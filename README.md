# Pavilion — wedding stage web section

A self-contained Three.js section: baked Cycles lighting, live blurred floor reflection, light-shaft cones,
bloom and cursor/gyro parallax. Total download ≈ 5 MB on desktop (hi tier), ≈ 1.2 MB on phones (lo tier),
plus the 150 KB script (gzipped) — the poster image shows instantly while the 3D loads.

## Files

```
pavilion-section.js        IIFE bundle (global `Pavilion`) — use with a <script> tag
pavilion-section.esm.js    ES module build — `import { mountPavilion } from ...`
assets/
  stage0.glb               geometry (quantized, no decoder needed)
  poster.jpg               still shown while loading
  hi/*.webp                desktop textures (2K–4K)
  lo/*.webp                phone / weak-GPU textures (1K–2K)
index.html                 demo page
```

## Hosting

Put this folder in a public GitHub repo and serve it through jsDelivr, e.g. for `USER/pavilion-web` on branch `main`:

```
https://cdn.jsdelivr.net/gh/USER/pavilion-web@main/pavilion-section.js
https://cdn.jsdelivr.net/gh/USER/pavilion-web@main/assets/
```

(Any static host with CORS enabled works: Cloudflare R2, Bunny, Netlify, GitHub Pages.)

## Embedding (Webflow or any HTML)

```html
<div id="pavilion" data-pavilion
     data-assets="https://cdn.jsdelivr.net/gh/USER/pavilion-web@main/assets/"
     style="width:100%;height:100vh"></div>
<script src="https://cdn.jsdelivr.net/gh/USER/pavilion-web@main/pavilion-section.js" defer></script>
```

The section fills whatever size its container has — control layout and responsiveness with your own CSS.
Optional attributes: `data-tier="hi|lo|auto"` (default auto), `data-parallax="0..2"` (default 1), `data-bloom="0..1"` (default 0.25),
`data-poster="url"`.

### Scroll-driven camera

```html
<section data-pavilion data-assets="…/assets/" data-scroll="true" data-stages="4" data-snap="true"></section>
```

With `data-scroll="true"` the element becomes a tall scroll track (`data-stages` × 100vh, or `data-track-height="350vh"`) with a sticky
100vh viewport inside. As the page scrolls through it the camera turns smoothly from stage to stage (90° apart, eased), and turns back when
scrolling up. `data-snap` adds gentle scroll-snapping to each stage. `data-screens="screen_wedding,screen_dinner,…"` picks a screen image per stage
(files in `assets/hi|lo/`). `api.goTo(k)` scrolls to a stage; `api.stage` is the current one; `onStage(k)` fires on change.

Programmatic use:

```js
const pav = Pavilion.mountPavilion(el, { assetsUrl, tier: 'auto', parallax: 1, bloom: 0.25, onReady(api) {} });
pav.enableGyro();       // iOS needs this from a user gesture (tap) to allow tilt parallax
pav.setScreenDim(0.5);  // dips the screen glow (for transitions)
pav.dispose();
```

## Behaviour

- Renders only while the section is on screen and the tab is visible; disposes cleanly.
- Device tier from GPU/memory/UA: phones and weak GPUs get smaller textures, lighter bloom and reflection, pixel ratio ≤ 1.5.
- Texture uploads are staggered across frames so the page never stalls.
- If WebGL is unavailable or the context is lost, the poster stays in place.
- Colour: AgX tone mapping + a small grade tuned against the Blender render.

## Regenerating

Source scene: `pavilion_v2.blend`. Lightmaps are baked with Cycles (DIFFUSE pass, log-encoded 8-bit),
geometry exported from the `EXP_*` copies as glTF and quantized with gltf-transform. Shaders live in `src/shaders.js`.
