---
phase: 03-leveling
plan: "03"
subsystem: leveling
tags: [leveling, take-turn, transaction, multi-level-up, stateDeltas-allowlist, LVL-02, LVL-04, LVL-05]
dependency_graph:
  requires:
    - Plan 01 (lib/leveling.ts with maxHpAtLevel + proficiencyBonus re-export)
    - Plan 01 (Character.maxHp column in DB via Prisma migration)
    - Plan 02 (take-turn.ts $transaction with xp + level writes)
  provides:
    - take-turn.ts LevelUpResult interface and levelUpResult return field
    - take-turn.ts $transaction atomic maxHp write alongside xp + level
    - lib/leveling.test.ts multi-level-up path describe block (LVL-02 delta proofs)
  affects:
    - Plan 04 (UI) will consume levelUpResult from TurnResult to render level-up card
tech_stack:
  added: []
  patterns:
    - Atomic $transaction covering xp + level + maxHp in one write (D-04)
    - Pre-transaction snapshot pattern for oldMaxHp capture (Pitfall 2 avoidance)
    - D-11 single import source: proficiencyBonus imported from lib/leveling (not lib/dice directly)
    - Conditional undefined (not null/empty object) for absent levelUpResult field
key_files:
  created: []
  modified:
    - app/actions/take-turn.ts
    - lib/leveling.test.ts
decisions:
  - LVL-04 verified without code change: RULES_ENGINE_KEYS at line 299 already equals ["hp","maxHp","xp","level","proficiencyBonus"] — D-12 satisfied
  - newMaxHp computed inside transaction callback (const newMaxHp = didLevelUp ? maxHpAtLevel(...) : currentCharacter.maxHp) — no-op write on xp-only turns is acceptable per plan
  - levelUpResult uses proficiencyBonus(newLevel) from lib/leveling to satisfy D-11
  - oldMaxHp captured from currentCharacter.maxHp (pre-transaction value) per Pitfall 2 guidance
metrics:
  duration: "6 minutes"
  completed: "2026-05-22"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 3 Plan 3: Atomic maxHp Write + LevelUpResult Shape Summary

**One-liner:** Extended take-turn $transaction to atomically write maxHp alongside xp/level on level-up, returning a structured LevelUpResult payload for Plan 04 UI; verified LVL-04 allowlist met without code change.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | lib/leveling.test.ts — add multi-level-up integration test (LVL-02 path) | 593a77d | lib/leveling.test.ts |
| 2 | take-turn.ts — extend $transaction with maxHp update and add LevelUpResult return shape | 809c770 | app/actions/take-turn.ts |

## What Was Built

### lib/leveling.test.ts (Task 1)

Added a new sibling describe block `maxHpAtLevel multi-level-up path (LVL-02)` immediately before the existing `maxHpAtLevel multi-level-up consistency (LVL-02)` block. Contains 3 `it()` cases proving the delta math:

- Fighter CON 14: `maxHpAtLevel('Fighter',14,5) - maxHpAtLevel('Fighter',14,1) === 32` (4 × (avg 6 + mod 2))
- Wizard CON 8: `maxHpAtLevel('Wizard',8,5) - maxHpAtLevel('Wizard',8,1) === 12` (4 × (avg 4 + mod -1))
- Rogue CON 10: `maxHpAtLevel('Rogue',10,5) - maxHpAtLevel('Rogue',10,1) === 20` (4 × (avg 5 + mod 0))

Total test count increased from 79 to 82 (3 new tests). All 82 pass.

### app/actions/take-turn.ts (Task 2)

Four surgical edits applied:

**EDIT 1 — Import:**
```ts
import { maxHpAtLevel, proficiencyBonus } from "../../lib/leveling";
```
Added after the existing `lib/xp` import. Uses lib/leveling as the single import source for all leveling math (D-11).

**EDIT 2 — Interfaces:**
- New `LevelUpResult` interface added immediately before `TurnResult`:
  - `oldLevel`, `newLevel`, `oldMaxHp`, `newMaxHp`, `proficiencyBonus` (all `number`)
- `TurnResult` extended with `levelUpResult?: LevelUpResult` after `newLevel?`
- Existing `leveledUp?` and `newLevel?` fields preserved (Plan 04 will replace usage but not remove declarations)

