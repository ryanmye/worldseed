// Throne slice (lane N3): "Because you…" callbacks and the realm's news (EVALUATION §1c: "nothing tells you what your last
// choice did"; "rulers change silently"; "the game never told me whether the match was accepted"). DOM-free: the card model,
// the dashboard's feed and the bots read the same lines. Every line states a recorded outcome (an order's resolution, a
// ruler's accession, a war's end) and dates it; it never claims a cause beyond what the order's own record says.
import { DEFER_OPTIONS, DecisionKind, EventType, OrderKind, OrderStatus, ReignEnd, WarOutcome } from '../../../contract.ts'
import type { History, Ruler } from '../../../contract.ts'
import { reasonWords, statusAt } from '../../nudgeFormat.ts'
import { optionLabel, polityWord, subjectWord, townWord } from '../seatFormat.ts'
import { crownedAs, heirName } from './heirs.ts'

export interface Callback {
  /** The earlier decision the line is about. */
  d: number
  /** The year the outcome is dated (resolved). */
  year: number
  text: string
}

/** The orders given for each decision (h.orders indices after its Choice record, same year), and the option chosen. */
export function ordersOfDecisions(h: History): Map<number, number[]> {
  const out = new Map<number, number[]>()
  const O = h.orders ?? []
  const D = h.seat?.decisions
  if (!D) return out
  let cur = -1
  for (let k = 0; k < O.length; k++) {
    const o = O[k]
    if (o.kind === OrderKind.Choice) { cur = Math.floor((o.target ?? -8) / 8); if (cur >= 0 && !out.has(cur)) out.set(cur, []); continue }
    if (cur >= 0 && cur < D.count && o.year === D.year[cur] + 1) out.get(cur)!.push(k)
    else cur = -1
  }
  return out
}

const lc = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/** "you offered a match to Launiluna in 744" (the choice, as the player made it). */
export function choiceClause(h: History, d: number): string {
  const D = h.seat!.decisions
  const o = D.chosen[d]
  const y = D.year[d]
  if (o < 0) return `the matter of ${y} went unanswered`
  const them = subjectWord(h, D.kind[d], D.subject[d], y, D.polity[d])
  const lab = lc(optionLabel(h, d, o)).replace(/, the law’s choice$/, '')
  const subj = them && D.kind[d] !== DecisionKind.General && D.kind[d] !== DecisionKind.Heir && !lab.includes(them) ? ` (${them})` : '' // (not for Heir / General: the subject is our own ruler)
  const verb = D.deferred?.[d] === 1 ? `you left it to the court in ${y}, and they chose to ${lab}` : `you chose to ${lab}${subj} in ${y}`
  return verb
}

