// Ports, dams and forts: small crisp icons, one instanced screen-space quad per structure,
// all drawn in a single call. Everything is static per history (position, an
// orientation on the surface, built and lost years, type); which icons show, the
// build animation and the fade after loss are functions of per-frame uniforms, so
// nothing is uploaded during playback and scrubbing is exact.
//
//  - A port is an anchor badge on the seaward side of its settlement's cell.
//  - A dam is a short bar across its river, just below a small reservoir. The
//    reservoir itself is water drawn by the planet shader: this layer only works out
//    which cells hold it (`reservoirs`), for GlobeMesh.setReservoirs.
//  - A fort (polities v2) is a small crenellated tower on its border cell, from mid zoom
//    in (sooner than ports and dams: there are few of them and they mark the frontiers);
//    no 3D model stands in for it up close, so it does not yield to the dioramas. (Walls
//    are drawn by the 3D towns, not here.)
//
// Icons scale with the on-screen size of a grid cell: hidden at full-globe zoom,
// clear when zoomed in. They are culled on the far side and fade at the limb.

import * as THREE from 'three'
import { RIVER_FLOW_THRESHOLD, StructureType, type Settlement, type Structure, type World } from '../contract.ts'
import { isWaterCell, lakeArray, PLANET_RADIUS, SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'

/** Height of icon anchors above the ground (settlement markers sit at 0.004). */
const LIFT = 0.0036
const NEVER = 1e9
/** Port badge distance from its cell centre toward the sea, in cell spacings (the shore is about halfway). */
const PORT_OFFSET = 0.55
/** Where along upstream cell -> dam cell the bar sits (matches the reservoir contour, see reservoirs). */
const DAM_ALONG = 0.4
/** Reservoir strength of the upstream cell, and of the dam's own cell (which pulls the pool toward the bar). */
const POOL_STRENGTH = 0.8
const DAM_CELL_POOL = 0.25

export interface ReservoirCells {
  cells: Int32Array
  built: Float32Array
  lost: Float32Array
  strength: Float32Array
}

export interface StructureLayer {
  mesh: THREE.Mesh
  /** Cells holding reservoir water, for GlobeMesh.setReservoirs. */
  reservoirs: ReservoirCells
  /** Per frame: continuous year and the build-animation length in years. */
  setTime(year: number, animYears: number): void
  /** Per frame: camera/sun in object space and viewport size. */
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Where each drawn structure sits (xyz per entry of `list`) and its seaward / downstream tangent, for the diorama layer. */
  placements: { list: Structure[]; pos: Float32Array; dir: Float32Array }
  /** Fade icons out within camera distance near..far (where models take over); far <= 0 turns it off. */
  setYield(near: number, far: number): void
  dispose(): void
}

export function buildStructureLayer(world: World, structures: Structure[], settlements: Settlement[]): StructureLayer {
  const { positions: P, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const lake = lakeArray(world)
  const water = (i: number) => isWaterCell(world, lake, i)
  const cellSpacing = Math.sqrt((4 * Math.PI) / cellCount)

  const list = structures.filter((st) => st.cell >= 0 && st.cell < cellCount && (st.type === StructureType.Port || st.type === StructureType.Dam || st.type === StructureType.Fort))
  const n = list.length
  const aPos = new Float32Array(Math.max(1, n) * 3)
  const aDir = new Float32Array(Math.max(1, n) * 3)
  const aInfo = new Float32Array(Math.max(1, n) * 4)

  const resCells: number[] = []
  const resBuilt: number[] = []
  const resLost: number[] = []
  const resStrength: number[] = []
  const resAt = new Map<number, number>()
  const addReservoir = (cell: number, st: Structure, strength: number) => {
    const k = resAt.get(cell)
    if (k !== undefined) {
      // shared by two dams: keep the stronger pool
      if (strength > resStrength[k]) {
        resBuilt[k] = st.builtYear
        resLost[k] = st.lostYear
        resStrength[k] = strength
      }
      return
    }
    resAt.set(cell, resCells.length)
    resCells.push(cell)
    resBuilt.push(st.builtYear)
    resLost.push(st.lostYear)
    resStrength.push(strength)
  }

  /** Whether a settlement lives on `cell` at some time while `st` stands (a pool there would drown it). */
  const occupied = (cell: number, st: Structure) => {
    const end = st.lostYear >= 0 ? st.lostYear : NEVER
    for (const s of settlements) {
      if (s.cell !== cell) continue
      const gone = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
      if (s.foundedYear < end && gone > st.builtYear) return true
    }
    return false
  }

  const c = new THREE.Vector3(), d = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3()
  const unit = (i: number, out: THREE.Vector3) => out.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
  /** Tangent at unit vector `at` pointing toward unit vector `to`, normalised (zero if they coincide). */
  const tangentToward = (at: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3) => {
    out.copy(to).addScaledVector(at, -to.dot(at))
    const l = out.length()
    return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(0, 0, 0)
  }

  for (let k = 0; k < n; k++) {
    const st = list[k]
    const cell = st.cell
    unit(cell, c)
    let r = surfaceRadius(world, cell)
    if (st.type === StructureType.Fort) {
      // on its cell, upright
      aPos.set([c.x * (r + LIFT), c.y * (r + LIFT), c.z * (r + LIFT)], k * 3)
      aDir.set([0, 0, 0], k * 3)
    } else if (st.type === StructureType.Port) {
      // seaward: mean direction to the open-water neighbours
      d.set(0, 0, 0)
      for (let e = off[cell]; e < off[cell + 1]; e++) {
        const j = nb[e]
        if (world.elevation[j] < 0) d.add(tangentToward(c, unit(j, u), t))
      }
      if (d.lengthSq() < 1e-12) for (let e = off[cell]; e < off[cell + 1]; e++) if (water(nb[e])) d.add(tangentToward(c, unit(nb[e], u), t))
      if (d.lengthSq() < 1e-12) d.set(0, 1, 0).addScaledVector(c, -c.y)
      d.normalize()
      t.copy(c).addScaledVector(d, PORT_OFFSET * cellSpacing).normalize()
      r = PLANET_RADIUS // at the shore
      aPos.set([t.x * (r + LIFT), t.y * (r + LIFT), t.z * (r + LIFT)], k * 3)
      aDir.set([d.x, d.y, d.z], k * 3)
    } else {
      // The pool sits on the main upstream river cell (never on an inhabited cell), the bar
      // just below it. A dam at a lake outlet needs no pool: the lake is its reservoir.
      const own = st.settlement
      let up = -1
      for (let e = off[cell]; e < off[cell + 1]; e++) {
        const j = nb[e]
        if (world.riverTo[j] !== cell) continue
        if (up < 0 || world.flow[j] > world.flow[up]) up = j
      }
      const ownCell = own >= 0 && own < settlements.length ? settlements[own].cell : -1
      const upIsLake = up >= 0 && lake !== null && lake[up] === 1
      const upIsRiver = up >= 0 && !water(up) && world.flow[up] >= RIVER_FLOW_THRESHOLD
      if (upIsLake) {
        // across the outflow, at the lake shore
        unit(up, u)
        d.copy(c).sub(u)
        c.copy(u).lerp(unit(cell, t), 0.55).normalize()
      } else {
        const a = upIsRiver && up !== ownCell && !occupied(up, st) ? up : cell
        const b = a === cell ? world.riverTo[cell] : cell
        if (a !== ownCell && !occupied(a, st) && b >= 0 && !water(b)) {
          addReservoir(a, st, POOL_STRENGTH)
          addReservoir(b, st, DAM_CELL_POOL)
          unit(a, u)
          unit(b, t)
          d.copy(t).sub(u) // downstream
          const ra = surfaceRadius(world, a), rb = surfaceRadius(world, b)
          c.copy(u).lerp(t, DAM_ALONG).normalize()
          r = ra + (rb - ra) * DAM_ALONG
        } else {
          // nowhere sensible for a pool (it would drown someone): just the bar on the dam cell
          const down = world.riverTo[cell]
          if (down >= 0) d.copy(unit(down, t)).sub(c)
          else d.set(1, 0, 0)
        }
      }
      tangentToward(c, d.add(c), d)
      if (d.lengthSq() < 1e-12) d.set(1, 0, 0)
      aPos.set([c.x * (r + LIFT), c.y * (r + LIFT), c.z * (r + LIFT)], k * 3)
      aDir.set([d.x, d.y, d.z], k * 3)
    }
    aInfo[k * 4] = st.builtYear
    aInfo[k * 4 + 1] = st.lostYear >= 0 ? st.lostYear : NEVER
    aInfo[k * 4 + 2] = st.type
    aInfo[k * 4 + 3] = 0
  }

  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3))
  quad.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 3))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(aInfo, 4))
  quad.instanceCount = n

  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uAnimYears: { value: 20 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uCellSpacing: { value: cellSpacing },
    uYield: { value: new THREE.Vector2(0, 0) },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec3 aDir;
      attribute vec4 aInfo; // built year, lost year, type (0 port, 1 dam, 3 fort)
      uniform float uYear;
      uniform float uAnimYears;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight; // 1: daylight everywhere (sun.ts)
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform vec2 uViewport;
      uniform float uCellSpacing;
      uniform vec2 uYield;
      varying vec2 vPx;
      varying vec2 vSize;
      varying float vType;
      varying float vAlpha;
      varying float vBuild;
      varying float vRuin;
      varying float vNight;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        float built = aInfo.x;
        float lost = aInfo.y;
        vec3 up = normalize(aPosR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
        float age = uYear - built;
        float gone = uYear - lost;
        vec4 mv = modelViewMatrix * vec4(ws_place(aPosR), 1.0);
        // on-screen size of a grid cell here, in CSS pixels
        float cellPx = uCellSpacing / max(-mv.z * uPixel, 1e-9) / uPixelRatio;
        float zoomA = aInfo.z > 2.5 ? smoothstep(8.0, 15.0, cellPx) : smoothstep(13.0, 24.0, cellPx);
        if (age < 0.0 || gone > uAnimYears || facing <= 0.0 || zoomA <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vType = aInfo.z;
        float b = clamp(age / uAnimYears, 0.0, 1.0);
        vBuild = b;
        vRuin = clamp(gone / uAnimYears, 0.0, 1.0) * step(0.0, gone);
        // pop in with a slight overshoot
        float c1 = 1.70158;
        float e = b - 1.0;
        float pop = b >= 1.0 ? 1.0 : 1.0 + (c1 + 1.0) * e * e * e + c1 * e * e;
        vec2 size;
        if (vType > 2.5) {
          float R = clamp(0.2 * cellPx, 5.0, 10.0);
          size = vec2(R, R);
        } else if (vType < 0.5) {
          float R = clamp(0.19 * cellPx, 3.2, 9.0);
          size = vec2(R, R);
        } else {
          size = vec2(clamp(0.2 * cellPx, 3.5, 10.0), clamp(0.04 * cellPx, 1.25, 2.4));
        }
        size *= max(pop, 0.0) * mix(0.6, 1.0, sqrt(facing));
        vSize = size;
        float ext = max(size.x, size.y) + 3.0;
        if (b < 1.0) ext = max(ext, size.x * 2.6 + 3.0); // room for the build ring
        // the quad's x axis runs across the river (dams); ports stay upright
        vec2 ax = vec2(1.0, 0.0);
        if (vType > 0.5 && vType < 2.5) {
          vec4 clip0 = projectionMatrix * mv;
          vec4 clip1 = projectionMatrix * modelViewMatrix * vec4(ws_place(aPosR + aDir * 0.005), 1.0);
          vec2 dd = (clip1.xy / clip1.w - clip0.xy / clip0.w) * uViewport;
          vec2 fwd = length(dd) > 1e-6 ? normalize(dd) : vec2(0.0, 1.0);
          ax = vec2(fwd.y, -fwd.x);
        }
        vec2 ay = vec2(-ax.y, ax.x);
        vec2 offPx = (ax * position.x + ay * position.y) * ext;
        vec4 clip = projectionMatrix * mv;
        clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vAlpha = zoomA * smoothstep(0.0, 0.3, facing) * (1.0 - vRuin);
        // up close the dock or dam model stands in for the icon
        if (uYield.y > 0.0 && vType < 2.5) vAlpha *= smoothstep(uYield.x, uYield.y, length(uCamObj - aPosR));
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying vec2 vSize;
      varying float vType;
      varying float vAlpha;
      varying float vBuild;
      varying float vRuin;
      varying float vNight;
      float sdBoxS(vec2 p, vec2 b) {
        vec2 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }
      float sdSeg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }
      // anchor glyph of radius R centred at the origin: distance to its stroke centre lines
      float sdAnchor(vec2 p, float R) {
        float ring = abs(length(p - vec2(0.0, 0.52 * R)) - 0.15 * R);
        float shaft = sdSeg(p, vec2(0.0, 0.37 * R), vec2(0.0, -0.62 * R));
        float bar = sdSeg(p, vec2(-0.3 * R, 0.2 * R), vec2(0.3 * R, 0.2 * R));
        vec2 q = p - vec2(0.0, -0.08 * R);
        float r = 0.52 * R;
        // lower arc of the arms, ending in small flukes
        float arc = q.y < -0.12 * R ? abs(length(q) - r) : min(length(q - vec2(-r * 0.99, -0.12 * R)), length(q - vec2(r * 0.99, -0.12 * R)));
        float flukes = min(sdSeg(p, vec2(-0.52 * R, -0.2 * R), vec2(-0.66 * R, -0.04 * R)), sdSeg(p, vec2(0.52 * R, -0.2 * R), vec2(0.66 * R, -0.04 * R)));
        return min(min(ring, shaft), min(min(bar, arc), flukes));
      }
      void main() {
        vec3 c = vec3(0.0);
        float a = 0.0;
        float rimD; // signed distance of the icon body, for the build ring
        if (vType > 2.5) {
          // a fort: a stone tower with three merlons, a dark door, a dark outline
          float R = vSize.x;
          vec2 p = vPx;
          float body = sdBoxS(p - vec2(0.0, -0.18 * R), vec2(0.42 * R, 0.62 * R));
          float m0 = sdBoxS(p - vec2(-0.32 * R, 0.56 * R), vec2(0.13 * R, 0.16 * R));
          float m1 = sdBoxS(p - vec2(0.0, 0.56 * R), vec2(0.13 * R, 0.16 * R));
          float m2 = sdBoxS(p - vec2(0.32 * R, 0.56 * R), vec2(0.13 * R, 0.16 * R));
          float d = min(body, min(m0, min(m1, m2)));
          float door = sdBoxS(p - vec2(0.0, -0.58 * R), vec2(0.13 * R, 0.22 * R));
          float outline = 1.0 - smoothstep(0.6, 1.6, d);
          float fill = 1.0 - smoothstep(-0.5, 0.4, d);
          vec3 stone = mix(vec3(0.62, 0.57, 0.5), vec3(0.88, 0.84, 0.76), smoothstep(-0.8 * R, 0.6 * R, p.y));
          stone = mix(stone, vec3(0.12, 0.1, 0.08), 1.0 - smoothstep(-0.4, 0.4, door));
          c = mix(vec3(0.08, 0.07, 0.06), stone, fill) * outline;
          a = outline;
          rimD = d;
        } else if (vType < 0.5) {
          float R = vSize.x;
          float d = length(vPx) - R;
          float bodyA = 1.0 - smoothstep(-0.5, 0.5, d);
          float rim = smoothstep(-1.6, -0.6, d);
          float sw = max(1.15, 0.14 * R);
          float glyph = 1.0 - smoothstep(sw * 0.5 - 0.5, sw * 0.5 + 0.5, sdAnchor(vPx, R * 0.82));
          vec3 badge = mix(vec3(0.05, 0.11, 0.20), vec3(0.82, 0.88, 0.95), rim);
          vec3 bodyC = mix(badge, vec3(0.94, 0.96, 1.0), glyph * (1.0 - rim));
          c = bodyC * bodyA;
          a = bodyA;
          rimD = d;
        } else {
          // a concrete bar across the river with a dark outline and a hint of shadow
          vec2 h = vSize;
          vec2 q = abs(vPx) - h;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.35;
          float outline = 1.0 - smoothstep(0.6, 1.5, d);
          float body = 1.0 - smoothstep(-0.5, 0.4, d);
          vec3 concrete = mix(vec3(0.70, 0.68, 0.64), vec3(0.93, 0.91, 0.87), smoothstep(-h.y, h.y, vPx.y));
          vec3 bodyC = mix(vec3(0.10, 0.09, 0.08), concrete, body);
          c = bodyC * outline;
          a = outline;
          rimD = d;
        }
        // build ring: expands and fades over the build animation
        if (vBuild < 1.0) {
          float ringR = max(vSize.x, 2.0) * (0.6 + 1.9 * vBuild);
          float ring = (1.0 - smoothstep(0.5, 1.6, abs(length(vPx) - ringR))) * pow(1.0 - vBuild, 1.3) * 0.9;
          vec3 rc = vType < 0.5 ? vec3(0.75, 0.9, 1.0) : vType > 2.5 ? vec3(1.0, 0.85, 0.6) : vec3(1.0, 0.95, 0.85);
          c = c + rc * ring * (1.0 - a);
          a = a + ring * (1.0 - a);
        }
        // falling into ruin: greys out as it fades
        float lum = dot(c, vec3(0.3, 0.55, 0.15));
        c = mix(c, vec3(lum) * 0.8, vRuin);
        float k = vAlpha * mix(1.0, 0.6, vNight);
        c *= k;
        a *= k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
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
  mesh.renderOrder = 8.5 // over the settlement markers, under travelling groups
  mesh.visible = n > 0

  const tmpQ = new THREE.Quaternion()
  return {
    mesh,
    reservoirs: {
      cells: Int32Array.from(resCells),
      built: Float32Array.from(resBuilt),
      lost: Float32Array.from(resLost),
      strength: Float32Array.from(resStrength),
    },
    placements: { list, pos: aPos, dir: aDir },
    setYield(near: number, far: number) {
      uniforms.uYield.value.set(near, far)
    },
    setTime(year: number, animYears: number) {
      uniforms.uYear.value = year
      uniforms.uAnimYears.value = Math.max(1e-3, animYears)
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(uniforms.uCamObj.value)
      mesh.worldToLocal(uniforms.uCamObj.value)
      uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      uniforms.uPixelRatio.value = pixelRatio
      uniforms.uViewport.value.copy(drawSize)
    },
    dispose() {
      quad.dispose()
      material.dispose()
    },
  }
}
