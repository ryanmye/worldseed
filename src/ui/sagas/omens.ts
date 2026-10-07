// Sagas: the player's orders (History.orders, orderOutcomes; events 170-173) told as signs and providence, never as
// orders. Each order gets one omen from the table of its kind (a light on the horizon for an expedition, a dream of a
// valley for settlers, entrails for walls...), chosen by a stream seeded with the world and the order's index, so every
// saga that tells it tells the same omen. The chronicle register reports it with hedging ("It is written that in 1000
// a light stood over the northern sea for three nights, and the Krakinoth took it for a summons"), the legend register
// tells it as plain fact of the uncanny ("A voice came to the king in his sleep: go north. He went."). What followed is
// told from the outcome as recorded: fulfilled (what came of it, by name and year), partly (a half-true prophecy),
// failed or lapsed (a sign misread or defied, with why), or not yet known at the year told. The Nudge panel and the
// chronicle keep their plain wording (nudgeFormat.ts).

import { Biome, CradleOutcome, EventType, OrderKind, OrderReason, OrderStatus, FeatureKind, type Order, type OrderOutcome } from '../../contract.ts'
import { cradlesOf, hearthOf, type CradleRecord } from '../cradlesData.ts'
import { createRng } from '../../sim/rng.ts'
import { statusAt } from '../nudgeFormat.ts'
import { settingOf, type Ctx } from './facts.ts'
import { warName } from './wars.ts'
import { cap, fill, list, num, type PhraseTable, type Vars, type Voice } from './voice.ts'

/** One omen: the chronicle's clause (after "in {year}"), how it was read, and the legend's telling. */
interface Omen { c: string; read: string; l: string; coast?: boolean }

