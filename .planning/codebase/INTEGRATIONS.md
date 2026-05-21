# External Integrations

**Analysis Date:** 2026-05-20

## Services

| Service | Purpose | SDK/Client |
|---------|---------|------------|
| Supabase Auth | User authentication (Google OAuth) | `@supabase/ssr` 0.10.3 |
| Supabase PostgreSQL | Hosted PostgreSQL database (connection pooler) | Prisma via `@prisma/adapter-neon` |
| Neon (via Supabase) | Serverless WebSocket database transport | `@neondatabase/serverless` 1.1.0 |
| Vercel | Frontend hosting and serverless function execution | Next.js built-in deploy target |
| Google OAuth | Login provider via Supabase | No direct SDK — redirect to Supabase auth endpoint |
| Google Fonts | Typography (Geist Sans, Geist Mono) | `next/font/google` |

**Planned but not yet implemented (per CLAUDE.md):**
- Anthropic Claude 3.5 Haiku — AI DM for intent parsing and narration (no SDK found in `package.json`)
- Resend — transactional email notifications (no SDK found)
- Discord Webhooks — turn notifications (no implementation found)

## Environment Variables

| Variable | Usage | Scope |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — used by both browser and server clients | Public (exposed to browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key — used by both browser and server clients | Public (exposed to browser) |
| `DATABASE_URL` | Neon/Supabase connection pooler URL (port 6543 or WebSocket) — used by Prisma runtime client in `lib/prisma.ts` and seed script | Server-only secret |
| `DIRECT_URL` | Direct database URL (port 5432) — used by Prisma CLI for migrations via `prisma.config.ts` | Server-only secret |

All variables are loaded from `.env.local` (present, never read). No `.env.example` file exists — variable names are inferred exclusively from source code references.

## Auth Flow

**Provider:** Google OAuth via Supabase

**Flow:**
1. User clicks "Sign in with Google" in `components/login-screen.tsx`
2. Browser is redirected to `{SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={origin}/auth/callback`
3. After OAuth, Supabase redirects to `/auth/callback` — `app/auth/callback/route.ts` immediately redirects to `/` (homepage)
4. Homepage (`app/page.tsx`) detects `#access_token=...` in URL hash, calls `supabaseBrowser.auth.setSession()` to write session cookies
5. All subsequent server actions call `createSupabaseServerClient()` from `lib/supabase-server.ts` to validate session via cookies

**Session management:**
- Browser-side: `lib/supabase-client.ts` — singleton `supabaseBrowser` using `createBrowserClient`
- Server-side: `lib/supabase-server.ts` — per-request `createServerClient` reading/writing HTTP cookies

## Database Connection Architecture

Two separate connection strings serve two different purposes:

| Variable | Transport | Port | Used By |
|----------|-----------|------|---------|
| `DATABASE_URL` | Neon WebSocket (`PrismaNeon` adapter) | varies | Runtime: `lib/prisma.ts` |
| `DIRECT_URL` | Standard TCP (`pg`) | 5432 | Prisma CLI: `prisma.config.ts` (migrations, db push) |

The Prisma client singleton in `lib/prisma.ts` uses `globalThis` caching to prevent exhausting connection limits during Next.js hot reload in development.

## Webhooks / Callbacks

**Incoming:**
- `GET /auth/callback` — `app/auth/callback/route.ts` — OAuth redirect receiver from Supabase after Google login. Immediately redirects to `/` to let client-side code capture the hash tokens.

**Outgoing:**
- None currently implemented. Discord webhooks and Resend email are planned per CLAUDE.md but have no code yet.

---

*Integration audit: 2026-05-20*
