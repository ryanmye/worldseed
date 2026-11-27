// society: snapshots during the run and the History tables at assembly (society-secular-cycles.md §2.9). Empty when off.

import type { PolityState } from '../polity/state.ts'
import type { SocietyState } from './state.ts'
import { SOC_SN } from './state.ts'

function growU(a: Uint8Array<ArrayBuffer>, need: number): Uint8Array<ArrayBuffer> {
  if (need <= a.length) return a
  let n = a.length
  while (n < need) n *= 2
  const b = new Uint8Array(n); b.set(a); return b
}
const byte = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0)

/** Snapshot hook (with polSnapshot): wages, rent, Ψ and its factors, shares, coercion and phase per polity. */
export function socSnapshot(ps: PolityState, soc: SocietyState): void {
  const P = ps.P
  const o = soc.snUsed
  for (const k of SOC_SN) soc[k] = growU(soc[k], o + P)
  for (let p = 0; p < P; p++) {
    const live = ps.pEnded[p] < 0 && p < soc.pcap && soc.init[p] === 1
    const j = o + p
    if (!live) {
      for (const k of SOC_SN) soc[k][j] = 0
      soc.snPhase[j] = 255
      continue
    }
    soc.snW[j] = byte(soc.w[p] / 4); soc.snWU[j] = byte(soc.wU[p] / 4); soc.snRent[j] = byte(soc.rent[p] / 4)
    soc.snPsi[j] = byte(soc.psi[p] / 8); soc.snMMP[j] = byte(soc.mmp[p] / 8); soc.snEMP[j] = byte(soc.emp[p] / 8); soc.snSFD[j] = byte(soc.sfd[p] / 8)
    soc.snEps[j] = byte(soc.eps[p] / 0.128); soc.snUrb[j] = byte(soc.urb[p]); soc.snCler[j] = byte(soc.cler[p] / 0.032); soc.snKappa[j] = byte(soc.kappa[p])
    soc.snPhase[j] = soc.phase[p]
  }
  soc.snOff.push(o); soc.snN.push(P); soc.snUsed += P
}

export interface SocietyHistory {
  socWage: Uint8Array
  socUrbanWage: Uint8Array
  socRent: Uint8Array
  socPsi: Uint8Array
  socMMP: Uint8Array
  socEMP: Uint8Array
  socSFD: Uint8Array
  socElite: Uint8Array
  socUrban: Uint8Array
  socClergy: Uint8Array
  socCoercion: Uint8Array
  socPhase: Uint8Array
}

/** History keys of the society tables (in SOC_SN order): for laterFields and the worker's transfer list. */
export const SOC_KEYS = ['socWage', 'socUrbanWage', 'socRent', 'socPsi', 'socMMP', 'socEMP', 'socSFD', 'socElite', 'socUrban', 'socClergy', 'socCoercion', 'socPhase'] as const

export function emptySocietyHistory(): SocietyHistory {
  const o: Record<string, Uint8Array> = {}
  for (const k of SOC_KEYS) o[k] = new Uint8Array(0)
  return o as unknown as SocietyHistory
}

/** The tables as of now (snapshotCount snapshots of P polities); 255 phase outside the polity's life. */
export function assembleSociety(soc: SocietyState, P: number, snapshotCount: number): SocietyHistory {
  const o: Record<string, Uint8Array> = {}
  for (let k = 0; k < SOC_KEYS.length; k++) {
    const src = soc[SOC_SN[k]]
    const a = new Uint8Array(snapshotCount * P)
    if (SOC_KEYS[k] === 'socPhase') a.fill(255)
    for (let q = 0; q < snapshotCount && q < soc.snOff.length; q++) a.set(src.subarray(soc.snOff[q], soc.snOff[q] + soc.snN[q]), q * P)
    o[SOC_KEYS[k]] = a
  }
  return o as unknown as SocietyHistory
}
