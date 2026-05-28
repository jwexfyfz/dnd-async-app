# Combat Engine Refactor — Implementation Plan
# Status: READY — all decisions locked, no blockers

---

## Locked Decisions

1. **`CombatSession` shape** — JSON array column + integer index pointer.
   Schema: `initiativeOrder: Json` (array of `{actorId, actorType: "CHARACTER"|"ENEMY", initiative, hasReaction, isSurprised}`),
   `currentTurnIndex: Int` (pointer into array), `currentRoundNumber: Int`.
   No cap on actor count. Turn advance = `(currentTurnIndex + 1) % initiativeOrder.length`.
   The DM system prompt must treat `initiativeOrder` as immutable after combat starts — entries may
   have `hasReaction` and `isSurprised` mutated, but the array order and actor slots never change mid-combat.

2. **Solo game grid position** — Add `posX Int @default(0)` and `posY Int @default(0)` to `Character`.
   Party games read from `PartyMember.posX/posY`. Solo games read from `Character.posX/posY`.

3. **`auto-advance.ts` strategy** — Keep as-is for player turns. Add `processNpcTurns(gameId)` call
   at the end of `autoAdvance()` when an active `CombatSession` exists.
   **Gap fixed:** `parseCombatEffects` returns target UUIDs — must route writes to `enemy` table when
   targetId matches an Enemy record, and to `character` table when it matches a Character. Both tables
   have `currentHp` columns. The transaction must look up both tables and dispatch accordingly.
   **Combat end:** `CombatSession` is deleted (not soft-deleted) when `encounterResult === "completed"`
   is returned by the AI AND no actor with `actorType === "ENEMY"` in the initiative order has `currentHp > 0`.
   Deleting the record is the "not in combat" signal — all combat gates check `CombatSession` existence.

4. **Map wall encoding** — `tiles[y][x]` string codes. `"W"` = wall (blocks movement + LoS).
   `"F"` = floor. `"D"` = door (passable, does NOT block LoS). LoS ray-march blocks only on `=== "W"`.

---

## Phase A — Schema Migration
**Goal:** Add `CombatSession` model + stealth/reaction/surprise fields to existing actors.

### Tasks
- [x] Add `CombatSession` model to `prisma/schema.prisma`
- [x] Add `combatSession CombatSession?` relation to `Game` model
- [x] Add to `Enemy`: `isHiding Boolean @default(false)`, `stealthRoll Int @default(0)`,
      `hasReaction Boolean @default(true)`, `isSurprised Boolean @default(false)`
- [x] Add to `PartyMember`: `isHiding Boolean @default(false)`, `stealthRoll Int @default(0)`
- [x] Add to `Character`: `posX Int @default(0)`, `posY Int @default(0)`
- [x] Run `prisma migrate dev --name add_combat_session_stealth_grid`

### State Snapshot — end of Phase A
```
DB:
  CombatSession table exists (empty)
  Game.combatSession relation wired
  Enemy columns added: isHiding, stealthRoll, hasReaction, isSurprised
  PartyMember columns added: isHiding, stealthRoll
  Character columns added: posX, posY

Files edited:
  prisma/schema.prisma

Variables/types added:
  Prisma client regenerated — CombatSession type available
```

---

## Phase B — Combat Trigger & Initiative Engine
**Goal:** Detect combat triggers, roll initiative with D&D 5e tie-breakers, create `CombatSession`.

### Tasks
- [x] Create `lib/initiative.ts`
- [x] Create `app/actions/trigger-combat.ts`
- [x] Modify `app/actions/take-turn.ts` (intercept rule + session-based turn gate)

### State Snapshot — end of Phase B
```
DB:
  CombatSession row created on first combat trigger
  CombatSession.currentTurnIndex = 0
  CombatSession.currentRoundNumber = 1
  Enemy.isSurprised = true/false per individual surprise evaluation
  Enemy.hasReaction = true (reset at session creation)

Files edited:
  lib/initiative.ts  (new)
  app/actions/trigger-combat.ts  (new)
  app/actions/take-turn.ts  (intercept rule + session-based turn gate)

Key variables:
  InitiativeSlot[]  — canonical ordered combat roster
  CombatSession.currentTurnIndex  — single integer pointer into roster
```