const OMENS: Record<number, readonly Omen[]> = {
  [OrderKind.Explore]: [
    { c: 'a light stood over the {dirAdj} horizon for three nights', read: 'a summons', l: 'A light stood over the {dirAdj} horizon for three nights and would not set. {Who} said: it calls us.' },
    { c: 'a star rose in the {dir} that did not set with the others', read: 'a guide', l: 'A star rose in the {dir} that never set, and {who} knew it for a guide.' },
    { c: 'a bird came down at {seat} with a leaf from no tree anyone knew', read: 'word of a land beyond', l: 'A bird came down at {seat} with a leaf in its beak from no tree that grows there, and {who} said: there is land beyond.' },
    { c: 'a voice was heard in the sleep of the elders of {seat}, saying one word: {dir}', read: 'a command', l: 'A voice came to the elders of {seat} in their sleep and said one word: {dir}.' },
  ],
  [OrderKind.Settle]: [
    { c: 'a shepherd of {seat} dreamed three nights running of a green valley to the {dir}', read: 'a promise', l: 'Three nights running a shepherd of {seat} dreamed of a green valley to the {dir}, and on the third morning he would not be silent.' },
    { c: 'a spring was found where none had been, on the road {dir} of {seat}', read: 'a blessing on the way', l: 'On the road {dir} of {seat}, where no water had ever run, a spring broke from the dry ground.' },
    { c: 'the swallows of {seat} rose all at once and flew {dir}', read: 'a sign to follow', l: 'The swallows of {seat} rose all at once and flew {dir}, and did not come back.' },
  ],
  [OrderKind.Crop]: [
    { c: 'seeds of {sp} were found in the pouch of a stranger who died at the gate of {seat}', read: 'a gift', l: 'A stranger died at the gate of {seat}, and in his pouch were seeds of {sp}. They buried him, and planted the seeds.' },
    { c: '{sp} came up unbidden in a field at {seat}', read: 'a sign of favour', l: 'In a field at {seat}, where no one had sown it, {sp} came up green.' },
    { c: 'a woman of {seat} dreamed of {sp} in flower', read: 'counsel', l: 'A woman of {seat} dreamed of {sp} in flower over the whole valley, and woke with its scent on her hands.' },
  ],
  [OrderKind.Idea]: [
    { c: 'a stranger came to {seat} who taught {idea} and was gone by spring', read: 'a teacher sent to them', l: 'A stranger came to {seat}, taught {idea} to any who would listen, and was gone in the night; no one saw him leave.' },
    { c: 'a book was washed ashore below {seat}', read: 'a gift of the sea', l: 'The sea gave up a book on the shore below {seat}, and in it, they say, was {idea}.', coast: true },
    { c: 'an old woman of {seat} spoke of {idea} on her deathbed', read: 'a last counsel', l: 'An old woman of {seat} spoke on her deathbed of {idea}, which no one there had heard of, and died smiling.' },
  ],
  [OrderKind.War]: [
    { c: 'the sun went dark at noon over {seat}', read: 'a call to arms against {target}', l: 'The sun went dark at noon over {seat}, and {who} said: so shall {target} be darkened.' },
    { c: 'fishermen drew a sword from the river at {seat}', read: 'a sign of victory over {target}', l: 'Fishermen of {seat} drew a sword from the river, bright as the day it was forged, and brought it to {who}, who turned it toward {target}.' },
    { c: 'a red comet hung over the road to {target}', read: 'a summons to war', l: 'A red comet hung over the road to {target}, and {who} took up the spear.' },
  ],
  [OrderKind.Peace]: [
    { c: 'half the sleepers of {seat} dreamed the same dream of a quiet field', read: 'a plea for peace with {target}', l: 'A plague of dreams fell on {seat}: every sleeper saw the same quiet field, and woke weeping, and {who} sent to {target}.' },
    { c: 'a child was born at {seat} with a white mark on its brow', read: 'a sign that the war with {target} should end', l: 'A child was born at {seat} with the white mark of a dove upon its brow, and {who} said: enough.' },
  ],
  [OrderKind.Seat]: [
    { c: 'a comet stood over {target}', read: 'a sign that the court should move there', l: 'A comet stood over {target} for a month of nights, pointing at it like a finger.' },
    { c: 'the royal hawk flew from {seat} and was found on the walls of {target}', read: 'the choice of a new seat', l: 'The royal hawk flew from {seat} and would not come back; it was found at last on the walls of {target}.' },
  ],
  [OrderKind.Faith]: [
    { c: '{who} saw a vision of {faith}', read: 'a calling', l: 'Between waking and sleep {who} saw the sign of {faith} burning on the wall of the chamber, and heard a name spoken.' },
    { c: 'a preacher of {faith} healed a dying child at {seat}', read: 'a proof', l: 'A preacher of {faith} laid hands on a dying child at {seat}, and the child rose and asked for bread.' },
    { c: 'the old shrine at {seat} cracked from roof to floor on a still night', read: 'a judgement on the old gods', l: 'On a still night the old shrine at {seat} split from roof to floor, and the priests of the old gods fled.' },
  ],
  [OrderKind.Fortify]: [
    { c: 'the priests of {seat} found a warning in the entrails', read: 'counsel to build walls', l: 'The entrails of the spring sacrifice at {seat} were black, and the priests said one word: build.' },
    { c: 'the watch at {seat} saw a figure in armour pacing a wall that did not yet exist', read: 'a warning', l: 'A ghost in old armour walked the line where no wall yet stood at {seat}, and the watch saw it three nights running.' },
    { c: 'crows circled {seat} from dawn to dusk', read: 'the warning of an enemy', l: 'Crows circled {seat} from dawn to dusk and would not settle, and the old men said: an enemy is coming.' },
  ],
  [OrderKind.Quarantine]: [
    { c: 'a dead gull lay at the harbour mouth of {seat} each morning for a week', read: 'a warning of sickness from the sea', l: 'Each morning for seven days a dead gull lay at the mouth of the harbour of {seat}, and the old women said: close the sea-gate.' },
    { c: 'a beggar on the quay of {seat} foretold a sickness from the ships', read: 'a prophecy', l: 'A blind beggar on the quay of {seat} cried that death would come in on the next sail, and would not stop crying it.' },
  ],
}

