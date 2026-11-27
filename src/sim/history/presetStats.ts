// presets: the Dramatic sanity guard (EVALUATION.md §3 P1b, §5 Risks). Not the realism ratchet: Dramatic is not tuned against
// real history; this only catches incoherent churn (a realm that swallows the world for centuries, centuries with no war once
// states exist, successions every few years, a flood of family-head events, non-finite numbers).
//   node --experimental-strip-types --no-warnings src/sim/history/presetStats.ts [seed ...]            (default 1 7 42 1234)
//   ... --preset realistic|off measure another preset (default dramatic)
//   ... --years N              run length (default 2000)
//   ... --check                exit 1 if any (non-off) row breaks SANITY_BOUNDS
//   ... --json                 one JSON row per seed
//   ... --out rows.jsonl       append each seed's row as it finishes; seeds already in the file are read back, not rerun
//
// Measured 2026-11-27 (lane/setup on main f20cb5f; 2000 y; seeds 1 / 7 / 42 / 1234; rows in /home/claude/runs/setup/*.jsonl):
//   preset      events                     warless c.  reign median  short (<3y)        accessions/realm-c.  familyHead/c.         battles
//   off         12251 13149 13683 15470    0 1 1 5     20 12 15 11   .079 .074 .068 .058  4.57 5.55 5.29 5.81  0                     0
//   realistic   14004 17078 14123 16618    1 2 3 3     17 13 15 12   .089 .067 .060 .079  4.78 5.38 5.11 5.74  0                     282 314 427 309
//   dramatic    17478 17635 15000 18923    3 2 3 5     16 12 18 13   .064 .061 .073 .067  5.16 5.75 4.81 5.47  70.7 52.5 29.4 37.3   347 378 384 403
// No non-finite value and no realm above 80% of the world's people in any run. Successions are not a churn: the median reign
// (12-18 y) is the off world's; the "every ~20 years" of the evaluation is the normal reign length. FamilyHead is 29-71 a
// century (600-1400 a run): volume for the director to filter, not a flood. The bounds below are loose (about 2x the worst
// measured value, and warless centuries at the off world's worst + 1); a guard against a broken system, not a target.

import { EventType } from '../../contract.ts'
import type { History, HistoryOptions, PresetName } from '../../contract.ts'
import { generateWorld } from '../index.ts'
import { simulateHistory } from './index.ts'

export interface SanityRow {
  seed: number
  preset: PresetName
  years: number
  events: number
  /** Non-finite values in the float tables (population, wealth, treasury, crown debt, strength). */
  nonFinite: number
  /** Longest run of years in which one polity held more than 80% of the world's people (snapshot resolution). */
  dominanceYears: number
  /** Centuries after the first state's century with no war declared. */
  warlessCenturies: number
  /** Reigns that ended: count, median length (years) and the share shorter than 3 years. */
  reigns: number
  reignMedian: number
  reignShort: number
  /** Successions (RulerAcceded) per realm-century: realms alive summed over centuries as the denominator. */
  accessionsPerRealmCentury: number
  /** FamilyHead events per century (merchant families: a new head of a house). */
  familyHeadPerCentury: number
  /** Battles, wars, crown defaults, eruptions (volume only). */
  battles: number
  wars: number
  defaults: number
  eruptions: number
}

/** Loose bounds for Dramatic and Realistic (EVALUATION.md §3 P1b; measured values in the header). */
export const SANITY_BOUNDS = {
  nonFinite: 0,
  dominanceYears: 300,
  warlessCenturies: 6,
  reignMedianMin: 8,
  reignShortMax: 0.2,
  accessionsPerRealmCenturyMax: 9,
  familyHeadPerCenturyMax: 150,
  /** Events at most this multiple of the off world's on the same seed (only checked when both are measured; measured <= 1.43). */
  eventsRatioMax: 2,
}

