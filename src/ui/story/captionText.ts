// n4c: caption text helpers (DOM-free).

/** Sentences of a text ("A. B? C!" -> ["A.", "B?", "C!"]), split at a stop followed by a space and a capital or a quote. */
function sentences(t: string): string[] {
  return t.split(/(?<=[.!?…])\s+(?=[A-Z“"'‘(])/).map((x) => x.trim()).filter(Boolean)
}
const norm = (t: string) => t.toLowerCase().replace(/[“”"'‘’…]/g, '').replace(/\s+/g, ' ').replace(/[.!?:;,]+$/, '').trim()

/**
 * n4c: Read more's paragraphs without what the caption shows (`shown`: its title and body): a paragraph the caption holds
 * whole is dropped, and the caption's sentences are taken out of the rest; a paragraph left empty is dropped.
 */
export function withoutShown(paragraphs: readonly string[], shown: readonly string[]): string[] {
  const said = new Set<string>()
  const whole = shown.map(norm).filter(Boolean)
  for (const s of shown) for (const x of sentences(s)) said.add(norm(x))
  const out: string[] = []
  for (const p of paragraphs) {
    const n = norm(p)
    if (!n || whole.some((w) => w === n || w.includes(n))) continue
    const left = sentences(p).filter((x) => !said.has(norm(x)))
    const t = left.join(' ').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}
