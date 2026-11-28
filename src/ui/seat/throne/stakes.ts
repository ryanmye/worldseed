// Throne slice (lane N3): what each option puts at stake, in plain words (ui-additions 4), and honest words for the court's
// own course (EVALUATION §1c: "Crush it" was a Wait-tagged no-op; every option without orders said "The court keeps its own
// counsel"). DOM-free (cardModel.ts and the bots read it). Where an option scales one of the HUD's hazards by a known factor
// of its order (seat/params.ts SEAT: placateMul, designateLaw/Over, the deferral's deference), the card says how the 50-year
// odds would move, "if things stay as they are": the same estimate as the HUD (hudModel.ts), nothing the court could not know.
import { DecisionKind, SeatOptionKey } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { OPTION_RISK, SEAT } from '../../../sim/history/seat/params.ts'
import { HUD, hudRowOf, oddsOfRow } from './hudModel.ts'
import { heirOf, heirPhrase, heirsAt } from './heirs.ts'

const K = SeatOptionKey

/** Plain words of what likely follows (an option with orders: added to its order's effect line). */
const LIKELY: Partial<Record<number, string>> = {
  [K.FightOn]: 'The levies march: land may be won or lost, and the war wears the realm.',
  [K.SuePeace]: 'The war ends sooner; they may keep what they took.',
  [K.OfferTribute]: 'Peace for silver, paid for years, if they accept.',
  [K.SeekAlly]: 'Another crown at our side, if they will have us.',
  [K.Strike]: 'War: their towns could be ours, or our levies broken.',
  [K.OfferMatch]: 'A marriage would bind the two houses; one day it could bring their crown.',
  [K.Arrange]: 'The two houses are bound; a claim to their throne may follow.',
  [K.Placate]: 'The magnates quiet down for a while; the treasury pays.',
  [K.Purge]: 'No coup while it holds, but the army is weaker, and he may strike first.',
  [K.Fortify]: 'Walls at the capital: harder to take, at the cost of labour.',
  [K.Crush]: 'A garrison holds the town that rose: walls go up there; the grievance stays.',
  [K.Defy]: 'Free of the overlord, unless the overlord comes to collect.',
  [K.Renounce]: 'The treaty ends at once; they will remember.',
  [K.Borrow]: 'Coin now, debt later.',
  [K.Levy]: 'Coin now; the towns grumble.',
  [K.RepudiateDebts]: 'The debts vanish; no lender will trust us for years.',
  [K.Quarantine]: 'Fewer ships bring the sickness in; trade suffers.',
  [K.MoveCourt]: 'The court escapes the sickness; the old capital may sulk.',
  [K.Embrace]: 'The ruler takes the new faith; the old priests are displeased.',
  [K.SeparatePeace]: 'Our war ends; the ally is left to fight alone, and will remember.',
  [K.Settle]: 'Settlers set out for the new lands.',
  [K.ExploreOn]: 'The explorers go out again, further.',
  [K.TakeUp]: 'Our farmers try the new crop.',
  [K.Seek]: 'Our scholars go to learn it.',
  [K.Reclaim]: 'You rule again in person, but the throne is less safe for years.',
  // lane N3b: the surfacing lane's keys (cards 102-112) had no words here, so their stakes said nothing
  [K.SendRelief]: 'Grain and silver for the stricken: the towns quiet down; the treasury pays.',
  [K.RecallGeneral]: 'The beaten general is called home: no coup from him, but the army is weaker for a while.',
  [K.JoinWar]: 'War beside the ally: the oath is kept, and its enemy becomes ours.',
  [K.Avenge]: 'War on the faithless ally: their towns could be ours, and the betrayal answered.',
  [K.CallBluff]: 'War on the bluffer: they may be weaker than they claimed, or not.',
  [K.OfferTerms]: 'Peace from strength: the war ends while we are ahead.',
  [K.RewardArmy]: 'Gold for the victors: the army is content, and the throne safer from its generals.',
  [K.DefyWithAlly]: 'An ally is sought against the overlord and the tribute stops: free, with a friend, if they come to collect.',
}

/** The honest words of an option without orders (the court's own course): what happens if this is chosen. */
const COURT: Partial<Record<number, string>> = {
  [K.Endure]: 'Nothing is done: the crisis runs its course.',
  [K.LawDecides]: 'No one is named: the law’s heir succeeds, unless the lords contest it.',
  [K.StayOut]: 'Nothing is done: the chance passes.',
  [K.Ignore]: 'Nothing is done: things take their course.',
  [K.Decline]: 'Nothing is done: no match, no treaty.',
  [K.Honour]: 'Things stay as they are: the treaty holds.',
  [K.Pay]: 'Things stay as they are: the tribute is paid.',
  [K.KeepWays]: 'Nothing changes: the ruler keeps the old faith.',
  [K.Stay]: 'Nothing is done: the news is filed away.',
  [K.Retrench]: 'No new coin: the court lives within its means.',
  [K.StandBy]: 'Nothing changes: we fight on beside the ally.',
  [K.FightOn]: 'Nothing changes: the war goes on.', // (lane N3b: the Battle and WarChest cards' court course)
  [K.KeepPaying]: 'Things stay as they are: the tribute is paid, and the overlord grows ready to take the realm whole.',
}

