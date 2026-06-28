# Seed Authoring Guidance

Rules for seeding campaigns, enemies, rooms, POIs, and class data. Written so that both
human authors and Claude can produce valid, balanced, playable seeds without consulting
anyone else. Every rule here either prevents a gameplay bug or prevents a content gap
that makes the AI dungeon master (DM) give poor narration.

---

## 1. Campaign Structure

### Hierarchy

```
Story → Acts → Scenes → RoomTemplates → PoiTemplates → PoiInstances (runtime)
             ↑ also   → Enemies (scoped to an Act)
             ↑ also   → Items (global, referenced by id)
```

Each **Act** represents a distinct story phase with its own map, enemies, and goals.
A campaign must have at least 2 acts and should have 3–5. Single-act campaigns are not
supported — the act-transition milestone XP is a core progression mechanic.

### Starting level

Every campaign seed must declare its `targetLevelRange: [min, max]` in a comment at the
top of the seed file (e.g. `// targetLevelRange: [1, 5]`). Characters entering with XP
above the range minimum still play normally — encounter design, not XP gates, controls
difficulty.

### Carrying characters between campaigns

Characters carry their full XP and level between campaigns. A future campaign whose
`targetLevelRange` starts at 5 assumes characters arrive at L5. Do not seed "catch-up XP"
for new joiners — the rule is no late joining after the first session.

---

## 2. Proximity and Distance Model

**This app does not use feet.** Every distance calculation uses named grid slots and
`slotGridDistance` from `lib/v2/room-geometry.ts`. This affects how you seed enemies,
POI interactions, ranged attacks, and `mechanicsJson` feature conditions. Any 5e rule
that references feet must be translated before seeding — never write a feet value into
seed data.

### The grid

Each room contains a 3×3 grid of named slots:

```
NW | N  | NE
---+----+---
W  | C  | E
---+----+---
SW | S  | SE
```

`C` (center) is the default position for the `open_space` POI and for characters who
have not taken a specific position. Exits occupy the cardinal slots (`N`, `S`, `E`, `W`).
Objects and NPCs occupy the corner slots (`NW`, `NE`, `SW`, `SE`).

`slotGridDistance(a, b)` returns the Chebyshev distance between two slots (maximum of
horizontal and vertical step difference). Adjacent slots have distance 1; opposite
corners have distance 2.

### Translating 5e distances

| 5e rule says... | Seed as... | Notes |
|---|---|---|
| within 5 ft (adjacent) | `slotGridDistance <= 1` | Melee range, Sneak Attack ally condition |
| within 30–60 ft | `in_same_room` | Covers almost all non-spell abilities |
| within 5 ft of self | `adjacent_slot` | e.g. Aura of Protection (Paladin) |
| can see target | `attacker_visible` | Same room OR remote LoS enrollment |
| out of reach | `in_different_room` | Characters in separate RoomInstances |

**When in doubt, collapse to `in_same_room`.** Rooms are small. Any 5e ability that
works within 60 feet works across the entire room in this app. Only abilities
explicitly requiring adjacency (within 5 ft) need the slot-distance check.

### What this means for ranged attacks

Enemy `rangedAttack.range` is in **grid slots**, not feet. A value of `2` means the
enemy can target any slot in the same room (max slot distance in a 3×3 grid is 2).
A value of `1` means adjacent slots only. There is no "long range" — cross-room attacks
are not supported in the engine.

```js
rangedAttack: {
  damageDice: "1d6+2",
  range: 2,          // slots, not feet — 2 reaches anywhere in the room
  attackBonus: 4,
},
```

### What this means for `mechanicsJson` conditions

Never write `{ kind: 'ally_within_5ft_of_target' }` or any feet value into
`mechanicsJson`. Use only the condition kinds from the approved vocabulary:

```typescript
type ConditionKind =
  | 'attacker_has_advantage'       // roll was made at advantage
  | 'ally_adjacent_to_target'      // slotGridDistance(ally.slot, target.slot) <= 1
  | 'attacker_visible'             // attacker in same room OR remote LoS
  | 'in_same_room'                 // actor and target share roomInstanceId
  | 'status_active'                // { kind: 'status_active', status: string }
  | 'weapon_type'                  // { kind: 'weapon_type', type: 'melee' | 'ranged' }
  | 'no_armor_equipped'            // for Unarmored Defense (Barbarian/Monk)
```

