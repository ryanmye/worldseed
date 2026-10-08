// What kind of device the page runs on, for the default render quality (quality.ts) and the
// start page's slow turn (main.ts): a phone (a touch screen with no fine pointer and a
// narrow viewport), and a weak one (few cores or little memory, where the browser says).
// The GPU itself is judged by a timing probe on the first frames (main.ts), not here.

import { Quality } from './quality.ts'

export interface DeviceClass {
  /** Touch is the only pointer (no mouse or trackpad). */
  touchOnly: boolean
  /** A phone: touch only, and the viewport's short side at most 600 CSS px. */
  phone: boolean
  /** Few CPU cores (<= 4) or little memory (deviceMemory <= 3 GB, Chromium only). */
  weak: boolean
  /** The quality to start with when nothing was chosen. */
  defaultQuality: Quality
}

export function detectDevice(): DeviceClass {
  const mm = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches
  const touchOnly = (navigator.maxTouchPoints ?? 0) > 0 && mm('(pointer: coarse)') && !mm('(any-pointer: fine)')
  const short = Math.min(window.innerWidth, window.innerHeight, window.screen?.width || Infinity, window.screen?.height || Infinity)
  const phone = touchOnly && short <= 600
  const cores = navigator.hardwareConcurrency || 0
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0
  const weak = (cores > 0 && cores <= 4) || (memory > 0 && memory <= 3)
  // (desktops keep Balanced: the first-frame probe lowers it where the GPU cannot keep up)
  const defaultQuality = phone ? (weak ? Quality.Low : Quality.Phone) : touchOnly && weak ? Quality.Phone : Quality.Balanced
  return { touchOnly, phone, weak, defaultQuality }
}
