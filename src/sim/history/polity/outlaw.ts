// polities v2: the outlaw economy (design 9.1-9.3, 6.2 blockade): pirate havens and the sea lanes they strike,
// privateers and blockades in war, bandits on roads far from any capital's grip, smugglers' hubs and corruption.
//
// Lanes (map pass, every POLITY.mapStep years): for every route, the coastal settlements within PIRACY.reachHops sea hops
// of its sea cells (its own ends excepted); a settlement's lane traffic is the loads a year of the open routes passing it.
// Pirates (every POLITY.slowStep years) at a coastal settlement h of a seafaring people (Seafaring >= PIRACY.seafaring),
// stateless or weakly held (enforcement <= weakEnf): pi moves PIRACY.rate a year toward
//   pi* = D_h * lane / (lane + laneHalf) * (1 - navy) * (poor ? 1 : 0.5) * (1 + ban * tariff)
//   D_h  the defensibility of its site (islands, headlands, crags; open beaches make no nests)
//   navy = max over its own polity and its neighbours' of naval strength * Proj / (Proj + Local_h)   (ports, Seafaring)
// navy >= suppress burns the nest (pi falls suppressRate a year: PiratesSuppressed); high duties on the lanes breed
// pirates (the haijin and the wokou); a nest that preyed on no lane at the last step (a stronger one nearby took them)
// aims at PIRACY.rival of pi*, so a sea has a few dominant havens. A route passing a haven loses lose * pi of its cargo: its transport costs rise by
// lossCost per unit share (trade.ts, through policy.ts) and the plunder goes to the haven, which grows rich on it; coasts
// within dangerHops sea hops of a haven take danger dangerZ * pi (fading with distance): exposed ports suffer, people
// shun those coasts, sheltered or well-defended ones grow. In war a belligerent with a navy sends privateers against the
// enemy's sea routes, and an attacker with the stronger fleet blockades the enemy's ports (Blockade).
// Bandits: a member's lawlessness is danger.ts's (weak grip in a weak state); a stateless settlement on a state's margin
// has BANDIT.stateless. An overland route costs (1 + cost * the worst lawlessness on it) more; above toll, a tenth of
// its cargo goes to the most lawless place on it (protection money); its road cells take danger roadZ * lawlessness.
// Smugglers' hubs and corruption (every step): see policy.ts for the contraband itself.

import { EventType, TECH_FIELD_COUNT, TechField } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { logEvent } from '../state.ts'
import { prosperity } from '../migration.ts'
import type { TradeState } from '../trade.ts'
import { distTo } from './control.ts'
import { BANDIT, DANGER, PIRACY, POLITY, SMUGGLE, TARIFF, WAYRISK } from './params.ts'
import type { PairPolicy } from './policy.ts'
import { enforcement, navyOf, routeSea, watch } from './policy.ts'
import { FAR, ensureRoutesP, localOf, projAt } from './state.ts'
import type { PolityState } from './state.ts'
import { atWar } from './formation.ts'
import { legLaneMap, legOutlaw } from '../goods/longhaul.ts' // goods: the long-haul legs' sea lanes and roads

/** Years between the market's accounts (duties, contraband, plunder paid out): flushAccounts at the end of each such year's market. */
export const ACCOUNTS = 5

/**
 * The market's accounts since the last flush (trade.ts: at the end of the market every ACCOUNTS years, and before the
 * trade pairs are rebuilt): duties and seizures to the collectors' capitals, the smugglers' cuts to the hubs, plunder to
 * the pirates and bandits; contraband and losses per route (annual means, for the trade snapshots); the polities'
 * smoothed revenue and the stats' sums.
 */
