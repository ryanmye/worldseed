// The flat map's frame: a thin neatline along the edge of the map (the antimeridian of the
// view and the clip latitudes near the poles), a graticule every 30 degrees, and a matte in
// the background colour all around the map, over whatever of the planet's triangles hangs
// past the edge (the planet shader itself has no clip, so the globe draws exactly as before).
// Lines in planet space through the shared projection (mapProjection.ts); shown only on the
// map (they fade in over the end of the morph). Add the three objects to the planet group.

import * as THREE from 'three'
import { RELIEF_GLSL } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'

export interface MapFrame {
  graticule: THREE.LineSegments
  neatline: THREE.LineSegments
  matte: THREE.Mesh
  /** The matte's colour: the background of the moment (linear). */
  setBackground(c: THREE.Color): void
  dispose(): void
}

const STEP = Math.PI / 90 // 2 degrees per segment

export function buildMapFrame(): MapFrame {
  // position: (longitude or map longitude, latitude or a fraction of the clip latitude, kind)
  //   kind 0: meridian at an absolute longitude, latitude as a fraction of the clip latitude
  //   kind 1: parallel, map longitude (from the central meridian), absolute latitude
  //   kind 2: neatline, map longitude, latitude as a fraction of the clip latitude
  const g: number[] = []
  const seg = (a: number[], b: number[]) => g.push(...a, ...b)
  for (let k = -5; k <= 6; k++) {
    const lon = (k * Math.PI) / 6
    const n = 60
    for (let i = 0; i < n; i++) seg([lon, -1 + (2 * i) / n, 0], [lon, -1 + (2 * (i + 1)) / n, 0])
  }
  for (let k = -2; k <= 2; k++) {
    const lat = (k * Math.PI) / 6
    for (let l = -Math.PI; l < Math.PI - 1e-6; l += STEP) seg([l, lat, 1], [Math.min(Math.PI, l + STEP), lat, 1])
  }
  const nl: number[] = []
  const nseg = (a: number[], b: number[]) => nl.push(...a, ...b)
  for (const side of [-1, 1]) {
    const n = 60
    for (let i = 0; i < n; i++) nseg([side * Math.PI, -1 + (2 * i) / n, 2], [side * Math.PI, -1 + (2 * (i + 1)) / n, 2])
    for (let l = -Math.PI; l < Math.PI - 1e-6; l += STEP) nseg([l, side, 2], [Math.min(Math.PI, l + STEP), side, 2])
  }
  const geo = (a: number[]) => {
    const gm = new THREE.BufferGeometry()
    gm.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(a), 3))
    gm.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3)
    return gm
  }
  const material = (color: THREE.Color, alpha: number) =>
    new THREE.ShaderMaterial({
      uniforms: { ...flatUniforms, uColor: { value: color }, uAlpha: { value: alpha } },
      vertexShader: /* glsl */ `
        ${RELIEF_GLSL}
        varying float vA;
        void main() {
          float kind = position.z;
          float lat = kind > 0.5 && kind < 1.5 ? position.y : position.y * uMapCentre.z;
          float lam = position.x;
          vA = smoothstep(0.5, 1.0, uFlat);
          if (kind < 0.5) {
            lam -= uMapCentre.x;
            lam -= WS_TAU * floor((lam + WS_PI) / WS_TAU);
            // a meridian on the edge of the map: the neatline is there
            if (abs(lam) > WS_PI - 0.004) vA = 0.0;
          }
          if (vA <= 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          float lon = lam + uMapCentre.x;
          vec3 pS = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)) * 1.0005;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(pS, ws_mapAt(pS, lam), uFlat), 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying float vA;
        void main() {
          gl_FragColor = vec4(uColor, uAlpha * vA);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  const gratMat = material(new THREE.Color(0.78, 0.84, 0.9), 0.2)
  const neatMat = material(new THREE.Color(0.86, 0.82, 0.72), 0.85)
  const graticule = new THREE.LineSegments(geo(g), gratMat)
  graticule.name = 'map graticule'
  graticule.renderOrder = 1.95 // over the planet and the faction tint, under the rivers (2)
  graticule.frustumCulled = false
  graticule.visible = false
  const neatline = new THREE.LineSegments(geo(nl), neatMat)
  neatline.name = 'map neatline'
  neatline.renderOrder = 9.7 // over every overlay near the edge
  neatline.frustumCulled = false
  neatline.visible = false
  // matte: a ring from the map's outline (map longitude +-pi, the clip latitudes) far out
  // position: (map longitude, latitude as a fraction of the clip latitude, 0 on the outline | 1 far out)
  const outline: [number, number][] = []
  const n = 60
  for (let i = 0; i < n; i++) outline.push([-Math.PI, -1 + (2 * i) / n])
  for (let l = -Math.PI; l < Math.PI - 1e-6; l += STEP) outline.push([l, 1])
  for (let i = 0; i < n; i++) outline.push([Math.PI, 1 - (2 * i) / n])
  for (let l = Math.PI; l > -Math.PI + 1e-6; l -= STEP) outline.push([l, -1])
  const mp: number[] = []
  const mi: number[] = []
  outline.forEach(([l, f], i) => {
    mp.push(l, f, 0, l, f, 1)
    const j = (i + 1) % outline.length
    mi.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1)
  })
  const matteGeo = new THREE.BufferGeometry()
  matteGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mp), 3))
  matteGeo.setIndex(mi)
  matteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100)
  const matteMat = new THREE.ShaderMaterial({
    uniforms: { ...flatUniforms, uColor: { value: new THREE.Color() } },
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      varying float vA;
      void main() {
        vA = smoothstep(0.8, 1.0, uFlat);
        if (vA <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec2 m = ws_equalEarth(position.x, position.y * uMapCentre.z);
        if (position.z > 0.5) m = normalize(m) * 60.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(uMapBasis * vec3(m.x, m.y - uMapCentre.y, 1.02), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        gl_FragColor = vec4(uColor, vA);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const matte = new THREE.Mesh(matteGeo, matteMat)
  matte.name = 'map matte'
  matte.renderOrder = 1.85 // over the planet (and its seam copy) and the faction tint, under the graticule
  matte.frustumCulled = false
  matte.visible = false
  return {
    graticule,
    neatline,
    matte,
    setBackground(c: THREE.Color) {
      matteMat.uniforms.uColor.value.copy(c)
    },
    dispose() {
      graticule.geometry.dispose()
      neatline.geometry.dispose()
      matteGeo.dispose()
      gratMat.dispose()
      neatMat.dispose()
      matteMat.dispose()
    },
  }
}
