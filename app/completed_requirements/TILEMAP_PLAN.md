# Tilemap Overhaul Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.
- Backfill all records affected by schema changes.
- Manage your own context

---

## Goal

Replace the current parallel-array map structure (`GameMap.data.enemies[]`, `GameMap.data.items[]`,
`Map.data.enemySpawns[]`, `Map.data.itemPlacements[]`) with a **tile-first model** where every
entity's position is encoded in the tile grid itself — no separate position arrays.

Add a **20×20 viewport** and **line-of-sight** system to the map renderer so large maps (up to 60×60)
can be explored with fog of war.

---

## Design Reference

### `Map.data` (template — seed source of truth)
```
MapTile[][] where each MapTile = {
  t: "W" | "F" | "D" | "?"        // terrain: Wall, Floor, Door, Unexplored
  enemy?: string                   // enemyId that spawns here (template only)
  item?: string                    // itemId placed here at act start (template only)
}
```

### `GameMap.data` (live per-game state)
```
{
  width:  number
  height: number
  tiles:  GameTile[][]             // single source of truth for all positions
  enemyState: Record<enemyId, EnemyInstance>   // bulk state keyed by enemyId
  itemState:  Record<itemId,  ItemInstance>    // bulk state keyed by itemId
}

GameTile = {
  t: "W" | "F" | "D"
  actor?: { kind: "enemy" | "party"; id: string }  // one actor max per tile
  item?: string                                      // itemId (or null)
}

EnemyInstance = {
  currentHp:   number
  maxHp:       number
  status:      "DORMANT" | "ACTIVE" | "DEFEATED" | "FLED"
  isHiding:    boolean
  stealthRoll: number
  hasReaction: boolean
  isSurprised: boolean
  lootItemIds: string[]
}

ItemInstance = {
  isPickedUp:           boolean
  isVisible:            boolean
  activeFromSceneOrder: number | null
  droppedByEnemyId:     string | null
  blocksMovement:       boolean   // copied from Item.blocksMovement at creation
}
```

### Passability rules
| Entity          | Blocks when…                                  |
|-----------------|-----------------------------------------------|
| Wall `"W"`      | always                                        |
| Closed Door `"D"` | always (must be opened first)               |
| Enemy actor     | status is DORMANT or ACTIVE                   |
| Party actor     | always (no pass-through allies)               |
| Item            | `blocksMovement === true` and not picked up   |

---

## Progress Tracker

### Phase A — Schema + Types
- [x] A1: Add `blocksMovement Boolean @default(false)` to `Item` model in `prisma/schema.prisma`
- [x] A2: Run migration (`npx prisma migrate dev --name add_blocks_movement`)
- [x] A3: Regenerate Prisma client (`npx prisma generate`)
- [x] A4: Create `lib/tile-types.ts` — export `TileType`, `MapTile`, `GameTile`, `EnemyInstance`, `ItemInstance`, `GameMapData`

### Phase B — `lib/game-map-utils.ts` (pure helpers, no DB)
- [x] B1: `findActor(tiles, id)` → `{ x, y } | null` — scans tiles for `actor.id === id`
- [x] B2: `findItem(tiles, itemId)` → `{ x, y } | null`
- [x] B3: `isTilePassable(tile, enemyState, itemState, moverId)` → `boolean`
- [x] B4: `moveActor(tiles, fromX, fromY, toX, toY)` → new `GameTile[][]` (immutable — returns copy)
- [x] B5: `placeItem(tiles, itemId, x, y)` and `removeItem(tiles, x, y)` → new `GameTile[][]`
- [x] B6: `getVisibleTiles(tiles, originX, originY, radius)` → `Set<string>` of `"x,y"` keys — raycasting LoS; walls and closed doors are opaque
- [x] B7: Write `lib/game-map-utils.test.ts` covering:
  - `findActor`: returns null when not present; returns correct coords when present
  - `findItem`: same
  - `isTilePassable`: wall → false; active enemy → false; defeated enemy → true; blocking item not picked up → false; blocking item picked up → true; passable item → true; party actor → false; mover's own tile → true
  - `moveActor`: actor removed from origin, placed at dest; origin tile is clean; dest tile has actor; throws (or returns unchanged) if dest already occupied by different actor
  - `getVisibleTiles`: tiles directly adjacent are visible; tiles behind a wall are not; tiles behind a closed door are not; tiles behind an open floor are visible up to radius

### Phase C — `createGameMap()` rewrite
- [x] C1: Rewrite `lib/create-game-map.ts` to:
  1. Read `Map.data.tiles` as `MapTile[][]`
  2. Scan every tile for `enemy` / `item` fields
  3. Build `enemyState` registry from found enemy IDs (fetch `maxHp` from DB)
  4. Build `itemState` registry from found item IDs (fetch `blocksMovement` from DB)
  5. Build `GameTile[][]` — clone terrain, place `actor` + `item` refs from spawn tiles
  6. Write `GameMap.data` as `{ width, height, tiles, enemyState, itemState }`
  7. Remove all reads of `tmpl.enemySpawns` and `tmpl.itemPlacements`
- [x] C2: Update `lib/create-game-map.test.ts`:
  - Empty map (no enemies, no items) → tiles are all terrain, registries are empty objects `{}`
  - Enemy tile → `GameTile.actor` set; `enemyState[enemyId]` has correct hp/status
  - Item tile → `GameTile.item` set; `itemState[itemId]` has correct `blocksMovement`
  - Tile with both enemy and item → both fields set independently
  - Two games from same template → independent `GameMap` records; mutating one tile doesn't affect the other
  - Enemy maxHp = 0 edge case → `currentHp: 0`, status DORMANT, no crash