export function flushAccounts(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const pc = ps.policy as PairPolicy | null
  if (pc === null) return
  const years = s.year - ps.flushYear > 0 ? s.year - ps.flushYear : 1
  ps.flushYear = s.year
  const income = ts.income
  const X = SMUGGLE
  for (const r of ps.lossRoutes) { ps.rSmug[r] = 0; ps.rLoss[r] = 0 }
  ps.lossRoutes.length = 0
  let legal = 0, smug = 0, pir = 0, band = 0
  for (let p = 0; p < pc.n; p++) {
    const code = pc.code[p], lv = pc.lossV[p]
    if (code === 0 && !(lv > 0) && !(pc.lost[p] > 0)) continue // (pc.lost: 0 with WAYRISK off)
    let sm = pc.smug[p]
    if (code !== 0 && pc.block[p] === 0) {
      // (goods: contraband evading a secret's monopoly rent was summed as it moved, with the hubs' cuts)
      const rent = s.goods !== null
      if (rent && sm > 0) smug += sm
      // A duty pair: a share sigma of what crossed evaded the duty as contraband; a share seize * enforcement of that was
      // caught (its worth to the collector: the goods are not taken out of the market), the rest paid the hub's cut.
      for (let dir = 0; dir < 2; dir++) {
        const v = dir === 0 ? pc.vAB[p] : pc.vBA[p]
        if (!(v > 0)) continue
        const sig = dir === 0 ? pc.sAB[p] : pc.sBA[p], e = dir === 0 ? pc.eAB[p] : pc.eBA[p]
        const rate = dir === 0 ? pc.dAB[p] : pc.dBA[p]
        const pv = dir === 0 ? pc.pvAB[p] : pc.pvBA[p], db = dir === 0 ? pc.dbAB[p] : pc.dbBA[p], nb = dir === 0 ? pc.nbAB[p] : pc.nbBA[p]
        const caught = X.seize * e
        const rev = rate * (1 - sig) * db + caught * sig * pv
        const c = dir === 0 ? pc.cAB[p] : pc.cBA[p], q = dir === 0 ? pc.qAB[p] : pc.qBA[p]
        if (rev > 0) { if (c >= 0 && s.abandoned[c] < 0) income[c] += rev; if (q >= 0) ps.pRevYear[q] += rev }
        const x = sig * (1 - caught) * v
        sm += x
        smug += x
        legal += (1 - sig) * v
        const k = X.hubCut * (1 - caught) * sig * nb
        if (k > 0) cut(s, ps, dir === 0 ? pc.hAB[p] : pc.hBA[p], k, k, dir === 0 ? pc.gAB[p] : pc.gBA[p], q, income)
        if (dir === 0) { pc.vAB[p] = 0; pc.pvAB[p] = 0; pc.dbAB[p] = 0; pc.nbAB[p] = 0; pc.bestAB[p] = 0 }
        else { pc.vBA[p] = 0; pc.pvBA[p] = 0; pc.dbBA[p] = 0; pc.nbBA[p] = 0; pc.bestBA[p] = 0 }
      }
      // (goods: the hubs' cuts of the rent evaded; without goods a cut left from an embargo waits for the next one, as before)
      if (rent) {
        let x = pc.cutAB[p]
        if (x > 0) { cut(s, ps, pc.hAB[p], x, x, pc.gAB[p], pc.qAB[p], income); pc.cutAB[p] = 0 }
        x = pc.cutBA[p]
        if (x > 0) { cut(s, ps, pc.hBA[p], x, x, pc.gBA[p], pc.qBA[p], income); pc.cutBA[p] = 0 }
      }
    } else if (code !== 0) {
      // An embargo or a war: the seizures and the cuts were summed as the contraband moved.
      smug += sm
      legal += pc.legal[p]
      pc.legal[p] = 0
      let x = pc.revAB[p]
      if (x > 0) { const c = pc.cAB[p], q = pc.qAB[p]; if (c >= 0 && s.abandoned[c] < 0) income[c] += x; if (q >= 0) ps.pRevYear[q] += x; pc.revAB[p] = 0 }
      x = pc.revBA[p]
      if (x > 0) { const c = pc.cBA[p], q = pc.qBA[p]; if (c >= 0 && s.abandoned[c] < 0) income[c] += x; if (q >= 0) ps.pRevYear[q] += x; pc.revBA[p] = 0 }
      x = pc.cutAB[p]
      if (x > 0) { cut(s, ps, pc.hAB[p], x, pc.bestAB[p], pc.gAB[p], pc.qAB[p], income); pc.cutAB[p] = 0; pc.bestAB[p] = 0 }
      x = pc.cutBA[p]
      if (x > 0) { cut(s, ps, pc.hBA[p], x, pc.bestBA[p], pc.gBA[p], pc.qBA[p], income); pc.cutBA[p] = 0; pc.bestBA[p] = 0 }
    }
    pc.smug[p] = 0
    // Plunder: pirates and privateers take theirs, bandits their tolls.
    if (lv > 0) {
      const to = pc.lossTo[p]
      if (to >= 0 && s.abandoned[to] < 0) income[to] += lv
      const r0 = pc.route[p]
      const b = r0 >= 0 && r0 < ps.rBand.length && ps.rBand[r0] >= BANDIT.toll && pc.loss[p] > 0 ? (BANDIT.tollShare / pc.loss[p]) * lv : 0
      band += b
      pir += lv - b
      pc.lossV[p] = 0
    }
    const r = pc.route[p]
    const lostP = WAYRISK.on ? pc.lost[p] : pc.loss[p]
    if (r < 0 || (!(sm > 0) && !(lostP > 0))) continue
    ensureRoutesP(ps, r + 1)
    if (ps.rLoss[r] === 0 && ps.rSmug[r] === 0) ps.lossRoutes.push(r)
    ps.rSmug[r] = sm / years
    ps.rLoss[r] = lostP // (pirates', privateers', a blockade's and bandits' share, and the danger on the way: WAYRISK.loss)
  }
  // Revenue smoothed (per year), and the stats' sums over the years since the last flush.
  const k = 1 - Math.pow(1 - TARIFF.smooth, years)
  let rev = 0, inc = 0
  for (const p of ps.alive) {
    ps.pRevSm[p] += k * (ps.pRevYear[p] / years - ps.pRevSm[p]); ps.pRevYear[p] = 0
    rev += ps.pRevSm[p]
    const c = ps.pCapital[p]
    if (c < ps.seen) inc += ps.incSm[c]
  }
  // (goods: the long-haul legs' duties, contraband and plunder, paid as they moved)
  const la = ps.legAcc
  if (la[0] > 0 || la[1] > 0 || la[2] > 0 || la[3] > 0) { legal += la[0]; smug += la[1]; pir += la[2]; band += la[3]; la.fill(0) }
  const d = ps.diag
  d.yRev[s.year] = rev * years; d.yCapInc[s.year] = inc * years
  d.yLegal[s.year] = legal; d.ySmug[s.year] = smug; d.yPir[s.year] = pir; d.yBand[s.year] = band
}

