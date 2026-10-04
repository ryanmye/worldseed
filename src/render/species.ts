// Species on the globe (ui/speciesData.ts has the data):
//
//  - Origins: a small ringed dot in the species' colour at each place it is native to,
//    shown for the selected species, and for every species of the category the Crops or
//    Herds view shows.
//  - The exchange web: for the selected species, a faint arc from the giving people's
//    place to the taking people's for each adoption up to the current year, brighter
//    toward the taker and for a while after it happened.
//  - Where it is grown now: for the selected species, a soft disc on every cell whose main
//    crop (or herd) it is at the current land snapshot (on the views that do not already
//    colour the cells by species). The per-cell flags are uploaded when the land snapshot
//    or the selection changes.
//
// Origins and arcs are static per history (arcs per selection), and the year is a uniform:
// what is shown is a function of the year and the selection. A known-world mask hides what
// lies in cells the people whose world is shown did not know.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { sunUniforms } from './sun.ts'
import type { SpeciesData } from '../ui/speciesData.ts'

const NEVER = 1e9
const ARC_SEGMENTS = 40
const ARC_RECENT_YEARS = 60

export interface SpeciesLayer {
  object: THREE.Group
  /** The species shown (-1 none): its origins, its exchange arcs, where it is grown. */
  setSelected(species: number): void
  /** Origins of every species of this category (-1: none) are shown too (the Crops or Herds view). */
  setOriginCategory(category: number): void
  /** Cells growing the selected species now (1 per cell, length cellCount), or null to hide the discs. */
  setGrown(flags: Uint8Array | null): void
  setTime(year: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  setKnownMask(cellYear: Float32Array | null): void
  setOrder(order: number): void
  dispose(): void
}

const blend = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const

export function buildSpeciesLayer(world: World, d: SpeciesData): SpeciesLayer {
  const P = world.grid.positions
  const N = world.grid.cellCount
  const object = new THREE.Group()
  const shared = {
    uYear: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uMaskOn: { value: 0 },
    uSelected: { value: -1 },
  }
  let mask: Float32Array | null = null

  // ---------- origins ----------
  const oCells: number[] = [], oSpecies: number[] = []
  d.list.forEach((x, s) => {
    for (const c of x.origins ?? []) if (c >= 0 && c < N) { oCells.push(c); oSpecies.push(s) }
  })
  const no = oCells.length
  const oQuad = new THREE.InstancedBufferGeometry()
  oQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  oQuad.setIndex([0, 1, 2, 0, 2, 3])
  const oPos = new Float32Array(Math.max(1, no) * 3)
  const oInfo = new Float32Array(Math.max(1, no) * 2) // species, category
  const oCol = new Float32Array(Math.max(1, no) * 3)
  const oKnown = new Float32Array(Math.max(1, no))
  for (let k = 0; k < no; k++) {
    const c = oCells[k], s = oSpecies[k]
    const r = surfaceRadius(world, c) + 0.0045
    oPos.set([P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r], k * 3)
    oInfo[k * 2] = s
    oInfo[k * 2 + 1] = d.list[s].category
    oCol.set(d.rgb.subarray(s * 3, s * 3 + 3), k * 3)
  }
  const oKnownAttr = new THREE.InstancedBufferAttribute(oKnown, 1)
  oQuad.setAttribute('aPos', new THREE.InstancedBufferAttribute(oPos, 3))
  oQuad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(oInfo, 2))
  oQuad.setAttribute('aCol', new THREE.InstancedBufferAttribute(oCol, 3))
  oQuad.setAttribute('aKnown', oKnownAttr)
  oQuad.instanceCount = no
  const oUniforms = {
    ...shared,
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCategory: { value: -1 },
    uSizeScale: { value: 1 },
  }
  const originMaterial = new THREE.ShaderMaterial({
    uniforms: oUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec2 aInfo;
      attribute vec3 aCol;
      attribute float aKnown;
      uniform vec3 uCamObj;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform float uSelected;
      uniform float uCategory;
      uniform float uSizeScale;
      uniform float uMaskOn;
      uniform float uYear;
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vSel = abs(aInfo.x - uSelected) < 0.5 ? 1.0 : 0.0;
        bool shown = vSel > 0.5 || abs(aInfo.y - uCategory) < 0.5;
        if (uMaskOn > 0.5 && uYear < aKnown) shown = false;
        vec3 up = normalize(aPos);
        float facing = dot(up, normalize(uCamObj - aPos));
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float r = (vSel > 0.5 ? 6.5 : 4.6) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r + 6.0;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPos, 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vCol = aCol;
        vAlpha = smoothstep(0.0, 0.3, facing);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vSel;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        float d = length(vPx);
        vec3 rim = vec3(0.05, 0.05, 0.06);
        // a ring and a core in the species' colour, on a dark halo
        float halo = (1.0 - smoothstep(vR + 0.8, vR + 2.2, d)) * 0.75;
        float ring = 1.0 - smoothstep(0.6, 1.5, abs(d - vR * 0.78));
        float core = 1.0 - smoothstep(vR * 0.32, vR * 0.32 + 1.0, d);
        vec3 c = rim * halo;
        float a = halo;
        c = vCol * ring + c * (1.0 - ring);
        a = ring + a * (1.0 - ring);
        c = vCol * core + c * (1.0 - core);
        a = core + a * (1.0 - core);
        float sr = vSel * (1.0 - smoothstep(0.5, 1.4, abs(d - vR - 3.0)));
        c = vec3(1.0) * sr + c * (1.0 - sr);
        a = sr + a * (1.0 - sr);
        c *= vAlpha;
        a *= vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
      }
    `,
    ...blend,
  })
  const origins = new THREE.Mesh(oQuad, originMaterial)
  origins.frustumCulled = false
  origins.renderOrder = 8.45
  origins.visible = no > 0
  object.add(origins)

  // ---------- exchange arcs (rebuilt per selection) ----------
  const arcUniforms = { ...shared, uColor: { value: new THREE.Vector3(1, 1, 1) } }
  const arcMaterial = new THREE.ShaderMaterial({
    uniforms: arcUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aArc; // along (0..1), year, known year (both ends)
      uniform float uYear;
      uniform vec3 uCamObj;
      uniform float uMaskOn;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying float vA;
      varying float vT;
      void main() {
        bool shown = uYear >= aArc.y;
        if (uMaskOn > 0.5 && uYear < aArc.z) shown = false;
        vec3 up = normalize(position);
        float facing = dot(up, normalize(uCamObj - position)) + 0.25; // lifted arcs show a little past the limb
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float recent = 1.0 - smoothstep(0.0, ${ARC_RECENT_YEARS.toFixed(1)}, uYear - aArc.y);
        vT = aArc.x;
        vA = mix(0.6, 1.0, recent) * smoothstep(0.0, 0.3, facing) * mix(0.5, 1.0, aArc.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      varying float vT;
      void main() {
        // the species' colour, paling toward the taker (it reads apart from the discs below)
        vec3 c = mix(uColor, vec3(1.0), 0.35 + 0.4 * vT);
        gl_FragColor = vec4(c * vA, vA);
      }
    `,
    ...blend,
  })
  let arcGeom = new THREE.BufferGeometry()
  const arcs = new THREE.LineSegments(arcGeom, arcMaterial)
  arcs.frustumCulled = false
  arcs.renderOrder = 8.1
  arcs.visible = false
  object.add(arcs)
  let selected = -1

  function buildArcs() {
    arcGeom.dispose()
    arcGeom = new THREE.BufferGeometry()
    arcs.geometry = arcGeom
    arcs.visible = false
    if (selected < 0) return
    const pos: number[] = [], info: number[] = []
    const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3()
    for (let k = 0; k < d.arcSpecies.length; k++) {
      if (d.arcSpecies[k] !== selected) continue
      const ca = d.arcFrom[k], cb = d.arcTo[k]
      if (ca === cb) continue
      a.set(P[ca * 3], P[ca * 3 + 1], P[ca * 3 + 2])
      b.set(P[cb * 3], P[cb * 3 + 1], P[cb * 3 + 2])
      const ang = a.angleTo(b)
      const lift = 0.014 + 0.15 * ang // even a hop between neighbours stands up as an arch
      const known = mask ? Math.max(mask[ca] ?? NEVER, mask[cb] ?? NEVER) : 0
      const at = (t: number, out: THREE.Vector3) => {
        // slerp, raised in a parabola over the ground
        const s = Math.sin(ang)
        out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s)
        return out.multiplyScalar(1.004 + lift * 4 * t * (1 - t))
      }
      for (let i = 0; i < ARC_SEGMENTS; i++) {
        at(i / ARC_SEGMENTS, p)
        at((i + 1) / ARC_SEGMENTS, q)
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z)
        info.push(i / ARC_SEGMENTS, d.arcYear[k], known, (i + 1) / ARC_SEGMENTS, d.arcYear[k], known)
      }
    }
    if (!pos.length) return
    arcGeom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3))
    arcGeom.setAttribute('aArc', new THREE.BufferAttribute(Float32Array.from(info), 3))
    arcs.visible = true
    arcUniforms.uColor.value.set(d.rgb[selected * 3], d.rgb[selected * 3 + 1], d.rgb[selected * 3 + 2])
  }

  // ---------- where it is grown (discs on land cells) ----------
  const landCells: number[] = []
  for (let c = 0; c < N; c++) if (world.elevation[c] >= 0) landCells.push(c)
  const nl = landCells.length
  const gQuad = new THREE.InstancedBufferGeometry()
  gQuad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  gQuad.setIndex([0, 1, 2, 0, 2, 3])
  const gPos = new Float32Array(Math.max(1, nl) * 3)
  for (let k = 0; k < nl; k++) {
    const c = landCells[k]
    const r = surfaceRadius(world, c) + 0.0025
    gPos.set([P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r], k * 3)
  }
  const gOn = new Float32Array(Math.max(1, nl))
  const gOnAttr = new THREE.InstancedBufferAttribute(gOn, 1)
  gQuad.setAttribute('aPos', new THREE.InstancedBufferAttribute(gPos, 3))
  gQuad.setAttribute('aOn', gOnAttr)
  gQuad.instanceCount = nl
  const cellRadius = Math.sqrt((4 * Math.PI) / N) * 0.62
  const gUniforms = { ...shared, uColor: arcUniforms.uColor, uRadius: { value: cellRadius } }
  const grownMaterial = new THREE.ShaderMaterial({
    uniforms: gUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute float aOn;
      uniform vec3 uCamObj;
      uniform float uRadius;
      uniform float uYear;
      uniform float uMaskOn;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying vec2 vUv;
      varying float vA;
      void main() {
        // aOn: 0 not grown; else grown, and (with the mask on) shown from that year
        bool on = aOn > 0.5 && (uMaskOn < 0.5 || uYear >= aOn);
        vec3 up = normalize(aPos);
        float facing = dot(up, normalize(uCamObj - aPos));
        if (!on || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        // a disc lying on the ground, a little smaller than its cell
        vec3 e = normalize(abs(up.y) > 0.95 ? cross(vec3(0.0, 0.0, 1.0), up) : cross(vec3(0.0, 1.0, 0.0), up));
        vec3 n = cross(up, e);
        vec3 p = aPos + (e * position.x + n * position.y) * uRadius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vUv = position.xy;
        float night = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vA = smoothstep(0.0, 0.25, facing) * mix(1.0, 0.6, night);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vA;
      void main() {
        // soft discs that run together into a tinted area where the species is grown
        float d = length(vUv);
        float a = (1.0 - smoothstep(0.55, 1.0, d)) * 0.36 * vA;
        if (a < 0.004) discard;
        vec3 c = uColor;
        gl_FragColor = vec4(c * a, a);
      }
    `,
    ...blend,
  })
  const grown = new THREE.Mesh(gQuad, grownMaterial)
  grown.frustumCulled = false
  grown.renderOrder = 4.8 // a tint on the ground: over the roads, under the clouds and every route
  grown.visible = false
  object.add(grown)
  let grownFlags: Uint8Array | null = null

  function writeGrown() {
    if (!grownFlags) {
      grown.visible = false
      return
    }
    for (let k = 0; k < nl; k++) {
      const c = landCells[k]
      gOn[k] = grownFlags[c] ? (mask ? Math.max(1, mask[c] ?? NEVER) : 1) : 0
    }
    gOnAttr.needsUpdate = true
    grown.visible = true
  }

  const tmpQ = new THREE.Quaternion()
  return {
    object,
    setSelected(s: number) {
      selected = s >= 0 && s < d.count ? s : -1
      shared.uSelected.value = selected
      buildArcs()
    },
    setOriginCategory(category: number) {
      oUniforms.uCategory.value = category
    },
    setGrown(flags: Uint8Array | null) {
      grownFlags = flags
      writeGrown()
    },
    setTime(year: number) {
      shared.uYear.value = year
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      shared.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(shared.uCamObj.value)
      object.worldToLocal(shared.uCamObj.value)
      oUniforms.uViewport.value.copy(drawSize)
      oUniforms.uPixelRatio.value = pixelRatio
      oUniforms.uSizeScale.value = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / camera.position.length())))
    },
    setKnownMask(cellYear: Float32Array | null) {
      mask = cellYear
      shared.uMaskOn.value = cellYear ? 1 : 0
      if (cellYear) {
        for (let k = 0; k < no; k++) oKnown[k] = cellYear[oCells[k]] ?? NEVER
        oKnownAttr.needsUpdate = true
      }
      buildArcs()
      writeGrown()
    },
    setOrder(order: number) {
      origins.renderOrder = order
    },
    dispose() {
      oQuad.dispose()
      originMaterial.dispose()
      arcGeom.dispose()
      arcMaterial.dispose()
      gQuad.dispose()
      grownMaterial.dispose()
    },
  }
}
