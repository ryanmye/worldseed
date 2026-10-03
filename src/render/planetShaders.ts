// Planet surface shaders.
//
//  - PLANET_FRAG: the full procedural shader (every noise field evaluated per pixel). Used
//    for the data views, while the surface bake is in progress, and with `bake=0`.
//  - bakeFrag(t): renders the static part of the Terrain view into cube-map target t (see
//    surfaceBake.ts). The globe mesh is drawn from the planet centre, so every texel gets
//    exactly the varyings (and the object-space position) the visible fragment has at
//    runtime, and fwidth() gives the texel footprint for the noise level of detail.
//  - bakedFrag(): the per-frame Terrain shader. Low-frequency fields come from the cube
//    maps (a handful of fetches); only octaves at or above SPLIT, which a cube texel cannot
//    hold, are evaluated per pixel, with the usual screen-footprint fade (so far away they
//    cost nothing, up close they add the fine detail). Thresholds (coast, lake, snow and ice
//    contours) are applied after the low and high bands are summed, so edges stay crisp at
//    any zoom. Lighting, glint, terminator, city lights, farmland and reservoirs (which
//    change with the camera, the sun and the history year) stay per frame.
//
// Baked fields, by target (RGBA8 unless noted; values encoded with enc()/dec()):
//   T0 (S):   albedo after corner blend and mottling (sqrt-encoded rgb)
//   T1 (S):   normal perturbation of the low bump band (object space, xyz); coast low band
//   T2 (S):   lake, snow and sea-ice low bands; glint streak field
//   T3 (S/2): sea depth noises dn, dn2; glint roughness; mottling m1
//   T4 (S/2, R8): mottling m2

import { NOISE_GLSL } from './glsl.ts'

export const LIGHT_TEX_WIDTH = 512
export const NEVER = 1e9
/** Years a reservoir takes to fill after its dam is built, and to drain after it is lost. */
export const RESERVOIR_FILL_YEARS = 12
export const RESERVOIR_DRAIN_YEARS = 40

/** Number of cube targets of the surface bake. */
export const BAKE_TARGETS = 5
/** Face size of target t, given the full face size. */
export const bakeTargetSize = (t: number, size: number) => (t >= 3 ? Math.max(64, size >> 1) : size)

/** Lowest octave frequency (object-space cycles per unit) left to the per-frame shader. */
export function bakeSplit(size: number): number {
  // a cube texel is ~2/size wide at a face centre: >= 4 texels per wavelength at 1024 and up
  // (at smaller sizes the bake holds the same octaves, a little softer)
  return 0.125 * Math.max(size, 1024)
}

export const PLANET_VERT = /* glsl */ `
attribute vec4 aSurf;
attribute vec4 aSeed;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aC2;
attribute float aDepth;
attribute vec3 aCorners;
uniform sampler2D uLightTex;
uniform sampler2D uCellPosTex;
uniform float uCityLights;
uniform sampler2D uLandTex;
uniform float uLandOn;
uniform float uLandFrac;
uniform sampler2D uResTex;
uniform float uResOn;
uniform float uYear;
flat varying vec3 vLand;
flat varying vec3 vDeg;
flat varying vec3 vRes;

varying float vDepth;
flat varying vec3 vLight;
flat varying vec3 vLP0;
flat varying vec3 vLP1;
flat varying vec3 vLP2;
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vBary;
varying vec4 vSurf;
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vC2;
flat varying vec3 vSeed;
varying float vSlope;

void main() {
  int k = gl_VertexID % 3;
  vBary = vec3(k == 0 ? 1.0 : 0.0, k == 1 ? 1.0 : 0.0, k == 2 ? 1.0 : 0.0);
  vObjPos = position;
  vNormal = normal;
  vSurf = aSurf;
  vC0 = aC0;
  vC1 = aC1;
  vC2 = aC2;
  vSeed = aSeed.xyz;
  vSlope = aSeed.w * 0.5;
  vDepth = aDepth;
  vLight = vec3(0.0);
  vLP0 = vLP1 = vLP2 = vec3(0.0);
  vLand = vDeg = vRes = vec3(0.0);
  ivec3 cc = ivec3(aCorners + 0.5);
  ivec3 cx = cc % ${LIGHT_TEX_WIDTH};
  ivec3 cy = cc / ${LIGHT_TEX_WIDTH};
  if (uLandOn > 0.0) {
    vec4 l0 = texelFetch(uLandTex, ivec2(cx.x, cy.x), 0);
    vec4 l1 = texelFetch(uLandTex, ivec2(cx.y, cy.y), 0);
    vec4 l2 = texelFetch(uLandTex, ivec2(cx.z, cy.z), 0);
    vLand = vec3(mix(l0.r, l0.g, uLandFrac), mix(l1.r, l1.g, uLandFrac), mix(l2.r, l2.g, uLandFrac));
    vDeg = vec3(mix(l0.b, l0.a, uLandFrac), mix(l1.b, l1.a, uLandFrac), mix(l2.b, l2.a, uLandFrac));
  }
  if (uResOn > 0.0) {
    vec4 r0 = texelFetch(uResTex, ivec2(cx.x, cy.x), 0);
    vec4 r1 = texelFetch(uResTex, ivec2(cx.y, cy.y), 0);
    vec4 r2 = texelFetch(uResTex, ivec2(cx.z, cy.z), 0);
    vec3 built = vec3(r0.x, r1.x, r2.x);
    vec3 lost = vec3(r0.y, r1.y, r2.y);
    vRes = vec3(r0.z, r1.z, r2.z)
      * smoothstep(built, built + ${RESERVOIR_FILL_YEARS.toFixed(1)}, vec3(uYear))
      * (1.0 - smoothstep(lost, lost + ${RESERVOIR_DRAIN_YEARS.toFixed(1)}, vec3(uYear)));
  }
  if (uCityLights > 0.0) {
    vLight = vec3(
      texelFetch(uLightTex, ivec2(cx.x, cy.x), 0).r,
      texelFetch(uLightTex, ivec2(cx.y, cy.y), 0).r,
      texelFetch(uLightTex, ivec2(cx.z, cy.z), 0).r);
    if (vLight.x > 0.0) vLP0 = texelFetch(uCellPosTex, ivec2(cx.x, cy.x), 0).xyz;
    if (vLight.y > 0.0) vLP1 = texelFetch(uCellPosTex, ivec2(cx.y, cy.y), 0).xyz;
    if (vLight.z > 0.0) vLP2 = texelFetch(uCellPosTex, ivec2(cx.z, cy.z), 0).xyz;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG_HEADER = /* glsl */ `
