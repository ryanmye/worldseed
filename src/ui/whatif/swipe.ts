// What-if: the swipe globe (experience-whatif-director-sagas §1.8). One camera, one render: the polity overlay of the
// world shown (A) and an alt polity layer built from the other world (B, buildPolityLayer: whole or skeleton) are both
// drawn, each clipped at a screen-space divider by the overlays' uClip uniform (render/polities.ts) on gl_FragCoord.x;
// A's settlement markers (render/settlements.ts, the same uniform) and its labels (a CSS clip on the label canvas) stay
// left of it, B's capitals (the stars of its polity layer) right of it, and up to eight DOM tags name B's largest
// states at their towns' centroid (rewritten when the snapshot changes, projected per frame). The divider is a
// draggable bar with a 44 px hit target ([ and ] move it); on phones "Hold to peek" shows B over the whole globe while
// pressed. B's side shows the Political view on the Factions view, else the Tint (the Danger view needs arrays a
// skeleton lacks). Matched polities keep A's colours (the digest's pMatch), so a realm that is "the same" looks the same.
// Cost: one more overlay draw of the planet geometry and one more cell texture (a true split view would double every
// frame: rejected, as the plan says).

import * as THREE from 'three'
import type { History, World } from '../../contract.ts'
import { buildPolityLayer, PolityView, type PolityLayer } from '../../render/polities.ts'
import type { SettlementLayer } from '../../render/settlements.ts'
import type { LabelLayer } from '../../render/labels.ts'
import type { GlobeMesh } from '../../render/globe.ts'
import { surfaceRadius } from '../../render/globe.ts'
import { assignPolityColors, politiesOf, type PolitiesData } from '../politiesData.ts'
import { addShortcut } from '../shortcuts.ts'
import { requestRender } from '../../render/invalidate.ts'

export interface SwipeDeps {
  host: HTMLElement
  canvas: HTMLCanvasElement
  planetGroup: THREE.Group
  getGlobe(): GlobeMesh | null
  /** A's layers to clip (the ones showing now). */
  aPolities(): PolityLayer | null
  aSettlements(): SettlementLayer | null
  aLabels(): LabelLayer | null
  /** The view shown on A's side is the Factions view (B then shows Political, else Tint). */
  political(): boolean
  phone: boolean
  wake(): void
}

