# Looting & Item Interactions Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.

## Goal
Implement a streamlined inventory interaction system allowing players to loot dead enemies (including weapons) via instant suggestion chips, interact with standalone floor items, open container types instantly, use item-on-item tools, interact with or break down terrain/objects based on eligible action types, and persist state changes across database tables.

---

## Codebase Baseline (read before implementing)

### What already exists

- **Single floor item pickup is fully implemented.** `GameTile.item?: string` (tile-types.ts) stores an itemId on the tile; `GameMapData.itemState` tracks `{ isPickedUp, isVisible, blocksMovement, ... }` per item; `GameMapData.pois[].itemId?` links a POI to its item at creation time; and the pickup handler in `auto-advance.ts` (lines 1041–1092) marks the item picked up, removes it from the tile, and equips or backpacks it. **Section 2 single-floor-item path requires no new work.**

- **`EnemyInstance.lootItemIds: string[]`** already exists in `GameMapData.enemyState` (tile-types.ts line 66). It is seeded as `[]` at map creation. The looting feature must populate this field when building the map or when an enemy is defeated, rather than designing a new field.

- **`Character.remainingActions`, `remainingBonusActions`, `remainingMovementFeet`, `remainingReactions`** exist. There is no `remainingObjectInteractions` field yet.

- **Enemy schema has `mainHandId` only.** The DB `Enemy` model has a single `mainHand Item?` relation — no off-hand, armor, or backpack fields. The "4 equip slots" claim in the original spec does not match the schema. Enemy weapon loot is limited to `mainHandId`.

- **POI system.** `GameMapData.pois[]` entries have `{ id, name, x, y, symbol, itemId? }`. Interactable terrain objects can extend this shape rather than requiring a separate entity layer.

- **Architecture split.** `Map.data` is the static template (never mutated after creation). `GameMap.data` is the live per-game state. Static properties (AC, maxHp, eligible_interactions, etc.) belong in `Map.data`; mutable state (currentHp, is_open, is_locked, searched_by_characters) belongs in `GameMap.data`.

### What is missing

- Dead-enemy loot chip generation and its action handler
- Container open/closed state and per-slot inventory in `GameMap.data`
- Terrain interaction fields (HP, AC, eligible_interactions, effective_tools, lock/key)
- `remaining_object_interactions` on `Character`
- `interaction_tags` and `key_id` on `Item`
- `investigation_ac` — see schema note below before adding to the `Item` table

---

## 1. Dead Enemy Looting

- **Loot source.** When an enemy is defeated, `EnemyInstance.lootItemIds` is populated with the enemy's `mainHandId` (the only loot-bearing slot in the `Enemy` schema). Do not reference "4 equip slots" — only `mainHandId` exists.
- **Instant Looting chip.** When `EnemyInstance.status === "DEFEATED"` and `lootItemIds.length > 0`, a chip candidate `Loot defeated <enemy_name>` is eligible. Clicking it transfers all IDs from `lootItemIds` into the character's backpack (or equip slot if empty and compatible) and clears `lootItemIds`.
- **No investigation check on corpse looting.** Investigation AC applies to containers only. Dead enemy loot is always freely accessible.
- **Chip placement.** Add loot candidate generation to `buildChipCandidates` in `lib/chip-candidates.ts`. Require the player to be within reach distance (≤ weapon range or ≤ 1 tile melee) and the enemy tile to be visible.
- **Handler.** Add a `lootEnemyId?: string` parameter to `autoAdvance` (parallel to the existing `itemId?`). The pickup block at auto-advance.ts:1041 is the right pattern to follow.

## 2. Floor Items & Containers

- **Single floor items: already implemented** (see Codebase Baseline). No new work.
- **Multi-item rule.** If a coordinate needs to hold multiple items they must be in a container POI. This is a data-authoring constraint, not a runtime enforcement.
- **Containers:**
  - Extend the POI shape in `GameMapData.pois` with optional container fields: `isContainer?: boolean`, `isOpen?: boolean`, `containerInventory?: { itemId: string; investigationAc: number }[]`, `searchedBy?: { characterId: string; roll: number }[]`.
  - Static container definition lives in `Map.data.pois` (isContainer, containerInventory slots). Mutable state (isOpen, searchedBy) lives in `GameMap.data.pois`.
  - On "Open container" chip: run one Investigation check per character per container. The `searchedBy` array records `{ characterId, roll }` so re-opens reuse the prior result.
  - Visible items = slots where `roll + investigationModifier > slot.investigationAc`. Chips for picking up visible items appear when player is adjacent to an open container.
