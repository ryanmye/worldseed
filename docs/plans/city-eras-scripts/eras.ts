// Era frontier per settlement (proxy: highest era with >= half its ideas held by the settlement's people, + share of next era) at years.
import { generateWorld, simulateHistory } from '../src/sim/index.ts'
import { IDEA_DEFS } from '../src/sim/history/ideas/params.ts'
import { ideasHeldAt } from '../src/contract.ts'
const seeds = process.argv.slice(2).map(Number)
for (const seed of seeds) {
  const w = generateWorld(seed)
  const h = simulateHistory(w, { years: 2000 })
  const eraOfKey = new Map(IDEA_DEFS.map((d) => [d.key, d.era]))
  const ideaEra = h.ideas.map((i) => eraOfKey.get(i.key) ?? 0)
  const perEra = [0, 0, 0, 0, 0].map((_, e) => ideaEra.filter((x) => x === e).length)
  const out: Record<string, unknown> = { seed }
  for (const Y of [500, 1000, 1500, 2000]) {
    const s = Math.min(h.snapshotCount - 1, Math.floor(Y / h.snapshotInterval)), N = h.settlements.length
    const eraP = h.peoples.map((_, p) => {
      const held = ideasHeldAt(h, p, Y)
      const cnt = [0, 0, 0, 0, 0]
      for (const i of held) cnt[ideaEra[i]]++
      let e = -1
      for (let k = 0; k < 5; k++) if (cnt[k] >= perEra[k] / 2) e = k; else break
      const frac = e + 1 < 5 ? cnt[e + 1] / perEra[e + 1] : 0
      return Math.max(0, e) + frac
    })
    const hist = new Array(5).fill(0); let towns = 0; const hTown = new Array(5).fill(0)
    for (let i = 0; i < N; i++) { const p = h.population[s * N + i]; if (p <= 0) continue; const e = Math.floor(eraP[h.settlements[i].people]); hist[e]++; if (p >= 3000) { hTown[e]++; towns++ } }
    out['y' + Y] = { all: hist.join('/'), towns: hTown.join('/'), maxEra: Math.max(...eraP).toFixed(2) }
  }
  console.log(JSON.stringify(out))
}
