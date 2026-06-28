# Leveling Mechanics — Phases 0–4: Foundation

> **Design reference:** `PLAN-leveling-mechanics.md`
> **Next file:** `PLAN-leveling-phases-5-8.md` (UI layer — ViewState, XP bars, pending choice, ASI)
>
> These phases establish the data and engine foundation. No UI. Every subsequent phase
> depends on this group being complete and green.

---

## Design Context

### XP Sources

**Combat XP:** `awardCombatXp` sums the `xpValue` field directly from each dead enemy (`PoiTemplate.xpValue`). No HP-tier fallback. Every enrolled character receives the full amount independently — XP is never split across the party.

| Source | Amount | Trigger |
|---|---|---|
| Enemy kill | `enemy.xpValue` (explicit, no HP-tier) | `deadEnemyPoiIds` path in mutation engine |
| Act 1 → 2 (Sunken Cellar) | 600 XP | `checkAndAdvanceAct` in `act-progression.ts` |
| Act 2 → 3 (Sunken Cellar) | 2,400 XP | `checkAndAdvanceAct` in `act-progression.ts` |
| Act 3 → complete | 0 XP | Completion bonus is next-campaign scoped |

**Not awarded:** room discovery, trap interaction, skill checks, dialogue choices, reviving downed characters, examining objects. XP flows only through kills and act milestones.

---

### Level-Up Effects — Automatic

When `applyXpAward` detects a level threshold crossed, it executes a single DB transaction:

1. `character.level = computeLevel(newXp)`
2. `character.maxHp = maxHpAtLevel(class, constitution, newLevel)`
3. `character.currentHp = newMaxHp` — **exception:** if `currentHp === 0` (downed), leave at 0
4. Append `ClassProgression.featuresUnlocked[newLevel]` to `character.featuresUnlocked`
5. If new level is an ASI or subclass level: push `{ type, level }` onto `pendingChoicesQueue[]`

   The level loop must iterate in ascending order — the queue is meaningless if entries are out of level order. Add an explicit sort before the loop as a load-bearing invariant.
6. For each newly unlocked `RESOURCE_POOL` feature: create `CharacterResourceState` with `current = maxByLevel[newLevel]` (fill sparse `maxByLevel` gaps downward)

Multi-level jumps (XP award crosses two thresholds at once) repeat steps 1–6 for each intermediate level in order. All intermediate `level_up` MessageLog entries are written in ascending level order in the same transaction.

---

## Status

| Phase | Name | Status |
|---|---|---|
| 0 | Dev Testing Dungeon Seed | ✅ DONE |
| 1 | XP Math Foundation | ✅ DONE |
| 2 | Character Schema Extension | ✅ DONE |
| 3 | Combat XP Engine | ✅ DONE |
| 4 | Milestone XP + Situation Summary | ✅ DONE |

---

## Phase 0 — Dev Testing Dungeon Seed `✅ DONE`

**Completed 2026-06-20.** Seed ran clean (`npm run db:seed`). Proving Grounds dungeon fully seeded with 4 rooms, 5 enemy types, story flags. DUNGEON_ACTS milestoneXp bug fixed (was shifted one act: values now 600/2400/0 on acts 1/2/3 respectively).

**Scope:** Seed "The Proving Grounds" — a standalone 4-room dungeon for rapid leveling
and ability testing. No schema change needed; uses existing `DungeonTemplate` +
`RoomTemplate` + `PoiTemplate` tables. Enemy NPCs include `xpValue` for consumption by
Phase 3's `awardCombatXp`.

**Why Phase 0:** The seed is self-contained and runnable immediately. Every subsequent
phase benefits from having a fast-XP environment to test against.

**Room layout:**

```
[Arena Floor (0,-1)]  ← hard: 2×CR1 Veteran + CR2 Boss, 850 XP
        |N
[Quartermaster's Hub (0,0)]  ← safe room (canLongRest, Phase 12)
        |S                   \E
[Proving Ring (0,1)]       [Skirmish Pit (1,0)]  ← easy: 3×CR1/4, 150 XP
3×CR1/2 Guard + 1×CR1/2 Scout (ranged) = 400 XP
```

**XP per full clear:** 150 (Skirmish Pit) + 400 (Proving Ring) + 850 (Arena Floor) = **1,400 XP**
→ L5 (6,500 XP) reachable in ~5 full clears solo; faster with multiple players.

