// Deterministic math for the sim: results that are bit-identical on every engine, version and platform.
//
// The sim may use only + - * / sqrt floor (and the other exactly-specified Math functions: abs, min, max, round, ceil, trunc,
// sign, imul, clz32, fround). IEEE 754 fixes those results exactly. The transcendental functions (Math.pow and the `**`
// operator, exp, log, trig ...) are "implementation-approximated" in ECMAScript, and engines change them: V8 changed Math.pow
// between Node 22 and Node 25 (about 9% of results moved by one ulp; Math.pow(0.9, 4) is 0.6561000000000001 on Node 22 and
// 0.6561 on Node 25), which broke G0 on CI (ubuntu, Node 25.9.0; lane/ci-determinism). A share link must replay the same
// history on every device, so the sim calls these instead; src/sim/detMath.test.ts forbids the raw calls under src/sim.
//
// powD is V8's port of fdlibm's __ieee754_pow (Sun Microsystems, 1993), base::ieee754::pow in V8 12.4 (src/base/ieee754.cc), what
// Math.pow and `**` returned through Node 22 (V8 later defaults to std::pow, --use-std-math-pow). It is written with integer
// operations on the IEEE words and + - * / sqrt only, so it returns exactly what Node 22 returned (detMath.test.ts pins values
// recorded on Node 22): the existing goldens are kept. V8's port differs from fdlibm in one line (the final r; marked).

// IEEE word access. The high word is the one holding the sign and exponent; which index that is depends on the platform's byte
// order (typed arrays use it), so it is detected once.
const F = new Float64Array(1)
const W = new Int32Array(F.buffer)
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0 // little-endian: the high word is W[1]
const LO = 1 - HI
const hiOf = (x: number): number => { F[0] = x; return W[HI] }
const loOf = (x: number): number => { F[0] = x; return W[LO] }
const withLo0 = (x: number): number => { F[0] = x; W[LO] = 0; return F[0] }
const fromWords = (hi: number, lo: number): number => { W[HI] = hi; W[LO] = lo; return F[0] }

const BP = [1.0, 1.5]
const DP_H = [0.0, 5.84962487220764160156e-01] // 0x3FE2B803 40000000
const DP_L = [0.0, 1.35003920212974897128e-08] // 0x3E4CFDEB 43CFD006
const TWO53 = 9007199254740992.0
const HUGE = 1.0e300
const TINY = 1.0e-300
// poly coefs for (3/2)*(log(x)-2s-2/3*s**3
const L1 = 5.99999999999994648725e-01
const L2 = 4.28571428578550184252e-01
const L3 = 3.33333329818377432918e-01
const L4 = 2.72728123808534006489e-01
const L5 = 2.30660745775561754067e-01
const L6 = 2.06975017800338417784e-01
const P1 = 1.66666666666666019037e-01
const P2 = -2.77777777770155933842e-03
const P3 = 6.61375632143793436117e-05
const P4 = -1.65339022054652515390e-06
const P5 = 4.13813679705723846039e-08
const LG2 = 6.93147180559945286227e-01
const LG2_H = 6.93147182464599609375e-01
const LG2_L = -1.90465429995776804525e-09
const OVT = 8.0085662595372944372e-17 // -(1024-log2(ovfl+.5ulp))
const CP = 9.61796693925975554329e-01 // 2/(3ln2)
const CP_H = 9.61796700954437255859e-01 // (float)cp
const CP_L = -7.02846165095275826516e-09 // tail of cp_h
const IVLN2 = 1.44269504088896338700e+00 // 1/ln2
const IVLN2_H = 1.44269502162933349609e+00 // 24b 1/ln2
const IVLN2_L = 1.92596299112661746887e-08 // 1/ln2 tail

