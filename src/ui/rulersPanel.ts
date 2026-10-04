// rulers in the UI: the ruler section of the Factions panel's detail (politiesPanel.ts hooks), and the
// inspector's seat line. For the selected state at the year shown:
//  - the title line gains its ruler ("Kingdom of Rilkochal, under Narun II of House Rilkoik");
//  - the ruler now: name and title, age, years on the throne, temperament in plain words, faith, how
//    they came to the throne (and from whom), a regency while it lasts;
//  - its state religion, personal unions and marriage ties (links to the other state);
//  - the king list (scrollable; a click jumps to that reign's accession), the reign now marked;
//  - the house's lineage strip: its reigns on every throne it held, each with its kin to the one
//    before (son, brother, a cadet line), regencies, usurpers, and where and why the line ended;
//  - wars of succession and holy wars tagged in the war list.
// Everything is a function of the year; the section is rebuilt only when what it shows changes (its
// lists keep their scroll position across the detail's yearly rebuilds). Without rulers data nothing
// is hooked and the Factions panel looks as before.

import { AccessionHow, ReignEnd, UnionEnd, type History } from '../contract.ts'
import { formatInt, settlementName } from './format.ts'
import { capitalAt, polityAtYear } from './politiesData.ts'
import { setPolityRulersHooks } from './politiesPanel.ts'
import {
  END_WORDS, generationOf, his, houseName, isCadet, kinToPredecessor, kinWordOfPredecessor, listWords, marriagePartner, reignsOf, rulerAt, rulerFaithAt, rulersOf, rulerWord, traitWords, type RulersData,
} from './rulersData.ts'
import { faithName, faithSnap, faithsOf, stateFaithAt, type FaithsData } from './faithsData.ts'
import { requestRender } from '../render/invalidate.ts'
import './rulers.css'

export interface RulersViewDeps {
  /** Inspector slot shared with the faith lines (faithsPanel.ts): the seat line goes first. */
  inspectorSlot: HTMLElement
  /** Jump the timeline to a year (paused where it was paused). */
  setYear(year: number): void
}

