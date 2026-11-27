// The drama strip (ui-additions 3, owner-approved): an intensity band just above the timeline's slider. Every scored
// chronicle entry (drama.ts S0) adds its score to its year, in its kind's colour: wars red, disasters and plagues orange,
// successions and dynasties violet, the rest gold. The band is smoothed over a few years and kept low (a background);
// the director's beats rise from it as peaks, each as tall as its score among the run's beats (surfacing lane, play-test 1:
// the band alone read as a smooth waveform with no distinct peaks). A click or tap jumps to the beat within a few pixels
// of it (and the caller shows its caption), else to the highest year there (the timeline pauses there, as a scrub would).
// Drawn to a canvas only when the data, the range or the size change.

import { DramaCat, type StaticDrama } from './drama.ts'

export interface DramaStrip {
  readonly root: HTMLElement
  /** The scores and the years of their entries (null: nothing to show); the beats' years. */
  setData(drama: StaticDrama | null, entryYear: ArrayLike<number> | null, beats: ArrayLike<number> | null, beatScores?: ArrayLike<number> | null, beatEntries?: ArrayLike<number> | null): void
  /** The timeline's range changed (the history grew). */
  setRange(years: number): void
}

/** Kind groups and their colours (rgb). */
const GROUPS: readonly [number, number, number][] = [
  [232, 92, 80], // war
  [240, 150, 60], // disasters, plague
  [176, 128, 240], // dynasty, politics
  [255, 208, 120], // the rest
]
const groupOf = (cat: number) => (cat === DramaCat.War ? 0 : cat === DramaCat.Plague || cat === DramaCat.Nature ? 1 : cat === DramaCat.Dynasty || cat === DramaCat.Politics ? 2 : 3)
const HEIGHT = 16
/** Smoothing half-width in years, and how far (CSS px) a tap looks for a peak. */
const SMOOTH_YEARS = 6
const SNAP_PX = 10

/** The band's share of the strip's height (the beats' peaks take the rest). */
const BAND = 0.4

