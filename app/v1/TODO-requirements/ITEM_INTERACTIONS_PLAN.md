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
    - Find `searchedBy` entry for `currentCharId`; if present, `roll = entry.roll` (already includes investigationModifier — baked into diceFormula in E2)
    - For each slot in `containerInventory` where `roll > slot.investigationAc` (or `searchedBy` empty → treat roll as 0, only expose slots with `investigationAc === 0`):
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
  - Compute `investigationModifier` from character Intelligence modifier + proficiency bonus (if `"Investigation"` is in `character.skillProficiencies`)
  - Queue one roll: `{ type: "ABILITY_CHECK", label: "Investigation", diceFormula: "1d20+<investigationModifier>", dc: null, advantageState: "NONE" }` — modifier baked into formula so `totalResult` already includes it; F3 stores `totalResult` directly in `searchedBy.roll` with no further adjustment
  - Create ATQ with this roll, status `PENDING_ROLLS`
  - Return normally

- [ ] **E3** For `action_type === "terrain_demolish"`:
  - Skip the Claude roll-detection call
  - Load the POI from `GameMap.data.pois` using `chip.poiId` to get `armorClass`
  - Load tool item using `chip.toolItemId` to get `damageDice`
  - Queue two rolls:
    1. `{ type: "ATTACK", label: "Tool Attack", diceFormula: "1d20+<attackBonus>", dc: poi.armorClass }`
    2. `{ type: "DAMAGE", label: "Tool Damage", diceFormula: tool.damageDice, dc: null, skipped: false }` (auto-skipped client-side if ATTACK fails — same as weapon damage)
  - Create ATQ, return normally

- [ ] **E4** For `action_type === "terrain_bash"`:
  - Skip the Claude roll-detection call
  - Load the POI from `GameMap.data.pois` using `chip.poiId` to get `armorClass`
  - Load character's equipped `mainHand` item to get `damageDice` (fallback: `"1d4"` unarmed)
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
  Key is **not consumed** — it stays in the character's inventory after unlocking. No action economy cost (free action).

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

