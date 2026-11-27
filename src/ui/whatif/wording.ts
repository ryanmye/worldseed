// What-if: the wording of the comparison (whatifPanel.ts, whatifUi.test.ts): what a comparison holds once shown (both
// histories, the worker's result, the facts) and one line per long-run difference. DOM-free.

import type { History, Order } from '../../contract.ts'
import type { HistoryFingerprint } from '../../whatif/fingerprint.ts'
import type { WhatIfDigest } from '../../whatif/diff.ts'
import { describeEvent, formatInt, formatPopulation, settlementName } from '../format.ts'
import type { PolitiesData } from '../politiesData.ts'
import { faithName, faithsOf } from '../faithsData.ts'
import { peakTitle, type Consequence, type WhatIfFacts } from './consequences.ts'

/** What the worker posts for a compare (worker.ts WorkerResponse 'compare'). */
export interface CompareResult {
  compareId: number
  digest: WhatIfDigest
  fpA: HistoryFingerprint
  fpB: HistoryFingerprint
  alt: History
  skeleton: boolean
  ms: number
  cached: boolean
}

/** A comparison as asked for: B's order list, the header, and the order it is about (in A or in B) for the "same" line. */
export interface CompareAsk {
  orders: Order[]
  label: string
  /** The order the comparison is about: its index in A's orders ("what if not") or in B's ("what if instead"), -1 none. */
  focus: { world: 'A' | 'B'; k: number } | null
}

export interface WhatIfShown {
  ask: CompareAsk
  A: History
  B: History
  result: CompareResult
  facts: WhatIfFacts
  pdA: PolitiesData | null
  pdB: PolitiesData | null
}

const pct = (r: number) => `${r > 0 ? '+' : '−'}${Math.round(Math.abs(Math.expm1(r)) * 100)}%`
export const safeDescribe = (h: History, i: number): string => {
  try {
    return describeEvent(h, h.events[i])
  } catch {
    return ''
  }
}

/** The wording of one long-run difference ("Only in the other world: …"). */
export function consequenceText(s: WhatIfShown, c: Consequence): string {
  const { A, B, pdA, pdB, result } = s
  const { fpA, fpB } = result
  const capA = (p: number) => (pdA && p >= 0 ? settlementName(A, pdA.list[p].capitals[0]) : '')
  const capB = (p: number) => (pdB && p >= 0 ? settlementName(B, pdB.list[p].capitals[0]) : '')
  const tA = (p: number) => peakTitle(pdA, fpA, p)
  const tB = (p: number) => peakTitle(pdB, fpB, p)
  const both = (a: number, b: number) => (tA(a) === tB(b) ? `the ${tA(a)}` : `the ${tA(a)} (in the other world, the ${tB(b)})`)
  switch (c.kind) {
    case 'polity':
      return c.side === 'A'
        ? `Only in our world: the ${tA(c.a)}, founded ${fpA.pFounded[c.a]} at ${capA(c.a)} (${formatPopulation(c.va)} at its height).`
        : `Only in the other world: the ${tB(c.b)}, founded ${fpB.pFounded[c.b]} at ${capB(c.b)} (${formatPopulation(c.vb)} at its height).`
    case 'polityDiff':
      if (c.what === 'end') {
        const aEnded = fpA.pEnded[c.a] >= 0 && fpA.pEnded[c.a] <= s.facts.T
        return aEnded ? `${cap(both(c.a, c.b))} ended in ${fpA.pEnded[c.a]} here; in the other world it stands in ${s.facts.T}.` : `${cap(both(c.a, c.b))} stands here in ${s.facts.T}; in the other world it ended in ${fpB.pEnded[c.b]}.`
      }
      return `${cap(both(c.a, c.b))}: ${formatPopulation(c.va)} at its height here, ${formatPopulation(c.vb)} there.`
    case 'people': {
      const name = A.peoples[c.a]?.name ?? 'a people'
      return c.what === 'land'
        ? `Land held by ${name} states: ${formatInt(c.va)} cells here, ${formatInt(c.vb)} there (${pct(c.r)}).`
        : `The ${name}: ${formatPopulation(c.va)} here, ${formatPopulation(c.vb)} there by ${s.facts.T} (${pct(c.r)}).`
    }
    case 'faith': {
      const fd = faithsOf(c.side === 'A' ? A : B)
      const f = c.side === 'A' ? c.a : c.b
      const fp = c.side === 'A' ? fpA : fpB
      const name = fd ? faithName(fd, f) : 'a faith'
      return `Only in ${c.side === 'A' ? 'our' : 'the other'} world: ${name}, founded ${fp.fFounded[f]} (${formatPopulation(c.side === 'A' ? c.va : c.vb)} followers at its height).`
    }
    case 'stateFaith': {
      const fa = faithsOf(A), fb = faithsOf(B)
      const wa = c.va >= 0 && fa ? faithName(fa, c.va) : 'no state faith'
      const wb = c.vb >= 0 && fb ? faithName(fb, c.vb) : 'no state faith'
      return `${cap(both(c.a, c.b))} keeps ${wa} here, ${wb} there.`
    }
    case 'war': {
      const fp = c.side === 'A' ? fpA : fpB
      const pd = c.side === 'A' ? pdA : pdB
      const w = c.side === 'A' ? c.a : c.b
      const nm = (p: number) => (pd && p >= 0 && p < pd.count ? pd.names[p] : 'a realm')
      return `Only in ${c.side === 'A' ? 'our' : 'the other'} world: the war of ${nm(fp.wA[w])} on ${nm(fp.wD[w])} from ${fp.wStart[w]}, ${formatPopulation(fp.wDead[w])} dead.`
    }
    case 'epidemic': {
      const h = c.side === 'A' ? A : B
      const x = h.epidemics?.[c.side === 'A' ? c.a : c.b]
      const dis = x ? h.diseases?.[x.disease]?.name : ''
      return `Only in ${c.side === 'A' ? 'our' : 'the other'} world: a great epidemic${dis ? ` of the ${dis}` : ''} from ${c.year} (${Math.round((c.side === 'A' ? c.va : c.vb) * 100)}% of those it reached died).`
    }
  }
  return ''
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

