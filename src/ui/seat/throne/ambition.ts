// Throne slice (lane N3): the declared ambition in words (play-test #1: "amb= alone is invisible"). The first ambition of
// seat= (amb=) is the reign's ambition: the HUD shows it with how it stands, the reach screen offers the choice, and with
// Unify first the "neighbour is weak" card comes more often (sim/history/seat/watch.ts coolOf). DOM-free.
import { AmbitionKind } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { SEAT } from '../../../sim/history/seat/params.ts'

export const AMBITIONS: readonly { kind: number; label: string; goal: string; hint: string }[] = [
  { kind: AmbitionKind.Endure, label: 'Endure', goal: `Hold the throne ${SEAT.endureYears} years`, hint: 'Keep the house on the throne: placate the lords, name heirs, avoid reckless wars.' },
  { kind: AmbitionKind.Unify, label: 'Unify the land', goal: `Take ${SEAT.unifyTaken} towns in your wars and hold your share of the landmass's people (vassals count; at most ${Math.round(SEAT.unifyKeep * 100)} points below where you began) ${SEAT.unifyYears} years running`, hint: 'Strike weak neighbours and hold what you take: placate the towns that rise; the war cards come more often.' },
  { kind: AmbitionKind.Faith, label: 'A faith of the realm', goal: 'A universal faith founded in the realm, or the state faith’s holy city in it', hint: 'Embrace a faith when many of your people follow it.' },
  { kind: AmbitionKind.Riches, label: 'The richest realm', goal: `The richest realm for ${SEAT.richesYears} years running`, hint: 'Take up crops and ideas, keep the peace, keep the treasury sound.' },
  { kind: AmbitionKind.Union, label: 'Two crowns', goal: 'The house holds two thrones at once', hint: 'Arrange matches with neighbouring houses; a marriage claim may bring their crown.' },
  { kind: AmbitionKind.Monument, label: 'A great monument', goal: 'A great work begun and finished by the realm in your time (not the capital’s castle or palace)', hint: 'Win a war (a victory monument), take up a faith (a great temple), grow rich trading towns (a market hall, a library).' },
]

/** "Ambition: Unify the land — not yet (rule 60%…)", or "achieved in 812". '' when none declared. */
export function ambitionLine(h: History, year: number): string {
  const S = h.seat
  const a = S?.seat.ambitions?.[0]
  if (!S || a === undefined) return ''
  const A = AMBITIONS.find((x) => x.kind === a)
  if (!A) return ''
  const y = S.ambitionYear?.[0] ?? -1
  if (y >= 0 && y <= year) return `Ambition: ${A.label}: achieved in ${y}.`
  if (a === AmbitionKind.Endure) return `Ambition: ${A.label}: ${Math.max(0, S.seat.from + SEAT.endureYears - year)} years to go.`
  return `Ambition: ${A.label}: not yet (${A.goal.toLowerCase()}). ${A.hint}`
}
