// Categories of chronicle entries for the chronicle's filter (chronicle.ts).

import type { History, HistoryEvent } from '../contract.ts'
import { EntryKind } from './historyIndex.ts'
import { isWallEvent } from './polityFormat.ts'
import { isFaithEvent, isRulersEvent } from './rulersData.ts'

/** Filter labels; index 0 shows everything, the others one category each. */
export const CHRONICLE_FILTERS: readonly string[] = ['All', 'Politics and war', 'Settlement', 'Trade and exploration', 'Nature and crops', 'Sickness', 'Travel']
const POLITICS = 1, SETTLEMENT = 2, TRADE = 3, NATURE = 4, SICKNESS = 5, TRAVEL = 6
// rulers, religion: two more categories (pushed on their own line, found by name, so other additions merge beside them)
;(CHRONICLE_FILTERS as string[]).push('Rulers', 'Faiths')
const RULERS = CHRONICLE_FILTERS.indexOf('Rulers'), FAITHS = CHRONICLE_FILTERS.indexOf('Faiths')
/** Whether filter i is offered only when the history has entries of its kind (Rulers, Faiths: a history without them shows the filter as before). */
export const isOptionalFilter = (i: number) => i === RULERS || i === FAITHS

/** Category (1..4) of a chronicle entry of kind `kind` whose first member is `first` (null for non-event members). */
export function entryCategory(h: History, kind: number, first: HistoryEvent | null): number {
  // rulers (80-88 and their groups) and faiths (89-97 and theirs)
  if (kind === EntryKind.Rulers || (kind === EntryKind.Single && first && isRulersEvent(first.type as number))) return RULERS
  if (kind === EntryKind.Faiths || (kind === EntryKind.Single && first && isFaithEvent(first.type as number))) return FAITHS
  switch (kind) {
    case EntryKind.PolityGains:
    case EntryKind.Raids:
    case EntryKind.SmallRaids:
    case EntryKind.Revolts:
    case EntryKind.Bonds:
    case EntryKind.Alliances:
    case EntryKind.Blockades:
    case EntryKind.Forts:
      return POLITICS
    case EntryKind.FamineBurst:
      return NATURE
    case EntryKind.Disease:
      return SICKNESS
    case EntryKind.Tourism:
      return TRAVEL
    case EntryKind.Foundings:
    case EntryKind.Migrations:
      return SETTLEMENT
    case EntryKind.TradeOpenings:
    case EntryKind.TradeClosings:
    case EntryKind.Named:
    case EntryKind.Landfalls:
    case EntryKind.Goods:
      return TRADE
  }
  if (!first) return TRADE
  const t = first.type as number
  // 20-43: polities, the second version's smuggling and piracy included (they are the outlaw side of trade policy and war)
  if (t >= 20 && t <= 43) return POLITICS
  if ((t === 4 || t === 7) && isWallEvent(h, first)) return POLITICS
  if ((t === 4 || t === 7) && h.structures?.[first.other]?.type === 3) return POLITICS // forts
  if ((t === 4 || t === 7) && (h.structures?.[first.other]?.type === 4 || h.structures?.[first.other]?.type === 5)) return TRADE // mines and merchants' quarters
  // disease (66-72) and the sickness a first contact brings (19)
  if (t === 19 || (t >= 66 && t <= 72)) return SICKNESS
  // tourism (100-105): leisure travel, resorts and their fashion, sights
  if (t >= 100 && t <= 105) return TRAVEL
  if (t === 2 || (t >= 17 && t <= 19) || (t >= 44 && t <= 49)) return NATURE
  if (t === 8 || t === 9 || (t >= 10 && t <= 15)) return TRADE
  // goods (50-65): deposits, crafts, secrets, lanes and posts are trade and exploration
  if (t >= 50 && t <= 65) return TRADE
  return SETTLEMENT
}
