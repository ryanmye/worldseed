// ideas: the History fields of the ideas system (all copied out of the state, each array with its own buffer).

import type { IdeaAdoptions, IdeaInfo, IdeaKind } from '../../../contract.ts'
import { IDEA_DEFS, easeOf } from './params.ts'
import type { IdeasState } from './state.ts'
import { PRE } from './state.ts'

export interface IdeasHistory {
  ideas: IdeaInfo[]
  ideaAdoptions: IdeaAdoptions
}

function adoptions(ix: IdeasState | null): IdeaAdoptions {
  const n = ix ? ix.aIdea.length : 0
  return {
    count: n,
    idea: Uint8Array.from(ix ? ix.aIdea : []),
    people: Int16Array.from(ix ? ix.aPeople : []),
    year: Int16Array.from(ix ? ix.aYear : []),
    how: Uint8Array.from(ix ? ix.aHow : []),
    from: Int16Array.from(ix ? ix.aFrom : []),
    via: Int32Array.from(ix ? ix.aVia : []),
    source: Int32Array.from(ix ? ix.aSource : []),
  }
}

export function emptyIdeasHistory(): IdeasHistory {
  return { ideas: [], ideaAdoptions: adoptions(null) }
}

/** Everything up to the year just simulated. */
export function assembleIdeas(ix: IdeasState): IdeasHistory {
  const ideas: IdeaInfo[] = IDEA_DEFS.map((d, i) => ({
    id: i, key: d.key, name: d.name, kind: d.kind as IdeaKind, prerequisites: PRE[i].slice(), technique: d.technique, ease: easeOf(d), effect: d.effect,
    firstYear: ix.firstYear[i], firstPeople: ix.firstPeople[i], firstSettlement: ix.firstAt[i], origins: ix.origins[i],
  }))
  return { ideas, ideaAdoptions: adoptions(ix) }
}
