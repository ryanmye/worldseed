// battles: headless stats harness (battles.md section 6). Run with:
//   node --experimental-strip-types --no-warnings src/sim/history/battles/battleStats.ts [seed ...]   (default 1 7 42 1234)
//   ... --years 2000        run length
//   ... --mode '{"toll":"split","tempo":false}'   BATTLE_MODE for the "on" run (default: the shipped BATTLE_MODE)
//   ... --opts '{"oaths":true,"finance":true}'     extra HistoryOptions for both runs
//   ... --json              one JSON row per seed and run instead of the table
// Every seed runs twice: "base" (battles neutral: the history is bit-identical to battles off, so its battle rows are the
// baseline of the 1.2 table) and "on" (the modifiers, the toll, tempo, naval, pretenders as BATTLE_MODE says). The table
// gives both per seed, the targets of section 6, and the modifiers' mean logs (the sim keeps the raw factors: it may not
// use Math.log). The realism rows (war.alpha, war.durCv, onsets, maxShare) come from realismStats.ts --opts '{"battles":true}'.

import { BattleFlag, BattleKind, EventType, ReignEnd, WarOutcome } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import type { BattleDiag } from './state.ts'
import { BATTLE_MODE } from './params.ts'

type Row = Record<string, number | string>

function quant(a: number[], q: number): number {
  if (a.length === 0) return NaN
  const b = a.slice().sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(q * b.length))]
}
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)

