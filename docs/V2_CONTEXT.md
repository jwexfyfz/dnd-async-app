# V2 System — Session Context

## What V2 Is

A **forked, parallel version** of the D&D app running as a standalone Express.js server on port 3001. It shares the same Postgres database (and Prisma schema) as the Next.js V1 app but targets a different set of tables — the "room system" tables. No existing V1 files were modified.

---

## Architecture

```
Next.js app (port 3000)  ←── V1, untouched
Express server (port 3001) ←── V2, all new files under src/
  └── Shares same DATABASE_URL / Prisma schema
  └── Loads env from .env.local via dotenv in src/lib/prisma.ts
```

---

## Database Tables Used by V2

From `prisma/schema.prisma` — these existed before V2 but were unpopulated:

| Table | Purpose |
|---|---|
| `DungeonTemplate` | Top-level dungeon container |
| `RoomTemplate` | Blueprint for a room (name, description) |
| `PoiTemplate` | Point of Interest blueprint; `defaultProperties` JSON holds verbs → stances |
| `GameSession` | Active session instance (has `gameState`: exploration/combat) |
| `RoomInstance` | Live room linked to a GameSession + RoomTemplate |
| `PoiInstance` | Live POI linked to a RoomInstance; `currentProperties` tracks state changes (examination, interaction flags merged in) |
| `RoomParticipant` | Links a Character to a RoomInstance; `combatState` JSON = `{proximity_target_id, stance}` |
| `MessageLog` | All events in a room — see MessageLog Anatomy below |
| `Character` | Shared with V1 — same table |
| `User` | Shared with V1 — same table |

`ClientStateView` exists in schema but is not a real DB table (no `@@map`, unused).

---

## MessageLog Anatomy

Three distinct entry types, distinguished by `isMechanicalEvent` and `mechanicalSummary`:

| Type | `isMechanicalEvent` | `mechanicalSummary` | `text` |
|---|---|---|---|
| Player action | `false` | `{ "type": "player_action" }` | Raw player input text |
| DM narrative | `false` | `null` | Haiku-generated narrative markdown |
| Mechanical event | `true` | `{ "event": "movement" \| "examine" \| "interact" \| "search" \| "narrative_only" \| "departed" \| "arrived", … }` | `[MECHANICAL] …` summary string |

**Ordering guarantee:** within a single pipeline run, the player action entry is written after Stage 1 (room exists), the mechanical events are written in Stage 3, and the DM narrative is written last in Stage 4. `createdAt` timestamps reliably reflect this order.

The history endpoint (`GET /api/room/history`) filters to `isMechanicalEvent: false` only — returning both player actions and DM narratives interleaved in chronological order, which is all the frontend chat needs.

---

## File Structure

```
src/
  lib/
    prisma.ts          # PrismaClient using @prisma/adapter-pg + pg.Pool
                       # Also loads dotenv here (MUST be first — import chain issue)
    supabaseAdmin.ts   # Verifies Supabase JWTs via REST (no SDK needed server-side)
  middleware/
    requireAuth.ts     # Express middleware: Bearer token → supabaseUser on req
  routes/
    configRoute.ts     # GET /api/config → { supabaseUrl, supabaseAnonKey }
    characters.ts      # GET/POST /api/me/characters (auth required)
    setup.ts           # Sessions, room templates, room history, room state
  controllers/
    gameController.ts  # The 5-stage AI pipeline
  types/
    game.ts            # TypeScript interfaces for request/response
  public/
    setup.html         # 3-step setup flow: Login → Character → Session
    play.html          # Game chat UI — reads ?room=&char= from URL query params
  server.ts            # Express app entry point
```

---

## The 5-Stage Pipeline (`POST /api/game/action`)

**Request body:** `{ characterId, roomInstanceId, playerActionText }`

**Pre-Stage — Player Action Storage**
- After Stage 1 validates the room and character exist, the raw `playerActionText` is written to `MessageLog` with `isMechanicalEvent: false` and `mechanicalSummary: { type: "player_action" }`.
- This happens before Stage 2 so that if the AI stages fail, the player's intent is still recorded in history.

