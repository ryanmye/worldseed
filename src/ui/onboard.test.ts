// Onboarding policies (ui/onboard.ts): Follow by default for a first visit only, never over a link that opens somewhere
// particular; the throne path's link keeps the page's preset.

import { describe, expect, it } from 'vitest'
import { followByDefault, PLAY_PATHS, PlayPath, throneUrl } from './onboard.ts'

const q = (s: string) => new URLSearchParams(s)

describe('onboarding', () => {
  it('follows by default on a first visit only', () => {
    expect(followByDefault(q(''), true)).toBe(true)
    expect(followByDefault(q('seed=5'), true)).toBe(true)
    expect(followByDefault(q('seed=5'), false)).toBe(false)
  })
  it('follow= wins; seat, comparison and place links keep their own camera', () => {
    expect(followByDefault(q('follow=1'), false)).toBe(true)
    expect(followByDefault(q('follow=0'), true)).toBe(false)
    for (const k of ['seat=polity:0:700', 'cmp=-', 'fly=3', 'select=4', 'polity=1', 'year=700']) expect(followByDefault(q(k), true)).toBe(false)
  })
  it('one primary play path; the throne link is a seat link keeping preset=', () => {
    expect(PLAY_PATHS.filter((p) => p.primary).map((p) => p.path)).toEqual([PlayPath.Watch])
    const u = throneUrl(new URL('http://x/?intro=1&preset=dramatic&seed=9'))
    expect(u.searchParams.get('seat')).toBeTruthy()
    expect(u.searchParams.get('preset')).toBe('dramatic')
    expect(u.searchParams.get('intro')).toBeNull()
  })
})
