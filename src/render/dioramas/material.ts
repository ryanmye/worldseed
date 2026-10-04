// The materials of the diorama layer, shared by every batch:
//  - models: instanced, lit by the same sun as the planet (sun.ts: same day/night
//    terminator, same sky ambient), team colour from a small palette. Generated buildings
//    get their facade in the fragment shader from object-space coordinates (stable and
//    seamless, fading out where a pattern would be finer than a pixel): windows and doors
//    as dark insets by storey, timber framing, stone courses, log walls or adobe grain by
//    style, tile, slate, thatch or turf on the roofs, darker plinths and eaves. At night the
//    same windows light up. Each instance carries its appear/disappear years, so the
//    pop-in (a short overshoot) and the shrink-away are pure functions of the year. A
//    camera-distance fade grows the models out of the ground as you zoom in. Up close they
//    receive the sun's shadow map (shadows.ts) on their walls and roofs.
//  - shadows: a soft dark blob under each model, stretched away from the sun; where the
//    shadow map covers the view it shrinks to a contact shadow (ambient occlusion).
//  - ground: the town's streets, squares, yards and gardens (layout.ts GroundSet), a
//    triangle list on the surface with its pattern (packed earth, paving, worn grass,
//    crop rows) per ground kind.
//  - depth and receiver: the shadow map pass, and the shadow it casts on the planet.
// All collapse instances outside their life or beyond the fade to nothing in the vertex
// shader, so instance sets only change on snapshot or camera steps.

import * as THREE from 'three'
import { SUN_COLOR, SUN_DIRECTION } from '../globe.ts'
import { sunUniforms } from '../sun.ts'
import { KK } from './models.ts'

/** Team colours (linear RGB); index 0 keeps the model's own colours. */
export const PALETTE: readonly [number, number, number][] = [
  [0, 0, 0],
  [0.55, 0.16, 0.08], // terracotta
  [0.27, 0.33, 0.45], // slate blue
  [0.55, 0.36, 0.1], // ochre
  [0.22, 0.32, 0.12], // moss
  [0.45, 0.1, 0.1], // brick red
  [0.12, 0.3, 0.32], // teal
  [0.38, 0.3, 0.24], // thatch brown
]

export interface DioramaUniforms {
  uYear: { value: number }
  uAnimYears: { value: number }
  uCamObj: { value: THREE.Vector3 }
  uSunObj: { value: THREE.Vector3 }
  /** Camera distance where models are full size (x) and gone (y). */
  uFade: { value: THREE.Vector2 }
  uSunColor: { value: THREE.Color }
  uPalette: { value: THREE.Vector3[] }
  /** Shared with every lit layer (sun.ts): 1 = daylight everywhere. */
  uDaylight: { value: number }
  /** World units per model unit of the generated buildings. */
  uKK: { value: number }
  /** Shadow map (depth, hardware compare), object space -> shadow texture space, on (0/1), texel size, depth bias. */
  uShadowMap: { value: THREE.DepthTexture | null }
  uShadowMat: { value: THREE.Matrix4 }
  uShadowOn: { value: number }
  uShadowTexel: { value: number }
  uShadowBias: { value: number }
  /** World units of one shadow texel (normal offset). */
  uShadowWorld: { value: number }
}

export function createUniforms(): DioramaUniforms {
  return {
    uYear: { value: 0 },
    uAnimYears: { value: 10 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uFade: { value: new THREE.Vector2(0.3, 0.5) },
    uSunColor: { value: SUN_COLOR.clone() },
    uPalette: { value: PALETTE.map(([r, g, b]) => new THREE.Vector3(r, g, b)) },
    uDaylight: sunUniforms.uDaylight,
    uKK: { value: KK },
    uShadowMap: { value: null },
    uShadowMat: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: 1 / 2048 },
    uShadowBias: { value: 0.001 },
    uShadowWorld: { value: 0.00004 },
  }
}

