# GameMap Requirements

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Track each task's completion below (mark `[x]` when done).
- Before providing final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run logic against them, (3) include runnable unit tests in the output, (4) verify zero placeholder text — production-ready only.
- Backfill all records affected by schema changes using best-judgement defaults.

---

## Context

Currently, `Game.mapId` points directly to the shared `Map` template for the act. All games in the same act share one `Map` record, so item positions, enemy positions, and enemy state have no per-game isolation. This plan introduces `GameMap` — a per-game, per-act copy of the map that becomes the source of truth for chip candidates and AI DM narrative.

---

## Design Decisions

- **One map per act** (`Map.actId @unique` — scenes share a map within an act).
- **`GameMap` is scoped to `Game + Act`** — one record per (gameId, actId) pair, enabling post-act narrative continuity.
- **`GameMap` is created fresh on each act transition** (and on game start for act 1), copying the `Map` template for that act.
- **`Item` stays as a catalog/template** — map-placement fields are removed; per-game placement lives in `GameMap.data`.
- **`Enemy` stays as an encounter definition template** — instance-state fields are removed; per-game state lives in `GameMap.data`.
- **`GameInventory` is deleted** — all picked-up loot is assigned directly to characters.
- **`Game.mapId` (→ `Map`) is removed** — current map is queried via `GameMap` where `gameId = game.id AND actId = game.currentActId`.

---

## `GameMap.data` JSON Structure

```
GameMapData {
  // Copied from Map.data template on creation
  width: number
  height: number
  tiles: TileType[][]
  playerStart: { x: number; y: number }
  rooms: Room[]
  pois: POI[]

  // Per-game item instances (copied from Item rows linked to the act's Map)
  items: Array<{
    itemId: string            // FK to Item template (for stat lookups)
    posX: number
    posY: number
    isPickedUp: boolean       // false on creation
    isVisible: boolean        // false until activeFromSceneOrder is reached
    activeFromSceneOrder: number | null  // null = visible from act start
    droppedByEnemyId: string | null      // populated for enemy loot items
  }>

  // Per-game enemy instances (copied from Enemy rows linked to the act)
  enemies: Array<{
    enemyId: string           // FK to Enemy template (for stat lookups)
    posX: number
    posY: number
    currentHp: number         // copied from Enemy.maxHp on creation
    maxHp: number             // copied from Enemy.maxHp on creation
    status: 'DORMANT' | 'ACTIVE' | 'DEFEATED' | 'FLED'
    isHiding: boolean
    stealthRoll: number
    hasReaction: boolean
    isSurprised: boolean
    lootItemIds: string[]     // Item IDs that appear on this tile on defeat
  }>
}
```

---

## Schema Changes

### New model: `GameMap`
```
model GameMap {
  id        String   @id @default(uuid())
  gameId    String
  game      Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  actId     String
  act       Act      @relation(fields: [actId], references: [id])
  mapId     String   // reference to the Map template used to seed this GameMap
  map       Map      @relation(fields: [mapId], references: [id])
  data      Json     // full GameMapData blob (see above)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([gameId, actId])
  @@index([gameId])
}
```

### Fields removed from `Item`
- `posX`, `posY`
- `mapId`, `map` relation, `@@index([mapId])`
- `activeFromSceneId`, `activeFromScene` relation
- `enemyId`, `enemy` relation

### Fields removed from `Enemy`
- `posX`, `posY`
- `currentHp`
- `status` (EnemyStatus enum)
- `isHiding`, `stealthRoll`
- `hasReaction`, `isSurprised`

### Enum deleted
- `EnemyStatus` (DORMANT, ACTIVE, DEFEATED, FLED) — replaced by the `status` string field inside `GameMap.data.enemies[].status`

### Model deleted
- `GameInventory` — entirely removed; loot goes directly to character equipment/backpack

### `Game` model changes
- Remove: `mapId String`, `map Map @relation(...)`
- Add: `gameMaps GameMap[]`

### `Map` model changes
- Remove: `games Game[]` relation
- Remove: `items Item[]` relation (Item no longer has mapId)
- Add: `gameMaps GameMap[]` relation

### `Act` model changes
- Add: `gameMaps GameMap[]` relation

---

## Task Checklist

### Phase A — Schema
- [x] A1: Add `GameMap` model to `prisma/schema.prisma`
- [x] A2: Remove map-placement fields from `Item`
- [x] A3: Remove instance-state fields from `Enemy`
- [x] A4: Delete `GameInventory` model
- [x] A5: Remove `EnemyStatus` enum
- [x] A6: Update `Game` (remove `mapId`/`map`, add `gameMaps`)
- [x] A7: Update `Map` (remove `games`/`items` relations, add `gameMaps`)
- [x] A8: Update `Act` (add `gameMaps`)
- [x] A9: Migration applied via background task. Prisma client regenerated.

