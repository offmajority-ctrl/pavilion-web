/**
 * Hero video — plays an intro clip, holds on its last frame with a CTA, and continues with the outro clip on click.
 * The clip is pre-split with ffmpeg into intro_{1080,720}.mp4 / outro_{1080,720}.mp4 + poster.jpg so the pause is frame-exact
 * and the second half is already buffered when the visitor clicks.
 *
 *   <section data-hero-video data-assets="…/assets/video/" data-cta="ENTER" data-next="#pavilion"></section>
 */
const DEFAULTS = {
  assetsUrl: './assets/video/',
  cta: 'ENTER',
  next: null,               // selector to scroll to when the outro finishes
  scrollDelay: 150,         // ms after the outro ends before scrolling
  font: null,               // woff2 url for the CTA (defaults to ../fonts/PerpetuaTitlingMT-Light.woff2 next to the video folder)
  fontFamily: 'Perpetua Titling MT Light',
  tier: 'auto',             // 'hi' (1080p) | 'lo' (720p) | 'auto'
  mode: 'overlay',          // 'overlay': fixed over the page, fades away into the section below; 'section': stays in flow and scrolls to `next`
  fadeMs: 1400,
  lead: 1.0,                // seconds before the outro ends at which the dissolve into the next section starts (overlaps the white-out)
  onHold: null, onContinue: null, onDone: null,
  urlMap: null,             // { url: blobUrl } from the preloader
  autoplay: true,           // false: wait for api.start() (the preloader lifts its curtain first)
};

