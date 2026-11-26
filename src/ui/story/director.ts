// "Follow the story" (experience-whatif-director-sagas §2.4): a state machine in real seconds over a fixed story plan,
// driven once per frame. It flies the camera to the next beat a little before its year, slows playback while the beat's
// caption shows, then lets go. Any user camera input suspends it for a while. DOM-free: the camera, the timeline, the
// caption and the reduced-motion setting come in through DirectorDeps, so director.test.ts runs it on a fake clock.
//
//   Idle      → Lead      the next beat kept at this speed is LEAD_SECONDS of playback away: fly there (unless in view)
//   Lead      → Dwell     its year is reached: slow to DWELL_SLOW, show the caption
//   Dwell     → Release   DWELL_SECONDS passed (or Next): ease back to normal speed
//   Release   → Idle
//   any       → Suspended user drag, zoom, pick or a panel's fly-to, or the city view; back to Idle after SUSPEND_SECONDS
//                         of no input, or on Resume
// A jump backward, or forward more than JUMP_YEARS, resets to Idle at the new year (the plan is fixed: this is exact).
// While the timeline's intro runs (its first playback, at its own rate) nothing happens; the view ends the intro when
// Follow is turned on.

import { beatKept, nextBeat, type StoryPlan } from './plan.ts'
import { DramaScale } from './drama.ts'

export const DIRECTOR = {
  /** Real seconds of playback before a beat that the flight starts (and lasts). */
  leadSeconds: 1.6,
  /** Playback factor while a beat's caption shows, eased in over slowIn and out over slowOut seconds. */
  dwellSlow: 0.25,
  slowIn: 0.4,
  slowOut: 0.8,
  /** Seconds a caption shows. */
  dwellSeconds: 6,
  /** Seconds without input before a suspended director follows again. */
  suspendSeconds: 12,
  /** A jump of more than this many years forward (or any backward) resets the director to the new year. */
  jumpYears: 50,
  /** Camera distance per scale: a town, a region (historyView's FLY_DIST), a continent. */
  dist: [1.8, 2.3, 2.8] as readonly number[],
}

export const DirectorState = { Off: 0, Idle: 1, Lead: 2, Dwell: 3, Release: 4, Suspended: 5 } as const
export type DirectorState = (typeof DirectorState)[keyof typeof DirectorState]

export interface DirectorTimeline {
  readonly year: number
  readonly playing: boolean
  readonly speed: number
  readonly yearsPerSecond: number
  readonly intro: boolean
  setSlow(k: number, easeSeconds: number): void
}

export interface DirectorDeps {
  timeline: DirectorTimeline
  /** Fly the camera to look down on `cell` from `dist` over `seconds` (0: cut). */
  flyTo(cell: number, dist: number, seconds: number): void
  /** Whether `cell` is already well inside the view (no flight needed). */
  inView(cell: number): boolean
  /** A ring at the place (for a beat that needs no flight). */
  pulse(cell: number): void
  reducedMotion(): boolean
  /** The city view is engaged (the director never flies into or out of a town). */
  cityEngaged(): boolean
  /** Show the caption of beat `b` (index into the plan's beats); hide it. */
  showCaption(b: number): void
  hideCaption(): void
  /** The state changed (the button and the "Following paused" chip follow it). */
  onState?(s: DirectorState): void
}

export interface Director {
  readonly state: DirectorState
  /** The beat being led to or shown (-1 none). */
  readonly beat: number
  setPlan(plan: StoryPlan | null): void
  /** Follow on or off. */
  setOn(on: boolean): void
  readonly on: boolean
  /** User input on the camera (drag, zoom, pick) or a fly-to from a panel. */
  suspend(): void
  /** Follow again at once (the chip's Resume). */
  resume(): void
  /** Skip the caption showing now. */
  next(): void
  /** Advance by `dt` real seconds (once per frame). */
  tick(dt: number): void
}

