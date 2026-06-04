# V2 Map & Room Rendering

Full visual design spec: [MAP_RENDERING_PLAN.md](./MAP_RENDERING_PLAN.md)

---

## Runtime State Shape

The tactical map is driven by `uiLayoutAnchors` and `poiIndex` from the Stage 5 response:

```json
{
  "poiIndex": {
    "<poi_instance_id>": "<poi template name>"
  },
  "poiStates": {
    "<poi_instance_id>": { "examined": false, "interacted": true }
  },
  "uiLayoutAnchors": {
    "<poi_instance_id>": [
      { "entityId": "...", "entityType": "character", "name": "Aria", "stance": "aggressive" }
    ],
    "open_space": [
      { "entityId": "...", "entityType": "character", "name": "Bran", "stance": null }
    ]
  }
}
```

- Each key in `uiLayoutAnchors` is a POI instance ID or the sentinel `"open_space"`
- Each value is the list of characters currently at that location, with their active stance
- `poiStates` drives the examined/interacted badges on each POI card
- `open_space` is a synthetic POI — every room has one, seeded per `RoomTemplate`. Characters not at any named POI appear here; dropped items in open space are tracked in `currentProperties.floor_items[]`

---

## POI Types

| Type | Purpose |
|---|---|
| `interactive` | Loot / examine targets |
| `positional` | Cover / stance positions |
| `exit` | Room transitions; carries `target_room_template_id` and `peek_visibility` |
| `open_space` | Implicit catch-all; always present |

Exit POIs carry `peek_visibility: "none" | "obvious_only" | "full"`. Locked doors are forced to `"none"`.

---

## Grid Layout

From [MAP_RENDERING_PLAN.md](./MAP_RENDERING_PLAN.md): each room has a **3×3 grid of POI slots** (NW, N, NE, W, C, E, SW, S, SE). Room positions on the dungeon grid use explicit `map_x` / `map_y` on `RoomTemplate` — not BFS-computed from exit directions.

---

## Multi-player Gap [planned]

The map has no live updates. A second player's movement is invisible until the page refreshes. Needs polling or SSE on `/api/room/history?roomInstanceId=&since=<timestamp>`.
