// "Follow the story" state machine on a fake clock with a fake camera and timeline (experience-whatif-director-sagas
// §2.8): the lead time is respected, the caption shows with the slow-down, user input suspends, reduced motion means no
// flights, a beat in view gets a pulse instead, a jump backward resets, the city view suspends.

import { describe, expect, it } from 'vitest'
import { createDirector, DIRECTOR, DirectorState, type DirectorDeps } from './director.ts'
import type { StoryPlan } from './plan.ts'

const YPS = 20 / 3

function plan(years: number[], prominence?: number[]): StoryPlan {
  return {
    beatEntry: Int32Array.from(years, (_, i) => i * 10),
    beatYear: Float64Array.from(years),
    beatScore: Float32Array.from(years, () => 10),
    beatProminence: Float32Array.from(prominence ?? years.map(() => Infinity)),
    beatCell: Int32Array.from(years, (_, i) => 100 + i),
    beatScale: Uint8Array.from(years, () => 1),
    noteEntry: new Int32Array(0),
    noteYear: new Float64Array(0),
    noteScore: new Float32Array(0),
  }
}

function rig(opts: { reduced?: boolean; inView?: boolean } = {}) {
  const log: string[] = []
  const tl = {
    year: 0,
    playing: true,
    speed: 1,
    intro: false,
    slow: 1,
    get yearsPerSecond() {
      return this.playing ? this.speed * this.slow * YPS : YPS
    },
    setSlow(k: number, ease: number) {
      this.slow = k
      log.push(`slow ${k} ${ease}`)
    },
  }
  let city = false
  const deps: DirectorDeps = {
    timeline: tl,
    flyTo: (cell, dist, s) => log.push(`fly ${cell} ${dist} ${s}`),
    inView: () => opts.inView ?? false,
    pulse: (cell) => log.push(`pulse ${cell}`),
    reducedMotion: () => opts.reduced ?? false,
    cityEngaged: () => city,
    showCaption: (b) => log.push(`show ${b}`),
    hideCaption: () => log.push('hide'),
  }
  const d = createDirector(deps)
  /** Play `seconds` of real time in frames of `dt`. */
  const run = (seconds: number, dt = 1 / 30) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      if (tl.playing) tl.year += dt * tl.speed * tl.slow * YPS
      d.tick(dt)
    }
  }
  return { d, tl, log, run, setCity: (on: boolean) => (city = on) }
}

