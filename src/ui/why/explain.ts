// Why: explaining a node (causal-explorer.md §4.5–4.6). Breadth first from the root: per node, the candidates of every
// registered rule module (the base catalogue first, then the plans' adapters, step 12), deduplicated, sorted by confidence,
// the top k kept (the rest counted as "lesser"). Chain confidence is the product of the Recorded and Rule confidences down
// the path (an independence approximation); a link whose chain falls below minChain is not drawn. Causes come no later than
// their effects (same-year: earlier in the log), so the tree is a DAG cut into a tree: a node reached twice is kept once.
// Trees are cached per History (an LRU); the CauseIndex is built on the first call.

import { EventType as E } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { WhyTier, evKey, parseKey, warKey } from './graph.ts'
import type { WhyLink, WhyNode, WhyTree } from './graph.ts'
import { causeIndexOf, ev, placeName, polName } from './causeIndex.ts'
import type { CauseIndex } from './causeIndex.ts'
import { baseRules } from './rules/base.ts'
import type { Cand } from './rules/base.ts'
import { dramaRule } from '../story/drama.ts'

/** A rule module: the candidate causes of a node (`code` for a condition key). Plan adapters register one each (rules/<plan>.ts). */
export type WhyRuleModule = (ix: CauseIndex, key: string, kind: string, id: number, code?: string) => Cand[]

const MODULES: WhyRuleModule[] = [baseRules]

/** Adds a plan's rule module (after the base catalogue); idempotent. */
export function registerWhyRules(m: WhyRuleModule): void {
  if (!MODULES.includes(m)) MODULES.push(m)
}

export interface ExplainOpts {
  /** Levels of causes below the root (default 3; at most WHY_LIMITS.maxDepth). */
  depth?: number
  /** Causes kept per node (default 3). */
  k?: number
  /** Chain confidence below which a link is not drawn (default 0.2). */
  minChain?: number
  /** Effects listed (default 5; 0 skips the search). */
  effects?: number
}

export const WHY_LIMITS = { depth: 3, maxDepth: 8, k: 3, minChain: 0.2, minWeight: 0.05, effects: 5, cacheDesktop: 128, cachePhone: 32 }

// ---------------------------------------------------------------------------------------------------------------------------
// Nodes

const T: Record<number, string> = {
  [E.Founded]: 'Founding', [E.Abandoned]: 'Abandonment', [E.Famine]: 'Famine', [E.Migration]: 'Migration', [E.PolityFounded]: 'Founding of a state',
  [E.PolityEnded]: 'End of a state', [E.CapitalMoved]: 'Capital moved', [E.Joined]: 'Submission', [E.WarDeclared]: 'War declared', [E.PeaceMade]: 'Peace',
  [E.Conquered]: 'Conquest', [E.Sacked]: 'Sack', [E.SiegeLifted]: 'Siege lifted', [E.Raid]: 'Raid', [E.Revolt]: 'Revolt', [E.RevoltCrushed]: 'Revolt crushed',
  [E.Seceded]: 'Secession', [E.Defected]: 'Defection', [E.SuccessionCrisis]: 'Contested succession', [E.CivilWar]: 'Civil war', [E.Partitioned]: 'Partition',
  [E.Reunified]: 'Reunification', [E.BecameVassal]: 'Vassalage', [E.Alliance]: 'Alliance', [E.BorderDispute]: 'Border dispute', [E.RulerAcceded]: 'Accession',
  [E.ReignEnded]: 'End of a reign', [E.DynastyEnded]: 'End of a house', [E.Regency]: 'Regency', [E.SuccessionWar]: 'War of succession', [E.HolyWar]: 'Holy war',
  [E.HolyCityFell]: 'Holy city fell', [E.Epidemic]: 'Epidemic', [E.CityStricken]: 'Plague', [E.GreatEpidemic]: 'Great epidemic', [E.DiseaseAppeared]: 'A new disease',
  [E.FirstContact]: 'First contact', [E.Blight]: 'Blight', [E.RoyalMarriage]: 'Royal marriage', [E.RulerConverted]: 'Conversion', [E.StateReligion]: 'State religion',
  [E.Persecution]: 'Persecution', [E.FaithReached]: 'Faith arrived', [E.FaithFounded]: 'Faith founded', [E.IdeaAdopted]: 'Idea adopted', [E.IdeaConceived]: 'Idea conceived',
  [E.TradeClosed]: 'Trade route closed', [E.TradeForsaken]: 'Trade forsaken', [E.OrderGiven]: 'Order given', [E.ResortAbandoned]: 'Resort given up', [E.BecameTown]: 'Became a town',
  [E.BecameCity]: 'Became a city',
}