**Stage 1 — DB Context Lookup**
- Parallel fetch: `Character` (stats, inventory) + `RoomInstance` (joins `RoomTemplate`, `PoiInstance[]` → each joins `PoiTemplate`)
- `PoiInstance.currentProperties` is read here to surface `examined`/`interacted` flags to the parser
- Lazy sync: if new `PoiTemplate`s were added to the `RoomTemplate` after this session was created, missing `PoiInstance`s are created automatically
- Fails fast with 404 if either ID doesn't exist

**Stage 2 — Intent Parsing (Claude Haiku)**
- Model: `claude-haiku-4-5-20251001`
- Forced tool call: `extract_game_intent`
- Tool schema: `{ actions: [{ action_type, target_poi_instance_id, resulting_stance, interaction_result, target_room_template_id }] }`
- `action_type` enum: `change_proximity | examine | interact | search | narrative_only | move_to_room`
- System prompt enumerates valid POI IDs + stances + current `examined`/`interacted` status per POI; exit POIs listed separately with their `target_room_template_id`
- After response, validates `target_poi_instance_id` against known POI set (prevents hallucination)
- Console logs the raw input text and captured actions for dev inspection

**Stage 3 — State Mutation (Prisma transaction)**
- `change_proximity`: `tx.roomParticipant.upsert(...)` sets `combatState: { proximity_target_id, stance }` + MessageLog
- `examine`: `tx.poiInstance.update(...)` merges `{ examined: true }` into `currentProperties` + MessageLog
- `interact`: `tx.poiInstance.update(...)` merges `{ interacted: true, lastInteraction: "<verb>" }` into `currentProperties` + MessageLog
- `search`: MessageLog only (room-wide, no specific POI target)
- `narrative_only`: MessageLog only
- `move_to_room`: finds or creates target `RoomInstance` (with fresh `PoiInstance`s if new), upserts `RoomParticipant` in target room, writes departure log to current room and arrival log to target room; returns `newRoomInstanceId` which shifts all subsequent stages to the target room

All multi-write actions use `prisma.$transaction(async tx => ...)` (callback form for true ACID atomicity).

**Stage 4 — Narrative Generation (Claude Haiku)**
- Model: `claude-haiku-4-5-20251001` (was Sonnet — switched to reduce API cost during development; swap back to `claude-sonnet-4-6` for production)
- Fetches last 5 `MessageLog` entries for the active room (desc, then reversed for chronological order)
- System prompt: DM persona + room context + mechanical fact block describing what actually happened
- Saves Haiku output as `MessageLog` with `isMechanicalEvent: false`, `mechanicalSummary: null`

**Stage 5 — View State Packager**
- Returns unified JSON:
  ```json
  {
    "roomInstanceId": "<active room, may differ from request if move_to_room>",
    "currentNarrative": [ "last 5 isMechanicalEvent=false MessageLogs" ],
    "activeState": "exploration | combat",
    "poiIndex": { "<poi_instance_id>": "<poi template name>" },
    "poiStates": {
      "<poi_instance_id>": { "examined": false, "interacted": true }
    },
    "uiLayoutAnchors": {
      "<poi_instance_id>": [ { "entityId", "entityType", "name", "stance" } ],
      "open_space": [ "…characters not at any POI…" ]
    }
  }
  ```
- `currentNarrative` includes both player action entries and DM narratives (all `isMechanicalEvent: false`); the frontend uses only the last entry for the DM bubble after each action
- `poiStates` reflects `currentProperties.examined` and `currentProperties.interacted` for each POI at the time of the response

---

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Redirects to `/setup` |
| `GET` | `/setup` | — | Serves setup.html |
| `GET` | `/play` | — | Serves play.html (reads `?room=&char=` from URL) |
| `GET` | `/api/config` | — | Returns Supabase URL + anon key |
| `GET` | `/api/me/characters` | ✓ | List characters for logged-in user |
| `POST` | `/api/me/characters` | ✓ | Create a new character |
| `GET` | `/api/room-templates` | — | List all room templates |
| `GET` | `/api/sessions?characterId=` | ✓ | List active sessions for a character (by RoomParticipant) |
| `POST` | `/api/sessions` | ✓ | Create GameSession + RoomInstance + RoomParticipant |
| `GET` | `/api/room/history?roomInstanceId=` | — | Last 50 player actions + DM narratives in chronological order |
| `GET` | `/api/room/state?roomInstanceId=` | — | Current character positions, POI examined/interacted states, activeState |
| `POST` | `/api/game/action` | — | Run the 5-stage pipeline |

