// Offline helpers (not part of the app bundle) shared by buildModels.mjs and
// buildLandmarks.mjs: read a glTF/glb, flatten its scene into one mesh with baked
// per-vertex colours, normalise it, and write a set of such meshes as one .glb
// (float32 or int16 positions, int8 normals via KHR_mesh_quantization, RGBA8 colours with
// a mask in alpha, uint16/32 indices, one shared material, no textures).
//
// The default paths (flatten(g), normalise(m, keepY), writeGlb(path, models)) are exactly
// what buildModels.mjs has always done, so its two .glb outputs stay byte-identical; the
// options are used by buildLandmarks.mjs only.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { inflateSync } from 'node:zlib'

// ---------- PNG decoding (8-bit, non-interlaced; RGB, RGBA or palette) ----------
export function decodePng(buf) {
  let pos = 8
  let width = 0, height = 0, colorType = 0, bitDepth = 0
  const idat = []
  let palette = null
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced png')
    } else if (type === 'PLTE') palette = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error('png bit depth ' + bitDepth)
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 1
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (colorType === 6) out.set(cur.subarray(x * 4, x * 4 + 4), o)
      else if (colorType === 2) { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255 }
      else if (colorType === 3) { const i = cur[x] * 3; out[o] = palette[i]; out[o + 1] = palette[i + 1]; out[o + 2] = palette[i + 2]; out[o + 3] = 255 }
      else { const g = cur[x * bpp]; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255 }
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}

export function sample(tex, u, v) {
  const x = Math.min(tex.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.width)))
  const y = Math.min(tex.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.height)))
  const o = (y * tex.width + x) * 4
  return [tex.data[o], tex.data[o + 1], tex.data[o + 2]]
}

// ---------- glTF / glb reading ----------
export function loadGltf(path) {
  let json, bin
  if (path.endsWith('.glb')) {
    const b = readFileSync(path)
    const jl = b.readUInt32LE(12)
    json = JSON.parse(b.subarray(20, 20 + jl).toString())
    const bl = b.readUInt32LE(20 + jl)
    bin = b.subarray(28 + jl, 28 + jl + bl)
  } else {
    json = JSON.parse(readFileSync(path, 'utf8'))
    bin = readFileSync(join(dirname(path), json.buffers[0].uri))
  }
  return { json, bin, dir: dirname(path), path }
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] }
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
export function readAccessor(g, idx) {
  const a = g.json.accessors[idx]
  const bv = g.json.bufferViews[a.bufferView]
  const [T, size] = COMP[a.componentType]
  const n = NCOMP[a.type]
  const stride = bv.byteStride || size * n
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0)
  const out = new Float64Array(a.count * n)
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength)
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const o = base + i * stride + k * size
      let v
      switch (a.componentType) {
        case 5126: v = dv.getFloat32(o, true); break
        case 5125: v = dv.getUint32(o, true); break
        case 5123: v = dv.getUint16(o, true); if (a.normalized) v /= 65535; break
        case 5122: v = dv.getInt16(o, true); if (a.normalized) v = Math.max(v / 32767, -1); break
        case 5121: v = dv.getUint8(o); if (a.normalized) v /= 255; break
        case 5120: v = dv.getInt8(o); if (a.normalized) v = Math.max(v / 127, -1); break
      }
      out[i * n + k] = v
    }
  }
  void T
  return out
}

const texCache = new Map()
export function textureOf(g, matIdx) {
  const m = g.json.materials?.[matIdx]
  const pbr = m?.pbrMetallicRoughness ?? {}
  const factor = pbr.baseColorFactor ?? [1, 1, 1, 1]
  const ti = pbr.baseColorTexture?.index
  if (ti === undefined) return { tex: null, factor }
  const img = g.json.images[g.json.textures[ti].source]
  if (img.uri === undefined) {
    // image embedded in the glb's binary chunk
    const key = g.path + '#' + g.json.textures[ti].source
    if (!texCache.has(key)) {
      if (img.mimeType && img.mimeType !== 'image/png') throw new Error('unsupported image ' + img.mimeType + ' in ' + g.path)
      const bv = g.json.bufferViews[img.bufferView]
      texCache.set(key, decodePng(Buffer.from(g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength))))
    }
    return { tex: texCache.get(key), factor }
  }
  const p = join(g.dir, img.uri)
  if (!texCache.has(p)) texCache.set(p, decodePng(readFileSync(p)))
  return { tex: texCache.get(p), factor }
}

