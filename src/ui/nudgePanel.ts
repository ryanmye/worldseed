// Nudge: the right column's panel for the player's orders (contract.ts Order; HistoryOptions.orders). The player urges a
// people, a state or a town to do something at the year shown; the rules decide and it can fail; the orders go into the
// URL (o=) with the seed, so a nudged world is shareable by link. Collapsed by default (O), in the right column's
// accordion like the Cities and Travel panels (gp-head / gp-body / gp-row).
//
// Giving an order: the kind (labels and effects from describeOrderKinds()), the actor from what is selected (a people
// in the Peoples panel, else the selected town's; a state in the Factions panel, else the selected town's; the selected
// town), the target where the kind takes one (a place picked on the map in a "pick a place" mode, Esc to cancel; a
// species, an idea, a state, a member town or a universal faith from a list, the impossible ones greyed out with the
// reason from orderFeasible). "Urge" re-simulates the world with the new list (deps.requestOrders: a full run, the
// history on screen stays until the new one arrives, then is swapped in at the order's year and plays on).
//
// The orders list: each order's status as of the year shown, its one-line story once resolved (nudgeFormat.ts), a link
// to what it produced, "remove" (re-simulates), "clear all" and "Copy link". The map marks (render/nudges.ts) are built
// per history (none without orders); the form refreshes only when the year, the selection or the history changes.
//
// Hearths (at the top, ui/hearthsSection.ts): the first hearths the player planted and what became of them, and
// "Replant the hearths", the start page's hearth picker on the main globe at year 0 (re-simulates like an order).

import * as THREE from 'three'
import { FaithKind, OrderKind, OrderReason, OrderRole, OrderStatus, encodeOrders, orderFeasible, settlementNameAt } from '../contract.ts'
import type { GeoFeature, History, Order, World } from '../contract.ts'
import type { HistoryIndex } from './historyIndex.ts'
import { buildNudgeLayer, type NudgeLayer, type NudgeMark } from '../render/nudges.ts'
import { requestRender } from '../render/invalidate.ts'
import { ORDER_KINDS, STATUS_WORDS, actorWords, capitalAt, cellWords, orderStory, orderYears, peopleSeat, polityWords, reasonWords, setOrderPlaceNamer, setOrderPositions, statusAt, urgePhrase } from './nudgeFormat.ts'
import { loadFlag, loadPref, panelToggled, registerPanel, saveFlag, savePref } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import { createHearthsSection, type HearthsSection } from './hearthsSection.ts'
import type { HearthPicker } from './hearthPicker.ts'
import './nudge.css'

export interface NudgeViewDeps {
  right: HTMLElement
  canvas: HTMLCanvasElement
  planetGroup: THREE.Group
  /** The orders of the history shown or on its way (canonical). */
  getOrders(): Order[]
  /** Re-simulate with this list; the new history is swapped in at `keepYear`. */
  requestOrders?(orders: Order[], keepYear: number): void
  /** What is selected: the inspector's settlement, the Peoples panel's people, the Factions panel's state (-1 none). */
  selection(): { settlement: number; people: number; polity: number }
  /** Named features on a cell (named or not yet). */
  featuresNear(cell: number): GeoFeature[]
  onSelectSettlement(id: number): void
  onSelectPolity(p: number): void
  flyToCell(cell: number): void
  setYear(year: number): void
  /** The hearths (HistoryOptions.cradles): the picker, the list shown or on its way, re-simulating with a new one. */
  hearths?: HearthPicker
  getCradles?(): number[]
  requestCradles?(cradles: number[], keepYear: number): void
  /** Stop the timeline playing. */
  pause?(): void
}

