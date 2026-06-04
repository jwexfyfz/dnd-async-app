# V2 Item Mechanics — Finalized Plan

## Item Schema (unified, used everywhere)

```typescript
interface ItemDefinition {
  id: string                         // stable, e.g. "healing_vial", "loose_stone"
  name: string
  quantity?: number                  // default 1 (for stackable future use)
  equip_slot?: 'main_hand' | 'off_hand' | 'head' | 'chest' | 'legs' | 'feet' | 'ring' | 'amulet'
  equip_bonus?: Record<string, number>  // { attack: 2, defense: 1 }
  throwable?: boolean
  consumable?: boolean               // single use, destroyed on use
  charges?: number                   // wands/staves — decremented on use
  on_depleted?: 'destroy' | 'inert'  // what happens when charges hit 0
  use_effect?: string                // "heal_4", "unlock" (use against locked POI)
  story_flag?: string                // marks quest-critical items
  improvised?: boolean               // ad-hoc environmental item
  obvious?: boolean                  // visible from adjacent rooms through exit peek
  hidden?: boolean                   // requires reveal check to appear
  reveal_check?: { skill: string; dc: number }
  value_gp?: number                  // price/weight deferred but field exists
}
```

---

## Character Inventory Shape

`Character.inventory` (JSON column) is normalized on read to:

```typescript
interface CharacterInventory {
  bag: ItemDefinition[]
  equipped: {
    main_hand?: ItemDefinition
    off_hand?: ItemDefinition
    head?: ItemDefinition
    chest?: ItemDefinition
    legs?: ItemDefinition
    feet?: ItemDefinition
    ring?: ItemDefinition
    amulet?: ItemDefinition
  }
}
```

Empty/null inventory → `{ bag: [], equipped: {} }`. Written back as JSON after every mutation.

---

## Where Items Live (no schema changes)

| Source | Storage |
|---|---|
| Seeded POI loot | `PoiTemplate.defaultProperties.items[]` — full ItemDefinition objects |
| Picked up / not yet taken | tracked via `PoiInstance.currentProperties.items_taken[]` (array of IDs) |
| Discovered hidden items | tracked via `PoiInstance.currentProperties.revealed_items[]` (array of IDs) |
| Dropped items (any position) | `PoiInstance.currentProperties.floor_items[]` — full ItemDefinition objects |
| Character bag + equipped | `Character.inventory` JSON blob |

---

## POI Types

`PoiTemplate.defaultProperties.poi_type` discriminates behavior:

| Type | Purpose |
|---|---|
| `interactive` | has items, examine verbs, can be locked/unlocked |
| `positional` | tactical anchor only — stances, no items, no examine verbs |
| `exit` | room transition, carries `peek_visibility` and `move_to_room` target |
| `open_space` | implicit floor POI, auto-created per room — holds dropped items |

### open_space POI

Every `RoomTemplate` is seeded with one `open_space` PoiTemplate. When a `RoomInstance` is created (new session or `move_to_room`), the open_space `PoiInstance` is created alongside named POIs. Lazy sync in Stage 1 also catches missing instances.

Characters not proximate to any named POI appear under `uiLayoutAnchors.open_space`. Items dropped in open space land in the open_space PoiInstance's `floor_items`. Stage 5 exposes these as `openSpaceItems: ItemDefinition[]` at the top level of the view state.

---

## POI Visibility

`PoiTemplate.defaultProperties.visibility`:

| Value | Meaning |
|---|---|
| `"always"` | default — visible to all characters in the room |
| `"proximity_only"` | only visible to characters currently proximate to this POI |

Stage 5 filters `poiStates` and items based on character's `combatState.proximity_target_id` vs each POI's visibility.

---

## Lock / Key Pairs

Door/container POIs carry:
```json
{ "locked_by": ["key_id_1", "key_id_2"] }
```

Key items carry `use_effect: "unlock"`. Stage 3 for `use_item` against a locked POI:
1. Checks `item.id ∈ poi.defaultProperties.locked_by[]`
2. On match: merges `{ unlocked: true }` into `PoiInstance.currentProperties`
3. On mismatch: writes narrative-only mechanical event ("wrong key")

A locked exit POI (`locked_by` set + `!currentProperties.unlocked`) has its `peek_visibility` forced to `"none"` in Stage 5.

`move_to_room` on a locked door is blocked in Stage 3: check `locked_by` present and `!currentProperties.unlocked` before allowing transition.

---

## Hidden Items + Reveal Checks

Items with `hidden: true` are excluded from Haiku's item list and from Stage 5 `poiStates` unless their ID appears in `PoiInstance.currentProperties.revealed_items[]`.

**`examine` action (updated):**
- Marks POI as examined
- For each hidden item with `reveal_check` not yet revealed: rolls d20 + `character.skillsModifiers[skill]` (pure code)
- Success: adds item ID to `revealed_items`
- Roll results logged in `mechanicalSummary` and console

**`search` action (updated):**
- Room-wide Investigation sweep
- All hidden items with `reveal_check.skill === "investigation"` across all POIs get checked
- Same roll logic, updates `revealed_items` on each affected POI in one transaction

---

## Cross-Room Visibility (exit peek)

Exit POI template carries:
```json
{ "peek_visibility": "none" | "obvious_only" | "full" }
```

