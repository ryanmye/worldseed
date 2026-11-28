// Throne slice (lane N3): "Because you…" callbacks and the realm's news (EVALUATION §1c: "nothing tells you what your last
// choice did"; "rulers change silently"; "the game never told me whether the match was accepted"). DOM-free: the card model,
// the dashboard's feed and the bots read the same lines. Every line states a recorded outcome (an order's resolution, a
// ruler's accession, a war's end) and dates it; it never claims a cause beyond what the order's own record says.
import { DEFER_OPTIONS, DecisionKind, EventType, OrderKind, OrderReason, OrderStatus, ReignEnd, SeatOptionKey, WarOutcome } from '../../../contract.ts'
import type { History, Ruler } from '../../../contract.ts'
import { reasonWords, statusAt } from '../../nudgeFormat.ts'
import { AMBITION_WORDS, optionLabel, polityWord, subjectWord, townWord } from '../seatFormat.ts'
import { crownedAs, heirName, heirOf, reignAt } from './heirs.ts'
import { deciderName } from '../decider.ts'

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
/** lane N3d: the body that decided a matter left at `year` ("the regent's council", not always "the court"). */
const bodyAt = (h: History, year: number): string => (h.seat ? deciderName(h, h.seat.seat, year) : 'the court').replace(/^your /, 'the ')
/** lane N3d: "1 year", "2 years". */
export const nYears = (n: number) => `${n} year${n === 1 ? '' : 's'}`

/**
 * lane N3d: what became of the heir born `born` that decision d named, the order having failed at `y`: "Yeler died (776)" when
 * the house still reigned, "a new house took the throne" when it did not (the play-test's "died first, or was no longer of the house").
 */
function heirFate(h: History, d: number, born: number, y: number): string {
  const D = h.seat!.decisions
  const p = D.polity[d]
  const x = heirOf(h, d, born)
  const name = x ? x.name : 'the heir named'
  const r0 = reignAt(h, p, D.year[d]), r1 = reignAt(h, p, y)
  if (r0 && r1 && r1.dynasty !== r0.dynasty) return `${name} never reigned: a new house took the throne (${y})`
  return `${name} died before the crown passed (${y})`
}

/** "you offered a match to Launiluna in 744" (the choice, as the player made it). */
export function choiceClause(h: History, d: number): string {
  const D = h.seat!.decisions
  const o = D.chosen[d]
  const y = D.year[d]
  if (o < 0) return `the matter of ${y} went unanswered`
  const them = subjectWord(h, D.kind[d], D.subject[d], y, D.polity[d])
  const lab = lc(optionLabel(h, d, o)).replace(/, the law’s choice$/, '')
  const subj = them && D.kind[d] !== DecisionKind.General && D.kind[d] !== DecisionKind.Heir && !lab.includes(them) ? ` (${them})` : '' // (not for Heir / General: the subject is our own ruler)
  const verb = D.deferred?.[d] === 1 ? `you left it to ${bodyAt(h, y)} in ${y}, and they chose to ${lab}` : `you chose to ${lab}${subj} in ${y}`
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
      return ok ? { year: y, text: `the heir named succeeded (${y})` } : { year: y, text: r.reason === OrderReason.NoHeir ? heirFate(h, d, o.target ?? -1, y) : `the heir named did not succeed (${y}${why ? `: ${why}` : ''})` }
    }
    case OrderKind.Placate: {
      // (lane N3b: the surfacing lane's cards give Placate as relief or the army's reward: say what was paid for)
      const key = D.chosen[d] >= 0 ? D.optKey[D.optStart[d] + D.chosen[d]] : -1
      if (key === SeatOptionKey.SendRelief) return { year: y, text: `relief reached the stricken, and the towns were calmer while it lasted (to ${y})` }
      if (key === SeatOptionKey.RewardArmy) return { year: y, text: `the army was rewarded; no general rose against the throne while it held (to ${y})` }
      return { year: y, text: `the magnates were paid; the throne was safer while it held (to ${y})` }
    }
    case OrderKind.Purge: {
      const struck = h.events.some((e) => e.type === EventType.GeneralPurged && e.value === D.polity[d] && e.year >= D.year[d] && e.year <= y && (e.extra ?? 0) === 1)
      const recall = D.chosen[d] >= 0 && D.optKey[D.optStart[d] + D.chosen[d]] === SeatOptionKey.RecallGeneral
      return { year: y, text: struck ? `the general struck first (${y})` : recall ? `the beaten general was recalled; no general rose while it held (to ${y})` : `the general was broken; no general rose while it held (to ${y})` }
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
    out.push({ d, year: D.year[d] + 1, text: `Because you left it to ${bodyAt(h, D.year[d])} in ${D.year[d]}, they chose to ${lc(optionLabel(h, d, D.courtPick[d]))}.` })
  }
  return out.sort((a, b) => b.year - a.year || b.d - a.d).slice(0, max)
}

