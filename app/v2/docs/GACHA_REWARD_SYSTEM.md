# Gacha & Reward System Design

## Pre-Implementation Cleanup: Remove Artificer & Blood Hunter

These two classes have been removed from the game. The following references remain and must be cleaned up before or alongside implementation.

| File | What to remove |
|------|---------------|
| `prisma/seed.mjs` | Blood Hunter section (lines ~926–987) and Artificer section (lines ~988–1049) — class progressions, features, subclasses, resource pools |
| `prisma/seed-class-progression.ts` | Full Artificer block (~line 1276 onward) |
| `scripts/patch-subclasses.mjs` | Blood Hunter subclass entries (crimson_rite_order, ghostslayer, lycan) |
| `lib/v2/combat-engine.ts` | `crimson_rite` status effect logic (~lines 1068, 1384–1390) |
| `lib/v2/__tests__/ui-resource-pools.test.ts` | `crimson_rite` test case |
| `lib/class-emoji.ts` | `Artificer: "⚙️"` entry |
| `lib/skills.ts` | Artificer skills and skill count entries |
| `lib/leveling.ts` | `Artificer: { die: 8, avg: 5 }` entry |
| `app/v1/actions/handle-player-action.test.ts` | Artificer reference in generateDeterministicChips test |

Characters with class `"Artificer"` or `"Blood Hunter"` in the database should not exist (neither class was selectable in character creation). No migration needed — seed cleanup is sufficient.

---

## Overview

A streak-based engagement system with a gacha pull mechanic, narratively framed as gifts from a **guardian angel** — a persistent in-world presence flavored per class (divine for Paladin/Cleric, trickster spirit for Rogue, patron manifestation for Warlock, etc.). Pulls are earned through consistent play and first-time milestones, not purchased.

---

## Streak System

### Mechanics
- **Streak** = consecutive calendar days in **UTC** with 1+ meaningful in-game action. Day boundary = midnight UTC. The current UTC time is displayed in the Guardian tab so players always know how much of their day is left.
- Side-chat messages do not count toward streak
- Rate-limited: only one action per 5 minutes registers for streak purposes (anti-spam)

### Early Habit Formation (Days 1–7)
- Auto-advantage on the first dice roll of each UTC day, no user action required
- Expires after day 7; players must maintain a streak to earn ongoing rewards

### Streak Shield
- Earned every 7 consecutive UTC days (one shield per completed cycle)
- **Automatic** — at session open, the server compares today's UTC date string (`YYYY-MM-DD`) to `lastStreakDate`. If one UTC day was skipped:
  - If `streakShields > 0`: decrement `streakShields` by 1, preserve `streakDays`, send notification: *"Your streak shield saved your N-day streak."*
  - If `streakShields === 0`: reset `streakDays` to 0, send notification: *"Your streak was broken."*
  - If two or more UTC days were skipped: streak breaks regardless of shields (one shield covers exactly one missed day)
- State visible in Guardian tab streak section only — this is the single source of truth for shield count
- Players can bank multiple shields (one per 7-day milestone)

---

## Pull System

### Pull Sources
| Source | Cadence |
|--------|---------|
| Streak | 1 pull per 7 consecutive days |
| Milestones | One-time pulls for first-time achievements (see below) |