/** Shared by the instanced vertex shaders: the instance's size factor from its life and the camera fade. */
const LIFE_GLSL = /* glsl */ `
  attribute vec4 aColor;
  attribute vec4 aAnim; // appear year, disappear year, palette index | shadow height, flags + far fade
  uniform float uYear;
  uniform float uAnimYears;
  uniform vec3 uCamObj;
  uniform vec2 uFade;
  float easeOutBack(float t) {
    float e = t - 1.0;
    return 1.0 + 2.2 * e * e * e + 1.2 * e * e;
  }
  /** 0 = hidden; 1 = full size. aAnim.w above 2 holds a nearer fade-out distance (x 1000). */
  float instanceSize(vec3 origin) {
    if (uYear < aAnim.x) return 0.0;
    vec3 toCam = uCamObj - origin;
    float dist = length(toCam);
    float facing = dot(normalize(origin), toCam) / dist;
    float farD = aAnim.w >= 2.0 ? floor(aAnim.w * 0.5) * 0.002 : uFade.y;
    float near = 1.0 - smoothstep(min(uFade.x, farD * 0.66), farD, dist);
    float grow = clamp((uYear - aAnim.x) / uAnimYears, 0.0, 1.0);
    float shrink = clamp((uYear - aAnim.y) / uAnimYears, 0.0, 1.0);
    float life = easeOutBack(grow) * (1.0 - shrink * shrink);
    return life * near * near * (3.0 - 2.0 * near) * smoothstep(0.0, 0.12, facing);
  }
`

const SKY = 'vec3(0.30, 0.50, 0.95)'

/** Light direction at a point: the sun, or (daylight everywhere) the sun leaned to just off the local zenith. */
const SUN_AT_GLSL = /* glsl */ `
  uniform float uDaylight;
  vec3 sunAt(vec3 up, vec3 sunObj) {
    vec3 L = normalize(sunObj);
    if (uDaylight < 0.5) return L;
    vec3 t = L - up * dot(L, up);
    float tl = length(t);
    return normalize(up + (tl > 1e-4 ? t / tl : vec3(0.0)) * 0.6);
  }
`

/** How much of the shadow map covers a point (vertex or fragment shaders). */
const SHADOW_COVER_GLSL = /* glsl */ `
  uniform mat4 uShadowMat;
  uniform float uShadowOn;
  /** How much of the shadow map covers point p (0 outside, 1 well inside). */
  float shadowCover(vec3 p) {
    if (uShadowOn < 0.5) return 0.0;
    vec3 q = (uShadowMat * vec4(p, 1.0)).xyz;
    vec2 e = min(q.xy, 1.0 - q.xy);
    return smoothstep(0.0, 0.08, min(e.x, e.y)) * step(q.z, 1.0) * step(0.0, q.z);
  }
`

/** Shadow map lookup (fragment shaders): 1 = lit, 0 = in shadow; fades to lit toward the map's edge. */
export const SHADOW_GLSL = /* glsl */ `
  uniform sampler2DShadow uShadowMap;
  uniform mat4 uShadowMat;
  uniform float uShadowOn;
  uniform float uShadowTexel;
  uniform float uShadowBias;
  uniform float uShadowWorld;
  float shadowAt(vec3 p, vec3 n, float slope) {
    if (uShadowOn < 0.5) return 1.0;
    // normal offset against acne on the casters' own faces
    vec3 q = (uShadowMat * vec4(p + n * uShadowWorld * 1.5, 1.0)).xyz;
    vec2 e = min(q.xy, 1.0 - q.xy);
    float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
    if (edge <= 0.0 || q.z >= 1.0 || q.z <= 0.0) return 1.0;
    float z = q.z - uShadowBias * (1.0 + 2.0 * slope);
    float t = uShadowTexel;
    float s = texture(uShadowMap, vec3(q.xy + vec2(-0.6, -0.25) * t, z))
      + texture(uShadowMap, vec3(q.xy + vec2(0.25, -0.6) * t, z))
      + texture(uShadowMap, vec3(q.xy + vec2(0.6, 0.25) * t, z))
      + texture(uShadowMap, vec3(q.xy + vec2(-0.25, 0.6) * t, z));
    return mix(1.0, s * 0.25, edge);
  }
`

