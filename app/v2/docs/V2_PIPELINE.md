# V2 Action Pipeline

`POST /api/game/action` — Request body: `{ characterId, roomInstanceId, playerActionText }`

---

## Pre-Stage — Player Action Storage

After Stage 1 validates the room and character exist, the raw `playerActionText` is written to `MessageLog` with `isMechanicalEvent: false` and `mechanicalSummary: { type: "player_action" }`.

This happens before Stage 2 so that if the AI stages fail, the player's intent is still recorded in history.

---

## Stage 1 — DB Context Lookup

- Parallel fetch: `Character` (stats, inventory) + `RoomInstance` (joins `RoomTemplate`, `PoiInstance[]` → each joins `PoiTemplate`)
- `PoiInstance.currentProperties` is read here to surface `examined`/`interacted` flags to the parser
- Lazy sync: if new `PoiTemplate`s were added to the `RoomTemplate` after this session was created, missing `PoiInstance`s are created automatically
- Fails fast with 404 if either ID doesn't exist

---

## Stage 2 — Intent Parsing (Claude Haiku)

- Model: `claude-haiku-4-5-20251001`
- Forced tool call: `extract_game_intent`
- Tool schema: `{ actions: [{ action_type, target_poi_instance_id, resulting_stance, interaction_result, target_room_template_id }] }`
- `action_type` enum: `change_proximity | examine | interact | search | narrative_only | move_to_room | pick_up | drop | equip | unequip | use_item | throw_item`
- System prompt enumerates valid POI IDs + stances + current `examined`/`interacted` status per POI; exit POIs listed separately with their `target_room_template_id`
- After response, validates `target_poi_instance_id` against known POI set (prevents hallucination)
- Console logs the raw input text and captured actions for dev inspection

---

## Stage 3 — State Mutation (Prisma transaction)

All multi-write actions use `prisma.$transaction(async tx => ...)` (callback form for true ACID atomicity).

| Action | DB write |
|---|---|
| `change_proximity` | `tx.roomParticipant.upsert(...)` sets `combatState: { proximity_target_id, stance }` + MessageLog |
| `examine` | `tx.poiInstance.update(...)` merges `{ examined: true }` into `currentProperties` + MessageLog |
| `interact` | `tx.poiInstance.update(...)` merges `{ interacted: true, lastInteraction: "<verb>" }` into `currentProperties` + MessageLog |
| `search` | MessageLog only (room-wide, no specific POI target) |
| `narrative_only` | MessageLog only |
| `move_to_room` | Finds or creates target `RoomInstance` (with fresh `PoiInstance`s if new), upserts `RoomParticipant` in target room, writes departure log to current room and arrival log to target room; returns `newRoomInstanceId` which shifts all subsequent stages to the target room |

`move_to_room` reuses an existing `RoomInstance` if the character has visited before — prior POI interaction states are preserved. Only truly new rooms get fresh `PoiInstance`s.

---

## Stage 4 — Narrative Generation (Claude Haiku)

- Model: `claude-haiku-4-5-20251001` (swap to `claude-sonnet-4-6` for production)
- Fetches last 5 `MessageLog` entries for the active room (desc, then reversed for chronological order)
- System prompt: DM persona + room context + mechanical fact block describing what actually happened
- Saves output as `MessageLog` with `isMechanicalEvent: false`, `mechanicalSummary: null`

---

## Stage 5 — View State Packager

Returns unified JSON:

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
  },
  "characterInventory": { "bag": [], "equipped": {} },
  "openSpaceItems": [],
  "adjacentRoomPreviews": []
}
```

- `currentNarrative` includes both player action entries and DM narratives (`isMechanicalEvent: false`); the frontend uses only the last entry for the DM bubble
- `poiStates` reflects `currentProperties.examined` and `currentProperties.interacted` at response time
- `uiLayoutAnchors` drives the tactical sidebar — see [V2_MAP.md](./V2_MAP.md)
- `characterInventory`, `openSpaceItems`, `adjacentRoomPreviews` — see [V2_INVENTORY.md](./V2_INVENTORY.md)
