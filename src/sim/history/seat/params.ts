// seat: the tunables of seat mode (seat-mode §3.7). Every value is a design default to tune with the stats harness (seat
// step 14), not a historical estimate.
import { DECISION_KIND_COUNT, DecisionKind, SeatOptionKey } from '../../../contract.ts'

const cool = new Int32Array(DECISION_KIND_COUNT) // (every registered kind: a kind past the table would be dropped)
// (years before the same kind may come again; 0: whenever it happens)
cool[DecisionKind.WarOnUs] = 0
cool[DecisionKind.Opening] = 25
cool[DecisionKind.Heir] = 20
cool[DecisionKind.Crisis] = 0
cool[DecisionKind.AllianceMade] = 30
cool[DecisionKind.AllianceSought] = 30
cool[DecisionKind.Overlord] = 30
cool[DecisionKind.Match] = 25
cool[DecisionKind.General] = 15
cool[DecisionKind.Plague] = 0 // (once per epidemic instead)
cool[DecisionKind.Faith] = 40
cool[DecisionKind.Revolt] = 25
cool[DecisionKind.Credit] = 20
cool[DecisionKind.Charter] = 30
cool[DecisionKind.Betrayal] = 20
cool[DecisionKind.Frontier] = 30
cool[DecisionKind.Crop] = 30
cool[DecisionKind.Idea] = 30

export const SEAT = {
  // at most maxCards decisions a year (by PRIORITY), none within minGap years of the last one unless urgent
  maxCards: 2,
  minGap: 4,
  // the worker posts the History at least every maxRun years even without a decision
  maxRun: 50,
  cool,
  // Opening: the realm's advantage at the border over a weak neighbour (polity/war.ts advantage)
  openAdv: 1.2,
  // Frontier: an expedition's news of at least frontierCells newly known cells
  frontierCells: 20,
  // Frontier: a settle target has no town within frontierClear hops
  frontierClear: 3,
  // Faith: a universal faith holding at least faithShare of the realm's people
  faithShare: 0.25,
  // Plague: quarantine at most plagueQuarantine ports (largest first); move the court to a town of >= seatShare of the capital
  plagueQuarantine: 3,
  // Heir: the ruler is old (age from the birth year only), or the succession may well be contested
  oldAge: 58,
  heirContest: 0.25,
  // General: a throne whose yearly overthrow chance is at least riseX, at war or with a war lost in the last generalLost years
  riseX: 0.015,
  generalLost: 10,
  // Overlord: the card comes again every overlordEvery years while the realm is a vassal or tributary
  overlordEvery: 30,
  // Match: an heir of the realm aged matchAge[0]..matchAge[1]
  matchAge: [14, 30] as readonly number[],
  // Betrayal: the realm, an ally in an alliance war, is worn (exhaustion >= betrayCase; a proxy for the oath calculus' case)
  betrayCase: 0.5,
  // Credit: the crown's need (finance finNeed) at least creditNeed
  creditNeed: 0.5,
  // ---- the court kinds' orders (orders/seatOrders.ts, orders/hooks.ts; seat-mode §3.6) ----
  // Repudiate: the rivalry with the renounced rises by renounceR; with oaths, an AllyBetrayed grievance at renounceGrief of its weight
  renounceR: 0.25,
  renounceGrief: 0.5,
  // Submit: a yearly chance (orders' stream) that the enemy accepts tribute for peace, once the war is peace-after years old
  submitChance: 0.35,
  // Ally: an ordered pair's threat test reads ALLIANCE.threat * allyThreat; the alliance chance times allyMul (C7 order factor)
  allyThreat: 0.6,
  allyMul: 4,
  // Marry: a refused match may still be agreed with chance marryConsent * (1 - rivalry) (orders' stream); the rivalry test is waived
  marryConsent: 0.6,
  // Designate: the contest chance times designateLaw when the designee is the law's own pick, designateOver when not
  designateLaw: 0.6,
  designateOver: 1.6,
  // Placate: costs placateCost of the capital's wealth (with finance: placateR * R° from the treasury); overthrow times placateMul
  // while in force (C3 order factor); member unrest times placateUnrest once
  placateCost: 0.15,
  placateR: 0.5,
  placateMul: 0.35,
  placateUnrest: 0.7,
  // Purge: the general strikes first with chance purgeFail + purgeAble * max(0, 1 - ability); else no overthrow while in force and
  // the realm's mass times purgeMass
  purgeFail: 0.15,
  purgeAble: 0.4,
  purgeMass: 0.9,
  // Levy (the proxy without finance): levyShare of the members' wealth to the capital, member unrest + levyUnrest; with finance
  // taxMul eases toward FIN.taxMax at levyRate times its rate
  levyShare: 0.1,
  levyUnrest: 0.08,
  levyRate: 3,
  // ---- deference: matters left to the body that decides without the player (orders/seatOrders.ts seatChoice) ----
  // +1 per deferral, x deferTaken per decision taken, x deferKeep a year; its weight k = min(1, deference / deferFull)
  deferKeep: 0.98,
  // a deferral costs 1 - deferDivisive * divisive (ducking a divisive matter costs little); the body bears its blame: its
  // shield (a negative Provincial grievance for the ruler) grows by blameShield * divisive and fades x blameKeep a year, and the
  // court spends credit (deference x (1 - blameSpend * divisive))
  deferDivisive: 0.7,
  blameShield: 0.06,
  blameKeep: 0.85,
  blameSpend: 0.1,
  deferTaken: 0.9,
  deferFull: 5,
  // the throne grows less safe (C3 order factor 1 + deferOverthrow k), successions more contested (x 1 + deferContest k), the
  // towns restive (Provincial grievance + deferUnrest k: UnrestPart.Deference)
  deferOverthrow: 1,
  deferContest: 0.8,
  deferUnrest: 0.08,
  // at deferDecline the deciding body rules in all but name (SeatDeclined): only urgent cards; reasserted by reassertRun
  // decisions taken in a row, or by Reclaim (the throne then less safe x reclaimRisk for reclaimYears)
  deferDecline: 4,
  reassertRun: 3,
  reclaimYears: 10,
  reclaimRisk: 2.5,
  // Ambitions: Endure years; Unify share and towns for unifyYears running; Riches years running
  endureYears: 300,
  unifyShare: 0.8,
  unifyTowns: 5,
  unifyYears: 10,
  richesYears: 25,
} as const

