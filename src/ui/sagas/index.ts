// Sagas: prose histories generated from the recorded History, deterministic for a seed. One entry point
// (generateSaga) for every form, a cache per history (subject, register, year told), the subject lists the panel's
// picker offers, and the Markdown a saga downloads as.

import type { History, World } from '../../contract.ts'
import { Ctx } from './facts.ts'
import { citySaga } from './city.ts'
import { peopleSaga } from './people.ts'
import { stateSaga } from './state.ts'
import { worldName, worldSaga } from './world.ts'
import { houseSaga } from './house.ts'
import { yearSaga } from './year.ts'
import type { Saga, SagaKind } from './types.ts'
import { polish } from './voice.ts'

export type { Saga, SagaKind, SagaMark, SagaRef } from './types.ts'

export interface SagaSubject {
  kind: SagaKind
  id: number
}

const cache = new WeakMap<History, Map<string, Saga>>()

/** The saga of `subject` told at `year` in the chronicle or legend register (cached per history). */
export function generateSaga(h: History, world: World | null, subject: SagaSubject, legend: boolean, year: number): Saga {
  const Y = Math.max(0, Math.min(h.years, Math.floor(year)))
  let m = cache.get(h)
  if (!m) cache.set(h, (m = new Map()))
  const key = `${subject.kind}:${subject.id}:${legend ? 1 : 0}:${Y}`
  const hit = m.get(key)
  if (hit) return hit
  const c = new Ctx(h, world, Y)
  let s: Saga
  switch (subject.kind) {
    case 'people': s = peopleSaga(c, subject.id, legend); break
    case 'state': s = stateSaga(c, subject.id, legend); break
    case 'city': s = citySaga(c, subject.id, legend); break
    case 'house': s = houseSaga(c, subject.id, legend); break
    case 'decade': s = yearSaga(c, subject.id, 10, legend, worldName(c)); break
    case 'year': s = yearSaga(c, subject.id, 1, legend, worldName(c)); break
    default: s = worldSaga(c, legend)
  }
  const keep = s.paragraphs.map((x) => x.trim().length > 0)
  const by = <T>(xs: T[] | undefined) => xs?.filter((_, i) => keep[i])
  s.heads = by(s.heads)
  s.titles = by(s.titles)
  s.marks = by(s.marks)
  s.paragraphs = s.paragraphs.filter((_, i) => keep[i]).map(polish)
  s.titles = s.titles?.map((t) => (t ? polish(t).replace(/\.$/, '') : t))
  // (chapters only in a long saga: a short one reads as one piece)
  if (s.heads && s.kind !== 'world' && s.paragraphs.filter((_, i) => !s.marks?.[i]).length < 6) s.heads = s.heads.map(() => null)
  s.epigraph = polish(s.epigraph)
  s.closing = polish(s.closing)
  if (m.size > 160) m.clear()
  m.set(key, s)
  return s
}

/** Whether `subject` can be told at `year` (it exists by then). */
export function sagaSubjectValid(h: History, subject: SagaSubject, year: number): boolean {
  switch (subject.kind) {
    case 'world': return true
    case 'people': return subject.id >= 0 && subject.id < h.peoples.length
    case 'state': return subject.id >= 0 && subject.id < (h.polities?.length ?? 0) && h.polities[subject.id].foundedYear <= year
    case 'city': return subject.id >= 0 && subject.id < h.settlements.length && h.settlements[subject.id].foundedYear <= year
    case 'house': return subject.id >= 0 && subject.id < (h.dynasties?.length ?? 0) && h.dynasties[subject.id].founded <= year
    case 'decade': case 'year': return subject.id >= 0 && subject.id <= year
  }
  return false
}

/** "people:3" and back (the saga= URL parameter). */
export function subjectKey(s: SagaSubject): string {
  return s.kind === 'world' ? 'world' : `${s.kind}:${s.id}`
}
export function parseSubject(v: string | null): SagaSubject | null {
  if (!v) return null
  if (v === 'world') return { kind: 'world', id: 0 }
  const m = /^(people|state|city|house|decade|year):(\d+)$/.exec(v)
  return m ? { kind: m[1] as SagaKind, id: Number(m[2]) } : null
}

/** The decade that holds `year` ("the decade from 1300"). */
export const decadeOf = (year: number): SagaSubject => ({ kind: 'decade', id: Math.max(0, Math.floor(year / 10) * 10) })

/** The saga as Markdown (chapters as second-level headings, scenes as third-level, omens in italics). */
export function sagaMarkdown(s: Saga): string {
  const body = s.paragraphs.map((p, i) => {
    const out: string[] = []
    if (s.heads?.[i]) out.push(`## ${s.heads[i]}`)
    if (s.titles?.[i]) out.push(`### ${s.titles[i]}`)
    out.push(s.marks?.[i] === 'omen' ? `*${p}*` : p)
    return out.join('\n\n')
  }).join('\n\n')
  return `# ${s.title}\n\n*${s.epigraph}*\n\n${body}\n\n*${s.closing}*\n`
}

/** The saga as plain text (Copy). */
export function sagaText(s: Saga): string {
  const body = s.paragraphs.map((p, i) => [s.heads?.[i], s.titles?.[i], p].filter(Boolean).join('\n\n')).join('\n\n')
  return `${s.title}\n\n${s.epigraph}\n\n${body}\n\n${s.closing}\n`
}
