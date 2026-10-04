// Travelling groups: settlers founding a new settlement and migrants joining one.
//
// Every route is smoothed once at build time into a sampled curve lying just above
// the terrain (a Catmull-Rom curve through a decimated subset of its cells that keeps
// to its side of the coast, see below). Two things are drawn from those samples:
//
//  - Trails: one static ribbon buffer holding every route, laid out in journey
//    order (journeys are sorted by departYear). Each vertex knows when the group
//    passes it, so the shader shows the travelled part with a bright head that
//    decays behind the group and a faint thread that lingers for some tens of
//    years after arrival. Per frame only the draw range changes: two binary
//    searches find the journeys that can be visible, so nothing scans all
//    journeys and scrubbing in either direction is exact.
//  - Groups: one instanced screen-space marker per journey under way, a dot on
//    land and a boat chevron pointing along the route at sea. Their positions are
//    written each frame into preallocated instance buffers (no allocation).
//
// A second mesh shares the trail buffers with its own draw range to highlight one
// route (the one that founded the selected settlement), persistently.
//
// Expeditions (JourneyKind.Expedition) are drawn apart from settlers and migrants: a fine
// dotted white-gold trail, out and back, and a small pennant for the party; a lost one's
// trail simply ends where it was lost (outposts.ts marks the spot). They have their own
// toggle (setExpeditionsVisible).

import * as THREE from 'three'
import type { Journeys, World } from '../contract.ts'
import { isWaterCell, lakeArray, SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { sunUniforms } from './sun.ts'

/** Height of the routes above the ground (settlement markers sit at 0.004). */
const LIFT = 0.0032
/** Curve knots every this many route cells (plus coast transitions and endpoints). */
const KNOT_STRIDE = 3
/** Curve samples per route cell spanned. */
const SAMPLES_PER_CELL = 3
/** Group marker radius range in CSS pixels; settlement markers are 1.7..6.5. */
const GROUP_MIN_RADIUS = 1.45
const GROUP_MAX_RADIUS = 2.5
/**
 * An expedition's round trip is brief (about 2 simulated years) next to the shared
 * settler/migrant thread duration (uThreadYears, scaled with playback speed): its trail
 * keeps at least this many years of fade after the group arrives home, so recent
 * exploration stays readable instead of flashing by.
 */
const EXPEDITION_THREAD_YEARS = 45

export interface JourneyLayer {
  /** Container of the trail, highlight and group meshes; add it to the planet group. */
  object: THREE.Group
  /**
   * Per frame: continuous year; `headYears` is how long the bright head of a trail
   * takes to decay, `threadYears` how long a route stays faintly visible after the
   * group passed.
   */
  setTime(year: number, headYears: number, threadYears: number): void
  /** Route to draw highlighted (a journey index), or -1. */
  setHighlight(journey: number): void
  /** Per frame: camera/sun in object space and viewport size. */
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  /**
   * Groups under way as last written by setTime (live views of preallocated buffers, valid
   * until the next setTime): count, then per group xyz, unit direction, and info
   * (kind, size 0..1, at sea 0|1, opacity). Used by the diorama layer for ships and carts.
   */
  groups(): { count: number; pos: Float32Array; dir: Float32Array; info: Float32Array }
  /** Fade group markers out within camera distance near..far (where models take over); far <= 0 turns it off. */
  setYield(near: number, far: number): void
  /** Show expedition trails and parties (settlers and migrants are unaffected). */
  setExpeditionsVisible(on: boolean): void
  dispose(): void
}

/** Index of the first element of the non-decreasing `a` that is >= v (a.length if none). */
function lowerBound(a: Float32Array, v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}

/** Number of elements of the non-decreasing `a` that are <= v. */
function upperBound(a: Float32Array, v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] <= v) lo = m + 1
    else hi = m
  }
  return lo
}

/** Largest number of journeys under way at the same time. */
function maxConcurrent(J: Journeys): number {
  const arrive = Float32Array.from(J.arriveYear).sort()
  let best = 0
  for (let j = 0; j < J.count; j++) {
    // under way at departYear[j]: departed by then and not yet arrived
    const n = upperBound(J.departYear, J.departYear[j]) - upperBound(arrive, J.departYear[j])
    if (n > best) best = n
  }
  return best
}

/**
 * Centripetal Catmull-Rom (alpha 0.5, Barry-Goldman pyramid) between p1 and p2 at u in
 * [0, 1]: no cusps or self-intersections, even with uneven knot spacing.
 */
