// Marker slots: where each layer puts its glyph round a settlement marker, so marks from different
// layers on one town do not land on each other (one rule, shared by the screen-space mark shaders).
//
// Round the marker (radius r, CSS px after zoom scaling) lies the ring band, out to about
// r * 1.25 + 8: the mart rings (longhaul.ts), the visitors' dots (tourism.ts), the sickness rings
// (disease.ts), selection and highlight rings. Glyphs sit outside it, each kind in its own slot; the
// name label runs to the right of the marker, so nothing but a factory's pennant goes there.
//
//   top          the capital's star (polities.ts), just over the marker; the holy city's sunburst
//                (faiths.ts) one step above it, whether or not the place is also a capital
//   upper left   a resort's parasol (tourism.ts)
//   left         a sight's glyph (tourism.ts)
//   upper right  a quarantine flag (disease.ts)
//   below        a fort's or a victualling station's tower (longhaul.ts)
//   right        a factory's pennant beside its host (longhaul.ts)
//   lower left   where a selected idea was conceived (a sparkle) or lost (a cross) (ideas.ts)
//
// Priority: where two kinds would share a slot the more lasting one keeps it (a capital over a holy
// city) and the other moves one step out; a sight that repeats what another layer already marks is
// not drawn twice (tourism.ts drops a faded parasol on a living resort, and its holy-city star on the
// Faiths view, where faiths.ts marks the holy city).

/** The top slot's height over the marker centre for a capital (CSS px before zoom scaling), by marker radius tier: polities.ts writes it per capital. */
export function capitalSlotHeight(population: number): number {
  return population >= 10000 ? 11.5 : population >= 3000 ? 8.5 : 6
}

/** The holy city's height over the marker centre (CSS px before zoom scaling): one step (12 px) over the capital's star. */
export function holySlotHeight(population: number): number {
  return capitalSlotHeight(population) + 12
}

/**
 * GLSL: offsets (CSS px, y up) beside the ring band, for a marker of radius r and a glyph of radius g
 * (both already scaled), s the size scale; the angle in radians from the right, counter-clockwise.
 */
export const MARKER_SLOT_GLSL = /* glsl */ `
vec2 ws_slotAt(float a, float r, float g, float s) { float d = r * 1.25 + 3.0 * s + g; return d * vec2(cos(a), sin(a)); }
const float WS_SLOT_UPPER_LEFT = 2.3562;
const float WS_SLOT_LEFT = 3.1416;
const float WS_SLOT_UPPER_RIGHT = 0.7854;
const float WS_SLOT_BELOW = -1.5708;
const float WS_SLOT_LOWER_LEFT = -2.3562;
`
