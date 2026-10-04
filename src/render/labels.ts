// Map labels: named geography (continents, oceans, seas, rivers, ranges, ...) and
// settlement names, drawn as atlas-style text with a soft dark halo on a 2D canvas
// laid over the globe (crisp at any pixel ratio, no DOM layout at all).
//
// Typography follows the kind: oceans and seas in spaced blue-grey italics, large and
// faint; continents in wide-tracked capitals; rivers in small italics along their
// course and ranges in small spaced capitals along their crest; deserts and forests
// subdued; cities bold, towns regular, villages small and only up close.
//
// Level of detail and decluttering: each candidate must be big enough on screen for its
// text (an estimate from its size in cells and the scale at its anchor), then labels
// are placed greedily by priority (kind, size, tier) and any whose boxes overlap an
// already placed one are dropped. Labels shown last time get a priority bonus and looser
// size thresholds (hysteresis), so the choice is stable while the globe rotates.
// Labels fade near the limb and are hidden on the far side; showing and hiding fade
// over a fraction of a second (the layer asks for frames only while a fade runs).
//
// A feature has no label before its namedYear; its label then fades in over FADE_YEARS
// years of history with a brief glow, a pure function of the year (scrubbing back removes it).
//
// The layer redraws only when the camera, the planet's rotation, the year, the viewport,
// the selection or the visibility changed, or a fade is running.

import * as THREE from 'three'
import { CITY_POPULATION, FeatureKind, TOWN_POPULATION, type GeoFeature, type History, type World } from '../contract.ts'
import { surfaceRadius } from './globe.ts'
import { reliefRadius } from './terrainHeight.ts'
import { equalEarthKx, equalEarthLat, equalEarthY, flat, flatLam, placeFlat } from './mapProjection.ts'
import { requestRender } from './invalidate.ts'

/** A newly named feature's label fades in over this many years, and glows for GLOW_YEARS. */
const FADE_YEARS = 18
const GLOW_YEARS = 70
/** A change of the year by more than this between two updates counts as a jump (see layout). */
const JUMP_YEARS = 25
/** Real-time fade speed for labels appearing and disappearing (alpha per second). */
const FADE_PER_SEC = 4.5
/** Height of label anchors above the ground. */
const LIFT = 0.004
/** Settlement labels: tiers shown from these camera distances in (hysteresis: show, hide). */
const TOWN_DIST: [number, number] = [2.45, 2.65]
const VILLAGE_DIST: [number, number] = [1.6, 1.72]
/** Collision grid cell size in CSS pixels, and padding around each label box. */
const GRID = 48
const PAD = 3
/** Halo width in CSS pixels. */
const HALO = 3.2

const SERIF = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif"
const SANS = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"

interface Style {
  italic: boolean
  weight: number
  family: string
  /** Font size range in CSS px (by feature size within its kind). */
  size: [number, number]
  /** Letter spacing as a fraction of the font size. */
  tracking: number
  upper: boolean
  /** Text colour (r, g, b) and opacity. */
  rgb: string
  alpha: number
  halo: number
  /** Base priority and its increase per unit of the feature's size measure. */
  priority: number
}

const FEATURE_STYLE: Record<number, Style> = {
  [FeatureKind.Ocean]: { italic: true, weight: 400, family: SERIF, size: [15, 19], tracking: 0.42, upper: true, rgb: '168,196,222', alpha: 0.72, halo: 0.45, priority: 880 },
  [FeatureKind.Sea]: { italic: true, weight: 400, family: SERIF, size: [12, 14.5], tracking: 0.2, upper: false, rgb: '170,202,228', alpha: 0.82, halo: 0.55, priority: 600 },
  [FeatureKind.Continent]: { italic: false, weight: 600, family: SERIF, size: [13, 19], tracking: 0.55, upper: true, rgb: '246,236,214', alpha: 0.82, halo: 0.6, priority: 900 },
  [FeatureKind.Island]: { italic: false, weight: 400, family: SERIF, size: [11, 12.5], tracking: 0.06, upper: false, rgb: '242,232,212', alpha: 0.9, halo: 0.7, priority: 450 },
  [FeatureKind.Lake]: { italic: true, weight: 400, family: SERIF, size: [10.5, 12], tracking: 0.05, upper: false, rgb: '160,212,240', alpha: 0.92, halo: 0.7, priority: 420 },
  [FeatureKind.River]: { italic: true, weight: 400, family: SERIF, size: [10.5, 12], tracking: 0.08, upper: false, rgb: '150,204,244', alpha: 0.95, halo: 0.75, priority: 380 },
  [FeatureKind.MountainRange]: { italic: false, weight: 400, family: SERIF, size: [9.5, 11], tracking: 0.32, upper: true, rgb: '232,206,172', alpha: 0.9, halo: 0.75, priority: 380 },
  [FeatureKind.Desert]: { italic: true, weight: 400, family: SERIF, size: [11, 13], tracking: 0.3, upper: true, rgb: '226,206,160', alpha: 0.62, halo: 0.5, priority: 400 },
  [FeatureKind.Forest]: { italic: true, weight: 400, family: SERIF, size: [11, 13], tracking: 0.22, upper: false, rgb: '176,214,160', alpha: 0.62, halo: 0.5, priority: 400 },
}