/** z * 2^n for z in [0.5, 2) and an n that makes the result subnormal or tiny (one rounding: the first product is exact). */
function scalbnSmall(z: number, n: number): number {
  // n >= -1100 here; 2^(n + 1000) is a normal power of two and z * 2^(n + 1000) is exact, then one rounding by 2^-1000
  return z * fromWords((n + 1000 + 1023) << 20, 0) * 9.332636185032189e-302 // 2^-1000
}

/** x^y, bit-identical on every engine (fdlibm __ieee754_pow; ECMAScript special cases: 1^±Infinity and 1^NaN are NaN). */
export function powD(x: number, y: number): number {
  F[0] = x; const hx = W[HI], lx = W[LO] >>> 0
  F[0] = y; const hy = W[HI], ly = W[LO] >>> 0
  let ix = hx & 0x7fffffff
  const iy = hy & 0x7fffffff

  // y == 0: x**0 = 1
  if ((iy | ly) === 0) return 1
  // NaN: x + y
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y

  // yisint = 0: y not an integer, 1: odd integer, 2: even integer (only needed when x < 0)
  let yisint = 0
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff
      if (k > 20) {
        const j = ly >>> (52 - k)
        if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1)
      } else if (ly === 0) {
        const j = iy >> (20 - k)
        if ((j << (20 - k)) === iy) yisint = 2 - (j & 1)
      }
    }
  }

  // special values of y
  if (ly === 0) {
    if (iy === 0x7ff00000) { // y is ±inf
      if (((ix - 0x3ff00000) | lx) === 0) return y - y // (±1)**±inf is NaN
      else if (ix >= 0x3ff00000) return hy >= 0 ? y : 0 // (|x|>1)**±inf = inf, 0
      else return hy < 0 ? -y : 0 // (|x|<1)**-,+inf = inf, 0
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x // y is ±1
    if (hy === 0x40000000) return x * x // y is 2
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x) // y is 0.5, x >= +0
  }

  let ax = Math.abs(x)
  // special values of x
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax // x is ±0, ±inf, ±1
    if (hy < 0) z = 1 / z
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = NaN // (-1)**non-int
      else if (yisint === 1) z = -z
    }
    return z
  }

  let n = (hx >> 31) + 1 // 0 when x < 0, else 1
  // (x<0)**(non-int) is NaN
  if ((n | yisint) === 0) return NaN

  let s = 1 // sign of the result: -1 for (-ve)**(odd int)
  if ((n | (yisint - 1)) === 0) s = -1

  let t1: number, t2: number
  if (iy > 0x41e00000) { // |y| > 2**31
    if (iy > 0x43f00000) { // |y| > 2**64: must over/underflow
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY
    }
    // over/underflow if x is not close to one
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY
    // |1-x| <= 2**-20: log(x) by x - x^2/2 + x^3/3 - x^4/4
    const t = ax - 1
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
    const u = IVLN2_H * t
    const v = t * IVLN2_L - w * IVLN2
    t1 = withLo0(u + v)
    t2 = v - (t1 - u)
  } else {
    n = 0
    // subnormal x
    if (ix < 0x00100000) { ax *= TWO53; n -= 53; ix = hiOf(ax) }
    n += (ix >> 20) - 0x3ff
    const j = ix & 0x000fffff
    // the interval
    ix = j | 0x3ff00000 // normalised
    let k: number
    if (j <= 0x3988e) k = 0 // |x| < sqrt(3/2)
    else if (j < 0xbb67a) k = 1 // |x| < sqrt(3)
    else { k = 0; n += 1; ix -= 0x00100000 }
    ax = fromWords(ix, loOf(ax))

    // ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
    let u = ax - BP[k]
    let v = 1 / (ax + BP[k])
    const ss = u * v
    const sH = withLo0(ss)
    // t_h = ax + bp[k], high part
    let tH = fromWords(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0)
    let tL = ax - (tH - BP[k])
    const sL = v * ((u - sH * tH) - sH * tL)
    // log(ax)
    let s2 = ss * ss
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))))
    r += sL * (sH + ss)
    s2 = sH * sH
    tH = withLo0(3.0 + s2 + r)
    tL = r - ((tH - 3.0) - s2)
    // u + v = ss*(1+...)
    u = sH * tH
    v = sL * tH + tL * ss
    // 2/(3log2)*(ss+...)
    const pH = withLo0(u + v)
    const pL = v - (pH - u)
    const zH = CP_H * pH // cp_h + cp_l = 2/(3*log2)
    const zL = CP_L * pH + pL * CP + DP_L[k]
    // log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l
    const t = n
    t1 = withLo0(((zH + zL) + DP_H[k]) + t)
    t2 = zL - (((t1 - t) - DP_H[k]) - zH)
  }

  // split y into y1 + y2 and compute (y1+y2)*(t1+t2)
  const y1 = withLo0(y)
  const pL = (y - y1) * t1 + y * t2
  let pH = y1 * t1
  let z = pL + pH
  F[0] = z
  let j = W[HI]
  let i = W[LO]
  if (j >= 0x40900000) { // z >= 1024
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE // overflow
    else if (pL + OVT > z - pH) return s * HUGE * HUGE
  } else if ((j & 0x7fffffff) >= 0x4090cc00) { // z <= -1075
    if (((j - 0xc090cc00) | i) !== 0) return s * TINY * TINY // underflow
    else if (pL <= z - pH) return s * TINY * TINY
  }

  // 2**(p_h + p_l)
  i = j & 0x7fffffff
  let k = (i >> 20) - 0x3ff
  n = 0
  if (i > 0x3fe00000) { // |z| > 0.5: n = [z + 0.5]
    n = j + (0x00100000 >> (k + 1))
    k = ((n & 0x7fffffff) >> 20) - 0x3ff // new k for n
    const t = fromWords(n & ~(0x000fffff >> k), 0)
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k)
    if (j < 0) n = -n
    pH -= t
  }
  const t = withLo0(pL + pH)
  const u = t * LG2_H
  const v = (pL - (t - pH)) * LG2 + t * LG2_L
  z = u + v
  const w = v - (z - u)
  const tt = z * z
  const tq = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))))
  const r = (z * tq) / ((tq - 2) - (w + z * w)) // (V8's parenthesisation, not fdlibm's (z*t1)/(t1-two)-(w+z*w): bit-identical to V8's pow)
  z = 1 - (r - z)
  j = hiOf(z) + (n << 20)
  if ((j >> 20) <= 0) z = scalbnSmall(z, n) // subnormal output
  else z = fromWords(j, loOf(z))
  return s * z
}

