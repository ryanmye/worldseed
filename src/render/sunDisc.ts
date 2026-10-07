// The sun itself, drawn in the sky at the sun's direction at infinity (SUN_DIRECTION, sun.ts):
// a small white-hot disc (about the real sun's 0.53 degrees across), a warm glow around it
// that falls off smoothly, a faint horizontal glare streak, and the sunrise over the limb:
// a thin bright arc along the planet's edge where the sun is just behind it.
//
// One quad facing the camera, placed on the CPU each drawn frame (update(), from main.ts draw)
// at a fixed distance from the camera along the sun's direction, so three's frustum culling
// drops it (no draw call) when the sun is behind the camera; it is also hidden (no draw
// call) while the sun is well behind the planet, on the flat map, and with daylight
// everywhere. Nothing runs between drawn frames.
//
// Occlusion by the planet: the quad is depth-tested against the depth buffer (the globe,
// the terrain, the 3D towns: never drawn over the planet), and each fragment's ray is also
// tested against the planet's sphere in the shader (for a ray that misses the ground, the
// closest approach to the planet's centre gives the path through the air: the disc and its
// glow are reddened and dimmed there, and the limb arc is lit). The lens-like parts (the wide
// halo and the streak) scale with the visible part of the disc, worked out on the CPU from
// the planet's angular radius, so they go out as the sun sets behind the limb while the
// glow and arc hugging the edge stay: the sunrise-over-the-limb look from the night side.
//
// Drawn after the atmosphere (renderOrder 10.5): in the city view the low sky covers what lies
// behind it, and the sun has to show through it as a disc near the horizon.

import * as THREE from 'three'
import { PLANET_RADIUS } from './globe.ts'
import { SUN_DIRECTION, sunUniforms } from './sun.ts'
import { flat } from './mapProjection.ts'

/** The sun's angular radius (radians): the real sun's, seen from about one astronomical unit. */
const SUN_RADIUS = 0.0046
/** Angular half-size of the quad (radians): the glow and the limb arc fit inside. */
const QUAD_RADIUS = 0.22
/** Distance of the quad from the camera: beyond everything in the scene, inside the far plane. */
const QUAD_DISTANCE = 150

export interface SunDisc {
  mesh: THREE.Mesh
  /** Per drawn frame, after the sun and the camera are placed. */
  update(camera: THREE.PerspectiveCamera, drawHeightPx: number): void
  dispose(): void
}

