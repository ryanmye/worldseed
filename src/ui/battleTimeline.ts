// battles: the replay timeline of one battle (battles.md 7.1), pure (no DOM, no THREE), shared by the 2D map and a later 3D replay.
//
// Local frame: the tangent plane at the battle's cell, +x along the attack axis (from the attackers' town toward the town
// struck), units of one cell (~150 km on the globe: a replay is a stylised field, as the UI says). Each side is a line of
// blocks, n = clamp(round(sqrt(men / 150)), 3, 12), widths in proportion to men, at x = -/+ 0.3. Strengths follow the
// Lanchester square law in closed form (battles/lanchester.ts): with rs = sqrt(x') (x' = Battles.ratio),
//   d(tau) = cosh tau - rs sinh tau,   a(tau) = cosh tau - sinh tau / rs
// down to the loser's break (Battles.breakA / breakD), then the rout takes the loser to 1 - its loss share. The phases, in
// seconds at 1x: Deploy 2 -> Advance 3..6 (longer over a ford) -> Clash 8..20 (the battle's hours) -> Flank (if flagged) ->
// Break -> Rout -> End. Jitter is a hash of (battle, block): the same battle gives the same replay.

import { BattleCourse, BattleFlag, BattleKind } from '../contract.ts'
import type { History, World } from '../contract.ts'

export type PhaseKind = 'deploy' | 'advance' | 'clash' | 'flank' | 'break' | 'rout' | 'end'
export interface Phase { kind: PhaseKind; t0: number; t1: number }
export interface Block {
  side: 0 | 1
  /** Lateral slot centre (y) and half-width, in cells; the block's home x. */
  y: number
  half: number
  x0: number
  /** Share of the side's men. */
  share: number
  /** Deterministic jitter in [-1, 1]. */
  j: number
}
export interface Timeline {
  battle: number
  seconds: number
  phases: Phase[]
  blocks: Block[]
  /** Normalised strengths at the break and at the end (1 - loss share), per side. */
  endA: number
  endD: number
  /** tau at the break (the clash phase maps 0..tauBreak). */
  tauBreak: number
  /** 0 the attackers won. */
  winner: number
  flank: boolean
  ford: boolean
  naval: boolean
  siege: boolean
  /** n5: the day (BattleWeather), mud (a longer advance), a frozen river, a winter campaign (History.battles course). */
  weather: number
  mud: boolean
  frozen: boolean
  winter: boolean
  /** Unit vectors of the frame on the globe at the site (x the attack axis, y across, n up), for projecting terrain. */
  ex: [number, number, number]
  ey: [number, number, number]
  origin: [number, number, number]
  /** Distance of one cell on the unit sphere (the frame's unit). */
  cell: number
}

/** A hash in [-1, 1] of (a, b) (no RNG stream: replays draw nothing). */
export function jitter(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return ((h >>> 0) / 4294967295) * 2 - 1
}