/** Short label of event i ("Conquest of Oruma (1204)"). */
export function eventLabel(ix: CauseIndex, i: number): string {
  const e = ev(ix, i)
  if (!e) return 'An event'
  const h = ix.h
  const t = T[e.type] ?? 'Event'
  const at = placeName(ix, e.settlement, e.year)
  if ((e.type === E.WarDeclared || e.type === E.CivilWar) && h.wars && e.value >= 0) return `${t}: ${polName(ix, h.wars.attacker[e.value])} on ${polName(ix, h.wars.defender[e.value])} (${e.year})`
  if (e.type === E.PolityEnded || e.type === E.PolityFounded) return `${t}: ${polName(ix, e.value)} (${e.year})`
  if (e.type === E.ReignEnded || e.type === E.RulerAcceded) { const r = h.rulers?.[e.value]; return `${t}: ${r ? r.name + (r.regnal > 1 ? ' ' + roman(r.regnal) : '') : 'a ruler'} at ${at} (${e.year})` }
  return `${t} at ${at} (${e.year})`
}

export function roman(n: number): string {
  const v: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let s = ''
  for (const [k, r] of v) while (n >= k) { s += r; n -= k }
  return s
}

export function nodeOf(ix: CauseIndex, key: string, c?: Cand): WhyNode | null {
  if (c?.node) return c.node
  const k = parseKey(key)
  if (!k) return null
  if (k.kind === 'event') {
    const e = ev(ix, k.id)
    if (!e) return null
    return { key, kind: 'event', id: k.id, year: e.year, place: e.settlement, label: eventLabel(ix, k.id) }
  }
  if (k.kind === 'war') {
    const W = ix.h.wars
    if (!W || k.id >= W.count) return null
    const d = ix.warDecl[k.id]
    const place = d >= 0 ? ev(ix, d).other : -1
    const end = W.endYear[k.id]
    return { key, kind: 'war', id: k.id, year: W.startYear[k.id], place, label: `War of ${polName(ix, W.attacker[k.id])} on ${polName(ix, W.defender[k.id])} (${W.startYear[k.id]}${end >= 0 ? '–' + end : ''})` }
  }
  return null
}

/** The event an entity stands for (a polity its end, or its founding while it stands; a town its abandonment or founding; a ruler its reign's end or accession); events and wars are themselves. */
export function resolveRoot(ix: CauseIndex, key: string): string {
  const k = parseKey(key)
  if (!k || k.kind === 'event' || k.kind === 'war' || k.kind === 'cond') return key
  const c = baseRules(ix, key, k.kind, k.id)
  return c.length ? c[0].key : key
}

// ---------------------------------------------------------------------------------------------------------------------------
// Causes of one node (cached per index)

const causeCache = new WeakMap<CauseIndex, Map<string, Cand[]>>()

/** All candidate causes of `key`, best first, deduplicated; causes later than the node are dropped (time order). */
export function causesOf(ix: CauseIndex, key: string): Cand[] {
  let m = causeCache.get(ix)
  if (!m) causeCache.set(ix, (m = new Map()))
  const hit = m.get(key)
  if (hit) return hit
  const k = parseKey(key)
  if (!k) return []
  const self = nodeOf(ix, k.kind === 'cond' ? evKey(k.id) : key) // (a condition is at its subject event)
  const best = new Map<string, Cand>()
  for (const mod of MODULES) {
    for (const c of mod(ix, key, k.kind, k.id, k.code)) {
      if (c.key === key || !(c.conf > 0)) continue
      if (!before(ix, c, key, self)) continue
      const o = best.get(c.key)
      if (!o || c.conf > o.conf) best.set(c.key, { ...c, conf: Math.min(1, c.conf) })
    }
  }
  const out = [...best.values()].sort((a, b) => rank(b) - rank(a) || (a.key < b.key ? -1 : 1))
  m.set(key, out)
  return out
}

const rank = (c: Cand) => c.conf + (c.tier === WhyTier.Recorded ? 0.001 : 0)

/** True when cause c comes no later than the node `key` (a condition of a node is at the node; same-year events in log order). */
function before(ix: CauseIndex, c: Cand, key: string, self: WhyNode | null): boolean {
  if (c.node || !self) return true
  const ck = parseKey(c.key)
  if (!ck) return false
  const cn = nodeOf(ix, c.key)
  if (!cn) return false
  if (cn.year > self.year) return false
  if (cn.year < self.year) return true
  const sk = parseKey(key)
  if (ck.kind === 'event' && sk && (sk.kind === 'event' || sk.kind === 'cond')) return ck.id < sk.id
  return true
}

// ---------------------------------------------------------------------------------------------------------------------------
// Trees

const treeCache = new WeakMap<History, Map<string, WhyTree>>()
let cacheCap = WHY_LIMITS.cacheDesktop

