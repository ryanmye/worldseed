// grudges and oaths: the shadow of the future (shadow.ts): the folk-theorem condition, delta's bounds and monotonicity.

import { describe, expect, it } from 'vitest'
import { oathDelta, oathExcess } from './shadow.ts'
import { OATH } from './params.ts'
import { survival } from '../rulers/state.ts'
import { createRng } from '../../rng.ts'
import type { HistoryState } from '../state.ts'
import type { PolityState } from './state.ts'

/** A one-polity world at `year` whose ruler is `age` with an heir pool of one (adult or minor, legitimate or not), or none. */
function fixture(age: number, heir: 'adult' | 'minor' | 'none', law = 0, crisis = false, danger = 0): [HistoryState, PolityState, number] {
  const year = 1000
  const R = {
    pcap: 1, cur: Int32Array.from([0]), rBorn: [year - age], rDyn: [0], rDeath: [year + 30], rPiety: [0.5],
    law: Int32Array.from([law]), cognatic: Uint8Array.from([0]), surv: survival(),
    hN: Int32Array.from([heir === 'none' ? 0 : 1]), hBorn: new Int32Array(6).fill(heir === 'adult' ? year - 20 : year - 5), hDeath: new Int32Array(6).fill(year + 40),
    hLegit: new Uint8Array(6).fill(1), hFemale: new Uint8Array(6), hChild: new Uint8Array(6).fill(1), hParent: new Int32Array(6),
  }
  const s = { year, rul: R } as unknown as HistoryState
  const ps = { pCapital: Int32Array.from([0]), seen: 1, dangerAvg: Float64Array.from([danger]), pCrisisUntil: Int32Array.from([crisis ? year + 5 : 0]), pPeople: Int32Array.from([0]) } as unknown as PolityState
  return [s, ps, 0]
}

describe('shadow of the future', () => {
  it('without a reputational cost, E > 0 exactly when delta < (T - R) / (T - P) (folk theorem, grim trigger)', () => {
    const rng = createRng(7, 'test-shadow')
    for (let k = 0; k < 2000; k++) {
      const P = rng.next(), Rw = P + rng.next(), T = Rw + rng.next() + 1e-6
      const d = OATH.deltaMin + (OATH.deltaMax - OATH.deltaMin) * rng.next()
      const E = oathExcess(d, T - Rw, Rw - P, 0, 0.5)
      const crit = (T - Rw) / (T - P)
      if (Math.abs(d - crit) < 1e-9) continue
      expect(E > 0).toBe(d < crit)
    }
  })

  it('delta stays in bounds, falls with age, rises with heir security, falls in crisis and danger', () => {
    for (const heir of ['adult', 'minor', 'none'] as const) {
      let prev = 2
      for (let age = 16; age <= 95; age++) {
        const d = oathDelta(...fixture(age, heir))
        expect(d).toBeGreaterThanOrEqual(OATH.deltaMin)
        expect(d).toBeLessThanOrEqual(OATH.deltaMax)
        expect(d).toBeLessThanOrEqual(prev + 1e-12)
        prev = d
      }
    }
    for (const age of [25, 44, 65]) {
      const a = oathDelta(...fixture(age, 'adult')), m = oathDelta(...fixture(age, 'minor')), n = oathDelta(...fixture(age, 'none'))
      expect(a).toBeGreaterThanOrEqual(m)
      expect(m).toBeGreaterThanOrEqual(n)
      expect(oathDelta(...fixture(age, 'adult', 0, true))).toBeLessThan(a)
      expect(oathDelta(...fixture(age, 'adult', 0, false, 0.5))).toBeLessThan(a)
    }
    // Worked value of the plan (3.6a): a 25-year-old with an adult heir under primogeniture, about 0.87.
    expect(Math.abs(oathDelta(...fixture(25, 'adult')) - 0.87)).toBeLessThan(0.03)
  })
})
