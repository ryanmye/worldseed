// Throne slice (lane N3): named heirs. The simulation keeps heirs as birth years only (rulers/state.ts hBorn, hFemale,
// hLegit, hChild); the seat records the living heirs at each decision (History.seat.decisions.heirStart/heirBorn/heirFlags).
// The UI gives each a given name, made from the syllables of the house's own names (its rulers' and the house's), the same
// every time for the same heir (a hash of the house, the birth year and the sex), so a card, the dashboard and the reign
// summary call the same child by the same name. When the heir takes the throne, the ruler's record has its own name, the
// regnal name: the UI says "Aru, crowned as Tika" (historically common: a throne name). DOM-free.
import type { History, Ruler } from '../../../contract.ts'

export interface HeirInfo {
  born: number
  female: boolean
  legit: boolean
  child: boolean
  /** The given name (UI-made, stable). */
  name: string
  age: number
  /** "son", "daughter", "kinsman", "kinswoman" ("natural son" when not legitimate). */
  relation: string
}

function hash(a: number, b: number, c: number): number {
  let x = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 17, 0x27d4eb2f)) >>> 0
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; x ^= x >>> 12; x = Math.imul(x, 0x297a2d39) >>> 0; x ^= x >>> 15
  return x >>> 0
}

const SYL = /[^aeiouyáéíóúàèìòùâêîôûäëïöüāēīōū]*[aeiouyáéíóúàèìòùâêîôûäëïöüāēīōū]+(?:[^aeiouyáéíóúàèìòùâêîôûäëïöüāēīōū]+$)?/gi

function syllables(w: string): string[] {
  return w.toLowerCase().match(SYL) ?? [w.toLowerCase()]
}

const cache = new WeakMap<History, Map<string, string>>()

/** The house's own name stock: its rulers' names (by sex where it has both) and the house name. */
function stock(h: History, dynasty: number, female: boolean, born: number): string[] {
  // (only reigns begun by the heir's birth: a later pause, with more reigns, names the same child alike)
  const R = (h.rulers ?? []).filter((r) => r.acceded <= born)
  const same = R.filter((r) => r.dynasty === dynasty && r.female === female).map((r) => r.name)
  const all = R.filter((r) => r.dynasty === dynasty).map((r) => r.name)
  const house = h.dynasties?.[dynasty]?.name
  const out = same.length >= 2 ? same : all.length > 0 ? all : []
  if (house) out.push(house)
  return out.length > 0 ? out : ['Ara', 'Tem', 'Osu']
}

/** The given name of the house's heir born in `born` (stable for the same house, year and sex). */
export function heirName(h: History, dynasty: number, born: number, female: boolean): string {
  assignAll(h)
  let m = cache.get(h)
  if (!m) { m = new Map(); cache.set(h, m) }
  const key = `${dynasty}:${born}:${female ? 1 : 0}`
  const got = m.get(key)
  if (got) return got
  const names = stock(h, dynasty, female, born)
  const taken = new Set((h.rulers ?? []).filter((r) => r.dynasty === dynasty && r.acceded <= born).map((r) => r.name.toLowerCase()))
  for (const [k, v] of m) if (k.startsWith(`${dynasty}:`)) taken.add(v.toLowerCase()) // (unique within the house, in order of first sight)
  let name = ''
  for (let t = 0; t < 24 && !name; t++) {
    const x = hash(dynasty, born, (female ? 1 : 0) + t * 2)
    const a = syllables(names[x % names.length]), b = syllables(names[(x >>> 8) % names.length])
    const head = a[0]
    const tail = b.length > 1 ? b[b.length - 1] : b[0]
    if (head === tail || (a.length > 1 && a[1] === tail)) continue // (no "Kruyarkruyar")
    let w = head + ((x >>> 16) % 3 === 0 && a.length > 1 ? a[1] : '') + tail
    if (w.length > 9) w = head + tail
    if (w.length < 3) w = head + b.join('')
    w = w.charAt(0).toUpperCase() + w.slice(1)
    if (!taken.has(w.toLowerCase())) name = w
  }
  if (!name) {
    // (a small stock used up: three syllables from the house's names, the first free one in a fixed order)
    const sy = [...new Set(names.flatMap(syllables))]
    const start = hash(dynasty, born, 99) % Math.max(1, sy.length)
    for (let i = 0; i < sy.length * sy.length && !name; i++) {
      const a = sy[(start + i) % sy.length], b = sy[(start + Math.floor(i / sy.length) + 1) % sy.length]
      const w = (a + b + (female ? 'a' : '')).replace(/^./, (c) => c.toUpperCase())
      if (a !== b && !taken.has(w.toLowerCase())) name = w
    }
    if (!name) name = `${names[0]}${born % 97}`
  }
  m.set(key, name)
  return name
}

