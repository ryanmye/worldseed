// The outlaw economy on the map (polities v2; data from ui/politiesData.ts): contraband routes,
// sea lanes preyed upon by pirates and privateers, bandit roads, pirate havens and their ships,
// smugglers' hubs and blockaded ports.
//
//  - Lanes: the links of the bundled route network (routeCurves.ts, shared with the trade and
//    road layers, so every overlay lies exactly on the trade line it qualifies) that ever carry
//    contraband or lose cargo. A float texture holds, per such link, the contraband summed over
//    its routes and the largest share of cargo lost on any of them at the two trade snapshots
//    bracketing the year; it is rewritten only when that pair changes and the vertex shader
//    interpolates. Two draws of one ribbon geometry: contraband as a dark plum dashed overlay,
//    wider with the smuggled volume; losses as broken crimson stretches at sea (a preyed-upon
//    lane: irregular gaps, wider with the share lost) and rust dots on land (a bandit road). The
//    dash lengths are in screen pixels. Shown with the Trade layer, and emphasised (wider,
//    stronger) on the Danger view, where they show even with the Trade layer off.
//  - Marks (one instanced draw): a black sail over each pirate haven, sized by its strength and
//    fading in and out with it between snapshots; a small lantern by each smugglers' hub
//    (contraband >= HUB_CONTRABAND of its income). Both taper with zoom (uHavenZoom, update()):
//    zoomed out to the globe or whole map only the strongest havens show, smaller and dimmer;
//    zooming in brings the weaker ones into view and grows both toward their close-up size and
//    brightness, so the sails declutter a whole-world view without changing the close-up look.
//    A hatched ring round each blockaded port
//    from the Blockade event until its war ends; and pirate ships, dark hulls under black
//    sails cruising now and then along the preyed-upon sea links near their haven (which link,
//    which way and when are hashed from the haven, the ship and the year: a pure function of the
//    year, like the merchants; they fade out at 4x and are gone at 16x). The havens' and hubs'
//    strengths are rewritten per snapshot, the blockades per whole year, the ships whenever the
//    year moves while they show.
//  - Known world: marks in cells not yet known are hidden (per instance), and the lanes lie
//    under the known-world mist like the trade lines.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { SUN_DIRECTION, sunUniforms } from './sun.ts'
import { surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { PIECE_SAMPLES, routeWayAt, type RouteNetwork } from './routeCurves.ts'
import { requestRender } from './invalidate.ts'
import { blockadesAt, HUB_CONTRABAND, type BlockadeMark, type PolitiesData } from '../ui/politiesData.ts'

/** Lift of the lanes above the ground (as the trade lines). */
const LIFT = 0.0032
/** Lift of the marks (over the settlement markers). */
const MARK_LIFT = 0.0045
const TEX_W = 1024
const MAX_BLOCKADES = 24
const MAX_SHIPS = 48
/** Pirate ships keep to links within this many cell spacings of their haven. */
const SHIP_REACH = 4
const NEVER = 1e9

const Kind = { Haven: 0, Hub: 1, Blockade: 2, Ship: 3 } as const

export interface OutlawLayer {
  object: THREE.Group
  /**
   * What shows: the havens, hubs and blockades (with the Factions layer or views), the lanes
   * and ships (with the Trade layer), and the Danger view's emphasis (lanes, ships and marks).
   */
  setShown(marks: boolean, lanes: boolean, danger: boolean): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order for the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /** Per frame: the year, the bracketing snapshots and fraction, and an effect opacity (lower at high playback speed). */
  setTime(year: number, s0: number, s1: number, frac: number, effectAlpha: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  dispose(): void
}

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const LANE_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec4 aSide; // side direction, across (-1|1)
attribute vec4 aInfo; // link slot, sea, arc length from the link midpoint
uniform sampler2D uLane;
uniform int uMode;
uniform float uFrac;
uniform float uLogMax;
uniform float uPixel;
uniform float uPixelRatio;
uniform float uClose;
uniform float uDrop;
uniform float uEmph;
uniform vec3 uCamObj;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vStrength;
varying float vArcPx;
varying float vSea;
varying float vFacing;
void main() {
  vec3 pR = ws_relief(position);
  int i = int(aInfo.x + 0.5);
  vec4 t = texelFetch(uLane, ivec2(i - (i / ${TEX_W}) * ${TEX_W}, i / ${TEX_W}), 0);
  float s;
  if (uMode == 0) {
    float v = mix(t.x, t.y, uFrac);
    s = v > 0.0 ? 0.3 + 0.7 * clamp(log(1.0 + v / 2.0) / uLogMax, 0.0, 1.0) : 0.0;
  } else {
    float l = mix(t.z, t.w, uFrac);
    s = l > 0.0 ? 0.35 + 0.65 * clamp(l * 3.0, 0.0, 1.0) : 0.0;
  }
  if (s <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vStrength = s;
  float core = (uMode == 0 ? 0.65 + 1.35 * s : 0.45 + 1.15 * s) * mix(0.45, 1.0, uClose) * uEmph;
  vec3 base = pR - normalize(pR) * uDrop;
  vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
  float pix = -mv.z * uPixel * uPixelRatio;
  float outer = core + 0.8;
  vCore = core / outer;
  vSoft = 0.9 / outer;
  vAcross = aSide.w;
  vec3 p = base + aSide.xyz * aSide.w * outer * pix;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
  vFacing = ws_facing(dot(normalize(pR), normalize(uCamObj - pR)));
  // dashes measured in CSS pixels along the line
  vArcPx = aInfo.z / max(pix / uPixelRatio, 1e-7);
  vSea = aInfo.y;
}
`

const LANE_FRAG = /* glsl */ `
uniform int uMode;
uniform float uClose;
uniform float uEmph;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vStrength;
varying float vArcPx;
varying float vSea;
varying float vFacing;
${SEAM_FRAG_GLSL}
void main() {
  ws_clipLine();
  float limb = smoothstep(0.0, 0.3, vFacing);
  float x = abs(vAcross);
  float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
  float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
  vec3 col;
  float a;
  if (uMode == 0) {
    // contraband: dark plum dashes with a pale rim, over the trade line
    float f = fract(vArcPx / 10.0);
    float dash = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.58, 0.64, f));
    col = mix(vec3(0.93, 0.84, 1.0), vec3(0.2, 0.03, 0.27), coreMask);
    a = body * mix(0.7, 1.0, coreMask) * dash * (0.7 + 0.3 * vStrength);
  } else if (vSea > 0.5) {
    // a preyed-upon sea lane: crimson stretches broken by irregular gaps
    float k = floor(vArcPx / 15.0);
    float f = fract(vArcPx / 15.0);
    float h = fract(sin(k * 12.9898 + 4.1) * 43758.5453);
    float on = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.3 + 0.4 * h, 0.36 + 0.4 * h, f));
    col = mix(vec3(0.16, 0.02, 0.02), vec3(1.0, 0.24, 0.17), coreMask);
    a = body * mix(0.5, 0.95, coreMask) * on;
  } else {
    // a bandit road: rust dots
    float f = fract(vArcPx / 6.0);
    float on = 1.0 - smoothstep(0.2, 0.32, abs(f - 0.5));
    col = mix(vec3(0.13, 0.05, 0.02), vec3(0.96, 0.45, 0.18), coreMask);
    a = body * mix(0.5, 0.95, coreMask) * on;
  }
  a *= limb * uClose;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // kind, size (px), value at s0, value at s1 (strength; opacity for blockades and ships)
