# Item Interactions — Implementation Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.

---

## Design Decisions

### Action type routing
New `ActionType` values are added to `types/suggestion-chip.ts`:
`"loot"` | `"container_open"` | `"container_pickup"` | `"key_use"` | `"terrain_demolish"` | `"terrain_bash"`

`take-turn.ts` detects these before calling Claude. Instant actions (`loot`, `key_use`, `container_pickup`) create an `ActiveTurnQueue` with an empty rolls array and status `COMPLETED` immediately — the client calls `autoAdvance` without a dice UI. Roll-requiring actions (`container_open`, `terrain_bash`, `terrain_demolish`) queue rolls mechanically and skip the Claude roll-detection call.

### New chip fields (SuggestionChip)
```
lootEnemyId?:    string   // dead enemy to loot
poiId?:          string   // POI being interacted with (container, terrain, lock)
containerItemId?: string  // specific item slot inside an open container
toolItemId?:     string   // Item.id of the tool being used for demolition
```
`autoAdvance` signature gains matching optional parameters:
`autoAdvance(gameId, turnId, chipLabel, endPosition?, itemId?, lootEnemyId?, poiId?, containerItemId?, toolItemId?)`

### Container inventory storage
`containerInventory` slots carry a denormalized `itemName` set at `createGameMap` time to avoid runtime DB lookups during chip generation:
```json
{ "itemId": "uuid", "itemName": "Knight's Sword", "investigationAc": 0 }
```
Live state (`isOpen`, `searchedBy`, `containerInventory`) lives in `GameMap.data.pois` entries alongside the existing `itemId?` field.

### Investigation roll
Container open queues one `ABILITY_CHECK` roll (label: "Investigation") with `dc: null`. The roll is not pass/fail — `autoAdvance` reads `totalResult` and computes `investigationModifier` from the character's Intelligence + proficiency, then exposes slots where `totalResult + modifier > slot.investigationAc`. The result is stored in `pois[i].searchedBy` so subsequent opens reuse it.

### Terrain destruction
Terrain objects are POIs with `eligibleInteractions`, `effectiveTools`, `armorClass`, `maxHp`, `damageThreshold`, `lockId` set in `Map.data.pois` (static) and `currentHp`, `isLocked` initialized in `GameMap.data.pois` at creation time.

When `currentHp` drops to 0:
- POI with a matching tile coordinate that has `t: "D"` → apply `mapUpdate` (D→F) on the tile
- POI without a tile mapping → set a `isDestroyed: true` flag on the pois entry to suppress chip generation

### lootItemIds population
`createGameMap` fetches `Enemy.mainHandId` for all enemies in the act and pre-populates `enemyState[id].lootItemIds = [mainHandId]` (or `[]` if null). This field was previously always seeded as `[]`.

### Object interaction economy
`remainingObjectInteractions` is decremented when a `container_open`, `container_pickup`, or single floor item pickup is executed. The reset location is wherever `remainingActions` is reset; that same block resets `remainingObjectInteractions` to 1.

---

## Phase A — Schema migration

- [ ] **A1** In `prisma/schema.prisma`, add to `model Item`:
  ```
  interactionTags String[] @default([])
  keyId           String?
  ```
- [ ] **A2** In `prisma/schema.prisma`, add to `model Character`:
  ```
  remainingObjectInteractions Int @default(1)
  ```
- [ ] **A3** Run `npx prisma migrate dev --name item_interactions` to apply. Confirm migration file is generated before proceeding.

---

## Phase B — TypeScript type definitions

- [ ] **B1** In `lib/tile-types.ts`, expand the `pois` array element shape inside `GameMapData` to:
  ```
  {
    id: string; name: string; x: number; y: number; symbol: string;
    itemId?: string;
    // Container (static from Map.data + live state in GameMap.data)
    isContainer?: boolean;
    containerInventory?: { itemId: string; itemName: string; investigationAc: number }[];
    isOpen?: boolean;
    searchedBy?: { characterId: string; roll: number }[];
    // Terrain interaction (static from Map.data)
    eligibleInteractions?: string[];
    effectiveTools?: string[];
    armorClass?: number;
    maxHp?: number;
    damageThreshold?: number;
    lockId?: string;
    // Live terrain state (GameMap.data)
    currentHp?: number;
    isLocked?: boolean;
    isDestroyed?: boolean;
  }
  ```

- [ ] **B2** In `types/suggestion-chip.ts`:
  - Add to `ActionType`: `"loot" | "container_open" | "container_pickup" | "key_use" | "terrain_demolish" | "terrain_bash"`
  - Add optional fields to `SuggestionChip`:
    ```
    lootEnemyId?:     string
    poiId?:           string
    containerItemId?: string
    toolItemId?:      string
    ```

