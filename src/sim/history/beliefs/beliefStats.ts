// beliefs: the stats harness (beliefs-and-deception.md §1.5, §6 step 0, §7). Not shipped in tests.
// Run: node --experimental-strip-types src/sim/history/beliefs/beliefStats.ts [--on] [--shadow] [--barriers (with language)] [--years N] [--opts JSON] [--set BELIEF.k=v] seeds...
// Prints one JSON line per seed: conquest wars, initiated (not ally-joined) wars and how they ended, war lengths, overawe
// vassalages; with beliefs on the misjudged wars (believed >= 1.5 actual), motives, crises, coerced, deterred, bluffs,
// secret pacts, spies caught, and the mean |ln(est / true)| of beliefs by channel class (Math.log: harness only).

import { BeliefSource, EventType, WarKind, WarOutcome } from '../../../contract.ts'
import type { History, HistoryOptions } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { BELIEF } from './params.ts'

const argv: string[] = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
const flag = (k: string) => argv.includes(k)
let years = 2000
const yi = argv.indexOf('--years')
if (yi >= 0) years = Number(argv[yi + 1])
const oi = argv.indexOf('--opts')
const extra: HistoryOptions = oi >= 0 ? JSON.parse(argv[oi + 1]) : {}
const seeds = argv.filter((x, i) => /^\d+$/.test(x) && argv[i - 1] !== '--years').map(Number)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set') continue
  const [k, v] = argv[i + 1].split('=')
  const f = k.split('.')[1]
  ;(BELIEF as unknown as Record<string, number | boolean>)[f] = v === 'true' ? true : v === 'false' ? false : Number(v)
}
if (flag('--shadow')) BELIEF.shadow = true
const opts: HistoryOptions = { years, ...extra, beliefs: flag('--on') || flag('--shadow') || flag('--barriers'), ...(flag('--barriers') ? { barriers: true, language: true } : {}) }

const median = (a: number[]) => { if (a.length === 0) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }
const won = (o: number) => o === WarOutcome.AttackerGains || o === WarOutcome.Conquest || o === WarOutcome.Tribute || o === WarOutcome.Vassalage

/** Wars joined by an ally of the defender: declared the same year as a war whose attacker they fight, right after it. */
function joinedWars(h: History): Uint8Array {
  const W = h.wars
  const out = new Uint8Array(W.count)
  for (let w = 1; w < W.count; w++) {
    if (W.kind[w] !== WarKind.Conquest) continue
    for (let v = w - 1; v >= 0 && W.startYear[v] === W.startYear[w]; v--) if (W.attacker[v] === W.defender[w] && W.kind[v] === WarKind.Conquest) { out[w] = 1; break }
  }
  return out
}

