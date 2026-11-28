// Sagas: epithets for the legend register, each drawn from a recorded fact ("Thesmu Wall-raiser" raised a castle;
// "Rilko the Thrice-sacked" was sacked three times; "the Leko, the Wave-riders" made the most landfalls). A subject
// with no fact that earns one gets none. The chronicle register never uses them.

import { AccessionHow, EventType, LandmarkKind, LandmarkRank, ReignEnd, WarOutcome } from '../../contract.ts'
import { traitWords } from '../rulersData.ts'
import type { Ctx } from './facts.ts'
import { battleName, battlesOf } from '../battlesData.ts' // battles:

/** What a reign did, up to the year told (shared by the state and house sagas). */
export interface ReignFacts {
  r: number
  years: number
  founded: boolean
  usurped: boolean
  claimed: boolean
  regency: number
  /** Kinds of great landmark begun in the reign by its realm. */
  works: number[]
  /** Wars of the realm begun in the reign that it won, and lost. */
  won: number
  lost: number
  ended: boolean
  end: number
  traits: string[]
  female: boolean
  /** oaths: truces and alliances broken in the reign (Betrayal, OathBroken at its realm's capital). */
  betrayals: number
  /** society: bondage imposed (1) or ended (2) in the realm during the reign (the last one), 0 none. */
  bondage: number
  /** beliefs: a war begun in the reign believing itself at least twice as strong as it was, and lost (the Rash); a show of strength that kept a foe off (the Fox). */
  rash: boolean
  fox: boolean
  /** absentee: the cause of a decline in the reign (CouncilRuled: DeferenceCause 1-6; 0 none), and taken captive (RulerTaken). */
  absent: number
  captive: boolean
}

export function reignFacts(c: Ctx, r: number): ReignFacts {
  const rd = c.rd!
  const x = rd.rulers[r]
  const ended = c.reignEndedBy(r)
  const works: number[] = []
  const L = c.h.landmarks
  if (L) for (let i = 0; i < L.count; i++) if (L.ruler[i] === r && L.rank[i] === LandmarkRank.Great && L.begunYear[i] <= c.Y) works.push(L.kind[i])
  let won = 0, lost = 0
  const W = c.pd?.wars
  if (W && c.pd) {
    const end = ended ? x.ended : c.Y
    for (const w of c.pd.warsOf[x.polity] ?? []) {
      if (W.startYear[w] < x.acceded || W.startYear[w] > end || W.endYear[w] < 0 || W.endYear[w] > c.Y) continue
      const att = W.attacker[w] === x.polity
      const o = W.outcome[w]
      if (o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage) att ? won++ : lost++
      else if (o === WarOutcome.DefenderGains) att ? lost++ : won++
    }
  }
  let betrayals = 0
  for (const t of [EventType.Betrayal, EventType.OathBroken]) for (const i of c.type(t)) {
    const e = c.ev(i)
    if (e.year >= x.acceded && e.year <= (ended ? x.ended : c.Y) && c.capital(x.polity, e.year) === e.settlement) betrayals++
  }
  let bondage = 0
  for (const t of [EventType.SerfdomImposed, EventType.SerfdomEnded]) for (const i of c.type(t)) {
    const e = c.ev(i)
    if (e.value === x.polity && e.year >= x.acceded && e.year <= (ended ? x.ended : c.Y)) bondage = t === EventType.SerfdomImposed ? 1 : 2
  }
  // beliefs: misjudged wars lost; bluffs that deterred (Deterred extra 1 against the realm's capital)
  let rash = false, fox = false
  const Wb = c.h.wars
  if (W && Wb && Wb.believed && Wb.believed.length === Wb.count) {
    const end = ended ? x.ended : c.Y
    for (const w of c.pd!.warsOf[x.polity] ?? []) if (W.attacker[w] === x.polity && W.startYear[w] >= x.acceded && W.startYear[w] <= end && W.outcome[w] === WarOutcome.DefenderGains && W.endYear[w] >= 0 && W.endYear[w] <= c.Y && Wb.believed[w] >= 2 * Wb.actual[w] && Wb.actual[w] >= 0) rash = true
  }
  for (const i of c.type(EventType.Deterred)) {
    const e = c.ev(i)
    if ((e.extra ?? 0) === 1 && e.year >= x.acceded && e.year <= (ended ? x.ended : c.Y) && c.capital(x.polity, e.year) === e.other) fox = true
  }
  // absentee: a decline in the reign (CouncilRuled `other` the reign; extra the DeferenceCause), taken captive (RulerTaken)
  let absent = 0, captive = false
  for (const i of c.type(EventType.CouncilRuled)) { const e = c.ev(i); if (e.other === r && e.year <= c.Y) { absent = e.extra ?? 0; break } }
  for (const i of c.type(EventType.RulerTaken)) { const e = c.ev(i); if (e.value === r && e.year <= c.Y) { captive = true; break } }
  return {
    absent, captive,
    betrayals, rash, fox, bondage,
    r, years: c.reignYears(r), founded: x.how === AccessionHow.Founded, usurped: x.how === AccessionHow.Usurped, claimed: x.how === AccessionHow.Claimed,
    regency: rd.regency[r] ?? 0, works, won, lost, ended, end: ended ? x.end : ReignEnd.Reigning, traits: traitWords(x, c.fd !== null), female: x.female,
  }
}