- [ ] **B3** In `components/map-renderer.tsx`, update the `pois` element shape in the `MapData` interface to match the B1 shape (add all new optional fields). No render logic changes.

---

## Phase C — Map creation enhancements

All changes in `lib/create-game-map.ts`.

- [ ] **C1** In the existing enemy/item ID collection loop (lines 20–25), also collect enemy IDs that have a non-null `mainHandId`. After the `enemyMaxHp` fetch, run a targeted query:
  ```
  enemyLootRows = await db.enemy.findMany({
    where:  { id: { in: enemyIds } },
    select: { id: true, mainHandId: true },
  })
  ```
  Build `enemyLootMap: Map<string, string>` → enemyId → mainHandId (skip nulls).

- [ ] **C2** When initializing `enemyState[tile.enemy]` (currently around line 57), set:
  ```
  lootItemIds: enemyLootMap.has(tile.enemy) ? [enemyLootMap.get(tile.enemy)!] : [],
  ```
  replacing the current hardcoded `lootItemIds: []`.

- [ ] **C3** If `Map.data.pois` entries reference container items, fetch their names. After the `itemBlocks` query (line 43), collect all `itemId` values from `tmpl.pois` container inventories:
  ```
  const containerItemIds = (tmpl.pois ?? [])
    .flatMap((p: any) => (p.containerInventory ?? []).map((s: any) => s.itemId as string))
    .filter(Boolean);
  ```
  If any exist, query `db.item.findMany({ where: { id: { in: containerItemIds } }, select: { id: true, name: true } })` and build `containerItemNameMap`.

- [ ] **C4** Replace the current pois line (currently `(tmpl.pois ?? []).map(...)`) with enriched initialization:
  ```
  pois: (tmpl.pois ?? []).map((p: any) => ({
    ...p,
    itemId: itemPosMap.get(`${p.x},${p.y}`),
    // Container live state
    ...(p.isContainer ? {
      isOpen: false,
      searchedBy: [],
      containerInventory: (p.containerInventory ?? []).map((slot: any) => ({
        ...slot,
        itemName: containerItemNameMap?.get(slot.itemId) ?? slot.itemId,
      })),
    } : {}),
    // Terrain live state
    ...(p.maxHp !== undefined ? {
      currentHp: p.maxHp,
      isLocked: !!p.lockId,
      isDestroyed: false,
    } : {}),
  }))
  ```

---

## Phase D — Chip candidate expansion

All changes in `lib/chip-candidates.ts`.

- [ ] **D1** Extend the `Poi` interface (currently `{ name, x, y, itemId? }`) to include:
  ```
  isContainer?:        boolean;
  containerInventory?: { itemId: string; itemName: string; investigationAc: number }[];
  isOpen?:             boolean;
  searchedBy?:         { characterId: string; roll: number }[];
  eligibleInteractions?: string[];
  effectiveTools?:     string[];
  armorClass?:         number;
  lockId?:             string;
  isLocked?:           boolean;
  isDestroyed?:        boolean;
  poiId?:              string;
  ```

- [ ] **D2** Add to `BuildCandidatesInput`:
  ```
  defeatedEnemies?: { id: string; name: string; x: number; y: number; lootItemIds: string[] }[];
  playerInventory?: { itemId: string; interactionTags: string[]; keyId?: string }[];
  currentCharId?:   string;
  investigationMod?: number;
  ```

- [ ] **D3** In `buildChipCandidates`, after the existing enemy loop, add **loot candidates**:
  - For each entry in `defeatedEnemies` where `lootItemIds.length > 0`:
    - Require Chebyshev distance ≤ 1 from `playerPos` (same tile or adjacent)
    - Require `visibleForChips` check (LoS — but corpse is likely already visible)
    - Push candidate: `action_type: "loot"`, `targetName: enemy.name`, `lootEnemyId: enemy.id`, `movementFeet: 0`, `requiresMovement: false`

- [ ] **D4** Add **container open candidates**:
  - For each POI in `pois` where `isContainer && !isOpen && !isDestroyed`:
    - Chebyshev distance from `playerPos` ≤ 1 (must be adjacent)
    - Push candidate: `action_type: "container_open"`, `targetName: poi.name`, `poiId: poi.id`, `movementFeet: 0`, `requiresMovement: false`
    - Note: player must already be adjacent — no movement chip for containers