// 4x4 column-major helpers
export const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export function mul(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
export function trs(n) {
  if (n.matrix) return n.matrix
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
export const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/**
 * Flattened mesh of a whole glTF scene: positions, normals, colours (sRGB 0..255), indices.
 *
 * Default (no options): the colour is the texture texel (sRGB) times the material's
 * baseColorFactor taken as-is, white without a texture; normals (0, 1, 0) when missing.
 * With `opts.linear`: colours are combined in linear space as glTF specifies (texel and
 * COLOR_0 to linear, times baseColorFactor, back to sRGB), missing normals become face
 * normals, mirrored nodes keep their winding, primitives with alphaMode BLEND are dropped
 * (glass) when `opts.skipBlend`, and each vertex records its material name in `mat`.
 */
export function flatten(g, opts = {}) {
  const pos = [], nor = [], col = [], idx = [], mat = []
  const lin = !!opts.linear
  const visit = (ni, parent) => {
    const n = g.json.nodes[ni]
    const m = mul(parent, trs(n))
    if (n.mesh !== undefined) {
      const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
      for (const prim of g.json.meshes[n.mesh].primitives) {
        if (lin && prim.mode !== undefined && prim.mode !== 4) throw new Error('non-triangle primitive in ' + g.path)
        const material = g.json.materials?.[prim.material]
        if (lin && opts.skipBlend && material?.alphaMode === 'BLEND') continue
        const P = readAccessor(g, prim.attributes.POSITION)
        const N = prim.attributes.NORMAL !== undefined ? readAccessor(g, prim.attributes.NORMAL) : null
        const UV = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, prim.attributes.TEXCOORD_0) : null
        const VC = lin && prim.attributes.COLOR_0 !== undefined ? readAccessor(g, prim.attributes.COLOR_0) : null
        const vcn = VC ? NCOMP[g.json.accessors[prim.attributes.COLOR_0].type] : 0
        const { tex, factor } = textureOf(g, prim.material)
        const I = prim.indices !== undefined ? readAccessor(g, prim.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i)
        const base = pos.length / 3
        for (let i = 0; i < P.length / 3; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
          pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
          if (N) {
            const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]
            // rotation-only nodes in these packs: the upper 3x3 (normalised) is enough
            let nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c
            const l = Math.hypot(nx, ny, nz) || 1
            nor.push(nx / l, ny / l, nz / l)
          } else nor.push(0, 1, 0)
          if (lin) {
            let rgb = tex && UV ? sample(tex, UV[i * 2], UV[i * 2 + 1]).map((v) => srgbToLinear(v / 255)) : [1, 1, 1]
            rgb = rgb.map((v, k) => v * factor[k] * (VC ? VC[i * vcn + k] : 1))
            col.push(...rgb.map((v) => Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, v))))))
            mat.push(material?.name ?? '')
          } else {
            let rgb = tex && UV ? sample(tex, UV[i * 2], UV[i * 2 + 1]) : [255, 255, 255]
            rgb = rgb.map((v, k) => Math.round(v * factor[k]))
            col.push(rgb[0], rgb[1], rgb[2])
          }
        }
        if (lin && det < 0) for (let i = 0; i < I.length; i += 3) idx.push(I[i] + base, I[i + 2] + base, I[i + 1] + base)
        else for (let i = 0; i < I.length; i++) idx.push(I[i] + base)
        if (lin && !N) {
          // face normals (a vertex shared by faces keeps the last one: these packs are flat shaded)
          for (let i = idx.length - I.length; i < idx.length; i += 3) {
            const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
            const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
            const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
            const l = Math.hypot(nx, ny, nz) || 1
            for (const v of [a, b, c]) { nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l }
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m)
  }
  for (const r of g.json.scenes[g.json.scene ?? 0].nodes) visit(r, ident())
  return lin ? { pos, nor, col, idx, mat } : { pos, nor, col, idx }
}