- [ ] **F9** Pass destructible terrain state into the per-turn Claude prompt so narration reflects the **post-action** HP, not the pre-action HP. The pattern mirrors the existing `mechanicalAttack` / `mechanicalEffect` flow used for enemy weapon damage.

  **Step 1 — Pre-compute terrain effect (before the Claude call)**

  After resolving `mechanicalAttack` (around line 497), add a parallel block for terrain actions:
  ```typescript
  interface TerrainAttackResult {
    poiName:   string;
    poiId:     string;
    damage:    number;   // effective damage after threshold (0 if below threshold or miss)
    hpBefore:  number;
    hpAfter:   number;
    destroyed: boolean;
  }
  let terrainAttackResult: TerrainAttackResult | undefined;

  if (poiId && (chipActionType === "terrain_bash" || chipActionType === "terrain_demolish")) {
    const terrainPoi = ((mapData.pois ?? []) as any[]).find(p => p.id === poiId);
    if (terrainPoi) {
      const checkRoll  = rolls.find(r => r.type === "ATTACK" || r.type === "ABILITY_CHECK");
      const damageRoll = rolls.find(r => r.type === "DAMAGE" && !r.skipped);
      if (checkRoll?.isSuccess && damageRoll?.totalResult != null) {
        const raw     = damageRoll.totalResult;
        const eff     = raw >= (terrainPoi.damageThreshold ?? 0) ? raw : 0;
        const hpBefore = terrainPoi.currentHp ?? terrainPoi.maxHp ?? 1;
        const hpAfter  = Math.max(0, hpBefore - eff);
        terrainAttackResult = {
          poiName:   terrainPoi.name,
          poiId,
          damage:    eff,
          hpBefore,
          hpAfter,
          destroyed: hpAfter <= 0,
        };
      }
    }
    console.log("[auto-advance] terrain pre-compute", {
      poiId,
      chipActionType,
      terrainAttackResult: terrainAttackResult ?? "miss or no damage",
    });
  }
  ```

  **Step 2 — Pass to `buildDynamicContext`**

  Add `terrainPois` and `terrainAttackResult` as parameters. Build the terrain string inside the function:
  ```typescript
  const allTerrainPois = ((mapData.pois ?? []) as any[]).filter(
    p => p.maxHp !== undefined && !p.isDestroyed
  );

  const terrainStr = allTerrainPois.length > 0
    ? allTerrainPois.map(p => {
        const hp = terrainAttackResult?.poiId === p.id
          ? terrainAttackResult.hpAfter    // post-action value
          : (p.currentHp ?? p.maxHp);     // pre-action value (no bash this turn)
        const destroyed = terrainAttackResult?.poiId === p.id && terrainAttackResult.destroyed;
        if (destroyed) return `${p.name}(${p.x},${p.y})[DESTROYED]`;
        return `${p.name}(${p.x},${p.y})[HP:${hp}/${p.maxHp}${p.isLocked ? ',locked' : ''}]`;
      }).join(' ')
    : null;
  ```

  Append to the `CURRENT STATE` block alongside enemies and items:
  ```
  Terrain: Iron-Banded Door(5,3)[HP:6/10,locked] Rotting Barrel(3,2)[HP:3/3]
  ```
  Or on a destroying blow:
  ```
  Terrain: Iron-Banded Door(5,3)[DESTROYED]
  ```

  **Step 3 — Add a MECHANICAL RESULT line for terrain** (mirrors the enemy attack line):
  ```typescript
  const terrainResultLine = terrainAttackResult
    ? terrainAttackResult.damage === 0
      ? `\nMECHANICAL RESULT: ${terrainAttackResult.poiName} resisted the blow — damage below structural threshold, no damage dealt.`
      : terrainAttackResult.destroyed
        ? `\nMECHANICAL RESULT: ${terrainAttackResult.poiName} took ${terrainAttackResult.damage} damage and is DESTROYED. HP applied by engine; do not invent a different outcome.`
        : `\nMECHANICAL RESULT: ${terrainAttackResult.poiName} took ${terrainAttackResult.damage} damage (HP ${terrainAttackResult.hpBefore} → ${terrainAttackResult.hpAfter}). HP applied by engine; do not invent a different outcome.`
    : "";
  ```

  Append `terrainResultLine` to the turn section, after any `attackLine`, so Claude sees both enemy and terrain mechanical outcomes in the same block.

  **Note:** The transaction in F6/F7 still writes the same `hpAfter` value to the DB — the pre-computation here is only for the prompt. The two calculations must use identical logic or they will diverge. Extract the `effectiveDamage` computation into a shared helper:
  ```typescript
  function calcEffectiveDamage(raw: number, threshold: number): number {
    return raw >= threshold ? raw : 0;
  }
  ```
  Call it in both F9 (pre-compute) and F6/F7 (transaction). Never inline the threshold logic in two places.

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

## Phase H — Console log specifications

Add these logs to help trace interactions during manual testing. Follow the existing `[auto-advance]` prefix pattern.

### F2 — Loot enemy
```typescript
console.log("[auto-advance] loot enemy", {
  lootEnemyId,
  lootItemIds:  enemySt?.lootItemIds ?? [],
  transferred:  enemySt?.lootItemIds?.length ?? 0,
  characterId:  currentCharId,
});
// Per item transferred:
console.log("[auto-advance] loot item", { itemId, slot: slotField ?? "backpack" });
// If enemy not found or already looted:
console.warn("[auto-advance] loot enemy skipped", { lootEnemyId, reason: enemySt ? "already empty" : "no enemyState entry" });
```

### F3 — Container open
```typescript
console.log("[auto-advance] container open", {
  poiId,
  poiName:      poi?.name,
  investigationRoll: totalRoll,
  alreadySearched:  poi?.searchedBy?.some(s => s.characterId === currentCharId) ?? false,
  visibleSlots: poi?.containerInventory?.filter(s => totalRoll > s.investigationAc).length ?? 0,
  totalSlots:   poi?.containerInventory?.length ?? 0,
});
// If poi not found:
console.warn("[auto-advance] container open — poi not found", { poiId, availablePoiIds: pois.map(p => p.id) });
```