/** Names every heir the seat has recorded, in order of first sight (decision rows, then birth): a later pause names alike. */
function assignAll(h: History): void {
  if (assigning.has(h) || done.has(h)) return
  assigning.add(h)
  const D = h.seat?.decisions
  if (D && D.heirStart && D.heirBorn && D.heirFlags) for (let d = 0; d < D.count; d++) {
    const r = reignAt(h, D.polity[d], D.year[d])
    if (!r || r.dynasty < 0) continue
    const xs: number[] = []
    for (let i = D.heirStart[d]; i < D.heirStart[d + 1]; i++) xs.push(i)
    xs.sort((a, b) => D.heirBorn![a] - D.heirBorn![b])
    for (const i of xs) heirName(h, r.dynasty, D.heirBorn[i], (D.heirFlags[i] & 1) !== 0)
  }
  // (rulers who were heirs before the seat: their given names come after)
  assigning.delete(h)
  done.add(h)
}
const assigning = new WeakSet<History>()
const done = new WeakSet<History>()

/** The reign of polity p at `year` (History.rulers), or null. */
export function reignAt(h: History, p: number, year: number): Ruler | null {
  let cur: Ruler | null = null
  for (const r of h.rulers ?? []) if (r.polity === p && r.acceded <= year && (r.ended < 0 || r.ended > year)) cur = r
  return cur
}

/** The heirs recorded at decision d (alive then), oldest first. */
export function heirsAt(h: History, d: number): HeirInfo[] {
  const D = h.seat?.decisions
  if (!D || !D.heirStart || !D.heirBorn || !D.heirFlags || d < 0 || d >= D.count) return []
  const y = D.year[d]
  const r = reignAt(h, D.polity[d], y)
  const dyn = r?.dynasty ?? -1
  const out: HeirInfo[] = []
  for (let i = D.heirStart[d]; i < D.heirStart[d + 1]; i++) {
    const born = D.heirBorn[i], f = D.heirFlags[i]
    const female = (f & 1) !== 0, legit = (f & 2) !== 0, child = (f & 4) !== 0
    const rel = child ? (female ? 'daughter' : 'son') : female ? 'kinswoman' : 'kinsman'
    out.push({ born, female, legit, child, name: heirName(h, dyn, born, female), age: y - born, relation: legit || !child ? rel : `natural ${rel}` })
  }
  return out.sort((a, b) => a.born - b.born)
}

/** The heir of decision d born in `born` (the Designate option's target), or null. */
export function heirOf(h: History, d: number, born: number): HeirInfo | null {
  return heirsAt(h, d).find((x) => x.born === born) ?? null
}

/** "Aru (son, 23)". */
export function heirPhrase(x: HeirInfo): string {
  return `${x.name} (${x.relation}, ${x.age === 0 ? 'a newborn' : x.age === 1 ? '1 year old' : x.age})`
}

/** A ruler who was a named heir: "Aru, crowned as Tika" (the given name when it differs from the regnal one). */
export function crownedAs(h: History, r: Ruler): string {
  const given = r.dynasty >= 0 ? heirName(h, r.dynasty, r.born, r.female) : r.name
  return given !== r.name && r.how === 1 ? `${given}, crowned as ${r.name}` : r.name
}
