// renaming: History.renamings and the PlaceRenamed events, made at assembly from the decisions (state.ts) and the names of
// everything else (settlements, features, rulers, houses, faiths).
//
// Names are made in the order of history: each year, the year's foundings first (a founding name that another town already
// bears gets a qualified form, a Distinguished renaming in its founding year), then the year's decisions in order. A new name
// must differ from every name a settlement has borne so far and from every feature named by then; a restored name is the
// town's own; a revived one passes from the ruin to the town on its site. Each decision k draws from 'names-place-<k>', a
// qualified founding name of settlement id from 'names-placequal-<id>': a longer run names alike.

import { EventType, NEW_NAME, RenameCause, RenameForm } from '../../../contract.ts'
import type { Dynasty, Faith, GeoFeature, HistoryEvent, Renamings, Ruler, Settlement, World } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { adaptName, cityEndings, dedicate, freshPlace, qualify } from '../../names/placeNames.ts'
import { buildRoot, capitalizeName } from '../../names/words.ts'
import type { RenamingState } from './state.ts'

export interface RenamingHistory {
  renamings: Renamings
  /** PlaceRenamed events in chronological order (index.ts weaves them into History.events). */
  events: HistoryEvent[]
}

export function emptyRenamings(): Renamings {
  return {
    count: 0, settlement: new Int32Array(0), year: new Int16Array(0), name: [], cause: new Uint8Array(0), form: new Uint8Array(0), polity: new Int16Array(0),
    ruler: new Int32Array(0), dynasty: new Int32Array(0), faith: new Int16Array(0), people: new Int16Array(0), previous: new Int32Array(0), restored: new Int32Array(0),
    source: new Int32Array(0), keptBy: new Int16Array(0),
  }
}

export function emptyRenamingHistory(): RenamingHistory {
  return { renamings: emptyRenamings(), events: [] }
}

interface Row {
  settlement: number; year: number; name: string; cause: number; form: number; polity: number; ruler: number; dynasty: number; faith: number
  people: number; previous: number; restored: number; source: number; keptBy: number; other: number
}

/**
 * The table and events up to the year just simulated. `settlements` carry their founding names; `rulers`, `dynasties` and
 * `faiths` are the assembled tables (empty when their systems are off).
 */
