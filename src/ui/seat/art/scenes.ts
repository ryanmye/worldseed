// seat: the header illustration of a decision card, one scene per category of DecisionKind, drawn procedurally (original art:
// hills from a seeded random walk, simple shapes for the motif; no copied images, heraldry or emblems). Colours come from CSS
// custom properties (seat.css: --seat-art-*), so the scene follows the theme; the seed (the decision row) varies the land
// and the sky between cards of one kind. Decorative: aria-hidden.
import { DecisionKind as D } from '../../../contract.ts'

/** Categories of scene. */
export const Scene = { War: 0, Court: 1, Bond: 2, Plague: 3, Faith: 4, Unrest: 5, Treasury: 6, Frontier: 7, Land: 8, Learning: 9 } as const

/** The scene of each DecisionKind (0-17). */
export const SCENE_OF: Record<number, number> = {
  [D.WarOnUs]: Scene.War, [D.Opening]: Scene.War, [D.Betrayal]: Scene.War,
  [D.Heir]: Scene.Court, [D.Crisis]: Scene.Court, [D.General]: Scene.Court,
  [D.AllianceMade]: Scene.Bond, [D.AllianceSought]: Scene.Bond, [D.Overlord]: Scene.Bond, [D.Match]: Scene.Bond,
  [D.Plague]: Scene.Plague, [D.Faith]: Scene.Faith, [D.Revolt]: Scene.Unrest, [D.Charter]: Scene.Unrest,
  [D.Credit]: Scene.Treasury, [D.Frontier]: Scene.Frontier, [D.Crop]: Scene.Land, [D.Idea]: Scene.Learning,
}

/** A small deterministic generator (mulberry32) for the scene's variation. */
function rand(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 160, H = 96
const f1 = (x: number) => Math.round(x * 10) / 10

/** A ridge from x 0 to W around height y with roughness `amp` (a closed path down to the bottom). */
function ridge(r: () => number, y: number, amp: number, steps: number): string {
  let d = `M0 ${H} L0 ${f1(y)}`
  let h = y
  for (let i = 1; i <= steps; i++) {
    h += (r() - 0.5) * amp
    h = Math.max(y - amp, Math.min(y + amp, h))
    d += ` L${f1((W * i) / steps)} ${f1(h)}`
  }
  return d + ` L${W} ${H}Z`
}

/** The motif of each scene, drawn over the land (ink and accent colours). */
function motif(scene: number, r: () => number): string {
  const ink = 'fill="var(--seat-art-ink)"', acc = 'fill="var(--seat-art-accent)"'
  const line = 'fill="none" stroke="var(--seat-art-ink)" stroke-width="2" stroke-linecap="round"'
  switch (scene) {
    case Scene.War: {
      // banners on poles over the far ridge, and crossed spears
      let s = ''
      for (let i = 0; i < 3; i++) {
        const x = 28 + i * 44 + r() * 14, y = 40 + r() * 10
        s += `<path d="M${f1(x)} ${f1(y + 22)}V${f1(y)}" ${line}/><path d="M${f1(x)} ${f1(y)}h${f1(14 + r() * 6)}l-4 5 4 5H${f1(x)}z" ${i === 1 ? acc : ink}/>`
      }
      return s + `<path d="M62 86L98 52M98 86L62 52" ${line}/>`
    }
    case Scene.Court: {
      // a throne between columns, a crown above
      return `<path d="M44 84V40M116 84V40M40 40h80" ${line}/><path d="M70 84V58h20v26M66 62h28" ${line}/><path d="M68 34l4-10 8 7 8-7 4 10z" ${acc}/>`
    }
    case Scene.Bond: {
      // two banners leaning together over a seal
      return `<path d="M50 86V36M110 86V36" ${line}/><path d="M50 36h22l-6 8 6 8H50z" ${ink}/><path d="M110 36H88l6 8-6 8h22z" ${ink}/><circle cx="80" cy="66" r="9" ${acc}/><path d="M74 66h12" stroke="var(--seat-art-sky)" stroke-width="2"/>`
    }
    case Scene.Plague: {
      // roofs under a drifting miasma
      let s = ''
      for (let i = 0; i < 5; i++) { const x = 16 + i * 28 + r() * 6, h = 14 + r() * 10; s += `<path d="M${f1(x)} 86V${f1(86 - h)}l10-8 10 8V86z" ${ink}/>` }
      for (let i = 0; i < 3; i++) { const y = 26 + i * 10 + r() * 4; s += `<path d="M${f1(10 + r() * 20)} ${f1(y)}c20-8 30 8 50 0s30 8 50 0 20 6 40 0" fill="none" stroke="var(--seat-art-accent)" stroke-width="2" opacity="0.7"/>` }
      return s
    }
    case Scene.Faith: {
      // a domed shrine and rays
      let s = ''
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.1 + (0.8 * i) / 8); s += `<path d="M80 48L${f1(80 - Math.cos(a) * 70)} ${f1(48 - Math.sin(a) * 44)}" stroke="var(--seat-art-accent)" stroke-width="1.5" opacity="0.6"/>` }
      return s + `<path d="M62 86V62h36v24zM62 62a18 18 0 0 1 36 0z" ${ink}/><path d="M80 44v-8" ${line}/>`
    }
    case Scene.Unrest: {
      // walls and torches raised against them
      let s = `<path d="M10 86V62h140v24z" ${ink}/>`
      for (let x = 10; x < 150; x += 12) s += `<path d="M${x} 62v-6h6v6z" ${ink}/>`
      for (let i = 0; i < 4; i++) { const x = 30 + i * 32 + r() * 8; s += `<path d="M${f1(x)} 60V44" ${line}/><path d="M${f1(x)} 44c-4-4-1-9 0-12 2 4 5 6 0 12z" ${acc}/>` }
      return s
    }
    case Scene.Treasury: {
      // stacked coins and a pair of scales
      let s = ''
      for (let c = 0; c < 3; c++) { const x = 40 + c * 16, n = 3 + Math.floor(r() * 4); for (let i = 0; i < n; i++) s += `<ellipse cx="${x}" cy="${84 - i * 5}" rx="7" ry="2.5" ${acc} stroke="var(--seat-art-ink)" stroke-width="1"/>` }
      return s + `<path d="M112 86V36M98 86h28M94 44h36M94 44l-7 14h14zM130 44l-7 14h14z" ${line}/>`
    }
    case Scene.Frontier: {
      // a sail on the sea toward far peaks
      return `<path d="M0 74h160v22H0z" fill="var(--seat-art-sea)"/><path d="M70 74h28l-4 6H74z" ${ink}/><path d="M84 72V40l14 28zM84 44l-10 24h10z" ${acc}/><path d="M110 74l12-20 10 14 8-10 20 16z" ${ink} opacity="0.7"/>`
    }
    case Scene.Land: {
      // furrows and sprouts
      let s = ''
      for (let i = 0; i < 4; i++) s += `<path d="M0 ${70 + i * 6}c40 -4 120 -4 160 0" fill="none" stroke="var(--seat-art-ink)" stroke-width="1.5" opacity="0.6"/>`
      for (let i = 0; i < 6; i++) { const x = 18 + i * 25 + r() * 6; s += `<path d="M${f1(x)} 68v-12M${f1(x)} 60c-5 0-7-3-7-6 4 0 7 2 7 6zM${f1(x)} 58c0-4 3-7 7-7 0 4-2 7-7 7z" stroke="var(--seat-art-ink)" stroke-width="1" ${acc}/>` }
      return s
    }
    case Scene.Learning: {
      // an open scroll under a bright star
      return `<path d="M40 70c20-8 40-8 40 0 0-8 20-8 40 0v14c-20-8-40-8-40 0 0-8-20-8-40 0z" ${ink}/><path d="M80 18l3.5 8 8.5 1-6.3 5.8 1.8 8.5L80 37l-7.5 4.3 1.8-8.5-6.3-5.8 8.5-1z" ${acc}/>`
    }
  }
  return ''
}

