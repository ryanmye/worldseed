// goods: state secrets and monopolies (design 5).
//
// Secrets: the four secret species (silk, tea, cloves and nutmeg, cochineal: held from the start by the peoples whose
// founding set has them, and by any people that tames one from the wild; only holders take them up from other peoples:
// hooks.ts crossFactor), two craft secrets (purple dye with murex, created by the first dyeing tradition that uses it; steel,
// created by the first blades tradition), and the chart of each lane (routes.ts). Holders are peoples; the polity that rules
// most of a secret's producers guards it (every 10 years, year % 10 = 9): its guard psi follows the rent it earns against its
// income, costs it, and protects producers by its grip on them. Exports of a secret variety leaving the holder's state pay a
// rent (market.ts). Leaks, per decade, per secret and each people in contact with a holder: contact (trade), espionage
// (states that pay much for it), smuggled seeds or tools (the contraband in its goods reaching the people: polities v2's smuggling, SecretSmuggled), rediscovery
// (crafts: technology and the input at hand), charts (contact, war); and at once: conquest of a producer, craftsmen fleeing a
// push (sack, famine, revolt, emigration) to another people (defection). SecretLeaked; MonopolyBroken once the first holder's
// share of world output falls below half. A craft secret whose traditions all end is lost (a lost art).

import { CraftKind, EventType, LeakChannel, SecretKind, TECH_FIELD_COUNT, TechField, TOWN_POPULATION } from '../../../contract.ts'
import { smoothstep } from '../../util.ts'
import type { HistoryState } from '../state.ts'
import { CASH, SP, SPECIES_TABLE, gainItem, hasBit, itemBit } from '../species.ts'
import { grip, Tier, tierOf } from '../polity/state.ts'
import { atWar } from '../polity/formation.ts'
import { SPECIES } from '../params.ts'
import type { TechState } from '../technology.ts'
import { SECRET, WORKSHOP } from './params.ts'
import type { GoodsState } from './state.ts'
import { K, M, MIX_OF, logGoods, setVarSecret } from './state.ts'
import { prosperity } from '../migration.ts'
import { chartedExpedition } from './routes.ts'

/** Creates secret `kind` about `subject`, begun at settlement `at` (-1); returns its id. */
export function newSecret(s: HistoryState, g: GoodsState, kind: number, subject: number, at: number): number {
  const k = g.sCount++
  g.sKind.push(kind); g.sSubject.push(subject); g.sFound.push(s.year); g.sFoundAt.push(at); g.sLost.push(-1)
  g.sHeld.push(new Uint8Array(g.P)); g.sPsi.push(SECRET.stateless); g.sOrig.push(at >= 0 ? s.people[at] : -1); g.sBroken.push(0); g.sGuardLogged.push(0)
  g.sRent.push(0); g.sExport.push(0); g.sPi.push(0)
  return k
}

/** Polity of settlement id (-1 stateless or none). */
function polityOf(s: HistoryState, id: number): number {
  const ps = s.pol
  return ps !== null && id >= 0 && id < ps.seen ? ps.polity[id] : -1
}

/**
 * People p gains secret k this year by `channel` through settlement `via` (from source settlement `src`); SecretLeaked unless
 * it is one of the secret's first holders.
 */
export function grantHold(s: HistoryState, g: GoodsState, k: number, p: number, channel: number, via: number, src: number): void {
  if (g.sHeld[k][p]) return
  g.sHeld[k][p] = 1
  g.hSecret.push(k); g.hPeople.push(p); g.hPolity.push(polityOf(s, via)); g.hFrom.push(s.year); g.hTo.push(-1); g.hChannel.push(channel); g.hVia.push(via)
  if (g.sOrig[k] < 0) g.sOrig[k] = p
  if (s.year > g.sFound[k] && via >= 0) {
    logGoods(s, EventType.SecretLeaked, via, src, k, channel)
    g.diag.leakLog.push(s.year, k, p, channel)
  }
  if (g.sKind[k] === SecretKind.Chart && channel !== LeakChannel.Founded) chartedExpedition(s, g, k, p)
}

/** People p loses secret k this year (its holding interval ends). */
function dropHold(s: HistoryState, g: GoodsState, k: number, p: number): void {
  if (!g.sHeld[k][p]) return
  g.sHeld[k][p] = 0
  for (let i = g.hSecret.length - 1; i >= 0; i--) if (g.hSecret[i] === k && g.hPeople[i] === p && g.hTo[i] < 0) { g.hTo[i] = s.year; break }
}