// ---------------------------------------------------------------------------------------------------------------------------
// exp, log, log2, sin, cos, acos (V8's fdlibm ports in V8 12.4 src/base/ieee754.cc, which Math.exp / log / log2 / sin / cos /
// acos call in Node 22 and Node 25, interpreter and optimising tiers alike) and hypot (V8's MathHypot builtin,
// src/builtins/math.tq). Line-for-line ports with the same parenthesisation; detMath.test.ts pins them to Node's Math.
// (JavaScript has no fused multiply-add contraction, so each line rounds exactly as the C does on x64.)

const setHi = (x: number, hi: number): number => { F[0] = x; W[HI] = hi; return F[0] }
const TWO54 = 1.80143985094819840000e+16
const TWOM1000 = 9.33263618503218878990e-302 // 2^-1000
const TWO1023 = 8.988465674311579539e307 // 2^1023

const E_O_THRESHOLD = 7.09782712893383973096e+02
const E_U_THRESHOLD = -7.45133219101941108420e+02
const LN2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01]
const LN2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10]
const HALF = [0.5, -0.5]
const E = 2.718281828459045

/** e^x, bit-identical to V8's Math.exp (fdlibm __ieee754_exp, with V8's exp(1) = E). */
export function expD(x: number): number {
  F[0] = x
  let hx = W[HI]
  const lx = W[LO]
  const xsb = hx >>> 31 // sign bit of x
  hx &= 0x7fffffff // high word of |x|
  let hi = 0, lo = 0, k = 0
  // filter out non-finite argument
  if (hx >= 0x40862e42) { // |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lx) !== 0) return x + x // NaN
      return xsb === 0 ? x : 0 // exp(+-inf) = {inf, 0}
    }
    if (x > E_O_THRESHOLD) return HUGE * HUGE // overflow
    if (x < E_U_THRESHOLD) return TWOM1000 * TWOM1000 // underflow
  }
  // argument reduction
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) { // and |x| < 1.5 ln2
      if (x === 1) return E
      hi = x - LN2HI[xsb]
      lo = LN2LO[xsb]
      k = 1 - xsb - xsb
    } else {
      k = (IVLN2 * x + HALF[xsb]) | 0
      const t = k
      hi = x - t * LN2HI[0] // t*ln2HI is exact here
      lo = t * LN2LO[0]
    }
    x = hi - lo
  } else if (hx < 0x3e300000) { // |x| < 2^-28
    if (HUGE + x > 1) return 1 + x
  } else {
    k = 0
  }
  // x is now in primary range
  const t = x * x
  const twopk = k >= -1021 ? fromWords(0x3ff00000 + (k << 20), 0) : fromWords(0x3ff00000 + ((k + 1000) << 20), 0)
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x)
  const y = 1 - ((lo - (x * c) / (2.0 - c)) - hi)
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * TWO1023
    return y * twopk
  }
  return y * twopk * TWOM1000
}

