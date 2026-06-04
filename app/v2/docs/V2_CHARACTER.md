# V2 Character Sheet [planned]

Stats, abilities, and skill reference tab. Not yet implemented.

---

## Character Data (current)

`Character` table is shared with V1. Fields relevant to V2:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `stats` | JSON | Point-buy stats (STR, DEX, CON, INT, WIS, CHA) |
| `skills` | JSON | Selected skills from character creation |
| `inventory` | JSON | `{ bag: ItemDefinition[], equipped: { [slot]: ItemDefinition } }` — see [V2_INVENTORY.md](./V2_INVENTORY.md) |

Stats are set at character creation via the point-buy UI in `/setup` Step 2 and are not yet modified by gameplay.

---

## Planned Tab Content

- Stat block (STR/DEX/CON/INT/WIS/CHA with modifiers)
- Skill list with proficiency markers
- Passive perception / initiative (derived)
- Equipped items summary (links to inventory tab)
- XP / level (V1 mechanic, not yet wired in V2)

---

## Dice Roll Integration [planned]

Hidden items use `reveal_check: { skill, dc }` — resolved by a d20 roll against the character's relevant skill modifier. Dice math is pure code (no AI). Implementation lives in Stage 3 alongside the `examine`/`search` mutation.