uniform int uStyle;
uniform vec3 uSunObj;
uniform vec3 uCamObj;
uniform vec3 uSunColor;
uniform float uCellFreq;
uniform float uCityLights;
uniform float uFarm;
uniform float uLandView;
uniform float uResOn;
uniform float uDaylight;

flat varying vec3 vLand;
flat varying vec3 vDeg;
flat varying vec3 vRes;
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vBary;
varying vec4 vSurf;
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vC2;
flat varying vec3 vSeed;
varying float vSlope;
varying float vDepth;
flat varying vec3 vLight;
flat varying vec3 vLP0;
flat varying vec3 vLP1;
flat varying vec3 vLP2;

${NOISE_GLSL}

const vec3 SHELF = vec3(0.016, 0.150, 0.190);
const vec3 SHALLOW = vec3(0.007, 0.055, 0.120);
const vec3 DEEP = vec3(0.002, 0.010, 0.042);
const vec3 LAKE_SHORE = vec3(0.030, 0.180, 0.200);
const vec3 LAKE_DEEP = vec3(0.020, 0.140, 0.180);
const vec3 SEA_ICE = vec3(0.80, 0.86, 0.92);
const vec3 SNOW = vec3(0.86, 0.89, 0.93);
const vec3 SKY = vec3(0.30, 0.50, 0.95);
const vec3 CROP_GRAIN = vec3(0.320, 0.245, 0.080);
const vec3 CROP_GREEN = vec3(0.105, 0.175, 0.045);
const vec3 CROP_SOIL = vec3(0.165, 0.105, 0.058);
const vec3 CROP_HAY = vec3(0.225, 0.205, 0.085);
const vec3 BARE_SOIL = vec3(0.320, 0.215, 0.115);
const float FIELD_STRENGTH = 0.6;
const vec3 CITY = vec3(1.0, 0.56, 0.22);
const vec3 CITY_CORE = vec3(1.0, 0.82, 0.55);

// Anisotropic Ward-shaped lobe (T, B: tangent axes; ax, ay: RMS slopes along them), times
// N.L. Deliberately not energy-normalised: the peak stays bounded however calm the water,
// so the glint is shaped by lobe width and never clips to a flat white patch.
float glintLobe(vec3 N, vec3 H, vec3 T, vec3 B, float ax, float ay, float nl) {
  float hn = max(dot(H, N), 1e-3);
  float ht = dot(H, T) / ax;
  float hb = dot(H, B) / ay;
  return exp(-(ht * ht + hb * hb) / (hn * hn)) * nl;
}

