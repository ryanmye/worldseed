# 3D model credits

All models used by the diorama layer (`src/render/dioramas/`) are CC0 (public domain).
Only a small subset of each pack is shipped, repacked by
`src/render/dioramas/tools/buildModels.mjs` into one `.glb` per pack (meshes flattened,
texture colours baked into vertex colours, no textures).

| File | Pack | Author | Source | License |
| --- | --- | --- | --- | --- |
| `kaykit/kaykit-medieval.glb` | KayKit Medieval Hexagon Pack 1.0 | Kay Lousberg (www.kaylousberg.com) | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | CC0 1.0 (`kaykit/LICENSE.txt`) |
| `kenney/kenney-ships.glb` (ships, dock) | Pirate Kit 2.1 | Kenney (www.kenney.nl) | https://kenney.nl/assets/pirate-kit | CC0 1.0 (`kenney/License-pirate-kit.txt`) |
| `kenney/kenney-ships.glb` (cart) | Fantasy Town Kit 2.0 | Kenney (www.kenney.nl) | https://kenney.nl/assets/fantasy-town-kit | CC0 1.0 (`kenney/License-fantasy-town-kit.txt`) |

Models used:

- KayKit: `building_church`, `building_market`, `building_tavern`, `building_well`,
  `building_blacksmith`, `building_windmill`, `building_watermill`, `building_castle`,
  `building_tower_A`, `building_barracks`, `building_lumbermill` (blue variants, with a
  team-colour mask derived from the red ones), as landmarks of temperate and mountain
  settlements only. `building_home_A`, `building_home_B` and `trees_A_small` are still in
  the file but no longer drawn.
- Kenney Pirate Kit: `ship-small`, `ship-medium`, `structure-platform-dock`.
- Kenney Fantasy Town Kit: `cart`.

Generated in code (`shapes.ts`, no external assets): the bulk houses of every building
style (temperate, cold, mountain, desert, savanna, rainforest), the landmarks of the
non-temperate styles (domed hall, minaret, kasbah, round halls, stockades, stepped
temples, longhouses, stave towers), town walls and towers, market stalls, a small well,
town bridges, groves (broadleaf, conifer, palm, jungle, acacia, cactus, rocks), haystacks,
the dam and the soft contact shadows.

The settlement plans (`town.ts`) follow the ideas of ward-based medieval town generators,
notably Oleg Dolya's (watabou) Medieval Fantasy City Generator / TownGeneratorOS
(https://github.com/watabou/TownGeneratorOS): Voronoi patches on a spiral, inner-patch
relaxation, wards by location rating, recursive lot bisection. The code is an independent
implementation, not a port.