/** The framing and the outcomes, both registers. */
export const OMEN_T: PhraseTable = {
  omenC: [
    ['It is written that in {year} {omen}, and {who} took it for {read}.', 'The chronicles say that in {year} {omen}; {who} read it as {read}.', 'In {year}, it is said, {omen}, and {who} took it for {read}.'],
    [],
  ],
  omenL: [[], ['In {year} {lc}', 'In the year {year} {lc}']],
  doneC: [['{done}.', 'Whether or not the sign had any part in it, {done}.', 'Be that as it may, {done}.'], []],
  doneL: [[], ['{Who} heeded it, and {done}.', 'And it was so: {done}.', 'So it came to pass: {done}.']],
  partC: [['The sign proved half true: {part}.', 'It was half fulfilled: {part}.'], []],
  partL: [[], ['But the prophecy came only half true: {part}.', 'The sign was half kept: {part}.']],
  failC: [['The sign was read, but {fail}.', 'Nothing came of it: {fail}.', 'Yet {fail}.'], []],
  misreadL: [[], ['But it was not to be: {fail}.', 'Yet the sign came to nothing, for {fail}.', 'But the sign was misread, or false: {fail}.']],
  defyL: [[], ['But {who} defied the sign.', 'But {who} would not heed it.']],
  openC: [['What came of it is not yet written.'], []],
  openL: [[], ['What it foretold is yet to be seen.']],
}

export interface OmenFacts {
  k: number
  o: Order
  r: OrderOutcome | undefined
  /** The status as of the year told. */
  status: number
  /** The actor's seat when it was given (the OrderGiven event's settlement), -1. */
  seat: number
}

/** The orders given by the year told, chronological, that pass `pred`. */
export function ordersWhere(c: Ctx, pred: (f: OmenFacts) => boolean): OmenFacts[] {
  const h = c.h
  const O = h.orders
  if (!O || !O.length) return []
  const seats = new Map<number, number>()
  for (const i of c.type(EventType.OrderGiven)) seats.set(c.ev(i).value, c.ev(i).settlement)
  const out: OmenFacts[] = []
  O.forEach((o, k) => {
    if (o.year > c.Y || !seats.has(k)) return
    const r = h.orderOutcomes?.[k]
    const f = { k, o, r, status: statusAt(o, r, c.Y), seat: seats.get(k) ?? r?.place ?? -1 }
    if (pred(f)) out.push(f)
  })
  return out.sort((a, b) => a.o.year - b.o.year || a.k - b.k)
}

const isPeopleKind = (k: number) => k <= OrderKind.Idea
const isPolityKind = (k: number) => k >= OrderKind.War && k <= OrderKind.Faith
const isTownKind = (k: number) => k === OrderKind.Fortify || k === OrderKind.Quarantine

/** The orders a people's saga tells: its own, its states', its towns'. */
export function omensOfPeople(c: Ctx, p: number): OmenFacts[] {
  return ordersWhere(c, ({ o }) => (isPeopleKind(o.kind) && o.actor === p) || (isPolityKind(o.kind) && c.h.polities[o.actor]?.people === p) || (isTownKind(o.kind) && c.peopleOf(o.actor) === p))
}
/** A state's: its own, a war or peace aimed at it, its towns' at the time. */
export function omensOfState(c: Ctx, p: number): OmenFacts[] {
  return ordersWhere(c, ({ o }) => (isPolityKind(o.kind) && (o.actor === p || ((o.kind === OrderKind.War || o.kind === OrderKind.Peace) && o.target === p))) || (isTownKind(o.kind) && c.polityOf(o.actor, o.year) === p))
}
/** A town's: its own, a seat moved to it, a town founded by it (the settlers' sign), one that came to pass there or was seen there. */
export function omensOfCity(c: Ctx, id: number): OmenFacts[] {
  const J = c.h.journeys
  return ordersWhere(c, ({ o, r, seat, status }) => {
    if (isTownKind(o.kind)) return o.actor === id
    if (o.kind === OrderKind.Seat && o.target === id) return true
    if (r && status >= OrderStatus.Fulfilled && r.place === id) return true
    if (o.kind === OrderKind.Settle && r && r.product === id) return true
    if (o.kind === OrderKind.Explore && r && r.product >= 0 && J && r.product < J.count && J.from[r.product] === id && status >= OrderStatus.Fulfilled) return true
    return seat === id && !isPolityKind(o.kind)
  })
}
/** A house's: orders to a realm while one of the house reigned. */
export function omensOfHouse(c: Ctx, d: number): OmenFacts[] {
  return ordersWhere(c, ({ o }) => isPolityKind(o.kind) && reignAt(c, o.actor, o.year) >= 0 && c.rd!.rulers[reignAt(c, o.actor, o.year)].dynasty === d)
}
/** Those given, or resolved, in the years from `a` to `b`. */
export function omensOfYears(c: Ctx, a: number, b: number): OmenFacts[] {
  return ordersWhere(c, ({ o, r }) => (o.year >= a && o.year <= b) || (!!r && r.year >= a && r.year <= b && r.year <= c.Y))
}

