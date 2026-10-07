// tourism: the History fields of the tourism system (all copied out of the state, each array with its own buffer).

import type { GeoFeature, Sight, SightKind, VisitorFlows } from '../../../contract.ts'
import type { FeatureMap } from '../../names/features.ts'
import type { TourismState } from './state.ts'

export interface TourismHistory {
  scenery: Uint8Array
  sceneryKind: Uint16Array
  sights: Sight[]
  visitorFlows: VisitorFlows
}

function emptyFlows(): VisitorFlows {
  return {
    count: 0, from: new Int32Array(0), to: new Int32Array(0), firstYear: new Int16Array(0), pathOffsets: new Uint32Array(1), path: new Uint32Array(0),
    rowCount: 0, rowSnapshot: new Uint16Array(0), rowPair: new Int32Array(0), visitors: new Float32Array(0), spend: new Float32Array(0),
  }
}

export function emptyTourismHistory(): TourismHistory {
  return { scenery: new Uint8Array(0), sceneryKind: new Uint16Array(0), sights: [], visitorFlows: emptyFlows() }
}

/**
 * Everything up to the year just simulated. Sight names: the settlement's, else the name of the mountain range (a summit) or
 * the feature at the cell, if it was named by the sight's year. Rows of trade snapshots up to tradeSnapshotCount.
 */
export function assembleTourism(tz: TourismState, tradeSnapshotCount: number, names: readonly string[], features: readonly GeoFeature[], map: FeatureMap): TourismHistory {
  const byAnchor = new Map<string, number>() // (lookup only)
  for (const f of features) byAnchor.set(f.kind + ':' + f.anchorCell, f.id)
  const sights: Sight[] = []
  for (let k = 0; k < tz.sKind.length; k++) {
    const st = tz.sSettlement[k], c = tz.sCell[k]
    let name = st >= 0 ? names[st] : ''
    if (!name) {
      const det = map.relief[c] >= 0 ? map.relief[c] : map.land[c]
      if (det >= 0) {
        const d = map.features[det]
        const id = byAnchor.get(d.kind + ':' + d.anchorCell)
        if (id !== undefined && features[id].namedYear <= tz.sFrom[k]) name = features[id].name
      }
    }
    const x: Sight = { id: k, kind: tz.sKind[k] as SightKind, cell: c, settlement: st, fromYear: tz.sFrom[k], fame: tz.sFame[k], name }
    if (tz.sLandmark[k] >= 0) x.landmark = tz.sLandmark[k] // landmarks: (its name its town's, as any sight's: the landmark's own is landmarkNameAt)
    sights.push(x)
  }
  const n = tz.pFrom.length
  const pathOffsets = new Uint32Array(n + 1)
  let total = 0
  for (let k = 0; k < n; k++) { pathOffsets[k] = total; total += tz.pPath[k].length }
  pathOffsets[n] = total
  const path = new Uint32Array(total)
  for (let k = 0; k < n; k++) path.set(tz.pPath[k], pathOffsets[k])
  let rows = 0
  while (rows < tz.rSnap.length && tz.rSnap[rows] < tradeSnapshotCount) rows++
  return {
    scenery: tz.scenery.slice(),
    sceneryKind: tz.sceneryKind.slice(),
    sights,
    visitorFlows: {
      count: n, from: Int32Array.from(tz.pFrom), to: Int32Array.from(tz.pTo), firstYear: Int16Array.from(tz.pFirst), pathOffsets, path,
      rowCount: rows, rowSnapshot: Uint16Array.from(tz.rSnap.slice(0, rows)), rowPair: Int32Array.from(tz.rPair.slice(0, rows)),
      visitors: Float32Array.from(tz.rVis.slice(0, rows)), spend: Float32Array.from(tz.rSpend.slice(0, rows)),
    },
  }
}
