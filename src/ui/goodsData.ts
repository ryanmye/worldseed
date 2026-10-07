// Worked goods, rare deposits, craft traditions, marts, long-haul legs and lanes, trading posts
// and secrets of a History (contract: History.varieties .. posts), indexed for the UI: everything
// a panel, the inspector, the chronicle, the map layer (render/longhaul.ts) or the town generator
// needs at a year is a cheap function of that year. Built once per history (goodsOf caches it);
// all of it is optional at runtime: a history without goods data gives null and the UI hides
// what it would show.

import { CraftKind, EventType, LegKind, PostKind, SecretKind, StructureType, VarietyKind, type History, type LongHaul, type Structure } from '../contract.ts'
import { politiesOf, polityAtYear } from './politiesData.ts'
import { peopleName, settlementName } from './format.ts'

/** English nouns of the deposit kinds (DepositKind order). */
export const DEPOSIT_NOUNS: readonly string[] = ['gold', 'silver', 'gems', 'amber', 'pearls', 'murex', 'copper', 'tin', 'fine iron', 'kaolin']
/** Kinds of deposit for lists ("Gold", "Silver"...). */
export const DEPOSIT_WORDS: readonly string[] = ['Gold', 'Silver', 'Gems', 'Amber', 'Pearls', 'Murex', 'Copper', 'Tin', 'Fine iron', 'Kaolin']
/** What a craft tradition makes (CraftKind order): the noun after its maker ("Kuniden silk"). */
export const CRAFT_NOUNS: readonly string[] = ['silk', 'dyed cloth', 'fine cloth', 'steel', 'bronze', 'glass', 'porcelain', 'paper', 'carpets', 'shawls', 'sugar', 'wine']
/** The craft as a kind ("Silk weaving"). */
export const CRAFT_WORDS: readonly string[] = ['Silk weaving', 'Dyeing', 'Fine cloth', 'Blades', 'Bronze', 'Glass', 'Porcelain', 'Paper', 'Carpets', 'Shawls', 'Sugar', 'Wine']
/** Its craftsmen ("the silk weavers of Kuniden"). */
export const CRAFTSMEN: readonly string[] = ['silk weavers', 'dyers', 'weavers', 'swordsmiths', 'bronze-smiths', 'glassmakers', 'potters', 'papermakers', 'carpet weavers', 'shawl weavers', 'sugar boilers', 'vintners']
/** Industry bits in display order, their words and tick colours (render/longhaul.ts, the Resources legend). */
export const INDUSTRY_LIST: readonly { bit: number; word: string; color: string }[] = [
  { bit: 1, word: 'Mine', color: '#c9a36a' },
  { bit: 2, word: 'Forge', color: '#ff6a3a' },
  { bit: 16, word: 'Bladesmiths', color: '#d8e2ee' },
  { bit: 4, word: 'Weaving', color: '#ff7fc4' },
  { bit: 8, word: 'Dyeworks', color: '#9a6bff' },
  { bit: 32, word: 'Kilns', color: '#d0793e' },
  { bit: 64, word: 'Glasshouse', color: '#7fe3e0' },
  { bit: 128, word: 'Paper mill', color: '#efe6c8' },
  { bit: 256, word: 'Warehouses', color: '#f2c14e' },
  { bit: 512, word: 'Guild hall', color: '#ffd98a' },
  { bit: 1024, word: 'Mint', color: '#ffe066' },
  { bit: 2048, word: 'Foreign factory', color: '#7fb6ff' },
  { bit: 4096, word: 'Shipyard', color: '#5fd0ff' },
]
/** Words of the price-indexed classes (PRICE_INDEX_GOODS order). */
export const PRICE_WORDS: readonly string[] = ['luxuries', 'stimulants', 'metalware', 'finery', 'treasure']
export const PRICE_GOODS: readonly number[] = [7, 8, 9, 10, 11]
/** How a secret was gained (LeakChannel order). */
export const CHANNEL_WORDS: readonly string[] = ['first held', 'through contact', 'by espionage', 'by defecting craftsmen', 'smuggled', 'by conquest', 'rediscovered', 'from a copied chart']
export const POST_WORDS: readonly string[] = ['factory', 'fort', 'victualling station', 'mining camp']

/** English nouns for luxury, fibre and stimulant species by archetype (the world name stays the variety's name). */
const CROP_NOUNS: Record<string, string> = {
  silk: 'silk', silkworm: 'silk', clovenutmeg: 'cloves', clove: 'cloves', nutmeg: 'nutmeg', pepper: 'pepper', cinnamon: 'cinnamon', spice: 'spice', saffron: 'saffron',
  indigo: 'indigo', cochineal: 'cochineal', madder: 'madder', sugarcane: 'sugar', grape: 'wine', tea: 'tea', coffee: 'coffee', cacao: 'cacao', tobacco: 'tobacco',
  poppy: 'opium', coca: 'coca', betel: 'betel', kava: 'kava', cotton: 'cotton', flax: 'linen', incense: 'incense', frankincense: 'incense', vanilla: 'vanilla',
}
/** What the trade calls the lands a variety comes from ("the spice coast"). */
const COAST_WORDS: Record<string, string> = { cloves: 'spice', nutmeg: 'spice', pepper: 'pepper', cinnamon: 'spice', spice: 'spice', saffron: 'spice', indigo: 'dye', cochineal: 'dye', madder: 'dye', murex: 'purple', sugar: 'sugar', wine: 'wine', tea: 'tea', coffee: 'coffee', silk: 'silk', gold: 'gold', silver: 'silver', gems: 'jewel', pearls: 'pearl', amber: 'amber', furs: 'fur', incense: 'incense' }
/** What smugglers carry out of a secret species' homeland. */
const SEED_WORDS: Record<string, string> = { silk: 'silkworm eggs', cloves: 'clove seedlings', nutmeg: 'nutmeg seedlings', tea: 'tea seedlings', pepper: 'pepper vines', cochineal: 'cochineal insects', indigo: 'indigo seed', cinnamon: 'cinnamon cuttings', coffee: 'coffee seeds', cacao: 'cacao pods', sugar: 'cane cuttings', wine: 'vine cuttings' }

