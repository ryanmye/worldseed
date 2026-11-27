import { describe, expect, it } from 'vitest'
import { BattleFlag, BattleKind, FeatureKind } from '../../../contract.ts'
import type { GeoFeature, Settlement, World } from '../../../contract.ts'
import type { FeatureMap } from '../../names/features.ts'
import { createBattles } from './state.ts'
import type { BattleState } from './state.ts'
import type { HistoryState } from '../state.ts'
import { nameBattles, withOrdinal } from './names.ts'

// A world of four cells on a line; towns on cells 0 (Ashtar) and 3 (Vebena); a river through cell 2, named in year 100.
const world = { seed: 1, grid: { cellCount: 4, positions: Float32Array.from([1, 0, 0, 0.99, 0.1, 0, 0.98, 0.2, 0, 0.97, 0.3, 0]) } } as unknown as World
const town = (id: number, cell: number, name: string): Settlement => ({ id, cell, foundedYear: 0, parent: -1, abandonedYear: -1, name, people: 0, outpost: false, post: false, resort: false })
const settlements = [town(0, 0, 'Ashtar'), town(1, 3, 'Vebena')]
const features: GeoFeature[] = [{ id: 0, kind: FeatureKind.River, name: 'Kephia', namedYear: 100, namedBy: 0, anchorCell: 2, size: 3, spine: [] }]
const none = Int32Array.from([-1, -1, -1, -1])
const map = { features: [{ kind: FeatureKind.River, anchorCell: 2, size: 3, spine: [], key: 'r' }], land: none, water: none, lake: none, relief: none, cover: none, river: Int32Array.from([-1, -1, 0, -1]), river2: none } as FeatureMap

function row(bs: BattleState, year: number, site: number, kind: number, flags: number, war = 0): void {
  bs.bWar.push(war); bs.bYear.push(year); bs.bSite.push(site); bs.bTarget.push(1); bs.bFrom.push(0); bs.bKind.push(kind); bs.bFlags.push(flags); bs.bWinner.push(0)
}

describe('battles: names', () => {
  it('a ford battle is named after its river once the river is named, else after the nearest town; repeats get ordinals', () => {
    const bs = createBattles({ world } as unknown as HistoryState)
    row(bs, 50, 2, BattleKind.Field, BattleFlag.Ford)
    row(bs, 150, 2, BattleKind.Field, BattleFlag.Ford)
    row(bs, 160, 2, BattleKind.Field, BattleFlag.Ford)
    row(bs, 170, 1, BattleKind.Field, 0)
    row(bs, 180, 3, BattleKind.Siege, 0, 3)
    row(bs, 181, 3, BattleKind.Siege, 0, 3)
    const n = nameBattles(world, bs, { settlements, renamings: undefined as never }, features, map)
    expect(n[0]).toBe('the Battle of Vebena Ford')
    expect(n[1]).toBe('the Battle of the Kephia Ford')
    expect(n[2]).toBe('the Second Battle of the Kephia Ford')
    expect(n[3]).toBe('the Battle of Ashtar Field')
    expect(n[4]).toBe('the Siege of Vebena')
    expect(n[5]).toBe('the Siege of Vebena') // (one siege, two assaults)
  })
  it('ordinals', () => {
    expect(withOrdinal('the Siege of X', 3)).toBe('the Third Siege of X')
    expect(withOrdinal('the Battle of X', 21)).toBe('the 21st Battle of X')
  })
})
