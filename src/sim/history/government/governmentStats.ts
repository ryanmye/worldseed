// governments: stats harness (city-states.md §8 step 8 targets). Run:
//   node --experimental-strip-types src/sim/history/government/governmentStats.ts [seeds...] [--no-ab] [--years N] [--json]
// For each seed: one run with governments on (and one off for the A/B unless --no-ab). Prints one row per seed.

import { EventType, Government, GovernmentCause, PolityEnd, PolityOrigin, RIVER_FLOW_THRESHOLD } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'

export interface GovRow {
  seed: number
  cityStates: number
  charters: number
  risings: number
  freeTowns: number
  council: number
  alive1500: number
  alive2000: number
  aliveShare2000: number
  portShare: number
  waterShare: number
  inlandShare: number
  medianLife: number
  mortalShare: number
  sigFall: number
  signorie: number
  restored: number
  theocracies: number
  confederations: number
  settled: number
  crowned: number
  peopleShare2000: number
  polities: number
  warsPerCentury: number
  revolts: number
  largestShare2000: number
}

/** The form of polity p at year y (governments table), -1 none. */
export function formAt(h: History, p: number, y: number): number {
  const o = h.governmentOffsets
  if (p + 1 >= o.length) return -1
  let f = -1
  for (let k = o[p]; k < o[p + 1]; k++) { const r = h.governmentIds[k]; if (h.governments.year[r] <= y) f = h.governments.form[r] }
  return f
}

const isCity = (f: number) => f === Government.Republic || f === Government.FreeCity || f === Government.Signoria

function median(a: number[]): number { if (a.length === 0) return 0; const b = a.slice().sort((x, y) => x - y); return b[(b.length - 1) >> 1] }

function snapAt(h: History, y: number): number { return Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)) }

/** Shape-only measures of a run (both on and off). */
export function baseMeasures(h: History): { polities: number; warsPerCentury: number; revolts: number; largestShare2000: number } {
  const q = snapAt(h, h.years), S = h.settlements.length
  const pp = new Map<number, number>(); let tot = 0
  for (let i = 0; i < S; i++) { const x = h.population[q * S + i]; if (!(x > 0)) continue; tot += x; const p = h.polity[q * S + i]; if (p >= 0) pp.set(p, (pp.get(p) ?? 0) + x) }
  let big = 0
  for (const v of pp.values()) if (v > big) big = v
  return { polities: h.polities.length, warsPerCentury: (h.wars.count * 100) / h.years, revolts: h.events.filter((e) => e.type === EventType.Revolt).length, largestShare2000: tot > 0 ? big / tot : 0 }
}

