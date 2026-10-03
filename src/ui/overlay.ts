// Plain-DOM UI overlay: seed controls, view mode toggle, layer toggles, hover readout.
// Exposes left/right/bottom containers that other panels (inspector, chronicle, timeline) join.

import { VIEW_MODES, BIOME_NAMES, type ViewMode } from '../render/palette.ts'
import type { Biome } from '../contract.ts'
import { GOOD_COLORS } from '../render/trade.ts'
import { GOOD_NAMES } from './format.ts'
import './trade.css'

export interface Readout {
  biome: Biome
  elevation: number
  temperature: number
  rainfall: number
  lake: boolean
}

export interface OverlayCallbacks {
  onSeedSubmit(seed: number): void
  onRandomSeed(): void
  onViewModeChange(mode: ViewMode): void
  onRiversToggle(show: boolean): void
  onCloudsToggle(show: boolean): void
  onMarkersToggle(show: boolean): void
  onJourneysToggle(show: boolean): void
  onFarmlandToggle(show: boolean): void
  onStructuresToggle(show: boolean): void
  /** 3D buildings, farms, docks and ships up close. */
  onBuildingsToggle?(show: boolean): void
  /** Trade routes and merchants. */
  onTradeToggle?(show: boolean): void
  /** Roads and bridges. */
  onRoadsToggle?(show: boolean): void
}

export interface OverlayOptions {
  viewMode: ViewMode
  rivers: boolean
  clouds: boolean
  markers: boolean
  journeys: boolean
  farmland: boolean
  structures: boolean
  buildings?: boolean
  trade?: boolean
  roads?: boolean
}

const MODE_LABELS: Record<ViewMode, string> = {
  terrain: 'Terrain',
  elevation: 'Elevation',
  temperature: 'Temperature',
  rainfall: 'Rainfall',
  plates: 'Plates',
  biomes: 'Biomes',
  population: 'Population',
  landuse: 'Land use',
}

export interface Overlay {
  root: HTMLElement
  /** Column under the seed bar (top-left). */
  left: HTMLElement
  /** Column under the view-mode panel (top-right). */
  right: HTMLElement
  /** Bottom-centre slot. */
  bottom: HTMLElement
  setGenerating(on: boolean): void
  setReadout(r: Readout | null): void
  setSeed(seed: number): void
  setViewMode(mode: ViewMode): void
}