export function createModelMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      uniform vec3 uPalette[${PALETTE.length}];
      uniform float uKK;
      varying vec3 vAlb;
      varying vec3 vN;
      varying vec3 vUp;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec3 vScale;
      varying vec3 vObj;
      varying vec4 vInfo;
      varying vec2 vFace;
      varying float vMask;
      varying float vLit;
      varying float vSeed;
      varying float vRoof;
      varying float vSnow;
      attribute vec4 aRoof; // roof colour (linear), snow
      attribute vec3 aWall; // wall colour (linear)
      attribute vec4 aInfo; // facade: style + 1, lowest floor, eave, flags + seed
      attribute vec2 aFace; // position along the wall face, face length (model units)
      vec3 srgbToLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      }
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 wp = instanceMatrix * vec4(position * s, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
        vObj = wp.xyz;
        vN = normalize(mat3(instanceMatrix) * normal);
        vUp = normalize(origin);
        vec3 c = srgbToLinear(aColor.rgb);
        int pi = int(aAnim.z + 0.5);
        float m = aColor.a;
        vRoof = 0.0;
        vMask = 0.0;
        bool tinted = aRoof.r + aRoof.g + aRoof.b > 0.0;
        if (m > 0.9) {
          // team colour (KayKit), keeping the pack's shading gradient (its blue has luminance ~0.13):
          // the settlement's roof colour, else the palette
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          if (tinted) c = aRoof.rgb * clamp(l / 0.13, 0.55, 1.6);
          else if (pi > 0) c = uPalette[pi] * clamp(l / 0.13, 0.5, 1.8);
          vRoof = 1.0;
          vMask = 3.0;
        } else if (m > 0.6) {
          // generated roof: the instance's roof colour, shaded by the vertex grey (188 = 1x)
          c = aRoof.rgb * (c.r / 0.5);
          vRoof = 1.0;
          vMask = 2.0;
        } else if (m > 0.35) {
          c = aWall * (c.r / 0.5);
          vMask = 1.0;
        }
        // a touch less saturated and bright than the packs, closer to the planet's albedos
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vSeed = fract(sin(dot(origin * 1000.0, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        vAlb = mix(vec3(lum), c, 0.85) * 0.9 * (0.94 + 0.12 * vSeed);
        vSnow = aRoof.a;
        vLocal = position;
        vLocalN = normal;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz)) / uKK;
        vInfo = aInfo;
        vFace = aFace;
        vLit = mod(aAnim.w, 2.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform vec3 uSunColor;
      ${SUN_AT_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vAlb;
      varying vec3 vN;
      varying vec3 vUp;
      varying vec3 vLocal;
      varying vec3 vLocalN;
      varying vec3 vScale;
      varying vec3 vObj;
      varying vec4 vInfo;
      varying vec2 vFace;
      varying float vMask;
      varying float vLit;
      varying float vSeed;
      varying float vRoof;
      varying float vSnow;
      float hash12(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233)) + vSeed * 91.7) * 43758.5453);
      }
      // stable per cell (no per-instance seed)
      float h21(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      // 1 inside [a, b], antialiased over w
      float band(float x, float a, float b, float w) {
        return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
      }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 L = sunAt(vUp, uSunObj);
        float mu = dot(vUp, L);
        float day = smoothstep(-0.12, 0.12, mu);
        float ndl = dot(N, L);
        float diff = max(ndl, 0.0) * day;
        vec3 sky = mix(vec3(0.030, 0.040, 0.070), ${SKY} * 0.08, smoothstep(-0.25, 0.4, mu));
        float up = dot(N, vUp);
        vec3 alb = vAlb;
        float ao = 1.0;
        float winMask = 0.0;
        float winOn = 0.0;
        if (vInfo.x > 0.5) {
          // ---------- generated building: the facade ----------
          float style = floor(vInfo.x - 0.5);
          vec3 P = vLocal * vScale;
          vec3 nR = normalize(vLocalN);
          vec3 n = normalize(vLocalN / max(vScale, vec3(1e-3)));
          float px = max(length(fwidth(P)), 1e-5);
          // fine textures (tiles, courses, grain) fade out sooner than windows and doors
          float det = 1.0 - smoothstep(0.012, 0.03, px);
          float detW = 1.0 - smoothstep(0.04, 0.085, px);
          float seedI = fract(vInfo.w);
          float flags = floor(vInfo.w);
          float base = vInfo.y * vScale.y, eave = vInfo.z * vScale.y;
          float y = P.y;
          if (vMask > 0.5 && vMask < 1.5) {
            // ----- walls -----
            // darker plinth where it meets the ground, shade under the eaves
            ao *= mix(0.6, 1.0, smoothstep(-0.03, 0.22, y));
            if (eave > 0.0) ao *= 1.0 - 0.22 * smoothstep(eave - 0.08, eave - 0.005, y) * step(y, eave + 0.01);
            float along = abs(nR.z) > abs(nR.x) ? vScale.x : vScale.z;
            float h = vFace.x * along, Lf = vFace.y * along;
            bool flatFace = abs(n.y) < 0.35;
            // wall material by style
            if (det > 0.0) {
              float grain = vnoise(vec2(h * 9.0 + nR.x * 7.0, y * 9.0)) - 0.5;
              if (style == 2.0 || (eave == 0.0 && (style == 0.0 || style == 1.0 || style == 2.0) && vFace.y > 0.0)) {
                // dressed stone: courses and staggered joints, block by block
                float row = floor(y / 0.065);
                float bx = h / 0.12 + row * 0.5;
                float joint = max(1.0 - band(fract(y / 0.065), 0.1, 0.9, px / 0.065), (1.0 - band(fract(bx), 0.06, 0.94, px / 0.12)) * step(0.0, vFace.y));
                float shade = 0.86 + 0.24 * h21(vec2(floor(bx), row) + floor(vSeed * 50.0));
                alb *= mix(1.0, shade * (1.0 - 0.32 * joint), det);
              } else if (style == 1.0) {
                // log or plank walls: horizontal courses
                float c = y / 0.048;
                float gap = 1.0 - band(fract(c), 0.12, 0.88, px / 0.048);
                float shade = 0.84 + 0.26 * h21(vec2(floor(c), floor(vSeed * 40.0)));
                alb *= mix(1.0, shade * (1.0 - 0.35 * gap), det);
              } else if (style == 5.0 && flatFace) {
                // bamboo and boards, upright
                float c = h / 0.035;
                float gap = 1.0 - band(fract(c), 0.1, 0.9, px / 0.035);
                alb *= mix(1.0, (0.88 + 0.22 * h21(vec2(floor(c), 3.0))) * (1.0 - 0.3 * gap), det);
              } else if (style == 3.0 || style == 4.0) {
                // adobe and mud: soft mottling, rain-washed streaks, a darker splash zone
                float m = vnoise(vec2(h * 6.0, y * 4.0) + vSeed * 13.0) - 0.5;
                float streak = vnoise(vec2(h * 22.0, y * 1.5)) - 0.5;
                alb *= mix(1.0, 1.0 + 0.16 * m + 0.08 * streak + 0.05 * grain, det);
              } else {
                // plaster: faint patches
                alb *= mix(1.0, 1.0 + 0.07 * (vnoise(vec2(h * 5.0, y * 5.0) + vSeed * 7.0) - 0.5) + 0.04 * grain, det);
              }
            }
            // timber-framed houses are plastered pale between the beams
            bool timber = mod(flags, 2.0) > 0.5;
            if (timber) alb = mix(alb, vec3(0.6, 0.56, 0.47) * (0.92 + 0.16 * seedI), 0.55 * detW);
            if (detW > 0.0 && flatFace && vFace.y > 0.0 && eave > base + 0.1) {
              // windows by storey, in columns along the face, a door at the street front (+z)
              float nF = max(1.0, floor((eave - base) / 0.3 + 0.3));
              float fh = (eave - base) / nF;
              float fy = (y - base) / fh;
              float fi = floor(fy), ff = fract(fy);
              float sp = style == 3.0 ? 0.3 : style >= 4.0 ? 0.32 : 0.2;
              float mg = 0.07;
              float nW = max(1.0, floor((Lf - 2.0 * mg) / sp));
              float cw = (Lf - 2.0 * mg) / nW;
              float t = (h - mg) / cw;
              float ci = floor(t), cf = fract(t);
              float inCol = step(0.0, t) * step(t, nW);
              float inRow = step(0.0, fy) * step(fy, nF);
              float hw = (style == 3.0 ? 0.042 : 0.058) / cw;
              float aw = px / cw, ah = px / fh;
              float win = band(cf, 0.5 - hw, 0.5 + hw, aw) * band(ff, 0.34, style == 3.0 ? 0.6 : 0.74, ah) * inCol * inRow;
              float r = h21(vec2(ci + floor(seedI * 97.0), fi * 7.0 + floor(abs(nR.x) * 2.0 + nR.z * 3.0 + 4.0)));
              win *= step(0.14, r);
              float door = 0.0;
              if (nR.z > 0.7) {
                float dc = min(nW - 1.0, floor(seedI * nW));
                float isDoor = step(abs(ci - dc), 0.5) * step(fi, 0.5);
                win *= 1.0 - isDoor;
                door = isDoor * band(cf, 0.5 - 0.07 / cw, 0.5 + 0.07 / cw, aw) * band(y, base - 0.3, base + min(0.23, fh * 0.8), px) * inCol;
              }
              if (timber) {
                // posts at the bay lines and corners, a beam at every floor, braces in blind bays
                float lw = 0.016;
                float post = (1.0 - band(cf, lw / cw, 1.0 - lw / cw, aw)) * inCol;
                float ends = 1.0 - band(h, lw * 1.5, Lf - lw * 1.5, px);
                float beam = (1.0 - band(ff, lw / fh, 1.0 - lw / fh, ah)) * inRow;
                float brace = (1.0 - step(0.14, r)) * band(cf - ff, -lw * 1.6 / cw, lw * 1.6 / cw, aw) * inCol * inRow;
                float beams = max(max(post, ends), max(beam, brace));
                alb = mix(alb, vec3(0.085, 0.06, 0.042), beams * detW * (1.0 - win) * (1.0 - door));
              }
              // window: dark glass in a pale frame; the door dark timber
              float frame = band(cf, 0.5 - hw - 0.016 / cw, 0.5 + hw + 0.016 / cw, aw) * band(ff, 0.3, (style == 3.0 ? 0.6 : 0.74) + 0.04, ah) * inCol * inRow * step(0.14, r) * (1.0 - step(0.5, door + 0.0));
              alb = mix(alb, alb * 1.25 + 0.03, (frame - win) * detW * 0.6 * step(style, 2.5));
              alb = mix(alb, vec3(0.03, 0.035, 0.045), win * detW);
              alb = mix(alb, vec3(0.12, 0.075, 0.045), door * detW);
              winMask = win * detW;
              winOn = step(0.4, fract(r * 7.31 + seedI));
            } else if (detW > 0.0 && vFace.y < 0.0 && nR.z > 0.6) {
              // a hut's doorway
              float d = band(y, -0.3, 0.17, px) * band(nR.x, -0.22, 0.22, 0.02);
              alb = mix(alb, vec3(0.06, 0.045, 0.035), d * detW);
            }
          } else if (vMask > 1.5 && vMask < 2.5) {
            // ----- roofs -----
            if (det > 0.0) {
              vec2 hn = normalize(n.xz + vec2(1e-5));
              float slopeS = sqrt(max(1.0 - n.y * n.y, 0.04));
              float s = y / slopeS;
              float a = dot(P.xz, vec2(-hn.y, hn.x));
              vec3 c = vAlb;
              float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
              bool flatRoof = n.y > 0.93;
              bool thatch = style >= 4.0 || (c.g > c.r * 0.72 && c.b < c.r * 0.62 && c.g < c.r);
              bool turf = c.g >= c.r * 0.98 && c.g > c.b * 1.2;
              bool slate = (mx - mn) < mx * 0.16 || style == 2.0;
              if (flatRoof) {
                // a terrace: plaster with patches
                alb *= mix(1.0, 0.93 + 0.14 * vnoise(P.xz * 12.0 + vSeed * 9.0), det);
              } else if (thatch) {
                float st = h21(vec2(floor(a / 0.009), floor(s / 0.1)));
                float course = band(fract(s / 0.1), 0.0, 0.18, px / 0.1);
                float m = vnoise(vec2(a * 30.0, s * 6.0));
                alb *= mix(1.0, (0.86 + 0.22 * st) * (1.0 - 0.14 * course) * (0.92 + 0.16 * m), det);
              } else if (turf) {
                float m = vnoise(P.xz * 18.0 + y * 7.0 + vSeed * 5.0);
                alb = mix(alb, mix(alb * 0.75, alb * vec3(1.15, 1.08, 0.8), m), det);
              } else {
                // tiles or slates: courses parallel to the eave, staggered joints
                float rh = slate ? 0.036 : 0.048, cw = slate ? 0.055 : 0.06;
                float row = floor(s / rh);
                float f = fract(s / rh);
                float g = fract(a / cw + row * 0.5);
                float lip = 1.0 - smoothstep(0.0, 0.28 + px / rh, f);
                float seam = 1.0 - band(g, 0.06, 0.94, px / cw);
                float jit = h21(vec2(floor(a / cw + row * 0.5), row) + floor(vSeed * 30.0));
                alb *= mix(1.0, (0.88 + (slate ? 0.24 : 0.16) * jit) * (1.0 - 0.3 * lip) * (1.0 - 0.14 * seam), det);
              }
              // weathering: lichen and soot patches
              float w = vnoise(P.xz * 4.0 + vSeed * 17.0);
              alb *= mix(1.0, 0.9 + 0.14 * w, det);
            }
          }
        }
        // snow on roofs (and lightly on other upward faces) where the ground is snowy
        if (vSnow > 0.0) alb = mix(alb, vec3(0.82, 0.85, 0.9), vSnow * smoothstep(0.3, 0.75, up) * (vRoof > 0.5 ? 1.0 : 0.55) * step(0.02, vLocal.y));
        // the sun's shadow (casters: every model near the view)
        float vis = diff > 0.0 ? shadowAt(vObj, N, 1.0 - max(ndl, 0.0)) : 1.0;
        // sky from above, a warm bounce from the sunlit ground below, so faces turned away
        // from the sun stay readable instead of sinking into the planet's deep shade
        vec3 fill = sky * (2.4 + 1.2 * up) + uSunColor * day * (0.2 + 0.08 * up) * vec3(1.0, 0.94, 0.85);
        // at night: darker, but lived-in buildings catch a little warm light from the streets
        fill *= mix(0.5, 1.0, day);
        vec3 col = alb * (uSunColor * diff * vis * mix(1.0, ao, 0.5) + fill * ao + (1.0 - day) * vLit * vec3(0.10, 0.06, 0.025));
        if (vInfo.x > 0.5) {
          // night: the facade's own windows, some lit
          col += (1.0 - day) * winMask * winOn * vLit * vec3(1.0, 0.58, 0.24) * 1.5;
        } else if (vLit > 0.5 && day < 0.98) {
          // night: a scatter of warm windows on the walls of lived-in landmarks
          vec3 ln = normalize(vLocalN);
          float wall = 1.0 - smoothstep(0.15, 0.35, abs(ln.y));
          vec2 h = normalize(ln.xz + vec2(1e-5));
          float u = dot(vLocal.xz, vec2(-h.y, h.x));
          vec2 g = vec2(u / 0.16, (vLocal.y - 0.06) / 0.22);
          vec2 f = fract(g);
          float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.28, f.y) * step(f.y, 0.78);
          float on = step(0.42, hash12(floor(g)));
          float band_ = step(0.1, vLocal.y) * (1.0 - step(1.6, vLocal.y)) * (1.0 - vRoof);
          col += (1.0 - day) * wall * win * on * band_ * vec3(1.0, 0.58, 0.24) * 1.4;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

export function createShadowMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      uniform vec3 uSunObj;
      ${SUN_AT_GLSL}
      ${SHADOW_COVER_GLSL}
      varying float vA;
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 up = normalize(origin);
        vec3 L = sunAt(up, uSunObj);
        float mu = dot(up, L);
        vec3 sunT = L - up * mu;
        float lt = length(sunT);
        vec3 sd = lt > 1e-4 ? -sunT / lt : vec3(0.0);
        // where the shadow map draws the cast shadow, the blob is only the soft contact
        // shadow round the base (ambient occlusion), not leaning with the sun
        float cover = shadowCover(origin);
        // the blob leans away from the sun, longer when it is low (and none at night)
        float lean = min(lt / max(mu, 0.25), 2.0) * smoothstep(-0.05, 0.2, mu) * (1.0 - cover);
        vec3 q = mat3(instanceMatrix) * position * (1.0 - 0.15 * cover);
        float along = dot(q, sd);
        q += sd * (max(along, 0.0) * lean * 0.7 + aAnim.z * lean * 0.3);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(origin + q * s, 1.0);
        vA = aColor.a * min(s, 1.0) * mix(mix(0.16, 0.4, smoothstep(-0.1, 0.25, mu)), 0.34, cover);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, vA);
      }
    `,
  })
}

/** Packed earth under built-up patches (the old disc decal): a soft disc in the instance's wall colour, lit like the ground. */
export function createGroundMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      attribute vec3 aWall;
      uniform vec3 uSunObj;
      uniform vec3 uSunColor;
      ${SUN_AT_GLSL}
      varying float vA;
      varying vec3 vC;
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 up = normalize(origin);
        vec3 L = sunAt(up, uSunObj);
        float mu = dot(up, L);
        float day = smoothstep(-0.12, 0.12, mu);
        vec3 sky = mix(vec3(0.030, 0.040, 0.070), vec3(0.30, 0.50, 0.95) * 0.08, smoothstep(-0.25, 0.4, mu));
        vC = aWall * (uSunColor * max(mu, 0.0) * day * 0.9 + sky * 2.0);
        vec3 q = mat3(instanceMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(origin + q * min(s, 1.0), 1.0);
        vA = aColor.a * min(s, 1.0) * 0.6;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying vec3 vC;
      void main() {
        gl_FragColor = vec4(vC, vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

/**
 * The town ground (layout.ts GroundSet, merged for every settlement near the view): per
 * vertex position, ground normal, colour, pattern coordinates, kind and life years. Lit like
 * the planet (sun and sky, the same terminator); fades in and out with its patch's life and
 * with camera distance like the models.
 */
export function createTownGroundMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute vec3 aNrm;
      attribute vec3 aCol;
      attribute vec2 aUv;
      attribute float aKind;
      attribute vec2 aLife;
      uniform float uYear;
      uniform float uAnimYears;
      uniform vec3 uCamObj;
      uniform vec2 uFade;
      varying vec3 vC;
      varying vec3 vNg;
      varying vec3 vP;
      varying vec2 vUv;
      varying float vKind;
      varying float vA;
      void main() {
        float grow = clamp((uYear - aLife.x) / uAnimYears, 0.0, 1.0);
        float shrink = clamp((uYear - aLife.y) / uAnimYears, 0.0, 1.0);
        float dist = length(uCamObj - position);
        float near = 1.0 - smoothstep(uFade.x, uFade.y, dist);
        vA = grow * (1.0 - shrink) * near;
        if (vA <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vC = aCol;
        vNg = aNrm;
        vP = position;
        vUv = aUv;
        vKind = aKind;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform vec3 uSunColor;
      ${SUN_AT_GLSL}
      varying vec3 vC;
      varying vec3 vNg;
      varying vec3 vP;
      varying vec2 vUv;
      varying float vKind;
      varying float vA;
      float h21(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float band(float x, float a, float b, float w) {
        return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
      }
      void main() {
        vec3 up = normalize(vP);
        vec3 L = sunAt(up, uSunObj);
        float mu = dot(up, L);
        float day = smoothstep(-0.12, 0.12, mu);
        vec3 N = normalize(vNg);
        vec2 uv = vUv;
        float px = max(length(fwidth(uv)), 1e-5);
        float det = 1.0 - smoothstep(0.012, 0.04, px);
        float k = floor(vKind + 0.5);
        vec3 alb = vC;
        float n1 = vnoise(uv * 2.2), n2 = vnoise(uv * 9.0 + 3.7);
        if (k < 0.5) {
          // packed earth: worn paler down the middle of the way, darker ruts and puddles
          alb *= 0.9 + 0.2 * n1 + mix(0.0, 0.1 * (n2 - 0.5), det);
        } else if (k < 1.5) {
          // paving: setts in rows, a few darker
          vec2 g = uv / vec2(0.075, 0.05);
          g.x += floor(g.y) * 0.5;
          vec2 f = fract(g);
          float joint = 1.0 - band(f.x, 0.1, 0.9, px / 0.075) * band(f.y, 0.12, 0.88, px / 0.05);
          float sh = 0.86 + 0.24 * h21(floor(g));
          alb *= (0.94 + 0.12 * n1) * mix(1.0, sh * (1.0 - 0.3 * joint), det);
        } else if (k < 2.5) {
          // worn yards: trodden earth breaking through the grass
          float bare = smoothstep(0.45, 0.75, n1 * 0.7 + n2 * 0.3);
          alb = mix(alb, alb * vec3(1.25, 1.05, 0.82), bare * 0.6) * (0.92 + 0.16 * n2);
        } else {
          // gardens: rows of crops on dark soil
          float r = h21(floor(uv * 0.5) + 7.0);
          vec3 crop = r < 0.4 ? vec3(0.07, 0.12, 0.03) : r < 0.7 ? vec3(0.1, 0.13, 0.035) : vec3(0.16, 0.13, 0.05);
          float row = band(fract(uv.y / 0.07), 0.25, 0.75, px / 0.07);
          alb = mix(alb, mix(alb, crop, row), det * 0.9 + 0.1) * (0.92 + 0.16 * n2);
        }
        float diff = max(dot(N, L), 0.0) * day;
        vec3 sky = mix(vec3(0.030, 0.040, 0.070), vec3(0.30, 0.50, 0.95) * 0.08, smoothstep(-0.25, 0.4, mu));
        vec3 col = alb * (uSunColor * diff + sky * 1.4);
        // at night the streets glow with lamps and windows, as the planet's city lights do
        float lamp = k < 1.5 ? 1.7 : k < 2.5 ? 1.05 : 0.6;
        col += (1.0 - day) * lamp * (0.75 + 0.5 * n1) * vec3(1.0, 0.74, 0.46);
        gl_FragColor = vec4(col, vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
}

/** Depth of every caster for the shadow map (instanced, same transform and life as the models). */
export function createDepthMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    colorWrite: false,
    vertexShader: /* glsl */ `
      ${LIFE_GLSL}
      void main() {
        vec3 origin = instanceMatrix[3].xyz;
        float s = instanceSize(origin);
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        gl_Position = projectionMatrix * modelViewMatrix * (instanceMatrix * vec4(position * s, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(1.0);
      }
    `,
  })
}

/**
 * The cast shadow on the planet surface (and the town ground over it): the globe mesh
 * drawn once more, darkening where the shadow map says the sun is blocked, by what the
 * direct sun would have added over the sky light.
 */
export function createReceiverMaterial(uniforms: DioramaUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -5,
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      ${SUN_AT_GLSL}
      ${SHADOW_GLSL}
      varying vec3 vP;
      void main() {
        vec3 up = normalize(vP);
        vec3 L = sunAt(up, uSunObj);
        float mu = dot(up, L);
        if (mu < -0.05) discard;
        float vis = shadowAt(vP, up, 0.0);
        // direct sun over sky: a strong shadow when the sun is up, none at night
        float a = (1.0 - vis) * 0.62 * smoothstep(-0.05, 0.2, mu);
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }
    `,
  })
}