const LN2_HI = 6.93147180369123816490e-01
const LN2_LO = 1.90821492927058770002e-10
const LG1 = 6.666666666666735130e-01
const LG2_ = 3.999999999940941908e-01
const LG3 = 2.857142874366239149e-01
const LG4 = 2.222219843214978396e-01
const LG5 = 1.818357216161805012e-01
const LG6 = 1.531383769920937332e-01
const LG7 = 1.479819860511658591e-01

/** Natural logarithm, bit-identical to V8's Math.log (fdlibm __ieee754_log). */
export function logD(x: number): number {
  F[0] = x
  let hx = W[HI]
  const lx = W[LO]
  let k = 0
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity // log(+-0) = -inf
    if (hx < 0) return NaN // log(-#) = NaN
    k -= 54
    x *= TWO54 // subnormal number, scale up x
    hx = hiOf(x)
  }
  if (hx >= 0x7ff00000) return x + x
  k += (hx >> 20) - 1023
  hx &= 0x000fffff
  let i = (hx + 0x95f64) & 0x100000
  x = setHi(x, hx | (i ^ 0x3ff00000)) // normalize x or x/2
  k += i >> 20
  const f = x - 1.0
  if ((0x000fffff & (2 + hx)) < 3) { // -2^-20 <= f < 2^-20
    if (f === 0) {
      if (k === 0) return 0
      const dk = k
      return dk * LN2_HI + dk * LN2_LO
    }
    const R = f * f * (0.5 - 0.33333333333333333 * f)
    if (k === 0) return f - R
    const dk = k
    return dk * LN2_HI - ((R - dk * LN2_LO) - f)
  }
  const s = f / (2.0 + f)
  const dk = k
  const z = s * s
  i = hx - 0x6147a
  const w = z * z
  const j = 0x6b851 - hx
  const t1 = w * (LG2_ + w * (LG4 + w * LG6))
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
  i |= j
  const R = t2 + t1
  if (i > 0) {
    const hfsq = 0.5 * f * f
    if (k === 0) return f - (hfsq - s * (hfsq + R))
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f)
  }
  if (k === 0) return f - s * (f - R)
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f)
}

function kLog1p(f: number): number {
  const s = f / (2.0 + f)
  const z = s * s
  const w = z * z
  const t1 = w * (LG2_ + w * (LG4 + w * LG6))
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
  const R = t2 + t1
  const hfsq = 0.5 * f * f
  return s * (hfsq + R)
}

