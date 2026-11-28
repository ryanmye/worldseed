// Why: the base rule catalogue (causal-explorer.md §4.2, R1–R23) over the 8cabf09 records plus History.why when present.
// Each rule finds the candidate causes of one node: recorded links (an id stored in a field: conf 1), rule-derived links (a
// pattern of place, polity and time window: conf = the rule's measured precision, RULE_CONF, or its prior where unmeasured)
// and contributing conditions (synthetic leaves with a weight: a share of a recorded drive or accumulator; §4.3).
// Conditions may themselves have causes: a rivalry part is backed by the event that made it (a border dispute, an earlier
// war, a crisis), found by the same rules (R4b–R4g, R10a backing).

import { AbandonCause, AccessionHow, BattleKind, CrisisBit, EventType as E, PolityEnd, PolityOrigin, RIVALRY_PARTS, ReignEnd, RevoltCause, RivalryPart, UnrestPart, WarWhyFlag, decodeLog2 } from '../../../contract.ts'
import { smoothstep } from '../../../sim/util.ts'
import { RELATION, UNREST, WAR } from '../../../sim/history/polity/params.ts'
import { WhyTier, condKey, evKey, warKey } from '../graph.ts'
import type { WhyNode } from '../graph.ts'
import type { CauseIndex } from '../causeIndex.ts'
import { atPlace, ev, ofType, pairKey, placeName, polAt, polName } from '../causeIndex.ts'
import { decidingSplit, factorClause } from '../../battleFormat.ts' // n4c: a battle's deciding factor
import type { History } from '../../../contract.ts'

/** n4c: what decided battle b, as a clause ("the defenders' numbers told, some 11,000 against 4,600 (about 2.4 to 1)"), or ''. */
function decidingCause(h: History, b: number): string {
  const { top, con } = decidingSplit(h, b)
  if (top) return factorClause(h, b, top)
  if (con[0]) return `the day went to ${h.battles.winner[b] === 0 ? 'the attackers' : 'the defenders'}, though ${factorClause(h, b, con[0], false)}`
  return ''
}

/** One candidate cause of a node. `node` describes a condition (synthetic); events and entities are described by the explainer. */
export interface Cand {
  key: string
  tier: WhyTier
  conf: number
  via: string
  value?: string
  node?: WhyNode
}

/**
 * Rule confidences: the measured precision of each rule against the records (whyStats.ts, seeds 1, 7, 42, 1234 at 2000 y),
 * where it has been measured; else the plan's prior (design default, §4.2). `measured` lists the ones that are.
 */
export const RULE_CONF: Record<string, number> = {
  // measured (whyStats.ts, 4 seeds × 2000 y, causes on; hits in brackets): R4b 0.05 [56], R4c 1.0 [25], R4d 0.82 [92],
  // R10bProvincial 0.73 [984] (0.56 on seeds 42 and 1234 at 1000 y: kept at 0.6, "perhaps", not "likely"), R10bEthnic 1.0 [919], R16burst 0.99 [680]. Too few hits to measure (prior kept): R10bPeasant [6],
  // R10bReligious [3], R16war [1]. R4b's border dispute is rarely a real share of the rivalry (the claim term is mostly
  // contested farmland): shown only below the chain threshold, i.e. not drawn. Measured 1.0 is capped at 0.95 (a rule is never
  // shown as certain: that is the recorded tier's).
  R1: 1, R2b: 0.95, R4b: 0.05, R4c: 0.95, R4d: 0.8, R4f: 0.9, R4g: 0.4, R6a: 0.95, R6b: 0.9, R6c: 0.95, R6d: 0.9, R7: 0.8,
  R9: 0.9, R10b: 0.6, R10bPeasant: 0.6, R10bEthnic: 0.95, R10bProvincial: 0.6, R10bReligious: 0.6, R11: 0.95, R12: 0.95,
  R13Battle: 0.7, R13Sack: 0.8, R13Usurp: 0.85, R13Plague: 0.9, R13Realm: 0.95, R15: 0.95, R16burst: 0.95, R16blight: 0.5,
  R16war: 0.5, R17: 0.6, R18: 0.8, R20: 0.8, R21: 0.9, Rmisc: 0.6,
}
export const RULE_MEASURED = new Set<string>(['R4b', 'R4c', 'R4d', 'R10bProvincial', 'R10bEthnic', 'R16burst'])

const conf = (id: string) => RULE_CONF[id] ?? 0.5
const rule = (key: string, id: string, w = 1): Cand => ({ key: key, tier: WhyTier.Rule, conf: conf(id) * w, via: id })
const rec = (key: string, via: string): Cand => ({ key, tier: WhyTier.Recorded, conf: 1, via })
function cond(code: string, subject: number, year: number, place: number, label: string, weight: number, value: string, via = `cond:${code}`, tier: WhyTier = WhyTier.Condition): Cand {
  const key = condKey(code, subject)
  return { key, tier, conf: weight, via, value, node: { key, kind: 'cond', id: subject, year, place, label } }
}

export const RIVALRY_NAMES: readonly string[] = ['Claim', 'Dispute', 'Differ', 'Hunger', 'RecentWar', 'Trade', 'Marriage', 'Faith', 'Grudge', 'Arms', 'TradeRival', 'Bloc', 'Reputation', 'Secession', 'Alarm', 'P15']
export const RIVALRY_LABEL: readonly string[] = [
  'rivalry: contested farmland', 'rivalry: claims meeting over open land', 'rivalry: peoples that differ', 'rivalry: hunger on the border',
  'rivalry: a war within living memory', 'trade between them', 'a marriage between their houses', 'rivalry of faiths', 'old grudges',
  'an arms race', 'trade rivalry', 'rival blocs', 'a name for faithlessness', 'rivalry: the break between them', 'alarm at an attack on a neighbour', 'rivalry',
]
export const UNREST_NAMES: Record<number, string> = {
  0: 'Famine', 1: 'Crowding', 2: 'BadTax', 3: 'Distance', 4: 'Exhaustion', 5: 'Crisis', 6: 'Corruption', 7: 'Foreign', 8: 'Conquest', 9: 'Colony', 10: 'Faith',
  11: 'Taxes', 12: 'Burghers', 13: 'Urban', 22: 'Displaced', 23: 'Generations', 24: 'Disaster', 25: 'Immiseration', 26: 'Coercion', 27: 'Shock',
}
export const UNREST_LABEL: Record<number, string> = {
  0: 'unrest: a recent famine', 1: 'unrest: crowding', 2: 'unrest: taxes taken in a bad harvest', 3: 'unrest: the distance of the capital',
  4: 'unrest: weariness of war', 5: 'unrest: a contested succession', 6: 'unrest: corruption', 7: 'unrest: foreign rule', 8: 'unrest: a recent conquest',
  9: 'unrest: rule from overseas', 10: 'unrest: a ruler of another faith', 27: 'unrest: bitterness after an earlier rising',
}

