// Sagas: what a generator returns.

/** A town's, a people's, a state's or a house's saga, the world's chronicle, or the chronicle of a decade or a year (id: its first year). */
export type SagaKind = 'world' | 'people' | 'state' | 'city' | 'house' | 'decade' | 'year'

/** What a paragraph is: plain narrative (null), a scene (a set piece on one recorded event), or an omen (an order told as a sign). */
export type SagaMark = 'scene' | 'omen' | null

/** A cross-reference: `text` (a saga's title as it appears in a paragraph) names the saga of `subject`. */
export interface SagaRef {
  text: string
  subject: { kind: SagaKind; id: number }
}

export interface Saga {
  kind: SagaKind
  /** Subject id (people, polity, settlement or dynasty id; 0 for the world; the first year for a decade or a year). */
  id: number
  title: string
  /** An epigraph-style first line. */
  epigraph: string
  paragraphs: string[]
  /** Optional chapter heading over each paragraph, null for none. */
  heads?: (string | null)[]
  /** Optional title of each paragraph's scene, null for none. */
  titles?: (string | null)[]
  /** Optional kind of each paragraph (scene, omen), null for plain narrative. */
  marks?: SagaMark[]
  /** Cross-references to other sagas named in the text. */
  refs?: SagaRef[]
  /** A closing line. */
  closing: string
  /** The year it is told at (nothing later is said). */
  year: number
  legend: boolean
}

/**
 * Collects a saga's paragraphs: chapter() sets the heading of the next paragraph added (a chapter with nothing in it
 * leaves no heading), add() appends narrative, scene() a titled set piece, omen() a portent. Empty text is skipped.
 */
export class Book {
  readonly paragraphs: string[] = []
  readonly heads: (string | null)[] = []
  readonly titles: (string | null)[] = []
  readonly marks: SagaMark[] = []
  readonly refs: SagaRef[] = []
  private pending: string | null = null

  chapter(head: string | null): void {
    this.pending = head
  }
  add(text: string, mark: SagaMark = null): void {
    if (!text.trim()) return
    this.paragraphs.push(text)
    this.heads.push(this.pending)
    this.pending = null
    this.marks.push(mark)
    this.titles.push(null)
  }
  /** A scene: a set piece under its own title (beside the chapter's heading, when it opens a chapter). */
  scene(title: string, text: string): void {
    if (!text.trim()) return
    this.add(text, 'scene')
    this.titles[this.titles.length - 1] = title
  }
  omen(text: string): void {
    this.add(text, 'omen')
  }
  /** The parts of a Saga this book fills. */
  parts(): Pick<Saga, 'paragraphs' | 'heads' | 'titles' | 'marks' | 'refs'> {
    return { paragraphs: this.paragraphs, heads: this.heads, titles: this.titles, marks: this.marks, refs: this.refs }
  }
}