**Enemy types across the dungeon:**

| Enemy | CR | xpValue | HP | AC | Key trait |
|---|---|---|---|---|---|
| Straw Sentinel ×3 | 1/4 | 50 | 14 | 11 | melee, INT=3 |
| Militia Guard ×3 | 1/2 | 100 | 18 | 12 | melee, INT=8 |
| Crossbow Scout ×1 | 1/2 | 100 | 18 | 12 | **ranged**, INT=8 |
| Arena Veteran ×2 | 1 | 200 | 28 | 13 | melee, **INT=10** |
| Proving Master ×1 | 2 | 450 | 60 | 14 | boss, INT=12, `battle_surge` |

**Seeding guidance compliance** (full rules and validation checklist: `prisma/seeding-guidance.md`):
- ≥3 distinct enemy types ✓ (5 types)
- ≥1 enemy INT ≥ 10 ✓ (Arena Veteran, Proving Master)
- ≥1 ranged attack ✓ (Crossbow Scout)
- Boss HP ≥ 2× act standard (Militia Guard HP=18 → boss needs ≥36; boss at 60 ✓)
- Boss has `lootTable` ✓ (Champion's Token)
- ≥1 safe room reachable before Act 2 ✓ (Quartermaster's Hub, Act 2 = Arena Floor)
- Story flags: `sentinels_cleared`, `proving_ring_cleared`, `proving_master_defeated`
- At least 1 missable flag ✓ (`proving_master_defeated` — requires entering Arena Floor)
- All enemies have explicit `xpValue` matching CR table (§3 — HP-tier fallback removed)
- Every room satisfies POI coverage: ≥1 exit, 1 open_space, ≥3 other POIs, ≥2 examine_details, ≥3 perception_details (§5)
- Any destructible obstacle has `maxHp`, `armorClass`, `damageThreshold`, `eligibleInteractions`, `effectiveTools` (§5)
- Weapon items have `weapon_type`, `damage_dice`; throwable damage items have `throw_damage_type` (§6)

**Note on act definitions:** The Proving Grounds uses the same `storyFlags.current_act`
tracking as the Sunken Cellar. A `PROVING_GROUNDS_ACTS` constant (parallel to `DUNGEON_ACTS`)
must be added to `lib/v2/act-definitions.ts` in Phase 4. Until then, milestone XP testing
uses the Sunken Cellar; the Proving Grounds is used for combat XP and ability testing only.

**Files:**
- `prisma/seed.mjs` (add items + dungeon template + 4 rooms + POIs)

**Test suite** (manual smoke test — no automated test needed for seed data):
- [ ] `npm run seed` completes without error
- [ ] `/setup` page shows both "The Sunken Cellar" and "The Proving Grounds" as choices
- [ ] Creating a session in The Proving Grounds places the player in Quartermaster's Hub
- [ ] Entering Skirmish Pit triggers combat with 3 Straw Sentinels
- [ ] Entering Proving Ring triggers combat with 4 enemies (3 Guards + 1 Scout)
- [ ] Entering Arena Floor triggers combat with 3 enemies (2 Veterans + Proving Master)

**Game-works checklist:**
- [ ] Seed runs idempotently (re-runnable without error)
- [ ] All rooms navigable from Hub
- [ ] Combat triggers on entry for all combat rooms (alert NPCs)
- [ ] Sunken Cellar session still works after seed update

---

## Phase 1 — XP Math Foundation `✅ DONE`

**What's done:** `lib/leveling.ts` (all 13 classes, `maxHpAtLevel` for all levels,
`proficiencyBonus`); `lib/leveling.test.ts` (comprehensive — L1–5 grid for 4 classes ×
3 CON mods); `lib/xp.ts` (`XP_THRESHOLDS` L1–20 full table, `computeLevel` capped at 20,
`xpForNextLevel` returns `null` at L20).

**Implementation notes (2026-06-20):**
- `XP_THRESHOLDS` extended from 5 entries to 20 entries (L1–20 per 5e PHB)
- `computeLevel` now guards `xp < 0 → 1` and clamps with `Math.min(level, 20)`
- `xpForNextLevel` unchanged logic — at L20, `level >= XP_THRESHOLDS.length` returns null correctly

**What remains:**
- `lib/xp.test.ts` — new test file not yet written (listed in phase spec)

**Files:** `lib/xp.ts` (edit only — no DB, no migration)

**Test suite** (`lib/xp.test.ts` — new file):

*Regression:* all existing `computeLevel` and `xpForNextLevel` assertions for L1–5 pass.

*Happy path:*
- `computeLevel(0) === 1`, `computeLevel(300) === 2`, `computeLevel(355000) === 20`
- `xpForNextLevel(1) === 300`, `xpForNextLevel(19) === 305000`
- `xpForNextLevel(20) === null` (at cap)

*Unhappy path:*
- `computeLevel(-1) === 1` (negative XP floors to L1)
- `computeLevel(999999) === 20` (XP beyond cap still returns L20, not > 20)

*Edge cases (exact threshold boundaries):*
- Every threshold ±1: `computeLevel(XP_THRESHOLDS[i] - 1) === i`, `computeLevel(XP_THRESHOLDS[i]) === i + 1`
- All 20 boundary pairs verified

**Game-works checklist:**
- [ ] All existing `lib/leveling.test.ts` tests still pass
- [ ] New `lib/xp.test.ts` tests pass
- [ ] No DB change, no build step needed

---

## Phase 2 — Character Schema Extension `✅ DONE`

**Implementation notes (2026-06-20):**
- Migration `20260620030917_leveling_foundation` applied to dev DB
- `prisma/schema.prisma`: `Character` gains `featuresUnlocked String[]`, `subclass String?`,
  `critThreshold Int @default(20)`, `pendingChoicesQueue Json[]`, `lastLongRest DateTime?`,
  and `resourceStates CharacterResourceState[]` relation
- `types/v2-game.ts`: added `PendingLevelUpChoice`, `NextFeature`, extended `PartyMemberInfo`
  with `xp/xpToNextLevel/nextFeature`, extended `CharacterStats` with
  `xp/pendingChoicesQueue/subclass/critThreshold/featuresUnlocked`
- `types/v2-game.ts`: added `MechanicalSummaryType` union covering `xp_gained`, `level_up`,
  `level_up_confirmed`; `NarrativeLog.mechanicalSummary` now typed as `MechanicalSummaryType | null`

> NOTE: Phase 9A's schema work (FeatureType/FeatureActionType/RestType enums, FeatureResourcePool,
> CharacterResourceState, Subclass tables, ClassFeature new columns) was batched into this same
> migration. See phase 9A notes in phases-9-12.md.

