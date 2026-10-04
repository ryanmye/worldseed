// Chronicle and inspector lines for the second version of the species system (event types
// 44-49): techniques worked out and learned, blights, habits taking hold, the drain of
// wealth they bring, and livestock plagues. format.ts asks here for these types. Like the
// rest of the history, every field is checked: a line names what it can and says less
// where a name or number is missing.

import { EventType, SpeciesCategory, type History, type HistoryEvent } from '../contract.ts'

const peopleOfSettlement = (h: History, id: number): number => {
  const v = id >= 0 && id < h.settlements.length ? (h.settlements[id] as { people?: number }).people : undefined
  return typeof v === 'number' && v >= 0 ? v : -1
}
const peopleNameOf = (h: History, p: number): string | null => {
  const ps = (h as Partial<History>).peoples
  const x = Array.isArray(ps) && p >= 0 ? ps[p] : undefined
  return x && typeof x.name === 'string' && x.name ? x.name : null
}
const speciesAt = (h: History, id: number) => {
  const sp = (h as Partial<History>).species
  return Array.isArray(sp) && id >= 0 ? sp[id] : undefined
}

/** "two thirds", "a quarter", "nearly all" for a fraction 0..1. */
export function fractionPhrase(f: number): string {
  if (!(f > 0)) return 'little'
  if (f < 0.07) return 'a little'
  if (f >= 0.93) return 'nearly all'
  const table: [number, string][] = [[0.1, 'a tenth'], [0.2, 'a fifth'], [0.25, 'a quarter'], [1 / 3, 'a third'], [0.4, 'two fifths'], [0.5, 'half'], [0.6, 'three fifths'], [2 / 3, 'two thirds'], [0.75, 'three quarters'], [0.8, 'four fifths'], [0.9, 'nine tenths']]
  let best = table[0]
  for (const t of table) if (Math.abs(t[0] - f) < Math.abs(best[0] - f)) best = t
  return best[1]
}

/**
 * What a people does when it works out a technique (present and past) and the technique as
 * a noun, by archetype; `sp` is the lower-case world name of the species it applies to.
 */
function techniqueWords(archetype: string, sp: string | null, name: string): [string, string, string] {
  switch (archetype.toLowerCase()) {
    case 'earlyrice': return [`work out two harvests of ${sp ?? 'rice'} a year`, `worked out two harvests of ${sp ?? 'rice'} a year`, `early-ripening ${sp ?? 'rice'}`]
    case 'rotation': return ['learn to rest their fields under a pulse between grain crops', 'learned to rest their fields under a pulse between grain crops', 'crop rotation']
    case 'heavyplough': return ['build a heavy plough for their clay soils', 'built a heavy plough for their clay soils', 'the heavy plough']
    case 'terrace': return ['cut terraces into their hillsides', 'cut terraces into their hillsides', 'terracing']
    case 'paddyirrigation': return [`water their ${sp ?? 'rice'} paddies from dams`, `watered their ${sp ?? 'rice'} paddies from dams`, `dam-fed ${sp ?? 'rice'} paddies`]
    case 'nixtamal': return [`learn to treat ${sp ?? 'the tall grain'} with lime so it nourishes`, `learned to treat ${sp ?? 'the tall grain'} with lime so it nourishes`, `lime-treating ${sp ?? 'the tall grain'}`]
    case 'freezedrying': return [`learn to freeze-dry ${sp ?? 'their tubers'} in the mountain cold`, `learned to freeze-dry ${sp ?? 'their tubers'} in the mountain cold`, `freeze-drying ${sp ?? 'tubers'}`]
    case 'grafting': return ['learn to graft vines and fruit trees', 'learned to graft vines and fruit trees', 'grafting']
    case 'breeding': return ['breed stronger herds', 'bred stronger herds', 'herd breeding']
    case 'hardygrain': return [`breed a hardy ${sp ?? 'grain'} for poor land`, `bred a hardy ${sp ?? 'grain'} for poor land`, `hardy ${sp ?? 'grain'}`]
    default: return [`work out ${name}`, `worked out ${name}`, name]
  }
}

/** How a mild stimulant is taken, for "The Dona take to drinking draveted". */
function takenAs(archetype: string): string {
  switch (archetype.toLowerCase()) {
    case 'tea':
    case 'coffee':
    case 'cacao': return 'drinking'
    case 'tobacco': return 'smoking'
    case 'coca': return 'chewing'
    default: return 'taking'
  }
}

