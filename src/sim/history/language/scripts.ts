// typology: writing systems at assembly (language-typology-scripts.md §5.5; HistoryOptions.typology). A script rides the
// existing writing idea: the IdeaAdoptions rows of the ideas keyed `writing` and `alphabet` (looked up by key), walked in
// (year, row) order, decide who made a script, who learned whose, who reformed theirs and who lost writing; in each 50-year bin
// between them a literate people under the rule (or the state faith) of a people writing a script of another family may give
// up its own for theirs. Each decision draws from 'script-<people>-<k>' (k: that people's decision count), each replacement from
// 'script-shift-<people>'; nothing here is read by the simulation, and every decision depends only on rows and snapshots up to
// its year, so a longer run repeats a shorter one's scripts.
//
//   writing, invented     a new script (origin Invented): logosyllabic with SCRIPT.firstLogo if none exists anywhere yet,
//                         SCRIPT.laterLogo for a later independent invention, else by the phonology fit below. ScriptInvented.
//   writing, learned      from a people with a script: a stimulus invention (a new family, by fit) with SCRIPT.stimulus, else an
//                         adapted daughter (a logosyllabic one becomes a syllabary in a non-isolating tongue with
//                         SCRIPT.logoToSyllabary). ScriptAdopted, or ScriptInvented (Stimulus).
//   alphabet, invented    a reform of the people's own script into an alphabet (an abjad for root-and-pattern tongues, an
//                         abugida from a syllabary or abugida of a simple-syllable tongue, featural with SCRIPT.featural).
//                         ScriptReformed.
//   alphabet, learned     from writers of the same line: a reform as above; from another line, the people takes an adapted
//                         daughter of the giver's script unless it already writes a segmental one. ScriptReplaced (cause Idea).
//   writing, lost         unwritten (a ScriptUse row with script -1); ScriptLost when no people writes a script of that line any more
//                         (also when the last writers of a line give it up for another).
//   rule and faith        exposure E to a script family = the share of the people's population in realms whose ruling people
//                         writes it, plus SCRIPT.faithMul x the share under a state faith whose holy city's people writes it;
//                         hazard SCRIPT.shiftRate x E^2 per bin once the mean over the last 4 bins reaches SCRIPT.shiftMin.
// Phonology fit [A; a design reading in the spirit of Daniels & Bright 1996]: simple syllables -> syllabary 0.6 / abugida 0.25
// / alphabet 0.15; moderate -> abugida 0.35 / syllabary 0.25 / alphabet 0.4; complex -> alphabet 0.6 / abjad 0.25 / abugida
// 0.15; root-and-pattern -> abjad 0.7 / alphabet 0.3.

import { EventType, IdeaHow, ScriptCause, ScriptOrigin, ScriptType, type Faith, type HistoryEvent, type IdeaAdoptions, type IdeaInfo, type People, type Scripts, type ScriptUse, type Settlement } from '../../../contract.ts'
import { createRng, type Rng } from '../../rng.ts'
import type { Drift } from '../../names/drift.ts'
import { SCRIPT } from '../../names/typology/params.ts'
import { Style } from '../../names/typology/profile.ts'

export interface ScriptInput {
  drift: Drift
  settlements: readonly Settlement[]
  peoples: readonly People[]
  ideas: readonly IdeaInfo[]
  adoptions: IdeaAdoptions
  population: Float32Array
  snapshotInterval: number
  snapshotCount: number
  /** Polity of each settlement per snapshot (q * S + v; -1 none), and the ruling people of each polity. */
  polity: Int16Array | null
  polityPeople: ArrayLike<number>
  /** State faith per snapshot per polity (q * P + p: faith id + 1, 0 none), and the faiths (empty without religion). */
  stateFaith: Uint8Array
  faiths: readonly Faith[]
}

export interface ScriptHistory {
  scripts: Scripts
  scriptUse: ScriptUse
  /** ScriptInvented ... ScriptLost, chronological. */
  events: HistoryEvent[]
}

const SEGMENTAL = (t: number): boolean => t === ScriptType.Alphabet || t === ScriptType.Abjad || t === ScriptType.Abugida || t === ScriptType.Featural

