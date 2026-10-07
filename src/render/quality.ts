// Render quality presets: pixel-ratio cap, surface bake resolution, frame-rate caps and
// whether clouds drift. Chosen from the URL (`quality=high|balanced|low`), else from
// localStorage, else Balanced.

export const Quality = {
  High: 'high',
  Balanced: 'balanced',
  Low: 'low',
} as const
export type Quality = (typeof Quality)[keyof typeof Quality]

export const QUALITIES: Quality[] = [Quality.High, Quality.Balanced, Quality.Low]

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
}

export const QUALITY_SETTINGS: Record<Quality, QualitySettings> = {
  high: { pixelRatioCap: 2, pixelRatioMin: 1, bakeSize: 1280, cloudBakeSize: 1536, cloudsAnimate: 'always', interactFps: Infinity, playFps: 60, ambientFps: 60, atmosphereSteps: 12, townShadows: true },
  balanced: { pixelRatioCap: 1.5, pixelRatioMin: 0.75, bakeSize: 1024, cloudBakeSize: 1024, cloudsAnimate: 'ride', interactFps: 60, playFps: 30, ambientFps: 30, atmosphereSteps: 12, townShadows: true },
  low: { pixelRatioCap: 1, pixelRatioMin: 0.6, bakeSize: 768, cloudBakeSize: 768, cloudsAnimate: 'never', interactFps: 45, playFps: 20, ambientFps: 15, atmosphereSteps: 8, townShadows: false },
}

const STORAGE_KEY = 'worldseed.quality'

export function isQuality(s: string | null): s is Quality {
  return s === Quality.High || s === Quality.Balanced || s === Quality.Low
}

export function loadQuality(urlValue: string | null): Quality {
  if (isQuality(urlValue)) return urlValue
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (isQuality(v)) return v
  } catch {
    // storage unavailable (private mode, blocked): fall through to the default
  }
  return Quality.Balanced
}

export function saveQuality(q: Quality) {
  try {
    window.localStorage.setItem(STORAGE_KEY, q)
  } catch {
    // not persisted; the choice still applies to this page
  }
}