export function buildSunDisc(): SunDisc {
  const geometry = new THREE.PlaneGeometry(2, 2)
  const uniforms = {
    uSun: { value: SUN_DIRECTION.clone() },
    /** Disc angular radius (at least a couple of pixels) and radians per pixel. */
    uDisc: { value: new THREE.Vector2(SUN_RADIUS, 0.001) },
    /** Visible part of the disc (0 behind the planet .. 1 clear of it). */
    uVis: { value: 1 },
    /** Limb arc strength (the sun just behind or just past the planet's edge). */
    uGraze: { value: 0 },
    /** The wider glow: the sun at most a few degrees behind the edge. */
    uNear: { value: 1 },
    /** 0 with the camera low in the air (the city view) .. 1 from above the air. */
    uSpace: { value: 1 },
    /** Fades out toward the flat map. */
    uFade: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vQuad;
      void main() {
        vQuad = position.xy;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec2 uDisc;
      uniform float uVis;
      uniform float uGraze;
      uniform float uNear;
      uniform float uFade;
      uniform float uSpace;
      varying vec3 vWorld;
      varying vec2 vQuad;
      const float RP = ${PLANET_RADIUS.toFixed(4)};
      const float H = 0.011;
      const vec3 BETA = vec3(1.0, 2.4, 5.8);
      void main() {
        float qr = length(vQuad);
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        // the ray's closest approach to the planet's centre (in front of the camera, else the camera)
        float tc = -dot(ro, rd);
        vec3 q = tc > 0.0 ? ro + rd * tc : ro;
        float rq = length(q);
        if (qr > 1.0 || rq < RP) {
          // (outside the glow's circle, or the ray hits the planet)
          gl_FragColor = vec4(0.0);
          return;
        }
        float th = acos(clamp(dot(rd, uSun), -1.0, 1.0));
        float rs = uDisc.x, px = uDisc.y;
        // the air along the ray: reddened and dimmed through the limb, near the horizon from low down
        float alt = rq - RP;
        // (a grazing ray from space: the whole path through the limb; from low down, inside
        // the air: from the camera up to the sky, by the ray's elevation; blended by the
        // camera's height, so the horizon below the camera's level shows no seam)
        float airSpace = tc > 0.0 ? 24.0 : min(1.0 / (max(dot(q / rq, rd), 0.0) + 0.035), 28.0);
        float camR = length(ro);
        float airLow = min(1.0 / (max(dot(ro / camR, rd), 0.0) + 0.035), 28.0);
        float odSpace = exp(-alt / H) * airSpace;
        float odLow = exp(-max(camR - RP, 0.0) / H) * airLow;
        vec3 tr = exp(-BETA * mix(odLow, odSpace, uSpace) * H * 3.0);
        // the disc (limb-darkened, antialiased) and its glow
        float disc = 1.0 - smoothstep(rs - px, rs + px, th);
        float mu = sqrt(max(0.0, 1.0 - (th * th) / (rs * rs)));
        vec3 col = vec3(1.0, 0.97, 0.9) * 7.0 * disc * (0.55 + 0.45 * mu);
        col += vec3(1.0, 0.8, 0.56) * (1.1 * exp(-th / (rs * 1.8)) + 0.3 * uNear * exp(-th / (rs * 7.0)));
        // lens-like halo and a faint horizontal streak: only while the disc is in view
        float streak = exp(-abs(vQuad.y) * ${QUAD_RADIUS.toFixed(3)} / (px * 1.6)) * exp(-abs(vQuad.x) * 5.0);
        col += uVis * (vec3(1.0, 0.74, 0.45) * 0.13 * exp(-th / 0.05) + vec3(1.0, 0.85, 0.7) * 0.22 * streak);
        col *= tr;
        // sunrise over the limb: the thin lit edge of the air nearest the sun, laid over the
        // atmosphere's blue limb (alpha: it covers part of what is behind, the rest adds)
        float cover = 0.0;
        if (tc > 0.0 && uGraze * uSpace > 0.0) {
          float rim = exp(-alt / 0.008) * exp(-(th * th) / (0.11 * 0.11)) * uGraze * uSpace;
          col += mix(vec3(1.0, 0.3, 0.06), vec3(1.0, 0.66, 0.36), smoothstep(0.0, 0.02, alt)) * rim * 1.8;
          cover = min(0.75, rim);
        }
        float k = uFade * (1.0 - smoothstep(0.7, 1.0, qr));
        gl_FragColor = vec4(col * k, cover * k);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // premultiplied: colour adds, alpha covers (only the limb arc has any)
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'sun'
  mesh.renderOrder = 10.5 // after the atmosphere (10)
  const camPos = new THREE.Vector3()
  const toCentre = new THREE.Vector3()
  return {
    mesh,
    update(camera, drawHeightPx) {
      const fade = 1 - Math.min(1, flat.t / 0.25)
      uniforms.uFade.value = fade
      camera.updateMatrixWorld()
      camera.getWorldPosition(camPos)
      const d = camPos.length()
      uniforms.uSpace.value = THREE.MathUtils.smoothstep(d - PLANET_RADIUS, 0.02, 0.06)
      // the planet's angular radius, and how far the sun's centre lies outside it (negative: behind)
      const alpha = Math.asin(Math.min(1, PLANET_RADIUS / d))
      toCentre.copy(camPos).multiplyScalar(-1 / d)
      const m = Math.acos(Math.max(-1, Math.min(1, SUN_DIRECTION.dot(toCentre)))) - alpha
      const px = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawHeightPx)
      const rs = Math.max(SUN_RADIUS, 2.2 * px)
      uniforms.uDisc.value.set(rs, px)
      uniforms.uVis.value = THREE.MathUtils.smoothstep(m, -rs, rs)
      uniforms.uNear.value = THREE.MathUtils.smoothstep(m, -0.05, 0)
      // strongest with the sun just behind the edge; gone well behind it or well clear of it
      uniforms.uGraze.value = THREE.MathUtils.smoothstep(m, -0.16, -0.01) * (1 - THREE.MathUtils.smoothstep(m, 0.0, 0.08))
      // (a sun far behind the planet lights nothing in view: no draw call)
      mesh.visible = fade > 0 && sunUniforms.uDaylight.value < 0.5 && m > -0.2
      if (!mesh.visible) return
      uniforms.uSun.value.copy(SUN_DIRECTION)
      mesh.position.copy(camPos).addScaledVector(SUN_DIRECTION, QUAD_DISTANCE)
      // facing the camera square on, its x along the screen's horizontal (the streak)
      const e = camera.matrixWorld.elements
      mesh.up.set(e[4], e[5], e[6])
      mesh.lookAt(camPos)
      mesh.scale.setScalar(QUAD_DISTANCE * Math.tan(QUAD_RADIUS))
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