export function createDirector(deps: DirectorDeps): Director {
  let plan: StoryPlan | null = null
  let state: DirectorState = DirectorState.Off
  let beat = -1
  /** Beats below this index are done (shown or passed). */
  let done = 0
  let timer = 0
  let lastYear = NaN
  const T = deps.timeline

  const set = (s: DirectorState) => {
    if (s === state) return
    state = s
    deps.onState?.(s)
  }
  const toIdle = () => {
    if (state === DirectorState.Dwell) deps.hideCaption()
    if (state === DirectorState.Dwell || state === DirectorState.Release) T.setSlow(1, DIRECTOR.slowOut)
    beat = -1
    timer = 0
    set(DirectorState.Idle)
  }
  /** The plan's first beat at or after `year` (the cursor after a jump). */
  const seek = (year: number) => {
    if (!plan) return
    let a = 0, b = plan.beatYear.length
    while (a < b) {
      const m = (a + b) >>> 1
      if (plan.beatYear[m] < year) a = m + 1
      else b = m
    }
    done = a
  }

  const api: Director = {
    get state() {
      return state
    },
    get beat() {
      return beat
    },
    get on() {
      return state !== DirectorState.Off
    },
    setPlan(p) {
      const old = plan
      plan = p
      if (state === DirectorState.Off) return
      // a longer run of the same history, or a new focus: a beat in progress that the new plan has too carries on
      const busy = state === DirectorState.Lead || state === DirectorState.Dwell || state === DirectorState.Release
      if (busy && old && p && beat >= 0) {
        const entry = old.beatEntry[beat]
        const j = p.beatEntry.indexOf(entry)
        if (j >= 0) {
          const doneYear = old.beatYear[done] ?? Infinity
          beat = j
          done = 0
          while (done < p.beatYear.length && p.beatYear[done] < doneYear && done <= j) done++
          done = Math.min(done, j)
          return
        }
      }
      if (state === DirectorState.Dwell) deps.hideCaption()
      T.setSlow(1, 0)
      beat = -1
      seek(T.year)
      set(state === DirectorState.Suspended ? DirectorState.Suspended : DirectorState.Idle)
    },
    setOn(on) {
      if (on === (state !== DirectorState.Off)) return
      if (on) {
        seek(T.year)
        lastYear = T.year
        beat = -1
        timer = 0
        set(DirectorState.Idle)
      } else {
        if (state === DirectorState.Dwell) deps.hideCaption()
        T.setSlow(1, 0)
        beat = -1
        set(DirectorState.Off)
      }
    },
    suspend() {
      if (state === DirectorState.Off) return
      if (state === DirectorState.Dwell) deps.hideCaption()
      if (state === DirectorState.Dwell || state === DirectorState.Release) T.setSlow(1, 0.3)
      // a beat led to is given up (it will have passed when following resumes)
      if (beat >= 0) done = Math.max(done, beat + 1)
      beat = -1
      timer = 0
      set(DirectorState.Suspended)
    },
    resume() {
      if (state !== DirectorState.Suspended) return
      seek(T.year)
      toIdle()
    },
    next() {
      if (state !== DirectorState.Dwell) return
      deps.hideCaption()
      T.setSlow(1, DIRECTOR.slowOut)
      timer = 0
      set(DirectorState.Release)
    },
    tick(dt) {
      if (state === DirectorState.Off) return
      const year = T.year
      // a jump backward, or far forward: start over at the new year
      if (Number.isFinite(lastYear) && (year < lastYear - 1e-6 || year - lastYear > DIRECTOR.jumpYears) && state !== DirectorState.Suspended) {
        seek(year)
        toIdle()
      }
      lastYear = year
      if (deps.cityEngaged() && state !== DirectorState.Suspended) api.suspend()
      if (state === DirectorState.Suspended) {
        if (deps.cityEngaged()) timer = 0
        else if (T.playing) timer += dt
        if (timer >= DIRECTOR.suspendSeconds) {
          seek(year)
          toIdle()
        }
        return
      }
      if (!plan || T.intro) return
      switch (state) {
        case DirectorState.Idle: {
          if (!T.playing) return
          const b = nextBeat(plan, year, T.speed, done)
          if (b < 0) return
          if (plan.beatYear[b] - year > DIRECTOR.leadSeconds * T.yearsPerSecond) return
          beat = b
          const cell = plan.beatCell[b]
          if (cell >= 0) {
            if (deps.inView(cell)) deps.pulse(cell)
            else if (!deps.reducedMotion()) deps.flyTo(cell, DIRECTOR.dist[plan.beatScale[b]] ?? DIRECTOR.dist[DramaScale.Region], DIRECTOR.leadSeconds)
          }
          timer = 0
          set(DirectorState.Lead)
          return
        }
        case DirectorState.Lead: {
          if (year + 1e-6 < plan.beatYear[beat]) return
          // (a speed change since the lead may have dropped it: shown anyway, it was already flown to)
          T.setSlow(DIRECTOR.dwellSlow, DIRECTOR.slowIn)
          deps.showCaption(beat)
          timer = 0
          set(DirectorState.Dwell)
          return
        }
        case DirectorState.Dwell: {
          if (T.playing) timer += dt
          if (timer < DIRECTOR.dwellSeconds) return
          deps.hideCaption()
          T.setSlow(1, DIRECTOR.slowOut)
          timer = 0
          set(DirectorState.Release)
          return
        }
        case DirectorState.Release: {
          timer += dt
          if (timer < DIRECTOR.slowOut) return
          done = Math.max(done, beat + 1)
          // beats that went by while the caption showed are passed, not shown late
          while (done < plan.beatYear.length && plan.beatYear[done] < T.year) done++
          beat = -1
          timer = 0
          set(DirectorState.Idle)
          return
        }
      }
    },
  }
  return api
}

/** Whether beat b of `plan` is kept at `speed` (re-exported for the view). */
export { beatKept }
