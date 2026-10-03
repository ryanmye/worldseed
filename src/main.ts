import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { World, WorldOptions } from './contract.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'
import { buildGlobeMesh, lakeArray, type GlobeMesh } from './render/globe.ts'
import { buildRiverLines, type RiverLines } from './render/rivers.ts'
import { buildAtmosphere, buildClouds, buildStarfield, type Clouds } from './render/sky.ts'
import { createOverlay, type Readout } from './ui/overlay.ts'
import { ViewMode, isViewMode, type ViewMode as ViewModeT } from './render/palette.ts'

// ---------- URL parameters ----------
// seed, view (terrain|elevation|...), spin=0, lon/lat/az (degrees), dist, clouds=0|1, rivers=0, sub (subdivisions)

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
controls.addEventListener('start', () => {
  spinning = false
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
  hoverCell = 0
}

function showWorld(world: World) {
  clearPlanet()
  currentWorld = world
  currentGlobe = buildGlobeMesh(world, viewMode)
  planetGroup.add(currentGlobe.mesh)
  currentRivers = buildRiverLines(world)
  planetGroup.add(currentRivers.lines)
  currentClouds = buildClouds(world.seed)
  planetGroup.add(currentClouds.mesh)
  applyLayerVisibility()
}

// ---------- worker ----------

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data
  overlay.setGenerating(false)
  if (msg.type === 'world') {
    showWorld(msg.world)
  } else {
    console.error('world generation failed:', msg.message)
  }
}

function requestWorld(seed: number) {
  overlay.setGenerating(true)
  overlay.setReadout(null)
  const req: WorkerRequest = { seed, options: WORLD_OPTIONS }
  worker.postMessage(req)
}

// ---------- UI ----------

let currentSeed = seedFromUrl()

const overlay = createOverlay(app, currentSeed, { viewMode, rivers: showRivers, clouds: showClouds }, {
  onSeedSubmit(seed: number) {
    if (seed === currentSeed && currentWorld?.seed === seed) return
    currentSeed = seed
    setUrlParam('seed', String(seed))
    requestWorld(seed)
  },
  onRandomSeed() {
    currentSeed = Math.floor(Math.random() * 1_000_000)
    overlay.setSeed(currentSeed)
    setUrlParam('seed', String(currentSeed))
    requestWorld(currentSeed)
  },
  onViewModeChange(mode: ViewModeT) {
    viewMode = mode
    overlay.setViewMode(mode)
    setUrlParam('view', mode === ViewMode.Terrain ? null : mode)
    currentGlobe?.setMode(mode)
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
})

setUrlParam('seed', String(currentSeed))
requestWorld(currentSeed)

// ---------- hover / click readout ----------
// Ray vs. the unit sphere in planet space, then a greedy walk over the cell
// graph to the nearest cell centre (cheap even at 100k+ cells).

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const planetSphere = new THREE.Sphere(new THREE.Vector3(), 1)
const invMatrix = new THREE.Matrix4()
const localRay = new THREE.Ray()
const hitPoint = new THREE.Vector3()
let hoverCell = 0

function nearestCell(world: World, x: number, y: number, z: number, start: number): number {
  const { positions: P, neighborOffsets: off, neighbors: nb } = world.grid
  let cur = start < world.grid.cellCount ? start : 0
  let best = P[cur * 3] * x + P[cur * 3 + 1] * y + P[cur * 3 + 2] * z
  for (let iter = 0; iter < 4096; iter++) {
    let next = -1
    for (let k = off[cur]; k < off[cur + 1]; k++) {
      const j = nb[k]
      const d = P[j * 3] * x + P[j * 3 + 1] * y + P[j * 3 + 2] * z
      if (d > best) {
        best = d
        next = j
      }
    }
    if (next < 0) break
    cur = next
  }
  return cur
}

function updateReadoutFromEvent(clientX: number, clientY: number) {
  if (!currentGlobe || !currentWorld) return
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  currentGlobe.mesh.updateWorldMatrix(true, false)
  invMatrix.copy(currentGlobe.mesh.matrixWorld).invert()
  localRay.copy(raycaster.ray).applyMatrix4(invMatrix)
  if (!localRay.intersectSphere(planetSphere, hitPoint)) {
    overlay.setReadout(null)
    return
  }
  hitPoint.normalize()
  const w = currentWorld
  const cell = nearestCell(w, hitPoint.x, hitPoint.y, hitPoint.z, hoverCell)
  hoverCell = cell
  const lake = lakeArray(w)
  const readout: Readout = {
    biome: w.biome[cell] as Readout['biome'],
    elevation: w.elevation[cell],
    temperature: w.temperature[cell],
    rainfall: w.rainfall[cell],
    lake: lake !== null && lake[cell] === 1,
  }
  overlay.setReadout(readout)
}

renderer.domElement.addEventListener('pointermove', (e) => {
  updateReadoutFromEvent(e.clientX, e.clientY)
})
renderer.domElement.addEventListener('click', (e) => {
  updateReadoutFromEvent(e.clientX, e.clientY)
})
renderer.domElement.addEventListener('pointerleave', () => overlay.setReadout(null))

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
  controls.update()
  currentClouds?.update(dt)
  currentGlobe?.update(camera)
  renderer.getDrawingBufferSize(drawSize)
  currentRivers?.update(camera, drawSize.y)
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()