// ---------------------------------------------------------------------------------------------------------------------------
// Helpers

/** The wars of the pair (p, q), any side, declared before year y (latest first). */
function pairWars(ix: CauseIndex, p: number, q: number, y: number): number[] {
  const W = ix.h.wars
  const out: number[] = []
  if (!W || !ix.pd) return out
  for (const w of ix.pd.warsOf[p] ?? []) {
    if (W.startYear[w] >= y) continue
    if ((W.attacker[w] === p && W.defender[w] === q) || (W.attacker[w] === q && W.defender[w] === p)) out.push(w)
  }
  return out.reverse()
}

/** BorderDispute events of the pair in [y0, y1], latest first. */
function pairOf(ix: CauseIndex, p: number, q: number, type: number, y0: number, y1: number): number[] {
  const a = ix.byPair.get(pairKey(p, q)) ?? []
  const out: number[] = []
  for (let k = a.length - 1; k >= 0; k--) {
    const e = ev(ix, a[k])
    if (e.type === type && e.year >= y0 && e.year <= y1) out.push(a[k])
  }
  return out
}

/** Crisis events of polity q (SuccessionCrisis, Regency at its capital, CivilWar against it) in [y0, y1], latest first. */
function crisesOf(ix: CauseIndex, q: number, y0: number, y1: number, before: number): number[] {
  const out: number[] = []
  for (const i of ofType(ix, E.SuccessionCrisis, y0, y1, (e) => e.value === q)) if (i < before) out.push(i)
  for (const i of ofType(ix, E.CivilWar, y0, y1, (e) => polAt(ix, e.other, e.year - 1) === q)) if (i < before) out.push(i)
  for (const i of ofType(ix, E.Regency, y0, y1, (e) => polAt(ix, e.settlement, e.year) === q)) if (i < before) out.push(i)
  return out.sort((a, b) => b - a)
}

