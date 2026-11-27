// battles: names of battles and of generals (battles.md 3.11), at assembly; pure in (rows, history names, features).
//
// Battles: English generic words, the proper noun from the named geography or the nearest town that existed that year
// (names as they were then, settlementNameAt):
//   Siege "the Siege of {town}" (one name for the assaults of one siege: the same war and town in successive years);
//   Relief "the Relief of {town}" when the relief won, else "the Battle of {town}";
//   Ford "the Battle of the {River} Ford" when the river was named by then, else "the Battle of {near} Ford";
//   Pass "the Battle of the {Range} Pass" / "the Battle of {near} Pass"; Ambush "the Ambush in the {Forest}" / "the Ambush
//   at {near}"; Landing "the Battle of {near} Strand"; Hill "the Battle of {near} Hill"; Marsh "the Battle of the {near}
//   Marshes"; else "the Battle of {near} Field".
// A name used before gets an ordinal in order of battle, as wars do ("the Second Battle of Ashtar Field").
// Generals: a fresh personal name in the language of the town they first fought from ('names-commander-<id>', its own
// stream per commander, so a longer run names alike); a ruler in the field keeps his name as ruler.

import { BattleFlag, BattleKind, FeatureKind, settlementNameAt } from '../../../contract.ts'
import type { GeoFeature, History, Ruler, World } from '../../../contract.ts'
import type { FeatureMap } from '../../names/features.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { buildRoot, capitalizeName, fluentName, letterCount } from '../../names/words.ts'
import { createRng } from '../../rng.ts'
import type { BattleState } from './state.ts'

const ORD = ['', '', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth']

function ordinal(n: number): string {
  if (n < ORD.length) return ORD[n]
  const t = n % 100, u = n % 10
  return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`
}

/** "the Battle of X" -> "the Second Battle of X". */
export function withOrdinal(name: string, n: number): string {
  return n <= 1 ? name : name.replace(/^the /, `the ${ordinal(n)} `)
}

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
function roman(n: number): string {
  let s = ''
  for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v }
  return s
}

type Names = Pick<History, 'settlements' | 'renamings'>

/** Names of the battles in id order. */
export function nameBattles(world: World, bs: BattleState, h: Names, features: readonly GeoFeature[], map: FeatureMap): string[] {
  const byAnchor = new Map<string, number>() // (lookup only)
  for (const f of features) byAnchor.set(f.kind + ':' + f.anchorCell, f.id)
  const named = (det: number, year: number): string => {
    if (det < 0) return ''
    const d = map.features[det]
    const id = byAnchor.get(d.kind + ':' + d.anchorCell)
    return id !== undefined && features[id].namedYear <= year ? features[id].name : ''
  }
  const P = world.grid.positions
  const S = h.settlements.length
  /** The two towns nearest cell c that stood in `year` (the target when nothing is nearer; -1 for a missing second). */
  let second = -1
  const nearest = (c: number, year: number, fallback: number): number => {
    const x = P[3 * c], y = P[3 * c + 1], z = P[3 * c + 2]
    let best = fallback, bestD = Infinity, d2 = Infinity
    second = -1
    for (let i = 0; i < S; i++) {
      const st = h.settlements[i]
      if (st.foundedYear > year || (st.abandonedYear >= 0 && st.abandonedYear <= year)) continue
      const k = st.cell
      const dx = P[3 * k] - x, dy = P[3 * k + 1] - y, dz = P[3 * k + 2] - z
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) { second = bestD < Infinity ? best : -1; d2 = bestD; bestD = d; best = i } else if (d < d2) { d2 = d; second = i }
    }
    return best
  }
  const out: string[] = []
  const used = new Map<string, number>()
  const siegeName = new Map<string, [string, number]>() // war:town -> name, last year
  for (let b = 0; b < bs.bWar.length; b++) {
    const year = bs.bYear[b], site = bs.bSite[b], target = bs.bTarget[b], kind = bs.bKind[b], fl = bs.bFlags[b]
    const town = settlementNameAt(h, target, year)
    let base: string
    if (kind === BattleKind.Siege) {
      const key = bs.bWar[b] + ':' + target
      const prev = siegeName.get(key)
      if (prev && year - prev[1] <= 1) { prev[1] = year; out.push(prev[0]); continue }
      base = `the Siege of ${town}`
      const n = (used.get(base) ?? 0) + 1
      used.set(base, n)
      const name = withOrdinal(base, n)
      siegeName.set(key, [name, year])
      out.push(name)
      continue
    }
    const nearId = nearest(site, year, target)
    const near = settlementNameAt(h, nearId, year)
    if (kind === BattleKind.Relief) base = bs.bWinner[b] === 0 ? `the Relief of ${town}` : `the Battle of ${town}`
    else if (kind === BattleKind.Ambush) { const f = named(map.cover[site] >= 0 && map.features[map.cover[site]].kind === FeatureKind.Forest ? map.cover[site] : -1, year); base = f ? `the Ambush in the ${f}` : `the Ambush at ${near}` }
    else if (kind === BattleKind.Landing) base = `the Battle of ${near} Strand`
    else if (fl & BattleFlag.Ford) { const r = named(map.river[site], year); base = r ? `the Battle of the ${r} Ford` : `the Battle of ${near} Ford` }
    else if (fl & BattleFlag.Pass) { const r = named(map.relief[site], year); base = r ? `the Battle of the ${r} Pass` : `the Battle of ${near} Pass` }
    else if (fl & BattleFlag.Hill) base = `the Battle of ${near} Hill`
    else if (fl & BattleFlag.Marsh) base = `the Battle of the ${near} Marshes`
    else {
      base = `the Battle of ${near} Field`
      // (a field fought over before: named after the next town if that name is fresh, as chroniclers tell apart battles on one plain)
      if (used.has(base) && second >= 0) { const alt = `the Battle of ${settlementNameAt(h, second, year)} Field`; if (!used.has(alt)) base = alt }
    }
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    out.push(withOrdinal(base, n))
  }
  return out
}

function personalName(world: World, naming: SettlementNaming, home: number, c: number): string {
  const lang = naming.language(naming.tribe[home], naming.level[home])
  const rng = createRng(world.seed, `names-commander-${c}`)
  for (let k = 0; k < 40; k++) {
    const w = capitalizeName(buildRoot(lang, rng))
    const n = letterCount(w)
    if (n >= 4 && n <= 9 && (k >= 30 || fluentName(w))) return w
  }
  return capitalizeName(buildRoot(lang, rng))
}

/** Names of the commanders in id order: a ruler's as ruler ("Narun II"), a general's of his first base's language. */
export function nameCommanders(world: World, bs: BattleState, naming: SettlementNaming, rulers: readonly Ruler[]): string[] {
  const out: string[] = []
  for (let c = 0; c < bs.cPolity.length; c++) {
    const reign = bs.cReign[c]
    if (reign >= 0 && rulers[reign]) { const r = rulers[reign]; out.push(r.regnal > 1 ? `${r.name} ${roman(r.regnal)}` : r.name); continue }
    const home = bs.cHome[c]
    out.push(home >= 0 && home < naming.tribe.length ? personalName(world, naming, home, c) : '')
  }
  return out
}