export interface NudgeView {
  setWorld(world: World): void
  /** A history was swapped in (null: none). */
  commit(h: History | null, index: HistoryIndex | null): void
  /** A click on the map landed on `cell`: taken (true) while a place is being picked. */
  pickCell(cell: number): boolean
  setKnownMask(cellYear: Float32Array | null): void
  tick(year: number, playing: boolean, camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
}

const KIND_KEY = 'worldseed.nudge.kind'
const COST_KEY = 'worldseed.nudge.costSeen'
const STATUS_CLASS = ['pending', 'active', 'fulfilled', 'partly', 'failed', 'expired']
const roleWord = (r: number) => (r === OrderRole.People ? 'people' : r === OrderRole.Polity ? 'state' : 'town')

/** Feature kinds in the order a target place is named, most local first: mountains, desert, forest, river, lake, island, continent, sea, ocean. */
const NAME_ORDER = [6, 7, 8, 5, 4, 1, 0, 3, 2]
function featureWords(f: GeoFeature): string {
  switch (f.kind) {
    case 6: return `the ${f.name}`
    case 7: return `the ${f.name} desert`
    case 8: return `the ${f.name} forest`
    case 5: return `the river ${f.name}`
    case 4: return `lake ${f.name}`
    case 1: return `the island of ${f.name}`
    case 0: return f.name
    case 3: return `the ${f.name} sea`
    case 2: return `the ${f.name} ocean`
  }
  return f.name
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

export function createNudgeView(deps: NudgeViewDeps): NudgeView {
  // ---------- panel ----------
  const root = el('div', 'panel nudge hidden collapsed')
  const head = el('button', 'gp-head')
  head.type = 'button'
  head.title = 'Urge a people, a state or a town to do something (O)'
  const title = el('span', 'gp-title', 'Nudge')
  const count = el('span', 'gp-count')
  const caret = el('span', 'caret')
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = el('div', 'gp-body')
  body.id = 'nudge-body'
  head.setAttribute('aria-controls', body.id)
  // the form
  const form = el('div', 'ng-form')
  const costNote = el('div', 'gp-note ng-cost', 'Each nudge re-runs the world’s history from the start (a few seconds); the world on screen stays until the new one is ready.')
  const formHead = el('div', 'ng-sub')
  const kindSel = el('select', 'ng-select')
  kindSel.setAttribute('aria-label', 'What to urge')
  for (const k of ORDER_KINDS) {
    const o = el('option', '', k.label)
    o.value = String(k.kind)
    kindSel.appendChild(o)
  }
  const effect = el('div', 'gp-note ng-effect')
  const actorLine = el('div', 'ng-line')
  const targetLine = el('div', 'ng-line')
  const targetSel = el('select', 'ng-select')
  targetSel.setAttribute('aria-label', 'Target')
  const pickBtn = el('button', 'gp-link ng-pick')
  pickBtn.type = 'button'
  const targetText = el('span', 'ng-target-text')
  const verdict = el('div', 'gp-note ng-verdict')
  const urgeBtn = el('button', 'ng-urge', 'Urge')
  urgeBtn.type = 'button'
  form.append(costNote, formHead, kindSel, effect, actorLine, targetLine, verdict, urgeBtn)
  // the list
  const listHead = el('div', 'ng-sub')
  const list = el('div', 'ng-list')
  const tools = el('div', 'ng-tools')
  const clearBtn = el('button', 'gp-link', 'clear all')
  clearBtn.type = 'button'
  const copyBtn = el('button', 'gp-link', 'Copy link')
  copyBtn.type = 'button'
  const copied = el('span', 'gp-note ng-copied')
  tools.append(copyBtn, clearBtn, copied)
  // (the hearths first, then the orders and what became of them, the form for the next one under them)
  let hearthsSection: HearthsSection | null = null
  if (deps.hearths && deps.getCradles && deps.requestCradles) {
    hearthsSection = createHearthsSection({
      hearths: deps.hearths,
      getCradles: deps.getCradles,
      requestCradles: deps.requestCradles,
      year: () => year,
      setYear: (y) => { deps.pause?.(); deps.setYear(y) },
      flyToCell: deps.flyToCell,
      onSelectSettlement: deps.onSelectSettlement,
      onStart: () => stopPicking(),
    })
    body.appendChild(hearthsSection.el)
  }
  body.append(listHead, list, tools, form)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))
  const hint = el('div', 'ng-pick-hint hidden')
  document.body.appendChild(hint)
  // (a touch screen alone: tap, and no Esc to name)
  const touchOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches

  let collapsed = loadFlag('worldseed.nudge.collapsed', true)
  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.nudge.collapsed', collapsed)
    syncCollapsed()
    panelToggled('nudge', !collapsed)
    if (collapsed) stopPicking()
    dirty = true
    if (!collapsed) window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
  }
  head.addEventListener('click', toggleCollapsed)
  registerPanel('nudge', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  addShortcut({ keys: ['o', 'O'], label: 'O', description: 'Show or hide the Nudge panel (urge a people, a state or a town)', group: 'Panels', run: () => (history ? toggleCollapsed() : false) })

  // ---------- state ----------
  let world: World | null = null
  let history: History | null = null
  let index: HistoryIndex | null = null
  let layer: NudgeLayer | null = null
  let knownMask: Float32Array | null = null
  let kind = Number(loadPref(KIND_KEY) ?? '0')
  if (!(kind >= 0 && kind < ORDER_KINDS.length)) kind = 0
  kindSel.value = String(kind)
  /** The target chosen per kind (-1 none). */
  const targets = new Array<number>(ORDER_KINDS.length).fill(-1)
  let picking = false
  let year = 0
  let dirty = true
  let lastYear = -1
  let lastSel = ''
  let lastRefresh = 0
  /** land cell index of each cell (-1 sea), for the polity under a click. */
  let landIndex: Int32Array | null = null
  /** The form's order as it stands (null: incomplete), and why it cannot be given ('' it can). */
  let draft: Order | null = null
  let blocked = ''

  const snapOf = (h: History, y: number) => Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)))
  const orderYear = () => Math.max(1, Math.floor(year + 1e-6))
  const aliveAt = (h: History, id: number, y: number) => id >= 0 && id < h.settlements.length && h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear > y)
  const polityOf = (h: History, id: number, y: number) => (h.polity.length && id >= 0 ? h.polity[snapOf(h, y) * h.settlements.length + id] : -1)
  const polAlive = (h: History, p: number, y: number) => p >= 0 && p < h.polities.length && h.polities[p].foundedYear <= y && (h.polities[p].endedYear < 0 || h.polities[p].endedYear > y)
  /** The polity holding (or claiming) a cell at year y, -1 none. */
  function polityAtCell(h: History, cell: number, y: number): number {
    if (!landIndex || !h.territory?.length) return -1
    const k = landIndex[cell]
    if (k < 0) return -1
    const L = h.landCells.length
    const q = Math.max(0, Math.min(h.landSnapshotCount - 1, Math.floor(y / h.landInterval)))
    const owner = h.territory[q * L + k] - 1
    return owner >= 0 ? polityOf(h, owner, y) : -1
  }
  /** The states whose land touches polity a's at year y (a border, as War needs). */
  let borderKey = ''
  let borders = new Set<number>()
  function bordersOf(h: History, a: number, y: number): Set<number> {
    if (!world || !landIndex || !h.territory?.length) return borders
    const q = Math.max(0, Math.min(h.landSnapshotCount - 1, Math.floor(y / h.landInterval)))
    const key = `${a}:${q}:${snapOf(h, y)}`
    if (key === borderKey) return borders
    borderKey = key
    borders = new Set<number>()
    const L = h.landCells.length, base = q * L
    const { neighborOffsets: off, neighbors: nb } = world.grid
    const own = (k: number) => { const o = h.territory[base + k] - 1; return o >= 0 ? polityOf(h, o, y) : -1 }
    for (let k = 0; k < L; k++) {
      if (own(k) !== a) continue
      const c = h.landCells[k]
      for (let j = off[c]; j < off[c + 1]; j++) {
        const kk = landIndex[nb[j]]
        if (kk < 0) continue
        const p = own(kk)
        if (p >= 0 && p !== a) borders.add(p)
      }
    }
    return borders
  }

  /** The actor of the current kind from the selection, with where it came from (-1 none). */
  function actorFor(h: History, k: number, y: number): { id: number; from: string } {
    const sel = deps.selection()
    const role = ORDER_KINDS[k].actor
    if (role === OrderRole.People) {
      if (sel.people >= 0 && sel.people < h.peoples.length) return { id: sel.people, from: 'the Peoples panel' }
      if (sel.settlement >= 0) return { id: h.settlements[sel.settlement].people, from: `the people of ${settlementNameAt(h, sel.settlement, y)}` }
      return { id: -1, from: '' }
    }
    if (role === OrderRole.Polity) {
      if (sel.polity >= 0 && sel.polity < h.polities.length) return { id: sel.polity, from: 'the Factions panel' }
      const p = sel.settlement >= 0 ? polityOf(h, sel.settlement, y) : -1
      if (p >= 0) return { id: p, from: `the state of ${settlementNameAt(h, sel.settlement, y)}` }
      return { id: -1, from: '' }
    }
    return sel.settlement >= 0 ? { id: sel.settlement, from: 'the selected town' } : { id: -1, from: '' }
  }

  const dot = (css: string) => {
    const d = el('span', 'gp-dot')
    d.style.background = css
    return d
  }

  function setOptions(opts: { value: number; label: string; disabled?: boolean; title?: string }[], chosen: number, none: string): number {
    targetSel.replaceChildren()
    const first = el('option', '', none)
    first.value = '-1'
    targetSel.appendChild(first)
    let ok = false
    for (const o of opts) {
      const e = el('option', o.disabled ? 'ng-dim' : '', o.label)
      e.value = String(o.value)
      if (o.disabled) e.disabled = true
      if (o.title) e.title = o.title
      targetSel.appendChild(e)
      if (o.value === chosen && !o.disabled) ok = true
    }
    const v = ok ? chosen : -1
    targetSel.value = String(v)
    return v
  }

  /** Rebuild the form for the year, the selection and the kind. */
  function refreshForm() {
    const h = history
    if (!h) return
    const y = orderYear()
    const info = ORDER_KINDS[kind]
    costNote.hidden = loadFlag(COST_KEY, false)
    formHead.textContent = `Give an order in ${y}`
    effect.textContent = info.effect
    // actor
    const actor = actorFor(h, kind, y)
    actorLine.replaceChildren()
    const lab = el('span', 'ng-label', 'Who:')
    actorLine.appendChild(lab)
    if (actor.id >= 0) {
      const o: Order = { year: y, kind: info.kind, actor: actor.id }
      const name = el('span', 'ng-actor', actorWords(h, o).replace(/^the port of /, ''))
      const pd = index?.peoples
      const p = info.actor === OrderRole.People ? actor.id : info.actor === OrderRole.Settlement ? h.settlements[actor.id].people : h.polities[actor.id].people
      if (pd && p >= 0 && p < pd.count) actorLine.appendChild(dot(pd.css[p]))
      actorLine.append(name, el('span', 'gp-note ng-from', `(${roleWord(info.actor)}, from ${actor.from})`))
    } else {
      actorLine.appendChild(el('span', 'gp-note ng-from', info.actor === OrderRole.People ? 'select a people in the Peoples panel, or one of its towns' : info.actor === OrderRole.Polity ? 'select a state in the Factions panel, or one of its towns' : 'select a town on the map'))
    }
    // target
    targetLine.replaceChildren()
    pickBtn.hidden = true
    let target = -1
    const tr = info.target
    if (tr !== OrderRole.None) {
      targetLine.appendChild(el('span', 'ng-label', tr === OrderRole.Cell ? 'Where:' : 'What:'))
      const chosen = targets[kind]
      const feas = (t: number) => (actor.id >= 0 ? orderFeasible(h, { year: y, kind: info.kind, actor: actor.id, target: t }, y) : OrderReason.None)
      if (tr === OrderRole.Cell) {
        target = chosen
        targetText.textContent = chosen >= 0 ? cellWords(h, chosen, y, actor.id >= 0 ? peopleSeat(h, actor.id, y - 1) : -1) : 'no place chosen'
        targetText.classList.toggle('ng-none', chosen < 0)
        pickBtn.textContent = picking ? (touchOnly ? 'tap the map…' : 'click the map… (Esc)') : chosen >= 0 ? 'choose again' : 'choose on the map'
        pickBtn.hidden = false
        targetLine.append(targetText, pickBtn)
      } else {
        const opts: { value: number; label: string; disabled?: boolean; title?: string }[] = []
        const why = (t: number) => { const r = feas(t); return r === OrderReason.None ? '' : reasonWords(r, info.kind) }
        if (tr === OrderRole.Species) {
          const held = (s: number) => { if (actor.id < 0) return false; const k = h.speciesYear[actor.id * h.species.length + s]; return k >= 0 && k <= y - 1 }
          const order = h.species.map((s) => s.id).sort((a, b) => Number(held(a)) - Number(held(b)) || h.species[a].name.localeCompare(h.species[b].name))
          for (const s of order) { const w = why(s); opts.push({ value: s, label: `${h.species[s].name} (${h.species[s].archetype})${w ? ` · ${w}` : ''}`, disabled: !!w }) }
          target = setOptions(opts, chosen, 'choose a species…')
        } else if (tr === OrderRole.Idea) {
          for (const I of h.ideas) { if (I.technique >= 0) continue; const w = why(I.id); opts.push({ value: I.id, label: `${I.name}${w ? ` · ${w}` : ''}`, disabled: !!w, title: I.effect }) }
          opts.sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled))
          target = setOptions(opts, chosen, 'choose an idea…')
        } else if (tr === OrderRole.Polity) {
          const bd = actor.id >= 0 ? bordersOf(h, actor.id, y - 1) : new Set<number>()
          const ps: number[] = []
          for (let p = 0; p < h.polities.length; p++) if (p !== actor.id && polAlive(h, p, y - 1)) ps.push(p)
          ps.sort((a, b) => Number(bd.has(b)) - Number(bd.has(a)) || a - b)
          for (const p of ps) {
            const w = why(p)
            const soft = !w && info.kind === OrderKind.War && !bd.has(p) ? 'no border with them' : ''
            opts.push({ value: p, label: `${polityWords(h, p)}${w ? ` · ${w}` : soft ? ` · ${soft}` : bd.has(p) ? ' · neighbour' : ''}`, disabled: !!w })
          }
          target = setOptions(opts, chosen, 'choose a state…')
          pickBtn.textContent = picking ? (touchOnly ? 'tap the map…' : 'click the map… (Esc)') : 'or pick on the map'
          pickBtn.hidden = false
        } else if (tr === OrderRole.Settlement) {
          const base = snapOf(h, y - 1) * h.settlements.length
          const ids: number[] = []
          if (actor.id >= 0) for (let i = 0; i < h.settlements.length; i++) if (!h.settlements[i].outpost && aliveAt(h, i, y - 1) && polityOf(h, i, y - 1) === actor.id) ids.push(i)
          ids.sort((a, b) => h.population[base + b] - h.population[base + a])
          for (const i of ids.slice(0, 60)) { const w = why(i); opts.push({ value: i, label: `${settlementNameAt(h, i, y)} (${Math.round(h.population[base + i])})${w ? ` · ${w}` : ''}`, disabled: !!w }) }
          target = setOptions(opts, chosen, actor.id >= 0 ? 'choose one of its towns…' : 'choose a town…')
        } else if (tr === OrderRole.Faith) {
          for (const f of h.faiths) { if (f.kind !== FaithKind.Universal || f.foundedYear > y - 1) continue; const w = why(f.id); opts.push({ value: f.id, label: `the ${f.name} faith${w ? ` · ${w}` : ''}`, disabled: !!w }) }
          target = setOptions(opts, chosen, opts.length ? 'choose a faith…' : 'no universal faith yet')
        }
        targets[kind] = target
        targetLine.appendChild(targetSel)
        if (!pickBtn.hidden) targetLine.appendChild(pickBtn)
      }
    }
    // verdict
    draft = null
    blocked = ''
    let soft = ''
    if (actor.id < 0) blocked = `Select a ${roleWord(info.actor)} first.`
    else if (tr !== OrderRole.None && target < 0) blocked = tr === OrderRole.Cell ? 'Choose a place on the map.' : 'Choose a target.'
    else if (y >= h.years) blocked = 'The history ends here: go back to give an order.'
    else {
      draft = { year: y, kind: info.kind, actor: actor.id }
      if (tr !== OrderRole.None) draft.target = target
      const r = orderFeasible(h, draft, y)
      const key = encodeOrders([draft])
      if (r !== OrderReason.None) blocked = `Cannot: ${reasonWords(r, info.kind)}.`
      else if (deps.getOrders().some((o) => encodeOrders([o]) === key)) blocked = 'Already urged.'
      else if (info.kind === OrderKind.War && !bordersOf(h, actor.id, y - 1).has(target)) soft = 'No border with them: it will likely fail. '
    }
    if (blocked) draft = null
    verdict.textContent = blocked || `${soft}${draft ? `${capFirst(actorWords(h, draft))}, urged to ${urgePhrase(h, draft)}, for up to ${info.years} years. The rules decide.` : ''}`
    verdict.classList.toggle('ng-blocked', !!blocked)
    urgeBtn.disabled = !draft || !deps.requestOrders
  }
  const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

  // ---------- the orders list ----------
  interface Row { el: HTMLDivElement; chip: HTMLSpanElement; text: HTMLSpanElement; links: HTMLSpanElement; remove: HTMLButtonElement }
  const rows: Row[] = []
  function rowAt(i: number): Row {
    while (rows.length <= i) {
      const r = el('div', 'gp-row ng-row')
      const chip = el('span', 'ng-chip')
      const text = el('span', 'ng-text')
      const links = el('span', 'ng-links')
      const remove = el('button', 'ng-remove', '×')
      remove.type = 'button'
      remove.title = 'Remove this order (re-runs the history)'
      remove.dataset.k = String(rows.length)
      r.append(chip, text, remove, links)
      list.appendChild(r)
      rows.push({ el: r, chip, text, links, remove })
    }
    return rows[i]
  }
  /** Whether the history shown was simulated with the orders asked for (else a re-run is on its way). */
  const inSync = () => !!history && encodeOrders(history.orders ?? []) === encodeOrders(deps.getOrders())

  function link(label: string, run: () => void): HTMLButtonElement {
    const b = el('button', 'gp-link', label)
    b.type = 'button'
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      run()
    })
    return b
  }

  function refreshList() {
    const h = history
    const orders = deps.getOrders()
    const sync = inSync()
    const y = year
    let fulfilled = 0
    listHead.textContent = orders.length ? (sync ? 'Orders' : 'Orders (re-running the history…)') : ''
    for (let k = 0; k < orders.length; k++) {
      const o = orders[k]
      const r = sync && h ? h.orderOutcomes?.[k] : undefined
      const row = rowAt(k)
      row.el.hidden = false
      const st = sync ? statusAt(o, r, y) : -1
      if (r?.status === OrderStatus.Fulfilled) fulfilled++
      row.chip.className = `ng-chip ${st >= 0 ? STATUS_CLASS[st] : 'waiting'}`
      row.chip.textContent = st >= 0 ? STATUS_WORDS[st] : '…'
      if (!h) continue
      const resolved = !!r && r.year >= 0 && y >= r.year
      row.text.textContent = resolved ? orderStory(h, k) : `${capFirst(actorWords(h, o))}, urged to ${urgePhrase(h, o)} in ${o.year}${st === OrderStatus.Active ? `; in force until ${o.year + orderYears(o)}` : ''}`
      row.el.title = row.text.textContent
      row.links.replaceChildren()
      const add = (b: HTMLElement) => { if (row.links.childNodes.length) row.links.append(' · '); row.links.appendChild(b) }
      // the actor
      if (o.kind >= OrderKind.War && o.kind <= OrderKind.Faith) add(link(polityWords(h, o.actor), () => deps.onSelectPolity(o.actor)))
      else if (o.kind >= OrderKind.Fortify) add(link(settlementNameAt(h, o.actor, o.year), () => deps.onSelectSettlement(o.actor)))
      else { const s = peopleSeat(h, o.actor, o.year); if (s >= 0) add(link(h.peoples[o.actor]?.name ?? 'the people', () => deps.onSelectSettlement(s))) }
      if (o.kind <= OrderKind.Settle && o.target !== undefined) add(link('the place', () => deps.flyToCell(o.target!)))
      if (r && r.acted >= 0 && y >= r.acted) row.links.append(` · acted ${r.acted}`)
      // what it produced, once it has
      if (r && resolved && r.product >= 0) {
        const yr = r.year
        switch (o.kind) {
          case OrderKind.Explore: { const J = h.journeys; const from = r.product < J.count ? J.from[r.product] : -1; add(link('the expedition', () => { deps.setYear(Math.max(0, Math.floor(J.departYear[r.product]))); if (from >= 0) deps.onSelectSettlement(from) })); break }
          case OrderKind.Settle: add(link(settlementNameAt(h, r.product, yr), () => deps.onSelectSettlement(r.product))); break
          case OrderKind.Crop: case OrderKind.Idea: case OrderKind.Quarantine: case OrderKind.Seat: add(link(settlementNameAt(h, r.product, yr), () => deps.onSelectSettlement(r.product))); break
          case OrderKind.War: case OrderKind.Peace: add(link('the war', () => { deps.setYear(h.wars.startYear[r.product]); deps.onSelectPolity(o.actor) })); break
          case OrderKind.Faith: add(link('the ruler', () => deps.onSelectPolity(o.actor))); break
          case OrderKind.Fortify: { const s = h.structures[r.product]?.settlement ?? o.actor; add(link('the walls', () => deps.onSelectSettlement(s))); break }
        }
      }
    }
    for (let k = orders.length; k < rows.length; k++) rows[k].el.hidden = true
    const hw = hearthsSection?.countWords() ?? ''
    tools.hidden = orders.length === 0 && !hw
    clearBtn.style.display = orders.length === 0 ? 'none' : ''
    count.textContent = (hw ? `${hw} · ` : '') + (orders.length === 0 ? 'no orders' : `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}${sync && fulfilled ? ` · ${fulfilled} fulfilled` : ''}${sync ? '' : ' · re-running…'}`)
    hearthsSection?.refresh()
  }

  function refresh() {
    lastRefresh = performance.now()
    dirty = false
    if (!history) return
    refreshList()
    if (!collapsed) refreshForm()
  }

  // ---------- giving and removing ----------
  function submit(orders: Order[], keepYear: number) {
    if (!deps.requestOrders) return
    saveFlag(COST_KEY, true)
    stopPicking()
    deps.requestOrders(orders, keepYear)
    dirty = true
    refresh()
  }
  urgeBtn.addEventListener('click', () => {
    if (!draft) return
    const d = draft
    targets[kind] = -1 // (a fresh form for the next order)
    submit([...deps.getOrders(), d], d.year)
  })
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.ng-remove') as HTMLElement | null
    if (!b) return
    const k = Number(b.dataset.k)
    const orders = deps.getOrders().filter((_, i) => i !== k)
    submit(orders, Math.floor(year))
  })
  clearBtn.addEventListener('click', () => submit([], Math.floor(year)))
  copyBtn.addEventListener('click', () => {
    const url = window.location.href
    const done = (ok: boolean) => {
      copied.textContent = ok ? 'copied' : url
      window.setTimeout(() => (copied.textContent = ''), 2500)
    }
    try {
      navigator.clipboard.writeText(url).then(() => done(true), () => done(false))
    } catch {
      done(false)
    }
  })
  kindSel.addEventListener('change', () => {
    kind = Number(kindSel.value)
    savePref(KIND_KEY, String(kind))
    stopPicking()
    refreshForm()
  })
  targetSel.addEventListener('change', () => {
    targets[kind] = Number(targetSel.value)
    refreshForm()
  })

  // ---------- picking a place on the map ----------
  function startPicking() {
    picking = true
    deps.canvas.classList.add('nudge-picking')
    const role = ORDER_KINDS[kind].target
    const [Click, esc] = touchOnly ? ['Tap', ''] : ['Click', ' · Esc to cancel']
    hint.textContent = role === OrderRole.Polity ? `${Click} a state’s land on the map${esc}` : `${Click} the map: where to ${ORDER_KINDS[kind].kind === OrderKind.Explore ? 'explore toward' : 'settle toward'}${esc}`
    hint.classList.remove('hidden')
    refreshForm()
  }
  function stopPicking() {
    if (!picking) return
    picking = false
    deps.canvas.classList.remove('nudge-picking')
    hint.classList.add('hidden')
    if (history && !collapsed) refreshForm()
  }
  pickBtn.addEventListener('click', () => (picking ? stopPicking() : startPicking()))
  window.addEventListener('keydown', (e) => {
    if (!picking || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    stopPicking()
  }, true)

  // ---------- map marks ----------
  function buildMarks(w: World, h: History): NudgeMark[] {
    const out: NudgeMark[] = []
    const O = h.orders ?? [], R = h.orderOutcomes ?? []
    for (let k = 0; k < O.length; k++) {
      const o = O[k], r = R[k]
      const y = o.year - 1
      const t = o.target ?? -1
      let cell = -1, from = -1
      switch (o.kind) {
        case OrderKind.Explore: case OrderKind.Settle: {
          cell = t
          // (the line from the people's town nearest the place)
          let bd = -Infinity
          const P = w.grid.positions
          for (let i = 0; i < h.settlements.length; i++) {
            const x = h.settlements[i]
            if (x.people !== o.actor || x.outpost || !aliveAt(h, i, y)) continue
            const d = P[x.cell * 3] * P[t * 3] + P[x.cell * 3 + 1] * P[t * 3 + 1] + P[x.cell * 3 + 2] * P[t * 3 + 2]
            if (d > bd) { bd = d; from = x.cell }
          }
          break
        }
        case OrderKind.Fortify: case OrderKind.Quarantine: cell = h.settlements[o.actor]?.cell ?? -1; break
        case OrderKind.Seat: cell = h.settlements[t]?.cell ?? -1; break
        case OrderKind.War: case OrderKind.Peace: { const c = t >= 0 ? capitalAt(h, t, y) : -1; cell = c >= 0 ? h.settlements[c].cell : -1; break }
        case OrderKind.Faith: { const c = capitalAt(h, o.actor, y); cell = c >= 0 ? h.settlements[c].cell : -1; break }
        default: { const s = peopleSeat(h, o.actor, y); cell = s >= 0 ? h.settlements[s].cell : -1 }
      }
      if (cell < 0 || cell >= w.grid.cellCount) continue
      const end = r && r.year >= 0 ? r.year : o.year + orderYears(o)
      out.push({ cell, from, y0: o.year, y1: r && r.status === OrderStatus.Active ? 1e9 : Math.max(o.year + 1, end), tone: o.kind >= OrderKind.War ? 1 : 0 })
    }
    return out
  }

  return {
    setWorld(w: World) {
      world = w
      setOrderPositions(w.grid.positions)
      stopPicking()
      targets.fill(-1)
    },
    commit(h: History | null, ix: HistoryIndex | null) {
      if (layer) {
        deps.planetGroup.remove(layer.mesh)
        layer.dispose()
        layer = null
      }
      history = h
      index = ix
      borderKey = ''
      hearthsSection?.commit(h)
      root.classList.toggle('hidden', !h)
      if (h && world) {
        const N = world.grid.cellCount
        landIndex = new Int32Array(N).fill(-1)
        if (h.landCells) for (let k = 0; k < h.landCells.length; k++) landIndex[h.landCells[k]] = k
        setOrderPlaceNamer((cell, y) => {
          const fs = deps.featuresNear(cell).filter((f) => f.namedYear <= y)
          fs.sort((a, b) => NAME_ORDER.indexOf(a.kind) - NAME_ORDER.indexOf(b.kind) || a.id - b.id)
          return fs.length ? featureWords(fs[0]) : ''
        })
        if (h.orders && h.orders.length) {
          layer = buildNudgeLayer(world, buildMarks(world, h))
          if (layer) {
            deps.planetGroup.add(layer.mesh)
            layer.setKnownMask(knownMask)
          }
        }
      } else setOrderPlaceNamer(null)
      dirty = true
      lastYear = -1
      requestRender()
    },
    pickCell(cell: number) {
      if (!picking || !history) return false
      const role = ORDER_KINDS[kind].target
      if (role === OrderRole.Cell) targets[kind] = cell
      else if (role === OrderRole.Polity) {
        const p = polityAtCell(history, cell, orderYear() - 1)
        if (p >= 0) targets[kind] = p
      }
      stopPicking()
      refreshForm()
      return true
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      layer?.setKnownMask(cellYear)
    },
    tick(y: number, playing: boolean, camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      year = y
      if (layer) {
        layer.setTime(y)
        layer.update(camera, drawSize, pixelRatio)
      }
      if (!history) return
      const s = deps.selection()
      const selKey = `${s.settlement}:${s.people}:${s.polity}:${encodeOrders(deps.getOrders()).length}:${inSync()}:${deps.getCradles?.().join('.') ?? ''}:${deps.hearths?.active ?? false}`
      const fy = Math.floor(y + 1e-6)
      if (selKey !== lastSel) {
        lastSel = selKey
        dirty = true
      }
      if (fy !== lastYear && (!playing || performance.now() - lastRefresh > 400)) {
        lastYear = fy
        dirty = true
      }
      if (dirty && (deps.getOrders().length > 0 || !collapsed || (hearthsSection?.countWords() ?? ''))) refresh()
      else if (dirty && collapsed) {
        dirty = false
        count.textContent = 'no orders'
      }
    },
  }
}
