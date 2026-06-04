---
phase: 02-xp-system
plan: "02"
subsystem: xp-integration
tags: [xp-award, encounter-detection, level-up, prisma-transaction, system-prompt]
dependency_graph:
  requires: [lib/xp.ts, Character.xp, Character.level]
  provides: [XP-award-on-encounter, levelUpNote-injection, encounterResult-parsing]
  affects: [app/actions/take-turn.ts]
tech_stack:
  added: []
  patterns: [strict-equality-signal-parsing, one-turn-delay-level-up, atomic-transaction-xp-write]
key_files:
  created: []
  modified:
    - app/actions/take-turn.ts
decisions:
  - encounterCompleted uses strict === "completed" equality — any other string or truthy value awards zero XP
  - xpAwarded from XP_BY_DIFFICULTY[difficulty] ?? 0 — unknown difficulty keys gracefully default to 0
  - tx.character.update is conditional on xpAwarded > 0 || didLevelUp — avoids no-op DB writes on non-encounter turns
  - levelUpNote stored in Game.state (one-turn delay) — written when level increases, deleted on every non-level-up turn to prevent stale notes
  - newLevel returned as undefined (not 0 or false) in TurnResult when no level-up occurred
metrics:
  duration: "~4 minutes"
  completed_date: "2026-05-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 1
---

# Phase 2 Plan 2: XP Integration into take-turn Summary

**One-liner:** take-turn.ts now parses encounterResult from Claude's JSON, awards difficulty-keyed XP atomically inside the existing prisma.$transaction, and injects level-up narration into the next turn's DM prompt via Game.state.levelUpNote.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend TurnResult, parsed type, and add xp import | 4dbb14e | app/actions/take-turn.ts |
| 2 | Add XP award logic, levelUpNote state, and character.update in $transaction | ddd6cb7 | app/actions/take-turn.ts |
| 3 | Add encounterResult to system prompt and levelUpNote to buildDynamicStatePrompt | ff06b64 | app/actions/take-turn.ts |

## What Was Built

**app/actions/take-turn.ts** — Four surgical integration points added:

1. **XP import**: `import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp"` added after the dice import. No new packages.

2. **TurnResult interface extended**: Added `leveledUp?: boolean` and `newLevel?: number` optional fields. The return value now signals level-up to callers.

3. **parsed type extended**: `encounterResult?: "completed" | null` added to the parsed variable type. The catch-block fallback object explicitly sets `encounterResult: null` so the XP logic always has a defined value.

4. **XP computation block** (inserted before newState construction):
   - `encounterCompleted` uses strict `=== "completed"` equality (T-02-04 mitigated)
   - `xpAwarded` from `XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0` — server-side DB data, not client-supplied
   - `currentXp`, `previousLevel`, `newLevel`, `didLevelUp` computed from character row values

5. **levelUpNote in newState** (after RULES_ENGINE_KEYS strip):
   - Written as `"CharacterName advanced to Level N this turn."` when level increases
   - Deleted on every non-level-up turn — prevents stale notes persisting across turns

6. **tx.character.update inside $transaction**:
   - Placed after `tx.game.update`, as last operation inside the transaction callback
   - Conditional on `xpAwarded > 0 || didLevelUp` to skip no-op writes
   - Updates `{ xp: currentXp, level: newLevel }` atomically

7. **buildStaticPrompt RESPONSE RULES**: Added `"encounterResult": "completed" | null` to the JSON schema comment and a rule line explaining trigger conditions (combat fully resolves: enemy defeated/fled, room cleared; null on exploration, dialogue, partial victories).

8. **buildDynamicStatePrompt**: Added `levelUpDirective` that reads `gameState.levelUpNote` and injects `"LEVEL UP: [note] Weave this advancement into your narration as a dramatic, triumphant moment."` when the note is present.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npx tsc --noEmit` | No errors |
| XP import | `grep -c "computeLevel.*XP_BY_DIFFICULTY"` | 1 |
| encounterResult occurrences | `grep -c "encounterResult"` | 5 (≥2 required) |
| tx.character.update | `grep -c "tx.character.update"` | 1 |
| levelUpNote occurrences | `grep -c "levelUpNote"` | 4 (≥3 required) |
| Full test suite | `npm run test:run` | 50/50 passed (no regressions) |

## Deviations from Plan

None — plan executed exactly as written. All four edits in Task 2 and both edits in Task 3 applied cleanly without structural adjustments.

## Known Stubs

None — all logic is fully wired. `encounterResult` parsing, XP computation, `tx.character.update`, and `levelUpNote` injection are all live code paths, not placeholders.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. The threat mitigations documented in the plan were applied:
- T-02-04: Strict `=== "completed"` equality implemented as specified
- T-02-05: RULES_ENGINE_KEYS already stripped "xp" and "level" from stateDeltas (verified in Phase 1, unchanged)
- T-02-06: XP amount from server-side `game.storyPrompt.difficulty`, not client input
- T-02-07: `levelUpNote` is code-generated server-side; cleared every non-level-up turn

## Self-Check: PASSED

- [x] app/actions/take-turn.ts modified: file exists and all grep checks pass
- [x] Commit 4dbb14e exists: Task 1 (import + TurnResult + parsed type)
- [x] Commit ddd6cb7 exists: Task 2 (XP award + levelUpNote + transaction)
- [x] Commit ff06b64 exists: Task 3 (system prompt + dynamic prompt)
- [x] npx tsc --noEmit: no errors
- [x] npm run test:run: 50/50 passing
