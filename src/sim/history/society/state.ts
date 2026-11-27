// society: the state of classes, elites and the secular cycle (society-secular-cycles.md §2.2). Per-polity arrays grow by
// doubling with ps.P (ensureSocPolities). No RNG stream: every rule is deterministic, and every stochastic effect rides an
// existing single draw (§3.2; the name 'history-society' stays reserved). HistoryState.soc is null when HistoryOptions.society is off.

import { SOC } from './params.ts'
import type { PolAggs } from '../polity/aggregates.ts'
import { createAggs } from '../polity/aggregates.ts'

export interface SocietyDiag {
  /** Events logged by kind (240-246: SocialPhase crisis, SocialPhase expansion, LabourDear, SerfdomImposed, SerfdomEnded, EliteFactions, Ennobled, EliteThinned). */
  crises: number
  expansions: number
  dear: number
  serfOn: number
  serfOff: number
  factions: number
  ennobled: number
  thinned: number
  /** Weighted instability counted, and the elite share removed by thinning (Σ Δε over polities). */
  inst: number
  thinTotal: number
  /** Per polity-step (polities alive >= 1 step): year, polity, Ψ, ε, w, phase (flat 6-tuples, for the harness). */
  steps: number[]
}

/** Per-polity Float64 fields (grown together). */
export const SOC_F64 = [
  'kBar', 'L', 'urb', 'trade', 'eps', 'kappa', 'cler', 'tau', 'w', 'wU', 'rent', 'o', 'chat', 'mmp', 'emp', 'sfd', 'psi', 'm', 'urbP',
  'wSm', 'dis', 'mem', 'scar', 'lam', 'pi', 'won', 'instY', 'ePeak', 'mobAcc',
] as const
/** Per-polity Int32 fields. */
export const SOC_I32 = ['ePeakYear', 'phaseSince', 'lastDear', 'lastNoble', 'initYear', 'epiAt', 'epiYear'] as const
/** Per-polity Uint8 fields. */
export const SOC_U8 = ['phase', 'serf', 'fact', 'init'] as const

type F64Key = (typeof SOC_F64)[number]
type I32Key = (typeof SOC_I32)[number]
type U8Key = (typeof SOC_U8)[number]

export type SocietyState = { [K in F64Key]: Float64Array } & { [K in I32Key]: Int32Array } & { [K in U8Key]: Uint8Array } & {
  pcap: number
  /** Ring length (SOC.ring) and its head (the slot of this step); ring[p * RING + k] population, oRing overproduction o. */
  RING: number
  ringAt: number
  ring: Float64Array
  oRing: Float64Array
  /** Event log position of the yearly scan. */
  evSeen: number
  /** Member aggregates (polity/aggregates.ts), one pass a step. */
  agg: PolAggs
  // --- snapshots: ragged per polity like finance (row-major S · P at assembly) ---
  snW: Uint8Array<ArrayBuffer>; snWU: Uint8Array<ArrayBuffer>; snRent: Uint8Array<ArrayBuffer>; snPsi: Uint8Array<ArrayBuffer>
  snMMP: Uint8Array<ArrayBuffer>; snEMP: Uint8Array<ArrayBuffer>; snSFD: Uint8Array<ArrayBuffer>; snEps: Uint8Array<ArrayBuffer>
  snUrb: Uint8Array<ArrayBuffer>; snCler: Uint8Array<ArrayBuffer>; snKappa: Uint8Array<ArrayBuffer>; snPhase: Uint8Array<ArrayBuffer>
  snOff: number[]; snN: number[]; snUsed: number
  diag: SocietyDiag
}

/** The snapshot byte fields (in History order: socWage … socPhase). */
export const SOC_SN = ['snW', 'snWU', 'snRent', 'snPsi', 'snMMP', 'snEMP', 'snSFD', 'snEps', 'snUrb', 'snCler', 'snKappa', 'snPhase'] as const

export function createSociety(): SocietyState {
  const n = 64
  const R = SOC.ring
  const o: Record<string, unknown> = {
    pcap: n, RING: R, ringAt: 0, ring: new Float64Array(n * R), oRing: new Float64Array(n * R), evSeen: 0,
    agg: createAggs(),
    snOff: [], snN: [], snUsed: 0,
    diag: { crises: 0, expansions: 0, dear: 0, serfOn: 0, serfOff: 0, factions: 0, ennobled: 0, thinned: 0, inst: 0, thinTotal: 0, steps: [] },
  }
  for (const k of SOC_F64) o[k] = new Float64Array(n)
  for (const k of SOC_I32) o[k] = new Int32Array(n).fill(-1000000)
  for (const k of SOC_U8) o[k] = new Uint8Array(n)
  for (const k of SOC_SN) o[k] = new Uint8Array(1024)
  return o as unknown as SocietyState
}

function grow<T extends Float64Array | Int32Array | Uint8Array>(a: T, size: number, fill = 0): T {
  const b = new (a.constructor as { new (n: number): T })(size)
  if (fill !== 0) b.fill(fill)
  b.set(a)
  return b
}

/** Grows the per-polity arrays to hold `need` polities. */
export function ensureSocPolities(soc: SocietyState, need: number): void {
  if (need <= soc.pcap) return
  let n = soc.pcap
  while (n < need) n *= 2
  const o = soc as unknown as Record<string, Float64Array | Int32Array | Uint8Array>
  for (const k of SOC_F64) o[k] = grow(o[k] as Float64Array, n)
  for (const k of SOC_I32) o[k] = grow(o[k] as Int32Array, n, -1000000)
  for (const k of SOC_U8) o[k] = grow(o[k] as Uint8Array, n)
  soc.ring = grow(soc.ring, n * soc.RING)
  soc.oRing = grow(soc.oRing, n * soc.RING)
  soc.pcap = n
}
