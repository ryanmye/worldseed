// Sagas: a saga as DOM (the panel, the reading view and the library share it): the title, the epigraph, chapter
// headings, scene titles, the paragraphs (scenes and omens set apart), the closing; cross-references become links.

import type { Saga, SagaRef } from './types.ts'

/** Renders `s` into `target` (cleared first); `onRef` follows a cross-reference (none: plain text). */
export function renderSaga(target: HTMLElement, s: Saga, onRef?: (r: SagaRef) => void, titleTag: 'h2' | 'h3' = 'h3'): void {
  target.textContent = ''
  const h1 = document.createElement(titleTag)
  h1.className = 'sg-title'
  h1.textContent = s.title
  const ep = document.createElement('p')
  ep.className = 'sg-epigraph'
  ep.textContent = s.epigraph
  target.append(h1, ep)
  s.paragraphs.forEach((p, i) => {
    const hd = s.heads?.[i]
    if (hd) {
      const h = document.createElement('h4')
      h.className = 'sg-head'
      h.textContent = hd
      target.appendChild(h)
    }
    const st = s.titles?.[i]
    if (st) {
      const h = document.createElement('h5')
      h.className = 'sg-scene-title'
      h.textContent = st
      target.appendChild(h)
    }
    const el = document.createElement('p')
    const mark = s.marks?.[i]
    if (mark === 'scene') el.className = 'sg-scene'
    else if (mark === 'omen') el.className = 'sg-omen'
    fillWithRefs(el, p, onRef ? s.refs ?? [] : [], onRef)
    target.appendChild(el)
  })
  const cl = document.createElement('p')
  cl.className = 'sg-closing'
  cl.textContent = s.closing
  target.appendChild(cl)
}

/** `text` into `el`, each first occurrence of a reference's title made a link. */
function fillWithRefs(el: HTMLElement, text: string, refs: readonly SagaRef[], onRef?: (r: SagaRef) => void): void {
  const hits: { at: number; r: SagaRef }[] = []
  for (const r of refs) {
    const at = text.indexOf(r.text)
    if (at >= 0) hits.push({ at, r })
  }
  if (!hits.length || !onRef) { el.textContent = text; return }
  hits.sort((a, b) => a.at - b.at)
  let k = 0
  for (const { at, r } of hits) {
    if (at < k) continue
    el.append(text.slice(k, at))
    const a = document.createElement('a')
    a.href = '#'
    a.className = 'sg-ref'
    a.textContent = r.text
    a.title = 'Read it'
    a.addEventListener('click', (e) => { e.preventDefault(); onRef(r) })
    el.appendChild(a)
    k = at + r.text.length
  }
  el.append(text.slice(k))
}