/** The smugglers' cut x reaches hub h (best: the largest single cut, of good g, evading polity q). */
export function cut(s: HistoryState, ps: PolityState, h: number, x: number, best: number, g: number, q: number, income: Float64Array): void {
  if (s.abandoned[h] >= 0) return
  income[h] += x
  if (h >= ps.seen) return
  ps.smugYear[h] += x
  if (ps.watch[h] === 0) watch(ps, h)
  if (best > ps.hubBest[h]) { ps.hubBest[h] = best; ps.hubGood[h] = g; ps.hubPol[h] = q }
}

/** Static: per sea cell, the coastal land cells within PIRACY.reachHops sea hops (CSR). */
function buildSeaNear(s: HistoryState, ps: PolityState): void {
  const T = s.terrain
  const N = T.cellCount
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const H = PIRACY.reachHops
  const pairS: number[] = [], pairC: number[] = []
  const mark = new Int32Array(N).fill(-1)
  const ring: number[] = [], next: number[] = []
  for (let c = 0; c < N; c++) {
    if (!T.seaCoast[c]) continue
    ring.length = 0
    for (let k = off[c]; k < off[c + 1]; k++) { const j = nb[k]; if (T.sea[j] && mark[j] !== c) { mark[j] = c; ring.push(j); pairS.push(j); pairC.push(c) } }
    for (let h = 1; h < H; h++) {
      next.length = 0
      for (const i of ring) for (let k = off[i]; k < off[i + 1]; k++) { const j = nb[k]; if (T.sea[j] && mark[j] !== c) { mark[j] = c; next.push(j); pairS.push(j); pairC.push(c) } }
      ring.length = 0
      for (const j of next) ring.push(j)
    }
  }
  const so = new Int32Array(N + 1)
  for (const j of pairS) so[j + 1]++
  for (let j = 0; j < N; j++) so[j + 1] += so[j]
  const fill = so.slice(0, N)
  const sc = new Int32Array(pairS.length)
  for (let k = 0; k < pairS.length; k++) sc[fill[pairS[k]]++] = pairC[k]
  ps.seaNearOff = so
  ps.seaNearCell = sc
}

