# Tech Stack

**Analysis Date:** 2026-05-20

## Languages

**Primary:**
- TypeScript 5.9.3 — all application code (`app/`, `lib/`, `components/`, `prisma.config.ts`)
- Target: ES2017, strict mode enabled, `moduleResolution: bundler`

**Secondary:**
- JavaScript (ESM `.mjs`) — seed script only (`prisma/seed.mjs`)

## Frameworks & Libraries

**Core Frontend:**
- Next.js 16.2.6 — App Router; hosted on Vercel
  - Config: `next.config.ts`
  - `serverExternalPackages: ["pg", "dotenv"]` (prevents bundling native node packages)
  - Uses Google Fonts via `next/font/google` (Geist Sans, Geist Mono)
- React 19.2.4 — UI layer (`react`, `react-dom`)

**Styling:**
- TailwindCSS 4.3.0 — utility-first CSS
  - PostCSS plugin: `@tailwindcss/postcss` ^4
  - Config: `postcss.config.mjs`
  - Global styles: `app/globals.css`

**Auth:**
- `@supabase/ssr` 0.10.3 — Supabase auth for Next.js (SSR-safe)
  - Browser client: `lib/supabase-client.ts` (uses `createBrowserClient`)
  - Server client: `lib/supabase-server.ts` (uses `createServerClient` with cookies)
- `@supabase/auth-ui-react` 0.4.7 — installed but not actively used in current UI (login implemented manually)
- `@supabase/auth-ui-shared` 0.1.8 — peer dependency of auth-ui-react

**Database / ORM:**
- Prisma 7.8.0 — ORM and schema management
  - Schema: `prisma/schema.prisma`
  - Prisma CLI config: `prisma.config.ts` (points CLI at `DIRECT_URL` on port 5432)
  - Generated client: `generated/prisma/client/`
- `@prisma/adapter-neon` 7.8.0 — Neon serverless adapter used by the runtime client (`lib/prisma.ts`)
- `@prisma/adapter-pg` 7.8.0 — installed, not actively used in runtime path
- `@neondatabase/serverless` 1.1.0 — Neon WebSocket driver (dependency of the Neon adapter)
- `pg` 8.20.0 — node-postgres (used by `@prisma/adapter-pg` and kept as server external package)

**Environment:**
- `dotenv` 17.4.2 — loads `.env.local` for Prisma CLI and seed script

## Build Tooling

**Bundler:**
- Next.js built-in (Webpack / Turbopack via `next dev` / `next build`)

**Linter:**
- ESLint 9 with `eslint-config-next` 16.2.6
  - Config: `eslint.config.mjs`
  - Rulesets: `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`

**Type Checking:**
- TypeScript compiler (tsc) — `noEmit: true`, incremental builds
  - Config: `tsconfig.json`
  - Path alias: `@/*` maps to project root

**No formatter config detected** (no `.prettierrc`, no `biome.json`).

## Runtime & Environment

**Node.js:**
- Active version: 24.15.0 (no `.nvmrc` or `.node-version` file — version not pinned)

**Execution model:**
- Server Actions (`"use server"`) for all database mutations — run as Node.js serverless functions on Vercel
- Client components (`"use client"`) for auth state, forms, and UI
- Route handlers for auth callback: `app/auth/callback/route.ts`
- No Edge Runtime used — all server code targets Node.js

**Package Manager:**
- npm (lockfile: `package-lock.json` present)
- `postinstall` hook runs `prisma generate` automatically after `npm install`

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
