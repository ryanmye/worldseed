import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyPowerMode, platform, setPlatformBackend, webBackend } from './index.ts'
import { requestPersistenceOnce } from './pwa.ts'
import { parseWorldFile, worldFileFor } from './worldFile.ts'

const g = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  delete g.__worldseed
  setPlatformBackend(webBackend)
  platform.power.set('normal')
})

describe('platform', () => {
  it('is the browser by default', async () => {
    expect(platform.kind).toBe('web')
    // node: no navigator.storage, no Web Share
    expect(await platform.storage.persist()).toBe(false)
    expect(await platform.files.share({ url: 'https://example.com' })).toBe(false)
  })

  it('takes parts from a native shell, keeping the rest', async () => {
    const exportFile = vi.fn(async () => 'cancelled' as const)
    setPlatformBackend({ kind: 'shell', exportFile })
    expect(platform.kind).toBe('shell')
    expect(await platform.files.exportFile({ name: 'w.worldseed', text: 'x' })).toBe('cancelled')
    expect(exportFile).toHaveBeenCalledWith({ name: 'w.worldseed', text: 'x' })
    expect(await platform.storage.persist()).toBe(false)
  })
})

describe('power mode', () => {
  it('skips the render hook while it is absent', () => {
    expect(applyPowerMode('saver')).toBe(false)
    g.__worldseed = {}
    expect(applyPowerMode('saver')).toBe(false)
  })

  it('hands changes to window.__worldseed.setPowerMode and the listeners', () => {
    const setPowerMode = vi.fn()
    g.__worldseed = { setPowerMode }
    const seen: string[] = []
    const off = platform.power.onChange((m) => seen.push(m))
    platform.power.set('saver')
    platform.power.set('saver')
    platform.power.set('normal')
    off()
    expect(platform.power.mode()).toBe('normal')
    expect(seen).toEqual(['saver', 'normal'])
    expect(setPowerMode.mock.calls).toEqual([['saver'], ['normal']])
  })

  it('retries while the hook is installed late', () => {
    vi.useFakeTimers()
    try {
      platform.power.set('saver')
      const setPowerMode = vi.fn()
      g.__worldseed = { setPowerMode }
      vi.advanceTimersByTime(2000)
      expect(setPowerMode).toHaveBeenCalledWith('saver')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('first-run persistence request', () => {
  it('asks once', async () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    expect(await requestPersistenceOnce(storage)).toBe(false)
    expect(await requestPersistenceOnce(storage)).toBe(null)
  })
})

describe('world file', () => {
  it('round-trips the run parameters and drops page-only ones', () => {
    const f = worldFileFor('?seed=42&years=3000&o=1000:explore:5:12345&perf=1&intro=1', 0)
    expect(f.name).toBe('world-42.worldseed')
    const data = JSON.parse(f.text)
    expect(data).toEqual({ worldseed: 1, link: '?seed=42&years=3000&o=1000%3Aexplore%3A5%3A12345', name: 'world-42', created: 0 })
    const back = parseWorldFile(f.text)
    expect(back).toEqual({ link: data.link })
    expect(new URLSearchParams((back as { link: string }).link).get('o')).toBe('1000:explore:5:12345')
  })
  it('opens the defaults without the start page', () => {
    expect(parseWorldFile(worldFileFor('', 0).text)).toEqual({ link: '?intro=0' })
  })
  it('rejects anything else', () => {
    expect(parseWorldFile('nope')).toHaveProperty('error')
    expect(parseWorldFile('{"worldseed":2,"link":"?seed=1"}')).toHaveProperty('error')
    expect(parseWorldFile('{"worldseed":1,"recipe":{}}')).toHaveProperty('error')
    expect(parseWorldFile('{"worldseed":1,"link":"https://evil.example/?seed=1"}')).toHaveProperty('error')
    expect(parseWorldFile('{"worldseed":1,"link":"/other?seed=1"}')).toHaveProperty('error')
  })
})