/** The line for order k of decision d, if it is resolved by `year` (null otherwise). */
function outcomeLine(h: History, d: number, k: number, year: number): { year: number; text: string } | null {
  const o = h.orders![k], r = h.orderOutcomes?.[k]
  const st = statusAt(o, r, year)
  if (!r || r.year < 0 || st === OrderStatus.Active || st === OrderStatus.Pending) return null
  const D = h.seat!.decisions
  const y = r.year
  const them = o.target !== undefined && o.target >= 0 && o.kind >= OrderKind.War && o.kind !== OrderKind.Designate && o.kind !== OrderKind.Seat && o.kind !== OrderKind.Faith ? polityWord(h, o.target) : subjectWord(h, D.kind[d], D.subject[d], D.year[d], D.polity[d])
  const ok = st === OrderStatus.Fulfilled
  const why = r.reason ? reasonWords(r.reason, o.kind) : ''
  switch (o.kind) {
    case OrderKind.Marry: return { year: y, text: ok ? `the match was made: our house and ${them}'s are joined (${y})` : `${them}'s court refused the match (${y}${why ? `: ${why}` : ''})` }
    case OrderKind.Ally: return { year: y, text: ok ? `${them} stood with us as an ally (${y})` : `${them} would not ally with us (${y})` }
    case OrderKind.War: return { year: y, text: ok ? `the war with ${them} came (${y})` : `no war came with ${them}: ${why || 'the chance passed'} (${y})` }
    case OrderKind.Peace: return { year: y, text: ok ? `peace was made with ${them} (${y})` : `the war with ${them} went on (${y})` }
    case OrderKind.Submit: return { year: y, text: ok ? `${them} took the tribute and made peace (${y})` : `${them} would not take tribute (${y})` }
    case OrderKind.Designate: {
      const R = (h.rulers ?? []).find((x) => x.polity === D.polity[d] && x.born === o.target && x.acceded > D.year[d] && x.acceded <= year)
      if (R) return { year: R.acceded, text: `${crownedAs(h, R)}${crownedAs(h, R).includes(', crowned as') ? ',' : ''} took the throne in ${R.acceded}${R.how === 3 ? ', though the lords contested it' : ''}` }
      return ok ? { year: y, text: `the heir named succeeded (${y})` } : { year: y, text: `the heir named did not succeed (${y}${why ? `: ${why}` : ''})` }
    }
    case OrderKind.Placate: return { year: y, text: `the magnates were paid; the throne was safer while it held (to ${y})` }
    case OrderKind.Purge: {
      const struck = h.events.some((e) => e.type === EventType.GeneralPurged && e.value === D.polity[d] && e.year >= D.year[d] && e.year <= y && (e.extra ?? 0) === 1)
      return { year: y, text: struck ? `the general struck first (${y})` : `the general was broken; no general rose while it held (to ${y})` }
    }
    case OrderKind.Fortify: return { year: y, text: ok ? `walls rose at ${townWord(h, o.actor, y)} (${y})` : `no walls were raised at ${townWord(h, o.actor, y)} (${why || 'nothing came of it'})` }
    case OrderKind.Quarantine: return { year: y, text: ok ? `the ports were closed to ships (${y})` : `the ports stayed open (${why || 'nothing came of it'})` }
    case OrderKind.Seat: return { year: y, text: ok ? `the court moved (${y})` : `the court stayed where it was (${why || y})` }
    case OrderKind.Faith: return { year: y, text: ok ? `the ruler took up ${them} (${y})` : `the ruler kept the old faith (${why || y})` }
    case OrderKind.Borrow: return { year: y, text: ok ? `the lenders lent (${y})` : `no one would lend (${why || y})` }
    case OrderKind.Levy: return { year: y, text: `the levy was raised, and the towns grumbled (${y})` }
    case OrderKind.Repudiate: return { year: y, text: o.target === o.actor ? `the debts were refused; the lenders will remember (${y})` : `the bond with ${them} was broken (${y})` }
    case OrderKind.Defy: return { year: y, text: `the tribute to ${them} stopped (${y})` }
    case OrderKind.Betray: return { year: y, text: ok ? `we made our own peace; the ally fights alone (${y})` : `no separate peace came (${y})` }
    case OrderKind.Settle: return { year: y, text: ok ? `settlers founded ${r.product >= 0 ? townWord(h, r.product, y) : 'a new town'} (${y})` : `the settlers found no land (${why || y})` }
    case OrderKind.Explore: return { year: y, text: ok ? `the explorers reached the far lands (${y})` : `the explorers came back with little (${why || y})` }
    case OrderKind.Crop: return { year: y, text: ok ? `our fields took ${them} (${y})` : `${them} never took in our fields (${why || y})` }
    case OrderKind.Idea: return { year: y, text: ok ? `our scholars learned ${them} (${y})` : `${them} stayed out of reach (${why || y})` }
  }
  return null
}

/**
 * The "Because you…" lines visible at `year`: the outcomes of earlier choices (within `span` years) resolved after
 * `since` (so the next card tells what is new), newest first, at most `max`.
 */
export function callbacksAt(h: History, year: number, since: number, span = 25, max = 3): Callback[] {
  const D = h.seat?.decisions
  if (!D || !h.orders) return []
  const byD = ordersOfDecisions(h)
  const out: Callback[] = []
  for (const [d, ks] of byD) {
    if (D.year[d] < year - span || D.year[d] >= year) continue
    for (const k of ks) {
      const x = outcomeLine(h, d, k, year)
      if (!x || x.year <= since || x.year > year) continue
      out.push({ d, year: x.year, text: `Because ${choiceClause(h, d)}: ${x.text}.` })
      break
    }
  }
  // a deferral's line (the court's choice, told once, when its outcome is not yet known)
  for (let d = 0; d < D.count; d++) {
    if (D.year[d] <= since || D.year[d] >= year || D.deferred?.[d] !== 1 || out.some((c) => c.d === d)) continue
    out.push({ d, year: D.year[d] + 1, text: `Because you left it to the court in ${D.year[d]}, they chose to ${lc(optionLabel(h, d, D.courtPick[d]))}.` })
  }
  return out.sort((a, b) => b.year - a.year || b.d - a.d).slice(0, max)
}

