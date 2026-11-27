// What-if (experience-whatif-director-sagas §1.11 tests 5 and 6): a skeleton of the other world runs through everything
// that may see one (politiesOf, rulersOf, faithsOf, the saga Ctx, buildPolityLayer's data part, the consequences and
// their wording, the whatif saga) with no NaN and no unfilled {slot}; the whatif saga fills every slot in both registers,
// is deterministic, and says only the `same` line for an order that changed nothing.

import { describe, expect, it } from 'vitest'
import { OrderKind, OrderStatus, type History, type Order } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { fingerprintOf } from '../../whatif/fingerprint.ts'
import { diffFingerprints } from '../../whatif/diff.ts'
import { skeletonOf, topLevelBytes } from '../../whatif/skeleton.ts'
import { politiesOf } from '../politiesData.ts'
import { rulersOf } from '../rulersData.ts'
import { faithsOf } from '../faithsData.ts'
import { Ctx } from '../sagas/facts.ts'
import { buildPolityLayer } from '../../render/polities.ts'
import { whatIfFacts } from './consequences.ts'
import { consequenceText, type WhatIfShown } from './wording.ts'
import { whatifSaga } from '../sagas/whatif.ts'
import { sagaText } from '../sagas/index.ts'
import { snapshot } from '../../historyCache.ts'

const SEED = 42, YEARS = 600
const world = generateWorld(SEED)
let cache: { A: History; B: History; order: Order } | null = null
function runs() {
  if (cache) return cache
  const A = simulateHistory(world, { years: YEARS })
  const N = A.settlements.length, s = 300 / A.snapshotInterval
  const ids = [...Array(N).keys()].sort((a, b) => A.population[s * N + b] - A.population[s * N + a])
  for (const id of ids.slice(0, 12)) {
    const order: Order = { year: 300, kind: OrderKind.Fortify, actor: id }
    const B = simulateHistory(world, { years: YEARS, orders: [order] })
    if (B.orderOutcomes?.[0].status === OrderStatus.Fulfilled) return (cache = { A, B, order })
  }
  throw new Error('no fortify fulfilled')
}
function shownOf(A: History, B: History): WhatIfShown {
  const fpA = fingerprintOf(A), fpB = fingerprintOf(B)
  const digest = diffFingerprints(fpA, fpB, world.grid.positions)
  const S = skeletonOf(B)
  const r = B.orderOutcomes?.[0]
  const cell = r && r.place >= 0 ? B.settlements[r.place].cell : -1
  const facts = whatIfFacts(A, S, fpA, fpB, digest, cell, world.grid.positions)
  return { ask: { orders: [], label: 'test', focus: { world: 'B', k: 0 } }, A, B: S, result: { compareId: 1, digest, fpA, fpB, alt: S, skeleton: true, ms: 0, cached: false }, facts, pdA: politiesOf(A), pdB: politiesOf(S) }
}

describe('skeleton', () => {
  it('runs through the polity, ruler, faith and saga indexes, the polity layer and the consequences', { timeout: 900_000 }, () => {
    const { A, B } = runs()
    const S = skeletonOf(B)
    expect(topLevelBytes(S)).toBeLessThan(topLevelBytes(B) * 0.5)
    const pd = politiesOf(S)!
    expect(pd.count).toBe(B.polities.length)
    expect(rulersOf(S)).not.toBeNull()
    expect(faithsOf(S)).not.toBeNull()
    const c = new Ctx(S, world, S.years)
    expect(Number.isFinite(c.ppeak(0).pop)).toBe(true)
    const layer = buildPolityLayer(world, S, pd)
    layer.dispose()
    const shown = shownOf(A, B)
    expect(shown.facts.digest.divergence).toBeGreaterThanOrEqual(300)
    expect(shown.facts.items.length).toBeGreaterThan(0)
    for (const it of shown.facts.items) {
      const t = consequenceText(shown, it)
      expect(t, it.kind).not.toMatch(/NaN|undefined|\{/)
      expect(t.length).toBeGreaterThan(10)
    }
  })
})

describe('whatif saga', () => {
  it('fills every slot in both registers, names the divergence, and is deterministic', { timeout: 900_000 }, () => {
    const { A, B } = runs()
    const shown = shownOf(A, B)
    for (const legend of [false, true]) {
      const tell = () => sagaText(whatifSaga(new Ctx(shown.A, world, shown.facts.T), new Ctx(shown.B, world, shown.facts.T), shown, legend))
      const t = tell()
      expect(t).not.toMatch(/\{|NaN|undefined/)
      expect(t).toContain(String(shown.result.digest.divergence))
      expect(tell()).toBe(t)
    }
  })
  it('says only the "same" line when nothing changed', { timeout: 900_000 }, () => {
    const { A } = runs()
    const shown = shownOf(A, snapshot(A))
    expect(shown.result.digest.divergence).toBe(-1)
    for (const legend of [false, true]) {
      const s = whatifSaga(new Ctx(shown.A, world, shown.facts.T), new Ctx(shown.B, world, shown.facts.T), shown, legend)
      expect(s.paragraphs.length).toBe(1)
      expect(sagaText(s)).not.toMatch(/\{/)
    }
  })
})