const CITY_STYLE: Style = { italic: false, weight: 700, family: SANS, size: [12.5, 12.5], tracking: 0.01, upper: false, rgb: '255,250,240', alpha: 1, halo: 0.8, priority: 800 }
const TOWN_STYLE: Style = { italic: false, weight: 500, family: SANS, size: [11.5, 11.5], tracking: 0, upper: false, rgb: '242,236,224', alpha: 0.95, halo: 0.75, priority: 500 }
const VILLAGE_STYLE: Style = { italic: false, weight: 400, family: SANS, size: [10.5, 10.5], tracking: 0, upper: false, rgb: '226,220,208', alpha: 0.85, halo: 0.7, priority: 300 }
/** Region labels (polities): wide-spaced capitals across the territory, in a pale tint of the region's colour; sized by area and rank. */
const REGION_SIZE: [number, number] = [10.5, 18.5]
const REGION_BASE: Omit<Style, 'rgb'> = { italic: false, weight: 600, family: SERIF, size: REGION_SIZE, tracking: 0.42, upper: true, alpha: 0.9, halo: 0.72, priority: 860 }

/** A label across a region (a polity's territory); see LabelLayer.setRegions. */
export interface RegionLabel {
  /** Stable key (the polity id) for fades and hysteresis. */
  key: number
  name: string
  /** Anchor cell, well inside the region. */
  cell: number
  /** Area in cells (sizes the text and decides whether it fits). */
  cells: number
  /** Text colour "r,g,b" (0..255). */
  rgb: string
  /** 0 small (a chiefdom) .. 2 large (an empire): larger, and placed first. */
  rank: number
}

interface RegionState {
  r: RegionLabel
  style: Style
  text: Text
  pos: THREE.Vector3
  extent: number
  alpha: number
  shown: boolean
}

/** Rendered text of one label at one style. */
interface Text {
  text: string
  font: string
  size: number
  /** Per-glyph advance including tracking (glyph mode), and the total width. */
  glyphs: string[]
  advances: Float32Array
  width: number
  /** Drawn glyph by glyph (letter-spaced or curved) rather than as one string. */
  glyphMode: boolean
}

interface FeatureLabel {
  f: GeoFeature
  style: Style
  text: Text
  /** Anchor position on the planet (object space). */
  pos: THREE.Vector3
  /** Smoothed path for rivers and ranges (object space xyz), with the anchor's arc fraction. */
  path: Float32Array | null
  pathAnchor: number
  /** Diameter (blobs) or length (rivers, ranges) in planet units. */
  extent: number
  alpha: number
  shown: boolean
}

interface SettlementLabel {
  id: number
  pos: THREE.Vector3
  texts: [Text, Text, Text]
  alpha: number
  shown: boolean
  tier: number
  /** Last placement side (0 right, 1 left, 2 above, 3 below), kept while it fits. */
  side: number
}

/** One placed (or fading) label for drawing: straight text or glyphs along a path. */
interface Placement {
  text: Text
  style: Style
  alpha: number
  glow: number
  /** Straight: anchor and alignment; curved: per-glyph x, y, angle. */
  x: number
  y: number
  align: CanvasTextAlign
  angle: number
  gx: Float32Array | null
  gy: Float32Array | null
  ga: Float32Array | null
  selected: boolean
}

export interface LabelSource {
  /** Interpolated population of settlement `id` at the current time (0 when not alive). */
  population(id: number): number
}