export function createDramaStrip(onJump: (year: number, beat: number) => void): DramaStrip {
  const root = document.createElement('div')
  root.className = 'tl-drama'
  root.title = 'The drama of each year: wars (red), disasters (orange), successions (violet), the rest (gold). The peaks are the story\'s great moments: click one to go there and read it.'
  root.setAttribute('role', 'img')
  root.setAttribute('aria-label', 'Drama over the years')
  const canvas = document.createElement('canvas')
  root.appendChild(canvas)
  let per: Float32Array[] = [] // per group, per year
  let total = new Float32Array(0)
  let beatYears: number[] = []
  let beatScore: number[] = []
  let beatGroup: number[] = []
  let years = 0
  let dirty = true

  function draw() {
    const w = Math.max(1, Math.round(root.clientWidth))
    if (w <= 1 || years <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(HEIGHT * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${HEIGHT}px`
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, HEIGHT)
    if (total.length === 0) return
    // per pixel column: the max of each group over its years (peaks survive a long range)
    const cols = per.map(() => new Float32Array(w))
    let max = 1e-6
    for (let x = 0; x < w; x++) {
      const y0 = Math.floor((x / w) * years), y1 = Math.max(y0 + 1, Math.floor(((x + 1) / w) * years))
      let sum = 0
      for (let k = 0; k < per.length; k++) {
        let m = 0
        for (let y = y0; y < y1 && y < per[k].length; y++) m = Math.max(m, per[k][y])
        cols[k][x] = m
        sum += m
      }
      max = Math.max(max, sum)
    }
    // a soft square-root scale, so the quieter centuries still show (the band stays low: the beats are the peaks)
    const scale = (v: number) => Math.sqrt(v / max) * (HEIGHT - 3) * (beatYears.length ? BAND : 1)
    for (let x = 0; x < w; x++) {
      let cum = 0, prevH = 0
      for (let k = 0; k < per.length; k++) {
        const v = cols[k][x]
        if (v <= 0) continue
        cum += v
        const hgt = scale(cum)
        const [r, gg, b] = GROUPS[k]
        g.fillStyle = `rgba(${r}, ${gg}, ${b}, 0.85)`
        g.fillRect(x, HEIGHT - hgt, 1, hgt - prevH)
        prevH = hgt
      }
    }
    // the beats: a peak each, as tall as its score among the run's beats, in its kind's colour, with a bright tip
    const bmax = Math.max(1e-6, ...beatScore)
    for (let i = 0; i < beatYears.length; i++) {
      const by = beatYears[i]
      if (by > years) continue
      const x = Math.round((by / years) * w)
      const hgt = Math.max(4, Math.sqrt((beatScore[i] ?? bmax) / bmax) * (HEIGHT - 1))
      const [r, gg, b] = GROUPS[beatGroup[i] ?? 3]
      g.fillStyle = `rgba(${r}, ${gg}, ${b}, 0.95)`
      g.beginPath()
      g.moveTo(x - 2.5, HEIGHT)
      g.lineTo(x, HEIGHT - hgt)
      g.lineTo(x + 2.5, HEIGHT)
      g.closePath()
      g.fill()
      g.fillStyle = 'rgba(255, 244, 214, 0.95)'
      g.fillRect(x - 0.5, HEIGHT - hgt, 1, 2)
    }
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { dirty = true; schedule() }) : null
  ro?.observe(root)
  let raf = 0
  function schedule() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (!dirty) return
      dirty = false
      draw()
    })
  }
  root.addEventListener('click', (e) => {
    if (years <= 0 || total.length === 0) return
    const r = root.getBoundingClientRect()
    const x = e.clientX - r.left
    // a beat's peak within SNAP_PX: go there, and the caller shows its caption
    let bi = -1, bd = SNAP_PX + 1
    for (let i = 0; i < beatYears.length; i++) {
      const d = Math.abs((beatYears[i] / years) * r.width - x)
      if (d < bd) { bd = d; bi = i }
    }
    if (bi >= 0) { onJump(beatYears[bi], bi); return }
    const ya = Math.max(0, Math.floor(((x - SNAP_PX) / r.width) * years))
    const yb = Math.min(total.length - 1, Math.ceil(((x + SNAP_PX) / r.width) * years))
    let best = Math.round((x / r.width) * years), bv = -1
    for (let y = ya; y <= yb; y++) if (total[y] > bv) { bv = total[y]; best = y }
    onJump(Math.max(0, best - 2), -1)
  })

  return {
    root,
    setData(drama, entryYear, beats, scores, entries) {
      beatYears = beats ? Array.from(beats) : []
      beatScore = scores ? Array.from(scores) : beatYears.map(() => 1)
      beatGroup = entries && drama ? Array.from(entries, (n) => groupOf(drama.cat[n])) : beatYears.map(() => 3)
      if (!drama || !entryYear) {
        per = []
        total = new Float32Array(0)
      } else {
        let last = 0
        for (let n = 0; n < drama.score.length; n++) if (drama.score[n] > 0) last = Math.max(last, entryYear[n])
        const Y = Math.ceil(last) + SMOOTH_YEARS + 1
        per = GROUPS.map(() => new Float32Array(Y))
        for (let n = 0; n < drama.score.length; n++) {
          const sc = drama.score[n]
          if (!(sc > 0)) continue
          const y = Math.round(entryYear[n])
          const arr = per[groupOf(drama.cat[n])]
          // a triangle over ±SMOOTH_YEARS
          for (let d = -SMOOTH_YEARS; d <= SMOOTH_YEARS; d++) {
            const q = y + d
            if (q >= 0 && q < Y) arr[q] += sc * (1 - Math.abs(d) / (SMOOTH_YEARS + 1))
          }
        }
        total = new Float32Array(Y)
        for (const a of per) for (let y = 0; y < Y; y++) total[y] += a[y]
      }
      dirty = true
      schedule()
    },
    setRange(y) {
      if (y === years) return
      years = y
      dirty = true
      schedule()
    },
  }
}