### F4 — Container item pickup
```typescript
console.log("[auto-advance] container pickup", {
  poiId,
  containerItemId,
  slotFound:   slotIndex !== -1,
  slot:        poi?.containerInventory?.[slotIndex],
  equippedTo:  slotField ?? "backpack",
  characterId: currentCharId,
});
// If slot not found:
console.warn("[auto-advance] container pickup — slot not found", { containerItemId, remainingSlots: poi?.containerInventory?.map(s => s.itemId) });
```

### F5 — Key use
```typescript
console.log("[auto-advance] key use", {
  poiId,
  poiName:    poi?.name,
  lockId:     poi?.lockId,
  toolItemId,
  wasLocked:  poi?.isLocked ?? false,
  keyRetained: true,   // key stays in inventory
});
// If poi already unlocked:
console.warn("[auto-advance] key use — poi already unlocked", { poiId });
```

### F6 — Terrain demolition
```typescript
console.log("[auto-advance] terrain demolish", {
  poiId,
  poiName:         poi?.name,
  attackSuccess:   attackRoll?.isSuccess,
  rawDamage:       damageRoll?.totalResult ?? 0,
  damageThreshold: poi?.damageThreshold ?? 0,
  effectiveDamage,
  hpBefore:        poi?.currentHp ?? poi?.maxHp,
  hpAfter:         poi?.currentHp,   // after mutation
  destroyed:       poi?.isDestroyed ?? false,
  tileConvertedToFloor: doorTile?.t === "D" && (poi?.currentHp ?? 1) <= 0,
});
```

### F7 — Terrain bash
```typescript
console.log("[auto-advance] terrain bash", {
  poiId,
  poiName:         poi?.name,
  checkSuccess:    checkRoll?.isSuccess,
  checkResult:     checkRoll?.totalResult,
  poiArmorClass:   poi?.armorClass,
  rawDamage:       damageRoll?.totalResult ?? 0,
  damageThreshold: poi?.damageThreshold ?? 0,
  effectiveDamage,
  hpBefore:        hpBefore,
  hpAfter:         poi?.currentHp,
  destroyed:       poi?.isDestroyed ?? false,
});
```

### C2 — Map creation loot population (in createGameMap)
```typescript
console.log("[create-game-map] enemyState lootItemIds", Object.fromEntries(
  Object.entries(enemyState).map(([id, st]) => [id, st.lootItemIds])
));
```

### D-level chip generation (in buildChipCandidates)
```typescript
console.log("[chip-candidates] loot candidates", defeatedEnemies?.map(e => ({ id: e.id, name: e.name, lootCount: e.lootItemIds.length })) ?? []);
console.log("[chip-candidates] container candidates", { open: openContainerCount, pickup: pickupCandidateCount, keyUse: keyUseCandidateCount });
console.log("[chip-candidates] terrain candidates", { demolish: demolishCount, bash: bashCount });
```

---

## Phase I — Test cases

New test file: `lib/item-interactions.test.ts`

### Group 1: createGameMap — loot population

```
test: enemy with mainHandId → lootItemIds = [mainHandId]
  setup:  Enemy DB row with mainHandId = "uuid-sword"
  assert: enemyState["uuid-enemy"].lootItemIds deepEquals ["uuid-sword"]

test: enemy with null mainHandId → lootItemIds = []
  setup:  Enemy DB row with mainHandId = null
  assert: enemyState["uuid-enemy"].lootItemIds deepEquals []
```

### Group 2: createGameMap — container POI enrichment

