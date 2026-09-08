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
scrolling up. `data-snap` snaps the scroll to stages (`true` = mandatory, the page never rests between scenes; `proximity` = gentle; `false` = off). `data-screens="screen_wedding,screen_dinner,…"` picks a screen image per stage
(files in `assets/hi|lo/`). `api.goTo(k)` scrolls to a stage; `api.stage` is the current one; `onStage(k)` fires on change.

### Header

`data-titles="WEDDINGS & ENGAGEMENTS|DINNERS|CELEBRATIONS|CONCEPT"` (pipe-separated, one per stage) renders a tracked uppercase
header in Noto Serif Display Thin (`assets/fonts/`, 20 KB woff2) over the viewport; it crossfades when the stage changes. `data-title-font` overrides the font URL.

### Preloader (0–100)

Add `data-preload="true"` to the hero section (or the pavilion section when there is no hero). A full-screen counter then fetches every byte
the page needs for this device — the two film clips in the right size/format, the geometry, all textures and the font, sizes read from
`assets/manifest.json` (written by the build) so the number is byte-accurate — holds everything in memory, mounts the pavilion and waits for
its first frames to render (shaders compiled, textures on the GPU), then lifts the curtain and starts the film. Nothing loads or compiles
after that, so there are no stalls when entering the room or turning between stages. `data-preload-label="vie"` adds a small caption under the number.

### Hero video (landing)

```html
<section data-hero-video data-assets="…/assets/video/" data-cta="ENTER" data-next="#pavilion" style="height:100vh"></section>
```

The 10 s film is split with ffmpeg at exactly 6.5 s (frame 156 of 241) into `intro` and `outro` clips (H.264 MP4 + VP9 WebM, 1080p and 720p
tiers, no audio). The intro autoplays muted, holds on its last frame and fades in the CTA; the outro is already buffered and plays on click. By default the hero
is a fixed overlay (`data-mode="overlay"`, scrolling locked): as the film whites out it dissolves away and the pavilion below — started under a
warm-white veil, over-exposed and pushed out (`data-await-enter="true"` on the pavilion) — clears and dollies into the room, so ENTER and the
camera move carry you inside. `data-mode="section"` keeps the old behaviour (hero in the flow, smooth-scroll to `data-next`). Autoplay-blocked browsers hold on the poster with the same CTA; reduced-motion users get the hold frame
straight away. `api.continue()`, `api.phase` (`loading|intro|hold|outro|done|blocked`), `onHold/onContinue/onDone` hooks.

Re-cut: `ffmpeg -i vieNEW.mp4 -t 6.5 -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart -an intro_1080.mp4` and
`ffmpeg -ss 6.5 -i vieNEW.mp4 …outro_1080.mp4` (accurate seek by re-encoding), `-vf scale=1280:720` for the 720 tier,
`-c:v libvpx-vp9 -crf 30 -b:v 0` for WebM, `-ss 0 -frames:v 1 poster.jpg` for the poster.

### Figure detach (VIEW button)

A small VIEW button sits at the bottom of the pavilion viewport whenever the current stage has a figure (stage 0: the olive arch).
Clicking it locks scrolling and, over 2.6 s, fades the room to white while the figure lifts off, drifts toward the camera and turns a full
360°, landing centred on the white page with a soft drop shadow; its baked room lighting crossfades to a neutral studio bake
(`archL_studio` / `archR_studio`, baked in Blender with a white world). On white the visitor can drag to turn it; BACK reverses the flight.
`data-figure-button` / `data-figure-back` set the labels (empty `data-figure-button` hides it); `api.detach()`, `api.attach()`, `api.detached`,
`onDetach` / `onAttach` hooks. Landing-page content for the white state can be layered over the section (it is plain DOM above the canvas).

### Scroll-carried transformation (stage 1 → 2)

The olive arch (stage 1) and the corporate arch (stage 2, `corp_arch.glb`, baked at its spot with room lighting `archC_rad` and a
white-studio version `archC_studio`) share one carrier. The camera turns on scroll as before; the carrier follows the camera on its own
critically-damped spring (ω = 2.4, ~2 s to settle) so a flick and a slow drag produce the same choreography — the room arrives first, the
figure glides in after it. Along the way the figure lifts (+1.4 m), bows toward the camera (radius 16.8 → 12.3 m) and makes half a turn with
a sine ease; the arriving object is mounted back-to-front on the carrier so 180° ends facing the room. Through the second half of the turn
(sine progress 0.55–0.85) the old object dissolves out as it turns away while the new one fades in already showing its front and swings round to
face you, with a 5% scale breath — it reads as one shape reorganising rather than a cut. The beam over a stage goes out in the first 8% of the
lift and comes on only once the figure has settled (last 7%), and the baked floor pool dims with it (`poolOn` uniform in the floor shader).
Both figures are lit by their own room bakes when at home, and both get VIEW/BACK. Chaining to stages 3 and 4 only needs their objects baked
the same way (`figures[k]` with `home`, `homeRot = -k·90°`, room + studio maps).

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
