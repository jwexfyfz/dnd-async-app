---
plan: 01-04
phase: 01-dice-engine-critical-bug-fixes
status: complete
completed: 2026-05-22
---

# Plan 01-04: take-turn.ts Refactor — SUMMARY

## What Was Built

Refactored `app/actions/take-turn.ts` to fix three critical bugs and integrate the dice engine:

1. **Prompt injection blocked** — `sanitizeChipText()` strips SYSTEM:/ASSISTANT:/USER: prefixes, backticks, "ignore previous", enforces ≤ 200 chars; `sanitizedAction` replaces raw `chipText` everywhere.
2. **Race condition eliminated** — `Promise.all([message.create, game.update])` replaced with `prisma.$transaction`; re-reads `game.version` inside the transaction and throws `STALE_TURN` on mismatch.
3. **Dice integrated** — `detectActionType()` heuristic routes attack keywords to `dcType: "AC"` (using `gameState.targetAC ?? 14`) and all other actions to `dcType: "DC"` (dc=12). `rollD20Check()` is called before the Claude narration call; `D20Result` passed as a fact in the dynamic system prompt.
4. **stateDeltas allowlist** — `hp`, `maxHp`, `xp`, `level`, `proficiencyBonus` stripped from AI-returned deltas before apply; rules engine owns these fields.
5. **consecutiveMisses tracking** — increments on failure, resets on success, stored in `game.state`; narration directive injected when ≥ 3.
6. **TurnResult.diceResult** — `D20Result` returned to the caller for Plan 05 UI rendering.

## Key Files

### Modified
- `app/actions/take-turn.ts` — full refactor; all six concerns above addressed

## Verification Checks (all passed)

- `npx tsc --noEmit` exits 0 ✓
- `grep -c "sanitizeChipText"` → 2 ✓
- `grep -c "diceResult"` → 11 ✓
- `grep -c "STALE_TURN"` → 4 ✓
- `grep -c 'prisma\.\$transaction'` → 1 ✓
- `grep -c "version.*increment"` → 1 ✓
- `grep -c "rollD20Check"` → 2 ✓
- `grep -c "delete deltas"` → 3 ✓
- `grep -c "consecutiveMisses"` → 9 ✓
- `grep -c "detectActionType"` → 2 ✓
- `grep -c "Promise.all"` → 0 ✓

## Self-Check: PASSED