const archKey = (a: string) => a.toLowerCase().replace(/[\s_-]+/g, '')

export interface GoodsData {
  history: History
  /** Settlements, trade snapshots and their interval. */
  N: number
  TS: number
  TI: number
  varietyNames: string[]
  /** English noun of each variety's kind ("silk", "gold", "cloves"). */
  varietyNouns: string[]
  /** Deposits and their output per trade snapshot (layout of History.depositOutput); names ("Lozonuwo gold"). */
  D: number
  depositNames: string[]
  output: Float32Array | null
  /** Largest output of any deposit over the first 2000 years (marker scale), and per deposit over the run. */
  outputMax: number
  depositPeak: Float32Array
  /** The Mine structures on each deposit's cell, oldest first. */
  minesOf: Structure[][]
  /** A rush on each deposit (from its Boom event while the output holds up), or null. */
  rush: ({ start: number; end: number; share: number } | null)[]
  /** Traditions and their quality per trade snapshot; names ("Kuniden silk"). */
  T: number
  traditionNames: string[]
  quality: Uint8Array | null
  /** Traditions with a seat at each settlement (any time). */
  seatsOf: Map<number, number[]>
  industry: Uint16Array | null
  metal: Uint8Array | null
  /** Long-haul legs and their volume per trade snapshot; largest volume (first 2000 years) for widths. */
  L: number
  legs: History['longHaul'] | null
  legVolume: Float32Array | null
  legVolumeMax: number
  /** Legs touching each settlement (as either end). */
  legsOf: Map<number, number[]>
  /**
   * History.longHaul has one entry per spell of a leg on one way (a relay leg that changed its way or reopened is a new
   * entry for the same pair; a lane is one entry for life). Per entry: the first entry of its pair (same kind, same two
   * marts either way round), which stands for the pair in lists; and each such first entry's spells, in order of opening.
   */
  legPair: Int32Array
  pairSpells: Map<number, number[]>
  /** Per leg: the route-seeking expedition (index into History.journeys) that opened it, -1. */
  legJourney: Int32Array
  /** Per leg: the DirectRoute event index that opened it, -1. */
  legEvent: Int32Array
  /** Lanes (LegKind.Lane) in order of opening. */
  lanes: number[]
  mart: Uint8Array | null
  /** Settlements that were ever a mart. */
  martSettlements: Int32Array
  /** Merchant capital per snapshot per settlement (History.merchantWealth, layout of `population`), or null. */
  merchantWealth: Float32Array | null
  price: Uint8Array | null
  /** Settlements that ever have a price for some class. */
  pricedSettlements: Int32Array
  secrets: History['secrets']
  holds: History['secretHolds'] | null
  /** Holds of each secret (indices into holds), by from-year. */
  holdsOf: number[][]
  guard: Uint8Array | null
  posts: History['posts']
  /** Factories hosted, posts owned and the post of each post settlement. */
  postsHosted: Map<number, number[]>
  postsOwned: Map<number, number[]>
  postOfSettlement: Map<number, number>
  /** Bypassed events per settlement (event indices). */
  bypassedOf: Map<number, number[]>
  /** Goods events (types 50-65) per secret, tradition, deposit, post and leg: event indices. */
  eventsOfSecret: number[][]
  eventsOfTradition: number[][]
  eventsOfDeposit: number[][]
}

const cache = new WeakMap<History, GoodsData | null>()

/** The goods index of `h` (built once per history), or null when it has no goods data. */
export function goodsOf(h: History | null | undefined): GoodsData | null {
  if (!h) return null
  if (cache.has(h)) return cache.get(h) ?? null
  let gd: GoodsData | null = null
  try {
    gd = buildGoodsData(h)
  } catch (err) {
    console.warn('goods: data unusable, hidden', err)
    gd = null
  }
  cache.set(h, gd)
  return gd
}

const NORM_YEARS = 2000

/** Index of the first element of the non-decreasing `a` that is >= v (a.length if none). */
function lowerBoundF32(a: Float32Array, v: number): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] < v) lo = m + 1
    else hi = m
  }
  return lo
}

