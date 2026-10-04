// polities: snapshots of membership, territory and danger during the run, and the contract tables
// (History.polities, polity, landCells, territory, danger, wars, raids) copied out at assembly.
// Everything is ragged while the run goes on and copied into arrays of their own, so a History owns
// its buffers and a longer run reproduces a shorter one exactly (raids are summarised only for
// complete decades, so that the last, partial one never differs).

import type { Polity, PolityEnd, PolityOrigin, PolityQualifier, RaidSummary, World, Wars } from '../../../contract.ts'
import { mix32, seedToU32 } from '../../rng.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { namePolities } from '../../names/polityNames.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from './state.ts'
import { fillCellDanger } from './territory.ts'

export interface PolitySnaps {
  pol: Int16Array<ArrayBuffer>
  used: number
  off: number[]
  count: number[]
  terr: Uint16Array<ArrayBuffer>
  dang: Uint8Array<ArrayBuffer>
  landCount: number
}

export function createSnaps(ps: PolityState): PolitySnaps {
  const L = ps.landCells.length
  return { pol: new Int16Array(4096), used: 0, off: [], count: [], terr: new Uint16Array(16 * L), dang: new Uint8Array(16 * L), landCount: 0 }
}

function growI16(a: Int16Array<ArrayBuffer>, need: number): Int16Array<ArrayBuffer> {
  if (need <= a.length) return a
  let size = a.length
  while (size < need) size *= 2
  const b = new Int16Array(size)
  b.set(a)
  return b
}

/** Snapshot of membership (expedition bases take their parent's polity). */
export function polSnapshot(s: HistoryState, ps: PolityState, sn: PolitySnaps): void {
  const n = s.count
  sn.pol = growI16(sn.pol, sn.used + n)
  const o = sn.used
  for (let id = 0; id < n; id++) {
    let p = -1
    if (s.abandoned[id] < 0) {
      if (s.outpost[id]) { const par = s.parent[id]; if (par < ps.seen && s.abandoned[par] < 0) p = ps.polity[par] }
      else if (id < ps.seen) p = ps.polity[id]
    }
    sn.pol[o + id] = p
  }
  sn.off.push(o)
  sn.count.push(n)
  sn.used += n
}

/** Land snapshot of territory owners and cell danger over the land cells. */
export function polLandSnapshot(s: HistoryState, ps: PolityState, sn: PolitySnaps): void {
  fillCellDanger(s, ps)
  const L = ps.landCells.length
  const need = (sn.landCount + 1) * L
  if (need > sn.terr.length) {
    let size = sn.terr.length
    while (size < need) size *= 2
    const t = new Uint16Array(size); t.set(sn.terr); sn.terr = t
    const d = new Uint8Array(size); d.set(sn.dang); sn.dang = d
  }
  const o = sn.landCount * L
  const cells = ps.landCells
  for (let k = 0; k < L; k++) {
    const c = cells[k]
    const w = ps.tOwner[c]
    sn.terr[o + k] = w >= 0 && w < 65535 && s.abandoned[w] < 0 ? w + 1 : 0
    sn.dang[o + k] = (ps.cellZ[c] * 255 + 0.5) | 0
  }
  sn.landCount++
}

export interface PolityHistory {
  polities: Polity[]
  polity: Int16Array
  landCells: Uint32Array
  territory: Uint16Array
  danger: Uint8Array
  wars: Wars
  raids: RaidSummary
}

export function emptyPolityHistory(): PolityHistory {
  return {
    polities: [], polity: new Int16Array(0), landCells: new Uint32Array(0), territory: new Uint16Array(0), danger: new Uint8Array(0),
    wars: { count: 0, kind: new Uint8Array(0), attacker: new Int16Array(0), defender: new Int16Array(0), startYear: new Int16Array(0), endYear: new Int16Array(0), outcome: new Uint8Array(0), taken: new Uint16Array(0), dead: new Float32Array(0) },
    raids: { count: 0, decade: new Int16Array(0), settlement: new Int32Array(0), raids: new Uint16Array(0), wealth: new Float32Array(0) },
  }
}

