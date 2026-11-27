// Partisan sagas (experience-whatif-director-sagas §3.2-3.5): the lens a saga is told through, a people's or a state's
// (MASTER-PLAN R5 reserves 'faction', 'ideology' and 'person' for later plans: until they land such a pov tells the
// neutral record). Without a pov there is no lens (Ctx.lens null) and every saga is the neutral record, byte for byte.
//
// Stance of the teller toward a polity at a year, the first that applies (Foe beats Kin):
//   Us: the viewpoint state, or its lineage (the parent chain either way) of its own people; for a people, its states.
//   Foe: at war with Us then, or a standing grudge (grudges-and-oaths standingGrudges, weight >= 0.3) of Us against it,
//        or (proxy, always on) a war between the two that began in the last PARTISAN.foeYears years.
//   Friend: an alliance, vassalage or tribute bond with Us in force, or the same state faith.
//   Kin: of the same people.  Neutral otherwise.
// Memoised per (polity, decade). Distortions are omission and wording only: no event is invented. Tolls are the truth ×
// PARTISAN factors (the beliefs plan records no casualty beliefs); strength words come only from beliefs (step 16, not
// built: PartisanFacts' proxies apply).

import { BondKind, EventType, WarKind, WarOutcome, type History } from '../../contract.ts'
import { bondActive, type PolitiesData } from '../politiesData.ts'
import { standingGrudges } from '../grudgesData.ts'
import { PARTISAN } from './partisanParams.ts'

/** Whose telling: a people's or a state's (null: the neutral record, as today). Later plans add 'faction', 'ideology', 'person' (R5). */
export interface Pov { kind: 'people' | 'state' | 'faction' | 'ideology' | 'person'; id: number }

/** How the teller stands to a polity at a year. */
export const Stance = { Us: 0, Kin: 1, Friend: 2, Neutral: 3, Foe: 4 } as const
export type Stance = (typeof Stance)[keyof typeof Stance]
/** Phrase-key suffix per stance (Voice.ps tries `key.<suffix>` first). */
export const STANCE_KEY: readonly string[] = ['us', 'kin', 'friend', '', 'foe']

/** "state:3" / "people:2" (the pov= URL parameter) and back. */
export const povKey = (p: Pov) => `${p.kind}:${p.id}`
export function parsePov(v: string | null): Pov | null {
  const m = v ? /^(people|state):(\d+)$/.exec(v) : null
  return m ? { kind: m[1] as Pov['kind'], id: Number(m[2]) } : null
}

/** The teller's side in a war. */
export interface WarSide { side: 'attacker' | 'defender' | 'none'; won: boolean; lost: boolean; white: boolean; ended: boolean }

export class Lens {
  readonly pov: Pov
  readonly h: History
  readonly pd: PolitiesData
  /** Polities of the teller (for a state: its lineage of its own people). */
  readonly us: Set<number>
  private memo = new Map<number, Stance>()

  constructor(h: History, pd: PolitiesData, pov: Pov) {
    this.h = h
    this.pd = pd
    this.pov = pov
    this.us = new Set()
    if (pov.kind === 'people') {
      for (let p = 0; p < pd.count; p++) if (pd.list[p].people === pov.id) this.us.add(p)
    } else if (pov.kind === 'state' && pov.id >= 0 && pov.id < pd.count) {
      const V = pov.id, people = pd.list[V].people
      this.us.add(V)
      for (let q = pd.list[V].parent; q >= 0; q = pd.list[q].parent) if (pd.list[q].people === people) this.us.add(q)
      const down = [V]
      while (down.length) for (const q of pd.children[down.pop()!] ?? []) if (pd.list[q].people === people && !this.us.has(q)) { this.us.add(q); down.push(q) }
    }
  }

  /** The stream suffix of the voice (neutral streams have none). */
  get suffix(): string {
    return `@${this.pov.kind[0]}${this.pov.id}`
  }

  isUs(p: number): boolean {
    return this.us.has(p)
  }

  /** Stance toward polity p at year y. */
  stance(p: number, y: number): Stance {
    if (p < 0 || p >= this.pd.count) return Stance.Neutral
    if (this.us.has(p)) return Stance.Us
    const key = p * 4096 + Math.max(0, Math.floor(y / 10))
    const hit = this.memo.get(key)
    if (hit !== undefined) return hit
    const s = this.compute(p, y)
    this.memo.set(key, s)
    return s
  }

