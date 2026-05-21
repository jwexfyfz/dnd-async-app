# External Integrations

**Analysis Date:** 2026-05-20

## Services

| Service | Purpose | SDK/Client |
|---------|---------|------------|
| Supabase Auth | User authentication — Google OAuth provider, session management via cookies | `@supabase/ssr` 0.10.3 |
| Supabase PostgreSQL | Hosted PostgreSQL — pooled connection for runtime queries | Prisma 7.8.0 via `@prisma/adapter-neon` |
| Neon Serverless | WebSocket database transport layer (underlies Supabase Postgres connection) | `@neondatabase/serverless` 1.1.0 |
| Anthropic API | AI Dungeon Master — generates opening narration and turn-by-turn narrative responses | `@anthropic-ai/sdk` 0.97.1 |
| Google OAuth | Login identity provider (routed through Supabase, no direct Google SDK) | Supabase auth endpoint redirect |
| Google Fonts | Typography — Geist Sans and Geist Mono served via CDN | `next/font/google` (Next.js built-in) |
| Vercel | Frontend hosting and serverless function execution environment | Next.js deploy target (no SDK) |

**Planned but not yet implemented (per CLAUDE.md):**
- Resend — transactional email turn notifications (no `resend` package in `package.json`, no implementation found)
- Discord Webhooks — turn notifications (no implementation found in any source file)

## Environment Variables

All variables are loaded from `.env.local` (file is present; contents not read). No `.env.example` file exists — variable names are inferred from source code references.

| Variable | Usage | Scope | Source File |
|----------|-------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project base URL — used to construct OAuth redirect and by both auth clients | Public (browser-exposed) | `lib/supabase-client.ts`, `lib/supabase-server.ts`, `components/login-screen.tsx` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key — used by both browser and server auth clients | Public (browser-exposed) | `lib/supabase-client.ts`, `lib/supabase-server.ts` |
| `DATABASE_URL` | Neon WebSocket connection string — used by Prisma runtime client | Server-only secret | `lib/prisma.ts`, `prisma/seed.mjs` |
| `DIRECT_URL` | Direct TCP connection string (port 5432) — used by Prisma CLI for migrations | Server-only secret | `prisma.config.ts` |

**Note:** `ANTHROPIC_API_KEY` is not explicitly referenced in source code — the `@anthropic-ai/sdk` reads it automatically from the environment via its default behavior (`new Anthropic()` with no constructor args in `app/actions/take-turn.ts` and `app/actions/initialize-game.ts`).

## Auth Flow

**Provider:** Google OAuth via Supabase

**Flow:**
1. User clicks "Sign in with Google" in `components/login-screen.tsx`
2. Browser is redirected to `{NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={origin}/auth/callback`
3. After Google authenticates, Supabase redirects to `GET /auth/callback`
4. `app/auth/callback/route.ts` immediately redirects browser to `/` (homepage) — preserving `#access_token=...` in the URL hash
5. Homepage (`app/page.tsx`) detects the hash fragment and calls `supabaseBrowser.auth.setSession()` to write session cookies
6. All server actions call `createSupabaseServerClient()` from `lib/supabase-server.ts` to verify the session via HTTP cookies before any database operation

**Session management:**
- Browser-side: `lib/supabase-client.ts` — singleton `supabaseBrowser` (`createBrowserClient`)
- Server-side: `lib/supabase-server.ts` — per-request client (`createServerClient`) reading and writing HTTP cookies; cookie writes fail silently in server components (only succeed in server actions and route handlers)

## Database Connection Architecture

Two separate connection strings serve distinct purposes:

| Variable | Transport | Used By | Purpose |
|----------|-----------|---------|---------|
| `DATABASE_URL` | Neon WebSocket (`PrismaNeon` adapter) | `lib/prisma.ts`, `prisma/seed.mjs` | Runtime queries from serverless functions |
| `DIRECT_URL` | Standard TCP (`pg`, port 5432) | `prisma.config.ts` | Prisma CLI — migrations, `db push`, introspection |

The Prisma singleton in `lib/prisma.ts` uses `globalThis` caching to prevent connection pool exhaustion during Next.js hot module reloading in development.

## AI Integration Details

**Client instantiation:** `new Anthropic()` with no arguments — API key read from `ANTHROPIC_API_KEY` environment variable automatically.

**Model:** `claude-haiku-4-5` (set in `lib/ai-config.ts` as `DM_MODEL`)

**Usage pattern:** Two server actions call the Anthropic API:
- `app/actions/initialize-game.ts` — generates opening scene narration when a game's message log is empty
- `app/actions/take-turn.ts` — generates narrative response and state deltas per player turn

**Prompt caching:** Static system prompt block sent with `cache_control: { type: "ephemeral" }` to reuse the Anthropic cache across turns for the same game.

**Response format:** Structured JSON (`{ narrative, stateDeltas, chips }`) — raw text fallback if JSON parse fails.

## Webhooks / Callbacks

**Incoming:**
- `GET /auth/callback` — `app/auth/callback/route.ts` — OAuth redirect receiver from Supabase after Google login; redirects immediately to `/`

**Outgoing:**
- None currently implemented. Discord webhooks planned per CLAUDE.md; no code exists.

---

*Integration audit: 2026-05-20*
