// Stats harness, species (see stats.ts): cradles' founding sets and what they are worth (crop multiplier and
// herd effect per cradle), population per cradle, what contact between cradles brings (species gained, population
// against the pre-contact trend), marginal land settled once its crop arrives, staple shares of the farmed land,
// epidemics, and printouts for single seeds (founding sets, adoption timeline, staple shares over time, crop maps).
// Run with:
//   node src/sim/history/speciesStats.ts [seed ...]        (summary over the seeds)
//   node src/sim/history/speciesStats.ts --detail 42 1     (also the per-seed printouts)

import { Biome, EventType, SpeciesCategory } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { runHistory } from './index.ts'
import type { HistoryDiagnostics } from './index.ts'
import type { HistoryState } from './state.ts'
import type { Terrain } from './terrain.ts'
import { SPECIES } from './params.ts'
import { cropOf, K_COUNT, S_COUNT, SPECIES_TABLE, TECHNIQUES } from './species.ts'

export const SPECIES_STATS_SEEDS = [1, 2, 3, 42, 1337, 2024, 31337, 77, 99999, 123456, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
/** Years at which the per-cradle crop multiplier and herd effect are sampled. */
export const SAMPLE_YEARS = [0, 250, 500, 1000, 1500, 2000]

/** What the probe records during a run. */
export interface SpeciesProbe {
  /** Per sample year per cradle: population, mean crop multiplier (normalised, population-weighted), mean herd effect (multiplier with / without herds). */
  pop: number[][]
  crop: number[][]
  herd: number[][]
  /** Population and mean crop multiplier (population-weighted) per people every 10 years: popP[q][p], cmP[q][p]. */
  popP: number[][]
  cmP: number[][]
  /** Settlements on marginal cells (habitable only with a marginal-land species) every 100 years. */
  marginal: number[]
}

/** A probe for runHistory recording SpeciesProbe. */
export function speciesProbe(out: SpeciesProbe): (s: HistoryState) => void {
  let K = -1
  return (s) => {
    const cr = s.sp.cradle
    if (K < 0) K = Math.max(...cr) + 1
    const y = s.year
    if (y % 10 === 0) {
      const row = new Array<number>(cr.length).fill(0)
      const cm = new Array<number>(cr.length).fill(0)
      for (const id of s.living) { row[s.people[id]] += s.pop[id]; cm[s.people[id]] += s.pop[id] * s.sp.cropMul[id] }
      for (let p = 0; p < cr.length; p++) if (row[p] > 0) cm[p] /= row[p]
      while (out.popP.length < y / 10) { out.popP.push(row.slice()); out.cmP.push(cm.slice()) } // (year 0 is not probed: repeat)
      out.popP.push(row)
      out.cmP.push(cm)
    }
    if (y % 100 === 0) {
      let n = 0
      for (const id of s.living) if (!s.terrain.baseHabitable[s.cell[id]]) n++
      out.marginal.push(n)
    }
    if (SAMPLE_YEARS.indexOf(y) < 0 && !(y === 1 && SAMPLE_YEARS[0] === 0)) return
    const pop = new Array<number>(K).fill(0), crop = new Array<number>(K).fill(0), herd = new Array<number>(K).fill(0)
    const sp = s.sp
    let herdMask = 0
    for (let x = 0; x < S_COUNT; x++) if (SPECIES_TABLE[x].category === SpeciesCategory.Livestock) herdMask |= 1 << x
    for (const id of s.living) {
      const k = cr[s.people[id]]
      const p = s.pop[id]
      const full = cropOf(s, id, sp.m0[id], sp.m1[id], false)
      const bare = cropOf(s, id, (sp.m0[id] & ~herdMask) >>> 0, sp.m1[id], false)
      pop[k] += p
      crop[k] += p * full
      herd[k] += (p * full) / bare
    }
    for (let k = 0; k < K; k++) if (pop[k] > 0) { crop[k] /= pop[k]; herd[k] /= pop[k] }
    out.pop.push(pop); out.crop.push(crop); out.herd.push(herd)
  }
}

export interface CradleContact {
  a: number
  b: number
  year: number
  /** Species newly held by each side (any people of the cradle) within 200 years of contact, that the other side held at contact. */
  gainA: number
  gainB: number
  /** Each side's mean crop multiplier 200 years after contact over the one at contact. */
  cmA: number
  cmB: number
  /** Population of each side 100 and 200 years later relative to the pre-contact trend (growth over the century before, extrapolated). */
  a100: number
  a200: number
  b100: number
  b200: number
  /** Population of each side 100 and 200 years later relative to the same world run without species exchange between peoples (NaN without that run). */
  ca100: number
  ca200: number
  cb100: number
  cb200: number
}

export interface SpeciesSeedStats {
  seed: number
  cradles: number
  sets: string[]
  /** Per sample year per cradle (from the probe). */
  pop: number[][]
  crop: number[][]
  herd: number[][]
  contacts: CradleContact[]
  /** Staple shares of farmed cells with a staple at 2000 (per species id, %), and the top one. */
  shares2000: number[]
  top: number
  /** Share of farmed cells (with a staple) at 2000 not growing the world's top staple. */
  notTop: number
  /** Staples covering >= 5% at 2000. */
  fivePct: number
  /** Highland (Mountain or e >= 0.3) and dryland (Desert, or rainfall < 0.12) habitable cells inside a living settlement's base catchment at 500/1000/1500/2000 (% of such cells), and of those claimed by holders of potato / sorghum (%). */
  high: number[]
  highHolders: number[]
  dry: number[]
  dryHolders: number[]
  marginal: number[]
  /** Settlements per people on highland / dryland cells when it first got potato / sorghum (not founding) and 200 years later. */
  highGain: [number, number][]
  dryGain: [number, number][]
  /** Desert cells on open trade routes at 1000 / 2000, and share of desert route cells on routes with a camel-holding end. */
  desertRoutes: number[]
  camelShare: number
  /** Epidemics: year, victim, mortality (planned), actual loss after 20 years, years to recover the population before (-1 never). */
  epidemics: { year: number; q: number; m: number; loss: number; recover: number; cross: boolean }[]
  /** Events of each species kind. */
  domesticated: number
  adopted: number
  /** Techniques: first year per technique (-1). */
  techFirst: number[]
  techPeoples: number[]
  /** Mean Jaccard overlap of species sets between peoples in contact at 2000. */
  jaccard: number
  extinctCradle: number
}

function cradleOfPeople(h: History): number[] { return h.peoples.map((p) => p.cradle) }

/** Held species of people p by `year` (bit mask over species ids < 32). */
function heldMask(h: History, p: number, year: number): number {
  const S = h.species.length
  let m = 0
  for (let x = 0; x < S; x++) { const y = h.speciesYear[p * S + x]; if (y >= 0 && y <= year) m |= 1 << x }
  return m
}
function cradleMask(h: History, k: number, year: number): number {
  let m = 0
  h.peoples.forEach((p, i) => { if (p.cradle === k) m |= heldMask(h, i, year) })
  return m
}
const bits = (m: number): number => { let n = 0; for (let x = m >>> 0; x; x &= x - 1) n++; return n }

export function speciesSeedStats(world: World, h: History, terrain: Terrain, diag: HistoryDiagnostics, probe: SpeciesProbe, alone?: SpeciesProbe): SpeciesSeedStats {
  const N = world.grid.cellCount
  const S = h.settlements.length
  const P = h.peoples.length
  const cr = cradleOfPeople(h)
  const K = Math.max(...cr) + 1
  const sets = (diag.cradleSets ?? []).map((x) => x.map((i) => SPECIES_TABLE[i].archetype).join('+'))
  // Contacts between cradles: first year any people of one met any of the other.
  const contacts: CradleContact[] = []
  const popC = (k: number, year: number): number => {
    const q = Math.min(probe.popP.length - 1, Math.max(0, Math.round(year / 10)))
    let t = 0
    for (let p = 0; p < P; p++) if (cr[p] === k) t += probe.popP[q][p]
    return t
  }
  const trend = (k: number, y: number, d: number): number => {
    const now = popC(k, y), before = popC(k, y - 100)
    if (now <= 0 || before <= 0 || y + d > h.years) return NaN
    const g = now / before
    // (g^(d/100) for d = 100, 200: no pow)
    const pred = d === 100 ? now * g : now * g * g
    return popC(k, y + d) / pred
  }
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    let y = -1
    for (let p = 0; p < P; p++) for (let q = 0; q < P; q++) {
      if (cr[p] !== a || cr[q] !== b) continue
      const c = h.contactYear[p * P + q]
      if (c >= 0 && (y < 0 || c < y)) y = c
    }
    if (y < 0) continue
    const ma0 = cradleMask(h, a, y), mb0 = cradleMask(h, b, y)
    const ma2 = cradleMask(h, a, y + 200), mb2 = cradleMask(h, b, y + 200)
    const cf = (k: number, d: number): number => {
      if (!alone || y + d > h.years) return NaN
      const q = Math.round((y + d) / 10)
      let t = 0, u = 0
      for (let p = 0; p < P; p++) if (cr[p] === k) { t += probe.popP[q][p]; u += alone.popP[q][p] }
      return u > 0 ? t / u : NaN
    }
    const cmRatio = (k: number): number => {
      if (y + 200 > h.years) return NaN
      const at = (q: number): number => { let t = 0, w = 0; for (let p = 0; p < P; p++) if (cr[p] === k) { t += probe.popP[q][p] * probe.cmP[q][p]; w += probe.popP[q][p] } return w > 0 ? t / w : NaN }
      return at(Math.round((y + 200) / 10)) / at(Math.round(y / 10))
    }
    contacts.push({
      a, b, year: y,
      gainA: bits(ma2 & ~ma0 & mb0), gainB: bits(mb2 & ~mb0 & ma0), cmA: cmRatio(a), cmB: cmRatio(b),
      a100: trend(a, y, 100), a200: trend(a, y, 200), b100: trend(b, y, 100), b200: trend(b, y, 200),
      ca100: cf(a, 100), ca200: cf(a, 200), cb100: cf(b, 100), cb200: cf(b, 200),
    })
  }
  // Staple shares at 2000 from the crop layer.
  const lq = h.landSnapshotCount - 1
  const count = new Array<number>(S_COUNT).fill(0)
  let farmed = 0
  for (let i = 0; i < N; i++) {
    const c = h.crop[lq * N + i]
    if (c === 0) continue
    count[c - 1]++
    farmed++
  }
  let top = 0
  for (let x = 0; x < S_COUNT; x++) if (count[x] > count[top]) top = x
  const shares2000 = count.map((c) => (farmed > 0 ? (100 * c) / farmed : 0))
  const fivePct = shares2000.filter((x) => x >= 5).length
  // Highland and dryland land claimed over time.
  const isHigh = (i: number) => terrain.habitable[i] === 1 && (world.biome[i] === Biome.Mountain || world.elevation[i] >= 0.3)
  const isDry = (i: number) => terrain.habitable[i] === 1 && (world.biome[i] === Biome.Desert || world.rainfall[i] < 0.12)
  let nHigh = 0, nDry = 0
  for (let i = 0; i < N; i++) { if (isHigh(i)) nHigh++; if (isDry(i)) nDry++ }
  const high: number[] = [], highHolders: number[] = [], dry: number[] = [], dryHolders: number[] = []
  const mark = new Int32Array(N).fill(-1)
  for (const year of [500, 1000, 1500, 2000]) {
    const q = year / h.snapshotInterval
    mark.fill(-1)
    for (let id = 0; id < S; id++) {
      if (h.population[q * S + id] <= 0 || h.settlements[id].outpost) continue
      const c = h.settlements[id].cell
      for (let k = terrain.catchOff[c]; k < terrain.catchBase[c]; k++) mark[terrain.catchCell[k]] = h.settlements[id].people
    }
    let ch = 0, chh = 0, cd = 0, cdh = 0
    for (let i = 0; i < N; i++) {
      const p = mark[i]
      if (p < 0) continue
      if (isHigh(i)) { ch++; const y = h.speciesYear[p * S_COUNT + 4]; if (y >= 0 && y <= year) chh++ }
      if (isDry(i)) { cd++; const y = h.speciesYear[p * S_COUNT + 6]; if (y >= 0 && y <= year) cdh++ }
    }
    high.push(nHigh > 0 ? (100 * ch) / nHigh : 0)
    highHolders.push(ch > 0 ? (100 * chh) / ch : 0)
    dry.push(nDry > 0 ? (100 * cd) / nDry : 0)
    dryHolders.push(cd > 0 ? (100 * cdh) / cd : 0)
  }
  // Per people: settlements on highland / dryland cells when it got potato / sorghum, and 200 years later.
  const onCells = (p: number, year: number, test: (i: number) => boolean): number => {
    const q = Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))
    let n = 0
    for (let id = 0; id < S; id++) if (h.settlements[id].people === p && !h.settlements[id].outpost && h.population[q * S + id] > 0 && test(h.settlements[id].cell)) n++
    return n
  }
  const highGain: [number, number][] = [], dryGain: [number, number][] = []
  for (let p = 0; p < P; p++) {
    const yp = h.speciesYear[p * S_COUNT + 4], ys = h.speciesYear[p * S_COUNT + 6]
    if (yp > 0 && yp + 200 <= h.years) highGain.push([onCells(p, yp, isHigh), onCells(p, yp + 200, isHigh)])
    if (ys > 0 && ys + 200 <= h.years) dryGain.push([onCells(p, ys, isDry), onCells(p, ys + 200, isDry)])
  }
  // Desert legs of trade routes.
  const desertRoutes: number[] = []
  let camelCells = 0, desertCells = 0
  for (const year of [1000, 2000]) {
    const tq = Math.min(h.tradeSnapshotCount - 1, year / h.tradeInterval)
    let n = 0
    for (let r = 0; r < h.trade.count; r++) {
      if (h.tradeVolume[tq * h.trade.count + r] <= 0) continue
      const pa = h.settlements[h.trade.a[r]].people, pb = h.settlements[h.trade.b[r]].people
      const camel = (p: number) => { const y = h.speciesYear[p * S_COUNT + 10]; return y >= 0 && y <= year }
      for (let k = h.trade.pathOffsets[r]; k < h.trade.pathOffsets[r + 1]; k++) {
        if (world.biome[h.trade.path[k]] !== Biome.Desert) continue
        n++
        if (year === 2000) { desertCells++; if (camel(pa) || camel(pb)) camelCells++ }
      }
    }
    desertRoutes.push(n)
  }
  // Epidemics.
  const epidemics: SpeciesSeedStats['epidemics'] = []
  const L = diag.epiLog ?? []
  const popP = (p: number, year: number): number => probe.popP[Math.min(probe.popP.length - 1, Math.round(year / 10))][p]
  for (let i = 0; i + 4 < L.length; i += 5) {
    const year = L[i], q = L[i + 1], p = L[i + 2], m = L[i + 3], before = L[i + 4]
    // Deepest point within 50 years (the wave takes decades to cross a people), and the years until back to the size before.
    let low = before, lowYear = year
    for (let y = year + 10; y <= year + 50 && y <= h.years; y += 10) { const v = popP(q, y); if (v < low) { low = v; lowYear = y } }
    let recover = -1
    for (let y = lowYear; y <= h.years; y += 10) if (y > year && popP(q, y) >= before) { recover = y - year; break }
    epidemics.push({ year, q, m, loss: before > 0 ? 1 - low / before : 0, recover, cross: cr[q] !== cr[p] })
  }
  let domesticated = 0, adopted = 0
  for (const e of h.events) { if (e.type === EventType.Domesticated) domesticated++; else if (e.type === EventType.SpeciesAdopted) adopted++ }
  const techFirst: number[] = [], techPeoples: number[] = []
  const TY = diag.techYear ?? new Int16Array(0)
  for (let k = 0; k < K_COUNT; k++) {
    let f = -1, n = 0
    for (let p = 0; p < P; p++) { const y = TY[p * K_COUNT + k]; if (y >= 0) { n++; if (f < 0 || y < f) f = y } }
    techFirst.push(f); techPeoples.push(n)
  }
  // Jaccard between peoples in contact (alive at the end).
  const lastQ = h.snapshotCount - 1
  const alive = new Uint8Array(P)
  for (let id = 0; id < S; id++) if (h.population[lastQ * S + id] > 0 && !h.settlements[id].outpost) alive[h.settlements[id].people] = 1
  let jac = 0, jn = 0
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
    if (!alive[a] || !alive[b] || h.contactYear[a * P + b] < 0) continue
    const ma = heldMask(h, a, h.years), mb = heldMask(h, b, h.years)
    const u = bits(ma | mb)
    if (u > 0) { jac += bits(ma & mb) / u; jn++ }
  }
  let extinctCradle = 0
  for (let k = 0; k < K; k++) {
    let any = false
    for (let id = 0; id < S && !any; id++) if (h.population[lastQ * S + id] > 0 && cr[h.settlements[id].people] === k) any = true
    if (!any) extinctCradle++
  }
  return {
    seed: world.seed, cradles: K, sets, pop: probe.pop, crop: probe.crop, herd: probe.herd, contacts,
    shares2000, top, notTop: 100 - shares2000[top], fivePct,
    high, highHolders, dry, dryHolders, marginal: probe.marginal, highGain, dryGain,
    desertRoutes, camelShare: desertCells > 0 ? (100 * camelCells) / desertCells : 0,
    epidemics, domesticated, adopted, techFirst, techPeoples, jaccard: jn > 0 ? jac / jn : NaN, extinctCradle,
  }
}

