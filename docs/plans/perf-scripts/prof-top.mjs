// Top functions by self time (and by inclusive time per file) of a .cpuprofile. Usage: node prof-top.mjs file.cpuprofile [n]
import { readFileSync } from 'node:fs'
const p = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const n = +process.argv[3] || 40
const byId = new Map(p.nodes.map((x) => [x.id, x]))
const self = new Map()
const dt = p.timeDeltas
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (dt[i] ?? 0))
const total = [...self.values()].reduce((a, b) => a + b, 0)
const agg = new Map(), file = new Map()
for (const [id, t] of self) {
  const cf = byId.get(id).callFrame
  const f = cf.url.replace(/.*worldseed-perf\//, '')
  const k = `${cf.functionName || '(anon)'} ${f}:${cf.lineNumber + 1}`
  agg.set(k, (agg.get(k) ?? 0) + t)
  file.set(f, (file.get(f) ?? 0) + t)
}
const pct = (t) => ((100 * t) / total).toFixed(1).padStart(5) + '%'
console.log(`total ${(total / 1e6).toFixed(1)} s sampled`)
for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(pct(t), k)
console.log('--- self time by file')
for (const [k, t] of [...file].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(pct(t), k)
