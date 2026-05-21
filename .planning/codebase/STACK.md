# Tech Stack

**Analysis Date:** 2026-05-20

## Languages

**Primary:**
- TypeScript 5.x — all application code (`app/`, `lib/`, `components/`, `prisma.config.ts`)
- TSConfig target: ES2017, strict mode enabled, `moduleResolution: bundler`, path alias `@/*` → project root

**Secondary:**
- JavaScript (ESM `.mjs`) — seed script only (`prisma/seed.mjs`)
- CSS — global styles (`app/globals.css`) via Tailwind v4 `@import "tailwindcss"`

## Frameworks & Libraries

**Core Framework:**
- Next.js 16.2.6 — App Router, server actions (`"use server"`), server components, route handlers
  - No `next.config.*` file detected — default Next.js config
  - Dynamic route: `app/game/[id]/` (game view and lobby)
- React 19.2.4 — UI layer (`react`, `react-dom`)
- Fonts: `next/font/google` — Geist Sans and Geist Mono loaded in `app/layout.tsx`

**Styling:**
- TailwindCSS 4.x — utility classes throughout all components
- `@tailwindcss/postcss` v4 — PostCSS plugin; config in `postcss.config.mjs`
- Global styles: `app/globals.css`
- No Shadcn/Radix UI — all UI is hand-rolled with Tailwind

**Authentication:**
- `@supabase/ssr` 0.10.3 — SSR-safe Supabase auth for Next.js
  - Browser client: `lib/supabase-client.ts` (`createBrowserClient`)
  - Server client: `lib/supabase-server.ts` (`createServerClient` with cookie read/write)
- `@supabase/auth-ui-react` 0.4.7 — installed but not used; login UI is custom (`components/login-screen.tsx`)
- `@supabase/auth-ui-shared` 0.1.8 — peer dependency of auth-ui-react

**AI Layer:**
- `@anthropic-ai/sdk` 0.97.1 — direct Anthropic API calls in server actions
  - Used in: `app/actions/take-turn.ts`, `app/actions/initialize-game.ts`
  - Model configured in `lib/ai-config.ts`: `claude-haiku-4-5`; max tokens: 600; rolling context window: 15 messages
  - Prompt caching used: `cache_control: { type: "ephemeral" }` on static system prompt block

**ORM / Database Client:**
- Prisma 7.8.0 — schema at `prisma/schema.prisma`, generated client at `generated/prisma/client/`
- `@prisma/adapter-neon` 7.8.0 — Neon serverless WebSocket adapter; used exclusively in `lib/prisma.ts`
- `@prisma/adapter-pg` 7.8.0 — installed but not used in the runtime path
- `@neondatabase/serverless` 1.1.0 — Neon WebSocket driver (dependency of the Neon adapter)
- `pg` 8.20.0 — raw postgres driver; used by seed and kept as adapter fallback
- `dotenv` 17.4.2 — loads `.env.local` for Prisma CLI (`prisma.config.ts`) and seed script

## Build Tooling

**Bundler:**
- Next.js built-in (Webpack/Turbopack) — no standalone bundler config

**Linter:**
- ESLint 9.x — config at `eslint.config.mjs`
- `eslint-config-next` 16.2.6 — extends `core-web-vitals` and `typescript` presets

**Type Checking:**
- TypeScript compiler — `noEmit: true`, incremental builds; config at `tsconfig.json`

**CSS Build:**
- PostCSS — `postcss.config.mjs` with single plugin `@tailwindcss/postcss`

**No formatter config detected** — no `.prettierrc`, no `biome.json`.

**Prisma CLI:**
- `prisma` 7.8.0 — `postinstall` script runs `prisma generate` after every `npm install`
- CLI configured via `prisma.config.ts` (reads `DIRECT_URL` from `.env.local`)

## Runtime & Environment

**Node.js:**
- Active system version: 24.15.0 (no `.nvmrc` or `.node-version` — version not pinned in repo)

**Execution Model:**
- Server Actions (`"use server"`) — all database mutations and AI calls run as Node.js serverless functions
- Client Components (`"use client"`) — auth state, interactive UI, real-time polling
- Route handlers — auth callback at `app/auth/callback/route.ts`
- No Edge Runtime used (`export const runtime = "edge"` not found anywhere)

**Deployment Target:**
- Vercel — inferred from Next.js App Router + Supabase URL pattern; no `vercel.json` file present
- Database: Neon serverless PostgreSQL (WebSocket adapter confirms serverless-compatible transport)

**Package Manager:**
- npm — `package-lock.json` present (lockfileVersion 3); no `yarn.lock` or `pnpm-lock.yaml`
- `postinstall` hook: `prisma generate` runs automatically on `npm install`

## Key Scripts

```bash
npm run dev          # Start Next.js development server (next dev)
npm run build        # Production build (next build)
npm run start        # Start production server (next start)
npm run lint         # Run ESLint (eslint)
npm run db:push      # Push schema to database without migration (prisma db push)
npm run db:seed      # Seed maps and story prompts (node prisma/seed.mjs)
npx prisma migrate dev   # Run database migrations (per CLAUDE.md)
```

---

*Stack analysis: 2026-05-20*
