# Suggestion Chip Refactor — Plan & Concerns

> Cross-reference of `app/suggestion-chip-refactor.md` against the live codebase.
> Written before any work begins. Discuss phasing before touching code.

## Decisions Confirmed

| Question | Decision |
|---|---|
| Chip `type` field | **Keep as required.** Add `"none"` as a valid `ChipType` value — chips with `type: "none"` suppress the attribute modifier badge. All other values display it. |
| Item model migration | **Do it in Phase E** as planned. |
| Shared party inventory | **Move to relational table** in Phase D — design as part of that phase. |
| `PendingRoll` vs `activeTurnQueue` | **Run both in parallel** until new design is validated, then deprecate `PendingRoll`. |
| `activeTurnQueue` storage | **Dedicated DB table** (cleaner cascade deletes, row-level locking). |
| Auto-Advance DB timing | **DB commit fires immediately** when the roll queue completes. The 1.5s delay is client-only (anticipation/animation). No data loss window. |
| In-flight games during Phase D cutover | **Graceful degradation**: old games continue reading from `game.state` JSON; new games dual-write to both JSON and dedicated columns until cutover is complete. |
| `EquippableItem` + `Item` collapse (Phase E) | **Option B — collapse into one model.** Single `Item` table with nullable `characterId` (equipped) + nullable `mapId` (map loot). Picking up loot sets `characterId`; dropping clears it. Requires data migration of all existing `EquippableItem` and `Item` rows. |

---

## What the Spec Is Asking For

The spec migrates the current single-LLM-call turn model into a **queued, player-initiated roll loop**:

1. Player taps a chip → server initializes a roll queue row (`activeTurnQueue`)
2. Player taps "roll" → server seeds each d20 securely, crit interceptor modifies subsequent damage dice
3. When all rolls in the queue are resolved → narrative is generated, new chips computed, DB committed in one transaction (the "Auto-Advance" step)
4. Bottom-sheet drawer animates through the roll sequence, then slides away

On top of that, it decouples the monolithic `game.state` JSON into five dedicated pillars (worldState, currentScenario, narrativeHistory, activeTurnQueue, activeSuggestionChips) and normalizes Character/Item data.

---

## Cross-Reference: What Already Exists vs. What's Missing

### Schema (prisma/schema.prisma)

| Spec Field | Current Status | Gap |
|---|---|---|
| `Character.activeConditions String[]` | **Missing** | New column needed |
| `Character.remainingReactions Int` | **Missing** | New column needed |
| `Character.hasCastedBonusSpell Boolean` | **Missing** | New column needed |
| `Character.remainingActions/BonusActions/MovementFeet` | ✅ Already present | — |
| `Character.backpack String[]` | ✅ Already present | — |
| `Character.mainHand/offHand/armor/ring` FK slots | ✅ Already present | — |
| `Item.diceFormula String?` | **Missing** | Current Item uses `statBonuses Json` + `slotType enum` |
| `Item.statModifierBonus Int` | **Missing** | See Item conflict below |
| `Item.combatImpactLabel String` | **Missing** | Already on `EquippableItem`, not `Item` |
| `Item.type String` (replacing `slotType enum`) | **Incompatible** | See Item conflict below |
| `PartyMember.posX/posY Int` | **Missing** | Currently stored in `game.state.partyPositions` JSON |
| `activeTurnQueue` table | **Missing entirely** | Partial overlap with existing `PendingRoll` |
| `Game.worldState Json` | **Missing** | Currently baked into `game.state` JSON blob |
| `Game.currentScenario String` | **Missing** | Currently the last DM message content |
| `Game.narrativeHistory String[]` | **Missing** | Currently `game.state.narrative_history` |
| `Game.activeSuggestionChips Json` | **Missing** | Currently `game.state.active_suggestion_chips` |

### The Item Model Conflict — Blocker-Level Concern

The current `Item` model:
```prisma
model Item {
  id          String   @id
  name        String
  slotType    SlotType  // enum: WEAPON | ARMOR | SHIELD | FOCUS | RING
  statBonuses Json      // { "strength": 2 } or { "strength": { type: "override", value: 19 } }
  ...
}
```

