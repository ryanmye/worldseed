// battles: the contract tables (History.battles, History.commanders), copied out at assembly; every array owns its buffer.

import type { Battles, Commanders } from '../../../contract.ts'

export interface BattleHistory {
  battles: Battles
  commanders: Commanders
}

export function emptyBattleHistory(): BattleHistory {
  return {
    battles: {
      count: 0, war: new Int32Array(0), year: new Int16Array(0), kind: new Uint8Array(0), counter: new Uint8Array(0), site: new Int32Array(0),
      target: new Int32Array(0), from: new Int32Array(0), attacker: new Int16Array(0), defender: new Int16Array(0), cmdA: new Int32Array(0),
      cmdD: new Int32Array(0), menA: new Float32Array(0), menD: new Float32Array(0), lossA: new Float32Array(0), lossD: new Float32Array(0),
      dead: new Float32Array(0), winner: new Uint8Array(0), hours: new Float32Array(0), weather: new Uint8Array(0), flags: new Uint16Array(0),
      ratio: new Float32Array(0), breakA: new Float32Array(0), breakD: new Float32Array(0), siegeYear: new Uint8Array(0), name: [],
    },
    commanders: {
      count: 0, polity: new Int16Array(0), people: new Int16Array(0), reign: new Int32Array(0), dynasty: new Int32Array(0), born: new Int16Array(0),
      female: new Uint8Array(0), skill: new Float32Array(0), firstYear: new Int16Array(0), lastYear: new Int16Array(0), battles: new Uint16Array(0),
      wins: new Uint16Array(0), fame: new Float32Array(0), fameYear: new Int16Array(0), fate: new Uint8Array(0), fateYear: new Int16Array(0),
      fateBattle: new Int32Array(0), fateWar: new Int32Array(0), reignAfter: new Int32Array(0), name: [],
    },
  }
}