function centripetal(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number, out: THREE.Vector3) {
  const t1 = Math.sqrt(Math.max(p0.distanceTo(p1), 1e-9))
  const t2 = t1 + Math.sqrt(Math.max(p1.distanceTo(p2), 1e-9))
  const t3 = t2 + Math.sqrt(Math.max(p2.distanceTo(p3), 1e-9))
  const t = t1 + (t2 - t1) * u
  // A1..A3, B1..B2, C, written out to avoid temporaries
  const lerp = (a: number, b: number, ta: number, tb: number) => (tb - t) / (tb - ta) * a + (t - ta) / (tb - ta) * b
  const coord = (a: number, b: number, c: number, d: number) => {
    const A1 = lerp(a, b, 0, t1), A2 = lerp(b, c, t1, t2), A3 = lerp(c, d, t2, t3)
    const B1 = lerp(A1, A2, 0, t2), B2 = lerp(A2, A3, t1, t3)
    return lerp(B1, B2, t1, t2)
  }
  return out.set(coord(p0.x, p1.x, p2.x, p3.x), coord(p0.y, p1.y, p2.y, p3.y), coord(p0.z, p1.z, p2.z, p3.z))
}

/** `normYear`: the group size scale is taken over journeys arriving by then (so a longer history does not rescale earlier groups). */
export function buildJourneyLayer(world: World, J: Journeys, normYear = Infinity): JourneyLayer {
  const P = world.grid.positions
  const nbOff = world.grid.neighborOffsets
  const nbList = world.grid.neighbors
  const lake = lakeArray(world)
  const count = J.count

  // ---------- smoothed route samples ----------
  // Routes are cell paths on the hex grid. Drawn cell to cell they run in three fixed
  // directions; instead each route is a centripetal Catmull-Rom curve through a
  // decimated subset of its cells (every KNOT_STRIDE-th, both cells of every land/sea
  // transition, and the endpoints). Each stretch between two knots is checked against
  // the grid: a land stretch whose curve strays over water (a bay), or a sea stretch
  // that strays over land (a cape), gets the skipped cells back as knots until it fits.
  // Every sample records whether it lies over water (the nearest cell), which drives
  // the wake styling and the boats.
  const path = J.path
  const knots: number[] = []
  const tmpKnots: number[] = []
  const ka = new THREE.Vector3(), kb = new THREE.Vector3(), kc = new THREE.Vector3(), kd = new THREE.Vector3()
  const q = new THREE.Vector3(), t = new THREE.Vector3()
  const unit = (cell: number, out: THREE.Vector3) => out.set(P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2])
  const radius = (cell: number) => surfaceRadius(world, cell)
  const isWater = (cell: number) => isWaterCell(world, lake, cell)

  /** Knots i0 .. i3 (path indices; -1 = phantom, reflected) -> curve point at u in [0, 1] between i1 and i2. */
  function curvePoint(p0: number, i0: number, i1: number, i2: number, i3: number, u: number, out: THREE.Vector3) {
    unit(path[p0 + i1], kb)
    unit(path[p0 + i2], kc)
    if (i0 >= 0) unit(path[p0 + i0], ka)
    else ka.copy(kb).multiplyScalar(2).sub(kc)
    if (i3 >= 0) unit(path[p0 + i3], kd)
    else kd.copy(kc).multiplyScalar(2).sub(kb)
    centripetal(ka, kb, kc, kd, u, out)
    return out.normalize()
  }

  /** Nearest cell to unit vector v, walking greedily from `start`. */
  function nearestCell(v: THREE.Vector3, start: number): number {
    let cur = start
    let best = P[cur * 3] * v.x + P[cur * 3 + 1] * v.y + P[cur * 3 + 2] * v.z
    for (let iter = 0; iter < 64; iter++) {
      let next = -1
      for (let k = nbOff[cur]; k < nbOff[cur + 1]; k++) {
        const c = nbList[k]
        const d = P[c * 3] * v.x + P[c * 3 + 1] * v.y + P[c * 3 + 2] * v.z
        if (d > best) {
          best = d
          next = c
        }
      }
      if (next < 0) break
      cur = next
    }
    return cur
  }

  const samplesOf = (span: number) => Math.max(2, span * SAMPLES_PER_CELL)

  /** Fills `knots` for journey path [p0, p0 + n). */
  function chooseKnots(p0: number, n: number) {
    knots.length = 0
    let last = 0
    knots.push(0)
    for (let k = 1; k < n; k++) {
      const transition = isWater(path[p0 + k]) !== isWater(path[p0 + k - 1])
      const before = k + 1 < n && isWater(path[p0 + k + 1]) !== isWater(path[p0 + k])
      if (k === n - 1 || transition || before || k - last >= KNOT_STRIDE) {
        knots.push(k)
        last = k
      }
    }
    // refine stretches whose curve leaves their side of the coast
    for (let round = 0; round < 6; round++) {
      let changed = false
      tmpKnots.length = 0
      for (let i = 0; i + 1 < knots.length; i++) {
        tmpKnots.push(knots[i])
        const i1 = knots[i], i2 = knots[i + 1]
        if (i2 - i1 < 2) continue
        const w = isWater(path[p0 + i1])
        const m = samplesOf(i2 - i1)
        let ok = true
        for (let s = 1; s < m && ok; s++) {
          const u = s / m
          curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
          const guess = path[p0 + Math.min(i2, i1 + Math.round(u * (i2 - i1)))]
          if (isWater(nearestCell(q, guess)) !== w) ok = false
        }
        if (!ok) {
          // short stretches get all their cells back, long ones their midpoint
          if (i2 - i1 <= 3) for (let k = i1 + 1; k < i2; k++) tmpKnots.push(k)
          else tmpKnots.push((i1 + i2) >> 1)
          changed = true
        }
      }
      tmpKnots.push(knots[knots.length - 1])
      knots.length = 0
      for (const k of tmpKnots) knots.push(k)
      if (!changed) break
    }
  }

  // capacity: samples per journey are bounded by every cell being a knot
  let cap = 0
  for (let j = 0; j < count; j++) {
    const n = J.pathOffsets[j + 1] - J.pathOffsets[j]
    if (n >= 2) cap += (n - 1) * SAMPLES_PER_CELL + 1
  }
  const sPos = new Float32Array(cap * 3)
  const sSide = new Float32Array(cap * 3)
  const sFrac = new Float32Array(cap)
  const sArc = new Float32Array(cap)
  const sWater = new Uint8Array(cap)
  /** First sample of each piece (one piece per route); the ribbon joins consecutive samples inside a piece only. */
  const pieceStart: number[] = []
  const sampleOffsets = new Uint32Array(count + 1)
  let ns = 0

  for (let j = 0; j < count; j++) {
    sampleOffsets[j] = ns
    const p0 = J.pathOffsets[j], p1 = J.pathOffsets[j + 1]
    const n = p1 - p0
    if (n < 2) continue
    pieceStart.push(ns)
    chooseKnots(p0, n)
    let cell = path[p0]
    for (let i = 0; i + 1 < knots.length; i++) {
      const i1 = knots[i], i2 = knots[i + 1]
      const r1 = radius(path[p0 + i1]), r2 = radius(path[p0 + i2])
      const m = samplesOf(i2 - i1)
      const lastPiece = i + 2 === knots.length
      for (let s = 0; s < m + (lastPiece ? 1 : 0); s++) {
        const u = s / m
        curvePoint(p0, i > 0 ? knots[i - 1] : -1, i1, i2, i + 2 < knots.length ? knots[i + 2] : -1, u, q)
        cell = nearestCell(q, cell)
        // the endpoints are exactly the settlement cells
        const w = u === 0 ? isWater(path[p0 + i1]) : u === 1 ? isWater(path[p0 + i2]) : isWater(cell)
        const r = r1 + (r2 - r1) * u + LIFT
        sPos[ns * 3] = q.x * r
        sPos[ns * 3 + 1] = q.y * r
        sPos[ns * 3 + 2] = q.z * r
        sWater[ns] = w ? 1 : 0
        ns++
      }
    }
    // ribbon sides from the sampled tangent; arc length and its fraction
    const s0 = sampleOffsets[j]
    for (let s = s0; s < ns; s++) {
      const a = Math.max(s0, s - 1), b = Math.min(ns - 1, s + 1)
      t.set(sPos[b * 3] - sPos[a * 3], sPos[b * 3 + 1] - sPos[a * 3 + 1], sPos[b * 3 + 2] - sPos[a * 3 + 2])
      q.set(sPos[s * 3], sPos[s * 3 + 1], sPos[s * 3 + 2]).normalize()
      t.crossVectors(q, t).normalize()
      sSide[s * 3] = t.x
      sSide[s * 3 + 1] = t.y
      sSide[s * 3 + 2] = t.z
    }
    let len = 0
    sArc[s0] = 0
    for (let s = s0 + 1; s < ns; s++) {
      len += Math.hypot(sPos[s * 3] - sPos[s * 3 - 3], sPos[s * 3 + 1] - sPos[s * 3 - 2], sPos[s * 3 + 2] - sPos[s * 3 - 1])
      sArc[s] = len
    }
    for (let s = s0; s < ns; s++) sFrac[s] = len > 0 ? sArc[s] / len : (s - s0) / Math.max(1, ns - 1 - s0)
  }
  sampleOffsets[count] = ns
  pieceStart.push(ns)

  // ---------- trail ribbon geometry (two vertices per sample) ----------
  const V = ns * 2
  const vPos = new Float32Array(V * 3)
  const vSide = new Float32Array(V * 4)
  const vTime = new Float32Array(V * 4)
  const vKind = new Float32Array(V * 2)
  {
    let j = 0
    for (let s = 0; s < ns; s++) {
      while (sampleOffsets[j + 1] <= s) j++
      for (let e = 0; e < 2; e++) {
        const v = s * 2 + e
        vPos[v * 3] = sPos[s * 3]
        vPos[v * 3 + 1] = sPos[s * 3 + 1]
        vPos[v * 3 + 2] = sPos[s * 3 + 2]
        vSide[v * 4] = sSide[s * 3]
        vSide[v * 4 + 1] = sSide[s * 3 + 1]
        vSide[v * 4 + 2] = sSide[s * 3 + 2]
        vSide[v * 4 + 3] = e === 0 ? -1 : 1
        vTime[v * 4] = J.departYear[j]
        vTime[v * 4 + 1] = J.arriveYear[j]
        vTime[v * 4 + 2] = sFrac[s]
        vTime[v * 4 + 3] = sArc[s]
        vKind[v * 2] = J.kind[j]
        vKind[v * 2 + 1] = sWater[s]
      }
    }
  }
  let quads = 0
  for (let p = 0; p + 1 < pieceStart.length; p++) quads += Math.max(0, pieceStart[p + 1] - pieceStart[p] - 1)
  const index = new Uint32Array(quads * 6)
  /** First index of each journey's triangles. */
  const indexOffsets = new Uint32Array(count + 1)
  {
    let k = 0
    let j = 0
    for (let p = 0; p + 1 < pieceStart.length; p++) {
      const s0 = pieceStart[p], s1 = pieceStart[p + 1]
      while (j < count && sampleOffsets[j + 1] <= s0) indexOffsets[++j] = k
      for (let s = s0; s + 1 < s1; s++) {
        const v = s * 2
        index[k++] = v; index[k++] = v + 2; index[k++] = v + 1
        index[k++] = v + 1; index[k++] = v + 2; index[k++] = v + 3
      }
    }
    while (j < count) indexOffsets[++j] = k
  }

  const trailGeom = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(vPos, 3)
  const sideAttr = new THREE.BufferAttribute(vSide, 4)
  const timeAttr = new THREE.BufferAttribute(vTime, 4)
  const kindAttr = new THREE.BufferAttribute(vKind, 2)
  const indexAttr = new THREE.BufferAttribute(index, 1)
  trailGeom.setAttribute('position', posAttr)
  trailGeom.setAttribute('aSide', sideAttr)
  trailGeom.setAttribute('aTime', timeAttr)
  trailGeom.setAttribute('aKind', kindAttr)
  trailGeom.setIndex(indexAttr)
  trailGeom.setDrawRange(0, 0)
  // same GPU buffers, its own draw range
  const highlightGeom = new THREE.BufferGeometry()
  highlightGeom.setAttribute('position', posAttr)
  highlightGeom.setAttribute('aSide', sideAttr)
  highlightGeom.setAttribute('aTime', timeAttr)
  highlightGeom.setAttribute('aKind', kindAttr)
  highlightGeom.setIndex(indexAttr)
  highlightGeom.setDrawRange(0, 0)

  const shared = {
    uReliefK: reliefUniforms.uReliefK,
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    // up close (among the 3D towns) trails thin and fade out, and trails and markers come
    // down from LIFT toward the ground; set in update()
    uClose: { value: 1 },
    uDrop: { value: 0 },
    uExpeditions: { value: 1 },
  }
  const trailUniforms = (mode: number) => ({
    ...shared,
    uYear: { value: 0 },
    uHeadYears: { value: 20 },
    uThreadYears: { value: 60 },
    uMode: { value: mode },
  })

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

  const trailVertex = /* glsl */ `
      ${RELIEF_GLSL}
    attribute vec4 aSide; // side direction, across (-1|1)
    attribute vec4 aTime; // depart year, arrive year, fraction of the route, arc length
    attribute vec2 aKind; // kind (0 settlers, 1 migrants), water
    uniform float uYear;
    uniform float uThreadYears;
    uniform float uHeadYears;
    uniform int uMode; // 0 trails, 1 highlighted route
    uniform float uPixel; // world size of a device pixel at unit view depth
    uniform float uPixelRatio;
    uniform float uClose;
    uniform float uDrop;
    uniform float uExpeditions;
    uniform vec3 uCamObj;
    uniform vec3 uSunObj;
      uniform float uDaylight; // 1: daylight everywhere (sun.ts)
    varying float vAcross;
    varying float vSoft;
    varying float vCore;
    varying float vAge;
    varying float vFrac;
    varying float vArc;
    varying float vKindV;
    varying float vWater;
    varying float vFacing;
    varying float vNight;
    void main() {
        vec3 positionR = ws_relief(position); // the ground at the zoom's relief (terrainHeight.ts)
      float passYear = mix(aTime.x, aTime.y, aTime.z);
      // expeditions are brief next to the shared thread duration: keep a minimum of their own
      float threadYears = aKind.x > 1.5 ? max(uThreadYears, ${EXPEDITION_THREAD_YEARS.toFixed(1)}) : uThreadYears;
      // whole journeys only, so no triangle is ever half culled
      if ((uMode == 0 && (uYear < aTime.x || uYear > aTime.y + threadYears)) || (aKind.x > 1.5 && uExpeditions < 0.5)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }
      vAge = uYear - passYear;
      float head = uMode == 1 ? 1.0 : exp(-max(vAge, 0.0) / uHeadYears);
      // half widths in CSS pixels: a hairline thread, a stronger head, a bold highlight with a dark rim
      float core = (uMode == 1 ? 1.25 : mix(0.62, 1.0, head)) * mix(0.45, 1.0, uClose);
      if (aKind.x > 1.5) core *= 0.72; // expeditions: a finer line
      float rim = uMode == 1 ? mix(0.3, 1.1, uClose) : 0.0;
      vec3 base = positionR - normalize(positionR) * uDrop;
      vec4 mv = modelViewMatrix * vec4(base, 1.0);
      float pix = -mv.z * uPixel * uPixelRatio;
      float outer = core + rim + 0.6;
      vCore = core / outer;
      vSoft = 0.9 / outer;
      vAcross = aSide.w;
      vec3 p = base + aSide.xyz * aSide.w * outer * pix;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      vec3 up = normalize(positionR);
      vFacing = dot(up, normalize(uCamObj - positionR));
      vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      vFrac = aTime.z;
      vArc = aTime.w;
      vKindV = aKind.x;
      vWater = aKind.y;
    }
  `
  const trailFragment = /* glsl */ `
    uniform float uClose;
    uniform float uHeadYears;
    uniform float uThreadYears;
    uniform int uMode;
    varying float vAcross;
    varying float vSoft;
    varying float vCore;
    varying float vAge;
    varying float vFrac;
    varying float vArc;
    varying float vKindV;
    varying float vWater;
    varying float vFacing;
    varying float vNight;
    void main() {
      if (uMode == 0 && vAge < 0.0) discard; // not reached yet: the trail ends at the group
      float limb = smoothstep(0.0, 0.3, vFacing);
      float x = abs(vAcross);
      float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
      float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
      bool sea = vWater > 0.5;
      bool expedition = vKindV > 1.5;
      bool migrants = vKindV > 0.5 && !expedition;
      vec3 headC = migrants ? vec3(1.0, 0.66, 0.54) : vec3(1.0, 0.93, 0.74);
      vec3 threadC = migrants ? vec3(0.92, 0.50, 0.42) : vec3(0.98, 0.76, 0.42);
      vec3 col;
      float a;
      if (uMode == 1) {
        // brighter toward the destination, so the direction of travel reads
        col = mix(vec3(0.05, 0.03, 0.01), migrants ? vec3(1.0, 0.75, 0.66) : vec3(1.0, 0.95, 0.82), coreMask);
        a = body * mix(0.55, 1.0, coreMask) * mix(0.6, 1.0, vFrac);
        if (sea) a *= mix(0.45, 1.0, step(0.45, fract(vArc / 0.007)));
      } else {
        float head = exp(-max(vAge, 0.0) / uHeadYears);
        float threadYears = expedition ? max(uThreadYears, ${EXPEDITION_THREAD_YEARS.toFixed(1)}) : uThreadYears;
        float thread = 1.0 - smoothstep(0.0, threadYears, vAge);
        col = mix(threadC, headC, head);
        a = max(0.9 * head, 0.46 * thread) * coreMask;
        if (expedition) {
          // a fine dotted white-gold line, the same by land and sea
          col = mix(vec3(0.96, 0.86, 0.58), vec3(1.0, 0.98, 0.9), head);
          a = max(0.95 * head, 0.62 * thread) * coreMask * step(0.5, fract(vArc / 0.0032));
        } else if (sea) {
          // a dotted, paler wake at sea
          col = mix(col, vec3(0.80, 0.93, 1.0), 0.6);
          a *= step(0.5, fract(vArc / 0.006)) * 0.9;
        }
        a *= mix(1.0, 0.45, vNight); // the city lights carry the night side
      }
      a *= limb * uClose;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col * a, a);
    }
  `

  const trailMaterial = new THREE.ShaderMaterial({ uniforms: trailUniforms(0), vertexShader: trailVertex, fragmentShader: trailFragment, ...blend })
  const highlightMaterial = new THREE.ShaderMaterial({ uniforms: trailUniforms(1), vertexShader: trailVertex, fragmentShader: trailFragment, ...blend })
  const trails = new THREE.Mesh(trailGeom, trailMaterial)
  trails.frustumCulled = false
  trails.renderOrder = 7 // after clouds, under the settlement markers
  const highlight = new THREE.Mesh(highlightGeom, highlightMaterial)
  highlight.frustumCulled = false
  highlight.renderOrder = 7.5
  highlight.visible = false

  // ---------- groups under way (instanced markers) ----------
  const capacity = Math.max(1, maxConcurrent(J))
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const gPos = new Float32Array(capacity * 3)
  const gDir = new Float32Array(capacity * 3)
  const gInfo = new Float32Array(capacity * 4)
  const dyn = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage)
  const gPosAttr = dyn(gPos, 3)
  const gDirAttr = dyn(gDir, 3)
  const gInfoAttr = dyn(gInfo, 4)
  quad.setAttribute('aPos', gPosAttr)
  quad.setAttribute('aDir', gDirAttr)
  quad.setAttribute('aInfo', gInfoAttr)
  quad.instanceCount = 0

  let maxSize = 1
  for (let j = 0; j < count; j++) if (J.arriveYear[j] <= normYear) maxSize = Math.max(maxSize, J.size[j])
  const sizeT = new Float32Array(count)
  for (let j = 0; j < count; j++) sizeT[j] = Math.sqrt(Math.min(1, J.size[j] / maxSize))

  const groupUniforms = {
    ...shared,
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSizeScale: { value: 1 },
    uYield: { value: new THREE.Vector2(0, 0) },
  }
  const groupMaterial = new THREE.ShaderMaterial({
    uniforms: groupUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec3 aDir;
      attribute vec4 aInfo; // kind, size (0..1), at sea, opacity
      uniform float uPixelRatio;
      uniform float uSizeScale;
      uniform vec2 uViewport;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight; // 1: daylight everywhere (sun.ts)
      uniform vec2 uYield;
      uniform float uDrop;
      varying vec2 vPx;
      varying float vR;
      varying float vKindV;
      varying float vSea;
      varying float vAlpha;
      varying float vNight;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        vec3 up = normalize(aPosR);
        vec3 at = aPosR - up * uDrop;
        float facing = dot(up, normalize(uCamObj - at));
        if (facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
        vec4 ahead = projectionMatrix * modelViewMatrix * vec4(at + aDir * 0.01, 1.0);
        vec2 d = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
        vec2 fwd = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
        vec2 side = vec2(-fwd.y, fwd.x);
        if (side.y < 0.0) side = -side; // (+y on screen up: an expedition's pennant flies upward; the other shapes are symmetric)
        float r = (${GROUP_MIN_RADIUS.toFixed(2)} + ${(GROUP_MAX_RADIUS - GROUP_MIN_RADIUS).toFixed(2)} * aInfo.y) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        if (aInfo.x > 1.5) r = max(r * 1.45, 2.4); // an expedition's pennant reads at a glance
        float ext = aInfo.x > 1.5 ? r * 3.0 + 3.0 : r * 2.2 + 3.0;
        // the quad's x axis runs along the direction of travel on screen
        vec2 offPx = (fwd * position.x + side * position.y) * ext;
        clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vKindV = aInfo.x;
        vSea = aInfo.z;
        vAlpha = aInfo.w * smoothstep(0.0, 0.3, facing);
        // up close a ship or cart model stands in for the marker
        if (uYield.y > 0.0) vAlpha *= smoothstep(uYield.x, uYield.y, length(uCamObj - at));
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vKindV;
      varying float vSea;
      varying float vAlpha;
      varying float vNight;
      // signed distance to triangle p0 p1 p2 (Inigo Quilez)
      float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
        vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
        vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
        vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
        vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
        vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
        float s = sign(e0.x * e2.y - e0.y * e2.x);
        vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                         vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                         vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
        return -sqrt(d.x) * sign(d.y);
      }
      void main() {
        bool expedition = vKindV > 1.5;
        bool migrants = vKindV > 0.5 && !expedition;
        vec3 fill = expedition ? vec3(1.0, 0.88, 0.5) : migrants ? vec3(1.0, 0.62, 0.50) : vec3(1.0, 0.95, 0.80);
        vec3 rim = vec3(0.12, 0.06, 0.03);
        float d;
        if (expedition) {
          // a pennant on a short staff (by land and sea), flying back from the direction of travel (+x)
          float staff = abs(vPx.x) - 0.55;
          staff = max(staff, max(-vPx.y - vR * 0.6, vPx.y - vR * 2.6));
          float flag = sdTri(vPx, vec2(0.0, vR * 2.6), vec2(0.0, vR * 1.3), vec2(-vR * 2.0, vR * 1.95));
          d = min(min(length(vPx) - vR * 0.75, staff), flag);
        } else if (vSea > 0.5) {
          // a boat: an arrowhead with a notched stern, pointing along +x
          float L = vR * 2.0;
          float W = vR * 1.4;
          float hull = sdTri(vPx, vec2(L, 0.0), vec2(-L * 0.8, W), vec2(-L * 0.8, -W));
          float notch = sdTri(vPx, vec2(-L * 0.25, 0.0), vec2(-L * 1.2, W * 1.4), vec2(-L * 1.2, -W * 1.4));
          d = max(hull, -notch);
        } else {
          d = length(vPx) - vR;
        }
        // boats get a thinner rim: their shape, not the outline, should carry
        float inner = vSea > 0.5 || expedition ? 1.0 - smoothstep(-0.8, 0.0, d) : 1.0 - smoothstep(-1.1, -0.1, d);
        float bodyA = 1.0 - smoothstep(0.3, 1.3, d);
        vec3 bodyC = mix(rim, fill, inner);
        // a soft glow so a few pixels read at a glance
        float glow = exp(-max(d, 0.0) * 0.55) * 0.35;
        vec3 c = fill * glow;
        float a = glow;
        c = bodyC * bodyA + c * (1.0 - bodyA);
        a = bodyA + a * (1.0 - bodyA);
        float k = vAlpha * mix(1.0, 0.55, vNight);
        c *= k;
        a *= k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    ...blend,
  })
  const groups = new THREE.Mesh(quad, groupMaterial)
  groups.frustumCulled = false
  groups.renderOrder = 9 // over the settlement markers

  const object = new THREE.Group()
  object.add(trails, highlight, groups)

  // Running maximum of arriveYear, so a binary search finds the first journey that
  // can still be under way (or still fading) at a year.
  const maxArrive = new Float32Array(count)
  for (let j = 0, m = -Infinity; j < count; j++) {
    m = Math.max(m, J.arriveYear[j])
    maxArrive[j] = m
  }

  const tmpQ = new THREE.Quaternion()
  const groupView = { count: 0, pos: gPos, dir: gDir, info: gInfo }

  function setTimeUniforms(m: THREE.ShaderMaterial, year: number, headYears: number, threadYears: number) {
    m.uniforms.uYear.value = year
    m.uniforms.uHeadYears.value = headYears
    m.uniforms.uThreadYears.value = threadYears
  }

  /** Upload only the first n instances. */
  function upload(attr: THREE.InstancedBufferAttribute, n: number) {
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, n * attr.itemSize)
    attr.needsUpdate = true
  }

  let expeditionsShown = true
  function writeGroups(year: number) {
    const hi = upperBound(J.departYear, year)
    let n = 0
    for (let j = lowerBound(maxArrive, year); j < hi && n < capacity; j++) {
      const d0 = J.departYear[j], d1 = J.arriveYear[j]
      if (year >= d1 || year < d0) continue
      if (!expeditionsShown && J.kind[j] === 2) continue
      const s0 = sampleOffsets[j], s1 = sampleOffsets[j + 1]
      if (s1 - s0 < 2) continue
      const p = d1 > d0 ? (year - d0) / (d1 - d0) : 1
      // last sample at or before p, within [s0, s1 - 2]
      let lo = s0, top = s1 - 2
      while (lo < top) {
        const m = (lo + top + 1) >>> 1
        if (sFrac[m] <= p) lo = m
        else top = m - 1
      }
      const f0 = sFrac[lo], f1 = sFrac[lo + 1]
      const u = f1 > f0 ? Math.min(1, Math.max(0, (p - f0) / (f1 - f0))) : 0
      const i0 = lo * 3, i1 = lo * 3 + 3
      const dx = sPos[i1] - sPos[i0], dy = sPos[i1 + 1] - sPos[i0 + 1], dz = sPos[i1 + 2] - sPos[i0 + 2]
      gPos[n * 3] = sPos[i0] + dx * u
      gPos[n * 3 + 1] = sPos[i0 + 1] + dy * u
      gPos[n * 3 + 2] = sPos[i0 + 2] + dz * u
      const l = Math.hypot(dx, dy, dz) || 1
      gDir[n * 3] = dx / l
      gDir[n * 3 + 1] = dy / l
      gDir[n * 3 + 2] = dz / l
      // fade in as the group sets out and out in the last moment before it arrives
      const appear = Math.min(1, (year - d0) / 0.35, (d1 - year) / 0.15)
      gInfo[n * 4] = J.kind[j]
      gInfo[n * 4 + 1] = sizeT[j]
      gInfo[n * 4 + 2] = sWater[lo]
      gInfo[n * 4 + 3] = Math.max(0, appear)
      n++
    }
    quad.instanceCount = n
    if (n > 0) {
      upload(gPosAttr, n)
      upload(gDirAttr, n)
      upload(gInfoAttr, n)
    }
  }

  return {
    object,
    setTime(year: number, headYears: number, threadYears: number) {
      setTimeUniforms(trailMaterial, year, headYears, threadYears)
      setTimeUniforms(highlightMaterial, year, headYears, threadYears)
      const hi = upperBound(J.departYear, year)
      const lo = Math.min(hi, lowerBound(maxArrive, year - threadYears))
      trailGeom.setDrawRange(indexOffsets[lo], indexOffsets[hi] - indexOffsets[lo])
      writeGroups(year)
    },
    groups() {
      groupView.count = quad.instanceCount
      return groupView
    },
    setYield(near: number, far: number) {
      groupUniforms.uYield.value.set(near, far)
    },
    setExpeditionsVisible(on: boolean) {
      expeditionsShown = on
      shared.uExpeditions.value = on ? 1 : 0
    },
    setHighlight(j: number) {
      const ok = j >= 0 && j < count && indexOffsets[j + 1] > indexOffsets[j]
      highlight.visible = ok
      if (ok) highlightGeom.setDrawRange(indexOffsets[j], indexOffsets[j + 1] - indexOffsets[j])
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      shared.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(shared.uCamObj.value)
      object.worldToLocal(shared.uCamObj.value)
      shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      shared.uPixelRatio.value = pixelRatio
      groupUniforms.uViewport.value.copy(drawSize)
      const dist = camera.position.length()
      groupUniforms.uSizeScale.value = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / dist)))
      const tc = Math.min(1, Math.max(0, (dist - 1.1) / 0.25))
      shared.uClose.value = tc * tc * (3 - 2 * tc)
      shared.uDrop.value = LIFT * (1 - Math.min(1, Math.max(0.06, (dist - 1) / 0.6)))
    },
    dispose() {
      trailGeom.dispose()
      highlightGeom.dispose()
      quad.dispose()
      trailMaterial.dispose()
      highlightMaterial.dispose()
      groupMaterial.dispose()
    },
  }
}