/** The four secret species: their secrets, held by the peoples whose founding set has them (set-up, year 0). */
export function initSpeciesSecrets(s: HistoryState, g: GoodsState): void {
  const sp = s.sp
  for (const name of SECRET.species) {
    let x = -1
    for (let i = 0; i < SPECIES_TABLE.length; i++) if (SPECIES_TABLE[i].archetype === name) x = i
    if (x < 0) continue
    let at = -1
    for (let p = 0; p < g.P; p++) if (hasBit(sp.found0[p], sp.found1[p], itemBit(x))) { at = s.founders[p]; break }
    const k = newSecret(s, g, SecretKind.Species, x, at)
    g.speciesSecret[x] = k
    for (let p = 0; p < g.P; p++) if (hasBit(sp.found0[p], sp.found1[p], itemBit(x))) grantHold(s, g, k, p, LeakChannel.Founded, s.founders[p], -1)
  }
}

/** True when people p holds secret k. */
export function craftHeld(g: GoodsState, k: number, p: number): boolean {
  return g.sHeld[k][p] === 1
}

/** Purple: settlement id dyes with murex (murex in its Luxury stock). */
function murexAt(g: GoodsState, id: number): boolean {
  if (id >= g.cap) return false
  const o = (id * M + MIX_OF[7]) * K
  for (let k = 0; k < K; k++) { const v = g.mixV[o + k]; if (v > 0 && g.vKind[v] === 2 && g.vDye[v]) return true }
  return false
}

/** Secret of craft c at settlement id: the secret's id, -1 if it is secret but not yet created, -2 if not secret there. */
export function secretKind(g: GoodsState, c: number, id: number): number {
  if (c === CraftKind.Blades) return g.steel
  if (c === CraftKind.Dyeing && murexAt(g, id)) return g.purple
  return -2
}

/** The craft secret of craft c passes to settlement `at`'s people (created there if it does not exist yet). */
export function grantCraft(s: HistoryState, g: GoodsState, c: number, at: number, from: number, channel: number): void {
  let k = c === CraftKind.Blades ? g.steel : c === CraftKind.Dyeing ? g.purple : -1
  if (c !== CraftKind.Blades && c !== CraftKind.Dyeing) return
  if (k < 0) {
    k = newSecret(s, g, SecretKind.Craft, c, at)
    if (c === CraftKind.Blades) g.steel = k
    else g.purple = k
    grantHold(s, g, k, s.people[at], LeakChannel.Founded, at, -1)
    // Its tradition's goods are the secret's.
    for (let t = 0; t < g.tCount; t++) if (g.tCraft[t] === c && g.tPeople[t] === s.people[at]) setVarSecret(g, g.tVar[t], k)
    return
  }
  grantHold(s, g, k, s.people[at], channel, at, from)
}

/** Secret of a tradition of craft c (steel for blades, purple for dyeing), -1. */
function craftSecret(g: GoodsState, c: number): number {
  return c === CraftKind.Blades ? g.steel : c === CraftKind.Dyeing ? g.purple : -1
}

/** Protection of producer id of secret k: psi * grip(dist, reach) * cohesion share in its state; stateless SECRET.stateless * psi. */
export function protectionOf(s: HistoryState, g: GoodsState, k: number, id: number): number {
  const psi = g.sPsi[k]
  const ps = s.pol
  const p = polityOf(s, id)
  if (ps === null || p < 0) return SECRET.stateless
  const A = ps.pAsab[p]
  return psi * grip(ps.dist[id], ps.pReach[p]) * (A / (A + 0.2))
}

/** Protection of a seat of craft c (0 when the craft is not secret). */
export function protection(s: HistoryState, g: GoodsState, c: number, id: number): number {
  const k = craftSecret(g, c)
  return k >= 0 ? protectionOf(s, g, k, id) : 0
}

const CASH_Q = new Int32Array(64).fill(-1)
CASH.forEach((x, q) => { CASH_Q[x] = q })

