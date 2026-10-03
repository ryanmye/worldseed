// Atmosphere shell, starfield and optional cloud layer.

import * as THREE from 'three'
import { NOISE_GLSL } from './glsl.ts'
import { PLANET_RADIUS, SUN_COLOR, SUN_DIRECTION } from './globe.ts'

const ATMOSPHERE_RADIUS = PLANET_RADIUS * 1.06
const SCALE_HEIGHT = 0.011

export interface Atmosphere {
  mesh: THREE.Mesh
  setStrength(s: number): void
  dispose(): void
}

/**
 * Single-scattering approximation, ray-marched per pixel through an
 * exponential shell: blue Rayleigh in-scatter that is strong along the limb
 * (long path), a thin haze over the disc, reddened near the terminator and
 * absent on the night side. Composited as `inscatter + dst * transmittance`.
 */
export function buildAtmosphere(): Atmosphere {
  const geometry = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 64)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uStrength: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      uniform float uStrength;
      varying vec3 vWorld;

      const float RP = ${PLANET_RADIUS.toFixed(4)};
      const float RA = ${ATMOSPHERE_RADIUS.toFixed(4)};
      const float H = ${SCALE_HEIGHT.toFixed(4)};
      // Rayleigh-like extinction per unit length at sea level (blue scatters most).
      const vec3 BETA = vec3(1.0, 2.4, 5.8);

      vec2 raySphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float h = b * b - c;
        if (h < 0.0) return vec2(1e9, -1e9);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }

      // Optical depth from point p toward the sun, approximated from altitude and sun zenith.
      float sunDepth(float alt, float cosZ) {
        float airmass = 1.0 / (max(cosZ, 0.0) + 0.15 * exp(-max(-cosZ, 0.0) * 8.0) + 0.02);
        return exp(-alt / H) * H * min(airmass, 40.0);
      }

      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorld - ro);
        vec2 ta = raySphere(ro, rd, RA);
        if (ta.y <= 0.0) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tp = raySphere(ro, rd, RP);
        bool hitPlanet = tp.x > 0.0 && tp.x < t1;
        if (hitPlanet) t1 = tp.x;

        const int STEPS = 12;
        float ds = (t1 - t0) / float(STEPS);
        vec3 sum = vec3(0.0);
        float odView = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 q = ro + rd * (t0 + (float(i) + 0.5) * ds);
          float r = length(q);
          float alt = max(r - RP, 0.0);
          float dens = exp(-alt / H) * ds;
          odView += dens;
          vec3 up = q / r;
          float cosZ = dot(up, uSun);
          // planet shadow: soft cylinder behind the planet
          float along = dot(q, uSun);
          float perp = length(q - uSun * along);
          float lit = 1.0 - (1.0 - smoothstep(RP * 0.97, RP * 1.05, perp)) * smoothstep(0.0, 0.15, -along);
          vec3 trans = exp(-BETA * (odView + sunDepth(alt, cosZ)));
          sum += dens * lit * trans;
        }
        float cosT = dot(rd, uSun);
        float phase = 0.75 * (1.0 + cosT * cosT);
        // a little forward (Mie-ish) brightening toward the sun
        phase += 0.25 * pow(max(cosT, 0.0), 8.0);
        vec3 inscatter = sum * BETA * phase * uSunColor * 0.55 * uStrength;
        vec3 transmit = exp(-BETA * odView * 0.6 * uStrength);
        float t = dot(transmit, vec3(0.3, 0.4, 0.3));

        gl_FragColor = vec4(inscatter, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.a = t;
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 10
  return {
    mesh,
    setStrength(s: number) {
      material.uniforms.uStrength.value = s
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Small deterministic PRNG (mulberry32), so the sky is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildStarfield(count = 3200): THREE.Points {
  const rand = mulberry32(0x5eed5)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const warm = [1.0, 0.82, 0.62]
  const cool = [0.68, 0.8, 1.0]
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1
    const th = rand() * Math.PI * 2
    const sr = Math.sqrt(1 - u * u)
    const radius = 90
    positions[i * 3] = radius * sr * Math.cos(th)
    positions[i * 3 + 1] = radius * u
    positions[i * 3 + 2] = radius * sr * Math.sin(th)
    // many faint stars, few bright ones
    const m = Math.pow(rand(), 4.0)
    const brightness = 0.18 + 1.6 * m
    sizes[i] = 1.4 + 2.2 * Math.sqrt(m)
    const k = rand()
    const tint = k < 0.25 ? warm : k > 0.75 ? cool : [1, 1, 1]
    const mixT = k < 0.25 || k > 0.75 ? 0.4 + 0.6 * rand() : 0
    for (let c = 0; c < 3; c++) {
      colors[i * 3 + c] = brightness * (1 + (tint[c] - 1) * mixT)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float a = exp(-r2 * 3.5) * (1.0 - smoothstep(0.7, 1.0, r2));
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
        #include <colorspace_fragment>
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const points = new THREE.Points(geometry, material)
  points.renderOrder = -1
  points.frustumCulled = false
  points.onBeforeRender = (renderer) => {
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio()
  }
  return points
}

export interface Clouds {
  mesh: THREE.Mesh
  update(dt: number): void
  dispose(): void
}

/** Procedural cloud deck on a slightly larger sphere, drifting slowly over the surface. */
export function buildClouds(seed: number): Clouds {
  const geometry = new THREE.SphereGeometry(PLANET_RADIUS * 1.012, 160, 120)
  const rand = mulberry32(seed ^ 0xc10d)
  const offset = new THREE.Vector3(rand() * 100, rand() * 100, rand() * 100)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunObj: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uOffset: { value: offset },
      uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObjPos;
      void main() {
        vObjPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform vec3 uSunColor;
      uniform vec3 uOffset;
      uniform vec3 uCamObj;
      varying vec3 vObjPos;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vObjPos);
        float footprint = length(fwidth(vObjPos));
        float lat = abs(p.y);
        // domain warp for swirly structure; stretched east-west like real weather systems
        vec3 ps = p * vec3(1.0, 1.9, 1.0);
        vec3 q = ps + 0.3 * vec3(
          ws_fbm(ps + uOffset, 1.6, 3, footprint),
          ws_fbm(ps + uOffset + 5.2, 1.6, 3, footprint),
          ws_fbm(ps + uOffset + 9.7, 1.6, 3, footprint));
        float n = ws_fbm(q + uOffset * 1.7, 3.0, 4, footprint);
        float detail = ws_fbm(q * 1.0 + uOffset * 2.3, 14.0, 4, footprint);
        // more cloud along the ITCZ and mid-latitude storm tracks, less in the subtropics
        float band = 0.22 * exp(-lat * lat * 60.0) + 0.14 * smoothstep(0.5, 0.75, lat) - 0.12 * smoothstep(0.85, 1.0, lat) - 0.25 * exp(-pow((lat - 0.4) * 6.0, 2.0));
        float cov = n + band + 0.2 * detail;
        float c = smoothstep(0.2, 0.58, cov);
        c *= smoothstep(-0.2, 0.3, detail + 0.25) * 0.9;
        if (c < 0.004) discard;
        vec3 L = normalize(uSunObj);
        float mu = dot(p, L);
        float day = smoothstep(-0.15, 0.15, mu);
        vec3 V = normalize(uCamObj - vObjPos);
        float limb = smoothstep(0.0, 0.25, dot(p, V));
        vec3 col = vec3(0.95) * (uSunColor * max(mu * 0.8 + 0.2, 0.0) * day + vec3(0.015, 0.02, 0.035));
        gl_FragColor = vec4(col, c * mix(0.6, 1.0, limb));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 5
  const tmpQ = new THREE.Quaternion()
  const tmpCam = new THREE.Vector3()
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.getWorldQuaternion(tmpQ).invert()
    ;(material.uniforms.uSunObj.value as THREE.Vector3).copy(SUN_DIRECTION).applyQuaternion(tmpQ)
    camera.getWorldPosition(tmpCam)
    ;(material.uniforms.uCamObj.value as THREE.Vector3).copy(mesh.worldToLocal(tmpCam))
  }
  return {
    mesh,
    update(dt: number) {
      mesh.rotation.y += dt * 0.004
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
