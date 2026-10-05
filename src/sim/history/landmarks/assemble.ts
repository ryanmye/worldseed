// landmarks: History.landmarks and the landmark events, made at assembly from the system's rows and changes (state.ts) and
// the names of everything else (settlements and their renamings, rulers, houses, faiths, peoples, craft traditions).
//
// Each landmark is named in begun order, in its builders' language (the builder realm's seat, or the town itself), for its
// ruler, house, faith or town (the town's name in use at the begun year), from 'names-landmark-<id>': its name depends only on
// what was known by its begun year, and it is unique within the world (case-insensitive) against the names before it, the
// later templates and then an ordinal ("the Second Church of Rilko") setting it apart.

import { EventType, LandmarkForm, LandmarkKind, LandmarkRank, settlementNameAt } from '../../../contract.ts'
import type { Dynasty, Faith, HistoryEvent, Landmarks, People, Renamings, Ruler, Settlement, Tradition, World } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { Rng } from '../../rng.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { cityEndings, dedicate, freshPlace } from '../../names/placeNames.ts'
import { buildRoot, capitalizeName } from '../../names/words.ts'
import type { LandmarksState } from './state.ts'

export interface LandmarkHistory {
  landmarks: Landmarks
  /** Landmark events (great landmarks) in chronological order (index.ts weaves them into History.events). */
  events: HistoryEvent[]
}

export function emptyLandmarks(): Landmarks {
  return {
    count: 0, kind: new Uint8Array(0), rank: new Uint8Array(0), form: new Uint8Array(0), variant: new Uint8Array(0), settlement: new Int32Array(0), cell: new Int32Array(0),
    begunYear: new Int16Array(0), completedYear: new Int16Array(0), polity: new Int16Array(0), ruler: new Int32Array(0), dynasty: new Int32Array(0), faith: new Int16Array(0),
    people: new Int16Array(0), name: [], changeCount: 0, changeLandmark: new Int32Array(0), changeYear: new Int16Array(0), changeState: new Uint8Array(0),
    changeFaith: new Int16Array(0), changePolity: new Int16Array(0), faithForm: new Uint8Array(0), faithVariant: new Uint8Array(0),
  }
}

export function emptyLandmarkHistory(): LandmarkHistory {
  return { landmarks: emptyLandmarks(), events: [] }
}

/** The event of a change of state (indexed by LandmarkState: Building 0 .. Unfinished 6). */
export const EVENT_OF_STATE: readonly number[] = [
  EventType.LandmarkBegun, EventType.LandmarkCompleted, EventType.LandmarkNeglected, EventType.LandmarkRuined,
  EventType.LandmarkRestored, EventType.LandmarkConverted, EventType.LandmarkAbandoned,
]

const F = LandmarkForm, KD = LandmarkKind
/** A great temple's word, by form. */
const GREAT_WORD: Record<number, string> = {
  [F.Steepled]: 'Cathedral', [F.Domed]: 'Great Dome', [F.Ziggurat]: 'Ziggurat', [F.Columned]: 'Great Temple', [F.Pagoda]: 'Great Pagoda',
  [F.Stave]: 'Great Stave Hall', [F.Stupa]: 'Great Stupa', [F.Circle]: 'Great Circle',
}
/** A town's temple's word, by form. */
const TEMPLE_WORD: Record<number, string> = {
  [F.Steepled]: 'Church', [F.Domed]: 'Domed Temple', [F.Ziggurat]: 'Temple Mound', [F.Columned]: 'Temple', [F.Pagoda]: 'Pagoda',
  [F.Stave]: 'Stave Church', [F.Stupa]: 'Stupa', [F.Circle]: 'Holy Grove',
}
const MONASTERY_WORDS = ['Monastery', 'Abbey', 'Priory', 'Hermitage']
/** Craftsmen by CraftKind. */
const CRAFTSMEN = ['Silk Weavers', 'Dyers', 'Clothiers', 'Swordsmiths', 'Bronzesmiths', 'Glassmakers', 'Potters', 'Papermakers', 'Carpet Weavers', 'Shawl Weavers', 'Sugar Refiners', 'Vintners']
const ORDINALS = ['Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth']

export function roman(n: number): string {
  const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const sy = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
  let out = ''
  for (let i = 0; i < v.length; i++) while (n >= v[i]) { out += sy[i]; n -= v[i] }
  return out
}

/** "the Second Church of Rilko" from "the Church of Rilko". */
function ordinal(name: string, k: number): string {
  const o = k < ORDINALS.length ? ORDINALS[k] : String(k + 2) + 'th'
  return name.startsWith('the ') ? `the ${o} ${name.slice(4)}` : `the ${o} ${name}`
}

/**
 * The table and events up to the year just simulated. `settlements` carry their founding names and `renamings` the names
 * they took since; `rulers`, `dynasties`, `faiths`, `peoples` and `traditions` are the assembled tables (empty when off).
 */