Stage 5 for each exit POI with `peek_visibility !== "none"`:
1. Finds the target `RoomInstance` for this session (skips if never visited — unvisited rooms have no instance)
2. Filters items by peek level: `obvious_only` → `item.obvious === true` only; `full` → all non-hidden
3. Includes characters in the target room
4. Returns as `adjacentRoomPreviews[exitPoiInstanceId]: { roomName, items, characters }`

---

## New Action Types

Added to Stage 2 Haiku tool schema:

| Action | Required fields | What Stage 3 does |
|---|---|---|
| `pick_up` | `target_poi_instance_id`, `item_id` | removes from POI (items_taken or floor_items), adds to character bag |
| `drop` | `item_id` | removes from bag, adds to current POI's floor_items (open_space if in open space) |
| `equip` | `item_id` | moves from bag to equipped[slot]; swaps if slot occupied |
| `unequip` | `item_id` | moves from equipped[slot] to bag |
| `use_item` | `item_id`, optional `target_poi_instance_id` | resolves use_effect, handles consumption/charges |
| `throw_item` | `item_id`, optional `target_poi_instance_id` | removes from bag, lands in target POI floor_items |
| `give_item` | `item_id`, `target_character_id` | moves item between two characters in same room atomically |

---

## Equip Slots

Slot occupancy enforced in Stage 3 (not by Haiku). On `equip`:
1. Resolve `item.equip_slot`
2. If slot occupied: move current equipped item to bag, equip new item (swap)
3. If empty: move item from bag to equipped slot

`unequip` moves item from slot to bag. Cursed items (future: `item.cursed`) can block `unequip`.

---

## Stage 5 View State Shape (updated)

```json
{
  "roomInstanceId": "...",
  "currentNarrative": [...],
  "activeState": "exploration",
  "poiIndex": { "<id>": "Stone Fountain", ... },
  "poiStates": {
    "<id>": {
      "examined": false,
      "interacted": false,
      "unlocked": false,
      "items": [{ ItemDefinition }, ...]
    }
  },
  "uiLayoutAnchors": { "<poi_id>": [...], "open_space": [...] },
  "characterInventory": {
    "bag": [...],
    "equipped": { "main_hand": {...} }
  },
  "openSpaceItems": [...],
  "adjacentRoomPreviews": {
    "<exit_poi_id>": { "roomName": "...", "items": [...], "characters": [...] }
  }
}
```

---

## Seed Additions (Entry Chamber)

### Stone Fountain (33333333)
```json
"items": [{ "id": "healing_vial", "name": "Healing Vial", "consumable": true, "use_effect": "heal_4", "hidden": true, "reveal_check": { "skill": "perception", "dc": 10 } }]
```

### Iron Pillar (55555555)
```json
"items": [{ "id": "coin_pouch", "name": "Coin Pouch", "value_gp": 5, "hidden": true, "reveal_check": { "skill": "investigation", "dc": 12 } }]
```

### Dark Passage North (66666666)
```json
"peek_visibility": "obvious_only"
```

### Entry Chamber open_space (bbbbbbbb — NEW)
```json
{ "poi_type": "open_space", "visibility": "always", "items": [{ "id": "loose_stone", "name": "Loose Stone", "throwable": true, "improvised": true, "obvious": true }] }
```

### Stagnant Pool (99999999 in Flooded Passage)
```json
"items": [{ "id": "waterlogged_journal", "name": "Waterlogged Journal", "story_flag": "merchant_notes", "obvious": true }]
```
(obvious = visible from Entry Chamber through peek)

### Flooded Passage open_space (cccccccc — NEW)
```json
{ "poi_type": "open_space", "visibility": "always", "items": [] }
```

---

## Console Logs (for testing)

All item mutations log at `[items]` prefix:
- `[items] pick_up: <char> picked up "<item>" from "<poi>"`
- `[items] drop: <char> dropped "<item>" at "<poi>"`
- `[items] equip: <char> equipped "<item>" → slot <slot>` (swap noted if applicable)
- `[items] unequip: <char> unequipped "<item>" from slot <slot>`
- `[items] use_item: <char> used "<item>" (effect: <use_effect>)`
- `[items] use_item unlock: <char> unlocked "<poi>" with "<item>"`
- `[items] throw_item: <char> threw "<item>" → "<landing_poi>"`
- `[items] give_item: <char> gave "<item>" to <target_char>`
- `[items] reveal-check: <char> rolled <total> (d20+<mod>) vs DC <dc> for "<item>" — PASS/FAIL`
- `[items] search-reveal: <n> item(s) checked across <m> POI(s), <k> revealed`
- `[items] inventory: bag=<n> items, equipped=[<slot>:<name>, ...]`
- `[items] peek: exit "<poi>" → "<room>" — <n> item(s) visible`

---

## Explicitly Deferred

- `weight` / encumbrance (field exists on ItemDefinition for future use)
- cursed items (block unequip)
- attunement (3-slot cap for magic items)
- charges on wands/staves (field exists, enforcement deferred)
- item identification (`identified: boolean`)
- `give_item` action type (schema and Stage 3 plumbing ready, Haiku prompt omits until multi-player is live)
- crafting, economy, durability