attribute vec3 aDir;
attribute float aKnown;
uniform float uFrac;
uniform float uYear;
uniform float uMaskOn;
uniform float uNear;
uniform float uDanger;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uHavenZoom;
uniform vec3 uCamObj;
varying vec2 vPx;
flat varying float vKind;
varying float vSize;
varying float vAlpha;
varying float vV;
flat varying float vFlip;
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  float kind = aA.x;
  float v = mix(aA.z, aA.w, uFrac);
  // zoomed out to the globe or whole map, only the strongest havens show, smaller and dimmer;
  // zooming in brings in the weaker ones and grows them toward their full close-up look. Hubs
  // (lanterns) keep their own strength cut but share the same size/opacity taper.
  float havenCut = mix(0.42, 0.0, uHavenZoom);
  float alpha = kind < 0.5 ? smoothstep(havenCut, havenCut + 0.1, v) : kind < 1.5 ? smoothstep(${(HUB_CONTRABAND / 255 - 0.03).toFixed(3)}, ${(HUB_CONTRABAND / 255 + 0.05).toFixed(3)}, v) : v;
  if (kind < 1.5) alpha *= mix(0.5, 1.0, uHavenZoom);
  if (facing <= 0.0 || alpha <= 0.003 || (uMaskOn > 0.5 && uYear < aKnown)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float size = kind < 0.5 ? (4.6 + 5.2 * sqrt(clamp(v, 0.0, 1.0))) * (uDanger > 0.5 ? 1.15 : 1.0) : aA.y;
  if (kind < 1.5) size *= mix(0.6, 1.0, uHavenZoom);
  size *= uSizeScale;
  float ext = size + 3.0;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  vec2 ax = vec2(1.0, 0.0), ay = vec2(0.0, 1.0);
  vFlip = 1.0;
  if (kind > 2.5) {
    // a ship is drawn upright, facing the way it sails across the screen
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(ws_place(pos + aDir * 0.01), 1.0);
    vec2 d = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
    vFlip = d.x < 0.0 ? -1.0 : 1.0;
  }
  // havens sit over their settlement's marker, hubs beside it, blockade rings around it
  vec2 off = kind < 0.5 ? vec2(0.0, 11.0) : kind < 1.5 ? vec2(9.0, 3.0) : vec2(0.0);
  vec2 offPx = (ax * position.x + ay * position.y) * ext + off * uSizeScale;
  clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vKind = kind;
  vSize = size;
  vV = v;
  vAlpha = alpha * smoothstep(0.0, 0.25, facing) * uNear;
}
`

const MARK_FRAG = /* glsl */ `
uniform float uDanger;
uniform float uYear;
varying vec2 vPx;
flat varying float vKind;
varying float vSize;
varying float vAlpha;
varying float vV;
flat varying float vFlip;
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
// a filled glyph with an outline of the given colour: premultiplied
vec4 glyph(float d, vec3 fillC, vec3 lineC, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  return vec4(mix(lineC, fillC, fill) * edge, edge);
}
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
void main() {
  vec2 p = vPx;
  float r = vSize;
  vec4 o = vec4(0.0);
  vec3 bone = vec3(0.93, 0.9, 0.82);
  if (vKind < 0.5 || vKind > 2.5) {
    // a black sail on a mast over a small hull (a haven; a ship, facing the way it sails)
    vec2 q = vKind > 2.5 ? vec2(p.x * vFlip, p.y) : p;
    float hull = max(sdBox(q - vec2(0.0, -0.62 * r), vec2(0.62 * r, 0.16 * r)), -(q.y + 0.62 * r) - 0.1 * r * (1.0 - abs(q.x) / (0.62 * r)));
    float sail = sdTri(q, vec2(0.08 * r, 0.9 * r), vec2(0.08 * r, -0.36 * r), vec2(0.72 * r, -0.36 * r));
    float jib = sdTri(q, vec2(-0.06 * r, 0.7 * r), vec2(-0.06 * r, -0.36 * r), vec2(-0.5 * r, -0.36 * r));
    float d = min(min(hull, sail), jib);
    vec3 line = vKind > 2.5 ? vec3(0.85, 0.2, 0.14) : bone;
    o = glyph(d, vec3(0.04, 0.035, 0.04), line, 1.1);
    // the Danger view: a red glow under a haven
    if (uDanger > 0.5 && vKind < 0.5) o = over(o, vec4(vec3(0.8, 0.1, 0.06) * 0.45, 0.45) * (1.0 - smoothstep(0.2 * r, 1.05 * r, length(p))));
  } else if (vKind < 1.5) {
    // a lantern: a warm glow, a dark frame round its bright window, a cap and a ring to hang it by
    float body = sdBox(p - vec2(0.0, -0.12 * r), vec2(0.34 * r, 0.46 * r)) - 0.1 * r;
    float capD = sdBox(p - vec2(0.0, 0.46 * r), vec2(0.24 * r, 0.08 * r));
    float ring = abs(length(p - vec2(0.0, 0.7 * r)) - 0.14 * r) - 0.06 * r;
    vec4 frame = glyph(min(min(body, capD), ring), vec3(0.1, 0.07, 0.05), vec3(0.98, 0.86, 0.6), 1.0);
    float win = 1.0 - smoothstep(-0.5, 0.5, sdBox(p - vec2(0.0, -0.12 * r), vec2(0.18 * r, 0.3 * r)));
    vec4 light = vec4(vec3(1.0, 0.8, 0.35) * win, win);
    float halo = exp(-dot(p - vec2(0.0, -0.1 * r), p - vec2(0.0, -0.1 * r)) / (r * r * 0.9)) * 0.55;
    o = over(light, over(frame, vec4(vec3(1.0, 0.62, 0.18) * halo, halo)));
  } else {
    // a blockaded port: a ring hatched crimson and white round it, with a dark rim either side
    float d = length(p);
    float band = abs(d - 0.74 * r) - 0.22 * r;
    float hf = fract((p.x + p.y) / 4.0);
    float hatch = smoothstep(0.0, 0.12, hf) * (1.0 - smoothstep(0.5, 0.62, hf));
    float inBand = 1.0 - smoothstep(-0.6, 0.6, band);
    float rim = 1.0 - smoothstep(-0.6, 0.6, band - 1.1);
    vec3 c = mix(vec3(0.06, 0.02, 0.02), mix(vec3(0.92, 0.12, 0.1), vec3(1.0, 0.95, 0.9), hatch), inBand);
    o = vec4(c * rim, rim);
  }
  o *= vAlpha;
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

export function buildOutlawLayer(world: World, h: History, pd: PolitiesData, net: RouteNetwork | null): OutlawLayer {
  const { cellCount, positions: P } = world.grid
  const N = pd.settlementCount
  const object = new THREE.Group()
  object.name = 'outlaws'
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)

  // ---------- lanes: the links that ever carry contraband or lose cargo ----------
  const T = pd.trade
  const SM = pd.smuggle, LO = pd.loss
  const R = T?.count ?? 0
  const TS = T?.snapshots ?? 0
  const L = net?.linkCount ?? 0
  const slotOf = new Int32Array(L).fill(-1)
  const slotLink: number[] = []
  const outlawRoutes: number[] = []
  // (a route's links are its way's at the snapshot: it may have re-pathed round danger, routeWayAt)
  const wayAt = (r: number, t: number) => (net ? routeWayAt(net, r, t * T!.interval) : r)
  if (T && net && (SM || LO) && (net.routeCount ?? net.routeLinkOffsets.length - 1) === R) {
    for (let r = 0; r < R; r++) {
      let any = false
      for (let t = 0; t < TS; t++) {
        if (!((SM && SM[t * R + r] > 0) || (LO && LO[t * R + r] > 0))) continue
        if (!any) outlawRoutes.push(r)
        any = true
        const w = wayAt(r, t)
        for (let k = net.routeLinkOffsets[w]; k < net.routeLinkOffsets[w + 1]; k++) {
          const l = net.routeLinks[k]
          if (slotOf[l] < 0) {
            slotOf[l] = slotLink.length
            slotLink.push(l)
          }
        }
      }
    }
  }
  const nSlots = slotLink.length
  const texH = Math.max(1, Math.ceil(nSlots / TEX_W))
  const laneData = new Float32Array(TEX_W * texH * 4)
  const laneTex = new THREE.DataTexture(laneData, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType)
  laneTex.minFilter = laneTex.magFilter = THREE.NearestFilter
  laneTex.generateMipmaps = false
  laneTex.needsUpdate = true
  /** Loss share per slot at the earlier trade snapshot shown (for the ships). */
  const slotLoss0 = new Float32Array(nSlots)
  const slotLoss1 = new Float32Array(nSlots)
  // volume scale: the largest contraband on a link over the first 2000 years (a longer run does not rescale)
  let maxSm = 1
  if (T && net && SM) {
    const sum = new Float32Array(nSlots)
    for (let t = 0, tn = Math.min(TS, Math.floor(2000 / T.interval) + 1); t < tn; t++) {
      sum.fill(0)
      for (const r of outlawRoutes) {
        const v = SM[t * R + r]
        const w = wayAt(r, t)
        if (v > 0) for (let k = net.routeLinkOffsets[w]; k < net.routeLinkOffsets[w + 1]; k++) sum[slotOf[net.routeLinks[k]]] += v
      }
      for (let i = 0; i < nSlots; i++) if (sum[i] > maxSm) maxSm = sum[i]
    }
  }

  const HS = PIECE_SAMPLES
  const lanesGeom = new THREE.BufferGeometry()
  if (net && nSlots > 0) {
    // every piece of the lanes' links (the curves the trade lines and merchants follow)
    let nPieces = 0
    for (let i = 0; i < nSlots; i++) nPieces += net.linkPieceOffsets[slotLink[i] + 1] - net.linkPieceOffsets[slotLink[i]]
    const V = nPieces * HS * 2
    const vPos = new Float32Array(V * 3), vSide = new Float32Array(V * 4), vInfo = new Float32Array(V * 4)
    let v = 0
    for (let i = 0; i < nSlots; i++) {
      const l = slotLink[i]
      for (let pk = net.linkPieceOffsets[l]; pk < net.linkPieceOffsets[l + 1]; pk++) {
        const hh = net.linkPieces[pk]
        const arcEnd = net.pieceArc[hh * HS + HS - 1]
        for (let s = 0; s < HS; s++) {
          const k = hh * HS + s
          const r = net.pieceRadius[k] + LIFT
          for (let side = 0; side < 2; side++, v++) {
            vPos[v * 3] = net.pieceDir[k * 3] * r
            vPos[v * 3 + 1] = net.pieceDir[k * 3 + 1] * r
            vPos[v * 3 + 2] = net.pieceDir[k * 3 + 2] * r
            vSide[v * 4] = net.pieceSide[k * 3]
            vSide[v * 4 + 1] = net.pieceSide[k * 3 + 1]
            vSide[v * 4 + 2] = net.pieceSide[k * 3 + 2]
            vSide[v * 4 + 3] = side === 0 ? -1 : 1
            vInfo[v * 4] = i
            vInfo[v * 4 + 1] = net.pieceSea[hh]
            vInfo[v * 4 + 2] = arcEnd - net.pieceArc[k]
          }
        }
      }
    }
    const idx = new Uint32Array(nPieces * (HS - 1) * 6)
    let q = 0
    for (let hh = 0; hh < nPieces; hh++) {
      for (let s = 0; s + 1 < HS; s++) {
        const b = (hh * HS + s) * 2
        idx[q++] = b; idx[q++] = b + 2; idx[q++] = b + 1
        idx[q++] = b + 1; idx[q++] = b + 2; idx[q++] = b + 3
      }
    }
    lanesGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
    lanesGeom.setAttribute('aSide', new THREE.BufferAttribute(vSide, 4))
    lanesGeom.setAttribute('aInfo', new THREE.BufferAttribute(vInfo, 4))
    lanesGeom.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  const laneShared = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uLane: { value: laneTex },
    uFrac: { value: 0 },
    uLogMax: { value: Math.log(1 + maxSm / 2) },
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uClose: { value: 1 },
    uDrop: { value: 0 },
    uEmph: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
  }
  const blend = {
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  } as const
  const laneMat = (mode: number) => new THREE.ShaderMaterial({ uniforms: { ...laneShared, uMode: { value: mode } }, vertexShader: LANE_VERT, fragmentShader: LANE_FRAG, ...blend })
  const smuggleMat = laneMat(0), lossMat = laneMat(1)
  const smuggleMesh = new THREE.Mesh(lanesGeom, smuggleMat)
  const lossMesh = new THREE.Mesh(lanesGeom, lossMat)
  for (const m of [smuggleMesh, lossMesh]) {
    m.frustumCulled = false
    m.visible = false
  }
  smuggleMesh.renderOrder = 6.52 // over the trade lines (6.5), under the selected routes (6.6)
  lossMesh.renderOrder = 6.54
  smuggleMesh.name = 'contraband routes'
  lossMesh.name = 'preyed-upon lanes'
  object.add(smuggleMesh, lossMesh)

  // ---------- marks: havens and hubs (by snapshot), blockades (by year), ships (by frame) ----------
  const havens = pd.havenSettlements, hubs = pd.hubSettlements
  const nH = havens.length, nB = hubs.length
  const B0 = nH + nB, S0 = B0 + MAX_BLOCKADES
  const cap = S0 + MAX_SHIPS
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const mPos = new Float32Array(cap * 3), mA = new Float32Array(cap * 4), mDir = new Float32Array(cap * 3), mKnown = new Float32Array(cap)
  const dyn = (a: Float32Array, n: number) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage)
  const posAttr = dyn(mPos, 3), aAttr = dyn(mA, 4), dirAttr = dyn(mDir, 3), knownAttr = dyn(mKnown, 1)
  geom.setAttribute('aPos', posAttr)
  geom.setAttribute('aA', aAttr)
  geom.setAttribute('aDir', dirAttr)
  geom.setAttribute('aKnown', knownAttr)
  geom.instanceCount = 0
  const markCell = new Int32Array(cap).fill(-1)
  const writePos = (k: number, cell: number) => {
    const r = surfaceRadius(world, cell) + MARK_LIFT
    mPos[k * 3] = P[cell * 3] * r
    mPos[k * 3 + 1] = P[cell * 3 + 1] * r
    mPos[k * 3 + 2] = P[cell * 3 + 2] * r
    markCell[k] = cell
  }
  for (let j = 0; j < nH; j++) {
    writePos(j, h.settlements[havens[j]].cell)
    mA[j * 4] = Kind.Haven
  }
  for (let j = 0; j < nB; j++) {
    writePos(nH + j, h.settlements[hubs[j]].cell)
    mA[(nH + j) * 4] = Kind.Hub
    mA[(nH + j) * 4 + 1] = 7.2
  }
  for (let k = B0; k < cap; k++) mA[k * 4] = k < S0 ? Kind.Blockade : Kind.Ship
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uFrac: { value: 0 },
    uYear: { value: 0 },
    uMaskOn: { value: 0 },
    uNear: { value: 1 },
    uDanger: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 1 },
    uHavenZoom: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
  }
  const markMat = new THREE.ShaderMaterial({ uniforms: mu, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, ...blend, side: THREE.FrontSide })
  const marks = new THREE.Mesh(geom, markMat)
  marks.frustumCulled = false
  marks.renderOrder = 8.6 // over the settlement markers and structure icons, under the merchants
  marks.name = 'outlaw marks'
  marks.visible = false
  object.add(marks)

  // pirate ships: per haven, the sea links (that ever lose cargo) within SHIP_REACH cells
  const shipLinks: Int32Array[] = []
  for (let j = 0; j < nH; j++) {
    const c = h.settlements[havens[j]].cell
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2]
    const near: number[] = []
    if (net) {
      for (let i = 0; i < nSlots; i++) {
        const l = slotLink[i]
        if (!net.linkSea[l]) continue
        const a = net.linkA[l], b = net.linkB[l]
        const da = Math.hypot(P[a * 3] - cx, P[a * 3 + 1] - cy, P[a * 3 + 2] - cz), db = Math.hypot(P[b * 3] - cx, P[b * 3 + 1] - cy, P[b * 3 + 2] - cz)
        if (Math.min(da, db) <= SHIP_REACH * spacing) near.push(i)
      }
    }
    shipLinks.push(Int32Array.from(near))
  }

  // ---------- state ----------
  let knownMask: Float32Array | null = null
  let showMarks = false, showLanes = false, danger = false
  let shownT0 = -1, shownT1 = -1, shownS0 = -1, shownS1 = -1, shownYearInt = NaN, shownShipYear = NaN
  let nBlock = 0, nShips = 0
  let effect = 1
  const active: BlockadeMark[] = []
  const tmp = new THREE.Vector3(), tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3(0, 0, 3)

  // Several writes may touch one attribute before it is next uploaded (the strengths, blockades and ships share the
  // buffers): its update range is the union of what is pending, reset once the marks have been drawn (uploaded).
  const attrList = [posAttr, aAttr, dirAttr, knownAttr]
  const pend = new Float64Array(8).fill(-1)
  function upload(attr: THREE.InstancedBufferAttribute, from: number, n: number) {
    const i = attrList.indexOf(attr)
    const lo = from, hi = from + Math.max(1, n)
    if (pend[i * 2] < 0) {
      pend[i * 2] = lo
      pend[i * 2 + 1] = hi
    } else {
      pend[i * 2] = Math.min(pend[i * 2], lo)
      pend[i * 2 + 1] = Math.max(pend[i * 2 + 1], hi)
    }
    attr.clearUpdateRanges()
    attr.addUpdateRange(pend[i * 2] * attr.itemSize, (pend[i * 2 + 1] - pend[i * 2]) * attr.itemSize)
    attr.needsUpdate = true
  }
  marks.onAfterRender = () => {
    pend.fill(-1)
  }
  const knownOf = (cell: number) => (knownMask && cell >= 0 ? (knownMask[cell] ?? NEVER) : 0)

  function writeLanes(t0: number, t1: number) {
    laneData.fill(0)
    if (!T || !net) return
    for (const r of outlawRoutes) {
      const s0 = SM ? SM[t0 * R + r] : 0, s1 = SM ? SM[t1 * R + r] : 0
      const l0 = LO ? LO[t0 * R + r] / 255 : 0, l1 = LO ? LO[t1 * R + r] / 255 : 0
      if (s0 <= 0 && s1 <= 0 && l0 <= 0 && l1 <= 0) continue
      // each snapshot along the way the route followed then
      const w0 = wayAt(r, t0), w1 = wayAt(r, t1)
      if (s0 > 0 || l0 > 0) {
        for (let k = net.routeLinkOffsets[w0]; k < net.routeLinkOffsets[w0 + 1]; k++) {
          const i = slotOf[net.routeLinks[k]]
          laneData[i * 4] += s0
          if (l0 > laneData[i * 4 + 2]) laneData[i * 4 + 2] = l0
        }
      }
      if (s1 > 0 || l1 > 0) {
        for (let k = net.routeLinkOffsets[w1]; k < net.routeLinkOffsets[w1 + 1]; k++) {
          const i = slotOf[net.routeLinks[k]]
          laneData[i * 4 + 1] += s1
          if (l1 > laneData[i * 4 + 3]) laneData[i * 4 + 3] = l1
        }
      }
    }
    for (let i = 0; i < nSlots; i++) {
      slotLoss0[i] = laneData[i * 4 + 2]
      slotLoss1[i] = laneData[i * 4 + 3]
    }
    laneTex.needsUpdate = true
  }

  function writeStrengths(s0: number, s1: number) {
    const S = pd.snapshotCount
    const a = Math.max(0, Math.min(S - 1, s0)) * N, b = Math.max(0, Math.min(S - 1, s1)) * N
    for (let j = 0; j < nH; j++) {
      mA[j * 4 + 2] = pd.piracy ? pd.piracy[a + havens[j]] / 255 : 0
      mA[j * 4 + 3] = pd.piracy ? pd.piracy[b + havens[j]] / 255 : 0
    }
    for (let j = 0; j < nB; j++) {
      mA[(nH + j) * 4 + 2] = pd.contraband ? pd.contraband[a + hubs[j]] / 255 : 0
      mA[(nH + j) * 4 + 3] = pd.contraband ? pd.contraband[b + hubs[j]] / 255 : 0
    }
    upload(aAttr, 0, B0 + nBlock)
  }

  function writeBlockades(y: number) {
    blockadesAt(pd, y, active)
    const n = Math.min(MAX_BLOCKADES, active.length)
    for (let k = 0; k < n; k++) {
      const b = active[k]
      const i = B0 + k
      writePos(i, h.settlements[b.port].cell)
      // fades in over the first year, out over the last
      const f = Math.max(0, Math.min(1, y - b.year + 0.3, b.end - y + 0.3))
      mA[i * 4 + 1] = 13
      mA[i * 4 + 2] = mA[i * 4 + 3] = f
      mKnown[i] = knownOf(markCell[i])
    }
    for (let k = n; k < nBlock; k++) mA[(B0 + k) * 4 + 2] = mA[(B0 + k) * 4 + 3] = 0
    const hi = Math.max(n, nBlock)
    nBlock = n
    upload(posAttr, B0, hi)
    upload(aAttr, B0, hi)
    upload(knownAttr, B0, hi)
  }

  /** The first sea piece at end e of link l (the one the earliest route laid), or -1. */
  function seaPiece(l: number, e: number) {
    const n = net!
    for (let k = n.linkPieceOffsets[l]; k < n.linkPieceOffsets[l + 1]; k++) {
      const p = n.linkPieces[k]
      if (n.pieceEnd[p] === e && n.pieceSea[p]) return p
    }
    return -1
  }
  /**
   * A point at fraction u (0 node A .. 1 node B) along the sea part of link l (on a link to the
   * shore, from the waterline out to the sea cell), and the direction toward B, into tmp / dir.
   */
  function alongLink(l: number, u: number, dir: Float32Array, k: number) {
    const n = net!
    const pa = seaPiece(l, 0), pb = seaPiece(l, 1)
    // the piece, the position along it (0 its node .. 1 the meeting point), and whether it runs toward B
    let piece: number, f: number, sg: number
    if (pa >= 0 && pb >= 0) {
      piece = u < 0.5 ? pa : pb
      f = u < 0.5 ? u * 2 : (1 - u) * 2
      sg = u < 0.5 ? 1 : -1
    } else if (pa >= 0) {
      piece = pa
      f = u
      sg = 1
    } else {
      piece = pb
      f = 1 - u
      sg = -1
    }
    if (piece < 0) piece = n.linkPieces[n.linkPieceOffsets[l]]
    f *= HS - 1
    const s = Math.min(HS - 2, Math.floor(f))
    const t = f - s
    const i0 = piece * HS + s, i1 = i0 + 1
    const D = n.pieceDir
    const r = n.pieceRadius[i0] + (n.pieceRadius[i1] - n.pieceRadius[i0]) * t + MARK_LIFT
    tmp.set(D[i0 * 3] + (D[i1 * 3] - D[i0 * 3]) * t, D[i0 * 3 + 1] + (D[i1 * 3 + 1] - D[i0 * 3 + 1]) * t, D[i0 * 3 + 2] + (D[i1 * 3 + 2] - D[i0 * 3 + 2]) * t)
    tmp.normalize().multiplyScalar(r)
    // toward node B: along the A piece the samples run toward the meeting point, along the B piece away from it
    const dx = (D[i1 * 3] - D[i0 * 3]) * sg, dy = (D[i1 * 3 + 1] - D[i0 * 3 + 1]) * sg, dz = (D[i1 * 3 + 2] - D[i0 * 3 + 2]) * sg
    const len = Math.hypot(dx, dy, dz) || 1
    dir[k * 3] = dx / len
    dir[k * 3 + 1] = dy / len
    dir[k * 3 + 2] = dz / len
  }

  function writeShips(y: number, frac: number, on: boolean) {
    let n = 0
    if (on && net && pd.piracy && effect > 0.5) {
      const S = pd.snapshotCount
      const s0 = Math.max(0, Math.min(S - 1, Math.floor(y / pd.interval)))
      const s1 = Math.min(S - 1, s0 + 1)
      const tf = T ? Math.min(Math.max(y / T.interval, 0), TS - 1) - Math.floor(Math.min(Math.max(y / T.interval, 0), TS - 1)) : 0
      for (let j = 0; j < nH && n < MAX_SHIPS; j++) {
        const id = havens[j]
        const v = pd.piracy[s0 * N + id] / 255 * (1 - frac) + pd.piracy[s1 * N + id] / 255 * frac
        const cands = shipLinks[j]
        if (v <= 0.02 || cands.length === 0) continue
        let m = 0
        for (let q = 0; q < cands.length; q++) if (slotLoss0[cands[q]] > 0 || slotLoss1[cands[q]] > 0) m++
        if (m === 0) continue
        const ships = 1 + (v > 0.35 ? 1 : 0) + (v > 0.7 ? 1 : 0)
        for (let k = 0; k < ships && n < MAX_SHIPS; k++) {
          const period = 6 + 6 * hash01(id, k)
          const w = y / period + hash01(id, k + 101)
          const c = Math.floor(w)
          const u = w - c
          // now and then: not every pass
          if (hash01(id * 977 + k, c) > 0.62) continue
          let pick = Math.floor(hash01(id * 131 + k, c + 7) * m)
          let slot = -1
          for (let q = 0; q < cands.length; q++) {
            if (!(slotLoss0[cands[q]] > 0 || slotLoss1[cands[q]] > 0)) continue
            if (pick-- === 0) {
              slot = cands[q]
              break
            }
          }
          if (slot < 0) continue
          const loss = slotLoss0[slot] + (slotLoss1[slot] - slotLoss0[slot]) * tf
          const fwd = hash01(id + k, c + 3) < 0.5
          const i = S0 + n
          alongLink(slotLink[slot], fwd ? u : 1 - u, mDir, i)
          if (!fwd) {
            mDir[i * 3] = -mDir[i * 3]
            mDir[i * 3 + 1] = -mDir[i * 3 + 1]
            mDir[i * 3 + 2] = -mDir[i * 3 + 2]
          }
          mPos[i * 3] = tmp.x
          mPos[i * 3 + 1] = tmp.y
          mPos[i * 3 + 2] = tmp.z
          const op = Math.pow(Math.sin(Math.PI * u), 0.6) * Math.min(1, loss * 25) * (effect >= 1 ? 1 : 0.8)
          mA[i * 4 + 1] = 7 + 2 * v
          mA[i * 4 + 2] = mA[i * 4 + 3] = op
          mKnown[i] = knownOf(h.settlements[id].cell)
          n++
        }
      }
    }
    for (let k = n; k < nShips; k++) mA[(S0 + k) * 4 + 2] = mA[(S0 + k) * 4 + 3] = 0
    const hi = Math.max(n, nShips)
    nShips = n
    if (hi > 0) {
      upload(posAttr, S0, hi)
      upload(aAttr, S0, hi)
      upload(dirAttr, S0, hi)
      upload(knownAttr, S0, hi)
    }
  }

  function syncVisibility() {
    const lanesOn = (showLanes || danger) && nSlots > 0
    smuggleMesh.visible = lanesOn && !!SM
    lossMesh.visible = lanesOn && !!LO
    laneShared.uEmph.value = danger ? 1.45 : 1
    mu.uDanger.value = danger ? 1 : 0
    // the marks: havens, hubs, blockades with the Factions layer (and on the Danger view); ships with the lanes
    const marksOn = showMarks || danger
    const shipsOn = lanesOn
    geom.instanceCount = marksOn ? (shipsOn ? S0 + nShips : S0) : shipsOn ? S0 + nShips : 0
    marks.visible = geom.instanceCount > 0
    // (without the marks the havens' slots stay hidden: their strengths are zeroed while marks are off)
  }

  const api: OutlawLayer = {
    object,
    setShown(m: boolean, l: boolean, d: boolean) {
      if (m === showMarks && l === showLanes && d === danger) return
      showMarks = m
      showLanes = l
      danger = d
      shownS0 = shownS1 = -1
      shownYearInt = NaN
      shownShipYear = NaN
      syncVisibility()
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      mu.uMaskOn.value = cellYear ? 1 : 0
      for (let k = 0; k < B0; k++) mKnown[k] = knownOf(markCell[k])
      upload(knownAttr, 0, B0)
      shownYearInt = NaN
      shownShipYear = NaN
      requestRender()
    },
    setMasked(on: boolean) {
      marks.renderOrder = on ? 9.78 : 8.6
    },
    setTime(y: number, s0: number, s1: number, frac: number, effectAlpha: number) {
      effect = effectAlpha
      mu.uYear.value = y
      mu.uFrac.value = frac
      const lanesOn = (showLanes || danger) && nSlots > 0
      const marksOn = showMarks || danger
      if (!lanesOn && !marksOn) return
      if (T && lanesOn) {
        const x = Math.min(Math.max(y / T.interval, 0), TS - 1)
        const t0 = Math.floor(x), t1 = Math.min(t0 + 1, TS - 1)
        laneShared.uFrac.value = t1 === t0 ? 0 : x - t0
        if (t0 !== shownT0 || t1 !== shownT1) {
          shownT0 = t0
          shownT1 = t1
          writeLanes(t0, t1)
          shownShipYear = NaN
        }
      }
      if (s0 !== shownS0 || s1 !== shownS1) {
        shownS0 = s0
        shownS1 = s1
        if (marksOn) writeStrengths(s0, s1)
        else {
          // havens and hubs hidden: zero their strengths
          for (let k = 0; k < B0; k++) mA[k * 4 + 2] = mA[k * 4 + 3] = 0
          upload(aAttr, 0, B0)
        }
      }
      const yi = Math.floor(y)
      if (yi !== shownYearInt) {
        shownYearInt = yi
        if (marksOn) writeBlockades(y)
        else if (nBlock > 0) {
          for (let k = 0; k < nBlock; k++) mA[(B0 + k) * 4 + 2] = mA[(B0 + k) * 4 + 3] = 0
          upload(aAttr, B0, nBlock)
          nBlock = 0
        }
      }
      if (lanesOn && y !== shownShipYear) {
        shownShipYear = y
        writeShips(y, frac, true)
      } else if (!lanesOn && nShips > 0) writeShips(y, frac, false)
      syncVisibility()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (!smuggleMesh.visible && !lossMesh.visible && !marks.visible) return
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      mu.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      laneShared.uCamObj.value.copy(camObj)
      mu.uCamObj.value.copy(camObj)
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 42
      laneShared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, drawSize.y)
      laneShared.uPixelRatio.value = pixelRatio
      mu.uViewport.value.copy(drawSize)
      mu.uPixelRatio.value = pixelRatio
      const dist = camObj.length()
      const alt = dist - 1
      const smooth = (a: number, b: number) => {
        const t = Math.min(1, Math.max(0, (dist - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      // as the trade lines: they thin and fade among the 3D towns, and come down toward the ground
      laneShared.uClose.value = smooth(1.1, 1.35)
      laneShared.uDrop.value = LIFT * (1 - Math.min(1, Math.max(0.06, alt / 0.6)))
      mu.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / Math.max(1.05, dist))))
      mu.uNear.value = Math.min(1, Math.max(0.25, (alt - 0.012) / 0.05))
      // 1 close in (today's full look) .. 0 at the globe's or whole map's own zoom (fewer, smaller,
      // dimmer havens and lanterns); works unchanged on the flat map, whose camera distance in the
      // planet group's local space tapers the same way as the globe's (see uClose/uSizeScale above).
      mu.uHavenZoom.value = 1 - smooth(1.6, 3.2)
      if (laneShared.uClose.value <= 0.003) {
        smuggleMesh.visible = false
        lossMesh.visible = false
      }
    },
    dispose() {
      lanesGeom.dispose()
      geom.dispose()
      smuggleMat.dispose()
      lossMat.dispose()
      markMat.dispose()
      laneTex.dispose()
    },
  }
  return api
}
