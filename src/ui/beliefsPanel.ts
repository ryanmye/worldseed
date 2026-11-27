// beliefs (beliefs-and-deception.md §5.2): the polity panel's "As X sees its neighbours" section: what the selected polity
// believed of its rivals' strength at the year shown (against the truth, which the user sees), how sure, from what, and the
// bluffs and secret pacts behind the picture; and how others saw it.

import { BondKind } from '../contract.ts'
import type { History } from '../contract.ts'
import { beliefAt, beliefsOf, deceptionAt, hasBeliefs, heldAbout, sourceWords, sureWord, truthAt } from './beliefsData.ts'
import type { PolitiesData } from './politiesData.ts'
import type { PanelKit } from './grudgesPanel.ts'

const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`)

/** Bars on a shared log scale (1 bar per doubling, at most 6). */
function bars(x: number, lo: number): string {
  const n = Math.max(1, Math.min(6, Math.round(Math.log2(Math.max(1e-9, x / lo)) + 1)))
  return '▮'.repeat(n)
}

export function beliefSection(h: History, pd: PolitiesData, p: number, year: number, k: PanelKit): void {
  if (!hasBeliefs(h)) return
  const rows = beliefsOf(h, p)
    .map((r) => ({ r, b: beliefAt(h, r, year), t: h.beliefs.target[r] }))
    .filter((x) => x.b !== null && x.b.est > 0 && truthAt(h, x.t, year) > 0)
  if (rows.length === 0) return
  const rivalry = (t: number) => (pd.warsOf[p] ?? []).filter((w) => pd.wars && (pd.wars.attacker[w] === t || pd.wars.defender[w] === t)).length
  rows.sort((a, b) => rivalry(b.t) - rivalry(a.t) || truthAt(h, b.t, year) - truthAt(h, a.t, year))
  k.cap(`As ${pd.names[p]} sees its neighbours`)
  const B = pd.bonds
  for (const x of rows.slice(0, 6)) {
    const est = x.b!.est, tr = truthAt(h, x.t, year)
    const lo = Math.min(est, tr) / 2
    const d = k.line(k.polityLink(x.t, pd.names[x.t]), ` · thought ${times(est / tr)} its strength · ${sureWord(x.b!.sd)} (${sourceWords(x.b!.src)}) · ${bars(est, lo)} vs ${bars(tr, lo)}`)
    d.classList.add('fp-belief')
    const dc = deceptionAt(h, x.t, year)
    if (dc && dc.bluff > 0 && est > 1.2 * tr) d.append(' · bluffing')
    if (B) for (let b = 0; b < B.count; b++) {
      if (B.kind[b] !== BondKind.Alliance || B.startYear[b] > year || (B.endYear[b] >= 0 && B.endYear[b] <= year)) continue
      if (B.a[b] !== x.t && B.b[b] !== x.t) continue
      const kn = B.known?.[b]
      if (kn === undefined || !(kn === -1 || kn > year)) continue
      const ally = B.a[b] === x.t ? B.b[b] : B.a[b]
      if (ally !== p) d.append(` · secret ally of ${pd.names[ally]}`)
    }
  }
  const seen = heldAbout(h, p).map((r) => ({ o: h.beliefs.observer[r], b: beliefAt(h, r, year) })).filter((x) => x.b !== null && x.b.est > 0)
  const tr = truthAt(h, p, year)
  if (seen.length > 0 && tr > 0) {
    const parts = seen.slice(0, 4).map((x) => `${pd.names[x.o]} ${times(x.b!.est / tr)}`)
    k.line(`Seen by others as: ${parts.join(' · ')}`).classList.add('fp-faint')
  }
  const dc = deceptionAt(h, p, year)
  if (dc && (dc.bluff > 0 || dc.spy >= 0.5 || dc.cred < 0.6)) {
    const parts: string[] = []
    if (dc.bluff > 0) parts.push(`shows ${times(1 + dc.bluff)} its strength`)
    if (dc.spy >= 0.5) parts.push('its spymasters are busy')
    if (dc.cred < 0.6) parts.push('its word is little trusted')
    k.line(parts.join(' · ')).classList.add('fp-faint')
  }
}

/** The tooltip of a bargained war in the war list: "believed 2.1× on the front, was 0.8×", or ''. */
export function beliefWarTitle(pd: PolitiesData, w: number): string {
  const W = pd.wars
  if (!W || !W.believed || W.believed.length !== W.count || !(W.believed[w] >= 0)) return ''
  return `believed ${times(W.believed[w])} on the front, was ${times(W.actual[w])}`
}