const NEAR_MAX = 24

/** Map pass: coastal settlements near each route's sea cells, and every settlement's lane traffic. */
export function laneMap(s: HistoryState, ps: PolityState, ts: TradeState): void {
  if (ps.seaNearOff === null) buildSeaNear(s, ps)
  const so = ps.seaNearOff as Int32Array, sc = ps.seaNearCell as Int32Array
  const R = ts.routeCount
  ensureRoutesP(ps, R + 1)
  const sea = s.terrain.sea
  const { lane, stamp } = ps
  const living = s.living
  for (let t = 0; t < living.length; t++) lane[living[t]] = 0
  const off = new Int32Array(R + 1)
  const ids: number[] = []
  for (let r = 0; r < R; r++) {
    off[r] = ids.length
    if (!ts.rOpen[r] || routeSea(s, ps, ts, r) === 0) continue
    const a = ts.rA[r], b = ts.rB[r]
    const run = ++ps.run
    const path = ts.rPath[r]
    const start = ids.length
    let alt = 0
    for (let k = 0; k < path.length && ids.length - start < NEAR_MAX; k++) {
      const j = path[k]
      if (!sea[j] || (alt++ & 1) === 1) continue // (every other sea cell: the reach covers the gaps)
      for (let e = so[j]; e < so[j + 1]; e++) {
        const h = s.occupant[sc[e]]
        if (h < 0 || h === a || h === b || h >= ps.seen || stamp[h] === run || s.outpost[h]) continue
        stamp[h] = run
        ids.push(h)
      }
    }
    const v = ts.rVol[r]
    for (let k = start; k < ids.length; k++) lane[ids[k]] += v
  }
  off[R] = ids.length
  ps.nearRoutes = R
  ps.nearOff = off
  ps.nearId = Int32Array.from(ids)
  if (s.goods !== null) legLaneMap(s, ps, s.goods) // goods: the long-haul legs' traffic draws pirates too
}

