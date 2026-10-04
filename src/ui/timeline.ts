// Timeline bar: play/pause, scrub slider, year readout, speed and live stats.
// Owns the playback clock (a single `year` value); everything shown on the globe is
// derived from that year, so scrubbing in either direction is exact.
//
// Open-ended playback: the history can be extended past its current end (the caller
// simulates a longer run and calls extendRange). While playing within PREFETCH_YEARS of
// the end the timeline asks for more (onWantMore) so playback at 1x normally never has
// to wait; if it does reach the end first it holds there ("simulating…") without
// advancing, and carries on when the longer history arrives. The initial animation stops
// at a soft stop (the end of the initial history, normally year 2000) even if more has
// been simulated by then; from there Play continues.

import { formatPopulation, formatInt } from './format.ts'
import { addShortcut } from './shortcuts.ts'

/** Simulated years per real second at 1x: a third of the original 20 (the owner's request), the
 * ¼×/4×/16× buttons keeping the same ratios to it. */
export const YEARS_PER_SECOND = 20 / 3
/** Years per real second of the initial 0→BASE_YEARS animation (intro): kept at the original 20
 * regardless of YEARS_PER_SECOND above, so slowing down normal playback does not stretch the intro. */
const INTRO_YEARS_PER_SECOND = 20
export const SPEEDS = [0.25, 1, 4, 16] as const
const DEFAULT_SPEED = 1
/** While playing this close to the end of the history (years), more is requested. */
export const PREFETCH_YEARS = 150
/** Length of the default history: marked on the slider once the range runs past it. */
const BASE_YEARS = 2000

/** Whether the history can grow past its current end. */
export const More = {
  /** More can be requested. */
  Yes: 0,
  /** A longer history is being simulated. */
  Pending: 1,
  /** No more: the length cap, or the last extension failed. */
  No: 2,
} as const
export type More = (typeof More)[keyof typeof More]

/** A span marked under the slider (a great epidemic): clicking it jumps to `from`. */
export interface TimelineMark {
  from: number
  to: number
  /** CSS colour. */
  color: string
  title: string
}

export interface TimelineCallbacks {
  /** Playback state changed (play/pause/scrub end/step); not called every frame. */
  onSettled(year: number, playing: boolean): void
  /** More history past the current end is wanted (may be called repeatedly; the caller dedupes). */
  onWantMore(): void
}