const IVLN2HI = 1.44269504072144627571e+00
const IVLN2LO = 1.67517131648865118353e-10

/** Base-2 logarithm, bit-identical to V8's Math.log2 (FreeBSD msun e_log2.c via V8). */
export function log2D(x: number): number {
  F[0] = x
  let hx = W[HI]
  const lx = W[LO]
  let k = 0
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity
    if (hx < 0) return NaN
    k -= 54
    x *= TWO54
    hx = hiOf(x)
  }
  if (hx >= 0x7ff00000) return x + x
  if (hx === 0x3ff00000 && lx === 0) return 0 // log(1) = +0
  k += (hx >> 20) - 1023
  hx &= 0x000fffff
  const i = (hx + 0x95f64) & 0x100000
  x = setHi(x, hx | (i ^ 0x3ff00000)) // normalize x or x/2
  k += i >> 20
  const y = k
  const f = x - 1.0
  const hfsq = 0.5 * f * f
  const r = kLog1p(f)
  const hi = withLo0(f - hfsq)
  const lo = (f - hi) - hfsq + r
  let valHi = hi * IVLN2HI
  let valLo = (lo + hi) * IVLN2LO + lo * IVLN2HI
  const w = y + valHi
  valLo += (y - w) + valHi
  valHi = w
  return valLo + valHi
}

const PI = 3.14159265358979311600e+00
const PIO2_HI = 1.57079632679489655800e+00
const PIO2_LO = 6.12323399573676603587e-17
const PS0 = 1.66666666666666657415e-01
const PS1 = -3.25565818622400915405e-01
const PS2 = 2.01212532134862925881e-01
const PS3 = -4.00555345006794114027e-02
const PS4 = 7.91534994289814532176e-04
const PS5 = 3.47933107596021167570e-05
const QS1 = -2.40339491173441421878e+00
const QS2 = 2.02094576023350569471e+00
const QS3 = -6.88283971605453293030e-01
const QS4 = 7.70381505559019352791e-02

/** Arc cosine, bit-identical to V8's Math.acos (fdlibm __ieee754_acos). */
export function acosD(x: number): number {
  F[0] = x
  const hx = W[HI]
  const lx = W[LO]
  const ix = hx & 0x7fffffff
  if (ix >= 0x3ff00000) { // |x| >= 1
    if (((ix - 0x3ff00000) | lx) === 0) return hx > 0 ? 0.0 : PI + 2.0 * PIO2_LO // acos(1) = 0, acos(-1) = pi
    return NaN // acos(|x|>1) is NaN
  }
  if (ix < 0x3fe00000) { // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO // |x| < 2^-57
    const z = x * x
    const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
    const r = p / q
    return PIO2_HI - (x - (PIO2_LO - x * r))
  } else if (hx < 0) { // x < -0.5
    const z = (1 + x) * 0.5
    const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
    const s = Math.sqrt(z)
    const r = p / q
    const w = r * s - PIO2_LO
    return PI - 2.0 * (s + w)
  } else { // x > 0.5
    const z = (1 - x) * 0.5
    const s = Math.sqrt(z)
    const df = withLo0(s)
    const c = (z - df * df) / (s + df)
    const p = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))))
    const q = 1 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)))
    const r = p / q
    const w = r * s + c
    return 2.0 * (df + w)
  }
}

// --- trigonometric functions: argument reduction (__ieee754_rem_pio2, __kernel_rem_pio2) and the kernels ---

const TWO_OVER_PI = [
  0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A,
  0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C, 0x7026B4, 0x5F7E41,
  0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D, 0x367ECF,
  0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08,
  0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880,
  0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
]
const NPIO2_HW = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
  0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A,
  0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
  0x404858EB, 0x404921FB,
]
const TWO24 = 1.67772160000000000000e+07
const TWON24 = 5.96046447753906250000e-08
const INVPIO2 = 6.36619772367581382433e-01
const PIO2_1 = 1.57079632673412561417e+00
const PIO2_1T = 6.07710050650619224932e-11
const PIO2_2 = 6.07710050630396597660e-11
const PIO2_2T = 2.02226624879595063154e-21
const PIO2_3 = 2.02226624871116645580e-21
const PIO2_3T = 8.47842766036889956997e-32
const PIO2 = [
  1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22,
  1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51,
]

