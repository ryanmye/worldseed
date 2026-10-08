// Double taps on touch screens, from the taps' click events (a browser's own dblclick after
// taps is not relied on: some fire it, some do not). The first tap of a pair does what a tap
// does (a click); the second also completes the double tap, as a mouse's second click and
// its dblclick do.

export interface DoubleTap {
  /** A tap at client (x, y): true if it completes a double tap (the pair then starts afresh). */
  tap(x: number, y: number): boolean
  /** Whether a tap at client (x, y) now would complete a double tap. */
  pending(x: number, y: number): boolean
}

/** Taps at most `ms` apart and `px` CSS px apart make a double tap. */
export function createDoubleTap(ms = 350, px = 32): DoubleTap {
  let t = -Infinity, lx = 0, ly = 0
  const near = (x: number, y: number) => performance.now() - t <= ms && Math.hypot(x - lx, y - ly) <= px
  return {
    pending: near,
    tap(x: number, y: number) {
      const now = performance.now()
      const dbl = near(x, y)
      t = dbl ? -Infinity : now
      lx = x
      ly = y
      return dbl
    },
  }
}
