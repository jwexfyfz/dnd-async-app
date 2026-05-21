<!-- refreshed: 2026-05-21 -->
# Architecture

**Analysis Date:** 2026-05-21

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│              Next.js 16 App Router (Vercel)                  │
│                                                              │
│  Client Components ("use client")   Server Actions          │
│  ┌──────────────────────────┐       ┌───────────────────┐   │
│  │  app/page.tsx            │──────▶│  app/actions/     │   │
│  │  components/             │       │  get-characters   │   │
│  │  (auth state, UI state)  │       │  create-character │   │
│  └──────────────────────────┘       │  start-game       │   │
│                                     │  get-story-prompts│   │
│                                     └────────┬──────────┘   │
└────────────────────────────────────────────┬─┴──────────────┘
                                             │
                    ┌────────────────────────┼────────────────┐
                    │                        │                │
                    ▼                        ▼                │
       ┌────────────────────┐   ┌────────────────────┐       │
       │  Supabase Auth     │   │  Prisma ORM        │       │
       │  lib/supabase-     │   │  lib/prisma.ts     │       │
       │  server.ts         │   │  (Neon adapter)    │       │
       │  lib/supabase-     │   └────────┬───────────┘       │
       │  client.ts         │            │                    │
       └────────────────────┘            ▼                    │
                                ┌────────────────────┐       │
                                │  Supabase          │       │
                                │  PostgreSQL (Neon) │       │
                                └────────────────────┘       │
└───────────────────────────────────────────────────────────┘
```

## Pattern

**Overall:** Next.js full-stack monolith with App Router, serverless-optimized.

- No separate API layer. All data mutations go through **Next.js Server Actions** (`"use server"`).
- Client components handle auth state and UI interactivity only; they never call the database directly.
- Database access is exclusive to server actions via `lib/prisma.ts`.
- Auth identity is verified at the top of every server action via `createSupabaseServerClient()` before any DB operation.

## Frontend

**Routing:**
- App Router (Next.js 16). Single route at `/` (`app/page.tsx`).
- Auth callback handled by `app/auth/callback/route.ts` — a Route Handler that redirects to `/` and lets `page.tsx` pick up the hash token.

**State Management:**
- Local `useState` only — no global state library (no Redux, Zustand, etc.).
- Auth state lives in `page.tsx` via `useState<user>`, synced with `supabaseBrowser.auth.onAuthStateChange()`.
- Character roster state also lives in `page.tsx` and is passed down as props.
- `useCallback` used for the `loadCharacters` refresh function so it can safely be passed as a prop to `CharacterForm`.

**Data Fetching:**
- Read operations: Server Actions returning `{ success, data, error }` objects (e.g., `getCharacters()`, `getStoryPrompts()`).
- Write operations: Server Actions called directly from client event handlers (e.g., `createCharacter(formData)`).
- No `fetch()` calls, no SWR/React Query. All data fetching is direct server action invocation.
- `revalidatePath("/")` called after mutations to invalidate Next.js cache.

**Auth Flow (Client):**
1. User clicks "Sign in with Google" in `components/login-screen.tsx`.
2. Browser is redirected to Supabase OAuth URL (`/auth/v1/authorize?provider=google`).
3. Supabase redirects to `app/auth/callback/route.ts`, which redirects to `/?#access_token=...`.
4. `page.tsx` `useEffect` detects the hash token, calls `supabaseBrowser.auth.setSession()`, strips hash from URL.
5. `onAuthStateChange` listener keeps session in sync across tabs.

## Backend / API

**Server Actions** (`app/actions/`) — 13 total:

| Action | Auth | Purpose |
|--------|------|---------|
| `create-character.ts` | Yes | Upserts User, creates Character |
| `delete-character.ts` | Yes | Deletes a character owned by the user |
| `get-characters.ts` | Yes | Fetches all characters for current user |
| `get-story-prompts.ts` | No | Returns seeded StoryPrompt rows (public) |
| `start-game.ts` | Yes | Creates a new Game in LOBBY state |
| `join-game.ts` | Yes | Adds a character to an existing lobby |
| `leave-game.ts` | Yes | Removes a character from a lobby |
| `kick-player.ts` | Yes | Host removes another player from lobby |
| `set-ready.ts` | Yes | Marks a player as ready in lobby |
| `start-adventure.ts` | Yes | Host transitions lobby → ACTIVE, builds initial state |
| `initialize-game.ts` | Yes | Builds initial AI narrative for the game start |
| `take-turn.ts` | Yes | Processes a player turn through the AI + state mutation |
| `get-game.ts` | Yes | Fetches full game state + message history |

All actions marked `"use server"`. Auth-gated actions call `createSupabaseServerClient()` first. Actions return `{ success: boolean, data?, error? }`.

