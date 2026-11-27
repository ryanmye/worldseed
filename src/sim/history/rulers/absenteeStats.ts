// absentee: headless harness for absentee and do-nothing rulers (absentee-rulers.md targets). Run with:
//   node --experimental-strip-types --no-warnings src/sim/history/rulers/absenteeStats.ts [seed ...]   (default 1 7 42 1234)
//   ... --years 2000   ... --json (one row per seed)
// Per seed, off (HistoryOptions.absentee false) against on: the share of dynastic reigns of 2+ years that saw significant
// deference (peak weight deferenceK >= 0.5; target 10-25%), declines (CouncilRuled) by cause and how they ended (the reign,
// a regent's handover, a return, a union's end; and of the reigns ended, by overthrow or deposition), captives, blame borne,
// and the realism guards: overthrows (ReignEnded Overthrown + Deposed; within +-15% of off), contested successions and revolts.
// Counts of a few dozen coups move by chance once the run diverges, so the guard is also read noise-free: the summed overthrow
// hazard of every throne-year of the on run with its deference against the same state without it (hazard x; guard <= 1.15).
import { EventType, ReignEnd } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { deferenceK } from './deference.ts'
import { contestChance, overthrowHazard } from './hazards.ts'
import { ABSENTEE } from './absentee.ts'

export interface AbsenteeRow {
  seed: number
  reigns: number
  significant: number
  share: number
  declines: number[]
  ended: number[]
  endedBy: { death: number; coup: number; other: number; reigning: number }
  captives: number
  blamed: number
  overthrowOff: number
  overthrowOn: number
  contestedOff: number
  contestedOn: number
  revoltsOff: number
  revoltsOn: number
  /** The direct effect, free of the run's chaos: the summed yearly overthrow hazard and contest chance of every throne in the
   * on run, with its deference against the same state without it (ratio; 1 = no effect). */
  hazardRatio: number
  contestRatio: number
  /** The extra overthrow hazard (on - off) by the cause behind the deference (a decaying sum of what each cause fed), per cause. */
  hazardBy: number[]
}

const count = (h: History, t: number, f?: (e: History['events'][number]) => boolean): number => {
  let n = 0
  for (const e of h.events) if ((e.type as number) === t && (!f || f(e))) n++
  return n
}
const coups = (h: History): number => count(h, EventType.ReignEnded, (e) => e.extra === ReignEnd.Overthrown || e.extra === ReignEnd.Deposed)

