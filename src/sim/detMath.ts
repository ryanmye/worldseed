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
