// Throne slice (lane N3, ui-additions 6): generated heraldry per realm and portrait medallions for rulers and heirs. Original
// procedural SVG from a hash of the world seed and the subject (no images, no fonts): a shield with a division, two
// tinctures and a charge for a realm (a house's arms for the ruler's medallion rim); a head-and-shoulders silhouette for a
// person (skin and hair from the hash, greying with age, a crown for the reigning, a beard for some men). Same subject, same
// art, on every pause and device. DOM-free strings (the dashboard and the reign summary inline them as trusted markup).

function mix(a: number, b: number): number {
  let x = (Math.imul(a ^ 0x5bd1e995, 0x9e3779b1) + Math.imul(b + 0x7f4a7c15, 0x85ebca77)) >>> 0
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16
  return x >>> 0
}
function strHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

// tinctures: metals and colours (the rule of tincture: a metal on a colour, a colour on a metal)
const METALS = ['#f1d36b', '#e8e6df']
const COLOURS = ['#b3262a', '#1f4f9c', '#2b7a3d', '#5b2a7a', '#1d1d1f', '#a8562a', '#1f7d86']

const SHIELD = 'M6 4 H58 V30 C58 48 44 58 32 62 C20 58 6 48 6 30 Z'

function charge(kind: number, fill: string): string {
  switch (kind) {
    case 0: { // a star of five points
      const pts: string[] = []
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 === 0 ? 11 : 4.6; pts.push(`${(32 + r * Math.cos(a)).toFixed(1)},${(30 + r * Math.sin(a)).toFixed(1)}`) }
      return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
    }
    case 1: return `<path d="M38 19 A12 12 0 1 0 38 41 A9.5 9.5 0 1 1 38 19 Z" fill="${fill}"/>` // a crescent
    case 2: return `<path d="M22 42 V24 H25 V20 H28 V24 H30.5 V20 H33.5 V24 H36 V20 H39 V24 H42 V42 Z M29 42 V35 A3 3 0 0 1 35 35 V42 Z" fill="${fill}" fill-rule="evenodd"/>` // a tower
    case 3: return `<path d="M29 17 H35 V27 H45 V33 H35 V45 H29 V33 H19 V27 H29 Z" fill="${fill}"/>` // a cross
    case 4: return `<path d="M18 41 L32 19 L46 41 L40 41 L32 28 L24 41 Z" fill="${fill}"/>` // a chevronel
    case 5: return `<path d="M17 40 L27 25 L32 32 L38 22 L48 40 Z" fill="${fill}"/>` // mountains
    case 6: return `<path d="M18 26 q3.5 -4 7 0 t7 0 t7 0 t7 0 M18 33 q3.5 -4 7 0 t7 0 t7 0 t7 0 M18 40 q3.5 -4 7 0 t7 0 t7 0 t7 0" stroke="${fill}" stroke-width="2.6" fill="none"/>` // waves
    case 7: return `<path d="M20 38 L22 24 L27 31 L32 21 L37 31 L42 24 L44 38 Z M20 40 H44 V43 H20 Z" fill="${fill}"/>` // a crown
    case 8: return `<circle cx="32" cy="30" r="9" fill="${fill}"/><circle cx="32" cy="30" r="4" fill="none" stroke="${fill === METALS[0] ? '#00000033' : '#ffffff44'}" stroke-width="1.4"/>` // a roundel
    default: return `<path d="M32 17 L41 30 L32 43 L23 30 Z" fill="${fill}"/>` // a lozenge
  }
}

function division(kind: number, a: string, b: string): string {
  switch (kind) {
    case 0: return `<rect x="0" y="0" width="64" height="64" fill="${a}"/>` // plain
    case 1: return `<rect x="0" y="0" width="32" height="64" fill="${a}"/><rect x="32" y="0" width="32" height="64" fill="${b}"/>` // per pale
    case 2: return `<rect x="0" y="0" width="64" height="30" fill="${a}"/><rect x="0" y="30" width="64" height="34" fill="${b}"/>` // per fess
    case 3: return `<rect x="0" y="0" width="64" height="64" fill="${a}"/><path d="M0 0 L64 64 L64 0 Z" fill="${b}"/>` // per bend
    case 4: return `<rect x="0" y="0" width="64" height="64" fill="${a}"/><rect x="32" y="0" width="32" height="30" fill="${b}"/><rect x="0" y="30" width="32" height="34" fill="${b}"/>` // quarterly
    case 5: return `<rect x="0" y="0" width="64" height="64" fill="${a}"/><path d="M0 64 L32 30 L64 64 Z" fill="${b}"/>` // per chevron
    default: return `<rect x="0" y="0" width="64" height="64" fill="${a}"/><rect x="0" y="0" width="64" height="14" fill="${b}"/>` // a chief
  }
}