export interface Timeline {
  readonly year: number
  /** Playback is on (including while held at the end waiting for more history). */
  readonly playing: boolean
  /** Playing but held at the end until a longer history arrives. */
  readonly waiting: boolean
  readonly speed: number
  /** Years advanced per second of real time at the current speed (accounts for the intro's own, unscaled rate); YEARS_PER_SECOND while paused. */
  readonly yearsPerSecond: number
  /** True while the user drags the slider. */
  readonly scrubbing: boolean
  /** The initial animation is under way (playing toward its soft stop). */
  readonly intro: boolean
  /** Enable for a history of `years` with snapshots every `interval` years; null disables (and shows `status`). Resets to year 0. */
  setRange(years: number | null, interval: number, status?: string): void
  /** The history grew to `years` (same start, same interval): keeps the year, playback and speed; resumes a held playback. */
  extendRange(years: number): void
  /**
   * Whether the history can grow. `message` explains a No (cap reached, extension failed); it is
   * shown briefly when playback stops at the end, or at once with `now`.
   */
  setMore(more: More, message?: string, now?: boolean): void
  /** Stop playback once on reaching this year (the end of the initial animation), or null for none. */
  setSoftStop(year: number | null): void
  /** Ask for more this many real seconds of playback before the end (at least PREFETCH_YEARS before it). */
  setPrefetchLead(seconds: number): void
  setYear(year: number): void
  play(): void
  pause(): void
  toggle(): void
  /** Move `dir` snapshots forward (> 0) or back (< 0) and pause. */
  step(dir: number): void
  /** Playback speed multiplier (one of SPEEDS). */
  setSpeed(speed: number): void
  /** Advance the clock by dt seconds; returns the current year. */
  tick(dt: number): number
  /** Live stats; towns and cities are counted by population tier; `routes` is the number of open trade routes. */
  /** `states` and `wars`: factions alive and wars in progress (polities; shown when given and there are any). */
  /** `largest`: the largest bloc of states (polities v2: a sphere of an overlord and its vassals, or a single state) and its share of the people, "Rilkochal 31%". */
  setStats(alive: number, population: number, towns?: number, cities?: number, routes?: number, states?: number, wars?: number, largest?: string): void
  /** Thin marks under the slider (great epidemics), or null for none; kept across extendRange. */
  setMarks(marks: readonly TimelineMark[] | null): void
  /** A faint sparkline behind the slider: one value per snapshot from year 0 (the world's people), or null for none. */
  setSparkline(values: ArrayLike<number> | null, interval: number): void
  /**
   * A thin progress strip along the top edge of the bar, with a short label in the status line:
   * `label` null hides it; `frac` (0..1) shows that much filled, or null for an indeterminate
   * animation. Shown (and legible) even while the bar is `disabled`, for the world-generation,
   * history-simulation and layer-build waits.
   */
  setProgress(label: string | null, frac: number | null): void
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>'
const PAUSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>'
/** Play on past the end: a play triangle with a second one behind it. */
const CONTINUE_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2 3v10l6.5-5z" fill="currentColor" opacity="0.55"/><path d="M7.5 3v10l7-5z" fill="currentColor"/></svg>'

export function createTimeline(container: HTMLElement, callbacks: TimelineCallbacks): Timeline {
  const root = document.createElement('div')
  root.className = 'panel timeline disabled'

  // thin progress strip along the top edge (world generation, history simulation, layer build,
  // history extension): a CSS animation only, so it costs nothing while idle and never drives a
  // WebGL frame (render/invalidate.ts)
  const progress = document.createElement('div')
  progress.className = 'tl-progress hidden'
  progress.setAttribute('aria-hidden', 'true')
  const progressFill = document.createElement('div')
  progressFill.className = 'tl-progress-fill'
  progress.appendChild(progressFill)

  const row = document.createElement('div')
  row.className = 'tl-row'

  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'btn tl-play'
  playBtn.title = 'Play / pause (Space)'
  playBtn.setAttribute('aria-label', 'Play')
  playBtn.innerHTML = PLAY_ICON

  const yearBox = document.createElement('div')
  yearBox.className = 'tl-year'
  const yearLabel = document.createElement('span')
  yearLabel.className = 'tl-year-label'
  yearLabel.textContent = 'Year'
  const yearValue = document.createElement('span')
  yearValue.className = 'tl-year-value'
  yearValue.textContent = '0'
  yearBox.append(yearLabel, yearValue)

  const stats = document.createElement('div')
  stats.className = 'tl-stats'
  const aliveText = document.createTextNode('')
  const popText = document.createTextNode('')
  const tierText = document.createTextNode('')
  /** polities v2: the largest bloc (a sphere or a state) and its share of the people, folded into the
   * second stats line (not its own line) so the timeline bar is never taller than its pre-polities height. */
  const blocText = document.createElement('span')
  blocText.className = 'tl-bloc'
  const statusText = document.createElement('span')
  statusText.className = 'tl-status'
  const statLine1 = document.createElement('div')
  statLine1.append(aliveText, popText)
  const statLine2 = document.createElement('div')
  statLine2.append(tierText, blocText)
  stats.append(statLine1, statLine2, statusText)

  const speedBox = document.createElement('div')
  speedBox.className = 'tl-speed'
  const speedButtons: HTMLButtonElement[] = []
  for (const s of SPEEDS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn tl-speed-btn'
    b.textContent = s === 0.25 ? '¼×' : `${s}×`
    b.title = `${Math.round(s * YEARS_PER_SECOND)} years per second (${SPEEDS.indexOf(s) + 1})`
    b.setAttribute('aria-label', `Speed ${s === 0.25 ? 'one quarter' : s}×, ${Math.round(s * YEARS_PER_SECOND)} years per second`)
    b.addEventListener('click', () => {
      speed = s
      syncSpeed()
    })
    speedButtons.push(b)
    speedBox.appendChild(b)
  }

  row.append(playBtn, yearBox, stats, speedBox)

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.className = 'tl-slider'
  slider.min = '0'
  slider.max = '2000'
  slider.step = '1'
  slider.value = '0'
  slider.setAttribute('aria-label', 'Year')

  const ticks = document.createElement('div')
  ticks.className = 'tl-ticks'

  // "Continue past 2000": shown once, when playback first stops where it can go on
  const hint = document.createElement('button')
  hint.type = 'button'
  hint.className = 'btn tl-hint hidden'
  hint.title = 'Simulate further and play on (Space)'
  // the end-of-history notice (cap reached, extension failed): brief, non-blocking
  const note = document.createElement('div')
  note.className = 'tl-note hidden'
  note.setAttribute('role', 'status')

  root.append(progress, hint, note, row, slider, ticks)
  container.appendChild(root)

  let years = 0
  let interval = 1
  let enabled = false
  let year = 0
  let playing = false
  let waiting = false
  let speed: number = DEFAULT_SPEED
  let scrubbing = false
  let more: More = More.Yes
  /** Why the history cannot grow (with More.No), shown when playback stops at the end. */
  let endMessage = ''
  let softStop: number | null = null
  let leadSeconds = 0
  /** Year where playback last stopped by itself (soft stop or end) and could go on from; -1 for none. */
  let stopPoint = -1
  let hintShown = false
  let noteTimer = 0
  /** What to do once the history has grown (step or End pressed at the end). */
  let afterExtend: 'step' | 'end' | null = null
  let baseStatus = ''
  /** Label of the progress strip (setProgress), shown instead of baseStatus / "simulating…" while set. */
  let progressLabel: string | null = null
  let shownYear = -1
  let shownAlive = -1
  let shownPop = ''
  let shownTiers = ''
  let shownBloc = ''
  let marks: readonly TimelineMark[] = []
  let spark: { values: ArrayLike<number>; interval: number } | null = null
  const sparkCanvas = document.createElement('canvas')
  sparkCanvas.className = 'tl-spark'

  function syncSpeed() {
    speedButtons.forEach((b, i) => {
      b.classList.toggle('active', SPEEDS[i] === speed)
      b.setAttribute('aria-pressed', String(SPEEDS[i] === speed))
    })
  }
  syncSpeed()

  /** Paused where Play would simulate further (or play on into history already simulated past a stop). */
  const atContinue = () => enabled && !playing && more !== More.No && (year >= years - 1e-6 || (stopPoint >= 0 && Math.abs(year - stopPoint) < 1e-6))

  function syncPlay() {
    const cont = atContinue()
    playBtn.innerHTML = playing ? PAUSE_ICON : cont ? CONTINUE_ICON : PLAY_ICON
    const label = playing ? 'Pause' : cont ? `Continue past ${Math.round(year)}` : 'Play'
    playBtn.setAttribute('aria-label', label)
    playBtn.title = playing ? 'Pause (Space)' : cont ? `${label}: simulate further and play on (Space)` : 'Play (Space)'
    playBtn.classList.toggle('continue', cont)
    root.classList.toggle('playing', playing)
    root.classList.toggle('waiting', waiting)
    syncStatus()
    if (!cont && !hint.classList.contains('hidden')) hint.classList.add('hidden')
  }

  function syncStatus() {
    const s = progressLabel ?? (baseStatus !== '' ? baseStatus : waiting ? 'simulating…' : '')
    if (statusText.textContent !== s) statusText.textContent = s
    stats.classList.toggle('has-status', s !== '')
  }

  function showNote(text: string, ms: number) {
    window.clearTimeout(noteTimer)
    note.textContent = text
    note.classList.toggle('hidden', text === '')
    if (text !== '' && ms > 0) noteTimer = window.setTimeout(() => note.classList.add('hidden'), ms)
  }

  /** Playback stopped by itself at a point it can go on from: flag it, and the first time show the hint. */
  function stoppedAt(y: number) {
    stopPoint = y
    if (!hintShown && more !== More.No) {
      hintShown = true
      hint.textContent = `Continue past ${Math.round(y)} ▸`
      hint.classList.remove('hidden')
    }
  }

  function syncYear() {
    const y = Math.floor(year + 1e-6)
    if (y === shownYear) return
    shownYear = y
    yearValue.textContent = String(y)
    slider.setAttribute('aria-valuetext', `Year ${y}`)
    if (!scrubbing) slider.value = String(y)
    slider.style.setProperty('--fill', years > 0 ? `${(100 * y) / years}%` : '0%')
  }

  function settle() {
    callbacks.onSettled(year, playing)
  }

  function setYear(y: number) {
    year = Math.min(Math.max(y, 0), years)
    syncYear()
  }

  /** Labels every 500 years (1000 on long runs), and a subtle mark where the initial history ended once the range runs past it. */
  function buildTicks() {
    ticks.innerHTML = ''
    if (!enabled) return
    const stepYears = years > 4000 ? 1000 : years >= 1500 ? 500 : years >= 600 ? 200 : 100
    for (let t = 0; t <= years; t += stepYears) {
      const s = document.createElement('span')
      s.textContent = String(t)
      s.style.left = `${(100 * t) / years}%`
      ticks.appendChild(s)
    }
    // marks of great epidemics (click: jump there), and the world's people behind the slider
    marks.forEach((mk, k) => {
      if (mk.from > years) return
      const b = document.createElement('i')
      b.className = 'tl-epi'
      b.dataset.mark = String(k)
      b.title = mk.title
      b.style.left = `${(100 * Math.max(0, mk.from)) / years}%`
      b.style.width = `${(100 * Math.max(0, Math.min(years, mk.to) - mk.from)) / years}%`
      b.style.backgroundColor = mk.color
      ticks.appendChild(b)
    })
    if (spark) {
      ticks.appendChild(sparkCanvas)
      drawSpark()
    }
    if (years > BASE_YEARS) {
      const m = document.createElement('i')
      m.className = 'tl-mark'
      m.title = `Year ${BASE_YEARS}: the end of the initial history`
      m.style.left = `${(100 * BASE_YEARS) / years}%`
      ticks.appendChild(m)
    }
  }

  /** The sparkline over the range shown (drawn when the range or the values change). */
  function drawSpark() {
    if (!spark) return
    const w = Math.max(100, Math.round(ticks.clientWidth || 600))
    const hgt = 12
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    sparkCanvas.width = w * dpr
    sparkCanvas.height = hgt * dpr
    const ctx = sparkCanvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, hgt)
    const v = spark.values
    const n = Math.min(v.length, Math.floor(years / spark.interval) + 1)
    let max = 0
    for (let k = 0; k < n; k++) max = Math.max(max, v[k])
    if (n < 2 || max <= 0) return
    ctx.beginPath()
    ctx.moveTo(0, hgt)
    for (let k = 0; k < n; k++) ctx.lineTo(((k * spark.interval) / years) * w, hgt - (v[k] / max) * (hgt - 1))
    ctx.lineTo(((n - 1) * spark.interval / years) * w, hgt)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 214, 160, 0.16)'
    ctx.fill()
    ctx.beginPath()
    for (let k = 0; k < n; k++) {
      const x = ((k * spark.interval) / years) * w, y = hgt - (v[k] / max) * (hgt - 1)
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  /** Start (or continue) playing; at the end with more possible, hold and ask for more. */
  function start() {
    if (!enabled) return
    hint.classList.add('hidden')
    if (year >= years - 1e-6) {
      if (more !== More.No) {
        year = years
        playing = true
        waiting = true
        stopPoint = -1
        softStop = null
        syncPlay()
        settle()
        callbacks.onWantMore()
        return
      }
      if (endMessage !== '') showNote(endMessage, 6000)
      setYear(0)
    }
    if (softStop !== null && year >= softStop - 1e-6) softStop = null // going on past the stop
    stopPoint = -1
    playing = true
    syncPlay()
    settle()
  }

  function stop() {
    playing = false
    waiting = false
    afterExtend = null
    syncPlay()
  }

  const api: Timeline = {
    get year() {
      return year
    },
    get playing() {
      return playing
    },
    get waiting() {
      return waiting
    },
    get speed() {
      return speed
    },
    get scrubbing() {
      return scrubbing
    },
    get intro() {
      return playing && softStop !== null && year < softStop
    },
    setRange(y: number | null, iv: number, status = '') {
      enabled = y !== null && y > 0
      years = enabled ? (y as number) : 0
      interval = Math.max(1, iv)
      root.classList.toggle('disabled', !enabled)
      slider.disabled = !enabled
      playBtn.disabled = !enabled
      slider.max = String(years || 1)
      baseStatus = status
      waiting = false
      afterExtend = null
      stopPoint = -1
      softStop = null
      more = More.Yes
      endMessage = ''
      showNote('', 0)
      hint.classList.add('hidden')
      if (!enabled) {
        playing = false
        aliveText.textContent = ''
        popText.textContent = ''
        tierText.textContent = ''
        blocText.textContent = ''
        shownBloc = ''
        shownAlive = -1
        shownPop = ''
        shownTiers = ''
      }
      buildTicks()
      shownYear = -1
      setYear(0)
      syncPlay()
    },
    extendRange(y: number) {
      if (!enabled || !(y > years)) return
      years = y
      slider.max = String(years)
      buildTicks()
      shownYear = -1
      syncYear()
      const then = afterExtend
      afterExtend = null
      if (waiting) {
        waiting = false
        if (then === 'step') {
          playing = false
          api.step(1)
        } else if (then === 'end') {
          playing = false
          setYear(years)
          settle()
        }
      }
      syncPlay()
    },
    setMore(m: More, message = '', now = false) {
      more = m
      endMessage = m === More.No ? message : ''
      if (m === More.No) {
        afterExtend = null
        hint.classList.add('hidden')
        if (waiting) {
          // held at the end for history that will not come: stop there
          waiting = false
          playing = false
          settle()
          now = true
        }
        if (now && message !== '') showNote(message, 6000)
      }
      syncPlay()
    },
    setSoftStop(y: number | null) {
      softStop = y
    },
    setPrefetchLead(seconds: number) {
      leadSeconds = Math.max(0, seconds)
    },
    setYear(y: number) {
      setYear(y)
      syncPlay()
    },
    play() {
      start()
    },
    pause() {
      if (!playing) return
      stop()
      settle()
    },
    toggle() {
      if (playing) api.pause()
      else api.play()
    },
    step(dir: number) {
      if (!enabled) return
      softStop = null
      stopPoint = -1
      hint.classList.add('hidden')
      if (dir > 0 && year >= years - 1e-6 && more !== More.No) {
        // stepping on from the end: simulate further, then step
        playing = true
        waiting = true
        afterExtend = 'step'
        syncPlay()
        callbacks.onWantMore()
        return
      }
      stop()
      const s = dir > 0 ? Math.floor(year / interval + 1e-6) + dir : Math.ceil(year / interval - 1e-6) + dir
      setYear(s * interval)
      syncPlay()
      settle()
    },
    setSpeed(s: number) {
      if (!(SPEEDS as readonly number[]).includes(s)) return
      speed = s
      syncSpeed()
    },
    get yearsPerSecond() {
      if (!playing) return YEARS_PER_SECOND
      const introNow = softStop !== null && year < softStop
      return speed * (introNow ? INTRO_YEARS_PER_SECOND : YEARS_PER_SECOND)
    },
    tick(dt: number) {
      if (playing && !waiting && !scrubbing && enabled) {
        const introNow = softStop !== null && year < softStop
        const next = year + dt * speed * (introNow ? INTRO_YEARS_PER_SECOND : YEARS_PER_SECOND)
        if (softStop !== null && year < softStop && next >= softStop) {
          // the end of the initial animation
          const at = Math.min(softStop, years)
          softStop = null
          setYear(at)
          playing = false
          stoppedAt(at)
          syncPlay()
          settle()
          return year
        }
        setYear(next)
        if (more === More.Yes && years - year < Math.max(PREFETCH_YEARS, leadSeconds * speed * YEARS_PER_SECOND)) callbacks.onWantMore()
        if (year >= years) {
          if (more !== More.No) {
            waiting = true
            syncPlay()
            callbacks.onWantMore()
          } else {
            playing = false
            if (endMessage !== '') showNote(endMessage, 6000)
            syncPlay()
            settle()
          }
        }
      }
      return year
    },
    setMarks(m: readonly TimelineMark[] | null) {
      marks = m ? m.slice() : []
      buildTicks()
    },
    setSparkline(values: ArrayLike<number> | null, iv: number) {
      spark = values && values.length > 1 ? { values, interval: Math.max(1, iv) } : null
      buildTicks()
    },
    setProgress(label: string | null, frac: number | null) {
      progressLabel = label
      const shown = label !== null
      progress.classList.toggle('hidden', !shown)
      progress.classList.toggle('indeterminate', shown && frac === null)
      progressFill.style.width = shown && frac !== null ? `${Math.max(0, Math.min(1, frac)) * 100}%` : ''
      syncStatus()
    },
    setStats(alive: number, population: number, towns?: number, cities?: number, routes?: number, states?: number, wars?: number, largest?: string) {
      if (alive !== shownAlive) {
        shownAlive = alive
        aliveText.textContent = `${formatInt(alive)} ${alive === 1 ? 'settlement' : 'settlements'}`
      }
      const p = ` · ${formatPopulation(population)} people`
      if (p !== shownPop) {
        shownPop = p
        popText.textContent = p
      }
      const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`
      let t = towns === undefined ? '' : towns + (cities ?? 0) === 0 ? 'no towns yet' : `${plural(towns, 'town', 'towns')} · ${plural(cities ?? 0, 'city', 'cities')}`
      // polities: states, and wars while any is fought
      if (states !== undefined && states > 0) t += `${t ? ' · ' : ''}${plural(states, 'state', 'states')}`
      if (wars !== undefined && wars > 0) t += `${t ? ' · ' : ''}${plural(wars, 'war', 'wars')}`
      // (the bar is narrow: the open trade routes and the largest bloc are on hover; the wars, which
      // come and go, stay in view rather than being the first thing clipped)
      const full = t + (routes !== undefined && routes > 0 ? ` · ${formatInt(routes)} trade ${routes === 1 ? 'route' : 'routes'} open` : '')
      const bl = largest ? ` · Largest bloc: ${largest} of the people` : ''
      if (bl !== shownBloc) {
        shownBloc = bl
        blocText.textContent = bl
        blocText.title = largest ? `The largest bloc of states (a state with its vassals, or a state alone): ${largest.replace(/ (\d+%)$/, ', $1 of the people')}` : ''
      }
      if (full + bl !== shownTiers) {
        shownTiers = full + bl
        tierText.textContent = t
        statLine2.title = full + (largest ? ` · the largest bloc of states: ${largest.replace(/ (\d+%)$/, ', $1 of the people')}` : '')
      }
    },
  }

  ticks.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest('[data-mark]') as HTMLElement | null
    const mk = m ? marks[Number(m.dataset.mark)] : undefined
    if (!mk || !enabled) return
    softStop = null
    stopPoint = -1
    hint.classList.add('hidden')
    setYear(mk.from)
    syncPlay()
    settle()
  })
  playBtn.addEventListener('click', () => api.toggle())
  hint.addEventListener('click', () => api.play())
  slider.addEventListener('pointerdown', () => {
    scrubbing = true
    softStop = null
  })
  const endScrub = () => {
    if (!scrubbing) return
    scrubbing = false
    syncPlay()
    settle()
  }
  slider.addEventListener('pointerup', endScrub)
  slider.addEventListener('pointercancel', endScrub)
  slider.addEventListener('change', endScrub)
  slider.addEventListener('input', () => {
    softStop = null
    stopPoint = -1
    hint.classList.add('hidden')
    if (waiting) {
      // dragged away from the end while held there: play on from here
      waiting = false
      afterExtend = null
    }
    setYear(Number(slider.value))
    if (!scrubbing) {
      syncPlay()
      settle() // keyboard on the focused slider
    }
  })

  addShortcut({ keys: [' '], label: 'Space', description: 'Play / pause (at the end: simulate further)', group: 'Timeline', run: () => api.toggle() })
  addShortcut({ keys: ['ArrowLeft', 'ArrowRight'], shift: false, label: '← / →', description: 'Step one snapshot back / forward', group: 'Timeline', run: (e) => api.step(e.key === 'ArrowRight' ? 1 : -1) })
  addShortcut({ keys: ['ArrowLeft', 'ArrowRight'], shift: true, label: 'Shift+← / Shift+→', description: 'Step ten snapshots', group: 'Timeline', run: (e) => api.step(e.key === 'ArrowRight' ? 10 : -10) })
  addShortcut({
    keys: ['Home', 'End'],
    label: 'Home / End',
    description: 'First / last year (at the end: simulate further)',
    group: 'Timeline',
    run: (e) => {
      if (!enabled) return false
      softStop = null
      stopPoint = -1
      hint.classList.add('hidden')
      if (e.key === 'End' && year >= years - 1e-6 && more !== More.No) {
        playing = true
        waiting = true
        afterExtend = 'end'
        syncPlay()
        callbacks.onWantMore()
        return
      }
      if (playing) stop()
      setYear(e.key === 'Home' ? 0 : years)
      syncPlay()
      settle()
    },
  })
  addShortcut({
    keys: ['1', '2', '3', '4'],
    label: '1 – 4',
    description: `Speed ${SPEEDS.map((v) => (v === 0.25 ? '¼' : String(v)) + '×').join(', ')}`,
    group: 'Timeline',
    run: (e) => api.setSpeed(SPEEDS[Number(e.key) - 1]),
  })

  return api
}