export function absenteeRow(seed: number, years: number, withOff = true): AbsenteeRow {
  const w = generateWorld(seed)
  const off = withOff ? runHistory(w, { years }).history : ({ events: [] } as unknown as History)
  const peak = new Map<number, number>()
  let hOn = 0, hOff = 0, cOn = 0, cOff = 0
  const hBy = new Array(7).fill(0)
  let mix = new Float64Array(0), prevFed = new Float64Array(0)
  const run = runHistory(w, { years, absentee: true }, (s) => {
    const R = s.rul
    const ps = s.pol
    if (R === null || s.defer === null || ps === null) return
    const D = s.defer
    for (const p of ps.alive) {
      const r = p < R.pcap ? R.cur[p] : -1
      if (r < 0) continue
      const k = deferenceK(s, p)
      if (k > (peak.get(r) ?? 0)) peak.set(r, k)
      // (read-only: the hazards with the deference state, then with it set aside for the call and restored)
      const x1 = overthrowHazard(s, ps, R, p), c1 = contestChance(s, ps, R, p)
      s.defer = null
      const x0 = overthrowHazard(s, ps, R, p), c0 = contestChance(s, ps, R, p)
      s.defer = D
      hOn += x1; hOff += x0; cOn += c1; cOff += c0
      if (x1 !== x0 && p < D.value.length) {
        let tot = 0
        for (let c = 1; c < 7; c++) tot += mix[p * 7 + c]
        if (tot > 0) for (let c = 1; c < 7; c++) hBy[c] += (x1 - x0) * mix[p * 7 + c] / tot
      }
    }
    // (the cause mix: each cause's feed decaying as deference does, x SEAT.deferKeep a year)
    const P = D.value.length
    if (mix.length < P * 7) { const m = new Float64Array(P * 7); m.set(mix); mix = m; const f = new Float64Array(P * 7); f.set(prevFed); prevFed = f }
    for (let i = 0; i < P * 7; i++) { mix[i] = mix[i] * 0.98 + (D.fed[i] - prevFed[i]); prevFed[i] = D.fed[i] }
  })
  const on = run.history
  const R = on.rulers ?? []
  let reigns = 0, significant = 0
  for (let r = 0; r < R.length; r++) {
    const x = R[r]
    if (x.dynasty < 0 || (x.ended >= 0 ? x.ended : years) - x.acceded < 2) continue
    reigns++
    if ((peak.get(r) ?? 0) >= 0.5) significant++
  }
  const d = run.diag.absentee!
  // How the reigns in decline ended (CouncilRuled `other` the reign).
  const endedBy = { death: 0, coup: 0, other: 0, reigning: 0 }
  for (const e of on.events) {
    if ((e.type as number) !== EventType.CouncilRuled) continue
    const x = R[e.other]
    if (!x || x.ended < 0) { endedBy.reigning++; continue }
    const c = x.end
    if (c === ReignEnd.Overthrown || c === ReignEnd.Deposed) endedBy.coup++
    else if (c === ReignEnd.Natural || c === ReignEnd.Battle || c === ReignEnd.Plague || c === ReignEnd.Sack) endedBy.death++
    else endedBy.other++
  }
  return {
    seed, reigns, significant, share: reigns > 0 ? significant / reigns : 0, declines: d.declines.slice(1), ended: d.ended.slice(), endedBy,
    captives: d.captives, blamed: d.blamed,
    overthrowOff: coups(off), overthrowOn: coups(on),
    contestedOff: count(off, EventType.SuccessionCrisis), contestedOn: count(on, EventType.SuccessionCrisis),
    revoltsOff: count(off, EventType.Revolt), revoltsOn: count(on, EventType.Revolt),
    hazardRatio: hOff > 0 ? hOn / hOff : 1, contestRatio: cOff > 0 ? cOn / cOff : 1,
    hazardBy: hBy.slice(1).map((x) => (hOff > 0 ? x / hOff : 0)),
  }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`

export function formatAbsentee(rows: AbsenteeRow[]): string {
  const out = ['seed  reigns  signif  share   declines(Mi Ab Un In If Ca)  ended(reign major home union)  of declines: death coup other reigning  capt  blame  coups off->on  contested off->on  revolts off->on']
  const sum = (f: (r: AbsenteeRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  for (const r of rows) {
    out.push(`${String(r.seed).padEnd(5)} ${String(r.reigns).padStart(6)} ${String(r.significant).padStart(7)}  ${pct(r.share).padStart(6)}  ${r.declines.join(' ').padEnd(27)} ${r.ended.join(' ').padEnd(30)} ${[r.endedBy.death, r.endedBy.coup, r.endedBy.other, r.endedBy.reigning].join(' ').padEnd(34)} ${String(r.captives).padStart(4)} ${String(r.blamed).padStart(6)}  ${r.overthrowOff}->${r.overthrowOn}`.padEnd(160) + `  ${r.contestedOff}->${r.contestedOn}   ${r.revoltsOff}->${r.revoltsOn}   hazard x${r.hazardRatio.toFixed(3)} (Mi Ab Un In If Ca +${r.hazardBy.map((x) => x.toFixed(3)).join(' +')}) contest x${r.contestRatio.toFixed(3)}`)
  }
  const oo = sum((r) => r.overthrowOff), on = sum((r) => r.overthrowOn)
  out.push(`all: share ${pct(sum((r) => r.significant) / Math.max(1, sum((r) => r.reigns)))} (target 10-25%); coups ${oo}->${on} (${pct(on / Math.max(1, oo) - 1)}, guard +-15%); contested ${sum((r) => r.contestedOff)}->${sum((r) => r.contestedOn)}; revolts ${sum((r) => r.revoltsOff)}->${sum((r) => r.revoltsOn)}; direct overthrow hazard x${(sum((r) => r.hazardRatio) / rows.length).toFixed(3)} (guard <= 1.15), contest x${(sum((r) => r.contestRatio) / rows.length).toFixed(3)}`)
  return out.join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const yi = argv.indexOf('--years')
  const years = yi >= 0 ? Number(argv[yi + 1]) : 2000
  const seeds = argv.filter((a, i) => !a.startsWith('--') && !(yi >= 0 && i === yi + 1) && !(argv[i - 1] === '--set')).map(Number)
  const json = argv.includes('--json')
  // --set k=v,k=v: ABSENTEE overrides (tuning); --no-off: skip the off runs (their counts read 0)
  const si = argv.indexOf('--set')
  if (si >= 0) for (const kv of argv[si + 1].split(',')) { const [k, v] = kv.split('='); (ABSENTEE as Record<string, number>)[k] = Number(v) }
  const rows: AbsenteeRow[] = []
  for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) {
    const r = absenteeRow(seed, years, !argv.includes('--no-off'))
    rows.push(r)
    if (json) console.log(JSON.stringify(r))
  }
  if (!json) console.log(formatAbsentee(rows))
}
