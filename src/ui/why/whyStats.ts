// Why: the stats harness and rule calibration (causal-explorer.md §10.3, step 7). Runs worlds with causes on, measures the
// precision of the rule-only links (R4b–R4d, R10b, R16 fallback) against the records on the same History (a rule link is
// confirmed when the record shows the matching part or factor), and the §10.3 metrics. The measured precisions are written
// by hand into rules/base.ts RULE_CONF (commit note), with RULE_MEASURED listing them.
// Run: node --experimental-strip-types --no-warnings src/ui/why/whyStats.ts [years=2000] [seeds=1,7,42,1234]

import { EventType as E, RIVALRY_PARTS, RivalryPart, UnrestPart, WarWhyFlag } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { causeIndexOf } from './causeIndex.ts'
import { eventCauses } from './rules/base.ts'
import { explain } from './explain.ts'
import { WhyTier, parseKey } from './graph.ts'

export interface RuleTally { hits: number; confirmed: number }
export interface WhyStats {
  rules: Record<string, RuleTally>
  /** §10.3 */
  warsWithLikely: number; wars: number
  revoltsTwoParts: number; revolts: number
  faminesExplained: number; famines: number
  abandonsWithCause: number; abandons: number
  endChainMedian: number
  unexplainedRoots: number; keyRoots: number
  indexMs: number
  explainP95Ms: number
}

/** The History as if causes had been off (rule-only explanations). */
export function withoutWhy(h: History): History {
  const { why: _w, ...rest } = h
  return rest as History
}

