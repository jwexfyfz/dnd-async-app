# Plan: Multiplayer Combat Join

> **⚠️ SUPERSEDED IN PART (2026-06-12):** See `PLAN-los-redesign-no-teleport.md`. The "Option A"
> LoS-ally enrollment design below — where a LoS ally's `roomParticipant` is teleported into the
> combat room — has been replaced with a "stay in place, join initiative remotely" design.
> Affected: the Design Principles bullet on Option A, spec items §C/§E/§F's `roomParticipant`
> move + `redirectRoomInstanceId` parts, scenario S2, and the "roomParticipant transfer for LoS
> allies (Option A)" test block. Everything else in this doc is still valid.

---

## Audit Findings (pre-implementation review, 2026-06-11)

### CRITICAL — Will break at runtime if unaddressed

**A. `isMechanicalEvent: true` blocks `combat_alert` from appearing in the log.** — SPEC FIXED
`prefetchViewStateData` queries `isMechanicalEvent: false` only. All new entries (`combat_alert`, `join_combat`) must use `isMechanicalEvent: false`, identical to `combat_start`.

**B. Cross-room message posting is unaddressed.** — SPEC FIXED (see Implementation Specs §B below)
Message logs are per-room. Characters in room B cannot see entries posted to room A. `enterCombat` must group non-enrolled characters by their current `roomInstanceId` and post one `combat_alert` entry per distinct room (not per character).

**C. `enterCombat` signature must change.** — SPEC FIXED (see Implementation Specs §C below)
Needs `sessionId: string` as a second parameter. All three call sites in `game-controller.ts` must be updated.

**D. `combatAlert` field missing from `ViewStatePayload` type.** — ✅ FIXED
`CombatAlertInfo` interface + `combatAlert` field added to `ViewStatePayload` in `types/v2-game.ts`. `view-state.ts` now fetches session combat rooms in parallel and populates `combatAlert`. `room/state` route also returns it.

**E. Client `activeRoomInstanceId` not updated after LoS auto-enroll.** — ⚠️ SUPERSEDED, see `PLAN-los-redesign-no-teleport.md` §2
~~`ViewStatePayload` now includes `redirectRoomInstanceId: string | null`...~~ No longer applicable — LoS allies are never physically moved, so there's no room to redirect the client to. Replaced by `ViewStatePayload.remoteCombat: { roomInstanceId, roomName, combatState } | null`, rendered as an overlay while the character's own room/map context is unchanged.

**F. Hidden LoS ally missing `'hiding'` in `InitiativeEntry.status_effects`.** — SPEC FIXED (see Implementation Specs §F below)
When creating the `InitiativeEntry` for a LoS auto-enrolled character in `enterCombat`, check `character.isHiding` and add `'hiding'` to `status_effects` if true.

---

### SIGNIFICANT — Wrong behavior in specific scenarios

**G. Late joiner `acted` flag: initiative slot already passed.** — SPEC FIXED (see Implementation Specs §G below)
`joinCombat` must set `acted: true` for a character whose initiative is strictly higher than the current active actor's initiative (that slot has already passed this round).

**H. `ally-in-combat` banner requires API changes not spelled out.** — ✅ FIXED
`characters` route now returns `isEnrolledInCombat: boolean` and `activeCombatRoomName: string | null` per session. Setup page `ActiveSession` type updated; `ally-in-combat` added to `BannerState` with orange palette.