/** The reign of polity p at year y (-1). */
function reignAt(c: Ctx, p: number, y: number): number {
  const h = c.h, rd = c.rd
  if (!rd || p < 0 || p + 1 >= h.reignOffsets.length) return -1
  let best = -1
  for (const r of h.reignIds.subarray(h.reignOffsets[p], h.reignOffsets[p + 1])) {
    const x = rd.rulers[r]
    if (x.acceded <= y && (x.ended < 0 || x.ended >= y)) best = r
  }
  return best
}

/** Compass word of cell b seen from cell a ('' without a world). */
function bearing(c: Ctx, a: number, b: number): string {
  const P = c.world?.grid.positions
  if (!P || a < 0 || b < 0) return ''
  const lat = (x: number) => Math.asin(Math.max(-1, Math.min(1, P[x * 3 + 1])))
  const lon = (x: number) => Math.atan2(P[x * 3], P[x * 3 + 2])
  const f1 = lat(a), f2 = lat(b), dl = lon(b) - lon(a)
  const y = Math.sin(dl) * Math.cos(f2)
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8]
}

const DIR_ADJ: Record<string, string> = { north: 'northern', south: 'southern', east: 'eastern', west: 'western', 'north-east': 'north-eastern', 'north-west': 'north-western', 'south-east': 'south-eastern', 'south-west': 'south-western' }

/** The target cell in words: the nearest named landmass, sea or range by `y` ("the Chakan Nain sea"), else "the lands to the north". */
function cellPlace(c: Ctx, cell: number, y: number, dir: string): string {
  const w = c.world
  if (w && cell >= 0 && cell < w.grid.cellCount) {
    const P = w.grid.positions
    let best = '', bd = 0.985
    for (const f of c.h.features) {
      if (f.namedYear > y || f.anchorCell < 0 || f.kind === FeatureKind.River || f.kind === FeatureKind.Lake) continue
      const d = P[cell * 3] * P[f.anchorCell * 3] + P[cell * 3 + 1] * P[f.anchorCell * 3 + 1] + P[cell * 3 + 2] * P[f.anchorCell * 3 + 2]
      if (d > bd) { bd = d; best = featureWords(f.kind, f.name) }
    }
    if (best) return best
  }
  return dir ? `the lands to the ${dir}` : 'the far lands'
}

function featureWords(kind: number, name: string): string {
  switch (kind) {
    case FeatureKind.Continent: return `the land of ${name}`
    case FeatureKind.Island: return `the island of ${name}`
    case FeatureKind.Ocean: return `the ${name} ocean`
    case FeatureKind.Sea: return `the ${name} sea`
    case FeatureKind.MountainRange: return `the ${name} mountains`
    case FeatureKind.Desert: return `the ${name} desert`
    case FeatureKind.Forest: return `the ${name} forest`
  }
  return name
}

