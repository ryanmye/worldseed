// Legends of the map views that had none: Elevation, Temperature, Rainfall, Biomes, Plates, Carrying capacity,
// Land use, Factions and Danger. One small panel under the map panel (as the Population, Crops, Faiths and Ideas
// legends, in their style), rebuilt only when the view changes (or the carrying capacity's scale arrives). The
// colours come from render/palette.ts; the Land use and Danger ramps are drawn in shaders (planetShaders.ts,
// polities.ts pl_heat) and repeated here.

import { biomeLegend, VIEW_RAMP_CSS, VIEW_SWATCH_CSS, ViewMode } from '../render/palette.ts'
import { formatPopulation } from './format.ts'

export interface ViewLegends {
  /** Show the legend of a view (none for the views that have their own, or none at all). */
  setMode(mode: ViewMode): void
  /** The Carrying capacity view's scale: the most people a cell could feed (0: unknown, no numbers). */
  setCapacityMax(max: number): void
}

const LANDUSE_CSS = 'linear-gradient(to right, rgb(41, 102, 56), rgb(128, 184, 66) 50%, rgb(245, 219, 77))'
const WORN_CSS = 'rgb(158, 61, 33)'
const DANGER_CSS = 'linear-gradient(to right, rgb(51, 26, 77), rgb(140, 31, 77) 33%, rgb(219, 77, 31) 66%, rgb(255, 199, 77))'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  e.append(...kids)
  return e
}

function swatch(background: string, label: string): HTMLElement {
  const sw = el('span', 'sp-swatch')
  sw.style.background = background
  return el('div', 'sp-legend-item none', sw, label)
}

/** A gradient bar with labels under its ends (and middle). */
function ramp(background: string, lo: string, hi: string, mid = ''): HTMLElement {
  const bar = el('span', 'vl-ramp')
  bar.style.background = background
  return el('div', 'vl-ramp-row', bar, el('div', 'vl-ramp-labels', el('span', '', lo), el('span', '', mid), el('span', '', hi)))
}

export function createViewLegends(right: HTMLElement): ViewLegends {
  const root = el('div', 'panel sp-legend vl-legend hidden')
  const title = el('div', 'sp-legend-title')
  const body = el('div', 'sp-legend-list')
  root.append(title, body)
  const mapPanel = right.querySelector('.map-panel')
  right.insertBefore(root, mapPanel ? mapPanel.nextSibling : right.firstChild)

  let mode: ViewMode | null = null
  let capacityMax = 0

  function build() {
    const parts: HTMLElement[] = []
    let t = ''
    switch (mode) {
      case ViewMode.Elevation:
        t = 'Height (−1 .. 1)'
        parts.push(ramp(VIEW_RAMP_CSS.elevation, '−1 deep sea', 'peaks 1', '0 coast'))
        break
      case ViewMode.Temperature:
        t = 'Mean temperature (0 .. 1)'
        parts.push(ramp(VIEW_RAMP_CSS.temperature, 'frozen', 'hottest', 'mild'))
        break
      case ViewMode.Rainfall:
        t = 'Rainfall on land (0 .. 1)'
        parts.push(ramp(VIEW_RAMP_CSS.rainfall, 'dry', 'wettest'))
        break
      case ViewMode.Biomes: {
        t = 'Biomes'
        const grid = el('div', 'vl-grid')
        for (const b of biomeLegend()) grid.append(swatch(b.css, b.name))
        parts.push(grid)
        break
      }
      case ViewMode.Plates:
        t = 'Tectonic plates'
        parts.push(el('div', 'vl-grid', swatch(VIEW_SWATCH_CSS.plateLand, 'A plate (its land)'), swatch(VIEW_SWATCH_CSS.plateSea, 'its sea floor')))
        parts.push(el('div', 'vl-note', 'Each plate has a colour of its own'))
        break
      case ViewMode.Capacity:
        t = 'People the land could feed, per cell'
        parts.push(ramp(VIEW_RAMP_CSS.capacity, 'few', capacityMax > 0 ? `~${formatPopulation(capacityMax)}` : 'most', capacityMax > 0 ? `~${formatPopulation(capacityMax / 4)}` : ''))
        parts.push(el('div', 'vl-grid', swatch(VIEW_SWATCH_CSS.barren, 'None'), swatch(VIEW_SWATCH_CSS.water, 'Water')))
        break
      case ViewMode.LandUse:
        t = 'Land in use'
        parts.push(ramp(LANDUSE_CSS, 'lightly farmed', 'farmed hard'))
        parts.push(el('div', 'vl-grid', swatch(VIEW_SWATCH_CSS.wild, 'Wild land'), swatch(WORN_CSS, 'Worn out')))
        break
      case ViewMode.Factions: {
        t = 'Factions'
        // (settled and claimed land: the Factions panel's own key says it)
        const vassal = el('div', 'sp-legend-item none', el('span', 'sp-swatch vl-striped'), 'Vassal')
        const tributary = el('div', 'sp-legend-item none', el('span', 'sp-swatch vl-tributary'), 'Tributary')
        parts.push(el('div', 'vl-grid', swatch(VIEW_SWATCH_CSS.stateless, 'No state'), vassal, tributary))
        parts.push(el('div', 'vl-note', 'A vassal in its overlord’s colour striped with its own; a tributary in its own, finely striped'))
        break
      }
      case ViewMode.Danger:
        t = 'Danger (raids, war, lawlessness)'
        parts.push(ramp(DANGER_CSS, 'some', 'deadly'))
        parts.push(el('div', 'vl-grid', swatch(VIEW_SWATCH_CSS.dangerLand, 'Safe')))
        break
      default:
        root.classList.add('hidden')
        return
    }
    title.textContent = t
    body.replaceChildren(...parts)
    root.classList.remove('hidden')
  }

  return {
    setMode(m: ViewMode) {
      if (m === mode) return
      mode = m
      build()
    },
    setCapacityMax(max: number) {
      if (max === capacityMax) return
      capacityMax = max
      if (mode === ViewMode.Capacity) build()
    },
  }
}