export function assembleLandmarks(world: World, lm: LandmarksState, settlements: readonly Settlement[], renamings: Renamings, naming: SettlementNaming,
  rulers: readonly Ruler[], dynasties: readonly Dynasty[], faiths: readonly Faith[], peoples: readonly People[], traditions: readonly Tradition[]): LandmarkHistory {
  const n = lm.lKind.length
  const C = lm.cLm.length
  const named = { settlements: settlements as Settlement[], renamings }
  const taken = new Set<string>() // (lookup only)
  const endings = new Map<string, string[]>()
  const names: string[] = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const at = lm.lLang[i]
    const tribe = naming.tribe[at], level = naming.level[at]
    const lang = naming.language(tribe, level)
    const ends = cityEndings(world, naming, endings, tribe, level)
    const rng = createRng(world.seed, `names-landmark-${i}`)
    const town = settlementNameAt(named, lm.lSett[i], lm.lBegun[i])
    const r = lm.lRuler[i] >= 0 && lm.lRuler[i] < rulers.length ? rulers[lm.lRuler[i]] : null
    const ruler = r !== null ? (r.regnal > 1 ? `${r.name} ${roman(r.regnal)}` : r.name) : ''
    const house = lm.lDyn[i] >= 0 && lm.lDyn[i] < dynasties.length ? dynasties[lm.lDyn[i]].name : ''
    const fi = lm.lFaith[i]
    const faith = isFaithKind(lm.lKind[i]) && fi >= 0 && fi < faiths.length ? faiths[fi].name : ''
    const fresh = (): string => (rng.next() < 0.5 ? capitalizeName(buildRoot(lang, rng)) : freshPlace(lang, ends, rng))
    const honour = (x: string): string => (x ? dedicate(x, lang, ends, rng) ?? fresh() : fresh())
    const cands = candidates(lm, i, rng, town, ruler, house, faith, fresh, honour, peoples, traditions)
    let name = ''
    // (from a drawn start, the templates in turn; then fresh ones; then an ordinal of the first)
    const start = rng.int(0, Math.max(0, cands.length - 1))
    for (let t = 0; t < cands.length && !name; t++) { const c = cands[(start + t) % cands.length]; if (c && !taken.has(c.toLowerCase())) name = c }
    for (let t = 0; t < 12 && !name; t++) { const c = candidates(lm, i, rng, town, ruler, house, faith, fresh, honour, peoples, traditions)[rng.int(0, cands.length - 1)]; if (c && !taken.has(c.toLowerCase())) name = c }
    const base = cands.find((c) => c !== '') ?? 'the Landmark'
    for (let k = 0; !name; k++) { const c = ordinal(base, k); if (!taken.has(c.toLowerCase())) name = c }
    taken.add(name.toLowerCase())
    names[i] = name
  }

  const fc = faiths.length
  const out: Landmarks = {
    count: n, kind: new Uint8Array(n), rank: new Uint8Array(n), form: new Uint8Array(n), variant: new Uint8Array(n), settlement: new Int32Array(n), cell: new Int32Array(n),
    begunYear: new Int16Array(n), completedYear: new Int16Array(n), polity: new Int16Array(n), ruler: new Int32Array(n), dynasty: new Int32Array(n), faith: new Int16Array(n),
    people: new Int16Array(n), name: names, changeCount: C, changeLandmark: new Int32Array(C), changeYear: new Int16Array(C), changeState: new Uint8Array(C),
    changeFaith: new Int16Array(C), changePolity: new Int16Array(C), faithForm: new Uint8Array(fc).fill(255), faithVariant: new Uint8Array(fc),
  }
  for (let i = 0; i < n; i++) {
    out.kind[i] = lm.lKind[i]; out.rank[i] = lm.lRank[i]; out.form[i] = lm.lForm[i]; out.variant[i] = lm.lVariant[i]; out.settlement[i] = lm.lSett[i]; out.cell[i] = lm.lCell[i]
    out.begunYear[i] = lm.lBegun[i]; out.completedYear[i] = lm.lDone[i]; out.polity[i] = lm.lPol[i]; out.ruler[i] = lm.lRuler[i]; out.dynasty[i] = lm.lDyn[i]; out.faith[i] = lm.lFaith[i]
    out.people[i] = lm.lPeople[i]
  }
  for (let f = 0; f < fc && f < lm.faithForm.length; f++) { out.faithForm[f] = lm.faithForm[f]; out.faithVariant[f] = lm.faithVariant[f] }
  const events: HistoryEvent[] = []
  for (let k = 0; k < C; k++) {
    const id = lm.cLm[k]
    out.changeLandmark[k] = id; out.changeYear[k] = lm.cYear[k]; out.changeState[k] = lm.cState[k]; out.changeFaith[k] = lm.cFaith[k]; out.changePolity[k] = lm.cPol[k]
    if (lm.lRank[id] !== LandmarkRank.Great) continue
    events.push({ year: lm.cYear[k], type: EVENT_OF_STATE[lm.cState[k]] as HistoryEvent['type'], settlement: lm.lSett[id], other: lm.cOther[k], value: id, extra: lm.lKind[id] })
  }
  return { landmarks: out, events }
}