describe('story director', () => {
  it('flies to a beat LEAD_SECONDS before it, dwells with the caption slowed, then releases', () => {
    const r = rig()
    r.d.setPlan(plan([100, 300]))
    r.d.setOn(true)
    // 100 years at 20/3 y/s is 15 s away: nothing for the first 13 s
    r.run(13)
    expect(r.log).toEqual([])
    expect(r.d.state).toBe(DirectorState.Idle)
    r.run(0.5)
    expect(r.log).toEqual([`fly 100 ${DIRECTOR.dist[1]} ${DIRECTOR.leadSeconds}`])
    expect(r.d.state).toBe(DirectorState.Lead)
    // the flight started no earlier than the lead time
    expect(100 - r.tl.year).toBeLessThanOrEqual(DIRECTOR.leadSeconds * YPS + 1e-6)
    r.run(2)
    expect(r.d.state).toBe(DirectorState.Dwell)
    expect(r.log).toContain('show 0')
    expect(r.log).toContain(`slow ${DIRECTOR.dwellSlow} ${DIRECTOR.slowIn}`)
    r.run(DIRECTOR.dwellSeconds + 0.1)
    expect(r.log).toContain('hide')
    expect(r.log).toContain(`slow 1 ${DIRECTOR.slowOut}`)
    r.run(DIRECTOR.slowOut + 0.1)
    expect(r.d.state).toBe(DirectorState.Idle)
    // on to the next beat, once
    r.run(40)
    expect(r.log.filter((x) => x.startsWith('fly'))).toEqual([`fly 100 ${DIRECTOR.dist[1]} ${DIRECTOR.leadSeconds}`, `fly 101 ${DIRECTOR.dist[1]} ${DIRECTOR.leadSeconds}`])
    expect(r.log.filter((x) => x.startsWith('show'))).toEqual(['show 0', 'show 1'])
  })

  it('user input suspends; following resumes after SUSPEND_SECONDS of playback, or on Resume', () => {
    const r = rig()
    r.d.setPlan(plan([100, 200, 400]))
    r.d.setOn(true)
    r.run(14.5) // leading to the first beat
    expect(r.d.state).toBe(DirectorState.Lead)
    r.d.suspend()
    expect(r.d.state).toBe(DirectorState.Suspended)
    const flights = r.log.filter((x) => x.startsWith('fly')).length
    r.run(DIRECTOR.suspendSeconds - 1)
    expect(r.d.state).toBe(DirectorState.Suspended)
    expect(r.log.filter((x) => x.startsWith('fly')).length).toBe(flights) // nothing moves while suspended
    expect(r.log).not.toContain('show 0')
    r.run(1.5)
    expect(r.d.state).not.toBe(DirectorState.Suspended)
    // the given-up beat (year 100) is passed, not shown late
    r.run(30)
    expect(r.log).not.toContain('show 0')
    expect(r.log).toContain('show 1')
    // Resume
    r.d.suspend()
    r.d.resume()
    expect(r.d.state).toBe(DirectorState.Idle)
  })

  it('a suspension during the caption hides it and restores the speed', () => {
    const r = rig()
    r.d.setPlan(plan([50]))
    r.d.setOn(true)
    r.run(9)
    expect(r.d.state).toBe(DirectorState.Dwell)
    r.d.suspend()
    expect(r.log.slice(-2)).toEqual(['hide', 'slow 1 0.3'])
    expect(r.tl.slow).toBe(1)
  })

  it('reduced motion: no flights, the caption still shows', () => {
    const r = rig({ reduced: true })
    r.d.setPlan(plan([60]))
    r.d.setOn(true)
    r.run(12)
    expect(r.log.some((x) => x.startsWith('fly'))).toBe(false)
    expect(r.log).toContain('show 0')
  })

  it('a beat already in view gets a pulse, not a flight', () => {
    const r = rig({ inView: true })
    r.d.setPlan(plan([60]))
    r.d.setOn(true)
    r.run(12)
    expect(r.log.some((x) => x.startsWith('fly'))).toBe(false)
    expect(r.log).toContain('pulse 100')
    expect(r.log).toContain('show 0')
  })

  it('a jump backward resets to the new year (the same beat is told again)', () => {
    const r = rig()
    r.d.setPlan(plan([60, 500]))
    r.d.setOn(true)
    r.run(10)
    expect(r.d.state).toBe(DirectorState.Dwell)
    r.tl.year = 10
    r.d.tick(1 / 30)
    expect(r.d.state).toBe(DirectorState.Idle)
    expect(r.log).toContain('hide')
    r.run(10)
    expect(r.log.filter((x) => x === 'show 0').length).toBe(2)
  })

  it('a jump forward past beats skips them', () => {
    const r = rig()
    r.d.setPlan(plan([60, 300, 600]))
    r.d.setOn(true)
    r.run(1)
    r.tl.year = 400
    r.run(40)
    expect(r.log).not.toContain('show 0')
    expect(r.log).not.toContain('show 1')
    expect(r.log).toContain('show 2')
  })

  it('beats dropped at the current speed are not led to', () => {
    const r = rig()
    // the first beat is too close to a higher one to show at 16×
    r.d.setPlan(plan([60, 100, 2000], [40, Infinity, 1500]))
    r.tl.speed = 16
    r.d.setOn(true)
    r.run(1.5)
    expect(r.log.filter((x) => x.startsWith('show'))).toEqual(['show 1'])
  })

  it('a new plan with the beat in progress carries on; one without it resets', () => {
    const r = rig()
    r.d.setPlan(plan([60, 300]))
    r.d.setOn(true)
    r.run(10)
    expect(r.d.state).toBe(DirectorState.Dwell)
    // the same beats, longer (an extension): the caption stays
    r.d.setPlan(plan([60, 300, 2500]))
    expect(r.d.state).toBe(DirectorState.Dwell)
    expect(r.log).not.toContain('hide')
    // a plan without it: reset
    const other = plan([500])
    other.beatEntry[0] = 999
    r.d.setPlan(other)
    expect(r.d.state).toBe(DirectorState.Idle)
    expect(r.log).toContain('hide')
  })

  it('the city view suspends; the intro and a pause hold it', () => {
    const r = rig()
    r.d.setPlan(plan([60]))
    r.tl.intro = true
    r.d.setOn(true)
    r.run(12)
    expect(r.log).toEqual([])
    r.tl.intro = false
    r.tl.year = 0
    r.tl.playing = false
    r.d.tick(0.1) // (a jump backward: resets, nothing else)
    r.run(5)
    expect(r.log.some((x) => x.startsWith('fly'))).toBe(false)
    r.tl.playing = true
    r.setCity(true)
    r.run(1)
    expect(r.d.state).toBe(DirectorState.Suspended)
    r.run(30)
    expect(r.d.state).toBe(DirectorState.Suspended)
    r.setCity(false)
    r.d.setOn(false)
    expect(r.d.state).toBe(DirectorState.Off)
  })
})