function buildGoodsData(h: History): GoodsData | null {
  const p = h as Partial<History>
  const N = h.settlements.length
  const TS = p.tradeSnapshotCount ?? 0
  const TI = p.tradeInterval ?? 0
  const varieties = Array.isArray(p.varieties) ? p.varieties : []
  const deposits = Array.isArray(p.deposits) ? p.deposits : []
  const traditions = Array.isArray(p.traditions) ? p.traditions : []
  const secrets = Array.isArray(p.secrets) ? p.secrets : []
  const posts = Array.isArray(p.posts) ? p.posts : []
  const LH = p.longHaul && p.longHaul.count > 0 && p.longHaul.a && p.longHaul.pathOffsets ? p.longHaul : null
  if (varieties.length <= 1 && deposits.length === 0 && traditions.length === 0 && !LH && posts.length === 0 && secrets.length === 0) return null
  if (!(TS > 0) || !(TI > 0)) return null
  const okArr = <T extends ArrayLike<number>>(a: T | undefined, n: number): T | null => (a && a.length >= n && n > 0 ? a : null)
  const normT = Math.min(TS, Math.floor(NORM_YEARS / TI) + 1)

  // ---- names ----
  const sp = Array.isArray(p.species) ? p.species : []
  const varietyNames: string[] = []
  const varietyNouns: string[] = []
  for (const v of varieties) {
    let noun = 'goods', name = ''
    const maker = v.maker || (v.people >= 0 ? peopleName(h, v.people) ?? '' : '')
    if (v.kind === VarietyKind.Crop) {
      const s = sp[v.source]
      const ak = s ? archKey(s.archetype) : ''
      noun = CROP_NOUNS[ak] ?? (s ? s.name : 'goods')
      // a finished good (silk) by its English noun; spices and dyes by the species' world name
      name = v.good === 10 && CROP_NOUNS[ak] ? `${maker} ${noun}` : `${maker} ${s ? s.name : noun}`
    } else if (v.kind === VarietyKind.Deposit) {
      const d = deposits[v.source]
      noun = d ? DEPOSIT_NOUNS[d.kind] ?? 'treasure' : 'treasure'
      name = `${maker} ${noun === 'murex' ? 'purple' : noun}`
    } else if (v.kind === VarietyKind.Tradition) {
      const t = traditions[v.source]
      noun = t ? CRAFT_NOUNS[t.craft] ?? 'wares' : 'wares'
      name = `${maker} ${noun}`
    } else if (v.kind === VarietyKind.Wild) {
      noun = 'furs'
      name = `${maker} furs`
    } else {
      noun = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants', 'metalware', 'finery', 'treasure', 'wares'][v.good] ?? 'goods'
      name = noun.charAt(0).toUpperCase() + noun.slice(1)
    }
    varietyNames.push(name.trim() || noun)
    varietyNouns.push(noun)
  }

  // ---- deposits ----
  const D = deposits.length
  const output = okArr(p.depositOutput, TS * D)
  const depositPeak = new Float32Array(D)
  let outputMax = 0
  if (output) {
    for (let q = 0; q < TS; q++) {
      for (let d = 0; d < D; d++) {
        const v = output[q * D + d]
        if (v > depositPeak[d]) depositPeak[d] = v
        if (q < normT && v > outputMax) outputMax = v
      }
    }
  }
  const depositNames = deposits.map((d) => (d.variety >= 0 && varietyNames[d.variety] ? varietyNames[d.variety] : DEPOSIT_WORDS[d.kind] ?? 'Deposit'))
  const sts = Array.isArray(p.structures) ? p.structures : []
  const depAt = new Map<number, number>()
  deposits.forEach((d, i) => depAt.set(d.cell, i))
  const minesOf: Structure[][] = deposits.map(() => [])
  for (const st of sts) if (st.type === StructureType.Mine && depAt.has(st.cell)) minesOf[depAt.get(st.cell)!].push(st)

  // ---- traditions ----
  const T = traditions.length
  const traditionNames = traditions.map((t) => (t.variety >= 0 && varietyNames[t.variety] ? varietyNames[t.variety] : `${t.maker} ${CRAFT_NOUNS[t.craft] ?? 'wares'}`))
  const seatsOf = new Map<number, number[]>()
  for (const t of traditions) for (const s of t.seats) {
    const a = seatsOf.get(s)
    if (!a) seatsOf.set(s, [t.id])
    else if (!a.includes(t.id)) a.push(t.id)
  }

  // ---- legs ----
  const L = LH ? LH.count : 0
  const legVolume = LH ? okArr(p.longHaulVolume, TS * L) : null
  let legVolumeMax = 1
  if (legVolume) for (let q = 0; q < normT; q++) for (let k = 0; k < L; k++) if (legVolume[q * L + k] > legVolumeMax) legVolumeMax = legVolume[q * L + k]
  const legsOf = new Map<number, number[]>()
  const lanes: number[] = []
  if (LH) {
    for (let k = 0; k < L; k++) {
      for (const s of [LH.a[k], LH.b[k]]) {
        const a = legsOf.get(s)
        if (a) a.push(k)
        else legsOf.set(s, [k])
      }
      if (LH.kind[k] === LegKind.Lane) lanes.push(k)
    }
  }
  const legPair = new Int32Array(L)
  const pairSpells = new Map<number, number[]>()
  if (LH) {
    const firstOf = new Map<string, number>()
    for (let k = 0; k < L; k++) {
      const a = LH.a[k], b = LH.b[k]
      const key = `${LH.kind[k]}:${Math.min(a, b)}:${Math.max(a, b)}`
      const f = firstOf.get(key)
      if (f === undefined) {
        firstOf.set(key, k)
        legPair[k] = k
        pairSpells.set(k, [k])
      } else {
        legPair[k] = f
        pairSpells.get(f)!.push(k)
      }
    }
  }
  const legJourney = new Int32Array(L).fill(-1)
  const legEvent = new Int32Array(L).fill(-1)

  // ---- marts, prices ----
  const mart = okArr(p.mart, TS * N)
  const everMart = new Uint8Array(N)
  if (mart) for (let i = 0; i < TS * N; i++) if (mart[i]) everMart[i % N] = 1
  const martSettlements: number[] = []
  for (let i = 0; i < N; i++) if (everMart[i]) martSettlements.push(i)
  const price = okArr(p.priceIndex, TS * N * 5)
  const priced = new Uint8Array(N)
  if (price) for (let i = 0; i < TS * N; i++) if (price[i * 5] || price[i * 5 + 1] || price[i * 5 + 2] || price[i * 5 + 3] || price[i * 5 + 4]) priced[i % N] = 1
  const pricedSettlements: number[] = []
  for (let i = 0; i < N; i++) if (priced[i]) pricedSettlements.push(i)

  // ---- secrets ----
  const SH = p.secretHolds && p.secretHolds.count > 0 && p.secretHolds.secret ? p.secretHolds : null
  const holdsOf: number[][] = secrets.map(() => [])
  if (SH) for (let k = 0; k < SH.count; k++) if (SH.secret[k] < secrets.length) holdsOf[SH.secret[k]].push(k)

  // ---- posts ----
  const postsHosted = new Map<number, number[]>()
  const postsOwned = new Map<number, number[]>()
  const postOfSettlement = new Map<number, number>()
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }
  for (const x of posts) {
    if (x.host >= 0) push(postsHosted, x.host, x.id)
    if (x.owner >= 0) push(postsOwned, x.owner, x.id)
    if (x.settlement >= 0) postOfSettlement.set(x.settlement, x.id)
  }

  // ---- events ----
  const rush: GoodsData['rush'] = deposits.map(() => null)
  const bypassedOf = new Map<number, number[]>()
  const eventsOfSecret: number[][] = secrets.map(() => [])
  const eventsOfTradition: number[][] = traditions.map(() => [])
  const eventsOfDeposit: number[][] = deposits.map(() => [])
  h.events.forEach((e, i) => {
    const t = e.type as number
    if (t < 50 || t > 65) return
    switch (t) {
      case EventType.DepositFound:
      case EventType.MineExhausted:
      case EventType.Boom:
        if (e.value >= 0 && e.value < D) eventsOfDeposit[e.value].push(i)
        if (t === EventType.Boom && e.value >= 0 && e.value < D && output) {
          // the rush lasts while the output holds at half its boom level or more (at most 80 years)
          const d = e.value
          const q0 = Math.min(TS - 1, Math.max(0, Math.floor(e.year / TI)))
          const base = Math.max(output[q0 * D + d], output[Math.min(TS - 1, q0 + 1) * D + d])
          let end = e.year + 10
          for (let q = q0 + 1; q < TS && q * TI <= e.year + 80; q++) {
            if (output[q * D + d] < base * 0.5) break
            end = q * TI
          }
          const ex = deposits[d].exhaustedYear
          if (ex >= 0) end = Math.min(end, ex)
          rush[d] = { start: e.year, end: Math.max(e.year + 5, end), share: e.extra ?? 0 }
        }
        break
      case EventType.TraditionBorn:
      case EventType.TraditionRenowned:
      case EventType.TraditionMoved:
      case EventType.TraditionLost:
        if (e.value >= 0 && e.value < T) eventsOfTradition[e.value].push(i)
        break
      case EventType.SecretGuarded:
      case EventType.SecretLeaked:
      case EventType.MonopolyBroken:
      case EventType.SecretSmuggled:
        if (e.value >= 0 && e.value < secrets.length) eventsOfSecret[e.value].push(i)
        break
      case EventType.DirectRoute:
        if (e.value >= 0 && e.value < L) legEvent[e.value] = i
        break
      case EventType.Bypassed:
        push(bypassedOf, e.settlement, i)
        break
    }
  })
  // the route-seeking expedition that opened each lane: an expedition from its home mart that came back in its opening year
  const J = p.journeys
  if (LH && J && J.count > 0) {
    for (const k of lanes) {
      const home = LH.a[k]
      const y = LH.openedYear[k]
      let best = -1, bestD = 4
      // (journeys are in order of arrival: only those arriving within 4 years of the opening)
      for (let j = lowerBoundF32(J.arriveYear, y - 4); j < J.count && J.arriveYear[j] < y + 4; j++) {
        if (J.kind[j] !== 2 || J.from[j] !== home) continue
        const d = Math.abs(J.arriveYear[j] - y)
        if (d < bestD && J.departYear[j] <= y + 0.5) {
          bestD = d
          best = j
        }
      }
      // a lane opened in the same year by the same expedition as another (a lane through a station) shares it
      legJourney[k] = best
    }
  }

  return {
    history: h,
    N,
    TS,
    TI,
    varietyNames,
    varietyNouns,
    D,
    depositNames,
    output,
    outputMax: Math.max(outputMax, 1e-3),
    depositPeak,
    minesOf,
    rush,
    T,
    traditionNames,
    quality: okArr(p.traditionQuality, TS * T),
    seatsOf,
    industry: okArr(p.industry, TS * N),
    metal: okArr(p.metal, TS * N * 2),
    L,
    legs: LH,
    legVolume,
    legVolumeMax,
    legsOf,
    legPair,
    pairSpells,
    legJourney,
    legEvent,
    lanes,
    mart,
    martSettlements: Int32Array.from(martSettlements),
    merchantWealth: okArr(p.merchantWealth, h.snapshotCount * N),
    price,
    pricedSettlements: Int32Array.from(pricedSettlements),
    secrets,
    holds: SH,
    holdsOf,
    guard: okArr(p.secretGuard, TS * secrets.length),
    posts,
    postsHosted,
    postsOwned,
    postOfSettlement,
    bypassedOf,
    eventsOfSecret,
    eventsOfTradition,
    eventsOfDeposit,
  }
}