- **`investigation_ac` field placement.** Do **not** add `investigation_ac` to the global `Item` table — the same DB item can appear in containers with different difficulty in different maps. Store it inside `containerInventory[].investigationAc` in the POI JSON instead.
- **Object interaction economy.** Add `remainingObjectInteractions Int @default(1)` to the `Character` table only. Interacting with a container or picking up a floor item (outside combat) costs 1; further interactions cost a main action. **Do not add this field to `Enemy`** — enemies do not consume object interactions.
- **Equip validation.** The existing equip logic in auto-advance.ts:1067 already handles slot-open checks and backpack fallback. Re-use it for container pickups.

## 3. Item-on-Item & Terrain Interactions

- **Interactable terrain.** Model terrain objects as extended POI entries in `Map.data.pois` (static properties) and `GameMap.data.pois` (live state). Do not add a separate top-level array if the POI shape can carry the fields.
  - **`Map.data.pois` static fields:** `eligibleInteractions?: string[]`, `effectiveTools?: string[]`, `armorClass?: number`, `maxHp?: number`, `damageThreshold?: number`, `lockId?: string`
  - **`GameMap.data.pois` live fields:** `currentHp?: number`, `isLocked?: boolean`, `isOpen?: boolean`
- **`floor_item_id` field: remove from spec.** Single floor items are already handled by `GameTile.item` — there is no need for a parallel `floor_item_id` on terrain objects.
- **Item table additions needed:** `interactionTags String[] @default([])`, `keyId String?` — these are per-item constants and belong in the `Item` schema.
- **Eligible interaction types:** `lock_and_key`, `tool_demolition`, `strength_bash` — exactly as specced.
- **Lock/key matching:** `poi.lockId` ↔ `item.keyId`. The check runs in the action handler before any roll.
- **Damage threshold rule:** unchanged from original spec. Damage < threshold → 0 damage; damage ≥ threshold → full damage applies to `currentHp`.
- **Tool chip suppression:** A tool chip for demolishing terrain only generates if `intersection(item.interactionTags, poi.effectiveTools)` is non-empty. Check this in `buildChipCandidates`.

## 4. Context-Aware Suggestion Chips

- **Triggering Rules:** Chips are generated from visible tiles and POIs within movement range. Standard walls (`t === "W"`) never generate interaction chips but must leave room for future support (don't hard-exclude them in the chip type system — just don't generate them today).
- **Looting Chips:** `Loot defeated <enemy_name>` — generated when the tile actor is an enemy whose `enemyState[id].status === "DEFEATED"` and `lootItemIds.length > 0`, and the player is within reach.
- **Container Chips:** `Open <name> (x,y)` — generated for POIs with `isContainer: true` and `isOpen: false` that are adjacent to the player. `Pick up <item> from <name> (x,y)` — generated for each visible item slot in an open container adjacent to the player.
- **Interaction/tool chips:** `<verb> <terrain> with <item>` — generated only when `intersection(item.interactionTags, poi.effectiveTools)` is non-empty. General weapons never generate these.
- **Chip limit.** `buildChipCandidates` already caps at 8 candidates (sliced to 5 in `candidatesToChips`). Loot, container, and terrain chips compete in that budget alongside attack/movement chips.

## 5. Database Schema & Backfill Strategy

Modify underlying data structures across `Item`, `Character`, `Map`, and `GameMap` to correctly record world state.

### Item Table additions
```prisma
interactionTags String[] @default([])
keyId           String?
```
`investigation_ac` is **not** added here — it lives inside container inventory JSON per slot.

### Character Table addition
```prisma
remainingObjectInteractions Int @default(1)
```

### Enemy Table
No changes needed. `mainHandId` is the only loot-bearing field. Loot population happens in `EnemyInstance.lootItemIds` (GameMap JSON), not the Enemy DB row.

### Map.data POI shape (JSON, template)
Extend POI entries with optional static properties:
```
eligibleInteractions?: string[]   // e.g. ["lock_and_key", "tool_demolition"]
effectiveTools?:       string[]   // e.g. ["heavy_demolition", "axes"]
armorClass?:           number     // default 0
maxHp?:                number     // default 1
damageThreshold?:      number     // default 0
lockId?:               string     // null for unlocked
isContainer?:          boolean
containerInventory?:   { itemId: string; investigationAc: number }[]
```

### GameMap.data POI shape (JSON, live state)
Add mutable fields to the matching pois entries (keyed by poi.id):
```
currentHp?:    number
isLocked?:     boolean
isOpen?:       boolean
searchedBy?:   { characterId: string; roll: number }[]
```
These can live directly in `GameMap.data.pois[]` entries alongside `itemId?`.

### Removed from original spec
- `floor_item_id` on terrain — redundant with `GameTile.item`
- `remaining_object_interactions` on `Enemy` — enemies don't use this counter
- `investigation_ac` on `Item` table — moved to per-slot container JSON
- `searched_by_characters` as a top-level Map/GameMap field — moved into `GameMap.data.pois[].searchedBy`