The spec's `Item` model:
```prisma
model Item {
  id                 String
  name               String
  type               String      // plain string, no enum
  diceFormula        String?
  statModifierBonus  Int
  combatImpactLabel  String
  ...
}
```

These are fundamentally incompatible. Migrating requires:
- Dropping the `SlotType` enum
- Dropping the `statBonuses Json` column (losing the override/additive distinction)
- Adding three new typed columns
- Data migration for all existing `Item` rows

The existing `EquippableItem` model already has `combatImpactLabel` — the spec appears to want to collapse these two models. That is also a breaking change.

**Recommendation**: Leave `Item` migration to its own dedicated schema phase. Do not touch `Item` until everything else is wired.

### The activeTurnQueue vs. PendingRoll Overlap

Existing `PendingRoll`:
- Stores one `d20 Int` per request, with a 5-minute TTL
- Written by `/api/rolls/secure-seed`, consumed by `completeTurn`

Spec `activeTurnQueue`:
- Stores an ordered array of rolls (`ATTACK`, `DAMAGE`, `SAVING_THROW`, `ABILITY_CHECK`)
- Manages `currentRollIndex`, crit mutation, status transitions, multi-resolve

These serve the same security goal but `activeTurnQueue` is a superset. The cleanest migration is:
- Add `activeTurnQueue` as a new table
- Deprecate `PendingRoll` after migration is complete (don't delete until the roll queue is fully wired)

### Current Chip Schema vs. Spec Chip Schema

| Field | Current `Chip` type | Spec `activeSuggestionChips` entry |
|---|---|---|
| Identifier | None (positional) | `id: UUID` |
| Display text | `text: string` | `label: string` |
| Skill type | `type: ChipType` (25 skills) | **Gone** |
| Resource cost | `resourceCost?: { type, value }` | `action_type: 'mainAction' \| 'bonusAction' \| 'movement'` |
| Roll required | Implied by all chips | `requiresRoll: boolean` |
| Advantage state | Not tracked | `advantageState: 'NONE' \| 'ADVANTAGE' \| 'DISADVANTAGE'` |
| Movement feet | Not tracked | `movementFeet: number` |
| Spell level | Not tracked | `spellLevel: number` |

The `type: ChipType` field (which maps to skill/ability and drives modifier calculation on the frontend) is **not present in the spec**. This is significant: the current frontend uses `chip.type` to look up `SKILL_MAP` and compute the modifier badge. If `type` goes away, the modifier/skill badge display needs a new source of truth.

**Recommendation**: Either keep `type` as an optional field on the new chip schema (for modifier display) or derive the modifier from `action_type` + a skill hint field. Needs a decision before the chip schema is locked.

### The worldState Extraction

The spec assigns `worldState` fields as: `activeObjective`, `plotFlags`, `consecutiveMisses`, `npcsEncountered`.

Fields currently in `game.state` that the spec does NOT assign to `worldState`:
- `playerPos` — spec moves this to `PartyMember.posX/posY`
- `hp`, `maxHp` — these should come from `Character.currentHp/maxHp`
- `inventory` — **shared party inventory**, not addressed by spec
- `equipped` — currently a string pair `{ weapon, armor }`, not relational FKs
- `partyPositions`, `partyHp`, `partyMaxHp` — party extensions in JSON

The spec is silent on shared party inventory. The current model stores it as a JSON string array in `game.state.inventory`. Moving HP/position to relational fields is clean; shared inventory has no clean relational home unless a `GameInventory` join table is added.

**Recommendation**: Flag this as an open design question. The `worldState` phase should explicitly decide whether shared inventory stays in JSON or gets its own table.

### The take-turn.ts Decomposition

Current `take-turn.ts` does everything in one server action:
1. Auth + game load
2. DC/modifier calculation
3. Optional server-seeded roll context (returns early for roll sheet)
4. First Claude call (narrative + chips + stateDeltas + encounterResult + skillName)
5. Optional second Claude call (skill check narration)
6. Combat effect parsing
7. XP award + level-up computation
8. $transaction: state update, message creation, HP writes, version bump
9. Returns `TurnResult` to client

The spec's equivalent is split across:
- `initializeTurnQueue` (chip tap → create queue row)
- `resolveRoll` (each tap → process one roll in index)
- `autoAdvance` (queue completed → Claude call → state commit → delete queue row)

The skill-check two-call architecture in `take-turn.ts` becomes the Auto-Advance step's single Claude call (with full roll context). The XP/level-up logic needs to survive the refactor.

The existing `completeTurn` server action (called from `useRollSheet`) currently calls the second narrative pass. That maps to part of the Auto-Advance step.

### RollSheet / useRollSheet

The current `RollSheet` handles a single roll (one tap → one d20 → narrative done). The spec's UX requires:
- Sequential roll loop (tap → animate → reveal → next roll card → tap again)
- Persistent outcome banner after each roll
- Cross-fade between roll cards
- Skip logic (attack miss → skip dependent damage roll)
- 1.5s pause after final roll before sliding out

`useRollSheet` would need to become stateful across multiple rolls, tracking the queue index. The timing contract (1.2s spin, 1.5s post-reveal, 320ms slide) can be preserved per roll but needs to loop.

---

## Concerns Flagged (Ordered by Severity)

### 🔴 Blockers / Decisions Needed Before Any Code

1. **Chip `type` field**: The spec drops `ChipType` (the 25-skill enum). The frontend currently uses it to compute modifier badges via `SKILL_MAP`. Do new chips carry a skill hint, or is modifier computation dropped in the new model?

2. **Shared party inventory**: Not addressed in the spec. Must decide before the `worldState` extraction phase: does it stay in `game.state` JSON or move to a relational table?

3. **Item model migration scope**: The current `Item` and spec's `Item` are incompatible. Changing `Item` will break `computeCharacterStats` and all equipment display code. This should be its own isolated phase with a clear data migration plan.

### 🟡 Design Questions That Affect Phasing

4. **`PendingRoll` deprecation timing**: `activeTurnQueue` replaces it functionally. We can run both in parallel during the transition. When does `PendingRoll` get deleted?

5. **`consecutiveMisses` field**: Currently read from `gameState` in `buildDynamicStatePrompt`. In the spec it lives in `worldState`. During migration, both paths need to be live simultaneously to avoid breaking turns in progress.

6. **`activeTurnQueue` storage**: The spec implies a dedicated DB table. Given that turns are short-lived (TTL < 5 minutes), this could alternatively be a `Json` column on `Game` to avoid a new migration. Trade-off: a column is simpler to add; a table enables row-level locking and cleaner cascade deletes.

7. **Auto-Advance timing (1.5s)**: The spec says the DB commit fires after a 1.5s UI delay. This means the client holds un-persisted results during that window. If the user navigates away or the tab crashes during those 1.5s, the turn outcome is lost. Is that acceptable?

### 🟢 Clean Additions (Low Risk)

8. `Character.activeConditions`, `remainingReactions`, `hasCastedBonusSpell` — additive-only columns, safe to add in one migration.

9. `Game.worldState`, `Game.currentScenario`, `Game.narrativeHistory`, `Game.activeSuggestionChips` — additive columns on `Game`. Existing code continues reading from `game.state` JSON until cutover.

10. `PartyMember.posX/posY` — additive, with default 0. Position can be dual-written (JSON + relational) during transition.

---

## Progress Tracker

Legend: `[ ]` not started · `[x]` done · `[~]` in progress

---

### Phase A — Schema Additions
*Additive-only. Zero breakage to existing code.*

- [x] A1. Add `Character.activeConditions String[] @default([])`
- [x] A2. Add `Character.remainingReactions Int @default(1)`
- [x] A3. Add `Character.hasCastedBonusSpell Boolean @default(false)`
- [x] A4. Add `Game.worldState Json?`
- [x] A5. Add `Game.currentScenario String?`
- [x] A6. Add `Game.narrativeHistory String[] @default([])`
- [x] A7. Add `Game.activeSuggestionChips Json?`
- [x] A8. Add `PartyMember.posX Int @default(0)` and `posY Int @default(0)`
- [x] A9. Add `activeTurnQueue` table (all fields per spec)
- [x] A10. Run `npx prisma migrate dev`, regenerate client
- [x] A11. Verify TypeScript compiles clean and all existing tests pass

**Testable after A:** `npm run build` green, `npm test` 218/218 pass, new columns visible in DB schema, no runtime errors on game page.

---

### Phase B — New Chip Schema & Roll Queue Engine
*Server-side only. Frontend unchanged — still reads `game.state` JSON.*

- [x] B1. Add `"none"` to `ChipType` union in `types/chips.ts`
- [x] B2. Define `SuggestionChip` type in `types/chips.ts` (id, label, type, requiresRoll, advantageState, action_type, movementFeet, spellLevel)
- [x] B3. Implement `app/actions/initialize-turn-queue.ts` — auth, validate chip, build roll array, insert `activeTurnQueue` row
- [x] B4. Implement `app/actions/resolve-roll.ts` — fetch queue row, seed d20, run crit interceptor (double damage dice formula on natural 20), mutate index item, increment `currentRollIndex`, flip status to `COMPLETED` if last roll
- [x] B5. Implement `app/actions/auto-advance.ts` — Claude call with full roll context, generate `SuggestionChip[]`, atomic $transaction (worldState update, narrativeHistory append, activeSuggestionChips overwrite, queue row delete, Character HP/conditions write, version bump)
- [x] B6. Dual-write: `autoAdvance` also writes `game.state.narrative_history` + `game.state.active_suggestion_chips` (keeps Phase C backward-compatible)
- [x] B7. Update `handle-player-action.ts` chip output to `SuggestionChip` shape
- [x] B8. Update DM prompt in `take-turn.ts` to request `SuggestionChip` fields from Claude
- [x] B9. Write unit tests for `initialize-turn-queue` (roll array shape, crit setup)
- [x] B10. Write unit tests for `resolve-roll` (crit interceptor doubles dice, status flip on last roll)
- [x] B11. Write unit tests for `auto-advance` (LLM called once, all DB fields written, queue row purged)

**Testable after B:** New server actions callable via test suite. `activeTurnQueue` rows visible in DB after manually triggering. Existing Field tab game flow unaffected (still reads old `game.state` path).

---

### Phase C — Bottom-Sheet UI Refactor
*Replaces `RollSheet` / `useRollSheet`. Cuts over chip tap → new queue flow.*

- [x] C1. Replace `useRollSheet.ts` with `useTurnQueue.ts` — stateful multi-roll loop (queue index, per-roll spin/reveal timing, skip logic for miss-dependent damage rolls, 1.5s client delay before slide-out after final roll)
- [x] C2. Build roll card component (modifier cards, DC card, advantage state indicator)
- [x] C3. Build outcome banner component (color-coded, persists above next roll card)
- [x] C4. Build roll history badges (rendered above narrative after all rolls resolve: `🎲 Attack: 18 vs AC 14 [HIT]`, `⚔️ Damage: 9`)
- [x] C5. Assemble new `TurnQueueSheet` drawer component using C1–C4
- [x] C6. Wire chip tap in `page.tsx` → `initializeTurnQueue` → open `TurnQueueSheet`
- [x] C7. Wire each roll tap → `resolveRoll`
- [x] C8. Wire queue `COMPLETED` → `autoAdvance` (immediate) → client 1.5s pause → drawer slide-out → `onDone`
- [x] C9. Update `consumeResource` call site to use `action_type` from `SuggestionChip` (not `resolveChipCost`)
- [x] C10. Remove fallback `displayChips = affordableChips.length > 0 ? affordableChips : chips` (show "No further actions" when empty)
- [x] C11. Delete `components/roll-sheet.tsx`, `hooks/useRollSheet.ts`
- [x] C12. Remove old `take-turn.ts` chip-tap code path from `page.tsx` (keep `completeTurn` until PendingRoll is retired)

**Testable after C:** Full roll flow playable end-to-end in browser. Tap chip → drawer opens → tap to roll → outcome banner → next roll or auto-advance → narrative updates → chips refresh. Modifier badges suppress correctly for `type: "none"` chips.

---

### Phase D — worldState Extraction
*Cuts prompt building and state writes over to dedicated columns.*

- [x] D1. Add `GameInventory` table (gameId FK, itemName String, quantity Int) for shared party loot
- [x] D2. Migrate `buildStaticPrompt` to read from relational `Character` + `PartyMember` rows (not `game.state`)
- [x] D3. Migrate `buildDynamicStatePrompt` to read from `Game.worldState` + `Character.currentHp` + `PartyMember.posX/posY` (not `game.state`)
- [x] D4. Implement token-compressed serializer: `You[LVL:1,HP:10/10,Pos:2,2,Weap:Crowbar,Cond:Poisoned]`
- [x] D5. Cut `autoAdvance` writes over to `Game.worldState`, `Game.currentScenario`, `Game.narrativeHistory`, `PartyMember.posX/posY`, `GameInventory`
- [x] D6. Update `useTurnActions` to hydrate from `Character.remaining*` columns (remove localStorage as source of truth; keep for optimistic UI only)
- [x] D7. Remove dual-write fallbacks for `game.state.narrative_history` and `game.state.active_suggestion_chips`
- [x] D8. Verify token counts visibly reduced (log before/after prompt lengths)

**Testable after D:** Game page loads correctly reading from new columns. Console shows compressed prompt format. Prompt token count measurably lower. `game.state` JSON no longer grows with narrative/chip data.

---

### Phase E — Item Model Collapse
*Merges `EquippableItem` + `Item` into one table. Most disruptive — do last.*

- [ ] E1. Design merged `Item` schema: `id, name, type String, diceFormula String?, statModifierBonus Int @default(0), combatImpactLabel String, characterId String? (FK), mapId String? (FK), slotKey String? ("mainHand"|"offHand"|"armor"|"ring"), category String, quantity Int @default(1), isEquipped Boolean @default(false), weightLbs Float @default(0)`
Design note: 

    The key Phase E design decisions to preserve, based on our conversation:

    statBonuses Json → two typed columns:
    - statKey String? — which ability gets the bonus ("strength" | "dexterity" | etc. | null)
    - statModifierBonus Int @default(0) — the flat bonus value
    - Reason: JSON is opaque in prompts and fragile to seed; two typed columns are token-efficient, impossible to malform, and DB-powered

      Equipment ownership: keep Character FKs
      - Character.mainHandId, offHandId, armorId, ringId stay as FKs → Item
      - Reason: single findUnique with include fetches character + all gear in one round trip; fastest read path

    Duplicate-equip validation: application-level in transaction
      - equip-item.ts checks prisma.character.findFirst({ where: { OR: [{ mainHandId }, { offHandId }, { armorId }, { ringId }] } }) before writing
      - No equippedByCharacterId denorm field — avoids two-field sync burden
    - Reason: D&D game doesn't have high contention; transaction-wrapped check is sufficient

      EquippableItem fields absorbed into Item:
      mapId, category, description, weightLbs, quantity, isEquipped, combatImpactLabel

      Dropped from Item: statBonuses Json, slotType SlotType (replaced by type String), SlotType enum

      EquippableItem model dropped entirely after data migration
- [x] E2. Data migration: EquippableItem rows → Item (mapId set, type derived from category+name heuristic); slotType enum → type String for existing rows
- [x] E3. Character FK fields unchanged — Character.mainHandId/offHandId/armorId/ringId still point to unified Item
- [x] E4. computeCharacterStats updated to read statKey + statModifierBonus (replaced statBonuses Json two-pass logic)
- [x] E5. get-map-items, update-item, equip-item, all seeds and backfill script updated to use Item; equip-item adds transaction-level duplicate-equip validation
- [x] E6. EquippableItem model and SlotType enum dropped from schema and DB
- [x] E7. Migration applied, Prisma client regenerated — build clean
- [x] E8. 251/251 tests pass; build clean; map items and character equipment verified in DB

**Testable after E:** Equipment bonuses show correctly. Map loot displays correctly. Picking up and equipping items works end-to-end. No `EquippableItem` or `SlotType` references remain in codebase.