/** The omen of one order and what came of it, in the voice's register (two to four sentences). */
export function omenText(c: Ctx, v: Voice, f: OmenFacts): string {
  const h = c.h
  const { o, r, k } = f
  const legend = v.legend
  const Y = c.Y
  const seatId = f.seat >= 0 ? f.seat : r?.place ?? -1
  const seat = seatId >= 0 ? c.name(seatId, o.year) : 'the old town'
  // who saw it
  let who = '', plural = true
  if (isPeopleKind(o.kind)) who = `the ${c.peopleName(o.actor)}`
  else if (isPolityKind(o.kind)) {
    const rr = reignAt(c, o.actor, o.year)
    if (rr >= 0) { who = c.ruler(rr, o.year); plural = false } else who = `the lords of ${seat}`
  } else who = `the people of ${c.name(o.actor, o.year)}`
  // where it pointed
  const t = o.target ?? -1
  let targetCell = -1, target = ''
  if (o.kind === OrderKind.Explore || o.kind === OrderKind.Settle) targetCell = t
  else if (o.kind === OrderKind.Seat && t >= 0 && t < c.N) { targetCell = h.settlements[t].cell; target = c.name(t, o.year) }
  else if ((o.kind === OrderKind.War || o.kind === OrderKind.Peace) && t >= 0) { const cp = c.capital(t, o.year); if (cp >= 0) targetCell = h.settlements[cp].cell; target = c.pname(t) }
  const dir = seatId >= 0 && targetCell >= 0 ? bearing(c, h.settlements[seatId].cell, targetCell) : ''
  const place = targetCell >= 0 && (o.kind === OrderKind.Explore || o.kind === OrderKind.Settle) ? cellPlace(c, targetCell, Math.min(Y, r && r.year >= 0 ? r.year : Y), dir) : target
  const sp = o.kind === OrderKind.Crop ? `the ${h.species[t]?.name ?? 'strange'}` : ''
  const idea = o.kind === OrderKind.Idea ? h.ideas[t]?.name ?? 'a new art' : ''
  const faith = o.kind === OrderKind.Faith ? c.faith(t) : ''
  // the omen: seeded per order (the same in every saga), a coastal one only for a seat by the sea
  const coastal = seatId >= 0 ? !!settingOf(c, h.settlements[seatId].cell)?.coast : false
  const table = (OMENS[o.kind] ?? []).filter((x) => !x.coast || coastal)
  if (!table.length) return ''
  const rng = createRng(c.seed, `omen:${k}:${o.kind}:${o.year}`)
  const om = table[Math.min(table.length - 1, Math.floor(rng.next() * table.length))]
  const vars: Vars = { who, Who: cap(who), seat, dir: dir || 'far', dirAdj: DIR_ADJ[dir] ?? 'far', place, target: target || 'the enemy', sp, idea, faith, year: o.year }
  const omen = fill(legend ? om.l : om.c, vars)
  const parts: string[] = []
  if (legend) parts.push(v.p('omenL', { year: o.year, lc: omen.charAt(0).toLowerCase() + omen.slice(1) }))
  else parts.push(v.p('omenC', { year: o.year, omen, who, read: fill(om.read, vars) }))
  // what came of it
  const st = f.status
  const out = { ...vars }
  if (st === OrderStatus.Fulfilled && r) {
    out.done = doneClause(c, o, r, legend, place, who)
    out.Done = cap(out.done as string)
    parts.push(v.p(legend ? 'doneL' : 'doneC', out))
  } else if (st === OrderStatus.Partly && r) {
    out.part = partClause(c, o, r, place)
    parts.push(v.p(legend ? 'partL' : 'partC', out))
  } else if ((st === OrderStatus.Failed || st === OrderStatus.Expired) && r) {
    out.fail = failClause(o.kind, r.reason, legend, plural, c, o)
    parts.push(v.p(legend ? (r.reason === OrderReason.Refused ? 'defyL' : 'misreadL') : 'failC', out))
  } else parts.push(v.p(legend ? 'openL' : 'openC', out))
  return parts.map((s) => cap(s.trim())).join(' ').replace(/\s+/g, ' ')
}

function doneClause(c: Ctx, o: Order, r: OrderOutcome, legend: boolean, place: string, who: string): string {
  const h = c.h
  const y = r.year
  const at = r.place >= 0 ? c.name(r.place, y) : ''
  switch (o.kind) {
    case OrderKind.Explore: {
      const J = h.journeys
      if (r.reason === OrderReason.Reached && J && r.product >= 0 && r.product < J.count) {
        const from = c.name(J.from[r.product], y)
        const dep = Math.floor(J.departYear[r.product])
        const when = dep === o.year ? 'that same year' : `in ${dep}`
        return legend ? `the ships of ${from} put out ${when} and came to ${place}${y !== dep ? ` in ${y}` : ''}` : `an expedition left ${from} ${when} and reached ${place}${y !== dep ? ` in ${y}` : ''}`
      }
      return `by ${y} word of ${place} had come to them from others`
    }
    case OrderKind.Settle: return legend ? `in ${y} they raised ${c.name(r.product, y)} where the sign had shown` : `${c.name(r.product, y)} was founded that way in ${y}`
    case OrderKind.Crop: return `by ${y} ${`the ${h.species[o.target ?? -1]?.name ?? 'new crop'}`} was grown at ${at || 'their towns'}`
    case OrderKind.Idea: return `by ${y} ${h.ideas[o.target ?? -1]?.name ?? 'the new art'} was known at ${at || 'their towns'}`
    case OrderKind.War: {
      const W = c.pd?.wars
      const w = r.product
      const name = W && w >= 0 && w < W.count ? warName(c, w) : ''
      const first = W && w >= 0 && w < W.count && W.attacker[w] === o.actor
      const base = first ? `in ${y} ${c.pname(o.actor)} went to war with ${c.pname(o.target ?? -1)}` : `in ${y} war came between ${c.pname(o.actor)} and ${c.pname(o.target ?? -1)}`
      return name ? `${base}: ${name}` : base
    }
    case OrderKind.Peace: return legend ? `in ${y} the war with ${c.pname(o.target ?? -1)} was ended` : `peace was made with ${c.pname(o.target ?? -1)} in ${y}`
    case OrderKind.Seat: return legend ? `in ${y} the court rode into ${c.name(r.product, y)} and made it the seat of the realm` : `in ${y} the court moved to ${c.name(r.product, y)}`
    case OrderKind.Faith: {
      const ruler = c.rd && r.product >= 0 && r.product < c.rd.R ? c.ruler(r.product, y) : who
      return `${ruler} took up ${c.faith(o.target ?? -1)} in ${y}`
    }
    case OrderKind.Fortify: return legend ? `by ${y} walls stood about ${c.name(o.actor, y)}` : `walls rose about ${c.name(o.actor, y)} in ${y}`
    case OrderKind.Quarantine: return `in ${y} ${c.name(o.actor, y)} began to hold the ships in quarantine`
  }
  return `it came about in ${y}`
}

