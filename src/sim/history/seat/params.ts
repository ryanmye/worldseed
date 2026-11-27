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
