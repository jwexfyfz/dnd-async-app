# Concerns & Technical Debt

**Analysis Date:** 2026-05-20

---

## High Priority

### [CRITICAL] Core Gameplay Routes Are Empty Directories

The two routes that players navigate to after the character list do not exist:
- `/app/game/[id]/` — directory exists but contains zero files (no `page.tsx`)
- `/app/play/` — directory exists but contains zero files (no `page.tsx`)

`CharacterList` links "Continue Adventure" to `/game/<id>` and "Begin Adventure" to `/play?characterId=<id>`. Both links are dead. Clicking either button produces a Next.js 404. The `startGame` server action (`app/actions/start-game.ts`) is also written but never called from any UI component — `getStoryPrompts` is similarly defined but has no consumer. The app currently stops at the character roster screen.

**Impact:** The entire game loop (Chat UI, Map Tab, Status Tab, AI DM, dice engine, turn management) is absent. This is not a bug in existing code; it is the complete remaining build surface.

---

### [CRITICAL] No Test Suite

`package.json` defines no `test` script. No Jest, Vitest, Playwright, or Cypress config exists anywhere in the project. `CLAUDE.md` states "You must test your work. Run `npm run test`" — running `npm run test` will error with `missing script: test`.

**Files:** `package.json` (line 6 — scripts block has no `"test"` key)
**Impact:** All future changes ship with zero automated regression coverage. CI cannot validate correctness.

---

### [HIGH] No Database Migration History — Schema Managed via `prisma db push`

There is no `prisma/migrations/` directory. The schema is applied with `prisma db push` (exposed as `npm run db:push` in `package.json`). `prisma db push` is a destructive, non-versioned operation that cannot be rolled back and silently drops columns on schema changes in non-interactive contexts.

**Files:** `package.json` (line 11), `prisma/schema.prisma`
**Impact:** Any schema change risks data loss in production. No audit trail of schema evolution.
**Fix approach:** Run `npx prisma migrate dev --name init` to capture current schema as a baseline migration, then commit `prisma/migrations/` to version control. Remove or gate `db:push` behind an explicit warning.

---

### [HIGH] `useState<any>` for the Supabase User Object

`app/page.tsx` line 24 stores the authenticated user as `useState<any>(null)`. The Supabase SDK exports a typed `User` interface from `@supabase/supabase-js`.

**File:** `app/page.tsx:24`
**Impact:** No TypeScript guard on `user.email`, `user.id`, or other fields consumed on lines 50, 59, 119. A shape change in the SDK silently breaks at runtime instead of at compile time.
**Fix approach:** `import type { User } from "@supabase/supabase-js"` and type the state as `useState<User | null>(null)`.

---

### [HIGH] `error: any` in All Four Server Actions

Every catch block uses `catch (error: any)` and forwards `error.message` directly to the client:
- `app/actions/create-character.ts:72`
- `app/actions/start-game.ts:81`
- `app/actions/get-characters.ts:33`
- `app/actions/get-story-prompts.ts:13`

**Impact:** Raw Prisma/database error messages (which can contain table names, column names, constraint names, or connection strings) are returned verbatim in the API response. This leaks internal schema details.
**Fix approach:** Log the full error server-side with `console.error`, then return a generic `"An unexpected error occurred."` to the client. Use `instanceof Error` narrowing instead of `error: any`.

---

### [HIGH] No Server-Side Validation for `characterClass`

`app/actions/create-character.ts` checks that `characterClass` is truthy (line 38–40) but does not validate it against an allowed list. The client-side class picker in `CharacterForm` restricts to `["Fighter", "Wizard", "Rogue", "Cleric"]`, but a direct POST to the server action can submit any arbitrary string.

**Files:** `app/actions/create-character.ts:38-40`, `components/character-form.tsx:7`
**Impact:** Arbitrary strings are written to the `Character.characterClass` column. Future AI prompts that include `characterClass` will receive unsanitized user input.
**Fix approach:** Add a whitelist check server-side: `if (!["Fighter","Wizard","Rogue","Cleric"].includes(characterClass)) return { success: false, error: "Invalid class." }`.

---

### [HIGH] No Input Length Limit on Character Name

`app/actions/create-character.ts` trims the name and checks it is non-empty, but imposes no maximum length. A user can submit a 100,000-character string.

**File:** `app/actions/create-character.ts:35-37`
**Impact:** Unbounded strings stored in PostgreSQL `String` (TEXT) column. Potential for oversized AI prompts when the name is included in DM context.
**Fix approach:** Add `if (name.trim().length > 50) return { success: false, error: "Name must be 50 characters or fewer." }` before the database write.

---

## Medium Priority

### [MEDIUM] `@prisma/adapter-pg` Is an Unused Dependency

