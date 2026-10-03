// Rivers as ribbons lying on the surface, drawn along smooth curves: each
// river cell contributes a quadratic Bezier from the midpoint of its incoming
// segment, with the cell as control point, to the midpoint of its outgoing
// segment. Neighbouring pieces meet at midpoints with matching tangent and
// width, so a river is one seamless ribbon with no overlap at joints.
// Width and opacity scale with log flow; the vertex shader widens sub-pixel
// ribbons to ~1px and lowers their alpha instead, so thin tributaries stay
// faint and stable. Ribbons are sun-lit and fade out toward the limb.

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, type World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius, SUN_COLOR, SUN_DIRECTION } from './globe.ts'
import { sunUniforms } from './sun.ts'

/** Height of river ribbons above the ground, avoids z-fighting with the terrain. */
const RIVER_LIFT = 0.0012
const SAMPLES = 6

export interface RiverLines {
  lines: THREE.Mesh
  /** Per-frame uniforms: camera/sun in object space, pixel size. */
  update(camera: THREE.PerspectiveCamera, viewportHeight: number): void
  dispose(): void
}

interface Knot {
  p: THREE.Vector3 // unit direction
  r: number // surface radius
  w: number // half width
  a: number // alpha
}

export function buildRiverLines(world: World): RiverLines {
  const { grid, flow, riverTo, elevation } = world
  const lake = lakeArray(world)
  const P = grid.positions
  const N = grid.cellCount

  const pos: number[] = []
  const side: number[] = []
  const data: number[] = []
  const index: number[] = []

  const logFlow = (f: number) => Math.log(Math.max(f, RIVER_FLOW_THRESHOLD) / RIVER_FLOW_THRESHOLD)
  const halfWidth = (f: number) => Math.min(0.0032, 0.0006 + 0.00075 * logFlow(f))
  const alphaOf = (f: number) => Math.min(0.9, 0.35 + 0.18 * logFlow(f))

  const water = (i: number) => isWaterCell(world, lake, i)
  const isRiver = (i: number) => flow[i] >= RIVER_FLOW_THRESHOLD && riverTo[i] >= 0 && !water(i)
  const unit = (i: number) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])

  // Main (largest) upstream river cell of each river cell.
  const main = new Int32Array(N).fill(-1)
  for (let i = 0; i < N; i++) {
    if (!isRiver(i)) continue
    const j = riverTo[i]
    if (main[j] < 0 || flow[i] > flow[main[j]]) main[j] = i
  }

  const midKnot = (a: number, b: number): Knot => ({
    p: unit(a).add(unit(b)).normalize(),
    r: (surfaceRadius(world, a) + surfaceRadius(world, b)) / 2,
    w: halfWidth(flow[a]),
    a: alphaOf(flow[a]),
  })
  const cellKnot = (b: number, f: number): Knot => ({ p: unit(b), r: surfaceRadius(world, b), w: halfWidth(f), a: alphaOf(f) })

  const tmp = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const sd = new THREE.Vector3()
  const q0 = new THREE.Vector3(), q1 = new THREE.Vector3(), q2 = new THREE.Vector3()

  /** Emit a ribbon along the quadratic Bezier k0 -> (ctrl) -> k2; alpha is scaled by fadeIn/fadeOut ramps. */
  function emit(k0: Knot, ctrl: Knot, k2: Knot, fadeIn: boolean, fadeOut: boolean) {
    q0.copy(k0.p).multiplyScalar(k0.r + RIVER_LIFT)
    q1.copy(ctrl.p).multiplyScalar(ctrl.r + RIVER_LIFT)
    q2.copy(k2.p).multiplyScalar(k2.r + RIVER_LIFT)
    const base = pos.length / 3
    for (let s = 0; s < SAMPLES; s++) {
      const t = s / (SAMPLES - 1)
      const u = 1 - t
      // point and tangent on the Bezier, then snapped to the sphere at an interpolated radius
      tmp.set(0, 0, 0).addScaledVector(q0, u * u).addScaledVector(q1, 2 * u * t).addScaledVector(q2, t * t)
      tan.set(0, 0, 0).addScaledVector(q1, 2 * u).addScaledVector(q0, -2 * u).addScaledVector(q2, 2 * t).addScaledVector(q1, -2 * t)
      const r = k0.r * u * u + ctrl.r * 2 * u * t + k2.r * t * t + RIVER_LIFT
      tmp.normalize()
      sd.crossVectors(tmp, tan).normalize()
      tmp.multiplyScalar(r)
      const w = k0.w + (k2.w - k0.w) * t
      let a = k0.a + (k2.a - k0.a) * t
      if (fadeIn) a *= Math.min(1, t * 1.6)
      if (fadeOut) a *= Math.min(1, (1 - t) * 2.5 + 0.15)
      for (const across of [-1, 1]) {
        pos.push(tmp.x, tmp.y, tmp.z)
        side.push(sd.x, sd.y, sd.z)
        data.push(across, w, a)
      }
      if (s > 0) {
        const v = base + s * 2
        index.push(v - 2, v, v - 1, v - 1, v, v + 1)
      }
    }
  }

  for (let b = 0; b < N; b++) {
    if (!isRiver(b)) continue
    const c = riverTo[b]
    const mouth = water(c)

    // End knot: midpoint of the outgoing segment, or the shoreline when draining into water.
    let end: Knot
    if (mouth) {
      const eb = elevation[b], ec = elevation[c]
      const t = ec < 0 && eb > ec ? Math.min(0.8, Math.max(0.2, eb / (eb - ec))) : 0.5
      end = {
        p: unit(b).lerp(unit(c), t).normalize(),
        r: surfaceRadius(world, b),
        w: halfWidth(flow[b]),
        a: alphaOf(flow[b]),
      }
    } else {
      end = midKnot(b, c)
    }

    const up = main[b]
    let start: Knot
    if (up >= 0) {
      start = midKnot(up, b)
      emit(start, cellKnot(b, (flow[up] + flow[b]) / 2), end, false, mouth)
    } else {
      // Lake outlet: start at the lake shore at full strength.
      let outlet = -1
      for (let k = grid.neighborOffsets[b]; k < grid.neighborOffsets[b + 1]; k++) {
        const a = grid.neighbors[k]
        if (riverTo[a] === b && water(a)) outlet = a
      }
      if (outlet >= 0) {
        start = { ...midKnot(outlet, b), w: halfWidth(flow[b]), a: alphaOf(flow[b]) }
        emit(start, cellKnot(b, flow[b]), end, false, mouth)
        continue
      }
      // Source: start at the cell centre and fade in.
      start = cellKnot(b, flow[b])
      const mid: Knot = { p: start.p.clone().add(end.p).normalize(), r: (start.r + end.r) / 2, w: start.w, a: start.a }
      emit(start, mid, end, true, mouth)
    }

    // Tributaries (non-main upstream rivers) end where they meet the main curve.
    if (up >= 0) {
      const join: Knot = {
        p: start.p.clone().multiplyScalar(0.25).addScaledVector(unit(b), 0.5).addScaledVector(end.p, 0.25).normalize(),
        r: surfaceRadius(world, b),
        w: 0,
        a: 0,
      }
      for (let k = grid.neighborOffsets[b]; k < grid.neighborOffsets[b + 1]; k++) {
        const a = grid.neighbors[k]
        if (a === up || riverTo[a] !== b || !isRiver(a)) continue
        const s0 = midKnot(a, b)
        const j: Knot = { ...join, w: s0.w, a: s0.a }
        const m: Knot = { p: s0.p.clone().add(j.p).normalize(), r: (s0.r + j.r) / 2, w: s0.w, a: s0.a }
        emit(s0, m, j, false, false)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(side), 3))
  geometry.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(data), 3))
  geometry.setIndex(index)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.02)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunObj: { value: SUN_DIRECTION.clone() },
      uDaylight: sunUniforms.uDaylight,
      uCamObj: { value: new THREE.Vector3(0, 0, 3) },
      uSunColor: { value: SUN_COLOR.clone() },
      uPixel: { value: 0.001 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSide;
      attribute vec3 aData; // across (-1|1), half width, alpha
      uniform float uPixel; // world size of a pixel at unit view depth
      varying float vAcross;
      varying float vSoft;
      varying float vAlpha;
      varying vec3 vObjPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float pix = -mv.z * uPixel;
        float hw = max(aData.y, 0.6 * pix);
        vAlpha = aData.z * min(1.0, aData.y / hw);
        float outer = hw + 0.5 * pix;
        vAcross = aData.x;
        vSoft = min(1.0, pix / outer);
        vec3 p = position + aSide * aData.x * outer;
        vObjPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform float uDaylight; // 1: daylight everywhere (sun.ts)
      uniform vec3 uCamObj;
      uniform vec3 uSunColor;
      varying float vAcross;
      varying float vSoft;
      varying float vAlpha;
      varying vec3 vObjPos;
      void main() {
        vec3 up = normalize(vObjPos);
        vec3 V = normalize(uCamObj - vObjPos);
        float limb = smoothstep(0.05, 0.35, dot(up, V));
        float edge = 1.0 - smoothstep(1.0 - vSoft, 1.0, abs(vAcross));
        float mu = mix(dot(up, normalize(uSunObj)), 0.92, uDaylight);
        float day = smoothstep(-0.12, 0.12, mu);
        vec3 water = vec3(0.022, 0.150, 0.230);
        vec3 col = water * (uSunColor * max(mu, 0.0) * day + vec3(0.02, 0.03, 0.05));
        float a = vAlpha * edge * limb;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })

  const lines = new THREE.Mesh(geometry, material)
  lines.renderOrder = 2
  const tmpQ = new THREE.Quaternion()

  return {
    lines,
    update(camera: THREE.PerspectiveCamera, viewportHeight: number) {
      lines.updateWorldMatrix(true, false)
      lines.getWorldQuaternion(tmpQ).invert()
      ;(material.uniforms.uSunObj.value as THREE.Vector3).copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      const cam = material.uniforms.uCamObj.value as THREE.Vector3
      camera.getWorldPosition(cam)
      lines.worldToLocal(cam)
      material.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, viewportHeight)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
