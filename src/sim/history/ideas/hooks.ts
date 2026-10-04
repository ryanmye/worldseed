// ideas: the narrow hooks other systems call (technology caps and the levers), the adoption log and the effects. Every hook is
// called only while HistoryState.ideas is non-null, which is how the off switch keeps the history bit-identical. This module
// imports no system module (only types, the params and the state), so species.ts and the others can import it without a cycle.

import { EventType, IdeaHow } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { IDEA, IDEA_DEFS } from './params.ts'
import type { IdeasState } from './state.ts'
import { CH, IDEA_OF_TECHNIQUE } from './state.ts'

const DEFS = IDEA_DEFS

/**
 * People q takes up idea i this year by `how` (Invented: conceived at `via`) from people `from` (-1), coming in at settlement `via`
 * from settlement `src` (-1): the adoption row and its event (IdeaConceived for a conception, IdeaAdopted otherwise).
 */
export function record(s: HistoryState, ix: IdeasState, i: number, q: number, how: number, from: number, via: number, src: number): void {
  const qi = q * ix.I + i
  if (ix.held[qi]) return
  ix.held[qi] = 1
  ix.since[qi] = s.year
  ix.prog[qi] = 0
  ix.refused[qi] = 0
  ix.acc.fill(0, qi * CH, (qi + 1) * CH)
  ix.useMax[qi] = 0
  ix.aIdea.push(i); ix.aPeople.push(q); ix.aYear.push(s.year); ix.aHow.push(how); ix.aFrom.push(from); ix.aVia.push(via); ix.aSource.push(src)
  if (how === IdeaHow.Invented) {
    const first = ix.firstAt[i]
    const n = ix.origins[i]++
    if (ix.firstYear[i] < 0) { ix.firstYear[i] = s.year; ix.firstPeople[i] = q; ix.firstAt[i] = via }
    else ix.diag.independent++
    ix.diag.conceived++
    ix.recent[q] += 1
    s.events.push({ year: s.year, type: EventType.IdeaConceived, settlement: via, other: n > 0 ? first : -1, value: i, extra: n })
  } else {
    ix.diag.adopted++
    ix.diag.byHow[how]++
    s.events.push({ year: s.year, type: EventType.IdeaAdopted, settlement: via, other: src, value: i, extra: how })
  }
}

/**
 * Species hook (species.ts gainItem): people of settlement id gained technique k from settlement `from` (-1: worked out at home).
 * If the technique is an idea it is recorded: Invented when no living holder it has met had it (else learned from that holder,
 * as the species system's contact factor means), otherwise taken up from the source's people by the strongest channel between them.
 */
export function ideaTechnique(s: HistoryState, ix: IdeasState, id: number, k: number, from: number): void {
  const i = k < IDEA_OF_TECHNIQUE.length ? IDEA_OF_TECHNIQUE[k] : -1
  if (i < 0) return
  const q = s.people[id]
  const P = ix.P, I = ix.I
  if (ix.held[q * I + i]) return
  let h = from >= 0 && s.people[from] !== q ? s.people[from] : -1
  if (h < 0) {
    for (let t = 0; t < P && h < 0; t++) if (t !== q && ix.held[t * I + i] && ix.ctx.pop[t] > 0 && s.know.contact[q * P + t] >= 0) h = t
    if (h < 0) { record(s, ix, i, q, IdeaHow.Invented, -1, id, -1); return }
  }
  let how: number = IdeaHow.Contact, best = 0
  const o = (q * P + h) * CH
  for (let c = 2; c < CH; c++) if (c !== IdeaHow.Theft && ix.rate[o + c] > best) { best = ix.rate[o + c]; how = c }
  record(s, ix, i, q, how, h, id, from >= 0 && s.people[from] === h ? from : ix.largest[h])
}

