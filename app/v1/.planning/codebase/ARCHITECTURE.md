<!-- refreshed: 2026-05-23 -->
# Architecture

**Analysis Date:** 2026-05-23

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                  Next.js 16 App Router (Client)              │
│   app/page.tsx  app/game/[id]/page.tsx  app/game/[id]/lobby │
└──────────────────────┬──────────────────────────────────────┘
                       │ server actions ("use server")
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    app/actions/                              │
│  take-turn.ts · initialize-game.ts · get-game.ts            │
│  start-adventure.ts · create-character.ts · join-game.ts    │
└────────────────┬──────────────────┬─────────────────────────┘
                 │                  │
                 ▼                  ▼
┌───────────────────────┐  ┌──────────────────────────────┐
│  Anthropic SDK         │  │  Prisma 7 + Neon adapter      │
│  claude-haiku-4-5     │  │  lib/prisma.ts (singleton)    │
│  (DM narration)        │  │  PostgreSQL via Neon          │
└───────────────────────┘  └──────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Home page | Auth lifecycle + character roster | `app/page.tsx` |
| Game page | Turn loop, HP HUD, tab UI (Field/Party/Chronicle) | `app/game/[id]/page.tsx` |
| Lobby page | Party assembly, ready-check, start adventure | `app/game/[id]/lobby/page.tsx` |
| MapRenderer | ASCII tile grid render, party markers | `components/map-renderer.tsx` |
| CharacterList | Character cards with active-game status | `components/character-list.tsx` |
| CharacterForm | Character creation form | `components/character-form.tsx` |
| LoginScreen | Google OAuth sign-in prompt | `components/login-screen.tsx` |
| UserMenu | Auth session menu | `components/user-menu.tsx` |

## Pattern Overview

**Overall:** Next.js App Router with server actions as the API layer. No separate REST API — all mutations go through `"use server"` functions. Client components hold optimistic UI state; server is the source of truth.

**Key Characteristics:**
- All data mutations are server actions, not API routes (one exception: `/api/auth` callback and `/api/resolveCombat`)
- Game state lives entirely in `Game.state` as a JSON blob; the DB is the single source of truth
- Client optimistically applies AI responses before re-fetching from DB to settle HP

## Layers

**Client Layer:**
- Purpose: Renders UI, manages ephemeral display state (tabs, loading flags, dice cards)
- Location: `app/game/[id]/page.tsx`, `app/game/[id]/lobby/page.tsx`, `app/page.tsx`
- Contains: React state, effects, derived values, tab sub-components defined in the same file
- Depends on: server actions (for data), Supabase browser client (for auth identity)
- Used by: End user browser

**Server Actions Layer:**
- Purpose: Auth guard, DB reads, AI calls, atomic DB writes
- Location: `app/actions/`
- Contains: All game mutations and queries
- Depends on: `lib/prisma.ts`, `lib/supabase-server.ts`, Anthropic SDK, pure lib utilities
- Used by: Client components via direct async function calls

**Pure Logic Layer:**
- Purpose: Deterministic game mechanics — dice, XP, leveling, HP, character sheet, combat parsing
- Location: `lib/dice.ts`, `lib/xp.ts`, `lib/leveling.ts`, `lib/combat-effect.ts`, `lib/character-sheet.ts`
- Contains: Zero framework dependencies, fully testable
- Depends on: Nothing (stdlib only)
- Used by: Server actions

## Data Flow

### Primary Turn Flow

1. Player clicks action chip → `handleChipClick()` in `app/game/[id]/page.tsx`
2. Optimistic player message appended to `localMessages` immediately
3. `takeTurn(gameId, chip)` server action called (`app/actions/take-turn.ts`)
4. Server sanitizes input, fetches game + party from DB
5. Turn ownership checked: `game.currentTurnCharacterId === callerMember.characterId`
6. `detectActionType()` classifies action as AC (attack) or DC (skill) check
7. `rollD20Check()` executes — **dice math is always code, never AI** (`lib/dice.ts`)
8. Anthropic `messages.create()` called with two-part system prompt (static cached + dynamic state)
9. AI returns JSON `{ narrative, stateDeltas, chips, encounterResult }` + optional `<combat_effect>` XML tags
10. `parseCombatEffects()` extracts HP deltas from raw text (`lib/combat-effect.ts`)
11. XP awarded if `encounterResult === "completed"`; `computeLevel()` checks for level-up
12. Prisma `$transaction` atomically: writes two messages, updates character XP/level, updates `Game.state`, applies HP deltas, advances `currentTurnCharacterId`, increments `version`
13. Server returns `{ narrative, chips, newState, diceResult, combatEffects, levelUpResult }`
14. Client appends DM message to `localMessages`, updates `localState`, applies `localHpOverrides`
15. `getGame()` refetch settles HP overrides from DB into `localHpOverrides`

