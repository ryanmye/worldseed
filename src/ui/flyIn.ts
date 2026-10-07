// The way into the city view from the panels (the inspector's and the Cities panel's "Fly in"):
// they call requestFlyIn; main.ts, which owns the camera, registers the handler.

let handler: ((id: number) => void) | null = null

export function setFlyInHandler(f: ((id: number) => void) | null): void {
  handler = f
}

/** Fly down into settlement id (the city view, render/cityView.ts). */
export function requestFlyIn(id: number): void {
  handler?.(id)
}
