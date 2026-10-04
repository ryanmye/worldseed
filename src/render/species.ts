// Species on the globe (ui/speciesData.ts has the data):
//
//  - Origins: a small ringed dot in the species' colour at each place it is native to,
//    shown for the selected species, and for every species of the category the Crops or
//    Herds view shows.
//  - The exchange web: for the selected species, a faint arc from the giving people's
//    place to the taking people's for each adoption up to the current year, brighter
//    toward the taker and for a while after it happened.
//  - Where it is grown now: for the selected species, a soft disc on every cell whose main
//    crop (or herd, or cash crop) it is at the current land snapshot (on the views that do
//    not already colour the cells by species). The per-cell flags are uploaded when the land
//    snapshot or the selection changes.
//  - Techniques: for the selected technique, a ringed dot where it was first worked out and
//    its arcs between peoples, like a species.
//  - Habits: for a selected stimulant, each people's land tinted by how habituated it is to
//    it (History.habit, interpolated between snapshots through uniforms; the per-cell owner
//    is uploaded when the land snapshot changes while a stimulant is selected), in a
//    warning tone for harmful ones.
//  - Blight and plague: a brief browning of the stricken people's fields (greying of their
//    pastures for a plague), spreading out from where it struck first; its length follows
//    the playback speed like the other pulses.
//
// Origins and arcs are static per history (arcs per selection), and the year is a uniform:
// what is shown is a function of the year and the selection. A known-world mask hides what
// lies in cells the people whose world is shown did not know.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { cellPeopleAt, CASH_VIEW, type SpeciesData } from '../ui/speciesData.ts'

const NEVER = 1e9
const ARC_SEGMENTS = 40
const ARC_RECENT_YEARS = 60
/** A brief warm emphasis on an adoption right after it happens (shorter than ARC_RECENT_YEARS, which only governs overall fade-in). */
const ARC_EMPHASIS_YEARS = 20
/** Most peoples the habit tint can show (uniform array size). */
const HABIT_MAX_PEOPLES = 64
/** Blight and plague pulses last this many times the playback's pulse length. */
const HAZARD_PULSE_SCALE = 1.4

export interface SpeciesLayer {
  object: THREE.Group
  /** The species shown (-1 none): its origins, its exchange arcs, where it is grown; a stimulant also tints each people's land by its habit. */
  setSelected(species: number): void
  /** The technique shown (-1 none): where it was first worked out and its arcs (replaces a selected species' arcs). */
  setTechnique(technique: number): void
  /** Origins of every species of this view category (-1: none; 0 Crops, 1 Herds, CASH_VIEW Cash crops) are shown too. */
  setOriginCategory(category: number): void
  /** Cells growing the selected species now (1 per cell, length cellCount), or null to hide the discs. */
  setGrown(flags: Uint8Array | null): void
  /** The year, and the playback's pulse length in years (for blight and plague). */
  setTime(year: number, pulseYears?: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setOrder(order: number): void
  dispose(): void
}

const blend = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const

/** `h` and `people` (people per settlement) give the habit tint its peoples' land; without them there is none. */
export function buildSpeciesLayer(world: World, d: SpeciesData, h: History | null = null, people: ArrayLike<number> | null = null): SpeciesLayer {
  const P3 = world.grid.positions
  const N = world.grid.cellCount
  const object = new THREE.Group()
  const shared = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uMaskOn: { value: 0 },
    uSelected: { value: -1 },
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
  }
  let mask: Float32Array | null = null

