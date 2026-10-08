// Render quality presets: pixel-ratio cap, surface bake resolution, frame-rate caps and
// whether clouds drift. Chosen from the URL (`quality=high|balanced|phone|low`), else from
// localStorage (the user's choice in the settings popover), else the device's default
// (render/device.ts: Phone on a phone, Low on a weak one, Balanced elsewhere; a slow first
// frame steps it down once, remembered apart from the user's choice).

export const Quality = {
  High: 'high',
  Balanced: 'balanced',
  /** Phones: Balanced's frame rates at a smaller bake, no town shadow maps, one motion target. */
  Phone: 'phone',
  Low: 'low',
} as const
export type Quality = (typeof Quality)[keyof typeof Quality]

export const QUALITIES: Quality[] = [Quality.High, Quality.Balanced, Quality.Phone, Quality.Low]

export interface QualitySettings {
  /** Upper bound on the renderer pixel ratio (also bounded by devicePixelRatio). */
  pixelRatioCap: number
  /** Lowest pixel ratio adaptive resolution may step down to. */
  pixelRatioMin: number
  /** Cube-map face size of the full-resolution surface bake (half-resolution maps use half). */
  bakeSize: number
  /** Cube-map face size of the cloud bake. */
  cloudBakeSize: number
  /**
   * Cloud drift: 'always' keeps the page drawing (slowly) for it; 'ride' drifts only while
   * frames are drawn anyway (auto-rotation, playback, interaction), so an idle page stays
   * idle; 'never' keeps the clouds still.
   */
  cloudsAnimate: 'always' | 'ride' | 'never'
  /** Frame-rate cap while the camera moves (Infinity = display rate). */
  interactFps: number
  /** Frame-rate cap while history plays back. */
  playFps: number
  /** Frame-rate cap when only the auto-rotation or cloud drift moves. */
  ambientFps: number
  /** Ray-march steps of the atmosphere. */
  atmosphereSteps: number
  /** The towns' real sun shadows (a shadow map) up close; off: their soft blob shadows only. */
  townShadows: boolean
  /** Share of the starfield's stars drawn (0..1). */
  starFraction: number
  /** The small clouds seen from below the deck in the city view: two octaves (true) or one. */
  cloudPuffDetail: boolean
  /** Frosted (backdrop-blurred) panels; off: opaque ones (the blur is redone under every panel each frame). */
  panelBlur: boolean
  /** Offscreen motion targets kept (render loop, main.ts) and their MSAA samples. */
  motionTargets: number
  motionSamples: number
}

export const QUALITY_SETTINGS: Record<Quality, QualitySettings> = {
  high: { pixelRatioCap: 2, pixelRatioMin: 1, bakeSize: 1280, cloudBakeSize: 1536, cloudsAnimate: 'always', interactFps: Infinity, playFps: 60, ambientFps: 60, atmosphereSteps: 12, townShadows: true, starFraction: 1, cloudPuffDetail: true, panelBlur: true, motionTargets: 2, motionSamples: 4 },
  balanced: { pixelRatioCap: 1.5, pixelRatioMin: 0.75, bakeSize: 1024, cloudBakeSize: 1024, cloudsAnimate: 'ride', interactFps: 60, playFps: 30, ambientFps: 30, atmosphereSteps: 12, townShadows: true, starFraction: 1, cloudPuffDetail: true, panelBlur: true, motionTargets: 2, motionSamples: 4 },
  // (1.5x on a 3x phone: a third of the pixels of 3x and still sharp at arm's length)
  phone: { pixelRatioCap: 1.5, pixelRatioMin: 0.5, bakeSize: 768, cloudBakeSize: 768, cloudsAnimate: 'ride', interactFps: 60, playFps: 30, ambientFps: 20, atmosphereSteps: 8, townShadows: false, starFraction: 0.5, cloudPuffDetail: false, panelBlur: false, motionTargets: 1, motionSamples: 2 },
  low: { pixelRatioCap: 1, pixelRatioMin: 0.6, bakeSize: 768, cloudBakeSize: 768, cloudsAnimate: 'never', interactFps: 45, playFps: 20, ambientFps: 15, atmosphereSteps: 8, townShadows: false, starFraction: 1, cloudPuffDetail: true, panelBlur: false, motionTargets: 2, motionSamples: 4 },
}

/** One step cheaper (the slow-first-frame probe's fallback); Low stays Low. */
export function cheaperQuality(q: Quality, phone: boolean): Quality {
  if (q === Quality.High) return Quality.Balanced
  if (q === Quality.Balanced) return phone ? Quality.Phone : Quality.Low
  return Quality.Low
}

const STORAGE_KEY = 'worldseed.quality'
/** The probe's step-down (not the user's choice: a choice in the popover replaces it). */
const AUTO_KEY = 'worldseed.quality.auto'

export function isQuality(s: string | null): s is Quality {
  return s === Quality.High || s === Quality.Balanced || s === Quality.Phone || s === Quality.Low
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // storage unavailable (private mode, blocked): fall through to the default
    return null
  }
}

/** The quality to start with, and whether it is the automatic one (no URL value, no remembered choice: the probe may lower it). */
export function loadQuality(urlValue: string | null, deviceDefault: Quality = Quality.Balanced): { quality: Quality; auto: boolean } {
  if (isQuality(urlValue)) return { quality: urlValue, auto: false }
  const v = read(STORAGE_KEY)
  if (isQuality(v)) return { quality: v, auto: false }
  const a = read(AUTO_KEY)
  if (isQuality(a)) return { quality: a, auto: true }
  return { quality: deviceDefault, auto: true }
}

export function saveQuality(q: Quality) {
  try {
    window.localStorage.setItem(STORAGE_KEY, q)
  } catch {
    // not persisted; the choice still applies to this page
  }
}

/** Remember the probe's step-down for the next visit (until the user picks a quality). */
export function saveAutoQuality(q: Quality) {
  try {
    window.localStorage.setItem(AUTO_KEY, q)
  } catch {
    // not persisted
  }
}
