// Peoples in the UI: the Peoples panel (right column), the known-world banner, the people
// section of the inspector, and the controller that ties them to the globe.
//
// Selecting a people (a panel row, "Show known world" in the inspector, or people=<id>)
// shows the world as that people knew it at the current year: the known-world mist
// (render/knownWorld.ts) covers the cells it did not know, and settlement markers, labels
// and 3D models there are hidden by per-layer masks. "Unexplored" (known=all) shows what
// nobody knew yet. Esc, the banner's close button or the selected row again go back to
// the normal view. The masks and the mist's per-cell texture are made once per selection
// (and per history swap); per frame only the year moves, so what is shown is a pure
// function of the year and the selection.
//
// Everything here is optional: a history without peoples data (peoplesData.ts) hides the
// panel, and selections are ignored.
//
// DOM writes happen only when a shown value changes; the per-frame update compares numbers.

import * as THREE from 'three'
import { TECH_FIELD_COUNT, type History, type World } from '../contract.ts'
import { buildContactPulses, buildKnownWorldFog, type ContactPulses, type KnownWorldFog } from '../render/knownWorld.ts'
import type { SettlementLayer } from '../render/settlements.ts'
import type { LabelLayer } from '../render/labels.ts'
import type { DioramaLayer } from '../render/dioramas/layer.ts'
import { requestRender } from '../render/invalidate.ts'
import { formatInt, formatPopulation, PeoplesEvent, TECH_FIELD_NAMES } from './format.ts'
import { NORM_YEARS, type HistoryIndex } from './historyIndex.ts'
import { ANYONE, cellKnownYears, contactOf, knownShare, metCount, NEVER_YEAR, type PeoplesData } from './peoplesData.ts'
import { loadFlag, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { HabitLine, SpeciesChips, TechniqueCount } from './speciesPanel.ts'
import './peoples.css'

/** A known-world selection: a people id, ANYONE (the unexplored world), or null (normal view). */
export type PeopleSelection = number | null

export interface PeoplesTargets {
  settlements: SettlementLayer | null
  labels: LabelLayer | null
  dioramas: DioramaLayer | null
}

export interface PeoplesViewDeps {
  /** Right column (the panel goes in before the chronicle). */
  right: HTMLElement
  /** Bottom slot (the banner goes in above the timeline). */
  bottom: HTMLElement
  /** The inspector's people slot. */
  inspectorSlot: HTMLElement
  planetGroup: THREE.Group
  setUrlParam(name: string, value: string | null): void
  /** The known world shown changed (null: the whole world again), after the masks are applied. */
  onSelectionChange?(sel: PeopleSelection): void
}

export interface PeoplesView {
  /** A new world: drop everything (the mist is rebuilt for it on demand). */
  setWorld(world: World): void
  /** A history was committed (`extend`: a longer run of the one shown; the selection is kept). */
  setIndex(index: HistoryIndex, world: World, targets: PeoplesTargets, extend: boolean): void
  select(sel: PeopleSelection): void
  readonly selection: PeopleSelection
  /** The inspector shows settlement `id` (-1: none). */
  showSettlement(id: number): void
  /** Settlement markers coloured by people. */
  setTint(on: boolean): void
  setMarkersVisible(on: boolean): void
  /** Whether cell `cell` is covered by the mist at the current year. */
  hidesCell(cell: number): boolean
  /** Per cell, the year from which the known world shown includes it (1e9 never), or null in the normal view. */
  readonly knownCells: Float32Array | null
  /** Per frame. */
  tick(year: number, s0: number, pulseYears: number, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
}

/** Sickness lines of the selected people (childhood sicknesses, fever, great epidemics suffered: ui/diseasePanel.ts), or null without disease data. */
let peopleDiseaseNote: ((p: number, year: number, s0: number) => string[]) | null = null
export function setPeopleDiseaseNote(fn: ((p: number, year: number, s0: number) => string[]) | null): void {
  peopleDiseaseNote = fn
}

/** ideas: lines of the selected people (ideas held, own and received, the latest, lost and refused: ui/ideasPanel.ts), and the idea behind a technology bar, or null without ideas. */
let peopleIdeasNote: ((p: number, year: number) => string[]) | null = null
export function setPeopleIdeasNote(fn: ((p: number, year: number) => string[]) | null): void {
  peopleIdeasNote = fn
}
let peopleTechNote: ((p: number, field: number, year: number) => string) | null = null
export function setPeopleTechNote(fn: ((p: number, field: number, year: number) => string) | null): void {
  peopleTechNote = fn
}

const pct = (x: number) => (x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`)

/** Technology levels when the history has them: technology[(s * P + p) * TECH_FIELD_COUNT + f]. */
function technologyOf(h: History, P: number): Float32Array | null {
  const t = (h as Partial<History>).technology
  return t instanceof Float32Array && t.length >= h.snapshotCount * P * TECH_FIELD_COUNT ? t : null
}

/** Cradle per people, when the history has them (else null). */
function cradlesOf(h: History, P: number): Int32Array | null {
  const ps = (h as Partial<History>).peoples
  if (!Array.isArray(ps) || ps.length !== P) return null
  const out = new Int32Array(P)
  for (let p = 0; p < P; p++) {
    const c = (ps[p] as { cradle?: number }).cradle
    if (typeof c !== 'number') return null
    out[p] = c
  }
  return out
}

interface Row {
  p: number
  el: HTMLButtonElement
  sett: HTMLSpanElement
  pop: HTMLSpanElement
  met: HTMLSpanElement
  known: HTMLSpanElement
  bars: HTMLSpanElement[]
  /** The species the people holds (when the history has species). */
  chips: SpeciesChips | null
  /** Its habits and techniques (when the history has species), on a line of their own while it has any. */
  extra: { el: HTMLSpanElement; habits: HabitLine; techs: TechniqueCount; on: boolean } | null
  /** What the row shows (numbers compared before any text is made). */
  shown: { alive: number; pop: number; met: number; known: number; tech: number; selected: boolean }
}

/** Percent shown for a share: whole percents, -1 standing for "under 1%" (not 0). */
const pctKey = (x: number) => (x > 0 && x < 0.005 ? -1 : Math.round(x * 100))
const pctText = (k: number) => (k < 0 ? '<1%' : `${k}%`)

export function createPeoplesView(deps: PeoplesViewDeps): PeoplesView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel peoples hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'pp-head'
  head.title = 'Show or hide the peoples (P)'
  const title = document.createElement('span')
  title.className = 'pp-title'
  title.textContent = 'Peoples'
  const count = document.createElement('span')
  count.className = 'pp-count'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'pp-body'
  body.id = 'peoples-body'
  head.setAttribute('aria-controls', body.id)
  const cols = document.createElement('div')
  cols.className = 'pp-cols'
  cols.innerHTML = '<span></span><span>People</span><span title="Living settlements">Sett.</span><span title="Population">Pop.</span><span title="Other peoples met">Met</span><span title="Share of the world known">Known</span>'
  const list = document.createElement('div')
  list.className = 'pp-list'
  const anyoneBtn = document.createElement('button')
  anyoneBtn.type = 'button'
  anyoneBtn.className = 'pp-anyone'
  anyoneBtn.title = 'Show what no people knows yet (K)'
  const anyoneText = document.createElement('span')
  anyoneText.className = 'pp-anyone-text'
  anyoneText.textContent = 'Unexplored world'
  const anyoneStat = document.createElement('span')
  anyoneStat.className = 'pp-anyone-stat'
  anyoneBtn.append(anyoneText, anyoneStat)
  const note = document.createElement('div')
  note.className = 'pp-note'
  note.textContent = 'Click a people to see the world as it knew it.'
  // the selected people's sickness (diseasePanel.ts), over the list
  const diseaseNote = document.createElement('div')
  diseaseNote.className = 'pp-disease hidden'
  let shownDiseaseNote = ''
  body.append(diseaseNote, cols, list, anyoneBtn, note)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))

  let collapsed = loadFlag('worldseed.peoples.collapsed', false)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.peoples.collapsed', collapsed)
    syncCollapsed()
    forceRefresh()
  }
  head.addEventListener('click', toggleCollapsed)

  // ---------- banner ----------
  const banner = document.createElement('div')
  banner.className = 'panel known-banner hidden'
  banner.setAttribute('role', 'status')
  const bSwatch = document.createElement('span')
  bSwatch.className = 'pp-swatch'
  const bText = document.createElement('span')
  bText.className = 'kb-text'
  const bLabel = document.createElement('span')
  const bYear = document.createElement('span')
  bText.append(bLabel, bYear)
  const bClose = document.createElement('button')
  bClose.type = 'button'
  bClose.className = 'kb-close'
  bClose.title = 'Back to the whole world (Esc)'
  bClose.setAttribute('aria-label', 'Close the known-world view')
  bClose.textContent = '×'
  banner.append(bSwatch, bText, bClose)
  deps.bottom.insertBefore(banner, deps.bottom.firstChild)
  bClose.addEventListener('click', () => api.select(null))

  // ---------- inspector section ----------
  const slot = deps.inspectorSlot
  const ipLine = document.createElement('div')
  ipLine.className = 'ip-line'
  const ipContacts = document.createElement('div')
  ipContacts.className = 'ip-contacts'
  const ipKnown = document.createElement('div')
  ipKnown.className = 'ip-known'
  slot.append(ipLine, ipContacts, ipKnown)

  // ---------- state ----------
  let world: World | null = null
  let index: HistoryIndex | null = null
  let data: PeoplesData | null = null
  let targets: PeoplesTargets = { settlements: null, labels: null, dioramas: null }
  let selection: PeopleSelection = null
  let fog: KnownWorldFog | null = null
  let pulses: ContactPulses | null = null
  let markersVisible = true
  let tint = false
  let rows: Row[] = []
  let tech: Float32Array | null = null
  let techMax = 1
  /** Per-cell known years of the selection (the mist's and the masks' source), or null. */
  let cellYears: Float32Array | null = null
  let year = 0
  let shownYear = NaN
  let shownS0 = -1
  let shownBannerYear = NaN
  let shownCount = -1
  let shownAnyone = -2
  let shownKnownKey = -2
  let inspected = -1
  let shownInspKey = -1
  let shownInspContacts = -1
  /** Contacts of the inspected settlement's people, by year. */
  let inspContacts: { p: number; year: number }[] = []
  const share = { land: 0, all: 0 }

  const forceRefresh = () => {
    shownYear = NaN
    shownS0 = -1
    shownInspKey = -1
    shownInspContacts = -1
    shownKnownKey = -2
    shownCount = -1
    shownAnyone = -2
    shownBannerYear = NaN
    requestRender()
  }

  const swatch = (p: number) => {
    const s = document.createElement('span')
    s.className = 'pp-swatch'
    if (data) s.style.background = data.css[p]
    return s
  }
  const peopleLink = (p: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ip-people-link'
    b.dataset.people = String(p)
    b.title = `Show the known world of the ${data?.names[p] ?? ''} people`
    b.append(swatch(p), data?.names[p] ?? '')
    return b
  }

  function buildRows() {
    list.replaceChildren()
    rows = []
    if (!data || !index) return
    const P = data.count
    const cradle = cradlesOf(index.history, P)
    const order = Array.from({ length: P }, (_, p) => p)
    if (cradle) order.sort((a, b) => cradle[a] - cradle[b] || a - b)
    let lastCradle = NaN
    for (const p of order) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'pp-row'
      el.dataset.people = String(p)
      if (cradle && cradle[p] !== lastCradle) {
        if (!Number.isNaN(lastCradle)) el.classList.add('cradle-start')
        lastCradle = cradle[p]
      }
      const name = document.createElement('span')
      name.className = 'pp-name'
      name.textContent = data.names[p]
      const nameWrap = document.createElement('span')
      nameWrap.className = 'pp-namecell'
      nameWrap.append(name)
      const bars: HTMLSpanElement[] = []
      if (tech) {
        const t = document.createElement('span')
        t.className = 'pp-tech'
        t.title = 'Technology: ' + TECH_FIELD_NAMES.join(', ')
        for (let f = 0; f < TECH_FIELD_COUNT; f++) {
          const bar = document.createElement('span')
          bar.className = `pp-bar f${f}`
          t.appendChild(bar)
          bars.push(bar)
        }
        nameWrap.append(t)
      }
      const cell = (cls: string) => {
        const s = document.createElement('span')
        s.className = cls
        return s
      }
      const sett = cell('pp-num'), pop = cell('pp-num'), met = cell('pp-num'), known = cell('pp-num')
      el.append(swatch(p), nameWrap, sett, pop, met, known)
      const chips = index.species ? new SpeciesChips() : null
      if (chips) el.append(chips.el)
      let extra: Row['extra'] = null
      if (index.species && (index.species.habit || index.species.techniques.length)) {
        const x = document.createElement('span')
        x.className = 'pp-extra hidden'
        const habits = new HabitLine(), techs = new TechniqueCount()
        x.append(habits.el, techs.el)
        el.append(x)
        extra = { el: x, habits, techs, on: false }
      }
      el.title = `The ${data.names[p]} people: click to see the world as they knew it`
      list.appendChild(el)
      rows.push({ p, el, sett, pop, met, known, bars, chips, extra, shown: { alive: -1, pop: -1, met: -1, known: -2, tech: -1, selected: false } })
    }
  }
  list.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-people]') as HTMLElement | null
    if (!el) return
    const p = Number(el.dataset.people)
    api.select(selection === p ? null : p)
  })
  anyoneBtn.addEventListener('click', () => api.select(selection === ANYONE ? null : ANYONE))
  slot.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-people]') as HTMLElement | null
    if (!el) return
    const p = Number(el.dataset.people)
    api.select(selection === p && el.classList.contains('ip-show') ? null : p)
  })

  function updatePanel(s0: number) {
    if (!data || !index) return
    const P = data.count
    const SN = index.history.snapshotCount
    const s = Math.max(0, Math.min(SN - 1, s0))
    let living = 0
    for (let p = 0; p < P; p++) if (data.alive[s * P + p] > 0) living++
    if (living !== shownCount) {
      shownCount = living
      count.textContent = living === P ? `${P}` : `${living} of ${P} living`
    }
    if (collapsed) return
    for (const r of rows) {
      const p = r.p
      const alive = data.alive[s * P + p]
      if (alive !== r.shown.alive) {
        r.shown.alive = alive
        r.sett.textContent = alive > 0 ? formatInt(alive) : '—'
        r.el.classList.toggle('extinct', alive === 0)
      }
      const pop = alive > 0 ? data.population[s * P + p] : 0
      if (pop !== r.shown.pop) {
        r.shown.pop = pop
        r.pop.textContent = alive > 0 ? formatPopulation(pop) : '—'
      }
      const met = metCount(data, p, year)
      if (met !== r.shown.met) {
        r.shown.met = met
        r.met.textContent = String(met)
      }
      knownShare(data, p, year, share)
      const known = pctKey(share.all) * 1000 + pctKey(share.land)
      if (known !== r.shown.known) {
        r.shown.known = known
        r.known.textContent = pctText(pctKey(share.all))
        r.known.title = `Knows ${pct(share.land)} of the land, ${pct(share.all)} of the world`
      }
      const sel = selection === p
      if (sel !== r.shown.selected) {
        r.shown.selected = sel
        r.el.classList.toggle('selected', sel)
        r.el.setAttribute('aria-pressed', String(sel))
      }
      r.chips?.update(index.species, p, year, data.names)
      if (r.extra) {
        r.extra.habits.update(index.species, p, year, data.names)
        r.extra.techs.update(index.species, p, year, data.names)
        const on = r.extra.habits.shown || r.extra.techs.shown
        if (on !== r.extra.on) {
          r.extra.on = on
          r.extra.el.classList.toggle('hidden', !on)
        }
      }
      if (tech && s !== r.shown.tech) {
        r.shown.tech = s
        for (let f = 0; f < TECH_FIELD_COUNT; f++) {
          const v = tech[(s * P + p) * TECH_FIELD_COUNT + f]
          r.bars[f].style.height = `${Math.round(2 + 10 * Math.min(1, v / techMax))}px`
          r.bars[f].title = `${TECH_FIELD_NAMES[f]} ${v.toFixed(1)}` + (peopleTechNote?.(p, f, s * index.history.snapshotInterval) ?? '')
        }
      }
    }
    knownShare(data, ANYONE, year, share)
    const a = pctKey(1 - share.land)
    if (a !== shownAnyone) {
      shownAnyone = a
      anyoneStat.textContent = `${pctText(a)} of the land unknown`
    }
    {
      const lines = selection !== null && selection >= 0 ? (peopleDiseaseNote?.(selection, year, s) ?? []) : []
      if (selection !== null && selection >= 0 && peopleIdeasNote) lines.push(...peopleIdeasNote(selection, year))
      const text = lines.length && selection !== null ? [`The ${data.names[selection]}:`, ...lines].join('\n') : ''
      if (text !== shownDiseaseNote) {
        shownDiseaseNote = text
        diseaseNote.replaceChildren(...text.split('\n').filter((t) => t).map((t) => {
          const d = document.createElement('div')
          d.textContent = t
          return d
        }))
        diseaseNote.classList.toggle('hidden', text === '')
      }
    }
    anyoneBtn.classList.toggle('selected', selection === ANYONE)
    anyoneBtn.setAttribute('aria-pressed', String(selection === ANYONE))
  }

  function updateBanner() {
    if (selection === null || !data) return
    // the year follows the timeline's (written only when the shown year changes)
    const y = Math.round(year)
    if (y === shownBannerYear) return
    shownBannerYear = y
    bYear.textContent = String(y)
  }

  function updateInspector() {
    if (!data || !index || inspected < 0) return
    const p = data.people[inspected]
    let n = 0
    while (n < inspContacts.length && inspContacts[n].year <= year) n++
    knownShare(data, p, year, share)
    const kk = pctKey(share.all) * 1000 + pctKey(share.land)
    if (kk !== shownKnownKey) {
      shownKnownKey = kk
      ipKnown.textContent = `Knows ${pct(share.land)} of the land, ${pct(share.all)} of the world`
    }
    const key = p * 100000 + (selection === null ? 99999 : selection + 3)
    if (n !== shownInspContacts) {
      shownInspContacts = n
      ipContacts.replaceChildren()
      if (n === 0) ipContacts.append(data.count > 1 ? 'Has met no other people yet' : 'The only people in the world')
      else {
        ipContacts.append('In contact with ')
        for (let k = 0; k < n; k++) {
          if (k > 0) ipContacts.append(k === n - 1 ? ' and ' : ', ')
          ipContacts.append(peopleLink(inspContacts[k].p), ` (since ${inspContacts[k].year})`)
        }
      }
    }
    if (key === shownInspKey) return
    shownInspKey = key
    ipLine.replaceChildren('Of the ', peopleLink(p), ' people')
    const show = document.createElement('button')
    show.type = 'button'
    show.className = 'btn ip-show'
    show.dataset.people = String(p)
    const on = selection === p
    show.textContent = on ? 'Whole world' : 'Show known world'
    show.title = on ? 'Back to the whole world (Esc)' : `See the world as the ${data.names[p]} people knew it`
    ipLine.append(show)
  }

  /** Masks and the mist for the current selection (once per selection or history). */
  function applySelection() {
    const settle = targets.settlements
    if (selection === null || !data || !world || !index) {
      cellYears = null
      fog?.setCellYears(null)
      settle?.setPeopleMask(null, null)
      targets.labels?.setKnownMask(null)
      targets.dioramas?.setKnownMask(null)
      banner.classList.add('hidden')
    } else {
      const N = world.grid.cellCount
      if (!fog) {
        fog = buildKnownWorldFog(world)
        deps.planetGroup.add(fog.mesh)
      }
      cellYears = cellKnownYears(data, selection, new Float32Array(N))
      fog.setCellYears(cellYears)
      targets.labels?.setKnownMask(cellYears)
      targets.dioramas?.setKnownMask(cellYears)
      if (settle) {
        const h = index.history
        const S = h.settlements.length
        const known = new Float32Array(S)
        const contact = new Float32Array(S).fill(NEVER_YEAR)
        for (let i = 0; i < S; i++) {
          known[i] = cellYears[h.settlements[i].cell]
          if (selection !== ANYONE) {
            const q = data.people[i]
            const y = q === selection ? -1 : contactOf(data, selection, q)
            if (y >= 0) contact[i] = y
          }
        }
        settle.setPeopleMask(known, contact)
      }
      banner.classList.remove('hidden')
      bLabel.textContent = selection === ANYONE ? 'The unexplored world: what no people knows, year ' : `Known world of the ${data.names[selection]} people, year `
      bSwatch.style.background = selection === ANYONE ? '' : data.css[selection]
      bSwatch.classList.toggle('anyone', selection === ANYONE)
    }
    deps.setUrlParam('people', selection !== null && selection !== ANYONE ? String(selection) : null)
    deps.setUrlParam('known', selection === ANYONE ? 'all' : null)
    forceRefresh()
    deps.onSelectionChange?.(cellYears ? selection : null)
  }

  function disposeFog() {
    if (!fog) return
    deps.planetGroup.remove(fog.mesh)
    fog.dispose()
    fog = null
  }
  function disposePulses() {
    if (!pulses) return
    deps.planetGroup.remove(pulses.mesh)
    pulses.dispose()
    pulses = null
  }

  function buildPulses() {
    disposePulses()
    if (!data || !world || !index) return
    const h = index.history
    const cells: number[] = [], years: number[] = [], a: number[] = [], b: number[] = []
    for (const e of h.events) {
      if ((e.type as number) !== PeoplesEvent.FirstContact || e.settlement < 0 || e.settlement >= h.settlements.length) continue
      const pa = data.people[e.settlement]
      const pb = e.value >= 0 && e.value < data.count ? e.value : e.other >= 0 && e.other < h.settlements.length ? data.people[e.other] : pa
      cells.push(h.settlements[e.settlement].cell)
      years.push(e.year)
      a.push(data.rgb[pa * 3], data.rgb[pa * 3 + 1], data.rgb[pa * 3 + 2])
      b.push(data.rgb[pb * 3], data.rgb[pb * 3 + 1], data.rgb[pb * 3 + 2])
    }
    pulses = buildContactPulses(world, cells, years, Float32Array.from(a), Float32Array.from(b))
    if (pulses) {
      pulses.mesh.visible = markersVisible
      deps.planetGroup.add(pulses.mesh)
    }
  }

  function showInspected() {
    const ok = inspected >= 0 && data !== null && index !== null && inspected < data.people.length
    slot.classList.toggle('hidden', !ok)
    if (!ok || !data) return
    const p = data.people[inspected]
    inspContacts = []
    for (let q = 0; q < data.count; q++) {
      const y = q === p ? -1 : contactOf(data, p, q)
      if (y >= 0) inspContacts.push({ p: q, year: y })
    }
    inspContacts.sort((x, y) => x.year - y.year || x.p - y.p)
    shownInspKey = -1
    shownInspContacts = -1
    shownKnownKey = -2
    shownYear = NaN // fill it on the next tick
    requestRender()
  }

  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else leave the known world, else deselect',
    group: 'Panels',
    run: () => {
      if (selection === null) return false
      api.select(null)
    },
  })
  addShortcut({ keys: ['p', 'P'], label: 'P', description: 'Show or hide the peoples', group: 'Panels', run: () => (data ? toggleCollapsed() : false) })
  addShortcut({ keys: ['k', 'K'], label: 'K', description: 'Show the unexplored world (known to no one)', group: 'View', run: () => (data ? api.select(selection === ANYONE ? null : ANYONE) : false) })

  const api: PeoplesView = {
    setWorld(w: World) {
      world = w
      index = null
      data = null
      selection = null
      cellYears = null
      inspected = -1
      disposeFog()
      disposePulses()
      targets = { settlements: null, labels: null, dioramas: null }
      deps.onSelectionChange?.(null)
      root.classList.add('hidden')
      banner.classList.add('hidden')
      slot.classList.add('hidden')
      list.replaceChildren()
      rows = []
    },
    setIndex(ix: HistoryIndex, w: World, t: PeoplesTargets, extend: boolean) {
      if (world !== w) {
        api.setWorld(w)
      }
      index = ix
      data = ix.peoples
      targets = t
      const h = ix.history
      tech = data ? technologyOf(h, data.count) : null
      techMax = 1
      if (tech && data) {
        const last = Math.min(h.snapshotCount, Math.floor(NORM_YEARS / Math.max(1, h.snapshotInterval)) + 1)
        for (let k = 0; k < last * data.count * TECH_FIELD_COUNT; k++) techMax = Math.max(techMax, tech[k])
      }
      root.classList.toggle('hidden', data === null)
      if (data) {
        // people colour per settlement (static per history)
        const S = h.settlements.length
        const rgb = new Float32Array(S * 3)
        for (let i = 0; i < S; i++) {
          const p = data.people[i]
          rgb[i * 3] = data.rgb[p * 3]
          rgb[i * 3 + 1] = data.rgb[p * 3 + 1]
          rgb[i * 3 + 2] = data.rgb[p * 3 + 2]
        }
        t.settlements?.setPeopleColors(rgb)
        t.settlements?.setTint(tint)
        if (data.standIn) console.info('peoples: using the dev stand-in data (peoplesData.ts STAND_IN)')
      } else {
        t.settlements?.setPeopleColors(null)
        t.settlements?.setTint(false)
      }
      buildRows()
      buildPulses()
      if (!data || (selection !== null && selection !== ANYONE && selection >= data.count)) selection = null
      if (!extend && !data) selection = null
      applySelection()
      if (inspected >= 0) showInspected()
    },
    select(sel: PeopleSelection) {
      if (sel !== null && (!data || (sel !== ANYONE && !(sel >= 0 && sel < data.count)))) sel = null
      if (sel === selection) return
      selection = sel
      applySelection()
    },
    get selection() {
      return selection
    },
    get knownCells() {
      return cellYears
    },
    showSettlement(id: number) {
      inspected = id
      showInspected()
    },
    setTint(on: boolean) {
      tint = on
      targets.settlements?.setTint(on && data !== null)
      requestRender()
    },
    setMarkersVisible(on: boolean) {
      markersVisible = on
      if (pulses) pulses.mesh.visible = on
    },
    hidesCell(cell: number) {
      return cellYears !== null && cell >= 0 && cell < cellYears.length && year < cellYears[cell]
    },
    tick(y: number, s0: number, pulseYears: number, camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      year = y
      if (fog && fog.mesh.visible) {
        fog.setYear(y)
        fog.update(camera)
      }
      if (pulses && pulses.mesh.visible) {
        pulses.setTime(y, pulseYears)
        pulses.update(camera, drawSize, pixelRatio)
      }
      if (!data) return
      // panel values change with the snapshot (settlements, population) and the year (contacts, knowledge)
      const yi = Math.floor(y)
      if (yi !== shownYear || s0 !== shownS0) {
        shownYear = yi
        shownS0 = s0
        updatePanel(s0)
        updateInspector()
      }
      updateBanner()
    },
  }
  return api
}