/** Urgent kinds come whatever the gap since the last card. */
export const URGENT: readonly number[] = [DecisionKind.WarOnUs, DecisionKind.Crisis, DecisionKind.Plague]

/** The order cards are kept in when more than maxCards come in one year (first kept). */
export const PRIORITY: readonly number[] = [
  DecisionKind.WarOnUs, DecisionKind.Crisis, DecisionKind.Plague, DecisionKind.Overlord, DecisionKind.General, DecisionKind.Heir,
  DecisionKind.Revolt, DecisionKind.Betrayal, DecisionKind.Opening, DecisionKind.AllianceMade, DecisionKind.AllianceSought,
  DecisionKind.Credit, DecisionKind.Charter, DecisionKind.Match, DecisionKind.Faith, DecisionKind.Frontier, DecisionKind.Idea,
  DecisionKind.Crop,
]

/** How divisive each kind of matter is (0..1): every course of it angers someone (a design default). A deferral of a divisive matter costs less authority (SEAT.deferDivisive) and its blame falls on the deciding body. */
export const DIVISIVE: readonly number[] = (() => {
  const t = new Array<number>(18).fill(0.3)
  t[DecisionKind.WarOnUs] = 0.6; t[DecisionKind.Opening] = 0.3; t[DecisionKind.Heir] = 0.8; t[DecisionKind.Crisis] = 0.9
  t[DecisionKind.AllianceMade] = 0.4; t[DecisionKind.AllianceSought] = 0.3; t[DecisionKind.Overlord] = 0.7; t[DecisionKind.Match] = 0.2
  t[DecisionKind.General] = 0.8; t[DecisionKind.Plague] = 0.5; t[DecisionKind.Faith] = 0.9; t[DecisionKind.Revolt] = 0.8
  t[DecisionKind.Credit] = 0.7; t[DecisionKind.Charter] = 0.6; t[DecisionKind.Betrayal] = 0.7; t[DecisionKind.Frontier] = 0.1
  t[DecisionKind.Crop] = 0.05; t[DecisionKind.Idea] = 0.1
  return t
})()

/** The risk a cautious court sees in each option (0 safe .. 1 reckless; a design default): left a matter, it takes the least risky (ties: the first). */
export const OPTION_RISK: Record<number, number> = {
  [SeatOptionKey.FightOn]: 0.6, [SeatOptionKey.SuePeace]: 0.2, [SeatOptionKey.OfferTribute]: 0.3, [SeatOptionKey.SeekAlly]: 0.3,
  [SeatOptionKey.Strike]: 0.8, [SeatOptionKey.StayOut]: 0.1, [SeatOptionKey.OfferMatch]: 0.2, [SeatOptionKey.NameHeir]: 0.5,
  [SeatOptionKey.LawDecides]: 0.2, [SeatOptionKey.Placate]: 0.25, [SeatOptionKey.CrushPretender]: 0.8, [SeatOptionKey.Endure]: 0.4,
  [SeatOptionKey.Honour]: 0.1, [SeatOptionKey.Renounce]: 0.7, [SeatOptionKey.Pay]: 0.2, [SeatOptionKey.Defy]: 0.9,
  [SeatOptionKey.Arrange]: 0.2, [SeatOptionKey.Decline]: 0.1, [SeatOptionKey.Purge]: 0.8, [SeatOptionKey.Ignore]: 0.3,
  [SeatOptionKey.Quarantine]: 0.15, [SeatOptionKey.MoveCourt]: 0.5, [SeatOptionKey.Embrace]: 0.6, [SeatOptionKey.KeepWays]: 0.3,
  [SeatOptionKey.Fortify]: 0.2, [SeatOptionKey.Crush]: 0.5, [SeatOptionKey.Borrow]: 0.4, [SeatOptionKey.Levy]: 0.5,
  [SeatOptionKey.Retrench]: 0.3, [SeatOptionKey.Grant]: 0.4, [SeatOptionKey.Refuse]: 0.3, [SeatOptionKey.SeparatePeace]: 0.7,
  [SeatOptionKey.StandBy]: 0.4, [SeatOptionKey.Settle]: 0.3, [SeatOptionKey.ExploreOn]: 0.3, [SeatOptionKey.Stay]: 0.1,
  [SeatOptionKey.TakeUp]: 0.1, [SeatOptionKey.Seek]: 0.15, [SeatOptionKey.RepudiateDebts]: 0.9, [SeatOptionKey.Reclaim]: 1,
}
