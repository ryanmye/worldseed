// The story plan (experience-whatif-director-sagas §2.3): which chronicle entries the director makes beats of, and
// which become notices, fixed once per History so scrubbing stays exact and tests stay deterministic. Pure, no RNG,
// ties break by entry index. CSS-free (imports drama.ts only).
//
// Live score of entry n at time t given the beats chosen before it:
//   S(n, t) = S0(n) · N(n, t) · D(n) · F(n)
//   N = 1 / (1 + Σ_j [e^{−(t − t_j)/τ_key}·[key_j = key_n] + 0.5·e^{−(t − t_j)/τ_cat}·[cat_j = cat_n]])   novelty
//   D = 1 − 0.3·[cat = cat_prev] − 0.3·[shares a polity with prev]                                        diversity
//   F = 1.5 when the entry involves a focused polity (the selection, a seat), else 1                     focus
//   K = 1 + κ·exp(−Σ_j e^{−(t − t_j)/τ_type}·[kind_j = kind_n]), or 1 + debut for a kind not told yet     freshness
// K (surfacing lane, EVALUATION §4 Lane 1): a kind of story (the representative event's type) not told for a long while is
// fresher than one told last generation, so a great battle, an eruption or a default gets its turn among the conquests.
//
// Greedy chronological pass: from the last beat's year t_b, the entries in (t_b + G_MIN, t_b + G_MIN + W]; the argmax
// of S is a beat if S ≥ θ, else the stretch is quiet and t_b moves on by W. Each beat's prominence is the distance in
// years to the nearest beat of higher S0·N (∞ for the top one); at playback speed k a beat is kept when prominence ≥
// STORY.promPerSpeed·k (the plan's G_MIN·k, retuned: see promPerSpeed), so the beats at 16× are a subset of those at 4×, a subset of those at 1×. Entries with S ≥ θ_n that are not
// beats become notices.

import type { StaticDrama } from './drama.ts'

export const STORY: {
  tauKey: number; tauCat: number; gMin: number; window: number; theta: number; thetaNote: number; focus: number; promPerSpeed: number
  fresh: number; tauType: number; debut: number; floor: number; like: number; likeYears: number; ahead: number
} = {
  /** Novelty decay for the same polity or people, and for the same kind of story (years). */
  tauKey: 120,
  /** (the plan's 40 y let one kind of story fill a third of the beats: 150 y, tuned with storyStats.ts) */
  tauCat: 150,
  /** Minimum years between beats, and the window searched after it. */
  gMin: 25,
  window: 50,
  /** Beat threshold θ, notice threshold θ_n. */
  theta: 6,
  /** (the plan's 3.5 gave ~1400 notices on 2000 years: 9.5 gave 60–150; 11 with the merged systems listed (surfacing lane), tuned with storyStats.ts) */
  thetaNote: 11,
  /** Focus factor F. */
  focus: 1.5,
  /** A beat is kept at speed k when its prominence ≥ promPerSpeed·k years (at most G_MIN at 1×, so 1× keeps every beat).
   * The plan's G_MIN·k (25·k) kept 1–3 beats at 16×; 18·k gives 4×: 11–14 and 16×: 3–5 on 2000 years (storyStats.ts). */
  promPerSpeed: 18,
  /** Freshness K: κ, and the decay of a told kind of story (years). Tuned with storyStats.ts on Realistic and Dramatic. */
  fresh: 0.6,
  tauType: 250,
  /** A merged system's stories (drama.ts storyKind >= 1000) never told yet in the run (their debut) get K = 1 + debut. */
  debut: 1,
  /** The beat search's floor: an entry scores at least floor·S0 whatever came before it. */
  floor: 0.6,
  /** Of two stories within likeYears, the greater (S0) is told if it scores at least like × the pick now. */
  like: 0.8,
  likeYears: 2,
  /** An entry just past the window (within gMin of the pick) that scores ahead × the pick is told instead. */
  ahead: 1.5,
}

export interface StoryPlan {
  beatEntry: Int32Array
  beatYear: Float64Array
  beatScore: Float32Array
  /** Years to the nearest beat of higher S0·N; Infinity for the top one. */
  beatProminence: Float32Array
  beatCell: Int32Array
  beatScale: Uint8Array
  noteEntry: Int32Array
  noteYear: Float64Array
  noteScore: Float32Array
}

