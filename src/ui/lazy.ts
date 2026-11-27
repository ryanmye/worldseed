// onboarding (bundle split): a stand-in for an object whose module loads later (a separate chunk). Calls made before it
// is built are queued and replayed on it in order; members listed in `before` answer meanwhile (values, or functions
// that return a neutral answer). Once built, every access goes straight to the real object.

export interface Lazy<T> {
  readonly value: T
  /** Resolves with the real object once built (the queued calls replayed). */
  readonly ready: Promise<T>
}

export function lazyObject<T extends object>(load: () => Promise<T>, before: Partial<Record<keyof T, unknown>> = {}, label = 'module'): Lazy<T> {
  let real: T | null = null
  const queue: [keyof T, unknown[]][] = []
  const value = new Proxy({} as T, {
    get(_t, key) {
      const k = key as keyof T
      if (real) {
        const v = real[k] as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v
      }
      if (k in before) return before[k]
      return (...args: unknown[]) => {
        queue.push([k, args])
      }
    },
  })
  const ready = load().then((v) => {
    real = v
    // (in order; a call these make goes straight to the object)
    for (const [k, args] of queue.splice(0)) (v[k] as (...a: unknown[]) => unknown)(...args)
    return v
  })
  ready.catch((err) => console.error(`${label} failed to load`, err))
  return { value, ready }
}