### Phase B — Backfill
- [x] B1: Migration SQL includes inline backfill (Phase 2 of migration.sql) that reads old Item/Enemy columns BEFORE they are dropped, creating GameMap records for all existing active games. Standalone re-run script written at `prisma/backfill-game-maps.mjs` for any post-migration gaps.
- [x] B2: Migration applied (same command as A9) — inline backfill ran as part of migration SQL.
- [x] B3: Spot-checked — 2 games backfilled. Both have all 8 data keys (tiles/items/enemies/rooms/pois/playerStart/width/height), 15 items with correct fields, 18 enemies with correct fields.

### Design Note — Map.data must include spawn positions (required for Phase D)
After migration, `Item.posX/posY/mapId` and `Enemy.posX/posY` no longer exist as DB columns.
The `createGameMap` helper (C10) and the standalone backfill script (B1) both read from `Map.data`
to reconstruct initial positions. Phase D seed updates MUST extend `Map.data` with:
- `enemySpawns: [{ enemyId, posX, posY, lootItemIds }]`
- `itemPlacements: [{ itemId, posX, posY, activeFromSceneOrder, droppedByEnemyId }]`

### Phase C — Code Updates
- [x] C1: `lib/chip-candidates.ts` — pure function, no map/enemy reads. No changes needed.
- [x] C2: `lib/scene-advance.ts` — already reads from `GameMap.data`. No changes needed.
- [x] C3: `app/actions/handle-player-action.ts` — no map include, no enemy writes, no item writes. No changes needed.
- [x] C4: `app/actions/auto-advance.ts` — removed `game.map` include; added `GameMap` load; fixed all `Enemy.currentHp/posX/posY/isHiding` reads (→ `gmData.enemies`); fixed HP writes (→ `tx.gameMap.update`); fixed item pickup (→ `gmData.items[].isPickedUp`); added `gameId`/`currentActId` to `checkSceneTrigger`; fixed act transition (remove `mapId`, add `createGameMap` call).
- [x] C5: `app/actions/take-turn.ts` — same as C4; also fixed AoO enemy pos reads and `encounterCompleted` check.
- [x] C6: `app/game/[id]/page.tsx` — `getMapItems(map.id)` → `getMapItems(id)`; removed `mapId` prop from `PartyTab`; updated `MemberInventoryPane`, `MemberStatsPane`, `TotalACCard` to accept `gameId` instead of `mapId`.
- [x] C7: `components/turn-queue-sheet.tsx` — no map/enemy reads. No changes needed.
- [x] C8: `hooks/useTurnQueue.ts` — no map/enemy reads. No changes needed.
- [x] C9: `GameInventory` — zero references found anywhere. No changes needed.
- [x] C10: `lib/create-game-map.ts` — already implemented before this session.
- [x] Extra: `app/actions/process-npc-turns.ts` — discovered broken `game.map` + `Enemy.currentHp` references; fixed same pattern as C4/C5.
- [x] Extra: `app/actions/start-game.ts` — removed `mapId` from game create; added `createGameMap` call.
- [x] Extra: `app/actions/start-adventure.ts` — `map: true` include → `gameMaps` include.
- [x] Extra: `scripts/seed-scenario.ts` — removed `map: true` include.
- [x] Extra: `prisma/seed-test-items.ts` — replaced broken temp file with no-op comment.

### Phase D — Seed Files
- [x] D1: Update `prisma/seed.mjs` — remove any `GameInventory` seeding; remove `Item` fields that no longer exist (posX, posY, mapId, activeFromSceneId, enemyId); remove `Enemy` fields that no longer exist
- [x] D2: `prisma/seed-items.ts` — removed `Map.items` include and `Item.mapId` write; dedup logic changed to check `Item.count()`.
- [x] D3: `prisma/seed-equippable-items.ts` — same as D2.
- [x] D4: Update `prisma/seed-enemy-weapons.mjs` — remove deleted fields if applicable
- [x] D5: Verify seed runs cleanly end-to-end: `npx prisma db seed`

### Phase E — Verification
- [x] E1: `npm run build` — zero TypeScript errors. All 10 routes compiled successfully.
- [x] E2: Run `npm run lint` — zero new lint errors in changed files (pre-existing no-explicit-any in create-game-map.ts unchanged)
- [x] E3: Write unit tests in `lib/create-game-map.test.ts` covering:
  - Edge case 1: Act has no items and no enemies — `GameMap.data.items` and `.enemies` are empty arrays (not null/undefined)
  - Edge case 2: Enemy with `maxHp = 0` — backfill sets `currentHp = 0`, status = 'DORMANT'; no division-by-zero in HP percentage calculations
  - Edge case 3: Item with `activeFromSceneId` set — `isVisible: false` and `activeFromSceneOrder` is populated from the scene's `order` field
  - Edge case 4: Multiple games in the same act — each gets an independent `GameMap`; mutating one does not affect the other
  - Edge case 5: Game with `currentActId = null` (lobby phase) — `createGameMap` is not called; no `GameMap` record exists yet; chip-candidates returns empty array gracefully
- [x] E4: Run tests: `npm test` — 6/6 passing in create-game-map.test.ts
