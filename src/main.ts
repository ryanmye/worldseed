import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { World, WorldOptions } from './contract.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'
import { buildGlobeMesh, type GlobeMesh } from './render/globe.ts'
import { buildRiverLines, type RiverLines } from './render/rivers.ts'
import { buildAtmosphere, buildClouds, buildStarfield, type Clouds } from './render/sky.ts'
import { createOverlay } from './ui/overlay.ts'
import { attachPointer } from './ui/pointer.ts'
import { ViewMode, isViewMode, type ViewMode as ViewModeT } from './render/palette.ts'
import { createCameraFly } from './render/cameraFly.ts'
import { createHistoryView } from './ui/historyView.ts'

// ---------- URL parameters ----------
// seed, view (terrain|elevation|...|population), spin=0, lon/lat/az (degrees), dist, clouds=0|1, rivers=0,
// sub (subdivisions), year=<n> (start year), play=0 (start paused), select=<settlement id>, markers=0, journeys=0,
// land=0 (no farmland on the Terrain view), structures=0 (no ports, dams or reservoirs)

const params = new URLSearchParams(window.location.search)

function numParam(name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = params.get(name)
  if (raw === null) return fallback
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

function seedFromUrl(): number {
  const raw = params.get('seed')
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 12345
}

function setUrlParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  window.history.replaceState(null, '', url)
}

const WORLD_OPTIONS: WorldOptions = { subdivisions: Math.round(numParam('sub', 48, 4, 160)) }

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('missing #app root')

const canvas = document.createElement('canvas')
canvas.id = 'globe-canvas'
app.appendChild(canvas)

// ---------- three.js scaffolding ----------

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 300)
{
  const lat = THREE.MathUtils.degToRad(numParam('lat', 12, -89, 89))
  const az = THREE.MathUtils.degToRad(numParam('az', 0))
  const dist = numParam('dist', 3.25, 1.4, 8)
  camera.position.set(dist * Math.sin(az) * Math.cos(lat), dist * Math.sin(lat), dist * Math.cos(az) * Math.cos(lat))
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x010205, 1)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.minDistance = 1.25
controls.maxDistance = 8
controls.rotateSpeed = 0.6
controls.zoomSpeed = 0.8

// The planet turns beneath a sun fixed in world space; the first drag stops it.
let spinning = numParam('spin', 1) !== 0
const SPIN_SPEED = 0.05 // rad/s
const fly = createCameraFly(camera)
controls.addEventListener('start', () => {
  spinning = false
  fly.cancel()
})

const stars = buildStarfield()
scene.add(stars)
const atmosphere = buildAtmosphere()
scene.add(atmosphere.mesh)

const planetGroup = new THREE.Group()
planetGroup.rotation.y = -THREE.MathUtils.degToRad(numParam('lon', 0))
scene.add(planetGroup)

let currentGlobe: GlobeMesh | null = null
let currentRivers: RiverLines | null = null
let currentClouds: Clouds | null = null
let currentWorld: World | null = null
let showRivers = params.get('rivers') !== '0'
let showClouds = params.get('clouds') !== '0'
let showMarkers = params.get('markers') !== '0'
let showJourneys = params.get('journeys') !== '0'
let showFarmland = params.get('land') !== '0'
let showStructures = params.get('structures') !== '0'
let viewMode: ViewModeT = isViewMode(params.get('view')) ? (params.get('view') as ViewModeT) : ViewMode.Terrain

function applyLayerVisibility() {
  const terrain = viewMode === ViewMode.Terrain
  if (currentRivers) currentRivers.lines.visible = showRivers && terrain
  if (currentClouds) currentClouds.mesh.visible = showClouds && terrain
  atmosphere.setStrength(terrain ? 1 : 0.35)
}

function clearPlanet() {
  if (currentGlobe) {
    planetGroup.remove(currentGlobe.mesh)
    currentGlobe.dispose()
    currentGlobe = null
  }
  if (currentRivers) {
    planetGroup.remove(currentRivers.lines)
    currentRivers.dispose()
    currentRivers = null
  }
  if (currentClouds) {
    planetGroup.remove(currentClouds.mesh)
    currentClouds.dispose()
    currentClouds = null
  }
  pointerInput.reset()
}

function showWorld(world: World) {
  clearPlanet()
  currentWorld = world
  currentGlobe = buildGlobeMesh(world, viewMode)
  currentGlobe.setFarmlandVisible(showFarmland)
  currentGlobe.setReservoirsVisible(showStructures)
  planetGroup.add(currentGlobe.mesh)
  currentRivers = buildRiverLines(world)
  planetGroup.add(currentRivers.lines)
  currentClouds = buildClouds(world.seed)
  planetGroup.add(currentClouds.mesh)
  applyLayerVisibility()
  historyView.setWorld(world)
}