  // ---------- origins ----------
  const oCells: number[] = [], oSpecies: number[] = []
  d.list.forEach((x, s) => {
    for (const c of x.origins ?? []) if (c >= 0 && c < N) { oCells.push(c); oSpecies.push(s) }
  })
  // techniques: where each was first worked out (selection id count + k, no category)
  const TECH_COLOR = [1.0, 0.86, 0.5] as const
  for (let k = 0; k < d.techniques.length; k++) {
    const c = d.techFirstCell[k]
    if (c >= 0 && c < N) { oCells.push(c); oSpecies.push(d.count + k) }
  }
  const no = oCells.length
  const oQuad = new THREE.InstancedBufferGeometry()
  oQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  oQuad.setIndex([0, 1, 2, 0, 2, 3])
  const oPos = new Float32Array(Math.max(1, no) * 3)
  const oInfo = new Float32Array(Math.max(1, no) * 2) // species, category
  const oCol = new Float32Array(Math.max(1, no) * 3)
  const oKnown = new Float32Array(Math.max(1, no))
  for (let k = 0; k < no; k++) {
    const c = oCells[k], s = oSpecies[k]
    const r = surfaceRadius(world, c) + 0.0045
    oPos.set([P3[c * 3] * r, P3[c * 3 + 1] * r, P3[c * 3 + 2] * r], k * 3)
    oInfo[k * 2] = s
    oInfo[k * 2 + 1] = s < d.count ? d.list[s].category : -5
    if (s < d.count) oCol.set(d.rgb.subarray(s * 3, s * 3 + 3), k * 3)
    else oCol.set(TECH_COLOR, k * 3)
  }
  const oKnownAttr = new THREE.InstancedBufferAttribute(oKnown, 1)
  oQuad.setAttribute('aPos', new THREE.InstancedBufferAttribute(oPos, 3))
  oQuad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(oInfo, 2))
  oQuad.setAttribute('aCol', new THREE.InstancedBufferAttribute(oCol, 3))
  oQuad.setAttribute('aKnown', oKnownAttr)
  oQuad.instanceCount = no
  const oUniforms = {
    ...shared,
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCategory: { value: -1 },
    uSizeScale: { value: 1 },
  }
  const originMaterial = new THREE.ShaderMaterial({
    uniforms: oUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec2 aInfo;
      attribute vec3 aCol;
      attribute float aKnown;
      uniform vec3 uCamObj;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform float uSelected;
      uniform float uCategory;
      uniform float uSizeScale;
      uniform float uMaskOn;
      uniform float uYear;
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        vSel = abs(aInfo.x - uSelected) < 0.5 ? 1.0 : 0.0;
        bool shown = vSel > 0.5 || abs(aInfo.y - uCategory) < 0.5 || (uCategory > ${(CASH_VIEW - 0.5).toFixed(1)} && aInfo.y > 1.5 && aInfo.y < 4.5);
        if (uMaskOn > 0.5 && uYear < aKnown) shown = false;
        vec3 up = normalize(aPosR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float r = (vSel > 0.5 ? 6.5 : 4.6) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r + 6.0;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(aPosR), 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vCol = aCol;
        vAlpha = smoothstep(0.0, 0.3, facing);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        float d = length(vPx);
        vec3 rim = vec3(0.05, 0.05, 0.06);
        // a ring and a core in the species' colour, on a dark halo
        float halo = (1.0 - smoothstep(vR + 0.8, vR + 2.2, d)) * 0.75;
        float ring = 1.0 - smoothstep(0.6, 1.5, abs(d - vR * 0.78));
        float core = 1.0 - smoothstep(vR * 0.32, vR * 0.32 + 1.0, d);
        vec3 c = rim * halo;
        float a = halo;
        c = vCol * ring + c * (1.0 - ring);
        a = ring + a * (1.0 - ring);
        c = vCol * core + c * (1.0 - core);
        a = core + a * (1.0 - core);
        float sr = vSel * (1.0 - smoothstep(0.5, 1.4, abs(d - vR - 3.0)));
        c = vec3(1.0) * sr + c * (1.0 - sr);
        a = sr + a * (1.0 - sr);
        c *= vAlpha;
        a *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    ...blend,
  })
  const origins = new THREE.Mesh(oQuad, originMaterial)
  origins.frustumCulled = false
  origins.renderOrder = 8.45
  origins.visible = no > 0
  object.add(origins)

  // ---------- exchange arcs (rebuilt per selection) ----------
  // a thin ribbon (pixel-space width, like the trade and journey layers) with a soft dark
  // rim, paling and flaring into an arrowhead toward the taker, and a brief warm emphasis
  // right after the adoption.
  const arcUniforms = { ...shared, uColor: { value: new THREE.Vector3(1, 1, 1) } }
  const arcMaterial = new THREE.ShaderMaterial({
    uniforms: arcUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec4 aSide; // side direction, across (-1|1)
      attribute vec4 aArc; // along (0..1), year, known year (both ends), lift above the ground
      uniform float uYear;
      uniform vec3 uCamObj;
      uniform float uMaskOn;
      uniform float uPixel;
      uniform float uPixelRatio;
      varying float vAcross;
      varying float vCore;
      varying float vSoft;
      varying float vA;
      varying float vT;
      varying float vEmphasis;
      void main() {
        // the ground at the zoom's relief (terrainHeight.ts), and the arch over it at its full height
        // (the relief scale would flatten it at globe zoom)
        vec3 positionR = ws_relief(position) + normalize(position) * aArc.w;
        bool shown = uYear >= aArc.y;
        if (uMaskOn > 0.5 && uYear < aArc.z) shown = false;
        vec3 up = normalize(positionR);
        float facing = ws_facing(dot(up, normalize(uCamObj - positionR)) + 0.25); // lifted arcs show a little past the limb
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float recent = 1.0 - smoothstep(0.0, ${ARC_RECENT_YEARS.toFixed(1)}, uYear - aArc.y);
        float emphasis = 1.0 - smoothstep(0.0, ${ARC_EMPHASIS_YEARS.toFixed(1)}, uYear - aArc.y);
        vEmphasis = emphasis;
        vT = aArc.x;
        vA = mix(0.78, 1.0, recent) * smoothstep(0.0, 0.3, facing) * mix(0.65, 1.0, aArc.x);
        // a steady ribbon that widens into a flare and tapers to a point just before the taker's end
        float widen = smoothstep(0.80, 0.92, aArc.x);
        float narrow = smoothstep(0.92, 1.0, aArc.x);
        float arrow = mix(1.0, mix(2.6, 0.0, narrow), widen);
        float core = 1.05 * arrow + 0.6 * emphasis;
        vec4 mv = modelViewMatrix * vec4(ws_place(positionR), 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float outer = core + 0.7;
        vCore = core / outer;
        vSoft = 0.85 / outer;
        vAcross = aSide.w;
        vec3 p = positionR + aSide.xyz * aSide.w * outer * pix;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAcross;
      varying float vCore;
      varying float vSoft;
      varying float vA;
      varying float vT;
      varying float vEmphasis;
      ${SEAM_FRAG_GLSL}
      void main() {
        ws_clipLine();
        float x = abs(vAcross);
        float core = 1.0 - smoothstep(vCore - vSoft, vCore, x);
        float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
        // the species' colour at the core, paling toward the taker, a soft dark rim at the edge,
        // and a brief warm glow on a just-happened adoption
        vec3 fill = mix(uColor, vec3(1.0), 0.12 + 0.38 * vT);
        fill = mix(fill, vec3(1.0, 0.95, 0.72), 0.55 * vEmphasis);
        vec3 rim = vec3(0.04, 0.03, 0.02);
        vec3 col = mix(rim, fill, core);
        float a = min(1.0, body * mix(0.6, 1.0, core) * vA * mix(1.0, 1.25, vEmphasis));
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
      }
    `,
    ...blend,
  })
  let arcGeom = new THREE.BufferGeometry()
  const arcs = new THREE.Mesh(arcGeom, arcMaterial)
  arcs.frustumCulled = false
  arcs.renderOrder = 8.1
  arcs.visible = false
  object.add(arcs)
  let selected = -1
  let technique = -1

  function buildArcs() {
    arcGeom.dispose()
    arcGeom = new THREE.BufferGeometry()
    arcs.geometry = arcGeom
    arcs.visible = false
    if (selected < 0 && technique < 0) return
    // a technique's arcs when one is selected, else the species'
    const ofTech = technique >= 0
    const want = ofTech ? technique : selected
    const arcId = ofTech ? d.techArc : d.arcSpecies
    const arcFrom = ofTech ? d.techArcFrom : d.arcFrom
    const arcTo = ofTech ? d.techArcTo : d.arcTo
    const arcYear = ofTech ? d.techArcYear : d.arcYear
    const pos: number[] = [], side: number[] = [], info: number[] = []
    const idx: number[] = []
    const a = new THREE.Vector3(), b = new THREE.Vector3(), tang = new THREE.Vector3(), sideV = new THREE.Vector3()
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= ARC_SEGMENTS; i++) pts.push(new THREE.Vector3())
    let vBase = 0
    for (let k = 0; k < arcId.length; k++) {
      if (arcId[k] !== want) continue
      const ca = arcFrom[k], cb = arcTo[k]
      if (ca === cb) continue
      a.set(P3[ca * 3], P3[ca * 3 + 1], P3[ca * 3 + 2])
      b.set(P3[cb * 3], P3[cb * 3 + 1], P3[cb * 3 + 2])
      const ang = a.angleTo(b)
      const lift = 0.014 + 0.15 * ang // even a hop between neighbours stands up as an arch
      const known = mask ? Math.max(mask[ca] ?? NEVER, mask[cb] ?? NEVER) : 0
      const at = (t: number, out: THREE.Vector3) => {
        // slerp, raised in a parabola over the ground
        const s = Math.sin(ang)
        out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s)
        return out.multiplyScalar(1.004 + lift * 4 * t * (1 - t))
      }
      // the arch's height over the ground (the shader adds it after the relief scale)
      const archAt = (t: number) => lift * 4 * t * (1 - t)
      for (let i = 0; i <= ARC_SEGMENTS; i++) at(i / ARC_SEGMENTS, pts[i])
      for (let i = 0; i <= ARC_SEGMENTS; i++) {
        const t = i / ARC_SEGMENTS
        const pA = pts[Math.max(0, i - 1)], pB = pts[Math.min(ARC_SEGMENTS, i + 1)]
        tang.copy(pB).sub(pA)
        sideV.crossVectors(pts[i], tang).normalize()
        // the vertex on the ground (radius 1.004), its arch in aArc.w
        const g = 1.004 / pts[i].length()
        for (const across of [-1, 1]) {
          pos.push(pts[i].x * g, pts[i].y * g, pts[i].z * g)
          side.push(sideV.x, sideV.y, sideV.z, across)
          info.push(t, arcYear[k], known, archAt(t))
        }
        if (i > 0) {
          const v = vBase + i * 2
          idx.push(v - 2, v, v - 1, v - 1, v, v + 1)
        }
      }
      vBase += (ARC_SEGMENTS + 1) * 2
    }
    if (!pos.length) return
    arcGeom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3))
    arcGeom.setAttribute('aSide', new THREE.BufferAttribute(Float32Array.from(side), 4))
    arcGeom.setAttribute('aArc', new THREE.BufferAttribute(Float32Array.from(info), 4))
    arcGeom.setIndex(idx)
    arcs.visible = true
    if (ofTech) arcUniforms.uColor.value.set(TECH_COLOR[0], TECH_COLOR[1], TECH_COLOR[2])
    else arcUniforms.uColor.value.set(d.rgb[selected * 3], d.rgb[selected * 3 + 1], d.rgb[selected * 3 + 2])
  }

  // ---------- where it is grown (discs on land cells) ----------
  const landCells: number[] = []
  for (let c = 0; c < N; c++) if (world.elevation[c] >= 0) landCells.push(c)
  const nl = landCells.length
  const gQuad = new THREE.InstancedBufferGeometry()
  gQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  gQuad.setIndex([0, 1, 2, 0, 2, 3])
  const gPos = new Float32Array(Math.max(1, nl) * 3)
  for (let k = 0; k < nl; k++) {
    const c = landCells[k]
    const r = surfaceRadius(world, c) + 0.0025
    gPos.set([P3[c * 3] * r, P3[c * 3 + 1] * r, P3[c * 3 + 2] * r], k * 3)
  }
  const gOn = new Float32Array(Math.max(1, nl))
  const gOnAttr = new THREE.InstancedBufferAttribute(gOn, 1)
  gQuad.setAttribute('aPos', new THREE.InstancedBufferAttribute(gPos, 3))
  gQuad.setAttribute('aOn', gOnAttr)
  gQuad.instanceCount = nl
  // sized and feathered to tile edge-to-edge (a per-cell tint) rather than leave gaps between
  // soft-edged discs, which read as a faint dotted moire where "grown here" cells adjoin
  const cellRadius = Math.sqrt((4 * Math.PI) / N) * 0.92
  const gUniforms = { ...shared, uColor: { value: new THREE.Vector3(1, 1, 1) }, uRadius: { value: cellRadius } }
  const grownMaterial = new THREE.ShaderMaterial({
    uniforms: gUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute float aOn;
      uniform vec3 uCamObj;
      uniform float uRadius;
      uniform float uYear;
      uniform float uMaskOn;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying vec2 vUv;
      varying float vA;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        // aOn: 0 not grown; else grown, and (with the mask on) shown from that year
        bool on = aOn > 0.5 && (uMaskOn < 0.5 || uYear >= aOn);
        vec3 up = normalize(aPosR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
        if (!on || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // a disc lying on the ground, a little smaller than its cell
        vec3 e = normalize(abs(up.y) > 0.95 ? cross(vec3(0.0, 0.0, 1.0), up) : cross(vec3(0.0, 1.0, 0.0), up));
        vec3 n = cross(up, e);
        vec3 p = aPosR + (e * position.x + n * position.y) * uRadius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
        vUv = position.xy;
        float night = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vA = smoothstep(0.0, 0.25, facing) * mix(1.0, 0.6, night);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vA;
      ${SEAM_FRAG_GLSL}
      void main() {
        ws_clipLine();
        // near-flat per-cell tiles (only a thin feather at the edge) so contiguous "grown
        // here" cells read as one tinted area instead of overlapping soft discs
        float d = length(vUv);
        float a = (1.0 - smoothstep(0.82, 1.0, d)) * 0.4 * vA;
        if (a < 0.004) discard;
        vec3 c = uColor;
        gl_FragColor = vec4(c * a, a);
      }
    `,
    ...blend,
  })
  const grown = new THREE.Mesh(gQuad, grownMaterial)
  grown.frustumCulled = false
  grown.renderOrder = 4.8 // a tint on the ground: over the roads, under the clouds and every route
  grown.visible = false
  object.add(grown)
  let grownFlags: Uint8Array | null = null

  function writeGrown() {
    if (!grownFlags) {
      grown.visible = false
      return
    }
    for (let k = 0; k < nl; k++) {
      const c = landCells[k]
      gOn[k] = grownFlags[c] ? (mask ? Math.max(1, mask[c] ?? NEVER) : 1) : 0
    }
    gOnAttr.needsUpdate = true
    grown.visible = true
  }


  // ---------- habits: each people's land tinted by its habit for the selected stimulant ----------
  const P = d.peoples
  const habitOk = d.habit !== null && h !== null && people !== null && P <= HABIT_MAX_PEOPLES && d.landCount > 0
  const hPeople = new Float32Array(Math.max(1, nl)).fill(-1)
  const hPeopleAttr = new THREE.InstancedBufferAttribute(hPeople, 1)
  const hKnown = new Float32Array(Math.max(1, nl))
  const hKnownAttr = new THREE.InstancedBufferAttribute(hKnown, 1)
  const hQuad = new THREE.InstancedBufferGeometry()
  hQuad.setAttribute('position', gQuad.getAttribute('position'))
  hQuad.setIndex(gQuad.getIndex())
  hQuad.setAttribute('aPos', gQuad.getAttribute('aPos'))
  hQuad.setAttribute('aPeople', hPeopleAttr)
  hQuad.setAttribute('aKnown', hKnownAttr)
  hQuad.instanceCount = nl
  const hUniforms = {
    ...shared,
    uRadius: gUniforms.uRadius,
    uColor: { value: new THREE.Vector3(1, 0.4, 0.2) },
    uHabit0: { value: new Float32Array(HABIT_MAX_PEOPLES) },
    uHabit1: { value: new Float32Array(HABIT_MAX_PEOPLES) },
    uFrac: { value: 0 },
  }
  const habitMaterial = new THREE.ShaderMaterial({
    uniforms: hUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute float aPeople;
      attribute float aKnown;
      uniform vec3 uCamObj;
      uniform float uRadius;
      uniform float uYear;
      uniform float uMaskOn;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      uniform float uHabit0[${HABIT_MAX_PEOPLES}];
      uniform float uHabit1[${HABIT_MAX_PEOPLES}];
      uniform float uFrac;
      varying vec2 vUv;
      varying float vA;
      varying float vLevel;
      void main() {
        vec3 aPosR = ws_relief(aPos);
        int p = int(aPeople + 0.5);
        float level = 0.0;
        if (aPeople > -0.5) level = mix(uHabit0[p], uHabit1[p], uFrac);
        vec3 up = normalize(aPosR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
        if (level < 0.02 || facing <= 0.0 || (uMaskOn > 0.5 && uYear < aKnown)) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 e = normalize(abs(up.y) > 0.95 ? cross(vec3(0.0, 0.0, 1.0), up) : cross(vec3(0.0, 1.0, 0.0), up));
        vec3 n = cross(up, e);
        vec3 pp = aPosR + (e * position.x + n * position.y) * uRadius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(pp), 1.0);
        vUv = position.xy;
        float night = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vA = smoothstep(0.0, 0.25, facing) * mix(1.0, 0.65, night);
        vLevel = level;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPixelRatio;
      varying vec2 vUv;
      varying float vA;
      varying float vLevel;
      ${SEAM_FRAG_GLSL}
      void main() {
        ws_clipLine();
        // diagonal hatching in screen space, the lines thicker the stronger the habit: nearly
        // opaque lines, so neighbouring tiles that overlap do not show as darker seams, over a
        // faint wash
        float period = 7.0 * uPixelRatio;
        float k = mod(gl_FragCoord.x + gl_FragCoord.y, period);
        float w = mix(0.7, 3.0, pow(vLevel, 0.7)) * uPixelRatio;
        float line = 1.0 - smoothstep(w - 0.6, w + 0.6, k);
        float edge = 1.0 - smoothstep(0.82, 1.0, length(vUv));
        float a = edge * vA * max(line * 0.52, 0.04 + 0.05 * vLevel);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    ...blend,
  })
  const habitMesh = new THREE.Mesh(hQuad, habitMaterial)
  habitMesh.frustumCulled = false
  habitMesh.renderOrder = 4.75 // under the grown discs
  habitMesh.visible = false
  object.add(habitMesh)
  /** Stimulant index shown (-1 none), and the land snapshot / snapshot pair the tint last took. */
  let habitK = -1
  let habitL = -1
  let habitS = -1
  const owner = new Int16Array(N)
  const scratchQ = new Int32Array(N)
  const scratchD = new Uint8Array(N)

  function writeHabitLand(l: number) {
    if (!h || !people) return
    habitL = l
    cellPeopleAt(world, h, people, l, owner, scratchQ, scratchD)
    for (let k = 0; k < nl; k++) hPeople[k] = owner[landCells[k]]
    hPeopleAttr.needsUpdate = true
  }
  function writeHabitLevels(s0: number) {
    habitS = s0
    const K = d.stimulants.length
    const s1 = Math.min(d.snapshotCount - 1, s0 + 1)
    const a = hUniforms.uHabit0.value, b = hUniforms.uHabit1.value
    for (let p = 0; p < P; p++) {
      a[p] = d.habit![(s0 * P + p) * K + habitK] / 255
      b[p] = d.habit![(s1 * P + p) * K + habitK] / 255
    }
  }
  function syncHabit(year: number) {
    if (habitK < 0 || !habitOk) return
    const l = Math.max(0, Math.min(d.landCount - 1, Math.floor(year / Math.max(1, d.landInterval) + 1e-6)))
    if (l !== habitL) writeHabitLand(l)
    const s0 = Math.max(0, Math.min(d.snapshotCount - 1, Math.floor(year / Math.max(1, d.snapshotInterval) + 1e-6)))
    if (s0 !== habitS) writeHabitLevels(s0)
    hUniforms.uFrac.value = s0 >= d.snapshotCount - 1 ? 0 : Math.max(0, Math.min(1, year / d.snapshotInterval - s0))
  }

  // ---------- blight and plague: a brief browning over the stricken land ----------
  const nz = d.hazardCells.length
  let hazardMesh: THREE.Mesh | null = null
  let zGeom: THREE.InstancedBufferGeometry | null = null
  let zMaterial: THREE.ShaderMaterial | null = null
  const zKnown = new Float32Array(Math.max(1, nz))
  const zKnownAttr = new THREE.InstancedBufferAttribute(zKnown, 1)
  const zUniforms = { ...shared, uRadius: gUniforms.uRadius, uPulse: { value: 28 } }
  if (nz > 0) {
    zGeom = new THREE.InstancedBufferGeometry()
    zGeom.setAttribute('position', gQuad.getAttribute('position'))
    zGeom.setIndex(gQuad.getIndex())
    const zPos = new Float32Array(nz * 3)
    const zInfo = new Float32Array(nz * 3) // year, delay, kind
    for (let k = 0; k < nz; k++) {
      const c = d.hazardCells[k]
      const r = surfaceRadius(world, c) + 0.0026
      zPos.set([P3[c * 3] * r, P3[c * 3 + 1] * r, P3[c * 3 + 2] * r], k * 3)
      zInfo.set([d.hazardYears[k], d.hazardDelay[k], d.hazardKind[k]], k * 3)
    }
    zGeom.setAttribute('aPos', new THREE.InstancedBufferAttribute(zPos, 3))
    zGeom.setAttribute('aInfo', new THREE.InstancedBufferAttribute(zInfo, 3))
    zGeom.setAttribute('aKnown', zKnownAttr)
    zGeom.instanceCount = nz
    zMaterial = new THREE.ShaderMaterial({
      uniforms: zUniforms,
      vertexShader: /* glsl */ `
        ${RELIEF_GLSL}
        attribute vec3 aPos;
        attribute vec3 aInfo;
        attribute float aKnown;
        uniform vec3 uCamObj;
        uniform float uRadius;
        uniform float uYear;
        uniform float uPulse;
        uniform float uMaskOn;
        varying vec2 vUv;
        varying float vA;
        varying float vT;
        varying float vKind;
        void main() {
          vec3 aPosR = ws_relief(aPos);
          // it reaches farther fields a little later
          float age = uYear - aInfo.x - aInfo.y * uPulse * 0.4;
          vec3 up = normalize(aPosR);
          float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
          if (age < 0.0 || age > uPulse || facing <= 0.0 || (uMaskOn > 0.5 && uYear < aKnown)) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 e = normalize(abs(up.y) > 0.95 ? cross(vec3(0.0, 0.0, 1.0), up) : cross(vec3(0.0, 1.0, 0.0), up));
          vec3 n = cross(up, e);
          // a spot a little smaller than its cell: neighbouring spots barely overlap and read as lesions
          vec3 p = aPosR + (e * position.x + n * position.y) * uRadius * 0.82;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(p), 1.0);
          vUv = position.xy;
          vT = age / uPulse;
          vKind = aInfo.z;
          vA = smoothstep(0.0, 0.25, facing) * smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.4, 1.0, vT));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vA;
        varying float vT;
        varying float vKind;
        ${SEAM_FRAG_GLSL}
        void main() {
          ws_clipLine();
          float r = length(vUv);
          float a = (1.0 - smoothstep(0.72, 1.0, r)) * vA * 0.8;
          if (a < 0.004) discard;
          // blight: withered ochre browning to rot, darker at the heart of each spot; plague: ashen grey
          vec3 blight = mix(vec3(0.56, 0.42, 0.15), vec3(0.27, 0.16, 0.06), smoothstep(0.0, 0.55, vT)) * mix(0.8, 1.05, r);
          vec3 plague = mix(vec3(0.66, 0.64, 0.58), vec3(0.28, 0.26, 0.28), smoothstep(0.0, 0.55, vT)) * mix(0.85, 1.05, r);
          vec3 c = vKind > 0.5 ? plague : blight;
          gl_FragColor = vec4(c * a, a);
        }
      `,
      ...blend,
    })
    hazardMesh = new THREE.Mesh(zGeom, zMaterial)
    hazardMesh.frustumCulled = false
    hazardMesh.renderOrder = 4.85
    object.add(hazardMesh)
  }

  function writeHabitKnown() {
    if (!mask) return
    for (let k = 0; k < nl; k++) hKnown[k] = mask[landCells[k]] ?? NEVER
    hKnownAttr.needsUpdate = true
    for (let k = 0; k < nz; k++) zKnown[k] = mask[d.hazardCells[k]] ?? NEVER
    zKnownAttr.needsUpdate = true
  }

  const tmpQ = new THREE.Quaternion()
  return {
    object,
    setSelected(s: number) {
      selected = s >= 0 && s < d.count ? s : -1
      if (selected >= 0) technique = -1
      shared.uSelected.value = selected >= 0 ? selected : technique >= 0 ? d.count + technique : -1
      if (selected >= 0) gUniforms.uColor.value.set(d.rgb[selected * 3], d.rgb[selected * 3 + 1], d.rgb[selected * 3 + 2])
      // a stimulant: its habit over each people's land (harmful ones in a warning red, mild ones in a warm cream)
      habitK = habitOk && selected >= 0 ? d.stimIndex[selected] : -1
      habitMesh.visible = habitK >= 0
      habitL = habitS = -1
      if (habitK >= 0) {
        const harm = d.list[selected].harm ?? 0
        if (harm >= 0.2) hUniforms.uColor.value.set(1.0, 0.3, 0.16)
        else if (harm > 0) hUniforms.uColor.value.set(1.0, 0.62, 0.25)
        else hUniforms.uColor.value.set(0.98, 0.9, 0.62)
        syncHabit(shared.uYear.value)
      }
      buildArcs()
    },
    setTechnique(k: number) {
      technique = k >= 0 && k < d.techniques.length ? k : -1
      if (technique >= 0) {
        selected = -1
        habitK = -1
        habitMesh.visible = false
      }
      shared.uSelected.value = selected >= 0 ? selected : technique >= 0 ? d.count + technique : -1
      buildArcs()
    },
    setOriginCategory(category: number) {
      oUniforms.uCategory.value = category
    },
    setGrown(flags: Uint8Array | null) {
      grownFlags = flags
      writeGrown()
    },
    setTime(year: number, pulseYears = 20) {
      shared.uYear.value = year
      zUniforms.uPulse.value = Math.max(1, pulseYears * HAZARD_PULSE_SCALE)
      syncHabit(year)
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      shared.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(shared.uCamObj.value)
      object.worldToLocal(shared.uCamObj.value)
      oUniforms.uViewport.value.copy(drawSize)
      oUniforms.uPixelRatio.value = pixelRatio
      oUniforms.uSizeScale.value = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / camera.position.length())))
      shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      shared.uPixelRatio.value = pixelRatio
    },
    setKnownMask(cellYear: Float32Array | null) {
      mask = cellYear
      shared.uMaskOn.value = cellYear ? 1 : 0
      if (cellYear) {
        for (let k = 0; k < no; k++) oKnown[k] = cellYear[oCells[k]] ?? NEVER
        oKnownAttr.needsUpdate = true
      }
      writeHabitKnown()
      buildArcs()
      writeGrown()
    },
    setOrder(order: number) {
      origins.renderOrder = order
    },
    dispose() {
      oQuad.dispose()
      originMaterial.dispose()
      arcGeom.dispose()
      arcMaterial.dispose()
      gQuad.dispose()
      grownMaterial.dispose()
      hQuad.dispose()
      habitMaterial.dispose()
      zGeom?.dispose()
      zMaterial?.dispose()
    },
  }
}