/** x * 2^n (exact while the result stays normal; the argument reduction keeps it there). */
function scalbn(x: number, n: number): number {
  while (n > 1023) { x *= TWO1023; n -= 1023 }
  while (n < -1022) { x *= 2.2250738585072014e-308; n += 1022 }
  return x * fromWords((n + 1023) << 20, 0)
}

const RY = new Float64Array(2) // rem_pio2's y[0], y[1]
const KIQ = new Int32Array(20), KF = new Float64Array(20), KFQ = new Float64Array(20), KQ = new Float64Array(20)
const KTX = new Float64Array(3)

function kernelRemPio2(x: Float64Array, y: Float64Array, e0: number, nx: number): number {
  const iq = KIQ, f = KF, fq = KFQ, q = KQ
  const jk = 4 // init_jk[prec = 2]
  const jp = jk
  const jx = nx - 1
  let jv = ((e0 - 3) / 24) | 0
  if (jv < 0) jv = 0
  let q0 = e0 - 24 * (jv + 1)
  let j = jv - jx
  const m = jx + jk
  for (let i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0 : TWO_OVER_PI[j]
  for (let i = 0; i <= jk; i++) {
    let fw = 0.0
    for (j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j]
    q[i] = fw
  }
  let jz = jk
  let z: number, n: number, ih: number
  for (;;) { // recompute:
    // distill q[] into iq[] reversingly
    let i = 0
    j = jz
    z = q[jz]
    for (; j > 0; i++, j--) {
      const fw = (TWON24 * z) | 0
      iq[i] = (z - TWO24 * fw) | 0
      z = q[j - 1] + fw
    }
    // compute n
    z = scalbn(z, q0) // actual value of z
    z -= 8.0 * Math.floor(z * 0.125) // trim off integer >= 8
    n = z | 0
    z -= n
    ih = 0
    if (q0 > 0) { // need iq[jz-1] to determine n
      i = iq[jz - 1] >> (24 - q0)
      n += i
      iq[jz - 1] -= i << (24 - q0)
      ih = iq[jz - 1] >> (23 - q0)
    } else if (q0 === 0) {
      ih = iq[jz - 1] >> 23
    } else if (z >= 0.5) {
      ih = 2
    }
    if (ih > 0) { // q > 0.5
      n += 1
      let carry = 0
      for (i = 0; i < jz; i++) { // compute 1-q
        j = iq[i]
        if (carry === 0) {
          if (j !== 0) { carry = 1; iq[i] = 0x1000000 - j }
        } else {
          iq[i] = 0xffffff - j
        }
      }
      if (q0 > 0) { // rare case: chance is 1 in 12
        if (q0 === 1) iq[jz - 1] &= 0x7fffff
        else if (q0 === 2) iq[jz - 1] &= 0x3fffff
      }
      if (ih === 2) {
        z = 1 - z
        if (carry !== 0) z -= scalbn(1, q0)
      }
    }
    // check if recomputation is needed
    if (z === 0) {
      j = 0
      for (i = jz - 1; i >= jk; i--) j |= iq[i]
      if (j === 0) { // need recomputation
        let k = 1
        while (jk >= k && iq[jk - k] === 0) k++ // k = no. of terms needed
        for (i = jz + 1; i <= jz + k; i++) { // add q[jz+1] to q[jz+k]
          f[jx + i] = TWO_OVER_PI[jv + i]
          let fw = 0.0
          for (j = 0; j <= jx; j++) fw += x[j] * f[jx + i - j]
          q[i] = fw
        }
        jz += k
        continue
      }
    }
    break
  }
  // chop off zero terms
  if (z === 0.0) {
    jz -= 1
    q0 -= 24
    while (iq[jz] === 0) { jz--; q0 -= 24 }
  } else { // break z into 24-bit if necessary
    z = scalbn(z, -q0)
    if (z >= TWO24) {
      const fw = (TWON24 * z) | 0
      iq[jz] = z - TWO24 * fw
      jz += 1
      q0 += 24
      iq[jz] = fw
    } else {
      iq[jz] = z
    }
  }
  // convert integer "bit" chunk to floating-point value
  let fw = scalbn(1, q0)
  for (let i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= TWON24 }
  // compute PIo2[0,...,jp]*q[jz,...,0]
  for (let i = jz; i >= 0; i--) {
    fw = 0.0
    for (let k = 0; k <= jp && k <= jz - i; k++) fw += PIO2[k] * q[i + k]
    fq[jz - i] = fw
  }
  // compress fq[] into y[] (prec 2)
  fw = 0.0
  for (let i = jz; i >= 0; i--) fw += fq[i]
  y[0] = ih === 0 ? fw : -fw
  fw = fq[0] - fw
  for (let i = 1; i <= jz; i++) fw += fq[i]
  y[1] = ih === 0 ? fw : -fw
  return n & 7
}

/** x rem pi/2 in RY[0] + RY[1]; returns n (mod 8 for huge x) with x = n * pi/2 + RY[0] + RY[1]. */
function remPio2(x: number): number {
  const y = RY
  F[0] = x
  const hx = W[HI]
  const ix = hx & 0x7fffffff
  if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0; return 0 } // |x| ~<= pi/4
  if (ix < 0x4002d97c) { // |x| < 3pi/4, special case with n=+-1
    if (hx > 0) {
      let z = x - PIO2_1
      if (ix !== 0x3ff921fb) { // 33+53 bit pi is good enough
        y[0] = z - PIO2_1T
        y[1] = (z - y[0]) - PIO2_1T
      } else { // near pi/2, use 33+33+53 bit pi
        z -= PIO2_2
        y[0] = z - PIO2_2T
        y[1] = (z - y[0]) - PIO2_2T
      }
      return 1
    } else { // negative x
      let z = x + PIO2_1
      if (ix !== 0x3ff921fb) {
        y[0] = z + PIO2_1T
        y[1] = (z - y[0]) + PIO2_1T
      } else {
        z += PIO2_2
        y[0] = z + PIO2_2T
        y[1] = (z - y[0]) + PIO2_2T
      }
      return -1
    }
  }
  if (ix <= 0x413921fb) { // |x| ~<= 2^19*(pi/2), medium size
    let t = Math.abs(x)
    const n = (t * INVPIO2 + 0.5) | 0
    const fn = n
    let r = t - fn * PIO2_1
    let w = fn * PIO2_1T // 1st round good to 85 bit
    if (n < 32 && ix !== NPIO2_HW[n - 1]) {
      y[0] = r - w // quick check no cancellation
    } else {
      const j = ix >> 20
      y[0] = r - w
      let i = j - ((hiOf(y[0]) >>> 20) & 0x7ff)
      if (i > 16) { // 2nd iteration needed, good to 118
        t = r
        w = fn * PIO2_2
        r = t - w
        w = fn * PIO2_2T - ((t - r) - w)
        y[0] = r - w
        i = j - ((hiOf(y[0]) >>> 20) & 0x7ff)
        if (i > 49) { // 3rd iteration need, 151 bits acc
          t = r
          w = fn * PIO2_3
          r = t - w
          w = fn * PIO2_3T - ((t - r) - w)
          y[0] = r - w
        }
      }
    }
    y[1] = (r - y[0]) - w
    if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n }
    return n
  }
  // all other (large) arguments
  if (ix >= 0x7ff00000) { y[0] = y[1] = x - x; return 0 } // inf or NaN
  // set z = scalbn(|x|, ilogb(x)-23)
  const low = loOf(x)
  const e0 = (ix >> 20) - 1046 // e0 = ilogb(z)-23
  let z = fromWords(ix - (e0 << 20), low)
  const tx = KTX
  for (let i = 0; i < 2; i++) { tx[i] = z | 0; z = (z - tx[i]) * TWO24 }
  tx[2] = z
  let nx = 3
  while (tx[nx - 1] === 0) nx-- // skip zero term
  const n = kernelRemPio2(tx, y, e0, nx)
  if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n }
  return n
}

