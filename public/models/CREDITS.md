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

- KayKit: `building_home_A`, `building_home_B`, `building_church`, `building_market`,
  `building_tavern`, `building_well`, `building_blacksmith`, `building_windmill`,
  `building_watermill`, `building_castle`, `building_tower_A`, `building_barracks`,
  `building_lumbermill` (blue variants, with a team-colour mask derived from the red ones),
  `trees_A_small`.
- Kenney Pirate Kit: `ship-small`, `ship-medium`, `structure-platform-dock`.
- Kenney Fantasy Town Kit: `cart`.

The haystacks, the dam and the soft contact shadows are generated in code (`models.ts`).