export interface NewsItem { year: number; kind: 'succession' | 'reign' | 'war' | 'ambition' | 'milestone' | 'callback'; text: string; ruler?: number }

/** "Queen Iha", or the ruler's name with a title. */
export function rulerTitle(r: Ruler): string {
  const R = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
  return `${r.female ? 'Queen' : 'King'} ${r.name}${r.regnal > 1 ? ` ${R[r.regnal - 1] ?? r.regnal}` : ''}`
}

const END_WORDS: Record<number, string> = {
  [ReignEnd.Natural]: 'died', [ReignEnd.Battle]: 'fell in battle', [ReignEnd.Sack]: 'was killed when the capital fell', [ReignEnd.Overthrown]: 'was overthrown and killed',
  [ReignEnd.Deposed]: 'was deposed', [ReignEnd.Plague]: 'died of the plague', [ReignEnd.RealmEnded]: 'lost the realm', [ReignEnd.TermEnded]: 'came to the end of the term',
}
const HOW_WORDS: Record<number, string> = { 0: 'founds the realm', 1: 'takes the throne by right', 2: 'is chosen by the great men', 3: 'seizes the throne', 4: 'is set on the throne by a conqueror', 5: 'inherits by a marriage claim', 6: 'rises as a claimant' }

/** The seat realm's news between (from, to]: successions (who died, who takes the throne, how), war ends, ambitions met. */
export function realmNews(h: History, p: number, from: number, to: number): NewsItem[] {
  const out: NewsItem[] = []
  const R = h.rulers ?? []
  for (const r of R) {
    if (r.polity !== p) continue
    if (r.ended > from && r.ended <= to) {
      const age = r.ended - r.born
      out.push({ year: r.ended, kind: 'reign', ruler: r.id, text: `${r.ended}: ${rulerTitle(r)} ${END_WORDS[r.end] ?? 'left the throne'}${r.end === ReignEnd.Natural || r.end === ReignEnd.Plague ? `, aged ${age}` : ''}, after ${r.ended - r.acceded} years.` })
    }
    if (r.acceded > from && r.acceded <= to) {
      const pred = r.predecessor >= 0 ? R[r.predecessor] : null
      const kin = pred && r.parent === pred.id ? (r.female ? `, daughter of ${pred.name},` : `, son of ${pred.name},`) : pred && r.dynasty !== pred.dynasty ? ', of a new house,' : ''
      const given = r.dynasty >= 0 ? heirName(h, r.dynasty, r.born, r.female) : r.name
      const known = r.how === 1 && given !== r.name ? ` (known as ${given} before the crown)` : ''
      out.push({ year: r.acceded, kind: 'succession', ruler: r.id, text: `${r.acceded}: ${rulerTitle(r)}${known}${kin} ${HOW_WORDS[r.how] ?? 'takes the throne'}, aged ${r.acceded - r.born}.` })
    }
  }
  const W = h.wars
  for (let w = 0; w < W.count; w++) {
    if (W.endYear[w] <= from || W.endYear[w] > to || (W.attacker[w] !== p && W.defender[w] !== p)) continue
    const them = polityWord(h, W.attacker[w] === p ? W.defender[w] : W.attacker[w])
    const att = W.attacker[w] === p, o = W.outcome[w]
    const won = o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage ? att : o === WarOutcome.DefenderGains ? !att : null
    out.push({ year: W.endYear[w], kind: 'war', text: `${W.endYear[w]}: the war with ${them} ends${won === null ? ' with nothing won' : won ? ` in our favour${W.taken[w] ? ` (${W.taken[w]} towns change hands)` : ''}` : ' badly for us'}.` })
  }
  for (const e of h.events) if (e.type === EventType.AmbitionFulfilled && e.year > from && e.year <= to) out.push({ year: e.year, kind: 'ambition', text: `${e.year}: an ambition is achieved.` })
  return out.sort((a, b) => a.year - b.year || (a.kind === 'reign' ? -1 : 1))
}

/** The option index sent for "Do nothing" (the bots' and the controller's shared constant). */
export const DEFER = DEFER_OPTIONS.defer
