---
phase: 03-leveling
plan: "02"
subsystem: leveling
tags: [leveling, character-creation, adventure-start, vertical-slice, hp]
dependency_graph:
  requires:
    - lib/leveling.ts (maxHpAtLevel — built in Plan 01)
    - Character.maxHp column (migration in Plan 01)
  provides:
    - create-character.ts writes class-correct maxHp at creation (LVL-03)
    - start-adventure.ts reads canonical maxHp from DB (D-03)
  affects:
    - All newly created characters get class-aware maxHp persisted
    - All adventures started now initialize partyHp/partyMaxHp from DB column
tech_stack:
  added: []
  patterns:
    - Surgical server action edit (import + const + data field)
    - Single-line formula replacement with canonical DB read
key_files:
  created:
    - app/actions/create-character.test.ts
  modified:
    - app/actions/create-character.ts (import + maxHp compute + create data field)
    - app/actions/start-adventure.ts (one-line formula replacement)
decisions:
  - maxHpAtLevel called at level 1 only (character creation is always level 1)
  - Unknown class propagates through existing catch handler — no new guard added (T-03-04)
  - hp variable name preserved in start-adventure.ts so partyHp/partyMaxHp assignments need zero changes
  - TDD RED test file written for create-character to document LVL-03 behavior specs
metrics:
  duration: "8 minutes"
  completed: "2026-05-22"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 3 Plan 2: Wire maxHp into Server Actions Summary

**One-liner:** Two surgical server-action edits wire `maxHpAtLevel` into character creation and replace the hardcoded `10+conMod` HP formula in adventure start with the canonical DB column.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | create-character LVL-03 behavior specs test file | 148d997 | app/actions/create-character.test.ts |
| 1 (GREEN) | create-character persists class-aware maxHp | a8f4396 | app/actions/create-character.ts |
| 2 | start-adventure reads canonical character.maxHp | a8394cc | app/actions/start-adventure.ts |

## What Was Built

### app/actions/create-character.ts

Two surgical changes:
1. Import: `import { maxHpAtLevel } from "../../lib/leveling";` added after existing imports
2. Compute + persist: `const maxHp = maxHpAtLevel(characterClass, constitution, 1);` added before `prisma.character.create`; `maxHp` added to the `data` block after `charisma`

HP values at character creation (level 1):
- Fighter CON 14 → `maxHp = 12` (die 10 + mod 2)
- Wizard CON 10 → `maxHp = 6` (die 6 + mod 0)
- Rogue CON 8 → `maxHp = 7` (die 8 + mod -1)
- Cleric CON 16 → `maxHp = 11` (die 8 + mod 3)

The existing class-validation guard (line 38: "You must choose a character class.") still runs before `maxHpAtLevel`. Unknown non-empty classes (forged POST) propagate through `maxHpAtLevel`'s throw into the existing `catch (error: any)` handler, returning `{ success: false, error: "Unknown class: <value>" }` — single source of truth in lib/leveling.ts.

### app/actions/start-adventure.ts

One-line replacement at line 49:

Before:
```typescript
const hp = 10 + Math.floor((member.character.constitution - 10) / 2);
```

After:
```typescript
const hp = member.character.maxHp;   // canonical, stored at character creation (D-03)
```

The `prisma.game.findUnique` include at lines 11-18 already uses `partyMembers: { include: { character: true } }` (full character include). Post-Plan-01 `prisma generate`, `member.character.maxHp: number` is present in the generated type. No import, no select clause change needed.

### app/actions/create-character.test.ts (TDD RED)

5 unit tests documenting LVL-03 behavior specs:
- Fighter CON 14 → maxHp = 12
- Wizard CON 10 → maxHp = 6
- Rogue CON 8 → maxHp = 7
- Cleric CON 16 → maxHp = 11
- Unknown class throws "Unknown class: Paladin" (T-03-04 defense-in-depth)

## Deviations from Plan

None — plan executed exactly as written. Both edits were surgical (3 insertions for create-character, 1 line changed for start-adventure). No other files modified.

## Success Criteria Verification

1. `create-character.ts` imports `maxHpAtLevel` and writes class-correct `maxHp` at creation: PASSED
2. `start-adventure.ts` reads `member.character.maxHp` from DB instead of recomputing: PASSED
3. Legacy formula `10 + Math.floor((member.character.constitution ...))` fully removed: PASSED (`grep` returns 0)
4. Both files build under strict TypeScript (`npx tsc --noEmit` exits 0): PASSED
5. No other server actions, components, or libs modified: PASSED (git diff confirms only 2 source files + 1 test file)
6. `npm run test:run` full suite: 134 tests, 4 files — all PASSED

## Known Stubs

None. Both changes wire real data: `maxHpAtLevel` returns computed values from the canonical `lib/leveling.ts` pure function, and `member.character.maxHp` reads the persisted DB column.

## Threat Flags

No new threat surface introduced. Both planned mitigations are in place:
- T-03-04: Unknown class in create-character falls through to existing catch handler (no new validation guard added — single source of truth in lib/leveling.ts)
- T-03-05: `character.maxHp` is server-only; no client write path exists

## Self-Check: PASSED

- `app/actions/create-character.test.ts` exists: FOUND
- `app/actions/create-character.ts` contains `import { maxHpAtLevel }`: FOUND (1 occurrence)
- `app/actions/create-character.ts` contains `const maxHp = maxHpAtLevel(characterClass, constitution, 1)`: FOUND (1 occurrence)
- `app/actions/create-character.ts` contains `maxHp,` in data block: FOUND (1 occurrence)
- `app/actions/start-adventure.ts` does NOT contain `10 + Math.floor((member.character.constitution`: CONFIRMED (0 occurrences)
- `app/actions/start-adventure.ts` contains `const hp = member.character.maxHp`: FOUND (1 occurrence)
- Commit 148d997 (Task 1 RED): FOUND
- Commit a8f4396 (Task 1 GREEN): FOUND
- Commit a8394cc (Task 2): FOUND