// Cultivated and degraded land over albedo alb. lu and dg are land use and degradation
// in 0..1 (interpolated over the triangle and between land snapshots), clump a mid-scale
// noise (~[-0.6, 0.6]) that gathers fields into irregular patches. Fields are Voronoi cells
// in object space, each cultivated once land use passes its own random threshold, in one of
// a few crop tones with darker hedgerows between them. They resolve only when zoomed in; at
// globe scale the patchwork is replaced by its average, a soft warm tint.
vec3 farmland(vec3 alb, vec3 p, float lu, float dg, float clump, float footprint) {
  vec3 col = alb;
  if (lu > 0.002) {
    float cover = clamp(smoothstep(0.0, 0.8, lu) * (1.0 + 0.9 * clump), 0.0, 1.0);
    // Each field moves the wild colour part of the way toward its crop (FIELD_STRENGTH on
    // average), so the patchwork keeps the regional colour and its mean is a soft tint.
    vec3 cropMean = (CROP_GRAIN + CROP_GREEN + CROP_SOIL + CROP_HAY) * 0.25;
    vec3 far = mix(alb, cropMean, cover * FIELD_STRENGTH);
    float fieldFreq = uCellFreq * 7.0;
    float detail = ws_lod(fieldFreq, footprint);
    if (detail > 0.0) {
      vec3 rnd;
      vec2 F = ws_cells(p * fieldFreq, rnd);
      float on = smoothstep(rnd.x - 0.06, rnd.x + 0.06, cover);
      float pick = fract(rnd.y * 7.31 + rnd.z * 3.17);
      vec3 crop = rnd.y < 0.25 ? CROP_GRAIN : rnd.y < 0.5 ? CROP_GREEN : rnd.y < 0.75 ? CROP_HAY : CROP_SOIL;
      crop = mix(alb, crop, FIELD_STRENGTH * (0.55 + 0.9 * pick)) * (0.9 + 0.2 * rnd.z);
      float edgeW = max(0.06, footprint * fieldFreq * 1.5);
      float hedge = 1.0 - smoothstep(0.0, edgeW, F.y - F.x);
      crop = mix(crop, alb * 0.85, hedge * 0.4);
      far = mix(far, mix(alb, crop, on), detail);
    }
    col = far;
  }
  if (dg > 0.002) {
    float d = smoothstep(0.08, 0.95, dg);
    // worn: paler, browner, less green, with patches of bare soil where it is worst
    float lum = dot(col, vec3(0.30, 0.55, 0.15));
    vec3 worn = BARE_SOIL * (lum / dot(BARE_SOIL, vec3(0.30, 0.55, 0.15))) * 1.15;
    col = mix(col, worn, d * 0.5);
    // bare patches are small (a few per cell): at globe scale they average into a paler tone
    float patchN = ws_fbm(p + 53.0, uCellFreq * 5.0, 3, footprint);
    float bare = smoothstep(0.5, 0.95, d + patchN * 0.8);
    col = mix(col, BARE_SOIL * (0.9 + 0.3 * patchN), bare * 0.6);
  }
  return col;
}

