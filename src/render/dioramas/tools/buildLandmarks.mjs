// Offline tool (not part of the app bundle): packs the CC0 landmark pieces the diorama layer
// can draw beside its generated landmarks (landmarkShapes.ts) into one small .glb,
// public/models/landmarks/landmarks.glb, plus the pack's licence next to it.
//
//   node src/render/dioramas/tools/buildLandmarks.mjs <kaykit medieval hexagon repo dir> [outDir = public/models]
//
// (the repo: git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0)
//
// Same format as buildModels.mjs (gltfPack.mjs): one mesh per piece, named, flattened, colours
// baked into RGBA8 vertex colours, int8 normals, no textures, node extras { size }. Unlike
// that tool, each piece is centred on x/z with its base at y = 0 and scaled so that its larger
// horizontal footprint dimension is 2.0 model units; the front (door) faces +z.
//
// The colour alpha is the landmark mask of shapes.ts / landmarkShapes.ts:
//   128   wall: the pack's grey-blue stone. rgb becomes a grey shade, 188 = 1x: the vertex's
//         linear luminance over the mean linear luminance of the piece's wall group (area
//         weighted), so the instance's wall colour keeps the pack's shading
//   191   roof: the team-coloured (blue/red variant) faces inside the piece's roof height band,
//         shaded the same way against the mean of the roof group
//   255   banner: the other team-coloured faces, rgb kept as the pack's blue (luminance ~0.13
//         = 1x, as for the KayKit models of buildModels.mjs)
//   0     fixed: wood, plaster (light greys), charred timber, everything else

import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGltf, flatten, normalise, writeGlb, srgbToLinear, linearToSrgb } from './gltfPack.mjs'

const [kaykitDir, outDir = 'public/models'] = process.argv.slice(2)
if (!kaykitDir) {
  console.error('usage: node buildLandmarks.mjs <kaykit-medieval-hexagon repo> [outDir]')
  process.exit(1)
}
const KB = join(kaykitDir, 'addons/kaykit_medieval_hexagon_pack/Assets/gltf/buildings')

/**
 * The pieces. `src` is relative to the pack's buildings folder; `red` the red variant of a
 * team-coloured building (its differing vertices are the team colour); `roofY` the band of
 * source heights (after the base is put at y = 0, before scaling) whose team colour is roof.
 */
const PIECES = [
  { name: 'ruin_house', what: 'burnt-out, collapsed house on its stone footing, rubble round it', src: 'neutral/building_destroyed.gltf' },
  { name: 'build_yard', what: "builders' yard: timber scaffold, sheds, ladders, stone and timber stacks", src: 'neutral/building_scaffolding.gltf' },
  { name: 'build_a', what: 'construction stage 1: dressed stone blocks, timber and crates delivered', src: 'neutral/building_stage_A.gltf' },
  { name: 'build_b', what: 'construction stage 2: footing laid, first timber frame up, materials', src: 'neutral/building_stage_B.gltf' },
  { name: 'build_c', what: 'construction stage 3: walls rising in a timber frame, steps, materials', src: 'neutral/building_stage_C.gltf' },
  { name: 'watchtower', what: 'tall stone tower with a timber gallery and a conical roof, banners', src: 'blue/building_tower_B_blue.gltf', red: 'red/building_tower_B_red.gltf', roofY: [1.5, 2.3] },
  { name: 'round_tower', what: 'crenellated stone tower (flat timber top), banners', src: 'blue/building_tower_base_blue.gltf', red: 'red/building_tower_base_red.gltf', roofY: null },
]

const M_FIXED = 0, M_WALL = 128, M_ROOF = 191, M_TEAM = 255
const lumLin = (c) => 0.2126 * srgbToLinear(c[0] / 255) + 0.7152 * srgbToLinear(c[1] / 255) + 0.0722 * srgbToLinear(c[2] / 255)
const lumSrgb = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** The pack's stone: a low-saturation grey with a blue cast, darker than its whitewash. */
function isStone(c) {
  const [r, g, b] = c
  return Math.max(r, g, b) - Math.min(r, g, b) < 30 && b >= r - 4 && lumSrgb(c) < 170
}

