// The simulation's code version, for the history cache (src/historyCache.ts): a hash of every
// file whose change can change a generated World or a simulated History. A cached history is
// only ever served to the same version.
//
// - build: computed once and baked in as __WORLDSEED_SIM_VERSION__ (define).
// - dev: served fresh at /__worldseed/sim-version (hashed again after any file under the hashed
//   paths changes), so a cache written before an edit is never read after it. A dev server that
//   was started before this config existed has no such endpoint: the cache is then off.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const ROOT = import.meta.dirname
/** Files and directories whose contents make up the version (directories recursively). */
const HASHED = ['src/sim', 'src/contract.ts', 'src/worker.ts', 'src/historyCache.ts']

function filesUnder(path: string, out: string[]) {
  const st = statSync(path, { throwIfNoEntry: false })
  if (!st) return
  if (st.isDirectory()) for (const name of readdirSync(path).sort()) filesUnder(join(path, name), out)
  else if (/\.(ts|js|json)$/.test(path) && !/\.test\.ts$/.test(path)) out.push(path)
}

function simVersion(): string {
  const files: string[] = []
  for (const p of HASHED) filesUnder(join(ROOT, p), files)
  const h = createHash('sha256')
  for (const f of files) {
    h.update(relative(ROOT, f).split(sep).join('/'))
    h.update('\0')
    h.update(readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

function simVersionPlugin(): Plugin {
  let cached: string | null = null
  const isHashed = (file: string) => {
    const rel = relative(ROOT, file).split(sep).join('/')
    return HASHED.some((p) => rel === p || rel.startsWith(p + '/'))
  }
  return {
    name: 'worldseed-sim-version',
    config(_config, env) {
      if (env.command === 'build') return { define: { __WORLDSEED_SIM_VERSION__: JSON.stringify(simVersion()) } }
    },
    configureServer(server) {
      const drop = (file: string) => {
        if (isHashed(file)) cached = null
      }
      server.watcher.on('change', drop)
      server.watcher.on('add', drop)
      server.watcher.on('unlink', drop)
      server.middlewares.use('/__worldseed/sim-version', (_req, res) => {
        cached ??= simVersion()
        res.setHeader('Content-Type', 'text/plain')
        res.setHeader('Cache-Control', 'no-store')
        res.end(`dev-${cached}`)
      })
    },
  }
}

export default defineConfig({
  plugins: [simVersionPlugin()],
})