const C1 = 4.16666666666666019037e-02
const C2 = -1.38888888888741095749e-03
const C3 = 2.48015872894767294178e-05
const C4 = -2.75573143513906633035e-07
const C5 = 2.08757232129817482790e-09
const C6 = -1.13596475577881948265e-11

function kernelCos(x: number, y: number): number {
  const ix = hiOf(x) & 0x7fffffff
  if (ix < 0x3e400000) return 1 // |x| < 2^-27 (C: if ((int)x == 0) return one, always true here)
  const z = x * x
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)) // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0) // x > 0.78125 ? 0.28125 : x/4
  const iz = 0.5 * z - qx
  const a = 1 - qx
  return a - (iz - (z * r - x * y))
}

const S1 = -1.66666666666666324348e-01
const S2 = 8.33333333332248946124e-03
const S3 = -1.98412698298579493134e-04
const S4 = 2.75573137070700676789e-06
const S5 = -2.50507602534068634195e-08
const S6 = 1.58969099521155010221e-10

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hiOf(x) & 0x7fffffff
  if (ix < 0x3e400000) return x // |x| < 2^-27
  const z = x * x
  const v = z * x
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
  if (iy === 0) return x + v * (S1 + z * r)
  return x - ((z * (0.5 * y - v * r) - y) - v * S1)
}