/** Strengths (fractions of each side) at clash time tau in [0, tauBreak] for ratio x': [a, d]. */
export function strengthsAt(x: number, tau: number): [number, number] {
  const rs = Math.sqrt(x > 1e-9 ? x : 1e-9)
  const c = Math.cosh(tau), s = Math.sinh(tau)
  const a = c - s / rs, d = c - rs * s
  return [a < 0 ? 0 : a > 1 ? 1 : a, d < 0 ? 0 : d > 1 ? 1 : d]
}

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** The replay of battle b (History.battles row) on world w. */
export function buildTimeline(h: History, w: World, b: number): Timeline {
  const B = h.battles
  const P = w.grid.positions
  const site = B.site[b]
  const kind = B.kind[b], flags = B.flags[b]
  const origin: [number, number, number] = [P[3 * site], P[3 * site + 1], P[3 * site + 2]]
  const n = norm(origin)
  const from = h.settlements[B.from[b]]?.cell ?? site, to = h.settlements[B.target[b]]?.cell ?? site
  let ax: [number, number, number] = [P[3 * to] - P[3 * from], P[3 * to + 1] - P[3 * from + 1], P[3 * to + 2] - P[3 * from + 2]]
  // project onto the tangent plane (fallback: any tangent)
  let dn = ax[0] * n[0] + ax[1] * n[1] + ax[2] * n[2]
  ax = [ax[0] - dn * n[0], ax[1] - dn * n[1], ax[2] - dn * n[2]]
  if (Math.hypot(ax[0], ax[1], ax[2]) < 1e-9) { ax = Math.abs(n[1]) < 0.9 ? [-n[2], 0, n[0]] : [1, 0, 0]; dn = ax[0] * n[0] + ax[2] * n[2]; ax = [ax[0] - dn * n[0], ax[1] - dn * n[1], ax[2] - dn * n[2]] }
  const ex = norm(ax)
  const ey = norm([n[1] * ex[2] - n[2] * ex[1], n[2] * ex[0] - n[0] * ex[2], n[0] * ex[1] - n[1] * ex[0]])
  // cell size: distance to the nearest neighbour
  const { neighborOffsets: off, neighbors: nb } = w.grid
  let cell = Infinity
  for (let k = off[site]; k < off[site + 1]; k++) { const j = nb[k]; const d = Math.hypot(P[3 * j] - origin[0], P[3 * j + 1] - origin[1], P[3 * j + 2] - origin[2]); if (d < cell) cell = d }
  if (!Number.isFinite(cell) || cell <= 0) cell = 0.02
  // blocks
  const blocks: Block[] = []
  const menA = B.menA[b], menD = B.menD[b]
  const naval = kind === BattleKind.Naval
  const per = naval ? 10 : 150
  const total = menA + menD
  for (const side of [0, 1] as const) {
    const men = side === 0 ? menA : menD
    let cnt = Math.round(Math.sqrt(men / per))
    cnt = cnt < 3 ? 3 : cnt > 12 ? 12 : cnt
    const width = 0.35 + 0.5 * (total > 0 ? men / total : 0.5) // the line's half-length, cells
    for (let i = 0; i < cnt; i++) {
      const j = jitter(b * 2 + side, i)
      const y = -width + ((i + 0.5) / cnt) * 2 * width
      blocks.push({ side, y, half: (width / cnt) * 0.8, x0: side === 0 ? -0.32 : 0.32, share: 1 / cnt, j })
    }
  }
  // phases
  const ford = (flags & BattleFlag.Ford) !== 0
  const flank = (flags & BattleFlag.Flank) !== 0
  const hours = B.hours[b]
  const phases: Phase[] = []
  let t = 0
  const push = (kind: PhaseKind, d: number): void => { phases.push({ kind, t0: t, t1: t + d }); t += d }
  push('deploy', 2)
  const course = B.course?.[b] ?? 0
  const mud = (course & BattleCourse.Mud) !== 0, frozen = (course & BattleCourse.Frozen) !== 0
  push('advance', (ford && !frozen ? 6 : kind === BattleKind.Siege ? 4 : 3) + (mud ? 2 : 0))
  const clash = 8 + 12 * Math.min(1, hours / 14)
  push('clash', clash)
  if (flank) push('flank', 3)
  push('break', 2)
  push('rout', 4)
  push('end', 2)
  // strengths: the loser's break and the winner at that moment (closed form), the end shares from the record
  const x = B.ratio[b] > 0 ? B.ratio[b] : 1
  const winner = B.winner[b]
  const bL = winner === 0 ? B.breakD[b] : B.breakA[b]
  const rs = winner === 0 ? Math.sqrt(x) : 1 / Math.sqrt(x)
  // time for the loser to fall to bL: cosh t - rs sinh t = bL  (the earlier root)
  const q = Math.max(0, bL * bL + rs * rs - 1)
  const z = (rs + 1) / (Math.sqrt(q) + bL)
  const tauBreak = z > 1 ? Math.log(z) : 0.05
  const endA = menA > 0 ? 1 - B.lossA[b] / menA : 1
  const endD = menD > 0 ? 1 - B.lossD[b] / menD : 1
  return { battle: b, seconds: t, phases, blocks, endA, endD, tauBreak, winner, flank, ford, naval, siege: kind === BattleKind.Siege, weather: B.weather[b], mud, frozen, winter: (course & BattleCourse.Winter) !== 0, ex, ey, origin, cell }
}

