// Settlement markers: one instanced screen-space marker per settlement, drawn in a
// single call. The shape follows the size tier of the interpolated population: a
// village is a dot, a town a rounded square, a city a bold bullseye (ring and core)
// with a soft glow, so tiers change during playback and revert when scrubbing back. Static per-instance data (position, founded/abandoned years, id) is
// uploaded once; population and food rows for the two snapshots bracketing the
// current year are copied in only when the snapshot index changes, and the shader
// interpolates between them. Everything else (liveness, founding pulse, selection
// ring, far-side culling, limb fade) is a function of per-frame uniforms, so the
// picture at a year never depends on how playback got there.

import * as THREE from 'three'
import { CITY_POPULATION, LandmarkKind, LandmarkRank, TOWN_POPULATION, type History, type World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefRadius, reliefUniforms } from './terrainHeight.ts'
import { flatActive, flatFacing, flatUniforms, placeFlat } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { MARKER_SLOT_GLSL } from './markerSlots.ts'
import { landmarkRuined, landmarksOf } from '../ui/landmarksData.ts'

/** Height of marker centres above the ground. */
const LIFT = 0.004
/** Marker radius range in CSS pixels (before zoom scaling). */
const MIN_RADIUS = 1.7
const MAX_RADIUS = 6.5
/** Smallest marker radius of a town and of a city (CSS pixels), so tiers read at any population scale. */
const TOWN_MIN_RADIUS = 4.6
const CITY_MIN_RADIUS = 7.0
const NEVER = 1e9
/** Camera distances (planet radii from the centre) over which a great landmark's glyph fades in: none at the globe's far view, all from mid zoom down (the 3D town then takes over, see setYield). */
const MARK_FAR = 2.3
const MARK_MID = 1.85

/**
 * Per settlement, its great landmark's glyph (4 floats: shown from year, until year, glyph, 0; glyph -1 none): a palace (1)
 * before a great temple (2 + its LandmarkForm) before a castle (0), the first finished of its kind; shown while it stands in
 * use or neglected, from its first year in use until it first falls into ruin (one span per town: a restored ruin is not shown again).
 */
function landmarkGlyphs(history: History, N: number): Float32Array {
  const out = new Float32Array(N * 4)
  for (let i = 0; i < N; i++) out[i * 4 + 2] = -1
  const d = landmarksOf(history)
  if (!d) return out
  const L = d.L
  const prio = (k: number) => (k === LandmarkKind.Palace ? 3 : k === LandmarkKind.GreatTemple ? 2 : k === LandmarkKind.Castle ? 1 : 0)
  const best = new Int32Array(N).fill(-1)
  for (let i = 0; i < L.count; i++) {
    const v = L.settlement[i]
    if (v < 0 || v >= N || L.rank[i] !== LandmarkRank.Great || prio(L.kind[i]) === 0 || L.completedYear[i] < 0) continue
    if (best[v] < 0 || prio(L.kind[i]) > prio(L.kind[best[v]])) best[v] = i
  }
  for (let v = 0; v < N; v++) {
    const i = best[v]
    if (i < 0) continue
    let from = NEVER, to = NEVER
    for (let o = d.spanOff[i]; o < d.spanOff[i + 1]; o++) {
      const st = d.spanState[o]
      if (!landmarkRuined(st) && st !== 0 && from === NEVER) from = d.spanFrom[o] // (0: building)
      if (landmarkRuined(st) && from !== NEVER) {
        to = d.spanFrom[o]
        break
      }
    }
    if (from === NEVER) continue
    out[v * 4] = from
    out[v * 4 + 1] = to
    out[v * 4 + 2] = L.kind[i] === LandmarkKind.Palace ? 1 : L.kind[i] === LandmarkKind.Castle ? 0 : 2 + Math.max(0, Math.min(7, L.form[i]))
  }
  return out
}

export const MarkerStyle = {
  /** Warm gold over the satellite view. */
  Terrain: 0,
  /** White over data views (the Population heat ramp is warm already). */
  Data: 1,
} as const

