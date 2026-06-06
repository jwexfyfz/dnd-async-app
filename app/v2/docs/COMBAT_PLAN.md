# V2 Combat System — Design Plan

> **Status: Planning.** None of this is implemented yet. Decisions marked ✅ are locked; 🔲 are open questions.

---

## 1. Combat Trigger — Detection Model ✅

Combat starts when an enemy with `awareness_state: "alert"` is in the same room as the player, **or** when the player explicitly attacks an NPC.

### Enemy data (on `PoiTemplate.defaultProperties`)

```json
{
  "poi_type": "npc",
  "passive_perception": 10,
  "combat_stats": {
    "hp": 11, "ac": 13,
    "attack_bonus": 3, "damage": "1d8+1",
    "dex_mod": 0
  },
  "hostile_to": ["intruders"],
  "recognition_exceptions": ["vorne_guard_ally"],
  "awareness_sounds": {
    "suspicious": { "text": "armor clinking, muttered curse", "dc": 13 },
    "alert":      { "text": "a shout and the scrape of a blade", "dc": 10 }
  }
}
```

`hostile_to: ["intruders"]` = hostile to anyone unless the session has a story flag listed in `recognition_exceptions`.  
`hostile_to: ["all"]` = always hostile.

### Runtime state (on `PoiInstance.currentProperties`)

```json
{ "awareness_state": "unaware", "current_hp": 11 }
```

### Awareness states

| State | Meaning | How player triggers combat |
|---|---|---|
| `unaware` | sleeping, distracted, not watching | Must be attacked or escalated to `alert` first |
| `suspicious` | heard something, actively looking | Player gets one grace turn (see §3) |
| `alert` | knows intruders are present | Combat triggers immediately on room entry or player action |

---

## 2. Detection Flow ✅

### On room entry (or already in room when enemy present)

1. **Is the player sneaking?**
   - Free-text signals: "sneak in", "creep", "move quietly", "stay hidden" → Haiku tags `move_to_room` with `sneaking: true`
   - Normal entry (no stealth tag) → **auto-detected** if enemy is `suspicious` or `alert`

2. **Stealth check** (only if sneaking AND enemy is `unaware`):
   - `d20 + DEX mod + proficiency (if Stealth-trained)` vs. enemy `passive_perception`
   - **Fail** → awareness escalates (`unaware` → `suspicious`)
   - **Pass** → enemy stays `unaware`; player has **surprise** advantage if combat starts this turn

3. **Hostility check** (separate from detection):
   - Check `hostile_to` vs. session story flags in `recognition_exceptions`
   - If hostile conditions met + enemy is `alert` → combat triggers

---

## 3. Suspicious Grace Turn ✅

When an enemy transitions to `suspicious`, Stage 3 logs a mechanical event and Stage 4 narrates the enemy's reaction. The player gets **one turn** before combat locks in:

| Player action | Outcome |
|---|---|
| **Hide** ("press against the wall", "hold still") | Stealth vs. `passive_perception + 2`. Success → enemy back to `unaware`. Fail → `alert` → combat. |
| **Attack** | Immediate combat. Player acts first (enemy flat-footed, not yet in initiative). |
| **Flee** (`move_to_room` away) | Enemy escalates to `alert`. Patrol enemies follow; non-patrol stay `alert`. |
| **Loud action** (`destroy_poi`, etc.) | Enemy immediately escalates to `alert` → combat. |
| **Quiet action** (examine, pick_up, etc.) | Enemy rolls active Perception (d20 + WIS mod) vs. player's passive Stealth (10 + DEX mod). Fail → `unaware`. Pass → `alert`. |

---

## 4. Loud Action Propagation ✅

### Which actions are loud

| Action | Loud? |
|---|---|
| `destroy_poi` | Always |
| `attack` | Always |
| `interact` on `loud: true` POIs | Conditional |
| `throw_item` with `loud: true` items | Conditional |
| All other actions | Never |

### Detection DC by barrier

| Barrier | DC to hear |
|---|---|
| Archway / open door | 10 |
| Closed door | 15 |
| Locked/reinforced door | 18 |

### Propagation rules
- Checks all NPC enemies in adjacent rooms (one exit away)
- Each enemy rolls `d20 + WIS mod` vs. DC
- Hit → awareness escalates one step (`unaware` → `suspicious`, `suspicious` → `alert`)
- Propagates **one room deep only** — noise doesn't chain

---

