// Sagas: what a generator returns.

export type SagaKind = 'world' | 'people' | 'state' | 'city' | 'house'

export interface Saga {
  kind: SagaKind
  /** Subject id (people, polity, settlement or dynasty id; 0 for the world). */
  id: number
  title: string
  /** An epigraph-style first line. */
  epigraph: string
  paragraphs: string[]
  /** Optional heading of each paragraph (the world chronicle's eras), null for none. */
  heads?: (string | null)[]
  /** A closing line. */
  closing: string
  /** The year it is told at (nothing later is said). */
  year: number
  legend: boolean
}
