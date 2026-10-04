// ideas: state of the ideas system: who holds which idea, learning progress, the channels between peoples, the effects, the
// adoption log. Every draw comes from 'history-ideas' (IdeasState.rng). Per-people and per-pair arrays are sized once (the
// people count is fixed); per-settlement arrays grow with the settlements. The context and the effects are separate objects
// so the state keeps fast properties.

import type { Rng } from '../../rng.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import { IDEA_DEFS } from './params.ts'
import type { IdeaCtx } from './params.ts'

export const I_COUNT = IDEA_DEFS.length
/** Channels, indexed by IdeaHow (0 Invented and 13 Lost unused). */
export const CH = 14

/** Index of each idea by key, prerequisites as id lists, mirrored techniques per TQ (-1). */
export const IDEA_INDEX = new Map<string, number>() // (lookup only)
IDEA_DEFS.forEach((d, i) => IDEA_INDEX.set(d.key, i))
export const PRE: number[][] = IDEA_DEFS.map((d) => d.pre.map((k) => { const i = IDEA_INDEX.get(k); if (i === undefined) throw new Error('unknown idea ' + k); return i }))
export const IDEA_OF_TECHNIQUE = new Int32Array(16).fill(-1)
IDEA_DEFS.forEach((d, i) => { if (d.technique >= 0) IDEA_OF_TECHNIQUE[d.technique] = i })

/** Effects of the ideas each people holds (recomputed every step). */
export interface IdeaEffects {
  /** Technology cap per people per field: cap[p * 4 + f]. */
  cap: Float64Array
  land: Float64Array
  seaCost: Float64Array
  range: Float64Array
  war: Float64Array
  defence: Float64Array
  admin: Float64Array
  toll: Float64Array
  craft: Float64Array
  learn: Float64Array
  /** 1 when the people may quarantine its ports. */
  quarantine: Uint8Array
  /** Farm multiplier per settlement (dry river land with irrigation), grown with the settlements. */
  farm: Float64Array
}

export interface IdeasDiag {
  conceived: number
  independent: number
  adopted: number
  lost: number
  resisted: number
  /** Adoptions per IdeaHow. */
  byHow: number[]
}

export interface IdeasState {
  rng: Rng
  P: number
  I: number
  /** held[p * I + i]: 1 held; year since held (-1). */
  held: Uint8Array
  since: Int16Array
  /** Learning progress per people and idea, and the share of it each channel carried: acc[(p * I + i) * CH + c]. */
  prog: Float64Array
  acc: Float64Array
  /** 1 while a refusal of the idea by the people is logged (until it takes it up). */
  refused: Uint8Array
  /** Channel rates this step between each learner q and teacher h: rate[(q * P + h) * CH + c]; gateway settlements (q's side, h's side). */
  rate: Float64Array
  gwQ: Int32Array
  gwH: Int32Array
  /** Pulses of the events since the last step, same layout (q learns from h), and their gateways. */
  pulse: Float64Array
  pgQ: Int32Array
  pgH: Int32Array
  /** Smoothed long-haul leg volume between peoples [q * P + h] (symmetric), and the leg ends of the busiest leg (q's, h's). */
  laneVol: Float64Array
  laneQ: Int32Array
  laneH: Int32Array
  /** Highest recent population per people (falling slowly), for collapse. */
  peak: Float64Array
  /** Ideas each people conceived lately (decaying by IDEA.cardDecay a year): Cardwell's law. */
  recent: Float64Array
  /** Largest living settlement per people this step (-1), and its capital (largest settlement's polity capital, else the largest). */
  largest: Int32Array
  capital: Int32Array
  /** First conception per idea: year (-1), people, settlement; number of independent origins. */
  firstYear: Int32Array
  firstPeople: Int32Array
  firstAt: Int32Array
  origins: Int32Array
  /** Adoption log (contract IdeaAdoptions), in order. */
  aIdea: number[]
  aPeople: number[]
  aYear: number[]
  aHow: number[]
  aFrom: number[]
  aVia: number[]
  aSource: number[]
  /** Events scanned for pulses. */
  evSeen: number
  ctx: IdeaCtx
  fx: IdeaEffects
  /** Per-settlement capacity of fx.farm. */
  cap: number
  diag: IdeasDiag
}

const f64 = (n: number): Float64Array => new Float64Array(n)

export function createIdeas(s: HistoryState): IdeasState {
  const P = s.know.P
  const I = I_COUNT
  const ctx: IdeaCtx = {
    pop: f64(P), big: f64(P), towns: f64(P), cities: f64(P), coast: f64(P), port: f64(P), river: f64(P), dry: f64(P), dryRiver: f64(P), open: f64(P),
    ore: f64(P), draught: f64(P), horse: f64(P), fibre: f64(P), trade: f64(P), lanes: f64(P), tier: f64(P), danger: f64(P), plague: f64(P), crowd: f64(P),
    farm: f64(P), sea: f64(P), metal: f64(P), crafts: f64(P), met: f64(P),
  }
  const ones = (): Float64Array => new Float64Array(P).fill(1)
  const fx: IdeaEffects = {
    cap: new Float64Array(P * 4).fill(1), land: ones(), seaCost: ones(), range: ones(), war: ones(), defence: ones(), admin: ones(), toll: ones(), craft: ones(),
    learn: ones(), quarantine: new Uint8Array(P), farm: new Float64Array(256).fill(1),
  }
  return {
    rng: createRng(s.world.seed, 'history-ideas'),
    P, I,
    held: new Uint8Array(P * I), since: new Int16Array(P * I).fill(-1),
    prog: f64(P * I), acc: f64(P * I * CH), refused: new Uint8Array(P * I),
    rate: f64(P * P * CH), gwQ: new Int32Array(P * P * CH).fill(-1), gwH: new Int32Array(P * P * CH).fill(-1),
    pulse: f64(P * P * CH), pgQ: new Int32Array(P * P * CH).fill(-1), pgH: new Int32Array(P * P * CH).fill(-1),
    laneVol: f64(P * P), laneQ: new Int32Array(P * P).fill(-1), laneH: new Int32Array(P * P).fill(-1),
    peak: f64(P), recent: f64(P), largest: new Int32Array(P).fill(-1), capital: new Int32Array(P).fill(-1),
    firstYear: new Int32Array(I).fill(-1), firstPeople: new Int32Array(I).fill(-1), firstAt: new Int32Array(I).fill(-1), origins: new Int32Array(I),
    aIdea: [], aPeople: [], aYear: [], aHow: [], aFrom: [], aVia: [], aSource: [],
    evSeen: 0,
    ctx, fx,
    cap: 256,
    diag: { conceived: 0, independent: 0, adopted: 0, lost: 0, resisted: 0, byHow: new Array<number>(CH).fill(0) },
  }
}

/** Grows the per-settlement arrays to hold `count` settlements. */
export function ensureIdeas(ix: IdeasState, count: number): void {
  if (count <= ix.cap) return
  let size = ix.cap
  while (size < count) size *= 2
  const f = new Float64Array(size).fill(1)
  f.set(ix.fx.farm)
  ix.fx.farm = f
  ix.cap = size
}
