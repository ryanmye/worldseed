// typology: invented glyphs by stroke grammar (language-typology-scripts.md §6.1, §6.3). Pure and deterministic in (world seed,
// family, script id); nothing is stored in History. Imported by the UI only (ui/scriptData.ts caches what it asks for).
//
// A family draws a style ('script-family-<family>'): an anchor grid of 3 or 4, an angularity (1 incised straight lines, 0 brush
// curves), the line directions it favours, 6-10 primitives (line, arc, hook, dot, loop, chevron, wave), a stroke width of 6-12%
// of the em, its terminals, a headline now and then and a slant. A glyph has k = 1 + Binomial(4, 0.5) strokes (mean 3, after
// Changizi & Shimojo 2005: about three strokes per character across writing systems whatever their size), each stroke after the
// first touching an earlier one with chance 0.7 [A]. A candidate within Hamming distance SCRIPT_GLYPH.minHam of an accepted
// glyph of the same script (8x8 raster signatures) is redrawn, up to 40 times, then the farthest is taken (their ~50%
// redundancy is why glyphs are kept well apart; the threshold is [A]). A daughter script keeps its parent's glyph for a sign the
// parent has, transformed when the script was derived (keep 0.5, drop the shortest stroke 0.2, straighten to an arc 0.15, add a
// stroke 0.1; mirrored when its direction flips between left-to-right and right-to-left); signs the parent lacks are the
// nearest sign's glyph with a diacritic stroke. Daughters do not simplify systematically (Miton & Morin 2021 found little sign
// of complexity falling over time or at borrowing).

import { createRng, type Rng } from '../../rng.ts'
import { hypotD } from '../../detMath.ts'

export const SCRIPT_GLYPH = { minHam: 6, retries: 40 } as const

/** A stroke: points on the 0-100 box; `curve` bends it through a control point (quadratic). */
export interface Stroke { x0: number; y0: number; x1: number; y1: number; cx?: number; cy?: number }
/** A glyph: its segments, its pen strokes (connected segments count once) and its raster signature. */
export interface Glyph { strokes: Stroke[]; count: number; sig: [number, number] }
export interface FamilyStyle {
  grid: number
  angular: number
  prims: string[]
  width: number
  terminal: 'round' | 'square' | 'butt'
  headline: boolean
  slant: number
}

const PRIMS = ['line', 'arc', 'hook', 'dot', 'loop', 'chevron', 'wave']

export function familyStyle(seed: number, family: number): FamilyStyle {
  const r = createRng(seed, `script-family-${family}`)
  const grid = r.next() < 0.5 ? 3 : 4
  const angular = r.next()
  const prims = PRIMS.slice()
  r.shuffle(prims)
  const k = 6 + r.int(0, 1)
  const chosen = ['line'].concat(prims.filter((p) => p !== 'line').slice(0, k - 1))
  return { grid, angular, prims: chosen, width: 6 + Math.round(r.next() * 6), terminal: (['round', 'square', 'butt'] as const)[r.int(0, 2)], headline: r.next() < 0.15, slant: -10 + r.next() * 25 }
}

function anchor(st: FamilyStyle, r: Rng): [number, number] {
  const g = st.grid
  const step = 80 / (g - 1)
  return [10 + r.int(0, g - 1) * step, 10 + r.int(0, g - 1) * step]
}

function stroke(st: FamilyStyle, r: Rng, from?: [number, number]): Stroke[] {
  const p = st.prims[r.int(0, st.prims.length - 1)]
  const [x0, y0] = from ?? anchor(st, r)
  let [x1, y1] = anchor(st, r)
  if (x1 === x0 && y1 === y0) { x1 = 100 - x0; y1 = y0 === 50 ? 90 : 100 - y0 }
  const curvy = r.next() > st.angular
  const mid = (a: number, b: number) => (a + b) / 2
  switch (p) {
    case 'dot': return [{ x0, y0, x1: x0 + 4, y1: y0 + 4 }]
    case 'arc': case 'hook': {
      const bend = (p === 'hook' ? 30 : 18) * (r.next() < 0.5 ? -1 : 1)
      return [{ x0, y0, x1, y1, cx: mid(x0, x1) + bend, cy: mid(y0, y1) - bend }]
    }
    case 'loop': return [{ x0, y0, x1, y1, cx: x1 + 25, cy: y0 - 25 }, { x0: x1, y0: y1, x1: x0, y1: y0, cx: x0 - 25, cy: y1 + 25 }]
    case 'chevron': { const mx = mid(x0, x1) + (y1 - y0) * 0.4, my = mid(y0, y1) - (x1 - x0) * 0.4; return [{ x0, y0, x1: mx, y1: my }, { x0: mx, y0: my, x1, y1 }] }
    case 'wave': return [{ x0, y0, x1: mid(x0, x1), y1: mid(y0, y1), cx: x0 + 10, cy: mid(y0, y1) - 15 }, { x0: mid(x0, x1), y0: mid(y0, y1), x1, y1, cx: x1 - 10, cy: mid(y0, y1) + 15 }]
    default: return curvy ? [{ x0, y0, x1, y1, cx: mid(x0, x1) + 8, cy: mid(y0, y1) - 8 }] : [{ x0, y0, x1, y1 }]
  }
}