```
test: container POI initialised with isOpen=false, searchedBy=[], isLocked=false (no lockId)
  setup:  Map.data.pois includes { id: "p1", isContainer: true, containerInventory: [...], lockId: null }
  assert: GameMap.data.pois[0].isOpen === false
  assert: GameMap.data.pois[0].searchedBy deepEquals []
  assert: GameMap.data.pois[0].isLocked === false

test: locked container POI initialised with isLocked=true
  setup:  POI with lockId: "chest_lock_01"
  assert: GameMap.data.pois[0].isLocked === true

test: container item names resolved from DB
  setup:  containerInventory slot has itemId "uuid-sword", Item row name = "Short Sword"
  assert: GameMap.data.pois[0].containerInventory[0].itemName === "Short Sword"
```

### Group 3: createGameMap — terrain POI enrichment

```
test: terrain POI initialised with currentHp = maxHp, isLocked from lockId
  setup:  POI with maxHp: 10, lockId: "cellar_key_01"
  assert: GameMap.data.pois[0].currentHp === 10
  assert: GameMap.data.pois[0].isLocked === true
  assert: GameMap.data.pois[0].isDestroyed === false

test: terrain POI with no lockId → isLocked = false
  setup:  POI with maxHp: 10, lockId: null
  assert: GameMap.data.pois[0].isLocked === false
```

### Group 4: buildChipCandidates — loot chips

```
test: defeated adjacent enemy with lootItemIds → loot chip generated
  input:  defeatedEnemies = [{ id: "e1", name: "Rat", x: 1, y: 1, lootItemIds: ["uuid-claw"] }]
          playerPos = { x: 1, y: 0 }   // adjacent (Chebyshev = 1)
  assert: candidates includes { action_type: "loot", lootEnemyId: "e1" }

test: defeated enemy 3 tiles away → no loot chip
  input:  playerPos = { x: 0, y: 0 }, defeatedEnemy at { x: 3, y: 3 }
  assert: candidates has no loot entry

test: defeated enemy with empty lootItemIds → no loot chip
  input:  defeatedEnemies = [{ id: "e1", lootItemIds: [] }]
  assert: candidates has no loot entry
```

### Group 5: buildChipCandidates — container chips

```
test: adjacent closed container → container_open chip generated
  input:  pois = [{ id: "p1", name: "Chest", x: 2, y: 1, isContainer: true, isOpen: false }]
          playerPos = { x: 2, y: 0 }
  assert: candidates includes { action_type: "container_open", poiId: "p1" }

test: container 2 tiles away → no container_open chip
  input:  playerPos = { x: 0, y: 0 }, container at { x: 2, y: 0 }
  assert: candidates has no container_open entry

test: adjacent open container + searchedBy roll 16 + investigationAc 8 → container_pickup chip
  input:  poi with isOpen: true, searchedBy: [{ characterId: "char-1", roll: 16 }]
          containerInventory: [{ itemId: "uuid-potion", itemName: "Potion", investigationAc: 8 }]
          currentCharId: "char-1"
  assert: candidates includes { action_type: "container_pickup", containerItemId: "uuid-potion" }

test: roll 7 < investigationAc 8 → no pickup chip for that slot
  input:  same as above but searchedBy roll = 7
  assert: candidates has no container_pickup for "uuid-potion"

test: no searchedBy entry for current character → only investigationAc=0 slots visible
  input:  searchedBy = [], containerInventory has slots with ac [0, 8, 14]
  assert: exactly 1 container_pickup candidate (the ac=0 slot)
```

### Group 6: buildChipCandidates — key use chips

```
test: adjacent locked POI + player has matching key → key_use chip
  input:  poi with lockId: "key_01", isLocked: true, at (3,3)
          playerInventory = [{ itemId: "uuid-key", keyId: "key_01" }]
          playerPos = { x: 3, y: 2 }
  assert: candidates includes { action_type: "key_use", poiId: poi.id, toolItemId: "uuid-key" }

test: locked POI but player has no matching key → no key_use chip
  input:  playerInventory = [{ itemId: "uuid-hammer", keyId: null }]
  assert: candidates has no key_use entry

test: unlocked POI (isLocked: false) → no key_use chip
  input:  poi.isLocked = false
  assert: candidates has no key_use entry

test: movement chip suppressed for locked POI
  input:  poi with isLocked: true (a door POI at (5,3))
  assert: candidates has no movement chip targeting (5,3)
  note:   add isLocked guard to the movement candidate loop in D3/existing POI handling
```

