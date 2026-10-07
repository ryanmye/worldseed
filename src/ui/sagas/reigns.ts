// Sagas: a long state's history in chapters by reign, one per house that held its throne for a good while ("House Mera,
// 812–1040"): how the house came to the throne, how many of it reigned and the longest of them, the wars begun in its
// time (by name where they have one), the greatest town taken, the seat moved, the faith of the realm changed, the great
// works begun, the provinces that broke away, and how its time ended. Short-lived houses are passed over (the topical
// chapters still tell of them). Every sentence is a recorded fact of those years.

import { AccessionHow, EventType, LandmarkRank, PolityOrigin, ReignEnd } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { topBy } from './facts.ts'
import { warName } from './wars.ts'
import { list, num, plural, type PhraseTable, type Voice } from './voice.ts'

export const REIGN_T: PhraseTable = {
  rcHead: [['House {name}, {from}–{to}'], ['The Years of House {name}']],
  rcHeadNow: [['House {name}, from {from}'], ['The Years of House {name}']],
  rcOpen: [
    ['House {name} came to the throne in {from} with {ruler}, who {how}; {n} of the house reigned {span}.', 'In {from} {ruler} {how}, and House {name} held the throne {span}, with {n}.'],
    ['In {from} {ruler} {how}, and the crown passed to House {name}, which held it {span}: {n} of its blood reigned.'],
  ],
  rcOpenOne: [['In {from} {ruler} {how}, and reigned {years} years.'], ['In {from} {ruler} {how}, and held the crown {years} winters.']],
  rcLong: [[' The longest reign of them was that of {ruler}, {years} years.'], [' Longest of them reigned {ruler}, {years} winters.']],
  rcWarsNamed: [['In those years the realm fought {named}{more}.', 'Its wars in those years included {named}{more}.'], ['In those years it waged {named}{more}.']],
  rcWars: [['In those years it went to war {times}.'], ['{times} in those years it took up the spear.']],
  rcTook: [['Its armies took {town} in {year}.', 'In {year} its armies took {town}.'], ['In {year} its spears won {town}.']],
  rcSeat: [['In {year} the seat moved to {town}.'], ['In {year} the throne was carried to {town}.']],
  rcFaith: [['In {year} {faith} became the faith of the realm.'], ['In {year} the realm was given to {faith}.']],
  rcWork: [['{lm} was begun in {year}.', 'Work on {lm} began in {year}.'], ['In {year} the first stones of {lm} were laid.']],
  rcBroke: [['{list} broke away.', 'It lost {list}, which broke away.'], ['{list} broke from it.']],
  rcEnd: [[' Its time ended in {year}, when {ruler} {end}.'], [' Its days ended in {year}, when {ruler} {end}.']],
}

const HOW: Record<number, string> = {
  [AccessionHow.Founded]: 'founded the realm',
  [AccessionHow.Inherited]: 'inherited the throne',
  [AccessionHow.Elected]: 'was chosen to rule',
  [AccessionHow.Usurped]: 'seized the throne',
  [AccessionHow.Conquered]: 'was set on the throne by conquerors',
  [AccessionHow.Union]: 'took the throne through a marriage claim',
  [AccessionHow.Claimed]: 'rose as a rival claimant',
}
const END: Record<number, string> = {
  [ReignEnd.Natural]: 'died with no heir of the house to follow',
  [ReignEnd.Battle]: 'fell in battle',
  [ReignEnd.Sack]: 'was killed when the capital fell',
  [ReignEnd.Overthrown]: 'was overthrown and killed',
  [ReignEnd.Deposed]: 'was driven from the throne',
  [ReignEnd.Plague]: 'died of plague',
  [ReignEnd.RealmEnded]: 'saw the realm itself come to an end',
  [ReignEnd.TermEnded]: 'came to the end of a term',
}