/** 1 + Binomial(4, 0.5) strokes (a primitive may draw two segments). */
export function drawGlyph(st: FamilyStyle, r: Rng, strokesWanted?: number): Glyph {
  let k = 1
  if (strokesWanted === undefined) for (let i = 0; i < 4; i++) if (r.next() < 0.5) k++
  const n = strokesWanted ?? k
  const out: Stroke[] = []
  for (let i = 0; i < n; i++) {
    let from: [number, number] | undefined
    if (out.length && r.next() < 0.7) { const s = out[r.int(0, out.length - 1)]; from = r.next() < 0.5 ? [s.x0, s.y0] : [s.x1, s.y1] }
    out.push(...stroke(st, r, from))
  }
  return { strokes: out, count: n, sig: signature(out) }
}


/** 8x8 raster of the strokes as 64 bits (two 32-bit halves). */
export function signature(strokes: readonly Stroke[]): [number, number] {
  let a = 0, b = 0
  for (const s of strokes) {
    for (let t = 0; t <= 1.0001; t += 1 / 24) {
      const u = 1 - t
      const x = s.cx === undefined ? u * s.x0 + t * s.x1 : u * u * s.x0 + 2 * u * t * s.cx + t * t * s.x1
      const y = s.cy === undefined ? u * s.y0 + t * s.y1 : u * u * s.y0 + 2 * u * t * s.cy! + t * t * s.y1
      const cx = Math.max(0, Math.min(7, Math.floor(x / 12.5))), cy = Math.max(0, Math.min(7, Math.floor(y / 12.5)))
      const bit = cy * 8 + cx
      if (bit < 32) a |= 1 << bit
      else b |= 1 << (bit - 32)
    }
  }
  return [a >>> 0, b >>> 0]
}
function pop(x: number): number { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 }
export function hamming(a: readonly [number, number], b: readonly [number, number]): number {
  return pop((a[0] ^ b[0]) >>> 0) + pop((a[1] ^ b[1]) >>> 0)
}

/** A glyph apart from `taken` (see the file comment). */
export function distinctGlyph(st: FamilyStyle, r: Rng, taken: readonly Glyph[], strokes?: number): Glyph {
  let best: Glyph | null = null, bd = -1
  for (let t = 0; t <= SCRIPT_GLYPH.retries; t++) {
    const g = drawGlyph(st, r, strokes)
    let d = 64
    for (const x of taken) { const h = hamming(g.sig, x.sig); if (h < d) d = h }
    if (d >= SCRIPT_GLYPH.minHam) return g
    if (d > bd) { bd = d; best = g }
  }
  return best!
}

/** A derived script's version of a parent glyph (see the file comment); `mirror` on a direction flip. */
export function deriveGlyph(g: Glyph, st: FamilyStyle, r: Rng, mirror: boolean, derived: boolean): Glyph {
  let s = g.strokes.map((x) => ({ ...x }))
  let count = g.count
  if (derived) {
    const u = r.next()
    if (u < 0.5) { /* keep */ } else if (u < 0.7 && s.length > 1) {
      let k = 0, len = Infinity
      s.forEach((x, i) => { const l = hypotD(x.x1 - x.x0, x.y1 - x.y0); if (l < len) { len = l; k = i } })
      s.splice(k, 1)
      count = Math.max(1, count - 1)
    } else if (u < 0.85) s = s.map((x) => (x.cx === undefined ? { ...x, cx: (x.x0 + x.x1) / 2 + 10, cy: (x.y0 + x.y1) / 2 - 10 } : x))
    else { s.push(...stroke(st, r)); count++ }
  }
  if (mirror) s = s.map((x) => ({ ...x, x0: 100 - x.x0, x1: 100 - x.x1, cx: x.cx === undefined ? undefined : 100 - x.cx }))
  return { strokes: s, count, sig: signature(s) }
}
/** The nearest sign's glyph with a diacritic stroke (a dot or a bar), for a sign the parent lacks. */
export function diacritic(g: Glyph, r: Rng): Glyph {
  const dot = r.next() < 0.5
  const extra: Stroke = dot ? { x0: 86, y0: 6, x1: 90, y1: 10 } : { x0: 20, y0: 96, x1: 80, y1: 96 }
  const s = g.strokes.concat([extra])
  return { strokes: s, count: g.count + 1, sig: signature(s) }
}

/** SVG path data over the 0-100 box. */
export function pathOf(g: Glyph): string {
  let d = ''
  for (const s of g.strokes) {
    d += `M${Math.round(s.x0)} ${Math.round(s.y0)}`
    d += s.cx === undefined ? `L${Math.round(s.x1)} ${Math.round(s.y1)}` : `Q${Math.round(s.cx)} ${Math.round(s.cy!)} ${Math.round(s.x1)} ${Math.round(s.y1)}`
  }
  return d
}
