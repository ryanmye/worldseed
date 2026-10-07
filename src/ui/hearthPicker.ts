// Planting the first hearths: the player clicks up to N places on the globe (N: how many peoples the world will have)
// and each click drops a numbered hearth there (render/hearths.ts), snapped to the clicked cell; clicking a hearth again
// takes it away (and the later ones move up a number); a drag orbits the globe as usual. A cell that cannot be lived on
// (sea, shallows, ice, a lake) gets a red hearth and a note that the simulation will move it to the nearest land: the
// simulation decides. The list is the cradle list of HistoryOptions.cradles, in people order (numbers 1..N).
//
// One picker serves both places that plant: the start page (ui/landing.ts, before the history exists) and the Nudge
// panel's "Replant the hearths" (ui/nudgePanel.ts, at year 0 of the history shown). The caller places the picker's bar
// (the hint, the note, Clear and Done) and routes the map's clicks to pickCell (main.ts, before every other use).

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { Biome } from '../contract.ts'
import { buildHearthLayer, HEARTH_MAX, type HearthLayer } from '../render/hearths.ts'
import { surfaceRadius } from '../render/globe.ts'
import { placeFlat } from '../render/mapProjection.ts'
import { requestRender } from '../render/invalidate.ts'
import { canonicalCradles } from './cradlesContract.ts'
import './hearths.css'

/** A click this close (CSS px) to a hearth takes it away. */
const HIT_PX = 16

export interface HearthPickerDeps {
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  planetGroup: THREE.Group
  getWorld(): World | null
  wake(): void
}

export interface HearthSession {
  /** How many hearths can be planted (the peoples the world will have). */
  max: number
  /** The hearths to start from (a cradle list; -1 entries are dropped). */
  cells: readonly number[]
  /** The list changed (a hearth planted or taken away, Clear). */
  onChange?(cells: number[]): void
  /** Done: the list as planted (canonical; [] for none). */
  onDone(cells: number[]): void
  /** Esc: leave without keeping the changes (absent: Esc is Done). */
  onCancel?(): void
}

export interface HearthPicker {
  /** The bar to place: the hint ("Click up to N places"), the note, Clear and Done. */
  readonly bar: HTMLElement
  readonly active: boolean
  start(session: HearthSession): void
  /** Leave the mode (without calling onDone or onCancel). */
  stop(): void
  /** The hearths now planted, in people order. */
  cells(): number[]
  /** A click on the map landed on `cell`: taken (true) while planting. */
  pickCell(cell: number): boolean
  /** A new world: the hearths of the old one are gone. */
  setWorld(world: World | null): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
}

/** Whether people could live on a cell as it stands (the simulation's own test is finer: this is the hint). */
export function livableCell(w: World, cell: number): boolean {
  const b = w.biome[cell]
  return b !== Biome.Ocean && b !== Biome.Coast && b !== Biome.Ice && w.elevation[cell] >= 0 && !w.lake[cell]
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text) e.textContent = text
  return e
}