// ---------------------------------------------------------------------------
// lookups at a year (pure functions of the year)

/** Trade snapshots bracketing a year and the fraction between them. */
export function tradeBracket(gd: GoodsData, year: number, out: { t0: number; t1: number; f: number }): { t0: number; t1: number; f: number } {
  const x = Math.min(Math.max(year / gd.TI, 0), gd.TS - 1)
  out.t0 = Math.floor(x)
  out.t1 = Math.min(out.t0 + 1, gd.TS - 1)
  out.f = out.t1 === out.t0 ? 0 : x - out.t0
  return out
}
/** The trade snapshot at or before a year (the state the inspector describes). */
export const tradeSnapAt = (gd: GoodsData, year: number) => Math.max(0, Math.min(gd.TS - 1, Math.floor(year / gd.TI + 1e-9)))

/** Whether settlement id stands at `year`. */
export function aliveAt(h: History, id: number, year: number): boolean {
  const s = h.settlements[id]
  return !!s && year >= s.foundedYear && (s.abandonedYear < 0 || year < s.abandonedYear)
}

/** Deposit d at a year: 0 unknown (before it was found), 1 found and yielding or idle, 2 spent. */
export function depositState(gd: GoodsData, d: number, year: number): 0 | 1 | 2 {
  const x = gd.history.deposits[d]
  if (!x || x.foundYear < 0 || year < x.foundYear) return 0
  if (x.exhaustedYear >= 0 && year >= x.exhaustedYear) return 2
  return 1
}
/** Output of deposit d at a year (class units a year, interpolated between trade snapshots). */
export function depositOutputAt(gd: GoodsData, d: number, year: number): number {
  if (!gd.output) return 0
  const x = Math.min(Math.max(year / gd.TI, 0), gd.TS - 1)
  const a = Math.floor(x), b = Math.min(a + 1, gd.TS - 1)
  const f = x - a
  return gd.output[a * gd.D + d] * (1 - f) + gd.output[b * gd.D + d] * f
}
/** The mine working deposit d at a year (its Structure), or null. */
export function mineAt(gd: GoodsData, d: number, year: number): Structure | null {
  for (const st of gd.minesOf[d] ?? []) if (year >= st.builtYear && (st.lostYear < 0 || year < st.lostYear)) return st
  return null
}
/** Whether a rush on deposit d is on at the year. */
export function rushAt(gd: GoodsData, d: number, year: number): boolean {
  const r = gd.rush[d]
  return !!r && year >= r.start && year < r.end
}