export function courtWords(key: number, kind: number): string {
  if (kind === DecisionKind.General && key === K.Honour) return 'Honours, not orders: the general is flattered, nothing more.'
  return COURT[key] ?? 'Nothing is done: things take their course.'
}

export function riskWord(key: number): string {
  const r = OPTION_RISK[key] ?? 0.5
  return r < 0.25 ? 'low' : r < 0.55 ? 'some' : r < 0.85 ? 'high' : 'grave'
}

export interface Stakes {
  /** Plain words of what likely follows. */
  likely: string
  /** "low", "some", "high", "grave" (the court's risk table: the same the court's pick reads). */
  risk: string
  /** "Odds 62% → 71%" where the option moves a hazard by a known factor ('' otherwise). */
  odds: string
  /** The odds after, 0..1 (NaN when not estimated). */
  oddsAfter: number
}

const pct = (x: number) => `${Math.round(x * 100)}%`

/** lane N3b: the surfacing lane's keys whose orders are an older key's (Placate as relief or the army's reward, Purge as the
 * recall, Peace as terms): the odds move as that key's. */
const ORDER_ALIAS: Partial<Record<number, number>> = { [K.SendRelief]: K.Placate, [K.RewardArmy]: K.Placate, [K.RecallGeneral]: K.Purge, [K.OfferTerms]: K.SuePeace }

/** The 50-year odds after option `option` of decision d (or the deferral, option = -1), NaN when no known factor. */
export function oddsAfter(h: History, d: number, option: number): number {
  const r0 = hudRowOf(h, d)
  if (!r0) return NaN
  const r = Array.from(r0)
  const D = h.seat!.decisions
  if (option < 0) {
    // a deferral: deference +(1 - deferDivisive x divisive), the overthrow factor (1 + deferOverthrow x k), k = min(1, dv / deferFull)
    const dv = Number.isFinite(r[HUD.Deference]) ? r[HUD.Deference] : 0
    const k0 = Math.min(1, dv / SEAT.deferFull), k1 = Math.min(1, (dv + 1 - SEAT.deferDivisive * D.divisive[d]) / SEAT.deferFull)
    r[HUD.Overthrow] *= (1 + SEAT.deferOverthrow * k1) / (1 + SEAT.deferOverthrow * k0)
    r[HUD.Contest] *= (1 + SEAT.deferContest * k1) / (1 + SEAT.deferContest * k0)
    return oddsOfRow(r)
  }
  const key = D.optKey[D.optStart[d] + option]
  const o = D.optStart[d] + option
  switch (ORDER_ALIAS[key] ?? key) {
    case K.Placate: if (r.length > HUD.Crisis) r[HUD.Crisis] = 0; r[HUD.Overthrow] *= SEAT.placateMul; r[HUD.Unrest] *= SEAT.placateUnrest; r[HUD.Breakaway] *= SEAT.placateUnrest; if (r.length > HUD.LostShare) r[HUD.LostShare] *= SEAT.placateUnrest; break
    case K.Purge: r[HUD.Overthrow] = 0; break
    case K.NameHeir: {
      const law = D.info?.[d] ?? -1, born = D.orderTarget[D.orderStart[o]]
      r[HUD.Contest] *= born === law ? SEAT.designateLaw : SEAT.designateOver
      break
    }
    case K.SuePeace: case K.OfferTribute: r[HUD.WarLoss] = 0; break
    default: return NaN
  }
  return oddsOfRow(r)
}

/** The stakes of option `option` of decision d. */
export function stakesOf(h: History, d: number, option: number): Stakes {
  const D = h.seat!.decisions
  const o = D.optStart[d] + option
  const key = D.optKey[o]
  const court = D.orderStart[o] === D.orderStart[o + 1]
  let likely = court ? courtWords(key, D.kind[d]) : LIKELY[key] ?? ''
  if (key === K.LawDecides) {
    const law = D.info?.[d] ?? -1
    const x = law >= 0 ? heirOf(h, d, law) : null
    if (x) likely = `No one is named: the law’s heir, ${heirPhrase(x)}, succeeds unless the lords contest it.`
  }
  const r0 = hudRowOf(h, d)
  const now = r0 ? oddsOfRow(r0) : NaN
  const after = oddsAfter(h, d, option)
  const odds = Number.isFinite(now) && Number.isFinite(after) && Math.abs(after - now) >= 0.005 ? `Odds the realm stands 50 years: ${pct(now)} → ${pct(after)}` : ''
  return { likely, risk: riskWord(key), odds, oddsAfter: after }
}

/** The heir option's label: "Name Aru (son, 23) heir, the law's choice". */
export function heirOptionLabel(h: History, d: number, option: number): string | null {
  const D = h.seat!.decisions
  const o = D.optStart[d] + option
  if (D.optKey[o] !== K.NameHeir || D.orderStart[o + 1] === D.orderStart[o]) return null
  const born = D.orderTarget[D.orderStart[o]]
  const x = heirOf(h, d, born)
  if (!x) return null
  const law = D.info?.[d] ?? -1
  return `Name ${heirPhrase(x)} heir${born === law ? ', the law’s choice' : ''}`
}

/** The heirs line of an Heir card's situation: "The heirs: Aru (son, 23), Mina (daughter, 20)". */
export function heirsLine(h: History, d: number): string {
  const xs = heirsAt(h, d)
  return xs.length === 0 ? '' : `The heirs: ${xs.map(heirPhrase).join(', ')}.`
}
