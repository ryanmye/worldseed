// Timeline bar: play/pause, scrub slider, year readout, speed and live stats.
// Owns the playback clock (a single `year` value); everything shown on the globe is
// derived from that year, so scrubbing in either direction is exact.

import { formatPopulation, formatInt } from './format.ts'

/** Simulated years per real second at 1x. */
export const YEARS_PER_SECOND = 20
export const SPEEDS = [0.25, 1, 4, 16] as const
const DEFAULT_SPEED = 1

export interface TimelineCallbacks {
  /** Playback state changed (play/pause/scrub end/step); not called every frame. */
  onSettled(year: number, playing: boolean): void
}

export interface Timeline {
  readonly year: number
  readonly playing: boolean
  readonly speed: number
  /** True while the user drags the slider. */
  readonly scrubbing: boolean
  /** Enable for a history of `years` with snapshots every `interval` years; null disables (and shows `status`). */
  setRange(years: number | null, interval: number, status?: string): void
  setYear(year: number): void
  play(): void
  pause(): void
  toggle(): void
  /** Move one snapshot forward (+1) or back (-1) and pause. */
  step(dir: number): void
  /** Advance the clock by dt seconds; returns the current year. */
  tick(dt: number): number
  /** Live stats; towns and cities are counted by population tier. */
  setStats(alive: number, population: number, towns?: number, cities?: number): void
}

const PLAY_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>'
const PAUSE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>'

export function createTimeline(container: HTMLElement, callbacks: TimelineCallbacks): Timeline {
  const root = document.createElement('div')
  root.className = 'panel timeline disabled'

  const row = document.createElement('div')
  row.className = 'tl-row'

  const playBtn = document.createElement('button')
  playBtn.type = 'button'
  playBtn.className = 'btn tl-play'
  playBtn.title = 'Play / pause (Space)'
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
  const statusText = document.createElement('span')
  statusText.className = 'tl-status'
  const statLine1 = document.createElement('div')
  statLine1.append(aliveText, popText)
  const statLine2 = document.createElement('div')
  statLine2.append(tierText)
  stats.append(statLine1, statLine2, statusText)

  const speedBox = document.createElement('div')
  speedBox.className = 'tl-speed'
  const speedButtons: HTMLButtonElement[] = []
  for (const s of SPEEDS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn tl-speed-btn'
    b.textContent = s === 0.25 ? '¼×' : `${s}×`
    b.title = `${s * YEARS_PER_SECOND} years per second`
    b.addEventListener('click', () => {
      speed = s
      syncSpeed()
      b.blur()
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

  const ticks = document.createElement('div')
  ticks.className = 'tl-ticks'

  root.append(row, slider, ticks)
  container.appendChild(root)

  let years = 0
  let interval = 1
  let enabled = false
  let year = 0
  let playing = false
  let speed: number = DEFAULT_SPEED
  let scrubbing = false
  let shownYear = -1
  let shownAlive = -1
  let shownPop = ''
  let shownTiers = ''

  function syncSpeed() {
    speedButtons.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === speed))
  }
  syncSpeed()

  function syncPlay() {
    playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON
    root.classList.toggle('playing', playing)
  }

  function syncYear() {
    const y = Math.floor(year + 1e-6)
    if (y === shownYear) return
    shownYear = y
    yearValue.textContent = String(y)
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

  const api: Timeline = {
    get year() {
      return year
    },
    get playing() {
      return playing
    },
    get speed() {
      return speed
    },
    get scrubbing() {
      return scrubbing
    },
    setRange(y: number | null, iv: number, status = '') {
      enabled = y !== null && y > 0
      years = enabled ? (y as number) : 0
      interval = Math.max(1, iv)
      root.classList.toggle('disabled', !enabled)
      slider.disabled = !enabled
      playBtn.disabled = !enabled
      slider.max = String(years || 1)
      statusText.textContent = status
      stats.classList.toggle('has-status', status !== '')
      if (!enabled) {
        playing = false
        syncPlay()
        aliveText.textContent = ''
        popText.textContent = ''
        tierText.textContent = ''
        shownAlive = -1
        shownPop = ''
        shownTiers = ''
      }
      ticks.innerHTML = ''
      if (enabled) {
        const stepYears = years >= 1500 ? 500 : years >= 600 ? 200 : 100
        for (let t = 0; t <= years; t += stepYears) {
          const s = document.createElement('span')
          s.textContent = String(t)
          s.style.left = `${(100 * t) / years}%`
          ticks.appendChild(s)
        }
      }
      shownYear = -1
      setYear(0)
    },
    setYear(y: number) {
      setYear(y)
    },
    play() {
      if (!enabled) return
      if (year >= years) setYear(0)
      playing = true
      syncPlay()
      settle()
    },
    pause() {
      if (!playing) return
      playing = false
      syncPlay()
      settle()
    },
    toggle() {
      if (playing) api.pause()
      else api.play()
    },
    step(dir: number) {
      if (!enabled) return
      playing = false
      syncPlay()
      const s = dir > 0 ? Math.floor(year / interval + 1e-6) + 1 : Math.ceil(year / interval - 1e-6) - 1
      setYear(s * interval)
      settle()
    },
    tick(dt: number) {
      if (playing && !scrubbing && enabled) {
        setYear(year + dt * speed * YEARS_PER_SECOND)
        if (year >= years) {
          playing = false
          syncPlay()
          settle()
        }
      }
      return year
    },
    setStats(alive: number, population: number, towns?: number, cities?: number) {
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
      const t = towns === undefined ? '' : towns + (cities ?? 0) === 0 ? 'no towns yet' : `${plural(towns, 'town', 'towns')} · ${plural(cities ?? 0, 'city', 'cities')}`
      if (t !== shownTiers) {
        shownTiers = t
        tierText.textContent = t
      }
    },
  }

  playBtn.addEventListener('click', () => {
    api.toggle()
    playBtn.blur()
  })
  slider.addEventListener('pointerdown', () => {
    scrubbing = true
  })
  const endScrub = () => {
    if (!scrubbing) return
    scrubbing = false
    settle()
  }
  slider.addEventListener('pointerup', endScrub)
  slider.addEventListener('pointercancel', endScrub)
  slider.addEventListener('change', endScrub)
  slider.addEventListener('input', () => {
    setYear(Number(slider.value))
    if (!scrubbing) settle() // keyboard on the focused slider
  })

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null
    if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault()
      api.toggle()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      api.step(e.key === 'ArrowRight' ? 1 : -1)
    }
  })

  return api
}