**What remains:**
- `lib/v2/__tests__/regression-baseline.test.ts` assertions not yet written (listed in phase spec)

---

## Phase 2 — Character Schema Extension (original spec)

**Scope:** Additive migration only. No logic change. Adds the fields the XP engine needs
to read/write on `Character`. Safe to deploy before the engine that uses them.

**Migration adds to `Character`:**
```prisma
featuresUnlocked   String[]  @default([])
subclass           String?
critThreshold      Int       @default(20)
pendingChoicesQueue  Json[]    @default([])
```

**Files:**
- `prisma/schema.prisma` (add fields)
- `prisma/migrations/` (generated)
- `types/v2-game.ts` (add `pendingChoicesQueue`, `critThreshold`, `subclass` to `CharacterStats`)

**Test suite** (add assertions to `lib/v2/__tests__/regression-baseline.test.ts`):

*Regression:* existing character create/read/update flows work after migration.

*Happy path:*
- `Character.create({ ... })` with no new fields → all defaults applied correctly
- `featuresUnlocked` default is `[]`, `critThreshold` default is `20`
- `pendingChoicesQueue` default is `[]`

*Edge cases:*
- `featuresUnlocked: ['feat-id-1', 'feat-id-2']` round-trips correctly
- `pendingChoicesQueue: [{ type: 'asi', level: 4 }]` round-trips correctly
- `pendingChoicesQueue: [{ type: 'subclass', level: 3 }, { type: 'asi', level: 4 }]` (multi-pending) round-trips correctly

**Game-works checklist:**
- [ ] Migration runs without error on dev DB
- [ ] `npx prisma generate` completes
- [ ] All existing tests still pass

---

## Phase 3 — Combat XP Engine `✅ DONE`

**Completed 2026-06-20.** `lib/v2/__tests__/xp-engine.test.ts` written (28 tests, all passing). TypeScript clean. Known gap: Sunken Cellar enemies have no `xp_value` — milestone XP only for that dungeon; Proving Grounds is the combat XP test bed.

