---
phase: 03-leveling
plan: "01"
subsystem: leveling
tags: [leveling, hp, prisma-migration, pure-module, unit-tests, tdd]
dependency_graph:
  requires: []
  provides:
    - lib/leveling.ts (maxHpAtLevel, HIT_DIE_BY_CLASS, proficiencyBonus re-export)
    - Character.maxHp column in PostgreSQL
    - prisma/migrations/0_init baseline + 20260522210049_add_character_max_hp
  affects:
    - Plans 02 and 03 consume lib/leveling.ts maxHpAtLevel
    - All existing Character rows backfilled to correct class-aware maxHp
tech_stack:
  added: []
  patterns:
    - Pure utility module pattern (lib/xp.ts analog) — zero Prisma/framework imports
    - TDD RED/GREEN cycle for leveling.ts
    - Prisma migrate resolve --applied for baselining existing db-push project
key_files:
  created:
    - lib/leveling.ts
    - lib/leveling.test.ts
    - prisma/seed-backfill-maxhp.mjs
    - prisma/migrations/0_init/migration.sql
    - prisma/migrations/20260522210049_add_character_max_hp/migration.sql
  modified:
    - prisma/schema.prisma (added maxHp Int @default(10) to Character)
    - package.json (added db:backfill-maxhp script)
decisions:
  - maxHpAtLevel uses total-HP formula (not incremental delta) — level N returns cumulative total
  - HIT_DIE_BY_CLASS inline in backfill script (Option A) — avoids .ts/.mjs import boundary
  - Baseline migration 0_init created via migrate diff + migrate resolve --applied (Pitfall 5 resolution)
  - Unknown class throws Error("Unknown class: <value>") — not silent NaN or 0
metrics:
  duration: "7 minutes"
  completed: "2026-05-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 2
---

# Phase 3 Plan 1: Leveling Foundation (HP Math + Migration) Summary

**One-liner:** Pure `maxHpAtLevel` module with class-correct d10/d8/d6 hit dice, 79 unit tests, first-ever Prisma migration, and backfill of 6 existing characters.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create lib/leveling.ts and lib/leveling.test.ts (TDD RED/GREEN) | a55a652 | lib/leveling.ts, lib/leveling.test.ts |
| 2 | Add maxHp column to Character model and run first-ever prisma migrate dev | 8dcd2b9 | prisma/schema.prisma, prisma/migrations/ |
| 3 | Backfill existing Character rows with class-correct maxHp | 5334511 | prisma/seed-backfill-maxhp.mjs, package.json |

## What Was Built

### lib/leveling.ts

Pure TypeScript module (zero Prisma/framework imports) exporting:
- `HIT_DIE_BY_CLASS: Record<string, { die: number; avg: number }>` — Fighter d10/avg6, Rogue d8/avg5, Cleric d8/avg5, Wizard d6/avg4
- `maxHpAtLevel(characterClass, constitution, level): number` — level 1 = max die + CON mod; levels 2–N add avg + CON mod each; throws on unknown class
- `proficiencyBonus` re-exported from lib/dice.ts (D-11 single import source for Phase 4)

### lib/leveling.test.ts

79 unit tests covering:
- HIT_DIE_BY_CLASS constant correctness (4 tests)
- LVL-01 base cases at level 1 for all 4 classes (4 tests)
- LVL-05 fixture grid: 4 classes × 5 levels × 3 CON modifiers (60 tests)
- LVL-02 multi-level-up consistency (4 tests)
- V5 input validation — unknown class throws (2 tests)
- proficiencyBonus re-export sanity (5 tests)

### prisma/schema.prisma

Added `maxHp        Int @default(10)` after `level Int @default(1)` in the Character model. `@default(10)` is a safe placeholder for migration (Fighter level-1 CON 10 baseline); backfill corrects all existing rows.

### prisma/migrations/

First-ever `prisma migrate dev` for this project. Two migrations created:
- `0_init`: full baseline of existing schema (from db-push history)
- `20260522210049_add_character_max_hp`: `ALTER TABLE "Character" ADD COLUMN "maxHp" INTEGER NOT NULL DEFAULT 10`

### prisma/seed-backfill-maxhp.mjs