### Cross-room (remote LoS) interactions

Characters enrolled in combat via remote LoS are in a different room. They can:
- Attack enemies in the combat room if they have a ranged attack
- Receive XP for kills
- **Cannot** receive fresh Bardic Inspiration mid-combat (range condition fails)
- **Cannot** benefit from proximity-dependent features (`ally_adjacent_to_target`)

Seed remote-eligible encounters accordingly: don't design a fight where the winning
strategy requires a remote character to be adjacent to an enemy.

---

## 3. XP Calibration

The single most important calibration goal: **characters should reach the campaign's
maximum target level at the start of the final act, not at campaign completion.** The
last act is the payoff for the abilities they just earned; reaching L5 only after the
boss dies means they never use L5 abilities.

### Enemy XP values (seed explicitly, do not derive from maxHp)

Every enemy must have an explicit `xpValue` field matching its 5e Challenge Rating.
Do not use the HP-tier fallback — it was removed.

| CR    | xpValue | Typical maxHp | Use for                              |
|-------|---------|---------------|--------------------------------------|
| 0     | 10      | 1–4           | Vermin, animated objects             |
| 1/8   | 25      | 5–10          | Commoners, giant rats, weak cultists |
| 1/4   | 50      | 11–16         | Goblins, skeletons, stirges          |
| 1/2   | 100     | 17–24         | Zombies, guards, cultist acolytes    |
| 1     | 200     | 25–40         | Hobgoblins, specters, dire wolves    |
| 2     | 450     | 41–65         | Cult fanatics, ettercaps, ghasts     |
| 3     | 700     | 66–90         | Knights, vampiric spawn, werewolves  |
| 4     | 1,100   | 91–115        | Banshees, incubi, helmed horrors     |
| 5     | 1,800   | 116–145       | Gladiators, vrocks, flesh golems     |

XP is awarded flat to every enrolled character (not divided by party size). This is
intentional — async play means uneven participation is the norm.

### Milestone XP

Awarded on act transition to every party member regardless of room or online status.

Formula per campaign level range:

| Target range | Act N→N+1 award                    | Final act entry total |
|--------------|------------------------------------|-----------------------|
| L1–5         | 600 / 2,400 / (0 on completion)   | ≥6,500 XP reachable   |
| L5–10        | 2,000 / 5,000 / 12,000 / (0)     | ≥64,000 XP reachable  |
| L10–15       | 15,000 / 35,000 / 65,000 / (0)   | ≥165,000 XP reachable |

