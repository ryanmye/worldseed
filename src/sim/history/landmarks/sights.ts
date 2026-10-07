// landmarks -> tourism: great landmarks as sights (LANDMARK.sights). The one place where the landmarks are more than a
// consequence layer: tourism's sight scan (tourism/system.ts sightScan, every SIGHT.step years) calls landmarkSights with the
// landmarks' state when the system is on (index.ts passes it; null with HistoryOptions.landmarks false, so tourism is then
// exactly as without landmarks). A great landmark ruined, left unfinished, or LANDMARK.sightAge years old since it was begun
// becomes a sight of its own once (SightKind.Landmark, Sight.landmark its row), with fame LANDMARK.sightFame[kind] (times
// sightRuin ruined or unfinished), which feeds its town's (or its cell's) destination like any sight's fame.
// It reads the landmarks' state as of the end of last year (tourism runs before landmarksYear) and changes nothing of theirs
// but their own `lSight` mark: deterministic, in landmark order.

import { LandmarkRank, LandmarkState } from '../../../contract.ts'
import type { HistoryState } from '../state.ts'
import { LANDMARK } from './params.ts'
import type { LandmarksState } from './state.ts'

/** Calls add(cell, settlement, fame, landmark) for each great landmark that has become a sight since the last call. */
export function landmarkSights(s: HistoryState, lm: LandmarksState, add: (cell: number, settlement: number, fame: number, landmark: number) => void): void {
  const X = LANDMARK
  if (!X.sights) return
  const n = lm.lKind.length
  for (let id = 0; id < n; id++) {
    if (lm.lSight[id] === 1 || lm.lRank[id] !== LandmarkRank.Great) continue
    const st = lm.lState[id]
    if (st === LandmarkState.Building) continue
    const ruin = st === LandmarkState.Ruined || st === LandmarkState.Unfinished
    if (!ruin && s.year - lm.lBegun[id] < X.sightAge) continue
    const fame = X.sightFame[lm.lKind[id]] * (ruin ? X.sightRuin : 1)
    if (!(fame > 0)) continue
    lm.lSight[id] = 1
    lm.diag.sights++
    add(s.cell[lm.lSett[id]], lm.lSett[id], fame, id)
  }
}