`package.json` lists `@prisma/adapter-pg` as a runtime dependency (line 22), but the codebase exclusively uses `@prisma/adapter-neon` (`lib/prisma.ts`, `prisma/seed.mjs`). `adapter-pg` is never imported anywhere.

**Files:** `package.json:22`
**Impact:** Bloated `node_modules`, unnecessary security surface, and misleading indication that `pg`-based connections are supported.
**Fix approach:** Remove `@prisma/adapter-pg` from `dependencies`.

---

### [MEDIUM] `@supabase/auth-ui-react` and `@supabase/auth-ui-shared` Are Unused

Both packages are installed as runtime dependencies (lines 23–24 of `package.json`) but are never imported in any `.ts` or `.tsx` file. The app builds a fully custom login screen in `components/login-screen.tsx`.

**Files:** `package.json:23-24`
**Impact:** Unused packages increase bundle size and represent outdated (v0.4.7) dependencies that may carry vulnerabilities.
**Fix approach:** Remove both packages from `dependencies`.

---

### [MEDIUM] Unsafe JSON Cast on `Map.data` in `start-game.ts`

`app/actions/start-game.ts` line 54 casts `storyPrompt.map.data` directly as `{ playerStart: { x: number; y: number } }` with no runtime validation:

```typescript
const mapData = storyPrompt.map.data as { playerStart: { x: number; y: number } };
```

If the JSON stored in the database is malformed or missing `playerStart`, this silently produces `undefined` at `mapData.playerStart`, causing `startingHp` and `initialState.playerPos` to reference `undefined`.

**File:** `app/actions/start-game.ts:54`
**Fix approach:** Validate the shape with a type guard or runtime check before proceeding.

---

### [MEDIUM] Auth Callback Discards PKCE Code Exchange — Relies on Implicit Flow Fragment Tokens

`app/auth/callback/route.ts` does not use the `code` query parameter from Supabase's PKCE flow. Instead, it redirects the browser to `/` and a client-side `useEffect` in `app/page.tsx` manually extracts `access_token` and `refresh_token` from the URL hash (lines 46–65).

**Files:** `app/auth/callback/route.ts`, `app/page.tsx:46-65`
**Impact:** Implicit flow with fragment-based tokens is less secure than PKCE. Tokens are briefly visible in the browser address bar and browser history before `replaceState` removes them. Supabase's recommended pattern is to exchange the `code` parameter server-side in the callback route.
**Fix approach:** Implement `exchangeCodeForSession(code)` in the callback route handler instead of relying on the hash fragment.

---

### [MEDIUM] `start-game.ts` Ownership Check Has a TOCTOU Window

`start-game.ts` first queries `findFirst` for an existing active game (line 24) before verifying ownership (line 33). If an existing game is found, it returns early *without* verifying the game belongs to the requesting user's character. A user who knows another character's UUID can pass it as `characterId` and receive a valid `gameId` for a game they do not own, provided that character already has an active game.

**File:** `app/actions/start-game.ts:24-29`
**Fix approach:** Include `character: { userId: user.id }` in the `findFirst` where clause, or perform the ownership check before the existing-game lookup.

---

### [MEDIUM] No Rate Limiting on Server Actions

All four server actions (`createCharacter`, `startGame`, `getCharacters`, `getStoryPrompts`) have no rate limiting. `createCharacter` in particular has no per-user character count cap.

**Files:** `app/actions/create-character.ts`, `app/actions/start-game.ts`
**Impact:** A single authenticated user can create an unbounded number of characters, flooding the `Character` table. All actions are open to brute-force or denial-of-service.
**Fix approach:** Add a per-user character limit check before `prisma.character.create` (e.g., `count` query with a max of 5). Consider middleware-level rate limiting via Vercel's built-in rate limiting or `@upstash/ratelimit`.

---

### [MEDIUM] `Character` Interface Duplicated Across Three Files Without a Shared Type

The `Character` interface is hand-typed in three separate places:
- `app/page.tsx:11-21` (includes `games`)
- `components/character-list.tsx:6-18` (includes `games`)
- `components/character-form.tsx` (implicit in submit handler shape)

Comments explicitly warn "must stay in sync" — a manual contract prone to drift.

**Fix approach:** Extract a shared `types/character.ts` with the canonical interface, or use `Prisma.CharacterGetPayload` to derive the type from the Prisma schema directly.

---

## Low Priority / Nice-to-Have

### [LOW] `console.error` Used for Production Error Logging

All four server actions log errors with `console.error` (`create-character.ts:73`, `start-game.ts:82`, `get-characters.ts:34`, `get-story-prompts.ts:14`). On Vercel, these appear in function logs but provide no structured context (no request IDs, no user IDs, no correlation).

**Fix approach:** Add a lightweight structured logger (e.g., Pino or a simple wrapper) that includes `userId` and action name in the log context.

