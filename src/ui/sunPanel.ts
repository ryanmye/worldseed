// Sun and render-quality controls, shown in the settings popover of the seed bar: sun
// mode (fixed / follows the camera / daylight everywhere), the fixed sun's longitude and
// latitude, and the quality preset. The sun can also be dragged on the globe (shift-drag
// or right-drag, see pointer.ts).

import { SUN_LAT_LIMIT, SunMode } from '../render/sun.ts'
import { QUALITIES, type Quality } from '../render/quality.ts'

export interface SunPanelCallbacks {
  onSunMode(mode: SunMode): void
  onSunLonLat(lon: number, lat: number): void
  onQuality(q: Quality): void
}

export interface SunPanel {
  root: HTMLElement
  /** Reflect the current sun state (e.g. after a drag on the globe). */
  setSun(mode: SunMode, lon: number, lat: number): void
  setQuality(q: Quality): void
}

const MODE_LABELS: [SunMode, string, string][] = [
  [SunMode.Fixed, 'Fixed', 'The sun stays put; the planet turns beneath it'],
  [SunMode.Follow, 'Follow', 'The sun follows the camera: whatever you look at is lit'],
  [SunMode.Full, 'Daylight', 'Daylight everywhere: no night side (city lights hidden)'],
]
const QUALITY_LABELS: Record<Quality, string> = { high: 'High', balanced: 'Balanced', phone: 'Phone', low: 'Low' }
const QUALITY_TITLES: Record<Quality, string> = {
  high: 'Sharpest: full pixel ratio, largest surface bake, display frame rate',
  balanced: 'Same look for much less work: capped pixel ratio and frame rates',
  phone: 'For phones: 1.5x pixel ratio, smaller surface bake, soft town shadows only, opaque panels',
  low: 'Least work: 1x pixel ratio, static clouds, low frame rates',
}

export function createSunPanel(callbacks: SunPanelCallbacks, initial: { mode: SunMode; lon: number; lat: number; quality: Quality }): SunPanel {
  const root = document.createElement('div')
  root.className = 'sun-panel'

  const row = (label: string) => {
    const r = document.createElement('div')
    r.className = 'sun-row'
    const l = document.createElement('span')
    l.className = 'sun-label'
    l.textContent = label
    r.appendChild(l)
    root.appendChild(r)
    return r
  }

  const modeRow = row('Sun')
  const modeButtons = new Map<SunMode, HTMLButtonElement>()
  const seg = document.createElement('div')
  seg.className = 'seg'
  for (const [mode, label, title] of MODE_LABELS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn seg-btn'
    b.textContent = label
    b.title = title
    b.addEventListener('click', (e) => {
      callbacks.onSunMode(mode)
      if (e.detail > 0) b.blur() // a mouse click: Space goes back to play / pause
    })
    modeButtons.set(mode, b)
    seg.appendChild(b)
  }
  modeRow.appendChild(seg)
  const slider = (label: string, min: number, max: number, title: string) => {
    const r = row(label)
    r.title = title
    const s = document.createElement('input')
    s.type = 'range'
    s.className = 'sun-slider'
    s.setAttribute('aria-label', title)
    s.min = String(min)
    s.max = String(max)
    s.step = '1'
    const v = document.createElement('span')
    v.className = 'sun-value'
    r.append(s, v)
    return { s, v }
  }
  const lon = slider('Lon', 0, 360, 'Sun longitude (shift-drag or right-drag on the globe to place the sun)')
  const lat = slider('Lat', -SUN_LAT_LIMIT, SUN_LAT_LIMIT, 'Sun latitude')
  const onSlide = () => callbacks.onSunLonLat(Number(lon.s.value), Number(lat.s.value))
  lon.s.addEventListener('input', onSlide)
  lat.s.addEventListener('input', onSlide)

  const qRow = row('Quality')
  const qSeg = document.createElement('div')
  qSeg.className = 'seg'
  const qButtons = new Map<Quality, HTMLButtonElement>()
  for (const q of QUALITIES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn seg-btn'
    b.textContent = QUALITY_LABELS[q]
    b.title = QUALITY_TITLES[q]
    b.addEventListener('click', (e) => {
      callbacks.onQuality(q)
      if (e.detail > 0) b.blur()
    })
    qButtons.set(q, b)
    qSeg.appendChild(b)
  }
  qRow.appendChild(qSeg)
  const fmt = (d: number) => `${Math.round(d)}°`
  const api: SunPanel = {
    root,
    setSun(mode: SunMode, lo: number, la: number) {
      for (const [m, b] of modeButtons) {
        b.classList.toggle('active', m === mode)
        b.setAttribute('aria-pressed', String(m === mode))
      }
      lon.s.value = String(Math.round(lo))
      lat.s.value = String(Math.round(la))
      lon.v.textContent = fmt(lo)
      lat.v.textContent = fmt(la)
      root.classList.toggle('sun-moving', mode !== SunMode.Fixed)
    },
    setQuality(q: Quality) {
      for (const [k, b] of qButtons) {
        b.classList.toggle('active', k === q)
        b.setAttribute('aria-pressed', String(k === q))
      }
    },
  }
  api.setSun(initial.mode, initial.lon, initial.lat)
  api.setQuality(initial.quality)
  return api
}
