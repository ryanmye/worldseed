// The diorama layer in the scene (layer.ts registers it): its own tiny module so the city view and main.ts can ask for it
// without loading the dioramas' code (onboarding bundle split: the layer is built by the history view, a later chunk).

import type { DioramaLayer } from './layer.ts'

let active: DioramaLayer | null = null

/** The diorama layer in the scene (the city view asks it about towns), or null. */
export function activeDioramaLayer(): DioramaLayer | null {
  return active
}

/** layer.ts: the layer now in the scene (null none). */
export function setActiveDioramaLayer(layer: DioramaLayer | null): void {
  active = layer
}