export function whyStats(h: History): WhyStats {
  const t0 = performance.now()
  const ix = causeIndexOf(h)
  const indexMs = performance.now() - t0
  const bare = causeIndexOf(withoutWhy(h))
  const W = ix.why
  const rules: Record<string, RuleTally> = {}
  const tally = (id: string, ok: boolean) => { const r = (rules[id] ??= { hits: 0, confirmed: 0 }); r.hits++; if (ok) r.confirmed++ }
  const ev = h.events
  let warsWithLikely = 0, wars = 0, revoltsTwoParts = 0, revolts = 0, faminesExplained = 0, famines = 0, abandonsWithCause = 0, abandons = 0
  let unexplained = 0, keyRoots = 0
  const times: number[] = []
  const depths: number[] = []
  const KEY = new Set<number>([E.PolityEnded, E.WarDeclared, E.Revolt, E.Famine, E.Abandoned, E.ReignEnded, E.Conquered])
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    if (!KEY.has(e.type)) continue
    keyRoots++
    const a = performance.now()
    const t = explain(h, `event:${i}`, { effects: 0 })
    times.push(performance.now() - a)
    if (!t.links.some((l) => l.effect === t.root)) unexplained++
    if (e.type === E.PolityEnded) {
      // the depth of the longest chain
      const dOf = new Map<string, number>([[t.root, 0]])
      let mx = 0
      for (const l of t.links) { const d = (dOf.get(l.effect) ?? 0) + 1; if (!dOf.has(l.cause)) dOf.set(l.cause, d); if (d > mx) mx = d }
      depths.push(mx)
    }
    if (!W) continue
    if (e.type === E.WarDeclared) {
      const w = e.value
      if (W.wars.odds[w] === 0) continue
      wars++
      const cs = t.links.filter((l) => l.effect === t.root)
      if (cs.some((l) => l.conf >= 0.66) || cs.reduce((s, l) => s + (l.tier === WhyTier.Condition ? l.conf : 0), 0) >= 0.66) warsWithLikely++
      for (const c of eventCauses(bare, i)) {
        const part = (k: number) => W.wars.parts[w * RIVALRY_PARTS + k] / 127
        if (c.via === 'R4b') tally('R4b', part(RivalryPart.Dispute) >= 0.1)
        if (c.via === 'R4c') tally('R4c', part(RivalryPart.RecentWar) >= 0.05)
        if (c.via === 'R4d') tally('R4d', (W.wars.flags[w] & WarWhyFlag.Crisis) !== 0)
      }
    }
    if (e.type === E.Revolt) {
      const r = ix.revoltRow.get(i)
      if (r === undefined) continue
      revolts++
      let named = 0
      const parts = new Map<number, number>()
      for (let j = 0; j < 4; j++) { const p = W.revolts.part[r * 4 + j]; if (p !== 255) { named++; parts.set(p, W.revolts.share[r * 4 + j] / 255) } }
      if (named >= 2) revoltsTwoParts++
      const has = (p: number) => (parts.get(p) ?? 0) >= 0.1
      for (const c of eventCauses(bare, i)) {
        if (!c.via.startsWith('R10b')) continue
        const k = parseKey(c.key)
        const be = k && k.kind === 'event' ? ev[k.id] : null
        if (!be) continue
        const ok = be.type === E.Famine ? has(UnrestPart.Famine) : be.type === E.Conquered ? has(UnrestPart.Conquest) || has(UnrestPart.Foreign)
          : be.type === E.Joined || be.type === E.Defected ? has(UnrestPart.Foreign) : be.type === E.WarDeclared ? has(UnrestPart.Exhaustion)
            : be.type === E.Persecution ? has(UnrestPart.Faith) : has(UnrestPart.Crisis)
        tally(c.via, ok)
      }
    }
    if (e.type === E.Famine) {
      const r = ix.famineRow.get(i)
      if (r === undefined) continue
      famines++
      const cs = t.links.filter((l) => l.effect === t.root)
      const harv = cs.find((l) => l.via === 'cond:famine.Harvest')?.conf ?? 0
      const rav = cs.find((l) => l.via === 'cond:famine.Ravaged')?.conf ?? 0
      if (harv >= 0.3 || rav >= 0.3) faminesExplained++
      for (const c of eventCauses(bare, i)) {
        if (c.via === 'R16burst') tally('R16burst', harv >= 0.3)
        if (c.via === 'R16war') tally('R16war', rav >= 0.1)
        if (c.via === 'R16blight') tally('R16blight', harv >= 0.3)
      }
    }
    if (e.type === E.Abandoned) {
      abandons++
      if (ix.abandonRow.has(i)) abandonsWithCause++
    }
  }
  times.sort((a, b) => a - b)
  depths.sort((a, b) => a - b)
  return {
    rules, warsWithLikely, wars, revoltsTwoParts, revolts, faminesExplained, famines, abandonsWithCause, abandons,
    endChainMedian: depths.length ? depths[depths.length >> 1] : 0, unexplainedRoots: unexplained, keyRoots, indexMs,
    explainP95Ms: times.length ? times[Math.floor(times.length * 0.95)] : 0,
  }
}

/** Sums of several runs' rule tallies; precision per rule. */
export function precision(all: WhyStats[]): Record<string, { hits: number; precision: number }> {
  const out: Record<string, { hits: number; confirmed: number }> = {}
  for (const s of all) for (const [k, v] of Object.entries(s.rules)) { const o = (out[k] ??= { hits: 0, confirmed: 0 }); o.hits += v.hits; o.confirmed += v.confirmed }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { hits: v.hits, precision: v.hits ? v.confirmed / v.hits : 0 }]))
}

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
if (argv[1] && /whyStats\.ts$/.test(argv[1])) {
  const { generateWorld, simulateHistory } = await import('../../sim/index.ts')
  const years = Number(argv[2] ?? 2000)
  const seeds = (argv[3] ?? '1,7,42,1234').split(',').map(Number)
  const all: WhyStats[] = []
  for (const seed of seeds) {
    const h = simulateHistory(generateWorld(seed), { years, causes: true })
    const s = whyStats(h)
    all.push(s)
    const { rules: _r, ...rest } = s
    console.log(JSON.stringify({ seed, years, ...rest, indexMs: Math.round(s.indexMs * 10) / 10, explainP95Ms: Math.round(s.explainP95Ms * 100) / 100 }))
  }
  console.log(JSON.stringify({ precision: precision(all) }))
}
