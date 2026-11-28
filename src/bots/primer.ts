// The player primer's version (docs/PLAYER_PRIMER.md, its header line "Version: N"). Every UI-driven bot and LLM play-tester
// reads the primer; a lane that changes the UI, the cards or the controls updates the primer and bumps this with it
// (coverage.test.ts checks the two agree and that every keyboard shortcut and decision kind is in the primer).
export const PRIMER_VERSION = 8