/** Quality Q of tradition t at a year (0 when not alive), interpolated. */
export function qualityAt(gd: GoodsData, t: number, year: number): number {
  if (!gd.quality) return 0
  const x = Math.min(Math.max(year / gd.TI, 0), gd.TS - 1)
  const a = Math.floor(x), b = Math.min(a + 1, gd.TS - 1)
  const f = x - a
  const qa = gd.quality[a * gd.T + t], qb = gd.quality[b * gd.T + t]
  if (qa === 0 && qb === 0) return 0
  return ((qa === 0 ? qb : qa) * (1 - f) + (qb === 0 ? qa : qb) * f) / 64
}
/** Whether tradition t exists at the year (born, not lost). */
export function traditionLives(gd: GoodsData, t: number, year: number): boolean {
  const x = gd.history.traditions[t]
  return !!x && year >= x.bornYear && (x.endYear < 0 || year < x.endYear)
}
/** Seats of tradition t at a year (settlement ids), written to out. */
export function seatsAt(gd: GoodsData, t: number, year: number, out: number[] = []): number[] {
  out.length = 0
  const x = gd.history.traditions[t]
  if (!x) return out
  for (let k = 0; k < x.seats.length; k++) {
    if (year < x.seatFrom[k] || (x.seatTo[k] >= 0 && year >= x.seatTo[k])) continue
    if (!out.includes(x.seats[k])) out.push(x.seats[k])
  }
  return out
}
/** Traditions seated at settlement id at the year, with the year each seat began. */
export function traditionsAt(gd: GoodsData, id: number, year: number): { t: number; since: number }[] {
  const out: { t: number; since: number }[] = []
  for (const t of gd.seatsOf.get(id) ?? []) {
    const x = gd.history.traditions[t]
    for (let k = 0; k < x.seats.length; k++) {
      if (x.seats[k] !== id || year < x.seatFrom[k] || (x.seatTo[k] >= 0 && year >= x.seatTo[k])) continue
      out.push({ t, since: x.seatFrom[k] })
      break
    }
  }
  return out
}