/** Members (settlement ids) of polity p at year y. */
function members(ix: CauseIndex, p: number, y: number): number[] {
  const pd = ix.pd
  if (!pd || p < 0) return []
  const s = Math.max(0, Math.min(pd.snapshotCount - 1, Math.floor(y / pd.interval)))
  const out: number[] = []
  for (let id = 0; id < pd.settlementCount; id++) if (pd.polity[s * pd.settlementCount + id] === p) out.push(id)
  return out
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const fx = (x: number, d = 2) => x.toFixed(d)

/** Drive factors of a rolled declaration: each factor's signed ln-share (smoothstep factors against their ramp middle, 0.5). */
export function driveShares(ix: CauseIndex, w: number): { name: string; f: number; ln: number; share: number }[] | null {
  const W = ix.why?.wars
  if (!W || w >= W.odds.length || W.odds[w] === 0) return null
  const riv = (W.rivalry[w] / 255) * 2
  const adv = decodeLog2(W.odds[w])
  const crisis = W.flags[w] & WarWhyFlag.Crisis ? WAR.crisisMul : 1
  const e = W.exhaustion[w] / 255
  const mul = decodeLog2(W.mul[w])
  const fs = [
    { name: 'rivalry', f: smoothstep(WAR.rLow, WAR.rHigh, riv), mid: 0.5 },
    { name: 'odds', f: smoothstep(WAR.advLow, WAR.advHigh, adv), mid: 0.5 },
    { name: 'crisis', f: crisis, mid: 1 },
    { name: 'exhaustion', f: 1 - e, mid: 1 },
    { name: 'mul', f: mul, mid: 1 },
  ]
  const lns = fs.map((x) => (x.f > 0 ? Math.log(x.f / x.mid) : -5))
  const tot = lns.reduce((a, b) => a + Math.abs(b), 0) || 1
  return fs.map((x, k) => ({ name: x.name, f: x.f, ln: lns[k], share: lns[k] / tot }))
}

// ---------------------------------------------------------------------------------------------------------------------------
// Entities: what a polity, settlement, ruler or war stands for

export function entityCauses(ix: CauseIndex, kind: string, id: number): Cand[] {
  const h = ix.h
  if (kind === 'war') {
    const d = ix.warDecl[id]
    const out: Cand[] = []
    if (d >= 0) out.push(rec(evKey(d), 'R3'))
    return out
  }
  if (kind === 'polity') {
    const e = ix.polEnd[id] >= 0 ? ix.polEnd[id] : ix.polFound[id]
    return e >= 0 ? [rec(evKey(e), 'entity')] : []
  }
  if (kind === 'settlement') {
    const s = h.settlements[id]
    if (!s) return []
    const a = atPlace(ix, id, s.abandonedYear >= 0 ? [E.Abandoned] : [E.Founded], s.abandonedYear >= 0 ? s.abandonedYear : s.foundedYear, s.abandonedYear >= 0 ? s.abandonedYear : s.foundedYear)
    return a.length ? [rec(evKey(a[0]), 'entity')] : []
  }
  if (kind === 'ruler') {
    const e = ix.rulerEnd[id] >= 0 ? ix.rulerEnd[id] : ix.rulerAcc[id]
    return e >= 0 ? [rec(evKey(e), 'entity')] : []
  }
  return []
}

// ---------------------------------------------------------------------------------------------------------------------------
// Conditions' own causes (their backing events)

export function condCauses(ix: CauseIndex, code: string, i: number): Cand[] {
  const h = ix.h
  const e = ev(ix, i)
  if (!e) return []
  const y = e.year
  const out: Cand[] = []
  // War declarations: the parts of rivalry, the crisis, an order (R4b–R4g).
  if (e.type === E.WarDeclared && h.wars && e.value >= 0) {
    const w = e.value, p = h.wars.attacker[w], q = h.wars.defender[w]
    if (code === 'rivalry.Dispute') for (const d of pairOf(ix, p, q, E.BorderDispute, y - 100, y).slice(0, 1)) out.push(rule(evKey(d), 'R4b'))
    if (code === 'rivalry.RecentWar') for (const v of pairWars(ix, p, q, y)) { const pe = ix.warPeace[v]; if (pe >= 0 && ev(ix, pe).year >= y - RELATION.recentYears && pe < i) { out.push(rule(evKey(pe), 'R4c')); break } }
    if (code === 'crisis') for (const c of crisesOf(ix, q, y - 10, y, i).slice(0, 1)) out.push(rule(evKey(c), 'R4d'))
    if (code === 'rivalry.Hunger') {
      const ms = new Set([...members(ix, p, y), ...members(ix, q, y)])
      const fam = ofType(ix, E.Famine, y - 10, y, (x, k) => k < i && ms.has(x.settlement))
      if (fam.length) out.push(rule(evKey(fam[fam.length - 1]), 'R4g'))
    }
    if (code === 'rivalry.Secession') {
      const s = ofType(ix, E.Seceded, 0, y, (x, k) => k < i && ((x.value === p && polAt(ix, x.other, x.year - 1) === q) || (x.value === q && polAt(ix, x.other, x.year - 1) === p)))
      const c = ofType(ix, E.CivilWar, 0, y, (x, k) => k < i && (ix.h.wars.attacker[x.value] === p || ix.h.wars.attacker[x.value] === q) && (ix.h.wars.defender[x.value] === p || ix.h.wars.defender[x.value] === q))
      const all = [...s, ...c].sort((a, b) => b - a)
      if (all.length) out.push(rule(evKey(all[0]), 'Rmisc'))
    }
    if (code === 'order') for (const [k, g] of ix.orderGiven) if (h.orderOutcomes?.[k]?.product === w) out.push(rec(evKey(g), 'R4e'))
    if (code === 'holy' && ix.warHoly[w] >= 0) out.push(rec(evKey(ix.warHoly[w]), 'rec:HolyWar.value'))
    if (code === 'warlike' && h.rulers) { const r = rulerAt(ix, p, y); if (r >= 0 && ix.rulerAcc[r] >= 0 && ix.rulerAcc[r] < i) out.push(rec(evKey(ix.rulerAcc[r]), 'rec:ruler')) }
    return out
  }
  // Revolts: each part backed by an event (R10a).
  if (e.type === E.Revolt) return revoltBacking(ix, i, code.replace('unrest.', ''), false)
  // Famine factors (R16).
  if (e.type === E.Famine) {
    if (code === 'famine.Ravaged') for (const k of atPlace(ix, e.settlement, [E.Conquered, E.Sacked, E.SiegeLifted, E.Raid], y - 3, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R16war'))
    if (code === 'famine.Harvest' && ix.why) {
      const r = ix.why.famines.region[ix.famineRow.get(i) ?? -1]
      const W = ix.why.weather
      if (r !== undefined && W.regions > 0 && y < W.crisis.length) {
        const d = W.drought[y * W.regions + r] / 255, c = W.crisis[y] / 255
        if (d > 0) out.push(cond('weather.drought', i, y, e.settlement, 'a drought in the region', 1, `drought ${pct(d)} of the harvest`, 'rec:why.weather.drought', WhyTier.Recorded))
        if (c > 0) out.push(cond('weather.crisis', i, y, e.settlement, 'a bad year far and wide', 1, `the world's harvest down ${pct(c)}`, 'rec:why.weather.crisis', WhyTier.Recorded))
        const burst = ofType(ix, E.Famine, y, y).length
        if (d === 0 && c === 0) out.push(cond('weather.bad', i, y, e.settlement, 'a poor year in the region', 1, `harvest ${fx(W.harvest[y * W.regions + r] / 255 * 1.4)} of normal; ${burst} famines that year`, 'rec:why.weather.harvest', WhyTier.Recorded))
      }
    }
    return out
  }
  if (e.type === E.Abandoned && code === 'decline') {
    const mig = ofType(ix, E.Migration, y - 50, y, (x, k) => k < i && x.settlement === e.settlement)
    if (mig.length) out.push(rule(evKey(mig[mig.length - 1]), 'R17'))
  }
  return out
}

function rulerAt(ix: CauseIndex, p: number, y: number): number {
  const R = ix.h.rulers
  if (!R) return -1
  let best = -1
  for (let k = R.length - 1; k >= 0; k--) {
    const r = R[k]
    if (r.polity === p && r.acceded <= y && (r.ended < 0 || r.ended >= y)) { best = k; break }
  }
  return best
}

/** The event behind an unrest part (or, without records, behind the revolt's cause): famine, conquest, crisis, war, faith. */
function revoltBacking(ix: CauseIndex, i: number, part: string, direct: boolean): Cand[] {
  const e = ev(ix, i)
  const y = e.year, seat = e.settlement
  const p = polAt(ix, e.other, y)
  const out: Cand[] = []
  const id = (base: string) => (direct ? `R10b${base}` : 'R10a')
  const add = (k: number, r: string) => out.push(direct ? rule(evKey(k), r) : { ...rule(evKey(k), r), conf: Math.max(conf(r), 0.85) })
  if (part === 'Famine') for (const k of atPlace(ix, seat, [E.Famine], y - UNREST.famineYears, y).filter((k) => k < i).slice(0, 1)) add(k, id('Peasant'))
  if (part === 'Conquest') for (const k of atPlace(ix, seat, [E.Conquered], y - UNREST.conquestYears, y).filter((k) => k < i).slice(0, 1)) add(k, id('Ethnic'))
  if (part === 'Foreign') for (const k of atPlace(ix, seat, [E.Conquered, E.Joined, E.Defected], 0, y).filter((k) => k < i).slice(0, 1)) add(k, id('Ethnic'))
  if (part === 'Crisis' && p >= 0) for (const k of crisesOf(ix, p, y - 10, y, i).slice(0, 1)) add(k, id('Provincial'))
  if (part === 'Exhaustion' && p >= 0 && ix.pd) {
    for (const w of [...(ix.pd.warsOf[p] ?? [])].reverse()) {
      const d = ix.warDecl[w]
      if (d < 0 || d >= i) continue
      const end = ix.h.wars.endYear[w]
      if (end < 0 || end >= y - 10) { add(d, id('Provincial')); break }
    }
  }
  if (part === 'Faith' && p >= 0) for (const k of ofType(ix, E.Persecution, y - 50, y, (x, k) => k < i && polAt(ix, x.settlement, x.year) === p).slice(-1)) add(k, id('Religious'))
  if (part === 'Shock') for (const k of atPlace(ix, seat, [E.RevoltCrushed], y - 30, y).filter((k) => k < i).slice(0, 1)) add(k, 'R11')
  return out
}

// ---------------------------------------------------------------------------------------------------------------------------
// Events

export function eventCauses(ix: CauseIndex, i: number): Cand[] {
  const h = ix.h
  const e = ev(ix, i)
  if (!e) return []
  const y = e.year
  const out: Cand[] = []
  const P = h.polities ?? []
  switch (e.type) {
    case E.PolityEnded: {
      const p = e.value
      const cause = P[p]?.endCause
      if (cause === PolityEnd.Conquered) for (const k of atPlace(ix, e.settlement, [E.Conquered], y - 1, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R1'))
      if (cause === PolityEnd.Reunified) for (const k of ofType(ix, E.Reunified, y, y, (x) => x.value === p)) out.push(rec(evKey(k), 'R8'))
      if (cause === PolityEnd.Absorbed) {
        const q = polAt(ix, e.other, y)
        if (q >= 0) for (const k of pairOf(ix, p, q, E.BecameVassal, y - 200, y).filter((k) => ev(ix, k).value % 1000 === q).slice(0, 1)) out.push(rule(evKey(k), 'R7'))
        const r = ix.absorbedRow.get(i)
        if (r !== undefined && ix.why) {
          const ratio = decodeLog2(ix.why.absorbed.ratio[r])
          out.push(cond('absorbed.size', i, y, e.settlement, `a neighbour ${fx(ratio, 0)} times its size`, 1, `the absorber had ${fx(ratio, 1)}× its people${ix.why.absorbed.bound[r] ? '; it had been its vassal' : ''}`, 'rec:why.absorbed', WhyTier.Recorded))
        } else out.push(cond('absorbed.size', i, y, e.settlement, 'a larger neighbour', 0.5, 'a larger neighbour drew it in'))
      }
      if (cause === PolityEnd.Fragmented) for (const k of crisesOf(ix, p, y - 20, y, i).slice(0, 1)) out.push(rule(evKey(k), 'Rmisc'))
      if (cause === PolityEnd.Dwindled) out.push(cond('dwindled', i, y, e.settlement, 'its people dwindled away', 1, 'too few people left to be a state'))
      break
    }
    case E.Conquered: case E.SiegeLifted: case E.Blockade: case E.ArmyStricken:
      if (e.value >= 0 && e.value < (h.wars?.count ?? 0)) out.push(rec(warKey(e.value), 'R2'))
      break
    case E.HolyCityFell:
      if (e.extra !== undefined && e.extra >= 0) out.push(rec(warKey(e.extra), 'R2'))
      break
    case E.Sacked:
      for (const k of atPlace(ix, e.settlement, [E.Conquered], y, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R2b'))
      break
    case E.WarDeclared: return declarationCauses(ix, i)
    case E.CivilWar: {
      const p = polAt(ix, e.other, y)
      for (const k of crisesOf(ix, p, y - 1, y, i).slice(0, 1)) out.push(rule(evKey(k), 'R6d'))
      break
    }
    case E.SuccessionWar: {
      if (e.extra !== undefined) for (const k of ofType(ix, E.RoyalMarriage, 0, y, (x, k) => k < i && x.value === e.extra)) out.push(rec(evKey(k), 'rec:SuccessionWar.extra'))
      for (const k of atPlace(ix, e.other, [E.ReignEnded], y - 1, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R12'))
      break
    }
    case E.HolyWar: {
      const d = ix.warDecl[e.value]
      if (d >= 0 && d < i) out.push(rec(evKey(d), 'rec:HolyWar.value'))
      break
    }
    case E.PeaceMade: {
      const w = e.value
      if (!h.wars || w < 0 || w >= h.wars.count) break
      const q = h.wars.defender[w]
      const capFell = ix.warEvents[w].filter((k) => k < i && ev(ix, k).type === E.Conquered && P[q] && P[q].capitals.includes(ev(ix, k).settlement))
      if (capFell.length) out.push(rule(evKey(capFell[capFell.length - 1]), 'R1'))
      const yrs = Math.max(1, y - h.wars.startYear[w])
      out.push(cond('war.exhaustion', i, y, e.settlement, 'the war wore both sides out', Math.min(1, yrs / 20), `${yrs} years of war, ${Math.round(h.wars.dead[w]).toLocaleString('en-US')} dead`))
      out.push(rec(warKey(w), 'R5'))
      break
    }
    case E.PolityFounded: {
      const p = e.value
      const o = P[p]?.origin
      if (o === PolityOrigin.Revolt || o === PolityOrigin.Colonial) for (const k of atPlace(ix, e.settlement, [E.Seceded], y, y).slice(0, 1)) out.push(rule(evKey(k), 'R6a'))
      if (o === PolityOrigin.Fragment) {
        const par = P[p]?.parent ?? -1
        if (par >= 0 && ix.polEnd[par] >= 0 && Math.abs(ev(ix, ix.polEnd[par]).year - y) <= 1) out.push(rule(evKey(ix.polEnd[par]), 'R6b'))
        else if (par >= 0) for (const k of ofType(ix, E.Conquered, y - 1, y, (x, k) => k < i && (P[par]?.capitals ?? []).includes(x.settlement)).slice(-1)) out.push(rule(evKey(k), 'R6b'))
      }
      if (o === PolityOrigin.Partition) for (const k of ofType(ix, E.Partitioned, y, y, (x) => x.value === P[p]?.parent)) out.push(rule(evKey(k), 'R6c'))
      if (o === PolityOrigin.CivilWar) for (const k of atPlace(ix, e.settlement, [E.CivilWar], y, y)) out.push(rec(evKey(k), 'rec:CivilWar'))
      if (o === PolityOrigin.Formed || o === PolityOrigin.League) out.push(cond('formed', i, y, e.settlement, o === PolityOrigin.League ? 'towns bound together against a threat' : 'a dominant town gathered its neighbours', 1, o === PolityOrigin.League ? 'a league of trading towns' : 'a state of its own'))
      break
    }
    case E.Seceded:
      for (const k of atPlace(ix, e.settlement, [E.Revolt], y, y).filter((k) => k < i)) out.push(rule(evKey(k), 'R11'))
      for (const k of atPlace(ix, e.other, [E.Partitioned], y, y).filter((k) => k < i)) out.push(rule(evKey(k), 'R6c'))
      break
    case E.RevoltCrushed:
      for (const k of atPlace(ix, e.settlement, [E.Revolt], y, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R11'))
      break
    case E.Defected:
      for (const k of atPlace(ix, e.settlement, [E.Revolt], y, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R11'))
      break
    case E.Revolt: return revoltCauses(ix, i)
    case E.CapitalMoved: {
      if (e.other >= 0) for (const k of atPlace(ix, e.other, [E.Conquered], y, y).filter((k) => k < i)) out.push(rule(evKey(k), 'R9'))
      else out.push(cond('capital.abandoned', i, y, e.settlement, 'the old capital was abandoned', 1, 'its old capital lay empty'))
      if (!out.length) out.push(cond('capital.larger', i, y, e.settlement, 'a larger, safer town', 0.6, 'a member long larger and safer than the capital'))
      break
    }
    case E.SuccessionCrisis: {
      for (const k of atPlace(ix, e.settlement, [E.ReignEnded], y, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R12'))
      const r = ix.crisisRow.get(i)
      if (r !== undefined && ix.why) {
        const bits = ix.why.crises.bits[r]
        const ch = ix.why.crises.chance[r] / 255
        const names: [number, string, string][] = [[CrisisBit.Minor, 'crisis.minor', 'the heir was a child'], [CrisisBit.Woman, 'crisis.woman', 'the heir was a woman'], [CrisisBit.Bastard, 'crisis.bastard', 'the heir was baseborn'],
          [CrisisBit.WeakPredecessor, 'crisis.weak', 'the last reign had been weak'], [CrisisBit.LowCohesion, 'crisis.cohesion', 'the realm had little cohesion'], [CrisisBit.ManyPeoples, 'crisis.peoples', 'it ruled several peoples'],
          [CrisisBit.Law, 'crisis.law', 'its law left rival claimants'], [CrisisBit.RivalCentre, 'crisis.rival', 'a rival centre stood ready'], [CrisisBit.Extinct, 'crisis.extinct', 'the house had no heir'],
          [CrisisBit.Deference, 'crisis.deference', 'the court had governed in the ruler’s name']] // (absentee: DeferenceCause read through the bit)
        const set = names.filter((n) => bits & n[0])
        for (const n of set) out.push(cond(n[1], i, y, e.settlement, n[2], 1 / Math.max(1, set.length), `contest chance ${pct(ch)}`, 'rec:why.crises'))
      }
      break
    }
    case E.ReignEnded: return reignCauses(ix, i)
    case E.RulerAcceded: {
      const r = h.rulers?.[e.value]
      if (r && r.predecessor >= 0 && ix.rulerEnd[r.predecessor] >= 0 && ix.rulerEnd[r.predecessor] <= i) out.push(rec(evKey(ix.rulerEnd[r.predecessor]), 'R14'))
      if (r && r.how === AccessionHow.Usurped) out.push(cond('accession.usurped', i, y, e.settlement, 'a usurper took the throne', 0.5, 'usurped'))
      break
    }
    case E.DynastyEnded:
      if (e.extra !== undefined && e.extra >= 0 && ix.rulerEnd[e.extra] >= 0 && ix.rulerEnd[e.extra] <= i) out.push(rule(evKey(ix.rulerEnd[e.extra]), 'R15'))
      break
    case E.Famine: return famineCauses(ix, i)
    case E.Abandoned: return abandonCauses(ix, i)
    case E.Epidemic: {
      const pa = h.settlements[e.settlement]?.people, pb = h.settlements[e.other]?.people
      for (const k of ofType(ix, E.FirstContact, y - 5, y, (x, k) => k < i && ((x.value === pa && h.settlements[x.settlement]?.people === pb) || (x.value === pb && h.settlements[x.settlement]?.people === pa))).slice(-1)) out.push(rule(evKey(k), 'R18'))
      break
    }
    case E.CityStricken: {
      const src = e.other >= 0 ? atPlace(ix, e.other, [E.CityStricken, E.DiseaseAppeared, E.GreatEpidemic], y - 5, y).filter((k) => k < i && (ev(ix, k).type !== E.CityStricken || ev(ix, k).value === e.value)) : []
      if (src.length) out.push(rec(evKey(src[0]), 'R18'))
      else for (const k of ofType(ix, E.GreatEpidemic, 0, y, (x, k) => k < i && x.value === e.value)) out.push(rec(evKey(k), 'R18'))
      break
    }
    case E.GreatEpidemic:
      if (e.extra !== undefined) for (const k of ofType(ix, E.DiseaseAppeared, 0, y, (x, k) => k < i && x.value === e.extra).slice(0, 1)) out.push(rec(evKey(k), 'R18'))
      break
    case E.IdeaAdopted:
      if (e.other >= 0) for (const k of atPlace(ix, e.other, [E.IdeaAdopted, E.IdeaConceived], 0, y).filter((k) => k < i && ev(ix, k).value === e.value).slice(0, 1)) out.push(rec(evKey(k), 'R19'))
      break
    case E.StateReligion:
      for (const k of atPlace(ix, e.settlement, [E.RulerConverted], y - 30, y).filter((k) => k < i && ev(ix, k).value === e.value).slice(0, 1)) out.push(rule(evKey(k), 'R20'))
      break
    case E.FaithReached:
      if (e.other >= 0) for (const k of atPlace(ix, e.other, [E.FaithReached, E.FaithFounded], 0, y).filter((k) => k < i && ev(ix, k).value === e.value).slice(0, 1)) out.push(rec(evKey(k), 'R20'))
      break
    case E.TradeClosed:
      for (const k of ofType(ix, E.TradeForsaken, y, y, (x, k) => x.value === e.value && k > i)) {
        const c = ev(ix, k).extra ?? 0
        out.push(cond('trade.forsaken', i, y, e.settlement, c === 1 ? 'pirates on the way' : c === 2 ? 'a war front across the way' : 'danger on the way', 1, 'forsaken for danger', 'rec:TradeForsaken.extra', WhyTier.Recorded))
      }
      break
    case E.BecameVassal: {
      const q = polAt(ix, e.other, y)
      const p = polAt(ix, e.settlement, y)
      for (const k of ofType(ix, E.PeaceMade, y, y, (x, k) => k < i && ((polAt(ix, x.settlement, y) === p && polAt(ix, x.other, y) === q) || (polAt(ix, x.settlement, y) === q && polAt(ix, x.other, y) === p)))) out.push(rule(evKey(k), 'R21'))
      break
    }
    case E.Alliance: {
      const rival = e.extra ?? -1
      if (rival >= 0 && h.wars) for (const k of ofType(ix, E.WarDeclared, y - 10, y, (x, k) => k < i && h.wars.attacker[x.value] === rival)) { out.push(rule(evKey(k), 'Rmisc')); break }
      break
    }
    case E.Founded:
      if (e.other >= 0) for (const k of atPlace(ix, e.other, [E.Founded], 0, y).filter((k) => k < i).slice(0, 1)) out.push(rec(evKey(k), 'R22'))
      break
    // n4c (play-test 2: "The record does not say why" for a battle): a battle comes of its war, the march that brought the
    // armies together and what decided it (all recorded: History.battles); a commander's fall, renown or dismissal of the battle
    case E.BattleFought: return battleCauses(ix, i)
    case E.SiegeLaid:
      if (e.value >= 0 && e.value < (h.wars?.count ?? 0)) out.push(rec(warKey(e.value), 'R2'))
      break
    case E.CommanderFell: case E.CommanderRenowned: case E.CommanderDismissed: {
      const b = commanderBattle(ix, i)
      if (b < 0) break
      const be = ofType(ix, E.BattleFought, y, y, (x, k) => k <= i && x.value === b)
      if (be.length) out.push(rec(evKey(be[be.length - 1]), 'rec:battle'))
      else if (h.battles.war[b] >= 0 && h.battles.war[b] < (h.wars?.count ?? 0)) out.push(rec(warKey(h.battles.war[b]), 'R2'))
      break
    }
    case E.OrderFulfilled: case E.OrderFailed: case E.OrderLapsed: {
      const g = ix.orderGiven.get(e.value)
      if (g !== undefined && g < i) out.push(rec(evKey(g), 'R23'))
      break
    }
  }
  return out
}

/** n4c: the battle a commanders event (CommanderFell, Renowned, Dismissed) at event i was about, or -1. */
export function commanderBattle(ix: CauseIndex, i: number): number {
  const h = ix.h, e = ev(ix, i)
  const B = h.battles, C = h.commanders
  if (!B || !C || e.value < 0 || e.value >= C.count) return -1
  if (e.type === E.CommanderFell && C.fateBattle[e.value] >= 0) return C.fateBattle[e.value]
  for (let b = B.count - 1; b >= 0; b--) {
    if (B.year[b] > e.year) continue
    if (B.year[b] < e.year) break
    if (B.target[b] === e.settlement && (B.cmdA[b] === e.value || B.cmdD[b] === e.value)) return b
  }
  return -1
}

/** n4c: a battle's causes: its war (recorded), what decided it, and the march that brought the armies together. */
function battleCauses(ix: CauseIndex, i: number): Cand[] {
  const h = ix.h, e = ev(ix, i)
  const B = h.battles
  const out: Cand[] = []
  const b = e.value
  if (!B || b < 0 || b >= B.count) return out
  const y = e.year
  const w = B.war[b]
  if (w >= 0 && w < (h.wars?.count ?? 0)) out.push(rec(warKey(w), 'R2'))
  const d = decidingCause(h, b)
  if (d) out.push(cond('battle.decided', i, y, B.target[b], d, 1, d, 'rec:battles.course', WhyTier.Recorded))
  const att = polName(ix, B.attacker[b]), def = polName(ix, B.defender[b])
  const to = placeName(ix, B.target[b], y)
  const march = B.kind[b] === BattleKind.Siege ? `${att} laid siege to ${to}`
    : B.kind[b] === BattleKind.Relief ? `${att} marched to relieve ${to}, besieged by ${def}`
    : B.kind[b] === BattleKind.Naval ? `the fleet of ${att} sailed against ${def}'s port of ${to}`
    : B.kind[b] === BattleKind.Landing ? `${att} came over the sea against ${to}`
    : `${att} marched${B.from[b] >= 0 ? ` from ${placeName(ix, B.from[b], y)}` : ''} on ${def}'s town of ${to}${B.counter[b] ? ', striking back' : ''}`
  out.push(cond('battle.march', i, y, B.from[b] >= 0 ? B.from[b] : B.target[b], march, 0.6, march, 'rec:battles.from', WhyTier.Recorded))
  return out
}

function declarationCauses(ix: CauseIndex, i: number): Cand[] {
  const h = ix.h
  const e = ev(ix, i)
  const w = e.value
  const y = e.year
  const out: Cand[] = []
  if (!h.wars || w < 0 || w >= h.wars.count) return out
  const p = h.wars.attacker[w], q = h.wars.defender[w]
  const W = ix.why?.wars
  const joined = W ? (W.flags[w] & WarWhyFlag.Joined) !== 0 : false
  // R4f: joined in the defence of an ally (the war its protégé was attacked in, the same year).
  const prot = ofType(ix, E.WarDeclared, y, y, (x, k) => k < i && h.wars.attacker[x.value] === q && h.wars.defender[x.value] !== p)
  if ((joined || !W) && prot.length) out.push(joined ? rec(evKey(prot[prot.length - 1]), 'R4f') : rule(evKey(prot[prot.length - 1]), 'R4f'))
  const sh = driveShares(ix, w)
  if (sh && W) {
    // R4a: the drive's factors, exact weights; rivalry split among its positive parts.
    const riv = (W.rivalry[w] / 255) * 2
    let pos = 0
    for (let k = 0; k < RIVALRY_PARTS; k++) pos += Math.max(0, W.parts[w * RIVALRY_PARTS + k])
    const wr = Math.max(0, sh[0].share)
    for (let k = 0; k < RIVALRY_PARTS; k++) {
      const x = W.parts[w * RIVALRY_PARTS + k]
      if (x <= 0 || pos <= 0) continue
      const wt = wr * (x / pos)
      out.push(cond(`rivalry.${RIVALRY_NAMES[k]}`, i, y, e.settlement, RIVALRY_LABEL[k], wt, `${pct(x / 127)} of a rivalry of ${fx(riv)}`))
    }
    const front = W.front[w]
    const adv = decodeLog2(W.odds[w])
    if (sh[1].share > 0) out.push(cond('odds', i, y, front >= 0 ? front : e.other, 'the stronger at the front', sh[1].share, `${fx(adv, 1)} to 1 at the front of ${placeName(ix, front, y)}`))
    if (sh[2].share > 0) out.push(cond('crisis', i, y, e.other, `${polName(ix, q)} in crisis`, sh[2].share, `×${WAR.crisisMul} while its succession was contested`))
    if (sh[4].share > 0) {
      const f = W.flags[w]
      const code = f & WarWhyFlag.Order ? 'order' : f & WarWhyFlag.Holy ? 'holy' : f & WarWhyFlag.Warlike ? 'warlike' : 'mul'
      const label = code === 'order' ? 'a player\'s order urged it' : code === 'holy' ? 'zeal for the faith' : code === 'warlike' ? 'a warlike ruler' : 'the ruler\'s temper'
      out.push(cond(code, i, y, e.settlement, label, sh[4].share, `×${fx(sh[4].f)}`))
    }
    return out
  }
  if (W && W.odds[w] === 0 && !joined) {
    // not rolled (a war of succession or a civil war logged as such elsewhere): the rivalry parts only
    return out
  }
  // Without records: R4b–R4d as rules.
  for (const d of pairOf(ix, p, q, E.BorderDispute, y - 100, y).slice(0, 1)) out.push(rule(evKey(d), 'R4b'))
  for (const v of pairWars(ix, p, q, y)) { const pe = ix.warPeace[v]; if (pe >= 0 && ev(ix, pe).year >= y - RELATION.recentYears && pe < i) { out.push(rule(evKey(pe), 'R4c')); break } }
  for (const c of crisesOf(ix, q, y - 10, y, i).slice(0, 1)) out.push(rule(evKey(c), 'R4d'))
  for (const [k, g] of ix.orderGiven) if (h.orderOutcomes?.[k]?.product === w) out.push(rec(evKey(g), 'R4e'))
  return out
}

function revoltCauses(ix: CauseIndex, i: number): Cand[] {
  const e = ev(ix, i)
  const y = e.year
  const out: Cand[] = []
  const r = ix.revoltRow.get(i)
  const W = ix.why?.revolts
  if (r !== undefined && W) {
    // R10a: the four largest parts of the unrest, exact shares, each backed by its event where there is one.
    for (let j = 0; j < 4; j++) {
      const part = W.part[r * 4 + j]
      if (part === 255) continue
      const share = W.share[r * 4 + j] / 255
      const name = UNREST_NAMES[part] ?? `P${part}`
      out.push(cond(`unrest.${name}`, i, y, e.settlement, UNREST_LABEL[part] ?? `unrest: ${name.toLowerCase()}`, share, `${pct(share)} of an unrest of ${fx((W.unrest[r] / 255) * 2)}`))
    }
    return out
  }
  // R10b: by the recorded RevoltCause.
  const c = e.value
  const parts = c === RevoltCause.Peasant ? ['Famine'] : c === RevoltCause.Ethnic ? ['Conquest', 'Foreign'] : c === RevoltCause.Provincial ? ['Crisis', 'Exhaustion'] : c === RevoltCause.Religious ? ['Faith'] : []
  for (const pt of parts) out.push(...revoltBacking(ix, i, pt, true))
  if (c === RevoltCause.Colonial) out.push(cond('unrest.Colony', i, y, e.settlement, 'rule from overseas', 0.6, 'another landmass than the capital\'s', 'rec:Revolt.value'))
  if (c === RevoltCause.Provincial && !out.length) out.push(cond('unrest.Distance', i, y, e.settlement, 'the distance of the capital', 0.5, 'a far province', 'rec:Revolt.value'))
  return out
}

function famineCauses(ix: CauseIndex, i: number): Cand[] {
  const e = ev(ix, i)
  const y = e.year
  const out: Cand[] = []
  const r = ix.famineRow.get(i)
  const F = ix.why?.famines
  if (r !== undefined && F) {
    const stored = (F.stored[r] / 255) * 1.4, harvest = (F.harvest[r] / 255) * 1.4
    const parts = [
      ['famine.Harvest', 'a bad harvest', Math.max(0, 1 - stored), `harvest ${fx(harvest)} of normal${stored > harvest + 0.02 ? `, ${fx(stored)} after the stores` : ''}`],
      ['famine.Ravaged', 'fields ravaged by war', F.ravaged[r] / 255, `${pct(F.ravaged[r] / 255)} of the fields lost to war and danger`],
      ['famine.Crowded', 'too many mouths', Math.max(0, (F.crowded[r] / 255) * 2 - 1), `${fx((F.crowded[r] / 255) * 2)} people per share of food`],
      ['famine.Imports', 'food that did not come', F.imports[r] / 255, `${pct(F.imports[r] / 255)} of the usual imports missing`],
    ] as const
    const tot = parts.reduce((a, b) => a + b[2], 0)
    for (const p of parts) if (p[2] > 0 && tot > 0) out.push(cond(p[0], i, y, e.settlement, p[1], p[2] / tot, p[3]))
    return out
  }
  const burst = ofType(ix, E.Famine, y, y).length
  if (burst >= 3) out.push(cond('famine.burst', i, y, e.settlement, 'a bad year far and wide', conf('R16burst'), `${burst} famines that year`, 'R16burst', WhyTier.Rule))
  const people = ix.h.settlements[e.settlement]?.people
  for (const k of ofType(ix, E.Blight, y - 2, y, (x, k) => k < i && ix.h.settlements[x.settlement]?.people === people).slice(-1)) out.push(rule(evKey(k), 'R16blight'))
  for (const k of atPlace(ix, e.settlement, [E.Conquered, E.Raid, E.SiegeLifted, E.Sacked], y - 3, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R16war'))
  return out
}

function abandonCauses(ix: CauseIndex, i: number): Cand[] {
  const h = ix.h
  const e = ev(ix, i)
  const y = e.year, id = e.settlement
  const out: Cand[] = []
  const r = ix.abandonRow.get(i)
  const cause = r !== undefined && ix.why ? ix.why.abandons.cause[r] : -1
  if (cause === AbandonCause.Outpost) out.push(cond('abandon.Outpost', i, y, id, 'the expedition base was given up', 1, 'an outpost no longer worth its supply', 'rec:why.abandons', WhyTier.Recorded))
  if (cause === AbandonCause.Supply) out.push(cond('abandon.Supply', i, y, id, 'its supply failed', 1, 'a fort or station whose supply failed', 'rec:why.abandons', WhyTier.Recorded))
  if (cause === AbandonCause.Resort) for (const k of atPlace(ix, id, [E.ResortAbandoned], y, y)) out.push(rec(evKey(k), 'rec:why.abandons'))
  if (cause === AbandonCause.Outpost || cause === AbandonCause.Supply || cause === AbandonCause.Resort) return out
  // Dwindled (recorded, or assumed without records): shocks, then the long decline.
  for (const k of atPlace(ix, id, [E.Sacked, E.Famine, E.CityStricken, E.Conquered], y - 20, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R17'))
  const N = h.settlements.length
  let peak = 0
  const last = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
  for (let s = 0; s <= last; s++) peak = Math.max(peak, h.population[s * N + id] ?? 0)
  const s1 = Math.max(0, last - 1)
  const food = h.food[s1 * N + id] ?? 1
  out.push(cond('decline', i, y, id, peak < 100 ? 'a hamlet that never grew' : 'a long decline', r !== undefined ? 1 : 0.6, `never above ${Math.round(peak)} people; food ${fx(food)} at the end`, r !== undefined ? 'rec:why.abandons' : 'cond:decline'))
  return out
}

/** absentee: why the court governed (CouncilRuled extra: DeferenceCause 1-6). */
const COUNCIL_WHY: Record<number, string> = { 1: 'a child on the throne', 2: 'the ruler away on campaign', 3: 'the ruler on another throne', 4: 'an idle ruler', 5: 'an old and failing ruler', 6: 'the ruler a captive' }

function reignCauses(ix: CauseIndex, i: number): Cand[] {
  const h = ix.h
  const e = ev(ix, i)
  const y = e.year
  const out: Cand[] = []
  const r = h.rulers?.[e.value]
  if (!r) return out
  const end = e.extra
  const p = r.polity
  if (end === ReignEnd.Battle && ix.pd) {
    for (const w of [...(ix.pd.warsOf[p] ?? [])].reverse()) {
      if (h.wars.startYear[w] <= y && (h.wars.endYear[w] < 0 || h.wars.endYear[w] >= y) && ix.warDecl[w] >= 0 && ix.warDecl[w] < i) { out.push(rule(warKey(w), 'R13Battle')); break }
    }
  }
  if (end === ReignEnd.Sack) for (const k of atPlace(ix, e.settlement, [E.Conquered, E.Sacked], y - 1, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R13Sack'))
  if (end === ReignEnd.Overthrown || end === ReignEnd.Deposed) {
    for (const k of ofType(ix, E.RulerAcceded, y, y + 1, (x) => h.rulers[x.value]?.polity === p && h.rulers[x.value]?.how === AccessionHow.Usurped).slice(0, 1)) out.push(rule(evKey(k), 'R13Usurp'))
    // absentee: the court had governed in the ruler's name (CouncilRuled of this reign; its extra the DeferenceCause)
    for (const k of ofType(ix, E.CouncilRuled, r.acceded, y, (x) => x.other === e.value).filter((k) => k < i).slice(0, 1)) out.push(cond('ruler.council', i, y, e.settlement, 'the court governed in the ruler’s name', 0.6, COUNCIL_WHY[ev(ix, k).extra ?? 0] ?? 'ruled by others', 'rec:CouncilRuled', WhyTier.Recorded))
    if (r.ability < 0.9) out.push(cond('ruler.ability', i, y, e.settlement, 'a weak ruler', Math.min(1, (1 - r.ability) * 2), `ability ${fx(r.ability)} (1 is average)`, 'rec:Ruler.ability', WhyTier.Recorded))
  }
  if (end === ReignEnd.Plague) for (const k of atPlace(ix, e.settlement, [E.CityStricken], y - 1, y).filter((k) => k < i).slice(0, 1)) out.push(rule(evKey(k), 'R13Plague'))
  if (end === ReignEnd.RealmEnded && ix.polEnd[p] >= 0 && ix.polEnd[p] < i) out.push(rule(evKey(ix.polEnd[p]), 'R13Realm'))
  if (end === ReignEnd.RealmEnded && !out.length) out.push(cond('ruler.realm', i, y, e.settlement, 'the realm itself ended', 1, 'its realm came to an end', 'rec:ReignEnded.extra', WhyTier.Recorded))
  if (end === ReignEnd.TermEnded) out.push(cond('ruler.term', i, y, e.settlement, 'the term ran out', 1, 'a league head\'s term', 'rec:ReignEnded.extra', WhyTier.Recorded))
  if ((end === ReignEnd.Overthrown || end === ReignEnd.Deposed) && !out.length) out.push(cond('ruler.overthrown', i, y, e.settlement, end === ReignEnd.Deposed ? 'driven from the throne' : 'overthrown', 1, 'the record names no usurper', 'rec:ReignEnded.extra', WhyTier.Recorded))
  if (end === ReignEnd.Natural) out.push(cond('ruler.age', i, y, e.settlement, 'old age or illness', 1, `aged ${y - r.born}`, 'rec:Ruler.born', WhyTier.Recorded))
  return out
}

/** The base rules (registered first). */
export function baseRules(ix: CauseIndex, _key: string, kind: string, id: number, code?: string): Cand[] {
  if (kind === 'event') return eventCauses(ix, id)
  if (kind === 'cond') return code ? condCauses(ix, code, id) : []
  return entityCauses(ix, kind, id)
}

/** UnrestPart value of a part name (for tests and prose). */
export const unrestPartOf = (name: string): number => Number(Object.keys(UNREST_NAMES).find((k) => UNREST_NAMES[Number(k)] === name) ?? -1)
export { RivalryPart, UnrestPart }
