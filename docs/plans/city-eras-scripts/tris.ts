import { styleGeometry, KIND_COUNT, STYLE_COUNT, floraGeometry, FLORA_COUNT, buildWallSegment, buildWallTower, buildSmoke } from '../src/render/dioramas/shapes.ts'
const t = (g: any) => (g.index ? g.index.count : g.getAttribute('position').count) / 3
const rows: string[] = []
for (let s = 0; s < STYLE_COUNT; s++) { const r: number[] = []; for (let k = 0; k < KIND_COUNT; k++) r.push(t(styleGeometry(s as any, k as any))); rows.push(`style ${s}: ${r.join(' ')}`) }
console.log(rows.join('\n'))
const f: number[] = []; for (let k = 0; k < FLORA_COUNT; k++) f.push(t(floraGeometry(k as any)))
console.log('flora', f.join(' '), 'wall', t(buildWallSegment()), 'tower', t(buildWallTower()), 'smoke', t(buildSmoke()))