### Pity System
- Guaranteed legendary at 40 total lifetime pulls
- Soft pity: legendary rate increases by 10% per pull starting at pull 30
- Pity is per-character (the guardian angel's relationship is with your character specifically)

**Rate formula:**
```
legendary = min(1.0, 0.02 + max(0, pull - 29) × 0.10)
remaining = 1 - legendary
common    = remaining × (60/98)
uncommon  = remaining × (28/98)
rare      = remaining × (10/98)
```

**How rates shift during soft pity:**
| Pull | Common | Uncommon | Rare | Legendary |
|------|--------|----------|------|-----------|
| 1–29 | 60% | 28% | 10% | 2% |
| 30 | 53.9% | 25.1% | 9.0% | 12% |
| 32 | 42.4% | 19.8% | 7.1% | 32% |
| 35 | 22.4% | 10.4% | 3.7% | 63% |
| 38 | 4.9% | 2.3% | 0.8% | 92% |
| 40 | 0% | 0% | 0% | 100% |

**Roll mechanic: real d100, legend fades at soft pity**

The d100 is a genuine roll — no theater, no reverse-engineered numbers. This preserves the game's "dice math is pure code" identity.

The legend area has two states based on pull count:

| Pull count | Legend area content |
|------------|-------------------|
| 1–29 | Fixed brackets: 1–60 Common · 61–88 Uncommon · 89–98 Rare · 99–100 Legendary |
| 30+ (soft pity) | Brackets replaced by: *"Your guardian angel is shifting the odds in your favor."* |

When soft pity kicks in, the brackets disappear and the angel's words appear in the same space. The transition is the allusion — players who notice understand the rules have shifted without being told explicitly. The roll remains honest; only the legend changes. Rarity is still revealed by the item card after the number lands.

### Pity Display — Qualitative Tiers

Rather than showing a pull counter or percentage, the pull UI shows a text description based on the current effective legendary probability. Players feel the escalation without seeing exact numbers.

| Effective Rate | Display Text |
|----------------|-------------|
| < 10% (pulls 1–29) | *"Your guardian angel offers you a small token of their favor."* |
| 10–30% (pull 30–31) | *"Your guardian angel stirs — your dedication hasn't gone unnoticed."* |
| 30–50% (pull 32–33) | *"Your guardian angel believes you've earned something meaningful."* |
| 50–70% (pull 34–35) | *"Your guardian angel thinks you deserve a truly good gift."* |
| 70–90% (pull 36–37) | *"Your guardian angel is preparing something exceptional for you."* |
| 90%+ (pull 38–39) | *"Your guardian angel's greatest gift stirs — it is almost time."* |
| Guaranteed (pull 40) | *"Your guardian angel's gift awaits."* |

### GachaRevealSheet

Follows the same bottom sheet pattern as `CombatRollSheet` (`idle → rolling → landed → dismissed`). Uses a **d100 die** styled identically to the combat d20 but in a distinct non-combat color (TBD). A rarity legend sits beside the die.

**Rarity brackets (legend, always fixed):**
```
1  – 60   Common
61 – 88   Uncommon
89 – 98   Rare
99 – 100  Legendary
```

The d100 is a genuine roll. During soft pity (pull 30+) the rarity brackets disappear and are replaced by angel flavor text — the real odds shift invisibly under the hood.

**Rarity colors:**
| Tier | Color |
|------|-------|
| Common | Gray |
| Uncommon | Green |
| Rare | Blue |
| Legendary | Gold + subtle glow |

**Animation sequence:**

| State | Content |
|-------|---------|
| `idle` | Pity flavor text + **Open Gift** button. Legend rows dim/neutral. |
| `rolling` | d100 cycles through numbers in base color. Flavor text remains. Legend neutral. |
| `landed` | Number locks. Die border + matching legend row simultaneously flash to rarity color. Brief pause (~500ms) to let rarity register before item appears. |
| `reveal` | Item card slides up with persistent rarity-colored border. Legendary adds a subtle gold glow. Flavor text replaced by item name, description, slot/type. |
| `dismissed` | Sheet closes, item added to bag silently. |

Legendary is the only tier where the die border flash is accompanied by a glow — it should feel visually distinct from all other rarities.

### Pull Rates
| Tier | Rate |
|------|------|
| Common | 60% |
| Uncommon | 28% |
| Rare | 10% |
| Legendary | 2% |

---

## Milestone Pulls

First-time achievements that naturally front-load pulls for new players. Veterans have already earned them.

Milestones are grouped by when they're likely to trigger. Early ones front-load pulls for new players; veteran ones sustain long-term engagement.

**Early game — most trigger in the first 1–2 sessions:**
| Name | Trigger |
|------|---------|
| First Steps | Complete your first session |
| Explorer | Discover your first new room |
| Treasure Hunter | Loot your first item |
| Armed & Ready | Equip your first weapon |
| Bloodied | Enter combat for the first time |
| Silver Tongue | Complete your first NPC dialogue |
| Survivor | Reach 0 HP and survive |

**Mid game — require a few sessions of play:**
| Name | Trigger |
|------|---------|
| Battle-Hardened | Reach character level 2 |
| Decisive Blow | Land your first critical hit |
| Cutpurse | Accumulate 100 gold across your character's lifetime |
| Hidden Path | Discover your first secret room or hidden POI |
| Full Kit | Fill every equipment slot simultaneously |
| Marked for Death | Have an enemy target you with priority |
| Pack Rat | Carry 10 items in your bag at once |
| Against the Odds | Win a combat encounter while at 5 HP or below |
| Graverobber | Loot a body after combat |
| True Companion | Play 3 sessions with the same party member |

**Long-term — veteran engagement:**
| Name | Trigger |
|------|---------|
| Ascended | Reach character level 5 |
| Seasoned | Take 500 exploration actions (not rate-limited) |
| Veteran | Win 100 combat encounters |
| Untouchable | Complete a combat encounter without taking damage |
| Devoted | Maintain a 30-day streak |

### Surfacing Milestones

**Two surfaces, two jobs:**

1. **Milestone tracker** (in character sheet or rewards panel) — shows all milestones with locked/unlocked state. Players see what's coming before it happens. Creates anticipation and gives new players a checklist to work toward.

2. **In-narrative delivery** — when a milestone is hit, the guardian angel appears as a special chat message type, distinct from normal narrative. The pull is delivered in-world. Example:
   > *A warmth settles over you as a familiar presence stirs. "Well fought," the voice murmurs. A small parcel materializes at your feet.*
   > **[Guardian's Gift — tap to open]**

If a milestone was hit while offline, the delivery surfaces on next session open as a bottom sheet (not a blocking popup), dismissible after opening.

---

## Item Pool

Constrained by current `ItemDefinition` engine support. Items marked ⚠️ require additional engine work before they can function mechanically (noted in implementation section).

### Effective Odds Per Item

Within each tier, all items have equal probability — the tier's rate divided evenly across the pool. Rare and legendary pools are **filtered to the player's class** before dividing.

| Tier | Tier Rate | Pool Size | Odds Per Item |
|------|-----------|-----------|---------------|
| Common | 60% | 4 items (shared) | 15.0% each |
| Uncommon | 28% | 9 items (shared) | ≈ 3.1% each |
| Rare | 10% | 5 items (3 class + 2 standalone) | 2.0% each |
| Legendary | 2% | 7 items (class only) | ≈ 0.29% each |

During soft pity (pulls 30+) the legendary tier rate increases per the pity formula, but the 7-item split within legendary remains even.

### Duplicate Prevention

**Equipment items are permanently excluded from future pulls once received.** Tracked by item definition ID in `pullHistory` — not by current inventory. A player who discards an item does not get it back in their pool; the exclusion is permanent.

**Consumables are never excluded** — they get used up, so duplicates are always useful.

**Pool shrinking:** As a player collects equipment from rare and legendary tiers, their pool for those tiers shrinks. When the legendary pool reaches 1 remaining item, every legendary pull is guaranteed to be that final set piece — a natural set-completion mechanic, no additional logic required.

**Implementation:** Before resolving a pull, filter the rolled tier's item list by removing any item whose definition ID appears in `character.pullHistory`. Then pick uniformly from the remaining items. If filtering produces an empty list (all equipment in that tier collected), fall back to the tier below and reroll.

### Common (60%) — Consumables & Utility

4 items, each at **60% / 4 = 15%** per pull. Pool is shared across all classes.

| Item | Description | Mechanic |
|------|-------------|----------|
| Healing Potion | "A vial of red liquid that tastes of copper and herbs. Drink to restore 8 HP." | `use_effect: 'heal_8'`, `consumable: true` |
| Greater Healing Potion | "A rich, glowing draught mixed by a skilled alchemist. Drink to restore 16 HP." | `use_effect: 'heal_16'`, `consumable: true` |
| Alchemist's Fire | "A volatile flask of magical oil that ignites on contact. Throw at an enemy to set them ablaze, dealing ongoing fire damage." | `throwable: true`, `throw_effect: 'ignite'` |
| Smoke Pellet | "A clay pellet packed with enchanted powder. Throw it at your feet during combat to erupt a cloud of thick smoke. All enemies who were actively targeting you lose their priority focus for one round. Your next attempt to hide this turn also has advantage — the smoke provides enough cover to slip away or reposition. Has no effect outside of combat." | `throwable: true`, `combat_usable: true`, `target: 'self'`, `use_effect: 'smoke'` ⚠️ needs engine support |

### Uncommon (28%) — Equipment & Consumables

9 items, each at **28% / 9 ≈ 3.1%** per pull.

**Equipment (equip once, permanent benefit while worn):**

| Item | Description | Mechanic |
|------|-------------|----------|
| Ring of Protection | "A plain iron band etched with warding runes. Passively grants +1 AC while worn." | `equip_slot: 'ring'`, `equip_bonus: { ac: 1 }` |
| Amulet of Warding | "A carved bone pendant on a leather cord. Passively grants +1 AC while worn." | `equip_slot: 'amulet'`, `equip_bonus: { ac: 1 }` |
| Bracers of Accuracy | "Snug leather bracers threaded with enchanted sinew. Steadies your aim regardless of weapon — grants +1 to all attack rolls while worn. Equips in the hands slot." | `equip_slot: 'hands'`, `equip_bonus: { to_hit: 1 }` ⚠️ needs hands slot + to_hit aggregation |
| Boots of Swiftness | "Soft boots with a quicksilver lining. Your feet move before your mind catches up — grants an initiative bonus at the start of combat." | `equip_slot: 'feet'`, `passive_effect: 'initiative_bonus'` ⚠️ needs passive_effect engine |

**Consumables (single use, kept in bag until used):**

| Item | Description | Mechanic |
|------|-------------|----------|
| Potion of Heroism | "A bubbling red-gold liquid that floods you with battlefield confidence. Drink to gain advantage on your next attack roll this combat. Single use." | `use_effect: 'heroism'`, `consumable: true` ⚠️ needs one-shot advantage flag on character |
| Bead of Force | "A crystalline bead charged with compressed magical force. Throw at one enemy to deal 1d4 force damage automatically — no attack roll needed. Costs your main action; you cannot also attack this turn. Useful when your accuracy is unreliable." | `throwable: true`, `throw_effect: 'force_1d4'` ⚠️ needs auto-hit throw_effect |
| Potion of Iron Will | "A gritty iron-colored tonic that hardens the body against the next blow. Drink to halve the next source of damage you take this combat. Does not stack with other Iron Will potions." | `use_effect: 'half_damage_once'`, `consumable: true` ⚠️ needs half-damage flag on initiative entry |
| Battle Draught | "A sharp-smelling red liquid that sends the limbs moving before the mind catches up. Drink before entering combat — you act first in the initiative roll regardless of your d20 result. Cannot be used once combat has started." | `use_effect: 'initiative_top'`, `usable_when: 'out_of_combat'`, `consumable: true` ⚠️ needs initiative override on enterCombat; greyed out with tooltip "Must be used before combat" when `inCombat === true` |
| Oil of Sharpness | "A vial of shimmering oil applied to your weapon before the next strike. Grants +1 to your next attack roll. Single use." | `use_effect: 'sharpen_next_attack'`, `consumable: true` ⚠️ needs one-shot attack modifier flag |

### Rare (10%) — Per-Class Sets

**Pool is filtered to the player's class.** Each player sees exactly 5 rare items: their class's 3-item set + 2 class-agnostic standalone drops. Each item is **10% / 5 = 2%** per pull.

Three items per class: the named weapon plus two supporting pieces. Two standalone rare items (Shadowweave Cloak, Ring of Sharpness) drop for any class regardless of set.

#### Fighter — Veteran's Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Soldier's Edge | "A veteran's blade, well-worn but impeccably balanced. Deals 1d8 damage with +1 to attack rolls." | `damage_dice: '1d8'`, melee, `equip_bonus: { to_hit: 1 }` |
| chest | Veteran's Plate | "Battle-worn plate mail bearing campaign marks from a dozen fights. Grants +6 AC." | `equip_bonus: { ac: 6 }` |
| ring | Veteran's Signet | "A steel ring stamped with a crossed-swords crest. The wearer's strikes find their mark more often. Grants +1 to attack rolls." | `equip_bonus: { to_hit: 1 }` ⚠️ needs ring→to_hit |

#### Rogue — Shadowrun Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Shadowfang | "A narrow blade honed for silent work. Deals 1d6 finesse damage with +1 to attack rolls. Makes no sound on impact." | `damage_dice: '1d6'`, finesse, `silent: true`, `equip_bonus: { to_hit: 1 }` |
| chest | Shadowrunner's Leathers | "Supple leather treated to muffle both sound and silhouette. Grants +4 AC." | `equip_bonus: { ac: 4 }` |
| feet | Shadowrunner's Boots | "Thin-soled boots with a silence-dampening weave. Grants an initiative bonus at the start of combat." | `passive_effect: 'initiative_bonus'` ⚠️ needs passive_effect engine |

#### Ranger — Warden's Trail Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Wardenbow | "A recurve bow of seasoned yew strung with spider silk. Deals 1d8 ranged damage with +1 to attack rolls." | `damage_dice: '1d8'`, ranged, `equip_bonus: { to_hit: 1 }` |
| chest | Warden's Trail Vest | "A layered leather vest built for long travel and fast draws. Grants +4 AC." | `equip_bonus: { ac: 4 }` |
| head | Warden's Trail Hood | "A weather-worn hood that narrows the eye to movement in the trees. Grants +1 AC." | `equip_bonus: { ac: 1 }` |

#### Cleric — Faithful's Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Ironclad Mace | "A heavy mace blessed with divine certainty. Deals 1d6 damage with +1 to attack rolls." | `damage_dice: '1d6'`, melee, `equip_bonus: { to_hit: 1 }` |
| chest | Faithful's Mail | "Chain mail blessed at the altar and worn with conviction. Grants +5 AC." | `equip_bonus: { ac: 5 }` |
| amulet | Amulet of Minor Healing | "A simple holy symbol storing one healing prayer. Use to restore 8 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_8'` |

#### Wizard — Sage's Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Sage's Staff | "A carved hardwood staff capped with a resonance crystal. Deals 1d6 damage with +1 to attack rolls." | `damage_dice: '1d6'`, melee, `equip_bonus: { to_hit: 1 }` |
| chest | Sage's Robes | "Layered robes inscribed with warding glyphs at every hem. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| ring | Ring of Focus | "A crystal ring that sharpens the mind's eye into more precise strikes. Grants +1 to attack rolls." | `equip_bonus: { to_hit: 1 }` ⚠️ needs ring→to_hit |

#### Barbarian — Forgeborn Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Forgeborn Axe | "A massive two-handed axe forged from volcanic iron. Deals 1d12 damage with +1 to attack rolls. Requires both hands." | `damage_dice: '1d12'`, melee, two_handed, `equip_bonus: { to_hit: 1 }` |
| chest | Forgeborn Hide | "Cured beast hide reinforced with iron studs and volcanic resin. Grants +5 AC." | `equip_bonus: { ac: 5 }` |
| head | Forgeborn Warhelm | "A dented but unbroken iron helm built to take whatever comes. Grants +2 AC." | `equip_bonus: { ac: 2 }` |

#### Bard — Duelist's Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Duelist's Rapier | "A slender blade favored by those who fight with flair. Deals 1d8 finesse damage with +1 to attack rolls." | `damage_dice: '1d8'`, finesse, `equip_bonus: { to_hit: 1 }` |
| chest | Duelist's Coat | "A tailored longcoat with a hidden mail lining. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| amulet | Amulet of the Silver Tongue | "A carved mask pendant storing a healing word. Use to restore 6 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_6'` |

#### Paladin — Sworn Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Warden's Warhammer | "A divine warhammer etched with oaths of protection. Deals 1d8 damage with +1 to attack rolls." | `damage_dice: '1d8'`, melee, `equip_bonus: { to_hit: 1 }` |
| chest | Sworn Plate | "Ceremonial full plate engraved with the tenets of your oath. Grants +7 AC." | `equip_bonus: { ac: 7 }` |
| amulet | Amulet of Lay on Hands | "A holy amulet containing a reserve of healing power. Use to restore 10 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_10'` |

#### Monk — Wind Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Wind Kama | "A curved blade that flows with the wielder's movement. Deals 1d6 finesse damage with +1 to attack rolls." | `damage_dice: '1d6'`, finesse, `equip_bonus: { to_hit: 1 }` |
| hands | Wind Wraps | "Cloth hand wraps threaded with ki-focusing cord. Grants +1 to all attack rolls including unarmed strikes." | `equip_bonus: { to_hit: 1 }` ⚠️ needs hands slot |
| feet | Wind Sandals | "Sandals that barely touch the ground. Grants an initiative bonus at the start of combat." | `passive_effect: 'initiative_bonus'` ⚠️ needs passive_effect engine |

#### Druid — Thornwood Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Thornwood Staff | "A gnarled staff of living wood, still faintly growing at the tips. Deals 1d6 damage with +1 to attack rolls." | `damage_dice: '1d6'`, melee, `equip_bonus: { to_hit: 1 }` |
| chest | Thornwood Vestments | "Woven bark-cloth grown in a sacred grove, still breathing slowly. Grants +4 AC." | `equip_bonus: { ac: 4 }` |
| amulet | Amulet of the Grove | "A seed pendant from a dying elder tree. Use to restore 6 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_6'` |

#### Sorcerer — Arcane Volatility Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Arcane Dagger | "A slender blade crackling with unstable arcane energy. Deals 1d4 finesse damage with +1 to attack rolls." | `damage_dice: '1d4'`, finesse, `equip_bonus: { to_hit: 1 }` |
| chest | Arcane Silks | "Enchanted robes that crackle faintly with untethered potential. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| ring | Ring of Unstable Power | "A ring of solidified wild magic that channels chaos into precision. Grants +1 to attack rolls." | `equip_bonus: { to_hit: 1 }` ⚠️ needs ring→to_hit |

#### Warlock — Hexblade's Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Hexblade's Shortblade | "A blade bound to your pact, drinking from the patron's power. Deals 1d6 finesse damage with +1 to attack rolls." | `damage_dice: '1d6'`, finesse, `equip_bonus: { to_hit: 1 }` |
| chest | Hexblade's Mantle | "A dark cloak-coat that absorbs ambient shadow. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| ring | Ring of the Lesser Pact | "A signet ring bearing your patron's lesser seal. Use to restore 10 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_10'` |

#### Standalone Rare Drops (any class)
| Item | Description | Mechanic |
|------|-------------|----------|
| Shadowweave Cloak | "A travel cloak woven from enchanted shadow-silk. When you are actively hiding, grants advantage on Stealth checks. Provides no benefit while in the open — the magic only works when you're already in cover." | `equip_slot: 'chest'`, `passive_effect: 'stealth_adv_while_hiding'` ⚠️ needs passive_effect engine |
| Ring of Sharpness | "A silver ring engraved with a cutting edge motif. The enchantment sharpens the wearer's focus, translating into more precise strikes regardless of weapon. Grants +1 to attack rolls." | `equip_slot: 'ring'`, `equip_bonus: { to_hit: 1 }` ⚠️ needs ring→to_hit |

### Legendary Sets (7 items per class, 84 total — 12 classes)

**Pool is filtered to the player's class.** Each player sees exactly 7 legendary items — their class's full set. Each item is **2% / 7 ≈ 0.286%** per pull (before soft pity). With 7 items and nearly no duplicates possible before cycling all 7, set completion is a very long-term goal.

**Slots per set:** `main_hand` · `off_hand` · `head` · `chest` · `legs` · `feet` · `ring` or `amulet`

Items marked ⚠️ have a planned passive ability requiring engine work — they function via base AC/charges today.

---

#### Fighter — Ironclad Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Ironclad Cleaver | "A heavy cleaver forged from folded iron ore, balanced for relentless swings. Deals 1d8+2 damage with +2 to attack rolls." | `damage_dice: '1d8+2'`, melee, `equip_bonus: { to_hit: 2 }` |
| off_hand | Ironclad Bulwark | "A tower shield bearing the Ironclad crest, proof against anything short of a siege weapon. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| head | Ironclad Helm | "A full-face iron helm, dented from old battles and still standing. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| chest | Ironclad Breastplate | "Interlocked iron plates proven in a hundred fights. Grants +8 AC." | `equip_bonus: { ac: 8 }` |
| legs | Ironclad Greaves | "Shin and knee protection forged to match the full set. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| feet | Ironclad Sabatons | "Iron-plated boots that ring on stone with every step. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| ring | Ring of Second Wind | "A steel ring carved with lungs mid-breath. Use to recover 10 HP once. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_10'` |

#### Rogue — Whisper Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Whisperblade | "A blade so narrow it leaves no sound on impact. Deals 1d6+2 finesse damage with +2 to attack rolls. Silent." | `damage_dice: '1d6+2'`, finesse, `silent: true`, `equip_bonus: { to_hit: 2 }` |
| off_hand | Parrying Dagger | "A notched dagger designed to catch and redirect blades. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| head | Shadowveil Hood | "A thin cloth hood that seems to absorb ambient light. Grants +1 AC. Planned: advantage on Perception checks while hidden." | `equip_bonus: { ac: 1 }` ⚠️ planned: perception advantage |
| chest | Shadowveil Leathers | "Treated leather that muffles both sound and silhouette. Grants +4 AC." | `equip_bonus: { ac: 4 }` |
| legs | Shadowveil Legwraps | "Close-fitting wraps that reduce the rustle of movement. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Whisperstep Boots | "Boots soled with compressed wool and shadowweave. Grants +1 AC. Planned: footsteps make no sound." | `equip_bonus: { ac: 1 }` ⚠️ planned: silent movement |
| ring | Ring of Evasion | "A tarnished silver ring worn smooth by anxious handling. Use as a bonus action on your turn — you can still attack. Absorbs the next hit you take this round entirely, dealing 0 damage. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'evade'` ⚠️ needs evade engine support |

#### Barbarian — Stormfang Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Stormfang Axe | "A massive axe whose blade crackles faintly even in still air. Deals 1d12+2 damage with +2 to attack rolls. Two-handed." | `damage_dice: '1d12+2'`, two_handed, `equip_bonus: { to_hit: 2 }` |
| off_hand | Stormfang Talisman | "A carved fang hung on iron wire, a trophy from something larger. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| head | Stormfang Warhelm | "A horned iron helm fitted for battle at full fury. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| chest | Stormfang Hide | "Thick beast hide cured in storm-salt brine and hammered flat. Grants +7 AC." | `equip_bonus: { ac: 7 }` |
| legs | Stormfang Legguards | "Layered hide wrappings reinforced at the knee with iron bands. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| feet | Stormfang Stompers | "Heavy boots that shake the floor with each step. Grants +1 AC. Planned: initiative bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: initiative bonus |
| amulet | Amulet of Reckless Power | "An iron amulet etched with claw marks over claw marks. Grants +1 AC. Planned: bonus damage while raging." | `equip_bonus: { ac: 1 }` ⚠️ planned: rage damage bonus |

#### Ranger — Warden Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Sureshot Bow | "A recurve bow of ironwood with a spider-silk string that never needs re-stringing. Deals 1d8+2 ranged damage with +2 to attack rolls." | `damage_dice: '1d8+2'`, ranged, `equip_bonus: { to_hit: 2 }` |
| off_hand | Warden's Bracer | "A leather bracer worn on the bow arm to deflect bowstring snap. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| head | Warden's Cowl | "A hood stitched with natural patterns that blend into forest movement. Grants +1 AC. Planned: tracking and Perception bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: tracking / perception bonus |
| chest | Warden's Cloak | "A layered travel cloak built for long watches in rough terrain. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| legs | Warden's Legguards | "Reinforced leather greaves with silent-step backing. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Warden's Striders | "Light boots with gum-sole silencing and ankle support for uneven ground. Grants +1 AC. Planned: initiative bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: initiative bonus |
| ring | Ring of the Huntsman | "A copper ring etched with prey-tracks circling the band. Grants +1 AC. Planned: bonus against favored enemy type." | `equip_bonus: { ac: 1 }` ⚠️ planned: favored enemy bonus |

#### Paladin — Oathkeeper Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Oathkeeper | "A warhammer engraved with every word of your oath. Deals 1d8+2 damage with +2 to attack rolls. Use to channel a minor heal (8 HP). 2 charges — resets on long rest." | `damage_dice: '1d8+2'`, melee, `equip_bonus: { to_hit: 2 }`, `charges: 2`, `use_effect: 'heal_8'` |
| off_hand | Oathkeeper Shield | "A kite shield bearing your order's sigil, never tarnished. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| head | Oathkeeper Helm | "A full-face battle helm with a flame motif at the crest. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| chest | Oathkeeper Plate | "Full ceremonial plate that never seems to dull no matter what it's put through. Grants +9 AC." | `equip_bonus: { ac: 9 }` |
| legs | Oathkeeper Greaves | "Plate greaves worn by those who do not retreat. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| feet | Oathkeeper Sabatons | "Heavy plate boots that ring like a bell on stone. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| ring | Ring of Divine Grace | "A gold ring set with a white stone that glows faintly in the dark. Use to restore 12 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_12'` |

#### Monk — Ironweave Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| hands | Ironweave Wraps | "Silk hand wraps threaded with wire of enchanted iron, bound to your strikes. Grants +2 to all attack rolls including unarmed. Equips in the hands slot." | `equip_bonus: { to_hit: 2 }` ⚠️ hands slot; planned: enchants unarmed strikes |
| off_hand | Ironweave Focus Beads | "A loop of smooth stone beads used to count breath and strikes. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| head | Ironweave Headband | "A plain cloth headband that channels focus inward. Grants +1 AC. Planned: ki point bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: ki point bonus |
| chest | Ironweave Gi | "A reinforced training gi worn over lightweight armor weave. Grants +4 AC." | `equip_bonus: { ac: 4 }` |
| legs | Ironweave Trousers | "Close-fitting trousers with flexible knee reinforcement for ground fighting. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| feet | Ironweave Sandals | "Thin sandals that keep ground-feel without sacrificing speed. Grants +1 AC. Planned: initiative bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: initiative bonus |
| amulet | Amulet of the Open Palm | "A jade disk carved with an outstretched hand, hung on braided cord. Grants +1 AC. Planned: unarmed damage bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: unarmed damage bonus |

#### Cleric — Blessed Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Blessed Mace | "A devotional mace that hums with stored prayer. Deals 1d6+2 damage with +2 to attack rolls. Use to heal 6 HP. 3 charges — resets on long rest." | `damage_dice: '1d6+2'`, melee, `equip_bonus: { to_hit: 2 }`, `charges: 3`, `use_effect: 'heal_6'` |
| off_hand | Blessed Aegis | "A round shield inscribed with the full symbol of your deity. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| head | Blessed Mitre | "A ceremonial headdress that broadcasts divine authority. Grants +1 AC. Planned: channel divinity bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: channel divinity bonus |
| chest | Blessed Vestments | "Layered ceremonial robes reinforced with hidden chainmail panels. Grants +6 AC." | `equip_bonus: { ac: 6 }` |
| legs | Blessed Greaves | "Plate greaves worn by the church's field clerics through long campaigns. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| feet | Blessed Sandals | "Simple sandals blessed at the altar on the day of their making. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| ring | Ring of Divine Favor | "A bronze ring inscribed with a prayer wheel. Use to heal 8 HP. 2 charges — resets on long rest." | `charges: 2`, `use_effect: 'heal_8'` |

#### Druid — Moonbeam Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Moonbeam Sickle | "A stone-tipped sickle that glows faintly under moonlight. Deals 1d6+2 finesse damage with +2 to attack rolls. Use to restore 8 HP. 2 charges — resets on long rest." | `damage_dice: '1d6+2'`, finesse, `equip_bonus: { to_hit: 2 }`, `charges: 2`, `use_effect: 'heal_8'` |
| off_hand | Moonbeam Totem | "A carved antler totem wrapped in living moonlit moss. Grants +1 AC. Use to restore 6 HP. 1 charge — resets on long rest." | `equip_bonus: { ac: 1 }`, `charges: 1`, `use_effect: 'heal_6'` |
| head | Moonbeam Antler Crown | "A crown of shed antlers wrapped in living vines that bloom in moonlight. Grants +1 AC. Planned: nature sense passive." | `equip_bonus: { ac: 1 }` ⚠️ planned: nature sense passive |
| chest | Moonbeam Barkweave | "Armor woven from living bark strips, still breathing in rhythm with the forest. Grants +5 AC." | `equip_bonus: { ac: 5 }` |
| legs | Moonbeam Legwraps | "Vine-woven wraps that harden on impact like bark. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Moonbeam Treads | "Soft-soled shoes grown from living moss over a carved wood frame. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| amulet | Amulet of the Wild | "A green stone amulet shaped like a curled leaf, warm to the touch. Grants +1 AC. Planned: wild shape bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: wild shape bonus |

#### Wizard — Arcanist Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Arcanist's Staff | "A gnarled staff topped with an arcane lens that focuses magical force into a beam. Deals 1d8+2 damage with +2 to attack rolls. Use to fire a ranged arcane blast (2d6 force, targets one enemy). 3 charges — resets on long rest." | `damage_dice: '1d8+2'`, melee, `equip_bonus: { to_hit: 2 }`, `charges: 3`, `use_effect: 'arcane_blast'` ⚠️ needs arcane_blast engine support |
| off_hand | Arcanist's Tome | "A leather-bound spellbook bound to your wrist by a silver chain. Grants +1 AC. Planned: spell DC bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: spell DC bonus |
| head | Arcanist's Hat | "A wide-brimmed hat stitched with memory-binding runes along the brim. Grants +1 AC. Planned: arcane recovery bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: arcane recovery bonus |
| chest | Arcanist's Robes | "Layered silk robes woven with deflection sigils at every layer. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| legs | Arcanist's Legwraps | "Enchanted wraps that insulate against magical backlash. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Arcanist's Boots | "Boots with a faint hover that cushions magical recoil. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| ring | Ring of Arcane Might | "A blue-stoned ring that amplifies the wearer's magical focus into physical precision. Grants +1 to attack rolls." | `equip_bonus: { to_hit: 1 }` ⚠️ needs ring→to_hit engine support |

#### Bard — Muse Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Silvered Rapier | "A rapier with a blade silvered for style and function in equal measure. Deals 1d8+2 finesse damage with +2 to attack rolls." | `damage_dice: '1d8+2'`, finesse, `equip_bonus: { to_hit: 2 }` |
| off_hand | Muse's Lute Shard | "A fragment of a legendary lute, still strung with one resonant string. Grants +1 AC. Planned: bardic inspiration bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: bardic inspiration bonus |
| head | Muse's Cap | "A velvet cap with a single iridescent feather that never loses its color. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| chest | Muse's Coat | "A long embroidered coat with a mail lining hidden beneath the silk. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| legs | Muse's Leggings | "Fitted performance leggings reinforced at the knees for long stage fights. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Muse's Dancing Boots | "Heeled boots whose soles seem to anticipate the next step. Grants +1 AC. Planned: initiative bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: initiative bonus |
| amulet | Amulet of the Muse | "A coin-shaped amulet engraved with a comedy mask. Use to heal 6 HP. 2 charges — resets on long rest. Planned: bardic inspiration charge." | `charges: 2`, `use_effect: 'heal_6'` ⚠️ planned: bardic inspiration charge |

#### Sorcerer — Chaos Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Chaos Shard | "A crystallized fragment of a wild magic storm, sharpened to a blade and barely contained. Deals 1d6+2 finesse damage with +2 to attack rolls. Planned: wild magic surge on critical hit." | `damage_dice: '1d6+2'`, finesse, `equip_bonus: { to_hit: 2 }` ⚠️ planned: wild magic surge on crit |
| off_hand | Chaos Orb | "A glass orb containing a miniature storm that rages in silence. Grants +1 AC. Planned: sorcery point bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: sorcery point bonus |
| head | Chaos Crown | "A circlet of fused crystalline energy, never quite the same color twice. Grants +1 AC. Planned: metamagic bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: metamagic bonus |
| chest | Chaos Robes | "Robes that shift color unpredictably, making the wearer difficult to track. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| legs | Chaos Legwraps | "Silk wraps suffused with residual wild magic that sparks faintly. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Chaos Steps | "Boots that occasionally leave faintly glowing footprints. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| amulet | Amulet of Wild Magic | "A cracked amulet containing bottled chaos, sealed with wax and luck. Grants +1 AC. Planned: wild surge on critical hit." | `equip_bonus: { ac: 1 }` ⚠️ planned: wild surge on crit |

#### Warlock — Soul Set
| Slot | Item | Description | Mechanic |
|------|------|-------------|----------|
| main_hand | Soul Reaver | "A blade that drinks faintly from the life of those it cuts, feeding the pact. Deals 1d8+2 finesse damage with +2 to attack rolls." | `damage_dice: '1d8+2'`, finesse, `equip_bonus: { to_hit: 2 }` |
| off_hand | Soul Tome | "A bound grimoire that whispers in your patron's voice when you hold it. Grants +1 AC. Planned: eldritch blast bonus." | `equip_bonus: { ac: 1 }` ⚠️ planned: eldritch blast bonus |
| head | Soul Cowl | "A deep hood that obscures the face from mundane and magical sight alike. Grants +2 AC." | `equip_bonus: { ac: 2 }` |
| chest | Soul Cloak | "A shadowy cloak that drifts even in still air, as though it has somewhere to be. Grants +3 AC." | `equip_bonus: { ac: 3 }` |
| legs | Soul Legwraps | "Wrappings of shadow-threaded cloth that dampen sound and light. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| feet | Soul Treads | "Boots that make no sound and leave no tracks on any surface. Grants +1 AC." | `equip_bonus: { ac: 1 }` |
| ring | Ring of the Pact | "A black iron ring bearing your patron's seal, warm even in cold. Use to restore 10 HP. 1 charge — resets on long rest." | `charges: 1`, `use_effect: 'heal_10'` |


---

## Engine Work Required

Before items marked ⚠️ can function, the following need implementation. Items are ordered roughly by complexity.

---

### 1. Hands Slot

**The hands slot is not Monk-only.** Bracers of Accuracy (uncommon) is available to all classes — any character can equip a hands item alongside their weapon. The Monk-specific behavior is only in item 5 below (unarmed strikes using the hands slot bonus when no weapon is equipped). Every other class just gets the `to_hit` or `ac` bonus while wearing hands items.

**Stacking:** hands items fully stack with `main_hand` and `off_hand`. A character can have all three simultaneously — the hands slot represents worn accessories (bracers, gauntlets, wraps), not a held item.

**What needs to change:**
- `types/v2-game.ts:52` — add `'hands'` to the `equip_slot` union: `'main_hand' | 'off_hand' | 'head' | 'chest' | 'legs' | 'feet' | 'ring' | 'amulet' | 'hands'`
- `CharacterSheet.tsx` — add a `hands` slot render between `ring` and `amulet` in the equipment grid
- `starting-equipment.ts` / `ItemDefinition` seed data — update Bracers of Accuracy and Ironweave Wraps from `equip_slot: 'ring'` to `equip_slot: 'hands'`
- Loot bag display and any slot-label maps that enumerate valid slots need the new entry

No combat logic changes required for the slot itself — the bonus is applied via item 2 below.

---

### 2. `equip_bonus.to_hit` Aggregation Across All Slots

Currently `to_hit` is read only from `main_hand` in `game-controller.ts:1012`:
```ts
toHitBonus: mainHand.equip_bonus?.to_hit,
```

This single value is passed to `resolveCombatAction` and applied to attack rolls. Rings, amulets, and hands items with `to_hit` bonuses are silently ignored.

**What needs to change:**
- `game-controller.ts` (around line 1007–1013) — before building `equippedWeapon`, sum `to_hit` from all equipped slots:
  ```ts
  const allEquipped = Object.values(characterInventory.equipped);
  const totalToHit = allEquipped.reduce((sum, item) =>
    item ? sum + (item.equip_bonus?.to_hit ?? 0) : sum, 0);
  // then pass totalToHit into equippedWeapon instead of mainHand.equip_bonus?.to_hit
  ```
- Affects: Bracers of Accuracy, Ring of Sharpness, Ring of Arcane Might, and all ring/amulet `to_hit` entries in legendary sets.

---

### 3. `passive_effect` Engine

`passive_effect` is typed on `ItemDefinition` (`types/v2-game.ts:65`) but never read anywhere. Two values are planned:

**`initiative_bonus`** — when an item with this passive is equipped, the character's initiative roll should receive +2 (or a flat modifier).
- Where to wire: `combat-engine.ts` inside `enterCombat` where initiative slots are built (~line 103). Read the character's equipped items, sum any `initiative_bonus` passives, add to the initiative roll.
- Affects: Boots of Swiftness (uncommon), Warden's Striders (Ranger), Ironweave Sandals (Monk), Muse's Dancing Boots (Bard), Stormfang Stompers (Barbarian).

**`stealth_adv_while_hiding`** — grants advantage on Stealth checks only when the character's `isHiding === true`.
- Where to wire: wherever Stealth check dice are rolled (check for passive on equipped chest/cloak slot before applying advantage). The "while hiding" condition prevents it from granting free advantage in open combat.
- Affects: Shadowweave Cloak (rare).

---

### 4. `use_effect` Extensions

`use_effect` is dispatched in `combat-engine.ts:1231` but only the existing consumable cases (`heal_N`, etc.) are handled. Three new values are needed:

**`smoke`** (Smoke Pellet)
- On use: (a) remove the using character from all enemy `priorityTargetId` fields in the current `combatState.initiativeOrder` for 1 round; (b) set a temporary flag granting advantage on the character's next Stealth/hide check that turn.
- Both effects expire at the start of the character's next turn.
- No new status type needed — can track via a `smokedUntilRound` field on the combat state actor entry.

**`evade`** (Ring of Evasion)
- **Does not auto-trigger.** The player must explicitly declare use on their turn as a **bonus action** (e.g. "I attack the goblin and activate my Ring of Evasion"). They can still make their normal attack. This sets an `evading: true` flag on their initiative entry.
- Effect: the next attack that connects against them this round deals 0 damage. The flag clears at the start of their next turn whether used or not.
- Charges: 1 per **long rest**. Long rest = HP restored to maximum, either via explicit rest action in the narrative or at the start of a new session when the DM grants rest.
- Implementation: check `evading` flag in incoming damage resolution before applying HP reduction; if true, set damage to 0 and clear the flag. Parse "activate ring of evasion" / "use ring of evasion" as a `use_item` bonus action alongside the main attack action.

**`arcane_blast`** (Arcanist's Staff)
- Costs the player's **main action** for that turn — they cannot also make a melee staff attack in the same turn. Max 1 blast per turn.
- 3 charges means 3 uses across multiple turns or encounters before a long rest, not 3 blasts in one turn.
- On use: roll `1d20 + proficiency + intelligence_modifier` against one target's AC; on hit deal `2d6` force damage.
- Can reuse the existing ranged attack resolution path — synthesize a weapon entry with `weapon_type: 'ranged'` and `damage_dice: '2d6'` for that action only.
- Charges reset on **long rest** (same definition as Ring of Evasion above).

---

### 5. Unarmed Strikes (Monk)

When a Monk has no `main_hand` weapon equipped, their attacks are unarmed. The Ironweave Wraps legendary should enchant these.

**What needs to change:**
- `game-controller.ts` — when building `equippedWeapon` and `mainHand` is null, check for a `hands` slot item and synthesize a pseudo-weapon:
  ```ts
  const handsItem = characterInventory.equipped.hands;
  const isMonk = character.characterClass === 'Monk';
  if (!mainHand && isMonk && handsItem) {
    equippedWeapon = {
      damageDice: '1d6', // Monk martial arts die at level 5+
      weaponType: 'melee',
      silent: false,
      toHitBonus: (handsItem.equip_bonus?.to_hit ?? 0) + totalToHitFromOtherSlots,
    };
  }
  ```
- The `Amulet of the Open Palm` planned unarmed damage bonus folds into this same path via item 2's aggregation.

---

### 6. `usable_when` Field (Battle Draught)

Add `usable_when?: 'out_of_combat'` to `ItemDefinition` in `types/v2-game.ts`. When set, the item bag UI checks `inCombat` from play page state — if true, render the item row greyed out and non-tappable with a subtitle: *"Must be used before combat."* No server-side enforcement needed; the item simply can't be tapped.

---

Most legendaries function today as strong +2 weapons. Planned special abilities unlock in priority order: **to_hit aggregation** (immediate, high value, low risk) → **hands slot** (UI + type change) → **passive_effect** (initiative first, then stealth) → **use_effect extensions** → **unarmed strikes**.

---

## UI Surfaces

---

### Guardian Tab

A dedicated 5th bottom nav tab added to the right end of the existing `Chat · Inventory · Party · Map` strip, making it `Chat · Inventory · Party · Map · Guardian`.

Tab label: **Guardian**. When pulls are pending, shows a notification dot using the same pattern as the Party tab's `hasPendingChoice` dot in `Header.tsx:55–57`. The dot disappears as soon as `character.pendingPulls` reaches 0.

The Guardian tab is the **only** place where pulls are opened. There is no sheet that floats over other tabs. All pull interactions happen directly on this page.

---

#### Navigation into the Guardian Tab

Whenever a pull becomes available (streak milestone, first-time milestone, guardian delivery), the narrative message in chat includes an inline button. Tapping it calls `setActiveTab('guardian')` — the same pattern used at `page.tsx:934` to navigate to the party tab. No separate notification required.

Example chat message when a milestone fires:
```
┌─────────────────────────────────────────┐
│ A warmth settles over you as a familiar │
│ presence stirs. "Well fought," the      │
│ voice murmurs. A small parcel           │
│ materializes at your feet.              │
│                                         │
│           [ Claim Gift → ]              │
└─────────────────────────────────────────┘
```

The button is a secondary outlined button (not primary fill) — it should be subtle enough not to interrupt reading but obvious enough to find without hunting.

---

#### Tab State A — Pulls Pending

Shown when `character.pendingPulls > 0`.

```
┌─────────────────────────────────────────┐
│  ✦ Your Guardian Angel                  │
│  "Something stirs — your dedication     │
│   has not gone unnoticed."              │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         2 gifts available       │    │
│  │    ┌───────────────────────┐    │    │
│  │    │     Open a Gift       │    │    │
│  │    └───────────────────────┘    │    │
│  └─────────────────────────────────┘    │
├─────────────────────────────────────────┤
│  STREAK                                 │
│  Day 1  Day 2  Day 3  Day 4  Day 5  Day 6  Day 7  │
│    ●      ●      ●      ●      ●      ○      ○    │
│  "5 of 7 — pull in 2 days"             │
│  🛡 2 shields banked                    │
│  A shield automatically saves your     │
│  streak if you miss a day.             │
├─────────────────────────────────────────┤
│  MILESTONES                      3 / 20 │
│  ✓ First Steps                          │
│  ✓ Explorer                             │
│  ✓ Treasure Hunter                      │
│  ○ Armed & Ready                        │
│  ○ Bloodied                             │
│                        [ See all → ]    │
├─────────────────────────────────────────┤
│  RECENT GIFTS                           │
│  Ring of Protection           Uncommon  │
│  Healing Potion                Common   │
└─────────────────────────────────────────┘
```

- The angel flavor text in the header reflects the current pity tier (from the Pity Display table above), not a static string.
- "2 gifts available" decrements by 1 immediately after each pull sheet dismisses (optimistic UI — decrement on the client, confirm via server response). When it reaches 0 the pull card disappears and the page transitions to State B. The tab notification dot also clears at that point.
- **Open a Gift** is disabled for the entire duration of the pull flow (from tap through to sheet dismiss) to prevent double-firing. Re-enables only after the server confirms the decrement.
- The streak, milestones, and recent gifts sections are always visible below — players see their progress even when a pull is waiting.

---

#### Pull Flow (triggered from State A)

Tapping **Open a Gift** opens a bottom sheet — same `idle → rolling → landed → reveal → dismissed` pattern as `CombatRollSheet`. The sheet renders over the Guardian tab content (not over the full app).

```
Guardian tab (behind, dimmed)
┌─────────────────────────────────────────┐
│  (streak / milestones visible behind)   │
│                                         │
│                                         │
│                                         │
╞═════════════════════════════════════════╡ ← sheet edge
│                                         │
│   ┌──────────┐    1  – 60   Common      │
│   │          │   61  – 88   Uncommon    │
│   │   d100   │   89  – 98   Rare        │
│   │   [  ]   │   99  – 100  Legendary   │
│   │          │                          │
│   └──────────┘                          │
│                                         │
│         [ Roll ]                        │
│                                         │
└─────────────────────────────────────────┘
```

**idle state:** Pity flavor text shown above the die. Rarity legend visible. "Roll" button active.

**rolling state:** Die cycles through numbers rapidly. Button disabled.

**landed state:** Number locks. Die border and the matching legend row simultaneously flash to rarity color (gray / green / blue / gold). Brief 500ms pause.

**reveal state:** Item card slides up. The die and legend remain visible above. The card shows item name, rarity badge, slot, and the full player-facing description — this is the primary way a player learns what they received. See mocks below.

**dismissed:** Sheet closes. A server action runs: decrements `pendingPulls` by 1, increments `lifetimePullCount` and `pityCount` (reset `pityCount` to 0 if the pull was legendary), appends to `pullHistory`. Item is added to the character's bag. Tab re-renders: "N gifts available" count updates, new item appears at top of Recent Gifts, tab dot clears if `pendingPulls` is now 0.

---

**Pull reveal mocks:**

```
── Uncommon example ─────────────────────────────────
  ┌──────────┐    1  –  60   Common
  │          │  ┃ 61  –  88   Uncommon ┃  ← green highlight
  │   [ 72 ] │    89  –  98   Rare
  │          │    99  – 100   Legendary
  └──────────┘

  ┌─────────────────────────────────────────┐
  │  Ring of Protection          Uncommon   │  ← green border
  │  ─────────────────────────────────────  │
  │  Slot: ring                             │
  │                                         │
  │  "A plain iron band etched with         │
  │   warding runes. Passively grants       │
  │   +1 AC while worn."                    │
  │                                         │
  │  Added to your bag.                     │
  └─────────────────────────────────────────┘

             [ Done ]
─────────────────────────────────────────────────────

── Legendary example ────────────────────────────────
  ┌──────────┐    1  –  60   Common
  │          │    61  –  88   Uncommon
  │   [ 99 ] │    89  –  98   Rare
  │          │  ┃ 99  – 100   Legendary ┃  ← gold glow
  └──────────┘

  ╔═════════════════════════════════════════╗
  ║  Ironclad Cleaver            Legendary  ║  ← gold border + glow
  ║  ─────────────────────────────────────  ║
  ║  Slot: main_hand  ·  Fighter            ║
  ║                                         ║
  ║  "A heavy cleaver forged from folded    ║
  ║   iron ore, balanced for relentless     ║
  ║   swings. Deals 1d8+2 damage with       ║
  ║   +2 to attack rolls."                  ║
  ║                                         ║
  ║  Added to your bag.                     ║
  ╚═════════════════════════════════════════╝

  [ Open Next Gift (1 remaining) ]   [ Done ]
─────────────────────────────────────────────────────

── Charged item example (Uncommon with use_effect) ──
  ┌──────────┐    1  –  60   Common
  │          │  ┃ 61  –  88   Uncommon ┃
  │   [ 65 ] │    89  –  98   Rare
  │          │    99  – 100   Legendary
  └──────────┘

  ┌─────────────────────────────────────────┐
  │  Amulet of Minor Healing     Uncommon   │
  │  ─────────────────────────────────────  │
  │  Slot: amulet  ·  1 charge             │
  │                                         │
  │  "A simple holy symbol storing one      │
  │   healing prayer. Use to restore 8 HP.  │
  │   1 charge — resets on long rest."      │
  │                                         │
  │  Added to your bag.                     │
  └─────────────────────────────────────────┘

             [ Done ]
─────────────────────────────────────────────────────
```

**Item card fields always shown:**
- Item name (large)
- Rarity badge (color-matched to rarity)
- Slot (e.g. `ring`, `main_hand`, `chest`)
- Class restriction if applicable (e.g. `· Fighter`)
- Charge count if item has charges (e.g. `· 3 charges`)
- Full description text
- "Added to your bag." confirmation line

---

#### Tab State B — No Pulls Pending

Shown when `character.pendingPulls === 0`. The pull card is gone. The header shows the angel's current pity disposition passively.

```
┌─────────────────────────────────────────┐
│  ✦ Your Guardian Angel                  │
│  "Your guardian angel offers you a      │
│   small token of their favor."          │
├─────────────────────────────────────────┤
│  STREAK                                 │
│  Day 1  Day 2  Day 3  Day 4  Day 5  Day 6  Day 7  │
│    ●      ●      ●      ●      ●      ○      ○    │
│  "5 of 7 — next pull in 2 days"        │
│  🛡 2 shields banked                    │
│  A shield automatically saves your     │
│  streak if you miss a day.             │
├─────────────────────────────────────────┤
│  MILESTONES                      3 / 20 │
│  ✓ First Steps                          │
│  ✓ Explorer                             │
│  ✓ Treasure Hunter                      │
│  ○ Armed & Ready                        │
│  ○ Bloodied                             │
│                        [ See all → ]    │
├─────────────────────────────────────────┤
│  RECENT GIFTS                           │
│  Ring of Protection           Uncommon  │
│  Healing Potion                Common   │
└─────────────────────────────────────────┘
```

---

#### Streak Section Detail

Seven filled/empty dots in a row, one per UTC day of the current 7-day cycle, labeled **Day 1 through Day 7** (relative to cycle start). Filled dot = qualifying action taken on that UTC date. Empty dot = UTC day not yet completed or missed.

- When all 7 dots fill, `pendingPulls` increments by 1, the tab notification dot appears, and the dots reset to Day 1–7 for the next cycle.
- **Shield auto-apply on miss:** Handled at session open — see streak logic in Data Requirements. The missed dot renders as a 🛡 icon if a shield was consumed; a broken-chain icon if the streak reset.

**UTC clock line** — displayed directly below the dot row so players know exactly how much of their UTC day remains:

```
Day 1  Day 2  Day 3  Day 4  Day 5  Day 6  Day 7
  ●      ●      ●      ●      ●      ○      ○
5 of 7 — Resets at midnight UTC · Currently 18:42 UTC
```

The time is rendered live on the client from `new Date().toUTCString()` — no server call needed. Update every minute.

**Shield display:** Always show shield count and description below the UTC line, even at 0:

```
🛡 2 shields banked
A shield automatically saves your streak if you miss a UTC day.
```

```
🛡 0 shields banked
Earn a shield every 7 days — it auto-applies if you miss a day.
```

The Guardian tab streak section is the **only place** shield count is visible. There is no other surface that shows this number.

---

#### Milestones Section Detail

Shows first 3–5 uncompleted milestones sorted by proximity to completion (nearest trigger first), plus all completed milestones. Completed milestones appear with a ✓ and muted styling.

**[ See all → ]** expands inline (not a separate page) to show the full milestone list grouped by tier (Early / Mid / Long-term).

Each locked milestone row shows:
```
○ Bloodied    "Enter combat for the first time"
```

Each completed milestone row shows:
```
✓ First Steps   "Completed your first session"
```

No pull count shown per milestone — the delivery was already in the chat narrative. This section is purely a tracker, not a claim UI.

---

#### Recent Gifts Section Detail

Last 5 pulls, most recent first. Each row shows:
```
[Item Name]                [Rarity]
```
Rarity label is color-coded (gray / green / blue / gold). No item description — just enough to jog memory. Tapping a row does nothing (read-only history). If 0 pulls have been opened yet, section shows: *"Your first gift awaits."*

---

### Data Requirements (Schema Work)

The Guardian tab requires new fields on the `Character` model in `prisma/schema.prisma`:

**On the `Character` model:**

| Field | Type | Purpose |
|-------|------|---------|
| `pendingPulls` | `Int default(0)` | Pulls available to open |
| `streakDays` | `Int default(0)` | Current consecutive UTC-day streak |
| `streakShields` | `Int default(0)` | Banked streak shields |
| `lastStreakDate` | `String?` | UTC date of last streak-qualifying action as `YYYY-MM-DD` (e.g. `"2026-07-01"`) |
| `lifetimePullCount` | `Int default(0)` | Total pulls ever taken (for pity) |
| `pityCount` | `Int default(0)` | Pulls since last legendary |
| `milestoneFlags` | `String[] default([])` | IDs of earned milestones |
| `pullHistory` | `Json default([])` | Last 20 pulls: `Array<{ itemName, rarity, pulledAt }>` |

No timezone field needed on any model — all dates are UTC.

**Streak logic** (runs at session open via a server action):
```ts
const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" UTC
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().slice(0, 10);

if (lastStreakDate === today) {
  // Already active today, no change
} else if (lastStreakDate === yesterday) {
  streakDays += 1;
  lastStreakDate = today;
} else if (lastStreakDate === twoDaysAgo && streakShields > 0) {
  streakShields -= 1; // shield absorbs the one missed day
  streakDays += 1;
  lastStreakDate = today;
} else {
  streakDays = 1; // streak broken or first day
  lastStreakDate = today;
}

if (streakDays > 0 && streakDays % 7 === 0) {
  streakShields += 1;
  pendingPulls += 1;
}
```

---

### Other Surfaces

| Surface | Location | Purpose |
|---------|----------|---------|
| Pull badge | Guardian tab icon | Number badge — count of pending pulls |
| Claim Gift button | Chat narrative message | Navigates to Guardian tab via `setActiveTab('guardian')` |
| Guardian's Blessing chip | Session open, days 1–7 only | "Day N of 7 — Blessing active on your first roll today" |
| Dice roll attribution | Roll result message | "Rolled with advantage — Guardian's Blessing (4-day streak)" |

### Guardian's Blessing Communication

Two surfaces work together to connect daily login to the advantage reward:

**Session open** — non-blocking status chip (same pattern as existing status chips in the play page):
> *"Day 4 of 7 — Guardian's Blessing active on your first roll today."*

**Dice roll result** — when advantage triggers from the blessing, the roll result explicitly attributes it:
> *Rolled with advantage — Guardian's Blessing (4-day streak)*

Both surfaces must say "streak" or "Day N of 7" — the angel framing alone isn't enough for players to connect daily login to the mechanical benefit.
