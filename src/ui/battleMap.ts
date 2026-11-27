// battles: the 2D tactical replay (battles.md 7.2, battles#12): a panel with a canvas, the battle's ground (the cells within
// three hops of its site, projected on the tangent plane: biome colours, rivers, the sea, towns with their names that
// year) drawn once to an offscreen canvas, and per frame the armies' blocks in their polities' colours (battleTimeline.ts).
// Playback: play / pause, speed 0.5..4x, a scrubber with the phases marked, the previous / next battle of the war, Esc
// closes. It redraws only while playing, at the quality's playFps; nothing is drawn at rest. Opened from a battle's
// chronicle line (the replay button) or with the `.` key (the latest battle up to the year shown, at the selected town
// if it saw one).

import './battleMap.css'
import { BattleKind, RIVER_FLOW_THRESHOLD, settlementNameAt } from '../contract.ts'
import type { History, World } from '../contract.ts'
import { terrainColor } from '../render/palette.ts'
import { battleTitle, roundMen } from './battleFormat.ts'
import { battlesOf } from './battlesData.ts'
import { blockAt, buildTimeline, phaseAt, sidesAt } from './battleTimeline.ts'
import type { BlockPose, Timeline } from './battleTimeline.ts'
import { politiesOf } from './politiesData.ts'
import { addShortcut } from './shortcuts.ts'

export interface BattleMapDeps {
  host: HTMLElement
  history: () => History | null
  world: () => World | null
  /** Moves the timeline to the battle's year (the towns and borders as they were). */
  setYear?: (y: number) => void
  /** Frames per second while playing (render/quality playFps). */
  fps?: () => number
}

export interface BattleOpenOptions {
  /** onboarding: the story director's replay: a smaller panel beside the globe that closes by itself at the end. */
  inline?: boolean
  /** Called once when this replay closes (by hand, by itself, or replaced by another). */
  onDone?: () => void
}

export interface BattleMap {
  open(b: number, opts?: BattleOpenOptions): void
  close(): void
  isOpen(): boolean
  /** The battle `.` opens at `year`: the latest battle up to then at settlement `sel` (if any), else anywhere; -1 if none. */
  pick(year: number, sel: number): number
}

const SIZE = 480
const SPAN = 3.2 // cells from the centre to the canvas edge
const SPEEDS = [0.5, 1, 2, 4]
/** onboarding: an inline replay closes this many ms after its end. */
const INLINE_LINGER_MS = 2500