/** The reign chapters of polity p (none for a state of few reigns or one house). */
export function reignChapters(c: Ctx, v: Voice, p: number, reigns: number[]): { head: string; text: string }[] {
  const rd = c.rd
  const pd = c.pd
  if (!rd || !pd || reigns.length < 6) return []
  const Y = c.Y
  const runs: { d: number; rs: number[] }[] = []
  for (const r of reigns) {
    const d = rd.rulers[r].dynasty
    const last = runs[runs.length - 1]
    if (last && last.d === d) last.rs.push(r)
    else runs.push({ d, rs: [r] })
  }
  const endOf = (r: number) => (c.reignEndedBy(r) ? rd.rulers[r].ended : Y)
  const housed = runs.filter((x) => x.d >= 0)
  if (housed.length < 2) return []
  // (the houses that held it long: at least three reigns or thirty years; at most eight chapters, the longest)
  const span = (x: { rs: number[] }) => endOf(x.rs[x.rs.length - 1]) - rd.rulers[x.rs[0]].acceded
  const kept = new Set(topBy(housed.filter((x) => x.rs.length >= 3 || span(x) >= 30), (x) => span(x) + 1, 8))
  const W = pd.wars
  const out: { head: string; text: string }[] = []
  const L = c.h.landmarks
  for (const run of runs) {
    if (!kept.has(run)) continue
    const r0 = run.rs[0], rz = run.rs[run.rs.length - 1]
    const from = rd.rulers[r0].acceded, to = endOf(rz)
    const name = c.h.dynasties[run.d]?.name ?? ''
    const ongoing = !c.reignEndedBy(rz)
    const head = v.p(ongoing ? 'rcHeadNow' : 'rcHead', { name, from, to })
    const s: string[] = []
    const how = HOW[rd.rulers[r0].how] ?? 'took the throne'
    if (run.rs.length === 1) s.push(v.p('rcOpenOne', { from, ruler: c.ruler(r0), how, years: to - from }))
    else {
      s.push(v.p('rcOpen', { name, from, ruler: c.ruler(r0), how, n: plural(run.rs.length, 'ruler'), span: ongoing ? 'to this day' : `until ${to}` }).replace(/; (\w+) rulers of the house/, (_m, n: string) => `; ${n} of the house`))
      const long = topBy(run.rs, (r) => c.reignYears(r), 1)[0]
      if (long !== undefined && long !== r0 && c.reignYears(long) >= 25) s[s.length - 1] += v.p('rcLong', { ruler: c.ruler(long), years: c.reignYears(long) })
    }
    // wars begun in its time
    if (W) {
      const ws = (pd.warsOf[p] ?? []).filter((w) => W.startYear[w] >= from && W.startYear[w] < Math.max(to, from + 1) && W.startYear[w] <= Y)
      const named = ws.map((w) => warName(c, w)).filter(Boolean)
      if (named.length) s.push(v.p('rcWarsNamed', { named: list(named.slice(0, 2)), more: ws.length > named.slice(0, 2).length ? `, among ${plural(ws.length, 'war')} in all` : '' }))
      else if (ws.length >= 2) s.push(v.p('rcWars', { times: ws.length === 2 ? 'twice' : `${num(ws.length)} times` }))
      // the greatest town taken
      const took = c.type(EventType.Conquered).map((i) => c.ev(i)).filter((e) => e.year >= from && e.year <= to && ws.includes(e.value) && c.polityOf(e.settlement, e.year + c.h.snapshotInterval) === p)
      const big = topBy(took, (e) => c.pop(e.settlement, Math.max(0, e.year - 1)), 1)[0]
      if (big && c.pop(big.settlement, Math.max(0, big.year - 1)) >= 2000) s.push(v.p('rcTook', { town: c.name(big.settlement, big.year), year: big.year }))
    }
    const x = pd.list[p]
    for (let k = 1; k < x.capitals.length; k++) if (x.capitalYears[k] >= from && x.capitalYears[k] < to && x.capitalYears[k] <= Y) { s.push(v.p('rcSeat', { year: x.capitalYears[k], town: c.name(x.capitals[k], x.capitalYears[k]) })); break }
    const sf = c.type(EventType.StateReligion).map((i) => c.ev(i)).find((e) => e.year >= from && e.year < to && c.capital(p, e.year) === e.settlement)
    if (sf) s.push(v.p('rcFaith', { year: sf.year, faith: c.faith(sf.value) }))
    if (L) {
      for (let i = 0; i < L.count; i++) if (L.polity[i] === p && L.rank[i] === LandmarkRank.Great && L.begunYear[i] >= from && L.begunYear[i] < to && L.begunYear[i] <= Y) {
        const nm = c.landmark(i, L.begunYear[i]), t = c.name(L.settlement[i], L.begunYear[i])
        s.push(v.p('rcWork', { lm: `${nm}${nm.includes(t) ? '' : ` at ${t}`}`, year: L.begunYear[i] }))
        break
      }
    }
    const kids = (pd.children[p] ?? []).filter((q) => { const y = pd.list[q].foundedYear; return y >= from && y < to && y <= Y && (pd.list[q].origin === PolityOrigin.Revolt || pd.list[q].origin === PolityOrigin.CivilWar || pd.list[q].origin === PolityOrigin.Colonial) })
    if (kids.length) s.push(v.p('rcBroke', { list: kids.length <= 2 ? list(kids.map((q) => c.pname(q))) : `${c.pname(kids[0])} and ${num(kids.length - 1)} others` }))
    // (after the opening, in the order of their years)
    const yearOf = (t: string) => Number(/\b(\d{3,4})\b/.exec(t)?.[1] ?? from)
    const mid = s.slice(1).map((t, i) => [t, yearOf(t), i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0])
    s.length = 1
    s.push(...mid)
    if (!ongoing) s[s.length - 1] += v.p('rcEnd', { year: to, ruler: c.ruler(rz), end: END[rd.rulers[rz].end] ?? 'died' })
    out.push({ head, text: s.join(' ') })
  }
  return out
}
