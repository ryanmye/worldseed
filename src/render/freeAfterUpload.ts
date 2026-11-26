// Dropping the CPU copies of static geometry once it is on the GPU (memory, not power: the big
// ribbons of every leg, lane and link that will ever exist are ~25 MB of typed arrays that
// nothing reads after the build). three.js keeps `attribute.array` for re-uploads; the
// documented hook for dropping it is BufferAttribute.onUpload.
//
// Only for geometry that (1) is never written or read on the CPU after the build (no
// needsUpdate, no picking, no seam copy, no wireframe) and (2) can be rebuilt: after a lost
// WebGL context three.js re-creates every buffer from `attribute.array` on its next render
// (WebGLRenderer onContextRestore -> initGLContext -> a fresh WebGLAttributes), which a freed
// attribute cannot give it. So a freed mesh is marked stale when the context is lost, kept
// hidden from then on (never handed to three.js without its array), and its layer is rebuilt
// from the History by the caller (main.ts: historyView.replaceHistory); the rebuilt layer
// disposes the stale geometry, which drops it from here.

import * as THREE from 'three'

const freed = new Set<THREE.Object3D>()
const stale = new Set<THREE.Object3D>()

function drop(this: THREE.BufferAttribute) {
  ;(this as unknown as { array: unknown }).array = null
}

/**
 * Frees the CPU arrays of `geometries` (every attribute and the index) as each is uploaded, for
 * `mesh` (and any other meshes drawing them, `also`). The bounding sphere is computed first
 * where missing (three.js needs it to sort transparent objects and reads the positions for it).
 */
export function freeAfterUpload(mesh: THREE.Object3D, geometries: THREE.BufferGeometry[], also: THREE.Object3D[] = []): void {
  const meshes = [mesh, ...also]
  for (const g of geometries) {
    if (!g.boundingSphere && g.getAttribute('position')) g.computeBoundingSphere()
    for (const a of Object.values(g.attributes)) if (a instanceof THREE.BufferAttribute) a.onUpload(drop)
    g.index?.onUpload(drop)
    g.addEventListener('dispose', () => {
      for (const m of meshes) {
        freed.delete(m)
        stale.delete(m)
      }
    })
  }
  for (const m of meshes) freed.add(m)
}

/** The context was lost: every mesh freed so far can no longer be drawn. Returns whether there were any. */
export function markFreedStale(): boolean {
  for (const m of freed) stale.add(m)
  return stale.size > 0
}

/** Just before a render: stale meshes stay hidden (their layers set visibility every tick). */
export function hideStale(): void {
  if (stale.size === 0) return
  for (const m of stale) m.visible = false
}

/** Freed and stale mesh counts (perf tools). */
export function freedInfo(): { freed: number; stale: number } {
  return { freed: freed.size, stale: stale.size }
}