/** Industry bits of settlement id at the year (the trade snapshot at or before it). */
export const industryAt = (gd: GoodsData, id: number, year: number) => (gd.industry && id >= 0 && id < gd.N ? gd.industry[tradeSnapAt(gd, year) * gd.N + id] : 0)
/** Whether settlement id is a mart at the year. */
export const martAt = (gd: GoodsData, id: number, year: number) => !!gd.mart && id >= 0 && id < gd.N && gd.mart[tradeSnapAt(gd, year) * gd.N + id] === 1
/** Tools and arms a head of settlement id at the year (0 none). */
export function metalAt(gd: GoodsData, id: number, year: number): [number, number] {
  if (!gd.metal || id < 0 || id >= gd.N) return [0, 0]
  const o = (tradeSnapAt(gd, year) * gd.N + id) * 2
  const dec = (b: number) => (b > 0 ? Math.pow(2, (b - 160) / 16) : 0)
  return [dec(gd.metal[o]), dec(gd.metal[o + 1])]
}
/** Price over worth of class k (PRICE_INDEX_GOODS order) at settlement id at trade snapshot q, 0 where it does not trade. */
export function priceAtSnap(gd: GoodsData, id: number, k: number, q: number): number {
  if (!gd.price || id < 0 || id >= gd.N) return 0
  const b = gd.price[(q * gd.N + id) * 5 + k]
  return b > 0 ? Math.pow(2, (b - 128) / 16) : 0
}
export const priceAt = (gd: GoodsData, id: number, k: number, year: number) => priceAtSnap(gd, id, k, tradeSnapAt(gd, year))
/** The cheapest and dearest price of class k among traders at trade snapshot q, with where (settlement ids), and the median. */
export function priceSpread(gd: GoodsData, k: number, q: number): { min: number; max: number; minAt: number; maxAt: number; median: number; n: number } {
  let min = Infinity, max = 0, minAt = -1, maxAt = -1
  const vals: number[] = []
  if (gd.price) {
    for (const id of gd.pricedSettlements) {
      const b = gd.price[(q * gd.N + id) * 5 + k]
      if (!b) continue
      vals.push(b)
      if (b < min) {
        min = b
        minAt = id
      }
      if (b > max) {
        max = b
        maxAt = id
      }
    }
  }
  vals.sort((a, b) => a - b)
  const dec = (b: number) => Math.pow(2, (b - 128) / 16)
  return { min: vals.length ? dec(min) : 0, max: vals.length ? dec(max) : 0, minAt, maxAt, median: vals.length ? dec(vals[vals.length >> 1]) : 0, n: vals.length }
}

/** Volume (class units a year) of leg k at a year, interpolated. */
export function legVolumeAt(gd: GoodsData, k: number, year: number): number {
  if (!gd.legVolume) return 0
  const x = Math.min(Math.max(year / gd.TI, 0), gd.TS - 1)
  const a = Math.floor(x), b = Math.min(a + 1, gd.TS - 1)
  const f = x - a
  return gd.legVolume[a * gd.L + k] * (1 - f) + gd.legVolume[b * gd.L + k] * f
}
/** Whether leg k is open at the year. */
export function legOpen(gd: GoodsData, k: number, year: number): boolean {
  const L = gd.legs
  return !!L && year >= L.openedYear[k] && (L.closedYear[k] < 0 || year < L.closedYear[k])
}
/**
 * Of the History.longHaul entries `entries` (spells of the legs between one pair of marts, in order of opening), the one
 * to follow at `year`: a lane first when `lane`, then the spell open at the year, else the last opened by then, else the
 * first; -1 when there are none. For links drawn along the leg a thing travelled (disease, ideas).
 */
export function longHaulEntryAt(LH: LongHaul, entries: readonly number[] | undefined, year: number, lane = false): number {
  if (!entries || !entries.length) return -1
  let best = -1, bestScore = -1
  for (const r of entries) {
    const begun = LH.openedYear[r] <= year
    const open = begun && (LH.closedYear[r] < 0 || year < LH.closedYear[r])
    const score = (lane && LH.kind[r] === LegKind.Lane ? 4 : 0) + (open ? 2 : 0) + (begun ? 1 : 0)
    // (ties: the latest among those begun, the first among those not yet)
    if (score > bestScore || (score === bestScore && begun)) {
      best = r
      bestScore = score
    }
  }
  return best
}

/** The spell of leg k's pair (legPair) open at the year, else the last one opened by then, else the first. */
export function pairSpellAt(gd: GoodsData, k: number, year: number): number {
  const L = gd.legs
  const spells = gd.pairSpells.get(gd.legPair[k]) ?? [k]
  if (!L) return k
  let last = spells[0]
  for (const r of spells) {
    if (L.openedYear[r] > year) break
    last = r
    if (L.closedYear[r] < 0 || year < L.closedYear[r]) return r
  }
  return last
}
/** Leg k's pair over its spells up to the year: years open in all, the first opening, the number of spells begun. */
export function pairSpan(gd: GoodsData, k: number, year: number): { years: number; first: number; spells: number } {
  const L = gd.legs
  const spells = gd.pairSpells.get(gd.legPair[k]) ?? [k]
  if (!L) return { years: 0, first: 0, spells: 0 }
  let years = 0, n = 0
  for (const r of spells) {
    const o = L.openedYear[r]
    if (o > year) break
    n++
    const c = L.closedYear[r] < 0 ? year : Math.min(year, L.closedYear[r])
    years += Math.max(0, c - o)
  }
  return { years, first: L.openedYear[spells[0]], spells: n }
}
/** Long-haul trade at settlement id at the year: its volume, and the marts it trades with (spells of one pair count once). */
export function martTrade(gd: GoodsData, id: number, year: number): { volume: number; legs: number } {
  let v = 0
  const pairs = new Set<number>()
  for (const k of gd.legsOf.get(id) ?? []) {
    const x = legVolumeAt(gd, k, year)
    if (x > 0) {
      v += x
      pairs.add(gd.legPair[k])
    }
  }
  return { volume: v, legs: pairs.size }
}
/** Merchant capital of settlement id at population snapshot s (0 without it). */
export const merchantWealthAt = (gd: GoodsData, id: number, s: number) =>
  gd.merchantWealth && id >= 0 && id < gd.N && s >= 0 && s < gd.history.snapshotCount ? gd.merchantWealth[s * gd.N + id] : 0