### Group 7: buildChipCandidates — terrain chips

```
test: adjacent POI with tool_demolition + player has matching tool → terrain_demolish chip
  input:  poi.eligibleInteractions = ["tool_demolition"], poi.effectiveTools = ["blunt"]
          playerInventory = [{ itemId: "uuid-hammer", interactionTags: ["blunt", "heavy_demolition"] }]
  assert: candidates includes { action_type: "terrain_demolish", poiId: poi.id, toolItemId: "uuid-hammer" }

test: player tool tags don't intersect effectiveTools → no demolish chip
  input:  poi.effectiveTools = ["blunt"], playerInventory = [{ interactionTags: ["piercing"] }]
  assert: candidates has no terrain_demolish entry

test: adjacent POI with strength_bash → terrain_bash chip
  input:  poi.eligibleInteractions = ["strength_bash"]
  assert: candidates includes { action_type: "terrain_bash", poiId: poi.id }

test: destroyed POI → no terrain chips generated
  input:  poi.isDestroyed = true
  assert: candidates has no terrain_demolish or terrain_bash entries for this poi
```

### Group 8: autoAdvance — container open handler

```
test: investigation roll 16 stored in searchedBy, isOpen set to true
  mock:   rolls = [{ type: "ABILITY_CHECK", label: "Investigation", totalResult: 16 }]
          GameMap has chest POI with isOpen: false, searchedBy: []
  assert: poi.isOpen === true after handler
  assert: poi.searchedBy = [{ characterId: currentCharId, roll: 16 }]
  assert: character.remainingObjectInteractions decremented by 1

test: same character opens same container twice — roll NOT overwritten
  mock:   searchedBy already = [{ characterId: currentCharId, roll: 16 }]
          new roll totalResult = 4
  assert: searchedBy still = [{ characterId: currentCharId, roll: 16 }]  (no duplicate entry)
```

### Group 9: autoAdvance — key use handler

```
test: key use sets isLocked to false
  mock:   poi with isLocked: true, lockId: "chest_lock_01"
          chip = { action_type: "key_use", poiId: poi.id, toolItemId: "uuid-key" }
  assert: poi.isLocked === false after handler

test: key stays in character inventory after use
  mock:   character backpack = ["uuid-key", "uuid-torch"]
  assert: character.backpack still contains "uuid-key" after handler

test: key_use on already-unlocked poi → no-op, no crash
  mock:   poi.isLocked = false
  assert: handler completes without error, poi.isLocked still false
```

### Group 10: autoAdvance — terrain handlers

```
test: demolish — attack hit + damage ≥ threshold → hp reduced
  mock:   poi with currentHp: 10, damageThreshold: 3, armorClass: 13
          rolls = [ATTACK isSuccess:true, DAMAGE totalResult:5]
  assert: poi.currentHp === 5

test: demolish — attack hit + damage < threshold → hp unchanged
  mock:   rolls = [ATTACK isSuccess:true, DAMAGE totalResult:2]  (threshold: 3)
  assert: poi.currentHp === 10  (effectiveDamage = 0)

test: demolish — attack miss → no damage
  mock:   rolls = [ATTACK isSuccess:false, DAMAGE skipped:true]
  assert: poi.currentHp === 10

test: demolish — currentHp reaches 0 → isDestroyed=true + door tile becomes "F"
  mock:   poi with currentHp: 3, damageThreshold: 0, tile at (x,y) has t:"D"
          rolls = [ATTACK isSuccess:true, DAMAGE totalResult:5]
  assert: poi.isDestroyed === true
  assert: GameMap.data.tiles[y][x].t === "F"

test: bash — strength check success + damage ≥ threshold → hp reduced (mirrors demolish)
test: bash — strength check fail → no damage
```

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
