# V2 System — Context Hub

## What V2 Is

A **forked, parallel version** of the D&D app running as a standalone Express.js server on port 3001. It shares the same Postgres database (and Prisma schema) as the Next.js V1 app but targets a different set of tables — the "room system" tables. No existing V1 files were modified.

---

## Architecture

```
Next.js app (port 3000)    ←── V1, untouched
Express server (port 3001) ←── V2, all new files under src/
  └── Shares same DATABASE_URL / Prisma schema
  └── Loads env from .env.local via dotenv in src/lib/prisma.ts
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `DungeonTemplate` | Top-level dungeon container |
| `RoomTemplate` | Blueprint for a room (name, description) |
| `PoiTemplate` | Point of Interest blueprint; `defaultProperties` JSON holds verbs → stances |
| `GameSession` | Active session instance (has `gameState`: exploration/combat) |
| `RoomInstance` | Live room linked to a GameSession + RoomTemplate |
| `PoiInstance` | Live POI; `currentProperties` tracks examined/interacted flags and item state |
| `RoomParticipant` | Links a Character to a RoomInstance; `combatState` JSON = `{proximity_target_id, stance}` |
| `MessageLog` | All events in a room — see [V2_DATA_MODEL.md](./V2_DATA_MODEL.md) |
| `Character` | Shared with V1 |
| `User` | Shared with V1 |

`ClientStateView` exists in schema but is not a real DB table (no `@@map`, unused).

---

## File Structure

```
src/
  lib/
    prisma.ts          # PrismaClient using @prisma/adapter-pg + pg.Pool; loads dotenv here
    supabaseAdmin.ts   # Verifies Supabase JWTs via REST
  middleware/
    requireAuth.ts     # Bearer token → supabaseUser on req
  routes/
    configRoute.ts     # GET /api/config
    characters.ts      # GET/POST /api/me/characters
    setup.ts           # Sessions, room templates, room history, room state
  controllers/
    gameController.ts  # The 5-stage AI pipeline
  types/
    game.ts            # TypeScript interfaces
  public/
    setup.html         # 3-step setup flow
    play.html          # Game chat UI
  server.ts            # Express entry point
```

---

## Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Redirects to `/setup` |
| `GET` | `/setup` | — | Serves setup.html |
| `GET` | `/play` | — | Serves play.html |
| `GET` | `/api/config` | — | Supabase URL + anon key |
| `GET` | `/api/me/characters` | ✓ | List characters for logged-in user |
| `POST` | `/api/me/characters` | ✓ | Create a new character |
| `GET` | `/api/room-templates` | — | List all room templates |
| `GET` | `/api/sessions?characterId=` | ✓ | List active sessions for a character |
| `POST` | `/api/sessions` | ✓ | Create GameSession + RoomInstance + RoomParticipant |
| `GET` | `/api/room/history?roomInstanceId=` | — | Last 50 player actions + DM narratives |
| `GET` | `/api/room/state?roomInstanceId=` | — | Character positions, POI states, activeState |
| `POST` | `/api/game/action` | — | Run the 5-stage pipeline |

---

## Dev Commands

```bash
# Recommended: bypasses RTK hook, console.log visible
node_modules/.bin/tsx src/server.ts

# Also works but stdout is swallowed by RTK
npm run v2:dev

npm run dev        # Start Next.js V1 on port 3000
npm run db:seed    # Re-seed (templates stable, instances cleared)
```

---

## System Gaps

1. **Combat trigger** — No mechanism to flip `gameState` → `combat` or introduce enemy `RoomParticipant`s.
2. **Multi-player polling** — No live updates; a second player's actions are invisible until page refresh.
3. **Sidebar after room transition** — Sidebar doesn't re-run `loadState()` when `move_to_room` fires; relies on Stage 5 response instead.

---

## Sub-Documents

| Document | Covers |
|---|---|
| [V2_PIPELINE.md](./V2_PIPELINE.md) | 5-stage action pipeline — intent parsing, state mutation, narrative generation, view state |
| [V2_DATA_MODEL.md](./V2_DATA_MODEL.md) | MessageLog anatomy, seed, key implementation decisions |
| [V2_UI_FLOWS.md](./V2_UI_FLOWS.md) | Setup flow, play page, auth pattern |
| [V2_MAP.md](./V2_MAP.md) | Room/POI layout, `uiLayoutAnchors`, tactical sidebar state |
| [V2_INVENTORY.md](./V2_INVENTORY.md) | Inventory runtime state, item storage locations [partial] |
| [V2_CHARACTER.md](./V2_CHARACTER.md) | Stats, skills, character sheet tab [planned] |
| [ITEM_MECHANICS_PLAN.md](./ITEM_MECHANICS_PLAN.md) | Full item schema, lock/key, hidden items, throw mechanics |
| [MAP_RENDERING_PLAN.md](./MAP_RENDERING_PLAN.md) | Visual map design, 3×3 grid, mobile bottom sheet |
| [STORY-FLOW.md](./STORY-FLOW.md) | End-to-end user journey from login to game completion |
| [THE-SUNKEN-CELLAR.md](./THE-SUNKEN-CELLAR.md) | Dungeon content — rooms, POIs, story beats |
| [V2-STORY-TEST-GUIDE.md](./V2-STORY-TEST-GUIDE.md) | Manual test guide for story mechanics |