/**
 * Line for a TechniqueFound, TechniqueAdopted, Blight, HabitSpreads, Drain or Panzootic
 * event (null for other types): for the chronicle (`forId` < 0, present tense) or from
 * the point of view of settlement `forId` (inspector, past tense).
 */
export function describeSpeciesV2Event(h: History, e: HistoryEvent, forId: number): string | null {
  const t = e.type as number
  if (t < EventType.TechniqueFound || t > EventType.Panzootic) return null
  const p = peopleOfSettlement(h, e.settlement)
  const pn = peopleNameOf(h, p) ?? 'people'
  const q = e.other >= 0 && e.other < h.settlements.length ? peopleOfSettlement(h, e.other) : -1
  const qn = q >= 0 && q !== p ? peopleNameOf(h, q) : null
  const mine = forId < 0 || e.settlement === forId
  if (t === EventType.TechniqueFound || t === EventType.TechniqueAdopted) {
    const tq = (h as Partial<History>).techniques?.[e.value]
    const sp = tq && tq.species >= 0 ? speciesAt(h, tq.species) : undefined
    const [does, did, noun] = techniqueWords(tq?.archetype ?? '', sp?.name ? sp.name.toLowerCase() : null, tq?.name ? tq.name.toLowerCase() : 'a new way of farming')
    if (t === EventType.TechniqueFound) return forId < 0 ? `The ${pn} ${does}` : `The ${pn} ${did} here`
    if (forId < 0) return `The ${pn} learn ${noun}` + (qn ? ` from the ${qn}` : '')
    return mine ? `Learned ${noun}` + (qn ? ` from the ${qn}` : '') : `The ${pn} learned ${noun} from here`
  }
  const sp = speciesAt(h, e.value)
  const name = sp?.name ? sp.name.toLowerCase() : null
  const frac = typeof e.extra === 'number' && e.extra > 0 ? fractionPhrase(e.extra) : null
  if (t === EventType.Blight) {
    const crop = name ?? 'crops'
    if (forId < 0) return `Blight strikes the ${crop} of the ${pn}` + (frac ? `: ${frac} of the harvest is lost` : '')
    return `Blight struck the ${crop} here first` + (frac ? `: ${frac} of the harvest was lost` : '')
  }
  if (t === EventType.Panzootic) {
    const herds = name ? `${name} herds` : 'herds'
    if (forId < 0) return `A plague takes ${frac ?? 'many'} of the ${herds} of the ${pn}` + (qn ? `, spreading from the ${qn}` : '')
    return mine ? `A plague took ${frac ?? 'many'} of its people's ${herds}` + (qn ? `, spreading from the ${qn}` : '') : `A plague spread from here to the ${herds} of the ${pn}`
  }
  const what = name ?? 'a habit-forming plant'
  const harm = sp?.harm ?? 0
  if (t === EventType.HabitSpreads) {
    if (forId < 0) {
      const from = qn ? `, brought by the ${qn}` : ''
      if (harm >= 0.5) return `The ${what} habit takes a grip on the ${pn}${from}`
      if (harm >= 0.2) return `The ${what} habit takes hold among the ${pn}${from}`
      return `The ${pn} take to ${takenAs(sp?.archetype ?? '')} ${what}${from}`
    }
    return mine ? `The ${what} habit took hold here` + (qn ? `, brought by the ${qn}` : '') : `The ${what} habit spread from here to the ${pn}`
  }
  // Drain: wealth flowing out of the people of `settlement` to pay for it (`other` the largest exporter, or -1)
  const seller = q >= 0 ? (qn ? `the ${qn}` : 'its own traders') : 'abroad'
  if (forId < 0) return `Silver drains from the ${pn} to pay for ${what} from ${seller}`
  return mine ? `Silver drained away to pay for ${what} from ${seller}` : `Grew rich selling ${what} to the ${pn}`
}

/** Whether event type `t` is one of the species-v2 types described here. */
export const isSpeciesV2Event = (t: number) => t >= EventType.TechniqueFound && t <= EventType.Panzootic

/** "tame" for animals, "cultivate" for plants (Domesticated lines). */
export const tameVerb = (category: number) => (category === SpeciesCategory.Livestock ? 'tame' : 'cultivate')