function partClause(c: Ctx, o: Order, r: OrderOutcome, place: string): string {
  if (o.kind === OrderKind.Explore) {
    const from = r.place >= 0 ? c.name(r.place, r.year) : ''
    const yr = r.acted >= 0 ? r.acted : o.year
    return `an expedition${from ? ` from ${from}` : ''} set out that way in ${yr}, but by ${r.year} none had reached ${place}`
  }
  if (o.kind === OrderKind.Settle && r.product >= 0) return `${c.name(r.product, r.year)} was founded in ${r.year}, but short of the place`
  return failClause(o.kind, r.reason, false, true, c, o)
}

function failClause(kind: number, reason: number, legend: boolean, plural: boolean, c: Ctx, o: Order): string {
  const were = plural ? 'were' : 'was'
  switch (reason) {
    case OrderReason.NoActor: case OrderReason.ActorGone: return kind <= OrderKind.Idea ? (legend ? 'those it called were gone before they could answer' : 'there was no one left to answer it') : kind >= OrderKind.Fortify ? (legend ? 'the town was already dust' : 'the town was gone') : legend ? 'the realm it called was already dust' : 'the realm it called no longer stood'
    case OrderReason.TargetGone: return legend ? 'what it pointed to passed away' : 'what it pointed to was gone'
    case OrderReason.NoExpedition: return legend ? 'no ship would sail' : 'no town of theirs could fit out an expedition'
    case OrderReason.OutOfReach: return legend ? 'the sea gave back only empty water' : 'their ships found nothing new that way'
    case OrderReason.NoRoom: return legend ? 'the land that way would not have them' : 'their settlers found no free land that way'
    case OrderReason.Unknown: return 'the land that way was unknown to them'
    case OrderReason.Unfit: return kind === OrderKind.Settle ? 'there was only sea that way' : legend ? 'it would not grow in their soil' : 'it would grow at none of their towns'
    case OrderReason.NoSource: return kind === OrderKind.Idea ? (legend ? 'no one came to teach it' : 'no one they knew could teach it') : legend ? 'no seed of it came to them' : 'no one they knew had it to give'
    case OrderReason.Prerequisite: return 'they lacked the learning it rests on'
    case OrderReason.NoBorder: return legend ? 'no road led to the enemy' : `no border lay between ${c.pname(o.actor)} and ${c.pname(o.target ?? -1)}`
    case OrderReason.Truce: return 'a truce held'
    case OrderReason.TooWeak: return kind === OrderKind.War ? (legend ? 'the spears were never enough' : 'the realm was never strong enough at the border to dare it') : 'the town was too small'
    case OrderReason.NotAtWar: return 'there was no war to end'
    case OrderReason.NotMember: return `${c.name(o.target ?? -1, o.year)} was not in the realm`
    case OrderReason.Refused: return kind === OrderKind.Idea ? 'the faithful and the guilds would not have it' : 'the ruler would not'
    case OrderReason.NotPort: return `${c.name(o.actor, o.year)} had no harbour${legend ? ' to close' : ''}`
    case OrderReason.Unskilled: return 'its people did not know how'
    case OrderReason.Absent: return 'too few in the realm kept that faith'
    case OrderReason.AlreadyDone: return kind === OrderKind.Fortify ? 'the walls were already up' : kind === OrderKind.Faith ? `that faith ${were} already kept at court` : 'it was so already'
    case OrderReason.Busy: return 'the realm had wars enough'
    case OrderReason.SystemOff: return legend ? 'its hour had not come' : 'nothing came of it'
  }
  return legend ? 'its hour had not come' : 'nothing came of it'
}