**Implementation notes (2026-06-20):**
- `lib/v2/xp-helpers.ts` created (new file): `awardCombatXp`, `applyXpAward`, internal
  `applyLevelEffects`. ASI levels hardcoded per class; subclass level per class. `maxByLevel`
  sparse-fill helper included.
- `lib/v2/game-controller.ts`: imports `awardCombatXp`/`applyXpAward`; after the dead-enemy loop,
  reads `defaultProperties.xp_value` from each dead POI template, sums via `awardCombatXp`,
  awards to all `type==='character'` entries in `initiativeOrder` via `applyXpAward`.
- `types/v2-game.ts`: `xp_gained` and `level_up` added to `MechanicalSummaryType` union.

**Type errors remaining (blockers before this phase is ✅ DONE):**
- `view-state.ts` line 339: `characterStats` object missing `xp/pendingChoicesQueue/subclass/critThreshold/featuresUnlocked` — charRow select updated but assembleViewState object literal not yet patched
- `PartyTab.tsx` line 9: test mock `CharacterStats` missing new fields
- Several test files with stale `CharacterStats` mocks

**What remains:**
- Fix all TypeScript errors listed above
- `lib/v2/__tests__/xp-engine.test.ts` — new test file not yet written
- Verify dead Sunken Cellar enemies have `xp_value` in `defaultProperties` (currently 0 — no XP until Phase 0 seed adds explicit values)

## Phase 3 — Combat XP Engine (original spec)

**Scope:** Enemies award XP on death; characters auto-level with HP updates. First version
where the level-up is observable in the game narrative.

> **Dependency note:** `applyXpAward` queries `ClassProgression` to append feature IDs at
> level-up. `ClassProgression` rows are not seeded until Phase 9B. To keep Phase 3 tests
> honest, seed a **minimal Fighter ClassProgression stub** (L1–5 only, feature IDs can be
> placeholder strings) as part of this phase's test setup. In production, level-ups between
> Phase 3 and Phase 9B will correctly update XP and HP but `featuresUnlocked` will not
> grow — document this in the game-works checklist and treat it as expected until 9B.

**New logic:**
- `lib/v2/xp-helpers.ts` (new file):
  - `awardCombatXp(deadEnemies: { xpValue: number }[]): number` — sums explicit `xpValue`
    fields. Returns 0 for empty arrays or enemies with `xpValue === 0`. No HP-tier fallback.
  - `applyXpAward(tx, character, xpAmount, sourceText): Promise<ApplyXpResult>` — awards XP,
    levels up if threshold crossed, updates HP, pushes to `pendingChoicesQueue[]`, appends
    `featuresUnlocked` from `ClassProgression`, **creates `CharacterResourceState` rows for
    any newly unlocked `RESOURCE_POOL` features** (see step 6 below).
- `lib/v2/mutation-engine.ts`: call `awardCombatXp` + `applyXpAward` per enrolled character
  in `deadEnemyPoiIds` path
- Write `xp_gained` and `level_up` `MessageLog` entries in the same transaction

**Level-up effects inside `applyXpAward`:**
1. `character.level = computeLevel(newXp)`
2. `character.maxHp = maxHpAtLevel(class, constitution, newLevel)`
3. `character.currentHp = newMaxHp` — except if `currentHp === 0` (downed), leave at 0
4. Append `ClassProgression.featuresUnlocked` for the new level to `character.featuresUnlocked`
5. If new level is an ASI or subclass level: push `{ type, level }` onto `pendingChoicesQueue[]`

   The level loop must iterate in ascending order — the queue is meaningless if entries are out of level order. Add an explicit sort before the loop as a load-bearing invariant.
6. **For each newly appended feature ID: query `ClassFeature`. If `featureType === RESOURCE_POOL`,
   create a `CharacterResourceState` row with `current = max at this character level` (read from
   `FeatureResourcePool.maxByLevel`, filling sparse gaps downward).** This ensures resource
   counters exist from the moment a feature is unlocked, even if Phase 12's rest endpoint hasn't
   shipped yet.

**Files:**
- `lib/v2/xp-helpers.ts` (new)
- `lib/v2/mutation-engine.ts` (edit)
- `types/v2-game.ts` (add `xp_gained`, `level_up` to `MessageLog` mechanicalSummary types)

**Test suite** (`lib/v2/__tests__/xp-engine.test.ts` — new file):