/** Stable hue of polity id: a hash of the world seed and id, near the parent's hue for a successor. */
function hues(world: World, ps: PolityState): number[] {
  const out: number[] = []
  const base = seedToU32(world.seed)
  for (let p = 0; p < ps.P; p++) {
    const h = mix32(base ^ mix32(p + 0x51ed)) / 4294967296
    const par = ps.pParent[p]
    let hue = par >= 0 ? out[par] + (h - 0.5) * 0.16 : h
    hue -= Math.floor(hue)
    out.push(hue)
  }
  return out
}

/** The contract tables as of the current year (`years`), each array with its own buffer. */
export function assemblePolityHistory(world: World, s: HistoryState, ps: PolityState, sn: PolitySnaps, years: number, snapshotCount: number, landSnapshotCount: number, naming: SettlementNaming, peopleNames: readonly string[]): PolityHistory {
  const S = s.count
  const polity = new Int16Array(snapshotCount * S).fill(-1)
  for (let q = 0; q < snapshotCount; q++) polity.set(sn.pol.subarray(sn.off[q], sn.off[q] + sn.count[q]), q * S)
  const L = ps.landCells.length
  const territory = sn.terr.slice(0, landSnapshotCount * L)
  const danger = sn.dang.slice(0, landSnapshotCount * L)
  const landCells = Uint32Array.from(ps.landCells)
  // Polities.
  const info: { capital: number; parent: number; people: number }[] = []
  for (let p = 0; p < ps.P; p++) info.push({ capital: ps.pCapIds[p][0], parent: ps.pParent[p], people: ps.pPeople[p] })
  const T = s.terrain
  const { names, qualifiers } = namePolities(world, info, naming, peopleNames, (id) => s.cell[id], (c) => T.landmass[c])
  const hue = hues(world, ps)
  const polities: Polity[] = []
  for (let p = 0; p < ps.P; p++) {
    polities.push({
      id: p, name: names[p], qualifier: qualifiers[p] as PolityQualifier, foundedYear: ps.pFounded[p], endedYear: ps.pEnded[p],
      origin: ps.pOrigin[p] as PolityOrigin, endCause: ps.pEnd[p] as PolityEnd, parent: ps.pParent[p], people: ps.pPeople[p],
      capitals: ps.pCapIds[p].slice(), capitalYears: ps.pCapYears[p].slice(), hue: hue[p],
    })
  }
  // Wars.
  const W = ps.wKind.length
  const wars: Wars = {
    count: W, kind: Uint8Array.from(ps.wKind), attacker: Int16Array.from(ps.wAtt), defender: Int16Array.from(ps.wDef),
    startYear: Int16Array.from(ps.wStart), endYear: Int16Array.from(ps.wEnd), outcome: Uint8Array.from(ps.wOutcome),
    taken: new Uint16Array(W), dead: Float32Array.from(ps.wDead),
  }
  for (let w = 0; w < W; w++) { const t = ps.wTaken[w] + ps.wRetaken[w]; wars.taken[w] = t > 65535 ? 65535 : t }
  // Raids of complete decades, by decade then settlement.
  const done = Math.floor((years + 1) / 10) // decades [0, done) are complete
  const idx: number[] = []
  for (let i = 0; i < ps.raidDecade.length; i++) if (ps.raidDecade[i] < done) idx.push(i)
  idx.sort((a, b) => ps.raidDecade[a] - ps.raidDecade[b] || ps.raidSettlement[a] - ps.raidSettlement[b])
  const R = idx.length
  const raids: RaidSummary = { count: R, decade: new Int16Array(R), settlement: new Int32Array(R), raids: new Uint16Array(R), wealth: new Float32Array(R) }
  for (let k = 0; k < R; k++) {
    const i = idx[k]
    raids.decade[k] = ps.raidDecade[i]
    raids.settlement[k] = ps.raidSettlement[i]
    raids.raids[k] = ps.raidCount[i] > 65535 ? 65535 : ps.raidCount[i]
    raids.wealth[k] = ps.raidWealth[i]
  }
  return { polities, polity, landCells, territory, danger, wars, raids }
}
