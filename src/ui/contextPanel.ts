// The context panel (ui-additions 2, owner-approved): of the right column's panels, one matches what is on screen and the
// rest wait in the "More" drawer (ui/onboard.ts groupRightRail). A context is a panel root that registers here with a
// priority and an `active` test; the column shows the active one of highest priority (the Factions panel, the default,
// is always active). Contexts so far: realm (Factions, 1), why (the Why panel while open, 5), battle (the story's battle,
// 6, ui/story/storyView.ts). The throne lane adds `seat` (its dashboard, 10). A context whose state changes calls
// contextChanged() (a change of the root's class or hidden attribute is noticed by itself).

export interface ContextProvider {
  id: string
  priority: number
  root: HTMLElement
  active(): boolean
}

const providers: ContextProvider[] = []
const listeners = new Set<() => void>()

export function registerContext(p: ContextProvider): void {
  const i = providers.findIndex((q) => q.id === p.id)
  if (i >= 0) providers.splice(i, 1)
  providers.push(p)
  providers.sort((a, b) => b.priority - a.priority)
  contextChanged()
}

/** The context shown now (null none registered or active). */
export function currentContext(): ContextProvider | null {
  for (const p of providers) if (p.root.isConnected && p.active()) return p
  return null
}

/** Whether `el` is a registered context's root. */
export function isContextRoot(el: Element): boolean {
  return providers.some((p) => p.root === el)
}

export function contextChanged(): void {
  for (const f of listeners) f()
}

export function onContextChange(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}
