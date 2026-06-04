# Stack Research: Testing Setup

**Project:** Async AI D&D Web App
**Researched:** 2026-05-21
**Sources:** Official Next.js 16.2.6 Vitest guide (fetched live, dated 2026-05-19), project file inspection

---

## Recommendation

Use **Vitest** (not Jest). The official Next.js 16 documentation explicitly recommends Vitest for unit testing and provides a maintained `with-vitest` example. Jest requires `babel-jest` or `ts-jest` plus manual ESM transform configuration to handle the project's `moduleResolution: bundler` and `module: esnext` tsconfig settings — that is several extra packages and a non-trivial config burden. Vitest is Vite-native, handles ESM transparently, understands `paths` aliases from tsconfig via `vite-tsconfig-paths`, and starts significantly faster. For this project's immediate goal (pure TS function unit tests with zero React component tests), Vitest is the unambiguous choice.

**For the dice engine, XP math, and proficiency bonus functions specifically:** these are pure TypeScript with no framework dependencies. The test environment should be `node`, not `jsdom`. The `@vitejs/plugin-react` and `@testing-library/*` packages are only needed if you later add React component tests — they are unnecessary weight for the current scope.

---

## Packages Required

Install as dev dependencies:

```bash
npm install -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

| Package | Version | Purpose |
|---|---|---|
| `vitest` | `^3.x` (latest stable) | Test runner, assertion library, watch mode |
| `@vitest/coverage-v8` | `^3.x` (match vitest version) | Coverage via V8 (no Babel transform needed, works with native ESM) |
| `vite-tsconfig-paths` | `^5.x` | Resolves `@/*` path aliases from tsconfig so imports work in tests |

**Do not install yet:**
- `@vitejs/plugin-react` — not needed until React component tests are added
- `jsdom` — not needed for pure TS unit tests
- `@testing-library/react` — not needed for pure TS unit tests
- `jest`, `ts-jest`, `babel-jest` — avoid entirely

**Why `@vitest/coverage-v8` over `@vitest/coverage-istanbul`:**
V8 coverage runs natively inside Node without instrumentation transforms. Istanbul requires Babel transforms that can interfere with ESM. V8 is the correct choice for this TypeScript + ESM stack.

---

## Minimal Config

Place this at the project root as `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/generated/**',
      '**/.next/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/actions/**'],
      exclude: [
        'lib/prisma.ts',
        'lib/supabase-*.ts',
        'lib/ai-config.ts',
        '**/*.d.ts',
      ],
    },
  },
})
```

**Key decisions in this config:**

- `environment: 'node'` — Pure TS game logic does not need a DOM. Using `jsdom` adds startup overhead and is semantically wrong for server-side math functions.
- `globals: false` — Explicit imports (`import { describe, it, expect } from 'vitest'`) are preferred in strict TypeScript to avoid polluting the global type namespace without `/// <reference types="vitest/globals" />`.
- `include` targets `.test.ts` and `.spec.ts` — keeps both colocation and `__tests__` directory patterns viable.
- `exclude` for `generated/**` — the Prisma generated client directory contains large auto-generated files that should never be test targets.
- `coverage.include` scoped to `lib/**` and `app/actions/**` — prevents coverage noise from Next.js page files, config files, and Prisma migrations.
- `coverage.exclude` for `lib/prisma.ts` — this file throws at import time if `DATABASE_URL` is missing (see Prisma Gotchas below). Excluding it from coverage prevents accidental execution.

Add the test script to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

Use `test:run` (not `test`) in CI — `vitest` alone enters watch mode which hangs non-interactive terminals.

---

## File Organization

**Recommendation: colocate test files next to the source file they test.**

```
lib/
  dice.ts
  dice.test.ts          <- lives beside the implementation
  xp.ts
  xp.test.ts
  proficiency.ts
  proficiency.test.ts
```

This pattern is idiomatic for the Vite/Vitest ecosystem and is explicitly acknowledged as valid in the official Next.js docs ("test files can also be colocated inside the app router"). The alternative `__tests__/` directory at the project root is the Jest convention; it requires navigating away from the source file constantly and creates import path noise (`../../lib/dice`). With colocation, the import is always `import { rollD20 } from './dice'`.

