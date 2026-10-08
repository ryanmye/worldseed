// The Library: every saga of the world read as a book, full screen. A table of contents on the left (the chronicle of
// the world and of each decade, every people, every state standing and fallen, the largest towns and on request all
// of them, the ruling houses, each with its years) and the chosen saga on the right, with the Chronicle / Legend
// register, the year it is told to, previous and next, Copy and Download .md; cross-references in the text are links.
// Opened from the Sagas panel, the B key (listed in the help), the chronicle's "Tell this decade" link, or the URL
// (library=1 with saga= and legend=, kept up to date while reading). Esc closes; ← → step through the contents; L
// switches the register. Built on first open, and nothing runs per frame: a saga is told when it is chosen, and cached
// (sagas/index.ts).

import type { History, World } from '../contract.ts'
import { decadeOf, generateSaga, parseSubject, sagaMarkdown, sagaSubjectValid, sagaText, subjectKey, type Saga, type SagaSubject } from './sagas/index.ts'
import { Ctx, topBy } from './sagas/facts.ts'
import { worldNameOf } from './sagas/world.ts'
import { renderSaga } from './sagas/render.ts'
import { addShortcut } from './shortcuts.ts'
import './library.css'

export interface LibraryDeps {
  /** Where the full-screen view is placed (the app root). */
  host: HTMLElement
  setUrlParam(name: string, value: string | null): void
  /** The timeline's year: the library opens told to it. */
  year(): number
  /** Select and fly to a town (the page's "Show on the map"). */
  onSelectSettlement?(id: number): void
}

export interface Library {
  commit(h: History | null, world: World | null, extend: boolean): void
  /** Opens on `subject` (else the last one read, else the world), in the register given (else the last). */
  open(subject?: SagaSubject, legend?: boolean): void
  close(): void
  readonly isOpen: boolean
}

interface Entry { s: SagaSubject; label: string; years: string; group: string; dim: boolean }

/** Cities and houses listed before "Show all". */
const FIRST_CITIES = 40, FIRST_HOUSES = 40

let instance: Library | null = null
/** The library, once created (the panel creates it). */
export const theLibrary = (): Library | null => instance