export function createOverlay(container: HTMLElement, initialSeed: number, initial: OverlayOptions, callbacks: OverlayCallbacks): Overlay {
  const root = document.createElement('div')
  root.className = 'overlay'

  const topBar = document.createElement('div')
  topBar.className = 'panel top-bar'

  const seedLabel = document.createElement('label')
  seedLabel.className = 'seed-label'
  seedLabel.textContent = 'SEED'
  const seedInput = document.createElement('input')
  seedInput.type = 'text'
  seedInput.className = 'seed-input'
  seedInput.value = String(initialSeed)
  seedInput.inputMode = 'numeric'
  seedLabel.appendChild(seedInput)

  const randomBtn = document.createElement('button')
  randomBtn.className = 'btn'
  randomBtn.type = 'button'
  randomBtn.textContent = 'Random'

  topBar.appendChild(seedLabel)
  topBar.appendChild(randomBtn)

  const modePanel = document.createElement('div')
  modePanel.className = 'panel mode-panel'
  const modeButtons = new Map<ViewMode, HTMLButtonElement>()
  for (const mode of VIEW_MODES) {
    const btn = document.createElement('button')
    btn.className = 'btn mode-btn'
    btn.type = 'button'
    btn.textContent = MODE_LABELS[mode]
    btn.addEventListener('click', () => {
      callbacks.onViewModeChange(mode)
    })
    modeButtons.set(mode, btn)
    modePanel.appendChild(btn)
  }

  const makeToggle = (label: string, checked: boolean, first: boolean) => {
    const row = document.createElement('label')
    row.className = first ? 'layer-toggle first' : 'layer-toggle'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    row.appendChild(box)
    row.appendChild(document.createTextNode(' ' + label))
    modePanel.appendChild(row)
    return box
  }
  const riverCheckbox = makeToggle('Rivers', initial.rivers, true)
  const cloudCheckbox = makeToggle('Clouds', initial.clouds, false)
  const markerCheckbox = makeToggle('Settlements', initial.markers, false)
  const journeyCheckbox = makeToggle('Journeys', initial.journeys, false)
  const tradeCheckbox = makeToggle('Trade', initial.trade ?? true, false)
  // what the merchants carry, under the Trade toggle
  const legend = document.createElement('div')
  legend.className = 'goods-legend'
  legend.title = 'Goods carried by merchants'
  GOOD_NAMES.forEach((name, g) => {
    const item = document.createElement('span')
    const dot = document.createElement('span')
    dot.className = 'good-dot'
    dot.style.background = GOOD_COLORS[g]
    item.append(dot, name)
    legend.appendChild(item)
  })
  legend.classList.toggle('off', !tradeCheckbox.checked)
  modePanel.appendChild(legend)
  const roadCheckbox = makeToggle('Roads', initial.roads ?? true, false)
  const farmCheckbox = makeToggle('Farmland', initial.farmland, false)
  const structureCheckbox = makeToggle('Structures', initial.structures, false)
  const buildingCheckbox = makeToggle('Buildings', initial.buildings ?? true, false)

  const readoutPanel = document.createElement('div')
  readoutPanel.className = 'panel readout-panel hidden'

  const loadingOverlay = document.createElement('div')
  loadingOverlay.className = 'loading hidden'
  loadingOverlay.textContent = 'generating world…'

  const hint = document.createElement('div')
  hint.className = 'panel hint'
  hint.textContent = 'drag to orbit · scroll to zoom · click settlements'

  const left = document.createElement('div')
  left.className = 'side-column left'
  left.appendChild(topBar)
  const right = document.createElement('div')
  right.className = 'side-column right'
  right.appendChild(modePanel)
  const bottom = document.createElement('div')
  bottom.className = 'bottom-slot'

  root.appendChild(left)
  root.appendChild(right)
  root.appendChild(bottom)
  root.appendChild(readoutPanel)
  root.appendChild(hint)
  root.appendChild(loadingOverlay)
  container.appendChild(root)

  function submitSeed() {
    const parsed = Number.parseInt(seedInput.value, 10)
    if (Number.isFinite(parsed)) callbacks.onSeedSubmit(parsed)
  }

  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSeed()
  })
  seedInput.addEventListener('blur', submitSeed)
  randomBtn.addEventListener('click', () => callbacks.onRandomSeed())
  riverCheckbox.addEventListener('change', () => callbacks.onRiversToggle(riverCheckbox.checked))
  cloudCheckbox.addEventListener('change', () => callbacks.onCloudsToggle(cloudCheckbox.checked))
  markerCheckbox.addEventListener('change', () => callbacks.onMarkersToggle(markerCheckbox.checked))
  journeyCheckbox.addEventListener('change', () => callbacks.onJourneysToggle(journeyCheckbox.checked))
  farmCheckbox.addEventListener('change', () => callbacks.onFarmlandToggle(farmCheckbox.checked))
  structureCheckbox.addEventListener('change', () => callbacks.onStructuresToggle(structureCheckbox.checked))
  buildingCheckbox.addEventListener('change', () => callbacks.onBuildingsToggle?.(buildingCheckbox.checked))
  tradeCheckbox.addEventListener('change', () => {
    legend.classList.toggle('off', !tradeCheckbox.checked)
    callbacks.onTradeToggle?.(tradeCheckbox.checked)
  })
  roadCheckbox.addEventListener('change', () => callbacks.onRoadsToggle?.(roadCheckbox.checked))

  function setActiveModeButton(mode: ViewMode) {
    for (const [m, btn] of modeButtons) {
      btn.classList.toggle('active', m === mode)
    }
  }
  setActiveModeButton(initial.viewMode)

  return {
    root,
    left,
    right,
    bottom,
    setGenerating(on: boolean) {
      loadingOverlay.classList.toggle('hidden', !on)
    },
    setReadout(r: Readout | null) {
      if (!r) {
        readoutPanel.classList.add('hidden')
        return
      }
      readoutPanel.classList.remove('hidden')
      readoutPanel.innerHTML = `
        <div class="readout-biome">${BIOME_NAMES[r.biome] ?? 'Unknown'}${r.lake ? '<span class="readout-tag">lake</span>' : ''}</div>
        <div class="readout-row">Elevation <span>${r.elevation.toFixed(2)}</span></div>
        <div class="readout-row">Temperature <span>${r.temperature.toFixed(2)}</span></div>
        <div class="readout-row">Rainfall <span>${r.rainfall.toFixed(2)}</span></div>
      `
    },
    setSeed(seed: number) {
      seedInput.value = String(seed)
    },
    setViewMode(mode: ViewMode) {
      setActiveModeButton(mode)
    },
  }
}