/** System part (every slow step): pirates rise and fall; routes' losses to pirates and bandits; outlaw danger on coasts and roads. */
export function outlawStep(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const X = PIRACY
  const step = X.step
  const living = s.living
  const T = s.terrain
  const { pir, lane, polity, gNb } = ps
  const seen: number[] = []
  let pirates = 0
  for (let t = 0; t < living.length; t++) {
    const h = living[t]
    if (!(lane[h] > 0) && !(pir[h] > 0)) continue
    if (!T.seaCoast[s.cell[h]]) { pir[h] = 0; continue }
    const p = polity[h]
    const seaf = s.tech[s.people[h] * TECH_FIELD_COUNT + TechField.Seafaring]
    if (!(pir[h] > 0) && (seaf < X.seafaring || ps.defenseD[s.cell[h]] === 0)) continue // (no nest can rise here)
    const enf = p >= 0 ? enforcement(s, ps, h, p) : 0
    if (!(pir[h] > 0) && enf > X.weakEnf) continue
    // Navies that can reach it: its own polity's and its neighbours'.
    seen.length = 0
    if (p >= 0) seen.push(p)
    const nb = gNb[h]
    if (nb) for (let k = 0; k < nb.length; k++) { const q = polity[nb[k]]; if (q >= 0 && s.abandoned[nb[k]] < 0 && seen.indexOf(q) < 0) seen.push(q) }
    let navy = 0, by = -1, tau = 0
    const loc = localOf(s, ps, h)
    for (const q of seen) {
      if (ps.pTariff[q] > tau) tau = ps.pTariff[q]
      const n = navyOf(s, ps, q)
      if (!(n > 0)) continue
      const d = q === p ? ps.dist[h] : distTo(ps, q, h, s.abandoned)
      if (!(d < FAR)) continue
      const pr = projAt(ps, q, d)
      const v = (n * pr) / (pr + loc + 1e-9)
      if (v > navy) { navy = v; by = ps.pCapital[q] }
    }
    let x = pir[h]
    let target = 0
    if (seaf >= X.seafaring && enf <= X.weakEnf) {
      const l = lane[h]
      const poor = s.food[h] < X.poorFood || prosperity(s, h) < X.poorWealth ? 1 : X.rich
      target = ps.defenseD[s.cell[h]] * (l / (l + X.laneHalf)) * (1 - navy) * poor * (1 + X.ban * tau)
      if (ps.taker[h] === 0) target *= X.rival // (a nest that took no lane last time, outdone by a stronger one nearby)
      if (target > 1) target = 1
    } // (else a state took hold, or the sailors are gone: the nest withers)
    x += (step * X.rate < 1 ? step * X.rate : 1) * (target - x)
    if (navy >= X.suppress) x -= step * X.suppressRate
    x = x < 0.001 ? 0 : x > 1 ? 1 : x
    pir[h] = x
    pirates += x
    if (x >= X.rise && !ps.pirRose[h]) {
      ps.pirRose[h] = 1
      logEvent(s, EventType.PiratesRise, h, -1, busiestLane(ps, ts, h))
    } else if (ps.pirRose[h] && x < X.suppressed) {
      ps.pirRose[h] = 0
      if (navy >= X.suppress && by >= 0) logEvent(s, EventType.PiratesSuppressed, h, by, -1)
    }
  }
  ps.diag.yPirates[s.year] = pirates
  // (the havens, for the snapshots)
  ps.havens.length = 0
  for (let t = 0; t < living.length; t++) if (pir[living[t]] > 0) ps.havens.push(living[t])
  // Routes: the worst haven near each (privateering: double against an enemy at war), and bandits on overland routes.
  const R = ts.routeCount
  ensureRoutesP(ps, R + 1)
  const { nearOff, nearId, lawless } = ps
  for (const r of ps.outRoutes) { const h = ps.rPirBy[r]; if (h >= 0) ps.taker[h] = 0; ps.rPir[r] = 0; ps.rPirBy[r] = -1; ps.rBand[r] = 0; ps.rBandBy[r] = -1 }
  ps.outRoutes.length = 0
  for (const r of ts.openList) {
    const a = ts.rA[r], b = ts.rB[r]
    ps.outRoutes.push(r)
    if (r < ps.nearRoutes) {
      let best = 0, bh = -1
      for (let k = nearOff[r]; k < nearOff[r + 1]; k++) {
        const h = nearId[k]
        if (!(pir[h] > 0) || s.abandoned[h] >= 0) continue
        let v = X.lose * pir[h]
        const ph = polity[h]
        if (ph >= 0 && (atWar(ps, ph, polity[a]) || atWar(ps, ph, polity[b]))) v *= 2
        if (v > best) { best = v; bh = h }
      }
      ps.rPir[r] = best > 0.5 ? 0.5 : best
      ps.rPirBy[r] = bh
      if (bh >= 0) ps.taker[bh] = 1
    }
    const path = ts.rPath[r]
    if (path.length - routeSea(s, ps, ts, r) < 3) continue
    let band = lawless[a], bb = a
    if (lawless[b] > band) { band = lawless[b]; bb = b }
    const tr = ts.rTransit[r]
    for (let k = 0; k < tr.length; k++) { const x = tr[k]; if (x < ps.seen && s.abandoned[x] < 0 && lawless[x] > band) { band = lawless[x]; bb = x } }
    ps.rBand[r] = band
    ps.rBandBy[r] = band > 0 ? bb : -1
  }
  if (s.goods !== null) legOutlaw(s, ps, s.goods) // goods: pirates on the long-haul legs' sea lanes, bandits on their roads
  outlawCells(s, ps, ts)
}

