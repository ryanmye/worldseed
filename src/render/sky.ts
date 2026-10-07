// Atmosphere shell, starfield and optional cloud layer. On the flat map (mapProjection.ts)
// the atmosphere and the stars fade out (main.ts) and the clouds lie on the map.

import * as THREE from 'three'
import { NOISE_GLSL } from './glsl.ts'
import { PLANET_RADIUS } from './globe.ts'
import { SUN_COLOR, SUN_DIRECTION, sunUniforms } from './sun.ts'
import { createCubeBake, type CubeBake } from './surfaceBake.ts'
import { RELIEF_GLSL } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { CITY_SKY_GLSL, lowAmount } from './citySky.ts'

const ATMOSPHERE_RADIUS = PLANET_RADIUS * 1.06
const SCALE_HEIGHT = 0.011
/** Radius of the cloud deck. */
export const CLOUD_DECK_RADIUS = PLANET_RADIUS * 1.012

export interface Atmosphere {
  mesh: THREE.Mesh
  setStrength(s: number): void
  /** The rendered ground's radius under the camera (per drawn frame). */
  setGroundRadius(r: number): void
  /** Ray-march steps (quality setting; rebuilds the shader when it changes). */
  setSteps(n: number): void
  dispose(): void
}

/**
 * Single-scattering approximation, ray-marched per pixel through an
 * exponential shell: blue Rayleigh in-scatter that is strong along the limb
 * (long path), a thin haze over the disc, reddened near the terminator and
 * absent on the night side. Composited as `inscatter + dst * transmittance`.
 */