*Regression:* existing combat tests pass; `mutation-engine-locks.test.ts` still passes.

*Happy path — `awardCombatXp` (reads xpValue directly — no HP-tier logic):*
- Single enemy `{ xpValue: 50 }` → `50 XP`
- Single enemy `{ xpValue: 200 }` → `200 XP`
- Three enemies `[{ xpValue: 50 }, { xpValue: 100 }, { xpValue: 200 }]` → `350 XP`
- Enemy with `xpValue: 0` → `0 XP` (no MessageLog entry written)
- Empty array `[]` → `0 XP`

*Happy path — `applyXpAward`:*
- `xp=200`, award `50` → no level-up, `xp=250`
- `xp=250`, award `100` → level-up to L2, HP updated, `pendingChoicesQueue` empty (L2 is not an ASI/subclass level)
- `xp=354900`, award `200` → reaches L20 exactly, `xp=355000`, `pendingChoicesQueue` empty (no ASI/subclass at L20)

*Happy path — `applyXpAward` with ClassProgression stub (requires minimal Fighter seed):*
- Fighter `xp=0`, award `900` → L3 reached, `pendingChoicesQueue=[{type:'subclass',level:3}]`
- `xp=0`, award `2700` → jumps to L4; L2/L3/L4 features appended; `pendingChoicesQueue=[{type:'subclass',level:3},{type:'asi',level:4}]` (both queued, ordered by level)
- RESOURCE_POOL feature unlocked at level-up → `CharacterResourceState` row created at `current=max`

*Unhappy path:*
- Award XP to character at L20 → `xp` stays at 355000 (or accumulates safely), no level-up fired

*Edge cases:*
- Downed character (`currentHp=0`) gets XP + level-up → `maxHp` updated, `currentHp` stays `0`
- Multi-level jump: all intermediate level features appended, level-up MessageLog cards written in order
- Multi-level jump: `pendingChoicesQueue` sorted ascending by level (e.g., L3 subclass before L4 ASI — assert `queue[0].level < queue[1].level` when jump crosses two choice levels)
- Award `0 XP` → no-op, no MessageLog entry written
- Exact threshold: `xp=299`, award `1` → reaches L2 exactly

**Game-works checklist:**
- [ ] Killing an enemy adds XP pill to narrative feed
- [ ] Level-up card appears when threshold is crossed
- [ ] HP bar shows new max on next poll
- [ ] Downed character does not revive on level-up
- [ ] Characters cannot level above 20
- [ ] `featuresUnlocked` remains empty on level-up (expected — ClassProgression not seeded until Phase 9B)
- [ ] `CharacterResourceState` row created when a RESOURCE_POOL feature is unlocked at level-up

---

## Phase 4 — Milestone XP + Situation Summary `✅ DONE`

**Completed 2026-06-20.** `levelUpThisFight` added to `lib/v2/situation-summary.ts`. `lib/v2/__tests__/milestone-xp.test.ts` written (13 tests, all passing). DUNGEON_ACTS milestoneXp values corrected.

**Implementation notes (2026-06-20):**
- `lib/v2/act-definitions.ts`: `ActDefinition` extended to `ActDefinitionWithXp` (adds optional
  `milestoneXp: number`). `DUNGEON_ACTS` entries annotated: Act 1→2 = 600 XP, Act 2→3 = 2,400 XP,
  Act 3→complete = 0 XP. `PROVING_GROUNDS_ACTS` constant added (3 acts, milestoneXp 0/300/0).
- `lib/v2/act-progression.ts`: imports `applyXpAward`; after act-complete transaction, queries all
  `RoomParticipant` rows for the session (distinct by characterId) and calls `applyXpAward` for
  each with the act's `milestoneXp`.

**Type errors remaining:**
- `act-progression.ts` line 57: `pendingChoicesQueue` in select — should resolve after Prisma
  generate (already run; check if lingering cache issue)
- `act-progression.ts` line 84: `member.character` property reference — query uses `include:
  { character: { select: ... } }` but the Prisma return shape may differ; needs verification

**What remains:**
- Fix type errors in act-progression.ts
- `levelUpThisFight` field in `situation-summary.ts` — not yet implemented (Phase 4 spec item)
- `lib/v2/__tests__/milestone-xp.test.ts` — new test file not yet written

## Phase 4 — Milestone XP + Situation Summary (original spec)