/** A realm's arms (SVG markup, `size` px): from the world seed and the realm's id and name. */
export function realmArms(seed: number, polity: number, name: string, size = 48): string {
  const x = mix(mix(seed, polity), strHash(name))
  const metalField = (x & 1) === 1
  const metal = METALS[(x >>> 1) % METALS.length], colour = COLOURS[(x >>> 3) % COLOURS.length]
  const colour2 = COLOURS[(x >>> 7) % COLOURS.length]
  const field = metalField ? metal : colour
  const second = metalField ? colour2 : (colour2 === colour ? COLOURS[(COLOURS.indexOf(colour) + 3) % COLOURS.length] : colour2)
  const div = (x >>> 11) % 7
  const ch = (x >>> 15) % 10
  // the charge: a colour on a metal field, a metal on a colour (on a divided field, the metal that is not the field's)
  const fill = metalField ? (div === 0 ? colour : METALS[(METALS.indexOf(metal) + 1) % 2]) : metal
  const id = `a${x.toString(36)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 66" width="${size}" height="${size}" role="img" aria-hidden="true"><defs><clipPath id="${id}"><path d="${SHIELD}"/></clipPath></defs><g clip-path="url(#${id})">${division(div, field, second)}${charge(ch, fill)}</g><path d="${SHIELD}" fill="none" stroke="#2a2216" stroke-width="2.4"/><path d="${SHIELD}" fill="none" stroke="#e9d9a8" stroke-width="0.8" opacity="0.6"/></svg>`
}

const SKIN = ['#f3d2b5', '#e5b48f', '#c98e64', '#a8704a', '#7d4f33', '#5a3825']
const HAIR = ['#2a1d15', '#4a2f1c', '#7a4b26', '#a8743a', '#d0b073', '#1a1a1a', '#6b2c1a']

/**
 * A person's medallion (SVG markup): `key` a stable id (a ruler's id, or an heir's house x 4096 + birth year), `female`,
 * `age` (grey past 50), `crowned` (a crown), `rim` the realm's colour.
 */
export function portrait(seed: number, key: number, female: boolean, age: number, crowned: boolean, rim: string, size = 40): string {
  const x = mix(seed ^ 0x2545f491, key)
  const skin = SKIN[x % SKIN.length]
  let hair = HAIR[(x >>> 4) % HAIR.length]
  if (age >= 62) hair = '#d8d6d0'; else if (age >= 50) hair = '#8d8a84'
  const young = age < 14
  const headR = young ? 9 : 10
  const beard = !female && !young && ((x >>> 9) & 3) !== 0
  const longHair = female ? 1 : ((x >>> 12) & 3) === 0 ? 1 : 0
  const robe = COLOURS[(x >>> 14) % COLOURS.length]
  const cy = young ? 28 : 26
  const parts: string[] = []
  parts.push(`<circle cx="32" cy="32" r="30" fill="#1b1712"/>`)
  parts.push(`<path d="M10 62 C12 46 22 42 32 42 C42 42 52 46 54 62 Z" fill="${robe}"/>`) // shoulders
  if (longHair) parts.push(`<path d="M${32 - headR - 2} ${cy} C${32 - headR - 3} ${cy + 18} ${32 + headR + 3} ${cy + 18} ${32 + headR + 2} ${cy} Z" fill="${hair}"/>`)
  parts.push(`<rect x="29" y="${cy + headR - 2}" width="6" height="7" fill="${skin}"/>`) // neck
  parts.push(`<circle cx="32" cy="${cy}" r="${headR}" fill="${skin}"/>`)
  parts.push(`<path d="M${32 - headR} ${cy - 1} C${32 - headR} ${cy - headR - 4} ${32 + headR} ${cy - headR - 4} ${32 + headR} ${cy - 1} C${32 + headR - 4} ${cy - headR + 2} ${32 - headR + 4} ${cy - headR + 2} ${32 - headR} ${cy - 1} Z" fill="${hair}"/>`) // hair
  if (beard) parts.push(`<path d="M${32 - headR + 2} ${cy + 2} C${32 - headR + 3} ${cy + headR + 5} ${32 + headR - 3} ${cy + headR + 5} ${32 + headR - 2} ${cy + 2} C${32 + 3} ${cy + 6} ${32 - 3} ${cy + 6} ${32 - headR + 2} ${cy + 2} Z" fill="${hair}"/>`)
  parts.push(`<circle cx="28.5" cy="${cy}" r="1.1" fill="#1b1712"/><circle cx="35.5" cy="${cy}" r="1.1" fill="#1b1712"/>`)
  if (crowned) parts.push(`<path d="M22 ${cy - headR + 1} L23 ${cy - headR - 7} L27.5 ${cy - headR - 2} L32 ${cy - headR - 9} L36.5 ${cy - headR - 2} L41 ${cy - headR - 7} L42 ${cy - headR + 1} Z" fill="${METALS[0]}" stroke="#6b5520" stroke-width="0.8"/>`)
  parts.push(`<circle cx="32" cy="32" r="30" fill="none" stroke="${rim}" stroke-width="3"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-hidden="true"><clipPath id="p${x.toString(36)}"><circle cx="32" cy="32" r="30"/></clipPath><g clip-path="url(#p${x.toString(36)})">${parts.join('')}</g></svg>`
}

/** The realm's main colour (the medallions' rim). */
export function realmColour(seed: number, polity: number, name: string): string {
  const x = mix(mix(seed, polity), strHash(name))
  return COLOURS[(x >>> 3) % COLOURS.length]
}