export interface RulersView {
  /** The history shown (null: none); hooks the Factions panel when it has rulers. */
  commit(h: History | null): void
  showSettlement(id: number): void
  tick(year: number): void
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function createRulersView(deps: RulersViewDeps): RulersView {
  let rd: RulersData | null = null
  let fd: FaithsData | null = null
  let year = 0
  let inspected = -1
  let shownSeat = ''
  const seat = document.createElement('div')
  seat.className = 'ir-seat hidden'
  deps.inspectorSlot.append(seat)

  // ---------- the Factions detail section ----------
  const section = document.createElement('div')
  section.className = 'rp-section'
  const nowBlock = document.createElement('div')
  nowBlock.className = 'rp-now'
  const listCap = document.createElement('div')
  listCap.className = 'fp-d-cap'
  const list = document.createElement('div')
  list.className = 'rp-list'
  const houseCap = document.createElement('div')
  houseCap.className = 'fp-d-cap'
  const house = document.createElement('div')
  house.className = 'rp-house'
  section.append(nowBlock, listCap, list, houseCap, house)
  let listTop = 0, houseTop = 0
  list.addEventListener('scroll', () => (listTop = list.scrollTop), { passive: true })
  house.addEventListener('scroll', () => (houseTop = house.scrollTop), { passive: true })
  section.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-year]') as HTMLElement | null
    if (!t || (e.target as HTMLElement).closest('[data-polity], [data-sid]')) return
    deps.setYear(Number(t.dataset.year))
    requestRender()
  })
  let shownNowKey = ''
  let shownListKey = ''
  let shownHouseKey = ''
  /** The reign highlighted when the list was last scrolled to it. */
  let scrolledTo = -1

  const el = (tag: string, cls: string, ...parts: (string | Node)[]) => {
    const e = document.createElement(tag)
    e.className = cls
    e.append(...parts)
    return e
  }
  const span = (cls: string, text: string, tip?: string) => {
    const s = document.createElement('span')
    s.className = cls
    s.textContent = text
    if (tip) s.title = tip
    return s
  }
  const polityLink = (q: number) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fp-link'
    b.dataset.polity = String(q)
    const sw = document.createElement('span')
    sw.className = 'fp-swatch'
    // (the colour: the Factions panel's, from its data via the same history)
    const css = rd?.pd.css[q]
    if (css) sw.style.background = css
    b.append(sw, rd ? rd.pd.names[q] : '')
    return b
  }
  const years = (a: number, b: number) => (b >= 0 && b <= year ? `${a}–${b}` : `${a}–`)

  /** "Narun II of House Rilkoik" for the title line, '' without a ruler then. */
  function title(p: number, y: number): string {
    if (!rd) return ''
    const r = rulerAt(rd, p, y)
    if (r < 0) return ''
    const hn = houseName(rd, r)
    return `, under ${rd.title[r]}${hn ? ` of ${hn}` : ''}`
  }

  /** The ruler now, the state religion, unions, marriages. */
  function fillNow(p: number) {
    const R = rd!
    const h = R.history
    nowBlock.replaceChildren()
    const line = (...parts: (string | Node)[]) => {
      const d = el('div', 'fp-d-line', ...parts)
      nowBlock.append(d)
      return d
    }
    const r = rulerAt(R, p, year)
    if (r >= 0) {
      const x = R.rulers[r]
      const age = year - x.born
      const reign = year - x.acceded
      const head = line(span('rp-name', `${rulerWord(R, r, year)} ${R.title[r]}`), houseName(R, r) ? ` of ${houseName(R, r)}` : '')
      head.append(span('rp-faint', ` · ${age}, ${reign === 0 ? 'crowned this year' : `on the throne ${reign} ${reign === 1 ? 'year' : 'years'}`}`))
      // temperament and faith
      const f = fd ? rulerFaithAt(R, r, year) : -1
      const tw = traitWords(x, !!fd)
      line(cap1(listWords(tw)) + (fd && f >= 0 ? `; of ${faithName(fd, f, false)}` : ''))
      // how they came to the throne
      const o = x.predecessor
      const kin = kinWordOfPredecessor(R, r)
      let how = ''
      switch (x.how) {
        case AccessionHow.Inherited:
          how = kin ? `Succeeded ${his(x)} ${kin} ${o >= 0 ? R.title[o] : ''}` : isCadet(R, r) ? `Came to the throne from a cadet line of the house` : 'Inherited the throne'
          break
        case AccessionHow.Elected: how = x.dynasty < 0 ? 'Elected head of the league' : o >= 0 && R.rulers[o].dynasty !== x.dynasty ? `Raised to the throne by the great men when House ${R.dynasties[R.rulers[o].dynasty]?.name ?? ''} failed` : 'Elected by the great men of the realm'; break
        case AccessionHow.Usurped: how = `Seized the throne${o >= 0 ? ` from ${R.title[o]}` : ''}`; break
        case AccessionHow.Conquered: how = 'Set on the throne by conquerors'; break
        case AccessionHow.Union: how = 'Inherited it through a marriage claim'; break
        case AccessionHow.Claimed: how = 'Rose as a rival claimant to the throne'; break
        default: how = 'Founded the realm'
      }
      const hl = line(`${how} in ${x.acceded}`)
      if (o >= 0 && R.rulers[o].end !== ReignEnd.Natural && R.rulers[o].end !== ReignEnd.Reigning && x.how !== AccessionHow.Usurped) hl.append(span('rp-faint', ` (${R.title[o]} ${END_WORDS[R.rulers[o].end]})`))
      if (R.regency[r] > 0 && year < x.acceded + R.regency[r]) line(span('rp-tag', 'regency'), ` A regency rules until ${x.acceded + R.regency[r]}, when ${x.female ? 'she' : 'he'} comes of age`)
      // the same person on another throne (a union)
      for (const q of personThrones(R, r, year)) line('Also rules ', polityLink(q), ' in a personal union')
    } else {
      const last = lastReignBy(R, p, year)
      if (last >= 0) line(span('rp-faint', `No ruler since ${R.rulers[last].ended} (${R.title[last]} ${END_WORDS[R.rulers[last].end] || 'left the throne'})`))
    }
    // state religion
    if (fd) {
      const s = faithSnap(fd, year)
      const sf = stateFaithAt(fd, p, s)
      if (sf >= 0) {
        let s0 = s
        while (s0 > 0 && stateFaithAt(fd, p, s0 - 1) === sf) s0--
        line(`State religion: ${faithName(fd, sf)}`, span('rp-faint', ` since ${Math.max(R.pd.list[p]?.foundedYear ?? 0, s0 * fd.interval)}`)).classList.add('rp-faith')
      }
    }
    // personal unions (in force, then past)
    const U = h.unions
    if (U) {
      for (const k of R.unionsOf[p]) {
        if (U.startYear[k] > year) continue
        const senior = U.senior[k] === p
        const other = senior ? U.junior[k] : U.senior[k]
        const on = U.endYear[k] < 0 || U.endYear[k] > year
        const d = line(span('rp-tag union', 'union'), ' ')
        if (on) {
          d.append(senior ? 'Its ruler also holds the throne of ' : 'Bound in personal union to ', polityLink(other), ` since ${U.startYear[k]}`)
        } else {
          d.append(senior ? 'Held the throne of ' : 'In personal union with ', polityLink(other), ` ${U.startYear[k]}–${U.endYear[k]}`)
          const end = U.end[k] === UnionEnd.Merged ? (senior ? ', merged into it' : ', merged into it') : U.end[k] === UnionEnd.Split ? ', split apart' : ', ended with a realm'
          d.append(end)
          d.classList.add('fp-faint')
        }
      }
    }
    // marriage ties
    const M = h.marriages
    if (M && R.marriagesOf[p].length) {
      const now: number[] = [], past: number[] = []
      for (const k of R.marriagesOf[p]) {
        if (M.year[k] > year) continue
        if (M.endYear[k] < 0 || M.endYear[k] > year) now.push(k)
        else past.push(k)
      }
      if (now.length) {
        const d = line('Marriage ties with ')
        now.slice(-6).forEach((k, i) => {
          if (i) d.append(', ')
          d.append(polityLink(marriagePartner(R, k, p)), ` (${M.year[k]})`)
        })
      }
      if (past.length) {
        const d = line(`Earlier ties: `)
        d.classList.add('fp-faint')
        const shown = past.slice(-4)
        shown.forEach((k, i) => {
          if (i) d.append(', ')
          d.append(polityLink(marriagePartner(R, k, p)), ` (${M.year[k]}–${M.endYear[k]})`)
        })
        if (past.length > shown.length) d.append(` and ${past.length - shown.length} more`)
      }
    }
  }

  /** The king list: every reign acceded by the year, the one now marked. */
  function fillList(p: number, rs: Int32Array, n: number, cur: number) {
    const R = rd!
    list.replaceChildren()
    listCap.textContent = `Rulers (${formatInt(n)})`
    for (let k = 0; k < n; k++) {
      const r = rs[k]
      const x = R.rulers[r]
      const row = el('button', 'rp-row' + (r === cur ? ' now' : ''))
      ;(row as HTMLButtonElement).type = 'button'
      row.dataset.year = String(x.acceded)
      const end = x.ended >= 0 && x.ended <= year ? END_WORDS[x.end] : ''
      const tags: Node[] = []
      if (x.how === AccessionHow.Usurped) tags.push(span('rp-tag usurp', 'usurper', 'Seized the throne'))
      else if (x.how === AccessionHow.Union) tags.push(span('rp-tag union', 'union', 'Inherited through a marriage claim: a personal union'))
      else if (x.how === AccessionHow.Conquered) tags.push(span('rp-tag usurp', 'conquest', 'Set on the throne by conquerors'))
      else if (x.how === AccessionHow.Elected && x.dynasty >= 0) tags.push(span('rp-tag', 'elected', 'Chosen by the great men of the realm'))
      if (isCadet(R, r)) tags.push(span('rp-tag cadet', 'cadet', 'A kinsman from a cadet line of the house'))
      if (R.regency[r] > 0) tags.push(span('rp-tag', 'regency', `Came to the throne aged ${x.acceded - x.born}: a regency ruled until ${x.acceded + R.regency[r]}`))
      const d = x.dynasty
      const prevD = k > 0 ? R.rulers[rs[k - 1]].dynasty : -2
      const hn = d >= 0 && d !== prevD ? span('rp-house-name', R.dynasties[d].name) : null
      row.append(span('rp-y', years(x.acceded, x.ended)), span('rp-n', R.title[r]), ...tags, ...(hn ? [hn] : []))
      if (end) row.append(span('rp-end', end))
      row.title = `${rulerWord(R, r, x.acceded)} ${R.title[r]}${houseName(R, r) ? ` of ${houseName(R, r)}` : ''}, ${years(x.acceded, x.ended)}${end ? ` (${end})` : ''}. Click to go to ${x.acceded}.`
      list.append(row)
    }
    void p
  }

  /** The house of the reign now (or the last): its reigns on every throne, with kin, regencies, cadet lines and its end. */
  function fillHouse(r: number) {
    const R = rd!
    house.replaceChildren()
    const x = R.rulers[r]
    const d = x.dynasty
    if (d < 0 || d >= R.D) {
      houseCap.textContent = ''
      houseCap.classList.add('hidden')
      house.classList.add('hidden')
      return
    }
    houseCap.classList.remove('hidden')
    house.classList.remove('hidden')
    const dy = R.dynasties[d]
    const all = R.houseReigns[d].filter((k) => R.rulers[k].acceded <= year)
    // (a person on two thrones is listed once, on the first)
    const seen = new Set<number>()
    const reigns = all.filter((k) => (seen.has(R.rulers[k].person) ? false : (seen.add(R.rulers[k].person), true)))
    houseCap.textContent = `House ${dy.name} · ${years(dy.founded, dy.ended)}`
    let maxGen = 0
    const gens = reigns.map((k) => {
      const g = generationOf(R, k)
      if (g > maxGen) maxGen = g
      return g
    })
    // (indented by generation within a window, so a long house still fits)
    const base = Math.max(0, maxGen - 7)
    reigns.forEach((k, i) => {
      const y = R.rulers[k]
      const row = el('button', 'rp-strip' + (R.rulers[k].person === x.person ? ' now' : ''))
      ;(row as HTMLButtonElement).type = 'button'
      row.dataset.year = String(y.acceded)
      row.style.paddingLeft = `${4 + Math.max(0, gens[i] - base) * 7}px`
      const rel = relationWords(R, k)
      row.append(span('rp-gen', gens[i] > 0 ? '└' : '•'), span('rp-n', R.title[k]), span('rp-y', ` ${y.acceded}`))
      if (y.polity !== x.polity) row.append(span('rp-faint', ` of ${R.pd.names[y.polity]}`))
      if (rel) row.append(span('rp-rel', ` ${rel}`))
      if (R.regency[k] > 0) row.append(span('rp-tag', 'regency'))
      if (isCadet(R, k)) row.append(span('rp-tag cadet', 'cadet'))
      if (y.how === AccessionHow.Usurped && R.dynasties[d].founder === k) row.append(span('rp-tag usurp', 'usurper'))
      row.title = `${R.title[k]}, ${years(y.acceded, y.ended)}${y.polity !== x.polity ? ` (on the throne of ${R.pd.names[y.polity]})` : ''}${rel ? `: ${rel}` : ''}. Click to go to ${y.acceded}.`
      house.append(row)
    })
    if (dy.ended >= 0 && dy.ended <= year) {
      const last = R.houseReigns[d].filter((k) => R.rulers[k].acceded <= dy.ended).pop() ?? -1
      house.append(el('div', 'rp-end-line', `The line ended in ${dy.ended}` + (last >= 0 ? `: ${lineEndWords(R, last)}` : '')))
    }
  }

  function updateSection(p: number, y: number, parent: HTMLElement) {
    if (!rd) return
    const R = rd
    year = y
    const yi = Math.floor(y + 1e-6)
    const cur = rulerAt(R, p, y)
    const rs = reignsOf(R, p)
    let n = 0
    while (n < rs.length && R.rulers[rs[n]].acceded <= y) n++
    if (n === 0) return // (no ruler yet: nothing to add)
    const nowKey = `${p}:${cur}:${yi}`
    if (nowKey !== shownNowKey) {
      shownNowKey = nowKey
      fillNow(p)
    }
    const lastEnded = n > 0 && R.rulers[rs[n - 1]].ended >= 0 && R.rulers[rs[n - 1]].ended <= y ? 1 : 0
    const listKey = `${p}:${n}:${cur}:${lastEnded}`
    let listChanged = false
    if (listKey !== shownListKey) {
      shownListKey = listKey
      fillList(p, rs, n, cur)
      listChanged = true
    }
    const hr = cur >= 0 ? cur : rs[n - 1]
    const d = R.rulers[hr].dynasty
    const hk = d >= 0 ? R.houseReigns[d].length : 0
    let houseN = 0
    if (d >= 0) for (const k of R.houseReigns[d]) if (R.rulers[k].acceded <= y) houseN++
    const houseKey = `${p}:${hr}:${d}:${houseN}:${hk}:${d >= 0 && R.dynasties[d].ended >= 0 && R.dynasties[d].ended <= y ? 1 : 0}`
    if (houseKey !== shownHouseKey) {
      shownHouseKey = houseKey
      fillHouse(hr)
      houseTop = house.scrollHeight // (newest reign at the bottom: shown)
    }
    parent.append(section)
    // the lists keep their scroll positions across the detail's rebuilds; a new reign scrolls into view
    if (listChanged || scrolledTo !== cur) {
      scrolledTo = cur
      const row = list.querySelector('.rp-row.now') as HTMLElement | null
      listTop = row ? Math.max(0, row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2) : list.scrollHeight
    }
    list.scrollTop = listTop
    house.scrollTop = houseTop
  }

  /** War tag for the Factions war list. */
  function warTag(w: number): string {
    if (rd?.succWar.has(w)) return 'war of succession'
    if (fd && fd.holyWarFaith.has(w)) return 'holy war'
    return ''
  }

  // ---------- the inspector's seat line ----------
  function updateSeat() {
    if (!rd || inspected < 0) {
      if (shownSeat) {
        shownSeat = ''
        seat.classList.add('hidden')
      }
      return
    }
    const R = rd
    const pd = R.pd
    const q = polityAtYear(pd, inspected, year)
    let text = ''
    if (q >= 0 && capitalAt(pd, q, year) === inspected) {
      const r = rulerAt(R, q, year)
      if (r >= 0) text = `Seat of ${rulerWord(R, r, year)} ${R.title[r]}${houseName(R, r) ? ` of ${houseName(R, r)}` : ''} (since ${R.rulers[r].acceded})`
    }
    if (text === shownSeat) return
    shownSeat = text
    seat.textContent = text
    seat.classList.toggle('hidden', !text)
  }

  const api: RulersView = {
    commit(h: History | null) {
      rd = rulersOf(h)
      fd = rd ? faithsOf(h) : null
      shownNowKey = shownListKey = shownHouseKey = ''
      scrolledTo = -1
      listTop = houseTop = 0
      setPolityRulersHooks(rd ? { title, section: updateSection, warTag } : fd ? { title: () => '', section: () => {}, warTag } : null)
      // (without rulers but with faiths: holy wars are still tagged)
      shownSeat = '-'
      updateSeat()
    },
    showSettlement(id: number) {
      inspected = id
      shownSeat = '-'
      updateSeat()
    },
    tick(y: number) {
      year = y
      updateSeat()
    },
  }
  void settlementName
  return api
}

