// renaming: stats harness. Per seed: renamings by cause and form, towns renamed more than once, restorations, the size of
// the towns renamed, and the run's time with the system on and off (--off). --detail prints every renaming as a story:
// the year, the old name and the new, why, by whom, and who kept the old name.
//   node src/sim/history/renaming/renamingStats.ts [--off] [--detail] [--years N] seeds...

import { CITY_POPULATION, RenameCause, RenameForm, TOWN_POPULATION, settlementNameAt } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'

const CAUSES = Object.keys(RenameCause) as (keyof typeof RenameCause)[]
const FORMS = Object.keys(RenameForm) as (keyof typeof RenameForm)[]

function popAt(h: History, id: number, y: number): number {
  return h.population[Math.floor(y / h.snapshotInterval) * h.settlements.length + id]
}

/** One renaming as a line of the chronicle. */
export function story(h: History, i: number): string {
  const R = h.renamings
  const v = R.settlement[i], y = R.year[i]
  const st = h.settlements[v]
  const before = R.previous[i] >= 0 ? R.name[R.previous[i]] : st.name
  const cause = CAUSES[R.cause[i]], form = FORMS[R.form[i]]
  const pol = R.polity[i] >= 0 ? h.polities[R.polity[i]] : null
  const ruler = R.ruler[i] >= 0 ? h.rulers[R.ruler[i]] : null
  const house = R.dynasty[i] >= 0 ? h.dynasties[R.dynasty[i]] : null
  const parts: string[] = []
  parts.push(`${y}: ${before} -> ${R.name[i]} [${cause}/${form}]`)
  parts.push(`(${h.peoples[st.people].name} town, ${Math.round(popAt(h, v, y))} people${pol && pol.capitals.some((c, k) => c === v && pol.capitalYears[k] <= y) ? ', a capital' : ''})`)
  if (pol) parts.push(`by ${pol.name} (${h.peoples[pol.people].name})`)
  if (ruler && (R.form[i] === RenameForm.Ruler || R.cause[i] === RenameCause.Capital)) parts.push(`ruler ${ruler.name} ${ruler.regnal}`)
  if (house && R.form[i] === RenameForm.House) parts.push(`house ${house.name}`)
  if (R.faith[i] >= 0) parts.push(`faith ${h.faiths[R.faith[i]].name}`)
  if (R.source[i] >= 0) parts.push(`ruin of ${h.settlements[R.source[i]].name} (abandoned ${h.settlements[R.source[i]].abandonedYear})`)
  if (R.restored[i] >= -1 && R.form[i] === RenameForm.Restored) parts.push(`restores the name of ${R.restored[i] >= 0 ? R.year[R.restored[i]] : 'its founding'}`)
  if (R.keptBy[i] >= 0) parts.push(`the ${h.peoples[R.keptBy[i]].name} keep calling it ${before}`)
  const end = st.abandonedYear >= 0 ? st.abandonedYear : h.years
  parts.push(`-> ${settlementNameAt(h, v, end)} at ${end}`)
  return parts.join(' ')
}

export interface RenamingRow {
  seed: number
  years: number
  ms: number
  msOff: number
  settlements: number
  count: number
  byCause: number[]
  byForm: number[]
  /** Settlements renamed (Distinguished aside), of them more than once; restorations; renamed while a town / city (at the year). */
  towns: number
  multi: number
  restored: number
  townSize: number
  /** Renamed with at least 1,000 people at the year. */
  thousand: number
  citySize: number
  kept: number
  distinguished: number
}