/** Output of secret k at settlement id this year (species: cash crop output; craft: tradition seat output; chart: lane home). */
function outputAt(s: HistoryState, g: GoodsState, k: number, id: number): number {
  void s
  const kind = g.sKind[k], subj = g.sSubject[k]
  if (kind === SecretKind.Species) {
    const q = CASH_Q[subj]
    return q >= 0 && id < g.cap ? g.cashCoef[id * CASH.length + q] * g.pot[id] : 0
  }
  if (kind === SecretKind.Craft) {
    const t = g.seatOf[id * 4 + subj]
    if (t < 0) return 0
    return subj === CraftKind.Blades ? g.wOut[id * 3] : g.wOut[id * 3 + 1]
  }
  return g.legOpen[subj] && g.legA[subj] === id ? 1 : 0
}


/** Scratch per people: output and largest producer. */
let POUT = new Float64Array(0), PTOP = new Int32Array(0), PBIG = new Int32Array(0)

/**
 * Every 10 years (year % 10 = 9): each secret's guard, its producers' protection, the leak channels per people, lost arts,
 * MonopolyBroken. `tk` gives the trade volume between peoples.
 */
export function secretPass(s: HistoryState, g: GoodsState, tk: TechState): void {
  const P = g.P
  if (POUT.length < P) { POUT = new Float64Array(P); PTOP = new Int32Array(P); PBIG = new Int32Array(P); PTOPV = new Float64Array(P) }
  const living = s.living
  const ps = s.pol
  // Largest settlement per people (alive).
  PBIG.fill(-1)
  for (let t = 0; t < living.length; t++) { const id = living[t]; const p = s.people[id]; if (PBIG[p] < 0 || s.pop[id] > s.pop[PBIG[p]]) PBIG[p] = id }
  for (let k = 0; k < g.sCount; k++) {
    if (g.sLost[k] >= 0) continue
    // A people that died out holds nothing.
    for (let p = 0; p < P; p++) if (g.sHeld[k][p] && PBIG[p] < 0) dropHold(s, g, k, p)
    // Craft secrets: lost with the last tradition of the craft among holders.
    if (g.sKind[k] === SecretKind.Craft) {
      let alive = false
      for (let t = 0; t < g.tCount && !alive; t++) if (g.tEnd[t] < 0 && g.tCraft[t] === g.sSubject[k] && g.sHeld[k][g.tPeople[t]]) alive = true
      if (!alive && s.year - g.sFound[k] > 30) {
        g.sLost[k] = s.year
        for (let p = 0; p < P; p++) dropHold(s, g, k, p)
        continue
      }
    }
    // Producers, output per people, and the main holder state.
    POUT.fill(0); PTOP.fill(-1)
    let world = 0
    let mainP = -1
    const ppop = PPOL
    ppop.length = 0
    if (OUTL.length < living.length) OUTL = new Float64Array(2 * living.length)
    const outl = OUTL
    PTOPV.fill(0)
    for (let t = 0; t < living.length; t++) {
      const id = living[t]
      const o = outputAt(s, g, k, id)
      outl[t] = o
      if (!(o > 0)) continue
      const p = s.people[id]
      POUT[p] += o
      world += o
      if (PTOP[p] < 0 || o > PTOPV[p]) { PTOP[p] = id; PTOPV[p] = o }
      if (g.sHeld[k][p]) {
        const q = polityOf(s, id)
        if (q >= 0) ppop.push(q, s.pop[id])
      }
    }
    // The state ruling most of the holders' producers guards it.
    let best = 0
    for (let i = 0; i < ppop.length; i += 2) {
      let sum = 0
      for (let j = 0; j < ppop.length; j += 2) if (ppop[j] === ppop[i]) sum += ppop[j + 1]
      if (sum > best || (sum === best && ppop[i] < mainP)) { best = sum; mainP = ppop[i] }
    }
    if (ps !== null && mainP >= 0 && ps.pEnded[mainP] < 0) {
      let inc = 1
      for (let t = 0; t < living.length; t++) if (ps.polity[living[t]] === mainP) inc += 0.02 * s.wealth[living[t]]
      const rent = g.sRent[k] / 10 + 0.3 * (g.sExport[k] / 10)
      const target = smoothstep(SECRET.rentLow, SECRET.rentHigh, rent / inc)
      let psi = g.sPsi[k] + 0.5 * (target - g.sPsi[k])
      const cap = ps.pCapital[mainP]
      const cost = SECRET.cost * psi * (best / 1000)
      if (s.wealth[cap] >= cost) s.wealth[cap] -= cost
      else psi *= 0.5
      g.sPsi[k] = psi
      if (!g.sGuardLogged[k] && psi >= 0.3) {
        g.sGuardLogged[k] = 1
        let prod = -1
        for (let t = 0; t < living.length; t++) { const id = living[t]; if (ps.polity[id] === mainP && outl[t] > 0 && g.sHeld[k][s.people[id]]) { prod = id; break } }
        logGoods(s, EventType.SecretGuarded, cap, prod, k, psi)
      }
    } else g.sPsi[k] = SECRET.stateless
    g.sRent[k] = 0
    g.sExport[k] = 0
    // Mean protection over the holders' producers.
    let pi = 0, pn = 0
    for (let t = 0; t < living.length; t++) { const id = living[t]; if (outl[t] > 0 && g.sHeld[k][s.people[id]]) { pi += protectionOf(s, g, k, id); pn++ } }
    g.sPi[k] = pn > 0 ? pi / pn : 0
    // MonopolyBroken: the first holder's share of world output below half (once there is output elsewhere).
    const orig = g.sOrig[k]
    if (!g.sBroken[k] && orig >= 0 && world > 0 && g.sKind[k] !== SecretKind.Chart && POUT[orig] < SECRET.broken * world && s.year - g.sFound[k] >= 20) {
      let nb = -1
      for (let p = 0; p < P; p++) if (p !== orig && PTOP[p] >= 0 && (nb < 0 || POUT[p] > POUT[s.people[nb]])) nb = PTOP[p]
      if (nb >= 0) {
        g.sBroken[k] = 1
        let other = PBIG[orig]
        if (ps !== null && other >= 0) { const q = polityOf(s, other); if (q >= 0) other = ps.pCapital[q] }
        logGoods(s, EventType.MonopolyBroken, nb, other, k, s.year - g.sFound[k])
      }
    }
    leaks(s, g, k, tk, PBIG)
  }
}
const PPOL: number[] = []
/** Output of the secret being reckoned per living settlement (index into living), and the top producer's output per people. */
let OUTL = new Float64Array(0)
let PTOPV = new Float64Array(0)