const WORK_EPITHET: Partial<Record<number, string>> = {
  [LandmarkKind.Castle]: 'Wall-raiser',
  [LandmarkKind.Palace]: 'Hall-builder',
  [LandmarkKind.GreatTemple]: 'Temple-raiser',
  [LandmarkKind.Monument]: 'the Victorious',
  [LandmarkKind.Library]: 'the Lettered',
  [LandmarkKind.Lighthouse]: 'Light-kindler',
  [LandmarkKind.MarketHall]: 'Market-maker',
  [LandmarkKind.Monastery]: 'the Pious',
  [LandmarkKind.Mausoleum]: 'Tomb-builder',
  [LandmarkKind.CouncilHouse]: 'the Counsellor',
  [LandmarkKind.Guildhall]: 'Guild-friend',
  [LandmarkKind.Baths]: 'Bath-giver',
}

/** A ruler's epithet from the facts of the reign ('' when none earns one). */
export function rulerEpithet(f: ReignFacts): string {
  if (f.works.length > 0) return WORK_EPITHET[f.works[0]] ?? ''
  if (f.won >= 3) return 'the Conqueror'
  if (f.founded) return 'the Founder'
  if (f.usurped) return 'the Usurper'
  if (f.betrayals >= 1) return 'the Faithless'
  if (f.bondage === 2) return 'the Liberator' // society
  if (f.bondage === 1) return 'the Binder' // society
  if (f.rash) return 'the Rash' // beliefs
  if (f.fox) return 'the Fox' // beliefs
  if (f.claimed) return 'the Pretender'
  if (f.regency > 0 && f.years >= 30) return f.female ? 'the Child-queen' : 'the Child-king'
  if (f.captive) return 'the Captive' // absentee: taken in battle
  if (f.absent === 2 || f.absent === 3) return 'the Absent' // absentee: on campaign far away, or reigning from another throne
  if (f.absent === 4) return 'the Idle' // absentee: the court governed while he took little part
  if (f.absent === 5) return 'the Old' // absentee: old and failing
  if (f.years >= 40) return 'the Long-reigning'
  if (f.end === ReignEnd.Battle) return 'the Fallen'
  if (f.end === ReignEnd.Plague) return 'the Plague-taken'
  if (f.end === ReignEnd.Overthrown) return 'the Betrayed'
  if (f.won >= 2) return 'the Victorious'
  if (f.lost >= 2) return 'the Luckless'
  if (f.traits.includes('brilliant')) return 'the Great'
  if (f.traits.includes('feeble')) return 'the Feeble'
  if (f.traits.includes('warlike')) return 'the Warlike'
  if (f.traits.includes('devout')) return 'the Devout'
  if (f.traits.includes('peaceable')) return 'the Peaceable'
  return ''
}