export function createHearthPicker(deps: HearthPickerDeps): HearthPicker {
  let layer: HearthLayer | null = null
  let world: World | null = null
  let session: HearthSession | null = null
  let list: number[] = []
  /** The last press on the canvas (client px): a click near a hearth takes it away. */
  const press = { x: -1e9, y: -1e9 }
  deps.canvas.addEventListener('pointerdown', (e) => {
    press.x = e.clientX
    press.y = e.clientY
  }, { capture: true })

  // ---------- the bar ----------
  const bar = el('div', 'hearth-bar hidden')
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Plant the first hearths')
  const hint = el('div', 'hearth-hint')
  hint.setAttribute('aria-live', 'polite')
  const note = el('div', 'hearth-note')
  const tools = el('div', 'hearth-tools')
  const clearBtn = el('button', 'hearth-btn', 'Clear')
  clearBtn.type = 'button'
  const doneBtn = el('button', 'hearth-btn hearth-done', 'Done')
  doneBtn.type = 'button'
  tools.append(clearBtn, doneBtn)
  bar.append(hint, note, tools)

  const livable = (cell: number) => (world ? livableCell(world, cell) : true)
  function render() {
    if (!session) return
    const n = list.length, max = session.max
    hint.textContent = n === 0 ? `Click up to ${max} places on the globe to set down the first peoples · drag to turn it` : n < max ? `${n} of ${max} placed · click to add, click a hearth to take it away` : `All ${max} placed · click a hearth to take it away`
    const wet = list.map((c, i) => [c, i + 1] as const).filter(([c]) => !livable(c)).map(([, k]) => k)
    note.textContent = wet.length ? `${wet.length === 1 ? `Hearth ${wet[0]} is` : `Hearths ${wet.join(', ')} are`} on water or ice: the people will move to the nearest land` : n > 0 ? 'Peoples you do not place begin where the world would have them.' : ''
    note.classList.toggle('hearth-warn', wet.length > 0)
    clearBtn.disabled = n === 0
    if (world) {
      if (!layer) {
        layer = buildHearthLayer()
        deps.planetGroup.add(layer.mesh)
      }
      layer.set(world, list.map((cell, i) => ({ cell, n: i + 1, livable: livable(cell) })))
    }
    requestRender()
    deps.wake()
  }
  function changed() {
    render()
    session?.onChange?.(list.slice())
  }
  function hideMarks() {
    if (layer) {
      deps.planetGroup.remove(layer.mesh)
      layer.dispose()
      layer = null
    }
    requestRender()
    deps.wake()
  }
  function end() {
    session = null
    bar.classList.add('hidden')
    deps.canvas.classList.remove('hearth-picking')
    hideMarks()
  }

  clearBtn.addEventListener('click', () => {
    list = []
    changed()
  })
  doneBtn.addEventListener('click', () => {
    const s = session
    if (!s) return
    const out = canonicalCradles(list)
    end()
    s.onDone(out)
  })
  window.addEventListener('keydown', (e) => {
    if (!session || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    const s = session
    if (s.onCancel) {
      end()
      s.onCancel()
    } else doneBtn.click()
  }, true)

  // ---------- which hearth is under the press ----------
  const v = new THREE.Vector3()
  function hearthAtPress(): number {
    if (!world) return -1
    const rect = deps.canvas.getBoundingClientRect()
    const P = world.grid.positions
    deps.planetGroup.updateWorldMatrix(true, false)
    const camDir = new THREE.Vector3()
    deps.camera.getWorldPosition(camDir)
    let best = -1, bd = HIT_PX
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      const r = Math.max(1, surfaceRadius(world, c))
      v.set(P[c * 3] * r, P[c * 3 + 1] * r, P[c * 3 + 2] * r)
      placeFlat(v)
      deps.planetGroup.localToWorld(v)
      // (only the hearths on the near side)
      const up = v.clone().normalize()
      if (up.dot(camDir.clone().sub(v).normalize()) <= 0) continue
      v.project(deps.camera)
      const x = rect.left + ((v.x + 1) / 2) * rect.width
      const y = rect.top + ((1 - v.y) / 2) * rect.height
      const d = Math.hypot(x - press.x, y - press.y)
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  return {
    bar,
    get active() {
      return session !== null
    },
    start(s: HearthSession) {
      session = { ...s, max: Math.max(1, Math.min(HEARTH_MAX, s.max)) }
      list = s.cells.filter((c) => c >= 0).slice(0, session.max)
      bar.classList.remove('hidden')
      deps.canvas.classList.add('hearth-picking')
      render()
    },
    stop() {
      if (session) end()
    },
    cells: () => list.slice(),
    pickCell(cell: number) {
      if (!session || !world) return false
      const hit = hearthAtPress()
      if (hit >= 0) list.splice(hit, 1)
      else if (list.length < session.max) list.push(cell)
      else {
        hint.textContent = `All ${session.max} placed · click a hearth to take it away first`
        return true
      }
      changed()
      return true
    },
    setWorld(w: World | null) {
      if (w === world) return
      world = w
      list = []
      if (session) render()
      else hideMarks()
    },
    update(camera, drawSize, pixelRatio) {
      layer?.update(camera, drawSize, pixelRatio)
    },
  }
}
