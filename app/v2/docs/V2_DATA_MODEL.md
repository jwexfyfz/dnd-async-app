# V2 Data Model

---

## MessageLog Anatomy

Three distinct entry types, distinguished by `isMechanicalEvent` and `mechanicalSummary`:

| Type | `isMechanicalEvent` | `mechanicalSummary` | `text` |
|---|---|---|---|
| Player action | `false` | `{ "type": "player_action" }` | Raw player input text |
| DM narrative | `false` | `null` | Haiku-generated narrative markdown |
| Mechanical event | `true` | `{ "event": "movement" \| "examine" \| "interact" \| "search" \| "narrative_only" \| "departed" \| "arrived", … }` | `[MECHANICAL] …` summary string |

**Ordering guarantee:** within a single pipeline run, the player action entry is written after Stage 1, mechanical events are written in Stage 3, and the DM narrative is written last in Stage 4. `createdAt` timestamps reliably reflect this order.

`GET /api/room/history` filters to `isMechanicalEvent: false` — returning player actions and DM narratives interleaved in chronological order.

---

## Seed

`prisma/seed.mjs` V2 section seeds **templates only** with stable hardcoded UUIDs. Re-seeding never changes template IDs. Instance tables (GameSession, RoomInstance, PoiInstance, RoomParticipant, MessageLog) are cleared on each seed run.

| Record | Stable ID |
|---|---|
| DungeonTemplate "The Sunken Cellar" | `11111111-1111-1111-1111-111111111111` |
| RoomTemplate "The Entry Chamber" | `22222222-2222-2222-2222-222222222222` |
| PoiTemplate "Stone Fountain" | `33333333-3333-3333-3333-333333333333` |
| PoiTemplate "Wooden Barricade" | `44444444-4444-4444-4444-444444444444` |
| PoiTemplate "Iron Pillar" | `55555555-5555-5555-5555-555555555555` |

`dungeonTemplate.deleteMany()` was removed from the seed's clear block — templates survive re-seeds.

Run: `npm run db:seed`

---

## Key Implementation Decisions

| Decision | Rationale |
|---|---|
| `@prisma/adapter-pg` (not Neon) | Express is a persistent process; pg Pool is correct. Neon adapter is for serverless/edge. |
| `dotenv.config()` in `prisma.ts` | tsx compiles imports to hoisted CJS `require()` calls. Dotenv in `server.ts` runs too late — DB and API key env vars are already read before it executes. Fix: load dotenv in the first module in the import chain. |
| `prisma.$transaction(async tx => ...)` | Callback form guarantees true ACID atomicity; array form does not. |
| `upsert` on `RoomParticipant` | Handles first-visit gracefully without a separate existence check. |
| POI ID validation after Haiku | Defense in depth — rejects hallucinated IDs before they reach the DB. |
| `currentProperties` as exploration state store | JSON merge (`{ ...existing, examined: true, lastInteraction: "opened" }`) avoids schema changes. Original stance verbs are preserved alongside exploration flags. |
| Lazy `PoiInstance` sync in Stage 1 | If new POI templates are added to a room template after a session was created, Stage 1 detects and creates the missing instances before proceeding. Prevents 404s and keeps existing sessions alive across template updates. |
| `move_to_room` reuses existing `RoomInstance` | If the character has visited a room before in this session, their prior POI interaction states are preserved. Only truly new rooms get fresh `PoiInstance`s. |
| Player action stored as `isMechanicalEvent: false` | Distinguishes it from mechanical events so `GET /api/room/history` returns a clean interleaved feed. `mechanicalSummary: { type: "player_action" }` is the discriminator on the frontend. |
| Stable template UUIDs in seed | `upsert` with hardcoded UUIDs — re-seeding never changes template IDs. Instance creation was removed from the seed; the setup flow creates those. |
| URL params for session identity | `/play?room=<id>&char=<id>` makes sessions bookmarkable and shareable without server-side session state. |