The "0 on completion" is intentional — the final act completion award carries over as a
small bonus to the next campaign (set to ≈5% of the current campaign's XP range) but
does not gate anything in the current campaign.

### Calibration check (run before finalizing any campaign seed)

1. Sum all milestone XP for acts 1 through N-1 (omit the final act completion).
2. Count all enemies in acts 1 through N-1 and multiply each by its `xpValue`.
3. Total must be ≥ the target level threshold for the campaign max level.
4. If the total falls short, add milestone XP — not more enemies. Encounter density
   should be driven by story, not XP grinding.

### Encounter density guidelines per act

| Act position | Encounters | Enemies per encounter | Notes                        |
|--------------|------------|----------------------|------------------------------|
| Act 1        | 3–5        | 1–3                  | Mostly CR 1/4–CR 1/2        |
| Act 2        | 4–6        | 2–4                  | Mix of CR 1/2–CR 2          |
| Act 3+       | 3–5        | 2–4 + 1 boss         | CR 2+ standard; CR 3+ boss  |

Never put more than 4 enemies in a single encounter — the turn-based initiative system
becomes unwieldy and AI narration quality drops above this count.

---

## 4. Enemy Design

### Required fields (all enemies)

```js
{
  name: string,           // Specific, not generic: "Beren's Guard" not "Guard"
  description: string,    // One sentence, flavour only, no stats
  maxHp: number,          // See CR table above
  armorClass: number,     // See CR table above
  attackBonus: number,    // See CR table above
  damageDice: string,     // e.g. "1d6+2", "2d8+3"
  xpValue: number,        // MUST match CR table — never omit
  strength: number,       // 1–20
  dexterity: number,
  constitution: number,
  intelligence: number,   // ≤4 for beasts; 6–10 for humanoid fodder; 10+ for leaders
  wisdom: number,
  charisma: number,
}
```

### Stat guidelines by CR

| CR  | maxHp  | AC    | Attack | Damage  | STR   | DEX   | CON   |
|-----|--------|-------|--------|---------|-------|-------|-------|
| 1/8 | 5–10   | 10–12 | +2     | 1d4+1   | 7–10  | 12–15 | 10–12 |
| 1/4 | 11–16  | 11–13 | +3–4   | 1d6+1   | 10–12 | 13–15 | 11–13 |
| 1/2 | 17–24  | 12–14 | +3–4   | 1d6+2   | 12–14 | 12–14 | 12–14 |
| 1   | 25–40  | 13–15 | +4–5   | 1d8+3   | 14–16 | 12–14 | 14–15 |
| 2   | 41–65  | 13–15 | +5–6   | 2d6+3   | 16–18 | 12–14 | 14–16 |
| 3   | 66–90  | 14–16 | +6–7   | 2d8+3   | 17–20 | 12–14 | 15–17 |

### Enemy diversity rules

- No two adjacent rooms in the same act may have the same enemy as the sole combatant.
- Each act must contain at least 3 distinct enemy types.
- At least one enemy per act must have `intelligence ≥ 10` (capable of strategy, tactics,
  or dialogue — important for AI narration quality).
- At least one enemy per act must have a ranged or special attack (`damageDice` describing
  a thrown or ranged attack, or `specialAbility` field — see below).
- Boss enemies (one per act at most) must have `maxHp` ≥ 2× the act's standard enemy.

### Optional enemy fields

```js
specialAbility: string,       // e.g. "pack_tactics", "multiattack", "web"
rangedAttack: {               // if the enemy can attack at range
  damageDice: string,
  range: number,              // grid slots (NOT feet). 2 = anywhere in the room; 1 = adjacent only
  attackBonus: number,
},
resistances: string[],        // damage types this enemy ignores: "melee", "ranged", "fire",
                              // "bludgeoning", "piercing", "slashing", etc.
                              // A hit whose weapon_type or throw_damage_type matches any entry
                              // deals 0 damage. Used for constructs, undead, raging Barbarians, etc.
recognitionException: string, // story_flag key — if set, enemy will not trigger combat
                              // when that flag is true (e.g. "beren_loyal")
lootTable: [                  // items dropped on death (optional)
  { itemId: string, chance: number },  // chance 0–1
],
```

### Boss design checklist

- `maxHp` at least 2× the act's standard enemy
- At least one `specialAbility`
- A distinct `description` that establishes them as a threat before combat starts
- A `recognitionException` if there is any story path that avoids fighting them
- Loot table with at least one story-relevant item or key

---

## 5. Room and POI Design

### Room required fields

```js
{
  name: string,                   // Evocative, location-specific: "The Flooded Passage"
  baseDescription: string,        // 2–4 sentences. Sets the scene. Never mentions enemies
                                  // by name — the engine adds them dynamically.
  searchFailureNarrative: string, // What the DM says when the player searches and finds
                                  // nothing. Should still feel interesting, not empty.
  map_x: number,                  // Grid position (integer, can be negative)
  map_y: number,
}
```

`baseDescription` must not name enemies that could be absent (dead or fled). Describe
the environment only. Enemies are injected by the engine.

### POI composition rules (per room)

Every room MUST contain:

| POI type     | Count | Notes                                                         |
|--------------|-------|---------------------------------------------------------------|
| `exit`       | ≥1    | One per connected room. Two exits if the room is a junction. |
| `open_space` | 1     | The center of the room. Used for positional actions.         |
| Other types  | ≥3    | At least one must be `interactive` or `npc`.                 |

At least 2 POIs per room must have `examine_details` (skill check reveals).
At least 3 POIs per room must have `perception_details` (passive perception reveals).
No two POIs in the same room may share the same `grid_slot`.

### POI types and their required fields

#### `interactive` — an object the player can manipulate

```js
{
  poi_type: "interactive",
  visibility: "always",
  examine_text: string,           // REQUIRED. What you see on first look.
  examine_details: [              // REQUIRED. At least 2 skill check reveals.
    { skill: string, dc: number, text: string, story_flag?: string }
  ],
  perception_details: [           // REQUIRED. At least 1 passive perception entry.
    { dc: number, text: string }
  ],
  // One or more of:
  items: [...],
  interact_options: [...],
  crouch_beside: { resulting_stance: string },
  wade_into: { resulting_stance: string },
}
```

#### `npc` — a character the player can talk to or fight

```js
{
  poi_type: "npc",
  visibility: "always",
  npc_id: string,                 // snake_case unique identifier
  npc_name: string,               // Display name
  initial_awareness_state: "unaware" | "alert",
  examine_text: string,           // REQUIRED. Physical description.
  examine_details: [              // REQUIRED. At least 2.
    { skill: string, dc: number, text: string }
  ],
  perception_details: [           // REQUIRED. At least 2.
    { dc: number, text: string }
  ],
  interact_options: [             // REQUIRED. At least 2 options.
    {
      label: string,              // Short action label shown to player
      check?: { skill: string, dc: number },
      requires_flag?: string,     // Only shown if this story_flag is set
      success: string,
      success_flag?: string,
      failure?: string,
      easter_egg?: boolean,       // Hidden option, not shown in standard list
    }
  ],
  combat_stats: {                 // REQUIRED if the NPC can be fought
    ac: number,
    max_hp: number,
    damage: string,
    attack_bonus: number,
  },
}
```

NPCs with `initial_awareness_state: "alert"` will trigger combat when the player enters
their room unless a `recognitionException` story flag is active. Set NPCs to `"unaware"`
if they should only fight when attacked first, or when discovered.

#### `positional` — cover, furniture, or terrain used for positioning

```js
{
  poi_type: "positional",
  visibility: "always",
  examine_text: string,           // REQUIRED.
  examine_details: [...],
  perception_details: [...],
  // Optionally: hide_behind, climb_on, etc.
}
```

#### `exit` — passage to another room

```js
{
  poi_type: "exit",
  visibility: "always",
  exit_direction: "N" | "S" | "E" | "W",  // REQUIRED — must match the target room's
                                            // relative position
  peek_visibility: "none" | "partial" | "full",
  locked_by?: string[],          // list of item ids that unlock this exit
  lock_dc?: number,              // DC to pick the lock (Thieves' Tools)
  stand_at:     { resulting_stance: "standing_in_doorway" },
  peer_through: { resulting_stance: "peering_through" },
  enter:        { target_room_template_id: string },  // REQUIRED
  examine_text?: string,
  perception_details: [           // REQUIRED. At least 1. Hints at what's beyond.
    { dc: number, text: string }
  ],
}
```

Exit direction must be consistent: if room A has an exit going "N" to room B, room B
must have an exit going "S" back to room A. Mismatched exits produce navigation bugs.

#### Destructible obstacles (doors and barricades)

Objects that can be broken down — iron doors, barricades, sealed hatches — are seeded as
POIs with an HP pool. The engine handles attacks against them via `tool_demolition` and
`strength_bash` interaction types. Required fields:

```js
{
  id: string,                   // Unique POI id (e.g. "poi-door-1")
  name: string,                 // Display name (e.g. "Iron Cellar Door")
  maxHp: number,                // Total HP before the obstacle is destroyed
  armorClass: number,           // AC to hit the obstacle — represents structural hardness
  damageThreshold: number,      // Per-hit damage must exceed this to apply (like 5e object hardness)
  lockId: string?,              // Item id that unlocks/opens without damage (e.g. "cellar_key_01")
  eligibleInteractions: string[], // Allowed interaction types. Always include at least one of:
                                //   "tool_demolition" — attacked with a tool (crowbar, pickaxe)
                                //   "strength_bash"   — bare STR check (no tool required)
  effectiveTools: string[],     // Tool material categories that bypass damageThreshold when used.
                                // e.g. ["blunt"] (hammers/warhammers), ["sharp"] (axes), ["fire"]
                                // Without a matching tool, each hit must still exceed the threshold.
}
```

**Design rules for destructible obstacles:**
- Every locked door that can be bashed must still have a non-bash alternative (lockpick or key).
  A door that can only be bashed is fine only if STR check is not gated behind a hard DC.
- Set `damageThreshold` proportional to the obstacle's importance: 3 for a weak barricade,
  5 for a standard wooden door, 8+ for reinforced iron. Thresholds above 10 require the party
  to have access to a tool in `effectiveTools` — otherwise it becomes unkillable.
- A destroyed obstacle sets `cp.destroyed = true` in the POI's current properties. Exits that
  were gated by the obstacle become passable. Design room descriptions to work with or without
  the obstacle present (the engine injects its state dynamically).

#### `open_space` — the general center of the room

```js
{
  poi_type: "open_space",
  visibility: "always",
  perception_details: [           // REQUIRED. At least 2.
    { dc: number, text: string }
  ],
  items: [],                      // Always include, even if empty
  interact_options?: [...],       // Easter eggs, environmental interactions
}
```

### Visibility levels

- `visibility_level: 1` — visible immediately on entering the room. Default for all POIs.
- `visibility_level: 2` — only visible after passing a Perception check or after a search.
  Use sparingly (at most 1 per room) for hidden objects, concealed exits, or secret areas.

### grid_slot values

```
NW | N  | NE
---+----+---
W  | C  | E
---+----+---
SW | S  | SE
```

`C` (center) is reserved for `open_space`. `N/S/E/W` are used for exits. `NE/SE/SW/NW`
are preferred for objects and NPCs. No two POIs in the same room may share a `grid_slot`.

### keywordIdentifier rules

- Must be unique within a room's POI list.
- snake_case only.
- Must match a noun the player might type ("fountain", "iron_door", "slumped_guard").
- Never use generic identifiers ("object_1", "thing") — the DM uses these to resolve
  player intent and generic identifiers produce mismatches.

---

## 6. Items

### Required item fields

```js
{
  id: string,          // Globally unique snake_case key within the POI's items array
  name: string,        // Display name, title-case
  description: string, // One sentence. Purpose or flavour. No stats in plain text.
  throwable: boolean,  // REQUIRED. True for most physical items.
}
```

### Optional item fields

```js
hidden: boolean,                  // If true, not visible without a check
reveal_check: { skill: string, dc: number },  // REQUIRED when hidden: true
obvious: boolean,                 // Player is told this item is here immediately
consumable: boolean,              // Removed from inventory on use
use_effect: string,               // Engine key: "heal_2", "unlock", "silence_area_10ft"
equip_slot: string,               // "main_hand", "off_hand", "chest", "amulet", "ring"
equip_bonus: { ac?: number, to_hit?: number, damage?: number },
                                  // ac: armor class bonus when worn
                                  // to_hit: attack roll bonus when equipped as weapon
                                  // damage: flat damage bonus when equipped as weapon
passive_effect: string,           // Always-on effect key
value_gp: number,                 // Gold value (used for selling)
story_flag: string,               // Set on this character when picked up or used

// Weapon-specific fields (required when equip_slot is "main_hand" or "off_hand")
weapon_type: string,              // "melee" | "ranged" | "finesse" | "thrown"
                                  // finesse: attacker uses the better of STR/DEX modifier
                                  // melee/ranged: checked against enemy.resistances — a match → 0 damage
damage_dice: string,              // e.g. "1d6", "1d4+1" — dice rolled when attacking with this weapon
silent: boolean,                  // If true: kills made while hidden count as silent kills
                                  // (no awareness gained by other enemies in the room)

// Throwable-specific fields (relevant when throwable: true and the item deals damage on throw)
throw_damage_type: string,        // Damage type when thrown: "fire", "acid", "bludgeoning", etc.
                                  // Checked against enemy.resistances — a match → 0 damage
                                  // Required for consumable damage items (oil flasks, fire bombs, etc.)
```

### Item design rules

- Every `hidden: true` item MUST have a `reveal_check`. Hidden items without checks are
  permanently undiscoverable — a content bug.
- Story-critical items (keys, quest objects, notes) MUST have `story_flag` set.
- At least 1 item per room should be obtainable without a skill check (`obvious: true` or
  not hidden).
- At most 2 items per room should require the same skill to find. Diversity matters —
  mix Perception, Investigation, and passive reveals.
- Don't put consumables behind checks with DC > 14. High-DC consumables are usually
  never found, creating effectively invisible content.
- Gold/value items: keep `value_gp` proportional to the act. Act 1: 1–15 gp per item.
  Act 2: 5–40 gp. Act 3+: 20–100 gp. Rewards should feel meaningful but not economy-breaking.

### Loot vs story items

Every room should have at least 1 item of each type:
- **Loot item**: generic value (gold, consumable, equipment). No story_flag.
- **Story item**: reveals plot information or enables a later interaction. Has story_flag.

A room with only story items feels unrewarding. A room with only loot feels empty of
narrative content.

---

## 7. Story Flags

### Naming conventions

- snake_case only.
- Prefix with the subject: `beren_roused`, `vorne_key_found`, `occultist_notes`.
- Verbs in past tense for events (`key_found`, `guard_roused`).
- Nouns for knowledge items (`dungeon_layout`, `occultist_notes`).
- Never use generic names (`flag_1`, `event_a`).

### Act transition requirements

Each act MUST define the condition that triggers the transition (`triggerType`). Valid
trigger types: `ACT_START`, `AREA_REACHED`, `STORY_FLAG`, `ENEMY_DEFEATED`, `ITEM_USED`.

The final act MUST be reachable via at least two story paths. A single chokepoint
that can permanently block a player (a required DC check with no alternative, or a
key that only spawns in one place) is a content bug. Every locked door must have either:
a findable key, a pickable lock, or a bashable alternative.

### Story flag design rules

- At least 2 distinct story flags per act (beyond simple discovery flags).
- At least 1 flag per act must be missable (requires a check or a specific action) — this
  gives the DM material to reference on replay.
- Each NPC `interact_option` with `requires_flag` must have a corresponding option
  without `requires_flag` that covers the same beat (so players who miss the flag don't
  hit a dead end).

### The skip path rule

Every major obstacle (locked door, hostile NPC, required boss) must have at least one
alternative approach that bypasses the primary method. Example: the iron door can be
unlocked with the key (primary), picked (DC 16 with Thieves' Tools), or bypassed by
persuading the sleeping guard to open it if roused. Three paths > two > one.

---

## 8. Room Design and Map Connectivity

### Safe rooms

At least one room in every campaign must be marked as a safe room by including a
`canLongRest: true` field in the room's metadata. Safe rooms:
- Have no hostile NPCs.
- Must be reachable before Act 2 begins (early safe room prevents resource death spirals).
- Must have distinct visual indicators seeded into `baseDescription` (mention firelight,
  dry bedrolls, a defensible position, etc.).
- Must include a "Make Camp" POI or an `open_space` with `interact_options` including
  `{ label: "Make Camp", requires_no_combat: true }`.

Recommended safe room count: 1 per 3 rooms, but at minimum 1 per act.

### Map grid rules

- `map_x` and `map_y` define the room's position on the dungeon grid (integer offsets).
- Rooms must not share coordinates.
- Exit connections must be geometrically consistent: if room A is at (0, 0) and has
  a "N" exit to room B, room B must be at (0, -1) (one step north = y decreases).
  Violations create teleporting navigation, which breaks LoS mechanics.

```
Cardinal direction → coordinate delta:
N → y - 1    S → y + 1    E → x + 1    W → x - 1
```

- Dead-end rooms (only one exit) are acceptable but should have rich content to justify
  the detour. A dead-end with no reward or story beat is a content gap.
- Room count per campaign: minimum 3, recommended 5–10 for L1–5. More than 15 rooms
  without additional narrative structure creates navigation confusion for players.

---

## 9. ClassFeature and ClassProgression Seeding

### What needs seeding

For every character class at every level in the campaign's target range:
- One `ClassProgression` row with `featuresUnlocked: string[]` listing feature names.
- One `ClassFeature` row per feature name, with `featureType` and `mechanicsJson` set.

### `featureType` and `mechanicsJson` contract

Every `ClassFeature` row must comply with the Zod schemas in `lib/v2/seed-schemas.ts`.
The seed script validates this automatically. Do not set `featureType` to `PASSIVE` just
to avoid writing `mechanicsJson` — use `PASSIVE` only when the feature genuinely has no
mechanical effect beyond narrative (e.g. a title or cosmetic unlock).

| featureType        | mechanicsJson required? | Notes                                       |
|--------------------|------------------------|---------------------------------------------|
| PASSIVE            | No (null)              | Narrative/cosmetic only                     |
| STAT_MODIFIER      | Yes                    | Must include `field`, `operation`, `value`  |
| RESOURCE_POOL      | No (null)              | Pool definition lives on FeatureResourcePool|
| ACTIVE_ABILITY     | Yes                    | Must include `cost[]` and `effect`          |
| TRIGGERED_EFFECT   | Yes                    | Must include `trigger`, `condition`, `effect`|
| REACTION           | Yes                    | Must include `trigger`, `condition`, `effect`|
| CHOICE_GATE        | Yes                    | Must include `choiceType` and `countAtLevel`|
| SPELLCASTING       | No (null)              | Deferred subsystem — mark only              |

### `implemented` flag

- `implemented` defaults to `false`.
- Set `implemented: true` ONLY when the mutation engine has a tested resolution path
  for this feature.
- A feature with `implemented: false` will appear on the character sheet (dimmed, no
  [Use] button) but never in InitiativeStrip.
- Shipping `implemented: true` without a corresponding smoke test in
  `lib/v2/__tests__/feature-engine.test.ts` is a merge blocker.

### FeatureResourcePool seeding

For every `RESOURCE_POOL` feature, a matching `FeatureResourcePool` row must exist with:
- `poolKey`: globally unique snake_case key (e.g. `second_wind`, `ki_points`)
- `maxByLevel`: sparse JSON map of level → max count (e.g. `{ "1": 1, "10": 2 }`)
- `resetOn`: `SHORT_REST` or `LONG_REST`
- `dieSize`: only for dice-typed pools (superiority dice, inspiration)

The engine fills gaps in `maxByLevel` by using the highest level ≤ the character's
current level. So `{ "1": 2, "6": 3 }` means: levels 1–5 get 2 uses; levels 6+ get 3.

### Seeding order (migration dependency)

When adding new tables or features, seed in this order:
1. `Subclass` rows
2. `ClassProgression` rows
3. `ClassFeature` rows (can reference ClassProgression)
4. `FeatureResourcePool` rows (reference ClassFeature)

Do not seed `CharacterResourceState` rows — these are created at runtime when a
character unlocks the corresponding feature.

---

## 10. Difficulty Calibration

### The unwinnable fight rule

Before publishing any encounter, verify it can be won by a solo character of the
minimum campaign level with average rolls. The test: expected DPR of the character
over 4 rounds must exceed total enemy HP before the character dies. If it cannot, add
an environmental mechanic (a barrel to tip, a door to bar, an NPC to help) or reduce
enemy count by one.

### HP budget per encounter

| Difficulty  | Total enemy HP budget (sum of all enemies)     |
|-------------|------------------------------------------------|
| Easy        | `party_size × target_level × 3`                |
| Medium      | `party_size × target_level × 5`                |
| Hard        | `party_size × target_level × 8`                |
| Boss        | `party_size × target_level × 12`               |

Act 1 should be mostly Easy/Medium. Act 2: Medium/Hard. Act 3: Hard/Boss.

### Resource drain design

Plan rest availability as a ratio:
- Every 2–3 Hard encounters, provide a safe room or an explicit short-rest opportunity
  (a locked room with no enemies, a brief story interlude with no time pressure).
- If the party is expected to exhaust short-rest resources before a boss, the encounter
  leading into the boss should be Easy.

---

## 11. Data Integrity Rules

### ID conventions

- Use UUIDs for all Prisma `@id` fields. Deterministic "named" UUIDs (e.g.
  `"11111111-1111-1111-1111-111111111111"`) are acceptable in seed files for readability
  but must not collide between different seeds in the same database.
- POI template IDs must be unique across the entire seed file, not just within a room.
- Enemy `id` values that appear in tile spawn references (`enemy: "e1-rat-1"`) must
  match the corresponding `prisma.enemy.create` call exactly.

### Cross-reference integrity

- Every `target_room_template_id` in an exit POI must match a room that exists in the
  same seed (or a previously migrated room in the database).
- Every `itemId` referenced in a container's `containerInventory` must be seeded before
  the container.
- Every `story_flag` referenced in `requires_flag` must be set somewhere in the campaign
  (either by another interact_option's `success_flag` or by an item's `story_flag`).
  Flags that are checked but never set are unreachable content.

### Field completeness

- `description` on enemies: one sentence. No stat numbers in prose (players read this
  in the AI narration and stat numbers break immersion).
- `examine_text` on POIs: must stand alone — the player reads this before making any
  skill checks, so it must be meaningful without the check reveals.
- `perception_details[0].dc` should be ≤ 12. The lowest-DC entry is what most players
  will see passively; make it interesting, not trivial ("you see a barrel") but not
  gated ("DC 18 notice the nearly invisible glyph"). Save DC 16+ reveals for the second
  or third entry in the array.

---

## 12. Validation Checklist

Run this check before submitting any new seed file:

### XP Calibration
- [ ] All enemies have `xpValue` matching the CR table
- [ ] Milestone XP for acts 1 through N-1 is set per the formula in §2
- [ ] Total available XP (milestone + combat) meets the target level threshold
  before the final act

### Enemy Coverage
- [ ] No two adjacent rooms share the same sole enemy type
- [ ] Each act has ≥3 distinct enemy types
- [ ] Each act has ≥1 enemy with `intelligence ≥ 10`
- [ ] Each act has ≥1 enemy with a ranged or special attack
- [ ] Boss enemies have `maxHp` ≥ 2× the act's standard enemy and a `lootTable`

### Room and POI Coverage
- [ ] Every room has ≥1 exit POI, 1 open_space POI, ≥3 other POIs
- [ ] Every room has ≥2 POIs with `examine_details`
- [ ] Every room has ≥3 POIs with `perception_details`
- [ ] No two POIs in the same room share a `grid_slot`
- [ ] All exit directions are geometrically consistent (N↔S, E↔W)
- [ ] Every exit POI has `target_room_template_id` pointing to a seeded room
- [ ] At least 1 safe room exists and is reachable before Act 2

### Items
- [ ] Every `hidden: true` item has a `reveal_check`
- [ ] Every story-critical item has `story_flag`
- [ ] At least 1 non-hidden item per room
- [ ] Every weapon item (`equip_slot: "main_hand"` or `"off_hand"`) has `weapon_type` and `damage_dice`
- [ ] Every throwable damage item (oil flask, fire bomb, etc.) has `throw_damage_type`
- [ ] `throw_damage_type` values match an existing `enemy.resistances` category if resistances are used

### Story Flags
- [ ] Every `requires_flag` has a corresponding `success_flag` source in the campaign
- [ ] Every major obstacle has ≥2 approaches
- [ ] Each act has ≥2 distinct story flags
- [ ] The final act is reachable via ≥2 story paths

### Proximity and Distance
- [ ] No seed data contains feet-based distance values
- [ ] All `rangedAttack.range` values are in grid slots (≤2 for same-room targeting)
- [ ] All `mechanicsJson` conditions use only the approved `ConditionKind` vocabulary
- [ ] No condition uses `ally_within_5ft_of_target` or any feet-named variant —
      use `ally_adjacent_to_target` (slotGridDistance ≤ 1) or `in_same_room` instead

### ClassFeature Seeding
- [ ] Every non-PASSIVE/non-SPELLCASTING ClassFeature has valid `mechanicsJson`
- [ ] Every `implemented: true` feature has a smoke test
- [ ] Every `RESOURCE_POOL` feature has a matching `FeatureResourcePool` row

### Data Integrity
- [ ] All POI template IDs are unique across the entire seed file
- [ ] All enemy tile spawn IDs match enemy `create` IDs exactly
- [ ] All `target_room_template_id` values point to seeded rooms
- [ ] All `requires_flag` values have a setting `success_flag` somewhere in the campaign