export function sanityRow(seed: number, preset: PresetName, h: History): SanityRow {
  const N = h.settlements.length
  const S = h.snapshotCount
  let nonFinite = 0
  const floats: (Float32Array | undefined)[] = [h.population, h.wealth, h.treasury, h.crownDebt, h.strength]
  for (const a of floats) if (a) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nonFinite++

  // dominance: the largest polity's share of the people, per snapshot
  let run = 0, best = 0
  const share = new Float64Array(h.polities.length)
  for (let s = 0; s < S; s++) {
    share.fill(0)
    let tot = 0
    for (let i = 0; i < N; i++) {
      const p = h.population[s * N + i]
      if (!(p > 0)) continue
      tot += p
      const q = h.polity[s * N + i]
      if (q >= 0) share[q] += p
    }
    let mx = 0
    for (let q = 0; q < share.length; q++) if (share[q] > mx) mx = share[q]
    if (tot > 0 && mx / tot > 0.8) { run += h.snapshotInterval; if (run > best) best = run } else run = 0
  }

  // wars per century from the first state's century on
  const firstState = h.polities.reduce((m, p) => Math.min(m, p.foundedYear), Infinity)
  const C = Math.floor(h.years / 100) + 1
  const warsIn = new Int32Array(C)
  for (let w = 0; w < h.wars.count; w++) warsIn[Math.min(C - 1, Math.floor(h.wars.startYear[w] / 100))]++
  let warless = 0
  if (Number.isFinite(firstState)) for (let c = Math.floor(firstState / 100) + 1; c < C - 1; c++) if (warsIn[c] === 0) warless++

  // reigns
  const lens: number[] = []
  for (const r of h.rulers) if (r.ended >= 0 && r.ended < h.years) lens.push(r.ended - r.acceded)
  lens.sort((a, b) => a - b)
  const reignMedian = lens.length ? lens[Math.floor(lens.length / 2)] : 0
  const reignShort = lens.length ? lens.filter((x) => x < 3).length / lens.length : 0

  // realm-centuries (polity alive years / 100)
  let realmYears = 0
  for (const p of h.polities) { const end = p.endedYear >= 0 ? p.endedYear : h.years; realmYears += Math.max(0, end - p.foundedYear) }
  let accessions = 0, familyHead = 0, battles = 0, defaults = 0, eruptions = 0
  for (const e of h.events) {
    if (e.type === EventType.RulerAcceded) accessions++
    else if (e.type === EventType.FamilyHead) familyHead++
    else if (e.type === EventType.BattleFought) battles++
    else if (e.type === EventType.CrownDefault) defaults++
    else if (e.type === EventType.Eruption) eruptions++
  }
  return {
    seed, preset, years: h.years, events: h.events.length, nonFinite, dominanceYears: best, warlessCenturies: warless,
    reigns: lens.length, reignMedian, reignShort: +reignShort.toFixed(3),
    accessionsPerRealmCentury: +(realmYears > 0 ? accessions / (realmYears / 100) : 0).toFixed(2),
    familyHeadPerCentury: +(familyHead / (h.years / 100)).toFixed(1),
    battles, wars: h.wars.count, defaults, eruptions,
  }
}

/** The bounds a row breaks (empty: sane). `off`: the same seed's off row, for the events ratio. */
export function sanityViolations(r: SanityRow, off?: SanityRow): string[] {
  const B = SANITY_BOUNDS, v: string[] = []
  if (r.nonFinite > B.nonFinite) v.push(`nonFinite ${r.nonFinite}`)
  if (r.dominanceYears > B.dominanceYears) v.push(`dominanceYears ${r.dominanceYears} > ${B.dominanceYears}`)
  if (r.warlessCenturies > B.warlessCenturies) v.push(`warlessCenturies ${r.warlessCenturies} > ${B.warlessCenturies}`)
  if (r.reignMedian < B.reignMedianMin) v.push(`reignMedian ${r.reignMedian} < ${B.reignMedianMin}`)
  if (r.reignShort > B.reignShortMax) v.push(`reignShort ${r.reignShort} > ${B.reignShortMax}`)
  if (r.accessionsPerRealmCentury > B.accessionsPerRealmCenturyMax) v.push(`accessionsPerRealmCentury ${r.accessionsPerRealmCentury} > ${B.accessionsPerRealmCenturyMax}`)
  if (r.familyHeadPerCentury > B.familyHeadPerCenturyMax) v.push(`familyHeadPerCentury ${r.familyHeadPerCentury} > ${B.familyHeadPerCenturyMax}`)
  if (off && r.events > B.eventsRatioMax * off.events) v.push(`events ${r.events} > ${B.eventsRatioMax} x off ${off.events}`)
  return v
}

export function runSanity(seed: number, preset: PresetName, years = 2000, extra: HistoryOptions = {}): SanityRow {
  const opts: HistoryOptions = { years, ...extra }
  opts.preset = preset
  return sanityRow(seed, preset, simulateHistory(generateWorld(seed), opts))
}

const PROC = (globalThis as { process?: { argv: string[]; exit(code: number): never } }).process
if (PROC && import.meta.url === `file://${PROC.argv[1]}`) {
  const argv = PROC.argv.slice(2)
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined }
  const preset = (val('--preset') ?? 'dramatic') as PresetName
  const years = Number(val('--years') ?? 2000)
  const out = val('--out')
  // node:fs only on the CLI path (as realismStats.ts: the module stays browser-safe)
  const { appendFileSync, existsSync, readFileSync } = (await import('node:' + 'fs')) as {
    appendFileSync(p: string, s: string): void; existsSync(p: string): boolean; readFileSync(p: string, e: string): string
  }
  const skip = new Set([val('--preset'), val('--years'), out])
  const seeds = argv.filter((a: string) => /^\d+$/.test(a) && !skip.has(a)).map(Number)
  const check = argv.includes('--check'), json = argv.includes('--json')
  let bad = 0
  for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) {
    const done = out && existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l: string) => JSON.parse(l) as SanityRow) : []
    const r = done.find((x) => x.seed === seed && x.preset === preset && x.years === years) ?? runSanity(seed, preset, years)
    if (out && !done.includes(r)) appendFileSync(out, JSON.stringify(r) + '\n')
    const v = preset !== 'off' ? sanityViolations(r) : []
    if (json) console.log(JSON.stringify(r))
    else console.log(Object.entries(r).map(([k, x]) => `${k}=${x}`).join(' ') + (v.length ? `  VIOLATES: ${v.join('; ')}` : ''))
    if (v.length) bad++
  }
  if (check && bad > 0) { console.error(`sanity: ${bad} seed(s) out of bounds`); PROC.exit(1) }
}
