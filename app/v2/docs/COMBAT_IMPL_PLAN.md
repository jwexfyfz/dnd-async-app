# Combat + UI Implementation Plan

> Tracks the phased build of everything in `COMBAT_PLAN.md` and `V2_UI_FLOWS.md`.
> Execute one phase at a time. Each phase ends with a checkpoint before the next begins.

---

## Claude Output Rules

Apply these to every phase. Non-negotiable.

- **Print only what changes.** No restating the plan, no "here's what I did" summaries.
- **One console.log per meaningful event.** No logging inside tight loops. No duplicate log lines for the same fact.
- **No progress narration.** If you read a file, don't announce it. If you write a file, don't summarize it.
- **On errors: print the error, stop.** Do not auto-attempt more than one fix strategy per error without asking.
- **Commit message only.** End each phase with a one-line git commit message. No bullet lists of changes.

---

## Architecture Reference

```
lib/v2/game-controller.ts    — 5-stage pipeline (2945 lines); Stage 3 owns all mechanics
types/v2-game.ts             — shared interfaces
app/v2/play/page.tsx         — client page; reads ViewStatePayload
app/api/v2/game/action/route.ts — POST /api/v2/game/action
prisma/schema.prisma         — GameSession.gameState exists; GameSession.combatState needed
lib/dice.ts                  — rollD20Check, abilityModifier, proficiencyBonus
lib/mechanical-damage.ts     — computeAttackDamage
lib/initiative.ts            — rollInitiative
lib/stealth.ts               — rollStealthCheck
```

Existing `GameSession.gameState: String @default("exploration")` — already in schema.
Missing: `GameSession.combatState: Json?` — added in Phase 1.

---

## Seed Scenarios

Each phase checkpoint uses a pre-seeded scenario instead of a full playthrough.
Run: `npx tsx scripts/seed-combat-scenario.ts --scenario <name>`

| Scenario | Description | Use in |
|---|---|---|
| `alert-entry` | Player at room entrance, one guard `alert`, no combat yet | Phase 2 |
| `mid-combat` | Round 2, player's turn, Slumped Guard at 4/11 HP | Phase 3 |
| `enemy-turn` | Player acted, awaiting enemy resolve | Phase 4 |
| `flee-test` | Combat active, player adjacent to exit | Phase 5 |
| `suspicious-grace` | Guard `suspicious`, player has one turn | Phase 6 |
| `ui-combat` | Full combat state with 2 enemies, chip data ready | Phases 7–13 |

Seed script lives at `scripts/seed-combat-scenario.ts`. Build it in Phase 1 alongside the schema.

---

## Phase 1 — Schema, Types, Seed Script

**Goal:** `combatState` column exists, TypeScript types cover the full combat model, seed script drops the player into any scenario.

### 1.1 Schema

Add to `GameSession` in `prisma/schema.prisma`:

```prisma
combatState  Json?  // null during exploration; CombatState JSON during combat
```

Run: `npx prisma migrate dev --name add-combat-state`

### 1.2 TypeScript Interfaces

Add to `types/v2-game.ts`:

```typescript
export interface InitiativeEntry {
  id: string                          // characterId or poiInstanceId
  type: 'character' | 'enemy'
  name: string
  initiative: number
  hp: number                          // enemies only; characters use Character.currentHp
  maxHp: number                       // enemies only
  ac: number
  surprised: boolean                  // skips first turn
  acted: boolean
  proximity: 'close' | 'far'          // relative to player
  status_effects: string[]            // ['prone', 'unconscious', ...]
  priority_target?: string            // characterId — set by Provoke
  priority_target_until_round?: number
}

export interface TurnUsage {
  actionUsed: boolean
  bonusActionUsed: boolean            // unenforced in v1; field exists for future
  movementUsed: boolean
  reactionUsed: boolean
}

export interface CombatState {
  round: number
  initiativeOrder: InitiativeEntry[]
  activeActorId: string
  currentTurnUsage: TurnUsage
}
```

Extend `ViewStatePayload`:

```typescript
combatState: CombatState | null
gameState: 'exploration' | 'combat'
```

Extend `ActionType` union:

```typescript
| 'attack'
| 'dodge'
| 'dash'
| 'disengage'
| 'hide'
| 'provoke'
| 'change_proximity'
| 'death_save'
```

### 1.3 Seed Script

Create `scripts/seed-combat-scenario.ts`. Accepts `--scenario <name>` flag. Outputs a browser URL on completion.

Each scenario must:
1. Find or create a test character (Rogue 3, Tomas Blackwood — use the first character belonging to the user in `.env.local` or create one)
2. Find or create a `GameSession` for The Sunken Cellar
3. Place the player in the specified room with the specified state
4. Write `combatState` directly to `GameSession` for scenarios that need it
5. Set enemy `PoiInstance.currentProperties` (`awareness_state`, `current_hp`)
6. Write a seed `MessageLog` entry so the chat has context
7. Print: `Ready: http://localhost:3000/v2/play?sessionId=<id>&characterId=<id>`

**Scenario data:**

`alert-entry` — Guard Post room, Slumped Guard has `awareness_state: "alert"`, `current_hp: 11`. `GameSession.gameState: "exploration"`, `combatState: null`. Seed message: *"The guard's eyes snap open — he's seen you."*

`mid-combat` — Same room. `gameState: "combat"`. `combatState`:
```json
{
  "round": 2,
  "activeActorId": "<characterId>",
  "currentTurnUsage": { "actionUsed": false, "bonusActionUsed": false, "movementUsed": false, "reactionUsed": false },
  "initiativeOrder": [
    { "id": "<characterId>", "type": "character", "name": "Tomas", "initiative": 17, "hp": 14, "maxHp": 18, "ac": 12, "surprised": false, "acted": false, "proximity": "close", "status_effects": [] },
    { "id": "<guardPoiInstanceId>", "type": "enemy", "name": "Slumped Guard", "initiative": 9, "hp": 4, "maxHp": 11, "ac": 13, "surprised": false, "acted": true, "proximity": "close", "status_effects": [] }
  ]
}
```

`suspicious-grace` — `gameState: "exploration"`, guard `awareness_state: "suspicious"`. Seed message: *"The guard's head lifts — he heard something."*