function stats(seed: number): Record<string, unknown> {
  const t0 = Date.now()
  const { history: h, diag } = runHistory(generateWorld(seed), opts)
  const ms = Date.now() - t0
  const W = h.wars
  const joined = joinedWars(h)
  const on = W.believed.length === W.count && W.count > 0
  let conquest = 0, initiated = 0, attWin = 0, defWin = 0, white = 0, ongoing = 0, mis = 0, misLost = 0, okN = 0, okLost = 0, bargained = 0
  const len: number[] = []
  for (let w = 0; w < W.count; w++) {
    if (W.kind[w] !== WarKind.Conquest) continue
    conquest++
    if (W.endYear[w] >= 0) len.push(W.endYear[w] - W.startYear[w])
    if (on ? W.believed[w] < 0 && joined[w] : joined[w]) continue
    initiated++
    const o = W.outcome[w]
    if (o === WarOutcome.Ongoing) { ongoing++; continue }
    if (won(o)) attWin++
    else if (o === WarOutcome.DefenderGains) defWin++
    else white++
    if (on && W.believed[w] >= 0) {
      bargained++
      const lost = o === WarOutcome.DefenderGains || o === WarOutcome.WhitePeace
      if (W.believed[w] >= 1.5 * W.actual[w]) { mis++; if (lost) misLost++ } else { okN++; if (lost) okLost++ }
    }
  }
  const ev = (t: number) => h.events.filter((e) => e.type === t).length
  // Overawe vassalages: BecameVassal (made) not in a year the pair made peace.
  const peace = new Set<string>()
  for (const e of h.events) if (e.type === EventType.PeaceMade) peace.add(`${e.year}:${e.settlement}:${e.other}`).add(`${e.year}:${e.other}:${e.settlement}`)
  let overawe = 0
  for (const e of h.events) if (e.type === EventType.BecameVassal && e.extra === 0 && (e.value ?? 0) < 1000 && !peace.has(`${e.year}:${e.settlement}:${e.other}`)) overawe++
  const out: Record<string, unknown> = {
    seed, ms, conquest, initiated, attWin: +(attWin / Math.max(1, initiated - ongoing)).toFixed(3), defWin: +(defWin / Math.max(1, initiated - ongoing)).toFixed(3), white, ongoing,
    medianLen: median(len), overawe, alliances: ev(EventType.Alliance),
  }
  if (on) {
    const B = h.beliefs, P = h.polities.length
    const errBy: Record<string, number[]> = { contactOnly: [], tradeMarriage: [], any: [] }
    for (let q = 1; q * 10 <= years; q++) {
      const s = Math.min(h.snapshotCount - 1, Math.round((q * 10) / h.snapshotInterval))
      for (let k = 0; k < B.count; k++) {
        const est = h.beliefEst[q * B.count + k]
        if (est <= 0) continue
        const tr = h.strength[s * P + B.target[k]]
        if (!(tr > 0)) continue
        const e = Math.abs(Math.log(est / tr))
        const src = h.beliefSource[q * B.count + k]
        errBy.any.push(e)
        if (src === BeliefSource.Contact || src === (BeliefSource.Contact | BeliefSource.Border)) errBy.contactOnly.push(e)
        if ((src & BeliefSource.Trade) !== 0 && (src & BeliefSource.Marriage) !== 0) errBy.tradeMarriage.push(e)
      }
    }
    const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : 0)
    const d = diag.beliefs!
    out.bargained = bargained
    out.misjudged = +(mis / Math.max(1, bargained)).toFixed(3)
    out.misLost = +(misLost / Math.max(1, mis)).toFixed(3)
    out.okLost = +(okLost / Math.max(1, okN)).toFixed(3)
    out.crises = d.crises; out.coerced = d.coerced; out.tributes = d.tributes; out.deterred = d.deterred; out.deterredLogged = d.deterredLogged
    out.motives = d.byMotive
    out.bluffs = d.bluffs; out.bluffsExposed = d.bluffsExposed; out.bluffsUnpaid = d.bluffsUnpaid
    out.secret = d.secret; out.revealed = ev(EventType.AllianceRevealed); out.spiesCaught = d.spiesCaught; out.spyEvents = ev(EventType.SpyCaught)
    out.coercedEv = ev(EventType.Coerced); out.deterredEv = ev(EventType.Deterred)
    out.errAny = mean(errBy.any); out.errContact = mean(errBy.contactOnly); out.errTradeMar = mean(errBy.tradeMarriage)
    out.rows = B.count
    const ib = diag.barrierState
    if (ib) { out.ibMeanE = +(ib.diag.eSum / Math.max(1, ib.diag.pairs)).toFixed(3); out.ibUnintel = +(ib.diag.unintelligible / Math.max(1, ib.diag.pairs)).toFixed(3); out.ibLagDays = +(ib.diag.lagSum / Math.max(1, ib.diag.pairs)).toFixed(1); out.ibLangs = ib.ld ? ib.ld.b.tree.count : 0 }
  }
  return out
}

for (const seed of seeds.length ? seeds : [1, 7, 42, 1234]) console.log(JSON.stringify(stats(seed)))