export function battleRow(h: History, d: BattleDiag | undefined): Row {
  const W = h.wars, B = h.battles, C = h.commanders
  const row: Row = {}
  row.wars = W.count
  let dead = 0, taken = 0
  const len: number[] = []
  const out = new Array(8).fill(0)
  for (let w = 0; w < W.count; w++) {
    dead += W.dead[w]; taken += W.taken[w]
    if (W.endYear[w] >= 0) len.push(W.endYear[w] - W.startYear[w])
    out[W.outcome[w]]++
  }
  row.dead = Math.round(dead); row.taken = taken
  row.lenMed = quant(len, 0.5); row.lenP90 = quant(len, 0.9); row.lenMean = mean(len)
  row.conquest = out[WarOutcome.Conquest]; row.attGains = out[WarOutcome.AttackerGains]; row.defGains = out[WarOutcome.DefenderGains]
  row.white = out[WarOutcome.WhitePeace]; row.tribute = out[WarOutcome.Tribute]; row.vassal = out[WarOutcome.Vassalage]
  let land = 0, att = 0, attW = 0, field = 0, fieldW = 0, walled = 0, walledW = 0, counter = 0, counterW = 0, naval = 0
  const kinds = new Array(6).fill(0)
  let ford = 0, pyr = 0, ruler = 0, lostNamed = 0, namedFell = 0
  const fWin: number[] = [], fLose: number[] = [], hours: number[] = []
  for (let b = 0; b < B.count; b++) {
    const k = B.kind[b]
    kinds[k]++
    if (k === BattleKind.Naval) { naval++; continue }
    land++
    const aw = B.winner[b] === 0
    if (B.counter[b] === 0) { att++; if (aw) attW++ } else { counter++; if (aw) counterW++ }
    if (B.counter[b] === 0 && k === BattleKind.Siege) { walled++; if (aw) walledW++ }
    else if (B.counter[b] === 0) { field++; if (aw) fieldW++ }
    if ((k === BattleKind.Field || k === BattleKind.Ambush) && (B.flags[b] & BattleFlag.Ford)) ford++
    if (B.flags[b] & BattleFlag.Pyrrhic) pyr++
    if (B.flags[b] & BattleFlag.RulerLed) ruler++
    const fa = B.menA[b] > 0 ? B.lossA[b] / B.menA[b] : 0, fd = B.menD[b] > 0 ? B.lossD[b] / B.menD[b] : 0
    fWin.push(aw ? fa : fd); fLose.push(aw ? fd : fa); hours.push(B.hours[b])
  }
  row.battles = land; row.attBattles = att; row.naval = naval
  row.attWin = attW / att; row.fieldWin = fieldW / field; row.walledN = walled; row.walledWin = walledW / walled; row.counterWin = counterW / counter
  const fieldAll = kinds[BattleKind.Field] + kinds[BattleKind.Ambush]
  for (const [k, n] of [['Field', 0], ['Siege', 1], ['Relief', 2], ['Ambush', 4], ['Landing', 5]] as [string, number][]) row['kind' + k] = kinds[n] / land
  row.ford = ford / fieldAll
  row.fWinMed = quant(fWin, 0.5); row.fLoseMed = quant(fLose, 0.5); row.pyrrhic = pyr / land; row.hoursMed = quant(hours, 0.5); row.hoursP90 = quant(hours, 0.9)
  row.rulerLed = ruler / land
  // named commanders killed or taken per lost battle (generals with a row: every battle has one)
  for (let b = 0; b < B.count; b++) {
    const loser = B.winner[b] === 0 ? B.cmdD[b] : B.cmdA[b]
    if (loser < 0) continue
    lostNamed++
    if ((C.fate[loser] === 1 || C.fate[loser] === 2) && C.fateBattle[loser] === b) namedFell++
  }
  row.commanders = C.count; row.cmdFellPerLoss = namedFell / lostNamed
  const ev = new Map<number, number>()
  for (const e of h.events) ev.set(e.type, (ev.get(e.type) ?? 0) + 1)
  const n = (t: number): number => ev.get(t) ?? 0
  row.sacked = n(EventType.Sacked); row.siegeLifted = n(EventType.SiegeLifted); row.blockade = n(EventType.Blockade)
  row.battleFought = n(EventType.BattleFought); row.renowned = n(EventType.CommanderRenowned); row.seized = n(EventType.GeneralSeized)
  row.rose = n(EventType.GeneralRose); row.turned = n(EventType.GeneralTurned); row.dismissedEv = n(EventType.CommanderDismissed)
  let rb = 0, ov = 0
  for (const r of h.rulers) { if (r.end === ReignEnd.Battle) rb++; if (r.end === ReignEnd.Overthrown || r.end === ReignEnd.Deposed) ov++ }
  row.rulerBattle = rb; row.overthrows = ov
  if (d && d.factors.length > 0) {
    const F = d.factors, K = 8, m = F.length / K
    const names = ['ground', 'cmd', 'supply', 'sick', 'surprise', 'weather', 'xs', 'rain']
    let all = 0
    for (let j = 0; j < K; j++) {
      let sum = 0
      for (let i = 0; i < m; i++) sum += Math.log(F[i * K + j])
      row['lnM.' + names[j]] = sum / m
      if (j !== 6) all += sum / m
    }
    // all: E ln (x / r^2) (every factor and the rain compression); net: E[ln M - ln x*], what moves the attacker win rate
    row['lnM.all'] = all
    row['lnM.net'] = all - (row['lnM.xs'] as number)
    let rain = 0
    for (let i = 0; i < m; i++) rain += F[i * K + 7] !== 1 ? 1 : 0
    row.rainShare = rain / m
    row.decisive = d.decisive; row.rulersFell = d.rulersFell; row.realmDead = Math.round(d.realmDead); row.navalLost = d.navalLost
  }
  return row
}

function runOne(seed: number, years: number, opts: HistoryOptions, mode: Partial<typeof BATTLE_MODE>): Row {
  const saved = { ...BATTLE_MODE }
  Object.assign(BATTLE_MODE, mode)
  try {
    const t0 = Date.now()
    const run = runHistory(generateWorld(seed), { ...opts, years, battles: true })
    const row = battleRow(run.history, run.diag.battles)
    row.ms = Date.now() - t0
    return row
  } finally { Object.assign(BATTLE_MODE, saved) }
}

