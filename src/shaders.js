// GLSL for the pavilion section. All lighting is baked in Blender (Cycles) into
// log-encoded 8-bit maps; the shaders decode them back to linear HDR so three.js
// AgX tone mapping matches the Blender look.

export const LOG_K = 400.0;
export const LOG_VMAX = 6.0;

export const logNorm = (vmax) => Math.log1p(vmax * LOG_K);
export const decodeChunk = /* glsl */ `
  const float LOG_K = ${LOG_K.toFixed(1)};
  uniform float logNorm;   // ln(1 + vmax * K) of the map's encoding
  vec3 decodeLog(vec3 c) { return (exp(c * logNorm) - 1.0) / LOG_K; }
`;

// ---------------------------------------------------------------- baked (unlit) surfaces: walls, ceiling, arch
export const bakedVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const bakedFrag = /* glsl */ `
  #include <common>
  ${decodeChunk}
  uniform sampler2D map;
  uniform sampler2D map2;     // alternate lighting (studio) for detached figures
  uniform float mixAmt;
  uniform float exposure;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec3 hdr = decodeLog(texture2D(map, vUv).rgb);
    if (mixAmt > 0.0) hdr = mix(hdr, decodeLog(texture2D(map2, vUv).rgb), mixAmt);
    hdr *= exposure;
    gl_FragColor = vec4(hdr, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- screen (emissive image)
export const screenFrag = /* glsl */ `
  #include <common>
  uniform sampler2D map;
  uniform float intensity;
  uniform float dim;        // transition dip 0..1
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec3 c = texture2D(map, vUv).rgb;          // sRGB texture -> sampled as linear by three
    // bottom 20 cm darkens so the panel visibly lifts off the floor (matches the Blender node)
    float baseDark = mix(0.18, 1.0, smoothstep(0.0, 0.2, vWorld.y));
    vec3 hdr = c * intensity * baseDark * (1.0 - 0.6 * dim);
    gl_FragColor = vec4(hdr, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- light shaft cones (core + haze)
export const beamVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Port of the Blender node tree: alpha = mapRange(z) * (1-facing)^p * smoothstep(fade) * noise
export const beamFrag = /* glsl */ `
  #include <common>
  uniform vec3 color;
  uniform float aTop, aBot, height, fadeH, edgePow, edgeBlend, noiseAmt, time, boost;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  // cheap value noise
  float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    float n = mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                  mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
    return n;
  }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vNormalW);
    float ndv = abs(dot(N, V));
    // Blender LayerWeight 'Facing' with blend b: facing = 1 - pow(ndv, 1/(1-b)) roughly; we want (1-facing)^p
    float k = 1.0 / max(1.0 - edgeBlend, 0.05);
    float edge = pow(pow(ndv, k), edgePow);
    float z = vWorld.y;
    float a = mix(aBot, aTop, clamp(z / height, 0.0, 1.0));
    float fade = smoothstep(0.0, fadeH, z);
    float n = 1.0;
    if (noiseAmt > 0.0) {
      float nv = vnoise(vWorld * 0.3 + vec3(0.0, -time * 0.05, 0.0));
      n = mix(1.0 - noiseAmt, 1.0 + noiseAmt, smoothstep(0.35, 0.65, nv));
    }
    float alpha = a * edge * fade * n;
    // emission strength 1.0 in Blender, additive over the scene
    vec3 hdr = color * alpha * boost;
    gl_FragColor = vec4(hdr, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- floor: baked light x albedo + live blurred planar reflection
export const floorVert = /* glsl */ `
  uniform mat4 reflMatrix;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec4 vRefl;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vRefl = reflMatrix * wp;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const floorFrag = /* glsl */ `
  #include <common>
  ${decodeChunk}
  uniform sampler2D lightMap;     // log irradiance, planar 68 m UV
  uniform sampler2D albedoMap;    // tinted concrete + mottle (sRGB), same UV
  uniform sampler2D detailMap;    // high-pass concrete grain, 0.5 = 1.0, tiled
  uniform sampler2D roughMap;     // tiled
  uniform sampler2D normalMap;    // tiled, OpenGL convention
  uniform sampler2D reflSharp;
  uniform sampler2D reflBlur;
  uniform float tileScale;        // metres per tile
  uniform float exposure;
  uniform float reflStrength;
  uniform float normalStrength;
  uniform float roughMin, roughMax;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec4 vRefl;

  void main() {
    vec2 tuv = vWorld.xz / tileScale;
    vec3 albedo = texture2D(albedoMap, vUv).rgb;                 // sRGB -> linear by three
    float detail = texture2D(detailMap, tuv).r * 2.0;
    albedo *= detail;
    vec3 light = decodeLog(texture2D(lightMap, vUv).rgb);
    vec3 diffuse = albedo * light;

    // perturbed normal for the reflection lookup + fresnel
    vec3 nm = texture2D(normalMap, tuv).xyz * 2.0 - 1.0;
    vec3 N = normalize(vec3(nm.x * normalStrength, 1.0, -nm.y * normalStrength));
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(N, V), 0.0);
    float rough = mix(roughMin, roughMax, texture2D(roughMap, tuv).r);

    // Schlick with F0 = 0.04 plus the clear-coat feel of the resin: reflections grow toward grazing angles
    float F = 0.09 + 0.91 * pow(1.0 - ndv, 5.0);
    vec2 duv = (vRefl.xy / vRefl.w) + N.xz * 0.012;
    vec3 rs = texture2D(reflSharp, duv).rgb;
    vec3 rb = texture2D(reflBlur, duv).rgb;
    vec3 refl = mix(rs, rb, 0.85);
    // rougher surface -> dimmer, broader highlight (energy roughly conserved by the blur)
    vec3 spec = refl * F * reflStrength * (1.0 - 0.35 * rough) * mix(1.0, detail, 0.4);

    vec3 hdr = (diffuse + spec) * exposure;
    gl_FragColor = vec4(hdr, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const blurVert = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const blurFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 dir;   // (1/w,0) or (0,1/h) scaled by radius
  varying vec2 vUv;
  void main(){
    float w[5]; w[0]=0.227027; w[1]=0.1945946; w[2]=0.1216216; w[3]=0.054054; w[4]=0.016216;
    vec3 c = texture2D(tDiffuse, vUv).rgb * w[0];
    for (int i=1;i<5;i++){
      c += texture2D(tDiffuse, vUv + dir*float(i)).rgb * w[i];
      c += texture2D(tDiffuse, vUv - dir*float(i)).rgb * w[i];
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ---------------------------------------------------------------- lamp discs seen only by the reflection camera (specular highlight of the spots)
export const lampVert = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const lampFrag = /* glsl */ `
  uniform vec3 color; uniform float intensity;
  varying vec2 vUv;
  void main(){
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
    gl_FragColor = vec4(color * intensity * a, 1.0);
  }
`;