/** The leak channels of secret k for each people in contact with a holder (one draw each). */
function leaks(s: HistoryState, g: GoodsState, k: number, tk: TechState, big: Int32Array): void {
  const X = SECRET
  const P = g.P
  const know = s.know
  const held = g.sHeld[k]
  const kind = g.sKind[k]
  const pi = g.sPi[k]
  const rng = g.rng
  const tech = s.tech
  let h0 = g.sOrig[k]
  if (h0 < 0 || !held[h0] || big[h0] < 0) { h0 = -1; for (let p = 0; p < P; p++) if (held[p] && big[p] >= 0) { h0 = p; break } }
  if (h0 < 0) return
  const ps = s.pol
  for (let q = 0; q < P; q++) {
    if (held[q] || big[q] < 0) continue
    let contact = false
    let v = 0
    for (let h = 0; h < P; h++) {
      if (!held[h] || big[h] < 0) continue
      if (know.contact[q * P + h] >= 0) { contact = true; v += tk.pairVol[q * P + h] }
    }
    if (!contact) continue
    const field = kind === SecretKind.Craft && g.sSubject[k] === CraftKind.Blades ? TechField.Metalworking : TechField.Crafts
    let cr = tech[q * TECH_FIELD_COUNT + field] / tech[h0 * TECH_FIELD_COUNT + field]
    if (cr < 0.5) cr = 0.5
    if (cr > 1.5) cr = 1.5
    // Import bill of the secret's goods (value a year, last decade).
    let bill = 0, sv = 0
    for (let vv = 1; vv < g.vCount; vv++) if (g.vSecret[vv] === k) { bill += g.vImp[vv * P + q] / 10; sv += g.vSmug[vv * P + q] / 10 }
    const income = s.sp.v2.income[q] > 1 ? s.sp.v2.income[q] : 1
    const r = R
    r.fill(0)
    if (kind !== SecretKind.Chart) {
      r[LeakChannel.Contact] = X.contact * (kind === SecretKind.Craft ? X.craftContact : 1) * (v / (v + X.contactHalf)) * (1 - X.protect * pi) * cr
      // Espionage: a kingdom or empire paying much for it.
      const qp = polityOf(s, big[q])
      if (ps !== null && qp >= 0 && tierOf(ps.pPop[qp], ps.pMembers[qp], ps.pMulti[qp] === 1, ps.worldPop) >= Tier.Kingdom) {
        const x = smoothstep(X.spyLow, X.spyHigh, bill / income)
        if (x > 0) {
          r[LeakChannel.Espionage] = X.espionage * x * (1 - X.protect * pi) * cr
          const cap = ps.pCapital[qp]
          const cost = X.spyCost * bill
          s.wealth[cap] = s.wealth[cap] > cost ? s.wealth[cap] - cost : 0
        }
      }
      // Smuggled seeds or tools: the contraband in its goods reaching the people (polities v2's smuggling; none without states).
      if (sv > 0) secretSmuggled(s, g, k, q, big[q], sv)
      const fit = kind === SecretKind.Species ? fitFor(s, q, g.sSubject[k]) : 1
      r[LeakChannel.Smuggling] = X.smuggling * (sv / (sv + X.smuggleHalf)) * fit * cr
      if (kind === SecretKind.Craft) {
        const c = g.sSubject[k]
        const gate = c === CraftKind.Blades ? WORKSHOP.bladeGate : WORKSHOP.gate[1]
        const inp = c === CraftKind.Dyeing ? murexPeople(s, g, q) : 1
        r[LeakChannel.Rediscovery] = X.rediscovery * smoothstep(gate, gate + 1, tech[q * TECH_FIELD_COUNT + field]) * inp
      }
    } else {
      let war = 0
      if (ps !== null) {
        const qp = polityOf(s, big[q]), hp = polityOf(s, g.legA[g.sSubject[k]])
        if (qp >= 0 && hp >= 0 && atWar(ps, qp, hp)) war = 1
      }
      r[LeakChannel.Chart] = X.chart * (1 - X.chartGuard * g.sPsi[k]) + X.chartWar * war
    }
    let keep = 1
    for (let c = 0; c < 8; c++) keep *= 1 - r[c]
    const Pt = 1 - keep
    const u = rng.next()
    if (!(u < Pt)) continue
    // The channel whose cumulative share holds u / P.
    const target = u / Pt
    let acc = 0, ch = -1, sum = 0
    for (let c = 0; c < 8; c++) sum += r[c]
    for (let c = 0; c < 8; c++) { if (!(r[c] > 0)) continue; acc += r[c] / sum; if (target <= acc) { ch = c; break } }
    if (ch < 0) for (let c = 7; c >= 0; c--) if (r[c] > 0) { ch = c; break }
    const via = big[q]
    // The source: a producer of a holder people q has met (the first holder if it is one of them).
    let hs = know.contact[q * P + h0] >= 0 ? h0 : -1
    for (let h = 0; h < P && hs < 0; h++) if (held[h] && big[h] >= 0 && know.contact[q * P + h] >= 0) hs = h
    if (hs < 0) continue
    let src = big[hs]
    for (let t = 0; t < s.living.length; t++) { const id = s.living[t]; if (s.people[id] === hs && OUTL[t] > 0) { src = id; break } }
    grantHold(s, g, k, q, ch, via, src)
    if (kind === SecretKind.Species && ch === LeakChannel.Smuggling) plantAt(s, q, g.sSubject[k], src)
  }
  for (let vv = 1; vv < g.vCount; vv++) if (g.vSecret[vv] === k) for (let q = 0; q < P; q++) { g.vImp[vv * P + q] = 0; g.vSmug[vv * P + q] = 0 }
}

