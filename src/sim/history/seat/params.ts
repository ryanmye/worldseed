// seat: the tunables of seat mode (seat-mode §3.7). Every value is a design default to tune with the stats harness (seat
// step 14), not a historical estimate.
import { DecisionKind } from '../../../contract.ts'

const cool = new Int32Array(18)
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