---

## Phase C — NPC Turn Loop + Combat End
**Goal:** Auto-execute consecutive NPC turns after player End Turn. Delete `CombatSession` on resolution.

### Tasks
- [x] Create `app/actions/process-npc-turns.ts`
  - Entry: `processNpcTurns(gameId: string): Promise<NpcBatchResult>`
  - Load `CombatSession` with `initiativeOrder` + current index
  - Loop forward from `currentTurnIndex + 1`:
    - **Dead actor skip:** if actor's `currentHp <= 0`, advance index, no AI call, continue
    - **Surprised actor:** force-pass (zero actions), clear `isSurprised`, set `hasReaction = true`
      on the slot, advance index, continue
    - **Human player:** stop loop, return accumulated results
    - **NPC:** reset `hasReaction = true` for this slot, accumulate in batch, continue
  - After collecting all consecutive NPCs, make ONE AI call with full batch context
  - Parse ALL `<combat_effect>` tags from response
  - **HP routing (gap fix):** collect unique targetIds → query BOTH `character` AND `enemy` tables
    in the same transaction → update `currentHp` in whichever table owns the ID:
    ```
    tx.character.update({ where: { id }, data: { currentHp: newHp } })  // if characterIds.has(id)
    tx.enemy.update(    { where: { id }, data: { currentHp: newHp } })  // if enemyIds.has(id)
    ```
  - Write updated `initiativeOrder` slots + new `currentTurnIndex` to `CombatSession`
  - **Round wrap:** if new index wraps to 0, increment `currentRoundNumber`, reset ALL slot `hasReaction = true`
  - **Combat end check:** if `encounterResult === "completed"` AND all ENEMY slots in `initiativeOrder`
    have `currentHp <= 0` → `tx.combatSession.delete({ where: { gameId } })`
- [x] Modify `app/actions/auto-advance.ts`
  - After existing `$transaction` commits, check `prisma.combatSession.findUnique({ where: { gameId } })`
  - If exists: call `processNpcTurns(gameId)`, append NPC narrative + dice blocks to return value
  - Return extended `AutoAdvanceResult` with `npcNarrative?: string`, `npcCombatEffects?: [...]`
- [x] Add same combat-end check to `app/actions/take-turn.ts` player turn path:
  - If player action kills last enemy (`encounterResult === "completed"`, no living enemies), delete `CombatSession`

### State Snapshot — end of Phase C
```
DB:
  CombatSession.currentTurnIndex = index of next human player's slot
  CombatSession.currentRoundNumber incremented when index wraps to 0
  CombatSession deleted when all enemies dead + encounterResult = "completed"
  Enemy.hasReaction = false if reaction was used during their turn
  Enemy.isSurprised = false after their surprised pass-turn is consumed
  Enemy.currentHp updated via tx.enemy.update (gap fix applied)
  Character.currentHp updated via tx.character.update

Files edited:
  app/actions/process-npc-turns.ts  (new)
  app/actions/auto-advance.ts  (post-commit NPC loop call + extended return type)
  app/actions/take-turn.ts  (combat-end delete on player kill)

Key variables:
  NpcBatchResult.narrative      — batched NPC narrative block
  NpcBatchResult.combatEffects  — HP deltas for all affected actors (characters + enemies)
  AutoAdvanceResult.npcNarrative
  AutoAdvanceResult.npcCombatEffects
```

---

## Phase D — Grid Spatial Engine
**Goal:** Authoritative grid math — diagonal movement, line-of-sight, Attacks of Opportunity.

### Tasks
- [x] Create `lib/grid.ts`
  - `diagonalDistance(a: {x,y}, b: {x,y}): number` — alternating 5ft/10ft (1st diagonal = 5ft, 2nd = 10ft, ...)
  - `lineOfSight(from: {x,y}, to: {x,y}, tiles: string[][]): boolean`
    — ray-march; blocks on `tiles[y][x] === "W"` only. Doors ("D") are transparent.
  - `checkAttackOfOpportunity(moverPos: {x,y}, destPos: {x,y}, enemies: {id: string; pos: {x,y}; hasReaction: boolean; isSurprised: boolean}[]): string | null`
    — returns enemy ID if movement exits adjacency of a reactive, un-surprised enemy; else null
