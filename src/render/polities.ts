// Polities on the globe (data from ui/politiesData.ts):
//
//  - Territory: a second draw of the planet's own geometry (the globe mesh, base triangles
//    and close-zoom detail tiles alike: the same ground, the same corner cells, barycentrics
//    and seeds), so a polity's land has exactly the noisy cell boundaries of the per-cell
//    views. A per-cell float texture holds each corner's polity at the two snapshots
//    bracketing the year and its danger at the two land snapshots bracketing it; the
//    fragment shader picks the owner of each pixel with the planet's categorical weights
//    (pow(b, 6) * exp(16 n)) and draws a soft tint, crisp borders where neighbouring cells
//    belong to different polities (lighter against stateless land), and a ribbon along the
//    inside of each border. A cell that changes hands switches at a noise threshold over
//    the five years between snapshots, so a conquest reads as a border sweeping across.
//    On the Terrain view the tint stops at the coast as the planet draws it (the elevation
//    contour and lake shores), and is lit by the sun (dim on the night side). On the
//    Factions view it is a flat political map (solid colours, strong dark borders, lit like
//    the data views); on the Danger view a heat ramp of History.danger. Borders between
//    polities at war glow red and pulse with the year. Triangles with no owned corner are
//    culled in the vertex shader. The texture is rewritten only when a snapshot changes.
//  - Capitals: a small gold star over each capital's marker (rewritten when the year moves
//    to another whole year).
//  - Armies (JourneyKind.Army): a shield in the polity's colour, larger for bigger armies,
//    moving from the staging town to its target (a march is drawn over a few years, from no
//    earlier than its war's start: the real marches last weeks), with three fading dots behind.
//  - Event marks: a clash burst where a settlement is taken or a siege lifted, a flash and a
//    lingering soot mark where one is sacked, ripples where a revolt breaks out or a province
//    breaks away; on the Danger view icons for the raids, battles, sacks and revolts of the
//    last decades (small raids from History.raids as faint dots). All a function of the year;
//    effects fade at high playback speed.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius, type GlobeMesh } from './globe.ts'
import { NOISE_GLSL } from './glsl.ts'
import { RELIEF_GLSL, relief, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, seamCopy, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { requestRender } from './invalidate.ts'
import { capitalAt, cellPolities, landSnapNear, polityAt, PolityEvent, SACK_YEARS, type PolitiesData } from '../ui/politiesData.ts'

const TEX_W = 512
const PAL_W = 256
const MAX_WARS = 16
const MAX_ARMIES = 96
const GHOSTS = 3
/** Years the Danger view keeps showing an event's icon. */
const DANGER_YEARS = 30
const NEVER = 1e9
const LIFT = 0.0045

/** What the territory overlay shows: off, a tint on the Terrain view, the flat Factions map, the Danger heat map. */
export const PolityView = { Off: 0, Tint: 1, Political: 2, Danger: 3 } as const
export type PolityView = (typeof PolityView)[keyof typeof PolityView]

export interface PolityLayer {
  object: THREE.Group
  /** The globe whose geometry the territory overlay redraws (null: none yet). */
  setGlobe(globe: GlobeMesh | null): void
  setView(view: PolityView): void
  /** Selected polity (-1 none): its land highlighted, the others dimmed. */
  setSelected(p: number): void
  /** Known-world mask: per cell, the year from which it is known (1e9 never); null shows all. Marks in unknown cells are hidden. */
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order for the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /**
   * Per frame: the year, the bracketing snapshots and fraction, the pulse length in years and
   * an effect opacity (lower at high playback speed). Rewrites the cell texture only when a
   * snapshot or land snapshot changes, the capitals and wars when the whole year changes.
   */
  setTime(year: number, s0: number, s1: number, frac: number, pulseYears: number, effectAlpha: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Polity of each cell at the snapshot shown (WATER, -1 or an id), or null. */
  readonly cells: Int16Array | null
  dispose(): void
}

// ---------------------------------------------------------------------------
// territory overlay shaders

const OVERLAY_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec3 aBary;
attribute vec4 aSurf;
attribute vec4 aSeed;
attribute vec3 aCorners;
attribute vec3 aGrad;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aC2;
uniform sampler2D uCells;
uniform int uMode;
flat varying vec3 vP0;
flat varying vec3 vP1;
flat varying vec3 vD0;
flat varying vec3 vD1;
flat varying vec3 vSeed;
flat varying vec3 vLake;
flat varying vec3 vT0;
flat varying vec3 vT1;
flat varying vec3 vT2;
varying vec3 vBary;
varying vec3 vObj;
varying vec3 vGrad;
varying float vElev;
varying float vSlope;
vec4 pl_cell(float c) {
  int i = int(c + 0.5);
  return texelFetch(uCells, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0);
}
void main() {
  vec4 a = pl_cell(aCorners.x), b = pl_cell(aCorners.y), c = pl_cell(aCorners.z);
  vP0 = vec3(a.x, b.x, c.x);
  vP1 = vec3(a.y, b.y, c.y);
  vD0 = vec3(a.z, b.z, c.z);
  vD1 = vec3(a.w, b.w, c.w);
  float owned = max(max(max(vP0.x, vP0.y), vP0.z), max(max(vP1.x, vP1.y), vP1.z));
  float danger = max(max(max(vD0.x, vD0.y), vD0.z), max(max(vD1.x, vD1.y), vD1.z));
  // nothing owned here (and no danger on the Danger view): nothing to draw
  if (owned < -0.5 && !(uMode == 3 && danger > 0.0)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vBary = aBary;
  vObj = position;
  vGrad = aGrad;
  vElev = aSurf.x;
  vSlope = aSeed.w * 0.5;
  vSeed = aSeed.xyz;
  vLake = vec3(aC0.a, aC1.a, aC2.a);
  // the planet's corner colours of the view (on the Terrain view its albedo), to keep the tint apart from it
  vT0 = aC0.rgb;
  vT1 = aC1.rgb;
  vT2 = aC2.rgb;
  // (on the flat map: unwrapped at the antimeridian, mapProjection.ts)
  vec3 pDrawn = ws_placeTri(ws_relief(position), aCorners);
  if (ws_cull > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pDrawn, 1.0);
}
`

const OVERLAY_FRAG = /* glsl */ `
uniform sampler2D uPalette;
uniform int uMode;
uniform float uFrac;
uniform float uLandFrac;
uniform float uCellFreq;
uniform float uSel;
uniform vec4 uWars[${MAX_WARS}];
uniform int uWarCount;
uniform float uTint;
uniform int uCoastOct;
uniform float uBorderPx;
uniform float uYear;
uniform float uPulse;
uniform float uShade;
uniform vec3 uSunObj;
uniform vec3 uCamObj;
uniform float uDaylight;
flat varying vec3 vP0;
flat varying vec3 vP1;
flat varying vec3 vD0;
flat varying vec3 vD1;
flat varying vec3 vSeed;
flat varying vec3 vLake;
flat varying vec3 vT0;
flat varying vec3 vT1;
flat varying vec3 vT2;
varying vec3 vBary;
varying vec3 vObj;
varying vec3 vGrad;
varying float vElev;
varying float vSlope;
${NOISE_GLSL}
${SEAM_FRAG_GLSL}

// cheap value noise in about [-0.5, 0.5] (the sweep of a changing border needs no gradient noise)
float pl_vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = ws_hash33(i).x, b = ws_hash33(i + vec3(1.0, 0.0, 0.0)).x, c = ws_hash33(i + vec3(0.0, 1.0, 0.0)).x, d = ws_hash33(i + vec3(1.0, 1.0, 0.0)).x;
  float e = ws_hash33(i + vec3(0.0, 0.0, 1.0)).x, g = ws_hash33(i + vec3(1.0, 0.0, 1.0)).x, h = ws_hash33(i + vec3(0.0, 1.0, 1.0)).x, k = ws_hash33(i + vec3(1.0, 1.0, 1.0)).x;
  return 0.5 * mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
vec3 pl_color(float id) {
  int i = int(id + 0.5);
  return ws_srgbToLinear(texelFetch(uPalette, ivec2(i % ${PAL_W}, i / ${PAL_W}), 0).rgb);
}
// a over b, premultiplied
vec4 pl_over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
float pl_atWar(float a, float b) {
  for (int i = 0; i < ${MAX_WARS}; i++) {
    if (i >= uWarCount) break;
    vec4 w = uWars[i];
    if ((abs(w.x - a) < 0.5 && abs(w.y - b) < 0.5) || (abs(w.x - b) < 0.5 && abs(w.y - a) < 0.5)) return w.z;
  }
  return 0.0;
}
vec3 pl_heat(float x) {
  vec3 c0 = vec3(0.20, 0.10, 0.30), c1 = vec3(0.55, 0.12, 0.30), c2 = vec3(0.86, 0.30, 0.12), c3 = vec3(1.0, 0.78, 0.30);
  vec3 c = x < 0.33 ? mix(c0, c1, x / 0.33) : x < 0.66 ? mix(c1, c2, (x - 0.33) / 0.33) : mix(c2, c3, (x - 0.66) / 0.34);
  return ws_srgbToLinear(c);
}

void main() {
  vec3 p = vObj;
  vec3 up = normalize(p);
  float footprint = length(fwidth(p));
  vec3 b = clamp(vBary, 0.0, 1.0);
  bool tint = uMode == 1;
  bool political = uMode == 2;
  bool danger = uMode == 3;

  // owners at this pixel: a cell changing hands switches at a noise threshold during the five years
  vec3 ids = vP0;
  if (any(notEqual(vP0, vP1))) {
    vec3 q = p * uCellFreq * 0.55 + 11.0;
    float thr = clamp(0.5 + 1.1 * (pl_vnoise(q) + 0.5 * pl_vnoise(q * 2.03 + 5.0)), 0.03, 0.97);
    ids = uFrac >= thr ? vP1 : vP0;
  }
  // the data views colour lakes as water; the Terrain view draws their shores itself (below)
  if (!tint) ids = mix(ids, vec3(-2.0), step(0.5, vLake));

  // the planet's categorical corner weights (planetShaders.ts), so boundaries match the cell views
  vec3 ws = b;
  bool flat3 = ids.x == ids.y && ids.y == ids.z;
  // on the Terrain view water corners do not take part: one owner among the land corners needs no weights
  if (tint && !flat3) {
    float l0 = ids.x > -1.5 ? ids.x : ids.y > -1.5 ? ids.y : ids.z;
    flat3 = (ids.x < -1.5 || ids.x == l0) && (ids.y < -1.5 || ids.y == l0) && (ids.z < -1.5 || ids.z == l0);
  }
  // up close the tint has stepped back for the towns: only borders are drawn
  if (flat3 && tint && uTint < 0.004) discard;
  if (!flat3 || danger) {
    vec3 q = p * uCellFreq * 1.1;
    float fp = footprint * uCellFreq * 1.1;
    // (the Terrain view shows no cell categories of its own: two octaves are enough for the borders there;
    // the data views keep the planet's three, so the coast matches theirs exactly)
    int oct = tint ? 2 : 3;
    vec3 n = vec3(
      ws_fbm(q + vSeed.x * vec3(173.3, 291.7, 117.1), 1.0, oct, fp),
      ws_fbm(q + vSeed.y * vec3(173.3, 291.7, 117.1), 1.0, oct, fp),
      ws_fbm(q + vSeed.z * vec3(173.3, 291.7, 117.1), 1.0, oct, fp));
    ws = pow(b, vec3(6.0)) * exp(n * 16.0);
    ws /= max(ws.x + ws.y + ws.z, 1e-6);
  }
  // on the Terrain view water corners do not count (the coast below clips the tint instead)
  vec3 wv = tint ? ws * step(-1.5, ids) : ws;
  float tot = max(wv.x + wv.y + wv.z, 1e-6);
  wv /= tot;
  float gx = wv.x + (ids.y == ids.x ? wv.y : 0.0) + (ids.z == ids.x ? wv.z : 0.0);
  float gy = wv.y + (ids.x == ids.y ? wv.x : 0.0) + (ids.z == ids.y ? wv.z : 0.0);
  float gz = wv.z + (ids.x == ids.z ? wv.x : 0.0) + (ids.y == ids.z ? wv.y : 0.0);
  float dom = ids.x, dw = gx;
  if (gy > dw) { dom = ids.y; dw = gy; }
  if (gz > dw) { dom = ids.z; dw = gz; }
  float sec = -3.0, sw = 0.0;
  if (ids.x != dom && gx > sw) { sec = ids.x; sw = gx; }
  if (ids.y != dom && gy > sw) { sec = ids.y; sw = gy; }
  if (ids.z != dom && gz > sw) { sec = ids.z; sw = gz; }
  // distance to the boundary in pixels: the log ratio of the two strongest owners' weights is smooth
  // (the weights themselves switch within a pixel), so its screen derivative gives a steady line width
  // (capped: near a triangle edge where the second owner's corner weight vanishes the log ratio and its
  // derivative both grow without bound, and their ratio would draw the edge)
  float lr = min(log(max(dw, 1e-30)) - log(max(sw, 1e-30)), 7.0);
  float px = sec > -2.5 && sw > 0.0 && lr < 6.9 ? lr / max(fwidth(lr), 1e-4) : 1e5;

  // land mask
  float landM = 1.0;
  if (tint) {
    // the coast and lake shores as the Terrain view draws them
    float coastAmp = max(vSlope, 0.01) * 1.7;
    float e = vElev;
    // (the planet's five octaves at a distance; fewer up close, where the tint has faded and only borders remain)
    if (abs(e) < coastAmp * 1.25) e += ws_fbm(p + 17.0, uCellFreq * 0.6, uCoastOct, footprint) * coastAmp;
    float aaE = fwidth(vElev) * 1.2 + 1e-5;
    landM = smoothstep(-aaE, aaE, e);
    if (max(vLake.x, max(vLake.y, vLake.z)) > 0.0) {
      float lakeLin = dot(b, vLake);
      float lakeF = lakeLin - 0.5 + 0.55 * ws_fbm(p + 29.0, uCellFreq * 0.6, uCoastOct, footprint);
      float aaL = fwidth(lakeLin) * 1.2 + footprint * uCellFreq * 0.25 + 1e-4;
      landM *= 1.0 - smoothstep(-aaL, aaL, lakeF);
    }
  } else if (dom < -1.5) landM = 0.0;
  if (landM < 0.003) discard;

  // lighting: the sun on the Terrain view (dim at night), the data views' flat light otherwise
  vec3 V = normalize(uCamObj - p);
  // (the flat map is seen from straight above)
  if (uFlat > 0.0) V = normalize(mix(V, up, uFlat));
  float light = 1.0, lineLight = 1.0;
  if (tint) {
    float ndl = uDaylight > 0.5 ? 0.8 : dot(up, normalize(uSunObj));
    float day = smoothstep(-0.12, 0.25, ndl);
    light = mix(0.32, 1.0, day);
    lineLight = mix(0.55, 1.0, day);
  } else {
    vec3 N = normalize(up - uShade * (vGrad - dot(vGrad, up) * up));
    vec3 Lv = normalize(V + 0.35 * cross(V, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.3, 0.0));
    light = 0.32 + 0.78 * max(dot(N, Lv), 0.0);
    lineLight = 1.0;
  }

  vec4 outc = vec4(0.0);
  bool sel = uSel >= 0.0;
  bool isSel = sel && abs(dom - uSel) < 0.5;
  // fill
  if (danger) {
    vec3 d = mix(vD0, vD1, uLandFrac);
    // danger is smooth: linear corner weights
    float dv = dot(b, d);
    float a = smoothstep(0.02, 0.16, dv) * 0.92;
    outc = vec4(pl_heat(clamp(dv * 1.3, 0.0, 1.0)) * light * a, a);
  } else if (dom >= -0.5) {
    vec3 c = pl_color(dom);
    // over the terrain a little more chroma, so a pale tint still reads against greens and sands
    if (tint) c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.35), vec3(0.0));
    float a = political ? 1.0 : uTint;
    if (tint) {
      // where the faction's colour is close to the ground's (a sand colour over desert), more of it
      vec3 ground = ws_srgbToLinear(vT0 * b.x + vT1 * b.y + vT2 * b.z);
      float near = 1.0 - smoothstep(0.03, 0.16, length(c - ground));
      a *= 1.0 + 0.7 * near;
    }
    // a ribbon of stronger colour along the inside of a border with another polity (or stateless land)
    if (tint && sec > -1.5) a += (sec >= 0.0 ? 0.3 : 0.16) * (1.0 - smoothstep(0.0, uBorderPx * 4.0, px));
    if (sel && !isSel) {
      if (political) c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), 0.7) * 0.55;
      else a *= 0.35;
    }
    if (isSel && tint) a = min(1.0, a + 0.16);
    a = min(a, 1.0);
    outc = vec4(c * light * a, a);
  }
  // the rest of the world dims while a polity is selected
  // (owned land only: stateless land is not drawn here at all)
  if (sel && !isSel && tint && dom >= -0.5) outc = pl_over(outc, vec4(0.0, 0.0, 0.0, 0.3));

  // borders (land to land, at least one side owned; the coast is not a border)
  if (sec > -1.5 && dom > -1.5 && (dom >= 0.0 || sec >= 0.0)) {
    bool both = dom >= 0.0 && sec >= 0.0;
    float war = both ? pl_atWar(dom, sec) : 0.0;
    float w = uBorderPx * (both ? 1.0 : 0.62) * (political ? 1.15 : 1.0) * (danger ? 0.7 : 1.0);
    vec3 lc;
    float la;
    if (political || danger) {
      lc = vec3(0.012, 0.012, 0.016);
      la = both ? 0.92 : 0.6;
    } else {
      vec3 own = pl_color(dom >= 0.0 ? dom : sec);
      lc = both ? mix(vec3(1.0, 0.97, 0.9), 0.5 * (pl_color(dom) + pl_color(sec)), 0.3) : mix(own, vec3(1.0), 0.45);
      la = both ? 0.95 : 0.6;
    }
    if (war > 0.0) {
      // the front: a broader red line, pulsing with the year
      float pulse = 0.72 + 0.28 * sin(uYear * 6.2831853 / max(uPulse, 1.0));
      w *= 1.0 + 1.2 * war;
      lc = mix(lc, vec3(1.0, 0.13, 0.05) * mix(1.0, pulse, 0.6), war);
      la = mix(la, 1.0, war);
    }
    if (sel && (abs(dom - uSel) < 0.5 || abs(sec - uSel) < 0.5)) {
      w *= 1.3;
      if (!political && war <= 0.0) lc = vec3(1.0);
      la = 1.0;
    }
    float core = 1.0 - smoothstep(w * 0.5 - 0.6, w * 0.5 + 0.6, px);
    float halo = (1.0 - smoothstep(w * 0.5, w * 0.5 + 1.8, px)) * (political ? 0.0 : 0.45) * (both ? 1.0 : 0.5);
    if (war > 0.0) halo = max(halo, (1.0 - smoothstep(w * 0.5, w * 0.5 + 3.5, px)) * 0.5 * war);
    outc = pl_over(vec4(0.0, 0.0, 0.0, halo), outc);
    outc = pl_over(vec4(lc * lineLight * core * la, core * la), outc);
  }
  outc *= landM;
  if (outc.a < 0.003) discard;
  ws_clipTri(); // (the flat map's edge: mapProjection.ts)
  // un-premultiply for the standard blend; tone mapping and output encoding as the planet
  gl_FragColor = vec4(outc.rgb / max(outc.a, 1e-4), outc.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------------------
// marks: capitals, armies, event effects and Danger-view icons

const Mark = { Capital: 0, Clash: 1, Siege: 2, Sack: 3, Revolt: 4, Raid: 5, SmallRaid: 6, Army: 7, Ghost: 8 } as const

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // year, kind, size (px), extra (capital: y offset px; army: opacity; selected flag)
attribute vec3 aCol;
attribute float aKnown;
uniform float uYear;
uniform float uLife;
uniform float uDanger;
uniform float uAlpha;
uniform float uNear;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform vec3 uCamObj;
uniform float uMaskOn;
varying vec2 vPx;
flat varying float vKind;
flat varying float vSize;
flat varying vec3 vCol;
varying float vT;
varying float vAge;
varying float vAlpha;
void main() {
  vec3 pos = ws_relief(aPos);
  float kind = aA.y;
  float age = uYear - aA.x;
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  bool hidden = facing <= 0.0 || (uMaskOn > 0.5 && uYear < aKnown);
  float t = 0.0, alpha = 1.0, ext = aA.z;
  if (kind < 0.5) {
    // capital star (rewritten with the year)
  } else if (kind > 6.5) {
    alpha = aA.w * uAlpha; // armies and their trail
  } else if (uDanger > 0.5) {
    // Danger view: icons of recent events
    float win = kind > 4.5 ? ${(DANGER_YEARS * 0.7).toFixed(1)} : ${DANGER_YEARS.toFixed(1)};
    if (age < 0.0 || age > win) hidden = true;
    t = age / win;
    alpha = (1.0 - smoothstep(0.35, 1.0, t)) * (kind > 5.5 ? 0.5 : 0.95);
  } else {
    // Terrain view: brief effects; a sack leaves a soot mark for decades
    float life = kind > 3.5 ? uLife * 1.4 : uLife;
    float span = kind > 2.5 && kind < 3.5 ? ${SACK_YEARS.toFixed(1)} : life;
    if (age < 0.0 || age > span || kind > 4.5) hidden = true;
    t = age / life;
    alpha = uAlpha * (kind > 2.5 && kind < 3.5 ? 1.0 : pow(max(0.0, 1.0 - t), 1.5));
    ext = kind > 3.5 && kind < 4.5 ? 22.0 : kind > 2.5 && kind < 3.5 ? 20.0 : 16.0;
  }
  if (hidden) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ext *= uSizeScale;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  vec2 off = kind < 0.5 ? vec2(0.0, aA.w * uSizeScale) : vec2(0.0);
  clip.xy += (position.xy * ext + off) * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vKind = kind;
  vSize = ext;
  vCol = aCol;
  vT = t;
  vAge = age;
  vAlpha = alpha * smoothstep(0.0, 0.25, facing) * uNear;
}
`

const MARK_FRAG = /* glsl */ `
uniform float uDanger;
varying vec2 vPx;
flat varying float vKind;
flat varying float vSize;
flat varying vec3 vCol;
varying float vT;
varying float vAge;
varying float vAlpha;
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float sdShield(vec2 p, float r) {
  vec2 q = vec2(abs(p.x), p.y);
  return max(max(q.x - 0.72 * r, q.y - 0.72 * r), length(q - vec2(-0.6 * r, 0.72 * r)) - 1.78 * r);
}
// a teardrop pointing up (after Inigo Quilez's uneven capsule)
float sdFlame(vec2 p, float r) {
  p.y += 0.4 * r;
  p.x = abs(p.x);
  float r1 = 0.5 * r, r2 = 0.05 * r, h = 1.2 * r;
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
// filled glyph with a dark outline: (colour, alpha) premultiplied
vec4 glyph(float d, vec3 col, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  vec3 c = mix(vec3(0.03, 0.03, 0.05), col, fill);
  return vec4(c * edge, edge);
}
void main() {
  vec2 p = vPx;
  float r = vSize;
  vec4 o = vec4(0.0);
  if (vKind < 0.5) {
    // capital: gold star, a white one for the selected polity's
    o = glyph(sdStar(p, r * 0.92, 0.48), vCol, 1.3);
  } else if (vKind > 7.5) {
    // army trail dot
    float d = length(p) - r * 0.45;
    o = glyph(d, vCol, 0.8);
  } else if (vKind > 6.5) {
    // army: a shield in its polity's colour with a pale rim
    float d = sdShield(p, r * 0.85);
    vec4 rim = glyph(d - 1.0, vec3(0.96, 0.93, 0.85), 1.2);
    vec4 body = glyph(d + 0.4, vCol, 0.0);
    o = vec4(body.rgb + rim.rgb * (1.0 - body.a), max(body.a, rim.a));
  } else if (uDanger > 0.5) {
    // Danger view icons
    if (vKind < 1.5) {
      float d = min(sdSeg(p, vec2(-0.7, -0.7) * r, vec2(0.7, 0.7) * r), sdSeg(p, vec2(-0.7, 0.7) * r, vec2(0.7, -0.7) * r)) - 0.16 * r;
      o = glyph(d, vec3(0.95, 0.9, 0.82), 1.2);
    } else if (vKind < 2.5) {
      o = glyph(abs(length(p) - 0.6 * r) - 0.14 * r, vec3(0.7, 0.85, 1.0), 1.0);
    } else if (vKind < 3.5) {
      o = glyph(sdFlame(p, r), vec3(1.0, 0.55, 0.15), 1.2);
    } else if (vKind < 4.5) {
      vec2 q = vec2(abs(p.x), p.y);
      float d = max(dot(q, vec2(0.87, 0.5)) - 0.42 * r, -p.y - 0.6 * r);
      o = glyph(d, vec3(1.0, 0.8, 0.25), 1.2);
    } else if (vKind < 5.5) {
      float d = sdSeg(p, vec2(0.0, -0.8) * r, vec2(0.0, 0.75) * r) - 0.13 * r * (1.0 - 0.6 * clamp((p.y / r + 0.8) / 1.6, 0.0, 1.0));
      d = min(d, sdSeg(p, vec2(-0.4, -0.35) * r, vec2(0.4, -0.35) * r) - 0.1 * r);
      o = glyph(d, vec3(0.95, 0.35, 0.3), 1.0);
    } else {
      o = glyph(length(p) - 0.32 * r, vec3(0.9, 0.4, 0.35), 0.6);
    }
  } else {
    float d = length(p);
    float t = clamp(vT, 0.0, 1.0);
    if (vKind < 2.5) {
      // clash: a burst of sparks and a ring
      float ring = (1.0 - smoothstep(0.8, 2.2, abs(d - (4.0 + r * 0.75 * sqrt(t))))) * (1.0 - t);
      float ang = atan(p.y, p.x);
      float spark = pow(max(0.0, cos(ang * 4.0 + 0.6)), 10.0) * (1.0 - smoothstep(0.0, r * (0.25 + 0.7 * t), d)) * (1.0 - t);
      vec3 c = vKind < 1.5 ? vec3(1.0, 0.55, 0.3) : vec3(0.75, 0.88, 1.0);
      float a = max(ring, spark);
      o = vec4(c * a, a);
    } else if (vKind < 3.5) {
      // sack: a bright flash, then a dark smudge of soot that fades over the years
      float flash = exp(-d * d / (r * r * 0.12)) * (1.0 - smoothstep(0.0, 1.0, t)) * 1.2;
      // (the soot lasts SACK_YEARS, fading)
      float soot = (1.0 - smoothstep(0.22 * r, 0.5 * r, d)) * 0.42 * (1.0 - smoothstep(${(SACK_YEARS * 0.15).toFixed(1)}, ${SACK_YEARS.toFixed(1)}, vAge));
      vec4 s = vec4(vec3(0.02, 0.015, 0.01) * soot, soot);
      vec4 f = vec4(vec3(1.0, 0.62, 0.22) * flash, min(1.0, flash));
      o = vec4(f.rgb + s.rgb * (1.0 - f.a), f.a + s.a * (1.0 - f.a));
    } else {
      // revolt or secession: ripples
      float a = 0.0;
      for (int k = 0; k < 3; k++) {
        float tk = clamp(t * 1.3 - float(k) * 0.18, 0.0, 1.0);
        float rr = 3.0 + r * 0.9 * sqrt(tk);
        a = max(a, (1.0 - smoothstep(0.6, 1.8, abs(d - rr))) * (1.0 - tk) * step(0.001, tk));
      }
      a *= 0.8;
      o = vec4(vec3(1.0, 0.78, 0.28) * a, a);
    }
  }
  o *= vAlpha;
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

interface MarkBuffers {
  geom: THREE.InstancedBufferGeometry
  pos: Float32Array
  a: Float32Array
  col: Float32Array
  known: Float32Array
  attrs: THREE.InstancedBufferAttribute[]
  mesh: THREE.Mesh
}

function markBuffers(capacity: number, material: THREE.ShaderMaterial, dynamic: boolean): MarkBuffers {
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(Math.max(1, capacity) * 3)
  const a = new Float32Array(Math.max(1, capacity) * 4)
  const col = new Float32Array(Math.max(1, capacity) * 3)
  const known = new Float32Array(Math.max(1, capacity))
  const mk = (arr: Float32Array, size: number) => {
    const at = new THREE.InstancedBufferAttribute(arr, size)
    if (dynamic) at.setUsage(THREE.DynamicDrawUsage)
    return at
  }
  const attrs = [mk(pos, 3), mk(a, 4), mk(col, 3), mk(known, 1)]
  geom.setAttribute('aPos', attrs[0])
  geom.setAttribute('aA', attrs[1])
  geom.setAttribute('aCol', attrs[2])
  geom.setAttribute('aKnown', attrs[3])
  geom.instanceCount = 0
  const mesh = new THREE.Mesh(geom, material)
  mesh.frustumCulled = false
  return { geom, pos, a, col, known, attrs, mesh }
}

export function buildPolityLayer(world: World, h: History, pd: PolitiesData): PolityLayer {
  const { cellCount, positions: P } = world.grid
  const object = new THREE.Group()
  object.name = 'polities'

  // ---- textures ----
  const texH = Math.ceil(cellCount / TEX_W)
  const cellData = new Float32Array(TEX_W * texH * 4)
  const cellTex = new THREE.DataTexture(cellData, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType)
  cellTex.minFilter = cellTex.magFilter = THREE.NearestFilter
  cellTex.generateMipmaps = false
  const palH = Math.max(1, Math.ceil(pd.count / PAL_W))
  const palData = new Uint8Array(PAL_W * palH * 4)
  for (let p = 0; p < pd.count; p++) {
    palData[p * 4] = Math.round(pd.rgb[p * 3] * 255)
    palData[p * 4 + 1] = Math.round(pd.rgb[p * 3 + 1] * 255)
    palData[p * 4 + 2] = Math.round(pd.rgb[p * 3 + 2] * 255)
    palData[p * 4 + 3] = 255
  }
  const palTex = new THREE.DataTexture(palData, PAL_W, palH, THREE.RGBAFormat, THREE.UnsignedByteType)
  palTex.minFilter = palTex.magFilter = THREE.NearestFilter
  palTex.generateMipmaps = false
  palTex.needsUpdate = true

  // ---- territory overlay ----
  const wars = Array.from({ length: MAX_WARS }, () => new THREE.Vector4(-9, -9, 0, 0))
  const ou = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uCells: { value: cellTex },
    uPalette: { value: palTex },
    uMode: { value: 1 },
    uFrac: { value: 0 },
    uLandFrac: { value: 0 },
    uCellFreq: { value: 1 / Math.sqrt((4 * Math.PI) / cellCount) },
    uSel: { value: -1 },
    uWars: { value: wars },
    uWarCount: { value: 0 },
    uTint: { value: 0.4 },
    uCoastOct: { value: 5 },
    uBorderPx: { value: 1.6 },
    uYear: { value: 0 },
    uPulse: { value: 20 },
    uShade: { value: relief.shade },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uDaylight: sunUniforms.uDaylight,
  }
  const overlayMat = new THREE.ShaderMaterial({
    uniforms: ou,
    vertexShader: OVERLAY_VERT,
    fragmentShader: OVERLAY_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
  })
  let overlay: THREE.Mesh | null = null
  let view: PolityView = PolityView.Tint

  // ---- marks ----
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uLife: { value: 10 },
    uDanger: { value: 0 },
    uAlpha: { value: 1 },
    uNear: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uMaskOn: { value: 0 },
  }
  const markMat = new THREE.ShaderMaterial({
    uniforms: mu,
    vertexShader: MARK_VERT,
    fragmentShader: MARK_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const N = pd.settlementCount
  const cellOf = (id: number) => h.settlements[id].cell
  const writePos = (arr: Float32Array, k: number, cell: number, lift = LIFT) => {
    const r = surfaceRadius(world, cell) + lift
    arr[k * 3] = P[cell * 3] * r
    arr[k * 3 + 1] = P[cell * 3 + 1] * r
    arr[k * 3 + 2] = P[cell * 3 + 2] * r
  }

  // capitals (rewritten with the whole year)
  const capitals = markBuffers(Math.max(8, pd.maxAlive), markMat, true)
  capitals.mesh.renderOrder = 8.25
  // event marks (static, by year)
  const evs: { year: number; kind: number; cell: number; col: [number, number, number] }[] = []
  for (const e of h.events) {
    const t = e.type as number
    if (e.settlement < 0 || e.settlement >= N) continue
    const kind = t === PolityEvent.Conquered ? Mark.Clash : t === PolityEvent.SiegeLifted ? Mark.Siege : t === PolityEvent.Sacked ? Mark.Sack : t === PolityEvent.Revolt || t === PolityEvent.Seceded ? Mark.Revolt : t === PolityEvent.Raid ? Mark.Raid : -1
    if (kind < 0) continue
    evs.push({ year: e.year + 0.5, kind, cell: cellOf(e.settlement), col: [1, 1, 1] })
  }
  const R = pd.raids
  if (R) for (let k = 0; k < R.count; k++) if (R.settlement[k] >= 0 && R.settlement[k] < N) evs.push({ year: R.decade[k] * 10 + 5, kind: Mark.SmallRaid, cell: cellOf(R.settlement[k]), col: [1, 1, 1] })
  evs.sort((a, b) => a.year - b.year)
  const evYears = Float64Array.from(evs, (e) => e.year)
  const events = markBuffers(evs.length, markMat, false)
  evs.forEach((e, k) => {
    writePos(events.pos, k, e.cell)
    events.a.set([e.year, e.kind, e.kind === Mark.SmallRaid ? 5 : 7, 0], k * 4)
    events.col.set(e.col, k * 3)
  })
  events.geom.instanceCount = evs.length
  events.mesh.renderOrder = 8.22
  // armies (rewritten while any is under way)
  const A = pd.armies
  const J = h.journeys
  const armies = markBuffers(A ? MAX_ARMIES * (1 + GHOSTS) : 1, markMat, true)
  armies.mesh.renderOrder = 8.9
  /** Cumulative length along each army's path (CSR over A's order), for even motion. */
  let armyLen: Float32Array | null = null
  let armyOff: Uint32Array | null = null
  if (A && J) {
    armyOff = new Uint32Array(A.count + 1)
    for (let k = 0; k < A.count; k++) {
      const j = A.journey[k]
      armyOff[k + 1] = armyOff[k] + (J.pathOffsets[j + 1] - J.pathOffsets[j])
    }
    armyLen = new Float32Array(armyOff[A.count])
    for (let k = 0; k < A.count; k++) {
      const j = A.journey[k]
      let L = 0
      for (let i = J.pathOffsets[j], o = armyOff[k]; i < J.pathOffsets[j + 1]; i++, o++) {
        if (i > J.pathOffsets[j]) {
          const a = J.path[i - 1], b = J.path[i]
          L += Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])
        }
        armyLen[o] = L
      }
    }
  }
  object.add(capitals.mesh, events.mesh, armies.mesh)

  // ---- state ----
  let knownMask: Float32Array | null = null
  let selected = -1
  let shownKey = -1
  let shownDangerKey = -1
  let shownYearInt = NaN
  let shownArmyYear = NaN
  let year = 0
  let marchYears = 6
  let cells: Int16Array | null = null
  const warList: number[] = []

  const sunTmp = new THREE.Quaternion()

  function fillCells(s0: number, s1: number, q0: number, q1: number) {
    const a = cellPolities(pd, s0, q0)
    if (!a) return
    for (let c = 0; c < cellCount; c++) cellData[c * 4] = a[c]
    const b = cellPolities(pd, s1, q1) ?? a
    for (let c = 0; c < cellCount; c++) cellData[c * 4 + 1] = b[c]
    // (the cache keeps the most recent few: a is still in it)
    cells = cellPolities(pd, s0, q0)
  }

  function fillDanger(l0: number, l1: number) {
    const L = pd.land
    if (!L || !L.danger) {
      for (let c = 0; c < cellCount; c++) cellData[c * 4 + 2] = cellData[c * 4 + 3] = 0
      return
    }
    for (let k = 0; k < L.L; k++) {
      const c = L.cells[k]
      if (c >= cellCount) continue
      cellData[c * 4 + 2] = L.danger[l0 * L.L + k] / 255
      cellData[c * 4 + 3] = L.danger[l1 * L.L + k] / 255
    }
  }

  function writeCapitals(y: number) {
    const s = Math.max(0, Math.min(pd.snapshotCount - 1, Math.floor(y / pd.interval)))
    let n = 0
    for (let k = pd.aliveOffsets[s]; k < pd.aliveOffsets[s + 1] && n < Math.max(8, pd.maxAlive); k++) {
      const p = pd.aliveId[k]
      const cap = capitalAt(pd, p, y)
      if (cap < 0 || cap >= N || polityAt(pd, cap, s) !== p || h.population[s * N + cap] <= 0) continue
      const cell = cellOf(cap)
      writePos(capitals.pos, n, cell)
      const pop = h.population[s * N + cap]
      const off = pop >= 10000 ? 11.5 : pop >= 3000 ? 8.5 : 6
      const isSel = p === selected
      capitals.a.set([0, Mark.Capital, isSel ? 6.2 : 5, off], n * 4)
      capitals.col.set(isSel ? [1, 1, 1] : [1.0, 0.82, 0.3], n * 3)
      capitals.known[n] = knownMask ? (knownMask[cell] ?? NEVER) : 0
      n++
    }
    capitals.geom.instanceCount = n
    for (const at of capitals.attrs) {
      at.clearUpdateRanges()
      at.addUpdateRange(0, Math.max(1, n) * at.itemSize)
      at.needsUpdate = true
    }
    capitals.mesh.visible = n > 0
  }

  function writeWars(y: number) {
    warList.length = 0
    const W = pd.wars
    let n = 0
    if (W) {
      for (let w = 0; w < W.count && n < MAX_WARS; w++) {
        if (!(y >= W.startYear[w] && (W.endYear[w] < 0 || y < W.endYear[w]))) continue
        if (W.attacker[w] === W.defender[w]) continue
        // a war fades in over its first year and out over its last
        const end = W.endYear[w] < 0 ? Infinity : W.endYear[w]
        const k = Math.min(1, (y - W.startYear[w]) / 1 + 0.35, (end - y) / 1 + 0.35)
        wars[n].set(W.attacker[w], W.defender[w], Math.max(0, Math.min(1, k)), 0)
        warList.push(w)
        n++
      }
    }
    ou.uWarCount.value = n
  }

  const tmpA = new THREE.Vector3()
  function writeArmies(y: number) {
    if (!A || !J || !armyLen || !armyOff) {
      armies.mesh.visible = false
      return
    }
    // armies arriving from now until marchYears ahead (binary search on arrival), and those just arrived
    let lo = 0, hi = A.count
    const from = y - 0.4
    while (lo < hi) {
      const m = (lo + hi) >>> 1
      if (A.arrive[m] < from) lo = m + 1
      else hi = m
    }
    let n = 0
    for (let k = lo; k < A.count && n + 1 + GHOSTS <= armies.pos.length / 3; k++) {
      const arrive = A.arrive[k]
      if (arrive - marchYears > y) break
      const start = Math.max(A.shownFrom[k], arrive - marchYears)
      if (y < start) continue
      const span = Math.max(0.05, arrive - start)
      const f = Math.min(1, (y - start) / span)
      const j = A.journey[k]
      const p0 = J.pathOffsets[j], p1 = J.pathOffsets[j + 1]
      if (p1 - p0 < 1) continue
      const total = armyLen[armyOff[k + 1] - 1]
      const q = A.polity[k]
      const cr = q >= 0 ? pd.rgb[q * 3] : 0.8, cg = q >= 0 ? pd.rgb[q * 3 + 1] : 0.8, cb = q >= 0 ? pd.rgb[q * 3 + 2] : 0.8
      const size = 4.2 + 5.2 * Math.sqrt(Math.min(1, A.size[k] / A.maxSize))
      // fade in at the start, out after arrival
      const op = Math.min(1, f * 6 + 0.2) * (y > arrive ? Math.max(0, 1 - (y - arrive) / 0.4) : 1)
      for (let g = 0; g <= GHOSTS; g++) {
        const fg = Math.max(0, f - g * 0.07)
        if (g > 0 && fg <= 0) break
        // point along the path at fraction fg of its length
        const target = fg * total
        let i = armyOff[k]
        const iEnd = armyOff[k + 1] - 1
        while (i < iEnd && armyLen[i + 1] < target) i++
        const c0 = J.path[p0 + (i - armyOff[k])], c1 = J.path[p0 + Math.min(iEnd, i + 1) - armyOff[k]]
        const segL = i < iEnd ? armyLen[i + 1] - armyLen[i] : 1
        const t = i < iEnd && segL > 0 ? (target - armyLen[i]) / segL : 0
        const r0 = surfaceRadius(world, c0), r1 = surfaceRadius(world, c1)
        tmpA.set(P[c0 * 3] + (P[c1 * 3] - P[c0 * 3]) * t, P[c0 * 3 + 1] + (P[c1 * 3 + 1] - P[c0 * 3 + 1]) * t, P[c0 * 3 + 2] + (P[c1 * 3 + 2] - P[c0 * 3 + 2]) * t)
        tmpA.normalize().multiplyScalar(Math.max(1, r0 + (r1 - r0) * t) + LIFT + 0.0005)
        armies.pos[n * 3] = tmpA.x
        armies.pos[n * 3 + 1] = tmpA.y
        armies.pos[n * 3 + 2] = tmpA.z
        armies.a[n * 4] = 0
        armies.a[n * 4 + 1] = g === 0 ? Mark.Army : Mark.Ghost
        armies.a[n * 4 + 2] = g === 0 ? size : Math.max(2.2, size * 0.62 - g * 0.5)
        armies.a[n * 4 + 3] = op * (g === 0 ? 1 : 0.55 - g * 0.12)
        armies.col[n * 3] = cr
        armies.col[n * 3 + 1] = cg
        armies.col[n * 3 + 2] = cb
        const cellK = fg < 0.5 ? J.path[p0] : J.path[p1 - 1]
        armies.known[n] = knownMask ? (knownMask[cellK] ?? NEVER) : 0
        n++
      }
    }
    armies.geom.instanceCount = n
    for (const at of armies.attrs) {
      at.clearUpdateRanges()
      at.addUpdateRange(0, Math.max(1, n) * at.itemSize)
      at.needsUpdate = true
    }
    armies.mesh.visible = n > 0
  }

  const countUpTo = (arr: Float64Array, y: number) => {
    let lo = 0, hi = arr.length
    while (lo < hi) {
      const m = (lo + hi) >>> 1
      if (arr[m] <= y) lo = m + 1
      else hi = m
    }
    return lo
  }

  function syncVisibility() {
    const on = view !== PolityView.Off
    if (overlay) overlay.visible = on
    capitals.mesh.visible = on && view !== PolityView.Danger && capitals.geom.instanceCount > 0
    armies.mesh.visible = on && view !== PolityView.Danger && armies.geom.instanceCount > 0
    // event marks: only while some event is within its window
    const win = view === PolityView.Danger ? DANGER_YEARS : Math.max(SACK_YEARS, ou.uPulse.value * 1.4)
    events.mesh.visible = on && countUpTo(evYears, year) - countUpTo(evYears, year - win) > 0
  }

  const api: PolityLayer = {
    object,
    get cells() {
      return cells
    },
    setGlobe(globe: GlobeMesh | null) {
      if (overlay) {
        object.remove(overlay)
        overlay = null
      }
      if (!globe) return
      overlay = new THREE.Mesh(globe.geometry, overlayMat)
      overlay.frustumCulled = false
      overlay.renderOrder = 1.8 // over the planet and the town ground and shadows, under rivers (2) and roads
      overlay.name = 'polity territory'
      seamCopy(overlay)
      object.add(overlay)
      syncVisibility()
    },
    setView(v: PolityView) {
      view = v
      ou.uMode.value = v
      mu.uDanger.value = v === PolityView.Danger ? 1 : 0
      ou.uTint.value = 0.4
      shownArmyYear = NaN
      syncVisibility()
      requestRender()
    },
    setSelected(p: number) {
      selected = p
      ou.uSel.value = p
      shownYearInt = NaN
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      mu.uMaskOn.value = cellYear ? 1 : 0
      if (cellYear) {
        evs.forEach((e, k) => (events.known[k] = cellYear[e.cell] ?? NEVER))
        events.attrs[3].needsUpdate = true
      }
      shownYearInt = NaN
      shownArmyYear = NaN
      requestRender()
    },
    setMasked(on: boolean) {
      capitals.mesh.renderOrder = on ? 9.76 : 8.25
      events.mesh.renderOrder = on ? 9.75 : 8.22
      armies.mesh.renderOrder = on ? 9.77 : 8.9
    },
    setTime(y: number, s0: number, s1: number, frac: number, pulseYears: number, effectAlpha: number) {
      year = y
      ou.uYear.value = y
      ou.uFrac.value = frac
      ou.uPulse.value = Math.max(3, pulseYears)
      mu.uYear.value = y
      // effects last about a third of a second of playback (and a few years when paused)
      mu.uLife.value = Math.min(8, Math.max(2.5, pulseYears * 0.3))
      mu.uAlpha.value = effectAlpha
      marchYears = Math.min(10, Math.max(2, pulseYears * 0.4))
      if (view === PolityView.Off) return
      // the cell texture: polity at s0, s1 (each with its nearest land snapshot), danger at the land bracket of the year
      const q0 = landSnapNear(pd, s0 * pd.interval), q1 = landSnapNear(pd, s1 * pd.interval)
      const key = ((s0 * 4096 + s1) * 512 + q0) * 512 + q1
      let dirty = false
      if (key !== shownKey) {
        shownKey = key
        fillCells(s0, s1, q0, q1)
        dirty = true
      }
      const L = pd.land
      if (L) {
        const x = Math.min(Math.max(y / L.interval, 0), L.count - 1)
        const l0 = Math.floor(x), l1 = Math.min(l0 + 1, L.count - 1)
        ou.uLandFrac.value = l1 === l0 ? 0 : x - l0
        const dk = l0 * 4096 + l1
        if (dk !== shownDangerKey) {
          shownDangerKey = dk
          fillDanger(l0, l1)
          dirty = true
        }
      }
      if (dirty) cellTex.needsUpdate = true
      const yi = Math.floor(y)
      if (yi !== shownYearInt) {
        shownYearInt = yi
        writeCapitals(y)
        writeWars(y)
      }
      if (y !== shownArmyYear) {
        shownArmyYear = y
        if (view !== PolityView.Danger) writeArmies(y)
      }
      syncVisibility()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (view === PolityView.Off) return
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(sunTmp).invert()
      ou.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(sunTmp)
      camera.getWorldPosition(ou.uCamObj.value)
      object.worldToLocal(ou.uCamObj.value)
      mu.uCamObj.value.copy(ou.uCamObj.value)
      ou.uShade.value = relief.shade
      const alt = ou.uCamObj.value.length() - 1
      // borders a little bolder as the camera comes down; the tint steps back for the 3D towns up close
      ou.uBorderPx.value = (alt > 1.2 ? 1.5 : alt > 0.3 ? 1.8 : 2.2) * pixelRatio
      ou.uCoastOct.value = alt < 0.12 ? 3 : 5
      // (gone at the closest zoom, where the 3D towns and fields take over: the borders stay)
      if (view === PolityView.Tint) ou.uTint.value = 0.4 * Math.min(1, Math.max(0, (alt - 0.025) / 0.06))
      mu.uViewport.value.copy(drawSize)
      mu.uPixelRatio.value = pixelRatio
      mu.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / Math.max(1.05, alt + 1))))
      // marks step back for the 3D towns at the closest zoom
      mu.uNear.value = Math.min(1, Math.max(0.25, (alt - 0.012) / 0.05))
    },
    dispose() {
      if (overlay) object.remove(overlay)
      overlayMat.dispose()
      markMat.dispose()
      cellTex.dispose()
      palTex.dispose()
      for (const m of [capitals, events, armies]) m.geom.dispose()
    },
  }
  return api
}