### Phase D — Seed + Backfill
- [x] D1: Update `prisma/seed.mjs` — rewrite all three map tile arrays from plain strings to `MapTile` objects
  - Add `enemy` field to tiles where enemies should spawn (use stable enemy IDs from the same seed run)
  - Add `item` field to tiles where items start (non-equipped items only)
  - Remove `enemySpawns` and `itemPlacements` top-level keys if they exist
- [x] D2: Update `prisma/seed-items.ts` — add `blocksMovement` to `ItemBlueprint` type; set `true` for crates/barrels/boulders, `false` for everything else
- [x] D3: Update `prisma/seed-equippable-items.ts` — add `blocksMovement: false` to all equippable items (weapons, armor, rings are never blocking)
- [x] D4: Write `prisma/backfill-tilemap.mjs` — for all existing `GameMap` records, convert old `{ enemies[], items[] }` format to new `{ tiles (with actor/item slots), enemyState, itemState }` format using best-judgement positions (place enemies at `playerStart` offset if old posX/posY were 0,0 defaults)
- [x] D5: Run `npx prisma db seed` — verify clean run, no errors
- [x] D6: Run `node prisma/backfill-tilemap.mjs` — 2 GameMaps converted

### Phase E — Action handler migration
- [x] E1: `app/actions/get-map-items.ts` — rewritten to scan tiles + itemState
- [x] E2: `app/actions/auto-advance.ts` — enemyState + findActor for HP/positions; item pickup uses itemState; hiding uses enemyState; tile cleared on enemy defeat; mapUpdate handler already correct
- [x] E3: `app/actions/take-turn.ts` — tiles extracted to string[][] for lineOfSight/isCovered; item prompt uses tile scan; enemy HP/pos reads updated
- [x] E4: `app/actions/process-npc-turns.ts` — enemyState + tile scan for positions; HP write uses enemyState
- [x] E5: `app/actions/initialize-game.ts` / `start-game.ts` / `start-adventure.ts` — verified no stale reads (no GameMap.data access in these files)
- [x] E6 (partial): `lib/scene-advance.ts` — ENEMY_DEFEATED and ITEM_FOUND fixed to read enemyState/itemState registries

### Phase F — Map renderer (viewport + LoS)
- [x] F1: MapRenderer updated — tiles now GameTile[][]; terrain rendering fixed to tile.t; itemMarkers kept (from getMapItems); enemyMarkers kept (from localState.enemies for live positions); tile-scan fallback for items if no itemMarkers
- [x] F2: Viewport radius VP=10 (21×21 max) — renders only playerPos±10 clamped to map bounds
- [x] F3: visibleTiles via getVisibleTiles(tiles, playerX, playerY, 10) — hidden tiles render as dark ░
- [x] F4: Tile render priority: party > solo player > enemy > item > POI > terrain
- [x] F5: Hidden tiles outside LoS render as dark ░
- [x] F6: `app/game/[id]/page.tsx` — MapData.tiles type needs updating to GameTile[][]; no other page changes needed (map.data is already GameMapData at runtime)

### Phase G — Final verification
- [x] G1: `npm run build` — zero TypeScript errors
- [x] G2: `npm run lint` — zero new errors (pre-existing issues only, none introduced by this phase)
- [x] G3: `npm test` — 311/311 tests pass
- [ ] G4: Manual smoke test — start a game, verify map renders with viewport, enemies/items visible, move player, verify LoS updates

---

## Edge Cases to verify before marking G4 complete
1. Player at map edge — viewport clamps correctly, no array out-of-bounds
2. Enemy defeated mid-combat — tile `actor` cleared, corpse tile becomes passable, `enemyState.status = "DEFEATED"`
3. Item picked up — `itemState.isPickedUp = true`, tile `item` field cleared
4. Act transition — new `GameMap` created fresh; old act's `GameMap` left intact for continuity reads
5. Enemy with `lootItemIds` defeated — loot items placed on that tile (tile gets `item` field set, `itemState` entry added)
6. LoS radius on a 60×60 map with radius 10 — no performance regression; `getVisibleTiles` stays < 1ms on worst case

---

## Files changed (expected)
- `prisma/schema.prisma` — Item.blocksMovement
- `prisma/migrations/…_add_blocks_movement/`
- `lib/tile-types.ts` — new
- `lib/game-map-utils.ts` — new
- `lib/game-map-utils.test.ts` — new
- `lib/create-game-map.ts` — rewrite
- `lib/create-game-map.test.ts` — update
- `prisma/seed.mjs` — tile format change
- `prisma/seed-items.ts` — blocksMovement field
- `prisma/seed-equippable-items.ts` — blocksMovement field
- `prisma/backfill-tilemap.mjs` — new
- `app/actions/get-map-items.ts` — tile scan
- `app/actions/auto-advance.ts` — tile scan for positions
- `app/actions/take-turn.ts` — tile scan for positions
- `app/actions/process-npc-turns.ts` — tile scan for positions
- `app/actions/initialize-game.ts` / `start-game.ts` / `start-adventure.ts` — verify/clean
- `components/map-renderer.tsx` — viewport + LoS
- `app/game/[id]/page.tsx` — pass gmData instead of marker arrays