/** SecretSmuggled (once per secret and people): contraband in secret k's goods worth sv a year reached people q (its largest settlement `at`). */
function secretSmuggled(s: HistoryState, g: GoodsState, k: number, q: number, at: number, sv: number): void {
  const P = g.P
  while (g.smugLogged.length < (k + 1) * P) g.smugLogged.push(0)
  if (g.smugLogged[k * P + q] || !(sv >= SECRET.smuggledMin)) return
  g.smugLogged[k * P + q] = 1
  logGoods(s, EventType.SecretSmuggled, at, g.sFoundAt[k], k, sv)
}
const R = new Float64Array(8)

/** 1 when species x would grow somewhere among people q's settlements (catchment fit at least SPECIES.minFit). */
function fitFor(s: HistoryState, q: number, x: number): number {
  const sp = s.sp
  const N = sp.N
  for (let t = 0; t < s.living.length; t++) { const id = s.living[t]; if (s.people[id] === q && sp.fitCatch[x * N + s.cell[id]] >= SPECIES.minFit) return 1 }
  return 0
}

/** 1 when people q dyes with murex somewhere (its input at hand), else 0. */
function murexPeople(s: HistoryState, g: GoodsState, q: number): number {
  for (let t = 0; t < s.living.length; t++) { const id = s.living[t]; if (s.people[id] === q && murexAt(g, id)) return 1 }
  return 0
}