export interface Swipe {
  /** Show the other world `B` beside the one shown, or nothing (null). `pMatch` (B → A polity, -1) and A's polity data give matched realms A's colours. */
  setAlt(world: World | null, B: History | null, pdA?: PolitiesData | null, pMatch?: Int16Array | null): void
  readonly on: boolean
  tick(year: number, s0: number, s1: number, frac: number, pulseYears: number, fx: number, camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
}

const TAGS = 8

export function createSwipe(deps: SwipeDeps): Swipe {
  let layer: PolityLayer | null = null
  let pd: PolitiesData | null = null
  let B: History | null = null
  let world: World | null = null
  /** Divider position, a fraction of the canvas width; peeking puts it at 0 (B everywhere). */
  let f = 0.5
  let peeking = false
  let shownS = -1
  const tags: HTMLDivElement[] = []
  const tagAt: { cell: number; on: boolean }[] = []
  const tmp = new THREE.Vector3()

  const divider = document.createElement('div')
  divider.className = 'wi-divider'
  divider.setAttribute('role', 'slider')
  divider.setAttribute('aria-label', 'Divider between this world (left) and the other world (right)')
  divider.tabIndex = 0
  const grip = document.createElement('div')
  grip.className = 'wi-grip'
  grip.textContent = '⇔'
  divider.append(grip)
  const leftLabel = document.createElement('div')
  leftLabel.className = 'wi-sidelabel'
  leftLabel.textContent = 'this world'
  const rightLabel = document.createElement('div')
  rightLabel.className = 'wi-sidelabel'
  rightLabel.textContent = 'the other world'
  const peek = document.createElement('button')
  peek.type = 'button'
  peek.className = 'wi-peek'
  peek.textContent = 'Hold to peek'
  peek.title = 'Show the other world over the whole globe while held'
  for (const e of [divider, leftLabel, rightLabel, peek]) e.hidden = true
  deps.host.append(divider, leftLabel, rightLabel, peek)

  const place = () => {
    const r = deps.canvas.getBoundingClientRect()
    const hr = deps.host.getBoundingClientRect()
    const x = r.left - hr.left + (peeking ? 0 : f) * r.width
    divider.style.left = `${x}px`
    divider.style.top = `${r.top - hr.top}px`
    divider.style.height = `${r.height}px`
    divider.setAttribute('aria-valuenow', String(Math.round(f * 100)))
    leftLabel.style.left = `${Math.max(8, x - 96)}px`
    rightLabel.style.left = `${x + 12}px`
    leftLabel.style.top = rightLabel.style.top = `${r.top - hr.top + 8}px`
    const labels = deps.aLabels()
    if (labels) labels.canvas.style.clipPath = on() ? `inset(0 ${Math.max(0, r.right - (r.left + (peeking ? 0 : f) * r.width))}px 0 0)` : ''
    requestRender()
    deps.wake()
  }
  const setF = (v: number) => {
    f = Math.max(0, Math.min(1, v))
    place()
  }
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId)
    e.preventDefault()
    e.stopPropagation()
  })
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return
    const r = deps.canvas.getBoundingClientRect()
    setF((e.clientX - r.left) / Math.max(1, r.width))
  })
  divider.addEventListener('pointerup', (e) => divider.releasePointerCapture(e.pointerId))
  divider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { setF(f - 0.05); e.preventDefault() }
    if (e.key === 'ArrowRight') { setF(f + 0.05); e.preventDefault() }
  })
  const peekOn = (v: boolean) => { peeking = v; place() }
  peek.addEventListener('pointerdown', (e) => { e.preventDefault(); peekOn(true) })
  peek.addEventListener('pointerup', () => peekOn(false))
  peek.addEventListener('pointercancel', () => peekOn(false))
  peek.addEventListener('pointerleave', () => peekOn(false))
  window.addEventListener('resize', () => { if (on()) place() })
  addShortcut({ keys: ['['], label: '[ / ]', description: 'What if: move the swipe divider left / right', group: 'View', run: () => (on() ? (setF(f - 0.05), true) : false) })
  addShortcut({ keys: [']'], label: '[ / ]', description: 'What if: move the swipe divider left / right', group: 'View', run: () => (on() ? (setF(f + 0.05), true) : false) })

  const on = () => !!layer

  function clear() {
    if (layer) {
      deps.planetGroup.remove(layer.object)
      layer.dispose()
    }
    layer = null
    pd = null
    B = null
    for (const t of tags) t.remove()
    tags.length = 0
    tagAt.length = 0
    deps.aPolities()?.setClip(0, -1, false)
    deps.aSettlements()?.setClip(0, -1, false)
    const labels = deps.aLabels()
    if (labels) labels.canvas.style.clipPath = ''
    for (const e of [divider, leftLabel, rightLabel, peek]) e.hidden = true
  }

  /** The largest polities of B at snapshot s and their towns' centroid cell (the most populous member's, for the tag). */
  function retag(s: number) {
    if (!B || !pd) return
    const N = B.settlements.length
    const pop = new Float64Array(pd.count)
    const big = new Int32Array(pd.count).fill(-1)
    for (let id = 0; id < N; id++) {
      const p = B.polity[s * N + id]
      if (p < 0 || p >= pd.count) continue
      const v = B.population[s * N + id]
      pop[p] += v
      if (big[p] < 0 || v > B.population[s * N + big[p]]) big[p] = id
    }
    const top = [...pop.keys()].filter((p) => pop[p] > 0).sort((a, b) => pop[b] - pop[a]).slice(0, TAGS)
    while (tags.length < TAGS) {
      const t = document.createElement('div')
      t.className = 'wi-tag'
      deps.host.append(t)
      tags.push(t)
      tagAt.push({ cell: -1, on: false })
    }
    for (let k = 0; k < TAGS; k++) {
      const p = top[k]
      tagAt[k].on = p !== undefined && big[p] >= 0
      tagAt[k].cell = tagAt[k].on ? B.settlements[big[p]].cell : -1
      tags[k].textContent = tagAt[k].on ? pd.names[p] : ''
    }
  }

  return {
    get on() {
      return on()
    },
    setAlt(w, h, pdA, pMatch) {
      clear()
      if (!w || !h) return
      const d = politiesOf(h)
      if (!d) return
      world = w
      B = h
      pd = d
      assignPolityColors(d, w)
      // (a matched realm keeps its colour in both worlds)
      if (pdA && pMatch) {
        for (let b = 0; b < d.count && b < pMatch.length; b++) {
          const a = pMatch[b]
          if (a < 0 || a >= pdA.count) continue
          for (let k = 0; k < 3; k++) d.rgb[b * 3 + k] = pdA.rgb[a * 3 + k]
          d.css[b] = pdA.css[a]
        }
      }
      layer = buildPolityLayer(w, h, d)
      layer.setGlobe(deps.getGlobe())
      deps.planetGroup.add(layer.object)
      shownS = -1
      for (const e of [divider, leftLabel, rightLabel]) e.hidden = false
      peek.hidden = !deps.phone
      place()
    },
    tick(year, s0, s1, frac, pulseYears, fx, camera, drawSize, pixelRatio) {
      if (!layer || !B || !world) return
      const x = (peeking ? 0 : f) * drawSize.x
      layer.setView(deps.political() ? PolityView.Political : PolityView.Tint)
      layer.setClip(x, 1, true)
      deps.aPolities()?.setClip(x, -1, true)
      deps.aSettlements()?.setClip(x, -1, true)
      const S = B.snapshotCount
      const a = Math.max(0, Math.min(S - 1, s0)), b = Math.max(0, Math.min(S - 1, s1))
      layer.setTime(year, a, b, frac, pulseYears, fx)
      layer.update(camera, drawSize, pixelRatio)
      if (a !== shownS) { shownS = a; retag(a) }
      // the tags: projected per frame, shown on B's side of the divider and on the near face
      const r = deps.canvas.getBoundingClientRect()
      const hr = deps.host.getBoundingClientRect()
      deps.planetGroup.updateWorldMatrix(true, false)
      const P = world.grid.positions
      for (let k = 0; k < tags.length; k++) {
        const t = tags[k], c = tagAt[k].cell
        if (!tagAt[k].on || c < 0) { t.hidden = true; continue }
        const rad = surfaceRadius(world, c)
        tmp.set(P[c * 3] * rad, P[c * 3 + 1] * rad, P[c * 3 + 2] * rad).applyMatrix4(deps.planetGroup.matrixWorld)
        const facing = tmp.clone().normalize().dot(camera.position.clone().normalize()) > 0.15
        tmp.project(camera)
        const sx = (tmp.x * 0.5 + 0.5) * r.width, sy = (-tmp.y * 0.5 + 0.5) * r.height
        const visible = facing && tmp.z < 1 && sx >= (peeking ? 0 : f) * r.width && sx <= r.width && sy >= 0 && sy <= r.height
        t.hidden = !visible
        if (visible) {
          t.style.left = `${r.left - hr.left + sx}px`
          t.style.top = `${r.top - hr.top + sy}px`
        }
      }
    },
  }
}