/** The other thrones the person of reign r holds at `year` (personal unions). */
function personThrones(R: RulersData, r: number, year: number): number[] {
  const out: number[] = []
  const person = R.rulers[r].person
  for (let k = 0; k < R.R; k++) {
    const y = R.rulers[k]
    if (k === r || y.person !== person || y.acceded > year || (y.ended >= 0 && y.ended < year)) continue
    out.push(y.polity)
  }
  return out
}

/** The last reign of p that had ended by `year` (-1). */
function lastReignBy(R: RulersData, p: number, year: number): number {
  const rs = reignsOf(R, p)
  let last = -1
  for (const r of rs) if (R.rulers[r].acceded <= year) last = r
  return last >= 0 && R.rulers[last].ended >= 0 && R.rulers[last].ended < year ? last : -1
}

/** "son of Narun I", "brother", "cadet line", "seized the throne", "founder" for the lineage strip. */
function relationWords(R: RulersData, r: number): string {
  const x = R.rulers[r]
  if (R.dynasties[x.dynasty]?.founder === r) return x.how === AccessionHow.Usurped ? 'founder, seized the throne' : x.how === AccessionHow.Elected ? 'founder, elected' : x.how === AccessionHow.Conquered ? 'founder, set up by conquerors' : 'founder'
  if (x.parent >= 0 && x.parent < R.R) {
    const kin = kinToPredecessor(R, r)
    if (kin === 'son' || kin === 'daughter') return kin
    return `${x.female ? 'daughter' : 'son'} of ${R.title[x.parent]}`
  }
  if (isCadet(R, r)) return 'of a cadet line'
  return x.how === AccessionHow.Usurped ? 'seized the throne' : x.how === AccessionHow.Union ? 'by a marriage claim' : 'kin of the house'
}

