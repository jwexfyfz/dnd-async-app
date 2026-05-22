---
phase: 02-xp-system
plan: "03"
subsystem: ui
tags: [xp-bar, party-tab, progress-bar, tailwind, character-data]

dependency_graph:
  requires:
    - phase: 02-01
      provides: lib/xp.ts with XP_THRESHOLDS and xpForNextLevel exports
    - phase: 02-02
      provides: Character.xp and Character.level populated via getGame re-fetch
  provides:
    - XP progress bar in PartyTab on each party member card
    - CharacterData interface extended with xp and level fields
    - lib/xp imported as value (not type) in page.tsx
  affects: [Phase 3 Leveling — level display already in place for level-up UI]

tech_stack:
  added: []
  patterns: [iife-per-member-computation, within-level-progress-calculation, clamped-percent-fill]

key_files:
  created: []
  modified:
    - app/game/[id]/page.tsx

key_decisions:
  - "xpForNextLevel and XP_THRESHOLDS imported as value (not type) — used at runtime in JSX expressions"
  - "within-level progress: (xp - XP_THRESHOLDS[level-1]) / (nextThreshold - XP_THRESHOLDS[level-1]) * 100"
  - "xpPct clamped to [0, 100] via Math.max/Math.min before string interpolation (T-02-09 mitigation)"
  - "IIFE pattern used for per-member computation inside .map() callback — consistent with existing page.tsx patterns"
  - "get-game.ts unchanged — character: true already returns all columns after db push in plan 02-01"

requirements-completed:
  - XP-04

metrics:
  duration: "~20 minutes"
  completed_date: "2026-05-22"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 1
---

# Phase 2 Plan 3: Party Tab XP Bar UI Summary

**Slim blue XP progress bar (h-1.5, bg-blue-500) added below the HP bar on each party member card in PartyTab, showing within-level progress with "Level N  ·  XP: current / next" label, reading from server-authoritative m.character.xp and m.character.level.**

## Performance

- **Duration:** ~20 minutes
- **Completed:** 2026-05-22
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments

- CharacterData interface in app/game/[id]/page.tsx extended with `xp: number` and `level: number`
- xpForNextLevel and XP_THRESHOLDS imported from lib/xp as value imports (runtime use in JSX)
- XP progress bar added to PartyTab below the HP bar on each party member card
- Within-level progress calculation: `(xp - prevThreshold) / (nextThreshold - prevThreshold) * 100`, clamped to [0, 100]
- Label: "Level N  ·  XP: current / next" for levels 1-4; "Level 5  ·  MAX" at cap with 100% fill
- TypeScript check passes: npx tsc --noEmit exits 0
- Human verification approved: bar displays correctly in browser

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend CharacterData with xp/level and import lib/xp | 9b7c8a1 | app/game/[id]/page.tsx |
| 2 | Add XP progress bar to PartyTab party member cards | b7f820c | app/game/[id]/page.tsx |

## Files Created/Modified

- `app/game/[id]/page.tsx` — CharacterData interface extended with xp/level; lib/xp value import added; XP bar JSX inserted in PartyTab below HP bar block

## Decisions Made

- Value import (not `import type`) for xpForNextLevel and XP_THRESHOLDS — both are used at runtime in JSX expressions and need to be emitted in the compiled output.
- Within-level progress formula uses XP_THRESHOLDS[level - 1] as the lower bound so the bar resets to 0% at each level boundary rather than showing cumulative XP.
- xpPct clamped via Math.max(0, Math.min(100, ...)) to prevent style attribute from receiving values outside [0, 100] (T-02-09 mitigation).
- get-game.ts required no changes — character: true already returns all columns including xp and level after the schema push in plan 02-01.

## Deviations from Plan

None — plan executed exactly as written. The only issue encountered was a Next.js .next cache staleness problem during verification (see Issues Encountered below), which is an environment concern, not a code deviation.

## Issues Encountered

**Next.js .next cache stale after wave 1 schema changes**

During browser verification, XP values displayed as `undefined` even though the TypeScript check passed and the DB schema was correct. Root cause: the Next.js dev server had compiled with the old Prisma client before the schema changes from plan 02-01 had propagated. Clearing the cache with `rm -rf .next/cache` and restarting the dev server resolved the issue. Values displayed correctly on the next load.

This is an environment concern (dev server compile-time caching), not a code defect. No source files were altered.

## Known Stubs

None — XP bar reads live data from `m.character.xp` and `m.character.level` via the existing getGame re-fetch that fires after each chip click. No hardcoded values or placeholder text.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced.
- T-02-08: XP and level are non-sensitive game data; party members intentionally share visibility
- T-02-09: xpPct clamped to [0, 100] before style interpolation; React renders numeric style values, not raw HTML
- T-02-10: No client-side XP state; all values from getGame re-fetch (server-authoritative)

## Next Phase Readiness

Phase 2 XP System is complete. All three plans delivered:
- 02-01: Schema (xp/level on Character) + lib/xp.ts engine + unit tests
- 02-02: take-turn.ts XP award integration + levelUpNote prompt injection
- 02-03: PartyTab XP progress bar UI

Phase 3 (Leveling) can proceed. The level display infrastructure in PartyTab is already in place; Phase 3 only needs to wire auto-leveling logic (maxHp increase, proficiency bonus) and ensure level-up transitions are smooth.

## Self-Check: PASSED

- [x] app/game/[id]/page.tsx modified: CharacterData extended, lib/xp imported, XP bar JSX present
- [x] Commit 9b7c8a1 exists: Task 1 (CharacterData extension + import)
- [x] Commit b7f820c exists: Task 2 (XP bar JSX)
- [x] npx tsc --noEmit: exits 0
- [x] Human verification: approved — bar displays correctly in browser
- [x] get-game.ts: zero modifications (verified by objective)

---
*Phase: 02-xp-system*
*Completed: 2026-05-22*