/** Smuggled seed: the settlement of people q where species x fits best takes it up (from `src`). */
function plantAt(s: HistoryState, q: number, x: number, src: number): void {
  const sp = s.sp
  const N = sp.N
  let best = -1, bf = SPECIES.minFit
  for (let t = 0; t < s.living.length; t++) {
    const id = s.living[t]
    if (s.people[id] !== q) continue
    const f = sp.fitCatch[x * N + s.cell[id]]
    if (f > bf && !hasBit(sp.m0[id], sp.m1[id], itemBit(x))) { bf = f; best = id }
  }
  if (best >= 0) gainItem(s, best, x, src)
}

/**
 * A push at settlement id (Sacked, famine, revolt, emigration to another people: `push`): craftsmen of the secrets it
 * produces may flee to the most prosperous town of another people in contact (defection; a craft's tradition goes with them).
 * Returns the receiving settlement for a craft secret's tradition (-1) via DEFECT.
 */
export function pushAt(s: HistoryState, g: GoodsState, id: number, push: number, carry: (from: number, to: number) => void): void {
  if (id >= g.cap || s.abandoned[id] >= 0) return
  const p = s.people[id]
  const P = g.P
  const rng = g.rng
  for (let k = 0; k < g.sCount; k++) {
    if (g.sLost[k] >= 0 || g.sKind[k] === SecretKind.Chart || !g.sHeld[k][p] || !(outputAt(s, g, k, id) > 0)) continue
    const chance = push * (1 - 0.7 * protectionOf(s, g, k, id))
    if (rng.next() >= chance) continue
    // The most prosperous town of another people in contact, not holding it, within reach.
    let best = -1, bf = -1
    const P3 = s.world.grid.positions
    const c0 = s.cell[id] * 3
    const lim = (1.12 / s.terrain.n) * 40
    const lim2 = lim * lim
    for (let t = 0; t < s.living.length; t++) {
      const j = s.living[t]
      const q = s.people[j]
      if (q === p || g.sHeld[k][q] || s.know.contact[p * P + q] < 0 || s.pop[j] < TOWN_POPULATION / 3) continue
      const c1 = s.cell[j] * 3
      const dx = P3[c0] - P3[c1], dy = P3[c0 + 1] - P3[c1 + 1], dz = P3[c0 + 2] - P3[c1 + 2]
      if (dx * dx + dy * dy + dz * dz > lim2) continue
      const f = prosperity(s, j)
      if (f > bf) { bf = f; best = j }
    }
    if (best < 0) continue
    grantHold(s, g, k, s.people[best], LeakChannel.Defection, best, id)
    if (g.sKind[k] === SecretKind.Craft) carry(id, best)
  }
}

/** Settlement v was conquered from u: the conquerors' people takes the secrets v produced. */
export function conquestAt(s: HistoryState, g: GoodsState, v: number, u: number): void {
  if (u < 0 || v >= g.cap || s.abandoned[v] >= 0) return
  const p = s.people[v], q = s.people[u]
  if (p === q) return
  for (let k = 0; k < g.sCount; k++) {
    if (g.sLost[k] >= 0 || !g.sHeld[k][p] || g.sHeld[k][q]) continue
    if (!(outputAt(s, g, k, v) > 0) && !(g.sKind[k] === SecretKind.Chart && (g.legA[g.sSubject[k]] === v || g.legB[g.sSubject[k]] === v))) continue
    grantHold(s, g, k, q, LeakChannel.Conquest, u, v)
  }
}

/** A people tamed a secret species from the wild (a Domesticated event): an independent origin of the secret. */
export function domesticated(s: HistoryState, g: GoodsState, id: number, x: number): void {
  const k = g.speciesSecret[x]
  if (k < 0) return
  if (g.sFoundAt[k] < 0) { g.sFoundAt[k] = id; g.sFound[k] = s.year }
  grantHold(s, g, k, s.people[id], LeakChannel.Founded, id, -1)
}

void SP