export interface NewsItem { year: number; kind: 'succession' | 'reign' | 'war' | 'ambition' | 'milestone' | 'callback' | 'loss'; text: string; ruler?: number }

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
      const fell = r.end === ReignEnd.Battle && age < 16 ? 'was killed in the fighting' : END_WORDS[r.end] ?? 'left the throne' // (lane N3d: a child under a regency does not lead the army)
      out.push({ year: r.ended, kind: 'reign', ruler: r.id, text: `${r.ended}: ${rulerTitle(r)} ${fell}${r.end === ReignEnd.Natural || r.end === ReignEnd.Plague || r.end === ReignEnd.Battle ? `, aged ${age}` : ''}, after ${nYears(r.ended - r.acceded)}.` })
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
    out.push({ year: W.endYear[w], kind: 'war', text: `${W.endYear[w]}: the war with ${them} ends${won === null ? ' with nothing won' : won ? ` in our favour${W.taken[w] ? ` (${W.taken[w] === 1 ? 'a town changes' : `${W.taken[w]} towns change`} hands)` : ''}` : ' badly for us'}.` })
  }
  // lane N3d: a war on us or of ours begun (a war of our own court's declaring came unseen: on our own tributary, play-test #2)
  for (let w = 0; w < W.count; w++) {
    const y = W.startYear[w]
    if (y <= from || y > to || (W.attacker[w] !== p && W.defender[w] !== p)) continue
    const q = W.attacker[w] === p ? W.defender[w] : W.attacker[w]
    out.push({ year: y, kind: 'war', text: W.attacker[w] === p ? `${y}: our court declares war on ${polityWord(h, q)}.` : `${y}: ${polityWord(h, q)} declares war on us.` })
  }
  // lane N3d: towns that rose and broke away (a won rising: the Revolt with no RevoltCrushed after it), and the named heirs who died
  const S = h.seat
  const cap = (y: number) => { const P = h.polities?.[p]; if (!P) return -1; let c = -1; for (let i = 0; i < P.capitals.length; i++) if (P.capitalYears[i] <= y) c = P.capitals[i]; return c }
  const E = h.events
  for (let e = 0; e < E.length; e++) {
    const x = E[e]
    if (x.year <= from || x.year > to) continue
    if (x.type === EventType.Revolt && x.other >= 0 && x.other === cap(x.year)) {
      let crushed = false
      for (let j = e + 1; j < E.length && E[j].year === x.year; j++) if (E[j].type === EventType.RevoltCrushed && E[j].settlement === x.settlement) { crushed = true; break }
      if (crushed) continue
      const now = townPolity(h, x.settlement, x.year + 1)
      if (now === p) continue
      out.push({ year: x.year, kind: 'loss', text: `${x.year}: ${townWord(h, x.settlement, x.year)} rose and broke away from the crown${now >= 0 ? `: it is part of ${polityWord(h, now)} now` : ': it governs itself'}.` })
    }
  }
  if (S && h.orders && h.orderOutcomes) {
    for (const [d, ks] of ordersOfDecisions(h)) for (const k of ks) {
      const o = h.orders[k], r = h.orderOutcomes[k]
      if (o.kind !== OrderKind.Designate || !r || r.reason !== OrderReason.NoHeir || r.year <= from || r.year > to || S.decisions.polity[d] !== p) continue
      out.push({ year: r.year, kind: 'succession', text: `${r.year}: ${heirFate(h, d, o.target ?? -1, r.year)}; the heir named in ${S.decisions.year[d]} will not reign.` })
    }
  }
  for (const e of h.events) if (e.type === EventType.AmbitionFulfilled && e.year > from && e.year <= to) out.push({ year: e.year, kind: 'ambition', text: `${e.year}: an ambition is achieved: ${AMBITION_WORDS[e.value] ?? 'one of yours'}.` })
  return out.sort((a, b) => a.year - b.year || (a.kind === 'reign' ? -1 : 1))
}

/** The polity holding town id at the first snapshot at or after `year`, -1. */
export function townPolity(h: History, id: number, year: number): number {
  if (id < 0 || id >= h.settlements.length || !h.polity) return -1
  const N = h.settlements.length, q = Math.max(0, Math.min(h.snapshotCount - 1, Math.ceil(year / h.snapshotInterval)))
  return h.polity[q * N + id]
}

/** The option index sent for "Do nothing" (the bots' and the controller's shared constant). */
export const DEFER = DEFER_OPTIONS.defer
