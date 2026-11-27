// typology: typological profiles per proto-language (language-typology-scripts.md §4.1-4.2). Pure in (world seed, the peoples'
// cradles and founding cells): no simulation state, so a longer run draws the same profiles.
//
// Each world draws an areal profile per cradle ('names-typo-world'): the syllable, tone and morphology groups by systematic
// sampling over the cradles (u_c = (π(c) + U) / C through the prior's inverse CDF), so a world's cradles span each distribution
// and no single "family" dominates; the inventory and vowel groups independently per cradle. A cradle near an earlier one copies
// each group of it with chance TYPO.nearCopy. Each people ('names-typo-<tribe>') keeps each group of its cradle with chance
// TYPO.arealKeep, else draws it afresh from the global prior; its inventory and syllable classes share a complexity factor z
// (weight TYPO.rho). Every draw is made whether or not it is used, so the draw order is fixed. A balance guard (no extra
// stream) redraws the tone and morphology of the people farthest from its cradle centre when more than half of the peoples
// agree on syllable, tone and morphology at once.
//
// No profile names or copies a real language or family: every feature is drawn on its own (§4.6 rule 1).

import { createRng, type Rng } from '../../rng.ts'
import { TYPO } from './params.ts'

/** How a language builds names (contract.ts MorphStyle mirrors these). */
export const Style = { Isolating: 0, Suffixing: 1, Prefixing: 2, Compounding: 3, RootPattern: 4 } as const
export const STYLE_NAMES = ['isolating', 'suffixing', 'prefixing', 'compounding', 'root-and-pattern'] as const

/** Series a profile may switch on (bits of TypoDraw.series). */
export const Series = {
  Voicing: 1, Aspirated: 2, Ejective: 4, Implosive: 8, Prenasal: 16, Retroflex: 32, Uvular: 64, Pharyngeal: 128,
  LabialVelar: 256, Labialised: 512, Lateral: 1024, Clicks: 2048, Dental: 4096,
} as const
/** The rare series (counted toward TYPO.markedPerWord). */
export const RARE_SERIES = Series.Ejective | Series.Implosive | Series.Pharyngeal | Series.LabialVelar | Series.Clicks | Series.Uvular

/** The drawn classes of one proto-language (inventory.ts turns them into a sound system). */
export interface TypoDraw {
  /** Consonant class 0..4 (TYPO.invRange) and the target size within it. */
  inv: number
  nCons: number
  /** Vowel class 0..2 (2-4, 5-6, 7-14) and the vowel qualities within it. */
  vow: number
  nVowels: number
  /** Syllable class: 0 simple, 1 moderate, 2 complex. */
  syl: number
  /** Tone: 0 none, 1 simple (H/L), 2 complex. */
  tone: number
  style: number
  /** Series bits (Series). */
  series: number
  length: boolean
  nasal: boolean
  harmony: boolean
  /** Compounds put the head first. */
  headInitial: boolean
  /** The cradle (People.cradle) whose areal profile it drew from. */
  cradle: number
}