/** Sine, bit-identical to V8's Math.sin (fdlibm; V8 builds without V8_USE_LIBM_TRIG_FUNCTIONS in Node). */
export function sinD(x: number): number {
  const ix = hiOf(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0) // |x| ~< pi/4
  if (ix >= 0x7ff00000) return x - x // sin(Inf or NaN) is NaN
  const n = remPio2(x)
  const y0 = RY[0], y1 = RY[1]
  switch (n & 3) {
    case 0: return kernelSin(y0, y1, 1)
    case 1: return kernelCos(y0, y1)
    case 2: return -kernelSin(y0, y1, 1)
    default: return -kernelCos(y0, y1)
  }
}

/** Cosine, bit-identical to V8's Math.cos (fdlibm). */
export function cosD(x: number): number {
  const ix = hiOf(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kernelCos(x, 0) // |x| ~< pi/4
  if (ix >= 0x7ff00000) return x - x // cos(Inf or NaN) is NaN
  const n = remPio2(x)
  const y0 = RY[0], y1 = RY[1]
  switch (n & 3) {
    case 0: return kernelCos(y0, y1)
    case 1: return -kernelSin(y0, y1, 1)
    case 2: return -kernelCos(y0, y1)
    default: return kernelSin(y0, y1, 1)
  }
}

/** sqrt(a^2 + b^2 + ...), bit-identical to V8's Math.hypot (builtin MathHypot: scale by the largest, Kahan-sum the squares). */
export function hypotD(...v: number[]): number {
  const n = v.length
  if (n === 0) return 0
  let nan = false, max = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(v[i])
    if (a !== a) nan = true
    else if (a > max) max = a
  }
  if (max === Infinity) return Infinity
  if (nan) return NaN
  if (max === 0) return 0
  let sum = 0, compensation = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(v[i])
    const q = (a !== a ? 0 : a) / max // (NaN never reaches here)
    const summand = q * q - compensation
    const preliminary = sum + summand
    compensation = (preliminary - sum) - summand
    sum = preliminary
  }
  return Math.sqrt(sum) * max
}