/** Route id of the busiest open lane near haven h (-1). */
function busiestLane(ps: PolityState, ts: TradeState, h: number): number {
  let best = -1, bv = 0
  for (let r = 0; r < ps.nearRoutes; r++) {
    if (!ts.rOpen[r]) continue
    for (let k = ps.nearOff[r]; k < ps.nearOff[r + 1]; k++) if (ps.nearId[k] === h && ts.rVol[r] > bv) { bv = ts.rVol[r]; best = r }
  }
  return best
}

/** Outlaw danger per cell: pirates on the coasts near havens, bandits on the roads of lawless routes. */
function outlawCells(s: HistoryState, ps: PolityState, ts: TradeState): void {
  const X = PIRACY
  const { cellOut, outCells } = ps
  for (const c of outCells) { cellOut[c] = 0; if (ps.tOwner[c] < 0) ps.cellZ[c] = DANGER.wild } // (fringe cells are rewritten every step)
  outCells.length = 0
  const T = s.terrain
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const set = (c: number, z: number): void => {
    if (!(z > cellOut[c])) return
    if (cellOut[c] === 0) outCells.push(c)
    cellOut[c] = z
  }
  const living = s.living
  const H = X.dangerHops
  const mark = ps.aStamp, ring: number[] = [], next: number[] = []
  // Coastal settlements within reach of a haven: the worst haven's danger there and the haven (coastal raids).
  const { exId, exZ, exBy } = ps
  for (const id of exId) ps.exMark[id] = -1
  exId.length = 0; exZ.length = 0; exBy.length = 0
  const expose = (o: number, z: number, h: number): void => {
    if (o >= ps.seen) return
    const k = ps.exMark[o]
    if (k < 0) { ps.exMark[o] = exId.length; exId.push(o); exZ.push(z); exBy.push(h) }
    else if (z > exZ[k]) { exZ[k] = z; exBy[k] = h }
  }
  const occupant = s.occupant
  // (and the pirates' reach over the sea cells, for the merchants' risk: policy.ts wayRisk)
  const { seaZ, seaZCells } = ps
  for (const c of seaZCells) seaZ[c] = 0
  seaZCells.length = 0
  for (let t = 0; t < living.length; t++) {
    const h = living[t]
    const x = ps.pir[h]
    if (!(x > 0.05)) continue
    const run = ++ps.aRun
    const c0 = s.cell[h]
    ring.length = 0
    mark[c0] = run
    for (let k = off[c0]; k < off[c0 + 1]; k++) { const j = nb[k]; if (T.sea[j]) { mark[j] = run; ring.push(j) } }
    for (let hop = 1; hop <= H && ring.length > 0; hop++) {
      const z = X.dangerZ * x * (1 - (hop - 1) / H)
      next.length = 0
      for (const i of ring) {
        if (z > seaZ[i]) { if (seaZ[i] === 0) seaZCells.push(i); seaZ[i] = z }
        for (let k = off[i]; k < off[i + 1]; k++) {
          const j = nb[k]
          if (mark[j] === run) continue
          mark[j] = run
          if (T.sea[j]) next.push(j)
          else { set(j, z); const o = occupant[j]; if (o >= 0 && o !== h) expose(o, z, h) }
        }
      }
      ring.length = 0
      for (const j of next) ring.push(j)
    }
    set(c0, X.dangerZ * x)
  }
  // Bandit roads.
  const sea = T.sea
  void sea
  for (const r of ts.openList) {
    if (r >= ps.rBand.length) continue
    const band = ps.rBand[r]
    if (band < BANDIT.toll) continue
    const z = BANDIT.roadZ * band
    const path = ts.rPath[r]
    for (let k = 1; k + 1 < path.length; k++) if (!T.sea[path[k]]) set(path[k], z)
  }
  // (the unowned ones, for cellDanger every step: territory is redrawn in the same years, before this)
  ps.outFree.length = 0
  for (const c of outCells) if (ps.tOwner[c] < 0) ps.outFree.push(c)
}