export function buildAtmosphere(): Atmosphere {
  const geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 64)
  const uniforms = {
    uSun: { value: SUN_DIRECTION.clone() },
    uSunColor: { value: SUN_COLOR.clone() },
    uStrength: { value: 1 },
    // low camera (the city view, the closest zoom): 0 from space .. 1 near the ground, and the horizon's distance
    uLow: { value: 0 },
    uHorizon: { value: 0.15 },
    // the rendered ground's radius under the camera (low down the haze meets the ground there, not at sea level)
    uGround: { value: PLANET_RADIUS },
  }
  // one material per step count (switching quality never recompiles back and forth)
  const materials = new Map<number, THREE.ShaderMaterial>()
  const materialFor = (steps: number) => {
    let m = materials.get(steps)
    if (!m) {
      m = template.clone()
      m.uniforms = uniforms
      m.defines = { STEPS: steps }
      materials.set(steps, m)
    }
    return m
  }
  const template = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      uniform float uStrength;
      uniform float uLow;
      uniform float uHorizon;
      uniform float uGround;
      varying vec3 vWorld;

      const float RP = ${PLANET_RADIUS.toFixed(4)};
      const float RA = ${ATMOSPHERE_RADIUS.toFixed(4)};
      ${CITY_SKY_GLSL}
      const float H = ${SCALE_HEIGHT.toFixed(4)};
      // Rayleigh-like extinction per unit length at sea level (blue scatters most).
      const vec3 BETA = vec3(1.0, 2.4, 5.8);

      vec2 raySphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(1e9, -1e9);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }

      // Optical depth from point p toward the sun, approximated from altitude and sun zenith.
      float sunDepth(float alt, float cosZ) {
        float airmass = 1.0 / (max(cosZ, 0.0) + 0.15 * exp(-max(-cosZ, 0.0) * 8.0) + 0.02);
        return exp(-alt / H) * H * min(airmass, 40.0);
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        vec2 ta = raySphere(ro, rd, RA);
        if (ta.y <= 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tp = raySphere(ro, rd, mix(RP, clamp(uGround, RP, length(ro) - 1e-4), uLow));
        bool hitPlanet = tp.x > 0.0 && tp.x < t1;
        if (hitPlanet) t1 = tp.x;

        float ds = (t1 - t0) / float(STEPS);
        vec3 sum = vec3(0.0);
        float odView = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 q = ro + rd * (t0 + (float(i) + 0.5) * ds);
          float r = length(q);
          float alt = max(r - RP, 0.0);
          float dens = exp(-alt / H) * ds;
          odView += dens;
          vec3 up = q / r;
          float cosZ = dot(up, uSun);
          // planet shadow: soft cylinder behind the planet
          float along = dot(q, uSun);
          float perp = length(q - uSun * along);
          float lit = 1.0 - (1.0 - smoothstep(RP * 0.97, RP * 1.05, perp)) * smoothstep(0.0, 0.15, -along);
          vec3 trans = exp(-BETA * (odView + sunDepth(alt, cosZ)));
          sum += dens * lit * trans;
        }
        float cosT = dot(rd, uSun);
        float phase = 0.75 * (1.0 + cosT * cosT);
        // a little forward (Mie-ish) brightening toward the sun
        phase += 0.25 * pow(max(cosT, 0.0), 8.0);
        vec3 inscatter = sum * BETA * phase * uSunColor * 0.55 * uStrength;
        vec3 transmit = exp(-BETA * odView * 0.6 * uStrength);
        float t = dot(transmit, vec3(0.3, 0.4, 0.3));

        // Near the ground the shell alone leaves a black, starry sky over a sharply curved
        // horizon. There the sky dome (citySky.ts) draws the sky behind everything: the shell
        // lets it through (and the 3D towns rising above the horizon), and lays a distance haze
        // over the ground in the sky's own colour at the horizon (the same model), thickening
        // toward the horizon, so the land fades into the sky instead of ending at a rim.
        vec3 hazeAdd = vec3(0.0);
        if (uLow > 0.001) {
          vec3 upC = normalize(ro);
          if (!hitPlanet) {
            inscatter *= 1.0 - uLow;
            t = mix(t, 1.0, uLow);
          } else {
            float d = tp.x / max(uHorizon, 1e-3);
            float fog = min(0.92, 1.0 - exp(-1.6 * d * d)) * uLow;
            // (the haze is display-referred like the dome: added after the tone mapping)
            hazeAdd = citySkyHorizon(rd, upC, uSun) * fog;
            inscatter *= 1.0 - fog;
            t *= 1.0 - fog;
          }
        }

        gl_FragColor = vec4(inscatter, 1.0);
        #include <tonemapping_fragment>
        gl_FragColor.rgb += hazeAdd;
        #include <colorspace_fragment>
        gl_FragColor.a = t;
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geometry, materialFor(12))
  mesh.renderOrder = 10
  // daylight everywhere: scatter as if the sun were behind the viewer (an even limb glow)
  const camW = new THREE.Vector3()
  mesh.onBeforeRender = (_r, _s, camera) => {
    if (sunUniforms.uDaylight.value > 0.5) camera.getWorldPosition(uniforms.uSun.value).normalize()
    else uniforms.uSun.value.copy(SUN_DIRECTION)
    // the sky and the haze near the ground (see the shader)
    const alt = Math.max(1e-4, camera.getWorldPosition(camW).length() - PLANET_RADIUS)
    uniforms.uLow.value = lowAmount(alt)
    uniforms.uHorizon.value = Math.max(0.1, Math.sqrt(2 * alt * PLANET_RADIUS) * 0.85 + 0.01)
  }
  return {
    mesh,
    setStrength(s: number) {
      uniforms.uStrength.value = s
    },
    setSteps(n: number) {
      mesh.material = materialFor(n)
    },
    setGroundRadius(r: number) {
      uniforms.uGround.value = r
    },
    dispose() {
      geometry.dispose()
      template.dispose()
      for (const m of materials.values()) m.dispose()
    },
  }
}

/** Small deterministic PRNG (mulberry32), so the sky is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildStarfield(count = 3200): THREE.Points {
  const rand = mulberry32(0x5eed5)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const warm = [1.0, 0.82, 0.62]
  const cool = [0.68, 0.8, 1.0]
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1
    const th = rand() * Math.PI * 2
    const sr = Math.sqrt(1 - u * u)
    const radius = 90
    positions[i * 3] = radius * sr * Math.cos(th)
    positions[i * 3 + 1] = radius * u
    positions[i * 3 + 2] = radius * sr * Math.sin(th)
    // many faint stars, few bright ones
    const m = Math.pow(rand(), 4.0)
    const brightness = 0.18 + 1.6 * m
    sizes[i] = 1.4 + 2.2 * Math.sqrt(m)
    const k = rand()
    const tint = k < 0.25 ? warm : k > 0.75 ? cool : [1, 1, 1]
    const mixT = k < 0.25 || k > 0.75 ? 0.4 + 0.6 * rand() : 0
    for (let c = 0; c < 3; c++) {
      colors[i * 3 + c] = brightness * (1 + (tint[c] - 1) * mixT)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      uniform float uFade; // 0 on the flat map
      varying vec3 vColor;
      void main() {
        vColor = aColor * uFade;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float a = exp(-r2 * 3.5) * (1.0 - smoothstep(0.7, 1.0, r2));
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
        #include <colorspace_fragment>
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const points = new THREE.Points(geometry, material)
  points.renderOrder = -1
  points.frustumCulled = false
  const cssSize = new THREE.Vector2()
  points.onBeforeRender = (renderer) => {
    // (a frame drawn into a smaller target while the view moves: that target's ratio)
    const rt = renderer.getRenderTarget()
    material.uniforms.uPixelRatio.value = rt ? rt.width / Math.max(1, renderer.getSize(cssSize).x) : renderer.getPixelRatio()
  }
  return points
}

export interface Clouds {
  mesh: THREE.Mesh
  update(dt: number): void
  /**
   * Bake the (static, object-space) cloud cover into a cube map of face size `size`; until
   * the bake is ready (and with size 0) the procedural shader draws.
   */
  setBakeSize(size: number): void
  /** Draw up to `maxFaces` bake faces; returns true while a bake is in progress. */
  bakeStep(renderer: THREE.WebGLRenderer, maxFaces: number, sync?: boolean): boolean
  readonly bakeInfo: { ready: boolean; pending: boolean; count: number; lastMs: number; bytes: number; size: number }
  /** Debug: false draws the procedural shader even when the bake is ready (A/B timing). */
  setBakeUse(on: boolean): void
  dispose(): void
}

