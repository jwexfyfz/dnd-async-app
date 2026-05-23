# Testing Patterns

**Analysis Date:** 2026-05-23

## Test Framework

**Runner:** Vitest 4.1.7
**Config:** `vitest.config.ts` (project root)
**Assertion library:** Vitest built-in (`expect`)
**Plugin:** `vite-tsconfig-paths` — enables the `@/*` path alias in tests

**Key config settings:**
- `environment: 'node'` — no DOM simulation
- `globals: false` — all vitest symbols must be explicitly imported
- `coverage.provider: 'v8'`

**Run Commands:**
```bash
npm test              # Watch mode (vitest)
npm run test:run      # Single run (vitest run)
npm run test:coverage # Coverage report (vitest run --coverage)
```

## Test File Locations

**Pattern:** Test files live alongside the source file they test.

```
lib/
  dice.ts
  dice.test.ts        ← co-located
  xp.ts
  xp.test.ts          ← co-located
  leveling.ts
  leveling.test.ts    ← co-located

app/actions/
  create-character.ts
  create-character.test.ts   ← co-located
```

**Naming:** `<source-file-name>.test.ts` — no `.spec.ts` files exist.

## Test File Header Convention

Every test file opens with a multi-line banner comment documenting:
- The test scope and ticket ID (e.g., `DICE-05`, `XP-05`, `LVL-01 + LVL-05`)
- What is and is not mocked
- The vitest globals requirement

Example:
```typescript
// ─── Dice Engine Unit Tests (DICE-05) ────────────────────────────────────────
// Tests all five exports of lib/dice.ts at boundary conditions.
// Uses injectable rollFn for all rollD20Check tests — no vi.spyOn or vi.mock.
// Requires explicit vitest imports (globals: false in vitest.config.ts).
```

## Test Structure

**Suite organization:** `describe` blocks group tests by function name. One `describe` block per exported function.

**Test naming:** `it(...)` descriptions are full human-readable sentences that include the input values and expected output, often with explanatory notes inline:
```typescript
it('score 9 → -1 (borderline: floor((9-10)/2) = floor(-0.5) = -1)', () => { ... })
it('level 5 → null (at level cap — no next level)', () => { ... })
```

**Imports:**
```typescript
import { describe, it, expect } from 'vitest'   // always explicit — no globals
import { functionUnderTest } from './module'
```

## What Is Tested

**`lib/dice.ts`** — `lib/dice.test.ts` (199 lines, ~30 test cases)
- `rollDie`: boundary values over 100 iterations
- `rollDice`: roll count, total sum correctness
- `abilityModifier`: all D&D 5e boundary scores (1, 8, 9, 10, 11, 12, 15, 20)
- `proficiencyBonus`: levels 1–5 with step-function boundary at L4→L5
- `rollD20Check`: success/failure at DC boundary, critical/fumble flags, dcType preservation, edge cases (nat 20 no auto-succeed on skill checks, fumble with high total)

**`lib/xp.ts`** — `lib/xp.test.ts` (116 lines, ~20 test cases)
- `computeLevel`: all 5 threshold boundaries (one below, exactly at, one above), cap behavior, negative XP
- `xpForNextLevel`: all levels 1–5 including null at cap
- `XP_THRESHOLDS`: length and exact values
- `XP_BY_DIFFICULTY`: all three difficulty keys

**`lib/leveling.ts`** — `lib/leveling.test.ts` (355 lines, ~70 test cases)
- `HIT_DIE_BY_CLASS`: all 4 classes (Fighter, Rogue, Cleric, Wizard) verify `{ die, avg }`
- `maxHpAtLevel`: level-1 base cases for all 4 classes; full 4×5×3 fixture grid (4 classes × 5 levels × 3 CON modifiers: -2, 0, +3); multi-level-up integration path; unknown class throws with descriptive message
- `proficiencyBonus` re-export: levels 1–5

**`app/actions/create-character.test.ts`** — (37 lines, 5 test cases)
- Does NOT import or call `createCharacter` directly — tests the underlying `maxHpAtLevel` computation that `create-character.ts` must use at level 1.
- Serves as an integration contract test: the action must call `maxHpAtLevel(characterClass, constitution, 1)`.

## Mocking

**No mocks for lib functions.** `lib/dice.ts`, `lib/xp.ts`, and `lib/leveling.ts` are all pure functions with no side effects — no `vi.mock` or `vi.spyOn` anywhere.

**Injectable rollFn pattern:** `rollD20Check` accepts an optional `rollFn: () => number` parameter. Tests pass a deterministic arrow function instead of mocking:
```typescript
const result = rollD20Check(3, 14, 'AC', () => 14)  // fixed roll of 14
```

**No database mocking:** The `create-character.test.ts` test avoids calling the actual server action (which requires Prisma + Supabase). It tests the math function directly.

## Coverage Configuration

**Coverage scope (included):**
- `lib/**` — all lib files
- `app/actions/**` — all server actions

**Coverage scope (excluded):**
- `lib/prisma.ts` — infrastructure singleton
- `lib/supabase-*.ts` — auth infrastructure
- `lib/ai-config.ts` — constants file
- `**/*.d.ts` — type declarations

## What Is NOT Tested

**Client components** — no tests exist for:
- `components/character-form.tsx`
- `components/character-list.tsx`
- `components/login-screen.tsx`
- `components/map-renderer.tsx`
- `components/user-menu.tsx`

**Server actions with I/O** — no tests exist for:
- `app/actions/take-turn.ts` (requires Anthropic SDK + Prisma + Supabase)
- `app/actions/initialize-game.ts`
- `app/actions/start-game.ts`
- `app/actions/join-game.ts`
- `app/actions/delete-character.ts`
- `app/actions/get-characters.ts`
- All other actions in `app/actions/`

**Pages** — no tests for any `app/**/page.tsx` files.

**E2E** — no Playwright or Cypress setup detected.

## Test Count Summary

| File | Test Cases (approx.) |
|------|---------------------|
| `lib/dice.test.ts` | ~30 |
| `lib/xp.test.ts` | ~20 |
| `lib/leveling.test.ts` | ~70 |
| `app/actions/create-character.test.ts` | 5 |
| **Total** | **~125** |

## Known Test Gaps

- All server actions that call Prisma or Supabase are untested. The pattern for adding tests would require either: (a) integration tests with a real test database, or (b) dependency injection refactors to allow mock DB clients.
- `lib/combat-effect.ts` and `lib/character-sheet.ts` have no test files despite containing business logic.
- `lib/ai-config.ts` is excluded from coverage — its constants are tested indirectly via action behavior.

---

*Testing analysis: 2026-05-23*