- [x] Extend `SuggestionChip` type in `types/suggestion-chip.ts`:
  add `endPosition?: { x: number; y: number }`, `actionTarget?: { x: number; y: number }`
- [x] Modify `app/actions/take-turn.ts`:
  - Validate `chip.endPosition` distance against `character.remainingMovementFeet` via `diagonalDistance`
  - Reject (return error) if distance exceeds remaining movement
  - Check `lineOfSight` before processing ranged attack chips — reject if blocked
  - On movement chip with `endPosition`: call `checkAttackOfOpportunity`; if triggered:
    1. Roll enemy reaction attack (dice only — no AI call)
    2. Apply damage via `tx.character.update` inside transaction
    3. Set that enemy's `hasReaction = false` in `CombatSession.initiativeOrder` slot
    4. Complete movement to `endPosition`
- [x] Modify `buildDynamicStatePrompt` in both `take-turn.ts` and `auto-advance.ts`:
  - Add LoS-filtered enemy list: enemies behind walls relative to active actor are marked `[CONCEALED]`
    in the state prompt to prevent AI narrating attacks through walls

### State Snapshot — end of Phase D
```
DB:
  PartyMember.posX/posY updated on valid movement (already wired in transaction)
  Character.posX/posY updated for solo games
  Enemy.posX/posY updated on NPC movement (via process-npc-turns)
  CombatSession.initiativeOrder slot hasReaction = false if AoO consumed

Files edited:
  lib/grid.ts  (new)
  types/suggestion-chip.ts  (endPosition, actionTarget fields)
  app/actions/take-turn.ts  (movement validation, LoS check, AoO processing)
  app/actions/auto-advance.ts  (LoS-filtered enemy list in buildDynamicContext)

Key variables:
  SuggestionChip.endPosition   — final tile after action
  SuggestionChip.actionTarget  — target tile for attacks/spells
```

---

## Phase E — Stealth & User-Relative Visibility
**Goal:** Sneak action, cover validation, hidden-actor scrubbing per-viewer.

### Tasks
- [x] Create `lib/stealth.ts`
  - `isCovered(pos: {x,y}, tiles: string[][]): boolean`
    — returns true if any adjacent (including diagonal) tile is `"W"` (adjacent to wall = total cover)
  - `rollStealthCheck(dexMod: number): number` — `1d20 + dexMod`
  - `breaksStealth(actionType: string): boolean` — true for `"strength"`, `"dexterity"` (attack), spell attack types
- [x] Modify `app/actions/take-turn.ts`:
  - On chip type `"stealth"` (Sneak action): call `isCovered` — reject if not in cover
  - If valid: `rollStealthCheck(dexMod)`, write `PartyMember.isHiding = true`, `PartyMember.stealthRoll = result`
    (or `Character.isHiding/stealthRoll` for solo — add these fields to Character in Phase A if needed)
  - On aggressive chip: if actor `isHiding`, set `isHiding = false` in transaction
  - After movement to `endPosition`: if new position not covered AND in LoS of any enemy, set `isHiding = false`
- [x] Modify `buildDynamicStatePrompt` in both prompt files:
  - **Player-facing:** scrub enemies with `isHiding = true` from enemy list (remove entirely from state)
  - **Enemy-facing (NPC batch prompt):** scrub `PartyMember` entries with `isHiding = true` from party list;
    replace their position with `[UNKNOWN]` so NPC AI cannot target hidden players

### State Snapshot — end of Phase E
```
DB:
  PartyMember.isHiding = true/false
  PartyMember.stealthRoll = integer (last stealth check result)
  Enemy.isHiding = true/false
  Enemy.stealthRoll = integer

Files edited:
  lib/stealth.ts  (new)
  app/actions/take-turn.ts  (sneak validation, stealth break on aggression/movement)
  app/actions/auto-advance.ts  (hidden-actor scrubbing in buildDynamicContext)
  app/actions/process-npc-turns.ts  (enemy-facing scrubbing in NPC batch prompt)

Key variables:
  PartyMember.isHiding  — controls UI scrub + AI context masking
  PartyMember.stealthRoll  — compared against enemy Passive Perception (10 + WIS mod)
```