/** Cloud cover in 0..0.9 at unit direction p (object space); footprint for the noise level of detail. */
const CLOUD_COVER_GLSL = /* glsl */ `
float cloudCover(vec3 p, float footprint) {
  float lat = abs(p.y);
  // domain warp for swirly structure; stretched east-west like real weather systems
  vec3 ps = p * vec3(1.0, 1.9, 1.0);
  vec3 q = ps + 0.3 * vec3(
    ws_fbm(ps + uOffset, 1.6, 3, footprint),
    ws_fbm(ps + uOffset + 5.2, 1.6, 3, footprint),
    ws_fbm(ps + uOffset + 9.7, 1.6, 3, footprint));
  float n = ws_fbm(q + uOffset * 1.7, 3.0, 4, footprint);
  float detail = ws_fbm(q * 1.0 + uOffset * 2.3, 14.0, 4, footprint);
  // more cloud along the ITCZ and mid-latitude storm tracks, less in the subtropics
  float band = 0.22 * exp(-lat * lat * 60.0) + 0.14 * smoothstep(0.5, 0.75, lat) - 0.12 * smoothstep(0.85, 1.0, lat) - 0.25 * exp(-pow((lat - 0.4) * 6.0, 2.0));
  float cov = n + band + 0.2 * detail;
  float c = smoothstep(0.2, 0.58, cov);
  return c * smoothstep(-0.2, 0.3, detail + 0.25) * 0.9;
}
`

const CLOUD_VERT = /* glsl */ `
  ${RELIEF_GLSL}
  // the deck's drift (its turn about the planet's axis): the map is laid out in planet space
  uniform mat3 uCloudTurn;
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    vec3 p = position;
    if (uFlat > 0.0) p = transpose(uCloudTurn) * ws_placeV(uCloudTurn * position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const CLOUD_FRAG = /* glsl */ `
  uniform vec3 uSunObj;
  uniform vec3 uSunColor;
  uniform vec3 uOffset;
  uniform vec3 uCamObj;
  uniform float uDaylight;
  uniform float uLow;
  uniform sampler2D uPuffs;
  varying vec3 vObjPos;
  ${SEAM_FRAG_GLSL}
  ${CITY_SKY_GLSL}
  // small fair-weather clouds (below the globe's resolution): the puff texture laid over the
  // deck in object space (three planar projections blended by the normal: no seams, no swimming)
  float puffs(vec3 p, vec3 n) {
    vec3 w = pow(abs(n), vec3(8.0));
    w /= w.x + w.y + w.z;
    float a = texture2D(uPuffs, p.yz * 9.0).r * w.x + texture2D(uPuffs, p.zx * 9.0).r * w.y + texture2D(uPuffs, p.xy * 9.0).r * w.z;
    float b = texture2D(uPuffs, p.yz * 23.0 + 0.37).r * w.x + texture2D(uPuffs, p.zx * 23.0 + 0.37).r * w.y + texture2D(uPuffs, p.xy * 23.0 + 0.37).r * w.z;
    return a * 0.68 + b * 0.32;
  }
#ifdef CLOUD_BAKED
  uniform samplerCube uCover;