**I. `activeSession.currentRoomName` was unreliable after auto-enroll.** — ✅ FIXED
`characters` route now finds the `roomInstance` where THIS character has a participant record, instead of using `roomInstances[0]` (which was ordered by timestamp, not by this character's location). `roomGameState` is also sourced from that room.

**J. Double-enrollment guard requires JSON field scan.** — SPEC FIXED (see Implementation Specs §J below)
`combatState` is a `Json` column; Prisma cannot filter by nested JSON in a `where` clause. The guard must fetch all `roomInstance` rows in the session with `gameState: 'combat'`, then scan `combatState.initiativeOrder` in JS.

**K. `ally-in-combat` banner showed wrong room name.** — ✅ FIXED
`characters` route returns `activeCombatRoomName` (the combat room name, not the character's own room). Banner label uses it.

---

### MINOR — Missing polish / edge cases

**L. `join_combat` message log `roomInstanceId` unspecified.** — SPEC FIXED
Post to the combat room's `roomInstanceId`. The character is now physically there.

**M. Map adjacentRoomPreviews after LoS auto-enroll.** — Handled implicitly
`roomParticipant` move removes the character from the old room's participant list; `adjacentRoomPreviews` re-derives from DB on next poll. No code change needed; a test covers it.

**N. Dormant LoS ally enrollment skip condition.** — SPEC FIXED
The LoS enrollment skip list (0 HP, own combat, already enrolled) must NOT include dormancy. Dormant only affects `advanceTurn`; the character should still be enrolled and their turn skipped each round.

**O. LoS ally OA on exit mid-combat.** — Handled by existing code
`resolveOpportunityAttacks` already fires on any `move_to_room` in combat. No change needed.

---

### Implementation Specs for remaining backend items

#### §B — Cross-room `combat_alert` posting in `enterCombat`

After building `initiativeOrder` and before returning, collect all non-enrolled session participants and group by room:

```typescript
// Collect characterIds already enrolled
const enrolledIds = new Set(initiativeOrder.filter(e => e.type === 'character').map(e => e.id));

// Fetch all session participants not in the combat room
const outsideParticipants = await prisma.roomParticipant.findMany({
  where: { roomInstance: { sessionId }, roomInstanceId: { not: roomInstance.id } },
  select: { characterId: true, roomInstanceId: true },
});

// Group by roomInstanceId; skip enrolled characters
const alertRooms = new Map<string, void>();
for (const p of outsideParticipants) {
  if (enrolledIds.has(p.characterId)) continue;
  alertRooms.set(p.roomInstanceId, undefined);
}

// Post one combat_alert per distinct room
const fightingNames = initiativeOrder.filter(e => e.type === 'character').map(e => e.name);
await Promise.all([...alertRooms.keys()].map(rid =>
  prisma.messageLog.create({
    data: {
      roomInstanceId: rid,
      isMechanicalEvent: false,
      mechanicalSummary: { type: 'combat_alert', roomName: roomInstance.template.name ?? '', fightingCharacters: fightingNames },
      text: `[COMBAT] Nearby combat — ${fightingNames.join(', ')} ${fightingNames.length === 1 ? 'is' : 'are'} fighting in ${roomInstance.template.name ?? 'an adjacent room'}.`,
    },
  })
));
```

Note: `roomInstance` passed to `enterCombat` needs to include `template.name` (add to the include shape).

#### §C — `enterCombat` new signature

```typescript
export async function enterCombat(
  roomInstance: { id: string; poiInstances: Array<...>; template: { name: string } },
  sessionId: string,
): Promise<CombatState>
```

All three call sites in `game-controller.ts` (lines ~900, ~877, ~608 area) pass `roomInstance.session.id` as the second argument. The `roomInstance` query in `game-controller.ts` already selects `session: { select: { id: true } }`, so `roomInstance.session.id` is available.

#### §F — Hidden LoS ally `status_effects` in `enterCombat`

⚠️ **Partially superseded, see `PLAN-los-redesign-no-teleport.md` §2.** The `isHiding`/`isDormant`
handling below is still correct — only the "moved roomParticipant" framing, `proximity: 'close'`,
and the missing `remoteRoomInstanceId` are outdated.

When building the `InitiativeEntry` for a LoS auto-enrolled character (`roomParticipant` is NOT moved — they stay in their own room), check `isHiding`:

```typescript
// Inside the LoS ally enrollment loop (roomParticipant is NOT moved):
const hidingEffects = loSAllyChar.isHiding ? ['hiding'] : [];
initiativeOrder.push({
  id: loSAllyChar.id,
  type: 'character',
  name: loSAllyChar.name,
  initiative: slot.initiative,
  hp: loSAllyChar.currentHp,
  maxHp: loSAllyChar.maxHp,
  ac: 10 + abilityModifier(loSAllyChar.baseDexterity),
  surprised: false,
  acted: false,
  proximity: 'far', // out of melee range until they physically arrive
  grid_slot: exitGridSlot, // the exit they're watching from
  status_effects: hidingEffects,
  isDormant: Date.now() - loSAllyLastActive.getTime() > DORMANT_MS,
  remoteRoomInstanceId: loSAllyChar.roomInstanceId,
});
```

#### §G — Late joiner `acted` flag in `joinCombat`

```typescript
// After rolling initiative and before inserting into the order:
const activeEntry = cs.initiativeOrder.find(e => e.id === cs.activeActorId);
// If the joiner's slot has already passed this round, mark acted so they don't act twice
const slotAlreadyPassed = activeEntry ? newInitiative > activeEntry.initiative : false;

const newEntry: InitiativeEntry = {
  id: characterId,
  type: 'character',
  name: characterName,
  initiative: newInitiative,
  hp: character.currentHp,
  maxHp: character.maxHp,
  ac: 10 + abilityModifier(character.baseDexterity),
  surprised: false,
  acted: slotAlreadyPassed,
  proximity: 'close',
  grid_slot: 'C',
  status_effects: resolvedIsHiding ? ['hiding'] : [],
  isDormant: false,
};

// Insert at correct position (descending initiative)
const insertIdx = cs.initiativeOrder.findIndex(e => e.initiative < newInitiative);
const newOrder = insertIdx === -1
  ? [...cs.initiativeOrder, newEntry]
  : [...cs.initiativeOrder.slice(0, insertIdx), newEntry, ...cs.initiativeOrder.slice(insertIdx)];
```

#### §J — Double-enrollment guard implementation

Used in both `enterCombat` (LoS scan) and `joinCombat`:

```typescript
async function isCharacterEnrolledInAnySessionCombat(
  characterId: string,
  sessionId: string,
  excludeRoomInstanceId?: string,
): Promise<boolean> {
  const combatRooms = await prisma.roomInstance.findMany({
    where: {
      sessionId,
      gameState: 'combat',
      ...(excludeRoomInstanceId ? { id: { not: excludeRoomInstanceId } } : {}),
    },
    select: { combatState: true },
  });
  return combatRooms.some(room => {
    const cs = room.combatState as { initiativeOrder?: Array<{ id: string }> } | null;
    return cs?.initiativeOrder?.some(e => e.id === characterId) ?? false;
  });
}
```

Call in `enterCombat` LoS scan: `await isCharacterEnrolledInAnySessionCombat(charId, sessionId, roomInstance.id)`
Call in `joinCombat`: `await isCharacterEnrolledInAnySessionCombat(characterId, sessionId, roomInstanceId)`

#### §L — `join_combat` message log placement

```typescript
await prisma.messageLog.create({
  data: {
    roomInstanceId: combatRoomInstanceId,  // the room the character just entered
    characterId,
    isMechanicalEvent: false,
    mechanicalSummary: {
      type: 'join_combat',
      round: cs.round,
      d20: d20Roll,
      modifier: dexMod,
      total: newInitiative,
      slotPosition: insertIdx === -1 ? newOrder.length : insertIdx + 1,
    },
    text: `[COMBAT] ${characterName} joins the fight — Round ${cs.round}. Initiative: ${d20Roll}+${dexMod}=${newInitiative} (slot #${slotPosition}).`,
  },
});
```

---

### Enhanced tests to add (appended to Tests section below)

See "Additional Tests" section at end of file.

---

## Design Principles
- Follow 5E rules where practical; simplify only when async play requires it
- MessageLog stays shared (party log) — LoS only affects join triggers and UI state
- Late joiners roll fresh initiative and slot into the current order (not bottom-of-round)
- Surprise only applies at combat start; late arrivals are never surprised
- Allies with LoS to the combat room are auto-enrolled in initiative when combat starts (5E: if you can see the fight you're in it). ⚠️ SUPERSEDED, see `PLAN-los-redesign-no-teleport.md` §2: ~~their `roomParticipant` is moved to the combat room at the doorway grid slot (Option A — simplest UI path; no cross-room state required)~~ — they stay in their own room and join the combat's `initiativeOrder` as a remote participant (`remoteRoomInstanceId` set, `grid_slot` = the exit they're watching from)
- Only one concurrent combat per session is supported; the LoS scan operates on the single active combat room
- A character cannot be enrolled in two initiative orders simultaneously; `joinCombat` skips if the character already appears in any active combat in the session

---

## Awareness States for Combat Join

The messageLog is a shared party log — all party members know combat is happening the moment it starts, regardless of walls or distance.

`combatAlert` in `ViewStatePayload` targets characters who are NOT enrolled in the initiative order. Enrolled LoS allies (doorway position) receive the combat UI, not `combatAlert`.

| Party member location | LoS to combat room? | Enrolled at combat start? | `combatAlert` shown? |
|---|---|---|---|
| Same room | N/A | Yes | No |
| Adjacent, `peek_visibility: full/obvious_only` | Yes | Yes | No |
| Adjacent, `peek_visibility: none` | No | No | Yes |
| Non-adjacent room | No | No | Yes |
| Already in own combat (adjacent room) | Yes | No — skip | Yes |
| 0 HP / downed | Any | No — skip | No |

---

## Scenarios

### S1 — Party member in the same room when combat starts
- **Trigger**: `enterCombat` called
- **Behavior**: all `roomParticipants` roll initiative and join regardless of hiding state
- **Hiding**: character joins with `isHiding` preserved — enemies don't know their position
- **0 HP**: downed characters in the room are NOT enrolled; they make death saves outside the initiative order
- **UI**: full combat view immediately
- **5E note**: surprise is not currently modelled for players (only for enemies via `isDormant`); this is a known gap against strict 5E and applies consistently across all scenarios

### S2 — Party member in adjacent room, LoS exists (`peek_visibility: full` or `obvious_only`)
> ⚠️ **SUPERSEDED — see `PLAN-los-redesign-no-teleport.md` §2.** Skip conditions, hiding
> preservation, and the "not surprised" note below remain valid; the "Behavior" line (the
> `roomParticipant` move + `redirectRoomInstanceId`) is replaced.
- **Trigger**: `enterCombat`; after enrolling same-room participants, scan all session `roomParticipants` not in the combat room
- **Skip conditions**: character is at 0 HP; character's current room is already in `gameState: combat` (S7); character is already enrolled in any active combat in the session
- **Behavior**: character remains physically in their own room (`roomParticipant` unchanged); added to `initiativeOrder` as a remote participant with `remoteRoomInstanceId` = their room and `grid_slot` = the exit's `grid_slot`; their `proximity` is "far" (out of melee range) until they physically walk in. `ViewStatePayload.remoteCombat` carries the combat UI to their client.
- **Hiding**: if `isHiding: true` at combat start, enrolled with hiding preserved — enemies in the combat room are unaware of them
- **UI**: `remoteCombat` overlay on next poll; no `combatAlert` shown — they are enrolled
- **5E note**: they can see the fight and are part of the encounter; not surprised (consistent with current no-player-surprise model)

### S3 — Party member in adjacent room, no LoS (`peek_visibility: none`), or non-adjacent room
- **Trigger**: `combat_alert` posted to messageLog (shared)
- **Behavior**: character remains in exploration mode; navigates to combat room; `joinCombat` fires on room entry
- **UI**: exploration mode + `combatAlert` banner
- **5E note**: not surprised on arrival — they knew combat was happening via the party log

### S4 — Hidden ally sneaks into combat room after combat has started
- **Trigger**: character with `isHiding: true` enters a room with `gameState: combat`
- **Behavior**: stealth check runs against each enemy's passive perception; if undetected, joins initiative with `isHiding: true` preserved and sneak attack available on first turn; if detected, joins with `isHiding: false`
- **UI**: combat view on entry; sneak attack chip visible if still hidden
- **5E note**: stealth check applies even in active combat — a rogue slipping through a side door can maintain surprise

### S5 — Party member joins mid-combat (rounds 2+), no LoS at combat start
- **Trigger**: character enters combat room while `gameState: combat`
- **Behavior**: roll initiative, insert at correct position; character acts on their next initiative count
- **0 HP**: downed character cannot move to join — blocked at the movement stage
- **UI**: full combat view on room entry; `join_combat` messageLog entry with initiative roll
- **Not surprised** — surprise only applies at combat start

### S6 — Party member is offline / inactive during combat
- **Behavior**: character remains in their room; does not auto-act
- **On reconnect**: if in combat room → auto-join on first action (S5); if outside → follow S3
- **Resume card**: show `CombatAlertResumeCard` only if `gameState` is still `combat`; if combat has already ended, show `ExplorationResumeCard` regardless of historical `combat_alert` log entries
- **Out of scope**: auto-resolving inactive character turns

### S7 — LoS ally is already in their own combat
- **Trigger**: `enterCombat` scans adjacent rooms; adjacent room is also in `gameState: combat`
- **Behavior**: skip — character is already fighting and cannot be enrolled in a second combat
- **UI**: character sees their own combat UI; receives `combatAlert` for the other fight (they know it's happening but can't act on it)
- **5E note**: a creature cannot participate in two combats simultaneously

### S8 — Combat ends before out-of-room character arrives
- **Trigger**: character is navigating toward combat room; combat ends (all enemies dead)
- **Behavior**: `joinCombat` is NOT called on room entry; `combatAlert` is absent from ViewState (combat over); room entry proceeds normally as exploration
- **Resume card precedence**: if `gameState !== 'combat'`, always show `ExplorationResumeCard` — never `CombatAlertResumeCard` — regardless of `combat_alert` entries in the log

---

## Known Gaps Against Strict 5E (out of scope this phase)
- **Player surprise**: 5E allows players to be surprised in an ambush. The current game only models enemy surprise (`isDormant`). LoS allies are stated as "not surprised" which is consistent with existing behavior but not strictly correct for ambush scenarios.
- **Fleeing combat**: a character can Disengage and exit the room mid-combat. They remain in the initiative order but cannot be targeted. No special handling is implemented; they stay enrolled until combat ends.
- **Opportunity attacks on room exit**: when a character leaves a threatened square, enemies can use their reaction for an OA. Not currently modelled for room-exit movement.
- **Concurrent combats**: only one combat per session is supported. Two simultaneous room combats would require significant rework of `combatState` scoping.

---

## UI Components

### Combat alert messageLog entry (`mechanicalSummary.type: 'combat_alert'`)
Rendered inline in the message log stream. Red palette, matches `CombatBanner` visual language. No action button — player responds in free text. Only posted for un-enrolled out-of-room characters.

```
┌─────────────────────────────────────────────┐
│ ⚔ Combat nearby — Flooded Passage           │  ← red-700 header, border-red-300 bg-red-50
│ Aldric is fighting.                          │  ← text-sm text-red-800
└─────────────────────────────────────────────┘
```

`isMechanicalEvent: true`, `mechanicalSummary: { type: 'combat_alert', roomName: string, fightingCharacters: string[] }`

### Initiative roll entry for late joiners (`mechanicalSummary.type: 'join_combat'`)
Posted by `joinCombat` when a character enters an in-progress combat. Renders like the roll rows inside `CombatBanner`.

```
┌─────────────────────────────────────────────┐
│ ⚔ Mira joins the fight — Round 2            │
│  Mira    14 +3 = 17  ← slots in at #2       │
└─────────────────────────────────────────────┘
```

### Character selection screen (`app/v2/setup/page.tsx`)
Add a new `bannerState: 'ally-in-combat'` for when the session has active combat but this character is NOT enrolled (not in the initiative order):

```
label: '⚔️  Ally in Battle — Flooded Passage'
cls: bg-orange-50 border-b border-orange-100 text-orange-700
```

Characters enrolled at the doorway (LoS auto-enroll) use the existing `battle-waiting` / `your-turn` states — they are in combat.

### "What did I miss" resume card
- `combatAlert` present AND `gameState === 'combat'` → show `CombatAlertResumeCard` (who is fighting, room, current round)
- `gameState !== 'combat'` → always show `ExplorationResumeCard`, regardless of log history

---

## Data / Logic Changes Required

### 1. `enterCombat` — enroll adjacent LoS allies
> ⚠️ **SUPERSEDED — see `PLAN-los-redesign-no-teleport.md` §2.** Skip conditions and the
> double-enrollment guard below remain valid; the "Move `roomParticipant`" step is replaced.
After enrolling same-room `roomParticipants`, scan all other session participants:
- Skip if character is at 0 HP
- Skip if character's current room is in `gameState: combat` (S7)
- Skip if character already appears in any active combat `initiativeOrder` in the session (double-enrollment guard)
- Check exits in character's current room for `peek_visibility: full` or `obvious_only` connecting to combat room
- If match:
  - `roomParticipant` is NOT moved — the character stays in their own room
  - Roll initiative, add to `initiativeOrder` with `remoteRoomInstanceId` = character's current room, `gridSlot` = exit's `grid_slot`, `proximity: 'far'`; preserve `isHiding` state
  - Two LoS exits to the same room → enroll once (first matching exit wins)
- `view-state.ts` populates `ViewStatePayload.remoteCombat` for this character on their own room's poll

### 2. On combat start — post `combat_alert`
Post once, shared. Targets all session participants not enrolled in initiative (not in same room, not auto-enrolled via LoS). Includes `roomName` and `fightingCharacters`.

### 4. `joinCombat(characterId, roomInstanceId)` — new function in `combat-engine.ts`
- Skip if character is at 0 HP
- Skip if character is already in this room's `initiativeOrder` (no-op)
- Skip if character appears in any other active combat `initiativeOrder` in the session (double-enrollment guard — same check as in `enterCombat`)
- Roll initiative: d20 + DEX modifier; tiebreak by DEX modifier value; further ties broken by second d20 roll
- Insert at correct position in `initiativeOrder`
- Post `join_combat` messageLog entry with roll data

### 5. Auto-join on `move_to_room` into combat room
In Phase 6 room entry: if destination room `gameState: combat` → call `joinCombat`. For hidden characters, run stealth check first (already done in Phase 6) — pass resolved `isHiding` into `joinCombat`.

### 6. `combatAlert` in `ViewStatePayload` and sessions API
- `view-state.ts`: populate `combatAlert` only when session has active combat AND character is NOT in `initiativeOrder`
- Sessions list API: surface `combatAlert` for the setup page banner

---

## Tests

### Unit: `joinCombat`
- [ ] Inserts character at correct initiative position (between two existing entries)
- [ ] Inserts at top when roll beats all existing entries
- [ ] Inserts at bottom when roll is lowest
- [ ] Tiebreak: higher DEX modifier wins; still tied → second d20 roll decides
- [ ] No-op if character already in `initiativeOrder`
- [ ] Skips and returns early if character is at 0 HP
- [ ] Posts `join_combat` messageLog entry with d20, modifier, total, and slot position

### Unit: LoS auto-enroll at combat start
- [ ] Character in adjacent room with `peek_visibility: full` exit is enrolled at combat start
- [ ] Character in adjacent room with `peek_visibility: obvious_only` exit is enrolled at combat start
- [ ] Character behind `peek_visibility: none` exit is NOT enrolled; receives `combatAlert`
- [ ] Character in non-adjacent room is NOT enrolled; receives `combatAlert`
- [ ] Character with 0 HP in adjacent LoS room is NOT enrolled
- [ ] Character whose current room is in `gameState: combat` is NOT enrolled (S7)
- [ ] Character already in any active combat `initiativeOrder` is NOT enrolled (double-enrollment guard)
- [ ] Enrolled LoS ally's initiative entry has `gridSlot` = exit's grid slot
- [ ] Enrolled LoS ally's `isHiding` state is preserved from their pre-combat value
- [ ] Two LoS exits to the same combat room → character enrolled exactly once (first matching exit)

### Unit: `roomParticipant` transfer for LoS allies (Option A)
⚠️ **SUPERSEDED — obsolete.** `roomParticipant` is never moved for LoS allies under
`PLAN-los-redesign-no-teleport.md` §2; the equivalent coverage is the remote-combat enrollment
test set added for that redesign (Task #9).

### Unit: `combatAlert` targeting
- [ ] `combatAlert` is posted only to characters NOT enrolled in `initiativeOrder`
- [ ] Enrolled LoS ally (roomParticipant moved to combat room) does NOT receive `combatAlert`
- [ ] Character in combat room does NOT receive `combatAlert`
- [ ] Character in adjacent room with closed door receives `combatAlert`
- [ ] Character in non-adjacent room receives `combatAlert`
- [ ] Character already in their own combat (S7) receives `combatAlert` but is not enrolled
- [ ] Solo player — no `combatAlert` posted, no LoS scan run

### Unit: double-enrollment guard
- [ ] `joinCombat` skips if character already in this room's `initiativeOrder`
- [ ] `joinCombat` skips if character already enrolled in a different room's active combat
- [ ] `enterCombat` LoS scan skips character already enrolled in any session combat
- [ ] Guard does not block a character who was in a now-ended combat (combat cleared from `combatState`)

### Unit: combat alert messageLog entry
- [ ] `combat_alert` entry is posted to messageLog when combat starts
- [ ] Entry includes `roomName` and `fightingCharacters`
- [ ] Entry is `isMechanicalEvent: true`

### Unit: initiative roll display for late joiners
- [ ] `join_combat` messageLog entry renders roll row (d20, modifier, total, position)
- [ ] Entry is attributed to the joining character

### Unit: tiebreaking
- [ ] Two characters with same initiative total — higher DEX modifier acts first
- [ ] Two characters with same initiative total and same DEX modifier — second d20 roll breaks tie
- [ ] Tiebreak applied consistently for both `enterCombat` (combat start) and `joinCombat` (late join)

### Integration: S1 — same room auto-join
- [ ] All `roomParticipants` join initiative when combat starts
- [ ] Hiding character in same room joins with `isHiding: true` preserved
- [ ] Downed (0 HP) character in same room is NOT enrolled in initiative
- [ ] Initiative order contains correct N characters + M enemies

### Integration: S2 — LoS ally auto-enroll
⚠️ **SUPERSEDED — see `PLAN-los-redesign-no-teleport.md` §2.** Replaced by the remote-combat
enrollment integration tests (Task #9): Player B's `roomParticipant` stays in their own room;
they're added to `initiativeOrder` with `remoteRoomInstanceId` set; `ViewStatePayload.remoteCombat`
(not `combatAlert`) is populated for Player B; hidden state and initiative roll are preserved as below.
- [ ] Player A triggers combat; player B in adjacent LoS room is in initiative order when combat starts
- [ ] Player B's initiative position reflects their d20 roll
- [ ] Player B with `isHiding: true` is enrolled hidden; enemies unaware of their position

### Integration: S3 — no LoS, manual entry
- [ ] `combatAlert` visible in messageLog for character in closed-door adjacent room
- [ ] Character moves to combat room; `joinCombat` fires; character in initiative order
- [ ] `join_combat` messageLog entry posted with roll details
- [ ] Character is not surprised on joining

### Integration: S4 — hidden ally sneaks into combat
- [ ] Hidden ally enters combat room; stealth check runs against each enemy's passive perception
- [ ] Stealth success: joins with `isHiding: true`; sneak attack chip available on first turn
- [ ] Stealth failure: joins with `isHiding: false`; no sneak attack chip
- [ ] Stealth roll posted to messageLog as `combat_roll` entry

### Integration: S5 — mid-combat join (rounds 2+)
- [ ] Character entering combat room in round 2 joins at correct initiative position
- [ ] Existing initiative order preserved; new entry inserted correctly
- [ ] `join_combat` messageLog entry posted
- [ ] Downed character cannot move to combat room (blocked at movement)

### Integration: S6 — reconnect mid-combat
- [ ] Character in combat room who was offline auto-joins on first action
- [ ] No duplicate initiative entries created
- [ ] If combat already ended on reconnect: `ExplorationResumeCard` shown, not `CombatAlertResumeCard`

### Integration: S7 — LoS ally already in own combat
- [ ] LoS ally whose room is in `gameState: combat` is NOT enrolled in the new combat
- [ ] LoS ally receives `combatAlert` for the new fight but is not added to its initiative
- [ ] The new combat's initiative order does not contain the already-fighting ally

### Integration: S8 — combat ends before ally arrives
- [ ] Character navigating toward combat room; combat ends before they arrive
- [ ] `joinCombat` is NOT called on room entry
- [ ] Room entry proceeds as normal exploration
- [ ] `combatAlert` absent from `ViewStatePayload` after combat ends
- [ ] On reconnect after combat ended: `ExplorationResumeCard` shown regardless of `combat_alert` log history

### UI: combat alert rendering
- [ ] `combat_alert` renders with red border/background matching `CombatBanner` palette
- [ ] Displays room name and fighting character names
- [ ] No action button rendered

### UI: character selection screen
- [ ] Enrolled LoS ally (doorway position) shows `battle-waiting` / `your-turn` banner — they are in combat
- [ ] Un-enrolled out-of-room character shows `ally-in-combat` orange banner
- [ ] `ally-in-combat` banner displays the room name
- [ ] Character in S7 (own combat + ally-in-combat) shows their own `battle-waiting` banner, not `ally-in-combat`

### UI: "what did I miss" resume card
- [ ] `gameState === 'combat'` + `combatAlert` present → `CombatAlertResumeCard` shown
- [ ] `gameState !== 'combat'` → `ExplorationResumeCard` shown, regardless of `combat_alert` in log
- [ ] `CombatAlertResumeCard` shows who is fighting, room name, current round
- [ ] Resume card dismissed on first player action

### Edge cases
- [ ] All party members in combat room — no `combatAlert` posted, no LoS scan needed
- [ ] All party members already enrolled via LoS — no `combatAlert` posted
- [ ] LoS ally has 0 HP — not enrolled, `roomParticipant` NOT moved, no `combatAlert`
- [ ] Two party members in different non-LoS rooms — each independently receives `combatAlert`
- [ ] Hidden LoS ally at combat start — `roomParticipant` moved to combat room; enrolled with `isHiding: true`; enemies unaware; sneak attack available on first turn
- [ ] LoS ally retreats from combat room mid-combat — `roomParticipant` moves back to their original room via normal `move_to_room`; stays enrolled in initiative until combat ends (known limitation)
- [ ] LoS ally enrolled (roomParticipant moved), then combat ends immediately — `roomParticipant` remains in combat room; they explore from there
- [ ] `combat_alert` messageLog entry persists after combat ends — treated as historical; does not trigger resume card
- [ ] Character already in a now-ended combat (cleared `combatState`) is not blocked by double-enrollment guard when new combat starts

---

## Known Gaps Against Strict 5E (out of scope this phase)
- **Player surprise**: 5E allows players to be surprised in an ambush. Current game only models enemy surprise (`isDormant`). Stating LoS allies as "not surprised" is consistent with existing behavior but not strictly correct for ambush scenarios.
- **Fleeing combat**: a character can Disengage and exit the room. They remain enrolled in initiative until combat ends. No special handling; enemies cannot target them across rooms.
- **Opportunity attacks on room exit**: when a character leaves a threatened square, enemies can use their reaction for an OA. Not currently modelled for room-exit movement.
- **Concurrent combats**: only one active combat per session. Two simultaneous room combats would require reworking `combatState` scoping. If triggered anyway, each room runs independently; the double-enrollment guard prevents a character appearing in both initiative orders; the LoS scan skips characters already in combat (S7). Degrades gracefully but is unsupported.
- **LoS ally room after combat**: when a LoS ally is auto-enrolled their `roomParticipant` moves to the combat room. If combat ends while they're there they remain in that room and explore from it. There is no automatic return to their original room.

---

## Additional Tests (from audit)

### Unit: `isMechanicalEvent` correctness
- [ ] `combat_alert` messageLog entry is created with `isMechanicalEvent: false` (not `true`)
- [ ] `join_combat` messageLog entry is created with `isMechanicalEvent: false`
- [ ] Both entry types appear in the narrative log returned by `prefetchViewStateData`

### Unit: cross-room `combat_alert` posting
- [ ] Two non-enrolled chars in different rooms each get a `combat_alert` posted to their respective `roomInstanceId`
- [ ] Two non-enrolled chars in the SAME non-combat room get exactly ONE `combat_alert` entry (not two)
- [ ] `combat_alert` is NOT posted to the combat room's message log

### Unit: `joinCombat` — `acted` flag for mid-round inserts
- [ ] Joiner whose initiative is LOWER than the current active actor: `acted: false` (can act this round)
- [ ] Joiner whose initiative is HIGHER than the current active actor (slot already passed): `acted: true` (acts next round)
- [ ] Joiner whose initiative equals the active actor's: tie-break logic determines `acted` value

### Unit: `enterCombat` session-scoped LoS scan
- [ ] `enterCombat` accepts `sessionId` (or session object) as second parameter — all call sites in `game-controller.ts` updated
- [ ] Dormant LoS ally (> 48h inactive) IS enrolled (dormancy only skips turns, not enrollment)
- [ ] LoS ally enrolled as dormant has `isDormant: true` in their `InitiativeEntry`
- [ ] `advanceTurn` skips dormant LoS ally's turn on their initiative slot

### Unit: hidden LoS ally in initiative entry
- [ ] Hidden LoS ally's `InitiativeEntry.status_effects` includes `'hiding'`
- [ ] `resolveEnemyTurn` uses disadvantage when attacking a hidden LoS ally (reads `playerIsHiding` from initiative context)
- [ ] Non-hidden LoS ally does NOT get `'hiding'` in `status_effects`

### Unit: double-enrollment guard implementation
- [ ] Guard fetches all `roomInstance` rows in session with `gameState: 'combat'`, scans `combatState.initiativeOrder` in JS
- [ ] Guard correctly handles `combatState` being null or malformed JSON
- [ ] Guard does not block a character whose previous session combat has `gameState: 'exploration'` (cleared)

### Unit: `ViewStatePayload.combatAlert` field
- [ ] `ViewStatePayload` type includes `combatAlert: { roomName: string; fightingCharacters: string[]; round: number } | null`
- [ ] `view-state.ts` populates `combatAlert` when session has active combat AND character is NOT in any `initiativeOrder`
- [ ] `view-state.ts` sets `combatAlert: null` when combat ends (room `gameState !== 'combat'`)
- [ ] `view-state.ts` sets `combatAlert: null` for a character who IS enrolled (they get combat UI, not the alert)

### Unit: client room redirect after LoS auto-enroll
⚠️ **SUPERSEDED — obsolete.** `redirectRoomInstanceId` was removed; LoS allies are never
physically moved, so there's no room to redirect to. See `ViewStatePayload.remoteCombat`
coverage in the remote-combat tests (Task #9).

### Unit: `characters` API — `isEnrolledInCombat` and `activeCombatRoomName`
- [ ] `characters` route returns `isEnrolledInCombat: true` when character appears in any session room's `initiativeOrder`
- [ ] `characters` route returns `isEnrolledInCombat: false` when session has combat but char is not enrolled
- [ ] `characters` route returns `activeCombatRoomName: string` (the combat room name) when `isEnrolledInCombat: false`
- [ ] `characters` route resolves `currentRoomName` from the roomInstance where THIS character has a participant, not `roomInstances[0]`

### Integration: setup page banner differentiation
- [ ] Enrolled LoS ally shows `battle-waiting` or `your-turn` (not `ally-in-combat`)
- [ ] Un-enrolled char with `isEnrolledInCombat: false` shows `ally-in-combat` with correct room name
- [ ] After character manually joins (S3/S5), banner updates to `battle-waiting` on next poll

### Integration: map adjacentRoomPreviews after auto-enroll
- [ ] Before auto-enroll: room A's adjacent preview shows LoS ally in room B
- [ ] After auto-enroll: room A's adjacent preview no longer shows the ally (they have moved to combat room)
- [ ] Combat room's participants list includes the auto-enrolled ally at doorway grid slot

### Integration: LoS auto-enrolled ally opportunity attacks on exit
- [ ] LoS ally at doorway grid slot who moves out of combat room via `move_to_room` triggers `resolveOpportunityAttacks`
- [ ] OA roll is posted to the combat room's message log
- [ ] After exiting, ally remains in `initiativeOrder` (known gap — stays enrolled until combat ends)

### Integration: S6 reconnect — no duplicate initiative entry
- [ ] Character was in combat room, went offline, reconnects and submits an action
- [ ] `joinCombat` is called but the no-op guard (already in `initiativeOrder`) prevents a duplicate entry
- [ ] Exactly one entry for the character exists in `initiativeOrder` after reconnect

### Integration: `combat_alert` persists but does not trigger resume card after combat ends
- [ ] Session combat ends; `combat_alert` still visible in message log history (historical entry)
- [ ] On next poll: `ViewStatePayload.combatAlert === null` (combat over)
- [ ] `ExplorationResumeCard` shown — not `CombatAlertResumeCard` — even if `combat_alert` is in log history