The only case for a top-level `__tests__/` folder is integration tests that span multiple modules — if server action integration tests are added later, put them in `__tests__/integration/` to signal their different nature.

**Concrete layout for this milestone:**

```
lib/
  dice.ts               <- rollD20(), rollDice(), applyModifier()
  dice.test.ts
  xp.ts                 <- XP thresholds, grantXP(), levelFromXp()
  xp.test.ts
  leveling.ts           <- autoLevelUp(), proficiencyBonusForLevel()
  leveling.test.ts
  skills.ts             <- applyProficiencyBonus(), resolveSkillCheck()
  skills.test.ts
__tests__/
  integration/          <- (future) server action integration tests
```

---

## Prisma Gotchas

**Gotcha 1: `lib/prisma.ts` throws at import time if `DATABASE_URL` is unset.**

The current `lib/prisma.ts` throws `Error: CRITICAL ERR: DATABASE_URL environment variable is missing!` immediately when the module is imported, before any test code runs. Any test file that directly or transitively imports `lib/prisma.ts` will fail with this error in CI and local environments without a `.env.local`.

**Solution: keep pure game logic in files that never import `lib/prisma.ts`.**

The dice engine, XP math, and proficiency bonus modules (`lib/dice.ts`, `lib/xp.ts`, `lib/leveling.ts`, `lib/skills.ts`) should have zero imports from `lib/prisma.ts`. They are pure functions. If they need types from the Prisma schema (e.g., a `Character` type), import only the type:

```ts
// Safe — type-only import is erased at runtime, no DB connection triggered
import type { Character } from '@prisma/client'
```

**Gotcha 2: `@prisma/client` resolves to the generated client at `./generated/prisma/client/`.**

The schema uses the default `provider = "prisma-client-js"` without a custom `output` path in the generator block. However, Prisma 7 with the Neon adapter appears to generate into `./generated/prisma/client/` based on the directory inspection. Verify the import path used in `lib/prisma.ts` (`@prisma/client`) resolves correctly under Vitest.

If Vitest cannot resolve `@prisma/client` to the generated output, add an alias in `vitest.config.ts`:

```ts
// Only needed if @prisma/client import resolution fails in Vitest
resolve: {
  alias: {
    '@prisma/client': path.resolve(__dirname, 'generated/prisma/client'),
  },
},
```

**Gotcha 3: Server action integration tests require mocking `lib/prisma.ts` and Supabase auth.**

`take-turn.ts` and similar server actions import both `lib/prisma.ts` and `lib/supabase-server.ts`. Testing these requires `vi.mock()` for both modules, plus a test environment variable for `DATABASE_URL`. This is materially harder than unit-testing pure functions. The official Next.js docs note that `async` Server Components are not supported in Vitest — defer server action integration tests to a later phase and use E2E tools (Playwright) when that testing is needed.

**Gotcha 4: `"use server"` directive in action files is a Next.js compiler annotation.**

Vitest's Vite pipeline does not process `"use server"` directives. Importing a server action file directly in a test will work (the string is just ignored by the TS/Vite compiler), but the test will not have Next.js's server action security context. This is fine for testing pure business logic extracted out of the action, but is why direct server action testing is discouraged.

---

## Confidence

**Overall: HIGH**

| Area | Confidence | Reasoning |
|---|---|---|
| Vitest vs Jest recommendation | HIGH | Official Next.js 16 docs (fetched 2026-05-19) explicitly recommend Vitest. ESM/TypeScript friction with Jest is well-documented. |
| Minimal config | HIGH | Config derived from official Next.js guide + confirmed against actual tsconfig and project structure. The `node` environment choice is certain for pure TS functions. |
| File organization | HIGH | Colocation is explicitly validated by Next.js docs. Consistent with Vitest/Vite community convention. |
| Prisma import-at-module-load throw | HIGH | Directly observed in `lib/prisma.ts` — the `throw` on line 7 is unconditional on import. This will break any test that transitively imports it. |
| Prisma generated client path | MEDIUM | Generator block has no `output` override in schema, but the generated directory at `./generated/prisma/client/` suggests the Prisma 7 default changed or `prisma.config.ts` influences it. Worth verifying `@prisma/client` resolves correctly after install. |
| Server action integration tests | MEDIUM | Pattern is known but untested in this specific project. Defer until pure unit tests are stable. |