/** Phones keep fewer trees (§4.6). */
export function setWhyCacheCap(n: number): void {
  cacheCap = Math.max(4, n)
}

export function explain(h: History, rootKey: string, opts: ExplainOpts = {}): WhyTree {
  const ix = causeIndexOf(h)
  const root = resolveRoot(ix, rootKey)
  const depth = Math.max(1, Math.min(WHY_LIMITS.maxDepth, opts.depth ?? WHY_LIMITS.depth))
  const K = opts.k ?? WHY_LIMITS.k
  const minChain = opts.minChain ?? WHY_LIMITS.minChain
  const nEff = opts.effects ?? WHY_LIMITS.effects
  const ck = `${root}|${depth}|${K}|${minChain}|${nEff}`
  let lru = treeCache.get(h)
  if (!lru) treeCache.set(h, (lru = new Map()))
  const hit = lru.get(ck)
  if (hit) { lru.delete(ck); lru.set(ck, hit); return hit }
  const t = build(ix, root, depth, K, minChain, nEff)
  lru.set(ck, t)
  while (lru.size > cacheCap) lru.delete(lru.keys().next().value as string)
  return t
}

function build(ix: CauseIndex, root: string, depth: number, K: number, minChain: number, nEff: number): WhyTree {
  const nodes = new Map<string, WhyNode>()
  const links: WhyLink[] = []
  const lesser = new Map<string, number>()
  const rn = nodeOf(ix, root)
  if (rn) nodes.set(root, rn)
  let truncated = false
  const queue: { key: string; d: number; chain: number }[] = rn ? [{ key: root, d: 0, chain: 1 }] : []
  const expanded = new Set<string>()
  for (let q = 0; q < queue.length; q++) {
    const { key, d, chain } = queue[q]
    if (expanded.has(key)) continue
    expanded.add(key)
    const cs = causesOf(ix, key).filter((c) => (c.tier === WhyTier.Condition ? c.conf >= WHY_LIMITS.minWeight : c.conf * chain >= minChain))
    if (cs.length === 0) continue
    if (d >= depth) { truncated = true; continue }
    const kept = cs.slice(0, K)
    if (cs.length > K) lesser.set(key, cs.length - K)
    for (const c of kept) {
      const n = nodes.get(c.key) ?? nodeOf(ix, c.key, c)
      if (!n) continue
      nodes.set(c.key, n)
      const ch = c.tier === WhyTier.Condition ? chain : chain * c.conf
      links.push({ cause: c.key, effect: key, tier: c.tier, conf: c.conf, via: c.via, value: c.value, chain: ch })
      if (!expanded.has(c.key)) queue.push({ key: c.key, d: c.via === 'R3' ? d : d + 1, chain: ch }) // (a war and its declaration are one step)
    }
  }
  const effects = nEff > 0 && rn ? effectsOf(ix, rn, nEff) : []
  for (const l of effects) { const n = nodeOf(ix, l.effect); if (n && !nodes.has(l.effect)) nodes.set(l.effect, n) }
  return { root, nodes, links, depth, truncated, effects, lesser }
}

/** "What came of it?": later events (at the place, of the war, of the polity, within 30 years) whose causes include the node. */
function effectsOf(ix: CauseIndex, n: WhyNode, max: number): WhyLink[] {
  const h = ix.h
  const cands = new Set<number>()
  const y0 = n.year, y1 = n.year + 30
  const at = (id: number) => { if (id < 0 || id >= ix.sx.bySettlement.length) return; for (const i of ix.sx.bySettlement[id]) { const y = h.events[i].year; if (y >= y0 && y <= y1) cands.add(i) } }
  at(n.place)
  if (n.kind === 'event') {
    const e = ev(ix, n.id)
    if (e.type === E.WarDeclared || e.type === E.CivilWar) for (const i of ix.warEvents[e.value] ?? []) cands.add(i)
    if (e.other >= 0 && e.type !== E.Built && e.type !== E.StructureLost) at(e.other)
  }
  if (n.kind === 'war') for (const i of ix.warEvents[n.id] ?? []) cands.add(i)
  const out: { l: WhyLink; s: number }[] = []
  let looked = 0
  for (const i of [...cands].sort((a, b) => a - b)) {
    const k = evKey(i)
    if (k === n.key || looked++ > 400) continue
    const c = causesOf(ix, k).find((c) => c.key === n.key || (n.kind === 'event' && c.key === warKey(ev(ix, n.id).value) && (ev(ix, n.id).type === E.WarDeclared)))
    if (!c) continue
    const s = (dramaRule(h.events[i].type)?.base ?? 1) * c.conf
    out.push({ l: { cause: n.key, effect: k, tier: c.tier, conf: c.conf, via: c.via, value: c.value }, s })
  }
  return out.sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.l)
}