/**
 * System part (every step): pirates raid the coasts within their reach: each exposed settlement loses raidWealth * z of
 * its wealth a year and raidPop * z of its people (captives), and the haven gains both.
 */
export function coastRaids(s: HistoryState, ps: PolityState): void {
  const X = PIRACY
  const step = POLITY.step
  const { exId, exZ, exBy } = ps
  for (let k = 0; k < exId.length; k++) {
    const o = exId[k], h = exBy[k]
    if (s.abandoned[o] >= 0 || s.abandoned[h] >= 0) continue
    const z = exZ[k]
    const w = step * X.raidWealth * z * s.wealth[o]
    s.wealth[o] -= w
    s.wealth[h] += w
    if (s.pop[o] < X.raidMinPop) continue
    const p = step * X.raidPop * z * s.pop[o]
    s.pop[o] -= p
    s.pop[h] += p
    ps.diag.pirCaptives += p
  }
}

/** System part (every slow step): smugglers' hubs (SmugglingRing, once per settlement) and corruption where contraband pays. */
export function hubStep(s: HistoryState, ps: PolityState): void {
  const X = SMUGGLE
  const k = POLITY.slowStep * X.corruptRate
  const living = s.living
  const { incSm, smugSm, corrupt } = ps
  for (let t = 0; t < living.length; t++) {
    const id = living[t]
    const sm = smugSm[id]
    if (!(sm > 0) && !(corrupt[id] > 0)) continue
    const share = sm / (incSm[id] + 1)
    const sh = share > 1 ? 1 : share
    const c = corrupt[id] + k * ((ps.polity[id] >= 0 ? sh : 0) - corrupt[id])
    corrupt[id] = c < 0.001 ? 0 : c
    if (!ps.ringDone[id] && sh >= X.ringShare && sm >= X.ringMin) {
      ps.ringDone[id] = 1
      const q = ps.hubPol[id]
      logEvent(s, EventType.SmugglingRing, id, q >= 0 && ps.pEnded[q] < 0 ? ps.pCapital[q] : -1, ps.hubGood[id])
    }
  }
}

/** Yearly in a war (campaigns): an attacker with the stronger fleet blockades the defender's ports (logged once per war). */
export function blockade(s: HistoryState, ps: PolityState, w: number, p: number, q: number): void {
  if (ps.pBlockade[q] === w || ps.pPorts[q] === 0 || navyOf(s, ps, p) <= 0) return
  const sp = s.tech[ps.pPeople[p] * TECH_FIELD_COUNT + TechField.Seafaring], sq = s.tech[ps.pPeople[q] * TECH_FIELD_COUNT + TechField.Seafaring]
  if (sp < sq) return
  // The enemy's main port.
  let port = -1
  const living = s.living
  for (let t = 0; t < living.length; t++) { const id = living[t]; if (ps.polity[id] === q && s.port[id] >= 0 && (port < 0 || s.pop[id] > s.pop[port])) port = id }
  if (port < 0) return
  ps.pBlockade[q] = w
  logEvent(s, EventType.Blockade, port, ps.pCapital[p], w)
}
