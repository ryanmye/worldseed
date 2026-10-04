// polities: names of states, in the language of the founding capital's people (design 10, names).
//
// A polity's proper name (the UI adds the English tier word: "Kingdom of Vashtar", "Vashtar Empire"):
//   50%  the founding capital's root with a polity ending of its language ("Vasht" + "ar");
//   30%  the ruling people's name fused with such an ending;
//   20%  a fresh root of the language (now and then with an ending).
// A successor state (it has a parent) keeps its parent's name with an English qualifier 40% of the
// time: North / South / East / West by its capital's bearing from the parent's capital, New when it is
// overseas, Upper / Lower when it lies much higher or lower; otherwise it gets a name of its own.
//
// Draws only from 'names-polity-<id>' and the polity endings from 'names-polaffix-<tribe>-<level>'
// (never the settlement, people or feature streams, and no new meaning class), in polity id order, and
// depends only on each polity's founding (capital, parent, people), so a longer history names its
// polities alike and nothing else is renamed. Names are unique among polities (a successor's
// inherited name counts with its qualifier).

import { PolityQualifier } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { SettlementNaming } from './index.ts'
import { buildMorph, buildRoot, capitalizeName, fuseWords, letterCount } from './words.ts'

/** What naming needs of a polity: its founding capital, parent and ruling people. */
export interface PolityLike {
  capital: number
  parent: number
  people: number
}

function bearing(world: World, from: number, to: number): number {
  // Local east / north components of the chord from `from` to `to` (+Y is the north pole).
  const P = world.grid.positions
  const x0 = P[from * 3], y0 = P[from * 3 + 1], z0 = P[from * 3 + 2]
  const dx = P[to * 3] - x0, dy = P[to * 3 + 1] - y0, dz = P[to * 3 + 2] - z0
  // east = normalize(Y x p) = (z0, 0, -x0) / r; north = p x east, up to scale.
  const r = Math.sqrt(x0 * x0 + z0 * z0) + 1e-12
  const ex = z0 / r, ez = -x0 / r
  const east = dx * ex + dz * ez
  // north = p x east
  const nx = y0 * ez, ny = z0 * ex - x0 * ez, nz = -y0 * ex
  const north = dx * nx + dy * ny + dz * nz
  // 1 North, 2 South, 3 East, 4 West: the larger component.
  if (north * north >= east * east) return north >= 0 ? PolityQualifier.North : PolityQualifier.South
  return east >= 0 ? PolityQualifier.East : PolityQualifier.West
}

function qualifierOf(world: World, cellOf: (id: number) => number, landmassOf: (cell: number) => number, child: PolityLike, parent: PolityLike): number {
  const a = cellOf(parent.capital), b = cellOf(child.capital)
  if (landmassOf(a) !== landmassOf(b)) return PolityQualifier.New
  const ea = world.elevation[a], eb = world.elevation[b]
  if (eb - ea > 0.25) return PolityQualifier.Upper
  if (ea - eb > 0.25) return PolityQualifier.Lower
  return bearing(world, a, b)
}

/**
 * Names every polity (in id order) and gives each successor's qualifier. `cellOf` and `landmassOf` give a
 * settlement's cell and a cell's landmass; `peopleNames` the peoples' names.
 */
export function namePolities(world: World, polities: readonly PolityLike[], naming: SettlementNaming, peopleNames: readonly string[], cellOf: (id: number) => number, landmassOf: (cell: number) => number): { names: string[]; qualifiers: number[] } {
  const names: string[] = []
  const qualifiers: number[] = []
  const used = new Set<string>()
  const endings = new Map<string, string[]>()
  const endingsOf = (tribe: number, level: number): string[] => {
    const key = tribe + ':' + level
    let e = endings.get(key)
    if (e) return e
    const lang = naming.language(tribe, level)
    const rng = createRng(world.seed, `names-polaffix-${tribe}-${level}`)
    e = []
    for (let k = 0; k < 3; k++) e.push(buildMorph(lang, rng, 2, true))
    endings.set(key, e)
    return e
  }
  for (let id = 0; id < polities.length; id++) {
    const pol = polities[id]
    const rng = createRng(world.seed, `names-polity-${id}`)
    const cap = pol.capital
    const tribe = naming.tribe[cap], level = naming.level[cap]
    const lang = naming.language(tribe, level)
    const ends = endingsOf(tribe, level)
    let qualifier = PolityQualifier.None as number
    let name = ''
    if (pol.parent >= 0 && pol.parent < id && rng.next() < 0.4) {
      qualifier = qualifierOf(world, cellOf, landmassOf, pol, polities[pol.parent])
      const inherited = names[pol.parent]
      if (!used.has((qualifier + ':' + inherited).toLowerCase())) name = inherited
      else qualifier = PolityQualifier.None
    }
    for (let attempt = 0; attempt < 200 && !name; attempt++) {
      const x = rng.next()
      let w: string | null
      const ending = ends[Math.floor(rng.next() * ends.length)]
      if (x < 0.5) w = fuseWords(lang, naming.roots[cap] ?? buildRoot(lang, rng), ending)
      else if (x < 0.8) w = fuseWords(lang, (peopleNames[pol.people] ?? '').toLowerCase(), ending)
      else { w = buildRoot(lang, rng); if (rng.next() < 0.5) w = fuseWords(lang, w, ending) ?? w }
      if (w === null || attempt > 100) w = buildRoot(lang, rng)
      const cand = capitalizeName(w)
      const n = letterCount(cand)
      if (n >= 3 && n <= 12 && !used.has((PolityQualifier.None + ':' + cand).toLowerCase())) name = cand
    }
    if (!name) name = capitalizeName(buildRoot(lang, rng)) + 'a' + id // practically unreachable
    used.add((qualifier + ':' + name).toLowerCase())
    names.push(name)
    qualifiers.push(qualifier)
  }
  return { names, qualifiers }
}