export function heroTier(tier = 'auto') {
  const hi = tier === 'hi' || (tier === 'auto' && Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2) >= 1900 && !/Android|iPhone|iPod/i.test(navigator.userAgent));
  return hi ? '1080' : '720';
}
export function heroFormat() {
  try { const v = document.createElement('video'); return v.canPlayType('video/mp4; codecs="avc1.640028"') ? 'mp4' : (v.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4'); } catch (e) { return 'mp4'; }
}
/** Files the hero needs for this device (relative to its assets folder). */
export function heroAssetList(el) {
  const base = (el.dataset.assets || './assets/video/').replace(/\/?$/, '/');
  const q = heroTier(el.dataset.tier || 'auto'), f = heroFormat();
  return { base, files: [`intro_${q}.${f}`, `outro_${q}.${f}`, 'poster.jpg'] };
}

export function mountHero(container, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const assets = opts.assetsUrl.endsWith('/') ? opts.assetsUrl : opts.assetsUrl + '/';
  const R = (u) => (opts.urlMap && opts.urlMap[u]) || u;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = heroTier(opts.tier);
  const state = { phase: 'loading', disposed: false };

  const overlay = opts.mode === 'overlay';
  if (overlay) {
    Object.assign(container.style, { position: 'fixed', inset: '0', width: '100%', height: '100vh', zIndex: '60', transition: `opacity ${opts.fadeMs}ms ease` });
    document.documentElement.style.overflow = 'hidden';   // no scrolling until the film lets you in
  } else container.style.position ||= 'relative';
  container.style.overflow = 'hidden';
  container.style.backgroundColor ||= '#ebe3d8';
  container.style.backgroundImage = `url('${R(assets + 'poster.jpg')}')`;
  container.style.backgroundSize = 'cover'; container.style.backgroundPosition = 'center';

  const mkVideo = (name) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.preload = 'auto'; v.disablePictureInPicture = true;
    const fmts = opts.urlMap ? [[heroFormat(), heroFormat() === 'mp4' ? 'video/mp4' : 'video/webm']] : [['mp4', 'video/mp4'], ['webm', 'video/webm']];
    for (const [ext, type] of fmts) { const src = document.createElement('source'); src.src = R(`${assets}${name}_${q}.${ext}`); src.type = type; v.appendChild(src); }
    Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: '0', transition: 'opacity 500ms ease', pointerEvents: 'none' });
    container.appendChild(v); return v;
  };
  const intro = mkVideo('intro');
  const outro = mkVideo('outro');

  // ---- CTA
  const fontUrl = opts.font || (assets.replace(/video\/$/, '') + 'fonts/PerpetuaTitlingMT-Light.woff2');
  if (!document.getElementById('pavilion-font')) {
    const st = document.createElement('style'); st.id = 'pavilion-font';
    st.textContent = `@font-face{font-family:'${opts.fontFamily}';src:url('${fontUrl}') format('woff2');font-weight:300;font-style:normal;font-display:swap;}`;
    document.head.appendChild(st);
  }
  if (!document.getElementById('hero-cta-style')) {
    const st = document.createElement('style'); st.id = 'hero-cta-style';
    st.textContent = `
      .hero-cta{position:absolute;left:50%;bottom:17%;transform:translateX(-50%);display:inline-flex;flex-direction:column;align-items:center;gap:14px;background:none;border:0;padding:16px 28px;cursor:pointer;color:rgba(64,48,36,.92);text-shadow:0 0 14px rgba(255,248,240,.75);font-family:'${opts.fontFamily}','Perpetua Titling MT','Perpetua',Georgia,serif;font-weight:300;font-size:clamp(14px,1.4vw,20px);letter-spacing:.34em;text-indent:.34em;text-transform:uppercase;opacity:0;transition:opacity 900ms ease,transform 900ms ease;pointer-events:none;-webkit-tap-highlight-color:transparent}
      .hero-cta.on{opacity:1;pointer-events:auto}
      .hero-cta .ring{width:58px;height:58px;border:1px solid rgba(64,48,36,.55);border-radius:50%;display:flex;align-items:center;justify-content:center;transition:transform 600ms cubic-bezier(.2,.7,.2,1),border-color 400ms ease;animation:heroPulse 2.8s ease-in-out infinite}
      .hero-cta .ring:after{content:'';width:7px;height:7px;border-right:1px solid rgba(64,48,36,.85);border-bottom:1px solid rgba(64,48,36,.85);transform:translateY(-2px) rotate(45deg)}
      .hero-cta:hover .ring,.hero-cta:focus-visible .ring{transform:scale(1.12);border-color:rgba(64,48,36,.95);animation:none}
      .hero-cta:focus-visible{outline:none}
      @keyframes heroPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
      @media (prefers-reduced-motion:reduce){.hero-cta .ring{animation:none}}
      @media (max-width:767px){.hero-cta{bottom:12%}}`;
    document.head.appendChild(st);
  }
  const cta = document.createElement('button');
  cta.type = 'button'; cta.className = 'hero-cta'; cta.setAttribute('aria-label', opts.cta);
  cta.innerHTML = `<span class="ring" aria-hidden="true"></span><span>${opts.cta}</span>`;
  container.appendChild(cta);

  const showCta = () => { cta.classList.add('on'); state.phase = 'hold'; opts.onHold && opts.onHold(api); };
  const hideCta = () => { cta.classList.remove('on'); };

  // ---- flow
  const playIntro = async () => {
    try { await intro.play(); intro.style.opacity = '1'; state.phase = 'intro'; }
    catch (e) { intro.style.opacity = '0'; showCta(); state.phase = 'blocked'; }   // autoplay refused: hold on the poster, CTA starts everything
  };
  intro.addEventListener('ended', () => { intro.pause(); showCta(); });
  const finish = () => {
    if (state.phase === 'done') return;
    state.phase = 'done'; opts.onDone && opts.onDone(api);
    const target = opts.next ? document.querySelector(opts.next) : null;
    if (overlay) {
      // the film ends in white; the room starts white and pushed-out, and the two cross while the overlay dissolves
      if (target && target.__pavilion && target.__pavilion.enter) target.__pavilion.enter(2.8);
      document.documentElement.style.overflow = '';
      window.scrollTo(0, 0);
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      setTimeout(() => { container.style.display = 'none'; intro.pause(); outro.pause(); }, opts.fadeMs + 50);
    } else if (target) setTimeout(() => window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top, behavior: 'smooth' }), opts.scrollDelay);
    container.dispatchEvent(new CustomEvent('hero:done'));
  };
  outro.addEventListener('ended', finish);
  // start the dissolve `lead` seconds before the end so the hand-off happens inside the white-out, not after a visible stop
  const watchOutro = () => {
    if (state.phase !== 'outro') return;
    if (outro.duration && outro.currentTime >= outro.duration - opts.lead) { finish(); return; }
    requestAnimationFrame(watchOutro);
  };
  const continueVideo = async () => {
    if (state.phase === 'blocked') { hideCta(); intro.style.opacity = '1'; try { await intro.play(); state.phase = 'intro'; } catch (e) {} return; }
    if (state.phase !== 'hold') return;
    hideCta(); state.phase = 'outro'; opts.onContinue && opts.onContinue(api);
    outro.style.opacity = '1';
    try { await outro.play(); } catch (e) {}
    requestAnimationFrame(watchOutro);
    setTimeout(() => { intro.style.opacity = '0'; }, 250);
  };
  cta.addEventListener('click', continueVideo);

  // preload the outro as soon as the intro is playing; start when enough of the intro is buffered
  let armed = opts.autoplay, canPlay = false;
  const startWhenReady = () => { if (armed && canPlay && state.phase === 'loading' && !reduced) playIntro(); };
  intro.addEventListener('canplay', () => { canPlay = true; startWhenReady(); }, { once: true });
  intro.load(); outro.load();
  if (reduced) { intro.addEventListener('loadeddata', () => { try { intro.currentTime = Math.max(0, intro.duration - 0.05); intro.style.opacity = '1'; } catch (e) {} showCta(); }, { once: true }); }

  // pause everything when the hero is off screen / tab hidden
  const io = new IntersectionObserver((en) => { const on = en[0].isIntersecting; if (!on) { if (state.phase === 'intro') intro.pause(); if (state.phase === 'outro') outro.pause(); } else { if (state.phase === 'intro') intro.play().catch(() => {}); if (state.phase === 'outro') outro.play().catch(() => {}); } }, { threshold: 0.05 });
  io.observe(container);

  const api = {
    get phase() { return state.phase; }, intro, outro, continue: continueVideo, start() { armed = true; startWhenReady(); },
    dispose() { state.disposed = true; io.disconnect(); intro.pause(); outro.pause(); intro.innerHTML = ''; outro.innerHTML = ''; intro.load(); outro.load(); intro.remove(); outro.remove(); cta.remove(); },
  };
  return api;
}

if (typeof document !== 'undefined') {
  const auto = () => document.querySelectorAll('[data-hero-video]').forEach((el) => {
    if (el.__hero || el.dataset.preload !== undefined) return;
    el.__hero = mountHero(el, { assetsUrl: el.dataset.assets || './assets/video/', cta: el.dataset.cta || DEFAULTS.cta, next: el.dataset.next || null, tier: el.dataset.tier || 'auto', font: el.dataset.font || null, mode: el.dataset.mode || 'overlay', lead: el.dataset.lead != null ? parseFloat(el.dataset.lead) : DEFAULTS.lead });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
}
