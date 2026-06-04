# External Integrations

**Analysis Date:** 2026-05-23

## Supabase Auth

**Purpose:** User authentication (Google OAuth + email/password)

**Package:** `@supabase/ssr` ^0.10.3

**Server client** — `lib/supabase-server.ts`:
- Uses `createServerClient` from `@supabase/ssr`
- Creates a fresh instance per request (not a singleton)
- Reads session from HTTP cookies via `next/headers` `cookies()` store
- Writes refreshed session tokens back via `cookieStore.set()` — silently no-ops in server components where writes are blocked
- Used by every server action to verify the caller before any DB access:
  ```ts
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };
  ```

**Browser client** — `lib/supabase-client.ts`:
- Uses `createBrowserClient` from `@supabase/ssr`
- Singleton exported as `supabaseBrowser`
- Used for auth state management in React components

**Auth callback** — `app/auth/callback/route.ts`:
- GET handler at `/auth/callback`
- Redirects to `origin/` to allow the homepage inline script to capture the `#access_token=` fragment

**Environment vars:**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (exposed to browser)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public anon key (exposed to browser)

**No middleware:** There is no `middleware.ts` in this project. Route protection is handled per-action via `supabase.auth.getUser()` checks inside each server action.

---

## Prisma + Neon

**Purpose:** PostgreSQL ORM over Neon serverless Postgres

**Packages:** `@prisma/client` ^7.8.0, `@prisma/adapter-neon` ^7.8.0, `@neondatabase/serverless` ^1.1.0

**Client singleton** — `lib/prisma.ts`:
- Adapter: `PrismaNeon({ connectionString })` — uses WebSocket connection, not a pg pool
- Global var pattern (`globalForPrisma`) prevents multiple Prisma instances during Next.js hot reload
- Throws immediately at module load if `DATABASE_URL` is missing

**Prisma CLI config** — `prisma.config.ts`:
- Loads `.env.local` via `dotenv` before Prisma CLI reads env vars
- Uses `DIRECT_URL` (not `DATABASE_URL`) for migrations — Neon's pooled URL does not support migrations

**Schema** — `prisma/schema.prisma`:
- Provider: `postgresql`
- 9 models: `User`, `Character`, `Map`, `StoryPrompt`, `Game`, `PartyMember`, `Message`, `ClassProgression`, `ClassFeature`
- Game state stored as `Json` column on `Game.state`; AI writes `stateDeltas` into it each turn
- Optimistic concurrency: `Game.version Int` — incremented every state write; `takeTurn` throws `STALE_TURN` if version changed since read

**next.config.ts:**
- `serverExternalPackages: ["pg", "dotenv"]` — prevents bundling of native pg and dotenv by Next.js

**Environment vars:**
- `DATABASE_URL` — Neon pooled connection string (runtime queries)
- `DIRECT_URL` — Neon direct connection string (Prisma CLI migrations only)

---

## Anthropic SDK (AI DM)

**Purpose:** Powers the Dungeon Master narrative engine

**Package:** `@anthropic-ai/sdk` ^0.97.1

**Client** — module-level singleton in `app/actions/take-turn.ts`:
```ts
const anthropic = new Anthropic({ maxRetries: 4 });
```
- `maxRetries: 4` provides SDK exponential backoff for 529 overload errors
- API key read from `ANTHROPIC_API_KEY` env var (SDK default)

**Model config** — `lib/ai-config.ts`:
- Model: `claude-haiku-4-5`
- Max tokens per response: `600`
- Rolling context window: last `15` messages sent to the API

**How it's called** — `app/actions/take-turn.ts`:
- `anthropic.messages.create()` with a two-block `system` prompt:
  1. Static block (character sheet + map + scenario + response rules) — marked `cache_control: { type: "ephemeral" }` for prompt caching
  2. Dynamic block (current game state + dice result)
- `messages` array: last 15 `Message` rows, mapped `PLAYER → user`, `DUNGEON_MASTER → assistant`
- Response format: raw JSON object `{ narrative, stateDeltas, chips, encounterResult }` optionally followed by `<combat_effect>` XML tags
- Dice rolls happen in code before the API call; AI is required to narrate around the result, never invent one

**Environment vars:**
- `ANTHROPIC_API_KEY` — secret, server-side only (no `NEXT_PUBLIC_` prefix)

---

## Next.js App Router

**Route structure:**

| Route | File | Type |
|-------|------|------|
| `/` | `app/page.tsx` | Server component (homepage) |
| `/play` | `app/play/page.tsx` | Character/game selection |
| `/create-character` | `app/create-character/page.tsx` | Character creation form |
| `/game/[id]` | `app/game/[id]/page.tsx` | Active game view |
| `/game/[id]/lobby` | `app/game/[id]/lobby/page.tsx` | Pre-game lobby |
| `/auth/callback` | `app/auth/callback/route.ts` | GET — OAuth redirect handler |
| `/api/resolveCombat` | `app/api/resolveCombat/route.ts` | POST — apply combat HP delta |

**Layout files:**
- `app/layout.tsx` — root layout
- `app/game/layout.tsx` — game section layout

**Server actions** — `app/actions/`:

| Action | Purpose |
|--------|---------|
| `take-turn.ts` | Main game loop: dice → AI DM → state write |
| `initialize-game.ts` | Create a new `Game` record |
| `start-game.ts` | Start game from character select |
| `start-adventure.ts` | Transition LOBBY → ACTIVE, assign turn order by DEX |
| `join-game.ts` | Add a player to a party |
| `leave-game.ts` | Remove caller from party |
| `kick-player.ts` | Host removes another player |
| `set-ready.ts` | Mark caller as READY in lobby |
| `create-character.ts` | Create a new `Character` |
| `delete-character.ts` | Delete a `Character` |
| `get-characters.ts` | Fetch characters for current user |
| `get-game.ts` | Fetch a single game with messages |
| `get-story-prompts.ts` | Fetch available `StoryPrompt` rows |
| `get-class-reference.ts` | Fetch `ClassProgression` + `ClassFeature` for a class |

**All server actions:**
- Begin with `"use server"` directive
- Call `createSupabaseServerClient()` and `supabase.auth.getUser()` for auth verification
- Access the database via the `prisma` singleton from `lib/prisma.ts`

---

## Environment Variables

All secrets are stored in `.env.local` (not committed). Five variables are required at runtime:

| Variable | Scope | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | Server | Neon pooled connection string — runtime queries |
| `DIRECT_URL` | CLI only | Neon direct connection — Prisma migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | Supabase project endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | Supabase public anon key |
| `ANTHROPIC_API_KEY` | Server | Anthropic API secret |

---

## Webhooks & Callbacks

**Incoming:**
- `GET /auth/callback` — Supabase OAuth redirect, redirects to `/` for fragment capture
- `POST /api/resolveCombat` — internal endpoint to apply a `<combat_effect>` HP delta directly (used for testing; production path goes through `take-turn` transaction)

**Outgoing:**
- Anthropic `messages.create` API call from `take-turn` server action

---

*Integration audit: 2026-05-23*