export function assembleScripts(inp: ScriptInput): ScriptHistory {
  const { drift, settlements, peoples, ideas, adoptions: A } = inp
  const seed = drift.world.seed
  const tree = drift.tree
  const S = settlements.length, P = peoples.length, Q = inp.snapshotCount, I = inp.snapshotInterval
  const W = ideas.findIndex((x) => x.key === 'writing'), AL = ideas.findIndex((x) => x.key === 'alphabet')
  // the proto-language of each people (its sound system: syllables and morphology)
  const proto = new Int32Array(P).fill(-1)
  for (let n = 0; n < tree.count; n++) if (tree.parent[n] < 0 && tree.people[n] >= 0 && tree.people[n] < P && proto[tree.people[n]] < 0) proto[tree.people[n]] = n
  const drawOf = (p: number) => (proto[p] >= 0 ? drift.base(proto[p]).typo?.draw : undefined)
  const largest = (p: number, year: number): number => {
    const q = Math.min(Q - 1, Math.max(0, Math.floor(year / I)))
    let best = -1, bx = 0
    for (let v = 0; v < S; v++) if (settlements[v].people === p) { const x = inp.population[q * S + v]; if (x > bx) { bx = x; best = v } }
    return best >= 0 ? best : peoples[p]?.founder ?? -1
  }
  const langOf = (p: number, year: number): number => { const v = largest(p, year); return v >= 0 ? drift.node(v, year) : proto[p] }

  // tables being built
  const sc = { type: [] as number[], direction: [] as number[], origin: [] as number[], parent: [] as number[], family: [] as number[], people: [] as number[], language: [] as number[], year: [] as number[], settlement: [] as number[], name: [] as string[] }
  const use: { year: number; script: number; cause: number }[][] = peoples.map(() => [])
  const cur = new Int32Array(P).fill(-1)
  const decisions = new Int32Array(P)
  const events: HistoryEvent[] = []

  const fit = (p: number, rng: Rng): number => {
    const d = drawOf(p)
    const u = rng.next()
    if (d && d.style === Style.RootPattern) return [ScriptType.Abjad, ScriptType.Alphabet][pickWFrom(u, [0.7, 0.3])]
    const syl = d?.syl ?? 1
    const table = syl === 0 ? [[ScriptType.Syllabary, 0.6], [ScriptType.Abugida, 0.25], [ScriptType.Alphabet, 0.15]] : syl === 1 ? [[ScriptType.Abugida, 0.35], [ScriptType.Syllabary, 0.25], [ScriptType.Alphabet, 0.4]] : [[ScriptType.Alphabet, 0.6], [ScriptType.Abjad, 0.25], [ScriptType.Abugida, 0.15]]
    return table[pickWFrom(u, table.map((x) => x[1]))][0]
  }
  const add = (type: number, origin: number, parent: number, p: number, year: number, at: number, rng: Rng, reform = false): number => {
    const id = sc.type.length
    const family = parent >= 0 && origin !== ScriptOrigin.Stimulus ? sc.family[parent] : id
    let dir: number
    const u = rng.next(), v = rng.next()
    if (parent >= 0 && origin !== ScriptOrigin.Stimulus && u < SCRIPT.keepDirection) dir = sc.direction[parent]
    else dir = pickWFrom(v, SCRIPT.direction)
    const base = peoples[p]?.name ?? 'Unknown'
    const had = sc.name.indexOf(base) >= 0
    sc.type.push(type); sc.direction.push(dir); sc.origin.push(origin); sc.parent.push(parent); sc.family.push(family); sc.people.push(p)
    sc.language.push(langOf(p, year)); sc.year.push(year); sc.settlement.push(at); sc.name.push(reform || had ? `New ${base}` : base)
    return id
  }
  const setUse = (p: number, year: number, script: number, cause: number): void => {
    const prev = cur[p]
    const list = use[p]
    if (list.length && list[list.length - 1].year === year) list[list.length - 1] = { year, script, cause }
    else list.push({ year, script, cause })
    cur[p] = script
    // (ScriptLost when a whole line of scripts goes unread: no people writes any script of its family)
    if (prev >= 0 && (script < 0 || sc.family[script] !== sc.family[prev])) {
      let still = false
      for (let q = 0; q < P && !still; q++) if (cur[q] >= 0 && sc.family[cur[q]] === sc.family[prev]) still = true
      if (!still) events.push({ year, type: EventType.ScriptLost, settlement: largest(p, year), other: -1, value: prev, extra: p })
    }
  }

  // decisions in (year, row) order, with the replacement bins between them
  const rows: number[] = []
  for (let k = 0; k < A.count; k++) if (A.idea[k] === W || (AL >= 0 && A.idea[k] === AL)) rows.push(k)
  rows.sort((a, b) => A.year[a] - A.year[b] || a - b)
  const years = drift.years
  const B = Math.floor(years / SCRIPT.bin) + 1
  const hist = peoples.map(() => [] as number[])
  const shiftRng = new Map<number, Rng>()
  let r = 0
  for (let b = 0; b <= B; b++) {
    const end = b < B ? b * SCRIPT.bin : Infinity
    for (; r < rows.length && A.year[rows[r]] < end; r++) decide(rows[r])
    if (b < B && b > 0) replaceBin(b * SCRIPT.bin)
  }

  function decide(k: number): void {
    const p = A.people[k], year = A.year[k], how = A.how[k], from = A.from[k]
    if (p < 0 || p >= P) return
    const rng = createRng(seed, `script-${p}-${decisions[p]++}`)
    const u = rng.next()
    if (A.idea[k] === W) {
      if (how === IdeaHow.Lost) { if (cur[p] >= 0) setUse(p, year, -1, ScriptCause.Lost); return }
      if (cur[p] >= 0) return // (already writing: a re-learning changes nothing)
      const src = from >= 0 && from < P ? cur[from] : -1
      if (how === IdeaHow.Invented || src < 0) {
        const first = sc.type.length === 0
        const type = rng.next() < (first ? SCRIPT.firstLogo : SCRIPT.laterLogo) && how === IdeaHow.Invented ? ScriptType.Logosyllabic : fit(p, rng)
        const origin = how === IdeaHow.Invented ? ScriptOrigin.Invented : ScriptOrigin.Stimulus
        const id = add(type, origin, -1, p, year, A.via[k], rng)
        setUse(p, year, id, ScriptCause.Own)
        events.push({ year, type: EventType.ScriptInvented, settlement: A.via[k], other: origin === ScriptOrigin.Stimulus ? A.source[k] : -1, value: id, extra: origin })
        return
      }
      if (u < SCRIPT.stimulus) {
        const id = add(fit(p, rng), ScriptOrigin.Stimulus, -1, p, year, A.via[k], rng)
        setUse(p, year, id, ScriptCause.Own)
        events.push({ year, type: EventType.ScriptInvented, settlement: A.via[k], other: A.source[k], value: id, extra: ScriptOrigin.Stimulus })
        return
      }
      let type = sc.type[src]
      const d = drawOf(p)
      if (type === ScriptType.Logosyllabic && d && d.style !== Style.Isolating && rng.next() < SCRIPT.logoToSyllabary) type = ScriptType.Syllabary
      const id = add(type, ScriptOrigin.Adapted, src, p, year, A.via[k], rng)
      setUse(p, year, id, ScriptCause.Learned)
      events.push({ year, type: EventType.ScriptAdopted, settlement: A.via[k], other: A.source[k], value: id, extra: src })
      return
    }
    // the alphabet
    if (how === IdeaHow.Lost || cur[p] < 0) return
    const own = cur[p]
    const gift = from >= 0 && from < P ? cur[from] : -1
    // (learned from writers of the same line, the alphabet is made out of the people's own signs: a reform, as derived alphabets are)
    if (how === IdeaHow.Invented || (gift >= 0 && sc.family[gift] === sc.family[own])) {
      if (SEGMENTAL(sc.type[own]) && sc.type[own] !== ScriptType.Abugida) return
      const d = drawOf(p)
      let type: number = ScriptType.Alphabet
      if (rng.next() < SCRIPT.featural) type = ScriptType.Featural
      else if (d && d.style === Style.RootPattern) type = ScriptType.Abjad
      else if ((sc.type[own] === ScriptType.Syllabary || sc.type[own] === ScriptType.Abugida) && d && d.syl === 0) type = ScriptType.Abugida
      if (type === sc.type[own]) return
      const at = largest(p, year)
      const id = add(type, ScriptOrigin.Reformed, own, p, year, at, rng, true)
      setUse(p, year, id, ScriptCause.Own)
      events.push({ year, type: EventType.ScriptReformed, settlement: at, other: -1, value: id, extra: own })
      return
    }
    const src = gift
    if (src < 0 || SEGMENTAL(sc.type[own]) || !SEGMENTAL(sc.type[src])) return
    replaceWith(p, year, src, ScriptCause.Idea, from, rng)
  }

  function replaceWith(p: number, year: number, src: number, cause: number, donor: number, rng: Rng): void {
    const at = largest(p, year)
    const id = add(sc.type[src], ScriptOrigin.Adapted, src, p, year, at, rng)
    setUse(p, year, id, cause)
    const other = donor >= 0 ? (cause === ScriptCause.Faith ? holyOf(donor, year) : largest(donor, year)) : -1
    events.push({ year, type: EventType.ScriptReplaced, settlement: at, other, value: id, extra: cause })
  }
  function holyOf(p: number, year: number): number {
    for (const f of inp.faiths) if (f.holyCity >= 0 && f.holyCity < S && settlements[f.holyCity].people === p && f.foundedYear <= year) return f.holyCity
    return largest(p, year)
  }

  function replaceBin(year: number): void {
    const pol = inp.polity
    if (!pol) return
    const q = Math.min(Q - 1, Math.floor(year / I))
    const PP = inp.polityPeople.length
    // per literate people: population, and exposure by family (with the donor people)
    const total = new Float64Array(P)
    const byFam: Map<number, { x: number; donor: number; faith: boolean }>[] = peoples.map(() => new Map())
    for (let v = 0; v < S; v++) {
      const p = settlements[v].people
      if (p < 0 || p >= P || cur[p] < 0) continue
      const x = inp.population[q * S + v]
      if (!(x > 0)) continue
      total[p] += x
      const pl = pol[q * S + v]
      if (pl < 0 || pl >= PP) continue
      const ruler = inp.polityPeople[pl]
      const rs = ruler >= 0 && ruler < P ? cur[ruler] : -1
      if (rs >= 0 && ruler !== p && sc.family[rs] !== sc.family[cur[p]]) {
        const m = byFam[p], f = sc.family[rs], e = m.get(f) ?? { x: 0, donor: ruler, faith: false }
        e.x += x
        m.set(f, e)
      }
      const sf = inp.stateFaith.length ? inp.stateFaith[q * PP + pl] : 0
      if (sf > 0 && sf - 1 < inp.faiths.length) {
        const hc = inp.faiths[sf - 1].holyCity
        const hp = hc >= 0 && hc < S ? settlements[hc].people : -1
        const hs = hp >= 0 && hp < P ? cur[hp] : -1
        if (hs >= 0 && hp !== p && sc.family[hs] !== sc.family[cur[p]]) {
          const m = byFam[p], f = sc.family[hs], e = m.get(f) ?? { x: 0, donor: hp, faith: true }
          e.x += SCRIPT.faithMul * x
          m.set(f, e)
        }
      }
    }
    for (let p = 0; p < P; p++) {
      if (cur[p] < 0 || !(total[p] > 0)) { hist[p].length = 0; continue }
      let best = -1, bx = 0, donor = -1, faith = false
      for (const [f, e] of byFam[p]) if (e.x > bx || (e.x === bx && f < best)) { bx = e.x; best = f; donor = e.donor; faith = e.faith }
      const E = Math.min(1, bx / total[p])
      const h = hist[p]
      h.push(E)
      if (h.length > 4) h.shift()
      const mean = h.reduce((a, b) => a + b, 0) / h.length
      if (h.length < 4 || mean < SCRIPT.shiftMin || donor < 0) continue
      let rng = shiftRng.get(p)
      if (!rng) shiftRng.set(p, (rng = createRng(seed, `script-shift-${p}`)))
      if (rng.next() >= SCRIPT.shiftRate * mean * mean) continue
      const src = cur[donor]
      if (src < 0) continue
      replaceWith(p, year, src, faith ? ScriptCause.Faith : ScriptCause.Rule, donor, rng)
      hist[p].length = 0
    }
  }

  const N = sc.type.length
  const scripts: Scripts = {
    count: N, type: Uint8Array.from(sc.type), direction: Uint8Array.from(sc.direction), origin: Uint8Array.from(sc.origin),
    parent: Int16Array.from(sc.parent), family: Int16Array.from(sc.family), people: Int16Array.from(sc.people), language: Int16Array.from(sc.language),
    year: Int16Array.from(sc.year), settlement: Int32Array.from(sc.settlement), name: sc.name.slice(),
  }
  const start = new Int32Array(P + 1)
  for (let p = 0; p < P; p++) start[p + 1] = start[p] + use[p].length
  const U = start[P]
  const scriptUse: ScriptUse = { start, year: new Int16Array(U), script: new Int16Array(U), cause: new Uint8Array(U) }
  for (let p = 0; p < P; p++) use[p].forEach((x, i) => { scriptUse.year[start[p] + i] = x.year; scriptUse.script[start[p] + i] = x.script; scriptUse.cause[start[p] + i] = x.cause })
  events.sort((a, b) => a.year - b.year || a.type - b.type || a.settlement - b.settlement || a.value - b.value)
  return { scripts, scriptUse, events }
}

function pickWFrom(u: number, w: readonly number[]): number {
  let t = 0
  for (const x of w) t += x
  let x = u * t
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i }
  return w.length - 1
}