// ---------------------------------------------------------------------------
// The first hearths the player planted (HistoryOptions.cradles; History.cradleWish, cradleCell, cradlePlaced, read
// through cradlesData.ts): told as the work of the Divine, never as the player's. Set down as wished, the people
// were placed by the Divine on their land; moved, the Divine pointed to the water (or the ice) the wish lay on and they
// came ashore at the nearest land; rejected, the Divine marked a place no one could live and they found their own.
// The chronicle register hedges ("It is held that..."), the legend's tells it as plain fact. Peoples whose cradle the
// simulation chose are told as before (no sentence). Every sentence rests on cradlePlaced (the outcome), cradleWish
// (what the wished cell was: sea, ice) and cradleCell with the people's founder (where they began); the voice's
// seeded stream picks the wording only.

export const DIVINE_T: PhraseTable = {
  divine: [
    ['It is held that the {people} did not wander to {home} but were set down there; the old songs say the land was chosen for them.', 'The {people}, it is said, did not come to {home} by their own wandering: they were set down there, and the old songs say the land was chosen for them.'],
    ['In the beginning the Divine marked {land} of {home} and set the first fire of the {people} upon it.', 'Before the first year was counted the Divine chose {land} of {home}, and set the {people} down upon it, and lit their first fire.'],
  ],
  divineMoved: [
    ['It is held that the place chosen for the {people} lay out on {water}, and that they came ashore at the nearest land, at {home}; the old songs say the shore was given them.', 'The old songs say a place was chosen for the {people} on {water}, and that they came ashore at the nearest land, at {home}.'],
    ['In the beginning the Divine pointed to {water}, and the {people} came ashore at the nearest land, at {home}.', 'In the beginning the Divine set a mark upon {water}, and the {people} came ashore at the nearest land, at {home}, and lit their first fire there.'],
  ],
  divineRejected: [
    ['It is told that a place was chosen for the {people} where no one could live, and that they were left to find their own.', 'The old songs say the place chosen for the {people} was one no one could live in, and that they were left to find their own.'],
    ['In the beginning the Divine marked a place no one could live; the {people} were left to find their own.', 'The Divine marked for the {people} a place where no one could live, and left them to find their own.'],
  ],
  /** (a placed people set down within sight of another placed people: History.cradleCrowded) */
  divineCrowded: [
    ['The old songs say they were set down within sight of the {other}.', 'It is held that the {other} were set down within sight of them.'],
    ['Within sight of them the Divine set down the {other}.', 'And the Divine set the {other} down within sight of them, so that each saw the other\'s smoke.'],
  ],
  /** (the chronicle's setting of a placed people's first hearth, after `divine` or `divineMoved`: the legend's sentence names the land itself) */
  divineWhere: [['{home} lay {where}.', 'Their first hearth, {home}, lay {where}.'], []],
  divineFew: [
    ['Of the {n} peoples, {k} {were} set down by the Divine, as the old songs hold{which}; the rest found their own hearths.', 'The old songs hold that {k} of the {n} peoples {were} set down by the Divine{which}; the rest found their own hearths.'],
    ['Of the {n} peoples, {k} {were} set down by the Divine{which}; the rest found their own hearths.', 'Of the {n} peoples the Divine set down {k}{which}; the rest found their own hearths.'],
  ],
  divineAll: [
    ['All {n} peoples, the old songs hold, were set down by the Divine{which}.'],
    ['All {n} peoples were set down by the Divine{which}, and none found its own hearth.'],
  ],
  divineNone: [
    ['It is told that places were chosen for {k} of the peoples where no one could live; all {n} found their own hearths.'],
    ['The Divine marked for {k} of the peoples places where no one could live, and all {n} found their own hearths.'],
  ],
}