**EDIT 3 — $transaction maxHp write:**
Inside the `if (xpAwarded > 0 || didLevelUp)` guard, before `tx.character.update`:
```ts
const newMaxHp = didLevelUp
  ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
  : currentCharacter.maxHp;
```
`tx.character.update` data extended from `{ xp, level }` to `{ xp, level, maxHp: newMaxHp }`. Atomically commits all three fields with the game.update and message.create in the same transaction.

**EDIT 4 — Return value:**
Single-line return replaced with multi-line return adding:
```ts
levelUpResult: didLevelUp ? {
  oldLevel: previousLevel,
  newLevel,
  oldMaxHp: currentCharacter.maxHp,        // pre-transaction snapshot (Pitfall 2)
  newMaxHp: maxHpAtLevel(class, con, newLevel),
  proficiencyBonus: proficiencyBonus(newLevel),
} : undefined,
```

**EDIT 5 (verification only) — LVL-04/D-12 compliance:**
RULES_ENGINE_KEYS at line 299 (now renumbered) confirmed to equal `["hp", "maxHp", "xp", "level", "proficiencyBonus"]` — unchanged. LVL-04 met without code modification. The constant strips all five keys from Claude stateDeltas before `Object.assign(newState, deltas)`, preventing AI from overriding mechanical values.

## Deviations from Plan

### TDD Gate Compliance

**Task 1 (TDD):** The function under test (`maxHpAtLevel`) was already correctly implemented in Plan 01. Running the new tests in a pure RED phase (before any code) would have shown them GREEN immediately — there was no failing state to establish. Tests were added directly in GREEN mode. The existing implementation is correct per the 82-test suite; no regression.

**Task 2 (TDD):** The server action has no isolated unit test harness (it depends on Prisma, Supabase, and Anthropic). TypeScript compile (`npx tsc --noEmit`) was used as the primary correctness gate alongside the full 132-test suite for regression. No TDD RED/GREEN cycle was possible without mocking the entire action infrastructure.

### Auto-fixed Issues

None — plan executed exactly as written. All four edits applied surgically with no unrelated changes.

## Success Criteria Verification

1. take-turn.ts imports `maxHpAtLevel` and `proficiencyBonus` from `lib/leveling.ts` — PASSED (grep returns 1)
2. `LevelUpResult` interface declared in take-turn.ts; `TurnResult.levelUpResult?: LevelUpResult` added — PASSED (grep returns 1 each)
3. $transaction character.update writes `maxHp: newMaxHp` alongside `xp` and `level` — PASSED (grep returns 1)
4. Return value carries `levelUpResult: didLevelUp ? {...} : undefined` — PASSED (grep returns 1)
5. RULES_ENGINE_KEYS line unchanged (LVL-04 already met, verified-not-modified) — PASSED (grep returns 1)
6. lib/leveling.test.ts contains passing multi-level-up describe block — PASSED (82 tests pass)
7. `npx tsc --noEmit` and `npm run test:run` both pass — PASSED (0 errors, 132 tests)

## Known Stubs

None. The levelUpResult shape is fully populated from deterministic pure functions (maxHpAtLevel, proficiencyBonus). No hardcoded placeholder values.

## Threat Flags

No new threat surface beyond what was analyzed in the plan's threat model:
- T-03-06: RULES_ENGINE_KEYS verified unchanged — strips hp/maxHp/xp/level/proficiencyBonus from stateDeltas
- T-03-07: maxHpAtLevel throws on unknown class inside $transaction — rolls back entire turn
- T-03-08: levelUpResult values already visible in Phase 2 narrative — no new disclosure surface
- T-03-SC: No npm install invoked — Package Legitimacy Gate not triggered

## Self-Check: PASSED

- `lib/leveling.test.ts` modified: FOUND
- `app/actions/take-turn.ts` modified: FOUND
- Commit 593a77d (Task 1): FOUND
- Commit 809c770 (Task 2): FOUND
- All 5 acceptance criteria greps return ≥ 1: PASSED
- `npx tsc --noEmit` exits 0: PASSED
- `npm run test:run` 132 tests pass: PASSED