/** The population snapshot at or before a year. */
export const popSnapAt = (gd: GoodsData, year: number) => Math.max(0, Math.min(gd.history.snapshotCount - 1, Math.floor(year / gd.history.snapshotInterval + 1e-9)))
/** Wealth a head of settlement id at population snapshot s: (wealth + merchantWealth) / population (0 where it has no people). */
export function wealthPerHead(gd: GoodsData, id: number, s: number): number {
  const h = gd.history
  const N = gd.N
  const pop = h.population[s * N + id] ?? 0
  if (!(pop > 0)) return 0
  const w = h.wealth && h.wealth.length >= (s + 1) * N ? h.wealth[s * N + id] : 0
  return (w + merchantWealthAt(gd, id, s)) / pop
}

/** Busiest marts at the year: settlement ids by the volume of the legs at them, most first. */
export function topMarts(gd: GoodsData, year: number, n: number): { id: number; volume: number; legs: number }[] {
  const out: { id: number; volume: number; legs: number }[] = []
  for (const id of gd.martSettlements) {
    if (!martAt(gd, id, year)) continue
    out.push({ id, ...martTrade(gd, id, year) })
  }
  out.sort((a, b) => b.volume - a.volume || a.id - b.id)
  return out.slice(0, n)
}
/** Whether post x stands at the year. */
export function postLives(gd: GoodsData, x: number, year: number): boolean {
  const p = gd.posts[x]
  return !!p && year >= p.foundedYear && (p.endedYear < 0 || year < p.endedYear)
}
/** Holds of secret k in force at the year (indices into holds). */
export function holdersAt(gd: GoodsData, k: number, year: number, out: number[] = []): number[] {
  out.length = 0
  const SH = gd.holds
  if (!SH) return out
  for (const i of gd.holdsOf[k] ?? []) if (SH.from[i] <= year && (SH.to[i] < 0 || year < SH.to[i])) out.push(i)
  return out
}
/** Guard 0..1 of secret k at the year. */
export const guardAt = (gd: GoodsData, k: number, year: number) => (gd.guard ? gd.guard[tradeSnapAt(gd, year) * gd.secrets.length + k] / 255 : 0)

/** "the secret of silk", "the secret of Fesnesen steel", "the chart of the lane to Wes Nufe". */
export function secretNoun(gd: GoodsData, k: number): string {
  const h = gd.history
  const x = gd.secrets[k]
  if (!x) return 'a secret'
  if (x.kind === SecretKind.Species) {
    const s = h.species?.[x.subject]
    const n = s ? CROP_NOUNS[archKey(s.archetype)] ?? s.name : 'a crop'
    return n
  }
  if (x.kind === SecretKind.Craft) return x.subject === CraftKind.Blades ? 'steel' : x.subject === CraftKind.Dyeing ? 'purple dye' : CRAFT_NOUNS[x.subject] ?? 'a craft'
  if (x.kind === SecretKind.Chart) {
    const L = gd.legs
    const leg = x.subject
    return L && leg >= 0 && leg < L.count ? `the way to ${settlementName(h, L.b[leg])}` : 'a sea chart'
  }
  return 'its arms'
}
/** Secret's name for lists ("Silk", "Steel", "Chart: Rilko to Wes Nufe"). */
export function secretTitle(gd: GoodsData, k: number): string {
  const x = gd.secrets[k]
  if (!x) return 'Secret'
  if (x.kind === SecretKind.Chart) {
    const L = gd.legs
    const leg = x.subject
    return L && leg >= 0 && leg < L.count ? `Chart: ${settlementName(gd.history, L.a[leg])} to ${settlementName(gd.history, L.b[leg])}` : 'A sea chart'
  }
  const n = secretNoun(gd, k)
  return n.charAt(0).toUpperCase() + n.slice(1)
}
/** The kind of a secret in words. */
export const SECRET_KIND_WORDS: readonly string[] = ['crop', 'craft', 'chart', 'arms']
/** What smugglers carry of a secret species ("clove seedlings"). */
export function seedWords(gd: GoodsData, k: number): string {
  const x = gd.secrets[k]
  if (!x || x.kind !== SecretKind.Species) return `the secret of ${secretNoun(gd, k)}`
  const n = secretNoun(gd, k)
  return SEED_WORDS[n] ?? `${n} seeds`
}
/** "spice", "silk", "gold": what the trade calls a variety's homeland by. */
export function coastWord(gd: GoodsData, v: number): string {
  const n = gd.varietyNouns[v] ?? ''
  return COAST_WORDS[n] ?? n
}

/** Name of a holding: "the Walu (Kingdom of Walin)" from a hold index. */
export function holderName(gd: GoodsData, i: number): string {
  const SH = gd.holds
  if (!SH) return ''
  const pn = peopleName(gd.history, SH.people[i]) ?? 'a people'
  const pd = politiesOf(gd.history)
  const q = SH.polity[i]
  return q >= 0 && pd && q < pd.count ? `${pn} of ${pd.names[q]}` : pn
}