export function phaseAt(tl: Timeline, t: number): Phase {
  for (const p of tl.phases) if (t < p.t1) return p
  return tl.phases[tl.phases.length - 1]
}

/** Fractions of each side still standing at replay time t (seconds): the square law in the clash, the rout after. */
export function sidesAt(h: History, tl: Timeline, t: number): [number, number] {
  const B = h.battles, b = tl.battle
  const x = B.ratio[b] > 0 ? B.ratio[b] : 1
  const clash = tl.phases.find((p) => p.kind === 'clash')!
  if (t <= clash.t0) return [1, 1]
  const brk = tl.phases.find((p) => p.kind === 'break')!
  if (t < brk.t0) {
    const tau = tl.tauBreak * Math.min(1, (t - clash.t0) / (clash.t1 - clash.t0))
    return strengthsAt(x, tau)
  }
  const [aB, dB] = strengthsAt(x, tl.tauBreak)
  const rout = tl.phases.find((p) => p.kind === 'rout')!
  const k = Math.min(1, Math.max(0, (t - brk.t0) / (rout.t1 - brk.t0)))
  const a = aB + (Math.min(aB, tl.endA) - aB) * k, d = dB + (Math.min(dB, tl.endD) - dB) * k
  return [t >= rout.t1 ? tl.endA : a, t >= rout.t1 ? tl.endD : d]
}

export interface BlockPose { x: number; y: number; depth: number; facing: number; alive: number }

/** Where block i stands at time t (cells in the local frame), its depth (strength), facing (+1 toward +x). */
export function blockAt(h: History, tl: Timeline, i: number, t: number, out: BlockPose): BlockPose {
  const bl = tl.blocks[i]
  const [a, d] = sidesAt(h, tl, t)
  const s = bl.side === 0 ? a : d
  const ph = phaseAt(tl, t)
  const loser = tl.winner === 0 ? 1 : 0
  const dir = bl.side === 0 ? 1 : -1
  let x = bl.x0, y = bl.y + 0.02 * bl.j
  const adv = tl.phases[1]
  // the attackers close to contact in the advance; both lines press a little in the clash
  if (bl.side === 0) { const k = Math.min(1, Math.max(0, (t - adv.t0) / (adv.t1 - adv.t0))); x = bl.x0 + 0.24 * k }
  if (ph.kind === 'clash') x += dir * 0.015 * Math.sin(t * 2 + bl.j * 3)
  // flank: the winner's end blocks wheel around the loser's wing
  const wing = tl.blocks.filter((q) => q.side === bl.side)
  const end = wing[0] === bl || wing[wing.length - 1] === bl
  const fl = tl.phases.find((p) => p.kind === 'flank')
  if (fl && bl.side !== loser && end && t >= fl.t0) {
    const k = Math.min(1, (t - fl.t0) / (fl.t1 - fl.t0))
    x += dir * 0.3 * k
    y += (bl.y > 0 ? -1 : 1) * 0.08 * k
  }
  let facing = dir
  const brk = tl.phases.find((p) => p.kind === 'break')!
  if (t >= brk.t0) {
    const k = Math.min(1, (t - brk.t0) / 6)
    if (bl.side === loser) { facing = -dir; x -= dir * (0.6 * k + 0.05 * bl.j * k); y += 0.1 * bl.j * k }
    else x += dir * 0.35 * k
  }
  out.x = x; out.y = y; out.depth = 0.03 + 0.06 * s; out.facing = facing; out.alive = s
  return out
}