/** Why the line ended with its last reign: "no heir: the great men chose House Narpokli", "overthrown by Proli I", "its realm conquered". */
function lineEndWords(R: RulersData, last: number): string {
  const y = R.rulers[last]
  const h = R.history
  let next = -1
  for (let k = h.reignOffsets[y.polity]; k < h.reignOffsets[y.polity + 1]; k++) if (R.rulers[h.reignIds[k]].predecessor === last) next = h.reignIds[k]
  const endW = END_WORDS[y.end]
  if (y.end === ReignEnd.RealmEnded || next < 0) return `${R.title[last]}'s realm${y.polity >= 0 ? ` of ${R.pd.names[y.polity]}` : ''} ended`
  const z = R.rulers[next]
  const nh = z.dynasty >= 0 ? `House ${R.dynasties[z.dynasty].name}` : 'another'
  switch (z.how) {
    case AccessionHow.Usurped: return `${R.title[last]} ${endW || 'was overthrown'}; ${R.title[next]} of ${nh} seized the throne`
    case AccessionHow.Conquered: return `conquerors set ${nh} on the throne`
    case AccessionHow.Union: return `the throne passed by a marriage claim to ${R.title[next]} of ${nh}`
    case AccessionHow.Elected: return `${R.title[last]} left no heir; the great men chose ${nh}`
  }
  return `${R.title[last]} ${endW || 'left no heir'}; ${nh} followed`
}
