// Sagas: the right column's panel of prose histories (ui/sagas/), collapsed by default (A). A subject picker (the
// world, a people, a state, a city or a ruling house; the current selection pre-filled), the Chronicle / Legend
// register, the text in a readable scrolling column, a wider reading view over the map (Esc closes it), Copy and
// Download .md. A saga is told at the timeline's year when it is asked for (opening the panel, changing the subject
// or the register, or "Retell"), and cached per subject per history (sagas/index.ts): nothing happens per frame
// but a comparison of the year with the one the text was told at, and only while the panel is open.
// URL: saga=<kind>:<id> (or saga=world), legend=1. The inspector's links ("Read its legend") call open().

import type { History, World } from '../contract.ts'
import { generateSaga, parseSubject, sagaMarkdown, sagaSubjectValid, sagaText, subjectKey, type Saga, type SagaKind, type SagaSubject } from './sagas/index.ts'
import { Ctx, topBy } from './sagas/facts.ts'
import { loadFlag, panelToggled, registerPanel, saveFlag } from './panels.ts'
import { addShortcut } from './shortcuts.ts'
import './sagas.css'
import { addDecadeLink, createLibrary } from './library.ts'
import { renderSaga } from './sagas/render.ts'

export interface SagasViewDeps {
  right: HTMLElement
  /** The map area the reading view covers. */
  overlayHost: HTMLElement
  setUrlParam(name: string, value: string | null): void
  /** What is selected now (for pre-filling the picker): settlement, polity, people (-1 none). */
  selection(): { settlement: number; polity: number; people: number }
  /** The year the timeline shows, and whether it is playing (a paused timeline's new year is retold after a moment). */
  year(): number
  playing(): boolean
  /** Select (and fly to) a settlement. */
  onSelectSettlement(id: number): void
  /** The URL's saga= and legend= on load. */
  initial?: { subject: SagaSubject | null; legend: boolean }
}

export interface SagasView {
  commit(h: History | null, world: World | null, extend: boolean): void
  /** Opens the panel on `subject` (the inspector's links). */
  open(subject: SagaSubject): void
  /** The inspector's selected settlement (-1 none): fills its saga links. */
  showSettlement(id: number): void
  /** Cheap: only compares the year with the one told at while open. */
  tick(year: number): void
  /** The inspector's link row (placed by the history view). */
  readonly inspectorLinks: HTMLElement
}

const KIND_LABEL: Record<SagaKind, string> = { world: 'World', people: 'People', state: 'State', city: 'City', house: 'House', decade: 'Decade', year: 'Year' }
/** Entries per subject list (the selected subject is always added). */
const LIST_CAP = 80

