// The first hearths the player plants (ui/hearthPicker.ts): a small flame with the people's number at each chosen cell,
// warm on land, red where the cell cannot be lived on (sea, ice: the simulation moves it to the nearest land). One
// instanced screen-space quad draw for all of them, glyphs from a small canvas atlas (12 numbers in two tones); the
// instances are rewritten only when the list changes, and nothing is drawn (the mesh hidden) when there are none.
// Drawn on the globe and on the flat map alike (ws_place), on the visible side only.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'

/** Most hearths drawn (the simulation's most peoples). */
export const HEARTH_MAX = 12
const TILE = 64
const TONES = 2
const LIFT = 0.006

/** One hearth: its cell, its number (1-based) and whether the cell can be lived on. */
export interface HearthMark {
  cell: number
  n: number
  livable: boolean
}

export interface HearthLayer {
  mesh: THREE.Mesh
  set(world: World, marks: readonly HearthMark[]): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  dispose(): void
}

/** The atlas: a row per tone (warm, red), a column per number; each tile a flame over a dark disc with the number under it. */
function buildAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = TILE * HEARTH_MAX
  cv.height = TILE * TONES
  const g = cv.getContext('2d')!
  for (let tone = 0; tone < TONES; tone++) {
    for (let i = 0; i < HEARTH_MAX; i++) {
      const x0 = i * TILE, y0 = tone * TILE
      const cx = x0 + TILE / 2
      // the dark disc (a halo for any ground)
      g.beginPath()
      g.arc(cx, y0 + TILE / 2, TILE / 2 - 3, 0, Math.PI * 2)
      g.fillStyle = 'rgba(8, 10, 14, 0.82)'
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = tone === 0 ? 'rgba(255, 196, 110, 0.95)' : 'rgba(255, 96, 80, 0.95)'
      g.stroke()
      // the flame (a teardrop) in the upper half
      const fy = y0 + 25
      g.beginPath()
      g.moveTo(cx, fy - 17)
      g.bezierCurveTo(cx + 12, fy - 4, cx + 11, fy + 9, cx, fy + 9)
      g.bezierCurveTo(cx - 11, fy + 9, cx - 12, fy - 4, cx, fy - 17)
      g.fillStyle = tone === 0 ? '#ffb347' : '#ff5a48'
      g.fill()
      g.beginPath()
      g.moveTo(cx, fy - 5)
      g.bezierCurveTo(cx + 6, fy + 2, cx + 5, fy + 8, cx, fy + 8)
      g.bezierCurveTo(cx - 5, fy + 8, cx - 6, fy + 2, cx, fy - 5)
      g.fillStyle = tone === 0 ? '#fff1c2' : '#ffd0c4'
      g.fill()
      // the number
      g.fillStyle = '#ffffff'
      g.font = '700 22px Inter, system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'alphabetic'
      g.fillText(String(i + 1), cx, y0 + TILE - 10)
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

export function buildHearthLayer(): HearthLayer {
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(HEARTH_MAX * 3)
  const tile = new Float32Array(HEARTH_MAX * 2)
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3)
  const tileAttr = new THREE.InstancedBufferAttribute(tile, 2)
  quad.setAttribute('aPos', posAttr)
  quad.setAttribute('aTile', tileAttr)
  quad.instanceCount = 0
  const atlas = buildAtlas()
  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uAtlas: { value: atlas },
    uGrid: { value: new THREE.Vector2(HEARTH_MAX, TONES) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSize: { value: 17 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec2 aTile;
      uniform vec2 uGrid;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      uniform float uSize;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec3 p = ws_relief(aPos);
        float facing = ws_facing(dot(normalize(p), normalize(uCamObj - p)));
        if (facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(p), 1.0);
        float r = uSize * mix(0.75, 1.0, sqrt(facing));
        clip.xy += position.xy * r * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vUv = (aTile + (position.xy * vec2(1.0, -1.0) * 0.5 + 0.5)) / uGrid;
        vUv.y = 1.0 - vUv.y;
        vAlpha = smoothstep(0.0, 0.25, facing);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        float a = c.a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c.rgb * a, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 9.78 // (over everything on the ground: the player's choice, always in view)
  mesh.visible = false
  return {
    mesh,
    set(world: World, marks: readonly HearthMark[]) {
      const P = world.grid.positions
      let n = 0
      for (const m of marks) {
        if (n >= HEARTH_MAX || m.cell < 0 || m.cell >= world.grid.cellCount) continue
        const r = Math.max(1, surfaceRadius(world, m.cell)) + LIFT
        pos[n * 3] = P[m.cell * 3] * r
        pos[n * 3 + 1] = P[m.cell * 3 + 1] * r
        pos[n * 3 + 2] = P[m.cell * 3 + 2] * r
        tile[n * 2] = Math.min(HEARTH_MAX, Math.max(1, m.n)) - 1
        tile[n * 2 + 1] = m.livable ? 0 : 1
        n++
      }
      quad.instanceCount = n
      posAttr.needsUpdate = true
      tileAttr.needsUpdate = true
      mesh.visible = n > 0
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (!mesh.visible) return
      mesh.updateWorldMatrix(true, false)
      camera.getWorldPosition(uniforms.uCamObj.value)
      mesh.worldToLocal(uniforms.uCamObj.value)
      uniforms.uViewport.value.copy(drawSize)
      uniforms.uPixelRatio.value = pixelRatio
    },
    dispose() {
      quad.dispose()
      material.dispose()
      atlas.dispose()
    },
  }
}
