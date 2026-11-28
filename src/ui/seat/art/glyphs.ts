// seat: one small glyph per kind of option (decision cards), drawn here from lines and circles on a 24-unit grid (original
// art: no copied icons or emblems). Strokes use currentColor, so the glyph follows the theme and the card's state.
import { SeatOptionKey as K } from '../../../contract.ts'

type Glyph = string // inner SVG markup on a 0..24 box

const sword: Glyph = '<path d="M18 3l3 0 0 3-10 10-3-3z"/><path d="M6 14l4 4M4 20l3-3M7 12l5 5"/>'
const crossed: Glyph = '<path d="M4 4l11 11M20 4L9 15"/><path d="M13 17l4 4M11 17l-4 4M17 13l3 3M7 13l-3 3"/>'
const branch: Glyph = '<path d="M5 20C9 14 13 9 20 4"/><path d="M9 15c-3 0-4-2-4-3 2 0 4 1 4 3zM12 11c0-3 2-4 3-4 0 2-1 4-3 4zM14 9c3 0 4 2 4 3-2 0-4-1-4-3z"/>'
const coins: Glyph = '<ellipse cx="12" cy="7" rx="6" ry="2.5"/><path d="M6 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M6 11v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4"/>'
const rings: Glyph = '<circle cx="9" cy="13" r="5"/><circle cx="15" cy="11" r="5"/>'
const linked: Glyph = '<path d="M10 14l4-4"/><path d="M8 12l-2 2a3 3 0 0 0 4 4l2-2M16 12l2-2a3 3 0 0 0-4-4l-2 2"/>'
const crown: Glyph = '<path d="M4 18h16M4 18L3 8l5 4 4-6 4 6 5-4-1 10"/><circle cx="12" cy="6" r="1"/>'
const scales: Glyph = '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-3 6h6zM19 7l-3 6h6z"/>'
const broken: Glyph = '<path d="M9 7l-3 3a3 3 0 0 0 4 4M15 17l3-3a3 3 0 0 0-4-4"/><path d="M11 4l1 3M4 11l3 1M13 20l-1-3M20 13l-3-1"/>'
const dagger: Glyph = '<path d="M12 2l2 4v8h-4V6z"/><path d="M7 14h10M12 14v4"/><circle cx="12" cy="20" r="1.5"/>'
const shield: Glyph = '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M12 7v10M8 11h8"/>'
const anchor: Glyph = '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M5 15c1 3 4 5 7 5s6-2 7-5"/><path d="M4 4l16 16"/>'
const road: Glyph = '<path d="M4 20c3-5 4-9 8-11s6-3 8-5"/><path d="M15 4h5v5"/><circle cx="6" cy="17" r="1"/>'
const sail: Glyph = '<path d="M4 18h16l-2 3H6z"/><path d="M12 3v15M12 4l6 11h-6M12 6L7 15h5"/>'
const flame: Glyph = '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 3 4 3 6 1-1 2-2 2-4 2 2 3 5 3 8 0 3-2 6-6 6z"/>'
const stone: Glyph = '<path d="M4 19l2-9 5-4 6 2 3 6-2 5z"/><path d="M9 12l4 1 2 4"/>'
const scroll: Glyph = '<path d="M7 4h10a2 2 0 0 1 0 4H7zM7 4a2 2 0 0 0 0 4v10a2 2 0 0 0 2 2h9V8"/><path d="M10 12h6M10 15h5"/>'
const torn: Glyph = '<path d="M6 4h12v6l-3 2 2 3-3 2v3H6z"/><path d="M9 8h5M9 11h3"/>'
const sprout: Glyph = '<path d="M12 21v-9"/><path d="M12 13c-5 0-7-3-7-6 4 0 7 2 7 6zM12 11c0-4 3-7 7-7 0 4-2 7-7 7z"/><path d="M7 21h10"/>'
const hourglass: Glyph = '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>'
const seal: Glyph = '<circle cx="12" cy="10" r="6"/><path d="M9 15l-2 6 5-2 5 2-2-6"/><path d="M10 10l1.5 1.5L14 9"/>'
const star: Glyph = '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'
const tower: Glyph = '<path d="M6 21V9h12v12M6 9V5h2v2h2V5h4v2h2V5h2v4"/><path d="M10 21v-4h4v4"/>'

const GLYPH: Record<number, Glyph> = {
  [K.FightOn]: crossed, [K.Strike]: sword, [K.Crush]: sword, [K.CrushPretender]: sword,
  [K.SuePeace]: branch, [K.SeparatePeace]: branch,
  [K.OfferTribute]: coins, [K.Pay]: coins, [K.KeepPaying]: coins, [K.Borrow]: coins, [K.Placate]: coins, [K.Levy]: scroll,
  [K.SeekAlly]: linked, [K.StandBy]: linked, [K.Honour]: seal,
  [K.OfferMatch]: rings, [K.Arrange]: rings,
  [K.NameHeir]: crown, [K.LawDecides]: scales,
  [K.Renounce]: broken, [K.Defy]: broken, [K.DefyWithAlly]: broken, [K.RepudiateDebts]: torn,
  [K.Purge]: dagger, [K.Fortify]: shield, [K.Quarantine]: anchor, [K.MoveCourt]: tower,
  [K.Settle]: road, [K.ExploreOn]: sail, [K.Embrace]: flame, [K.KeepWays]: stone,
  [K.TakeUp]: sprout, [K.Seek]: star, [K.Grant]: seal,
  [K.Endure]: hourglass, [K.Stay]: hourglass, [K.StayOut]: hourglass, [K.Ignore]: hourglass, [K.Decline]: hourglass,
  [K.Retrench]: hourglass, [K.Refuse]: hourglass,
  [K.SendRelief]: coins, [K.RewardArmy]: coins, [K.RecallGeneral]: dagger, [K.JoinWar]: sword, [K.Avenge]: sword, [K.CallBluff]: sword,
  [K.OfferTerms]: branch,
  [K.Commission]: tower, // lane N3c
}

/** The glyph of option key `key` as an inline SVG (decorative: aria-hidden), `size` CSS px. */
export function optionGlyph(key: number, size = 28): string {
  const g = GLYPH[key] ?? hourglass
  return `<svg class="seat-glyph" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${g}</svg>`
}

/** The glyph's inner markup (to draw it large inside an illustration). */
export function glyphInner(key: number): string {
  return GLYPH[key] ?? hourglass
}

/** Every key has a glyph (for the test). */
export const hasGlyph = (key: number): boolean => key in GLYPH