/** Centre on x/z, put the base at y = 0 (unless keepY), and report the bounds. */
export function normalise(mesh, keepY) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < mesh.pos.length; i += 3) {
    minX = Math.min(minX, mesh.pos[i]); maxX = Math.max(maxX, mesh.pos[i])
    minY = Math.min(minY, mesh.pos[i + 1]); maxY = Math.max(maxY, mesh.pos[i + 1])
    minZ = Math.min(minZ, mesh.pos[i + 2]); maxZ = Math.max(maxZ, mesh.pos[i + 2])
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, cy = keepY ? 0 : minY
  for (let i = 0; i < mesh.pos.length; i += 3) {
    mesh.pos[i] -= cx
    mesh.pos[i + 1] -= cy
    mesh.pos[i + 2] -= cz
  }
  return { size: [maxX - minX, maxY - minY, maxZ - minZ] }
}

// ---------- glb writing ----------
/**
 * Writes models ({ name, pos, nor, col, mask, size }) as one glb; returns its byte size.
 * `opts.generator` names the tool in the asset block (default buildModels.mjs).
 */
export function writeGlb(path, models, opts = {}) {
  const views = []
  const accessors = []
  const meshes = []
  const nodes = []
  const chunks = []
  let offset = 0
  const push = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
    const pad = (4 - (bytes.length % 4)) % 4
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
    chunks.push(bytes, Buffer.alloc(pad))
    offset += bytes.length + pad
    return views.length - 1
  }
  for (const m of models) {
    const n = m.pos.length / 3
    const P = Float32Array.from(m.pos)
    const N = new Int8Array(n * 4)
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) N[i * 4 + k] = Math.round(m.nor[i * 3 + k] * 127)
    const C = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) {
      C[i * 4] = m.col[i * 3]; C[i * 4 + 1] = m.col[i * 3 + 1]; C[i * 4 + 2] = m.col[i * 3 + 2]
      C[i * 4 + 3] = m.mask ? m.mask[i] : 0
    }
    const I = n > 65535 ? Uint32Array.from(m.idx) : Uint16Array.from(m.idx)
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i * 3 + k]); max[k] = Math.max(max[k], P[i * 3 + k]) }
    const a0 = accessors.length
    accessors.push({ bufferView: push(P, 34962), componentType: 5126, count: n, type: 'VEC3', min, max })
    const nv = push(N, 34962)
    views[nv].byteStride = 4
    accessors.push({ bufferView: nv, componentType: 5120, normalized: true, count: n, type: 'VEC3' })
    accessors.push({ bufferView: push(C, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' })
    accessors.push({ bufferView: push(I, 34963), componentType: I instanceof Uint32Array ? 5125 : 5123, count: I.length, type: 'SCALAR' })
    meshes.push({ name: m.name, primitives: [{ attributes: { POSITION: a0, NORMAL: a0 + 1, COLOR_0: a0 + 2 }, indices: a0 + 3, material: 0 }] })
    nodes.push({ name: m.name, mesh: meshes.length - 1, extras: { size: m.size } })
  }
  const json = {
    asset: { version: '2.0', generator: `worldseed ${opts.generator ?? 'buildModels.mjs'}` },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [{ name: 'vertex', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.9 } }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  }
  let jsonBuf = Buffer.from(JSON.stringify(json))
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
  const bin = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8)
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  writeFileSync(path, Buffer.concat([header, jh, jsonBuf, bh, bin]))
  return 12 + 8 + jsonBuf.length + 8 + bin.length
}
