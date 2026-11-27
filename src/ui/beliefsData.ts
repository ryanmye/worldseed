// beliefs (beliefs-and-deception.md §5.1): read-outs of History.beliefs, beliefEst / beliefSd / beliefSource, strength and the
// per-polity bluff, spy and credibility rows, for the panel, the Beliefs view and the sagas. The UI may use log.

import { BeliefSource } from '../contract.ts'
import type { History } from '../contract.ts'

/** Belief snapshot cadence in years (BELIEF.snapStep). */
export const BELIEF_SNAP = 10

/** Whether the history has belief data. */
export const hasBeliefs = (h: History): boolean => (h.beliefs?.count ?? 0) > 0 && (h.beliefEst?.length ?? 0) > 0

/** The slow snapshot at or before `year` (-1 none). */
export function beliefSnapAt(h: History, year: number): number {
  const n = h.beliefs?.count ?? 0
  if (n === 0) return -1
  const Q = h.beliefEst.length / n
  const q = Math.floor(year / BELIEF_SNAP)
  return q < 0 ? -1 : q >= Q ? Q - 1 : q
}

/** Rows by observer o (beliefsOf) or by target t (heldAbout). */
export function beliefsOf(h: History, o: number): number[] {
  const B = h.beliefs, out: number[] = []
  if (!B) return out
  for (let k = 0; k < B.count; k++) if (B.observer[k] === o) out.push(k)
  return out
}
export function heldAbout(h: History, t: number): number[] {
  const B = h.beliefs, out: number[] = []
  if (!B) return out
  for (let k = 0; k < B.count; k++) if (B.target[k] === t) out.push(k)
  return out
}

/** Row k at `year`: the estimate (mass units; 0 none), its log-sd and the channels (BeliefSource bits); null without data. */
export function beliefAt(h: History, k: number, year: number): { est: number; sd: number; src: number } | null {
  const q = beliefSnapAt(h, year)
  if (q < 0) return null
  const i = q * h.beliefs.count + k
  return { est: h.beliefEst[i], sd: h.beliefSd[i] / 100, src: h.beliefSource[i] }
}

/** True strength (mass) of polity t at `year` (the main snapshot at or before it), 0 outside its life. */
export function truthAt(h: History, t: number, year: number): number {
  const P = h.polities.length
  if (!h.strength || h.strength.length === 0) return 0
  const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval)))
  return h.strength[s * P + t]
}

/** Shown strength factor minus 1, spy service and credibility of p at `year` (0..1 each); null without data. */
export function deceptionAt(h: History, p: number, year: number): { bluff: number; spy: number; cred: number } | null {
  const P = h.polities.length
  if (!h.bluffShown || h.bluffShown.length === 0) return null
  const q = Math.min(h.bluffShown.length / P - 1, Math.max(0, Math.floor(year / BELIEF_SNAP)))
  const i = q * P + p
  return { bluff: h.bluffShown[i] / 255, spy: h.spyService[i] / 255, cred: h.credibility[i] / 255 }
}

/** Confidence words from the log-sd. */
export function sureWord(sd: number): string {
  return sd < 0.2 ? 'sure' : sd < 0.45 ? 'fair' : sd < 0.8 ? 'hazy' : 'in the dark'
}

const SRC_WORDS: [number, string][] = [
  [BeliefSource.War, 'war'], [BeliefSource.Spies, 'spies'], [BeliefSource.Envoys, 'envoys'], [BeliefSource.Marriage, 'marriage'],
  [BeliefSource.Trade, 'trade'], [BeliefSource.Faith, 'faith'], [BeliefSource.Border, 'border'], [BeliefSource.Contact, 'hearsay'],
]
/** The channels in words ("trade, border"). */
export function sourceWords(src: number): string {
  const w = SRC_WORDS.filter(([b]) => (src & b) !== 0).map(([, t]) => t)
  return w.length ? w.join(', ') : 'nothing new'
}
