// Goods' names and map colours (split out of ui/format.ts and render/trade.ts so the overlay's legend does not load them:
// onboarding bundle split; both re-export these).

export const GOOD_NAMES: readonly string[] = ['grain', 'fish', 'livestock', 'timber', 'ore', 'salt', 'cloth', 'luxuries', 'stimulants', 'metalware', 'finery', 'treasure', 'wares']

/** Map colour per good (render/trade.ts documents the choice). Only the first GOOD_COUNT entries are ever read. */
export const GOOD_COLORS: readonly string[] = [
  '#f7d54a', '#3fe6cf', '#f2605f', '#8fd447', '#ef7dff', '#f6f4ee', '#5f93ff', '#a65cff', '#ff9a2e',
  '#8aa8b0', '#ff6fb8', '#d9a62a', '#c2a46a',
]