export interface PlanOptions {
  /** Polities whose entries get the focus factor (the selection, a seat). */
  focus?: ReadonlySet<number>
  /** Only entries up to this year (the history's length; default: all). */
  until?: number
  /**
   * Story arcs (ui/story/arcs.ts arcEntries; lane N3, throne-stories §2.2): per entry its arc (-1) and phase, per arc its
   * payoff entry. Inside an arc whose earlier chapter is a beat, novelty ignores the arc's own beats and S grows x (1 + 0.4
   * phase); an arc whose opening is a beat has its payoff made a beat too, kept at every speed its opening is.
   */
  arcs?: { arcOf: Int32Array; phase: Uint8Array; payoffOf: Int32Array }
}

/** The story plan of the static scores `sd` over entries dated `years` (HistoryIndex.notableYear). */
export function buildStoryPlan(sd: StaticDrama, years: Float64Array, opts: PlanOptions = {}): StoryPlan {
  const E = sd.score.length
  const until = opts.until ?? Infinity
  const focus = opts.focus
  const beats: number[] = []
  const beatNov: number[] = []
  const notes: number[] = []
  const noteScore: number[] = []
  const isBeat = new Uint8Array(E)

  /** S0·N of entry n at its year, given the beats so far. */
  const arcs = opts.arcs
  const arcBeat = new Uint8Array(arcs ? arcs.payoffOf.length : 0) // (an arc with a beat so far)
  const novel = (n: number) => {
    const t = years[n]
    let sum = 0
    const an = arcs && arcs.arcOf[n] >= 0 && arcBeat[arcs.arcOf[n]] ? arcs.arcOf[n] : -1
    for (let j = beats.length - 1; j >= 0; j--) {
      const b = beats[j]
      if (an >= 0 && arcs!.arcOf[b] === an) continue // (continuity: the arc's own chapters do not count against it)
      const dt = t - years[b]
      if (dt > 6 * STORY.tauKey) break // e^-6: negligible (beats are in year order)
      if (sd.key[b] === sd.key[n]) sum += Math.exp(-dt / STORY.tauKey)
      if (sd.cat[b] === sd.cat[n]) sum += 0.5 * Math.exp(-dt / STORY.tauCat)
    }
    return sd.score[n] / (1 + sum)
  }
  /** K: 1 + κ·exp(−Σ same-type beats, decayed). */
  const fresh = (n: number) => {
    if (STORY.fresh <= 0 || !sd.type) return 1
    const t = years[n], ty = sd.type[n]
    let sum = 0
    for (let j = beats.length - 1; j >= 0; j--) {
      const b = beats[j]
      const dt = t - years[b]
      if (dt > 6 * STORY.tauType) break
      if (sd.type[b] === ty) sum += Math.exp(-dt / STORY.tauType)
    }
    return told.has(ty) || ty < 1000 ? 1 + STORY.fresh * Math.exp(-sum) : 1 + STORY.debut // (debut: a merged system's kinds only, drama.ts storyKind)
  }
  /** Story kinds told so far (a kind's first beat is its debut: K = 1 + debut). */
  const told = new Set<number>()
  const shares = (a: number, b: number) => (sd.polA[a] >= 0 && (sd.polA[a] === sd.polA[b] || sd.polA[a] === sd.polB[b])) || (sd.polB[a] >= 0 && (sd.polB[a] === sd.polA[b] || sd.polB[a] === sd.polB[b]))
  const live = (n: number, nov: number) => {
    let s = nov
    const prev = beats.length > 0 ? beats[beats.length - 1] : -1
    if (prev >= 0) s *= 1 - (sd.cat[n] === sd.cat[prev] ? 0.3 : 0) - (shares(n, prev) ? 0.3 : 0)
    if (focus && focus.size > 0 && ((sd.polA[n] >= 0 && focus.has(sd.polA[n])) || (sd.polB[n] >= 0 && focus.has(sd.polB[n])))) s *= STORY.focus
    if (arcs && arcs.arcOf[n] >= 0 && arcBeat[arcs.arcOf[n]]) s *= 1 + 0.4 * arcs.phase[n]
    return s
  }

  // entries are in year order (notableYear ascending); a cursor over them
  let lo = 0
  let tb = -STORY.gMin - 1 // so the first window starts at year 0
  const last = E > 0 ? Math.min(until, years[E - 1]) : -1
  while (tb + STORY.gMin < last) {
    const from = tb + STORY.gMin, to = tb + STORY.gMin + STORY.window
    while (lo < E && years[lo] <= from) lo++
    let best = -1, bestS = 0, bestNov = 0
    const at = (n: number): [number, number] => {
      const nov = novel(n) * fresh(n)
      // (a floor: an event far above its neighbours is told even right after one like it; surfacing lane, so a run's
      // greatest battle is not lost to the battle a generation before)
      return [Math.max(live(n, nov), STORY.floor * sd.score[n]), nov]
    }
    let hi = lo
    for (let n = lo; n < E && years[n] <= to && years[n] <= until; n++, hi = n) {
      if (sd.score[n] <= 0) continue
      const [s, nov] = at(n)
      if (s > bestS) {
        bestS = s
        best = n
        bestNov = nov
      }
    }
    if (best >= 0 && sd.type) {
      // of two stories told at once (within likeYears), tell the greater if it scores nearly as well now
      let alt = -1
      for (let n = lo; n < hi; n++) {
        if (n === best || Math.abs(years[n] - years[best]) > STORY.likeYears || sd.score[n] <= sd.score[alt < 0 ? best : alt]) continue
        if (at(n)[0] >= STORY.like * bestS) alt = n
      }
      // and a lesser beat does not block a far greater one just past the window (within gMin of it)
      for (let n = hi; n < E && years[n] <= years[best] + STORY.gMin && years[n] <= until; n++) {
        if (sd.score[n] <= 0) continue
        const s = at(n)[0]
        if (s >= STORY.ahead * bestS && (alt < 0 || years[alt] <= to || s > at(alt)[0])) alt = n
      }
      if (alt >= 0) {
        const [s, nov] = at(alt)
        best = alt
        bestS = s
        bestNov = nov
      }
    }
    if (best >= 0 && bestS >= STORY.theta) {
      beats.push(best)
      if (sd.type) told.add(sd.type[best])
      beatNov.push(bestNov)
      isBeat[best] = 1
      if (arcs && arcs.arcOf[best] >= 0) arcBeat[arcs.arcOf[best]] = 1
      tb = years[best]
    } else tb += STORY.window
  }
  // debuts (surfacing lane): a merged system with stories above θ but no beat swaps its best one for the nearest beat
  // within 1.5 gMin whose kind is told at least twice, when its debut score beats that beat's (the spacing stays about gMin)
  if (sd.type && STORY.debut > 0) {
    const kindBeats = new Map<number, number>()
    for (const b of beats) kindBeats.set(sd.type[b], (kindBeats.get(sd.type[b]) ?? 0) + 1)
    const bestOf = new Map<number, number>()
    for (let n = 0; n < E && years[n] <= until; n++) {
      const k = sd.type[n]
      if (k < 1000 || kindBeats.has(k) || sd.score[n] < STORY.theta) continue
      const o = bestOf.get(k)
      if (o === undefined || sd.score[n] > sd.score[o]) bestOf.set(k, n)
    }
    for (const [k, n] of [...bestOf].sort((x, y) => sd.score[y[1]] - sd.score[x[1]] || x[1] - y[1])) {
      const yn = years[n], s = sd.score[n] * (1 + STORY.debut)
      let j = -1
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i], d = Math.abs(years[b] - yn)
        if (d >= 1.5 * STORY.gMin || (kindBeats.get(sd.type[b]) ?? 0) < 2 || beatNov[i] >= s) continue
        // (no other beat closer than gMin / 2 to the debut)
        if (beats.some((c, ci) => ci !== i && Math.abs(years[c] - yn) < STORY.gMin / 2)) continue
        if (j < 0 || d < Math.abs(years[beats[j]] - yn)) j = i
      }
      if (j < 0) continue
      kindBeats.set(sd.type[beats[j]], kindBeats.get(sd.type[beats[j]])! - 1)
      kindBeats.set(k, 1)
      isBeat[beats[j]] = 0
      isBeat[n] = 1
      beats[j] = n
      beatNov[j] = s
      // (keep year order)
      const order = beats.map((_, i) => i).sort((x, y) => years[beats[x]] - years[beats[y]] || beats[x] - beats[y])
      const b2 = order.map((i) => beats[i]), v2 = order.map((i) => beatNov[i])
      beats.length = 0; beats.push(...b2)
      beatNov.length = 0; beatNov.push(...v2)
    }
  }
  // notices: the rest scoring at least θ_n, at their own year, given the beats before them
  {
    const allBeats = beats.slice()
    beats.length = 0
    let bi = 0
    for (let n = 0; n < E && years[n] <= until; n++) {
      while (bi < allBeats.length && allBeats[bi] < n) beats.push(allBeats[bi++])
      if (isBeat[n] || sd.score[n] <= 0) continue
      const s = live(n, novel(n))
      if (s >= STORY.thetaNote) {
        notes.push(n)
        noteScore.push(s)
      }
    }
    beats.length = 0
    beats.push(...allBeats)
  }
  // arcs: the payoff guarantee (an arc whose opening chapter is a beat gets its payoff as a beat, within `until`)
  const payoffBeats = new Map<number, number>() // payoff entry -> the arc's first beat entry
  if (arcs) {
    const firstBeat = new Int32Array(arcs.payoffOf.length).fill(-1)
    for (const b of beats) { const a = arcs.arcOf[b]; if (a >= 0 && firstBeat[a] < 0 && arcs.phase[b] < 3) firstBeat[a] = b }
    for (let a = 0; a < arcs.payoffOf.length; a++) {
      const n = arcs.payoffOf[a]
      if (firstBeat[a] < 0 || n < 0 || years[n] > until || sd.score[n] <= 0) continue
      payoffBeats.set(n, firstBeat[a])
      if (isBeat[n]) continue
      isBeat[n] = 1
      let k = beats.length
      while (k > 0 && beats[k - 1] > n) k--
      beats.splice(k, 0, n)
      beatNov.splice(k, 0, sd.score[n])
    }
  }
  // prominence (isolation): distance to the nearest beat of higher S0·N, ties broken by entry index (the earlier is higher)
  const B = beats.length
  const prom = new Float32Array(B)
  const higher = (a: number, b: number) => beatNov[a] > beatNov[b] || (beatNov[a] === beatNov[b] && beats[a] < beats[b])
  for (let i = 0; i < B; i++) {
    let d = Infinity
    for (let j = i - 1; j >= 0; j--) if (higher(j, i)) { d = years[beats[i]] - years[beats[j]]; break }
    for (let j = i + 1; j < B; j++) if (higher(j, i)) { d = Math.min(d, years[beats[j]] - years[beats[i]]); break }
    prom[i] = d
  }
  // (a payoff is kept at every speed its arc's opening is: computed after prominence, so 16x ⊂ 4x ⊂ 1x still holds)
  if (payoffBeats.size > 0) for (let i = 0; i < B; i++) {
    const open = payoffBeats.get(beats[i])
    if (open === undefined) continue
    const oi = beats.indexOf(open)
    if (oi >= 0 && prom[oi] > prom[i]) prom[i] = prom[oi]
  }
  return {
    beatEntry: Int32Array.from(beats),
    beatYear: Float64Array.from(beats, (n) => years[n]),
    beatScore: Float32Array.from(beats, (_, i) => beatNov[i]),
    beatProminence: prom,
    beatCell: Int32Array.from(beats, (n) => sd.cell[n]),
    beatScale: Uint8Array.from(beats, (n) => sd.scale[n]),
    noteEntry: Int32Array.from(notes),
    noteYear: Float64Array.from(notes, (n) => years[n]),
    noteScore: Float32Array.from(noteScore),
  }
}

/** Whether beat b is kept at playback speed `speed` (speeds below 1× keep every beat). */
export const beatKept = (plan: StoryPlan, b: number, speed: number) => plan.beatProminence[b] >= Math.min(STORY.gMin, STORY.promPerSpeed) * Math.max(1, speed)

/** The first beat kept at `speed` with year ≥ `year` (from index `from`), or -1. */
export function nextBeat(plan: StoryPlan, year: number, speed: number, from = 0): number {
  const Y = plan.beatYear
  let a = from, b = Y.length
  while (a < b) {
    const m = (a + b) >>> 1
    if (Y[m] < year) a = m + 1
    else b = m
  }
  for (let i = a; i < Y.length; i++) if (beatKept(plan, i, speed)) return i
  return -1
}

/** Beats kept at `speed`, counted. */
export function keptCount(plan: StoryPlan, speed: number): number {
  let n = 0
  for (let i = 0; i < plan.beatYear.length; i++) if (beatKept(plan, i, speed)) n++
  return n
}