const rng = (xs: number[], f: (x: number) => string): string => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return v.length ? `${f(v[v.length >> 1])} [${f(v[0])}..${f(v[v.length - 1])}]` : '-'
}
const f2 = (x: number): string => x.toFixed(2)
const f0 = (x: number): string => x.toFixed(0)

export function formatSpeciesStats(rows: SpeciesSeedStats[]): string {
  const L: string[] = []
  L.push('species: per cradle, crop multiplier (normalised, pop-weighted) x herd effect (multiplier with / without herds); population')
  const ratios: number[][] = SAMPLE_YEARS.map(() => [])
  const herdR: number[][] = SAMPLE_YEARS.map(() => [])
  for (const r of rows) {
    L.push(`  seed ${r.seed}: sets ${r.sets.map((x, k) => `${k}:${x}`).join('  ')}`)
    for (let t = 0; t < SAMPLE_YEARS.length && t < r.crop.length; t++) {
      const y = SAMPLE_YEARS[t]
      const cm = r.crop[t], hm = r.herd[t], pp = r.pop[t]
      L.push(`     ${String(y).padStart(4)}: ` + cm.map((c, k) => `c${k} ${f2(c)} herd ${f2(hm[k])} pop ${pp[k] >= 1000 ? (pp[k] / 1000).toFixed(1) + 'k' : f0(pp[k])}`).join(' | '))
      const live = cm.filter((_, k) => pp[k] > 0)
      if (live.length >= 2) ratios[t].push(Math.max(...live) / Math.min(...live))
      const lh = hm.filter((_, k) => pp[k] > 0)
      if (lh.length >= 2) herdR[t].push(Math.max(...lh) / Math.min(...lh))
    }
  }
  L.push('  best / worst cradle crop multiplier per sample year (median [min..max] over seeds): ' + SAMPLE_YEARS.map((y, t) => `${y}: ${rng(ratios[t], f2)}`).join('; '))
  L.push('  best / worst cradle herd effect: ' + SAMPLE_YEARS.map((y, t) => `${y}: ${rng(herdR[t], f2)}`).join('; '))
  const popR: number[][] = SAMPLE_YEARS.map(() => [])
  for (const r of rows) for (let t = 0; t < r.pop.length; t++) { const live = r.pop[t].filter((x) => x > 0); if (live.length >= 2) popR[t].push(Math.max(...live) / Math.min(...live)) }
  L.push('  largest / smallest cradle population: ' + SAMPLE_YEARS.map((y, t) => `${y}: ${rng(popR[t], f2)}`).join('; '))
  L.push(`  cradles extinct by the end: ${rows.reduce((a, r) => a + r.extinctCradle, 0)} of ${rows.reduce((a, r) => a + r.cradles, 0)}`)
  L.push('contacts between cradles: year, species gained by each side within 200 y (of those the other held), pop vs pre-contact trend at +100 / +200')
  const cmGain: number[] = []
  const g: number[] = [], t100: number[] = [], t200: number[] = [], c100: number[] = [], c200: number[] = [], gained100: number[] = [], gained200: number[] = []
  for (const r of rows) {
    L.push(`  seed ${r.seed}: ` + r.contacts.map((c) => `${c.a}-${c.b} @${c.year}: +${c.gainA}/+${c.gainB} crop x${f2(c.cmA)}/x${f2(c.cmB)} trend ${f2(c.a100)},${f2(c.a200)}/${f2(c.b100)},${f2(c.b200)} vs no-exchange ${f2(c.ca100)},${f2(c.ca200)}/${f2(c.cb100)},${f2(c.cb200)}`).join('  '))
    for (const c of r.contacts) {
      g.push(c.gainA, c.gainB)
      // the receiving side: the one that gained more
      const a = c.gainA >= c.gainB
      t100.push(a ? c.a100 : c.b100); t200.push(a ? c.a200 : c.b200)
      c100.push(a ? c.ca100 : c.cb100); c200.push(a ? c.ca200 : c.cb200)
      if (c.gainA > 0) { gained100.push(c.ca100); gained200.push(c.ca200); cmGain.push(c.cmA) }
      if (c.gainB > 0) { gained100.push(c.cb100); gained200.push(c.cb200); cmGain.push(c.cmB) }
    }
  }
  L.push(`  species gained per side ${rng(g, f0)}; receiving side's pop vs pre-contact trend +100 ${rng(t100, f2)}, +200 ${rng(t200, f2)}; vs the run without exchange +100 ${rng(c100, f2)}, +200 ${rng(c200, f2)}; sides that gained >= 1 species: vs no exchange +100 ${rng(gained100, f2)}, +200 ${rng(gained200, f2)}, crop multiplier +200 / at contact ${rng(cmGain, f2)}`)
  L.push('staple shares of farmed cells at 2000 (%), top staple, cells not on the global top staple, staples >= 5%:')
  for (const r of rows) L.push(`  seed ${r.seed}: ` + r.shares2000.map((x, i) => (x > 0 ? `${SPECIES_TABLE[i].archetype} ${x.toFixed(0)}` : '')).filter((x) => x).join(', ') + ` | top ${SPECIES_TABLE[r.top].archetype}, not-top ${f0(r.notTop)}%, >=5%: ${r.fivePct}`)
  const tops = new Array<number>(S_COUNT).fill(0)
  for (const r of rows) tops[r.top]++
  L.push(`  top staple per seed: ${tops.map((n, i) => (n ? `${SPECIES_TABLE[i].archetype} ${n}` : '')).filter((x) => x).join(', ')}; top share ${rng(rows.map((r) => 100 - r.notTop), f0)}%; staples >= 5% ${rng(rows.map((r) => r.fivePct), f0)}`)
  L.push(`  mean Jaccard of species sets between peoples in contact at the end ${rng(rows.map((r) => r.jaccard), f2)}`)
  L.push('marginal land: highland / dryland habitable cells claimed (%) at 500/1000/1500/2000, and % of those claimed by potato / sorghum holders')
  for (const r of rows) L.push(`  seed ${r.seed}: high ${r.high.map(f0).join('/')} (holders ${r.highHolders.map(f0).join('/')}), dry ${r.dry.map(f0).join('/')} (holders ${r.dryHolders.map(f0).join('/')}); marginal-cell settlements per century ${r.marginal.join(' ')}; per people on arrival -> +200y: potato ${r.highGain.map((x) => x.join('->')).join(' ')}, sorghum ${r.dryGain.map((x) => x.join('->')).join(' ')}; desert route cells 1000/2000 ${r.desertRoutes.join('/')}, with a camel end ${f0(r.camelShare)}%`)
  const hg = rows.flatMap((r) => r.highGain), dg = rows.flatMap((r) => r.dryGain)
  L.push(`  per people getting potato: highland settlements ${rng(hg.map((x) => x[0]), f0)} -> ${rng(hg.map((x) => x[1]), f0)} 200 y later (${hg.length} cases); sorghum: dryland ${rng(dg.map((x) => x[0]), f0)} -> ${rng(dg.map((x) => x[1]), f0)} (${dg.length})`)
  L.push('epidemics: year victim mortality(planned) deepest loss within 50 y, years to regain the size before')
  const ep = rows.flatMap((r) => r.epidemics)
  for (const r of rows) if (r.epidemics.length) L.push(`  seed ${r.seed}: ` + r.epidemics.map((e) => `${e.year} p${e.q}${e.cross ? '' : '(same cradle)'} m${f2(e.m)} loss ${f2(e.loss)} rec ${e.recover}`).join('; '))
  L.push(`  per seed ${rng(rows.map((r) => r.epidemics.length), f0)}; mortality ${rng(ep.map((e) => e.m), f2)}; deepest loss within 50 y ${rng(ep.map((e) => e.loss), f2)}; recovery years ${rng(ep.map((e) => e.recover).filter((x) => x >= 0), f0)} (never ${ep.filter((e) => e.recover < 0).length})`)
  L.push(`events per seed: Domesticated ${rng(rows.map((r) => r.domesticated), f0)}, SpeciesAdopted ${rng(rows.map((r) => r.adopted), f0)}`)
  L.push('techniques: first year (median [min..max] over seeds that found it), peoples holding at the end: ' + TECHNIQUES.map((t, k) => `${t} ${rng(rows.map((r) => r.techFirst[k]).filter((x) => x >= 0), f0)} in ${rows.filter((r) => r.techFirst[k] >= 0).length} seeds, peoples ${rng(rows.map((r) => r.techPeoples[k]), f0)}`).join('; '))
  return L.join('\n')
}

