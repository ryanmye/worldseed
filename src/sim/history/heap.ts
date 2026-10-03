// A binary min-heap of (key, id) pairs for the history's searches, ordered
// like util.ts's MinHeap (by key, ties on the smaller id), so it pops the
// same sequence; it sifts by moving a hole instead of swapping, which is
// noticeably faster in the hot migration and trade searches.

export class Heap {
  keys: Float64Array
  ids: Int32Array
  size = 0

  constructor(capacity: number) {
    this.keys = new Float64Array(Math.max(16, capacity))
    this.ids = new Int32Array(Math.max(16, capacity))
  }

  push(key: number, id: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.keys.length * 2); k.set(this.keys); this.keys = k
      const v = new Int32Array(this.ids.length * 2); v.set(this.ids); this.ids = v
    }
    const keys = this.keys, ids = this.ids
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      const kp = keys[p]
      if (kp < key || (kp === key && ids[p] < id)) break
      keys[i] = kp
      ids[i] = ids[p]
      i = p
    }
    keys[i] = key
    ids[i] = id
  }

  /** Key of the top element (call only when size > 0). */
  topKey(): number {
    return this.keys[0]
  }

  /** Removes the top element and returns its id (call only when size > 0). */
  pop(): number {
    const keys = this.keys, ids = this.ids
    const top = ids[0]
    const last = --this.size
    if (last > 0) {
      const key = keys[last], id = ids[last]
      let i = 0
      for (;;) {
        let m = 2 * i + 1
        if (m >= last) break
        let km = keys[m]
        const r = m + 1
        if (r < last) {
          const kr = keys[r]
          if (kr < km || (kr === km && ids[r] < ids[m])) { m = r; km = kr }
        }
        if (key < km || (key === km && id < ids[m])) break
        keys[i] = km
        ids[i] = ids[m]
        i = m
      }
      keys[i] = key
      ids[i] = id
    }
    return top
  }
}