---

### [LOW] HP Calculation Is Flat — No Class-Specific Hit Dice

`start-game.ts:50-52` computes starting HP as `10 + conModifier` for all classes. A Fighter and a Wizard both start with identical HP regardless of class, which contradicts D&D 5e rules (d10 for Fighter, d6 for Wizard).

**File:** `app/actions/start-game.ts:50-52`
**Impact:** Low for MVP, but will become a correctness issue once combat is implemented.

---

### [LOW] `prisma.config.ts` Uses `DIRECT_URL` for Migrations But `DATABASE_URL` for Runtime

The Prisma config (`prisma.config.ts:14`) specifies `DIRECT_URL` for the datasource when running CLI commands, while `lib/prisma.ts:4` reads `DATABASE_URL` for the runtime adapter. This dual-variable setup is correct for Neon's pooled vs. direct connection pattern but is not documented, making it easy for a new developer to misconfigure.

**Files:** `prisma.config.ts:14`, `lib/prisma.ts:4`
**Fix approach:** Add a comment in both files cross-referencing the other and explaining the pooled vs. direct distinction.

---

### [LOW] `prisma/seed.mjs` Uses `console.log` Directly

`prisma/seed.mjs` lines 79 and 118 use `console.log` for seed output. This is standard for seed scripts but worth noting for consistency if a logging standard is adopted.

---

## Incomplete Features

### [CRITICAL] Game Loop Does Not Exist

The following features are planned in `CLAUDE.md` but have zero implementation:

| Feature | Status |
|---|---|
| `/app/game/[id]/page.tsx` — Chat UI, Map, Status tabs | Directory empty |
| `/app/play/page.tsx` — Story/adventure selection screen | Directory empty |
| AI DM turn processing (Claude 3.5 Haiku integration) | No implementation |
| Dice roll engine (`d20 + modifiers` vs DC/AC) | No implementation |
| Turn/initiative management | No implementation |
| `Campaigns` table with `active_turn_player_id` | Not in schema |
| `TurnSessions` / `ActionLogs` audit tables | Not in schema |
| `DiscoveredObjects` perception filtering | Not in schema |
| Notification worker (Resend email / Discord webhook) | Not in schema, no implementation |
| Map rendering (20x20 grid viewport) | No implementation |
| Quick-command action chips | No implementation |
| Multiplayer / party campaigns | Not in schema (Game is 1-player only) |

The Prisma schema defines only `User`, `Character`, `Map`, `StoryPrompt`, `Game`, and `Message`. All schema tables described in `CLAUDE.md` under "Database Schema & State Model" that are missing from the actual schema represent incomplete features.

---

## Dependency Risks

### [MEDIUM] Prisma 7.x Is a Major Version with Breaking Changes

The project uses `@prisma/client@^7.8.0`, `prisma@^7.8.0`, and `@prisma/adapter-neon@^7.8.0`. Prisma 7 introduced the `PrismaNeon` adapter API used in `lib/prisma.ts`. Most online documentation and community examples reference Prisma 4/5, which can cause confusion when debugging.

**Impact:** Low immediate risk, but worth tracking as the ecosystem around Prisma 7 is still maturing.

---

### [MEDIUM] `next@16.2.6` — Non-Standard Version Numbering

The project uses `next@16.2.6`. At the knowledge cutoff (August 2025) the stable Next.js release line was 15.x. A version number of 16.2.6 may indicate a pre-release, canary, or custom fork, which carries unknown stability and security patch status.

**File:** `package.json:28`
**Impact:** Potential exposure to unpatched vulnerabilities if this is a canary or pre-release build.
**Fix approach:** Verify `npm info next@16.2.6` to confirm the release type. Pin to a stable LTS version if a canary was installed accidentally.

---

### [LOW] `dotenv@^17.4.2` Is an Unusually High Major Version

`dotenv` is listed at `^17.4.2` in `dependencies`. The widely-used stable dotenv is in the 16.x line. Version 17 may be a pre-release or a fork. Its presence in `dependencies` (not `devDependencies`) also means it ships in the production bundle unnecessarily — environment variables in Next.js are loaded by the framework itself.

**Files:** `package.json:25`
**Fix approach:** Confirm `dotenv@17.4.2` is a stable release. Move to `devDependencies` since it is only needed for `prisma.config.ts` and `prisma/seed.mjs` (CLI tooling), not the runtime application.

---

### [LOW] `react@19.2.4` and `react-dom@19.2.4`

React 19 is used. This is a major version released after React 18 and introduces new APIs (Actions, `useOptimistic`, etc.). Community ecosystem compatibility (e.g., third-party Radix/Shadcn components) should be verified as stable against React 19.

---

*Concerns audit: 2026-05-20*