- [ ] **D5** Add **container item pickup candidates**:
  - For each POI where `isContainer && isOpen && !isDestroyed`:
    - Chebyshev distance ≤ 1
    - Find `searchedBy` entry for `currentCharId`; if present, `roll = entry.roll + investigationMod`
    - For each slot in `containerInventory` where `roll > slot.investigationAc` (or `searchedBy` empty → treat as roll 0, only expose slots with `investigationAc === 0`):
      - Push candidate: `action_type: "container_pickup"`, `targetName: slot.itemName`, `poiId: poi.id`, `containerItemId: slot.itemId`, `movementFeet: 0`

- [ ] **D6** Add **key use candidates**:
  - For each POI where `isLocked && lockId` and Chebyshev distance ≤ 1:
    - Find matching key: `playerInventory?.find(i => i.keyId === poi.lockId)`
    - If found: push candidate: `action_type: "key_use"`, `targetName: poi.name`, `poiId: poi.id`, `toolItemId: matchingKey.itemId`, `movementFeet: 0`

- [ ] **D7** Add **terrain demolition candidates**:
  - For each POI where `eligibleInteractions` includes `"tool_demolition"` and `!isDestroyed` and Chebyshev distance ≤ 1:
    - For each item in `playerInventory` where `intersection(item.interactionTags, poi.effectiveTools).length > 0`:
      - Push ONE candidate per tool (take the first match if inventory could have multiple): `action_type: "terrain_demolish"`, `targetName: poi.name`, `poiId: poi.id`, `toolItemId: item.itemId`

- [ ] **D8** Add **strength bash candidates**:
  - For each POI where `eligibleInteractions` includes `"strength_bash"` and `!isDestroyed` and Chebyshev distance ≤ 1:
    - Push candidate: `action_type: "terrain_bash"`, `targetName: poi.name`, `poiId: poi.id`, `movementFeet: 0`

- [ ] **D9** In `candidatesToChips`, add label/type mappings for the new `action_type` values:
  - `"loot"` → label: `Loot ${name}`, type: `"none"`, `requiresRoll: false`
  - `"container_open"` → label: `Open ${name} (${x},${y})`, type: `"investigation"`, `requiresRoll: true`
  - `"container_pickup"` → label: `Take ${name}`, type: `"none"`, `requiresRoll: false`
  - `"key_use"` → label: `Unlock ${name} with key`, type: `"none"`, `requiresRoll: false`
  - `"terrain_demolish"` → label: `Use tool on ${name} (${x},${y})`, type: `"strength"`, `requiresRoll: true`
  - `"terrain_bash"` → label: `Bash ${name} (${x},${y})`, type: `"strength"`, `requiresRoll: true`
  - Propagate `lootEnemyId`, `poiId`, `containerItemId`, `toolItemId` from candidate onto the emitted `SuggestionChip`