export function createSagasView(deps: SagasViewDeps): SagasView {
  // ---------- panel ----------
  const root = document.createElement('div')
  root.className = 'panel sagas hidden'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'gp-head'
  head.title = 'Show or hide the sagas (A)'
  const title = document.createElement('span')
  title.className = 'gp-title'
  title.textContent = 'Sagas'
  const count = document.createElement('span')
  count.className = 'gp-count'
  count.textContent = 'histories told from the records'
  const caret = document.createElement('span')
  caret.className = 'caret'
  caret.setAttribute('aria-hidden', 'true')
  head.append(title, count, caret)
  const body = document.createElement('div')
  body.className = 'gp-body sg-body'
  body.id = 'sagas-body'
  head.setAttribute('aria-controls', body.id)

  const controls = document.createElement('div')
  controls.className = 'sg-controls'
  const kindSel = document.createElement('select')
  kindSel.className = 'view-select sg-kind'
  kindSel.title = 'What the saga is about'
  for (const k of ['world', 'people', 'state', 'city', 'house'] as SagaKind[]) {
    const o = document.createElement('option')
    o.value = k
    o.textContent = KIND_LABEL[k]
    kindSel.appendChild(o)
  }
  const subjSel = document.createElement('select')
  subjSel.className = 'view-select sg-subject'
  subjSel.title = 'Whose saga'
  controls.append(kindSel, subjSel)

  const bar = document.createElement('div')
  bar.className = 'sg-bar'
  const regWrap = document.createElement('div')
  regWrap.className = 'sg-register'
  regWrap.setAttribute('role', 'group')
  regWrap.setAttribute('aria-label', 'Register')
  const chronBtn = document.createElement('button')
  chronBtn.type = 'button'
  chronBtn.textContent = 'Chronicle'
  chronBtn.title = 'Tell it plainly, as a chronicle'
  const legBtn = document.createElement('button')
  legBtn.type = 'button'
  legBtn.textContent = 'Legend'
  legBtn.title = 'Tell the same facts as a legend, with epithets'
  regWrap.append(chronBtn, legBtn)
  const readBtn = document.createElement('button')
  readBtn.type = 'button'
  readBtn.className = 'sg-btn'
  readBtn.textContent = 'Read'
  readBtn.title = 'Read it in a wider view over the map (Esc closes)'
  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'sg-btn'
  copyBtn.textContent = 'Copy'
  copyBtn.title = 'Copy the text'
  const dlBtn = document.createElement('button')
  dlBtn.type = 'button'
  dlBtn.className = 'sg-btn'
  dlBtn.textContent = '.md'
  dlBtn.title = 'Download as Markdown'
  bar.append(regWrap, readBtn, copyBtn, dlBtn)

  const told = document.createElement('div')
  told.className = 'sg-told'
  const toldText = document.createElement('span')
  const retell = document.createElement('button')
  retell.type = 'button'
  retell.className = 'gp-link sg-retell'
  retell.hidden = true
  told.append(toldText, retell)

  const text = document.createElement('article')
  text.className = 'sg-text'
  const libLink = document.createElement('button')
  libLink.type = 'button'
  libLink.className = 'gp-link sg-library'
  libLink.textContent = 'Open the library'
  libLink.title = 'Every saga of the world, read as a book (B)'
  libLink.addEventListener('click', () => library.open(subject, legend))
  body.append(controls, bar, told, text, libLink)
  root.append(head, body)
  deps.right.insertBefore(root, deps.right.querySelector('.chronicle'))
  // the library (full screen) and the chronicle's "Tell this decade"
  const library = createLibrary({ host: document.body, setUrlParam: deps.setUrlParam, year: deps.year, onSelectSettlement: deps.onSelectSettlement })
  addDecadeLink(deps.right.querySelector('.chronicle'), deps.year)

  // ---------- reading view ----------
  const reader = document.createElement('div')
  reader.className = 'sg-reader hidden'
  reader.setAttribute('role', 'dialog')
  reader.setAttribute('aria-label', 'Saga')
  const readerClose = document.createElement('button')
  readerClose.type = 'button'
  readerClose.className = 'sg-reader-close'
  readerClose.textContent = '×'
  readerClose.title = 'Close (Esc)'
  readerClose.setAttribute('aria-label', 'Close the reading view')
  const readerText = document.createElement('article')
  readerText.className = 'sg-text sg-reader-text'
  reader.append(readerClose, readerText)
  deps.overlayHost.appendChild(reader)
  const readerOpen = () => !reader.classList.contains('hidden')
  const closeReader = () => reader.classList.add('hidden')
  readerClose.addEventListener('click', closeReader)
  reader.addEventListener('click', (e) => { if (e.target === reader) closeReader() })
  // (capture: before the shortcuts' Esc, which would deselect)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && readerOpen()) {
      e.preventDefault()
      e.stopPropagation()
      closeReader()
    }
  }, true)

  // ---------- state ----------
  let history: History | null = null
  let world: World | null = null
  let subject: SagaSubject = deps.initial?.subject && deps.initial.subject.kind !== 'decade' && deps.initial.subject.kind !== 'year' ? deps.initial.subject : { kind: 'world', id: 0 }
  let legend = deps.initial?.legend ?? false
  let saga: Saga | null = null
  let shown = ''
  let lastYear = 0
  let selSettlement = -1
  let notYet = false
  let seenYear = -1, seenAt = 0
  const fromUrl = !!deps.initial?.subject
  let collapsed = fromUrl ? false : loadFlag('worldseed.sagas.collapsed', true)

  const syncCollapsed = () => {
    root.classList.toggle('collapsed', collapsed)
    head.setAttribute('aria-expanded', String(!collapsed))
  }
  syncCollapsed()
  const toggleCollapsed = () => {
    collapsed = !collapsed
    saveFlag('worldseed.sagas.collapsed', collapsed)
    syncCollapsed()
    panelToggled('sagas', !collapsed)
    if (!collapsed) {
      prefill()
      tell()
      window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
    }
  }
  head.addEventListener('click', toggleCollapsed)
  registerPanel('sagas', root, () => !collapsed, () => { if (!collapsed) toggleCollapsed() })
  addShortcut({ keys: ['a', 'A'], label: 'A', description: 'Show or hide the sagas (histories told from the records)', group: 'Panels', run: () => (history ? toggleCollapsed() : false) })

  const syncRegister = () => {
    chronBtn.classList.toggle('on', !legend)
    legBtn.classList.toggle('on', legend)
    chronBtn.setAttribute('aria-pressed', String(!legend))
    legBtn.setAttribute('aria-pressed', String(legend))
  }
  syncRegister()

  /** The current selection as a subject (a town first, then a state, then a people), if any. */
  function prefill() {
    if (!history || fromUrlPending) return
    const sel = deps.selection()
    if (sel.settlement >= 0) subject = { kind: 'city', id: sel.settlement }
    else if (sel.polity >= 0) subject = { kind: 'state', id: sel.polity }
    else if (sel.people >= 0) subject = { kind: 'people', id: sel.people }
  }
  let fromUrlPending = fromUrl

  /** Subjects of a kind for the picker, largest first (told at `year`). */
  function subjectsOf(kind: SagaKind, year: number): { id: number; label: string }[] {
    const h = history!
    if (kind === 'world') return [{ id: 0, label: 'The world' }]
    const c = new Ctx(h, world, year)
    if (kind === 'people') return topBy(h.peoples.map((p) => p.id), (p) => 1 + c.ix.ofPeople[p].reduce((a, id) => a + c.pop(id), 0), h.peoples.length).map((p) => ({ id: p, label: `the ${h.peoples[p].name}` }))
    if (kind === 'state') {
      const ids = (h.polities ?? []).filter((x) => x.foundedYear <= year).map((x) => x.id)
      return topBy(ids, (p) => 1 + c.ppeak(p).pop, LIST_CAP).map((p) => {
        const x = h.polities[p]
        const end = x.endedYear >= 0 && x.endedYear <= year ? `${x.endedYear}` : ''
        return { id: p, label: `${c.pgreatTitle(p)} (${x.foundedYear}–${end})` }
      })
    }
    if (kind === 'city') {
      const ids: number[] = []
      for (const s of h.settlements) if (s.foundedYear <= year && !s.outpost) ids.push(s.id)
      return topBy(ids, (id) => 1 + c.peak(id).pop, LIST_CAP).map((id) => ({ id, label: `${c.name(id, year)}${c.alive(id) ? '' : ' (ruin)'}` }))
    }
    const rd = c.rd
    if (!rd) return []
    const ids = h.dynasties.filter((d) => d.founded <= year).map((d) => d.id)
    return topBy(ids, (d) => 1 + rd.houseReigns[d].filter((r) => rd.rulers[r].acceded <= year).length, LIST_CAP).map((d) => ({ id: d, label: `House ${h.dynasties[d].name}` }))
  }

  function fillPicker(year: number) {
    kindSel.value = subject.kind
    for (const o of kindSel.options) {
      const k = o.value as SagaKind
      o.disabled = !!history && ((k === 'state' && !(history.polities?.length)) || (k === 'house' && !(history.dynasties?.length)))
    }
    subjSel.textContent = ''
    const items = history ? subjectsOf(subject.kind, year) : []
    if (subject.kind !== 'world' && !items.some((x) => x.id === subject.id) && history && sagaSubjectValid(history, subject, year)) {
      const c = new Ctx(history, world, year)
      const label = subject.kind === 'city' ? c.name(subject.id, year) : subject.kind === 'state' ? c.pgreatTitle(subject.id) : subject.kind === 'people' ? `the ${history.peoples[subject.id].name}` : `House ${history.dynasties[subject.id].name}`
      items.unshift({ id: subject.id, label })
    }
    for (const x of items) {
      const o = document.createElement('option')
      o.value = String(x.id)
      o.textContent = x.label
      subjSel.appendChild(o)
    }
    subjSel.value = String(subject.id)
    subjSel.hidden = subject.kind === 'world'
  }

  function render(target: HTMLElement, s: Saga) {
    renderSaga(target, s, (r) => { if (r.subject.kind === 'decade' || r.subject.kind === 'year') library.open(r.subject, legend); else { subject = r.subject; tell() } })
  }

  /** Tells the saga of the subject at the timeline's year (cached), and shows it. */
  function tell() {
    if (!history || collapsed) return
    const year = Math.floor(deps.year())
    lastYear = year
    retell.hidden = true
    if (!sagaSubjectValid(history, subject, year)) {
      // (not founded yet at this year: say so, and keep the subject for when it is)
      if (fromUrlPending || shown === '') {
        notYet = true
        text.textContent = ''
        const p = document.createElement('p')
        p.className = 'sg-epigraph'
        p.textContent = `Nothing is recorded of it yet in the year ${year}.`
        text.appendChild(p)
        toldText.textContent = ''
        shown = ''
        saga = null
        return
      }
      subject = { kind: 'world', id: 0 }
    }
    notYet = false
    fromUrlPending = false
    const key = `${subjectKey(subject)}|${legend ? 1 : 0}|${year}`
    fillPicker(year)
    if (key === shown && saga) return
    saga = generateSaga(history, world, subject, legend, year)
    shown = key
    render(text, saga)
    if (readerOpen()) render(readerText, saga)
    text.scrollTop = 0
    toldText.textContent = `Told to the year ${year}.`
    count.textContent = saga.title
    deps.setUrlParam('saga', subject.kind === 'world' && !legend ? null : subjectKey(subject))
    deps.setUrlParam('legend', legend ? '1' : null)
  }

  kindSel.addEventListener('change', () => {
    const k = kindSel.value as SagaKind
    const sel = deps.selection()
    let id = 0
    if (k === 'city') id = sel.settlement >= 0 ? sel.settlement : -1
    else if (k === 'state') id = sel.polity >= 0 ? sel.polity : -1
    else if (k === 'people') id = sel.people >= 0 ? sel.people : sel.settlement >= 0 && history ? history.settlements[sel.settlement].people : -1
    if (id < 0 && history) id = subjectsOf(k, Math.floor(deps.year()))[0]?.id ?? 0
    subject = { kind: k, id }
    tell()
  })
  subjSel.addEventListener('change', () => {
    subject = { kind: subject.kind, id: Number(subjSel.value) }
    tell()
  })
  chronBtn.addEventListener('click', () => { if (legend) { legend = false; syncRegister(); tell() } })
  legBtn.addEventListener('click', () => { if (!legend) { legend = true; syncRegister(); tell() } })
  retell.addEventListener('click', () => tell())
  readBtn.addEventListener('click', () => {
    if (!saga) return
    render(readerText, saga)
    reader.classList.remove('hidden')
    readerText.scrollTop = 0
    readerClose.focus()
  })
  copyBtn.addEventListener('click', () => {
    if (!saga) return
    const t = sagaText(saga)
    const done = () => { copyBtn.textContent = 'Copied'; window.setTimeout(() => (copyBtn.textContent = 'Copy'), 1200) }
    navigator.clipboard?.writeText(t).then(done, () => fallbackCopy(t, done)) ?? fallbackCopy(t, done)
  })
  dlBtn.addEventListener('click', () => {
    if (!saga) return
    const blob = new Blob([sagaMarkdown(saga)], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${saga.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })
  function fallbackCopy(t: string, done: () => void) {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); done() } catch { /* (nothing to do) */ }
    ta.remove()
  }

  // ---------- inspector links ----------
  const links = document.createElement('div')
  links.className = 'sg-links hidden'
  const linkCity = document.createElement('button')
  linkCity.type = 'button'
  linkCity.className = 'gp-link'
  linkCity.textContent = 'Read its legend'
  const linkPeople = document.createElement('button')
  linkPeople.type = 'button'
  linkPeople.className = 'gp-link'
  const linkState = document.createElement('button')
  linkState.type = 'button'
  linkState.className = 'gp-link'
  links.append(linkCity, linkPeople, linkState)
  let linkPeopleId = -1, linkStateId = -1
  linkCity.addEventListener('click', () => { if (selSettlement >= 0) api.open({ kind: 'city', id: selSettlement }) })
  linkPeople.addEventListener('click', () => { if (linkPeopleId >= 0) api.open({ kind: 'people', id: linkPeopleId }) })
  linkState.addEventListener('click', () => { if (linkStateId >= 0) api.open({ kind: 'state', id: linkStateId }) })
  function syncLinks() {
    const h = history
    links.classList.toggle('hidden', !h || selSettlement < 0)
    if (!h || selSettlement < 0) return
    const year = Math.floor(deps.year())
    linkPeopleId = h.settlements[selSettlement].people
    linkPeople.textContent = `the saga of the ${h.peoples[linkPeopleId]?.name ?? 'people'}`
    const pol = h.polity && h.polities?.length ? h.polity[Math.max(0, Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))) * h.settlements.length + selSettlement] : -1
    linkStateId = pol
    linkState.hidden = pol < 0
    if (pol >= 0) linkState.textContent = `a history of ${new Ctx(h, world, year).pname(pol)}`
  }

  const api: SagasView = {
    inspectorLinks: links,
    commit(h, w, extend) {
      history = h
      library.commit(h, w, extend)
      world = w
      root.classList.toggle('hidden', !h)
      if (!h) { closeReader(); saga = null; shown = ''; text.textContent = ''; return }
      if (!extend) { saga = null; shown = '' }
      if (!collapsed) tell()
      syncLinks()
    },
    open(s) {
      subject = s
      fromUrlPending = false
      if (collapsed) toggleCollapsed()
      tell()
      window.setTimeout(() => root.scrollIntoView({ block: 'nearest' }), 80)
    },
    showSettlement(id) {
      selSettlement = id
      syncLinks()
    },
    tick(year) {
      if (collapsed || !history || (!saga && !notYet)) return
      const y = Math.floor(year)
      if (y === lastYear) { if (!retell.hidden) retell.hidden = true; return }
      // a paused timeline: retell at the new year once it has stayed there a moment (not while scrubbing)
      const now = performance.now()
      if (y !== seenYear) { seenYear = y; seenAt = now }
      else if (!deps.playing() && now - seenAt > 350) { tell(); return }
      if (retell.hidden) {
        retell.hidden = false
        retell.textContent = 'Retell to now'
      }
    },
  }
  return api
}

/** saga= and legend= from the URL. */
export function sagaParamsFrom(params: URLSearchParams): { subject: SagaSubject | null; legend: boolean } {
  return { subject: parseSubject(params.get('saga')), legend: params.get('legend') === '1' }
}
