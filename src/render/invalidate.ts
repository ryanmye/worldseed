// Render-on-demand signal. Anything that changes the picture (camera, playback,
// toggles, data or asset arrival, animations in progress) calls requestRender();
// the frame loop draws only when a request is pending.

let pending = true

export function requestRender(): void {
  pending = true
}

/** Returns whether a render was requested since the last call, and clears the request. */
export function consumeRenderRequest(): boolean {
  const was = pending
  pending = false
  return was
}