export interface LabelLayer {
  readonly canvas: HTMLCanvasElement
  setVisible(show: boolean): void
  /** The year shown; `playing` when it advances by playback (never counted as a jump, see layout). */
  setYear(year: number, playing?: boolean): void
  setSelected(id: number): void
  setHovered(id: number): void
  /** Known-world mask: per cell, the year from which labels anchored there show (1e9 never); null shows all. */
  setKnownMask(cellYear: Float32Array | null): void
  /** Region labels (polity names across their territory), replaced whenever the regions change (null: none). */
  setRegions?(regions: readonly RegionLabel[] | null): void
  /** Redraw if anything changed. cssWidth/cssHeight: viewport in CSS pixels. */
  update(camera: THREE.PerspectiveCamera, planet: THREE.Object3D, cssWidth: number, cssHeight: number): void
  dispose(): void
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Chaikin corner cutting on a 3D polyline (keeps the end points). */
function chaikin(pts: number[], rounds: number): number[] {
  let p = pts
  for (let r = 0; r < rounds; r++) {
    const n = p.length / 3
    if (n < 3) return p
    const out: number[] = [p[0], p[1], p[2]]
    for (let i = 0; i + 1 < n; i++) {
      for (const t of [0.25, 0.75]) {
        if ((i === 0 && t === 0.25) || (i === n - 2 && t === 0.75)) continue
        out.push(p[i * 3] + (p[i * 3 + 3] - p[i * 3]) * t, p[i * 3 + 1] + (p[i * 3 + 4] - p[i * 3 + 1]) * t, p[i * 3 + 2] + (p[i * 3 + 5] - p[i * 3 + 2]) * t)
      }
    }
    out.push(p[(n - 1) * 3], p[(n - 1) * 3 + 1], p[(n - 1) * 3 + 2])
    p = out
  }
  return p
}

/** Collision boxes in a uniform grid. */
class BoxGrid {
  private cells = new Map<number, number[]>()
  private boxes: number[] = []
  clear(): void {
    this.cells.clear()
    this.boxes.length = 0
  }
  private key(cx: number, cy: number): number {
    return (cy + 1024) * 4096 + (cx + 1024)
  }
  hits(x0: number, y0: number, x1: number, y1: number): boolean {
    const b = this.boxes
    for (let cy = Math.floor(y0 / GRID); cy <= Math.floor(y1 / GRID); cy++) {
      for (let cx = Math.floor(x0 / GRID); cx <= Math.floor(x1 / GRID); cx++) {
        const list = this.cells.get(this.key(cx, cy))
        if (!list) continue
        for (const i of list) if (b[i] < x1 && b[i + 2] > x0 && b[i + 1] < y1 && b[i + 3] > y0) return true
      }
    }
    return false
  }
  add(x0: number, y0: number, x1: number, y1: number): void {
    const i = this.boxes.length
    this.boxes.push(x0, y0, x1, y1)
    for (let cy = Math.floor(y0 / GRID); cy <= Math.floor(y1 / GRID); cy++) {
      for (let cx = Math.floor(x0 / GRID); cx <= Math.floor(x1 / GRID); cx++) {
        const k = this.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(i)
        else this.cells.set(k, [i])
      }
    }
  }
}

/** `normYear`: label sizes are scaled by the largest feature of each kind named by then (so a longer history does not resize earlier labels). */
export function createLabelLayer(container: HTMLElement, before: Node | null, world: World, history: History, source: LabelSource, normYear = Infinity): LabelLayer {
  const canvas = document.createElement('canvas')
  canvas.className = 'label-layer'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block'
  container.insertBefore(canvas, before)
  const ctx = canvas.getContext('2d')!
  const P = world.grid.positions
  const N = world.grid.cellCount
  const cellArea = (4 * Math.PI) / N
  const cellSpacing = Math.sqrt(cellArea) * 1.07

  const measure = (raw: string, style: Style, size: number): Text => {
    const text = style.upper ? raw.toUpperCase() : raw
    const font = `${style.italic ? 'italic ' : ''}${style.weight} ${size.toFixed(1)}px ${style.family}`
    ctx.font = font
    const track = style.tracking * size
    const glyphs = Array.from(text)
    const advances = new Float32Array(glyphs.length)
    let width = 0
    for (let i = 0; i < glyphs.length; i++) {
      advances[i] = ctx.measureText(glyphs[i]).width + (i < glyphs.length - 1 ? track : 0)
      width += advances[i]
    }
    const glyphMode = track > 0.4
    if (!glyphMode) width = ctx.measureText(text).width
    return { text, font, size, glyphs, advances, width, glyphMode }
  }
  const cellPos = (c: number, out: THREE.Vector3) => {
    const r = surfaceRadius(world, c) + LIFT
    return out.set(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r)
  }

  // ---- features
  const features: GeoFeature[] = Array.isArray((history as Partial<History>).features) ? history.features : []
  const maxSize: number[] = []
  for (const f of features) if (f.namedYear <= normYear) maxSize[f.kind] = Math.max(maxSize[f.kind] ?? 1, f.size)
  const later: number[] = []
  for (const f of features) if (maxSize[f.kind] === undefined) later[f.kind] = Math.max(later[f.kind] ?? 1, f.size)
  later.forEach((m, k) => (maxSize[k] = m))
  const featureLabels: FeatureLabel[] = []
  for (const f of features) {
    const style = FEATURE_STYLE[f.kind]
    if (!style || f.anchorCell < 0 || f.anchorCell >= N) continue
    const rel = Math.sqrt(Math.min(1, f.size / Math.max(1, maxSize[f.kind])))
    const size = style.size[0] + (style.size[1] - style.size[0]) * rel
    const line = f.kind === FeatureKind.River || f.kind === FeatureKind.MountainRange
    let path: Float32Array | null = null
    let pathAnchor = 0.5
    if (line && f.spine.length >= 2) {
      const raw: number[] = []
      const v = new THREE.Vector3()
      for (const c of f.spine) {
        if (c < 0 || c >= N) continue
        cellPos(c, v)
        raw.push(v.x, v.y, v.z)
      }
      // ranges: a running mean first, the crest path is jagged
      let pts = raw
      if (f.kind === FeatureKind.MountainRange && raw.length >= 15) {
        const n = raw.length / 3
        const avg: number[] = []
        for (let i = 0; i < n; i++) {
          let x = 0, y = 0, z = 0, w = 0
          for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) { x += raw[k * 3]; y += raw[k * 3 + 1]; z += raw[k * 3 + 2]; w++ }
          avg.push(x / w, y / w, z / w)
        }
        pts = avg
      }
      path = Float32Array.from(chaikin(pts, 3))
      const ai = f.spine.indexOf(f.anchorCell)
      pathAnchor = ai >= 0 && f.spine.length > 1 ? ai / (f.spine.length - 1) : 0.5
      if (f.kind === FeatureKind.MountainRange) pathAnchor = 0.5
    }
    featureLabels.push({
      f,
      style,
      text: measure(f.name, style, size),
      pos: cellPos(f.anchorCell, new THREE.Vector3()),
      path,
      pathAnchor,
      extent: line ? f.size * cellSpacing : 2 * Math.sqrt((f.size * cellArea) / Math.PI),
      alpha: 0,
      shown: false,
    })
  }

