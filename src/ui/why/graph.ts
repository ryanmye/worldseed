// Why (causal explorer, causal-explorer.md §4): the causal graph's nodes and links. DOM-free. A node is an event of
// History.events, an entity (polity, settlement, ruler, war) that expands to its events, or a contributing condition (a
// synthetic leaf: a share of a recorded drive or accumulator, or a background state). Keys are "kind:id" strings, stable
// for a History and URL-safe ("event:1234", "war:7", "cond:rivalry.Claim:812").

/** What a node of the causal graph is. */
export type WhyNodeKind = 'event' | 'polity' | 'settlement' | 'ruler' | 'war' | 'cond'

export interface WhyNode {
  key: string
  kind: WhyNodeKind
  /** Event index, entity id, or (cond) the subject event index. */
  id: number
  year: number
  /** Settlement where it happened, or -1. */
  place: number
  /** Short label for the tree ("Fall of Oruma", "rivalry: contested farmland"). */
  label: string
}

/** How sure a link is: recorded (an id stored in a field), rule-derived (a structural pattern), or a contributing condition (a weight). */
export const WhyTier = { Recorded: 0, Rule: 1, Condition: 2 } as const
export type WhyTier = (typeof WhyTier)[keyof typeof WhyTier]

export interface WhyLink {
  cause: string
  effect: string
  tier: WhyTier
  /** Recorded 1; Rule: the rule's measured precision (its prior where unmeasured); Condition: its weight 0..1. */
  conf: number
  /** Rule or record that made it ("R1", "rec:Conquered.value", "cond:rivalry.Claim"): shown in the record view, used by tests. */
  via: string
  /** For a Condition: the value shown ("rivalry 1.4", "harvest 0.45 of normal"). */
  value?: string
  /** Product of the confidences of Recorded and Rule links from the root down to this one. */
  chain?: number
}

/** An explanation of one node: its causes to `depth`, as a tree (a DAG cut into a tree: a node reached twice is kept once, with both links). */
export interface WhyTree {
  root: string
  nodes: Map<string, WhyNode>
  /** Links, parents before children (breadth first). */
  links: WhyLink[]
  depth: number
  /** True when the record goes further back than shown (the depth limit cut it). */
  truncated: boolean
  /** "What came of it?": the root's effects, one level. */
  effects: WhyLink[]
  /** Causes left out per node (beyond the top k): "and N lesser". */
  lesser: Map<string, number>
}

export const evKey = (i: number) => `event:${i}`
export const warKey = (w: number) => `war:${w}`
export const condKey = (code: string, subject: number) => `cond:${code}:${subject}`

/** Parses "kind:id" (a cond key: its subject event in `id`, its code in `code`). */
export function parseKey(key: string): { kind: WhyNodeKind; id: number; code?: string } | null {
  const a = key.split(':')
  const kind = a[0] as WhyNodeKind
  if (kind === 'cond') {
    if (a.length < 3) return null
    const id = Number(a[a.length - 1])
    return Number.isInteger(id) ? { kind, id, code: a.slice(1, -1).join(':') } : null
  }
  if (a.length !== 2 || !['event', 'polity', 'settlement', 'ruler', 'war'].includes(kind)) return null
  const id = Number(a[1])
  return Number.isInteger(id) && id >= 0 ? { kind, id } : null
}

/** Children (causes) of each node of a tree, in link order. */
export function causesIn(t: WhyTree): Map<string, WhyLink[]> {
  const m = new Map<string, WhyLink[]>()
  for (const l of t.links) {
    let a = m.get(l.effect)
    if (!a) m.set(l.effect, (a = []))
    a.push(l)
  }
  return m
}