- [ ] **D10** In `auto-advance.ts`, pass the new inputs to `buildChipCandidates`. Before the `buildChipCandidates` call:
  - Extract `defeatedEnemies` from `gmData.enemyState`: entries where `status === "DEFEATED"` and `lootItemIds.length > 0`, joined with tile positions from `gmTilesCand`
  - Extract `playerInventory` from the character's equipped items and `backpack`: fetch `interactionTags` and `keyId` for each item ID. Add a DB query: `prisma.item.findMany({ where: { id: { in: [...equippedIds, ...backpackIds] } }, select: { id: true, interactionTags: true, keyId: true } })`
  - Pass `currentCharId`, `investigationMod` (computed from character's Intelligence modifier + proficiency if Investigation proficient)
  - Update `candidatePois` to use the enriched POI shape (pois already carry all new fields after Phase C)

---

## Phase E — take-turn.ts: mechanical roll queueing

All changes in `app/actions/take-turn.ts`. Read the file fully before editing — locate the roll-queueing block and the ATQ creation.

- [ ] **E1** Near the top of `takeTurn` (after loading game and chip), add an early-return branch for instant action types (`"loot"`, `"key_use"`, `"container_pickup"`):
  - Create `ActiveTurnQueue` with `rolls: []` and immediately mark `status: "COMPLETED"`
  - Return `{ success: true, turnId: atq.id, requiresRoll: false }` — skip the Claude call entirely

- [ ] **E2** For `action_type === "container_open"`:
  - Skip the Claude roll-detection call
  - Compute `investigationModifier` from character Intelligence + proficiency (if Investigation is in `character.skillProficiencies`)
  - Queue one roll: `{ type: "ABILITY_CHECK", label: "Investigation", diceFormula: "1d20", dc: null, advantageState: "NONE" }` with `actorName: character.name`
  - Create ATQ with this roll, status `PENDING_ROLLS`
  - Return normally

- [ ] **E3** For `action_type === "terrain_bash"`:
  - Skip the Claude roll-detection call
  - Load the POI from `GameMap.data.pois` using `chip.poiId` to get `armorClass`
  - Queue one roll: `{ type: "ABILITY_CHECK", label: "Strength Check", diceFormula: "1d20+<strengthMod>", dc: poi.armorClass }` 
  - Create ATQ, return normally

- [ ] **E4** For `action_type === "terrain_demolish"`:
  - Skip the Claude roll-detection call
  - Load the POI from `GameMap.data.pois` using `chip.poiId` to get `armorClass`
  - Load tool item using `chip.toolItemId` to get `damageDice`
  - Queue two rolls:
    1. `{ type: "ATTACK", label: "Tool Attack", diceFormula: "1d20+<attackBonus>", dc: poi.armorClass }`
    2. `{ type: "DAMAGE", label: "Tool Damage", diceFormula: tool.damageDice, dc: null, skipped: false }` (will be auto-skipped client-side if ATTACK fails — same as weapon damage)
  - Create ATQ, return normally

- [ ] **E5** For `action_type === "terrain_bash"`:
  - Skip the Claude roll-detection call
  - Load the POI from `GameMap.data.pois` using `chip.poiId` to get `armorClass`
  - Load character's equipped weapon to get `damageDice` (fallback: `"1d4"` unarmed)
  - Queue two rolls:
    1. `{ type: "ABILITY_CHECK", label: "Strength Check", diceFormula: "1d20+<strengthMod>", dc: poi.armorClass }`
    2. `{ type: "DAMAGE", label: "Bash Damage", diceFormula: weapon.damageDice, dc: null, skipped: false }` (auto-skipped client-side if ABILITY_CHECK fails)
  - Create ATQ, return normally

---

## Phase F — auto-advance.ts: new action handlers

All changes in `app/actions/auto-advance.ts`.

- [ ] **F1** Add `lootEnemyId?: string`, `poiId?: string`, `containerItemId?: string`, `toolItemId?: string` to the `autoAdvance` function signature (after existing `itemId?`).

- [ ] **F2** Add **loot enemy handler** inside the transaction (after the existing `itemId` pickup block, ~line 1093):
  ```
  if (lootEnemyId) {
    const gmForLoot = await tx.gameMap.findUnique(...)
    const enemySt = gmForLoot.data.enemyState[lootEnemyId]
    if (enemySt && enemySt.lootItemIds.length > 0) {
      // Transfer each item to character (same equip-or-backpack logic as itemId handler)
      // Clear enemySt.lootItemIds = []
      // Write updated enemyState back to GameMap
    }
  }
  ```
  For each item in `lootItemIds`: apply the same `EQUIPPABLE` slot logic used in the `itemId` handler (lines 1067–1091) — equip if slot open, else backpack.

- [ ] **F3** Add **container open handler** inside the transaction:
  ```
  if (poiId && chip.action_type === "container_open") {
    const roll = rolls.find(r => r.label === "Investigation" && r.totalResult !== null)
    const totalRoll = roll?.totalResult ?? 0
    const gmForContainer = await tx.gameMap.findUnique(...)
    const poiIndex = gmForContainer.data.pois.findIndex(p => p.id === poiId)
    const poi = pois[poiIndex]
    // Append { characterId: currentCharId, roll: totalRoll } to poi.searchedBy (skip if already present for this character)
    poi.isOpen = true
    // Write updated pois back
    // After transaction, generate new chips that include container_pickup candidates for visible items
    // (the next autoAdvance call will regenerate chips from the updated pois state — no special handling needed)
  }
  ```
  Also decrement `character.remainingObjectInteractions` by 1 (floor at 0).

- [ ] **F4** Add **container item pickup handler** inside the transaction:
  ```
  if (poiId && containerItemId && chip.action_type === "container_pickup") {
    const gmForPickup = await tx.gameMap.findUnique(...)
    const poi = pois.find(p => p.id === poiId)
    const slotIndex = poi.containerInventory.findIndex(s => s.itemId === containerItemId)
    if (slotIndex !== -1 && !poi.isPickedUpItems?.includes(containerItemId)) {
      // Remove slot from containerInventory
      poi.containerInventory.splice(slotIndex, 1)
      // Apply equip-or-backpack logic (same as itemId handler)
      // Write updated pois + character
    }
    // Decrement character.remainingObjectInteractions
  }
  ```

- [ ] **F5** Add **key use handler** inside the transaction:
  ```
  if (poiId && chip.action_type === "key_use") {
    const gm = await tx.gameMap.findUnique(...)
    const poi = pois.find(p => p.id === poiId)
    if (poi && poi.isLocked) {
      poi.isLocked = false
      // Write updated pois
    }
  }
  ```
  No action economy cost (free action).

- [ ] **F6** Add **terrain demolition handler** inside the transaction:
  ```
  if (poiId && chip.action_type === "terrain_demolish") {
    const attackRoll = rolls.find(r => r.type === "ATTACK")
    const damageRoll = rolls.find(r => r.type === "DAMAGE" && !r.skipped)
    if (attackRoll?.isSuccess && damageRoll?.totalResult) {
      const damage = damageRoll.totalResult
      const gm = await tx.gameMap.findUnique(...)
      const poi = pois.find(p => p.id === poiId)
      const effectiveDamage = damage >= (poi.damageThreshold ?? 0) ? damage : 0
      poi.currentHp = Math.max(0, (poi.currentHp ?? poi.maxHp ?? 1) - effectiveDamage)
      if (poi.currentHp <= 0) {
        poi.isDestroyed = true
        // If poi.t === "D" or poi tile coordinate has a door tile, apply D→F mapUpdate
        const doorTile = gm.data.tiles[poi.y]?.[poi.x]
        if (doorTile?.t === "D") {
          gm.data.tiles[poi.y][poi.x] = { ...doorTile, t: "F" }
        }
      }
      // Write updated pois + tiles
    }
  }
  ```

- [ ] **F7** Add **terrain bash handler** inside the transaction (same pattern as F6 — reads both rolls from the client queue):
  ```
  if (poiId && chip.action_type === "terrain_bash") {
    const checkRoll  = rolls.find(r => r.type === "ABILITY_CHECK")
    const damageRoll = rolls.find(r => r.type === "DAMAGE" && !r.skipped)
    if (checkRoll?.isSuccess && damageRoll?.totalResult) {
      // Apply damage threshold + currentHp update (identical to F6)
    }
  }
  ```
  Bash damage flows through the client dice queue (DAMAGE roll queued in E4), not server-side. No `rollDamageExpr` call here.

- [ ] **F8** Find the location where `character.remainingActions` is reset to 1 at turn start/round boundary. Add a parallel reset of `remainingObjectInteractions` to 1 in the same `tx.character.update` call.

---

## Phase G — Verification

- [ ] **G1** `npm run build` — zero new TypeScript errors
- [ ] **G2** `npm test` — all tests pass

---

## Edge cases to verify before marking G complete

1. **Enemy defeated with no mainHandId** — `lootItemIds` stays `[]`; no loot chip generated. No crash.
2. **Container opened twice by same character** — `searchedBy` already has this `characterId`; handler skips appending a second entry and reuses the existing roll. Items visible are identical to first open.
3. **Container opened by two different party members** — `searchedBy` has two entries; each character's chip generation reads only their own roll entry. Correct per-character visibility.
4. **Terrain bash hits but damage < threshold** — `effectiveDamage = 0`; `currentHp` unchanged. No destruction. Correct.
5. **Key used on already-unlocked POI** — `poi.isLocked === false` check guards against double-unlock. No-op, no crash.
6. **Container item picked up then the same container opened again** — slot was removed from `containerInventory`; chip generation reflects the reduced inventory. Correct.
7. **Old `GameMap` rows (pre-migration)** — POI entries lack all new fields. All new fields are optional; handlers guard with null-checks. No crash, features silently inactive for legacy maps.

---

## Files changed (expected)

| File | What changes |
|------|-------------|
| `prisma/schema.prisma` | Add `interactionTags`, `keyId` to Item; `remainingObjectInteractions` to Character |
| `lib/tile-types.ts` | Expand `GameMapData.pois` element shape |
| `types/suggestion-chip.ts` | New ActionType values; new SuggestionChip fields |
| `components/map-renderer.tsx` | Update MapData.pois shape (no render logic) |
| `lib/create-game-map.ts` | lootItemIds population, container/terrain POI live state init |
| `lib/chip-candidates.ts` | New candidate types, extended interfaces, new candidatesToChips labels |
| `app/actions/auto-advance.ts` | New function params, defeatedEnemies/playerInventory inputs, 6 new action handlers, actions reset |
| `app/actions/take-turn.ts` | Early-return for instant types, mechanical roll queueing for container/terrain types |