#else
  ${NOISE_GLSL}
  ${CLOUD_COVER_GLSL}
#endif
  void main() {
    ws_clipLine();
    vec3 p = normalize(vObjPos);
    if (uFlat > 0.0 && abs(p.y) > sin(uMapCentre.z)) discard; // (the map stops short of the poles)
#ifdef CLOUD_BAKED
    float c = textureCube(uCover, vObjPos).r;
#else
    float c = cloudCover(p, length(fwidth(vObjPos)));
#endif
    if (c < 0.004 && uLow < 0.001) discard;
    vec3 L = normalize(uSunObj);
    float mu = uDaylight > 0.5 ? 0.9 : dot(p, L);
    float day = smoothstep(-0.15, 0.15, mu);
    vec3 V = normalize(uCamObj - vObjPos);
    float limb = mix(smoothstep(0.0, 0.25, dot(p, V)), 1.0, uFlat);
    vec3 col = vec3(0.95) * (uSunColor * max(mu * 0.8 + 0.2, 0.0) * day + vec3(0.015, 0.02, 0.035));
    gl_FragColor = vec4(col, c * mix(0.6, 1.0, limb));
    #include <tonemapping_fragment>
    if (uLow > 0.001) {
      // seen from below (the city view): the deck's underside, coloured with the sky (citySky.ts):
      // white-grey by day, warm toward a low sun and blue-grey away from it at sunset, a dark
      // silhouette against the night sky; thinning into the horizon haze. Display-referred like the dome.
      vec3 up = normalize(uCamObj);
      vec3 rd = normalize(vObjPos - uCamObj);
      float e = dot(rd, up);
      if (uDaylight > 0.5) L = up;
      float sunH = dot(up, L);
      vec3 rh = rd - up * e, sh = L - up * sunH;
      float tw = 0.5 + 0.5 * dot(rh, sh) * inversesqrt(max(dot(rh, rh) * dot(sh, sh), 1e-8));
      float cosT = dot(rd, L);
      // the deck's cover, with small clouds added (more of them near the large ones)
      float n = puffs(vObjPos, p);
      c = max(c, 0.8 * smoothstep(0.6 - 0.3 * c, 0.76 - 0.25 * c, n));
      float thick = smoothstep(0.1, 0.8, c);
      vec3 dayC = vec3(0.74, 0.76, 0.8) * mix(1.0, 0.62, thick);
      // the sun behind thin cloud: a bright, silvery edge
      dayC += vec3(0.6, 0.56, 0.48) * pow(max(cosT, 0.0), 10.0) * (1.0 - thick);
      vec3 warmC = mix(vec3(0.3, 0.3, 0.44), mix(vec3(0.95, 0.4, 0.36), vec3(1.0, 0.48, 0.14), smoothstep(0.7, 1.0, tw)), smoothstep(0.15, 0.8, tw)) * mix(1.0, 0.75, thick);
      float E = sunElevDeg(sunH);
      float warm = rampWarm(E) * rampDusk(E);
      // still lit from below a little after sunset (the cloud is higher than the town), then dark
      float lit = rampLamps(E);
      vec3 sky = citySkyColor(rd, up, L);
      vec3 under = mix(sky * 0.55, mix(dayC, warmC, warm), lit);
      under = mix(under, citySkyHorizon(rd, up, L), 0.5 * exp(-max(e, 0.0) / 0.035));
      float a = smoothstep(0.03, 0.4, c) * 0.94 * smoothstep(0.0, 0.03, e);
      if (a < 0.003) discard;
      gl_FragColor = mix(gl_FragColor, vec4(under, a), uLow);
    }
    #include <colorspace_fragment>
  }
`

const CLOUD_BAKE_FRAG = /* glsl */ `
  uniform vec3 uOffset;
  varying vec3 vObjPos;
  ${NOISE_GLSL}
  ${CLOUD_COVER_GLSL}
  void main() {
    gl_FragColor = vec4(cloudCover(normalize(vObjPos), length(fwidth(vObjPos))), 0.0, 0.0, 1.0);
  }