/** The effects of the ideas each people holds (caps, levers) and the farm multiplier of each living settlement. */
export function recompute(s: HistoryState, ix: IdeasState): void {
  const P = ix.P, I = ix.I
  const X = IDEA
  const fx = ix.fx
  const c = ix.ctx
  const uf = X.useFloor
  let irr = -1
  for (let i = 0; i < I; i++) if (DEFS[i].farm) irr = i
  for (let p = 0; p < P; p++) {
    const o = p * 4
    for (let f = 0; f < 4; f++) fx.cap[o + f] = 1 + X.capBase
    let land = 1, sea = 1, range = 1, war = 1, def = 1, admin = 1, toll = 1, craft = 1, learn = 1
    let quar = 0
    let score = 0
    for (let i = 0; i < I; i++) {
      if (!ix.held[p * I + i]) continue
      const d = DEFS[i]
      // (the most use it has had since it was taken up: a people that held its ports keeps what the compass taught it)
      let u = d.use && c.pop[p] > 0 ? d.use(c, p) : 1
      const pi = p * I + i
      if (u < ix.useMax[pi]) u = ix.useMax[pi]
      else ix.useMax[pi] = u
      const m = uf + (1 - uf) * u
      const cm = m * X.capMul * X.capEra[d.era]
      score += m * X.eraWeight[d.era] * (d.weight ?? 1)
      const lm = m * X.lever
      for (let f = 0; f < 4; f++) fx.cap[o + f] += d.caps[f] * cm
      if (d.land) land += d.land * lm
      if (d.seaCost) sea += d.seaCost * lm
      if (d.range) range += d.range * lm
      if (d.war) war += d.war * lm
      if (d.defence) def += d.defence * lm
      if (d.admin) admin += d.admin * lm
      if (d.toll) toll += d.toll * m
      if (d.craft) craft += d.craft * lm
      if (d.learn) learn += d.learn
      if (d.quarantine) quar = 1
    }
    const gen = X.general * Math.sqrt(score) // (the general part: a people that knows more can do more, with diminishing returns)
    for (let f = 0; f < 4; f++) { fx.cap[o + f] += gen * X.generalField[f]; if (fx.cap[o + f] > fx.capPeak[o + f]) fx.capPeak[o + f] = fx.cap[o + f] }
    fx.land[p] = land; fx.seaCost[p] = sea; fx.range[p] = range; fx.war[p] = war; fx.defence[p] = def; fx.admin[p] = admin
    fx.toll[p] = toll > X.tollMin ? toll : X.tollMin
    fx.craft[p] = craft; fx.learn[p] = learn; fx.quarantine[p] = quar
  }
  // Farm multiplier: irrigation on dry river land.
  const T = s.terrain
  const living = s.living
  const farm = fx.farm
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const cell = s.cell[id]
    let m = 1
    if (irr >= 0 && ix.held[s.people[id] * I + irr] && T.aridity[cell] >= 0.35 && (T.river[cell] === 1 || T.riverCap[cell] > 0)) m += DEFS[irr].farm as number
    farm[id] = m
  }
}

// --- Technology (technology.ts) ---

/** Growth inc of a level L at index j (people * 4 + field) under its cap C: slowed above C, falling back above C + slack. */
export function ideaGrowth(ix: IdeasState, j: number, L: number, inc: number, dt: number): number {
  const X = IDEA
  inc *= X.practice
  const d = L - ix.fx.cap[j]
  if (!(d > 0)) return inc - X.catchUp * dt * d // (below the cap: the practice of ideas newly held catches up)
  const x = d / X.soft
  let g = inc / (1 + x * x)
  if (d > X.slack && ix.fx.cap[j] < ix.fx.capPeak[j]) g -= X.decay * dt * (d - X.slack) // (only after ideas were lost)
  return g
}

/** A diffusion gain at index j: at most up to the cap plus slack. */
export function ideaGain(ix: IdeasState, tech: Float64Array, j: number, gain: number): number {
  const room = ix.fx.cap[j] + IDEA.slack - tech[j]
  return gain < room ? gain : room > 0 ? room : 0
}

// --- Levers ---

/** Farm multiplier of settlement id (population.ts). */
export function ideaFarm(ix: IdeasState, id: number): number {
  return id < ix.cap ? ix.fx.farm[id] : 1
}
/** Overland transport (trade reach) multiplier of people p (trade.ts, goods/longhaul.ts). */
export function ideaLand(ix: IdeasState, p: number): number {
  return ix.fx.land[p]
}
/** Divisor of the deep-sea cost of people p (trade.ts, goods/longhaul.ts). */
export function ideaSea(ix: IdeasState, p: number): number {
  return ix.fx.seaCost[p]
}
/** Ship range multiplier of people p (voyages.ts, exploration.ts). */
export function ideaRange(ix: IdeasState, p: number): number {
  return ix.fx.range[p]
}
/** War strength multiplier of people p (polity qualityOf). */
export function ideaWar(ix: IdeasState, p: number): number {
  return ix.fx.war[p]
}
/** Wall multiplier of people p (polity localOf). */
export function ideaDefence(ix: IdeasState, p: number): number {
  return ix.fx.defence[p]
}
/** Reach of rule multiplier of people p (polity reachOf: tax and cohesion of large states). */
export function ideaAdmin(ix: IdeasState, p: number): number {
  return ix.fx.admin[p]
}
/** Toll multiplier of crowd diseases among people p (disease/system.ts). */
export function ideaToll(ix: IdeasState, p: number): number {
  return ix.fx.toll[p]
}
/** True when people p may hold its ships in quarantine (disease/system.ts). */
export function ideaQuarantine(ix: IdeasState, p: number): boolean {
  return ix.fx.quarantine[p] === 1
}
/** Workshop output multiplier of people p (goods/market.ts). */
export function ideaCraft(ix: IdeasState, p: number): number {
  return ix.fx.craft[p]
}
