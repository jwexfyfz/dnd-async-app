<!-- refreshed: 2026-05-21 -->
# Concerns & Technical Debt

**Analysis Date:** 2026-05-21

---

## High Priority

### [CRITICAL] No Dice Engine — AI Controls All Mechanical Outcomes
`app/actions/take-turn.ts` passes player input directly to Claude with no code-side dice roll. Claude generates outcomes including combat results. This directly violates the CLAUDE.md spec ("Never let AI invent the roll result") and the Gameplay Transaction Loop (Step 4: Dice Roll Engine must be pure code). The game is mechanically broken at its core.

### [CRITICAL] Prompt Injection Risk in `takeTurn`
`app/actions/take-turn.ts` embeds raw `chipText` user input directly into the Claude system prompt with no sanitization or length limit. An adversarial user can override DM instructions or exhaust token budgets via the chip text input.

### [CRITICAL] No DB Transaction on Turn State Mutation
`app/actions/take-turn.ts` reads game state, calls Claude, then writes updated state as separate DB operations with no transaction. A concurrent turn submission causes a race condition that can corrupt HP values and turn order.

### [CRITICAL] `initializeGame` Broken for Party Games
`app/actions/initialize-game.ts` uses wrong prompt builders and wrong access checks for multi-player scenarios. Party games that transition from lobby will fail to initialize correctly.

### [HIGH] No Real-Time Updates on Game Page
`app/game/[id]/page.tsx` has no polling, WebSocket, or Supabase Realtime subscription. Party players never see turn changes after the page loads. The async turn loop is effectively non-functional for multiplayer.

### [HIGH] No Notification System
Resend (email) and Discord webhook integrations are specified in CLAUDE.md but not implemented anywhere. The async turn loop has no way to alert players when it's their turn.

### [HIGH] No Server-Side Stat Validation
`app/actions/create-character.ts` accepts stat values and class names from the client without server-side validation. Illegal stat distributions (totals > 27 points, values outside 8–15) and arbitrary class strings can be written to the DB. Client-side enforcement in `character-form.tsx` is the only guard.

---

## Medium Priority

### [MEDIUM] Duplicate Prompt Builder Functions
Prompt builder logic is copy-pasted across `app/actions/initialize-game.ts` and `app/actions/take-turn.ts`. These will drift apart as the game evolves, producing inconsistent AI behavior.

### [MEDIUM] Unbounded Message Loads
`app/actions/get-game.ts` and `app/actions/take-turn.ts` load all `Message` rows for a game with no pagination or limit. Long-running games will exceed Claude's context window and cause increasingly slow DB queries.

### [MEDIUM] No Prisma Indexes on Foreign Keys
`Character.userId`, `Message.gameId`, and `Game`'s player join table lack explicit indexes in `prisma/schema.prisma`. Query performance will degrade as data grows.

### [MEDIUM] `useState<any>` for Auth User
`app/page.tsx` (line 24) and at least two other files use `useState<any>(null)` for the Supabase user object. No TypeScript safety on auth state.

### [MEDIUM] `as unknown as GameFull` Double Casts
Type assertions `as unknown as GameFull` in the game page hide mismatches between Prisma's generated types and the app's local `GameFull` interface. Runtime shape errors won't be caught at compile time.

### [MEDIUM] Open Redirect in `create-character` Page
`app/create-character/page.tsx` reads a `returnUrl` from `sessionStorage` and redirects to it after character creation without validating the URL. An attacker can redirect users to arbitrary external URLs.

### [MEDIUM] `sessionStorage` Return URL Not Validated
Related to the above — the `returnUrl` written to `sessionStorage` before auth is not validated as a relative URL, enabling open redirect attacks.

### [MEDIUM] Non-Atomic Character Deletion
`app/actions/delete-character.ts` deletes related records (games, messages) in a loop before deleting the character, with no transaction. A mid-loop error leaves orphaned records.

### [MEDIUM] `leaveGame` Leaves Game Stuck if Active Player Departs
`app/actions/leave-game.ts` does not handle the case where the departing player is the active turn holder. The game's `active_turn_player_id` is not advanced, leaving the game permanently stalled.

### [MEDIUM] Debug `console.log` in Production Path
`app/actions/get-game.ts` contains a `console.log` statement in the normal (non-error) code path that will emit to Vercel function logs in production.

---

## Low Priority

### [LOW] Inconsistent `@/` Alias Usage
Some files use `@/app/actions/...` while others use relative paths (`../../lib/prisma`). No enforced standard.

### [LOW] `Character` Interface Duplicated
The `Character` interface is defined separately in `app/page.tsx` and `components/character-list.tsx`. No shared `lib/types.ts` exists yet.

### [LOW] No `types/` or `lib/types.ts` Directory
All interfaces are file-local. As the codebase grows this will cause duplication and drift.

---

## Incomplete Features

| Feature | Status | Location |
|---------|--------|----------|
| Dice Roll Engine | Missing entirely | — |
| Notification system (Resend/Discord) | Not implemented | — |
| Host disband / end game | Not implemented | — |
| Game completion states (victory/death) | Not implemented | — |
| `TurnSessions` / `ActionLogs` tables | In schema, unused | `prisma/schema.prisma` |
| Map coordinate labels (A–T, 1–20) | Not implemented | — |
| Initiative tracker bar | Not implemented | — |
| Notification settings panel | Not implemented | — |
| "It's Your Turn" badge | Not implemented | — |
| Perception filtering (`DiscoveredObjects`) | In schema, unused | — |

---

## Dependency Risks

### [MEDIUM] Unused Packages in `dependencies`
- `@supabase/auth-ui-react` and `@supabase/auth-ui-shared` — imported nowhere; a custom `LoginScreen` component is used instead. Adds ~40KB to bundle.
- `@prisma/adapter-pg` — present alongside `@prisma/adapter-neon`; only the Neon adapter is actually used.

### [LOW] `dotenv` in Runtime Dependencies
`dotenv` is listed under `dependencies` (not `devDependencies`). It's only needed at build/dev time via `prisma.config.ts`.

### [LOW] Unverified `next` Version
`package.json` specifies `next: "16.2.6"`. As of 2026-05-21 this version string doesn't match a known published Next.js release — may be a typo or pre-release pinned version. Verify against the npm registry.

---

*Concerns analysis: 2026-05-21*