  private compute(p: number, y: number): Stance {
    const pd = this.pd, W = pd.wars
    if (W) for (const w of pd.warsOf[p] ?? []) {
      const other = W.attacker[w] === p ? W.defender[w] : W.attacker[w]
      if (!this.us.has(other) || W.startYear[w] > y) continue
      const active = W.endYear[w] < 0 || W.endYear[w] >= y
      if (active || y - W.startYear[w] < PARTISAN.foeYears) return Stance.Foe
    }
    for (const u of this.us) {
      for (const g of standingGrudges(this.h, u, y)) if (g.other === p && g.w >= PARTISAN.grudgeFoe) return Stance.Foe
    }
    if (pd.bonds) for (const k of pd.bondsOf[p] ?? []) {
      const B = pd.bonds
      const other = B.a[k] === p ? B.b[k] : B.a[k]
      if (this.us.has(other) && bondActive(pd, k, y) && (B.kind[k] === BondKind.Alliance || B.kind[k] === BondKind.Vassal || B.kind[k] === BondKind.Tribute)) return Stance.Friend
    }
    const SF = this.h.stateFaith
    if (SF?.length) {
      const s = Math.max(0, Math.min(pd.snapshotCount - 1, Math.floor(y / pd.interval)))
      const f = SF[s * pd.count + p]
      if (f > 0) for (const u of this.us) if (SF[s * pd.count + u] === f) return Stance.Friend
    }
    const people = pd.list[p].people
    if (this.pov.kind === 'state' ? pd.list[this.pov.id]?.people === people : this.pov.id === people) return Stance.Kin
    return Stance.Neutral
  }

  /** The teller's side in war w as of year Y (the WarOutcome reading of state.ts). */
  sideOfWar(w: number, Y: number): WarSide {
    const W = this.pd.wars!
    const att = this.us.has(W.attacker[w]), def = this.us.has(W.defender[w])
    const side = att && !def ? 'attacker' : def && !att ? 'defender' : 'none'
    const ended = W.endYear[w] >= 0 && W.endYear[w] <= Y
    const o = W.outcome[w]
    let won = false, lost = false
    if (ended && side !== 'none') {
      const attWon = o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage
      const defWon = o === WarOutcome.DefenderGains
      won = side === 'attacker' ? attWon : defWon
      lost = side === 'attacker' ? defWon : attWon
      if (W.kind[w] === WarKind.CivilWar && o === WarOutcome.Reunified) { won = side === 'defender'; lost = !won }
    }
    return { side, won, lost, white: ended && o === WarOutcome.WhitePeace, ended }
  }

  /** Whether one of our capitals fell to the other side in war w (a Conquered of an Us capital). */
  capitalFell(w: number, Y: number, capitalOf: (p: number, y: number) => number): boolean {
    for (const i of this.h.events.length ? this.conquestsOf(w) : []) {
      const e = this.h.events[i]
      if (e.year > Y) break
      for (const u of this.us) if (capitalOf(u, Math.max(0, e.year - 1)) === e.settlement) return true
    }
    return false
  }
  private conq: Map<number, number[]> | null = null
  private conquestsOf(w: number): number[] {
    if (!this.conq) {
      this.conq = new Map()
      this.h.events.forEach((e, i) => { if (e.type === EventType.Conquered) { const a = this.conq!.get(e.value) ?? []; a.push(i); this.conq!.set(e.value, a) } })
    }
    return this.conq.get(w) ?? []
  }

  /**
   * Whether a war of ours is left out of the telling: the chronicle drops a lost war with fewer than omitLostDead dead,
   * at most one town taken and no capital of ours fallen; the legend drops every lost war in which no capital of ours fell.
   */
  omitsWar(w: number, Y: number, legend: boolean, capitalOf: (p: number, y: number) => number): boolean {
    const s = this.sideOfWar(w, Y)
    if (!s.lost) return false
    const W = this.pd.wars!
    if (this.capitalFell(w, Y, capitalOf)) return false
    if (legend) return PARTISAN.legendOmitLost
    return W.dead[w] < PARTISAN.omitLostDead && W.taken[w] <= 1
  }

  /** A toll as the teller tells it: ours at the foe's hands (`ourByFoe`), the foe's at ours, ours at ours; 0 means "do not say". */
  toll(trueDead: number, who: 'ourByFoe' | 'foeByUs' | 'ourByUs', legend: boolean): number {
    const f = PARTISAN[who === 'ourByFoe' ? 'ourDeadByFoe' : who === 'foeByUs' ? 'foeDeadByUs' : 'ourDeadByUs'][legend ? 1 : 0]
    return f > 0 ? roundToll(trueDead * f, legend) : 0
  }
}

/** Chronicle: two significant figures. Legend: the nearest number of the formulaic set in log space. */
export function roundToll(n: number, legend: boolean): number {
  if (!(n > 0)) return 0
  if (legend) {
    let best: number = PARTISAN.legendNumbers[0]
    for (const x of PARTISAN.legendNumbers) if (Math.abs(Math.log(x / n)) < Math.abs(Math.log(best / n))) best = x
    return best
  }
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1))
  return Math.round(n / p) * p
}