export interface SettlementLayer {
  mesh: THREE.Mesh
  /** Copy population/food rows of snapshots s0 and s1; call when the snapshot index changes. */
  setSnapshot(s0: number, s1: number): void
  /** Per frame: continuous year, interpolation fraction between s0 and s1, pulse length in years. */
  setTime(year: number, frac: number, pulseYears: number): void
  setSelected(id: number): void
  setHovered(id: number): void
  setStyle(style: number): void
  /** Per frame: camera/sun in object space and viewport size. */
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Nearest living, visible settlement within `slopPx` of the marker edge at CSS pixel (x, y), or -1. */
  pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number, slopPx: number): number
  /** Marker centre of settlement `id` in planet (object) space. */
  centerLocal(id: number, out: THREE.Vector3): THREE.Vector3
  /** Interpolated population at the current time (0 if not alive). */
  displayedPopulation(id: number): number
  /**
   * Within camera distance near..far the markers step back for the 3D models: bodies shrink
   * and fade (selection and hover rings stay); far <= 0 turns it off.
   */
  setYield(near: number, far: number): void
  /** Colour per settlement (sRGB 0..1, 3 per settlement: its people's), uploaded once; null clears. Shown while setTint(true). */
  setPeopleColors(rgb: Float32Array | null): void
  /** Fill markers with their people's colour instead of the gold/white of the view. */
  setTint(on: boolean): void
  /**
   * Known-world mask (uploaded once per selection): per settlement, the year from which it is
   * shown (`known`, before that it is hidden and not pickable) and the year from which it gets
   * a faint contact ring (`contact`); 1e9 for never. Null turns the mask off.
   */
  setPeopleMask(known: Float32Array | null, contact: Float32Array | null): void
  dispose(): void
}

/**
 * Marker area is proportional to population (radius ~ sqrt(pop / maxPopulation)), the
 * cartographic convention, between MIN_RADIUS and MAX_RADIUS CSS pixels.
 */
