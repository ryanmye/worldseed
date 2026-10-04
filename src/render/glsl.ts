// Shared GLSL snippets. Noise is evaluated on object-space positions, so it is
// seamless on the sphere and anchored to the surface (no shimmer as it turns).

/**
 * Gradient noise with analytic derivatives (after Inigo Quilez, MIT), plus
 * footprint-aware fBm that fades octaves finer than a pixel to avoid aliasing.
 * Returns vec4(value, d/dx, d/dy, d/dz); value is roughly in [-0.6, 0.6].
 */
export const NOISE_GLSL = /* glsl */ `
#ifdef WS_COUNT_NOISE
// debug instrumentation (perf=1, window.__worldseed.noiseCount()): calls per pixel
int ws_noiseCount = 0;
int ws_cellCount = 0;
#endif

vec3 ws_hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return -1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx);
}

vec4 ws_noised(vec3 x) {
#ifdef WS_COUNT_NOISE
  ws_noiseCount++;
#endif
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec3 ga = ws_hash33(i + vec3(0.0, 0.0, 0.0));
  vec3 gb = ws_hash33(i + vec3(1.0, 0.0, 0.0));
  vec3 gc = ws_hash33(i + vec3(0.0, 1.0, 0.0));
  vec3 gd = ws_hash33(i + vec3(1.0, 1.0, 0.0));
  vec3 ge = ws_hash33(i + vec3(0.0, 0.0, 1.0));
  vec3 gf = ws_hash33(i + vec3(1.0, 0.0, 1.0));
  vec3 gg = ws_hash33(i + vec3(0.0, 1.0, 1.0));
  vec3 gh = ws_hash33(i + vec3(1.0, 1.0, 1.0));

  float va = dot(ga, f - vec3(0.0, 0.0, 0.0));
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));

  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va)
    + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg)
    + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);

  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
    + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
    + u.z * u.x * (ga - gb - ge + gf) + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
    + du * (vec3(vb - va, vc - va, ve - va)
      + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
      + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg)
      + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return vec4(v, d);
}

// Octave weight given the object-space size of one pixel (footprint).
float ws_lod(float freq, float footprint) {
  return 1.0 - smoothstep(0.18, 0.5, freq * footprint);
}

// fBm value only. Octaves finer than the pixel footprint fade out.
float ws_fbm(vec3 p, float freq, int octaves, float footprint) {
  float sum = 0.0;
  float amp = 0.5;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    sum += amp * w * ws_noised(p * freq).x;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum * 2.0;
}

// fBm returning vec4(value, gradient) in object-space units (gradient of the summed field).
vec4 ws_fbmd(vec3 p, float freq, int octaves, float footprint) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    vec4 n = ws_noised(p * freq);
    sum += amp * w * vec4(n.x, n.yzw * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum * 2.0;
}

// Ridged fBm: vec4(value in ~[0, 1], gradient). Each octave is (1 - |n|)^2, sharp crests
// where the noise crosses zero; normalised by the weights of the octaves actually used.
vec4 ws_ridged(vec3 p, float freq, int octaves, float footprint) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  float norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    vec4 n = ws_noised(p * freq);
    float r = 1.0 - min(abs(n.x) * 1.6, 1.0);
    vec3 dr = -sign(n.x) * 1.6 * n.yzw * freq;
    sum += amp * w * vec4(r * r, 2.0 * r * dr);
    norm += amp * w;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / max(norm, 1e-4);
}

// Band-limited variants: only the octaves with fmin <= freq < fmax, with the same
// amplitudes and footprint weights as the full versions, so splitting a field into a
// low band (baked into a texture, see surfaceBake.ts) and a high band (evaluated per
// frame) sums to the original. Pass footprint 0 for full weight.
float ws_fbm_band(vec3 p, float freq, int octaves, float footprint, float fmin, float fmax) {
  float sum = 0.0;
  float amp = 0.5;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves || freq >= fmax) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    if (freq >= fmin) sum += amp * w * ws_noised(p * freq).x;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum * 2.0;
}

vec4 ws_fbmd_band(vec3 p, float freq, int octaves, float footprint, float fmin, float fmax) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves || freq >= fmax) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    if (freq >= fmin) {
      vec4 n = ws_noised(p * freq);
      sum += amp * w * vec4(n.x, n.yzw * freq);
    }
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum * 2.0;
}

// Ridged band: the unnormalised sum (value, gradient) and, in norm, the summed octave
// weights; ws_ridged is (sum of all bands) / (sum of all norms).
vec4 ws_ridged_band(vec3 p, float freq, int octaves, float footprint, float fmin, float fmax, out float norm) {
  vec4 sum = vec4(0.0);
  float amp = 0.5;
  norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves || freq >= fmax) break;
    float w = ws_lod(freq, footprint);
    if (w <= 0.0) break;
    if (freq >= fmin) {
      vec4 n = ws_noised(p * freq);
      float r = 1.0 - min(abs(n.x) * 1.6, 1.0);
      vec3 dr = -sign(n.x) * 1.6 * n.yzw * freq;
      sum += amp * w * vec4(r * r, 2.0 * r * dr);
      norm += amp * w;
    }
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// Cellular (Voronoi) noise with jittered feature points: returns vec2(F1, F2), the
// distances to the nearest and second-nearest feature point, and an independent
// 0..1 random vec3 for the nearest one (its "cell id"). 27 hashes: use sparingly.
vec2 ws_cells(vec3 x, out vec3 cellRand) {
#ifdef WS_COUNT_NOISE
  ws_cellCount++;
#endif
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d1 = 9.0;
  float d2 = 9.0;
  vec3 best = vec3(0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int k = -1; k <= 1; k++) {
    vec3 g = vec3(float(k), float(y), float(z));
    vec3 r = g + 0.5 + 0.42 * ws_hash33(i + g) - f;
    float d = dot(r, r);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = g;
    } else if (d < d2) {
      d2 = d;
    }
  }
  cellRand = ws_hash33(i + best + 71.3) * 0.5 + 0.5;
  return sqrt(vec2(d1, d2));
}

// ws_cells that also returns the nearest feature point (in the same scaled space as x).
vec2 ws_cellsc(vec3 x, out vec3 cellRand, out vec3 center) {
#ifdef WS_COUNT_NOISE
  ws_cellCount++;
#endif
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d1 = 9.0;
  float d2 = 9.0;
  vec3 best = vec3(0.0);
  vec3 bestR = vec3(0.0);
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int k = -1; k <= 1; k++) {
    vec3 g = vec3(float(k), float(y), float(z));
    vec3 r = g + 0.5 + 0.42 * ws_hash33(i + g) - f;
    float d = dot(r, r);
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = g;
      bestR = r;
    } else if (d < d2) {
      d2 = d;
    }
  }
  cellRand = ws_hash33(i + best + 71.3) * 0.5 + 0.5;
  center = x + bestR;
  return sqrt(vec2(d1, d2));
}

vec3 ws_srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`
