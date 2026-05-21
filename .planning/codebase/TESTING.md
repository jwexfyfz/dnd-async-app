# Testing

**Analysis Date:** 2026-05-20

## Framework

**Runner:** None installed.

No test framework is present in the project. `package.json` lists no test runner (`jest`, `vitest`, `mocha`, etc.) in either `dependencies` or `devDependencies`. No config files were found:
- `jest.config.*` — absent
- `vitest.config.*` — absent
- `.mocharc.*` — absent

**Test script:** The `package.json` `scripts` block has no `"test"` key. The `CLAUDE.md` references `npm run test` as the verification command, but this script does not exist — running it will produce an `npm error Missing script: "test"`.

## Test Types & Organization

**Unit tests:** None.

**Integration tests:** None.

**E2E tests:** None.

**Test files found:** Zero files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` exist anywhere in the repository outside of `node_modules`.

## Coverage Areas

No code has automated test coverage. The following logic areas exist in the codebase with no tests:

**Server Actions (`app/actions/`):**
- `create-character.ts` — Point Buy stat validation, auth guard, Prisma upsert + create flow
- `get-characters.ts` — Auth guard, Prisma query with relation include
- `get-story-prompts.ts` — Prisma findMany, unauthenticated access
- `start-game.ts` — Auth guard, duplicate game prevention, character ownership check, HP calculation (`conModifier = Math.floor((constitution - 10) / 2)`), initial game state construction

**Game Logic:**
- `getStatCost()` in `components/character-form.tsx` — D&D 5e Point Buy cost table (1 point per level up to 13, 2 points per level for 14-15)
- `handleStatChange()` — Boundary enforcement (min 8, max 15, pool exhaustion)

**Auth Flow (`app/page.tsx`):**
- OAuth hash token extraction and `setSession` call
- `onAuthStateChange` subscription lifecycle

**Database Utilities (`lib/`):**
- `lib/prisma.ts` — Singleton pattern, adapter initialization
- `lib/supabase-server.ts` — Cookie read/write integration

## Gaps

Every feature in the application is untested. High-priority gaps by risk level:

**Critical — pure logic with no side effects (easiest to add unit tests):**
- `getStatCost(currentValue, isIncrementing)` in `components/character-form.tsx` — Six boundary cases (increment from 13, 14; decrement from 14, 15; normal increment; normal decrement)
- HP calculation in `app/actions/start-game.ts` — `Math.floor((constitution - 10) / 2)` across stat range 8–15

**High — server action validation logic:**
- `createCharacter`: blank name, missing class, invalid stat values, unauthenticated call
- `startGame`: duplicate game guard, character ownership mismatch, missing story prompt

**Medium — integration paths:**
- Auth callback route (`app/auth/callback/route.ts`) — redirects to `/`
- Prisma singleton initialization when `DATABASE_URL` is missing (throws immediately)

**Low — UI rendering:**
- `CharacterList` empty state, loading state
- `CharacterForm` error display states

## Running Tests

No test command is available. To add testing:

1. Install a test runner (Vitest is recommended for Next.js/ESM projects):
   ```bash
   npm install --save-dev vitest @vitejs/plugin-react
   ```

2. Add a script to `package.json`:
   ```json
   "scripts": {
     "test": "vitest run",
     "test:watch": "vitest"
   }
   ```

3. Create a `vitest.config.ts` at the project root.

The `CLAUDE.md` instruction `npm run test` will fail until a test framework is installed and a `"test"` script is added to `package.json`.

---

*Testing analysis: 2026-05-20*