/** Equirectangular ASCII map of the main staple per farmed cell at `year` (letters per species; '.' farmed without a staple). */
export function asciiCropMap(world: World, h: History, year: number, W = 120, H = 40): string {
  const N = world.grid.cellCount
  const P = world.grid.positions
  const grid: string[] = new Array(W * H).fill(' ')
  const rank = new Float64Array(W * H).fill(-1)
  const at = (i: number): number => {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  const letters = 'WBRMPCS'
  const q = Math.min(h.landSnapshotCount - 1, Math.round(year / h.landInterval))
  for (let i = 0; i < N; i++) {
    const p = at(i)
    const e = world.elevation[i]
    let ch = ' ', r = 0
    if (e >= 0) { ch = world.biome[i] === Biome.Mountain ? '^' : world.biome[i] === Biome.Desert ? ':' : '.'; r = 1 }
    const c = h.crop[q * N + i]
    const u = h.landUse[q * N + i]
    if (u > 0) { ch = c > 0 ? letters[c - 1] : ','; r = 2 + u / 255 }
    if (r > rank[p]) { rank[p] = r; grid[p] = ch }
  }
  const lines = [`year ${year} main staple: W wheat B barley R paddy rice M maize P potato C cassava S sorghum  , farmed but no staple held grows there   (. land ^ mountain : desert)`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}

/** Per-seed printout: founding sets, adoption timeline, staple shares over time. */
export function speciesDetail(world: World, h: History, diag: HistoryDiagnostics): string {
  const L: string[] = []
  const S = h.settlements.length
  L.push(`seed ${world.seed}: species ` + h.species.map((x) => `${x.id} ${x.archetype} "${x.name}" origins ${x.origins.join(',')}`).join('; '))
  h.peoples.forEach((p, i) => {
    const held = h.species.filter((x) => h.speciesYear[i * h.species.length + x.id] === 0).map((x) => x.archetype)
    L.push(`  people ${i} ${p.name} (cradle ${p.cradle}): founding set ${held.join(', ') || '-'}`)
  })
  L.push('  timeline (first per people):')
  for (const e of h.events) {
    if (e.type !== EventType.Domesticated && e.type !== EventType.SpeciesAdopted && e.type !== EventType.Epidemic) continue
    const st = h.settlements[e.settlement]
    if (e.type === EventType.Epidemic) { L.push(`    ${e.year}: epidemic among people ${st.people} (from people ${h.settlements[e.other].people}), mortality ${e.value.toFixed(2)}`); continue }
    const x = h.species[e.value]
    L.push(`    ${e.year}: people ${st.people} (cradle ${h.peoples[st.people].cradle}) ${e.type === EventType.Domesticated ? 'tamed' : 'adopted'} ${x.archetype} "${x.name}"${e.type === EventType.SpeciesAdopted ? ` from people ${h.settlements[e.other].people} (cradle ${h.peoples[h.settlements[e.other].people].cradle})` : ''} at ${st.name}`)
  }
  const TY = diag.techYear ?? new Int16Array(0)
  for (let k = 0; k < K_COUNT; k++) {
    const ys: string[] = []
    h.peoples.forEach((_, p) => { const y = TY[p * K_COUNT + k]; if (y >= 0) ys.push(`p${p}@${y}`) })
    L.push(`  technique ${TECHNIQUES[k]}: ${ys.join(' ') || 'never'}`)
  }
  L.push('  staple shares of farmed cells over time (%):')
  const N = world.grid.cellCount
  for (const year of [250, 500, 750, 1000, 1250, 1500, 1750, 2000]) {
    if (year > h.years) continue
    const q = year / h.landInterval
    const count = new Array<number>(S_COUNT).fill(0)
    let farmed = 0, none = 0
    for (let i = 0; i < N; i++) {
      if (h.landUse[q * N + i] === 0) continue
      const c = h.crop[q * N + i]
      if (c === 0) { none++; continue }
      count[c - 1]++
      farmed++
    }
    L.push(`    ${year}: ` + count.map((c, i) => (c > 0 ? `${SPECIES_TABLE[i].archetype} ${((100 * c) / farmed).toFixed(0)}` : '')).filter((x) => x).join(', ') + ` (farmed cells with a staple ${farmed}, without ${none})`)
  }
  void S
  return L.join('\n')
}

export function runSpeciesStats(seeds: number[], detail: boolean, counterfactual = true): string {
  const rows: SpeciesSeedStats[] = []
  const extra: string[] = []
  for (const seed of seeds) {
    const w = generateWorld(seed)
    const probe: SpeciesProbe = { pop: [], crop: [], herd: [], popP: [], cmP: [], marginal: [] }
    const run = runHistory(w, undefined, speciesProbe(probe))
    let alone: SpeciesProbe | undefined
    if (counterfactual) {
      // The same world without species exchange between peoples.
      alone = { pop: [], crop: [], herd: [], popP: [], cmP: [], marginal: [] }
      const X = SPECIES as { exchange: boolean }
      X.exchange = false
      try { runHistory(w, undefined, speciesProbe(alone)) } finally { X.exchange = true }
    }
    rows.push(speciesSeedStats(w, run.history, run.terrain, run.diag, probe, alone))
    if (detail) {
      extra.push(speciesDetail(w, run.history, run.diag))
      for (const y of [500, 1000, 1500, 2000]) extra.push(asciiCropMap(w, run.history, y))
    }
  }
  return formatSpeciesStats(rows) + (extra.length ? '\n\n' + extra.join('\n\n') : '')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const detail = args.includes('--detail')
  const seeds = args.map(Number).filter((s) => Number.isFinite(s))
  console.log(runSpeciesStats(seeds.length > 0 ? seeds : SPECIES_STATS_SEEDS, detail, !args.includes('--fast')))
}
