# Technology Stack

**Analysis Date:** 2026-05-23

## Languages

**Primary:**
- TypeScript ^5 — all source files (`app/`, `lib/`, `prisma/*.ts`)
- JavaScript (ESM) — seed scripts (`prisma/seed.mjs`, `prisma/dev-boost-xp.mjs`)

## Runtime

**Environment:**
- Node.js ^20 (inferred from `@types/node: ^20`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js 16.2.6 — App Router, server actions, route handlers
- React 19.2.4 / react-dom 19.2.4 — UI rendering

**Testing:**
- Vitest ^4.1.7 — test runner, node environment
- @vitest/coverage-v8 ^4.1.7 — V8-based coverage reports
- vite-tsconfig-paths ^6.1.1 — path alias resolution in tests

**Build/Dev:**
- `next dev` — development server
- `next build` / `next start` — production build and serve
- `prisma generate` — runs automatically on `postinstall`

## Key Dependencies

**Critical:**
- `next` 16.2.6 — framework
- `react` 19.2.4 — UI
- `@prisma/client` ^7.8.0 — database ORM client
- `@anthropic-ai/sdk` ^0.97.1 — AI DM calls

**Infrastructure:**
- `@prisma/adapter-neon` ^7.8.0 — Neon serverless Postgres adapter for Prisma 7
- `@neondatabase/serverless` ^1.1.0 — underlying Neon WebSocket driver
- `@prisma/adapter-pg` ^7.8.0 — pg adapter (present as fallback; Neon is primary)
- `pg` ^8.20.0 — node-postgres, marked as `serverExternalPackages` in `next.config.ts`
- `dotenv` ^17.4.2 — loaded by `prisma.config.ts` to expose `.env.local` to Prisma CLI

**Auth:**
- `@supabase/ssr` ^0.10.3 — SSR-compatible Supabase client (cookie-based session)
- `@supabase/auth-ui-react` ^0.4.7 — pre-built auth UI components
- `@supabase/auth-ui-shared` ^0.1.8 — shared theme/styles for auth UI

## CSS

**Framework:**
- Tailwind CSS ^4 — utility classes, v4 (PostCSS plugin approach)
- `@tailwindcss/postcss` ^4 — PostCSS integration
- Config: `postcss.config.mjs`
- Global styles: `app/globals.css`

## Linting

- ESLint ^9 — flat config format via `eslint.config.mjs`
- `eslint-config-next` 16.2.6 — includes `core-web-vitals` and `typescript` rulesets
- No Prettier config detected

## TypeScript Config

- Target: ES2017
- Module resolution: `bundler`
- Strict mode: enabled
- Path alias: `@/*` → `./*` (root-relative)
- Config: `tsconfig.json`

## Database

**ORM:**
- Prisma ^7.8.0 — schema at `prisma/schema.prisma`
- Adapter: `PrismaNeon` from `@prisma/adapter-neon` (serverless WebSocket connection)
- Client singleton: `lib/prisma.ts` (global var pattern, prevents hot-reload re-instantiation)
- Prisma config: `prisma.config.ts` — loads `.env.local`, sets `DIRECT_URL` for CLI migrations

**Schema models:** `User`, `Character`, `Map`, `StoryPrompt`, `Game`, `PartyMember`, `Message`, `ClassProgression`, `ClassFeature`

**Seed scripts:**
- `prisma/seed.mjs` — primary seed (run via `npm run db:seed`)
- `prisma/seed-backfill-maxhp.mjs` — back-fill maxHp column
- `prisma/dev-boost-xp.mjs` — dev-only XP manipulation
- `prisma/seed-class-progression.ts` — class progression table

## Build Scripts

| Script | Command |
|--------|---------|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `eslint` |
| `test` | `vitest` (watch) |
| `test:run` | `vitest run` |
| `test:coverage` | `vitest run --coverage` |
| `postinstall` | `prisma generate` |
| `db:push` | `prisma db push` |
| `db:seed` | `node prisma/seed.mjs` |
| `db:backfill-maxhp` | `node prisma/seed-backfill-maxhp.mjs` |
| `db:boost-xp` | `node prisma/dev-boost-xp.mjs` |

## Platform Requirements

**Development:**
- Node ^20, npm, `.env.local` with 5 required vars (see INTEGRATIONS.md)

**Production:**
- Serverless-compatible Node runtime (Neon adapter uses WebSockets, not persistent pools)
- `pg` and `dotenv` declared as `serverExternalPackages` in `next.config.ts` to avoid edge bundling

---

*Stack analysis: 2026-05-23*
