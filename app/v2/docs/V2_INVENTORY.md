# V2 Inventory [partial]

Full item mechanics design: [ITEM_MECHANICS_PLAN.md](./ITEM_MECHANICS_PLAN.md)

---

## Runtime State Shape

Stage 5 returns inventory and floor item state:

```json
{
  "characterInventory": {
    "bag": [ /* ItemDefinition[] */ ],
    "equipped": {
      "main_hand": { /* ItemDefinition */ },
      "chest": { /* ItemDefinition */ }
    }
  },
  "openSpaceItems": [ /* ItemDefinition[] on the room floor */ ],
  "adjacentRoomPreviews": [ /* exit POI peek results */ ]
}
```

`Character.inventory` (JSON column) is normalized to `{ bag: ItemDefinition[], equipped: { [slot]: ItemDefinition } }` on read.

---

## Item Storage Locations

| Location | Where stored |
|---|---|
| Seeded loot on a POI | `PoiTemplate.defaultProperties.items[]` |
| Items already taken from a POI | `PoiInstance.currentProperties.items_taken[]` |
| Dropped items on a POI | `PoiInstance.currentProperties.floor_items[]` |
| Dropped items in open space | `open_space` PoiInstance `currentProperties.floor_items[]` |
| Character carried items | `Character.inventory.bag[]` |
| Character equipped items | `Character.inventory.equipped[slot]` |

---

## Action Types (Stage 2)

`pick_up`, `drop`, `equip`, `unequip`, `use_item`, `throw_item` — parsed by the intent parser and mutated in Stage 3.

Lock/key: POI carries `locked_by: string[]`; key item has `use_effect: "unlock"`; Stage 3 validates the match before unlocking.

---

## Inventory Tab UI [planned]

A dedicated tab on the play page showing:
- Equipped slots grid
- Bag item list with use/drop/equip actions
- Item detail on tap/hover

Not yet implemented. Stage 5 already returns `characterInventory` — the tab just needs to consume it.