export function govMeasures(h: History, seed: number, port: Int32Array, flow: Float32Array): GovRow {
  const G = h.governments
  const city: number[] = []
  let charters = 0, risings = 0, freeTowns = 0, council = 0
  for (const P of h.polities) {
    const p = P.id
    const o = h.governmentOffsets
    if (p + 1 >= o.length || o[p] === o[p + 1]) continue
    const first = h.governmentIds[o[p]]
    const f0 = G.form[first], c0 = G.cause[first]
    if ((P.origin === PolityOrigin.Charter || P.origin === PolityOrigin.CityState) && isCity(f0)) {
      city.push(p)
      if (c0 === GovernmentCause.Charter) charters++
      else if (c0 === GovernmentCause.Rising) risings++
      else if (c0 === GovernmentCause.Free) freeTowns++
      continue
    }
    for (let k = o[p]; k < o[p + 1]; k++) { const r = h.governmentIds[k]; if (G.cause[r] === GovernmentCause.Council && P.origin !== PolityOrigin.League) { city.push(p); council++; break } }
  }
  let a15 = 0, a20 = 0, alive20 = 0, ports = 0, water = 0, inland = 0, mortal = 0, ended = 0
  const life: number[] = []
  const S = h.settlements.length, q = snapAt(h, h.years)
  let cityPeople = 0, people = 0
  const inCity = new Set<number>()
  for (const P of h.polities) {
    const alive = (y: number) => P.foundedYear <= y && (P.endedYear < 0 || P.endedYear > y)
    if (alive(Math.min(2000, h.years))) alive20++
  }
  for (const p of city) {
    const P = h.polities[p]
    const alive = (y: number) => P.foundedYear <= y && (P.endedYear < 0 || P.endedYear > y)
    if (alive(1500) && isCity(formAt(h, p, 1500))) a15++
    if (alive(Math.min(2000, h.years)) && isCity(formAt(h, p, h.years))) { a20++; inCity.add(p) }
    const c = P.capitals[0]
    if (port[c] >= 0) ports++
    if (port[c] >= 0 || flow[h.settlements[c].cell] >= RIVER_FLOW_THRESHOLD) water++
    else inland++
    life.push((P.endedYear >= 0 ? P.endedYear : h.years) - P.foundedYear)
    if (P.endedYear >= 0) { ended++; if (P.endCause === PolityEnd.Conquered || P.endCause === PolityEnd.Absorbed) mortal++ }
  }
  for (let i = 0; i < S; i++) { const x = h.population[q * S + i]; if (!(x > 0)) continue; people += x; if (inCity.has(h.polity[q * S + i])) cityPeople += x }
  // republics lasting >= 100 years that fall to a signoria within 300 years of becoming republics
  let rep100 = 0, rep100sig = 0
  for (let p = 0; p + 1 < h.governmentOffsets.length; p++) {
    const o = h.governmentOffsets
    for (let k = o[p]; k < o[p + 1]; k++) {
      const r = h.governmentIds[k]
      if (G.form[r] !== Government.Republic) continue
      const y0 = G.year[r]
      const next = k + 1 < o[p + 1] ? h.governmentIds[k + 1] : -1
      const P = h.polities[p]
      const y1 = next >= 0 ? G.year[next] : P.endedYear >= 0 ? P.endedYear : h.years
      if (y1 - y0 < 100 && next < 0 && P.endedYear < 0 && h.years - y0 < 300) continue // (too young to judge)
      if (y1 - y0 < 100) continue
      rep100++
      if (next >= 0 && G.form[next] === Government.Signoria && y1 - y0 <= 300) rep100sig++
    }
  }
  const cnt = (c: number) => { let n = 0; for (let k = 0; k < G.count; k++) if (G.cause[k] === c) n++; return n }
  let conf = 0
  for (let k = 0; k < G.count; k++) if (G.form[k] === Government.Confederation && G.cause[k] === GovernmentCause.Founded) conf++
  const b = baseMeasures(h)
  const n = city.length
  return {
    seed, cityStates: n, charters, risings, freeTowns, council, alive1500: a15, alive2000: a20, aliveShare2000: alive20 > 0 ? a20 / alive20 : 0,
    portShare: n ? ports / n : 0, waterShare: n ? water / n : 0, inlandShare: n ? inland / n : 0, medianLife: median(life), mortalShare: ended ? mortal / n : 0,
    sigFall: rep100 ? rep100sig / rep100 : 0, signorie: cnt(GovernmentCause.Strongman) + cnt(GovernmentCause.Family), restored: cnt(GovernmentCause.Restored),
    theocracies: cnt(GovernmentCause.Clergy), confederations: conf, settled: cnt(GovernmentCause.Settled), crowned: cnt(GovernmentCause.Crowned),
    peopleShare2000: people > 0 ? cityPeople / people : 0, ...b,
  }
}

const ARGV: string[] = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []

function main(): void {
  const argv = ARGV.slice(2)
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const years = Number(val('--years') ?? 2000)
  const skip = new Set([val('--years') ?? ''])
  const seeds = argv.filter((a) => !a.startsWith('--') && !skip.has(a)).map(Number)
  const ab = !argv.includes('--no-ab')
  for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) {
    const w = generateWorld(seed)
    let port = new Int32Array(0)
    const opts: HistoryOptions = { years, governments: true }
    const run = runHistory(w, opts, (s) => { if (s.year === years) port = s.port.slice(0, s.count) })
    const row = govMeasures(run.history, seed, port, w.flow)
    const out: Record<string, unknown> = { ...row, diag: run.diag.governments }
    if (ab) out.off = baseMeasures(runHistory(w, { years }).history)
    console.log(JSON.stringify(out))
  }
}

if (ARGV[1] !== undefined && import.meta.url === `file://${ARGV[1]}`) main()