### Game Initialization Flow

1. Game page loads → `getGame(gameId)` fetches full game data
2. If `phase === "LOBBY"`, router redirects to `/game/[id]/lobby`
3. If `messages.length === 0`, `initializeGame(gameId)` is called once (guarded by `initCalledRef`)
4. Opening DM narration + chips saved to DB and displayed

### Party Lobby Flow

1. Host creates game → redirected to lobby URL
2. Others visit lobby URL; unauthenticated users see sign-in prompt
3. Members join via `joinGame(gameId, characterId)`, toggle ready with `setReady()`
4. Lobby polls `getGame()` every 3 seconds to detect new members
5. Host calls `startAdventure()`: sorts party by DEX desc, assigns `turnOrder`, initialises `partyPositions`/`partyHp`/`partyMaxHp` in `Game.state`, sets `phase = ACTIVE`, sets `currentTurnCharacterId`

## AI Integration

**Prompt Architecture** (two-part system, `app/actions/take-turn.ts`):
- **Static block** (cache_control: ephemeral): Party stats, scenario description, map rooms/POIs, response format rules, `<combat_effect>` tag instructions. Built by `buildStaticPrompt()`. Cached by Anthropic's prompt caching to reduce cost.
- **Dynamic block**: Current game state (positions, HP, inventory, plot flags), dice result, consecutive-miss count. Built by `buildDynamicStatePrompt()`. Regenerated each turn.
- **Conversation messages**: Rolling window of last 15 messages (`ROLLING_WINDOW_SIZE`). Older messages stored in DB for Chronicle display but excluded from AI context.

**Model:** `claude-haiku-4-5` (`lib/ai-config.ts`), 600 max tokens per response.

**Rules Engine Keys:** The server strips `hp`, `maxHp`, `xp`, `level`, `proficiencyBonus` from AI-returned `stateDeltas` — the AI cannot override mechanical values.

## Combat Effects: `<combat_effect>` Tag Flow

1. AI appends self-closing XML tags after the JSON object: `<combat_effect target_id="CHAR_ID" delta="-8" type="damage" />`
2. `parseCombatEffects(rawText)` in `lib/combat-effect.ts` extracts all tags with regex
3. Server fetches current HP for each affected character from DB
4. `clampHp(currentHp, delta, maxHp)` enforces floor 0 / ceiling maxHp
5. `resolvedEffects` (`{ targetId, delta, type, newHp }`) written to DB inside the same transaction
6. Client receives `combatEffects` in the turn result, applies `localHpOverrides` immediately
7. Subsequent `getGame()` refetch settles overrides from the DB-committed values

## HP State Management

Three layers of HP state coexist on the client (`app/game/[id]/page.tsx`):

| Layer | Variable | Source | When updated |
|-------|----------|--------|--------------|
| Optimistic display | `localHpOverrides` | `combatEffects` from `takeTurn` | Immediately after AI response |
| Settled display | `localHpOverrides` | `getGame()` refetch | ~100ms after turn completes |
| Game blob state | `localState.hp` / `localState.partyHp` | `takeTurn` `newState` | Same frame as DM message |

`displayHp` resolves as: `localHpOverrides[myCharId] ?? localState.partyHp?.[myCharId] ?? localState.hp`

HP flash animation (`hpFlashing` state, 800ms) fires when the acting character's HP changes.

## Auth Flow

**Browser:** `supabaseBrowser` (`lib/supabase-client.ts`) reads session from localStorage/cookies. Used only for reading the current user's ID client-side.

**Server:** `createSupabaseServerClient()` (`lib/supabase-server.ts`) reconstructs session from HTTP cookies per request. Called at the top of every server action to validate the acting user before any DB access.

**OAuth:** Google OAuth redirect. After callback, tokens arrive in URL hash on `app/page.tsx`, extracted and set via `supabaseBrowser.auth.setSession()`. Lobby pages redirect unauthenticated users through `sessionStorage.setItem("auth-return-to")` to return them after sign-in.

## Optimistic Lock (Concurrency)

`Game.version` is an integer incremented on every state write. `takeTurn` reads the version before calling the AI, then checks it inside a Prisma `$transaction`. If another request modified the game first, the transaction throws `"STALE_TURN"` and the action returns `{ error: "STALE_TURN" }`. The client surfaces this as a human-readable error message.

## Error Handling

**Strategy:** Fail fast and return typed error objects. No global error boundaries.

**Patterns:**
- Server actions return `{ success: false, error: string }` on all failures
- AI call wrapped in try/catch; failures return "DM temporarily unavailable" to client
- Stale turn lock returns `STALE_TURN` string sentinel, translated to UI text client-side
- Prisma transaction errors for STALE_TURN are caught by message check; all others re-thrown

---

*Architecture analysis: 2026-05-23*