---

## Setup Flow (port 3001)

**`/setup`** — 3-step HTML page (Supabase CDN SDK, vanilla JS)
- Step 1: Google OAuth via Supabase (redirect URL must be `http://localhost:3001/setup` — add to Supabase Dashboard → Auth → URL Config → Redirect URLs)
- Step 2: Select existing character or create new one (point-buy stat system, skill picker)
- Step 3: **Session picker** — shows existing sessions for the character with "Continue" cards, plus "Start New Session" that expands a room template picker
- On continue: navigates to `/play?room=<roomInstanceId>&char=<characterId>`
- On new session: `POST /api/sessions` → navigates to `/play?room=<roomInstanceId>&char=<characterId>`

**`/play`** — game chat UI
- Reads `?room=` and `?char=` from URL query params on load; redirects to `/setup` if either is missing
- **On load:** calls `GET /api/room/history` to pre-populate the chat with all prior player actions and DM narratives; calls `GET /api/room/state` to pre-populate the tactical sidebar with character positions and POI states
- Sends new actions to `POST /api/game/action`; renders the last DM narrative entry as the new chat bubble and re-renders the sidebar from the response
- "Switch session" link → `/setup`

**Tactical sidebar POI cards** show:
- Character chips for anyone currently at that POI (with stance tag if set)
- Green "examined" badge if `poiStates[id].examined === true`
- Purple "interacted" badge if `poiStates[id].interacted === true`

---

## Auth Pattern

Server-side token verification is a plain `fetch` to the Supabase REST API:
```
GET ${SUPABASE_URL}/auth/v1/user
Headers: { Authorization: Bearer <token>, apikey: <anon_key> }
```
No SDK needed. Used in `requireAuth` middleware, result attached as `req.supabaseUser`.

---

## Key Implementation Decisions

| Decision | Rationale |
|---|---|
| `@prisma/adapter-pg` (not Neon) | Express is a persistent process; pg Pool is correct. Neon adapter is for serverless/edge. |
| `dotenv.config()` in `prisma.ts` | tsx compiles imports to hoisted CJS `require()` calls. Dotenv in `server.ts` runs too late — DB and API key env vars are already read before it executes. The fix is to load dotenv in the first module in the import chain. |
| `prisma.$transaction(async tx => ...)` | Callback form guarantees true ACID atomicity; array form does not. |
| `upsert` on `RoomParticipant` | Handles first-visit gracefully without a separate existence check. |
| Haiku for both parsing and narrative | Haiku = cheap + fast. Sonnet-quality narrative is not needed during exploration development. Swap Stage 4 back to `claude-sonnet-4-6` when ready for production. |
| POI ID validation after Haiku | Defense in depth — rejects hallucinated IDs before they reach the DB. |
| `currentProperties` as exploration state store | JSON merge (`{ ...existing, examined: true, lastInteraction: "opened" }`) avoids schema changes. Original stance verbs are preserved as-is alongside exploration flags. |
| URL params for session identity | `/play?room=<id>&char=<id>` makes sessions bookmarkable and shareable without requiring server-side session state. |
| Redirect `express.static` intercept fix | The `/` redirect must be registered before `app.use(express.static(...))`, otherwise Express serves `index.html` and the redirect never fires. |
| Stable template UUIDs in seed | Templates use hardcoded UUIDs (`11111111…`, `22222222…`, POIs `33333333/44444444/55555555`) with `upsert`. Re-seeding never changes template IDs. Instance creation (GameSession etc.) was removed from the seed — the setup flow creates those. |
| `tsx` directly for dev server | `npm run v2:dev` routes through RTK (Rust Token Killer) hook which swallows stdout. Run `node_modules/.bin/tsx src/server.ts` directly to see console.log output. |
| Player action stored as `isMechanicalEvent: false` | Distinguishes it from mechanical events so `GET /api/room/history` (which filters `isMechanicalEvent: false`) returns a clean interleaved feed of player actions and DM narratives without needing a schema change. `mechanicalSummary: { type: "player_action" }` is the discriminator on the frontend. |
| `move_to_room` reuses existing `RoomInstance` if present | If the character has visited a room before in this session, their prior POI interaction states are preserved. Only truly new rooms get fresh `PoiInstance`s. |
| Lazy `PoiInstance` sync in Stage 1 | If new POI templates are added to a room template after a session was created, Stage 1 detects and creates the missing instances before proceeding. Prevents 404s and keeps existing sessions alive across template updates. |