// ---------- worker ----------
// One request per seed; responses for superseded requests are dropped.

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
let requestId = 0

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data
  if (msg.requestId !== requestId) return
  if (msg.type === 'world') {
    overlay.setGenerating(false)
    showWorld(msg.world)
  } else if (msg.type === 'history') {
    console.info(`history: ${msg.history.settlements.length} settlements, ${msg.history.events.length} events, ${msg.ms.toFixed(0)} ms`)
    historyView.setHistory(msg.history)
  } else if (msg.stage === 'world') {
    overlay.setGenerating(false)
    console.error('world generation failed:', msg.message)
  } else {
    historyView.setHistoryError(msg.message)
  }
}

function requestWorld(seed: number) {
  overlay.setGenerating(true)
  overlay.setReadout(null)
  const req: WorkerRequest = { requestId: ++requestId, seed, options: WORLD_OPTIONS }
  worker.postMessage(req)
}

// ---------- UI ----------

let currentSeed = seedFromUrl()

function clearHistoryParams() {
  setUrlParam('year', null)
  setUrlParam('play', null)
  setUrlParam('select', null)
}

const overlay = createOverlay(app, currentSeed, { viewMode, rivers: showRivers, clouds: showClouds, markers: showMarkers, journeys: showJourneys, farmland: showFarmland, structures: showStructures }, {
  onSeedSubmit(seed: number) {
    if (seed === currentSeed && currentWorld?.seed === seed) return
    currentSeed = seed
    setUrlParam('seed', String(seed))
    clearHistoryParams()
    requestWorld(seed)
  },
  onRandomSeed() {
    currentSeed = Math.floor(Math.random() * 1_000_000)
    overlay.setSeed(currentSeed)
    setUrlParam('seed', String(currentSeed))
    clearHistoryParams()
    requestWorld(currentSeed)
  },
  onViewModeChange(mode: ViewModeT) {
    viewMode = mode
    overlay.setViewMode(mode)
    setUrlParam('view', mode === ViewMode.Terrain ? null : mode)
    currentGlobe?.setMode(mode)
    historyView.setViewMode(mode)
    applyLayerVisibility()
  },
  onRiversToggle(show: boolean) {
    showRivers = show
    applyLayerVisibility()
  },
  onCloudsToggle(show: boolean) {
    showClouds = show
    setUrlParam('clouds', show ? null : '0')
    applyLayerVisibility()
  },
  onMarkersToggle(show: boolean) {
    showMarkers = show
    setUrlParam('markers', show ? null : '0')
    historyView.setMarkersVisible(show)
  },
  onJourneysToggle(show: boolean) {
    showJourneys = show
    setUrlParam('journeys', show ? null : '0')
    historyView.setJourneysVisible(show)
  },
  onFarmlandToggle(show: boolean) {
    showFarmland = show
    setUrlParam('land', show ? null : '0')
    currentGlobe?.setFarmlandVisible(show)
  },
  onStructuresToggle(show: boolean) {
    showStructures = show
    setUrlParam('structures', show ? null : '0')
    currentGlobe?.setReservoirsVisible(show)
    historyView.setStructuresVisible(show)
  },
})

const intParam = (name: string): number | null => {
  const raw = params.get(name)
  const v = raw === null ? NaN : Number.parseInt(raw, 10)
  return Number.isFinite(v) ? v : null
}

const historyView = createHistoryView(
  {
    bottom: overlay.bottom,
    left: overlay.left,
    right: overlay.right,
    planetGroup,
    camera,
    canvas,
    fly,
    getGlobe: () => currentGlobe,
    onFly: () => {
      spinning = false
    },
    setUrlParam,
  },
  { year: intParam('year'), play: params.get('play') !== '0', select: intParam('select') },
)
historyView.setViewMode(viewMode)
historyView.setMarkersVisible(showMarkers)
historyView.setJourneysVisible(showJourneys)
historyView.setStructuresVisible(showStructures)

setUrlParam('seed', String(currentSeed))
requestWorld(currentSeed)

// ---------- pointer: terrain readout on hover, settlement hover/click ----------

const pointerInput = attachPointer({
  canvas,
  camera,
  getWorld: () => currentWorld,
  getGlobe: () => currentGlobe,
  setReadout: (r) => overlay.setReadout(r),
  pickSettlement: (x, y) => historyView.pickAt(x, y),
  hoverSettlement: (id) => historyView.setHover(id),
  selectSettlement: (id) => historyView.select(id, false),
})

// ---------- resize ----------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---------- render loop ----------

const timer = new THREE.Timer()
timer.connect(document)
const drawSize = new THREE.Vector2()

function tick(timestamp?: number) {
  timer.update(timestamp)
  const dt = Math.min(timer.getDelta(), 0.1)
  if (spinning) planetGroup.rotation.y += SPIN_SPEED * dt
  fly.update(dt)
  controls.update()
  currentClouds?.update(dt)
  currentGlobe?.update(camera)
  renderer.getDrawingBufferSize(drawSize)
  currentRivers?.update(camera, drawSize.y)
  historyView.tick(dt, drawSize, renderer.getPixelRatio())
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()
