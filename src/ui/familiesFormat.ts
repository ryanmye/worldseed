// families: chronicle and inspector lines for the merchant-family events (161-169), from ui/familiesData.ts. Plain, as the goods
// lines are. Every function tolerates a history without families (null: the caller falls back).

import { EventType, FamilyCause, FamilyEnd, FamilyMoveCause, FamilyRuin, FamilySeatClose, HeadHow, type History, type HistoryEvent } from '../contract.ts'
import { settlementName } from './format.ts'
import { FamilyTitle, familiesOf, familyTitle, headFullName, type FamilyData } from './familiesData.ts'

export const isFamilyEvent = (t: number): boolean => t >= EventType.FamilyFounded && t <= EventType.FamilyFell

/** Event types whose `other` is a settlement id (all of them, when not -1). */
export const familyOtherIsSettlement = (t: number): boolean => isFamilyEvent(t) && t !== EventType.FamilyHead && t !== EventType.FamilyPatron

/** Marriages into ruling houses and backed civil wars go with politics; the rest with trade. */
export const familyIsPolitics = (t: number): boolean => t === EventType.FamilyMarriage || t === EventType.FamilyBacked

/** Headlines: a house founded on a venture, a bankruptcy, a marriage into a ruling house. */
export function isFamilyHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === EventType.FamilyFounded) return e.extra === FamilyCause.Venture
  if (t === EventType.FamilyMarriage) return true
  if (t === EventType.FamilyFell) return (((e.extra ?? 0) / 16) | 0) === FamilyEnd.Bankrupt
  void h
  return false
}

const nm = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? settlementName(h, id) : 'a far place')

function headLine(fd: FamilyData, k: number): string {
  const F = fd.history.families
  const who = headFullName(fd, k)
  const fem = F.headFemale[k] === 1
  switch (F.how[k]) {
    case HeadHow.Son: return `${who} succeeds ${fem ? 'her' : 'his'} father at the head of ${familyTitle(fd, F.headFamily[k])}`
    case HeadHow.Brother: return `${who} succeeds ${fem ? 'her' : 'his'} brother at the head of ${familyTitle(fd, F.headFamily[k])}`
    case HeadHow.Nephew: return `${who} succeeds ${fem ? 'her' : 'his'} uncle at the head of ${familyTitle(fd, F.headFamily[k])}`
    case HeadHow.Widow: return `${who} takes up the keys of ${familyTitle(fd, F.headFamily[k])} at her husband's death`
    case HeadHow.SonInLaw: return `${who}, who married the last head's daughter, takes over ${familyTitle(fd, F.headFamily[k])}`
    default: return `${who} heads ${familyTitle(fd, F.headFamily[k])}`
  }
}

function fellLine(fd: FamilyData, e: HistoryEvent): string {
  const h = fd.history
  const F = h.families
  const f = e.value
  const T = FamilyTitle(fd, f)
  const end = ((e.extra ?? 0) / 16) | 0, ruin = (e.extra ?? 0) % 16
  if (end === FamilyEnd.Bankrupt) {
    switch (ruin) {
      case FamilyRuin.Fleet: return `${T} is ruined when its fleet is lost at sea`
      case FamilyRuin.Venture: return `${T} is ruined by a venture that came to nothing`
      case FamilyRuin.Default: return e.other >= 0 ? `${T} is ruined when the crown at ${nm(h, e.other)} will not repay` : `${T} is ruined when a crown will not repay`
      case FamilyRuin.War: return e.other >= 0 ? `${T} is ruined by war: its houses are sacked by the men of ${nm(h, e.other)}` : `${T} is ruined by war`
      case FamilyRuin.Plague: return `${T} is ruined as plague empties ${nm(h, e.settlement)}`
      default: return `${T} goes bankrupt`
    }
  }
  if (end === FamilyEnd.Faded) return `${T} drops from the ranks of the great merchants of ${nm(h, e.settlement)}`
  if (end === FamilyEnd.NoHeir) {
    const hs = fd.headsOf[f]
    const last = hs.length ? hs[hs.length - 1] : -1
    return last >= 0 ? `${T} dies out: ${headFullName(fd, last)} leaves no heir` : `${T} dies out`
  }
  if (end === FamilyEnd.TownLost) return `${T} ends with its town, ${nm(h, e.settlement)}`
  void F
  return `${T} comes to an end`
}