/** "Thesmu Wall-raiser", "Narun II the Founder". */
export function withEpithet(name: string, ep: string): string {
  return ep ? `${name} ${ep}` : name
}

const TIMES_WORD = ['', 'Once-', 'Twice-', 'Thrice-', 'Four-times-', 'Five-times-', 'Six-times-', 'Seven-times-']

/** A town's epithet from its record ('' none). */
export function cityEpithet(c: Ctx, id: number): string {
  const sacks = c.at(id, [EventType.Sacked]).length
  if (sacks >= 2) return `the ${TIMES_WORD[Math.min(7, sacks)]}sacked`
  const holy = c.fd?.faiths.some((f) => f.holyCity === id && f.foundedYear <= c.Y) ?? false
  if (holy) return 'the Holy'
  const s = c.h.settlements[id]
  if (s.parent < 0 && c.h.peoples[s.people]?.founder === id) return 'the First Hearth'
  if (!c.alive(id)) return 'the Lost'
  const pd = c.pd
  if (pd) {
    let capYears = 0
    for (const p of pd.list) for (let k = 0; k < p.capitals.length; k++) {
      if (p.capitals[k] !== id || p.capitalYears[k] > c.Y) continue
      const to = k + 1 < p.capitals.length ? p.capitalYears[k + 1] : p.endedYear >= 0 ? p.endedYear : c.Y
      capYears += Math.max(0, Math.min(to, c.Y) - p.capitalYears[k])
    }
    if (capYears >= 300) return 'the Crowned'
  }
  const daughters = c.h.settlements.filter((x) => x.parent === id && x.foundedYear <= c.Y).length
  if (daughters >= 8) return 'Mother of Towns'
  const sieges = c.at(id, [EventType.SiegeLifted]).length
  if (sieges >= 2) return 'the Unbowed'
  if (c.at(id, [EventType.PlaceRenamed]).length >= 2) return 'of Many Names'
  if (s.resort) return 'the Pleasant'
  return ''
}

/** The core of a battle's name for an epithet ("the Battle of Vebena Ford" -> "Vebena Ford", "the Siege of Kubeta" -> "Kubeta"). */
export function battlePlace(name: string): string {
  return name.replace(/^the (\S+ )?(Battle|Siege|Ambush|Relief) (of|in|at) /, '').replace(/^the /, 'the ')
}

/**
 * battles: a commander's epithet from his record up to the year told ('' none): three victories over one realm make him its
 * "Hammer"; else his greatest victory names him ("the Victor of Vebena Ford"); an unbeaten record of three or more, "the Unbeaten".
 */
export function commanderEpithet(c: Ctx, k: number): string {
  const bd = battlesOf(c.h)
  if (!bd || k < 0 || k >= bd.C.count) return ''
  const B = bd.B
  const over = new Map<number, number>()
  let best = -1, bestW = 0, wins = 0, losses = 0
  for (const b of bd.byCommander[k]) {
    if (B.year[b] > c.Y) break
    const att = B.cmdA[b] === k
    const won = (B.winner[b] === 0) === att
    if (!won) { losses++; continue }
    wins++
    const foe = att ? B.defender[b] : B.attacker[b]
    over.set(foe, (over.get(foe) ?? 0) + 1)
    const w = att ? B.lossD[b] : B.lossA[b]
    if (w > bestW) { bestW = w; best = b }
  }
  for (const [foe, n] of over) if (n >= 3 && foe >= 0) return `Hammer of ${c.pname(foe)}`
  if (wins >= 3 && losses === 0) return 'the Unbeaten'
  if (best >= 0 && battleName(c.h, best)) return `the Victor of ${battlePlace(battleName(c.h, best))}`
  return ''
}
