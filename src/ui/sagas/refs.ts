// Sagas: cross-references between sagas ("as is told in the Legend of Rilko"). A saga refers to another only when that
// other has a story worth the reference (a town that grew or suffered, a state that lasted or ruled many, a house with
// several reigns), at most a few times, each subject once; the reference is the other saga's own title, recorded in the
// saga's refs so the library can make it a link.

import { CITY_POPULATION, EventType, TOWN_POPULATION } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import type { Book, SagaKind } from './types.ts'

export interface Subject { kind: SagaKind; id: number }

/** The title another saga is known by (as its generator titles it, without the legend's epithets). */
export function refTitle(c: Ctx, s: Subject, legend: boolean): string {
  switch (s.kind) {
    case 'city': return `the Legend of ${c.name(s.id, c.Y)}`
    case 'state': return legend ? `the Saga of the ${c.pgreatTitle(s.id)}` : `the History of the ${c.pgreatTitle(s.id)}`
    case 'people': return `the Saga of the ${c.peopleName(s.id)}`
    case 'house': return legend ? `the Saga of the House of ${c.h.dynasties[s.id]?.name ?? ''}` : `the Chronicle of the House of ${c.h.dynasties[s.id]?.name ?? ''}`
    case 'world': return 'the Chronicle of the World'
  }
  return ''
}

/** Whether `s` has a saga worth sending a reader to. */
export function worthTelling(c: Ctx, s: Subject): boolean {
  const h = c.h
  switch (s.kind) {
    case 'city': {
      if (s.id < 0 || s.id >= c.N || h.settlements[s.id].foundedYear > c.Y) return false
      if (c.peak(s.id).pop >= TOWN_POPULATION * 2) return true
      return c.at(s.id, [EventType.Sacked]).length > 0 && c.peak(s.id).pop >= TOWN_POPULATION
    }
    case 'state': {
      const x = c.pd?.list[s.id]
      if (!x || x.foundedYear > c.Y) return false
      const end = x.endedYear >= 0 && x.endedYear <= c.Y ? x.endedYear : c.Y
      return end - x.foundedYear >= 80 || c.ppeak(s.id).pop >= CITY_POPULATION * 2
    }
    case 'house': {
      const rd = c.rd
      if (!rd || !h.dynasties[s.id] || h.dynasties[s.id].founded > c.Y) return false
      return (rd.houseReigns[s.id] ?? []).filter((r) => rd.rulers[r].acceded <= c.Y).length >= 4
    }
    case 'people': return s.id >= 0 && s.id < h.peoples.length
  }
  return false
}

/** Cross-references for one saga: self is never referred to, each subject once, at most `max` in all. */
export class Refs {
  private used = new Set<string>()
  private c: Ctx
  private book: Book
  private legend: boolean
  private max: number
  constructor(c: Ctx, book: Book, self: Subject, legend: boolean, max = 3) {
    this.c = c
    this.book = book
    this.legend = legend
    this.max = max
    this.used.add(`${self.kind}:${self.id}`)
  }
  /**
   * `sentence` with a reference to `s` worked in before its last stop (", as is told in the Legend of Rilko."),
   * when `s` is worth it and the budget allows; else `sentence` unchanged.
   */
  cite(sentence: string, s: Subject): string {
    const k = `${s.kind}:${s.id}`
    if (this.used.has(k) || this.book.refs.length >= this.max || !worthTelling(this.c, s)) return sentence
    const title = refTitle(this.c, s, this.legend)
    if (!title || !/[.!?]$/.test(sentence.trim())) return sentence
    this.used.add(k)
    this.book.refs.push({ text: title, subject: { kind: s.kind, id: s.id } })
    const n = this.book.refs.length
    const how = this.legend
      ? [', as is sung in {t}', ', as {t} tells', ', and of this {t} sings'][n % 3]
      : [', as is told in {t}', ' (of which more is told in {t})', ', as {t} relates'][n % 3]
    return sentence.trim().replace(/[.!?]$/, (m) => how.replace('{t}', title) + m)
  }
}