export function buildSettlementLayer(world: World, history: History, maxPopulation: number): SettlementLayer {
  const N = history.settlements.length
  const P = world.grid.positions

  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])

  const center = new Float32Array(N * 3)
  const life = new Float32Array(N * 2)
  /** Expedition bases have their own markers (outposts.ts): never drawn or picked here. */
  const outpost = new Uint8Array(N)
  const ids = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const s = history.settlements[i]
    const r = surfaceRadius(world, s.cell) + LIFT
    center[i * 3] = P[s.cell * 3] * r
    center[i * 3 + 1] = P[s.cell * 3 + 1] * r
    center[i * 3 + 2] = P[s.cell * 3 + 2] * r
    life[i * 2] = s.foundedYear
    life[i * 2 + 1] = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
    ids[i] = i
    outpost[i] = (s as { outpost?: boolean }).outpost === true ? 1 : 0
  }
  // the shader's copy of the life years: an expedition base is never alive
  const drawnLife = life.slice()
  for (let i = 0; i < N; i++) if (outpost[i]) drawnLife[i * 2] = NEVER
  const popA = new Float32Array(N)
  const popB = new Float32Array(N)
  const food = new Float32Array(N)
  const dyn = (arr: Float32Array) => new THREE.InstancedBufferAttribute(arr, 1).setUsage(THREE.DynamicDrawUsage)
  const popAAttr = dyn(popA)
  const popBAttr = dyn(popB)
  const foodAttr = dyn(food)
  quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3))
  quad.setAttribute('aLife', new THREE.InstancedBufferAttribute(drawnLife, 2))
  quad.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1))
  quad.setAttribute('aPopA', popAAttr)
  quad.setAttribute('aPopB', popBAttr)
  quad.setAttribute('aFood', foodAttr)
  // peoples: colour per settlement, and the known-world mask (shown from, contact ring from)
  const peopleCol = new Float32Array(N * 3)
  const mask = new Float32Array(N * 2)
  const peopleColAttr = new THREE.InstancedBufferAttribute(peopleCol, 3)
  const maskAttr = new THREE.InstancedBufferAttribute(mask, 2)
  quad.setAttribute('aPeople', peopleColAttr)
  quad.setAttribute('aMask', maskAttr)
  // great landmarks: a small glyph in the lower-right slot (markerSlots.ts) from mid zoom
  quad.setAttribute('aMark', new THREE.InstancedBufferAttribute(landmarkGlyphs(history, N), 4))
  let maskOn = false
  quad.instanceCount = N

  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uFrac: { value: 0 },
    uPulseYears: { value: 20 },
    uInvMaxPop: { value: 1 / Math.max(1, maxPopulation) },
    uSizeScale: { value: 1 },
    uPixelRatio: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSelected: { value: -1 },
    uHovered: { value: -1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uStyle: { value: 0 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uTint: { value: 0 },
    uMaskOn: { value: 0 },
    /** 0 at the globe's far view .. 1 from mid zoom: the landmark glyphs fade in (update). */
    uMarkShow: { value: 0 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      ${MARKER_SLOT_GLSL}
      attribute vec3 aCenter;
      attribute vec4 aMark; // great landmark glyph: from year, until year, glyph (-1 none, 0 castle, 1 palace, 2 + form a great temple)
      uniform float uMarkShow;
      varying float vGlyph;
      varying vec2 vGlyphC;
      varying float vGlyphR;
      varying float vGlyphA;
      attribute vec2 aLife;
      attribute float aId;
      attribute float aPopA;
      attribute float aPopB;
      attribute float aFood;
      attribute vec3 aPeople;
      attribute vec2 aMask; // known-world mask: shown from year x, contact ring from year y
      uniform float uMaskOn;
      varying vec3 vPeople;
      varying float vContact;
      uniform float uYear;
      uniform float uFrac;
      uniform float uPulseYears;
      uniform float uInvMaxPop;
      uniform float uSizeScale;
      uniform float uPixelRatio;
      uniform vec2 uViewport;
      uniform float uSelected;
      uniform float uHovered;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight; // 1: daylight everywhere (sun.ts)
      uniform vec2 uYield;
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying float vYield;
      varying float vHov;
      varying float vPulse;
      varying float vAlpha;
      varying float vFood;
      varying float vNight;
      varying float vTier;
      void main() {
        vec3 aCenterR = ws_relief(aCenter); // the ground at the zoom's relief (terrainHeight.ts)
        bool alive = uYear >= aLife.x && uYear < aLife.y;
        if (uMaskOn > 0.5 && uYear < aMask.x) alive = false; // unknown to the people whose world is shown
        vPeople = aPeople;
        vContact = uMaskOn > 0.5 && uYear >= aMask.y ? 1.0 : 0.0;
        vec3 up = normalize(aCenterR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aCenterR)));
        if (!alive || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
          return;
        }
        float pop = mix(aPopA, aPopB, uFrac);
        float t = sqrt(clamp(pop * uInvMaxPop, 0.0, 1.0));
        float age = uYear - aLife.x;
        float grow = mix(0.4, 1.0, smoothstep(0.0, uPulseYears * 0.6, age));
        vTier = pop >= ${CITY_POPULATION.toFixed(1)} ? 2.0 : pop >= ${TOWN_POPULATION.toFixed(1)} ? 1.0 : 0.0;
        float r0 = ${MIN_RADIUS.toFixed(2)} + ${(MAX_RADIUS - MIN_RADIUS).toFixed(2)} * t;
        if (vTier > 1.5) r0 = max(r0, ${CITY_MIN_RADIUS.toFixed(2)});
        else if (vTier > 0.5) r0 = max(r0, ${TOWN_MIN_RADIUS.toFixed(2)});
        // foreshortened toward the limb, like the ground they sit on
        float r = r0 * uSizeScale * grow * mix(0.55, 1.0, sqrt(facing));
        // up close the buildings take over: 1 = marker fully yielded
        vYield = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - aCenterR)) : 0.0;
        r *= mix(1.0, 0.55, vYield);
        vSel = abs(aId - uSelected) < 0.5 ? 1.0 : 0.0;
        vHov = abs(aId - uHovered) < 0.5 ? 1.0 : 0.0;
        vPulse = age < uPulseYears ? age / uPulseYears : -1.0;
        float ext = r + 2.0;
        if (vSel > 0.5 || vHov > 0.5) ext = r + 8.0;
        else if (vContact > 0.5) ext = r + 4.5;
        if (vPulse >= 0.0) ext = max(ext, r + 20.0);
        if (vTier > 1.5) ext = max(ext, r + 7.0); // glow
        // a great landmark: its glyph in the lower-right slot, from mid zoom until the 3D town takes over
        vGlyph = -1.0;
        vGlyphC = vec2(0.0);
        vGlyphR = 1.0;
        vGlyphA = uMarkShow * (1.0 - vYield);
        if (aMark.z > -0.5 && vTier > 0.5 && vGlyphA > 0.01 && uYear >= aMark.x && uYear < aMark.y) {
          vGlyph = aMark.z;
          vGlyphR = 5.0 * uSizeScale;
          vGlyphC = ws_slotAt(WS_SLOT_LOWER_RIGHT, r, vGlyphR, uSizeScale);
          ext = max(ext, length(vGlyphC) + vGlyphR * 1.45 + 1.5);
        }
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(aCenterR), 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vFood = aFood;
        vAlpha = smoothstep(0.0, 0.3, facing);
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform int uStyle;
      uniform float uTint;
      varying vec3 vPeople;
      varying float vContact;
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying float vHov;
      varying float vPulse;
      varying float vAlpha;
      varying float vFood;
      varying float vNight;
      varying float vTier;
      varying float vYield;
      varying float vGlyph;
      varying vec2 vGlyphC;
      varying float vGlyphR;
      varying float vGlyphA;
      float sdBox(vec2 p, vec2 c, vec2 b) { vec2 q = abs(p - c) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
      /** An upright triangle: apex at (x, top), base at y = base with half width w (sign exact, distance near enough at glyph size). */
      float sdTri(vec2 p, float x, float base, float top, float w) {
        vec2 q = vec2(abs(p.x - x), p.y - base);
        vec2 n = normalize(vec2(top - base, w));
        return max(-q.y, dot(q - vec2(0.0, top - base), n));
      }
      /** Silhouette of a great landmark glyph in unit coordinates (y up, about -1..1): castle, palace, or a great temple by its form. */
      float landmarkD(float g, vec2 p) {
        if (g < 0.5) { // castle: a keep with three merlons
          float d = sdBox(p, vec2(0.0, -0.25), vec2(0.6, 0.55));
          for (int k = -1; k <= 1; k++) d = min(d, sdBox(p, vec2(float(k) * 0.44, 0.46), vec2(0.16, 0.18)));
          return max(d, -sdBox(p, vec2(0.0, -0.62), vec2(0.15, 0.2))); // the gate
        }
        if (g < 1.5) { // palace: a broad hall under a crown-like roof of three points
          float d = sdBox(p, vec2(0.0, -0.48), vec2(0.8, 0.32));
          d = min(d, sdBox(p, vec2(0.0, -0.08), vec2(0.66, 0.1)));
          d = min(d, sdTri(p, 0.0, -0.05, 0.85, 0.3));
          d = min(d, sdTri(p, -0.5, -0.05, 0.5, 0.22));
          return min(d, sdTri(p, 0.5, -0.05, 0.5, 0.22));
        }
        float f = g - 2.0;
        if (f < 0.5) { // steepled: a nave and a tower with its spire
          float d = sdBox(p, vec2(0.25, -0.5), vec2(0.5, 0.3));
          d = min(d, sdBox(p, vec2(-0.35, -0.3), vec2(0.22, 0.5)));
          return min(d, sdTri(p, -0.35, 0.18, 0.95, 0.24));
        }
        if (f < 1.5) { // domed: a dome on a hall between two minarets
          float d = sdBox(p, vec2(0.0, -0.58), vec2(0.6, 0.22));
          d = min(d, max(length(p - vec2(0.0, -0.36)) - 0.48, -(p.y + 0.36)));
          d = min(d, sdBox(p, vec2(-0.74, -0.2), vec2(0.08, 0.6)));
          return min(d, sdBox(p, vec2(0.74, -0.2), vec2(0.08, 0.6)));
        }
        if (f < 2.5) { // ziggurat: three steps and a shrine
          float d = sdBox(p, vec2(0.0, -0.66), vec2(0.82, 0.14));
          d = min(d, sdBox(p, vec2(0.0, -0.38), vec2(0.58, 0.14)));
          d = min(d, sdBox(p, vec2(0.0, -0.1), vec2(0.34, 0.14)));
          return min(d, sdBox(p, vec2(0.0, 0.16), vec2(0.14, 0.12)));
        }
        if (f < 3.5) { // columned: a pediment on columns on a stepped base
          float d = sdBox(p, vec2(0.0, -0.72), vec2(0.8, 0.08));
          for (int k = -1; k <= 1; k++) d = min(d, sdBox(p, vec2(float(k) * 0.46, -0.34), vec2(0.1, 0.32)));
          d = min(d, sdBox(p, vec2(0.0, 0.04), vec2(0.72, 0.07)));
          return min(d, sdTri(p, 0.0, 0.1, 0.55, 0.78));
        }
        if (f < 4.5) { // pagoda: tiers of flared roofs round a core
          float d = sdBox(p, vec2(0.0, -0.3), vec2(0.26, 0.5));
          d = min(d, sdBox(p, vec2(0.0, -0.45), vec2(0.78, 0.07)));
          d = min(d, sdBox(p, vec2(0.0, -0.05), vec2(0.62, 0.07)));
          d = min(d, sdBox(p, vec2(0.0, 0.33), vec2(0.46, 0.07)));
          return min(d, sdBox(p, vec2(0.0, 0.62), vec2(0.05, 0.24)));
        }
        if (f < 5.5) { // stave: stacked steep roofs
          float d = sdTri(p, 0.0, -0.8, 0.25, 0.78);
          return min(d, sdTri(p, 0.0, -0.15, 0.95, 0.46));
        }
        if (f < 6.5) { // stupa: a mound with a spire
          float d = sdBox(p, vec2(0.0, -0.78), vec2(0.8, 0.07));
          d = min(d, max(length(p - vec2(0.0, -0.72)) - 0.62, -(p.y + 0.72)));
          return min(d, sdTri(p, 0.0, -0.12, 0.92, 0.16));
        }
        // circle: standing stones under lintels
        float d = sdBox(p, vec2(-0.62, -0.3), vec2(0.13, 0.42));
        d = min(d, sdBox(p, vec2(0.0, -0.3), vec2(0.13, 0.42)));
        d = min(d, sdBox(p, vec2(0.62, -0.3), vec2(0.13, 0.42)));
        return min(d, sdBox(p, vec2(0.0, 0.2), vec2(0.78, 0.08)));
      }
      void main() {
        float d = length(vPx);
        vec3 fed = uStyle == 0 ? vec3(1.0, 0.74, 0.30) : vec3(0.97, 0.98, 1.0);
        vec3 hungry = uStyle == 0 ? vec3(0.96, 0.38, 0.20) : vec3(0.62, 0.86, 1.0);
        if (uTint > 0.5) {
          // by people: its colour, darker when hungry
          fed = vPeople;
          hungry = vPeople * 0.55;
        }
        vec3 fill = mix(hungry, fed, smoothstep(0.45, 0.9, vFood));
        vec3 rim = vHov > 0.5 ? vec3(1.0) : (uStyle == 0 ? vec3(0.22, 0.09, 0.02) : vec3(0.04, 0.04, 0.07));
        // body shape by tier: distance to its outline (negative inside)
        float sd = d - vR;
        if (vTier > 0.5 && vTier < 1.5) {
          float hs = vR * 0.86;
          float cr = hs * 0.28;
          vec2 q = abs(vPx) - vec2(hs - cr);
          sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cr;
        }
        float inner = 1.0 - smoothstep(-1.1, -0.1, sd);
        if (vTier > 1.5) {
          // bullseye: dark rim, bright ring, dark gap, bright core
          float gap = (1.0 - smoothstep(-2.9, -2.4, sd)) * smoothstep(-4.3, -3.8, sd);
          inner *= 1.0 - gap;
        }
        // on the night side markers step back so the city lights carry the picture
        float night = uStyle == 0 ? vNight : 0.0; // data views are lit from the viewer
        float bodyA = (1.0 - smoothstep(0.3, 1.3, sd)) * mix(1.0, max(0.28, max(vSel, vHov)), night) * (1.0 - 0.85 * vYield);
        vec3 bodyC = mix(rim, fill * (1.1 - 0.25 * d / max(vR, 1.0)), inner);

        float ringA = max(vSel, vHov * 0.45) * (1.0 - smoothstep(0.55, 1.45, abs(d - (vR + 4.5))));
        // a faint thin ring in its people's colour: a people in contact with the one whose world is shown
        float contactA = vContact * (1.0 - max(vSel, vHov)) * 0.42 * (1.0 - smoothstep(0.3, 1.0, abs(d - (vR + 2.6)))) * (1.0 - 0.85 * vYield) * mix(1.0, 0.35, night);
        float pulseA = 0.0;
        if (vPulse >= 0.0) {
          float pr = vR + 1.5 + 16.0 * vPulse;
          pulseA = (1.0 - smoothstep(0.5, 1.8, abs(d - pr))) * pow(1.0 - vPulse, 1.5) * 0.85;
        }
        // premultiplied "over": body over selection ring over founding pulse (over a city's glow)
        float glowA = vTier > 1.5 ? exp(-max(sd, 0.0) * 0.4) * 0.38 * (1.0 - 0.6 * night) * (1.0 - vYield) : 0.0;
        vec3 c = fed * glowA;
        float a = glowA;
        c = fed * pulseA + c * (1.0 - pulseA);
        a = pulseA + a * (1.0 - pulseA);
        c = vec3(1.0) * ringA + c * (1.0 - ringA);
        a = ringA + a * (1.0 - ringA);
        c = vPeople * contactA + c * (1.0 - contactA);
        a = contactA + a * (1.0 - contactA);
        c = bodyC * bodyA + c * (1.0 - bodyA);
        a = bodyA + a * (1.0 - bodyA);
        if (vGlyph > -0.5) {
          // the great landmark's glyph over everything: a light silhouette with a dark outline (a palace faintly gilded: the gold crown left of a marker is an old capital, tourism.ts)
          float u = vGlyphR;
          float gd = landmarkD(vGlyph, (vPx - vGlyphC) / u) * u;
          float gFill = 1.0 - smoothstep(-0.55, 0.45, gd);
          float gA = (1.0 - smoothstep(0.45, 1.5, gd)) * vGlyphA * mix(1.0, 0.6, uStyle == 0 ? vNight : 0.0);
          vec3 light = vGlyph > 0.5 && vGlyph < 1.5 ? vec3(1.0, 0.94, 0.76) : vec3(0.97, 0.95, 0.88);
          vec3 gC = mix(vec3(0.07, 0.05, 0.04), light, gFill);
          c = gC * gA + c * (1.0 - gA);
          a = gA + a * (1.0 - gA);
        }
        c *= vAlpha;
        a *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })

  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 8 // after rivers and clouds, before the atmosphere haze

  let year = 0
  let frac = 0
  let pulseYears = 20
  const tmpQ = new THREE.Quaternion()
  const tmpV = new THREE.Vector3()
  const camLocal = new THREE.Vector3()
  const mvp = new THREE.Matrix4()

  const radiusOf = (id: number): number => {
    const s = history.settlements[id]
    const pop = popA[id] + (popB[id] - popA[id]) * frac
    const t = Math.sqrt(Math.min(1, Math.max(0, pop * uniforms.uInvMaxPop.value)))
    const age = year - s.foundedYear
    const e = Math.min(1, Math.max(0, age / (pulseYears * 0.6)))
    const grow = 0.4 + 0.6 * e * e * (3 - 2 * e)
    let r0 = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * t
    if (pop >= CITY_POPULATION) r0 = Math.max(r0, CITY_MIN_RADIUS)
    else if (pop >= TOWN_POPULATION) r0 = Math.max(r0, TOWN_MIN_RADIUS)
    return r0 * uniforms.uSizeScale.value * grow
  }
  const aliveAt = (id: number) => year >= life[id * 2] && year < life[id * 2 + 1]
  /** Alive and not hidden by the known-world mask (what is drawn and pickable). */
  const shownAt = (id: number) => aliveAt(id) && !outpost[id] && !(maskOn && year < mask[id * 2])

  return {
    mesh,
    setSnapshot(s0: number, s1: number) {
      const pop = history.population
      const fd = history.food
      const b0 = s0 * N, b1 = s1 * N
      for (let i = 0; i < N; i++) {
        const a = pop[b0 + i]
        popA[i] = a
        popB[i] = pop[b1 + i]
        food[i] = a > 0 ? fd[b0 + i] : fd[b1 + i]
      }
      popAAttr.needsUpdate = true
      popBAttr.needsUpdate = true
      foodAttr.needsUpdate = true
    },
    setTime(y: number, f: number, pulse: number) {
      year = y
      frac = f
      pulseYears = pulse
      uniforms.uYear.value = y
      uniforms.uFrac.value = f
      uniforms.uPulseYears.value = pulse
    },
    setSelected(id: number) {
      uniforms.uSelected.value = id
    },
    setHovered(id: number) {
      uniforms.uHovered.value = id
    },
    setStyle(style: number) {
      uniforms.uStyle.value = style
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(uniforms.uCamObj.value)
      mesh.worldToLocal(uniforms.uCamObj.value)
      uniforms.uViewport.value.copy(drawSize)
      uniforms.uPixelRatio.value = pixelRatio
      const dist = camera.position.length()
      uniforms.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / dist)))
      const m = Math.min(1, Math.max(0, (MARK_FAR - dist) / (MARK_FAR - MARK_MID)))
      uniforms.uMarkShow.value = m * m * (3 - 2 * m)
    },
    pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number, slopPx: number) {
      mesh.updateWorldMatrix(true, false)
      mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld)
      camera.getWorldPosition(camLocal)
      mesh.worldToLocal(camLocal)
      let best = -1
      let bestScore = Infinity
      for (let id = 0; id < N; id++) {
        if (!shownAt(id)) continue
        const cx = center[id * 3], cy = center[id * 3 + 1], cz = center[id * 3 + 2]
        // visible hemisphere: (camera - c) . c > 0 (on the flat map, everything)
        if (!flatActive() && (camLocal.x - cx) * cx + (camLocal.y - cy) * cy + (camLocal.z - cz) * cz <= 0) continue
        const cl = Math.hypot(cx, cy, cz)
        const dx = camLocal.x - cx, dy = camLocal.y - cy, dz = camLocal.z - cz
        const facing = flatFacing((dx * cx + dy * cy + dz * cz) / (cl * Math.hypot(dx, dy, dz)))
        if (facing <= 0) continue
        placeFlat(tmpV.set(cx, cy, cz).multiplyScalar(reliefRadius(cl) / cl)).applyMatrix4(mvp) // as drawn (ws_relief, ws_place)
        const sx = ((tmpV.x + 1) / 2) * width
        const sy = ((1 - tmpV.y) / 2) * height
        const d = Math.hypot(sx - x, sy - y)
        const r = radiusOf(id) * (0.55 + 0.45 * Math.sqrt(facing))
        const score = d - r
        if (score <= slopPx && score < bestScore) {
          bestScore = score
          best = id
        }
      }
      return best
    },
    centerLocal(id: number, out: THREE.Vector3) {
      return out.set(center[id * 3], center[id * 3 + 1], center[id * 3 + 2])
    },
    displayedPopulation(id: number) {
      if (!aliveAt(id)) return 0
      return popA[id] + (popB[id] - popA[id]) * frac
    },
    setYield(near: number, far: number) {
      uniforms.uYield.value.set(near, far)
    },
    setPeopleColors(rgb: Float32Array | null) {
      if (rgb && rgb.length >= N * 3) peopleCol.set(rgb.subarray(0, N * 3))
      else peopleCol.fill(0)
      peopleColAttr.needsUpdate = true
    },
    setTint(on: boolean) {
      uniforms.uTint.value = on ? 1 : 0
    },
    setPeopleMask(known: Float32Array | null, contact: Float32Array | null) {
      maskOn = known !== null
      uniforms.uMaskOn.value = maskOn ? 1 : 0
      if (!known) return
      for (let i = 0; i < N; i++) {
        mask[i * 2] = known[i] ?? NEVER
        mask[i * 2 + 1] = contact ? contact[i] ?? NEVER : NEVER
      }
      maskAttr.needsUpdate = true
    },
    dispose() {
      quad.dispose()
      material.dispose()
    },
  }
}
