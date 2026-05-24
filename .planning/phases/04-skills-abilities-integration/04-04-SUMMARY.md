---
phase: 04-skills-abilities-integration
plan: "04"
subsystem: take-turn / game-ui
tags: [skill-checks, two-call-architecture, ai-guardrails, ui-components]
dependency_graph:
  requires: [04-01-PLAN, 04-03-PLAN]
  provides: [two-call-skill-check-architecture, SkillCheckCard, skillCheckResult-in-TurnResult]
  affects: [app/actions/take-turn.ts, app/game/[id]/page.tsx]
tech_stack:
  added: []
  patterns: [two-call-LLM-pattern, MECHANICAL-CONTEXT-keyword-injection, conditional-UI-card-suppression]
key_files:
  created: []
  modified:
    - app/actions/take-turn.ts
    - app/game/[id]/page.tsx
decisions:
  - "Call #2 uses same buildConversationMessages as Call #1 — narration context is identical except for the MECHANICAL CONTEXT block"
  - "resolveSkillCheck wraps currentCharacter inline as SkillCharacterInput — no new type needed in take-turn.ts"
  - "rawText (Call #1) still used for parseCombatEffects — combat effect tags come from Call #2 on skill turns would require rawText2; accepted as-is since skill check turns are narrative, not combat"
  - "Error path in handleChipClick also clears skillCheckResult to avoid stale state from prior turn"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-24T16:18:00Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 04 Plan 04: Two-Call Skill Check Architecture Summary

Two-call skill check integration in `take-turn.ts` and `SkillCheckCard` in the game UI. Call #1 detects skill intent via `skillName` in the JSON schema; `resolveSkillCheck` runs the dice math in code; Call #2 receives a compact `MECHANICAL CONTEXT` keyword and produces the narration. Claude never sees raw roll numbers, DC values, or proficiency bonuses.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | take-turn.ts two-call skill check integration | 90efc53 |
| 2 | SkillCheckCard UI component and state in page.tsx | 1e8350e |

## What Was Built

### Task 1 — take-turn.ts

- Added `resolveSkillCheck`, `SKILL_ABILITY_MAP`, `SkillCheckResult` imports from `lib/skills`
- Extended `buildStaticPrompt` RESPONSE RULES JSON schema with `"skillName": "ExactSkillName" | null` and the 18-skill canonical list
- Extended `buildDynamicStatePrompt` with optional `mechanicalContext?: string` parameter — appends `MECHANICAL CONTEXT\n[SKILL skill=X outcome=Y dc=N]\nNarration rules: ...` block when present
- Validated `skillName` case-sensitively against `Object.keys(SKILL_ABILITY_MAP)` — invalid or hallucinated names treated as null with no crash
- When `validSkillName` non-null: calls `resolveSkillCheck(validSkillName, currentCharacter, dc)`, builds `[SKILL skill=X outcome=Y dc=N]` keyword, makes Call #2 with `mechanicalContext` injected
- `finalParsed` replaces `parsed` for all downstream code: `stateDeltas`, `chips`, `narrative`, `encounterResult`, transaction `content`/`chips` fields, and return value
- `skillCheckResult` added to `TurnResult` interface and return value

### Task 2 — page.tsx

- Added `SkillCheckCard` component using violet theme (`bg-violet-50`, `border-violet-200`, `text-violet-700`) — shows only `{result.skill}: SUCCESS/FAILURE`, no raw numbers
- Added `skillCheckResult` state (`useState<SkillCheckResult | null>(null)`)
- `setSkillCheckResult(null)` in turn-start clear block and error path
- `setSkillCheckResult(result.skillCheckResult ?? null)` after `takeTurn` returns
- `FieldTab` props interface extended with `skillCheckResult?: SkillCheckResult | null`
- DiceCard suppressed when `skillCheckResult` present; `LevelUpCard` renders independently
- `skillCheckResult` prop passed to `FieldTab` JSX

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-04-04-01 | `Object.keys(SKILL_ABILITY_MAP).includes(rawSkillName)` — case-sensitive validation; invalid names → null; no crash |
| T-04-04-02 | MECHANICAL CONTEXT block contains only `[SKILL skill=X outcome=Y dc=N]`; roll, modifier, proficiencyBonus never appear in any Claude prompt string |
| T-04-04-03 | `finalParsed = Call #2 parsed result`; only `finalParsed.stateDeltas` applied downstream; Call #1 stateDeltas discarded on skill check turns |
| T-04-04-05 | `SkillCheckCard` renders only `result.skill` and `result.success` — no `result.roll`, `result.dc`, `result.modifier`, `result.proficiencyBonus` in JSX |

## Known Stubs

None. Both files produce live behavior — no hardcoded empty values, placeholder text, or unconnected data sources.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- `app/actions/take-turn.ts` — modified, build passes
- `app/game/[id]/page.tsx` — modified, build passes
- Commit `90efc53` — confirmed in git log
- Commit `1e8350e` — confirmed in git log
- 174/174 tests pass
