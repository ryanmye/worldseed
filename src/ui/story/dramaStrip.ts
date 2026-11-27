// The drama strip (ui-additions 3, owner-approved): an intensity band just above the timeline's slider. Every scored
// chronicle entry (drama.ts S0) adds its score to its year, in its kind's colour: wars red, disasters and plagues orange,
// successions and dynasties violet, the rest gold; the director's beats are bright ticks over it. The band is smoothed
// over a few years so peaks read as hills. A click or tap jumps to the highest peak within a few pixels of it (the
// timeline pauses there, as a scrub would). Drawn to a canvas only when the data, the range or the size change.

import { DramaCat, type StaticDrama } from './drama.ts'

export interface DramaStrip {
  readonly root: HTMLElement
  /** The scores and the years of their entries (null: nothing to show); the beats' years. */
  setData(drama: StaticDrama | null, entryYear: ArrayLike<number> | null, beats: ArrayLike<number> | null): void
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

/**
 * lane N3 (throne slice): the seat's marks on every strip: the years of its decision cards (blue ticks) and the span it is
 * held from (a faint band), so the strip reads as the reign's own record while seated. null clears them.
 */
const stripsMarks = new Set<(m: { from: number; cards: number[] } | null) => void>()
export function setSeatMarks(m: { from: number; cards: number[] } | null): void {
  for (const f of stripsMarks) f(m)
}

export function createDramaStrip(onJump: (year: number) => void): DramaStrip {
  const root = document.createElement('div')
  root.className = 'tl-drama'
  root.title = 'The drama of each year: wars (red), disasters (orange), successions (violet), the rest (gold). Click a peak to go there.'
  root.setAttribute('role', 'img')
  root.setAttribute('aria-label', 'Drama over the years')
  const canvas = document.createElement('canvas')
  root.appendChild(canvas)
  let per: Float32Array[] = [] // per group, per year
  let total = new Float32Array(0)
  let beatYears: number[] = []
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
    // a soft square-root scale, so the quieter centuries still show
    const scale = (v: number) => Math.sqrt(v / max) * (HEIGHT - 3)
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
    g.fillStyle = 'rgba(255, 244, 214, 0.95)'
    for (const by of beatYears) if (by <= years) g.fillRect(Math.round((by / years) * w) - 0.5, 0, 1, 3)
    if (seatMarks) {
      g.fillStyle = 'rgba(140, 190, 255, 0.12)'
      const x0 = Math.round((seatMarks.from / years) * w)
      g.fillRect(x0, 0, w - x0, HEIGHT)
      g.fillStyle = 'rgba(150, 200, 255, 0.95)'
      for (const cy of seatMarks.cards) if (cy <= years) g.fillRect(Math.round((cy / years) * w) - 1, HEIGHT - 5, 2, 5)
    }
  }
  let seatMarks: { from: number; cards: number[] } | null = null
  stripsMarks.add((m) => { seatMarks = m; dirty = true; schedule() })
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
    const ya = Math.max(0, Math.floor(((x - SNAP_PX) / r.width) * years))
    const yb = Math.min(total.length - 1, Math.ceil(((x + SNAP_PX) / r.width) * years))
    let best = Math.round((x / r.width) * years), bv = -1
    for (let y = ya; y <= yb; y++) if (total[y] > bv) { bv = total[y]; best = y }
    onJump(Math.max(0, best - 2))
  })

  return {
    root,
    setData(drama, entryYear, beats) {
      beatYears = beats ? Array.from(beats) : []
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