/** The header illustration of decision kind `kind` (seed: the decision row), as an inline SVG string. */
export function decisionScene(kind: number, seed: number): string {
  const scene = SCENE_OF[kind] ?? Scene.Court
  const r = rand(seed * 2654435761 + scene * 97 + 1)
  const sun = `<circle cx="${f1(20 + r() * 120)}" cy="${f1(14 + r() * 10)}" r="${f1(6 + r() * 4)}" fill="var(--seat-art-accent)" opacity="0.5"/>`
  const far = `<path d="${ridge(r, 56 + r() * 6, 10, 12)}" fill="var(--seat-art-far)"/>`
  const near = `<path d="${ridge(r, 76 + r() * 4, 6, 9)}" fill="var(--seat-art-land)"/>`
  return `<svg class="seat-scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${W}" height="${H}" fill="var(--seat-art-sky)"/>${sun}${far}${near}${motif(scene, r)}</svg>`
}

/** An option card's framed illustration: a small landscape in the option's tint with its glyph drawn large over it (seeded). */
export function optionArt(glyphInner: string, seed: number): string {
  const r = rand(seed * 40503 + 17)
  const far = `<path d="${ridge(r, 60 + r() * 6, 10, 10)}" fill="var(--seat-tint)" opacity="0.28"/>`
  const near = `<path d="${ridge(r, 80, 5, 8)}" fill="var(--seat-tint)" opacity="0.45"/>`
  const g = `<g transform="translate(52 14) scale(2.4)" fill="none" stroke="var(--seat-art-ink-strong)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${glyphInner}</g>`
  return `<svg class="seat-opt-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${W}" height="${H}" fill="var(--seat-art-sky)"/>${far}${near}${g}</svg>`
}