`

/**
 * A tileable fractal value-noise texture (256 x 256, one byte), made once per world from its
 * seed: the small clouds seen from below the deck in the city view (CLOUD_FRAG's puffs()).
 */
function puffTexture(rand: () => number): THREE.DataTexture {
  const N = 256
  const out = new Float32Array(N * N)
  let amp = 1, total = 0
  for (let cells = 8; cells <= 64; cells *= 2) {
    const g = new Float32Array(cells * cells)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    const k = cells / N
    for (let y = 0; y < N; y++) {
      const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty)
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells
      for (let x = 0; x < N; x++) {
        const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx)
        const c0 = x0 % cells, c1 = (x0 + 1) % cells
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx
        const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx
        out[y * N + x] += amp * (a + (b - a) * sy)
      }
    }
    total += amp
    amp *= 0.5
  }
  const data = new Uint8Array(N * N)
  for (let i = 0; i < data.length; i++) data[i] = Math.round((out[i] / total) * 255)
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/** Procedural cloud deck on a slightly larger sphere, drifting slowly over the surface. */
export function buildClouds(seed: number): Clouds {
  const geometry = new THREE.SphereGeometry(CLOUD_DECK_RADIUS, 160, 120)
  const rand = mulberry32(seed ^ 0xc10d)
  const offset = new THREE.Vector3(rand() * 100, rand() * 100, rand() * 100)
  const uniforms = {
    uSunObj: { value: SUN_DIRECTION.clone() },
    uSunColor: { value: SUN_COLOR.clone() },
    uOffset: { value: offset },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uDaylight: sunUniforms.uDaylight,
    uLow: { value: 0 },
    uPuffs: { value: puffTexture(rand) },
    ...flatUniforms,
    uCloudTurn: { value: new THREE.Matrix3() },
  }
  const blend = { transparent: true, depthWrite: false }
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, ...blend })
  let bakedMaterial: THREE.ShaderMaterial | null = null
  let bake: CubeBake | null = null
  let bakeSize = 0
  let bakeCount = 0
  let useBake = true
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 5
  const tmpQ = new THREE.Quaternion()
  const tmpCam = new THREE.Vector3()
  const pick = () => {
    mesh.material = useBake && bake && bake.ready && bakedMaterial ? bakedMaterial : material
  }
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.getWorldQuaternion(tmpQ).invert()
    uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
    camera.getWorldPosition(tmpCam)
    uniforms.uCamObj.value.copy(mesh.worldToLocal(tmpCam))
    // from below the deck (the city view, the closest zoom) its inside faces show, shaded as seen from under it
    const below = uniforms.uCamObj.value.length() < CLOUD_DECK_RADIUS
    ;(mesh.material as THREE.ShaderMaterial).side = below ? THREE.BackSide : THREE.FrontSide
    uniforms.uLow.value = below ? lowAmount(tmpCam.length() - PLANET_RADIUS) : 0
    const c = Math.cos(mesh.rotation.y), s = Math.sin(mesh.rotation.y)
    uniforms.uCloudTurn.value.set(c, 0, s, 0, 1, 0, -s, 0, c)
  }
  const disposeBake = () => {
    bake?.dispose()
    bakedMaterial?.dispose()
    bake = null
    bakedMaterial = null
  }
  return {
    mesh,
    update(dt: number) {
      mesh.rotation.y += dt * 0.004
    },
    setBakeSize(size: number) {
      if (size === bakeSize && (bake || size <= 0)) return
      disposeBake()
      bakeSize = size
      if (size > 0) {
        const bakeMat = new THREE.ShaderMaterial({ uniforms: { uOffset: uniforms.uOffset }, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_BAKE_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false })
        bake = createCubeBake(geometry, [{ size, format: THREE.RedFormat, material: bakeMat }], 0.2, 4)
        bakedMaterial = new THREE.ShaderMaterial({
          uniforms: { ...uniforms, uCover: { value: bake.textures[0] } },
          defines: { CLOUD_BAKED: '' },
          vertexShader: CLOUD_VERT,
          fragmentShader: CLOUD_FRAG,
          ...blend,
        })
        bake.start()
      }
      pick()
    },
    bakeStep(renderer: THREE.WebGLRenderer, maxFaces: number, sync = false) {
      if (!bake || !bake.pending) return false
      const more = bake.step(renderer, maxFaces, sync)
      if (!more) {
        bakeCount++
        pick()
      }
      return more
    },
    get bakeInfo() {
      return { ready: bake?.ready ?? false, pending: bake?.pending ?? false, count: bakeCount, lastMs: bake?.lastMs ?? 0, bytes: bake?.bytes ?? 0, size: bakeSize }
    },
    setBakeUse(on: boolean) {
      useBake = on
      pick()
    },
    dispose() {
      disposeBake()
      geometry.dispose()
      material.dispose()
      uniforms.uPuffs.value.dispose()
    },
  }
}