`ui-combat` — Two enemies (Slumped Guard + Harwick Vorne), round 1, player's turn. Full `combatState` with both enemies.

### 1.4 Console Logs

```typescript
console.log(`[seed] scenario=${scenario} sessionId=${session.id} characterId=${char.id}`)
console.log(`[seed] combatState written: round=${cs.round} actors=${cs.initiativeOrder.length}`)
```

### Checkpoint 1 — Verify Schema + Seed

```bash
npx prisma migrate dev --name add-combat-state
npx tsx scripts/seed-combat-scenario.ts --scenario mid-combat
# → prints URL; open it; confirm page loads without errors
# → open /api/v2/room/state?roomInstanceId=<id> in browser; confirm combatState appears in response
```

### Automated Tests — Phase 1

File: `lib/v2/__tests__/combat-types.test.ts`

```
describe('CombatState structure')
  ✓ InitiativeEntry with all required fields serializes to valid JSON
  ✓ TurnUsage defaults all false
  ✓ combatState null is valid for exploration sessions
  ✓ ViewStatePayload extends to include combatState and gameState
```

---

## Phase 2 — Combat Entry (Stage 2 + Stage 3)

**Goal:** Submitting any action while an `alert` hostile enemy is in the room, or submitting an explicit `attack`, triggers combat — rolls initiative, builds `CombatState`, writes to DB, returns `gameState: "combat"` in the response.

### 2.1 Stage 2 — Intent Parsing

In `game-controller.ts` Stage 2 (the Haiku intent parsing call), add `attack` to the recognized `action_type` values the model can return. Update the system prompt to include:

```
"attack" — player intends to strike an NPC or enemy
```

Pass `action_hint` (the chip value from the request body) as additional context in Stage 2 if present.

### 2.2 Stage 3 — Combat Trigger Detection

Add a function `detectCombatTrigger(extractedAction, poiContexts, session)` that returns `boolean`. Returns true if:
- `extractedAction.action_type === 'attack'`, OR
- `session.gameState === 'exploration'` AND any enemy POI in the room has `awareness_state: "alert"` AND is hostile to the player (check `hostile_to` vs session `storyFlags`)

### 2.3 Stage 3 — Initiative Roll + State Build

Add `enterCombat(characterId, roomInstance, session, character)`:

1. Load all enemy POIs in the room with `awareness_state: "alert"`
2. Roll player initiative: `rollInitiative(character.dexScore)` → `{ total, roll, mod }`
3. For each enemy: read `combat_stats.dex_score` from `defaultProperties`, call `rollInitiative(dex_score)` using the enemy's `poiInstanceId` as actor ID
4. Sort all combatants descending by total; player wins ties
5. Mark enemies with `awareness_state: "unaware"` who are in the same room as `surprised: true` (they heard combat start — §Open Questions §5 rule)
6. Set all enemies `proximity: "close"` initially (they're in the same room)
7. Build `CombatState`, write to `session.combatState`, set `session.gameState = "combat"`
8. Return the new `CombatState`

```typescript
console.log(`[stage3:combat] entering combat — room=${roomInstance.id} enemies=${enemyCount}`)
console.log(`[stage3:initiative] player=${playerInitiative} enemies=${enemyInitiatives.map(e => `${e.name}:${e.total}`).join(', ')}`)
console.log(`[stage3:initiative] order=[${initiativeOrder.map(e => e.name).join(' → ')}]`)
```

### 2.4 Stage 5 — Return combatState

Ensure `buildViewState()` at Stage 5 reads `session.combatState` and `session.gameState` and includes them in `ViewStatePayload`.

### Checkpoint 2

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario alert-entry
# Open URL. In chat input, type: "I attack the guard"
# Expect:
#   - Response returns gameState: "combat"
#   - combatState has 2 entries in initiativeOrder
#   - Terminal shows [stage3:initiative] log with both names and rolls
#   - Page does not crash (UI hasn't changed yet — that's Phase 7)
```

### Automated Tests — Phase 2

File: `lib/v2/__tests__/combat-entry.test.ts`

Use `vi.mock` to stub `prisma` and the Anthropic client.

```
describe('detectCombatTrigger')
  ✓ returns true when action_type is 'attack'
  ✓ returns true when alert+hostile enemy is in the room regardless of action type
  ✓ returns false when enemy is alert but not hostile (recognition_exception matches story flag)
  ✓ returns false when enemy is only 'suspicious' and player doesn't attack
  ✓ returns false during exploration with no alert enemies

describe('enterCombat — initiative')
  ✓ player initiative uses correct DEX modifier
  ✓ enemy initiative reads dex_score from combat_stats
  ✓ initiative order is sorted descending
  ✓ player wins tie with equal initiative rolls (deterministic tie mock)
  ✓ surprised enemies are marked surprised: true
  ✓ all enemies start at proximity: 'close'

describe('enterCombat — state shape')
  ✓ round starts at 1
  ✓ activeActorId is first in sorted order
  ✓ currentTurnUsage starts all false
  ✓ gameState is written as 'combat'
```

---

## Phase 3 — Player Combat Turn

**Goal:** Player can submit combat actions on their turn. Stage 3 resolves attacks, damage, crits, advantage/disadvantage, death of enemies. Turn advances to the next combatant after the player acts.

### 3.1 Turn Gate

At the top of Stage 3, when `session.gameState === 'combat'`:
- If `combatState.activeActorId !== characterId` → return `{ error: "It's not your turn", status: 409 }`

```typescript
console.log(`[stage3:turn] actor=${activeActorId} player=${characterId} match=${isPlayerTurn}`)
```

### 3.2 Action Resolution

Handle each `action_type` in combat context:

**`attack`**
1. Resolve target: Stage 2 extracts target name; match to `initiativeOrder` entry by name
2. Determine advantage/disadvantage (see §12 of COMBAT_PLAN)
   - Hidden attacker → advantage
   - Target `surprised` → advantage
   - Any `close` enemy while using ranged weapon → disadvantage
3. Call `rollD20Check(attackBonus, targetAC, "AC")` — double-roll if adv/disadv
4. On hit: `computeAttackDamage(damageDice, statMod, isCrit)`
5. Apply damage to enemy `hp` in `initiativeOrder`
6. If enemy `hp ≤ 0` → remove from `initiativeOrder`, set `currentProperties.awareness_state = "dead"`, `current_hp = 0`
7. Check sneak attack: Rogue + has advantage OR ally adjacent → add `Xd6` sneak attack dice

**`dodge`** — set `status_effects: ['dodging']` on the player's entry; attackers have disadvantage until player's next turn

**`dash`**, **`disengage`** — mark `actionUsed`; `disengage` sets a flag preventing opportunity attacks this turn

**`hide`** — roll Stealth vs highest passive Perception among enemies; on success set player hidden; on fail no change

**`provoke`** — Charisma (Intimidation) vs enemy WIS save; success sets `priority_target`; failure gives enemy advantage on next attack

**`change_proximity`** — toggle target enemy `proximity` between `close` and `far`; if moving from `close` to `far` without `disengage`, enemy gets opportunity attack (reaction)

**`death_save`** — player at 0 HP: `d20 ≥ 10` = success, else failure; 3 successes = stabilized at 1 HP; 3 failures = dead

```typescript
console.log(`[stage3:attack] target=${target.name} roll=${attackRoll} vs AC=${target.ac} hit=${isHit} damage=${damage} crit=${isCrit}`)
console.log(`[stage3:enemy-dead] ${target.name} dropped to 0 HP — removed from initiative`)
console.log(`[stage3:turn-advance] ${currentActorId} → ${nextActorId}`)
```

### 3.3 Turn Advance

After player action resolves:
1. Mark player's `acted: true` in `initiativeOrder`
2. Set `currentTurnUsage` flags appropriately
3. Find next actor in order who has `acted: false`; if all have acted, start new round (increment `round`, reset all `acted: false`)
4. Set `activeActorId` to next actor

### 3.4 Combat End Check

After every HP update: if `initiativeOrder.every(e => e.type === 'character' || e.hp <= 0)` → call `exitCombat()`:

```typescript
function exitCombat(session) {
  session.combatState = null
  session.gameState = 'exploration'
  console.log(`[stage3:combat] combat ended — all enemies dead`)
}
```

### Checkpoint 3

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario mid-combat
# Open URL. Submit: "I attack the guard" (guard at 4/11 HP)
# Expect:
#   - [stage3:attack] log shows roll, hit, damage
#   - If damage ≥ 4: [stage3:enemy-dead] log; response has combatState: null; gameState: "exploration"
#   - If damage < 4: initiativeOrder still has guard with reduced HP; turn advances
# Also test: submit action when it's not the player's turn (manually set activeActorId to enemy in DB)
#   - Expect 409 response
```

### Automated Tests — Phase 3

File: `lib/v2/__tests__/combat-turn.test.ts`

```
describe('turn gate')
  ✓ returns 409 when activeActorId !== characterId
  ✓ allows action when activeActorId === characterId

describe('attack resolution')
  ✓ hit: damage applied to enemy HP in initiativeOrder
  ✓ miss: enemy HP unchanged
  ✓ natural 20: damage dice doubled (not modifier)
  ✓ natural 1: always misses regardless of attack bonus
  ✓ advantage: higher of two rolls used
  ✓ disadvantage: lower of two rolls used
  ✓ enemy at 0 HP: removed from initiativeOrder
  ✓ enemy at 0 HP: currentProperties.awareness_state set to 'dead'
  ✓ sneak attack dice added when Rogue has advantage
  ✓ sneak attack NOT added when Rogue has disadvantage and no ally adjacent
  ✓ damage resistance: halves damage when attack type matches resistance list
  ✓ minimum 1 damage enforced

describe('turn advance')
  ✓ player acted: acted flag set on their entry
  ✓ next actor in initiative order becomes activeActorId
  ✓ end of round: all acted reset to false, round increments
  ✓ all enemies dead: combatState null, gameState exploration

describe('other actions')
  ✓ hide: stealth roll vs passive perception determines hidden status
  ✓ provoke success: priority_target set on enemy for N rounds
  ✓ provoke failure: enemy gains advantage flag for next attack
  ✓ change_proximity: toggles enemy proximity field
  ✓ change_proximity to 'far' without disengage: opportunity attack triggered
  ✓ disengage: no opportunity attack on subsequent move_to_room

describe('death saves')
  ✓ roll ≥ 10: success counter increments
  ✓ roll < 10: failure counter increments
  ✓ 3 successes: stabilized at 1 HP, removed from initiative action requirement
  ✓ 3 failures: player dead
```

---

## Phase 4 — Enemy AI Turn Resolution

**Goal:** When `activeActorId` is an enemy, Stage 3 auto-resolves that enemy's turn with pure code, then advances to the next actor. All enemy actions are appended to the mechanical fact block for Stage 4 to narrate in one call.

### 4.1 Enemy Turn Dispatcher

```typescript
function resolveEnemyTurn(entry: InitiativeEntry, combatState: CombatState, character): EnemyActionResult
```

Reads `ai_behavior` from the enemy's `defaultProperties` in `PoiTemplate`:

| `priority` | Behavior |
|---|---|
| `aggressive` | Attack player if `close`; move to `close` if `far` |
| `defensive` | Hold; attack if player is `close` |
| `cowardly` | Attack if cornered; `move_to_room` if HP < `flee_threshold` |

Attack resolution uses the same `rollD20Check` + `computeAttackDamage` path as player attacks, with `combat_stats.attack_bonus` and `combat_stats.damage`.

Apply damage to `character.currentHp` via DB update.

If `priority_target` is set and active, target that character first.

```typescript
console.log(`[stage3:enemy-turn] ${entry.name} — action=${action} target=${targetName}`)
console.log(`[stage3:enemy-attack] ${entry.name} roll=${roll} vs AC=${charAC} hit=${isHit} damage=${damage}`)
```

### 4.2 Auto-Resolve Loop

After the player's turn resolves and `activeActorId` advances:
- Loop through `initiativeOrder` entries where `type === 'enemy'` and `acted === false`
- Resolve each enemy turn in sequence (not parallel — order matters)
- Stop when hitting the next player entry (player's next turn)
- All enemy actions accumulate in `mechanicalFacts[]` passed to Stage 4

### 4.3 Stage 4 Integration

Append to the mechanical fact block for the existing Stage 4 narrative call:

```
Player: Tomas attacked Slumped Guard — hit AC 13, dealt 5 damage.
Enemy turns:
- Slumped Guard: attacked Tomas — rolled 11 vs AC 12, miss.
```

Stage 4 narrates the full round in one call. No extra AI calls per enemy.

### Checkpoint 4

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario enemy-turn
# Manually set activeActorId to the enemy's ID in the DB (or adjust seed)
# Submit any action — it should immediately advance past the enemy turn
# Expect:
#   - [stage3:enemy-turn] log appears
#   - [stage3:enemy-attack] log shows the roll
#   - Response narrative includes the enemy action
#   - Character.currentHp decremented if attack hit
#   - activeActorId advances back to player
```

### Automated Tests — Phase 4

File: `lib/v2/__tests__/enemy-ai.test.ts`

```
describe('resolveEnemyTurn')
  ✓ aggressive: attacks when player is close
  ✓ aggressive: moves to close when player is far (proximity changes)
  ✓ defensive: does not advance if player is far
  ✓ defensive: attacks when player moves to close
  ✓ cowardly: attacks when HP above flee_threshold
  ✓ cowardly: flees when HP below flee_threshold
  ✓ surprised enemy: skips turn (acted = true without action)
  ✓ priority_target: targets specified characterId when set and not expired
  ✓ priority_target expires at round N
  ✓ enemy at 0 HP: skipped (already removed)

describe('auto-resolve loop')
  ✓ all enemies between player turns resolved before returning
  ✓ player's next turn is activeActorId after loop
  ✓ enemy actions appended to mechanicalFacts in order
  ✓ character.currentHp decremented by successful enemy attacks
  ✓ player reaching 0 HP mid-enemy-loop: remaining enemies skip (player is down)
```

---

## Phase 5 — Combat Exit + Flee + Opportunity Attacks

**Goal:** Player can flee combat via `move_to_room`. Opportunity attacks apply. Pursuit behavior governs whether enemies follow. Combat ends cleanly with correct state cleanup.

### 5.1 Flee Detection

In Stage 3, when `action_type === 'move_to_room'` and `session.gameState === 'combat'`:
1. Identify all `close` enemies in `initiativeOrder` who have `reactionUsed: false`
2. Each such enemy gets one free attack roll (opportunity attack) before the move resolves
3. Apply damage to `character.currentHp`
4. Set `reactionUsed: true` on each enemy who attacked

If player has `disengage` flag set this turn, skip opportunity attacks entirely.

```typescript
console.log(`[stage3:opportunity] ${enemy.name} opportunity attack on fleeing player — roll=${roll} hit=${isHit} damage=${damage}`)
```

### 5.2 Pursuit

After the player's `move_to_room` resolves, check each enemy's `pursuit` value from `defaultProperties`:

| `pursuit` | Action |
|---|---|
| `"none"` | Enemy stays in current room, remains `alert` |
| `"adjacent"` | Enemy moves to the player's new room on their next turn (update their `RoomParticipant`) |
| `"full"` | Enemy follows until 3 rooms away |

If an enemy follows the player into a room that already has an `alert` enemy, both participate in a single `CombatState` in the new room.

### 5.3 Flee to New Combat Room

If `move_to_room` destination has alert + hostile enemies:
- `exitCombat()` the old room state
- Immediately call `enterCombat()` for the new room
- No exploration turn — combat triggers without user submitting another action

### Checkpoint 5

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario flee-test
# Open URL. Submit: "I run for the door"
# Expect:
#   - [stage3:opportunity] log if enemy is close and has reaction
#   - Character HP decremented by opportunity attack damage
#   - Player moves to new room; gameState reverts to exploration (no enemies there)
# Also test with disengage first:
#   - Submit "I disengage" then "I run for the door"
#   - No opportunity attack should fire
```

### Automated Tests — Phase 5

File: `lib/v2/__tests__/combat-exit.test.ts`

```
describe('opportunity attacks on flee')
  ✓ close enemy fires opportunity attack when player moves_to_room
  ✓ far enemy does not fire opportunity attack
  ✓ reactionUsed set to true after opportunity attack
  ✓ second enemy with reactionUsed already set does not fire again
  ✓ disengage flag suppresses all opportunity attacks
  ✓ player at 0 HP from opportunity attack: enters death save state, move cancels

describe('pursuit')
  ✓ pursuit:"none" — enemy stays in room, remains alert
  ✓ pursuit:"adjacent" — enemy assigned to player's new roomInstance
  ✓ pursuit:"full" — enemy follows across multiple rooms until 3-room limit
  ✓ pursuing enemy into new room with existing combat: single CombatState merges both

describe('combat end — all enemies dead')
  ✓ combatState set to null
  ✓ gameState set to "exploration"
  ✓ enemy currentProperties.awareness_state = "dead"
  ✓ enemy current_hp = 0 persisted
  ✓ surviving enemies in adjacent rooms retain their awareness_state unchanged
```

---

## Phase 6 — Detection Flow

**Goal:** Stealth on room entry works. Awareness state progression (`unaware → suspicious → alert`) is correct. Suspicious grace turn enforces one-action window. Loud action propagation reaches adjacent rooms.

### 6.1 Room Entry Detection

When `action_type === 'move_to_room'` resolves:
1. Check if player is sneaking (Stage 2 tags `sneaking: true`)
2. For each enemy in the destination room:
   - If enemy is `alert` + hostile → trigger combat immediately (no check needed)
   - If enemy is `suspicious` → auto-detected; combat does NOT trigger immediately (grace turn)
   - If enemy is `unaware` AND player is sneaking → roll Stealth vs `passive_perception`
     - Fail → enemy escalates to `suspicious`
     - Pass → enemy stays `unaware`; player has `surprised_bonus: true` if combat starts this turn

```typescript
console.log(`[stage3:detection] room=${roomId} sneaking=${isSneaking} enemies=${enemies.map(e => `${e.name}:${e.awareness}`).join(', ')}`)
console.log(`[stage3:stealth] roll=${stealthRoll} vs DC=${passivePerception} result=${result}`)
```

### 6.2 Suspicious Grace Turn

When an enemy transitions to `suspicious`, write to its `currentProperties` and narrate via Stage 4. The player's NEXT action determines escalation:

- Hide → Stealth vs `passive_perception + 2`
  - Success: enemy back to `unaware`
  - Fail: escalate to `alert` → combat
- Attack → immediate combat, player acts first (enemy flat-footed)
- `move_to_room` → enemy escalates to `alert`; patrol enemies follow, others stay `alert`
- Loud action (`destroy_poi`, etc.) → immediate `alert` → combat
- Quiet action (examine, pick_up) → enemy rolls active Perception (`d20 + WIS mod`) vs player's passive Stealth

Store `suspectedRoomInstanceId` on the POI's `currentProperties` so the next action in that room triggers the check.

### 6.3 Loud Action Propagation

After `destroy_poi`, `attack`, or `interact` on a `loud: true` POI:
1. Find all adjacent rooms (one exit away from current room)
2. For each `unaware` or `suspicious` enemy in those rooms:
   - Compute DC from barrier type (archway=10, closed door=15, locked door=18)
   - Roll `d20 + enemy WIS mod` vs DC
   - Hit → escalate awareness one step

```typescript
console.log(`[stage3:loud] propagating to ${adjacentRooms.length} adjacent rooms, barrier DC=${dc}`)
console.log(`[stage3:loud] ${enemy.name} in ${roomName}: roll=${roll} vs DC=${dc} → ${result}`)
```

### Checkpoint 6

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario suspicious-grace
# Open URL. Submit: "I hide behind the barrel"
# Expect: [stage3:stealth] log with roll; enemy returns to unaware on success
#
# Submit: "I smash the crate" (loud action from another room adjacent to a guard)
# Expect: [stage3:loud] propagation log; guard in adjacent room escalates awareness
```

### Automated Tests — Phase 6

File: `lib/v2/__tests__/detection.test.ts`

```
describe('room entry detection')
  ✓ alert hostile enemy: combat triggered immediately on entry
  ✓ suspicious enemy: grace turn granted, combat NOT triggered
  ✓ unaware enemy, sneaking, stealth pass: enemy stays unaware
  ✓ unaware enemy, sneaking, stealth fail: enemy escalates to suspicious
  ✓ unaware enemy, not sneaking: enemy auto-detects player (escalates)
  ✓ recognition_exception matches story flag: hostile check returns false, no combat

describe('suspicious grace turn')
  ✓ hide + stealth success: enemy returns to unaware
  ✓ hide + stealth fail: enemy escalates to alert, combat triggers
  ✓ attack action: immediate combat, player acts before enemy (no surprise)
  ✓ move_to_room: enemy escalates to alert
  ✓ loud action: enemy escalates to alert, combat triggers
  ✓ quiet action: enemy rolls active perception vs player passive stealth

describe('loud action propagation')
  ✓ destroy_poi: propagates to adjacent rooms
  ✓ archway barrier: DC 10
  ✓ closed door barrier: DC 15
  ✓ locked door barrier: DC 18
  ✓ roll beats DC: enemy escalates one step
  ✓ roll fails DC: enemy unchanged
  ✓ propagation is one room deep only (does not chain)
  ✓ enemy already alert: no further escalation
```

---

## Phase 7 — UI: Global Layout + Combat Header

**Goal:** The play page renders the correct header color and combat indicators based on `gameState`. Bottom nav is always visible with 4 tabs.

### 7.1 Bottom Nav

Replace the existing map pull-up sheet with a persistent `<BottomNav />` component. Four equal-width tabs: Chat, Inventory, Party, Map. Active tab: accent underline + bold label. Tab state lives in a `useState('chat')` in the page root.

### 7.2 Header

Extract `<Header />` component. Props: `roomName: string`, `gameState: 'exploration' | 'combat'`, `round?: number`.

- Exploration: `bg-blue-600 text-white` — room name left-aligned
- Combat: `bg-red-600 text-white` — room name left, `[In Combat]` pill center, round number right (small, `text-sm`)

The header color is the primary mode signal — players see it across all tabs.

### 7.3 `<TabContent />`

`flex-1 overflow-hidden` region between header and bottom nav. Renders active tab's component. Tab components:
- `<ChatTab />` — existing chat stream, refactored into this component
- `<InventoryTab />` — Phase 11
- `<PartyTab />` — Phase 11
- `<MapTab />` — moves existing `<DungeonMap />` here from the pull-up sheet

### Checkpoint 7

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario ui-combat
# Open URL. Confirm:
#   - Header is red with [In Combat] pill and round number
#   - Bottom nav shows 4 tabs; tapping each switches content
#   - Map tab shows the dungeon SVG (existing map, moved here)
#   - Header color persists when switching tabs
# Then: kill all enemies via API (PATCH combatState to null)
#   - Confirm header switches back to blue
```

### Automated Tests — Phase 7

File: `lib/v2/__tests__/ui-header.test.tsx` (React Testing Library)

```
describe('<Header />')
  ✓ exploration: renders bg-blue-600
  ✓ exploration: no [In Combat] pill, no round number
  ✓ combat: renders bg-red-600
  ✓ combat: renders [In Combat] pill
  ✓ combat: renders round number
  ✓ combat round=1: shows "Round 1"
  ✓ combat round=3: shows "Round 3"

describe('<BottomNav />')
  ✓ renders 4 tabs: Chat, Inventory, Party, Map
  ✓ active tab has accent underline
  ✓ tapping a tab calls onTabChange with correct value
```

---

## Phase 8 — UI: Initiative Strip

**Goal:** `<InitiativeStrip />` renders sticky below the combat header. Scrollable row of icon circles in initiative order. Tap expands `<InitiativeMiniSheet />`.

### 8.1 `<InitiativeStrip />`

`overflow-x-auto` horizontal row. Only renders when `gameState === 'combat'`.

Icon circle per `InitiativeEntry`:
- `▼` above the active actor (current turn)
- 80% size + 50% opacity for entries where `acted === true`
- HP ring color: >60% green, 30–60% yellow, <30% red, 0 grey
- Skull overlay on grey ring for dead/unconscious

Rightmost visible icon cropped ~30% (overflow hint). Active actor auto-scrolled into view via `scrollIntoView` on update.

Name label and HP fraction below each icon.

### 8.2 `<InitiativeMiniSheet />`

Inline panel that drops below the strip on tap. Tap the active icon or any icon to open; tap again or tap outside to close. One sheet at a time.

**Own character:**
- HP, AC, attack bonus
- Class features with `●`/`◎` availability indicators
- Tapping `●` during combat: sub-picker if needed (Cunning Action), then navigate to Chat tab, insert chip

**Enemy:**
- HP / maxHP, AC
- `Proximity: Close / Far`
- `Status: —` or listed conditions

### Checkpoint 8

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario ui-combat
# Open URL → Chat tab
# Confirm:
#   - Initiative strip visible below header
#   - Active actor has ▼ marker
#   - Enemy with 4/11 HP has yellow or red ring (depending on %)
#   - Rightmost icon is partially cropped
#   - Tapping own character icon: mini-sheet shows HP, AC, class features
#   - Tapping enemy icon: mini-sheet shows HP/maxHP, AC, proximity
#   - Tapping outside mini-sheet: dismisses
```

### Automated Tests — Phase 8

File: `lib/v2/__tests__/ui-initiative.test.tsx`

```
describe('<InitiativeStrip />')
  ✓ not rendered when gameState === 'exploration'
  ✓ renders one icon per initiativeOrder entry
  ✓ active actor icon has ▼ marker
  ✓ acted actors are at 80% size and 50% opacity
  ✓ HP > 60%: green ring
  ✓ HP 30–60%: yellow ring
  ✓ HP < 30%: red ring
  ✓ HP = 0: grey ring with skull overlay
  ✓ entries sorted in initiative order left-to-right

describe('<InitiativeMiniSheet />')
  ✓ own character: shows HP, AC, class features
  ✓ enemy: shows HP/maxHP, AC, proximity
  ✓ tapping outside dismisses
  ✓ tapping same icon again dismisses
  ✓ only one sheet open at a time (second tap replaces)
  ✓ class feature ● tap during combat: navigates to chat and inserts chip
  ✓ class feature out of combat: shows tooltip, no navigation
```

---

## Phase 9 — UI: Action Chips + Chip-in-Input

**Goal:** `<ActionChips />` row above the input in combat mode. Tapping a chip inserts a removable pill tag into `<ChatInput />`. `action_hint` is passed with the submission.

### 9.1 `<ActionChips />`

Horizontally scrollable row. Only renders when `gameState === 'combat'`.

Standard chips: `[Attack]` `[Dodge]` `[Dash]` `[Disengage]` `[Hide]` `[Use Item]` `[Provoke]`

Class feature chips keyed to character class (read from `ViewStatePayload` character data):
- `[⚡ Second Wind ●]` — Fighter/other; `◎` if expended
- `[⚡ Cunning Action ●]` — Rogue

Greyed chips (actions already used this turn via `currentTurnUsage.actionUsed`) are visible but non-interactive. `[Use Item]` greyed if no `combat_usable` items in inventory.

Cunning Action tap → inline sub-picker above the chips row:
```
Cunning Action — use as:  [Hide] [Dash] [Disengage]
```
Selection closes picker and inserts `[Cunning Action: Hide ×]` chip.

### 9.2 Chip-in-Input

`<ChatInput />` has a `chipSlot: string | null` state. When non-null, renders a pill at the start of the input with an `×` button.

- One chip maximum — tapping a second chip replaces the first
- `×` clears chip, input returns to freeform
- Sending appends `action_hint: chipSlot` to the POST body alongside `text`
- Exploration mode: no chip slot, no chips row

### Checkpoint 9

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario ui-combat
# Open URL → Chat tab
# Confirm:
#   - Chips row visible in combat
#   - Tapping [Attack] inserts "[Attack ×]" pill in input
#   - Typing additional text: "[Attack ×] slash at his wrist"
#   - Tapping [×] removes pill
#   - Tapping another chip replaces existing pill
#   - Tapping [⚡ Cunning Action ●]: sub-picker appears
#   - Selecting [Hide] from sub-picker: "[Cunning Action: Hide ×]" in input
#   - Sending: action_hint is visible in the POST body (check network tab)
#   - Switch to exploration (seed or DB patch): chips row disappears
```

### Automated Tests — Phase 9

File: `lib/v2/__tests__/ui-chips.test.tsx`

```
describe('<ActionChips />')
  ✓ not rendered during exploration
  ✓ renders all standard chips in combat
  ✓ class feature chips rendered for correct class
  ✓ actionUsed chip is greyed and non-interactive
  ✓ expended class feature shows ◎ and is non-interactive
  ✓ no combat_usable items: [Use Item] greyed
  ✓ [⚡ Cunning Action] tap: sub-picker appears
  ✓ sub-picker selection: picker closes, chip inserted

describe('<ChatInput /> chip-in-input')
  ✓ chip tap: pill renders at start of input
  ✓ second chip tap: replaces existing pill
  ✓ × tap: pill removed, input freeform
  ✓ send with chip: action_hint included in POST body
  ✓ send without chip: action_hint absent from POST body
  ✓ exploration mode: no chip slot rendered
```

---

## Phase 10 — UI: Combat Chat Messages + State Transitions

**Goal:** `<CombatBanner />` appears in the log at combat start/end. `<RollBadge />` renders mechanical results. Exploration↔combat transitions work without a page reload.

### 10.1 Message Type Rendering

The chat stream already renders `dm_narrative` and `player_action` message types. Add:

**`<CombatBanner />`** — full-width card with dark border. Two variants:
- `combat_start`: "⚔ Combat started — Round 1 | [Show snapshot]" — tap expands initiative order at that moment
- `combat_end`: "Combat ended — all enemies defeated" or "— fled"

**`<RollBadge />`** — left-aligned pill row (no avatar). Shows: action name, roll breakdown, result.
```
🎲 Attack   17+5=22  vs AC 15  ✓
   Damage   1d8+3 = 7
```

### 10.2 State Transition Handling

The existing `sendAction` response handler receives `ViewStatePayload`. Extend it:
- When `gameState` switches from `exploration` to `combat`: update local `gameState` state, store `combatState`, append `<CombatBanner type="combat_start" />` to message list
- When `gameState` switches from `combat` to `exploration` (combatState null): update local state, append `<CombatBanner type="combat_end" />`
- No page reload. No refetch of message history. State derived from each response.

### 10.3 `<CombatResumeCard />`

Rendered at the bottom of the Chat message list when page loads with `gameState === 'combat'` AND the most recent message in the log predates the current session.

Not stored. Generated from `combatState` on mount. Unmounts when the player's first action response returns.

```
─── Combat resumed · Round 3 · Guard Post ──────────────
  Tomas (you)      ♥ 8/18   AC 12
  Slumped Guard    ♥ 4/11   AC 13   ← your turn
  Harwick Vorne    ♥ 22/22  AC 15   (acted)

  Scroll up to see how this fight started.
─────────────────────────────────────────────────────────
```

Dead enemies (hp=0) are omitted. "(acted)" label for entries with `acted: true`. "← your turn" for `activeActorId === characterId`.

### Checkpoint 10

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario mid-combat
# Fresh page load (simulate returning player)
# Confirm:
#   - Resume card renders at bottom of chat
#   - Card shows correct round, room name, combatants, whose turn
#   - Dead enemies not shown in card
#   - Submit action → card disappears, response narrative appears
#
# From exploration, trigger combat (Phase 2 path):
#   - Confirm <CombatBanner type="combat_start"> appears inline in log
#   - Header turns red
#   - Chips + initiative strip appear
# Kill all enemies:
#   - Confirm <CombatBanner type="combat_end"> appears
#   - Header turns blue
#   - Chips + initiative strip disappear
```

### Automated Tests — Phase 10

File: `lib/v2/__tests__/ui-combat-messages.test.tsx`

```
describe('<CombatBanner />')
  ✓ combat_start variant renders ⚔ and round number
  ✓ combat_end variant renders "Combat ended" text
  ✓ snapshot expand: shows initiative order at combat start

describe('<RollBadge />')
  ✓ renders action name, roll equation, vs target, outcome check
  ✓ renders damage line when present
  ✓ crit highlighted differently from normal hit

describe('<CombatResumeCard />')
  ✓ renders when gameState=combat on load with stale messages
  ✓ not rendered when gameState=exploration on load
  ✓ not rendered when last message is from current session
  ✓ dead enemies (hp=0) excluded from card
  ✓ active actor marked with "← your turn"
  ✓ acted entries show "(acted)"
  ✓ unmounts after first action response

describe('state transitions')
  ✓ exploration→combat: header turns red, strip+chips mount, combat banner appended
  ✓ combat→exploration: header turns blue, strip+chips unmount, end banner appended
  ✓ no page reload on either transition
  ✓ combatState null in response: treated as combat end
```

---

## Phase 11 — UI: Party Tab + Inventory Tab

**Goal:** Party tab shows character sheet with class features activatable during combat. Inventory tab shows correct buttons for exploration vs combat, with combat restrictions enforced.

### 11.1 `<PartyTab />`

`<PartyHeader />` — sticky top of tab. Horizontally scrollable avatar row with name and HP. Tap to switch `<CharacterSheet />` below.

`<CharacterSheet />` — scrollable content:
- Combat stats: HP, AC, Speed, Attack bonus, Damage, Initiative modifier
- Class features: each with availability indicator `●`/`◎`
  - Own character + combat: tap `●` → sub-picker if needed → navigate to Chat → insert chip
  - Own character + exploration: tap → description tooltip
  - Ally: read-only in all cases
- Ability scores: 6 scores with modifiers
- Skills: proficient marked `★`, all shown with total bonus

### 11.2 `<InventoryTab />`

**Exploration:**
- `[Use]`: executes directly for usable items
- `[Equip]`/`[Unequip]`: updates equipment state
- `[Drop]`: places item as POI in current room

**Combat:**
- `[Use]` (only on `combat_usable: true` items): navigates to Chat, inserts chip
- `[Equip]`/`[Unequip]`/`[Drop]`: fully disabled with a muted visual state
- Items without `combat_usable` do not show `[Use]` during combat

### Checkpoint 11

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario ui-combat
# Open URL → Party tab
# Confirm:
#   - PartyHeader shows avatar + HP for each character
#   - Tapping avatar switches character sheet below
#   - Own character: class features show ● and are tappable
#   - Tapping Cunning Action ●: sub-picker appears, then chat tab opens with chip
#   - Ally character: class features are read-only (no tap affordance)
#
# → Inventory tab in combat mode:
#   - Healing Potion shows [Use]; tap navigates to Chat with chip inserted
#   - [Equip]/[Drop] are visually disabled
#   - Rope (no combat_usable) has no [Use] button
#
# Switch to exploration (DB patch or seed):
#   - Inventory [Use] executes directly (test with Thieves' Tools)
#   - [Equip]/[Drop] are active
```

### Automated Tests — Phase 11

File: `lib/v2/__tests__/ui-party-inventory.test.tsx`

```
describe('<CharacterSheet />')
  ✓ combat stats section: HP, AC, attack, initiative
  ✓ class features: own character in combat shows tappable ●
  ✓ class features: own character out of combat shows tooltip on tap, no nav
  ✓ class features: ally is read-only regardless of mode
  ✓ expended feature shows ◎ and is non-interactive

describe('<InventoryTab />')
  ✓ exploration: [Use] visible for usable items
  ✓ exploration: [Equip]/[Unequip] active
  ✓ exploration: [Drop] active
  ✓ combat: [Use] only on combat_usable items; tap navigates to Chat
  ✓ combat: item without combat_usable has no [Use]
  ✓ combat: [Equip]/[Unequip]/[Drop] disabled
  ✓ combat: Use Item chip inserted with correct item name
```

---

## Phase 12 — Use Item Flow

**Goal:** `[Use Item]` chip opens `<ItemPickerSheet />` bottom sheet. Target selection for `targetable` items. Chip inserted, sheet dismissed.

### 12.1 `<ItemPickerSheet />`

Bottom sheet slides up ~50% screen height on `[Use Item]` chip tap. Chat partially visible above.

Content: list of `combat_usable: true` items in inventory with name, quantity, description.

If selected item has `targetable: true`: replace list with target picker showing party members in the same room with their current HP.

On selection: sheet dismisses, chip inserted into `<ChatInput />`:
- `[Use: Healing Potion ×]` (self / untargeted)
- `[Use: Healing Potion → Brennan ×]` (targeted)

Edge cases:
- No `combat_usable` items: `[Use Item]` chip greyed; tap shows inline "Nothing usable in combat" message
- One item, no target: sheet skips to chip insertion immediately
- Drag sheet down or tap outside: dismiss with no chip

### Checkpoint 12

```bash
npx tsx scripts/seed-combat-scenario.ts --scenario ui-combat
# Ensure character inventory has Healing Potion (targetable) and one non-targetable item
# Open URL → Chat tab → tap [Use Item]
# Confirm:
#   - Sheet slides up; shows only combat_usable items
#   - Rope/Silver Key not shown
#   - Tap Healing Potion: target picker appears with own character + any allies
#   - Tap own character: sheet dismisses, "[Use: Healing Potion ×]" in input
#   - Drag sheet down: dismisses, no chip
# Also: remove all combat_usable items from inventory (DB patch)
#   - [Use Item] chip greyed; tap shows "Nothing usable in combat"
```

### Automated Tests — Phase 12

File: `lib/v2/__tests__/ui-item-sheet.test.tsx`

```
describe('<ItemPickerSheet />')
  ✓ opens on [Use Item] chip tap
  ✓ shows only combat_usable items
  ✓ non-combat items not listed
  ✓ targetable item: tap shows target picker
  ✓ non-targetable item: tap inserts chip immediately
  ✓ target selection: chip includes target name
  ✓ no target: chip has no arrow
  ✓ drag down: dismisses, no chip
  ✓ tap outside: dismisses, no chip
  ✓ empty combat_usable inventory: "Nothing usable in combat"
  ✓ one non-targetable item: skips sheet, chip immediate
```

---

## Phase 13 — Advanced Mechanics

**Goal:** Stealth kills, body discovery, patrol behavior, re-hiding mid-combat, status effects (prone/unconscious), damage resistances.

### 13.1 Stealth Kills

In `resolvePlayerAttack`, after confirming `hidden` status + target `unaware`:
- Attack has advantage
- If kill is instant (HP → 0) AND weapon has `silent: true` → no loud-action propagation
- If kill is NOT instant → enemy can cry out on their turn (auto-propagate loud to adjacent rooms)

### 13.2 Body Discovery

On each `unaware` enemy's turn: if any dead ally (`awareness_state: "dead"`) is in the same room:
- Roll `d20 + WIS mod` vs DC 8 (or 12/16 if partially/fully obscured)
- Success → enemy escalates to `suspicious`

### 13.3 Patrol Behavior

Enemies with `patrol: true` in `defaultProperties`:
- When `suspicious`: move to doorway between rooms on their grace turn (narrated as approaching footsteps)
- When `alert`: enter the room and join combat

### 13.4 Re-hiding Mid-Combat

`hide` action costs a full `action`. Roll Stealth vs all enemies' passive Perception:
- Success: player marked hidden; gain advantage on next attack
- Fail: no hidden status

Rogue Cunning Action (`hide` as bonus action) — `bonusActionUsed` path, deferred for v1 but field exists.

### 13.5 Status Effects — Prone

`prone` in `status_effects`:
- Melee attacker has advantage vs prone target
- Ranged attacker has disadvantage vs prone target
- Standing costs movement (one `change_proximity` equivalent action)

`unconscious` — player at 0 HP:
- Enter death save state
- Cannot take actions (gate in Stage 3)
- Stable at 1 HP after 3 saves

### Checkpoint 13

```bash
# Test stealth kill:
npx tsx scripts/seed-combat-scenario.ts --scenario alert-entry
# Sneak in, hide, attack unaware guard with dagger (silent: true)
# Confirm: no propagation log to adjacent rooms on kill

# Test body discovery:
# After killing guard silently, advance turns until second guard's turn
# Confirm: [stage3:detection] body discovery roll log

# Test prone:
# Add prone to a test enemy's status_effects via DB patch
# Attack with melee: confirm advantage
# Attack with ranged: confirm disadvantage
```

### Automated Tests — Phase 13

File: `lib/v2/__tests__/advanced-mechanics.test.ts`

```
describe('stealth kills')
  ✓ hidden attacker + unaware target: advantage on attack
  ✓ instant kill with silent weapon: no propagation
  ✓ instant kill with non-silent weapon: propagation fires
  ✓ non-instant kill: enemy cry on their turn auto-propagates

describe('body discovery')
  ✓ unaware enemy: rolls perception vs DC 8 when dead ally in room
  ✓ roll beats DC: enemy escalates to suspicious
  ✓ roll fails DC: enemy unchanged
  ✓ DC 12 for partially obscured body
  ✓ DC 16 for hidden body

describe('prone status effect')
  ✓ melee attack vs prone target: advantage
  ✓ ranged attack vs prone target: disadvantage
  ✓ standing action: removes prone status

describe('damage resistances')
  ✓ attack type matches resistance: damage halved (round down)
  ✓ attack type not in resistance: full damage
  ✓ Varath: resistant to nonmagical physical; magical bypasses

describe('re-hiding mid-combat')
  ✓ hide action: stealth roll vs all enemies' passive perception
  ✓ all enemies beaten: player gains hidden status
  ✓ any enemy beats stealth: no hidden status
```

---

## Regression Guard

After each phase, run the full test suite to catch regressions:

```bash
npm run test:run
```

Key exploration behaviors that must not break:
- `move_to_room` in exploration: no combat detection triggers
- `pick_up`, `examine`, `use_item` (non-combat): still resolve in exploration context
- `lock`/`unlock` interactions: unaffected by combat state
- Map rendering: works regardless of `gameState`
- Message log history load: unaffected by `combatState` presence

Each of these should have a corresponding regression test in their respective existing test files. If they don't, add a smoke test now:

File: `lib/v2/__tests__/exploration-regression.test.ts`

```
describe('exploration actions unaffected by combat schema addition')
  ✓ move_to_room in exploration: gameState stays "exploration"
  ✓ pick_up: inventory updated, no combat side effects
  ✓ examine: POI state updated, no combat state touched
  ✓ use_item (healing potion in exploration): HP updated, no combatState written
  ✓ message log load: works when combatState is null
  ✓ message log load: works when combatState is present (mid-combat session)
  ✓ map route: returns correctly when combatState is null
  ✓ map route: returns correctly when combatState is present
```