const TARGETS: [string, string, (b: number, o: number) => boolean][] = [
  ['wars', '±10%', (b, o) => Math.abs(o / b - 1) <= 0.1],
  ['battles', '±10%', (b, o) => Math.abs(o / b - 1) <= 0.1],
  ['attWin', '±0.03', (b, o) => Math.abs(o - b) <= 0.03],
  ['fieldWin', '±0.03', (b, o) => Math.abs(o - b) <= 0.03],
  ['walledWin', '±0.05', (b, o) => Math.abs(o - b) <= 0.05],
  ['counterWin', '±0.04', (b, o) => Math.abs(o - b) <= 0.04],
  ['taken', '±12%', (b, o) => Math.abs(o / b - 1) <= 0.12],
  ['sacked', '±15%', (b, o) => Math.abs(o / b - 1) <= 0.15],
  ['siegeLifted', '±30%', (b, o) => Math.abs(o / b - 1) <= 0.3],
  ['blockade', '>=60%', (b, o) => o >= 0.6 * b],
  ['rulerBattle', '±25%', (b, o) => Math.abs(o / b - 1) <= 0.25],
  ['overthrows', '±25%', (b, o) => Math.abs(o / b - 1) <= 0.25],
]
const ABS: [string, number, number][] = [
  ['lnM.net', -0.05, 0.05], ['lnM.xs', -0.05, 0.05], ['kindField', 0.55, 0.75], ['kindSiege', 0.08, 0.16], ['kindRelief', 0.02, 0.08],
  ['kindAmbush', 0.03, 0.08], ['kindLanding', 0.01, 0.05], ['ford', 0.15, 0.35], ['fWinMed', 0.03, 0.1], ['fLoseMed', 0.2, 0.4],
  ['pyrrhic', 0.03, 0.08], ['hoursMed', 2, 6], ['hoursP90', 0, 12], ['commanders', 120, 300], ['rulerLed', 0.2, 0.4],
  ['cmdFellPerLoss', 0.05, 0.12], ['renowned', 5, 20], ['seized', 1, 6], ['rose', 0, 4], ['battleFought', 200, 600],
]

function fmt(x: number | string | undefined): string {
  if (x === undefined) return '-'
  if (typeof x === 'string') return x
  if (!Number.isFinite(x)) return '-'
  return Math.abs(x) >= 100 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(3)
}

const ARGV = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
if (ARGV.length > 1 && import.meta.url === `file://${ARGV[1]}`) {
  const argv = ARGV.slice(2)
  let years = 2000, json = false
  let opts: HistoryOptions = {}, mode: Partial<typeof BATTLE_MODE> = {}
  const seeds: number[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--years') years = Number(argv[++i])
    else if (a === '--json') json = true
    else if (a === '--opts') opts = JSON.parse(argv[++i])
    else if (a === '--mode') mode = JSON.parse(argv[++i])
    else seeds.push(Number(a))
  }
  if (seeds.length === 0) seeds.push(1, 7, 42, 1234)
  const rows: { seed: number; base: Row; on: Row }[] = []
  for (const seed of seeds) {
    const base = runOne(seed, years, opts, { neutral: true })
    const on = runOne(seed, years, opts, mode)
    rows.push({ seed, base, on })
    if (json) { console.log(JSON.stringify({ seed, run: 'base', ...base })); console.log(JSON.stringify({ seed, run: 'on', ...on })) }
  }
  if (!json) {
    const keys = Object.keys(rows[0].on)
    console.log('metric'.padEnd(18) + rows.map((r) => `${r.seed} base`.padStart(11) + `on`.padStart(9)).join('') + '  target')
    for (const k of keys) {
      if (k === 'ms') continue
      const t = TARGETS.find((x) => x[0] === k), ab = ABS.find((x) => x[0] === k)
      let ok = 0
      const cells = rows.map((r) => {
        const b = r.base[k] as number, o = r.on[k] as number
        if (t && t[2](b, o)) ok++
        if (ab && o >= ab[1] && o <= ab[2]) ok++
        return fmt(b).padStart(11) + fmt(o).padStart(9)
      }).join('')
      const tgt = t ? `${t[1]} of base ${ok}/${rows.length}` : ab ? `${ab[1]}..${ab[2]} ${ok}/${rows.length}` : ''
      console.log(k.padEnd(18) + cells + '  ' + tgt)
    }
    console.log('ms'.padEnd(18) + rows.map((r) => fmt(r.base.ms).padStart(11) + fmt(r.on.ms).padStart(9)).join(''))
  }
}