## 5. Player Awareness of Cross-Room Reactions ✅

When an enemy in an adjacent room escalates awareness, the player simultaneously rolls to hear the reaction:

| Enemy reaction sound | Base DC |
|---|---|
| Voice ("Who's there?", calling for backup) | 10 |
| Armor/weapon noise (drawing sword, standing up) | 13 |
| Footsteps approaching the door | 15 |
| Silent escalation (mental only) | No check |

Barrier modifier: open door +0 / closed door +4 / locked door +6.

**Resolution:**
- Player's **Passive Perception** (10 + WIS mod + proficiency) ≥ DC → auto-hears, no roll
- Below DC and player declared they're listening → active Perception roll
- Otherwise → no feedback

If they hear it, Stage 4 adds a line: *"Through the iron door you catch the scrape of a chair and the rasp of steel."*

---

## 6. Stealth Kills ✅

**Requirements:**
- Attacker is **hidden** from the target (Stealth ≥ target's `passive_perception`)
- Target is `unaware` → attack has **advantage**, target is **surprised**

**If kill is instant (HP → 0):**
- Silent weapon (`silent: true` on ItemDefinition — daggers, garrotes) → no propagation to other rooms
- Other enemies in the **same room** who are also `unaware` don't see it (not watching)
- Other enemies in the same room who are `suspicious` or `alert` **do** see it → immediate combat

**If kill is NOT instant:**
- Enemy survives → on their turn they can cry out (auto-propagates) or grapple
- Creates design pressure toward high-damage builds (Rogues especially)

**Rogue sneak attack** applies automatically on any attack made with advantage (hidden attacker) or when an ally is adjacent — resolves in Stage 3 as bonus damage dice.

### Item addition
```typescript
// ItemDefinition
silent?: boolean  // daggers, garrotes — no noise propagation on kill
```

---

## 7. Initiative & Turn Order ✅

**Model: strict D&D 5e initiative** (single player = simple queue: player → enemy1 → enemy2 → …)

### At combat start
1. Player rolls `d20 + DEX mod`
2. Each enemy in the room rolls `d20 + DEX mod` (from `combat_stats.dex_mod`)
3. All combatants sorted descending by result. Ties: player wins
4. Surprised combatants keep their initiative position but **skip their first turn**

### Combat state (new `combatState` JSON column on `GameSession`)

```typescript
interface CombatState {
  round: number
  initiativeOrder: Array<{
    id: string             // characterId or poiInstanceId
    type: 'character' | 'enemy'
    name: string
    initiative: number
    hp: number             // enemies only — characters use Character.currentHp
    maxHp: number          // enemies only
    ac: number             // enemies only
    surprised: boolean     // skips first turn
    acted: boolean         // has acted this round
  }>
  activeActorId: string    // whose turn it currently is
}
```

`GameSession.gameState` stays as `"exploration" | "combat"` string. `combatState` is null during exploration.

### Turn enforcement
- If `activeActorId` is the player's character: player can submit actions
- If `activeActorId` is an enemy: player cannot act; enemy turn is resolved automatically then control passes
- Player submits action on wrong turn → 409 "It's not your turn"

### End of round
- When all combatants have `acted: true` → `round++`, reset all `acted: false`, advance to first in initiative order

---

## 7a. Combat State Lifecycle ✅

### Entry — when `gameState` flips to `"combat"`

Stage 3 is responsible for the transition. It triggers when **either** condition from §1 is met:

1. Player submits any action while an `alert` + hostile enemy is in the same room
2. Player submits an explicit `attack` action against any NPC regardless of awareness state

**Entry sequence (Stage 3):**
1. Roll initiative for the player character (`d20 + DEX mod`)
2. Roll initiative for every `alert` enemy in the room (`d20 + dex_mod` from `combat_stats`)
3. Sort all combatants descending; ties go to the player
4. Mark any `unaware` enemies who are joining mid-fight as `surprised: true` (see §5 of Open Questions)
5. Set `activeActorId` to the first combatant in initiative order
6. Write `GameSession.combatState` with the full `CombatState` payload
7. Set `GameSession.gameState = "combat"`

The session API response includes both fields. The client switches to combat UI on receipt.

### Exit — conditions that end combat

| Condition | Trigger | Stage 3 action |
|---|---|---|
| **All enemies dead** | Every `type: 'enemy'` entry in `initiativeOrder` has `hp ≤ 0` | Clear `combatState`, set `gameState = "exploration"` |
| **Player flees** | `move_to_room` resolves and the destination room has no `alert` + hostile enemies | Clear `combatState` in the old room, set `gameState = "exploration"`; apply opportunity attacks and pursuit before clearing (§Open Questions §4) |
| **Player enters a new room with `alert` enemies** | Flee destination itself has a combat trigger | Clear old `combatState`, immediately begin entry sequence above in the new room — no gap in `gameState` |
| **Player death** | 3 failed death saving throws | `gameState` set to `"game_over"` (separate flow, not scoped in v1) |

Surrender and negotiation are not in v1. Free text attempts will be handled narratively by Stage 4 but have no mechanical combat-exit path.

### State cleanup on exit

```typescript
// Stage 3 on combat end
session.combatState = null
session.gameState = "exploration"
// Enemy awareness_state intentionally NOT reset — they stay "alert"
// Their current_hp persists — damage carries over if the player returns
```

Enemies do **not** reset to `"unaware"` when combat ends. A wounded guard who was fought but fled is still `alert` and hostile — returning to that room re-triggers combat entry immediately (skipping the detection flow, going straight to initiative).

---

## 8. Sunken Cellar Enemy Reference

| Enemy | Awareness | Passive Perc | HP | AC | Initiative |
|---|---|---|---|---|---|
| Slumped Guard | `unaware` (dozing) | 8 (−2 distracted) | 11 | 13 | d20+0 |
| Harwick Vorne | `alert` | 14 | 22 | 15 | d20+2 |
| Varath (demon) | dormant until `binding_seal_used` | 16 | 45 | 17 | d20+3 |

---

## 9. Enemy AI & Narration ✅

**Model: pure code mechanics, folded into existing Stage 4 narrative call.**

No extra Claude call per enemy turn. Enemy turns resolve deterministically in Stage 3, then their actions are appended to the Stage 4 mechanical fact block. One narrative response covers the full round.

### Combat turn flow (per player action)
```
Player submits action
  → Stage 2: Haiku parses combat intent
  → Stage 3: Apply player action (attack, item use, etc.)
  → Auto-resolve all enemy turns between now and next player turn (pure code, Stage 3)
  → Stage 4: Single Haiku/Sonnet call narrating player action + all enemy actions
  → Stage 5: Return updated combat state
```

### Mechanical fact block additions for Stage 4
```
Player: Tomas attacked Harwick with dagger — hit AC 15, dealt 7 damage (4+3 sneak attack).
Enemy turns:
- Harwick Vorne: attacked Tomas — rolled 14 vs AC 12, hit, dealt 6 piercing damage.
- Slumped Guard: moved toward Tomas (now adjacent).
```

### Enemy behavior tags (`ai_behavior` on `defaultProperties`)
```json
{
  "ai_behavior": {
    "priority": "aggressive",
    "below_half_hp": "taunt",
    "flee_threshold": 0.25,
    "special": "threatening_shout"
  }
}
```

| `priority` value | Behavior |
|---|---|
| `aggressive` | Always attack player if in range, move toward them if not |
| `defensive` | Hold position, attack if player approaches |
| `cowardly` | Attack if cornered, flee if below `flee_threshold` HP |

Enemy personality lives in these tags — they shape both mechanics (does the enemy flee?) and what gets passed to Stage 4 as context (does Haiku know to make Harwick taunt?).

---

## 10. Provoke Mechanic ✅

5e has no formal taunt. Instead it makes attacking others *costly*. We model this as a `provoke` action:

- **Check**: Charisma (Intimidation) vs. enemy Wisdom save (`8 + WIS mod + proficiency`)
- **Success** → `priority_target: characterId` set on enemy in `initiativeOrder` entry for N rounds. AI targets you first; disadvantage on attacks against anyone else.
- **Failure** → enemy attacks you with advantage on their next turn (enraged, not controlled).
- `priority_target` expires at round N or when the provoker drops to 0 HP.

Low-WIS / bestial enemies are easy to provoke. High-WIS commanders (Harwick) resist reliably.

```typescript
// initiativeOrder entry (enemy)
{
  id: string, type: 'enemy', ...
  priority_target?: string         // characterId
  priority_target_until_round?: number
}
```

---

## 11. Action Scope & Bonus Action Architecture ✅

**v1: Action + Movement per turn. No bonus action enforcement yet.**

### `TurnUsage` (in `CombatState`, per active actor's turn)

```typescript
interface TurnUsage {
  actionUsed: boolean
  bonusActionUsed: boolean   // always false/unenforced in v1 — ready for option B
  movementUsed: boolean
  reactionUsed: boolean      // opportunity attacks, Protection style
}
```

### Action cost table (standard)

```typescript
const ACTION_COSTS = {
  attack:           'action',
  cast_spell:       'action',
  use_item:         'action',
  hide:             'action',     // Cunning Action → 'bonus_action' for Rogues
  dash:             'action',     // Cunning Action → 'bonus_action' for Rogues
  disengage:        'action',     // Cunning Action → 'bonus_action' for Rogues
  dodge:            'action',
  provoke:          'action',
  change_proximity: 'movement',
}
```

Class features override costs. When option B lands, `ClassFeature.action_cost_overrides` is read before falling back to this table:

```json
{ "name": "Cunning Action", "action_cost_overrides": { "hide": "bonus_action", "dash": "bonus_action", "disengage": "bonus_action" } }
```

In v1, `bonusActionUsed` is never checked — the field exists and is ready.

---

## 12. Attack Resolution ✅

### Attack roll
`rollD20Check(attackBonus, enemyAC, "AC")` from `lib/dice.ts`.
- Natural 20 → `critical: true` → double damage dice (not modifiers)
- Natural 1 → `fumble: true` → always misses regardless of bonus
- Advantage/disadvantage: roll twice, take higher/lower — roll two `rollD20Check` calls, pick by result

### Damage on hit
`computeAttackDamage(damageDice, statMod, isCrit)` from `lib/mechanical-damage.ts`.
- `damageDice`: string expression e.g. `"1d8+1"` from item or enemy `combat_stats`
- `statMod`: STR mod for melee, DEX mod for ranged/finesse
- Minimum 1 damage enforced
- Crit doubles dice count, applies modifier once

### Advantage/disadvantage sources (v1)
| Source | Effect |
|---|---|
| Hidden attacker | Advantage |
| Target is `unaware` / surprised | Advantage |
| Provoke failure (against provoker) | Advantage |
| Dodging (future) | Attacker has disadvantage |
| Target prone + attacker adjacent | Advantage |

### Damage resistances
Stored on enemy `defaultProperties.damage_resistances: string[]` (e.g. `["nonmagical_bludgeoning", "nonmagical_piercing"]`). Stage 3 halves damage (round down) if the attack's `damage_type` matches. Varath: resistant to all non-magical physical damage.

### Death / 0 HP
- **Enemies**: drop to 0 HP → removed from initiative order, `currentProperties.current_hp = 0`, `awareness_state: "dead"`. Stage 4 narrates the kill.
- **Player**: drop to 0 HP → unconscious. Begin death saving throws: each round player rolls d20. 3 successes (≥10) → stabilized at 1 HP. 3 failures → dead. Stabilized characters are out of combat.

### v1 reuse map
| Need | Source | Notes |
|---|---|---|
| d20 attack roll | `lib/dice.ts` → `rollD20Check` | Use as-is |
| Damage on hit | `lib/mechanical-damage.ts` → `computeAttackDamage` | Use as-is |
| Initiative | `lib/initiative.ts` → `rollInitiative` | Pass enemy PoiInstanceId as `actorId`; store `dex_score` on enemy seed (not mod) so `abilityModifier()` can be applied consistently |
| Stealth check | `lib/stealth.ts` → `rollStealthCheck` | Adapt to use `rollD20Check` for consistent audit trail |
| Ability modifier | `lib/dice.ts` → `abilityModifier` | Use as-is |
| Proficiency bonus | `lib/dice.ts` → `proficiencyBonus` | Use as-is |

### Enemy `combat_stats` schema update
```json
{
  "combat_stats": {
    "hp": 11, "ac": 13,
    "attack_bonus": 3, "damage": "1d8+1", "damage_type": "slashing",
    "dex_score": 11,
    "str_score": 13
  },
  "damage_resistances": []
}
```

---

## Open Questions — Recommendations ✅

### 1. Re-hiding mid-combat
**Deferred to bonus action phase (option B).** In v1, Hide costs a full Action — player sacrifices their attack to attempt Stealth vs. all enemies' passive Perception. If successful, regain hidden status and advantage on next attack. Rogue Cunning Action (bonus action Hide) lands when option B is implemented.

---

### 2. Body discovery
**Recommendation: passive Perception check at the start of each `unaware` enemy's turn.**

In 5e a body in plain sight is DC 8 to notice — obvious, but an inattentive creature can miss it. On each `unaware` enemy's turn in a room with a dead ally: roll `d20 + WIS mod` vs. DC 8. Success → escalate to `suspicious`. This creates real tension for stealth runs — you have a window before other guards notice, but it closes fast.

```
DC 8  — body in open (default)
DC 12 — body partially obscured (behind furniture, dim light)
DC 16 — body hidden by player (drag into shadow — future: requires Action to stash)
```

---

### 3. Patrol behavior
**Recommendation: `patrol` flag on enemy `defaultProperties`, two-phase movement.**

- `patrol: false` (default) — enemy stays in their room. Escalates awareness in place. Never crosses into another room.
- `patrol: true` — when escalated to `suspicious`, enemy moves to the doorway between rooms on their grace-turn. If escalated again to `alert`, they enter the room and join initiative.

This means a patrolling guard who hears something approaches the door first (player sees the narrative warning: *"Heavy footsteps approach the iron door from the other side"*), then enters. Non-patrolling enemies — Harwick in the Ritual Chamber, Varath — never leave their room.

---

### 4. Fleeing / opportunity attacks + pursuit
**Recommendation: strict 5e opportunity attack on exit; `pursuit` flag governs follow behavior.**

**Opportunity attack:**
- `move_to_room` while any `alert` enemy is in the room → enemy gets one free attack roll (reaction) before the player exits. Damage applies even if player escapes.
- `disengage` action on player's turn → no opportunity attack that turn; player can `move_to_room` safely afterward.
- `reactionUsed` on the enemy's `TurnUsage` prevents multiple opportunity attacks per round.

**Pursuit behavior (`pursuit` on enemy `defaultProperties`):**

| Value | Behavior |
|---|---|
| `"none"` | Never leaves room. Enemy stays `alert` in place. If player returns, initiative resumes from current order — no re-roll. |
| `"adjacent"` | Follows player one room on their next turn. If player not found (moved again), enemy returns to post after 1 round. Default for humanoid guards. |
| `"full"` | Actively hunts across rooms until player is caught or 3 rooms away. Reserved for special enemies. |

`adjacent` is the default. It creates tension — the enemy is now in the hallway, blocking the path back — without making fleeing pointless.

**Patrol + pursuit combinations (Sunken Cellar):**

| Enemy | `patrol` | `pursuit` | Behavior |
|---|---|---|---|
| Slumped Guard | `true` | `"adjacent"` | Investigates sounds, follows one room |
| Harwick Vorne | `false` | `"none"` | Never leaves Ritual Chamber |
| Varath | `false` | `"none"` (bound) / `"full"` (freed) | Changes on `binding_seal_destroyed` story flag |

---

### 5. Multiple enemies entering combat
**Recommendation: detection is individual, but combat start is a loud event.**

Each enemy makes their own detection check — they're not telepathic. However, when the **first attack roll** happens in a room, treat it as a loud action (DC 10 to hear within the room). All `unaware` enemies in the same room roll Perception vs. DC 10:
- Pass → join initiative, **surprised** (skip first turn — they heard it but weren't ready)
- Fail → join initiative at the end of the order with `surprised: true`

Enemies who are already `suspicious` or `alert` join initiative normally with no surprise.

Adjacent rooms: first attack = loud action, propagation rules from §4 apply.

---

### 6. Status effects
**Recommendation: implement `prone` and `unconscious` in v1; store all others as extensible array.**

5e has 15 conditions. Most are edge cases. Only two matter for v1:

| Condition | v1 enforcement |
|---|---|
| `unconscious` | Already needed — player at 0 HP, death saves |
| `prone` | Attacker in melee has **advantage**; attacker ranged has **disadvantage**. Standing costs half movement (one `change_proximity` action). |
| Everything else | Stored in `status_effects: string[]` on `initiativeOrder` entry. Not enforced in v1 — passed to Stage 4 as context for narrative flavor only. |

```typescript
// initiativeOrder entry
{
  id: string, type: 'character' | 'enemy', ...
  status_effects: string[]   // ['prone', 'poisoned', ...] — v1 enforces only 'prone', 'unconscious'
}
```

When future conditions are added (poisoned, frightened, paralyzed), the field is already there — just add enforcement in Stage 3.

---

## 13. Weapon Range — Proximity Model ✅

**Model: per-enemy distance state, not a player zone.**

Each enemy in `initiativeOrder` carries a `proximity` field relative to the player character:

```typescript
// initiativeOrder entry (enemy) — addition
{
  id: string, type: 'enemy', ...
  proximity: 'close' | 'far'   // 'close' = melee range; 'far' = across the room
}
```

`change_proximity` (movement action) toggles a specific enemy's proximity state. Moving from `far` to `close` costs movement. Moving from `close` to `far` triggers an opportunity attack from that enemy unless the player used `disengage` this turn.

### Weapon rules by proximity

| Weapon type | vs `close` enemy | vs `far` enemy |
|---|---|---|
| Melee | Works normally | Cannot attack — must close first |
| Ranged | **Disadvantage** (any `close` enemy imposes this) | Works normally |
| Thrown (`range: "thrown"`) | **Disadvantage** (same rule — it's a ranged attack) | Works normally |
| Reach (`reach: true`) | Works normally | Cannot attack, but opportunity attacks still trigger when enemy moves to `far` |

**Key rule:** if ANY enemy is `close` to the player, ALL ranged and thrown attacks have disadvantage — even against `far` targets. This is standard 5e and creates real weapon-choice tension without a grid.

### Item schema addition

```typescript
// ItemDefinition.combatProperties
{
  damage: string           // e.g. "1d6+0"
  damage_type: string
  attack_stat: 'str' | 'dex'
  range: 'melee' | 'ranged' | 'thrown'
  reach?: boolean          // true = opportunity attacks extend to 'far' on retreat
  combat_usable?: boolean  // false = cannot be used as a combat action (rope, key, etc.)
  targetable?: boolean     // true = prompts target selection UI (healing potion, etc.)
}
```

### Reach weapons in v1

Reach weapons (`reach: true`) require `close` like any melee weapon. The only mechanical difference: when an enemy moves from `close` to `far`, a reach-weapon wielder still gets an opportunity attack (they can still reach). No third proximity state needed.

---

## 14. Mobile UI Layout ✅

**Scope: mobile-only. Desktop layout deferred.**

### Global navigation

Persistent bottom nav bar with 4 tabs, always visible:

```
[ Chat ] [ Inventory ] [ Party ] [ Map ]
```

The map pull-up bottom sheet is removed — Map is a full-screen tab with proper space for the SVG dungeon layout.

### Exploration mode

```
┌─────────────────────────────────────┐
│  Room Name                          │  header: room name only
├─────────────────────────────────────┤
│                                     │
│  (chat stream)                      │
│                                     │
├─────────────────────────────────────┤
│  [textarea input]        [Send ↑]   │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

### Combat mode

```
┌─────────────────────────────────────┐
│  ⚔  Room Name                  R2  │  header: combat indicator + round (small)
├─────────────────────────────────────┤
│  initiative strip (see §15)         │
├─────────────────────────────────────┤
│                                     │
│  (chat stream)                      │
│                                     │
├─────────────────────────────────────┤
│  action chips (see §16)             │
├─────────────────────────────────────┤
│  [chip-in-input]         [Send ↑]   │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

Round number (`R2`) is displayed small at the far right of the header. Not a headline — exists as reference for tracking duration-based effects (e.g. "provoked for 2 rounds").

---

## 15. Combat Header & Initiative Strip ✅

The initiative strip sits between the header and the chat stream. It is only rendered when `gameState === "combat"`.

### Layout

Horizontally scrollable row of icon circles. Left-to-right reflects initiative order.

```
           ▼
  ┌──┐   ┌────┐   ┌──┐   ┌─╴ fade
  │ T│   │ H  │   │ G│   │        →  scroll
  └──┘   └────┘   └──┘   └─╴
  14/18  22/22   11/11
  (dim)  (ACTIVE)(wait)
```

### Icon states

| State | Visual |
|---|---|
| Active (current turn) | Full size, full opacity, ▼ marker above |
| Already acted this round | 80% size, ~50% opacity |
| Waiting (not yet acted) | Full size, full opacity, no marker |
| Dead / unconscious | Grey ring, skull overlay |

### Ring colors (HP status)

| HP % | Ring color |
|---|---|
| > 60% | Green |
| 30–60% | Yellow |
| < 30% | Red |
| 0 / unconscious | Grey |

### Scroll affordance

The rightmost visible icon is cropped ~30% to signal more exist. The active actor is always scrolled into view automatically.

### Tap behavior

Tapping any icon expands an inline mini-sheet below the strip:
- **Player character:** HP, AC, attack bonus, available class features
- **Enemy:** HP, AC, status effects, proximity state (`close` / `far`)

Tapping outside or tapping the icon again dismisses it.

---

## 16. Action Chips & Chip-in-Input ✅

### Action chips

Rendered in a horizontally scrollable row above the input. Combat only — not shown during exploration.

**Standard chips** (shown if action not yet used this turn):

```
[Attack] [Dodge] [Dash] [Disengage] [Hide] [Use Item] [Provoke]
```

**Class feature chips** (shown based on character class):

```
[⚡ Second Wind ●]  [⚡ Cunning Action ●]
```

`●` = available, `◎` = expended (greyed out). Expended chips are visible but non-interactive — they remind the player the feature exists even when unavailable.

Chips for actions already used this turn (e.g. Attack after attacking) are greyed out.

### Chip-in-input pattern

Tapping a chip inserts a removable pill tag at the **start** of the input field. The pill has an `×` to cancel.

```
No chip:        [  What do you do?              ]
After [Attack]: [Attack ×]                       |
After typing:   [Attack ×] slash at his wrist    
```

Rules:
- Only one chip at a time — tapping a second chip replaces the first
- `×` removes the chip; input returns to freeform
- Free text without a chip is always valid; Stage 2 infers as normal
- When sent, the chip value is passed as `action_hint` to Stage 2 alongside the player text

### Cunning Action sub-picker

Tapping `[⚡ Cunning Action ●]` opens an inline sub-picker above the chip row:

```
Cunning Action — use as:
[Hide]  [Dash]  [Disengage]
```

Selection inserts the full context chip: `[Cunning Action: Hide ×]`

### Class feature resource confirmation

For features with limited uses (Second Wind, spell slots), the chip itself is the confirmation — no modal. Sending with `[⚡ Second Wind ×]` in the input tells Stage 3 to consume the resource. The player can still cancel by removing the chip before sending.

---

## 17. Use Item Flow ✅

**Trigger:** player taps `[Use Item]` chip (or selects an item from the Inventory tab during combat — see §19).

### Step 1 — Item picker

A bottom sheet slides up (~50% screen height), partially covering the chat. The chat history above remains partially visible for combat context.

```
┌─────────────────────────────────────┐
│  ...Harwick steps forward, blade    │  ← chat partially visible
├─────────────────────────────────────┤
│  Use an item                 ── ── ─│  ← drag handle
├─────────────────────────────────────┤
│  Healing Potion  ×2   Restore 2d4+2 │
│  Thieves' Tools  ×1   Pick a lock   │
└─────────────────────────────────────┘
```

Only items with `combat_usable: true` are listed. Items like rope, keys, and torches do not appear.

### Step 2 — Target selection (if applicable)

If the selected item has `targetable: true`, the list is replaced inline with valid targets:

```
│  Healing Potion — use on:   ← back │
├─────────────────────────────────────┤
│  ● Tomas (you)      ♥ 8/18         │
│    Brennan          ♥ 8/22         │  ← only party members in same room
└─────────────────────────────────────┘
```

Items without `targetable` skip this step entirely and insert the chip immediately.

### Step 3 — Chip insertion

Sheet dismisses. Input shows:

```
[Use: Healing Potion ×]                      (self / no target)
[Use: Healing Potion → Brennan ×]            (targeted)
```

Player adds flavor text or sends directly.

### Edge cases

| Scenario | Behavior |
|---|---|
| No `combat_usable` items in inventory | `[Use Item]` chip is greyed out; tapping shows "Nothing usable in combat" |
| One item, no target required | Sheet skips both steps; chip inserted immediately |
| Cancel | Drag sheet down or tap outside; no chip inserted |
| Free text ("I drink my potion") | Bypasses this flow entirely; Stage 2 handles normally |

---

## 18. Party Tab & Character Access ✅

### Tab header

Horizontally scrollable row of character avatars — same component as the initiative strip but without turn-order indicators. Shows all party members with HP visible.

```
  ┌──┐      ┌──┐      ┌──┐
  │ T│      │ B│      │ M│        tap to switch content below
  └──┘      └──┘      └──┘
  Tomas    Brennan   Miriel
  ♥14/18   ♥8/22    ♥12/12
```

Tapping switches the character sheet content below. Only the player's own character shows activation affordances; allies are read-only.

### Character sheet content

```
─── Tomas Blackwood · Rogue 3 ───

COMBAT STATS
HP 14/18  AC 12  Speed 30ft
Attack +5  Damage 1d6+3  Initiative +3

CLASS FEATURES
Sneak Attack    2d6 (auto on advantage)
Cunning Action  ● available
Second Wind     ● available

ABILITY SCORES
STR  8 −1    DEX 16 +3
CON 12 +1    INT 14 +2
WIS 10 +0    CHA 13 +1

SKILLS  (★ = proficient)
Acrobatics  +5 ★    Deception   +3
Perception  +2      Stealth     +5 ★
...
```

Skills are reference only — no use buttons. Ability scores and skills never have activation affordances.

### Class feature activation (combat only)

Tapping a `●` feature during combat:
1. Sub-picker appears if needed (Cunning Action → Hide / Dash / Disengage)
2. App navigates to Chat tab
3. Chip is inserted into the input (`[Cunning Action: Hide ×]`)

This is the same outcome as tapping the chip in the chat view — Party tab is just an alternate entry point. The player always lands in Chat before submitting.

**Out of combat:** tapping any class feature shows a description tooltip. No activation, no navigation.

---

## 19. Inventory Tab ✅

### Structure

```
EQUIPPED
  Dagger (main hand)   1d4+3 piercing   [Unequip]
  Leather Armor        AC 12            [Unequip]

CARRIED
  Healing Potion ×2    Restore 2d4+2    [Use] [Drop]
  Thieves' Tools ×1    Pick a lock      [Use] [Drop]
  Rope (50ft)                           [Drop]
  Silver Key                            [Drop]
```

### During combat

`[Use]` and `[Throw]` buttons in the Inventory tab navigate to Chat and insert the appropriate chip — they do not execute directly. Item use in combat must go through the action economy in the chat input.

`[Equip]` / `[Unequip]` and `[Drop]` are fully disabled during combat (no action cost modeled for v1).

### Out of combat

`[Use]` executes directly for tool-type items (Thieves' Tools attempts a lock on an adjacent locked POI). `[Equip]` / `[Unequip]` updates equipment state immediately. `[Drop]` places the item as a POI in the current room.

---

## 20. Combat Resume Card ✅

### Purpose

When a player logs in and `gameState === "combat"`, they may have no memory of how they got there or what happened in prior rounds. The resume card provides instant orientation without requiring them to scroll the chat log.

### Storage

Not persisted — generated client-side from `combatState` on page load. Never written to the message log. Disappears once the player submits their first action this session (replaced by the round narration that comes back from Stage 4).

### Trigger condition

Render the card when **all** of the following are true on initial load:
- `gameState === "combat"`
- `combatState` is non-null
- The most recent message in the log is **not** from the current session (i.e. the player wasn't the one who triggered the last round)

If the player refreshes mid-turn after already acting, the card is suppressed — they don't need catchup.

### Layout

Injected at the bottom of the Chat message list, above the action chips. Visually distinct from normal messages: muted background, left border accent, no avatar.

```
┌─ ╴ Combat resumed · Round 3 · Guard Post ╶ ─────────────┐
│                                                           │
│  Tomas (you)     ♥  8 / 18   AC 12                       │
│  Slumped Guard   ♥  4 / 11   AC 13   ← your turn         │
│  Harwick Vorne   ♥ 22 / 22   AC 15   (acted)             │
│                                                           │
│  Scroll up to see how this fight started.                 │
└───────────────────────────────────────────────────────────┘
```

### Content rules

| Field | Source | Notes |
|---|---|---|
| Round number | `combatState.round` | |
| Room name | `GameSession.currentRoomId` → room display name | |
| Combatant rows | `combatState.initiativeOrder` | Sorted by initiative (same as strip) |
| HP display | `hp` / `maxHp` for enemies; `Character.currentHp` / `Character.maxHp` for player | |
| AC | `ac` from `initiativeOrder` entry | |
| "your turn" marker | `combatState.activeActorId === character.id` | Only one row gets the marker |
| "(acted)" label | `acted: true` on the entry | Shown for anyone who has already gone this round |
| "(surprised)" label | `surprised: true` on the entry | Shown instead of "(acted)" if they haven't gone yet |

Dead enemies (`hp: 0`) are omitted from the card — they're already gone from initiative.

### Dismissal

The card unmounts when the player's first action response returns from the API. At that point Stage 4's narrative is appended to the log and the player is oriented. No manual dismiss button needed.