---

## Seed

`prisma/seed.mjs` V2 section seeds **templates only** with stable hardcoded UUIDs:

| Record | Stable ID |
|---|---|
| DungeonTemplate "The Sunken Cellar" | `11111111-1111-1111-1111-111111111111` |
| RoomTemplate "The Entry Chamber" | `22222222-2222-2222-2222-222222222222` |
| PoiTemplate "Stone Fountain" | `33333333-3333-3333-3333-333333333333` |
| PoiTemplate "Wooden Barricade" | `44444444-4444-4444-4444-444444444444` |
| PoiTemplate "Iron Pillar" | `55555555-5555-5555-5555-555555555555` |

`dungeonTemplate.deleteMany()` was removed from the seed's clear block — templates survive re-seeds. All V2 instance tables (GameSession, RoomInstance, PoiInstance, RoomParticipant, MessageLog) are still cleared on each seed run.

Run: `npm run db:seed`

---

## Dev Commands

```bash
# Recommended: bypasses RTK hook, console.log visible
node_modules/.bin/tsx src/server.ts

# Also works but stdout is swallowed by RTK
npm run v2:dev

npm run dev           # Start Next.js V1 on port 3000 (unchanged)
npm run db:seed       # Re-seed (templates stable, instances cleared)
```

Open `http://localhost:3001` → redirects to `/setup` → complete login + character + session → lands on `/play?room=...&char=...`.

---

## Item Mechanics

Full design in [ITEM_MECHANICS_PLAN.md](./ITEM_MECHANICS_PLAN.md). Summary:

- Items are embedded JSON (`ItemDefinition`) — not linked to the V1 `Item` table
- Seeded items live in `PoiTemplate.defaultProperties.items[]`; taken items tracked in `PoiInstance.currentProperties.items_taken[]`; dropped items in `currentProperties.floor_items[]`
- `Character.inventory` normalized to `{ bag: ItemDefinition[], equipped: { [slot]: ItemDefinition } }`
- Every room has an implicit `open_space` PoiInstance (seeded per RoomTemplate) — dropped items in open space land here; Stage 5 exposes them as `openSpaceItems[]`
- POI types: `interactive` (loot/examine), `positional` (cover/stances), `exit` (transitions), `open_space`
- Lock/key: POI carries `locked_by: string[]`; key item has `use_effect: "unlock"`; Stage 3 validates match
- Hidden items: `hidden: true` + `reveal_check: { skill, dc }`; revealed by `examine`/`search` via d20 roll (pure code)
- Cross-room peek: exit POI `peek_visibility: "none" | "obvious_only" | "full"` — locked doors forced to `"none"`
- New Stage 2 action types: `pick_up`, `drop`, `equip`, `unequip`, `use_item`, `throw_item`
- Stage 5 returns `characterInventory`, `openSpaceItems`, `adjacentRoomPreviews`

---

## System Gaps (Planned)

These are known gaps not yet implemented, in priority order:

1. **Combat trigger** — No mechanism to flip `gameState` → `combat` or introduce enemy `RoomParticipant`s. Needs encounter condition definitions and a phase-transition handler.
2. **Multi-player polling** — The chat UI has no live updates. A second player's actions are invisible until the page refreshes. Needs polling or SSE on `/api/room/history?roomInstanceId=&since=<timestamp>`.
3. **Sidebar state after room transition** — When `move_to_room` fires, the response returns the new room's state correctly, but the sidebar does not re-run `loadState()` for the new room on its own. It relies on the Stage 5 response, which is correct but only covers character positions — POI states for the new room come from the game action response, not a fresh `GET /api/room/state` call.