export function assembleRenamings(world: World, rn: RenamingState, settlements: readonly Settlement[], naming: SettlementNaming, features: readonly GeoFeature[], rulers: readonly Ruler[], dynasties: readonly Dynasty[], faiths: readonly Faith[]): RenamingHistory {
  const S = settlements.length
  const K = rn.ySettlement.length
  // Feature names and the year each was named (lookup only).
  const featureYear = new Map<string, number>()
  for (const f of features) { const lc = f.name.toLowerCase(); const y = featureYear.get(lc); if (y === undefined || f.namedYear < y) featureYear.set(lc, f.namedYear) }
  /** Owner of every name borne so far (lower case). */
  const owner = new Map<string, number>()
  const cur: string[] = new Array<string>(S)
  /** Table row of each settlement's Distinguished renaming (-1), and of each decision. */
  const distRow = new Int32Array(S).fill(-1)
  /** Table row that gave each settlement the name it bears now (-1: its founding name). */
  const lastRow = new Int32Array(S).fill(-1)
  const rowOf = new Int32Array(K)
  const identName: string[] = new Array<string>(K)
  const rows: Row[] = []
  const endings = new Map<string, string[]>()
  const endingsOf = (at: number): string[] => cityEndings(world, naming, endings, naming.tribe[at], naming.level[at])
  const langOf = (at: number) => naming.language(naming.tribe[at], naming.level[at])
  const free = (name: string, year: number): boolean => {
    const lc = name.toLowerCase()
    if (owner.has(lc)) return false
    const fy = featureYear.get(lc)
    return fy === undefined || fy > year
  }
  /** A name borne before: a decision's, or a founding name (its qualified form if it was Distinguished). */
  const nameOfIdent = (ident: number): string => {
    if (ident >= 0) return identName[ident]
    const id = -ident - 2
    return distRow[id] >= 0 ? rows[distRow[id]].name : settlements[id].name
  }
  const rowOfIdent = (ident: number): number => (ident >= 0 ? rowOf[ident] : distRow[-ident - 2])

  let admitted = 0
  const admit = (upToYear: number): void => {
    for (; admitted < S && settlements[admitted].foundedYear <= upToYear; admitted++) {
      const id = admitted
      const st = settlements[id]
      const lc = st.name.toLowerCase()
      cur[id] = st.name
      if (!owner.has(lc)) { owner.set(lc, id); continue }
      // Founded with a name another town already bore: a qualified form from its founding.
      const lang = langOf(id), ends = endingsOf(id)
      const rng = createRng(world.seed, `names-placequal-${id}`)
      let name = ''
      for (let attempt = 0; attempt < 20 && !name; attempt++) { const q = qualify(st.name, lang, ends, rng); if (q !== null && free(q, st.foundedYear)) name = q }
      for (let attempt = 0; !name; attempt++) { const q = attempt < 200 ? freshPlace(lang, ends, rng) : capitalizeName(buildRoot(lang, rng) + buildRoot(lang, rng)); if (free(q, st.foundedYear) || attempt > 400) name = q }
      distRow[id] = rows.length
      lastRow[id] = rows.length
      rows.push({ settlement: id, year: st.foundedYear, name, cause: RenameCause.Distinguished, form: RenameForm.Qualified, polity: -1, ruler: -1, dynasty: -1, faith: -1, people: st.people, previous: -1, restored: NEW_NAME, source: -1, keptBy: -1, other: -1 })
      owner.set(name.toLowerCase(), id)
      cur[id] = name
    }
  }

  for (let k = 0; k < K; k++) {
    const year = rn.yYear[k]
    admit(year)
    const v = rn.ySettlement[k]
    const old = cur[v]
    let form = rn.yForm[k]
    const restore = rn.yRestore[k]
    let name = ''
    if (form === RenameForm.Restored || form === RenameForm.Revived) {
      name = nameOfIdent(restore)
      const o = owner.get(name.toLowerCase())
      // (a restored name is the town's own; a revived one the ruin's, which passes to the town on its site)
      if (o !== undefined && o !== v && !(form === RenameForm.Revived && o === rn.ySource[k])) name = ''
    } else {
      const at = rn.yLang[k]
      const lang = langOf(at), ends = endingsOf(at)
      const rng = createRng(world.seed, `names-place-${k}`)
      for (let attempt = 0; attempt < 24 && !name; attempt++) {
        let cand: string | null = null
        if (form === RenameForm.Adapted) cand = adaptName(old, lang, ends, rng)
        else if (form === RenameForm.Ruler) cand = rn.yRuler[k] >= 0 && rn.yRuler[k] < rulers.length ? dedicate(rulers[rn.yRuler[k]].name, lang, ends, rng) : null
        else if (form === RenameForm.House) cand = rn.yDynasty[k] >= 0 && rn.yDynasty[k] < dynasties.length ? dedicate(dynasties[rn.yDynasty[k]].name, lang, ends, rng) : null
        else if (form === RenameForm.Faith) cand = rn.yFaith[k] >= 0 && rn.yFaith[k] < faiths.length ? dedicate(faiths[rn.yFaith[k]].name, lang, ends, rng) : null
        else cand = freshPlace(lang, ends, rng)
        if (cand !== null && free(cand, year)) name = cand
      }
      for (let attempt = 0; !name; attempt++) {
        const cand = attempt < 200 ? freshPlace(lang, ends, rng) : capitalizeName(buildRoot(lang, rng) + buildRoot(lang, rng))
        if (free(cand, year) || attempt > 400) { name = cand; form = RenameForm.New }
      }
    }
    if (!name) {
      // (practically unreachable: a revived name that someone else bears) a new name of the town's own language
      const lang = langOf(v), ends = endingsOf(v)
      const rng = createRng(world.seed, `names-place-${k}`)
      for (let attempt = 0; !name; attempt++) { const cand = freshPlace(lang, ends, rng); if (free(cand, year) || attempt > 400) name = cand }
      form = RenameForm.New
    }
    owner.set(name.toLowerCase(), v)
    identName[k] = name
    rowOf[k] = rows.length
    const prev = rn.yPrev[k]
    // (a revived name is the ruin's as it was given up: the row that gave the ruin that name, which may itself have been revived
    // from an older ruin, so not always the row of the name's identity)
    const src = rn.ySource[k]
    const restored = form === RenameForm.Revived && src >= 0 && src < S && cur[src] === name ? lastRow[src]
      : form === RenameForm.Restored || form === RenameForm.Revived ? rowOfIdent(restore) : NEW_NAME
    rows.push({
      settlement: v, year, name, cause: rn.yCause[k], form, polity: rn.yPolity[k], ruler: rn.yRuler[k], dynasty: rn.yDynasty[k], faith: rn.yFaith[k],
      people: rn.yPeople[k], previous: prev >= 0 ? rowOf[prev] : distRow[v], restored, source: rn.ySource[k], keptBy: rn.yKept[k], other: rn.yOther[k],
    })
    cur[v] = name
    lastRow[v] = rowOf[k]
  }
  admit(1 << 30)

  // Rows in the order of history (Distinguished rows are made as their founding years are reached, so they are in place).
  const n = rows.length
  const out: Renamings = {
    count: n, settlement: new Int32Array(n), year: new Int16Array(n), name: new Array<string>(n), cause: new Uint8Array(n), form: new Uint8Array(n), polity: new Int16Array(n),
    ruler: new Int32Array(n), dynasty: new Int32Array(n), faith: new Int16Array(n), people: new Int16Array(n), previous: new Int32Array(n), restored: new Int32Array(n),
    source: new Int32Array(n), keptBy: new Int16Array(n),
  }
  const events: HistoryEvent[] = []
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    out.settlement[i] = r.settlement; out.year[i] = r.year; out.name[i] = r.name; out.cause[i] = r.cause; out.form[i] = r.form; out.polity[i] = r.polity
    out.ruler[i] = r.ruler; out.dynasty[i] = r.dynasty; out.faith[i] = r.faith; out.people[i] = r.people; out.previous[i] = r.previous; out.restored[i] = r.restored
    out.source[i] = r.source; out.keptBy[i] = r.keptBy
    events.push({ year: r.year, type: EventType.PlaceRenamed, settlement: r.settlement, other: r.other, value: i, extra: r.cause })
  }
  return { renamings: out, events }
}

/** `base` with `extra` (both chronological) woven in: each extra event after every base event of its year. */
export function weaveEvents(base: HistoryEvent[], extra: readonly HistoryEvent[]): HistoryEvent[] {
  if (extra.length === 0) return base
  const out: HistoryEvent[] = []
  let j = 0
  for (let i = 0; i < base.length; i++) {
    const y = base[i].year
    while (j < extra.length && extra[j].year < y) out.push(extra[j++])
    out.push(base[i])
  }
  while (j < extra.length) out.push(extra[j++])
  return out
}
