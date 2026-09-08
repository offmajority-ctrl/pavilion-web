/**
 * Preloader — a full-screen 0–100 counter that fetches every byte the hero film and the pavilion need
 * (videos, geometry, textures, font), then mounts both from memory so nothing stalls once the visitor is in.
 *
 *   <section data-hero-video data-preload="true" …></section>   (+ the [data-pavilion] section)
 */
import { mountHero, heroAssetList } from './hero-video.js';

const FONT = 'Perpetua Titling MT Light';

export async function runPreloader({ heroEl, pavEl, mountPavilion, pavilionAssetList, label = '' } = {}) {
  // ---- overlay
  const ov = document.createElement('div');
  Object.assign(ov.style, { position: 'fixed', inset: '0', zIndex: '200', background: '#ebe3d8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', transition: 'opacity 800ms ease', fontFamily: `'${FONT}', 'Perpetua Titling MT', 'Perpetua', Georgia, serif`, color: 'rgba(64,48,36,.92)' });
  const num = document.createElement('div');
  Object.assign(num.style, { fontWeight: '300', fontSize: 'clamp(44px, 7vw, 96px)', lineHeight: '1', letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums' });
  num.textContent = '0';
  const sub = document.createElement('div');
  Object.assign(sub.style, { fontWeight: '300', fontSize: 'clamp(11px, 0.9vw, 13px)', letterSpacing: '0.34em', textIndent: '0.34em', textTransform: 'uppercase', opacity: '0.7' });
  sub.textContent = label;
  ov.appendChild(num); if (label) ov.appendChild(sub);
  document.body.appendChild(ov);
  document.documentElement.style.overflow = 'hidden';

  // ---- asset list (+ sizes from the manifest so the counter is byte-accurate)
  const heroAssets = heroEl ? heroAssetList(heroEl) : { base: '', files: [] };
  const pavAssets = pavEl ? pavilionAssetList(pavEl) : { base: '', files: [] };
  const urls = [...heroAssets.files.map((f) => heroAssets.base + f), ...pavAssets.files.map((f) => pavAssets.base + f)];
  const root = (pavAssets.base || heroAssets.base).replace(/(assets\/)(video\/)?$/, '$1');
  let sizes = {};
  try { sizes = await (await fetch(root + 'manifest.json', { cache: 'force-cache' })).json(); } catch (e) { /* fall back to per-response lengths */ }
  const sizeOf = (u) => { const rel = u.replace(root, ''); return sizes[rel] || 0; };
  const totals = {}; let total = 0;
  for (const u of urls) { totals[u] = sizeOf(u); total += totals[u]; }
  const loaded = {};
  let shown = 0, target = 0;
  // timer-driven (not rAF) so the counter keeps moving even when the tab is in the background
  const tickId = setInterval(() => { if (shown < target) { shown = Math.min(target, shown + Math.max(1, Math.round((target - shown) * 0.25))); num.textContent = String(shown); } if (shown >= 100) clearInterval(tickId); }, 50);
  const report = () => {
    const done = Object.values(loaded).reduce((a, b) => a + b, 0);
    const t = total || 1;
    target = Math.max(target, Math.min(92, Math.floor((done / t) * 92)));
  };

  // ---- fetch with streaming progress → blob URLs
  const urlMap = {};
  await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u);
      const len = +res.headers.get('content-length') || totals[u] || 0;
      if (!totals[u] && len) { totals[u] = len; total += len; }
      const type = res.headers.get('content-type') || '';
      if (!res.body || !res.body.getReader) { const b = await res.blob(); loaded[u] = totals[u] || b.size; urlMap[u] = URL.createObjectURL(b); report(); return; }
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.byteLength; loaded[u] = Math.min(got, totals[u] || got); report(); }
      loaded[u] = totals[u] || got; report();
      urlMap[u] = URL.createObjectURL(new Blob(chunks, { type }));
    } catch (e) { console.warn('[preload] failed', u, e); loaded[u] = totals[u] || 0; report(); }
  }));
  target = Math.max(target, 92);

  // ---- mount the pavilion from memory and wait until its first frames are rendered (shaders compiled, textures on the GPU)
  let pav = null;
  if (pavEl && mountPavilion) {
    pav = await new Promise((resolve) => {
      const api = mountPavilion(pavEl, { ...pavilionOptsFrom(pavEl), urlMap, onReady: () => resolve(api) });
      pavEl.__pavilion = api;
      // GPU warm-up needs frames; a background tab gets none, so don't hold the curtain there (or if WebGL is unavailable)
      const bail = () => setTimeout(() => resolve(api), 1500);
      if (document.hidden) bail(); else document.addEventListener('visibilitychange', () => { if (document.hidden) bail(); }, { once: true });
      setTimeout(() => resolve(api), 20000);
    });
  }
  target = 100; shown = 99; num.textContent = '100';

  // ---- mount the hero from memory, then lift the curtain
  let hero = null;
  if (heroEl) { hero = mountHero(heroEl, { ...heroOptsFrom(heroEl), urlMap, autoplay: false }); heroEl.__hero = hero; }
  await new Promise((r) => setTimeout(r, 350));
  ov.style.opacity = '0';
  if (!heroEl) document.documentElement.style.overflow = '';
  setTimeout(() => { ov.remove(); if (hero) hero.start(); }, 820);
  return { pav, hero, urlMap };
}

export function heroOptsFrom(el) {
  return { assetsUrl: el.dataset.assets || './assets/video/', cta: el.dataset.cta || 'ENTER', next: el.dataset.next || null, tier: el.dataset.tier || 'auto', font: el.dataset.font || null, mode: el.dataset.mode || 'overlay', lead: el.dataset.lead != null ? parseFloat(el.dataset.lead) : 1.0 };
}
export function pavilionOptsFrom(el) {
  return {
    assetsUrl: el.dataset.assets || './assets/', tier: el.dataset.tier || 'auto', poster: el.dataset.poster || null,
    parallax: el.dataset.parallax != null ? parseFloat(el.dataset.parallax) : 1, bloom: el.dataset.bloom != null ? parseFloat(el.dataset.bloom) : 0.1,
    scroll: el.dataset.scroll === 'true', stages: el.dataset.stages ? parseInt(el.dataset.stages, 10) : 4, snap: el.dataset.snap !== 'false', trackHeight: el.dataset.trackHeight || null,
    screens: el.dataset.screens ? el.dataset.screens.split(',').map((x) => x.trim()) : null, titles: el.dataset.titles ? el.dataset.titles.split('|').map((x) => x.trim()) : null,
    titleFont: el.dataset.titleFont || null, awaitEnter: el.dataset.awaitEnter === 'true',
    figureButton: el.dataset.figureButton !== undefined ? (el.dataset.figureButton || null) : 'VIEW', figureBack: el.dataset.figureBack || 'BACK',
  };
}
