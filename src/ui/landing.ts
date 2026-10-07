// The start page: shown at the bare URL (and with intro=1; main.ts decides), before the app. A dark page under the
// app's starry sky, with
// the title, a seed field (with a dice to roll a new one), a years field and Start; below it the real planet of
// the seed in the field, its top rising into the first screen like a sunrise and slowly turning; further down,
// what worldseed is and how to use it (the words: landingCopy.ts).
//
// The planet is the app's own: the same WebGL canvas and scene (main.ts), here lying in the page under the
// fields (the canvas, window-sized, is placed in the document so that it scrolls with the page for free, no
// redraw on scroll), drawn on the app's own dark with the camera set back so the disc fills the slot reserved for
// it (main.ts reads discRho()).
//
// The sky: the app's starfield as the app will show it once started (main.ts draws it, takeSky(), with the app's
// camera) onto a window-sized canvas fixed to the window, so the stars stay put while the page (and the planet
// with it) scrolls; it lies over the planet's canvas, which draws no stars meanwhile, screened onto it (stars add
// light, as in the app), with a hole where the disc is (a mask in page coordinates, so it scrolls with the disc
// while the stars it holds stay fixed). During the hand-over the hole follows the planet (setDisc) and the stars do
// not move; at the end the canvas's own stars, the same ones in the same places, take over. A new seed in the field asks main.ts for that world (debounced; a shimmer over
// the slot meanwhile); the world is generated in the worker without its history.
//
// Planting (the button under Start, "Choose where peoples begin"): the page scrolls the planet into full view and hands
// the globe to main.ts's hearth picker (ui/hearthPicker.ts, its bar placed over the disc): the canvas takes the pointer
// (a drag turns the globe, a click plants or takes away a numbered hearth), the slow turn stops. Done (or Esc, or the
// button again) leaves it; the button then says how many hearths are planted. Start passes them on (main.ts: the
// history's cradles, c= in the address).
//
// Start (or Enter in a field): main.ts starts the history at once, and the page hands over to the app in about
// 1.2 s (frame(), driven by the render loop so the canvas, the camera and the colours move in the same frame):
// the canvas is fixed to the window at its current place on screen and slides to the top, while main.ts moves the
// camera from the landing distance to the app's and the view's centre to the app's free rect; the stars stay; the
// fields and text fade out; the app's bars fade in. With prefers-reduced-motion it is a short fade instead. Then the page is removed and the document is the
// app's again (no scrolling).

import { LANDING_COPY as C } from './landingCopy.ts'
import './landing.css'

/** The controls' own words (the page's text is in landingCopy.ts). */
const UI = {
  siteText: 'ryanmye.github.io',
  siteUrl: 'https://ryanmye.github.io',
  seedLabel: 'Random Seed',
  randomButton: 'Roll a new seed',
  yearsLabel: 'Years',
  yearsHint: 'How many years of history to simulate (200 to 6000)',
  start: 'Start',
  plant: 'Choose where peoples begin',
  plantDone: 'Done planting',
  planted: (n: number) => `${n} ${n === 1 ? 'hearth' : 'hearths'} planted · change`,
  plantTitle: 'Plant the first hearths: click places on the globe where the first peoples begin',
}

/** The years field's range (the timeline extends further later, to the app's MAX_YEARS). */
export const YEARS_MIN = 200
export const YEARS_MAX = 6000
const YEARS_STEP = 100
const DURATION_MS = 1200
const REDUCED_MS = 500
const SEED_DEBOUNCE_MS = 450

export interface LandingFrame {
  /** Geometry from the landing (0) to the app (1): camera distance, view centre, the canvas's place. */
  geom: number
  /** The page has been handed over: main.ts finishes (controls, keys) and drops the landing. */
  done: boolean
}

export interface LandingDeps {
  canvas: HTMLCanvasElement
  seed: number
  years: number
  /** A new seed in the field (debounced): show that planet. */
  onSeed(seed: number): void
  /** Start: begin the history of `seed`, `years` long (the hand-over then runs through frame()). */
  onStart(seed: number, years: number): void
  /** The planet's slot scrolled into or out of view (the slow turn pauses while it is out). */
  onVisible(visible: boolean): void
  /** Something on the page changed what the canvas shows (its place, the colours): draw. */
  wake(): void
  /** Planting the first hearths begins (true; the page has scrolled the planet into view) or ends (false: Start, or the button again). */
  onPlant?(on: boolean): void
}