function pickCat(prior: readonly number[], u: number): number {
  let acc = 0
  for (let i = 0; i < prior.length; i++) { acc += prior[i]; if (u < acc) return i }
  return prior.length - 1
}
function normal(rng: Rng): number {
  const u = 1 - rng.next(), v = rng.next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

interface Groups {
  /** G1: inventory class, size draw (uniform 0..1), series bits */
  inv: number; invU: number; series: number
  /** G2: vowel class, size draw, length, nasal, harmony */
  vow: number; vowU: number; length: boolean; nasal: boolean; harmony: boolean
  /** G3, G4, G5 */
  syl: number; tone: number; style: number; headInitial: boolean
}

function drawSeries(rng: Rng): number {
  let s = 0
  const bit = (p: number, b: number): void => { if (rng.next() < p) s |= b }
  bit(TYPO.voicing, Series.Voicing)
  bit(TYPO.aspiration, Series.Aspirated)
  bit(TYPO.ejective, Series.Ejective)
  bit(TYPO.implosive, Series.Implosive)
  bit(TYPO.prenasal, Series.Prenasal)
  bit(TYPO.retroflex, Series.Retroflex)
  bit(TYPO.uvular, Series.Uvular)
  bit(TYPO.pharyngeal, Series.Pharyngeal)
  bit(TYPO.labialVelar, Series.LabialVelar)
  bit(TYPO.labialised, Series.Labialised)
  bit(TYPO.lateralFric, Series.Lateral)
  bit(TYPO.clicks, Series.Clicks)
  bit(TYPO.dentalFric, Series.Dental)
  return s
}

/** One fresh draw of every group from the global priors (a fixed number of draws). */
function freshGroups(rng: Rng, z: number): Groups {
  const r = TYPO.rho, s = Math.sqrt(1 - r * r)
  const inv = pickCat(TYPO.invPrior, phi(r * z + s * normal(rng)))
  const invU = rng.next()
  const series = drawSeries(rng)
  const vow = pickCat(TYPO.vowPrior, rng.next())
  const vowU = rng.next()
  const length = rng.next() < TYPO.length
  const nasal = rng.next() < TYPO.nasalVowels
  const hu = rng.next()
  const syl = pickCat(TYPO.sylPrior, phi(r * z + s * normal(rng)))
  const tone = pickCat(TYPO.tonePrior, rng.next())
  const style = pickCat(TYPO.stylePrior, rng.next())
  const headInitial = rng.next() < 0.5
  return { inv, invU, series, vow, vowU, length, nasal, harmony: hu < TYPO.harmony * (vow === 2 ? TYPO.harmonyLargeMul : 1), syl, tone, style, headInitial }
}

/** Systematic sample of a prior over C cradles: category per cradle. */
function systematic(rng: Rng, prior: readonly number[], C: number): number[] {
  const perm: number[] = []
  for (let c = 0; c < C; c++) perm.push(c)
  rng.shuffle(perm)
  const U = rng.next()
  return perm.map((p) => pickCat(prior, (p + U) / C))
}

/** The areal profile of each cradle (see the file comment); `centre` gives a cradle's unit position. */
export function drawCradles(seed: number, C: number, centre: (c: number) => [number, number, number]): Groups[] {
  const rng = createRng(seed, 'names-typo-world')
  const syl = systematic(rng, TYPO.sylPrior, C)
  const tone = systematic(rng, TYPO.tonePrior, C)
  const style = systematic(rng, TYPO.stylePrior, C)
  const out: Groups[] = []
  for (let c = 0; c < C; c++) {
    const g = freshGroups(rng, normal(rng))
    g.syl = syl[c]; g.tone = tone[c]; g.style = style[c]
    // a near earlier cradle: copy each group with chance nearCopy (draws made either way)
    let near = -1, best = Infinity
    const a = centre(c)
    for (let e = 0; e < c; e++) {
      const b = centre(e)
      const arc = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
      if (arc < best) { best = arc; near = e }
    }
    const u = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]
    if (near >= 0 && best < TYPO.nearArc) {
      const o = out[near]
      if (u[0] < TYPO.nearCopy) { g.inv = o.inv; g.invU = o.invU; g.series = o.series }
      if (u[1] < TYPO.nearCopy) { g.vow = o.vow; g.vowU = o.vowU; g.length = o.length; g.nasal = o.nasal; g.harmony = o.harmony }
      if (u[2] < TYPO.nearCopy) g.syl = o.syl
      if (u[3] < TYPO.nearCopy) g.tone = o.tone
      if (u[4] < TYPO.nearCopy) { g.style = o.style; g.headInitial = o.headInitial }
    }
    out.push(g)
  }
  return out
}