export function createLibrary(deps: LibraryDeps): Library {
  let history: History | null = null
  let world: World | null = null
  const params = new URLSearchParams(window.location.search)
  let subject: SagaSubject = parseSubject(params.get('saga')) ?? { kind: 'world', id: 0 }
  let legend = params.get('legend') === '1'
  let told = -1
  let wantOpen = params.get('library') === '1'
  let toldFromUrl = params.has('told') ? Number(params.get('told')) : params.get('library') === '1' && params.has('year') ? Number(params.get('year')) : -1
  let built = false
  let openNow = false
  let allCities = false, allHouses = false
  let filter = ''
  let century = -1
  let saga: Saga | null = null
  let entries: Entry[] = []
  let contentsKey = ''

  // ---------- DOM (built on first open) ----------
  const root = document.createElement('div')
  root.className = 'lib hidden'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', 'The library')
  const top = document.createElement('header')
  top.className = 'lib-top'
  const heading = document.createElement('h2')
  heading.className = 'lib-heading'
  const regWrap = document.createElement('div')
  regWrap.className = 'sg-register lib-register'
  regWrap.setAttribute('role', 'group')
  regWrap.setAttribute('aria-label', 'Register')
  const chronBtn = btn('Chronicle', 'Tell it plainly, as a chronicle (L switches)')
  const legBtn = btn('Legend', 'Tell the same facts as a legend (L switches)')
  regWrap.append(chronBtn, legBtn)
  const toldWrap = document.createElement('label')
  toldWrap.className = 'lib-told'
  toldWrap.append('Told to the year ')
  const toldInput = document.createElement('input')
  toldInput.type = 'number'
  toldInput.min = '0'
  toldInput.step = '1'
  toldInput.className = 'lib-told-input'
  toldInput.title = 'Nothing later than this year is told'
  const nowBtn = btn('Timeline', 'Tell it to the year the timeline shows', 'sg-btn')
  toldWrap.append(toldInput, nowBtn)
  const prevBtn = btn('←', 'Previous in the contents (←)', 'sg-btn lib-step')
  const nextBtn = btn('→', 'Next in the contents (→)', 'sg-btn lib-step')
  const copyBtn = btn('Copy', 'Copy the text', 'sg-btn')
  const dlBtn = btn('.md', 'Download as Markdown', 'sg-btn')
  const closeBtn = btn('×', 'Close the library (Esc)', 'lib-close')
  closeBtn.setAttribute('aria-label', 'Close the library')
  // (the phone layout: the contents are a drawer from the top, this button opens it; compact.css)
  const tocBtn = btn('Contents', 'The contents', 'sg-btn lib-toc-btn')
  tocBtn.setAttribute('aria-expanded', 'false')
  const setTocOpen = (open: boolean) => {
    root.classList.toggle('toc-open', open)
    tocBtn.setAttribute('aria-expanded', String(open))
  }
  tocBtn.addEventListener('click', () => setTocOpen(!root.classList.contains('toc-open')))
  top.append(heading, tocBtn, regWrap, toldWrap, prevBtn, nextBtn, copyBtn, dlBtn, closeBtn)
  const main = document.createElement('div')
  main.className = 'lib-main'
  const toc = document.createElement('nav')
  toc.className = 'lib-toc'
  toc.setAttribute('aria-label', 'Contents')
  const find = document.createElement('input')
  find.type = 'search'
  find.className = 'lib-find'
  find.placeholder = 'Find a name…'
  find.setAttribute('aria-label', 'Find in the contents')
  const tocList = document.createElement('div')
  tocList.className = 'lib-toc-list'
  toc.append(find, tocList)
  const page = document.createElement('div')
  page.className = 'lib-page'
  const text = document.createElement('article')
  text.className = 'sg-text lib-text'
  const foot = document.createElement('div')
  foot.className = 'lib-foot'
  page.append(text, foot)
  main.append(toc, page)
  root.append(top, main)

  function btn(label: string, title: string, cls = ''): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.title = title
    if (cls) b.className = cls
    return b
  }

  function build() {
    if (built) return
    built = true
    deps.host.appendChild(root)
    chronBtn.addEventListener('click', () => setLegend(false))
    legBtn.addEventListener('click', () => setLegend(true))
    toldInput.addEventListener('change', () => {
      const y = Math.round(Number(toldInput.value))
      if (!history || !Number.isFinite(y)) return
      told = Math.max(0, Math.min(history.years, y))
      deps.setUrlParam('told', String(told))
      fillToc()
      show()
    })
    nowBtn.addEventListener('click', () => { told = Math.floor(deps.year()); deps.setUrlParam('told', null); fillToc(); show() })
    prevBtn.addEventListener('click', () => step(-1))
    nextBtn.addEventListener('click', () => step(1))
    closeBtn.addEventListener('click', () => api.close())
    copyBtn.addEventListener('click', () => {
      if (!saga) return
      const t = sagaText(saga)
      const done = () => { copyBtn.textContent = 'Copied'; window.setTimeout(() => (copyBtn.textContent = 'Copy'), 1200) }
      navigator.clipboard?.writeText(t).then(done, () => undefined)
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
    find.addEventListener('input', () => { filter = find.value.trim().toLowerCase(); fillToc() })
    // (capture: before the app's shortcuts, which must not act behind the library)
    window.addEventListener('keydown', (e) => {
      if (!openNow) return
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (typing && find.value) { find.value = ''; filter = ''; fillToc() } else api.close()
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      e.stopPropagation()
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setLegend(!legend) }
    }, true)
  }

  function setLegend(on: boolean) {
    if (legend === on) return
    legend = on
    show()
  }

  // ---------- contents ----------
  function contents(): Entry[] {
    const h = history!
    const Y = told
    const c = new Ctx(h, world, Y)
    const out: Entry[] = []
    out.push({ s: { kind: 'world', id: 0 }, label: 'The Chronicle of the World', years: `to ${Y}`, group: 'World', dim: false })
    const cur = decadeOf(Y)
    out.push({ s: cur, label: `The years ${cur.id}–${cur.id + 9}`, years: 'this decade', group: 'World', dim: false })
    out.push({ s: { kind: 'year', id: Y }, label: `The year ${Y}`, years: 'this year', group: 'World', dim: false })
    // decades of the chosen century
    const cent = century >= 0 ? century : Math.floor(Y / 100) * 100
    for (let d = cent; d < cent + 100 && d <= Y; d += 10) if (d !== cur.id) out.push({ s: { kind: 'decade', id: d }, label: `The years ${d}–${d + 9}`, years: '', group: 'Decades', dim: false })
    // peoples, largest first
    const popOf = (p: number) => c.ix.ofPeople[p].reduce((a, id) => a + (c.alive(id) ? c.pop(id) : 0), 0)
    for (const p of topBy(h.peoples.map((x) => x.id), (p) => 1 + popOf(p), h.peoples.length)) {
      const gone = popOf(p) <= 0
      out.push({ s: { kind: 'people', id: p }, label: `The ${h.peoples[p].name}`, years: gone ? 'vanished' : '', group: 'Peoples', dim: gone })
    }
    // states, standing then fallen, greatest first
    const pd = c.pd
    if (pd) {
      const ids = pd.list.filter((x) => x.foundedYear <= Y).map((x) => x.id)
      const ranked = topBy(ids, (p) => 1 + c.ppeak(p).pop, ids.length)
      for (const standing of [true, false]) for (const p of ranked) {
        const x = pd.list[p]
        const ended = x.endedYear >= 0 && x.endedYear <= Y
        if (ended === standing) continue
        out.push({ s: { kind: 'state', id: p }, label: c.pgreatTitle(p), years: ended ? `${x.foundedYear}–${x.endedYear}` : `from ${x.foundedYear}`, group: standing ? 'States standing' : 'States fallen', dim: false })
      }
    }
    // towns, largest at their height first
    const towns = h.settlements.filter((s) => s.foundedYear <= Y && !s.outpost).map((s) => s.id)
    const rankedT = topBy(towns, (id) => 1 + c.peak(id).pop, allCities ? towns.length : FIRST_CITIES)
    for (const id of rankedT) {
      const s = h.settlements[id]
      const ab = s.abandonedYear >= 0 && s.abandonedYear <= Y
      out.push({ s: { kind: 'city', id }, label: c.name(id, Y), years: ab ? `${s.foundedYear}–${s.abandonedYear}` : `from ${s.foundedYear}`, group: 'Towns and cities', dim: ab })
    }
    // houses, by reigns
    const rd = c.rd
    if (rd && h.dynasties?.length) {
      const ds = h.dynasties.filter((d) => d.founded <= Y).map((d) => d.id)
      const reigns = (d: number) => rd.houseReigns[d].filter((r) => rd.rulers[r].acceded <= Y).length
      for (const d of topBy(ds, (d) => reigns(d), allHouses ? ds.length : FIRST_HOUSES)) {
        const D = h.dynasties[d]
        const ended = D.ended >= 0 && D.ended <= Y
        out.push({ s: { kind: 'house', id: d }, label: `House ${D.name}`, years: ended ? `${D.founded}–${D.ended}` : `from ${D.founded}`, group: 'Ruling houses', dim: ended })
      }
    }
    return out
  }

  function fillToc() {
    if (!history) return
    if (told < 0) told = Math.floor(deps.year())
    toldInput.max = String(history.years)
    toldInput.value = String(told)
    const ck = `${told}|${allCities}|${allHouses}|${century}|${history.years}`
    if (ck !== contentsKey || !entries.length) { entries = contents(); contentsKey = ck }
    const shown = filter ? entries.filter((e) => e.label.toLowerCase().includes(filter)) : entries
    tocList.textContent = ''
    let group = ''
    let ul: HTMLUListElement | null = null
    const key = subjectKey(subject)
    for (const e of shown) {
      if (e.group !== group) {
        group = e.group
        const h = document.createElement('div')
        h.className = 'lib-group'
        h.textContent = group
        if (group === 'Decades') h.appendChild(centuryPicker())
        tocList.appendChild(h)
        ul = document.createElement('ul')
        tocList.appendChild(ul)
        if (group === 'Towns and cities' || group === 'Ruling houses') {
          const more = document.createElement('button')
          more.type = 'button'
          more.className = 'gp-link lib-more'
          const all = group === 'Towns and cities' ? allCities : allHouses
          more.textContent = all ? 'Show the largest only' : 'Show all'
          more.addEventListener('click', () => { if (group === 'Towns and cities') allCities = !allCities; else allHouses = !allHouses; fillToc() })
          h.appendChild(more)
        }
      }
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'lib-entry' + (subjectKey(e.s) === key ? ' on' : '') + (e.dim ? ' dim' : '')
      const l = document.createElement('span')
      l.className = 'lib-entry-name'
      l.textContent = e.label
      const yy = document.createElement('span')
      yy.className = 'lib-entry-years'
      yy.textContent = e.years
      b.append(l, yy)
      b.addEventListener('click', () => { subject = e.s; setTocOpen(false); show() })
      li.appendChild(b)
      ul!.appendChild(li)
    }
  }

  function centuryPicker(): HTMLSelectElement {
    const sel = document.createElement('select')
    sel.className = 'view-select lib-century'
    sel.title = 'Which century'
    const Y = told
    for (let y = 0; y <= Y; y += 100) {
      const o = document.createElement('option')
      o.value = String(y)
      o.textContent = y < 100 ? 'the first century' : `the ${y}s`
      sel.appendChild(o)
    }
    sel.value = String(century >= 0 ? century : Math.floor(Y / 100) * 100)
    sel.addEventListener('change', () => { century = Number(sel.value); fillToc() })
    sel.addEventListener('click', (e) => e.stopPropagation())
    return sel
  }

  function step(d: number) {
    if (!entries.length) return
    const key = subjectKey(subject)
    const list = filter ? entries.filter((e) => e.label.toLowerCase().includes(filter)) : entries
    let i = list.findIndex((e) => subjectKey(e.s) === key)
    i = i < 0 ? 0 : (i + d + list.length) % list.length
    subject = list[i].s
    show()
  }

  // ---------- the page ----------
  function show() {
    if (!history || !openNow) return
    if (told < 0) told = Math.floor(deps.year())
    chronBtn.classList.toggle('on', !legend)
    legBtn.classList.toggle('on', legend)
    chronBtn.setAttribute('aria-pressed', String(!legend))
    legBtn.setAttribute('aria-pressed', String(legend))
    if (!sagaSubjectValid(history, subject, told)) {
      text.textContent = ''
      const p = document.createElement('p')
      p.className = 'sg-epigraph'
      p.textContent = `Nothing is recorded of it yet in the year ${told}.`
      text.appendChild(p)
      saga = null
    } else {
      saga = generateSaga(history, world, subject, legend, told)
      renderSaga(text, saga, (r) => { subject = r.subject; show() }, 'h2')
    }
    page.scrollTop = 0
    // the contents: mark the entry read (refill when it is not listed, as when a decade of another century is chosen)
    const key = subjectKey(subject)
    if ((subject.kind === 'decade') && century !== Math.floor(subject.id / 100) * 100 && subject.id !== decadeOf(told).id) { century = Math.floor(subject.id / 100) * 100 }
    fillToc()
    tocList.querySelector('.lib-entry.on')?.scrollIntoView({ block: 'nearest' })
    // previous / next
    const i = entries.findIndex((e) => subjectKey(e.s) === key)
    foot.textContent = ''
    if (i >= 0) {
      const prev = entries[(i - 1 + entries.length) % entries.length], next = entries[(i + 1) % entries.length]
      const a = btn(`← ${prev.label}`, 'Previous (←)', 'gp-link lib-foot-prev')
      a.addEventListener('click', () => step(-1))
      const b = btn(`${next.label} →`, 'Next (→)', 'gp-link lib-foot-next')
      b.addEventListener('click', () => step(1))
      foot.append(a, b)
    }
    if (subject.kind === 'city' && deps.onSelectSettlement && saga) {
      const m = btn('Show it on the map', 'Close the library and fly to the town', 'gp-link lib-foot-map')
      const id = subject.id
      m.addEventListener('click', () => { api.close(); deps.onSelectSettlement!(id) })
      foot.appendChild(m)
    }
    deps.setUrlParam('library', '1')
    deps.setUrlParam('saga', subjectKey(subject))
    deps.setUrlParam('legend', legend ? '1' : null)
  }

  function syncHeading() {
    if (!history) return
    heading.textContent = `The Library of ${worldNameOf(new Ctx(history, world, told >= 0 ? told : history.years))}`
  }

  const api: Library = {
    get isOpen() { return openNow },
    commit(h, w, extend) {
      history = h
      world = w
      if (!h) { if (openNow) api.close(); return }
      if (!extend) told = -1
      contentsKey = ''
      // (from the URL: once the timeline has its year, a moment after the history is shown)
      if (wantOpen) { wantOpen = false; window.setTimeout(() => api.open(), 0); return }
      if (openNow) { syncHeading(); show() }
    },
    open(s, leg) {
      if (!history) { wantOpen = true; if (s) subject = s; if (leg !== undefined) legend = leg; return }
      build()
      if (s) subject = s
      if (leg !== undefined) legend = leg
      told = toldFromUrl >= 0 ? Math.min(history.years, toldFromUrl) : Math.floor(deps.year())
      toldFromUrl = -1
      century = -1
      openNow = true
      root.classList.remove('hidden')
      document.body.classList.add('lib-open')
      syncHeading()
      show()
      closeBtn.focus()
    },
    close() {
      if (!openNow) return
      openNow = false
      root.classList.add('hidden')
      document.body.classList.remove('lib-open')
      deps.setUrlParam('library', null)
      deps.setUrlParam('told', null)
    },
  }
  instance = api
  addShortcut({ keys: ['b', 'B'], label: 'B', description: 'The library: every saga of the world, read as a book (Esc closes, ← → turn, L legend)', group: 'Panels', run: () => { if (!history) return false; if (openNow) api.close(); else api.open() } })
  return api
}

/** A "Tell this decade" link under the chronicle's heading: the library opens on the decade of the timeline's year. */
export function addDecadeLink(chronicle: Element | null, year: () => number): void {
  if (!chronicle) return
  const a = document.createElement('button')
  a.type = 'button'
  a.className = 'gp-link lib-decade-link'
  a.textContent = 'Tell this decade'
  a.title = 'What happened in the world in these ten years, in the library (B)'
  a.addEventListener('click', () => instance?.open(decadeOf(Math.floor(year()))))
  chronicle.insertBefore(a, chronicle.querySelector('.chr-list'))
}
