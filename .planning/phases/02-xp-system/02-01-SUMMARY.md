---
phase: 02-xp-system
plan: "01"
subsystem: xp-engine
tags: [schema, pure-module, unit-tests, xp-system]
dependency_graph:
  requires: []
  provides: [Character.xp, Character.level, lib/xp.ts, lib/xp.test.ts]
  affects: [prisma-client-types, downstream-wave-2-plans]
tech_stack:
  added: []
  patterns: [pure-module-no-prisma, for-loop-threshold-scan, colocated-vitest-tests]
key_files:
  created:
    - lib/xp.ts
    - lib/xp.test.ts
  modified:
    - prisma/schema.prisma
decisions:
  - XP_THRESHOLDS array [0,300,900,2700,6500] is authoritative from REQUIREMENTS.md XP-02
  - computeLevel uses a for loop over 5-element constant array — clarity beats cleverness
  - xpForNextLevel(5) returns null to signal level cap, not a sentinel number
  - lib/xp.ts has zero imports — fully testable without DB, matching lib/dice.ts pattern
metrics:
  duration: "~2 minutes"
  completed_date: "2026-05-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 1
---

# Phase 2 Plan 1: XP Schema + Pure Engine Module Summary

**One-liner:** Schema columns xp/level added to Character, pushed to Neon, and a pure lib/xp.ts engine validated by 22 unit tests covering all XP-05 boundary values.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add xp and level to Character schema, push, regenerate | 9a0ccdf | prisma/schema.prisma |
| 2 | Create lib/xp.ts — pure XP engine module | 6b986be | lib/xp.ts |
| 3 | Create lib/xp.test.ts — full boundary test suite | 94df86b | lib/xp.test.ts |

## What Was Built

**prisma/schema.prisma** — Added two fields to the Character model immediately after `charisma`:
- `xp    Int @default(0)` — cumulative XP total, persists across games
- `level Int @default(1)` — current level (1–5), written by computeLevel

`npm run db:push` applied the additive schema change to the Neon PostgreSQL database. `npx prisma generate` regenerated the Prisma client so `Character.xp` and `Character.level` are now TypeScript-typed.

**lib/xp.ts** — Pure XP engine module with zero imports. Exports:
- `XP_THRESHOLDS: readonly number[]` — `[0, 300, 900, 2700, 6500]` authoritative from REQUIREMENTS.md XP-02
- `XP_BY_DIFFICULTY: Record<string, number>` — `{ Beginner: 50, Standard: 100, Veteran: 200 }` from CONTEXT.md D-04
- `computeLevel(xp: number): number` — for-loop scan over XP_THRESHOLDS, returns level in [1, 5]
- `xpForNextLevel(level: number): number | null` — returns null at level 5 cap

**lib/xp.test.ts** — 22 unit tests across 4 describe blocks:
- 12 `computeLevel` cases: all 10 XP-05 required boundaries (0, 299, 300, 301, 899, 900, 2699, 2700, 6499, 6500) plus 99999 (above cap) and -1 (negative XP)
- 5 `xpForNextLevel` cases: levels 1–4 return correct thresholds, level 5 returns null
- 3 `XP_BY_DIFFICULTY` cases: Beginner/Standard/Veteran amounts
- 2 `XP_THRESHOLDS` cases: array length and exact values

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Schema xp field | `grep -c "xp.*Int"` | 1 |
| Schema level field | `grep -c "level.*Int"` | 1 |
| DB push | `npm run db:push` | "Your database is now in sync with your Prisma schema" |
| Client regen | `npx prisma generate` | Exit 0 |
| Type check | `npx tsc --noEmit` | No errors |
| XP tests | `npm run test:run -- lib/xp.test.ts` | 22/22 passed |
| Full suite | `npm run test:run` | 50/50 passed (no regressions in dice tests) |

## Deviations from Plan

None — plan executed exactly as written. The node verify command from Task 2 (`node -e "require('./lib/xp')"`) failed because the module uses ESM exports, but TypeScript compilation (`npx tsc --noEmit`) passed cleanly and the vitest suite confirmed all function behaviors.

## TDD Gate Compliance

- RED gate: Not applicable for Tasks 1–2 (schema/pure module, no test-first requirement). Task 3 wrote tests after the implementation was in place (GREEN state — implementation existed from Task 2).
- GREEN gate: `npm run test:run -- lib/xp.test.ts` passed 22/22 immediately after Task 3.
- The plan is typed `tdd` but the task ordering (schema → implementation → tests) is correct for this plan's structure. The implementation (Task 2) and tests (Task 3) were committed separately.

## Known Stubs

None — all four exports in lib/xp.ts are fully implemented with real logic. No placeholder values.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at external trust boundaries beyond the additive schema columns documented in the plan's threat model (T-02-01).

## Self-Check: PASSED

- [x] prisma/schema.prisma modified: `grep -c "xp.*Int" prisma/schema.prisma` returns 1
- [x] lib/xp.ts created at correct path
- [x] lib/xp.test.ts created at correct path
- [x] Commit 9a0ccdf exists: schema change
- [x] Commit 6b986be exists: xp.ts creation
- [x] Commit 94df86b exists: xp.test.ts creation
- [x] All 22 XP tests pass, 50 total tests pass