**Scope:** Act transitions grant XP to the whole party. AI narration gets `levelUpThisFight`
context so it can name characters near a level-up.

**New logic:**
- `lib/v2/act-progression.ts`: in `checkAndAdvanceAct`, after writing the act-complete
  `MessageLog` entry, call `applyXpAward` for every `PartyMember` in the session with the
  milestone XP amount for The Sunken Cellar:
  - Act 1 → 2: **600 XP**
  - Act 2 → 3: **2,400 XP**
  - Act 3 → complete: **0 XP** (completion bonus carries to next campaign, not this one)
- Add `PROVING_GROUNDS_ACTS` constant to `lib/v2/act-definitions.ts` (parallel to `DUNGEON_ACTS`)
  so The Proving Grounds can trigger its own act transitions for milestone XP testing.
- `lib/v2/situation-summary.ts`: compute `levelUpThisFight: string[]` — names of enrolled
  characters where `character.xp + combatXpPool >= xpForNextLevel(character.level)`

**Files:**
- `lib/v2/act-progression.ts` (edit)
- `lib/v2/act-definitions.ts` (edit — add `PROVING_GROUNDS_ACTS`)
- `lib/v2/situation-summary.ts` (edit)

**Test suite** (`lib/v2/__tests__/milestone-xp.test.ts` — new file):

*Regression:* existing `act-definitions.test.ts` passes; act progression logic unchanged.

*Happy path:*
- Act 1→2 transition: every PartyMember gets **600 XP** via `applyXpAward`
- Act 2→3 transition: every PartyMember gets **2,400 XP**
- Act 3→complete: milestone XP = **0** (no award; completion bonus is next-campaign scoped)
- PartyMember who is offline (not in room) still gets XP

*Unhappy path:*
- Party member already at L5 cap: XP award is a no-op (no level-up event, XP does not overflow past cap)

*Edge cases — `levelUpThisFight`:*
- Zero enemies in initiative order → `levelUpThisFight = []`
- Character's `xp + combatXpPool < xpForNextLevel` → not in list
- Character's `xp + combatXpPool >= xpForNextLevel` → included in list
- Multiple characters near level-up → all included
- Character at L20 cap → never in list

**Game-works checklist:**
- [ ] Act transition grants XP to every party member (600 on Act 1→2, 2,400 on Act 2→3)
- [ ] Level-up fires if act XP pushes character over threshold
- [ ] AI prompt includes character names when `levelUpThisFight` non-empty
- [ ] Offline party members do not miss milestone XP
- [ ] The Proving Grounds act transitions work independently from Sunken Cellar

---

## Handoff → `PLAN-leveling-phases-5-8.md`

**Entry criteria before starting Phase 5:**

- [ ] Phase 3 green: enemies award XP, level-ups fire correctly, HP updates, `CharacterResourceState` rows created on RESOURCE_POOL unlock
- [ ] Phase 4 green: milestone XP fires at 600/2,400/0 for Sunken Cellar; `levelUpThisFight` feeds into AI prompt
- [ ] All regression tests passing (mutation-engine-locks, act-definitions, regression-baseline)
- [ ] Confirmed: `featuresUnlocked` is intentionally empty until Phase 9B; no production bug, expected gap

**Phase 9C parallelization:** Phase 9C (content authoring for 12 remaining classes) can start as soon as Phase 9A deploys and Phase 9B establishes the template. It does **not** block Phases 5–8, 10A, 10B, or 11. Run it as a parallel content track. Phases 10B and 10C expand class-by-class as 9C completes — they do not need 9C fully done to ship.

**Phase 9B backfill obligation:** Characters that level up between Phase 3 and Phase 9B will have placeholder or missing feature IDs (ClassProgression rows don't exist yet). Phase 9B's definition of done must include a backfill migration: for every Character whose `featuresUnlocked` contains IDs that do not exist in `ClassFeature` (catches both empty arrays and arrays containing Phase 3 placeholder stub strings), replace the entire array with correct IDs from `ClassProgression` for their class and level, and create any missing `CharacterResourceState` rows. Without this, characters active in the Phase 3–9B window will have no features after Phase 11 ships.

**What Phase 5 picks up:** ViewState needs to expose `xp`, `xpToNextLevel`, `nextFeature`, and
`pendingChoicesQueue` before any UI work can begin. Phase 5 is the read-path prerequisite for
Phases 6–8.