function isFaithKind(k: number): boolean {
  return k === KD.GreatTemple || k === KD.Monastery || k === KD.Temple || k === KD.Shrine
}

/** The name templates of landmark i, in their order (empty strings where a part is missing). */
function candidates(lm: LandmarksState, i: number, rng: Rng, T: string, R: string, H: string, Fa: string, fresh: () => string, honour: (x: string) => string,
  peoples: readonly People[], traditions: readonly Tradition[]): string[] {
  const form = lm.lForm[i]
  switch (lm.lKind[i]) {
    case KD.Castle:
      return lm.lSeat[i] === 1
        ? [`the Keep of ${T}`, `the Citadel of ${T}`, `${T} Castle`, `the ${honour(R || H)} Keep`, `Castle ${fresh()}`]
        : [`the Fortress of ${T}`, `the ${T} Citadel`, `the Bastion of ${T}`, `Fort ${honour(R)}`]
    case KD.Palace:
      return [H ? `the ${H} Palace` : '', R ? `the Palace of ${R}` : '', `the Royal Palace of ${T}`, `the ${honour(H || R)} Palace`, `the Palace of ${T}`]
    case KD.GreatTemple: {
      const W = GREAT_WORD[form] ?? 'Great Temple'
      return [R ? `${R}'s ${W} at ${T}` : '', Fa ? `the ${W} of ${Fa} at ${T}` : '', `the ${W} of ${T}`, `the ${W} of ${fresh()}`]
    }
    case KD.Monastery: {
      const W = MONASTERY_WORDS[rng.int(0, MONASTERY_WORDS.length - 1)]
      const saint = fresh()
      return [`the ${W} of ${saint}`, `${saint} ${W}`, `the ${W} of ${saint} at ${T}`, Fa ? `the ${Fa} ${W} at ${T}` : '']
    }
    case KD.MarketHall:
      return [`the Great Market of ${T}`, `the ${T} Exchange`, `the Grand Bazaar of ${T}`, `the Cloth Hall of ${T}`, `the ${honour(R)} Market`]
    case KD.Guildhall: {
      const t = lm.lSubject[i] >= 0 && lm.lSubject[i] < traditions.length ? traditions[lm.lSubject[i]] : null
      const crafts = t !== null ? CRAFTSMEN[t.craft] ?? 'Craftsmen' : 'Craftsmen'
      const pp = t !== null && t.people >= 0 && t.people < peoples.length ? peoples[t.people].name : ''
      return [pp ? `the Hall of the ${pp} ${crafts}` : '', `the ${crafts}' Hall of ${T}`, `the Guildhall of ${T}`, `the Hall of the ${crafts} of ${T}`]
    }
    case KD.Lighthouse:
      return [`the Light of ${T}`, `the Great Light of ${T}`, `the Lighthouse of ${T}`, `the ${T} Lighthouse`, `the ${fresh()} Tower`]
    case KD.Library:
      return [`the Library of ${T}`, `the Great Library of ${T}`, R ? `the Library of ${R}` : '', `the House of Learning at ${T}`, `the ${honour(R)} Library`]
    case KD.Monument:
      return R ? [`the Column of ${R}`, `the Arch of ${R}`, `the Obelisk of ${R}`, `${R}'s Victory Column`] : [`the Victory Column of ${T}`, `the Arch of ${T}`]
    case KD.Mausoleum:
      return R ? [`the Tomb of ${R}`, `the Mausoleum of ${R}`, H ? `the Tombs of the House of ${H}` : '', `the Mound of ${R}`] : [`the Royal Tombs of ${T}`]
    case KD.Baths:
      return [`the Baths of ${T}`, `the Great Baths of ${T}`, `the ${honour(R)} Baths`, `the Hot Baths of ${T}`, `the Springs of ${T}`]
    case KD.CouncilHouse:
      return [`the Council House of ${T}`, `the Senate House of ${T}`, `the Moot Hall of ${T}`, `the Assembly Hall of ${T}`]
    case KD.Temple: {
      const W = TEMPLE_WORD[form] ?? 'Temple'
      return [Fa ? `the ${W} of ${Fa} at ${T}` : '', `the ${W} of ${fresh()} at ${T}`, `the Old ${W} of ${T}`, `the ${W} of ${T}`, `the New ${W} of ${T}`]
    }
    default: // Shrine
      return [`the Stones of ${T}`, `the Sacred Grove of ${T}`, `the ${fresh()} Stones`, `the Ring of ${fresh()}`, Fa ? `the Grove of ${Fa} at ${T}` : '']
  }
}