  // ---- settlements (texts measured lazily: most villages are never labelled)
  const settlementLabels: (SettlementLabel | null)[] = new Array(history.settlements.length).fill(null)
  const settlementLabel = (id: number): SettlementLabel => {
    let l = settlementLabels[id]
    if (!l) {
      const s = history.settlements[id]
      const name = s.name || `Settlement #${id}`
      l = {
        id,
        pos: cellPos(s.cell, new THREE.Vector3()),
        texts: [measure(name, VILLAGE_STYLE, VILLAGE_STYLE.size[0]), measure(name, TOWN_STYLE, TOWN_STYLE.size[0]), measure(name, CITY_STYLE, CITY_STYLE.size[0])],
        alpha: 0,
        shown: false,
        tier: 0,
        side: 0,
      }
      settlementLabels[id] = l
    }
    return l
  }

  let visible = true
  let year = 0
  let selected = -1
  let hovered = -1
  let knownMask: Float32Array | null = null
  /** Region labels by key (kept across updates for their fades). */
  const regionLabels = new Map<number, RegionState>()
  let dirty = true
  let lastTime = -1
  let dpr = 1
  const lastCam = new Float64Array(16)
  const lastPlanet = new Float64Array(16)
  let lastYear = NaN
  let playing = false
  let lastW = 0, lastH = 0, lastFov = 0
  let lastFlat = -1

  const mvp = new THREE.Matrix4()
  const invPlanet = new THREE.Matrix4()
  const camLocal = new THREE.Vector3()
  const grid = new BoxGrid()
  const placements: Placement[] = []
  const v4 = new THREE.Vector4()

  /**
   * Projects a local point: writes screen x, y (CSS px), clip w and facing into proj; false
   * when behind the camera. On the flat map (mapProjection.ts) also its longitude from the
   * central meridian (proj.lam), and everything faces the viewer.
   */
  const proj = { x: 0, y: 0, w: 1, facing: 0, lam: 0 }
  const flatTmp = new THREE.Vector3()
  let W = 1, H = 1
  const project = (x: number, y: number, z: number): boolean => {
    // where the ground under the anchor is drawn at the zoom's relief (terrainHeight.ts ws_relief)
    const rr = Math.hypot(x, y, z)
    if (rr > 1) {
      const f = reliefRadius(rr) / rr
      x *= f; y *= f; z *= f
    }
    if (flat.t > 0) {
      proj.lam = flatLam(x, z)
      placeFlat(flatTmp.set(x, y, z))
      v4.set(flatTmp.x, flatTmp.y, flatTmp.z, 1).applyMatrix4(mvp)
    } else v4.set(x, y, z, 1).applyMatrix4(mvp)
    if (v4.w <= 1e-6) return false
    proj.x = (v4.x / v4.w + 1) * 0.5 * W
    proj.y = (1 - v4.y / v4.w) * 0.5 * H
    proj.w = v4.w
    const dx = camLocal.x - x, dy = camLocal.y - y, dz = camLocal.z - z
    const r = Math.hypot(x, y, z), d = Math.hypot(dx, dy, dz)
    proj.facing = (x * dx + y * dy + z * dz) / (r * d)
    if (flat.t > 0) proj.facing += (1 - proj.facing) * flat.t
    return true
  }

  const glyphX: Float32Array[] = []
  const glyphY: Float32Array[] = []
  const glyphA: Float32Array[] = []
  let glyphSlot = 0
  const slot = (n: number): [Float32Array, Float32Array, Float32Array] => {
    if (glyphSlot >= glyphX.length || glyphX[glyphSlot].length < n) {
      glyphX[glyphSlot] = new Float32Array(Math.max(n, 32))
      glyphY[glyphSlot] = new Float32Array(Math.max(n, 32))
      glyphA[glyphSlot] = new Float32Array(Math.max(n, 32))
    }
    const s = glyphSlot++
    return [glyphX[s], glyphY[s], glyphA[s]]
  }

  // scratch for path layout
  let sx = new Float32Array(256), sy = new Float32Array(256), sl = new Float32Array(256), sf = new Float32Array(256)

