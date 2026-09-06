/**
 * Pavilion — wedding stage web section.
 * Baked (Cycles) lighting + live blurred floor reflection, light-shaft cones, bloom, cursor/gyro parallax.
 *
 *   import { mountPavilion } from './pavilion-section.js'
 *   const pav = mountPavilion(document.querySelector('#pavilion'), { assetsUrl: 'https://.../assets/' })
 *   pav.dispose()
 *
 * Or as a plain script: any element with [data-pavilion] is mounted automatically,
 * reading data-assets, data-tier (auto|hi|lo) and data-poster.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as S from './shaders.js';

const DEFAULTS = {
  assetsUrl: './assets/',
  tier: 'auto',            // 'hi' | 'lo' | 'auto'
  poster: null,            // url of a still shown while loading (defaults to assets/poster.jpg)
  parallax: 1.0,           // 0 disables
  scroll: false,           // scroll-driven camera: the container becomes a tall track with a sticky viewport
  stages: 4,               // number of stages the camera turns through (90° apart)
  snap: true,              // scroll-snap to each stage (scroll mode only)
  trackHeight: null,       // e.g. '350vh' — defaults to stages * 100vh
  screens: null,           // per-stage screen texture names, e.g. ['screen_wedding', 'screen_dinner', ...]
  onStage: null,           // called with the nearest stage index when it changes
  titles: null,            // per-stage header text, e.g. ['WEDDINGS & ENGAGEMENTS', 'DINNERS', ...]
  titleFont: null,         // woff2 url (defaults to assets/fonts/NotoSerifDisplay-Thin.woff2)
  titleFamily: 'Noto Serif Display Thin',
  bloom: 0.25,
  exposure: 1.0,
  maxPixelRatio: 2.0,
  onReady: null,
  onFrame: null,
};

// ------------------------------------------------------------------ device tier
export function detectTier(renderer) {
  try {
    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && screen.width < 1100);
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    const weakGpu = /Mali-4|Mali-T|Adreno \(TM\) [345]|PowerVR|Intel\(R\) HD Graphics [45]|SwiftShader|llvmpipe/i.test(gpu);
    if (weakGpu || mem <= 3 || (mobile && cores <= 4)) return 'lo';
    if (mobile) return 'lo';
    return 'hi';
  } catch (e) { return 'lo'; }
}

// ------------------------------------------------------------------ planar reflection helper (floor)
class FloorReflection {
  constructor(renderer, scene, camera, scale) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.scale = scale;
    this.reflCam = new THREE.PerspectiveCamera(); this.reflCam.layers.enable(1);
    this.textureMatrix = new THREE.Matrix4();
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 };
    this.rt = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtBlurA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtBlurB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    for (const t of [this.rt, this.rtBlurA, this.rtBlurB]) { t.texture.minFilter = THREE.LinearFilter; t.texture.magFilter = THREE.LinearFilter; }
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: S.blurVert, fragmentShader: S.blurFrag, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = { normal: new THREE.Vector3(), camWorld: new THREE.Vector3(), look: new THREE.Vector3(), view: new THREE.Vector3(), target: new THREE.Vector3(), q: new THREE.Vector4(), clip: new THREE.Vector4(), rot: new THREE.Matrix4(), mplane: new THREE.Plane() };
    this.blurPasses = 4;
  }
  setSize(w, h) {
    const rw = Math.max(64, Math.round(w * this.scale)), rh = Math.max(64, Math.round(h * this.scale));
    this.rt.setSize(rw, rh); this.rtBlurA.setSize(rw >> 2, rh >> 2); this.rtBlurB.setSize(rw >> 2, rh >> 2);
  }
  render(floorMesh) {
    const v = this._v, cam = this.camera, rc = this.reflCam, r = this.renderer;
    v.normal.set(0, 1, 0); v.camWorld.setFromMatrixPosition(cam.matrixWorld);
    if (v.camWorld.y < 0.02) return; // camera below floor: skip
    v.view.copy(v.camWorld); v.view.y = -v.view.y;             // mirror across y=0
    v.look.set(0, 0, -1).applyQuaternion(cam.quaternion).add(v.camWorld); v.look.y = -v.look.y;
    v.target.copy(v.look);
    rc.position.copy(v.view); rc.up.set(0, -1, 0); rc.lookAt(v.target); rc.up.set(0, 1, 0);
    rc.far = cam.far; rc.near = cam.near; rc.fov = cam.fov; rc.aspect = cam.aspect; rc.updateProjectionMatrix(); rc.updateMatrixWorld();
    // texture matrix for projective lookup
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near clipping plane (Lengyel), so nothing below the floor leaks in
    v.mplane.set(v.normal, 0).applyMatrix4(rc.matrixWorldInverse);
    v.clip.set(v.mplane.normal.x, v.mplane.normal.y, v.mplane.normal.z, v.mplane.constant);
    const p = rc.projectionMatrix;
    v.q.x = (Math.sign(v.clip.x) + p.elements[8]) / p.elements[0];
    v.q.y = (Math.sign(v.clip.y) + p.elements[9]) / p.elements[5];
    v.q.z = -1.0; v.q.w = (1.0 + p.elements[10]) / p.elements[14];
    v.clip.multiplyScalar(2.0 / v.clip.dot(v.q));
    p.elements[2] = v.clip.x; p.elements[6] = v.clip.y; p.elements[10] = v.clip.z + 1.0; p.elements[14] = v.clip.w;

    const prevRT = r.getRenderTarget();
    floorMesh.visible = false;
    r.setRenderTarget(this.rt); r.clear(); r.render(this.scene, rc);
    floorMesh.visible = true;
    // separable blur into rtBlurB
    const bw = this.rtBlurA.width, bh = this.rtBlurA.height;
    let src = this.rt;
    for (let i = 0; i < this.blurPasses; i++) {
      const rad = [1.5, 2.5, 4.0, 6.0, 8.0, 10.0][Math.min(i, 5)];
      this.blurMat.uniforms.tDiffuse.value = src.texture; this.blurMat.uniforms.dir.value.set(rad / bw, 0);
      r.setRenderTarget(this.rtBlurA); r.render(this.quadScene, this.quadCam);
      this.blurMat.uniforms.tDiffuse.value = this.rtBlurA.texture; this.blurMat.uniforms.dir.value.set(0, rad / bh);
      r.setRenderTarget(this.rtBlurB); r.render(this.quadScene, this.quadCam);
      src = this.rtBlurB;
    }
    r.setRenderTarget(prevRT);
  }
  dispose() { for (const t of [this.rt, this.rtBlurA, this.rtBlurB]) t.dispose(); this.blurMat.dispose(); this.quad.geometry.dispose(); }
}

// ------------------------------------------------------------------ main
export function mountPavilion(container, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts };
  const assets = opts.assetsUrl.endsWith('/') ? opts.assetsUrl : opts.assetsUrl + '/';
  const state = { disposed: false, ready: false, visible: true, running: false, tier: 'hi', frames: 0, t: 0, last: performance.now() };

  // DOM — in scroll mode the container is the tall track and `view` is a sticky 100vh viewport inside it
  container.style.position ||= 'relative';
  let view = container;
  if (opts.scroll) {
    container.style.overflow = 'visible';
    container.style.height = opts.trackHeight || (opts.stages * 100) + 'vh';
    view = document.createElement('div');
    Object.assign(view.style, { position: 'sticky', top: '0', height: '100vh', width: '100%', overflow: 'hidden' });
    container.appendChild(view);
    if (opts.snap) {
      for (let k = 0; k < opts.stages; k++) {
        const m = document.createElement('div');
        Object.assign(m.style, { position: 'absolute', left: '0', width: '1px', height: '100vh', top: (k * 100) + 'vh', pointerEvents: 'none', scrollSnapAlign: 'start' });
        container.insertBefore(m, view);
      }
      document.documentElement.style.scrollSnapType ||= 'y proximity';
    }
  } else {
    container.style.overflow = 'hidden';
  }
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', opacity: '0', transition: 'opacity 900ms ease' });
  const poster = document.createElement('img');
  poster.alt = ''; poster.decoding = 'async'; poster.src = opts.poster || (assets + 'poster.jpg');
  Object.assign(poster.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', transition: 'opacity 900ms ease' });
  view.appendChild(poster); view.appendChild(canvas);

  // ---------------------------------------------------------------- header overlay (DOM text over the canvas, crisp at any DPR)
  let titleEl = null;
  if (opts.titles && opts.titles.length) {
    const fontUrl = opts.titleFont || (assets + 'fonts/NotoSerifDisplay-Thin.woff2');
    if (!document.getElementById('pavilion-font')) {
      const st = document.createElement('style'); st.id = 'pavilion-font';
      st.textContent = `@font-face{font-family:'${opts.titleFamily}';src:url('${fontUrl}') format('woff2');font-weight:100;font-style:normal;font-display:swap;}`;
      document.head.appendChild(st);
    }
    titleEl = document.createElement('h2');
    Object.assign(titleEl.style, {
      position: 'absolute', left: '50%', top: '11%', transform: 'translateX(-50%)', margin: '0', padding: '0 6vw', width: 'max-content', maxWidth: '100%', boxSizing: 'border-box',
      fontFamily: `'${opts.titleFamily}', 'Noto Serif Display', Georgia, serif`, fontWeight: '100', fontSize: 'clamp(14.5px, 1.9vw, 29px)', letterSpacing: '0.2em', textIndent: '0.2em', textTransform: 'uppercase',
      textAlign: 'center', lineHeight: '1.25', color: 'rgba(255, 241, 228, 0.94)', textShadow: '0 1px 18px rgba(40, 20, 10, 0.35)', pointerEvents: 'none', userSelect: 'none',
      opacity: '0', transition: 'opacity 700ms ease', whiteSpace: 'normal',
    });
    titleEl.textContent = opts.titles[0] || '';
    view.appendChild(titleEl);
  }
  let titleTimer = 0;
  const showTitle = (k) => {
    if (!titleEl) return;
    const next = (opts.titles && opts.titles[k]) || '';
    if (titleEl.textContent === next && titleEl.style.opacity === '1') return;
    titleEl.style.opacity = '0'; clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { titleEl.textContent = next; if (next) titleEl.style.opacity = '1'; }, next === titleEl.textContent ? 0 : 450);
  };

  // renderer
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) { console.warn('[pavilion] WebGL unavailable, keeping poster'); return { dispose() {}, get ready() { return false; } }; }
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.tier = opts.tier === 'auto' ? detectTier(renderer) : opts.tier;
  const hi = state.tier === 'hi';
  const pixelRatio = Math.min(opts.maxPixelRatio, window.devicePixelRatio || 1, hi ? 2 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  const texDir = assets + (hi ? 'hi/' : 'lo/');

  // scene + camera (matches Cam_0_Wedding: (0, 2.75, 0) looking at the stage 16.8 m away, 0.86° up)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 120);
  const camBase = new THREE.Vector3(0, 2.75, 0);
  const lookBase = new THREE.Vector3(0, 3.0, -16.8);
  camera.position.copy(camBase); camera.lookAt(lookBase);

  // post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), opts.bloom, 0.55, 0.9);
  bloom.resolution.set(hi ? 512 : 256, hi ? 512 : 256);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // display-space grade that brings three's AgX in line with Blender's AgX (measured against the Cycles render)
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, gain: { value: 0.94 }, sat: { value: 1.15 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float gain, sat; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float y = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(clamp(gain * y + sat * (c.rgb - y), 0.0, 1.0), 1.0); }',
  });
  composer.addPass(grade);

  const reflection = new FloorReflection(renderer, scene, camera, hi ? 0.5 : 0.35);
  reflection.blurPasses = hi ? 4 : 3;

  // ---------------------------------------------------------------- loading
  const texLoader = new THREE.TextureLoader();
  const loadTex = (name, { srgb = false, wrap = false, flipY = false } = {}) => new Promise((res, rej) => {
    texLoader.load(texDir + name + '.webp', (t) => {
      t.flipY = flipY; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = Math.min(hi ? 8 : 4, renderer.capabilities.getMaxAnisotropy());
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      res(t);
    }, undefined, rej);
  });

  const objects = {};
  const mats = {};
  const uniformsTime = [];

  const beamMaterial = (color, aTop, aBot, fadeH, edgePow, edgeBlend, noiseAmt) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(...color) }, aTop: { value: aTop }, aBot: { value: aBot }, height: { value: 31 }, fadeH: { value: fadeH }, edgePow: { value: edgePow }, edgeBlend: { value: edgeBlend }, noiseAmt: { value: noiseAmt }, time: { value: 0 }, boost: { value: 1 } },
      vertexShader: S.beamVert, fragmentShader: S.beamFrag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    });
    uniformsTime.push(m.uniforms.time); return m;
  };

  const load = async () => {
    const screenNames = Array.from({ length: opts.stages }, (_, k) => (opts.screens && opts.screens[k]) || 'screen_wedding');
    const uniqueScreens = [...new Set(screenNames)];
    const [gltf, gltfRest, tex, screenTex] = await Promise.all([
      new Promise((res, rej) => new GLTFLoader().load(assets + 'stage0.glb', res, undefined, rej)),
      opts.stages > 1 ? new Promise((res, rej) => new GLTFLoader().load(assets + 'stages_rest.glb', res, undefined, rej)) : Promise.resolve(null),
      (async () => {
        const [floor_irr, floor_alb, floor_detail, floor_rough, floor_normal, wall_rad, ceil_rad, archL_rad, archR_rad] = await Promise.all([
          loadTex('floor_irr'), loadTex('floor_alb', { srgb: true }), loadTex('floor_detail', { wrap: true }), loadTex('floor_rough', { wrap: true }), loadTex('floor_normal', { wrap: true }),
          loadTex('wall_rad'), loadTex('ceil_rad'), loadTex('archL_rad'), loadTex('archR_rad'),
        ]);
        return { floor_irr, floor_alb, floor_detail, floor_rough, floor_normal, wall_rad, ceil_rad, archL_rad, archR_rad };
      })(),
      Promise.all(uniqueScreens.map((n) => loadTex(n, { srgb: true }))).then((list) => Object.fromEntries(uniqueScreens.map((n, i) => [n, list[i]]))),
    ]);
    if (state.disposed) return;


    const baked = (map) => new THREE.ShaderMaterial({ uniforms: { map: { value: map }, exposure: { value: opts.exposure }, logNorm: { value: S.logNorm(6) } }, vertexShader: S.bakedVert, fragmentShader: S.bakedFrag, toneMapped: true });
    mats.wall = baked(tex.wall_rad); mats.ceil = baked(tex.ceil_rad); mats.archL = baked(tex.archL_rad); mats.archR = baked(tex.archR_rad);
    const screenMat = (map) => new THREE.ShaderMaterial({ uniforms: { map: { value: map }, intensity: { value: 1.0 * opts.exposure }, dim: { value: 0 } }, vertexShader: S.bakedVert, fragmentShader: S.screenFrag, toneMapped: true });
    mats.screens = screenNames.map((n) => screenMat(screenTex[n]));
    mats.screen = mats.screens[0];
    mats.floor = new THREE.ShaderMaterial({
      uniforms: {
        lightMap: { value: tex.floor_irr }, albedoMap: { value: tex.floor_alb }, detailMap: { value: tex.floor_detail }, roughMap: { value: tex.floor_rough }, normalMap: { value: tex.floor_normal },
        reflSharp: { value: reflection.rt.texture }, reflBlur: { value: reflection.rtBlurB.texture }, reflMatrix: { value: reflection.textureMatrix },
        tileScale: { value: 3.5 }, exposure: { value: opts.exposure }, logNorm: { value: S.logNorm(24) }, reflStrength: { value: 0.8 }, normalStrength: { value: 0.5 }, roughMin: { value: 0.22 }, roughMax: { value: 0.36 },
      }, vertexShader: S.floorVert, fragmentShader: S.floorFrag, toneMapped: true,
    });
    mats.beamCore = beamMaterial([1.0, 0.93, 0.82], 0.16, 0.015, 7.5, 2.0, 0.45, 0.0);
    mats.beamHaze = beamMaterial([1.0, 0.88, 0.72], 0.045, 0.012, 5.0, 2.2, 0.55, 0.25);

    const assign = (root) => root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name.replace(/^EXP_/, '');
      objects[n] = o; o.frustumCulled = false;
      const stageIdx = (n.match(/_(\d)(_|$)/) || [])[1];
      if (n === 'Floor') o.material = mats.floor;
      else if (n === 'RoomWall') o.material = mats.wall;
      else if (n === 'RoomCeiling') o.material = mats.ceil;
      else if (n === 'Arch_0_left') o.material = mats.archL;
      else if (n === 'Arch_0_right') o.material = mats.archR;
      else if (n.startsWith('Screen_')) { const k = Math.min(parseInt(stageIdx || '0', 10), mats.screens.length - 1); o.material = mats.screens[k]; if (k >= opts.stages) o.visible = false; }
      else if (n.startsWith('BeamCone_')) { o.material = mats.beamCore; o.renderOrder = 10; o.scale.y *= 1.3; if (parseInt(stageIdx || '0', 10) >= opts.stages) o.visible = false; }
      else if (n.startsWith('BeamHaze_')) { o.material = mats.beamHaze; o.renderOrder = 9; o.scale.y *= 1.3; if (parseInt(stageIdx || '0', 10) >= opts.stages) o.visible = false; }
    });
    assign(gltf.scene); scene.add(gltf.scene);
    if (gltfRest) { assign(gltfRest.scene); scene.add(gltfRest.scene); }
    // stagger GPU uploads over a few frames so the main thread never stalls on one big upload
    const texList = [...Object.values(tex), ...Object.values(screenTex)];
    let i = 0;
    const upload = () => { if (state.disposed) return; for (let k = 0; k < 3 && i < texList.length; k++, i++) renderer.initTexture(texList[i]); if (i < texList.length) requestAnimationFrame(upload); else { state.ready = true; start(); } };
    requestAnimationFrame(upload);
  };

  // ---------------------------------------------------------------- sizing
  const size = { w: 1, h: 1 };
  const resize = () => {
    const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight);
    if (w === size.w && h === size.h) return;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    const aspect = w / h;
    // keep the composition: horizontal FOV 77° on wide screens, tightening to 51° on portrait
    const t = THREE.MathUtils.clamp((aspect - 0.6) / (1.6 - 0.6), 0, 1);
    const hfov = THREE.MathUtils.lerp(51, 77, t);
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / aspect);
    camera.fov = THREE.MathUtils.radToDeg(vfov); camera.aspect = aspect; camera.updateProjectionMatrix();
    reflection.setSize(w * pixelRatio, h * pixelRatio);
  };
  const ro = new ResizeObserver(resize); ro.observe(view);

  // ---------------------------------------------------------------- parallax (cursor + gyro)
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  const onMove = (e) => { const r = view.getBoundingClientRect(); target.x = ((e.clientX - r.left) / r.width) * 2 - 1; target.y = ((e.clientY - r.top) / r.height) * 2 - 1; };
  const onLeave = () => { target.x = 0; target.y = 0; };
  let gyroBase = null;
  const onGyro = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!gyroBase) gyroBase = { g: e.gamma, b: e.beta };
    target.x = THREE.MathUtils.clamp((e.gamma - gyroBase.g) / 25, -1, 1);
    target.y = THREE.MathUtils.clamp((e.beta - gyroBase.b) / 25, -1, 1);
  };
  const enableGyro = async () => {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission(); if (p !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', onGyro, { passive: true }); return true;
    } catch (e) { return false; }
  };
  if (opts.parallax > 0) {
    container.addEventListener('pointermove', onMove, { passive: true });
    container.addEventListener('pointerleave', onLeave, { passive: true });
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function' && /Android|iPhone|iPad/i.test(navigator.userAgent)) enableGyro();
  }

  // ---------------------------------------------------------------- scroll-driven yaw (stage k sits at yaw k * 90°)
  const yaw = { target: 0, cur: 0, stage: 0 };
  const readScroll = () => {
    if (!opts.scroll) return;
    const r = container.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const travel = Math.max(1, r.height - vh);
    const p = THREE.MathUtils.clamp(-r.top / travel, 0, 1);
    yaw.target = p * (opts.stages - 1) * Math.PI / 2;
    const k = Math.round(p * (opts.stages - 1));
    if (k !== yaw.stage) { yaw.stage = k; showTitle(k); opts.onStage && opts.onStage(k, api); }
  };
  const onScroll = () => { readScroll(); if (state.visible && !state.running) start(); };
  if (opts.scroll) window.addEventListener('scroll', onScroll, { passive: true });

  // ---------------------------------------------------------------- loop
  let raf = 0;
  const loop = () => {
    raf = 0;
    if (state.disposed || !state.running) return;
    const now = performance.now(); const dtRaw = (now - state.last) / 1000; const dt = Math.min(0.05, dtRaw); state.last = now; state.t += dt;
    // damped parallax
    const k = 1 - Math.exp(-dt * 3.2);
    cur.x += (target.x - cur.x) * k; cur.y += (target.y - cur.y) * k;
    const px = cur.x * 0.45 * opts.parallax, py = -cur.y * 0.18 * opts.parallax;
    // camera yaw eases toward the scroll target; parallax is applied in the camera's own frame
    const ky = 1 - Math.exp(-Math.min(dtRaw, 0.5) * 4.5);
    yaw.cur += (yaw.target - yaw.cur) * ky;
    const sy = Math.sin(yaw.cur), cy = Math.cos(yaw.cur);
    const fwd = new THREE.Vector3(sy, 0, -cy), right = new THREE.Vector3(cy, 0, sy);
    camera.position.copy(camBase).addScaledVector(right, px); camera.position.y += py;
    const look = camBase.clone().addScaledVector(fwd, 16.8); look.y = lookBase.y; look.addScaledVector(right, px * 0.35); look.y += py * 0.35;
    camera.lookAt(look);
    camera.updateMatrixWorld();
    // beam life
    for (const u of uniformsTime) u.value = state.t;
    if (mats.beamCore) { mats.beamCore.uniforms.boost.value = 1 + Math.sin(state.t * 0.9) * 0.03; mats.beamHaze.uniforms.boost.value = 1 + Math.sin(state.t * 0.6 + 1) * 0.04; }
    if (objects.Floor) reflection.render(objects.Floor);
    composer.render();
    state.frames++;
    readScroll();   // polled every frame too, so throttled or missing scroll events never stall the camera
    if (state.frames === 2) { canvas.style.opacity = '1'; poster.style.opacity = '0'; showTitle(yaw.stage); setTimeout(() => { if (!state.disposed) poster.remove(); }, 1000); opts.onReady && opts.onReady(api); }
    opts.onFrame && opts.onFrame(dt, state);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (state.running || !state.ready) return; state.running = true; state.last = performance.now(); if (!raf) raf = requestAnimationFrame(loop); };
  const stop = () => { state.running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const io = new IntersectionObserver((entries) => { state.visible = entries[0].isIntersecting; if (state.visible && !document.hidden) start(); else stop(); }, { threshold: 0.01 });
  io.observe(container);
  const onVis = () => { if (document.hidden) stop(); else if (state.visible) start(); };
  document.addEventListener('visibilitychange', onVis);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); poster.style.opacity = '1'; canvas.style.opacity = '0'; console.warn('[pavilion] WebGL context lost'); });

  resize();
  load().catch((e) => { console.error('[pavilion] load failed', e); });

  const api = {
    get ready() { return state.ready; }, get tier() { return state.tier; }, scene, camera, renderer, materials: mats, objects, enableGyro,
    setScreenDim(v) { for (const m of (mats.screens || [])) m.uniforms.dim.value = v; },
    get stage() { return yaw.stage; }, get yaw() { return { ...yaw }; },
    goTo(k) {
      k = THREE.MathUtils.clamp(k | 0, 0, opts.stages - 1);
      if (!opts.scroll) { yaw.target = k * Math.PI / 2; yaw.stage = k; showTitle(k); return; }
      const r = container.getBoundingClientRect(); const vh = window.innerHeight || 1;
      const top = window.scrollY + r.top + (r.height - vh) * (k / Math.max(1, opts.stages - 1));
      window.scrollTo({ top, behavior: 'smooth' });
    },
    dispose() {
      state.disposed = true; stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('scroll', onScroll);
      container.removeEventListener('pointermove', onMove); container.removeEventListener('pointerleave', onLeave); window.removeEventListener('deviceorientation', onGyro);
      scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      for (const m of Object.values(mats).flat()) { for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) u.value.dispose(); m.dispose(); }
      reflection.dispose(); composer.dispose(); renderer.dispose(); canvas.remove(); poster.remove(); if (titleEl) titleEl.remove();
    },
  };
  return api;
}

// auto-mount for script-tag usage
if (typeof document !== 'undefined') {
  const auto = () => document.querySelectorAll('[data-pavilion]').forEach((el) => {
    if (el.__pavilion) return;
    el.__pavilion = mountPavilion(el, { assetsUrl: el.dataset.assets || './assets/', tier: el.dataset.tier || 'auto', poster: el.dataset.poster || null, parallax: el.dataset.parallax != null ? parseFloat(el.dataset.parallax) : 1, bloom: el.dataset.bloom != null ? parseFloat(el.dataset.bloom) : DEFAULTS.bloom, scroll: el.dataset.scroll === 'true', stages: el.dataset.stages ? parseInt(el.dataset.stages, 10) : DEFAULTS.stages, snap: el.dataset.snap !== 'false', trackHeight: el.dataset.trackHeight || null, screens: el.dataset.screens ? el.dataset.screens.split(',').map((x) => x.trim()) : null, titles: el.dataset.titles ? el.dataset.titles.split('|').map((x) => x.trim()) : null, titleFont: el.dataset.titleFont || null });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
}
