// Partisan sagas (experience-whatif-director-sagas §3.7 tests 2-6; test 1, the neutral golden, is neutralGolden.test.ts):
// seeds 42 and 1234 at 2000 years. Told by a state itself, its won wars are all kept and its minor lost wars left out;
// a sack told by its victim counts at least the true toll × 1.5 (rounded); no {slot} is left for any teller; stances
// (Foe in a war and within 150 years of it, Friend under an alliance); told by a state's enemy, its saga uses the .foe keys.

import { describe, expect, it } from 'vitest'
import { BondKind, EventType, type History, type World } from '../../contract.ts'
import { generateWorld, simulateHistory } from '../../sim/index.ts'
import { generateSaga, sagaText } from './index.ts'
import { Ctx } from './facts.ts'
import { Lens, roundToll, Stance, type Pov } from './lens.ts'
import { PARTISAN } from './partisanParams.ts'
import { sackScene, SCENE_T } from './scenes.ts'
import { PARTISAN_T } from './partisan.ts'
import { Voice } from './voice.ts'
import { politiesOf } from '../politiesData.ts'

const runs = new Map<number, { world: World; h: History; top: number[] }>()
function run(seed: number) {
  let r = runs.get(seed)
  if (!r) {
    const world = generateWorld(seed)
    const h = simulateHistory(world, { years: 2000 })
    const c = new Ctx(h, world, h.years)
    const top = h.polities.map((p) => p.id).sort((a, b) => c.ppeak(b).pop - c.ppeak(a).pop || a - b).slice(0, 3)
    runs.set(seed, (r = { world, h, top }))
  }
  return r
}

describe('rounding', () => {
  it('two figures in the chronicle, the formulaic set in the legend', () => {
    expect(roundToll(1234, false)).toBe(1200)
    expect(roundToll(87654, false)).toBe(88000)
    expect(roundToll(2400, true)).toBe(3000)
    expect(roundToll(1600, true)).toBe(1000)
    expect(roundToll(0, true)).toBe(0)
  })
})

for (const seed of [42, 1234]) {
  describe(`partisan, seed ${seed}`, () => {
    it('told by the state itself: won wars kept, minor lost wars left out (chronicle)', { timeout: 900_000 }, () => {
      const { world, h, top } = run(seed)
      for (const p of top) {
        const c = new Ctx(h, world, h.years, { kind: 'state', id: p })
        const L = c.lens!
        const W = c.pd!.wars!
        for (const w of c.pd!.warsOf[p] ?? []) {
          const s = L.sideOfWar(w, h.years)
          const omitted = L.omitsWar(w, h.years, false, (q, y) => c.capital(q, y))
          if (s.won) expect(omitted).toBe(false)
          if (s.lost && W.dead[w] < PARTISAN.omitLostDead && W.taken[w] <= 1 && !L.capitalFell(w, h.years, (q, y) => c.capital(q, y))) expect(omitted).toBe(true)
        }
      }
    })

    it('a sack told by its victim counts at least the true toll × 1.5', { timeout: 900_000 }, () => {
      const { world, h } = run(seed)
      const pd = politiesOf(h)!
      let checked = 0
      for (let i = 0; i < h.events.length && checked < 12; i++) {
        const e = h.events[i]
        if (e.type !== EventType.Sacked) continue
        const c0 = new Ctx(h, world, h.years)
        const victim = c0.polityOf(e.settlement, Math.max(0, e.year - 1))
        const by = c0.polityOf(e.other, e.year)
        if (victim < 0 || by < 0 || victim === by || pd.list[victim].people === pd.list[by].people) continue
        const c = new Ctx(h, world, h.years, { kind: 'state', id: victim })
        if (!c.lens!.isUs(victim) || c.lens!.isUs(by)) continue
        const sc = sackScene(c, new Voice(1, 'test', false, SCENE_T, PARTISAN_T), i)
        if (!sc) continue
        const m = /count some ([\d,]+) dead/.exec(sc.text)
        expect(m, sc.text).not.toBeNull()
        const told = Number(m![1].replace(/,/g, ''))
        const truth = e.value * c.pop(e.settlement, Math.max(0, e.year - 1))
        expect(told).toBeGreaterThanOrEqual(roundToll(truth * 1.5, false))
        checked++
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('leaves no {slot} in either register for any teller', { timeout: 900_000 }, () => {
      const { world, h, top } = run(seed)
      const povs: Pov[] = [...top.map((id) => ({ kind: 'state', id }) as Pov), { kind: 'people', id: 0 }, { kind: 'people', id: 1 }]
      for (const pov of povs) for (const legend of [false, true]) {
        const subjects = [{ kind: 'world' as const, id: 0 }, { kind: 'people' as const, id: 0 }, ...top.map((id) => ({ kind: 'state' as const, id })), ...top.map((id) => ({ kind: 'city' as const, id: h.polities[id].capitals[0] }))]
        for (const s of subjects) {
          const t = sagaText(generateSaga(h, world, s, legend, h.years, pov))
          expect(t, `${pov.kind}:${pov.id} ${s.kind}:${s.id} ${legend}`).not.toMatch(/\{|NaN|undefined/)
        }
      }
    })

    it('stances: Foe in a war and within 150 years after it; Friend under an alliance', { timeout: 900_000 }, () => {
      const { h } = run(seed)
      const pd = politiesOf(h)!
      const W = pd.wars!
      let w = -1
      for (let k = 0; k < W.count; k++) if (W.endYear[k] > 0 && W.endYear[k] + 100 < h.years && pd.list[W.attacker[k]].people !== pd.list[W.defender[k]].people) { w = k; break }
      expect(w).toBeGreaterThanOrEqual(0)
      const L = new Lens(h, pd, { kind: 'state', id: W.defender[w] })
      if (!L.isUs(W.attacker[w])) {
        expect(L.stance(W.attacker[w], W.startYear[w])).toBe(Stance.Foe)
        expect(L.stance(W.attacker[w], W.startYear[w] + PARTISAN.foeYears - 10)).toBe(Stance.Foe)
      }
      const B = pd.bonds!
      let found = 0
      for (let k = 0; k < B.count && found < 3; k++) {
        if (B.kind[k] !== BondKind.Alliance) continue
        const y = B.startYear[k] + 1
        const L2 = new Lens(h, pd, { kind: 'state', id: B.a[k] })
        if (L2.isUs(B.b[k])) continue
        const s = L2.stance(B.b[k], y)
        expect([Stance.Friend, Stance.Foe]).toContain(s) // (Foe beats Friend: an ally fought within 150 years is still a foe)
        if (s === Stance.Friend) found++
      }
    })

    it('told by its enemy, a conqueror\'s saga uses the .foe wording', { timeout: 900_000 }, () => {
      const { world, h } = run(seed)
      const pd = politiesOf(h)!
      const W = pd.wars!
      let done = false
      for (let k = 0; k < W.count && !done; k++) {
        const a = W.attacker[k], d = W.defender[k]
        if (pd.list[a].people === pd.list[d].people || W.taken[k] < 3) continue
        const neutral = sagaText(generateSaga(h, world, { kind: 'state', id: a }, false, h.years))
        if (!/Its armies took|In war it took/.test(neutral)) continue
        const c = new Ctx(h, world, h.years, { kind: 'state', id: d })
        if (c.lens!.stance(a, h.years) !== Stance.Foe) continue
        const told = sagaText(generateSaga(h, world, { kind: 'state', id: a }, false, h.years, { kind: 'state', id: d }))
        expect(told).toMatch(/In war it seized/)
        expect(told).not.toBe(neutral)
        done = true
      }
      expect(done).toBe(true)
    })
  })
}