**Auth on the Server:**
- `lib/supabase-server.ts` exports `createSupabaseServerClient()`, which creates a per-request Supabase client that reads/writes session tokens from HTTP cookies.
- Auth is validated via `supabase.auth.getUser()` — the server validates the session JWT directly, not from client-supplied state.

**Database Access:**
- `lib/prisma.ts` exports a singleton `PrismaClient` using `@prisma/adapter-neon` for serverless-compatible connection pooling.
- Global singleton pattern (`globalThis`) prevents connection pool exhaustion under hot-reload in dev.
- All Prisma calls are directly in server actions — no repository or service layer.

**Route Handlers:**
- `app/auth/callback/route.ts`: Single GET handler that redirects to `/`. No logic beyond the redirect.
- `app/api/auth/` directory exists but is empty (no NextAuth routes present).

**Pages:**
- `app/page.tsx`: Home — auth gate, character roster, start/join game entry point.
- `app/create-character/page.tsx`: Dedicated character creation page.
- `app/game/[id]/page.tsx`: Active game view — chat feed, turn input, game state display.
- `app/game/[id]/lobby/page.tsx`: Pre-game lobby — player list, ready checks, host controls.
- `app/play/page.tsx`: Game browser / join existing game.

## Data Flow

### Character Creation (Write Path)

1. User fills form in `components/character-form.tsx` (`"use client"`)
2. `handleSubmit` constructs a `FormData` and calls `createCharacter(formData)` (`app/actions/create-character.ts`)
3. Server action calls `createSupabaseServerClient()` → `supabase.auth.getUser()` to verify identity
4. Upserts `User` row in Postgres (keyed by Supabase user ID)
5. Inserts `Character` row via `prisma.character.create()`
6. Calls `revalidatePath("/")`, returns `{ success: true }`
7. `CharacterForm` calls `onCharacterCreated()` callback → `page.tsx` re-fetches roster

### Character Load (Read Path)

1. `page.tsx` `useEffect` fires when `user` state is set
2. Calls `loadCharacters()` → `getCharacters()` (`app/actions/get-characters.ts`)
3. Server action verifies session, queries `prisma.character.findMany({ where: { userId } })` with `include: { games: { where: { status: "ACTIVE" } } }`
4. Returns `{ success: true, data: characters[] }`
5. `page.tsx` sets state → `CharacterList` re-renders

### Game Start

1. `startGame(characterId, storyPromptId)` called from client
2. Verifies auth, checks for existing active game (idempotent — returns existing if found)
3. Verifies character ownership: `character.userId !== user.id`
4. Loads `StoryPrompt` with its `Map`, computes starting HP (`10 + conModifier`)
5. Builds `initialState` JSON (player position, HP, empty inventory, plot flags)
6. Creates `Game` row with `state` JSON blob

**State Management:**
- Canonical game world state is a JSON blob (`Game.state`) in PostgreSQL.
- Message history is stored as `Message` rows linked to `Game` — role is `PLAYER` or `DUNGEON_MASTER`.
- DM messages carry a `chips` JSON field for quick-action chips shown to the player next turn.

## Key Design Decisions

**1. Server Actions over API Routes**
No REST or tRPC layer. Server Actions provide type-safe RPC from client to server with minimal boilerplate. The entire backend surface is `app/actions/`.

**2. Supabase ID as Prisma User PK**
`User.id` in Prisma matches the Supabase auth UID directly. No join table. `createCharacter` upserts the `User` row on first character creation rather than requiring a separate registration step.

**3. Neon Serverless Adapter**
`@prisma/adapter-neon` replaces the standard `pg` connection pool with a WebSocket-based pool optimized for serverless cold starts (Vercel edge functions). Configured in `lib/prisma.ts` and `prisma.config.ts`.

**4. Game State as JSON Blob**
`Game.state` stores the full current world state as JSON rather than normalized columns. This allows the AI DM to read a single compact snapshot per turn without replaying the full message history. The schema comment documents the exact shape: `{ playerPos, hp, maxHp, inventory, equipped, npcsEncountered, plotFlags, activeObjective }`.

**5. Point Buy Enforced Client-Side with Server Re-validation**
D&D 5e point-buy rules (8–15 stat range, 27 points, 2-cost tier at 14+) are enforced in `components/character-form.tsx` with inline rule hints. The server action (`create-character.ts`) accepts the submitted values but relies on client-side enforcement — there is no server-side point-buy validation at this stage.

**6. Auth Callback via Hash Token**
Supabase OAuth uses hash-fragment tokens (`#access_token=...`) rather than query params. The callback route at `app/auth/callback/route.ts` simply redirects to `/`; `page.tsx` handles token extraction from the hash, calls `setSession()`, then strips the hash from the browser URL.

---

*Architecture analysis: 2026-05-20*
