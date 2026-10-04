// What the flat layers need to know about the 3D layer up close. Shared uniforms, like
// sun.ts sunUniforms, written by the diorama layer:
//  - where the 3D towns stand: the road ribbons fade out inside a town (its own streets
//    take over); with no towns near the view the count is 0.
//  - whether the 3D layer is showing: the planet's close-zoom field detail (furrows,
//    strips, hedgerows) belongs to it, so with models=0 the surface is as it was.

import * as THREE from 'three'

export const TOWN_MASK_MAX = 16

export const townMaskUniforms = {
  /** Centre (object space, on the ground) and radius of each town near the view. */
  uTowns: { value: Array.from({ length: TOWN_MASK_MAX }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uTownCount: { value: 0 },
}

export const closeDetailUniforms = {
  /** 1 while the diorama layer shows models (planetShaders.ts farmland detail). */
  uFieldDetail: { value: 0 },
}

/** GLSL: 1 outside every town, fading to 0 inside one (p in object space). */
export const TOWN_MASK_GLSL = /* glsl */ `
  uniform vec4 uTowns[${TOWN_MASK_MAX}];
  uniform float uTownCount;
  float townMask(vec3 p) {
    float m = 1.0;
    for (int i = 0; i < ${TOWN_MASK_MAX}; i++) {
      if (float(i) >= uTownCount) break;
      vec4 t = uTowns[i];
      m = min(m, smoothstep(t.w * 0.72, t.w, length(p - t.xyz)));
    }
    return m;
  }
`