// Soft, noise-perturbed corner weights of the Terrain albedo (continuous across triangles).
vec3 terrainWeights(vec3 p, vec3 b, float footprint) {
  vec3 q = p * uCellFreq * 1.1;
  float fp = footprint * uCellFreq * 1.1;
  vec3 n = vec3(
    ws_fbm(q + vSeed.x * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
    ws_fbm(q + vSeed.y * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
    ws_fbm(q + vSeed.z * vec3(173.3, 291.7, 117.1), 1.0, 3, fp));
  vec3 w = pow(b, vec3(1.6)) * exp(n * 5.0);
  return w / max(w.x + w.y + w.z, 1e-6);
}

// Daylight everywhere: each point lit from just off its own zenith (from the north-west).
vec3 sunAt(vec3 up, vec3 east, vec3 north) {
  return uDaylight > 0.5 ? normalize(up + 0.35 * (north - east)) : normalize(uSunObj);
}

// Night side: settlement lights, a radial glow around each lit cell centre (radius
// and brightness grow with population), its outline warped by noise into an
// irregular sprawl, plus street-level sparkle that only resolves when zoomed in.
vec3 cityLights(vec3 p, float footprint, float dayFade, float water) {
  if (uCityLights > 0.0 && max(vLight.x, max(vLight.y, vLight.z)) > 0.0 && dayFade < 0.995) {
    float warp = 0.16 * ws_fbm(p + 41.0, uCellFreq * 2.2, 3, footprint);
    vec3 dist = vec3(length(p - vLP0), length(p - vLP1), length(p - vLP2)) * uCellFreq + warp;
    vec3 rad = 0.1 + 0.3 * vLight;
    vec3 x = dist / rad;
    vec3 core = exp(-x * x * 2.2);
    vec3 halo = exp(-x * x * 0.45);
    vec3 per = (core * (0.25 + 1.1 * vLight) + halo * 0.18 * vLight) * vLight * step(0.0001, vLight);
    float lum = per.x + per.y + per.z;
    lum *= 0.65 + 0.7 * (ws_fbm(p + 77.0, uCellFreq * 8.0, 2, footprint) + 0.5);
    vec3 lc = mix(CITY, CITY_CORE, clamp(dot(core, vLight * vLight), 0.0, 1.0));
    return (1.0 - dayFade) * uCityLights * lum * lc * (1.0 - water);
  }
  return vec3(0.0);
}
`

const FRAG_FOOTER = /* glsl */ `
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#ifdef WS_COUNT_NOISE
  gl_FragColor = vec4(float(ws_noiseCount), float(ws_cellCount), 0.0, 1.0);
#endif
}
`

/** The full procedural surface shader (all views). */
export const PLANET_FRAG = /* glsl */ `
${FRAG_HEADER}

void main() {
  vec3 p = vObjPos;
  vec3 up = normalize(p);
  vec3 V = normalize(uCamObj - p);
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(up, east);
  vec3 L = sunAt(up, east, north);
  float footprint = length(fwidth(p));

  // ----- corner blend weights -----
  vec3 b = clamp(vBary, 0.0, 1.0);
  vec3 w = b;   // linear: smooth data
  vec3 ws = b;  // sharp, noise-perturbed: lakes and categorical data
  if (uStyle != 1) {
    vec3 q = p * uCellFreq * 1.1;
    float fp = footprint * uCellFreq * 1.1;
    vec3 n = vec3(
      ws_fbm(q + vSeed.x * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
      ws_fbm(q + vSeed.y * vec3(173.3, 291.7, 117.1), 1.0, 3, fp),
      ws_fbm(q + vSeed.z * vec3(173.3, 291.7, 117.1), 1.0, 3, fp));
    ws = pow(b, vec3(6.0)) * exp(n * 16.0);
    ws /= max(ws.x + ws.y + ws.z, 1e-6);
    // terrain albedo: soft but irregular blending (climate colours are continuous already)
    w = uStyle == 0 ? pow(b, vec3(1.6)) * exp(n * 5.0) : ws;
  }
  w /= max(w.x + w.y + w.z, 1e-6);

  vec3 c0 = ws_srgbToLinear(vC0.rgb);
  vec3 c1 = ws_srgbToLinear(vC1.rgb);
  vec3 c2 = ws_srgbToLinear(vC2.rgb);

  vec3 N = normalize(vNormal);
  float mu = dot(up, L);
  float dayFade = smoothstep(-0.12, 0.12, mu);

  vec3 color;
  if (uStyle == 0) {
    // ---------- terrain ----------
    // Sea: iso-line of the interpolated elevation, pushed around by noise scaled to the
    // local slope. Noise is only evaluated where it could move the shoreline.
    float coastAmp = max(vSlope, 0.01) * 1.7;
    float e = vSurf.x;
    if (abs(e) < coastAmp * 1.25) e += ws_fbm(p + 17.0, uCellFreq * 0.6, 5, footprint) * coastAmp;
    float aaE = fwidth(vSurf.x) * 1.2 + 1e-5;
    float seaM = 1.0 - smoothstep(-aaE, aaE, e);
    // Lakes: the same contour trick on the linearly interpolated lake flag (continuous
    // across triangles), so shores are organic curves rather than cell polygons.
    float lakeLin = dot(b, vec3(vC0.a, vC1.a, vC2.a));
    float aaLin = fwidth(lakeLin);
    float lakeF = -1.0;
    float lakeM = 0.0;
    if (max(vC0.a, max(vC1.a, vC2.a)) > 0.0) {
      lakeF = lakeLin - 0.5 + 0.55 * ws_fbm(p + 29.0, uCellFreq * 0.6, 5, footprint);
      float aaL = aaLin * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
      lakeM = smoothstep(-aaL, aaL, lakeF);
    }
    // Reservoirs behind dams: the same contour on the interpolated fill, with a finer,
    // weaker shore noise so the pool stays small and close to its dam.
    if (uResOn > 0.0 && max(vRes.x, max(vRes.y, vRes.z)) > 0.0) {
      float resLin = dot(b, vRes);
      float resF = resLin - 0.6 + 0.16 * ws_fbm(p + 37.0, uCellFreq * 1.6, 4, footprint);
      float aaR = fwidth(resLin) * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
      float resM = smoothstep(-aaR, aaR, resF);
      lakeF = max(lakeF, resF * 2.0);
      lakeM = max(lakeM, resM);
    }
    float water = max(seaM, lakeM);

    vec3 skyAmb = mix(vec3(0.030, 0.040, 0.070), SKY * 0.08, smoothstep(-0.25, 0.4, mu));

    vec3 land = vec3(0.0);
    if (water < 0.999) {
      vec3 alb = c0 * w.x + c1 * w.y + c2 * w.z;

      // multi-scale albedo mottling, anchored to the surface
      float m1 = ws_fbm(p, 9.0, 4, footprint);
      float m2 = ws_fbm(p + 31.7, 40.0, 3, footprint);
      alb *= 1.0 + 0.22 * m1 + 0.12 * m2;
      alb = mix(alb, alb * vec3(1.10, 1.02, 0.80), clamp(m2 * 1.5, 0.0, 1.0) * 0.5);

      // people: cultivated fields and worn-out land (only where the data says so)
      if (uFarm > 0.0 && max(max(vLand.x, vLand.y), vLand.z) + max(max(vDeg.x, vDeg.y), vDeg.z) > 0.002) {
        alb = farmland(alb, p, dot(w, vLand), dot(w, vDeg), m2 - 0.4 * m1, footprint);
      }

      // high or steep ground gets ridged relief below (crisp crests, dark gullies)
      float elev = max(vSurf.x, 0.0);
      float steep = 1.0 - dot(N, up);
      float mtn = clamp(smoothstep(0.3, 0.68, elev) + 0.5 * smoothstep(0.06, 0.16, steep) * smoothstep(0.18, 0.4, elev), 0.0, 1.0);

      // small-scale bump on land normals, rougher in the mountains
      vec4 bump = ws_fbmd(p + 7.3, uCellFreq * 2.5, 4, footprint);
      vec3 g = (bump.yzw - dot(bump.yzw, up) * up) / uCellFreq;
      float rough = (0.012 + 0.09 * smoothstep(0.12, 0.6, elev)) * (1.0 - 0.55 * mtn);
      N = normalize(N - g * rough);

      float ridge = 0.5;
      if (mtn > 0.01) {
        float rf = uCellFreq * 1.5;
        vec3 warp = ws_noised(p * (rf * 0.35) + 3.7).yzw;
        vec4 rg = ws_ridged(p + 13.7 + warp * (0.35 / rf), rf, 3, footprint);
        vec3 gr = (rg.yzw - dot(rg.yzw, up) * up) / rf;
        N = normalize(N - gr * 0.2 * mtn);
        ridge = rg.x;
        alb *= mix(1.0, 0.76 + 0.45 * ridge, mtn);
      }

      // snow line from temperature, broken up by noise, slope and ridges
      if (vSurf.y > 0.08) {
        float slope = 1.0 - dot(N, up);
        float sn = vSurf.y + 0.28 * ws_fbm(p + 3.1, 25.0, 4, footprint) - slope * 1.2 + (ridge - 0.5) * 0.3 * mtn;
        float snow = smoothstep(0.42, 0.58, sn);
        alb = mix(alb, SNOW * (0.94 + 0.08 * m2), snow);
      }

      // cartographic hillshade (light from the local north-west) layered on the sun
      vec3 Lhs = normalize(up + 0.75 * (north - east));
      float hs = clamp(dot(N, Lhs) / dot(up, Lhs), 0.35, 1.6);
      float diff = max(dot(N, L), 0.0) * dayFade;
      float shade = diff * mix(1.0, hs, 0.5);
      land = alb * (uSunColor * shade + skyAmb * mix(1.0, hs, 0.4));
    }

    vec3 sea = vec3(0.0);
    if (water > 0.001) {
      float lakeW = lakeM * (1.0 - seaM);
      float depth = clamp(-mix(vDepth, vSurf.x, 0.35), 0.0, 1.0) * (1.0 - lakeW);
      float dn = ws_fbm(p + 11.0, 6.0, 3, footprint);
      float dn2 = ws_fbm(p + 13.0, uCellFreq * 0.5, 2, footprint);
      float dd = depth + dn * 0.06 + dn2 * 0.04;
      vec3 wcol = mix(SHELF, SHALLOW, smoothstep(0.0, 0.2, dd));
      wcol = mix(wcol, DEEP, smoothstep(0.15, 0.7, dd));
      vec3 lakeCol = mix(LAKE_SHORE, LAKE_DEEP, smoothstep(0.12, 0.6, lakeF + dn2 * 0.08));
      wcol = mix(wcol, lakeCol, lakeW);

      float ice = 0.0;
      if (vSurf.z > 0.08) ice = smoothstep(0.45, 0.55, vSurf.z + 0.3 * ws_fbm(p + 5.5, 18.0, 4, footprint));

      // Sun glint: an anisotropic lobe (stretched east-west, like wind-driven seas) whose
      // width follows a patchy roughness field, so the glint breaks into calm bright
      // streaks and rough dim patches. Resolved wave slopes tilt the normal; slopes too
      // fine for this zoom widen the lobe instead. Noise is only evaluated near the glint.
      vec3 H = normalize(L + V);
      float nv = max(dot(up, V), 0.0);
      float nl0 = max(dot(up, L), 0.0);
      float fresH = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float axBase = mix(0.085, 0.04, ws_lod(240.0, footprint));
      float sheen = glintLobe(up, H, east, north, axBase * 3.5, axBase * 2.2, nl0);
      float spec = 0.0;
      if (sheen * fresH > 2e-4 && uDaylight < 0.5) {
        vec3 S = vec3(1.0, 3.0, 1.0);
        float wind = ws_fbm(p * S + 7.0, 9.0, 2, footprint);
        float streak = ws_fbm(p * S + 4.0, 40.0, 2, footprint);
        float rough = 0.75 + 0.85 * smoothstep(-0.45, 0.45, wind + 0.6 * streak);
        vec4 sw = ws_fbmd(p * S + 2.0, 70.0, 2, footprint);
        vec4 ch = ws_fbmd(p + 9.0, 240.0, 3, footprint);
        vec3 gsw = sw.yzw * S;
        vec3 wslope = 0.035 * (gsw - dot(gsw, up) * up) / 70.0 + 0.12 * (ch.yzw - dot(ch.yzw, up) * up) / 240.0;
        vec3 Nw = normalize(up - wslope);
        float ax = axBase * rough;
        float nl = max(dot(Nw, L), 0.0);
        float glitter = 0.5 + 0.9 * smoothstep(-0.25, 0.35, streak + 0.5 * ch.x);
        spec = fresH * 15.0 * (glintLobe(Nw, H, east, north, ax, ax * 0.55, nl) * glitter + 0.12 * sheen);
      }
      spec *= dayFade * (1.0 - ice);
      float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      float wdiff = max(mu, 0.0) * dayFade;
      sea = wcol * (uSunColor * wdiff * 0.9 + skyAmb * 1.2);
      sea += uSunColor * spec;
      sea = mix(sea, SKY * 0.35 * dayFade, fres * 0.55);
      vec3 iceLit = SEA_ICE * (0.95 + 0.1 * dn) * (uSunColor * wdiff + skyAmb);
      sea = mix(sea, iceLit, ice);
    }

    color = mix(land, sea, water);
    color += cityLights(p, footprint, dayFade, water);
  } else {
    // ---------- data views: flat, legible lighting from the viewer ----------
    vec3 c = c0 * w.x + c1 * w.y + c2 * w.z;
    if (uLandView > 0.0) {
      // cultivated intensity green -> yellow, degradation toward red-brown, on land only
      float lu = dot(b, vLand);
      float dg = dot(b, vDeg);
      float landM = smoothstep(-1e-4, 1e-4 + fwidth(vSurf.x), vSurf.x) * (1.0 - dot(b, vec3(vC0.a, vC1.a, vC2.a)));
      if (lu + dg > 0.002 && landM > 0.0) {
        vec3 lo = ws_srgbToLinear(vec3(0.16, 0.40, 0.22));
        vec3 mid = ws_srgbToLinear(vec3(0.50, 0.72, 0.26));
        vec3 hi = ws_srgbToLinear(vec3(0.96, 0.86, 0.30));
        vec3 rc = lu < 0.5 ? mix(lo, mid, lu * 2.0) : mix(mid, hi, lu * 2.0 - 1.0);
        vec3 lc = mix(c, rc, smoothstep(0.0, 0.06, lu));
        lc = mix(lc, ws_srgbToLinear(vec3(0.62, 0.24, 0.13)), smoothstep(0.12, 0.85, dg) * 0.85);
        c = mix(c, lc, landM);
      }
    }
    vec3 Lv = normalize(V + 0.35 * cross(V, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.3, 0.0));
    float lam = max(dot(N, Lv), 0.0);
    color = c * (0.32 + 0.78 * lam);
  }
${FRAG_FOOTER}
`

// Encoding of signed baked fields into 0..1 texels.
const ENC_GLSL = /* glsl */ `
const float R_FIELD = 1.2;
const float R_PERT = 1.2;
float enc(float x, float r) { return clamp(x / (2.0 * r) + 0.5, 0.0, 1.0); }
float dec(float t, float r) { return (t - 0.5) * 2.0 * r; }
`

/** Mountain mask from elevation and the steepness of the vertex normal (static). */
const MOUNTAIN_GLSL = /* glsl */ `
float mountainMask(vec3 N, vec3 up) {
  float elev = max(vSurf.x, 0.0);
  float steep = 1.0 - dot(N, up);
  return clamp(smoothstep(0.3, 0.68, elev) + 0.5 * smoothstep(0.06, 0.16, steep) * smoothstep(0.18, 0.4, elev), 0.0, 1.0);
}
`

/** Bake shader for cube target t (0..BAKE_TARGETS-1). */
export function bakeFrag(t: number, size: number): string {
  const split = bakeSplit(size)
  return /* glsl */ `
#define BAKE_T ${t}
${FRAG_HEADER}
${ENC_GLSL}
${MOUNTAIN_GLSL}
const float SPLIT = ${split.toFixed(3)};
// contour fields (coast, lake shore, snow line) keep more octaves per pixel: their edges
// sit where the field crosses a threshold, so small interpolation errors would move them
const float SPLIT_CONTOUR = ${Math.min(split, 100).toFixed(3)};

void main() {
  vec3 p = vObjPos;
  vec3 up = normalize(p);
  float footprint = length(fwidth(p));
  vec3 b = clamp(vBary, 0.0, 1.0);
  vec3 N = normalize(vNormal);
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
#if BAKE_T == 0
  vec3 w = terrainWeights(p, b, footprint);
  vec3 alb = ws_srgbToLinear(vC0.rgb) * w.x + ws_srgbToLinear(vC1.rgb) * w.y + ws_srgbToLinear(vC2.rgb) * w.z;
  float m1 = ws_fbm(p, 9.0, 4, footprint);
  float m2 = ws_fbm(p + 31.7, 40.0, 3, footprint);
  alb *= 1.0 + 0.22 * m1 + 0.12 * m2;
  alb = mix(alb, alb * vec3(1.10, 1.02, 0.80), clamp(m2 * 1.5, 0.0, 1.0) * 0.5);
  o.rgb = sqrt(clamp(alb, 0.0, 1.0));
#elif BAKE_T == 1
  // low band of the land bump (full weight; the runtime applies the screen-footprint fade)
  float elev = max(vSurf.x, 0.0);
  float mtn = mountainMask(N, up);
  vec4 bump = ws_fbmd_band(p + 7.3, uCellFreq * 2.5, 4, 0.0, 0.0, SPLIT);
  vec3 g = (bump.yzw - dot(bump.yzw, up) * up) / uCellFreq;
  float rough = (0.012 + 0.09 * smoothstep(0.12, 0.6, elev)) * (1.0 - 0.55 * mtn);
  vec3 pert = -g * rough;
  o.rgb = vec3(enc(pert.x, R_PERT), enc(pert.y, R_PERT), enc(pert.z, R_PERT));
  o.a = enc(ws_fbm_band(p + 17.0, uCellFreq * 0.6, 5, 0.0, 0.0, SPLIT_CONTOUR), R_FIELD);
#elif BAKE_T == 2
  o.r = enc(ws_fbm_band(p + 29.0, uCellFreq * 0.6, 5, 0.0, 0.0, SPLIT_CONTOUR), R_FIELD);
  o.g = vSurf.y > 0.04 ? enc(ws_fbm_band(p + 3.1, 25.0, 4, 0.0, 0.0, SPLIT_CONTOUR), R_FIELD) : 0.5;
  o.b = vSurf.z > 0.04 ? enc(ws_fbm_band(p + 5.5, 18.0, 4, 0.0, 0.0, SPLIT), R_FIELD) : 0.5;
  vec3 S = vec3(1.0, 3.0, 1.0);
  o.a = enc(ws_fbm(p * S + 4.0, 40.0, 2, footprint), R_FIELD);
#elif BAKE_T == 3
  vec3 S = vec3(1.0, 3.0, 1.0);
  float wind = ws_fbm(p * S + 7.0, 9.0, 2, footprint);
  float streak = ws_fbm(p * S + 4.0, 40.0, 2, footprint);
  float rough = 0.75 + 0.85 * smoothstep(-0.45, 0.45, wind + 0.6 * streak);
  o.r = enc(ws_fbm(p + 11.0, 6.0, 3, footprint), R_FIELD);
  o.g = enc(ws_fbm(p + 13.0, uCellFreq * 0.5, 2, footprint), R_FIELD);
  o.b = (rough - 0.75) / 0.85;
  o.a = enc(ws_fbm(p, 9.0, 4, footprint), R_FIELD);
#else
  o.r = enc(ws_fbm(p + 31.7, 40.0, 3, footprint), R_FIELD);
#endif
  gl_FragColor = o;
}
`
}

/** Per-frame Terrain shader reading the surface bake. */
export function bakedFrag(size: number): string {
  const split = bakeSplit(size)
  return /* glsl */ `
${FRAG_HEADER}
${ENC_GLSL}
${MOUNTAIN_GLSL}
uniform samplerCube uBake0;
uniform samplerCube uBake1;
uniform samplerCube uBake2;
uniform samplerCube uBake3;
uniform samplerCube uBake4;
const float SPLIT = ${split.toFixed(3)};
// contour fields (coast, lake shore, snow line) keep more octaves per pixel: their edges
// sit where the field crosses a threshold, so small interpolation errors would move them
const float SPLIT_CONTOUR = ${Math.min(split, 100).toFixed(3)};
const float HI = 1e9;

void main() {
  vec3 p = vObjPos;
  vec3 up = normalize(p);
  vec3 V = normalize(uCamObj - p);
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), up) + vec3(1e-5, 0.0, 0.0));
  vec3 north = cross(up, east);
  vec3 L = sunAt(up, east, north);
  float footprint = length(fwidth(p));

  // all fetches up front (implicit derivatives need uniform control flow)
  vec4 t0 = textureCube(uBake0, p);
  vec4 t1 = textureCube(uBake1, p);
  vec4 t2 = textureCube(uBake2, p);
  vec4 t3 = textureCube(uBake3, p);
  float t4 = textureCube(uBake4, p).r;

  vec3 b = clamp(vBary, 0.0, 1.0);
  vec3 N = normalize(vNormal);
  float mu = dot(up, L);
  float dayFade = smoothstep(-0.12, 0.12, mu);

  // coast: low band baked, high band per pixel (only where it could move the shoreline)
  float coastAmp = max(vSlope, 0.01) * 1.7;
  float e = vSurf.x;
  if (abs(e) < coastAmp * 1.25) e += (dec(t1.a, R_FIELD) + ws_fbm_band(p + 17.0, uCellFreq * 0.6, 5, footprint, SPLIT_CONTOUR, HI)) * coastAmp;
  float aaE = fwidth(vSurf.x) * 1.2 + 1e-5;
  float seaM = 1.0 - smoothstep(-aaE, aaE, e);
  float lakeLin = dot(b, vec3(vC0.a, vC1.a, vC2.a));
  float aaLin = fwidth(lakeLin);
  float lakeF = -1.0;
  float lakeM = 0.0;
  if (max(vC0.a, max(vC1.a, vC2.a)) > 0.0) {
    lakeF = lakeLin - 0.5 + 0.55 * (dec(t2.r, R_FIELD) + ws_fbm_band(p + 29.0, uCellFreq * 0.6, 5, footprint, SPLIT_CONTOUR, HI));
    float aaL = aaLin * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
    lakeM = smoothstep(-aaL, aaL, lakeF);
  }
  if (uResOn > 0.0 && max(vRes.x, max(vRes.y, vRes.z)) > 0.0) {
    float resLin = dot(b, vRes);
    float resF = resLin - 0.6 + 0.16 * ws_fbm(p + 37.0, uCellFreq * 1.6, 4, footprint);
    float aaR = fwidth(resLin) * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
    float resM = smoothstep(-aaR, aaR, resF);
    lakeF = max(lakeF, resF * 2.0);
    lakeM = max(lakeM, resM);
  }
  float water = max(seaM, lakeM);

  vec3 skyAmb = mix(vec3(0.030, 0.040, 0.070), SKY * 0.08, smoothstep(-0.25, 0.4, mu));
  float m1 = dec(t3.a, R_FIELD);
  float m2 = dec(t4, R_FIELD);

  vec3 land = vec3(0.0);
  if (water < 0.999) {
    vec3 alb = t0.rgb * t0.rgb;

    if (uFarm > 0.0 && max(max(vLand.x, vLand.y), vLand.z) + max(max(vDeg.x, vDeg.y), vDeg.z) > 0.002) {
      // land use follows the same noisy corner weights as the procedural albedo blend
      vec3 w = terrainWeights(p, b, footprint);
      alb = farmland(alb, p, dot(w, vLand), dot(w, vDeg), m2 - 0.4 * m1, footprint);
    }

    float elev = max(vSurf.x, 0.0);
    float mtn = mountainMask(N, up);
    float rough = (0.012 + 0.09 * smoothstep(0.12, 0.6, elev)) * (1.0 - 0.55 * mtn);

    // bump: the baked low octave (with the same footprint fade as the procedural shader)
    // plus the octaves too fine for the bake
    vec3 pert = vec3(dec(t1.r, R_PERT), dec(t1.g, R_PERT), dec(t1.b, R_PERT)) * ws_lod(uCellFreq * 2.5, footprint);
    vec4 bump = ws_fbmd_band(p + 7.3, uCellFreq * 2.5, 4, footprint, SPLIT, HI);
    pert -= (bump.yzw - dot(bump.yzw, up) * up) / uCellFreq * rough;
    N = normalize(N + pert);

    // ridged mountains stay per pixel (crisp crests at any zoom); only where mtn > 0
    float ridge = 0.5;
    if (mtn > 0.01) {
      float rf = uCellFreq * 1.5;
      vec3 warp = ws_noised(p * (rf * 0.35) + 3.7).yzw;
      vec4 rg = ws_ridged(p + 13.7 + warp * (0.35 / rf), rf, 3, footprint);
      vec3 gr = (rg.yzw - dot(rg.yzw, up) * up) / rf;
      N = normalize(N - gr * 0.2 * mtn);
      ridge = rg.x;
      alb *= mix(1.0, 0.76 + 0.45 * ridge, mtn);
    }

    if (vSurf.y > 0.08) {
      float slope = 1.0 - dot(N, up);
      float sn = vSurf.y + 0.28 * (dec(t2.g, R_FIELD) + ws_fbm_band(p + 3.1, 25.0, 4, footprint, SPLIT_CONTOUR, HI)) - slope * 1.2 + (ridge - 0.5) * 0.3 * mtn;
      float snow = smoothstep(0.42, 0.58, sn);
      alb = mix(alb, SNOW * (0.94 + 0.08 * m2), snow);
    }

    vec3 Lhs = normalize(up + 0.75 * (north - east));
    float hs = clamp(dot(N, Lhs) / dot(up, Lhs), 0.35, 1.6);
    float diff = max(dot(N, L), 0.0) * dayFade;
    float shade = diff * mix(1.0, hs, 0.5);
    land = alb * (uSunColor * shade + skyAmb * mix(1.0, hs, 0.4));
  }

  vec3 sea = vec3(0.0);
  if (water > 0.001) {
    float lakeW = lakeM * (1.0 - seaM);
    float depth = clamp(-mix(vDepth, vSurf.x, 0.35), 0.0, 1.0) * (1.0 - lakeW);
    float dn = dec(t3.r, R_FIELD);
    float dn2 = dec(t3.g, R_FIELD);
    float dd = depth + dn * 0.06 + dn2 * 0.04;
    vec3 wcol = mix(SHELF, SHALLOW, smoothstep(0.0, 0.2, dd));
    wcol = mix(wcol, DEEP, smoothstep(0.15, 0.7, dd));
    vec3 lakeCol = mix(LAKE_SHORE, LAKE_DEEP, smoothstep(0.12, 0.6, lakeF + dn2 * 0.08));
    wcol = mix(wcol, lakeCol, lakeW);

    float ice = 0.0;
    if (vSurf.z > 0.08) ice = smoothstep(0.45, 0.55, vSurf.z + 0.3 * (dec(t2.b, R_FIELD) + ws_fbm_band(p + 5.5, 18.0, 4, footprint, SPLIT, HI)));

    vec3 H = normalize(L + V);
    float nv = max(dot(up, V), 0.0);
    float nl0 = max(dot(up, L), 0.0);
    float fresH = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float axBase = mix(0.085, 0.04, ws_lod(240.0, footprint));
    float sheen = glintLobe(up, H, east, north, axBase * 3.5, axBase * 2.2, nl0);
    float spec = 0.0;
    if (sheen * fresH > 2e-4 && uDaylight < 0.5) {
      vec3 S = vec3(1.0, 3.0, 1.0);
      float streak = dec(t2.a, R_FIELD);
      float rough = 0.75 + 0.85 * t3.b;
      vec4 sw = ws_fbmd(p * S + 2.0, 70.0, 2, footprint);
      vec4 ch = ws_fbmd(p + 9.0, 240.0, 3, footprint);
      vec3 gsw = sw.yzw * S;
      vec3 wslope = 0.035 * (gsw - dot(gsw, up) * up) / 70.0 + 0.12 * (ch.yzw - dot(ch.yzw, up) * up) / 240.0;
      vec3 Nw = normalize(up - wslope);
      float ax = axBase * rough;
      float nl = max(dot(Nw, L), 0.0);
      float glitter = 0.5 + 0.9 * smoothstep(-0.25, 0.35, streak + 0.5 * ch.x);
      spec = fresH * 15.0 * (glintLobe(Nw, H, east, north, ax, ax * 0.55, nl) * glitter + 0.12 * sheen);
    }
    spec *= dayFade * (1.0 - ice);
    float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    float wdiff = max(mu, 0.0) * dayFade;
    sea = wcol * (uSunColor * wdiff * 0.9 + skyAmb * 1.2);
    sea += uSunColor * spec;
    sea = mix(sea, SKY * 0.35 * dayFade, fres * 0.55);
    vec3 iceLit = SEA_ICE * (0.95 + 0.1 * dn) * (uSunColor * wdiff + skyAmb);
    sea = mix(sea, iceLit, ice);
  }

  vec3 color = mix(land, sea, water);
  color += cityLights(p, footprint, dayFade, water);
${FRAG_FOOTER}
`
}