export function renamingRow(seed: number, years: number, off: boolean, detail: boolean): RenamingRow {
  const w = generateWorld(seed)
  if (off) { runHistory(w, { years: 300 }); runHistory(w, { years: 300, renaming: false }) } // (warm-up, so the timings compare)
  let t = performance.now()
  const run = runHistory(w, { years })
  const ms = performance.now() - t
  let msOff = NaN
  if (off) { t = performance.now(); runHistory(w, { years, renaming: false }); msOff = performance.now() - t }
  const h = run.history
  const R = h.renamings
  const byCause = new Array<number>(CAUSES.length).fill(0)
  const byForm = new Array<number>(FORMS.length).fill(0)
  const per = new Map<number, number>() // (counts only)
  let restored = 0, townSize = 0, citySize = 0, kept = 0, distinguished = 0, thousand = 0
  for (let i = 0; i < R.count; i++) {
    byCause[R.cause[i]]++
    byForm[R.form[i]]++
    if (R.cause[i] === RenameCause.Distinguished) { distinguished++; continue }
    per.set(R.settlement[i], (per.get(R.settlement[i]) ?? 0) + 1)
    if (R.cause[i] === RenameCause.Restored || R.form[i] === RenameForm.Restored) restored++
    const p = popAt(h, R.settlement[i], R.year[i])
    if (p >= 1000) thousand++
    if (p >= TOWN_POPULATION) townSize++
    if (p >= CITY_POPULATION) citySize++
    if (R.keptBy[i] >= 0) kept++
  }
  let multi = 0
  for (const c of per.values()) if (c > 1) multi++
  const row: RenamingRow = { seed, years, ms, msOff, settlements: h.settlements.length, count: R.count - distinguished, byCause, byForm, towns: per.size, multi, restored, townSize, thousand, citySize, kept, distinguished }
  if (detail) {
    console.log(`\n== seed ${seed}: ${row.count} renamings of ${row.towns} towns (${h.settlements.length} settlements) ==`)
    for (let i = 0; i < R.count; i++) console.log('  ' + story(h, i))
    const d = run.diag.renaming
    if (d) console.log('  diag ' + JSON.stringify(d))
  }
  return row
}

function main(): void {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const off = args.includes('--off')
  const detail = args.includes('--detail')
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const seeds = args.filter((a: string, i: number) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number)
  const list = seeds.length ? seeds : HISTORY_STATS_SEEDS
  const rows: RenamingRow[] = []
  console.log('seed  n  towns multi rest  town city kept dist  ' + CAUSES.map((c) => c.slice(0, 5)).join(' ') + '   ms' + (off ? '  msOff' : ''))
  for (const seed of list) {
    const r = renamingRow(seed, years, off, detail)
    rows.push(r)
    console.log(`${String(seed).padEnd(5)} ${String(r.count).padStart(2)} ${String(r.towns).padStart(5)} ${String(r.multi).padStart(5)} ${String(r.restored).padStart(4)}  ${String(r.townSize).padStart(4)} ${String(r.citySize).padStart(4)} ${String(r.kept).padStart(4)} ${String(r.distinguished).padStart(4)}  ` + r.byCause.map((x) => String(x).padStart(5)).join(' ') + `  ${Math.round(r.ms)}` + (off ? `  ${Math.round(r.msOff)}` : ''))
  }
  const sum = (f: (r: RenamingRow) => number): number => rows.reduce((a, r) => a + f(r), 0)
  const n = rows.length
  console.log(`mean renamings ${(sum((r) => r.count) / n).toFixed(1)} (min ${Math.min(...rows.map((r) => r.count))}, max ${Math.max(...rows.map((r) => r.count))}); by cause ` + CAUSES.map((c, k) => `${c} ${(sum((r) => r.byCause[k]) / n).toFixed(2)}`).join(', '))
  console.log('by form ' + FORMS.map((f, k) => `${f} ${(sum((r) => r.byForm[k]) / n).toFixed(2)}`).join(', '))
  console.log(`towns renamed more than once ${(sum((r) => r.multi) / n).toFixed(2)}; restorations ${(sum((r) => r.restored) / n).toFixed(2)}; at 1,000 people or more ${(sum((r) => r.thousand) / n).toFixed(2)}, town size ${(sum((r) => r.townSize) / n).toFixed(2)}, city ${(sum((r) => r.citySize) / n).toFixed(2)}; old name kept ${(sum((r) => r.kept) / n).toFixed(2)}`)
  if (off) console.log(`time on ${Math.round(sum((r) => r.ms))} ms, off ${Math.round(sum((r) => r.msOff))} ms`)
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) main()