  /**
   * Lays a label's text along its path on screen around the anchor. Returns the minimum
   * facing over the glyphs (or -1 when it cannot be laid out: off the visible side, too
   * short at this zoom, or too sharply bent), filling the placement's glyph arrays.
   */
  const layoutCurved = (l: FeatureLabel, pl: Placement, minFit: number): number => {
    const path = l.path!
    const n = path.length / 3
    if (sx.length < n) { sx = new Float32Array(n * 2); sy = new Float32Array(n * 2); sl = new Float32Array(n * 2); sf = new Float32Array(n * 2) }
    let L = 0
    // visible run of the path around the anchor
    const ai = Math.round(l.pathAnchor * (n - 1))
    let a = ai, b = ai
    // (on the flat map a path stops at the antimeridian, where it would jump across the map)
    let lamA = 0
    const vis = (i: number) => project(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]) && proj.facing > 0.05 && (flat.t <= 0 || Math.abs(proj.lam - lamA) < 2)
    if (flat.t > 0 && project(path[ai * 3], path[ai * 3 + 1], path[ai * 3 + 2])) lamA = proj.lam
    if (!vis(ai)) return -1
    while (a > 0 && vis(a - 1)) a--
    while (b < n - 1 && vis(b + 1)) b++
    const m = b - a + 1
    if (m < 2) return -1
    for (let i = 0; i < m; i++) {
      project(path[(a + i) * 3], path[(a + i) * 3 + 1], path[(a + i) * 3 + 2])
      sx[i] = proj.x
      sy[i] = proj.y
      sf[i] = proj.facing
      if (i > 0) L += Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1])
      sl[i] = L
    }
    if (L < l.text.width * minFit) return -1
    // centre the text on the anchor's arc position, kept inside the path (squeezed when a little short)
    const spread = Math.min(1, L / l.text.width)
    const tw = l.text.width * spread
    const s0 = Math.max(0, Math.min(L - tw, sl[ai - a] - tw / 2))
    // how far toward the limb the text itself reaches
    let minFacing = 1
    for (let i = 0; i < m; i++) if (sl[i] >= s0 - 8 && sl[i] <= s0 + tw + 8 && sf[i] < minFacing) minFacing = sf[i]
    // read left to right
    const pointAt = (s: number, out: number[]) => {
      let i = 1
      while (i < m - 1 && sl[i] < s) i++
      const seg = sl[i] - sl[i - 1] || 1
      const t = Math.min(1, Math.max(0, (s - sl[i - 1]) / seg))
      out[0] = sx[i - 1] + (sx[i] - sx[i - 1]) * t
      out[1] = sy[i - 1] + (sy[i] - sy[i - 1]) * t
    }
    const p0 = [0, 0], p1 = [0, 0]
    pointAt(s0, p0)
    pointAt(s0 + tw, p1)
    const reverse = p1[0] < p0[0]
    const g = l.text
    const count = g.glyphs.length
    const [gx, gy, ga] = slot(count)
    let s = s0
    const sz = g.size
    const lift = l.f.kind === FeatureKind.River ? -0.55 * sz : 0 // rivers: text sits just above the line
    let prevA = NaN
    for (let k = 0; k < count; k++) {
      const adv = g.advances[k] * spread
      const mid = reverse ? s0 + tw - (s - s0) - adv / 2 : s + adv / 2
      const h = Math.max(3, sz * 0.6)
      pointAt(mid - h, p0)
      pointAt(mid + h, p1)
      let ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
      if (reverse) ang += Math.PI
      if (ang > Math.PI) ang -= 2 * Math.PI
      if (!Number.isNaN(prevA)) {
        let d = Math.abs(ang - prevA)
        if (d > Math.PI) d = 2 * Math.PI - d
        if (d > 0.75) return -1
      }
      prevA = ang
      const cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2
      gx[k] = cx - Math.sin(ang) * lift
      gy[k] = cy + Math.cos(ang) * lift
      ga[k] = ang
      s += adv
    }
    pl.gx = gx
    pl.gy = gy
    pl.ga = ga
    return minFacing
  }

  /** The globe's outline on screen (centre and radius, CSS px): labels stay inside it. */
  const disk = { x: 0, y: 0, r2: 0 }
  /** On the flat map: screen pixels per map unit and the map y of the clip latitude (labels stay on the map). */
  const mapClip = { on: false, k: 1, yTop: 1 }
  const onMap = (x: number, y: number) => {
    const my = flat.y0 - (y - H / 2) / mapClip.k
    if (Math.abs(my) > mapClip.yTop) return false
    return Math.abs((x - W / 2) / mapClip.k) <= Math.PI * equalEarthKx(equalEarthLat(my))
  }
  const onDisk = (x: number, y: number) => (mapClip.on ? onMap(x, y) : (x - disk.x) * (x - disk.x) + (y - disk.y) * (y - disk.y) <= disk.r2)

  /** Collision boxes of a placement; returns false (adding nothing) when one overlaps or it leaves the globe. */
  const tryPlace = (pl: Placement, commit: boolean): boolean => {
    const t = pl.text
    const hh = t.size * 0.62 + PAD
    if (pl.gx) {
      const r = t.size * 0.55 + PAD
      for (let k = 0; k < t.glyphs.length; k++) if (!onDisk(pl.gx[k], pl.gy![k])) return false
      for (let k = 0; k < t.glyphs.length; k++) if (grid.hits(pl.gx[k] - r, pl.gy![k] - r, pl.gx[k] + r, pl.gy![k] + r)) return false
      if (commit) for (let k = 0; k < t.glyphs.length; k++) grid.add(pl.gx[k] - r, pl.gy![k] - r, pl.gx[k] + r, pl.gy![k] + r)
      return true
    }
    const x0 = pl.align === 'left' ? pl.x : pl.align === 'right' ? pl.x - t.width : pl.x - t.width / 2
    const box = [x0 - PAD, pl.y - hh, x0 + t.width + PAD, pl.y + hh]
    if (box[0] < 0 || box[2] > W || box[1] < 0 || box[3] > H) return false
    if (!onDisk(box[0] + PAD, box[1] + PAD) || !onDisk(box[2] - PAD, box[1] + PAD) || !onDisk(box[0] + PAD, box[3] - PAD) || !onDisk(box[2] - PAD, box[3] - PAD)) return false
    if (grid.hits(box[0], box[1], box[2], box[3])) return false
    if (commit) grid.add(box[0], box[1], box[2], box[3])
    return true
  }

  const newPlacement = (text: Text, style: Style): Placement => ({ text, style, alpha: 0, glow: 0, x: 0, y: 0, align: 'center', angle: 0, gx: null, gy: null, ga: null, selected: false })

  interface Cand { pri: number; feature: FeatureLabel | null; settlement: SettlementLabel | null; region?: RegionState; pl: Placement; ok: boolean; facing: number; r: number }

  const cands: Cand[] = []

  /**
   * Chooses and places the labels for the current view. `fresh` (after a jump in time, or the
   * first layout) forgets what was shown before and skips the fades, so the result is the same
   * as loading that year directly.
   */
  function layout(camera: THREE.PerspectiveCamera, planet: THREE.Object3D, dt: number, fresh: boolean): boolean {
    planet.updateWorldMatrix(true, false)
    mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(planet.matrixWorld)
    invPlanet.copy(planet.matrixWorld).invert()
    camera.getWorldPosition(camLocal).applyMatrix4(invPlanet)
    const camDist = camLocal.length()
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const pxPerUnit = (w: number) => H / (2 * tanHalf * w)
    const vmax = Math.max(W, H)
    // the planet's outline: centre projected, radius from the angle it subtends (a hair inside the limb)
    project(0, 0, 0.0001)
    disk.x = proj.x
    disk.y = proj.y
    const sinA = Math.min(0.9999, 1 / Math.max(1.0001, camDist))
    const rPx = (H / 2) * (sinA / Math.sqrt(1 - sinA * sinA)) / tanHalf
    disk.r2 = (rPx * 0.985) * (rPx * 0.985)
    // the flat map has no limb: the labels keep to the map (and to the screen during the morph)
    if (flat.t > 0) disk.r2 = Infinity
    mapClip.on = flat.t >= 1
    mapClip.k = H / (2 * tanHalf * Math.max(1e-4, camDist - 1))
    mapClip.yTop = equalEarthY(flat.poleClip)
    cands.length = 0
    glyphSlot = 0
    grid.clear()
    if (fresh) {
      for (const l of featureLabels) { l.shown = false; l.alpha = 0 }
      for (const l of settlementLabels) if (l) { l.shown = false; l.alpha = 0; l.side = 0 }
      for (const l of regionLabels.values()) { l.shown = false; l.alpha = 0 }
    }

    // features named by now
    for (const l of featureLabels) {
      const f = l.f
      if (year < f.namedYear || (knownMask !== null && year < knownMask[f.anchorCell])) {
        l.alpha = 0
        l.shown = false
        continue
      }
      const pl = newPlacement(l.text, l.style)
      const age = year - f.namedYear
      pl.glow = age < GLOW_YEARS ? 1 - age / GLOW_YEARS : 0
      const yearFade = smoothstep(0, FADE_YEARS, age) * 0.85 + 0.15
      const hyst = l.shown ? 0.82 : 1
      if (!project(l.pos.x, l.pos.y, l.pos.z) || proj.facing < 0.04) { l.alpha = 0; l.shown = false; continue }
      let facing = proj.facing
      const ext = l.extent * pxPerUnit(proj.w)
      const tw = l.text.width
      let ok: boolean
      switch (f.kind) {
        case FeatureKind.Continent:
        case FeatureKind.Ocean:
          ok = ext >= tw * 1.05 * hyst && ext < (5 * vmax) / hyst
          break
        case FeatureKind.Sea:
        case FeatureKind.Desert:
        case FeatureKind.Forest:
          ok = ext >= tw * 0.95 * hyst && ext < (2.5 * vmax) / hyst
          break
        case FeatureKind.Island:
        case FeatureKind.Lake:
          ok = ext >= 9 * hyst && ext < (2 * vmax) / hyst
          break
        default:
          ok = ext >= tw * 1.05 * hyst && ext < 6 * vmax
      }
      if (!ok && l.alpha <= 0) { l.shown = false; continue }
      if (l.path) {
        // rivers must fit their text along the visible course; ranges may squeeze it a little
        facing = layoutCurved(l, pl, f.kind === FeatureKind.River ? 1.08 * hyst : 0.8 * hyst)
        if (facing <= 0) { l.alpha = 0; l.shown = false; continue }
      } else {
        pl.x = proj.x
        pl.y = proj.y
        // islands and lakes small on screen: the name sits just below
        if ((f.kind === FeatureKind.Island || f.kind === FeatureKind.Lake) && ext < tw) pl.y = proj.y + ext / 2 + l.text.size * 0.75
      }
      pl.alpha = yearFade * smoothstep(0.08, 0.4, facing)
      const sizeRank = Math.sqrt(f.size / Math.max(1, maxSize[f.kind] ?? 1))
      let pri = l.style.priority + 60 * sizeRank
      if ((f.kind === FeatureKind.River || f.kind === FeatureKind.MountainRange) && sizeRank > 0.6) pri += 180
      if (pl.glow > 0) pri += 250
      if (l.shown) pri += 120
      cands.push({ pri, feature: l, settlement: null, pl, ok, facing, r: 0 })
    }

    // regions (polities): across their territory when it is wide enough on screen for the name
    for (const l of regionLabels.values()) {
      if (knownMask !== null && year < knownMask[l.r.cell]) { l.alpha = 0; l.shown = false; continue }
      if (!project(l.pos.x, l.pos.y, l.pos.z) || proj.facing < 0.05) { l.alpha = 0; l.shown = false; continue }
      const hyst = l.shown ? 0.85 : 1
      const ext = l.extent * pxPerUnit(proj.w)
      const ok = ext >= l.text.width * 0.92 * hyst && ext < (3.5 * vmax) / hyst
      if (!ok && l.alpha <= 0) { l.shown = false; continue }
      const pl = newPlacement(l.text, l.style)
      pl.x = proj.x
      pl.y = proj.y
      pl.alpha = smoothstep(0.08, 0.4, proj.facing)
      let pri = l.style.priority + 45 * l.r.rank + 40 * Math.min(1, Math.sqrt(l.r.cells / 600))
      if (l.shown) pri += 120
      cands.push({ pri, feature: null, settlement: null, region: l, pl, ok, facing: proj.facing, r: 0 })
    }

    // living settlements, by tier and zoom
    const sizeScale = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / camDist)))
    for (let id = 0; id < history.settlements.length; id++) {
      const existing = settlementLabels[id]
      const pop = source.population(id)
      if (pop <= 0 || (knownMask !== null && year < knownMask[history.settlements[id].cell])) {
        if (existing) { existing.alpha = 0; existing.shown = false }
        continue
      }
      const special = id === selected || id === hovered
      const isOutpostBase = (history.settlements[id] as { outpost?: boolean }).outpost === true
      // an expedition base is no village: named only while selected or hovered
      if (!special && isOutpostBase) {
        if (existing) { existing.alpha = 0; existing.shown = false }
        continue
      }
      const tier = pop >= CITY_POPULATION ? 2 : pop >= TOWN_POPULATION ? 1 : 0
      const wasShown = existing !== null && existing.shown
      const ok = special || tier === 2 || (tier === 1 && camDist < TOWN_DIST[wasShown ? 1 : 0]) || (tier === 0 && camDist < VILLAGE_DIST[wasShown ? 1 : 0])
      if (!ok && (!existing || existing.alpha <= 0)) continue
      const l = settlementLabel(id)
      if (!project(l.pos.x, l.pos.y, l.pos.z) || proj.facing < 0.04) { l.alpha = 0; l.shown = false; continue }
      l.tier = tier
      const style = tier === 2 ? CITY_STYLE : tier === 1 ? TOWN_STYLE : VILLAGE_STYLE
      const pl = newPlacement(l.texts[tier], style)
      pl.selected = special
      const facing = proj.facing
      pl.alpha = smoothstep(0.04, 0.32, facing)
      pl.x = proj.x
      pl.y = proj.y
      // keep clear of the marker (radius by tier, as in settlements.ts); an expedition base's
      // pennant stands on a pole well above its foot (outposts.ts), so it needs a much wider
      // berth than a settlement's flat marker or the name sits on top of the flag
      const r = isOutpostBase
        ? 18 * sizeScale * (0.55 + 0.45 * Math.sqrt(facing)) + 6
        : (tier === 2 ? 8 : tier === 1 ? 5.5 : 3) * sizeScale * (0.55 + 0.45 * Math.sqrt(facing)) + 3
      let pri = style.priority + Math.min(60, pop / (tier === 2 ? 2000 : tier === 1 ? 200 : 20))
      if (special) pri = 10000
      if (l.shown) pri += 120
      cands.push({ pri, feature: null, settlement: l, pl, ok, facing, r })
    }

    cands.sort((a, b) => b.pri - a.pri)
    placements.length = 0
    let animating = false
    const step = dt * FADE_PER_SEC
    for (const c of cands) {
      let placed = false
      if (c.ok && c.settlement) {
        // the side it had last time first, then right, left, above, below
        const l = c.settlement
        const bx = c.pl.x, by = c.pl.y
        for (let t = 0; t < 4 && !placed; t++) {
          const side = t === 0 ? l.side : t <= l.side ? t - 1 : t
          placeSide(c.pl, bx, by, c.r, side)
          if (tryPlace(c.pl, true)) { placed = true; l.side = side }
        }
        if (!placed) placeSide(c.pl, bx, by, c.r, l.side)
      } else if (c.ok) placed = tryPlace(c.pl, true)
      else if (c.settlement) placeSide(c.pl, c.pl.x, c.pl.y, c.r, c.settlement.side)
      const target = placed ? 1 : 0
      const holder = (c.feature ?? c.settlement ?? c.region)!
      holder.shown = placed
      if (fresh) holder.alpha = target
      else if (holder.alpha !== target) {
        holder.alpha = target > holder.alpha ? Math.min(1, holder.alpha + step) : Math.max(0, holder.alpha - step)
        if (holder.alpha !== target) animating = true
      }
      c.pl.alpha *= holder.alpha
      if (c.pl.alpha > 0.003) placements.push(c.pl)
    }
    return animating
  }

  /** Puts a settlement's name on one side of its marker at (bx, by): 0 right, 1 left, 2 above, 3 below. */
  function placeSide(pl: Placement, bx: number, by: number, r: number, side: number): void {
    const t = pl.text
    if (side === 0) { pl.x = bx + r; pl.y = by; pl.align = 'left' }
    else if (side === 1) { pl.x = bx - r; pl.y = by; pl.align = 'right' }
    else if (side === 2) { pl.x = bx; pl.y = by - r - t.size * 0.45; pl.align = 'center' }
    else { pl.x = bx; pl.y = by + r + t.size * 0.45; pl.align = 'center' }
  }

  function draw(): void {
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    ctx.lineJoin = 'round'
    ctx.textBaseline = 'middle'
    // draw low priority first so important labels sit on top of anything fading
    for (let i = placements.length - 1; i >= 0; i--) {
      const pl = placements[i]
      const st = pl.style
      const t = pl.text
      ctx.font = pl.selected ? t.font.replace(/\b[1-6]00\b/, '700') : t.font
      const a = Math.min(1, st.alpha + (pl.selected ? 0.3 : 0)) * pl.alpha
      const haloA = Math.min(1, st.halo + 0.25 * pl.glow) * pl.alpha
      const fill = pl.glow > 0 ? mixGlow(st.rgb, pl.glow) : st.rgb
      ctx.lineWidth = HALO + 1.5 * pl.glow
      ctx.strokeStyle = `rgba(6,10,18,${haloA.toFixed(3)})`
      ctx.fillStyle = `rgba(${fill},${Math.min(1, a + 0.25 * pl.glow).toFixed(3)})`
      if (pl.gx) {
        ctx.textAlign = 'center'
        for (let k = 0; k < t.glyphs.length; k++) {
          const ang = pl.ga![k], c = Math.cos(ang), s = Math.sin(ang)
          ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * pl.gx[k], dpr * pl.gy![k])
          ctx.strokeText(t.glyphs[k], 0, 0)
          ctx.fillText(t.glyphs[k], 0, 0)
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else if (t.glyphMode) {
        ctx.textAlign = 'left'
        let x = pl.align === 'left' ? pl.x : pl.align === 'right' ? pl.x - t.width : pl.x - t.width / 2
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const y = Math.round(pl.y * dpr) / dpr
        for (let k = 0; k < t.glyphs.length; k++) {
          ctx.strokeText(t.glyphs[k], x, y)
          ctx.fillText(t.glyphs[k], x, y)
          x += t.advances[k]
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else {
        ctx.textAlign = pl.align
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const x = Math.round(pl.x * dpr) / dpr, y = Math.round(pl.y * dpr) / dpr
        ctx.strokeText(t.text, x, y)
        ctx.fillText(t.text, x, y)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
    }
  }

  /** A newly named feature's text glows warm-white, settling to its own colour. */
  function mixGlow(rgb: string, g: number): string {
    const c = rgb.split(',').map(Number)
    const k = g * 0.7
    return `${Math.round(c[0] + (255 - c[0]) * k)},${Math.round(c[1] + (244 - c[1]) * k)},${Math.round(c[2] + (214 - c[2]) * k)}`
  }

  const same = (a: Float64Array, m: THREE.Matrix4) => {
    const e = m.elements
    let eq = true
    for (let i = 0; i < 16; i++) if (a[i] !== e[i]) { eq = false; a[i] = e[i] }
    return eq
  }

  return {
    canvas,
    setVisible(show: boolean) {
      if (show === visible) return
      visible = show
      canvas.style.display = show ? 'block' : 'none'
      dirty = true
      requestRender()
    },
    setYear(y: number, isPlaying = false) {
      year = y
      playing = isPlaying
    },
    setSelected(id: number) {
      if (id !== selected) { selected = id; dirty = true }
    },
    setHovered(id: number) {
      if (id !== hovered) { hovered = id; dirty = true }
    },
    setRegions(regions: readonly RegionLabel[] | null) {
      const keep = new Set<number>()
      for (const r of regions ?? []) {
        if (r.cell < 0 || r.cell >= N) continue
        keep.add(r.key)
        const size = Math.round((REGION_SIZE[0] + (REGION_SIZE[1] - REGION_SIZE[0]) * Math.min(1, Math.sqrt(r.cells / 700)) + r.rank * 1.2) * 2) / 2
        let l = regionLabels.get(r.key)
        if (!l || l.r.name !== r.name || l.text.size !== size || l.r.rgb !== r.rgb) {
          const style: Style = { ...REGION_BASE, rgb: r.rgb }
          const text = measure(r.name, style, size)
          l = { r, style, text, pos: l?.pos ?? new THREE.Vector3(), extent: 0, alpha: l?.alpha ?? 0, shown: l?.shown ?? false }
          regionLabels.set(r.key, l)
        }
        l.r = r
        cellPos(r.cell, l.pos)
        l.extent = 2 * Math.sqrt((r.cells * cellArea) / Math.PI)
      }
      for (const k of [...regionLabels.keys()]) if (!keep.has(k)) regionLabels.delete(k)
      dirty = true
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear && cellYear.length >= N ? cellYear : null
      dirty = true
      requestRender()
    },
    update(camera: THREE.PerspectiveCamera, planet: THREE.Object3D, cssWidth: number, cssHeight: number) {
      if (!visible) return
      planet.updateWorldMatrix(true, false)
      const camSame = same(lastCam, camera.matrixWorld)
      const planetSame = same(lastPlanet, planet.matrixWorld)
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const sizeSame = cssWidth === lastW && cssHeight === lastH && ratio === dpr && camera.fov === lastFov
      const flatSame = flat.version === lastFlat
      lastFlat = flat.version
      if (camSame && planetSame && sizeSame && flatSame && year === lastYear && !dirty) return
      // a jump in time (scrubbing, a new history) lays out afresh: no hysteresis, no fades
      const fresh = Number.isNaN(lastYear) || (!playing && !(Math.abs(year - lastYear) <= JUMP_YEARS))
      lastYear = year
      lastW = cssWidth
      lastH = cssHeight
      lastFov = camera.fov
      dpr = ratio
      W = Math.max(1, cssWidth)
      H = Math.max(1, cssHeight)
      const now = performance.now()
      // fades advance with real time, but at most a frame's worth after an idle spell
      const dt = lastTime < 0 ? 0.05 : Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now
      const animating = layout(camera, planet, dt, fresh)
      draw()
      dirty = animating
      if (animating) requestRender()
      else lastTime = -1
    },
    dispose() {
      canvas.remove()
    },
  }
}