const SCALE_TO = 2.0
const models = []
const report = []
for (const p of PIECES) {
  const m = flatten(loadGltf(join(KB, p.src)))
  const n = m.pos.length / 3
  // team colour from the red variant (same topology), as buildModels.mjs does
  let team = null
  if (p.red) {
    const r = flatten(loadGltf(join(KB, p.red)))
    if (r.pos.length !== m.pos.length) throw new Error('variant topology differs: ' + p.name)
    team = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const d = Math.abs(m.col[i * 3] - r.col[i * 3]) + Math.abs(m.col[i * 3 + 1] - r.col[i * 3 + 1]) + Math.abs(m.col[i * 3 + 2] - r.col[i * 3 + 2])
      team[i] = d > 30 ? 1 : 0
    }
  }
  const { size: raw } = normalise(m, false)
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const c = [m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]]
    const y = m.pos[i * 3 + 1]
    if (team && team[i]) mask[i] = p.roofY && y >= p.roofY[0] && y <= p.roofY[1] ? M_ROOF : M_TEAM
    else mask[i] = isStone(c) ? M_WALL : M_FIXED
  }
  // area weights per vertex, for the mean luminance of each masked group
  const wgt = new Float64Array(n)
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]]
    const ux = m.pos[b * 3] - m.pos[a * 3], uy = m.pos[b * 3 + 1] - m.pos[a * 3 + 1], uz = m.pos[b * 3 + 2] - m.pos[a * 3 + 2]
    const vx = m.pos[c * 3] - m.pos[a * 3], vy = m.pos[c * 3 + 1] - m.pos[a * 3 + 1], vz = m.pos[c * 3 + 2] - m.pos[a * 3 + 2]
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    wgt[a] += area / 3; wgt[b] += area / 3; wgt[c] += area / 3
  }
  const ref = {}
  for (const g of [M_WALL, M_ROOF]) {
    let s = 0, w = 0
    for (let i = 0; i < n; i++) if (mask[i] === g) { s += wgt[i] * lumLin([m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]]); w += wgt[i] }
    ref[g] = w > 0 ? s / w : 0
  }
  for (let i = 0; i < n; i++) {
    const g = mask[i]
    if (g !== M_WALL && g !== M_ROOF) continue
    // 188 sRGB is 0.5 linear, the material's 1x
    const k = lumLin([m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]]) / ref[g]
    const grey = Math.min(255, Math.max(0, Math.round(255 * linearToSrgb(Math.min(1, 0.5 * k)))))
    m.col[i * 3] = m.col[i * 3 + 1] = m.col[i * 3 + 2] = grey
  }
  // scale: the larger footprint dimension to 2.0 (positions are already centred, base at 0)
  const s = SCALE_TO / Math.max(raw[0], raw[2])
  for (let i = 0; i < m.pos.length; i++) m.pos[i] *= s
  const size = raw.map((v) => +(v * s).toFixed(4))
  models.push({ name: p.name, pos: m.pos, nor: m.nor, col: m.col, idx: m.idx, mask, size })
  const count = (g) => mask.reduce((a, v) => a + (v === g ? 1 : 0), 0)
  report.push([p.name, n, m.idx.length / 3, size.map((v) => v.toFixed(2)).join(' x '), `wall ${count(M_WALL)} roof ${count(M_ROOF)} team ${count(M_TEAM)} fixed ${count(M_FIXED)}`, `lumRef wall ${ref[M_WALL].toFixed(3)} roof ${ref[M_ROOF].toFixed(3)}`])
}

mkdirSync(join(outDir, 'landmarks'), { recursive: true })
const bytes = writeGlb(join(outDir, 'landmarks/landmarks.glb'), models, { generator: 'buildLandmarks.mjs' })
copyFileSync(join(kaykitDir, 'LICENSE.txt'), join(outDir, 'landmarks/License-kaykit-medieval-hexagon.txt'))
for (const r of report) console.log(r.join('\t'))
console.log('landmarks glb', bytes, 'bytes')
