// The ramps on the sun's elevation over a place (degrees) that the city view's light shares:
// the town's light (dioramas/townLight.ts), the sky dome and its haze and clouds (citySky.ts,
// sky.ts) and the sun disc (sunDisc.ts), so the sky, the buildings' ambient and the sun turn
// together. Each is a smoothstep from the first number to the second.

/** Sunset warmth: none above WARM[1], all of it at the horizon; (1 - smoothstep)^WARM_POW. */
export const WARM: readonly [number, number] = [0, 16]
export const WARM_POW = 1.4
/** Night -> dusk (the twilight sky lights up). */
export const DUSK: readonly [number, number] = [-12, -1]
/** Dusk -> day (the sky turns blue). */
export const DAY: readonly [number, number] = [1, 12]
/** Lamps and windows off (and the stars gone) above, on below. */
export const LAMPS: readonly [number, number] = [-4, 3]

const f = (x: number) => x.toFixed(2)

/** GLSL: the same ramps for sunH = sine of the sun's elevation. */
export const SUN_RAMPS_GLSL = /* glsl */ `
float sunElevDeg(float sunH) { return degrees(asin(clamp(sunH, -1.0, 1.0))); }
float rampWarm(float e) { return pow(1.0 - smoothstep(${f(WARM[0])}, ${f(WARM[1])}, e), ${f(WARM_POW)}); }
float rampDusk(float e) { return smoothstep(${f(DUSK[0])}, ${f(DUSK[1])}, e); }
float rampDay(float e) { return smoothstep(${f(DAY[0])}, ${f(DAY[1])}, e); }
float rampLamps(float e) { return smoothstep(${f(LAMPS[0])}, ${f(LAMPS[1])}, e); }
`