export interface Landing {
  /** The landing disc's radius as a fraction of the canvas half-height (camera distance, main.ts). */
  discRho(): number
  /** The world for the field's seed is on its way (true) or shown (false). */
  setLoading(on: boolean): void
  /** The sky canvas, when its stars need drawing (first, after a resize, at Start); null otherwise. */
  takeSky(): HTMLCanvasElement | null
  /** During the hand-over: the planet's place on its canvas (centre offset from the canvas's, radius; CSS px). */
  setDisc(dx: number, dy: number, r: number): void
  /** The hand-over is running: the render loop must draw every frame. */
  readonly leaving: boolean
  /** The state of the hand-over at time `ts` (also places the canvas and colours the page). */
  frame(ts: number): LandingFrame
  /** The hearth picker's bar, placed over the planet's disc. */
  mountPlantBar(bar: HTMLElement): void
  /** Planting is over (Done in the bar, Esc): the page is a page again; `planted` hearths are kept. */
  endPlanting(planted: number): void
  readonly planting: boolean
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const DICE_SVG =
  '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="7" r="1.4" fill="currentColor"/><circle cx="13" cy="13" r="1.4" fill="currentColor"/><circle cx="13" cy="7" r="1.4" fill="currentColor"/><circle cx="7" cy="13" r="1.4" fill="currentColor"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/></svg>'

export const randomSeed = () => Math.floor(Math.random() * 1_000_000)

export function createLanding(deps: LandingDeps): Landing {
  const doc = document.documentElement
  doc.classList.add('landing-mode', 'ui-veiled')
  const root = el('div', 'landing')
  root.id = 'landing'

  // ---------- header, title, fields ----------
  const header = el('header', 'landing-header')
  const site = el('a', 'landing-site', UI.siteText)
  site.href = UI.siteUrl
  site.target = '_blank'
  site.rel = 'noopener'
  header.appendChild(site)

  const hero = el('main', 'landing-hero')
  const title = el('h1', 'landing-title', C.title)
  const subtitle = el('p', 'landing-subtitle', C.subtitle)

  const form = el('form', 'landing-form')
  form.noValidate = true
  form.setAttribute('aria-label', 'Start a world')
  const fields = el('div', 'landing-fields')

  const seedField = el('div', 'landing-field landing-seed')
  const seedLabel = el('label', 'landing-label', UI.seedLabel)
  seedLabel.htmlFor = 'landing-seed'
  const seedRow = el('div', 'landing-input-row')
  const seedInput = el('input', 'landing-input')
  seedInput.id = 'landing-seed'
  seedInput.type = 'text'
  seedInput.inputMode = 'numeric'
  seedInput.autocomplete = 'off'
  seedInput.spellcheck = false
  seedInput.value = String(deps.seed)
  const dice = el('button', 'landing-dice')
  dice.type = 'button'
  dice.innerHTML = DICE_SVG + '<span>Random</span>'
  dice.title = UI.randomButton
  dice.setAttribute('aria-label', UI.randomButton)
  seedRow.append(seedInput, dice)
  seedField.append(seedLabel, seedRow)

  const yearsField = el('div', 'landing-field landing-years')
  const yearsLabel = el('label', 'landing-label', UI.yearsLabel)
  yearsLabel.htmlFor = 'landing-years'
  const yearsInput = el('input', 'landing-input')
  yearsInput.id = 'landing-years'
  yearsInput.type = 'number'
  yearsInput.min = String(YEARS_MIN)
  yearsInput.max = String(YEARS_MAX)
  yearsInput.step = String(YEARS_STEP)
  yearsInput.value = String(deps.years)
  yearsInput.title = UI.yearsHint
  yearsInput.setAttribute('aria-describedby', 'landing-years-hint')
  const yearsHint = el('span', 'landing-sr', UI.yearsHint)
  yearsHint.id = 'landing-years-hint'
  yearsField.append(yearsLabel, yearsInput, yearsHint)
  fields.append(seedField, yearsField)

  const start = el('button', 'landing-start', UI.start)
  start.type = 'submit'
  const plantBtn = el('button', 'landing-plant', UI.plant)
  plantBtn.type = 'button'
  plantBtn.title = UI.plantTitle
  plantBtn.setAttribute('aria-pressed', 'false')
  form.append(fields, start, plantBtn)
  hero.append(title, subtitle, form)

  // ---------- the planet's slot ----------
  const slot = el('section', 'landing-globe')
  slot.setAttribute('aria-label', 'The planet of this seed')
  const disc = el('div', 'landing-disc')
  const shimmer = el('div', 'landing-shimmer')
  disc.appendChild(shimmer)
  slot.appendChild(disc)

  // ---------- about ----------
  const about = el('section', 'landing-about')
  const colA = el('div', 'landing-col')
  colA.appendChild(el('h2', 'landing-h2', C.left.heading))
  for (const p of C.left.paragraphs) colA.appendChild(el('p', 'landing-p', p))
  const colB = el('div', 'landing-col')
  colB.appendChild(el('h2', 'landing-h2', C.right.heading))
  for (const p of C.right.paragraphs) colB.appendChild(el('p', 'landing-p', p))
  about.append(colA, colB)

  root.append(header, hero, slot, about)
  document.body.insertBefore(root, document.body.firstChild)

  // ---------- the sky ----------
  // (outside the page's own layer, which is isolated by its fade: the screen blend reaches the planet's canvas)
  const sky = el('div', 'landing-sky')
  sky.setAttribute('aria-hidden', 'true')
  const skyCanvas = el('canvas', 'landing-sky-canvas')
  sky.appendChild(skyCanvas)
  document.body.appendChild(sky)
  let skyDirty = true

  // ---------- the canvas in the page ----------
  // (the hand-over's state, see frame)
  let leaving = false
  let t0 = -1
  let y0 = 0
  let reduced = false
  let geomNow = 0
  let uiShown = false
  const canvas = deps.canvas
  /** Centre the window-sized canvas on the disc, in document coordinates (it then scrolls with the page). */
  function placeCanvas() {
    if (leaving) return
    const r = disc.getBoundingClientRect()
    const top = r.top + window.scrollY + r.height / 2 - window.innerHeight / 2
    canvas.style.top = `${Math.round(top)}px`
    // (a classic scrollbar narrows the page: keep the disc centred on it)
    canvas.style.left = `${Math.round((doc.clientWidth - window.innerWidth) / 2)}px`
    // the sky's hole over the disc (page coordinates)
    const cx = r.left + window.scrollX + r.width / 2
    const cy = r.top + window.scrollY + r.height / 2
    setHole(cx, cy, r.height / 2)
    deps.wake()
  }
  function setHole(cx: number, cy: number, rad: number) {
    sky.style.setProperty('--hole', `radial-gradient(circle at ${cx.toFixed(1)}px ${cy.toFixed(1)}px, transparent ${(rad - 0.5).toFixed(1)}px, #000 ${(rad + 0.5).toFixed(1)}px)`)
  }
  function resized() {
    skyDirty = true
    placeCanvas()
  }
  placeCanvas()
  window.addEventListener('resize', resized)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placeCanvas) : null
  ro?.observe(root)
  // the slow turn only while the planet is on screen
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => deps.onVisible(es[es.length - 1].isIntersecting)) : null
  io?.observe(disc)

  // ---------- seed and years ----------
  let shownSeed = deps.seed
  let seedTimer = 0
  const parseSeed = () => {
    const v = Number.parseInt(seedInput.value.trim(), 10)
    return Number.isFinite(v) ? v : null
  }
  function seedChanged(delay: number) {
    window.clearTimeout(seedTimer)
    const s = parseSeed()
    seedInput.setAttribute('aria-invalid', String(s === null))
    if (s === null || s === shownSeed) return
    seedTimer = window.setTimeout(() => {
      seedTimer = 0
      shownSeed = s
      deps.onSeed(s)
    }, delay)
  }
  seedInput.addEventListener('input', () => seedChanged(SEED_DEBOUNCE_MS))
  dice.addEventListener('click', () => {
    seedInput.value = String(randomSeed())
    seedChanged(150)
  })
  const years = () => {
    const v = Number.parseInt(yearsInput.value, 10)
    const y = Number.isFinite(v) ? v : 2000
    return Math.min(YEARS_MAX, Math.max(YEARS_MIN, Math.round(y / YEARS_STEP) * YEARS_STEP))
  }
  yearsInput.addEventListener('change', () => (yearsInput.value = String(years())))
  // Enter in either field starts (as the form's own submission would, without relying on it)
  for (const input of [seedInput, yearsInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      e.preventDefault()
      form.requestSubmit()
    })
  }

  // ---------- planting the first hearths ----------
  let planting = false
  let planted = 0
  const syncPlant = () => {
    plantBtn.textContent = planting ? UI.plantDone : planted > 0 ? UI.planted(planted) : UI.plant
    plantBtn.setAttribute('aria-pressed', String(planting))
    doc.classList.toggle('landing-planting', planting)
  }
  function setPlanting(on: boolean) {
    if (on === planting || leaving) return
    planting = on
    syncPlant()
    if (on) {
      const r = disc.getBoundingClientRect()
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: Math.max(0, r.top + window.scrollY + r.height / 2 - window.innerHeight / 2), behavior: reduce ? 'auto' : 'smooth' })
    }
    deps.onPlant?.(on)
  }
  plantBtn.addEventListener('click', () => setPlanting(!planting))

  // ---------- Start and the hand-over ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (leaving) return
    if (planting) setPlanting(false)
    const s = parseSeed()
    if (s === null) {
      seedInput.focus()
      return
    }
    window.clearTimeout(seedTimer)
    const y = years()
    yearsInput.value = String(y)
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // the canvas leaves the page for the window, where it is now on screen
    y0 = canvas.getBoundingClientRect().top
    leaving = true
    io?.disconnect()
    ro?.disconnect()
    window.removeEventListener('resize', resized)
    canvas.style.top = '0px'
    canvas.style.left = '0px'
    canvas.style.transform = `translateY(${y0}px)`
    // (the sky, fixed to the window now, keeps its hole over the disc: in window coordinates)
    const r = disc.getBoundingClientRect()
    setHole(r.left + r.width / 2, r.top + r.height / 2, r.height / 2)
    doc.classList.add('landing-leaving')
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    root.setAttribute('aria-hidden', 'true')
    shownSeed = s
    deps.onStart(s, y)
    // the app's bars have their places now: the stars as the app will show them
    skyDirty = true
    deps.wake()
  })

  function finish() {
    root.remove()
    sky.remove()
    doc.classList.remove('landing-mode', 'landing-leaving', 'ui-veiled')
    canvas.style.top = canvas.style.left = canvas.style.transform = canvas.style.opacity = ''
    window.scrollTo(0, 0)
  }

  return {
    discRho: () => disc.getBoundingClientRect().height / Math.max(1, window.innerHeight),
    setLoading(on) {
      slot.classList.toggle('landing-loading', on)
      plantBtn.disabled = on && !planting
    },
    mountPlantBar(bar) {
      bar.classList.remove('in-app')
      bar.classList.add('in-landing')
      disc.appendChild(bar)
    },
    endPlanting(n) {
      planted = n
      if (planting) {
        planting = false
        syncPlant()
      } else syncPlant()
    },
    get planting() {
      return planting
    },
    takeSky() {
      if (!skyDirty) return null
      skyDirty = false
      return skyCanvas
    },
    setDisc(dx, dy, r) {
      if (!leaving) return
      const ty = geomNow >= 1 ? 0 : y0 * (1 - geomNow)
      setHole(window.innerWidth / 2 + dx, ty + window.innerHeight / 2 + dy, r)
    },
    get leaving() {
      return leaving
    },
    frame(ts) {
      if (!leaving) return { geom: 0, done: false }
      if (t0 < 0) t0 = ts
      const dur = reduced ? REDUCED_MS : DURATION_MS
      const p = Math.min(1, (ts - t0) / dur)
      let geom: number
      if (reduced) {
        // a fade: out at the landing's place, in at the app's (the stars stay)
        geom = p < 0.5 ? 0 : 1
        canvas.style.opacity = String(p < 0.5 ? 1 - 2 * p : 2 * p - 1)
      } else geom = ease(p)
      geomNow = geom
      canvas.style.transform = geom >= 1 ? '' : `translateY(${(y0 * (1 - geom)).toFixed(2)}px)`
      if (!uiShown && p >= (reduced ? 0.5 : 0.55)) {
        uiShown = true
        doc.classList.remove('ui-veiled')
      }
      const done = p >= 1
      if (done) finish()
      return { geom, done }
    },
  }
}