/** Chronicle line for a family event, or null. */
export function describeFamilyEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isFamilyEvent(t)) return null
  const fd = familiesOf(h)
  if (!fd || e.value < 0 || e.value >= h.families.count) return null
  const F = h.families
  const f = e.value
  const T = FamilyTitle(fd, f)
  switch (t) {
    case EventType.FamilyFounded:
      if (e.extra === FamilyCause.Venture) return `${T} is founded at ${nm(h, e.settlement)} on the profits of the lane to ${nm(h, e.other)}`
      if (e.extra === FamilyCause.Split) return `${T} part from House ${F.name[f]} of ${nm(h, e.other)} and keep their own counting-house at ${nm(h, e.settlement)}`
      return `${T} is founded at ${nm(h, e.settlement)}`
    case EventType.FamilyBranch: return `${T} opens a factor's house at ${nm(h, e.settlement)}`
    case EventType.BranchClosed:
      switch (e.extra) {
        case FamilySeatClose.Seized: return `The ${F.name[f]} factor at ${nm(h, e.settlement)} is seized`
        case FamilySeatClose.Expelled: return `The ${F.name[f]} factor is expelled from ${nm(h, e.settlement)}`
        case FamilySeatClose.Sacked: return `The ${F.name[f]} factor at ${nm(h, e.settlement)} is lost in the sack`
        case FamilySeatClose.TownLost: return `The ${F.name[f]} factor at ${nm(h, e.settlement)} is lost with the town`
        default: return `${T} closes its factor's house at ${nm(h, e.settlement)}`
      }
    case EventType.FamilyHead: return e.extra !== undefined && e.extra >= 0 && e.extra < F.headCount ? headLine(fd, e.extra) : null
    case EventType.FamilyMoved:
      if (e.extra === FamilyMoveCause.Bypassed) return `${T} leaves ${nm(h, e.other)} for ${nm(h, e.settlement)} as the lane passes ${nm(h, e.other)} by`
      if (e.extra === FamilyMoveCause.TownLost) return `${T} moves its home from ${nm(h, e.other)} to ${nm(h, e.settlement)}`
      return `${T} moves its home to ${nm(h, e.settlement)}`
    case EventType.FamilyMarriage: {
      const m = e.extra ?? -1
      const dyn = m >= 0 && m < F.marriageCount ? h.dynasties[F.marriageDynasty[m]] : undefined
      const house = dyn ? `House ${dyn.name}` : 'the ruling house'
      const daughter = m >= 0 && F.marriageDaughter[m] === 1
      return daughter ? `A daughter of ${familyTitle(fd, f)} marries into ${house}, which rules from ${nm(h, e.other)}` : `A son of ${familyTitle(fd, f)} weds a woman of ${house}, which rules from ${nm(h, e.other)}`
    }
    case EventType.FamilyBacked: {
      let side = -1
      for (const r of fd.backsOf[f]) if (F.backWar[r] === e.extra) side = F.backSide[r]
      return side === 1 ? `${T} backs the pretender at ${nm(h, e.other)}` : `${T} backs the crown against the pretender at ${nm(h, e.other)}`
    }
    case EventType.FamilyPatron: {
      const l = e.extra ?? -1
      const name = l >= 0 && h.landmarks && l < h.landmarks.count ? h.landmarks.name[l] : 'a great work'
      return `${T} pays for ${name}`
    }
    case EventType.FamilyFell: return fellLine(fd, e)
  }
  return null
}

/** Inspector line for a family event at settlement id, or null. */
export function describeFamilyEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isFamilyEvent(t)) return null
  const fd = familiesOf(h)
  if (!fd || e.value < 0 || e.value >= h.families.count) return null
  const F = h.families
  const f = e.value
  const T = FamilyTitle(fd, f)
  const here = e.settlement === id
  switch (t) {
    case EventType.FamilyFounded:
      if (!here) return `${T} parts from House ${F.name[f]} to trade from ${nm(h, e.settlement)}`
      if (e.extra === FamilyCause.Venture) return `${T} is founded here on the profits of the lane to ${nm(h, e.other)}`
      if (e.extra === FamilyCause.Split) return `${T}, a cadet line of House ${F.name[f]} of ${nm(h, e.other)}, makes its home here`
      return `${T} is founded here`
    case EventType.FamilyBranch: return here ? `${T} of ${nm(h, e.other)} opens a factor's house here` : `${T} opens a factor's house at ${nm(h, e.settlement)}`
    case EventType.FamilyMoved:
      if (here) return `${T} moves its home here from ${nm(h, e.other)}`
      return `${T} leaves for ${nm(h, e.settlement)}`
    default: return describeFamilyEvent(h, e)
  }
}
