// Progressive cube-map bakes of static, procedurally shaded surfaces.
//
// A bake draws a mesh from the planet centre into the six faces of one or more cube
// render targets, a strip of a face at a time (at most 512 rows) so a bake never stalls
// the page (the caller keeps drawing with the procedural shader until it is ready).
// Mipmaps are generated once per target, after its last strip. Used for the planet surface (planetShaders.ts) and the
// cloud deck (sky.ts).

import * as THREE from 'three'

export interface CubeBakePass {
  /** Face size of the target. */
  size: number
  format: typeof THREE.RGBAFormat | typeof THREE.RedFormat
  /** Material that writes this target's texels (drawn on the inside of the mesh). */
  material: THREE.ShaderMaterial
}

export interface CubeBake {
  readonly textures: THREE.CubeTexture[]
  readonly ready: boolean
  /** Bake started and not finished. */
  readonly pending: boolean
  /** GPU memory of the targets, mipmaps included (bytes). */
  readonly bytes: number
  /** Completed bakes, and the wall time of the last one (ms, start to finish). */
  readonly count: number
  readonly lastMs: number
  /** Start (or restart) baking. */
  start(): void
  /** Draw up to `maxFaces` face strips; returns true while work remains. `sync` waits for the GPU (timing). */
  step(renderer: THREE.WebGLRenderer, maxFaces: number, sync?: boolean): boolean
  dispose(): void
}

const FACES = 6
const STRIP_ROWS = 512

export function createCubeBake(geometry: THREE.BufferGeometry, passes: CubeBakePass[], near = 0.2, far = 4): CubeBake {
  const targets = passes.map((p) => {
    const rt = new THREE.WebGLCubeRenderTarget(p.size, {
      format: p.format,
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })
    rt.texture.colorSpace = THREE.NoColorSpace
    return rt
  })
  const mesh = new THREE.Mesh(geometry, passes[0].material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const cubeCamera = new THREE.CubeCamera(near, far, targets[0])
  scene.add(cubeCamera)
  const cameras = cubeCamera.children as THREE.PerspectiveCamera[]
  const probe = new Uint8Array(4)

  // work units: (pass, face, strip), in that order
  const units: { pass: number; face: number; y: number; h: number }[] = []
  passes.forEach((p, pass) => {
    const strips = Math.max(1, Math.ceil(p.size / STRIP_ROWS))
    for (let face = 0; face < FACES; face++) {
      for (let k = 0; k < strips; k++) {
        const y = Math.round((k * p.size) / strips)
        units.push({ pass, face, y, h: Math.round(((k + 1) * p.size) / strips) - y })
      }
    }
  })
  let next = -1 // next unit; -1 = idle
  let t0 = 0
  let count = 0
  let lastMs = 0
  let ready = false
  let bytes = 0
  for (const p of passes) bytes += p.size * p.size * FACES * (p.format === THREE.RedFormat ? 1 : 4) * (4 / 3)

  return {
    textures: targets.map((t) => t.texture),
    get ready() {
      return ready
    },
    get pending() {
      return next >= 0
    },
    bytes,
    get count() {
      return count
    },
    get lastMs() {
      return lastMs
    },
    start() {
      next = 0
      ready = false
      t0 = -1
    },
    step(renderer: THREE.WebGLRenderer, maxFaces: number, sync = false) {
      if (next < 0) return false
      if (t0 < 0) t0 = performance.now()
      if (cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
        cubeCamera.coordinateSystem = renderer.coordinateSystem
        cubeCamera.updateCoordinateSystem()
      }
      cubeCamera.updateMatrixWorld(true)
      const prevTarget = renderer.getRenderTarget()
      const prevFace = renderer.getActiveCubeFace()
      const prevLevel = renderer.getActiveMipmapLevel()
      const total = units.length
      for (let k = 0; k < maxFaces && next < total; k++, next++) {
        const { pass, face, y, h } = units[next]
        const target = targets[pass]
        mesh.material = passes[pass].material
        // mipmaps once per target, after its last strip
        target.texture.generateMipmaps = next + 1 === total || units[next + 1].pass !== pass
        target.scissor.set(0, y, target.width, h)
        target.scissorTest = true
        renderer.setRenderTarget(target, face)
        renderer.render(scene, cameras[face])
        target.scissorTest = false
      }
      renderer.setRenderTarget(prevTarget, prevFace, prevLevel)
      if (sync) {
        // wait for the GPU (perf timing only): a 1-pixel read of the current framebuffer
        const gl = renderer.getContext()
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe)
      }
      if (next >= total) {
        next = -1
        ready = true
        count++
        lastMs = performance.now() - t0
        return false
      }
      return true
    },
    dispose() {
      for (const t of targets) t.dispose()
      for (const p of passes) p.material.dispose()
    },
  }
}