/** The land a cell lies in, as the sagas name it ("the grassland"), from its biome. */
const BIOME_LAND: readonly string[] = ['the sea', 'the shallows', 'the ice', 'the tundra', 'the pinewoods', 'the woodland', 'the grassland', 'the desert’s edge', 'the savanna', 'the rainforest', 'the mountains']

/** What the wished cell of a moved cradle was ("the sea", "the ice"), from the world. */
function wishWater(c: Ctx, cell: number): string {
  const w = c.world
  if (!w || cell < 0 || cell >= w.grid.cellCount) return 'the waters'
  if (w.lake[cell]) return 'the waters of a lake'
  const b = w.biome[cell]
  return b === Biome.Ice ? 'the ice' : b === Biome.Ocean || b === Biome.Coast || w.elevation[cell] < 0 ? 'the sea' : 'a place no one could live'
}

/** How people p's first hearth came to be, told as divine placement ('' when the simulation chose it); `replaces`: the sentence says where they began (the plain origin can go). */
export function divineOrigin(c: Ctx, v: Voice, p: number): { text: string; replaces: boolean } {
  const rec = cradlesOf(c.h)
  const o = hearthOf(rec, p)
  if (!rec || o === CradleOutcome.Chosen || p < 0 || p >= c.h.peoples.length) return { text: '', replaces: false }
  const home = c.h.peoples[p].founder
  const vars: Vars = { people: c.peopleName(p), home: c.place(home, 0) }
  if (o === CradleOutcome.Placed) {
    const w = c.world
    const cell = rec.cell[p] >= 0 ? rec.cell[p] : c.h.settlements[home]?.cell ?? -1
    vars.land = w && cell >= 0 && cell < w.grid.cellCount ? BIOME_LAND[w.biome[cell]] ?? 'the land' : 'the land'
    return { text: v.p('divine', vars) + crowdedText(c, v, rec, p), replaces: true }
  }
  if (o === CradleOutcome.Moved) return { text: v.p('divineMoved', { ...vars, water: wishWater(c, rec.wish[p]) }) + crowdedText(c, v, rec, p), replaces: true }
  return { text: v.p('divineRejected', vars), replaces: false }
}

/** ' They were set down within sight of the X.' for a crowded people: the nearest other crowded wished people ('' otherwise). */
function crowdedText(c: Ctx, v: Voice, rec: CradleRecord, p: number): string {
  if (!rec.crowded[p]) return ''
  const P = c.h.peoples.length
  const pos = c.world?.grid.positions
  let best = -1, bd = -Infinity
  for (let q = 0; q < P; q++) {
    if (q === p || !rec.crowded[q] || (rec.placed[q] !== CradleOutcome.Placed && rec.placed[q] !== CradleOutcome.Moved)) continue
    const a = rec.cell[p], b = rec.cell[q]
    const d = pos ? pos[a * 3] * pos[b * 3] + pos[a * 3 + 1] * pos[b * 3 + 1] + pos[a * 3 + 2] * pos[b * 3 + 2] : -q
    if (d > bd) { bd = d; best = q }
  }
  return best >= 0 ? ' ' + v.p('divineCrowded', { other: c.peopleName(best) }) : ''
}

/** One sentence on how many peoples the Divine set down ('' when none was placed); `names`: say which, and where. */
export function divineSummary(c: Ctx, v: Voice, names: boolean): string {
  const rec = cradlesOf(c.h)
  if (!rec) return ''
  const P = c.h.peoples.length
  const set: number[] = []
  let rejected = 0
  for (let p = 0; p < P; p++) {
    const o = rec.placed[p]
    if (o === CradleOutcome.Placed || o === CradleOutcome.Moved) set.push(p)
    else if (o === CradleOutcome.Rejected) rejected++
  }
  const n = num(P)
  if (set.length === 0) return rejected ? v.p('divineNone', { n, k: num(rejected) }) : ''
  const which = names ? ` (${list(set.slice(0, 4).map((p) => `the ${c.peopleName(p)} at ${c.place(c.h.peoples[p].founder, 0)}`))}${set.length > 4 ? `, and ${num(set.length - 4)} more` : ''})` : ''
  if (set.length === P) return v.p('divineAll', { n, which })
  return v.p('divineFew', { n, k: num(set.length), were: set.length === 1 ? 'was' : 'were', which })
}