One-shot ESM backfill using Option A (inline math). Executed once: Updated 6 of 6 characters. Results:
- Wizard CON 8 L1 → 5 (was 10)
- Rogue CON 11 L1 → 8 (was 10)
- Rogue CON 8 L1 → 7 (was 10)
- Cleric CON 8 L1 → 7 (was 10)
- Fighter CON 15 L1 → 12 (was 10)
- (One fighter already at 10 or updated to correct value)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed LVL-02 test table typo — Cleric CON 16 L5 expected value**
- **Found during:** Task 1 GREEN phase (test run showed 1 failure)
- **Issue:** Plan's LVL-02 multi-level-up table listed `maxHpAtLevel("Cleric", 16, 5) === 35 (11 + 6 + 6 + 6 + 6)` but used Fighter's avg=6 instead of Cleric's avg=5. Correct value per fixture grid and arithmetic: 11 + 8 + 8 + 8 + 8 = 43 (where 8 = avg 5 + mod 3).
- **Fix:** Updated test description and expected value from 35 to 43. The fixture grid (canonical truth) showed Cleric CON 16 L5 = 43 which is correct.
- **Files modified:** lib/leveling.test.ts
- **Commit:** a55a652

**2. [Rule 3 - Blocking] First-ever prisma migrate dev required baselining of db-push history**
- **Found during:** Task 2
- **Issue:** The project used `prisma db push` previously with no `_prisma_migrations` table. Running `migrate dev` detected drift between the empty migration history and the actual DB schema (Pitfall 5 in RESEARCH.md).
- **Fix:** Generated baseline SQL from the live DB using `prisma migrate diff --from-empty --to-config-datasource --script`. Created `prisma/migrations/0_init/migration.sql` with the full schema. Used `prisma migrate resolve --applied 0_init` to mark it as applied without running the SQL (DB already has the schema). Then ran `migrate dev --name add-character-max-hp` successfully for just the new column.
- **Files modified:** prisma/migrations/0_init/migration.sql (created)
- **This is the standard Prisma migration-from-db-push approach and is expected for first-ever migrate dev.**

**3. [Rule 3 - Blocking] rtk wrapper intercepted npx prisma migrate dev**
- **Found during:** Task 2
- **Issue:** The rtk (Rust Token Killer) Claude Code hook was rewriting `npx prisma migrate dev` to `rtk npx prisma migrate dev`, which failed with "No such file or directory".
- **Fix:** Used the direct prisma binary at `/Users/jeffwang/Desktop/dnd-async-app/node_modules/.bin/prisma` for migration commands. `npm run` commands still work as expected.

**4. [Rule 3 - Blocking] .env.local not available in git worktree**
- **Found during:** Task 2
- **Issue:** `.env.local` is gitignored and not present in the git worktree. `prisma.config.ts` uses `path.resolve(process.cwd(), ".env.local")` which failed.
- **Fix:** Created a symlink at `<worktree>/.env.local → /Users/jeffwang/Desktop/dnd-async-app/.env.local`. This is a runtime fix only (not committed).

## Success Criteria Verification

1. `lib/leveling.ts` exports `HIT_DIE_BY_CLASS`, `maxHpAtLevel`, `proficiencyBonus` — zero Prisma/Next.js imports: PASSED
2. `lib/leveling.test.ts` green with 79 tests (full 4-class × 5-level × 3-CON fixture + unknown-class throw): PASSED
3. `Character.maxHp` column exists in DB with non-null integer default 10: PASSED
4. `prisma/migrations/` directory exists with `add-character-max-hp` migration applied: PASSED
5. Every existing Character row has class-correct `maxHp` (backfill updated 6 of 6): PASSED
6. `npm run test:run` full suite remains green (129 tests, 3 files): PASSED

## Known Stubs

None. All data is live from the DB backfill and computed by the canonical maxHpAtLevel function.

## Threat Flags

No new threat surface introduced beyond what was planned in the threat model (T-03-01 through T-03-SC). All planned mitigations implemented:
- T-03-01: Unknown class throws Error — implemented and tested
- T-03-02: Migration used additive @default(10) — no reset performed
- T-03-03: Backfill inline math has explicit "regenerate if formula changes" comment

## Self-Check: PASSED

- `lib/leveling.ts` exists: FOUND
- `lib/leveling.test.ts` exists: FOUND
- `prisma/schema.prisma` contains `maxHp Int @default(10)`: FOUND
- `prisma/migrations/20260522210049_add_character_max_hp/migration.sql` exists: FOUND
- `prisma/seed-backfill-maxhp.mjs` exists: FOUND
- Commit a55a652 (Task 1): FOUND
- Commit 8dcd2b9 (Task 2): FOUND
- Commit 5334511 (Task 3): FOUND
