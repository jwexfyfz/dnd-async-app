---
phase: 03-leveling
plan: "04"
subsystem: ui
tags: [leveling, level-up-card, react-component, indigo, dice-card-pattern, human-verify, LVL-02]

# Dependency graph
requires:
  - phase: 03-03
    provides: "take-turn.ts LevelUpResult interface and levelUpResult field on TurnResult"
  - phase: 03-01
    provides: "lib/leveling.ts maxHpAtLevel + proficiencyBonus; Character.maxHp DB column"
provides:
  - app/game/[id]/page.tsx LevelUpCard component (indigo color family, level/HP/proficiency display)
  - app/game/[id]/page.tsx levelUpResult state + 3-point lifecycle wiring in handleChipClick
  - app/game/[id]/page.tsx FieldTab levelUpResult prop forwarding
affects:
  - Human verification required (Task 2 checkpoint) before plan marked complete
  - LVL-02 vertical slice closure: server-side maxHp write (Plan 03) now has a visible UI card

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DiceCard clone pattern — LevelUpCard reuses same container shape with indigo instead of amber
    - Ephemeral UI state pattern — cleared on turn start, set on success, cleared on failure (parallel to diceResult)
    - Level-5-only conditional render — proficiency bonus row shown only on newLevel === 5

key-files:
  created: []
  modified:
    - app/game/[id]/page.tsx (LevelUpResult type, levelUpResult state, handleChipClick wiring, FieldTab prop, LevelUpCard component)

key-decisions:
  - "LevelUpResult declared locally in page.tsx (not imported from take-turn.ts) — server-internal interface not exported; structural identity sufficient for TypeScript"
  - "Proficiency bonus line rendered only when result.newLevel === 5 — matches the step function in lib/dice.ts (D-06)"
  - "No second pulse-placeholder for level-up loading state — DiceCard's amber placeholder already reserves vertical space; one is sufficient"
  - "LevelUpCard placed after DiceCard in space-y-2 container — both cards can appear simultaneously if a level-up turn also has a dice roll"

patterns-established:
  - "Ephemeral card pattern: parallel state hooks (diceResult / levelUpResult) cleared at turn start, set on success, cleared on failure"
  - "Color-family differentiation: amber = dice outcome, indigo = level-up reward"

requirements-completed: [LVL-02]

# Metrics
duration: 8min
completed: 2026-05-22
---

# Phase 3 Plan 4: LevelUpCard UI Component Summary

**Indigo-styled `LevelUpCard` component wired to `levelUpResult` from take-turn, rendering level/HP delta and conditional proficiency line above the narrative on level-up turns.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-22T21:00:00Z
- **Completed:** 2026-05-22T21:08:00Z
- **Tasks:** 1 of 2 completed (Task 2 = human-verify checkpoint, awaiting approval)
- **Files modified:** 1

## Accomplishments

- Defined `LevelUpResult` interface locally in `app/game/[id]/page.tsx` matching the server-side shape from Plan 03
- Added `levelUpResult` useState hook parallel to `diceResult`; wired at all 3 lifecycle points in `handleChipClick` (clear-on-start, set-on-success with `?? null` coercion, clear-on-failure)
- Extended `FieldTab` signature with optional nullable `levelUpResult?: LevelUpResult | null` prop
- Rendered `<LevelUpCard result={levelUpResult} />` in the existing `space-y-2` narrative container, gated by `!isTakingTurn`
- Defined `LevelUpCard` function: indigo-50 bg / indigo-200 border / indigo-700 text; ⬆ icon; "Level X → Y" (bold); "Max HP: A → B"; conditional "Proficiency Bonus: +N" on `newLevel === 5` only
- TypeScript compiles cleanly (`npx tsc --noEmit` exits 0); no new lint errors in page.tsx

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | page.tsx — add LevelUpResult type, state, handler wiring, FieldTab prop, and LevelUpCard component | 18a4986 | app/game/[id]/page.tsx |
| 2 | Human verification checkpoint | (awaiting human approval) | — |

## Files Created/Modified

- `app/game/[id]/page.tsx` — Added LevelUpResult interface, levelUpResult state hook, 3-point handleChipClick wiring, FieldTab prop extension, LevelUpCard component definition and render slot

## Decisions Made

- LevelUpResult interface declared locally in page.tsx — the server-side interface in take-turn.ts is not exported; structural typing makes the local declaration sufficient and avoids a shared-types refactor (out of scope for this plan)
- Proficiency bonus line rendered only when `result.newLevel === 5` — matches the step-function in lib/dice.ts (proficiency bonus only increases at levels 1, 5, 9, 13, 17 in D&D 5e Basic Rules; within the levels 1–5 scope, the only jump is at level 5)
- No second pulse-placeholder for level-up loading — DiceCard's amber `animate-pulse` div already reserves vertical space during loading; adding a second placeholder would be redundant
- LevelUpCard is placed after DiceCard in the render order — on a turn that both levels up AND has a dice roll, both cards appear (level-up above the narrative, dice above that)

## Deviations from Plan

None — plan executed exactly as written. All 7 edits applied surgically with no unrelated changes. The only adjustment was removing alignment whitespace from the `levelUpResult` useState declaration to satisfy the acceptance criteria grep pattern.

## Issues Encountered

Minor: The initial `useState` declaration used alignment-style extra spaces (matching the existing `diceResult` line formatting), which caused the automated verify regex to miss. Fixed by using single-space formatting to match the acceptance criteria grep pattern. TypeScript and lint were unaffected.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Task 2 (human-verify checkpoint) requires a player to trigger a real level-up turn and confirm the indigo card renders above the narrative with correct values
- Once human verification is approved, Plan 04 is complete and the LVL-02 vertical slice is fully closed
- Phase 4 (Skills) can proceed after this verification

## Known Stubs

None. All displayed values flow directly from server-authoritative `levelUpResult` returned by `take-turn.ts`. No hardcoded placeholders.

## Threat Flags

No new threat surface beyond what was analyzed in the plan's threat model:
- T-03-09 (accept): LevelUpCard is display-only; client mutation of React state has no effect on DB values already committed in the Plan 03 `$transaction`
- T-03-10 (accept): All displayed data (level, maxHp) is already visible in partyMaxHp/partyHp Game.state for all party members; no new disclosure surface

## Self-Check: PASSED

- `app/game/[id]/page.tsx` modified: FOUND
- Commit 18a4986 (Task 1): FOUND
- `interface LevelUpResult` declared once: FOUND (grep returns 1)
- `const [levelUpResult, setLevelUpResult] = useState<LevelUpResult` present: FOUND (grep returns 1)
- `setLevelUpResult(` appears 3 times: FOUND (grep returns 3)
- `setLevelUpResult(result.levelUpResult ?? null)` present: FOUND (grep returns 1)
- `levelUpResult={levelUpResult}` passed to FieldTab: FOUND (grep returns 1)
- `levelUpResult?: LevelUpResult | null` in FieldTab signature: FOUND (grep returns 1)
- `<LevelUpCard result={levelUpResult}` rendered: FOUND (grep returns 1)
- `function LevelUpCard` defined: FOUND (grep returns 1)
- `bg-indigo-50 border border-indigo-200` present: FOUND (grep returns 1)
- `result.newLevel === 5` present: FOUND (grep returns 1)
- `npx tsc --noEmit` exits 0: PASSED
