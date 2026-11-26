// The globe's slow idle turn (main.ts): how long it lasts before it stops on its own (battery:
// every turning frame redraws the whole scene), and the ease-out that brings it to rest rather
// than stopping dead. Pure, so the timing can be tested without a renderer.

/** Seconds of turning before the idle turn stops (mouse and keyboard devices; a design default). */
export const IDLE_TURN_SECONDS = 45
/** Touch devices stop sooner (a frame every few dozen ms for as long as it lasts). */
export const TOUCH_TURN_SECONDS = 8
/** The last seconds of the turn, over which its speed eases to zero. */
export const TURN_EASE_SECONDS = 2

/**
 * How many seconds the idle turn lasts: Infinity when the address asks for it explicitly
 * (`spin=1`, so recordings keep turning), else the device's limit.
 */
export function turnLimit(touchOnly: boolean, explicit: boolean): number {
  if (explicit) return Infinity
  return touchOnly ? TOUCH_TURN_SECONDS : IDLE_TURN_SECONDS
}

/**
 * The turn's speed as a fraction of full (0..1) after `turned` seconds of turning, for a turn that
 * stops at `limit`: 1 until `ease` seconds before the limit, then a smooth fall to 0 at it.
 */
export function turnSpeedFactor(turned: number, limit: number, ease = TURN_EASE_SECONDS): number {
  if (!Number.isFinite(limit)) return 1
  const e = Math.min(ease, limit)
  if (e <= 0) return turned < limit ? 1 : 0
  const x = (limit - turned) / e
  if (x >= 1) return 1
  if (x <= 0) return 0
  return x * x * (3 - 2 * x)
}