function toDraw(g: Groups, cradle: number): TypoDraw {
  const [lo, hi] = TYPO.invRange[g.inv]
  const nCons = lo + Math.min(hi - lo, Math.floor(g.invU * (hi - lo + 1)))
  // vowel qualities: class 0 -> 3 or 4 (2 is too rare to name with), 1 -> 5 (188 of 287) or 6, 2 -> 7..10
  const nVowels = g.vow === 0 ? (g.vowU < 0.6 ? 3 : 4) : g.vow === 1 ? (g.vowU < 188 / 287 ? 5 : 6) : 7 + Math.min(3, Math.floor(g.vowU * 4))
  return { inv: g.inv, nCons, vow: g.vow, nVowels, syl: g.syl, tone: g.tone, style: g.style, series: g.series, length: g.length, nasal: g.nasal, harmony: g.harmony, headInitial: g.headInitial, cradle }
}

/** What profile drawing needs to know of each people (proto-language). */
export interface ProfileInput {
  /** The tribe (founding settlement id) whose stream it draws from ('names-typo-<tribe>'). */
  tribe: number
  /** Its cradle (People.cradle), and the distance from its founding cell to the cradle centre (any monotone measure). */
  cradle: number
  fromCentre: number
}

/**
 * Profiles of every people at once (the balance guard looks at them all) with each tribe's Rng left after its draws (inventory.ts
 * continues on it). `cradleCount` cradles with unit-vector centres.
 */
export function drawProfiles(seed: number, peoples: readonly ProfileInput[], cradleCount: number, centre: (c: number) => [number, number, number]): { draw: TypoDraw[]; rng: Rng[] } {
  const C = Math.max(1, cradleCount)
  const areal = drawCradles(seed, C, centre)
  const draw: TypoDraw[] = [], rngs: Rng[] = []
  for (const p of peoples) {
    const rng = createRng(seed, `names-typo-${p.tribe}`)
    const z = normal(rng)
    const keep = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()]
    const fresh = freshGroups(rng, z)
    const a = areal[Math.max(0, Math.min(C - 1, p.cradle))]
    const k = TYPO.arealKeep
    const g: Groups = { ...fresh }
    if (keep[0] < k) { g.inv = a.inv; g.invU = a.invU; g.series = a.series }
    if (keep[1] < k) { g.vow = a.vow; g.vowU = a.vowU; g.length = a.length; g.nasal = a.nasal; g.harmony = a.harmony }
    if (keep[2] < k) g.syl = a.syl
    if (keep[3] < k) g.tone = a.tone
    if (keep[4] < k) { g.style = a.style; g.headInitial = a.headInitial }
    draw.push(toDraw(g, p.cradle))
    rngs.push(rng)
  }
  // balance guard: more than half agree on syllable, tone and morphology at once
  const P = draw.length
  if (P >= 3) {
    const count = new Map<string, number[]>()
    for (let i = 0; i < P; i++) {
      const key = `${draw[i].syl}:${draw[i].tone}:${draw[i].style}`
      const l = count.get(key) ?? []
      l.push(i)
      count.set(key, l)
    }
    for (const list of count.values()) {
      if (list.length * 2 <= P) continue
      let far = list[0]
      for (const i of list) if (peoples[i].fromCentre > peoples[far].fromCentre || (peoples[i].fromCentre === peoples[far].fromCentre && i > far)) far = i
      const rng = rngs[far]
      draw[far].tone = pickCat(TYPO.tonePrior, rng.next())
      draw[far].style = pickCat(TYPO.stylePrior, rng.next())
    }
  }
  return { draw, rng: rngs }
}

/** A synthetic profile draw (harness and tests): `n` peoples over `C` cradles spread on a ring, from a seed. */
export function syntheticProfiles(seed: number, n: number, C: number): TypoDraw[] {
  const centre = (c: number): [number, number, number] => [Math.cos((2 * Math.PI * c) / C), Math.sin((2 * Math.PI * c) / C), 0]
  const peoples: ProfileInput[] = []
  for (let t = 0; t < n; t++) peoples.push({ tribe: t, cradle: t % C, fromCentre: t })
  return drawProfiles(seed, peoples, C, centre).draw
}