/** Owner's colour (sRGB 0..1) of a post: its owner's polity at the year, else a hash of the owner. */
export function ownerRgb(gd: GoodsData, owner: number, year: number): [number, number, number] {
  const pd = politiesOf(gd.history)
  const q = pd ? polityAtYear(pd, owner, year) : -1
  if (pd && q >= 0) return [pd.rgb[q * 3], pd.rgb[q * 3 + 1], pd.rgb[q * 3 + 2]]
  const h = ((owner * 0.6180339887) % 1 + 1) % 1
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return 0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

/** Tools and arms a head in words ("well supplied with tools, few arms"). */
export function metalWords(tools: number, arms: number): string {
  const t = tools <= 0 ? 'no iron tools' : tools < 0.05 ? 'few tools' : tools < 0.2 ? 'some tools' : tools < 0.6 ? 'well supplied with tools' : 'rich in tools'
  const a = arms <= 0 ? 'no arms to speak of' : arms < 0.02 ? 'few arms' : arms < 0.08 ? 'some arms' : arms < 0.25 ? 'well armed' : 'heavily armed'
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}, ${a}`
}

/** Words for industry bits ("forge, weaving, warehouses"). */
export function industryWords(bits: number): string[] {
  const out: string[] = []
  for (const x of INDUSTRY_LIST) if (bits & x.bit) out.push(x.word)
  return out
}

/** Deposits within `reach` cell spacings of cell c (by unit-sphere distance), found by the year. */
export function depositsNear(gd: GoodsData, positions: Float32Array, cell: number, year: number, reach: number): number[] {
  const out: number[] = []
  const spacing = Math.sqrt((4 * Math.PI) / (positions.length / 3))
  const cx = positions[cell * 3], cy = positions[cell * 3 + 1], cz = positions[cell * 3 + 2]
  gd.history.deposits.forEach((d, i) => {
    if (depositState(gd, i, year) === 0) return
    const dx = positions[d.cell * 3] - cx, dy = positions[d.cell * 3 + 1] - cy, dz = positions[d.cell * 3 + 2] - cz
    if (Math.hypot(dx, dy, dz) <= reach * spacing) out.push(i)
  })
  return out
}

// ---------------------------------------------------------------------------
// The 3D town generator's view of a settlement (render/dioramas).

export interface TownGoodsState {
  /** Industry bits at the year (IndustryBit). */
  industry: number
  /** The renowned or living tradition seated here (the best by quality), or null. */
  tradition: { id: number; craft: number; quality: number; name: string } | null
  /** A mart of the long-haul trade at the year. */
  mart: boolean
  /** Foreign factories it hosts at the year: their owners and colours (sRGB 0..1). */
  factories: { post: number; owner: number; rgb: [number, number, number] }[]
  /** It works a mine at the year (a Mine structure of its own, or the Mine bit). */
  mine: boolean
  /** Cell of the deposit it works (for the direction of the workings), -1. */
  mineCell: number
  /** Treasure enough for a mint at a capital (IndustryBit.Mint). */
  mint: boolean
  /** A lane's home port (IndustryBit.Shipyard). */
  shipyard: boolean
  /** Its own settlement is a trading post of this kind (PostKind), -1. */
  postKind: number
}

/**
 * Goods state of settlement `id` at `year` for the town generator, or null without goods data.
 * A pure function of the year.
 */
export function townGoodsState(history: History, id: number, year: number): TownGoodsState | null {
  const gd = goodsOf(history)
  if (!gd || id < 0 || id >= gd.N) return null
  const bits = industryAt(gd, id, year)
  let tradition: TownGoodsState['tradition'] = null
  for (const { t } of traditionsAt(gd, id, year)) {
    const q = qualityAt(gd, t, year)
    if (!tradition || q > tradition.quality) tradition = { id: t, craft: history.traditions[t].craft, quality: q, name: gd.traditionNames[t] }
  }
  const factories: TownGoodsState['factories'] = []
  for (const x of gd.postsHosted.get(id) ?? []) {
    const p = gd.posts[x]
    if (p.kind !== PostKind.Factory || !postLives(gd, x, year)) continue
    factories.push({ post: x, owner: p.owner, rgb: ownerRgb(gd, p.owner, year) })
  }
  let mineCell = -1
  for (let d = 0; d < gd.D && mineCell < 0; d++) {
    const st = mineAt(gd, d, year)
    if (st && st.settlement === id) mineCell = st.cell
  }
  const post = gd.postOfSettlement.get(id)
  return {
    industry: bits,
    tradition,
    mart: martAt(gd, id, year),
    factories,
    mine: mineCell >= 0 || (bits & 1) !== 0,
    mineCell,
    mint: (bits & 1024) !== 0,
    shipyard: (bits & 4096) !== 0,
    postKind: post !== undefined && postLives(gd, post, year) ? gd.posts[post].kind : -1,
  }
}

/** Display noun of a deposit kind with the place ("silver of Venet"). */
export function depositOf(gd: GoodsData, d: number): string {
  const x = gd.history.deposits[d]
  if (!x) return 'a deposit'
  const v = x.variety >= 0 ? gd.history.varieties[x.variety] : undefined
  const noun = DEPOSIT_NOUNS[x.kind] ?? 'treasure'
  return v?.maker ? `${noun === 'murex' ? 'murex beds' : noun} of ${v.maker}` : noun
}