---

## Phase F — AI Prompt Grounding (Combat Context)
**Goal:** Rewrite prompts to be session-aware, round-aware, actor-role-aware.

### Tasks
- [x] Modify `buildStaticPrompt` in `take-turn.ts` and `buildStaticContext` in `auto-advance.ts`:
  - Accept optional `combatSession: CombatSession | null` parameter
  - When in combat, prepend:
    ```
    IN COMBAT — Round {N}
    Initiative order (do not alter): {name1} → {name2} → ... (active: {name})
    Active actor role: PLAYER | NPC
    STRICT RULE: initiativeOrder is set at combat start and NEVER changes. You cannot add, remove,
    or reorder actors. You cannot invent enemies not listed in CURRENT STATE.
    ```
  - Narrow chip rules: forbid movement chips when `remainingMovementFeet = 0`; forbid mainAction
    chips when `remainingActions = 0`
- [x] Modify `buildDynamicStatePrompt` / `buildDynamicContext`:
  - Source enemy HP + position from DB (via `CombatSession` actor IDs) not from `gameState.enemies` JSON
  - Add grounding rule: `NARRATIVE GROUNDING: Only reference entities and objects with explicit
    coordinates in CURRENT STATE above. Do not invent assets, obstacles, or enemies not listed.`
- [x] Create NPC-specific prompt builder in `process-npc-turns.ts`:
  - Per-NPC context block: `{name}[HP:{n}/{max},Pos:{x},{y},Speed:{n}ft,Actions:1,Reaction:{bool}]`
  - Known visible targets only (LoS-filtered, hidden players masked)

### State Snapshot — end of Phase F
```
DB: no changes

Files edited:
  app/actions/take-turn.ts  (buildStaticPrompt, buildDynamicStatePrompt — combat context)
  app/actions/auto-advance.ts  (buildStaticContext, buildDynamicContext — combat context)
  app/actions/process-npc-turns.ts  (NPC-specific prompt builder)

Key variables:
  System prompt now contains: round number, initiative order (names only), active actor, grounding rule
  NPC batch prompt: per-actor context blocks, LoS-filtered target list
```

---

## Phase G — UI Updates
**Goal:** "In Combat" card, initiative tracker, End Turn pin, chip exhaustion, tab sync.

### Tasks
- [x] Modify `app/actions/get-game.ts`: include `combatSession` in game query
- [x] Add `combatSession: CombatSession | null` to `GameFull` interface in `page.tsx`
- [x] Add `InCombatCard` component:
  - Renders only when `combatSession !== null`
  - Displays initiative order as a horizontal scroll of avatar chips (class emoji + name)
  - Active turn slot highlighted; dead slots greyed + strikethrough; surprised slots show lock icon
  - Hides all initiative roll numbers
- [x] Modify `FieldTab` chip column:
  - During combat (`combatSession !== null`): pin "End Turn" button at bottom always
  - When `remainingActions = 0 && remainingBonusActions = 0 && remainingMovementFeet = 0`:
    hide all chips, show only the pinned "End Turn" button
- [x] On `handleAdvanceComplete`: if `npcNarrative` is present, append it as a second DM message
  in `localMessages` and apply `npcCombatEffects` to `localHpOverrides`
- [x] When `combatSession` becomes `null` after a refresh (combat ended): remove `InCombatCard`,
  restore normal chip column (no pinned End Turn)

### State Snapshot — end of Phase G
```
DB: no changes

Files edited:
  app/actions/get-game.ts  (include combatSession relation)
  app/game/[id]/page.tsx  (InCombatCard, End Turn pin, chip exhaustion, npcNarrative handling)

Key variables:
  GameFull.combatSession: { initiativeOrder, currentTurnIndex, currentRoundNumber } | null
  localMessages receives npcNarrative as second DM entry after player turn
```

---

## Resume Protocol
If the session resets, re-read this file then run:
```bash
git log --oneline -10
npx prisma db pull
grep -rn "CombatSession" prisma/schema.prisma app/
```
Continue from the first unchecked task in the earliest incomplete phase.