export function createBattleMap(deps: BattleMapDeps): BattleMap {
  const root = document.createElement('div')
  root.className = 'battle-map hidden'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', 'Battle replay')
  const title = document.createElement('div')
  title.className = 'bm-title'
  const sub = document.createElement('div')
  sub.className = 'bm-sub'
  const canvas = document.createElement('canvas')
  canvas.width = SIZE; canvas.height = SIZE
  canvas.className = 'bm-canvas'
  const bar = document.createElement('div')
  bar.className = 'bm-bar'
  const btn = (label: string, aria: string): HTMLButtonElement => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria); return b }
  const prev = btn('‹', 'Previous battle of the war'), play = btn('▶', 'Play or pause'), next = btn('›', 'Next battle of the war'), close = btn('×', 'Close the replay')
  const speed = btn('1×', 'Speed')
  const scrub = document.createElement('input')
  scrub.type = 'range'; scrub.min = '0'; scrub.max = '1000'; scrub.value = '0'; scrub.className = 'bm-scrub'; scrub.setAttribute('aria-label', 'Replay time')
  const phase = document.createElement('span')
  phase.className = 'bm-phase'
  bar.append(prev, play, speed, scrub, next, close)
  const note = document.createElement('div')
  note.className = 'bm-note'
  note.textContent = 'A stylised field: one cell is some 150 km on the globe. Figures as the chroniclers give them.'
  root.append(title, sub, canvas, bar, phase, note)
  deps.host.appendChild(root)
  const ctx = canvas.getContext('2d')
  const ground = document.createElement('canvas')
  ground.width = SIZE; ground.height = SIZE

  let battle = -1
  let tl: Timeline | null = null
  let t = 0, playing = false, si = 1, last = 0, raf = 0
  let inline = false, onDone: (() => void) | null = null, lingerTimer = 0
  const pose: BlockPose = { x: 0, y: 0, depth: 0, facing: 1, alive: 1 }
  const px = SIZE / (2 * SPAN)
  const toX = (x: number): number => SIZE / 2 + x * px
  const toY = (y: number): number => SIZE / 2 - y * px

  function drawGround(h: History, w: World, tl: Timeline, year: number): void {
    const g = ground.getContext('2d')
    if (!g) return
    g.fillStyle = '#1d3a55'
    g.fillRect(0, 0, SIZE, SIZE)
    const P = w.grid.positions
    const { neighborOffsets: off, neighbors: nb } = w.grid
    const site = h.battles.site[tl.battle]
    // the cells within 3 hops
    const seen = new Set<number>([site])
    let ring = [site]
    for (let k = 0; k < 4; k++) { const nx: number[] = []; for (const c of ring) for (let q = off[c]; q < off[c + 1]; q++) { const j = nb[q]; if (!seen.has(j)) { seen.add(j); nx.push(j) } } ring = nx }
    const loc = (c: number): [number, number] => {
      const dx = P[3 * c] - tl.origin[0], dy = P[3 * c + 1] - tl.origin[1], dz = P[3 * c + 2] - tl.origin[2]
      return [(dx * tl.ex[0] + dy * tl.ex[1] + dz * tl.ex[2]) / tl.cell, (dx * tl.ey[0] + dy * tl.ey[1] + dz * tl.ey[2]) / tl.cell]
    }
    const col = new Uint8Array(3)
    const cells = [...seen]
    for (const c of cells) {
      const [x, y] = loc(c)
      if (w.elevation[c] < 0) g.fillStyle = '#244a6b'
      else { terrainColor(w, c, col, 0, 255); const shade = 1 - 0.25 * Math.min(1, Math.max(0, w.elevation[c])); g.fillStyle = `rgb(${col[0] * shade | 0}, ${col[1] * shade | 0}, ${col[2] * shade | 0})` }
      g.beginPath(); g.arc(toX(x), toY(y), px * 0.62, 0, 2 * Math.PI); g.fill()
    }
    // rivers
    g.strokeStyle = '#5d9fd0'
    for (const c of cells) {
      if (w.elevation[c] < 0 || w.flow[c] < RIVER_FLOW_THRESHOLD) continue
      const to = w.riverTo[c]
      if (to < 0) continue
      const [x0, y0] = loc(c), [x1, y1] = loc(to)
      g.lineWidth = Math.min(5, 1 + Math.sqrt(w.flow[c] / RIVER_FLOW_THRESHOLD))
      g.beginPath(); g.moveTo(toX(x0), toY(y0)); g.lineTo(toX(x1), toY(y1)); g.stroke()
    }
    // towns of that year
    g.font = '12px system-ui, sans-serif'
    g.textAlign = 'center'
    for (let id = 0; id < h.settlements.length; id++) {
      const st = h.settlements[id]
      if (!seen.has(st.cell) || st.foundedYear > year || (st.abandonedYear >= 0 && st.abandonedYear <= year)) continue
      const [x, y] = loc(st.cell)
      g.fillStyle = '#f4ecd8'; g.strokeStyle = '#2a2116'; g.lineWidth = 1.5
      g.beginPath(); g.rect(toX(x) - 4, toY(y) - 4, 8, 8); g.fill(); g.stroke()
      g.fillStyle = 'rgba(20,16,10,0.85)'
      g.fillText(settlementNameAt(h, id, year), toX(x) + 1, toY(y) - 7)
      g.fillStyle = '#fbf6ea'
      g.fillText(settlementNameAt(h, id, year), toX(x), toY(y) - 8)
    }
  }

  function frame(): void {
    const h = deps.history()
    if (!ctx || !h || !tl) return
    ctx.drawImage(ground, 0, 0)
    const pd = politiesOf(h)
    const B = h.battles
    const colA = pd?.css[B.attacker[battle]] ?? '#d9534f', colD = pd?.css[B.defender[battle]] ?? '#4a7fd6'
    const ph = phaseAt(tl, t)
    // dust in the clash
    if (ph.kind === 'clash' || ph.kind === 'flank') {
      ctx.fillStyle = 'rgba(230, 215, 180, 0.22)'
      ctx.beginPath(); ctx.ellipse(SIZE / 2, SIZE / 2, px * 0.35, px * 0.9, 0, 0, 2 * Math.PI); ctx.fill()
    }
    for (let i = 0; i < tl.blocks.length; i++) {
      const bl = tl.blocks[i]
      blockAt(h, tl, i, t, pose)
      const cx = toX(pose.x), cy = toY(pose.y)
      const w = Math.max(3, pose.depth * px), hgt = Math.max(4, 2 * bl.half * px * (0.4 + 0.6 * pose.alive))
      ctx.fillStyle = bl.side === 0 ? colA : colD
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1
      if (tl.naval) { ctx.beginPath(); ctx.ellipse(cx, cy, w, hgt / 3, Math.PI / 2, 0, 2 * Math.PI); ctx.fill(); ctx.stroke() }
      else { ctx.fillRect(cx - w / 2, cy - hgt / 2, w, hgt); ctx.strokeRect(cx - w / 2, cy - hgt / 2, w, hgt) }
      // the facing: a tick on the front edge
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.fillRect(cx + (pose.facing > 0 ? w / 2 - 2 : -w / 2), cy - hgt / 2, 2, hgt)
    }
    // the advance arrow
    if (ph.kind === 'advance' || ph.kind === 'deploy') {
      ctx.strokeStyle = colA; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(toX(-0.6), toY(0)); ctx.lineTo(toX(-0.15), toY(0)); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(toX(-0.15), toY(0)); ctx.lineTo(toX(-0.25), toY(0.08)); ctx.lineTo(toX(-0.25), toY(-0.08)); ctx.closePath(); ctx.fillStyle = colA; ctx.fill()
    }
    const [a, d] = sidesAt(h, tl, t)
    const label: Record<string, string> = { deploy: 'The armies deploy', advance: tl.ford ? 'The attackers force the crossing' : tl.siege ? 'The assault on the walls' : 'The attackers advance', clash: 'The lines clash', flank: 'A flank is turned', break: (tl.winner === 0 ? 'The defenders' : 'The attackers') + ' break', rout: 'The rout', end: tl.winner === 0 ? 'The attackers hold the field' : 'The defenders hold the field' }
    phase.textContent = `${label[ph.kind]} · ${roundMen(B.menA[battle] * a)} against ${roundMen(B.menD[battle] * d)} still standing`
    scrub.value = String(Math.round((t / tl.seconds) * 1000))
  }

  function tick(now: number): void {
    raf = 0
    if (!playing || !tl) return
    const fps = deps.fps ? deps.fps() : 30
    if (now - last >= 1000 / fps - 1) {
      const dt = last > 0 ? Math.min(0.25, (now - last) / 1000) : 0
      last = now
      t += dt * SPEEDS[si]
      if (t >= tl.seconds) {
        t = tl.seconds; playing = false; play.textContent = '▶'
        if (inline) lingerTimer = window.setTimeout(() => api.close(), INLINE_LINGER_MS)
      }
      frame()
    }
    if (playing) raf = requestAnimationFrame(tick)
  }
  function setPlaying(on: boolean): void {
    playing = on
    play.textContent = on ? '❚❚' : '▶'
    if (on && tl && t >= tl.seconds) t = 0
    last = 0
    if (on && !raf) raf = requestAnimationFrame(tick)
  }

  function neighbour(dir: number): void {
    const h = deps.history()
    const bd = battlesOf(h)
    if (!h || !bd || battle < 0) return
    const rows = bd.byWar.get(h.battles.war[battle]) ?? []
    const i = rows.indexOf(battle) + dir
    if (i >= 0 && i < rows.length) api.open(rows[i])
  }

  play.addEventListener('click', () => { window.clearTimeout(lingerTimer); setPlaying(!playing) })
  speed.addEventListener('click', () => { si = (si + 1) % SPEEDS.length; speed.textContent = `${SPEEDS[si]}×` })
  prev.addEventListener('click', () => neighbour(-1))
  next.addEventListener('click', () => neighbour(1))
  close.addEventListener('click', () => api.close())
  scrub.addEventListener('input', () => { if (!tl) return; t = (Number(scrub.value) / 1000) * tl.seconds; frame() })
  addShortcut({ keys: ['Escape'], label: 'Esc', description: 'Close the battle replay', group: 'Panels', first: true, run: () => { if (battle < 0) return false; api.close(); return true } })

  const finish = () => {
    window.clearTimeout(lingerTimer)
    lingerTimer = 0
    const done = onDone
    onDone = null
    done?.()
  }
  const api: BattleMap = {
    open(b: number, opts?: BattleOpenOptions) {
      const h = deps.history(), w = deps.world()
      if (!h || !w || b < 0 || b >= h.battles.count) return
      finish()
      inline = opts?.inline ?? false
      onDone = opts?.onDone ?? null
      root.classList.toggle('bm-inline', inline)
      battle = b
      tl = buildTimeline(h, w, b)
      const year = h.battles.year[b]
      deps.setYear?.(year)
      drawGround(h, w, tl, year)
      const B = h.battles
      const pd = politiesOf(h)
      title.textContent = `${battleTitle(h, b)}, ${year}`
      const nameOf = (p: number): string => pd?.names[p] ?? 'the enemy'
      sub.textContent = B.kind[b] === BattleKind.Naval
        ? `Some ${roundMen(B.menA[b])} ships of ${nameOf(B.attacker[b])} against ${roundMen(B.menD[b])} of ${nameOf(B.defender[b])}`
        : `Some ${roundMen(B.menA[b])} of ${nameOf(B.attacker[b])} against perhaps ${roundMen(B.menD[b])} of ${nameOf(B.defender[b])}`
      root.classList.remove('hidden')
      t = 0
      frame()
      setPlaying(true)
    },
    close() {
      battle = -1; tl = null
      setPlaying(false)
      root.classList.add('hidden')
      finish()
    },
    isOpen: () => battle >= 0,
    pick(year: number, sel: number) {
      const h = deps.history()
      const bd = battlesOf(h)
      if (!h || !bd) return -1
      const B = h.battles
      if (sel >= 0) {
        const rows = bd.byTarget.get(sel)
        if (rows) for (let i = rows.length - 1; i >= 0; i--) if (B.year[rows[i]] <= year) return rows[i]
      }
      for (let b = B.count - 1; b >= 0; b--) if (B.year[b] <= year) return b
      return -1
    },
  }
  return api
}
