// battles: the Lanchester square law in closed form (Lanchester 1916, Aircraft in Warfare), pure, + - * / sqrt only.
//
//   dA/dt = -beta D,  dD/dt = -alpha A,  invariant alpha A^2 - beta D^2 = const
// With a = A/A0, d = D/D0 and x = alpha A0^2 / (beta D0^2) (the attacker's square-law strength ratio): x a^2 - d^2 = x - 1.
// A side breaks when it falls to the fraction b of its strength (its morale; BATTLE.break0 = 0.8 is a design default: the
// data show no fixed breakpoint, Clark 1954 and Dupuy 1990 as summarised by The Dupuy Institute 2018a). The attacker wins
// iff x (1 - bA^2) >= 1 - bD^2, i.e. x >= x* = (1 - bD^2) / (1 - bA^2). Losses (fractions of the side's men):
//   attacker wins: fA = 1 - sqrt(1 - (1 - bD^2) / x),  fD = (1 - bD) + bD rho   (rho: the rout's share of what is left)
//   defender wins: fD = 1 - sqrt(1 - x (1 - bA^2)),    fA = (1 - bA) + bA rho
// Duration: with tau = sqrt(alpha beta) t and rs = sqrt(x), d(tau) = cosh tau - rs sinh tau and a(tau) = cosh tau - sinh tau / rs;
// d reaches b at z = e^tau = (rs + 1) / (sqrt(b^2 + rs^2 - 1) + b) (the earlier root, written without cancellation), and tau =
// ln z by lnSqrt (util.ts). The mirror (rs -> 1 / rs, b -> bA) when the attacker breaks.
//
// Luck: the day's luck multiplies the attacker's effectiveness by L = (1 - U) / U (log-logistic, U the war's single uniform
// draw), so P(x L >= x*) = x / (x + x*), the ratio-form contest success function (Tullock 1980; Hirshleifer 1989; Jia 2008).
// The outcome test `U < x / (x + x*)` is therefore today's `rng.next() < r*r / (r*r + 1)` when x = r*r and x* = 1 (bit for
// bit), and the realised ratio x' = x L drives losses and duration, so the record agrees with the outcome.
//
// Empirical standing: a stylised model. Engel (1954) fitted Iwo Jima with the square law; Willard (1962) found land battles
// of 1618-1905 far from it; Bracken (1995) found the linear law fit the Ardennes better; Lucas & Turkes (2004) found no law
// fits Kursk or the Ardennes well. Exponent 2 is kept because the baseline contest is exponent 2.

import { lnSqrt } from '../../util.ts'

/** The result of resolve (one reused object: copy what you keep). */
export interface Resolution {
  /** 0 the attacker won (the defenders broke), 1 the defender won. */
  winner: number
  /** Fractions of each side's men lost (killed, wounded, taken, scattered). */
  fA: number
  fD: number
  /** The realised ratio x' = x L. */
  xEff: number
  /** Dimensionless time to the break, sqrt(alpha beta) t. */
  tau: number
}

const out: Resolution = { winner: 0, fA: 0, fD: 0, xEff: 1, tau: 0 }

/** Luck factors are kept within [1/LMAX, LMAX] (U at 0 or 1 would be infinite odds). */
const LMAX = 1e6

/** tau at which a side of normalised ratio rs (its foe's strength over its own, square-law) falls to b. */
export function breakTime(rs: number, b: number): number {
  let q = b * b + rs * rs - 1
  if (q < 0) q = 0
  const z = (rs + 1) / (Math.sqrt(q) + b)
  return z > 1 ? lnSqrt(z) : 0
}

/**
 * One battle: x the attacker's square-law ratio (with modifiers), xs the threshold x* (1 with equal breaks), bA and bD the
 * break fractions, rho the rout share applied to the loser, U the outcome draw in [0, 1). The winner is decided exactly by
 * `U < x / (x + xs)`; the losses and the duration follow from x' = x (1 - U) / U.
 */
export function resolve(x: number, xs: number, bA: number, bD: number, rho: number, U: number): Resolution {
  const won = U < x / (x + xs)
  let L = U > 0 ? (1 - U) / U : LMAX
  if (L > LMAX) L = LMAX
  if (L < 1 / LMAX) L = 1 / LMAX
  const xe = x * L
  out.xEff = xe
  out.winner = won ? 0 : 1
  if (won) {
    let k = 1 - (1 - bD * bD) / xe
    if (k < bA * bA) k = bA * bA // (rounding at the threshold: the winner stops at its own break at worst)
    out.fA = 1 - Math.sqrt(k)
    out.fD = 1 - bD + bD * rho
    out.tau = breakTime(Math.sqrt(xe), bD)
  } else {
    let k = 1 - xe * (1 - bA * bA)
    if (k < bD * bD) k = bD * bD
    out.fD = 1 - Math.sqrt(k)
    out.fA = 1 - bA + bA * rho
    out.tau = breakTime(1 / Math.sqrt(xe), bA)
  }
  return out
}
