// Offline tool (not part of the app bundle): packs the subset of CC0 models the
// diorama layer uses into two small .glb files under public/models/.
//
//   node src/render/dioramas/tools/buildModels.mjs <kaykit repo dir> <kenney pirate kit dir> <kenney fantasy town kit dir>
//
// Each source model is flattened into one mesh (node transforms applied), its texture
// colour baked into per-vertex colours (all three packs use flat colour atlases), so the
// app needs no textures and every model can share one material. For KayKit buildings
// the blue and red variants are compared: vertices whose colour differs are the "team
// colour" (roofs, banners) and get a mask in the colour alpha, so the app can tint them
// per settlement without shipping four colour variants. Positions are float32, normals
// int8 (KHR_mesh_quantization), colours RGBA8 (sRGB rgb + team mask), indices uint16/32.
// The reading, flattening and writing live in gltfPack.mjs (shared with buildLandmarks.mjs).

import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGltf, flatten, normalise, writeGlb } from './gltfPack.mjs'

const [kaykitDir, pirateDir, townDir, outDir = 'public/models'] = process.argv.slice(2)
if (!kaykitDir || !pirateDir || !townDir) {
  console.error('usage: node buildModels.mjs <kaykit> <pirate-kit> <fantasy-town-kit> [outDir]')
  process.exit(1)
}

// ---------- the subset ----------
const KK = join(kaykitDir, 'addons/kaykit_medieval_hexagon_pack/Assets/gltf')
const kaykitTeam = ['home_A', 'home_B', 'church', 'market', 'tavern', 'well', 'blacksmith', 'windmill', 'watermill', 'castle', 'tower_A', 'barracks', 'lumbermill']
const kaykitPlain = [['trees', 'decoration/nature/trees_A_small.gltf']]
const report = []
const kModels = []
for (const name of kaykitTeam) {
  const blue = flatten(loadGltf(join(KK, `buildings/blue/building_${name}_blue.gltf`)))
  const red = flatten(loadGltf(join(KK, `buildings/red/building_${name}_red.gltf`)))
  let mask = null
  if (red.pos.length === blue.pos.length) {
    mask = new Uint8Array(blue.pos.length / 3)
    for (let i = 0; i < mask.length; i++) {
      const d = Math.abs(blue.col[i * 3] - red.col[i * 3]) + Math.abs(blue.col[i * 3 + 1] - red.col[i * 3 + 1]) + Math.abs(blue.col[i * 3 + 2] - red.col[i * 3 + 2])
      mask[i] = d > 30 ? 255 : 0
    }
  } else console.warn('variant topology differs:', name)
  const { size } = normalise(blue, false)
  kModels.push({ name, ...blue, mask, size })
  report.push([name, blue.pos.length / 3, blue.idx.length / 3, size.map((v) => +v.toFixed(2))])
}
for (const [name, file] of kaykitPlain) {
  const m = flatten(loadGltf(join(KK, file)))
  const { size } = normalise(m, false)
  kModels.push({ name, ...m, mask: null, size })
  report.push([name, m.pos.length / 3, m.idx.length / 3, size.map((v) => +v.toFixed(2))])
}

const PG = join(pirateDir, 'Models/GLB format')
const TG = join(townDir, 'Models/GLB format')
const kenney = [
  ['ship', join(PG, 'ship-small.glb'), true],
  ['ship_medium', join(PG, 'ship-medium.glb'), true],
  ['dock', join(PG, 'structure-platform-dock.glb'), true],
  ['cart', join(TG, 'cart.glb'), false],
]
const nModels = []
for (const [name, file, keepY] of kenney) {
  const m = flatten(loadGltf(file))
  const { size } = normalise(m, keepY)
  nModels.push({ name, ...m, mask: null, size })
  report.push([name, m.pos.length / 3, m.idx.length / 3, size.map((v) => +v.toFixed(2))])
}

mkdirSync(join(outDir, 'kaykit'), { recursive: true })
mkdirSync(join(outDir, 'kenney'), { recursive: true })
const a = writeGlb(join(outDir, 'kaykit/kaykit-medieval.glb'), kModels)
const b = writeGlb(join(outDir, 'kenney/kenney-ships.glb'), nModels)
copyFileSync(join(kaykitDir, 'LICENSE.txt'), join(outDir, 'kaykit/LICENSE.txt'))
copyFileSync(join(pirateDir, 'License.txt'), join(outDir, 'kenney/License-pirate-kit.txt'))
copyFileSync(join(townDir, 'License.txt'), join(outDir, 'kenney/License-fantasy-town-kit.txt'))
for (const r of report) console.log(r.join('\t'))
console.log('kaykit glb', a, 'bytes; kenney glb', b, 'bytes')
