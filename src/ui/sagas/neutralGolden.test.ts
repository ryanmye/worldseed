// Partisan sagas, test 1 (experience-whatif-director-sagas §3.7, step 12): the neutral record is byte-identical to the
// text before the partisan lens existed. The hashes below were recorded on main 31c11c9, before any partisan change
// (step 12 records them first, with no behaviour change); a later commit may change them only for an intended change
// of the neutral sagas or of the sim, and must say so.

import { describe, expect, it } from 'vitest'
import type { History, World } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { generateSaga, sagaText, type SagaSubject } from './index.ts'
import { Ctx } from './facts.ts'

/** FNV-1a 32-bit over UTF-16 code units (only compared with itself). */
export function textHash(s: string): string {
  let x = 2166136261
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619)
  return (x >>> 0).toString(16).padStart(8, '0')
}

/** The subjects of the golden: the world, the first three peoples, the three largest states by peak and their founding capitals, a decade. */
export function goldenSubjects(h: History, world: World): SagaSubject[] {
  const c = new Ctx(h, world, h.years)
  const states = h.polities.map((p) => p.id).sort((a, b) => c.ppeak(b).pop - c.ppeak(a).pop || a - b).slice(0, 3)
  const out: SagaSubject[] = [{ kind: 'world', id: 0 }]
  for (let p = 0; p < Math.min(3, h.peoples.length); p++) out.push({ kind: 'people', id: p })
  for (const p of states) out.push({ kind: 'state', id: p })
  for (const p of states) out.push({ kind: 'city', id: h.polities[p].capitals[0] })
  out.push({ kind: 'decade', id: 1200 })
  return out
}

/** `kind:id:L|C hash` per subject and register. */
export function goldenLines(h: History, world: World): string[] {
  const out: string[] = []
  for (const s of goldenSubjects(h, world)) for (const legend of [false, true]) out.push(`${s.kind}:${s.id}:${legend ? 'L' : 'C'} ${textHash(sagaText(generateSaga(h, world, s, legend, h.years)))}`)
  return out
}

const GOLDEN: Record<number, string[]> = {
  42: [
    "world:0:C d5fd4cd7",
    "world:0:L 814beaac",
    "people:0:C 8c1bd2d8",
    "people:0:L a05860b3",
    "people:1:C ad89f8d0",
    "people:1:L 87f5b336",
    "people:2:C e916abd7",
    "people:2:L dad6ad62",
    "state:27:C 56b37058",
    "state:27:L 7a3330e7",
    "state:38:C e0e69795",
    "state:38:L 2bb9faa3",
    "state:2:C 2c94d8be",
    "state:2:L 5549d4ff",
    "city:21:C ba258e9c",
    "city:21:L ce47f906",
    "city:744:C 468fe52d",
    "city:744:L f807d244",
    "city:14:C f8b36219",
    "city:14:L dfbf658c",
    "decade:1200:C 3765d600",
    "decade:1200:L 16741865",
  ],
  1234: [
    "world:0:C ab61b528",
    "world:0:L 2d6936b5",
    "people:0:C fdf96b85",
    "people:0:L 966cc1cb",
    "people:1:C f91d1adf",
    "people:1:L 8db9ed88",
    "people:2:C 077fd1e9",
    "people:2:L 211f7856",
    "state:0:C 671c612f",
    "state:0:L 3f61eb4f",
    "state:24:C 3de7921b",
    "state:24:L ddc0e02e",
    "state:11:C 21e554d5",
    "state:11:L ab782767",
    "city:22:C 83632456",
    "city:22:L 2d0c1f8e",
    "city:404:C a9b77928",
    "city:404:L 035629d8",
    "city:549:C 8200d6a0",
    "city:549:L 0a2c7a00",
    "decade:1200:C 297b5ecd",
    "decade:1200:L e602bb7b",
  ],
}

describe('neutral sagas are unchanged (partisan test 1)', () => {
  for (const seed of [42, 1234]) {
    it(`seed ${seed}`, { timeout: 900_000 }, () => {
      const world = generateWorld(seed)
      const h = simulateHistory(world, { years: 2000 })
      const lines = goldenLines(h, world)
      expect(lines).toEqual(GOLDEN[seed])
    })
  }
})
