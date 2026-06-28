# Plan: Heroic Sacrifice & Character Continuity

## Design Goals

Players are never permanently sidelined from the campaign. When a character reaches 3 failed
death saving throws the game acknowledges the moment with narrative weight, immediately begins
preparing the player's replacement, and reunites the full party as soon as the encounter ends.
No split narratives. No inactive lobby wait. No mechanical punishment beyond the narrative loss.

---

## Core Principles

- Death saves auto-roll server-side on the downed character's initiative turn — no player input required
- 3 failures → `heroic_sacrifice` pushed to `pendingChoicesQueue`; `isDead` is NOT set yet
- The fallen character's slot is skipped in initiative going forward (treated like stabilized)
- Combat resolves independently — other players are never blocked on the death popup
- New character joins during exploration at the same level as the fallen character
- Arrival narrative is woven into the AI response on the **new character's first action**

---

## State Machine

```
hp = 0, in combat
  │
  ├─ each turn (auto-resolved server-side, no player input)
  │     roll d20
  │     nat 20 → revive (hp = 1, cleared from downed state, back in combat)
  │     nat 1  → +2 failures
  │     10+    → +1 success; 3 successes → stabilized (skipped forever, alive)
  │     2-9    → +1 failure
  │
  └─ 3rd failure accumulated (any source: own roll or enemy attack auto-fail)
        → push { type: 'heroic_sacrifice', fallenName, fallenClass, fallenLevel } to pendingChoicesQueue
        → write public MessageLog entry: fallen narrative (all players see)
        → set isStabilized = true on initiative entry (skip slot going forward)
        → DO NOT set isDead: true yet (player must confirm)
        → combat continues unblocked

Player confirms popup (client-side)
  → isDead: true written to DB
  → pendingChoicesQueue entry cleared
  → redirect to character creation at fallenLevel

New character created & joins session (exploration phase, any time)
  → standard session join flow
  → write { pendingArrivalContext: { fallenName, fallenClass, recentContext } }
    onto the new Character row (not RoomInstance — survives room transitions)
  → public MessageLog entry: "[NewName] is on their way..."  (brief, non-specific)

New character's FIRST action in the session
  → pendingArrivalContext claimed atomically from Character row (UPDATE...RETURNING)
  → AI crafts arrival story connecting old and new character thematically
  → pendingArrivalContext is NULL after the atomic claim; subsequent actions unaffected
```

---

## Auto-Resolve Death Saves (server-side)

Death saves must not require a player action. The existing enemy auto-resolve pattern is the
model: after `end_turn` resolves all enemy turns, a parallel path handles downed characters.

**Breaking change — remove existing handler first:** `game-controller.ts` lines 432–437
currently handle `deathSaveFailures >= 3` by immediately setting `isDead: true` and removing
the character from the initiative order. This must be deleted before Phase 2 code ships. The
new flow replaces it entirely with the `pendingChoicesQueue` push described below.

**Where it fires:** The auto-resolve logic lives in a new `resolveDownedCharacterTurn`
function in `combat-engine.ts` (alongside `resolveDeathSave` which already lives there).
`game-controller.ts` calls it from the `while` loop — it does not embed the logic inline.
This keeps combat resolution concerns out of the controller.

```typescript
// combat-engine.ts — new export
export function resolveDownedCharacterTurn(
  entry: InitiativeEntry,
  workingCs: CombatState,
): { updatedCs: CombatState; characterDied: boolean; rollLog: RollLogEntry } {
  const dsResult = resolveDeathSave(entry, entry.name);
  const updatedEntry = applyDeathSaveResult(entry, dsResult);
  const updatedCs = {
    ...workingCs,
    initiativeOrder: workingCs.initiativeOrder.map(e => e.id === entry.id ? updatedEntry : e),
  };
  return {
    updatedCs: advanceTurn(updatedCs),
    characterDied: dsResult.characterDied ?? false,
    rollLog: dsResult.rollLog,
  };
}
```

**Concretely:** In the `while (true)` turn-resolution loop (game-controller.ts ~line 373),
the break condition changes from "break on character" to "break on non-downed character":

```typescript
while (true) {
  const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
  if (!activeEntry) break;

  // Non-downed character: hand control back to the player
  if (activeEntry.type === 'character' && activeEntry.hp > 0) break;

  // Downed character: auto-resolve death save via combat-engine helper
  if (activeEntry.type === 'character' && activeEntry.hp <= 0 && !activeEntry.isStabilized) {
    const { updatedCs, characterDied } = resolveDownedCharacterTurn(activeEntry, workingCs);
    workingCs = updatedCs;
    if (characterDied) {
      // heroic_sacrifice push and pendingChoicesQueue write happen here (see §Heroic Sacrifice Trigger)
      // combatState is written atomically alongside the pendingChoicesQueue update (single $transaction)
    }
    continue;
  }

  // Enemy: existing enemy turn resolution
  // ...
}
```

**Crash recovery:** If the server crashes after `resolveDownedCharacterTurn` runs but before
`combatState` is written, `activeActorId` still points to the downed character. On the next
request, the while loop detects the downed character again and re-resolves. To prevent a
double-revive on a natural 20, `resolveDownedCharacterTurn` must check whether the entry
already has a non-zero `deathSaveSuccesses` or `deathSaveFailures` that are inconsistent with
a first-roll result before applying. Simpler alternative: write `combatState` atomically in the
same `$transaction` as any character-level updates (HP, pendingChoicesQueue) so the two states
never diverge.

The death save roll badge is written to MessageLog the same way enemy attack rolls are — a
`combat_roll` entry with `action: 'Death Save'` (already implemented in combat-engine.ts).

---

## Heroic Sacrifice Trigger (3rd failure)

When `resolveDeathSave` returns `characterDied: true` OR accumulated `deathSaveFailures >= 3`:

```typescript
// 1. Push to pendingChoicesQueue (private — only this character's client sees it)
await prisma.character.update({
  where: { id: characterId },
  data: {
    pendingChoicesQueue: {
      push: {
        type: 'heroic_sacrifice',
        fallenName: character.name,
        fallenClass: character.characterClass,
        fallenLevel: character.level,
      },
    },
  },
});

// 2. Public log entry (all players see this)
await prisma.messageLog.create({
  data: {
    roomInstanceId: combatRoomId,
    characterId,
    isMechanicalEvent: false,
    mechanicalSummary: { type: 'heroic_sacrifice', characterName: character.name },
    text: `[FALLEN] ${character.name} has fallen. The party has a sneaking suspicion they haven't seen the last of ${character.name}'s story...`,
  },
});

// 3. Mark stabilized so advanceTurn skips the slot
workingCs = {
  ...workingCs,
  initiativeOrder: workingCs.initiativeOrder.map(e =>
    e.id === characterId ? { ...e, isStabilized: true } : e
  ),
};
// Do NOT set isDead: true here — player must confirm via popup
```

---

## Popup → Character Creation

The client already polls `pendingChoicesQueue` and surfaces modal popups (level-up, ASI).
`heroic_sacrifice` follows the same pattern.

**Type change required before any client code ships:** `PendingLevelUpChoice` in
`types/v2-game.ts` is currently `{ type: 'asi' | 'subclass'; level: number }`. It must be
widened to a discriminated union:

```typescript
export type PendingChoice =
  | { type: 'asi'; level: number }
  | { type: 'subclass'; level: number }
  | { type: 'heroic_sacrifice'; fallenName: string; fallenClass: string; fallenLevel: number };

// Replace PendingLevelUpChoice with PendingChoice everywhere:
// - CharacterStats.pendingChoicesQueue: PendingChoice[]
// - any client switch/narrowing on pendingChoicesQueue entries
```

All existing `switch (choice.type)` handlers should add an `'heroic_sacrifice'` case; the
existing `default` or unhandled branch would otherwise silently ignore the entry.

**Popup content:**
```
[Character portrait faded]
[Name] has fallen in battle.

Their story will be remembered.

Your adventure continues — build your next character
at level [N] and rejoin the party when they reach safety.

[ Begin Character Creation ]
```

On confirm:
- Client calls a new endpoint: `POST /api/v2/me/characters/[id]/confirm-sacrifice`
- Server sets `isDead: true`, clears the `heroic_sacrifice` queue entry
- Client redirects to character creation with `?level=N&sessionId=X` pre-filled

**Character creation constraint:** New character is created at `fallenLevel`. The setup page
enforces this — level selector is locked if arriving via the sacrifice redirect.

---

## Old Character Fate (after `isDead: true`)

When `confirm-sacrifice` fires, three writes happen atomically in a `$transaction`:

1. `isDead: true` is set on the fallen character record — permanent, never cleared.
2. All `RoomParticipant` rows for this character in this session are set `isActive = false`. They no longer appear in the live party, cannot take actions, and are excluded from party member API responses (all queries filter `WHERE isActive = true`).
3. The `heroic_sacrifice` entry is removed from `pendingChoicesQueue`.

Their character record is **retained indefinitely** as a historical artifact. On the setup page's
character list, they appear with a skull icon, name in italic, and no CTA button — visible as a
memorial but unselectable.

The net effect: from the DB's perspective, the slot in the session is now empty. The new character fills it when they join.

Note: there is no `activeSession` field on `Character` and none is added. A character that is
`isDead: true` is naturally excluded from all active flows by the existing `isDead` gate.

---

## New Character Join (Exploration Phase)

**Why enrollment cannot happen in the room state API:**
- `GET /api/v2/room/state` has no authentication — any caller can read it.
- It performs no writes, so it cannot create `RoomParticipant` rows or set `pendingArrivalContext`.
- Enrolling inside a read endpoint would let any player join any session by URL-editing.

**The correct flow:** the client calls a new authenticated endpoint **before** navigating to play. Navigation only happens after a successful 200.

```
POST /api/v2/sessions/[sessionId]/join
Body: { characterId: string, predecessorCharacterId: string }
```

`predecessorCharacterId` is the ID of the fallen character. The client already has it from the
`heroic_sacrifice` queue entry returned by `confirm-sacrifice`. It is required — the server
uses it as the authoritative anchor for authorization and for reading the fallen character's
name/class without relying on a heuristic search.

**Authorization checks (in order):**

1. User must be authenticated (`supabase.auth.getUser()`).
2. `newCharacter.userId === user.id` — the new character belongs to the calling user.
3. `newCharacter.isDead === false` — new character must be alive.
4. `predecessorCharacter.userId === user.id` AND `predecessorCharacter.isDead === true` — the named predecessor belongs to this user and is confirmed dead. Rejects with 403 otherwise.
5. A `RoomParticipant` linking `predecessorCharacterId` to a room in this session must exist — proves the predecessor was actually in this session, not plucked from another campaign.
6. Session `gameState` must be `'active'` (not lobby, not ended).
7. Party must not be full (≤ 3 existing active participants).

**Resolving `currentPartyRoomId`:** the join endpoint determines which room to enroll the new
character into by finding the room in this session with the most recent participant activity:

```typescript
const currentRoom = await prisma.roomInstance.findFirst({
  where: { sessionId },
  orderBy: { participants: { _count: 'desc' } }, // most occupied room
  select: { id: true },
});
// Fallback: if tied, use latest MessageLog createdAt across the session's rooms.
```

This works correctly for normal play (party together) and degrades gracefully for split parties
(new character joins the majority room). The new character sees the catch-up card regardless.

**On success, three things written atomically:**

```typescript
const recentMessages = await prisma.messageLog.findMany({
  where: { roomInstanceId: currentPartyRoomId, isMechanicalEvent: false },
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { text: true },
});
const recentContext = recentMessages
  .reverse()
  .map(m => m.text.substring(0, 200))  // cap per-message to prevent unbounded JSON
  .join(' / ')
  .substring(0, 800);                  // hard cap on total stored

await prisma.$transaction([
  // 1. Enroll new character in the party's current room
  prisma.roomParticipant.create({
    data: { roomInstanceId: currentPartyRoomId, characterId: newCharacter.id },
  }),

  // 2. pendingArrivalContext on the Character row — travels with the character, not the room
  prisma.character.update({
    where: { id: newCharacter.id },
    data: {
      pendingArrivalContext: {
        fallenName: predecessorCharacter.name,
        fallenClass: predecessorCharacter.characterClass,
        recentContext,
      },
    },
  }),

  // 3. Public log entry
  prisma.messageLog.create({
    data: {
      roomInstanceId: currentPartyRoomId,
      isMechanicalEvent: false,
      mechanicalSummary: { type: 'character_incoming', characterName: newCharacter.name },
      text: `[PARTY] ${newCharacter.name} is making their way to the group...`,
    },
  }),
]);
```

Returns `{ ok: true }`. Client then navigates to `/v2/play?session=X&char=newCharId`.

A stranger who edits the URL and calls this endpoint fails check 4 — they have no dead predecessor — and gets a 403 before any writes occur.

**Why `pendingArrivalContext` lives on `Character`, not `RoomInstance`:**
If the party moves to a different room before the new character takes their first action, a
flag on `RoomInstance` would be in the wrong room and never fire. A flag on `Character` travels
with the character regardless of which room they are in when they act. The check in
`generateAndPersistNarrative` becomes `character.pendingArrivalContext !== null` instead of a
room field lookup — simpler and correct across room transitions.

---

## Arrival Narrative (New Character's First Action)

`pendingArrivalContext` is a nullable `Json` column on `Character` (not `RoomInstance`).
It travels with the character across room changes. The check and clear in
`generateAndPersistNarrative` uses the character record that is already loaded for the
action — no extra room join needed.

In `generateAndPersistNarrative`, the check uses an atomic claim — the clear and the read
happen in the same DB operation so a concurrent retry cannot claim the flag twice:

```typescript
// Atomic claim: set to NULL only if this character's flag is still set.
// Returns the old value; null means another request already claimed it.
// Operates on Character (not RoomInstance) — the flag travels with the character.
const claimed = await prisma.$queryRaw<{ pendingArrivalContext: unknown }[]>`
  UPDATE "Character"
  SET    "pendingArrivalContext" = NULL
  WHERE  id = ${characterId}
    AND  "pendingArrivalContext" IS NOT NULL
  RETURNING "pendingArrivalContext"
`;

if (claimed.length > 0) {
  const arrival = claimed[0].pendingArrivalContext as ArrivalContext;
  extraContext = `
A new companion, ${arrival.newName} (${arrival.newClass}), is joining the party for the
first time. Weave their arrival naturally into the narrative. Draw a subtle thematic
connection to ${arrival.fallenName} (${arrival.fallenClass}) who fell in the recent battle —
perhaps a shared marking, a rumor heard on the road, or a curious resemblance. Do not be
heavy-handed. Let the story breathe.

Recent party activity (for continuity — do not contradict this):
${arrival.recentContext}
  `.trim();
}
```

The raw `UPDATE ... RETURNING` is the only safe pattern here. A separate read-then-write
(read the flag, generate narrative, then clear) has a TOCTOU window: a network retry or
duplicate request could read the flag concurrently and fire the arrival narrative twice.
The atomic claim eliminates that window entirely.

---

## Schema Changes

Three migrations needed (not one):

```prisma
model Character {
  // pendingChoicesQueue already exists — no new column, but entries now include heroic_sacrifice shape
  // isDead already exists — no change needed
  pendingArrivalContext Json?   // set on session join, cleared atomically on first narrative action
  // activeSession does NOT exist on Character and is NOT added — the "de-enroll" step is handled
  // by the RoomParticipant row, not a flag on Character (see Old Character Fate below)
}

model RoomParticipant {
  // existing fields unchanged
  isActive  Boolean  @default(true)  // false = fallen character, slot is empty for replacement
}
```

SQL:
```sql
ALTER TABLE "Character" ADD COLUMN "pendingArrivalContext" jsonb;
ALTER TABLE "RoomParticipant" ADD COLUMN "isActive" boolean NOT NULL DEFAULT true;
```

`RoomInstance.pendingArrivalNarrative` is **not** added — the flag lives on `Character`
instead (see New Character Join for rationale).

**De-enrolling the fallen character** (confirm-sacrifice): set `isActive = false` on the
fallen character's `RoomParticipant` rows for this session (there may be multiple if the
character moved rooms). All party-member queries must add `WHERE isActive = true`. The
character record itself is retained as a historical artifact.

---

## New API Endpoints

**`POST /api/v2/me/characters/[id]/confirm-sacrifice`**

Atomic `$transaction`:
1. Verify `pendingChoicesQueue` contains `heroic_sacrifice` for this character — return **409 Conflict** if not (already confirmed or never triggered; 403 would imply an auth failure which is misleading)
2. Set `isDead: true`
3. Remove the `heroic_sacrifice` entry from `pendingChoicesQueue`
4. Set `isActive = false` on all `RoomParticipant` rows for this character in the session

Returns `{ ok: true, redirectLevel: number, sessionId: string, predecessorCharacterId: string }`.

`predecessorCharacterId` is the fallen character's own ID — passed to the client so it can
include it in the subsequent `POST /api/v2/me/characters` and `POST /api/v2/sessions/.../join`
calls as the validation anchor.

**`POST /api/v2/sessions/[sessionId]/join`**

See New Character Join section. Returns `{ ok: true }`.

**`GET /api/v2/room/state` change:** must filter `RoomParticipant` with `isActive = true` so
fallen characters no longer appear in `partyMembers`.

---

## Implementation Phases

### Phase 0 — Breaking change removal (must be first)
- Delete `game-controller.ts` lines 432–437 (the existing `isDead: true` setter triggered by `deathSaveFailures >= 3` from enemy attacks). Nothing replaces it yet — Phase 2 is the replacement. Tests will catch any regression.

### Phase 1 — Auto-resolve death saves (no player input)
- Add `resolveDownedCharacterTurn` to `combat-engine.ts` (new export; calls existing `resolveDeathSave`)
- Modify end_turn while-loop in `game-controller.ts` to call `resolveDownedCharacterTurn` for downed characters; do not embed logic inline
- Remove Death Save chip from ActionChips (already present; just stop showing it)
- Console log on every auto-resolve for debugging: `[stage3:death-save:auto]`

### Phase 2 — Heroic sacrifice trigger
- Widen `PendingLevelUpChoice` → `PendingChoice` discriminated union in `types/v2-game.ts`; update all callsites
- On 3rd failure: push `heroic_sacrifice` to `pendingChoicesQueue`; write public fallen MessageLog entry; set `isStabilized: true` on initiative entry — all in a single `$transaction` alongside the `combatState` write
- Add `confirm-sacrifice` API endpoint (returns `predecessorCharacterId`; uses 409 not 403 for already-confirmed)
- `confirm-sacrifice` sets `isDead: true`, clears queue entry, sets `isActive = false` on `RoomParticipant` rows — atomically

### Phase 3 — Client popup + character creation
- Handle `heroic_sacrifice` in pending choice renderer
- Confirm → call `confirm-sacrifice` endpoint → redirect to `/v2/setup?fromSacrifice=true&level=N&sessionId=X&fallenName=Y&predecessorId=P`
- Add `lockedLevel` prop to `CharCreationForm`; pass `startingLevel` and `predecessorCharacterId` in the create-character body
- Setup page: detect `fromSacrifice=true`, skip character/session picker, show context banner above form
- After creation, navigate directly to `/v2/play?session=X&char=newCharId` (no session picker)
- `POST /api/v2/me/characters`: accept `startingLevel` + `predecessorCharacterId`; validate `targetLevel === predecessor.level`

### Phase 4 — Arrival narrative
- Schema migrations: `pendingArrivalContext Json?` on `Character`; `isActive Boolean @default(true)` on `RoomParticipant` (two migrations)
- Update all `RoomParticipant` queries to filter `isActive: true` (room state API, party member queries)
- New endpoint: `POST /api/v2/sessions/[sessionId]/join` with `predecessorCharacterId` in body (see auth checks above); resolves `currentPartyRoomId` via most-occupied room query
- Client calls join endpoint after character creation, before navigating to play
- In `generateAndPersistNarrative`: atomic `UPDATE ... WHERE pendingArrivalContext IS NOT NULL RETURNING` claim; inject context from returned row; no separate clear needed

---

## UI & Narrative Details

### 1. Death Save Roll Narrative

Every auto-resolved death save writes two MessageLog entries:

1. A `combat_roll` badge (existing `isMechanicalEvent: true` pattern) — shows the d20 number, `vsTarget: 'DC 10'`, `isCrit` on a natural 20.
2. A short `isMechanicalEvent: false` narrative sentence scoped to the outcome:

| Outcome | Text |
|---|---|
| Natural 20 | `"[Name] surges back from the brink, eyes snapping open — alive!"` |
| Natural 1 | `"[Name] slips further into darkness — two steps closer to the end."` |
| 10+ (success, not 3rd) | `"[Name] holds on by sheer will. (Death Save: success)"` |
| 3rd success (stabilized) | `"[Name]'s breathing steadies. They are stable — unconscious but no longer dying."` |
| 2–9 (failure, not 3rd) | `"[Name]'s grip on consciousness weakens. (Death Save: failure)"` |
| 3rd failure | `"[Name] has fought their last battle. The light fades."` (followed immediately by the heroic sacrifice log entry) |

The narrative entry uses the same `characterId` as the fallen character and is public (visible to all players).

---

### 2. Can Enemies Attack a Downed Character?

Yes — per 5E, enemies can attack downed characters. Each hit is an automatic death save failure; a critical hit counts as two failures. The AI is free to have enemies do this (a finishing blow is narratively valid).

**Mechanically:** the existing `resolveCombatAction` path already writes `deathSaveFailures += 1` when an attack hits a target with `hp ≤ 0`. That path already checks for `>= 3` failures and triggers the sacrifice. No change needed to enemy targeting logic — enemies can target any character regardless of `hp`.

**Design note for the AI prompt:** no special instruction is needed. The DM AI will decide whether an enemy strikes a downed character based on narrative context (a cruel enemy might; a distracted one might not).

---

### 3. Death Save Tracker UI — Lo-fi Mocks

The bottom action bar (where chips normally live) is replaced by a **Death Save Panel** whenever the current character is downed. The initiative strip at the top stays visible — other players' turns still animate. The chat log still scrolls above.

---

#### A. First moment at 0 HP (no rolls yet)

The panel replaces the chip row the instant `hp` reaches 0. Goal text is prominent and persistent.

```
┌─────────────────────────────────────────────┐
│  chat log / narrative scrolls here          │
│  ...                                        │
│  > Goblin attacks Mira for 8 damage.        │
│  > Mira drops to 0 HP and falls unconscious │
└─────────────────────────────────────────────┘

══════════ INITIATIVE STRIP (unchanged) ═══════

┌─────────────────────────────────────────────┐
│  Mira is unconscious                        │
│                                             │
│  Rolls happen automatically on your turn.   │
│                                             │
│  SURVIVE           FALL                     │
│  3 successes   vs  3 failures               │
│  ─────────────────────────────────          │
│  Successes  ○  ○  ○                         │
│  Failures   ○  ○  ○                         │
│                                             │
│  3 failures → your story ends here          │
│  3 successes → you stabilize and survive    │
└─────────────────────────────────────────────┘
```

---

#### B. After 1st success (roll ≥ 10)

One green circle fills. Goal lines update with remaining count. No indicator yet — one roll proves nothing.

```
┌─────────────────────────────────────────────┐
│  > Mira's Death Save: 13 — Success          │
│  > Mira holds on by sheer will.             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Mira is unconscious                        │
│                                             │
│  SURVIVE           FALL                     │
│  2 more to survive    3 failures            │
│  ─────────────────────────────────          │
│  Successes  ●  ○  ○      ← green           │
│  Failures   ○  ○  ○                         │
│                                             │
│  3 failures → your story ends here          │
└─────────────────────────────────────────────┘
```

---

#### C. After 1st failure (roll 2–9)

One red circle fills. Warning copy appears — but one failure is survivable, so the tone stays tense not terminal.

```
┌─────────────────────────────────────────────┐
│  > Mira's Death Save: 6 — Failure           │
│  > Mira's grip on consciousness weakens.    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Mira is unconscious                        │
│                                             │
│  SURVIVE           FALL                     │
│  3 successes    2 more failures = death     │
│  ─────────────────────────────────          │
│  Successes  ○  ○  ○                         │
│  Failures   ●  ○  ○      ← red             │
│                                             │
│  3 failures → your story ends here          │
└─────────────────────────────────────────────┘
```

---

#### D. Mixed state — 1 success, 1 failure

**It is 3 total, not 3 in a row.** Successes and failures accumulate independently. This state shows both trackers partially filled — the most common scenario.

```
┌─────────────────────────────────────────────┐
│  > Mira's Death Save: 7 — Failure           │
│  > Mira's grip on consciousness weakens.    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Mira is unconscious                        │
│                                             │
│  SURVIVE           FALL                     │
│  2 more to survive    2 more = death        │
│  ─────────────────────────────────          │
│  Successes  ●  ○  ○      ← green           │
│  Failures   ●  ○  ○      ← red             │
│                                             │
│  3 failures → your story ends here          │
└─────────────────────────────────────────────┘
```

Both rows fill independently. Neither being ahead of the other changes anything until one reaches 3.

---

#### E. High danger: 2 failures, 1 success

Red pulses. Outcome indicator turns explicit — one more failure is fatal regardless of successes so far.

```
┌─────────────────────────────────────────────┐
│  > Mira's Death Save: 4 — Failure           │
│  > Mira slips further into darkness.        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐  ← panel border pulses red
│  Mira is unconscious                        │
│                                             │
│  SURVIVE           FALL                     │
│  2 more to survive  ! 1 more = death        │
│  ─────────────────────────────────          │
│  Successes  ●  ○  ○      ← green           │
│  Failures   ●  ●  ○      ← red             │
│                                             │
│  ⚠ One more failure and Mira falls for good │
└─────────────────────────────────────────────┘
```

Note: 1 success doesn't neutralise a failure. The rows are independent counters racing to 3.

---

#### F. 3 successes — Stabilized

All success circles fill green. Failures grey out. Tracker locks with a calm resolution message. No more rolls.

```
┌─────────────────────────────────────────────┐
│  > Mira's Death Save: 15 — Success          │
│  > Mira's breathing steadies. Stable.       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐  ← panel border goes green
│  Mira is stable                             │
│                                             │
│  Successes  ●  ●  ●      ← green           │
│  Failures   ○  ○  ○      ← greyed out      │
│                                             │
│  You're unconscious but out of danger.      │
│  You'll recover HP when combat ends.        │
│                                             │
│  Waiting for combat to resolve...           │
└─────────────────────────────────────────────┘
```

After combat ends, the character wakes up with 1 HP and the tracker is removed. Normal play resumes.

---

#### G. 3 failures — Heroic Sacrifice Modal → Persistent Strip

The 3rd failure circle fills red. After a 1-second pause the tracker fades and the full-screen modal appears. The player can dismiss it — after dismissal it collapses into the **existing red pending-choice strip** (same component as the amber ASI strip, different colour) so the call-to-action is always reachable without occupying screen real estate.

**Full-screen modal (appears once on 3rd failure):**

```
     [chat log fades / darkens behind overlay]

╔═════════════════════════════════════════════╗
║                                             ║
║          [Mira portrait — greyscale]        ║
║                                             ║
║             Mira has fallen.                ║
║                                             ║
║   Successes  ○  ○  ○                        ║
║   Failures   ●  ●  ●   ← red, locked        ║
║                                             ║
║  ─────────────────────────────────────────  ║
║                                             ║
║   Their story will be remembered by all     ║
║   who stood beside them.                   ║
║                                             ║
║   Your adventure continues. Create a new   ║
║   character at level 3 and rejoin the      ║
║   party when they reach safety.            ║
║                                             ║
║   ┌─────────────────────────────────────┐  ║
║   │      Begin Character Creation       │  ║
║   └─────────────────────────────────────┘  ║
║                                             ║
║              [ Watch combat ]               ║  ← dismisses modal
╚═════════════════════════════════════════════╝
```

**After "Watch combat" — persistent red strip (same slot as amber ASI strip):**

```
┌─────────────────────────────────────────────┐
│  Mira has fallen — begin your next chapter  │
│                                   [ Go ] ×  │
└─────────────────────────────────────────────┘
```

- `[ Go ]` reopens the full modal.
- `×` collapses to a 4px red rule (same as the amber strip collapse), and re-expands on tap.
- Persists across page reloads until "Begin Character Creation" is tapped and the `heroic_sacrifice` queue entry is cleared.

---

### 4. UI on 3rd Failure (the Heroic Sacrifice Moment)

When the 3rd failure is written to the DB and `heroic_sacrifice` enters `pendingChoicesQueue`:

1. The death save tracker fills the 3rd failure circle in red.
2. After a 1-second pause (CSS delay, not a timer), the tracker fades out and the **Heroic Sacrifice modal** fades in over a dimmed screen.
3. The character portrait in the modal is desaturated (CSS `filter: grayscale(100%)`).

**Modal content:**
```
[Character portrait, greyscale, faded to 60% opacity]

[Name] has fallen.

Their story will be remembered by all who stood
beside them.

Your adventure continues — create your next character
at level [N] and rejoin the party when they reach safety.

                [ Begin Character Creation ]
```

A "Watch combat" link dismisses the modal and collapses it to the persistent red strip (same component as the amber pending-choice strip). The strip has a `[ Go ]` button to reopen the modal and a `×` to collapse it to a 4px red rule. It persists across page reloads until confirmed.

---

### 5. Character Creation and Session Join Flow

**Does it reuse the existing flow or copy it?**

It reuses the existing `CharCreationForm` component directly — no copy. But the existing form and API are both level-1-only and need concrete changes to support higher starting levels. The gaps are:

| Gap | Current state | Fix |
|---|---|---|
| HP | `maxHp = hitDie + conMod` (level 1 only) | Call `maxHpAtLevel(class, con, N)` |
| Level / XP | Always creates at level 1 | Set `level = N`, `xp = XP_THRESHOLDS[N-1]` |
| Class features | None applied | Call `applyLevelEffects` for levels 2..N in the create transaction |
| Resource pools | None created | Handled inside `applyLevelEffects` — covered |
| **Subclass** | Only shown for Cleric/Sorcerer/Warlock (L1 subclass classes) | Show for all classes when `lockedLevel >= subclassLevel` — see below |
| **ASI** | Not handled at creation | Queue `{ type: 'asi', level: N }` entries via `applyLevelEffects` — resolved in-session |

**Subclass selection during creation:**

`subclassLevelForClass` in `xp-helpers.ts` defines when each class gets their subclass:
- Level 1: Cleric, Sorcerer, Warlock
- Level 2: Wizard, Druid
- Level 3: everyone else (Fighter, Rogue, Paladin, Ranger, Monk, Barbarian, Bard, Artificer)

When `lockedLevel >= subclassLevelForClass(class)`, subclass selection must happen during character creation — not deferred to `pendingChoicesQueue`. Arriving in-session as a Fighter with no Martial Archetype is confusing and incomplete. The existing subclass overlay UI already works for L1 classes; it just needs to be gated on `lockedLevel >= subclassLevel` instead of `L1_SUBCLASS_CLASSES.includes(class)`.

When the player picks a non-L1 class in the sacrifice flow at level 3:
- The class grid renders normally
- The class detail overlay appears normally
- At the bottom, instead of `"Subclass chosen at level 3 (in-game)"`, it shows the subclass carousel (same component already used for Cleric/Sorcerer/Warlock)
- The selected subclass is passed to `POST /api/v2/me/characters` as `subclassKey`

**ASI deferred to in-session resolution:**

ASI choices (level 4, 8, etc.) are queued as `{ type: 'asi', level: N }` entries in `pendingChoicesQueue` by `applyLevelEffects`, identical to how they're added when a character levels up normally. The player resolves them in the party tab after joining. This is acceptable — stats are already set via point-buy; the ASI just improves two of them.

A character joining at level 8 with two unresolved ASIs will see the amber pending-choice strip immediately on joining. That's correct behaviour.

**`POST /api/v2/me/characters` changes:**

```typescript
// New fields accepted in body
const { ..., subclassKey, startingLevel, predecessorCharacterId } = await req.json();
const targetLevel = (typeof startingLevel === 'number' && startingLevel >= 1) ? startingLevel : 1;

// Validate startingLevel against the sacrificed character's fallenLevel.
// predecessorCharacterId is the authoritative anchor — without it the server
// has no way to know which fallen character's level to enforce.
if (predecessorCharacterId) {
  const predecessor = await prisma.character.findUnique({
    where: { id: predecessorCharacterId },
    select: { userId: true, isDead: true, pendingChoicesQueue: true },
  });
  if (!predecessor || predecessor.userId !== user.id || !predecessor.isDead) {
    return Response.json({ error: 'Invalid predecessor' }, { status: 403 });
  }
  const sacrificeEntry = (predecessor.pendingChoicesQueue as PendingChoice[])
    .find(c => c.type === 'heroic_sacrifice');
  // After confirm-sacrifice fires, the queue entry is cleared. We instead rely on isDead:true
  // and the level stored on the predecessor character itself.
  const fallenLevel = predecessor.level; // source of truth after queue is cleared
  if (targetLevel !== fallenLevel) {
    return Response.json({ error: 'startingLevel must match fallen character level' }, { status: 400 });
  }
}
// (server re-checks — client cannot override this)

const maxHp = maxHpAtLevel(characterClass, constitution, targetLevel);
const xp = XP_THRESHOLDS[targetLevel - 1] ?? 0;

// Create at target level in a transaction, then apply level effects 2..N
await prisma.$transaction(async (tx) => {
  const character = await tx.character.create({
    data: { ..., level: targetLevel, xp, maxHp, currentHp: maxHp,
      ...(subclassKey ? { subclass: subclassKey } : {}),
    },
  });

  // Apply features, resource pools, and queue ASI choices for levels 2..N
  let pendingQueue: Array<{ type: string; level: number }> = [];
  let featuresUnlocked: string[] = [];
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    const { pendingChoiceAdded, newFeatureIds } = await applyLevelEffects(
      tx, { ...character, pendingChoicesQueue: pendingQueue, featuresUnlocked }, lvl,
    );
    if (pendingChoiceAdded && pendingChoiceAdded !== 'subclass') {
      // subclass already set via subclassKey — only queue ASI
      pendingQueue.push({ type: pendingChoiceAdded, level: lvl });
    }
    featuresUnlocked = [...featuresUnlocked, ...newFeatureIds];
  }

  if (pendingQueue.length > 0 || featuresUnlocked.length > 0) {
    await tx.character.update({
      where: { id: character.id },
      data: { pendingChoicesQueue: pendingQueue, featuresUnlocked },
    });
  }
});
```

`applyLevelEffects` needs a minor refactor to return `newFeatureIds` (it currently returns `newFeatureNames`, then looks up IDs separately inside `applyXpAward`) — or the create endpoint replicates that lookup inline.

**Step-by-step:**

1. Player taps "Begin Character Creation" in the sacrifice modal.
2. Client calls `POST /api/v2/me/characters/[id]/confirm-sacrifice` → `{ redirectLevel: N, sessionId: X, predecessorCharacterId: P }`.
3. Client redirects to `/v2/setup?fromSacrifice=true&level=N&sessionId=X&fallenName=Mira&predecessorId=P`.
4. Setup page detects `fromSacrifice=true` and **skips directly to character creation** — no character selection step, no session picker. The page renders:

```
┌─────────────────────────────────────────────┐
│  ← (back does nothing — no history to go to)│
├─────────────────────────────────────────────┤
│  Mira has fallen.                           │
│  Build your next hero at level 3.           │
├─────────────────────────────────────────────┤
│  [CharCreationForm — level hidden, locked]  │
│  Name: ___________                          │
│  Class: [grid of class buttons]             │
│  Stats: [point buy]                         │
│  Skills: [pills]                            │
│                                             │
│  [ Create Character ]                       │
└─────────────────────────────────────────────┘
```

5. On "Create Character" success (`POST /api/v2/me/characters` returns `newCharacterId`):
   - `onCreated()` calls `POST /api/v2/sessions/[sessionId]/join` with `{ characterId: newCharacterId, predecessorCharacterId: P }`.
   - On success, navigates to `/v2/play?session=X&char=newCharId`.
   - On failure (403 etc.), shows an inline error — this should not happen in normal flow.

**How does the new character join the session?**

Through `POST /api/v2/sessions/[sessionId]/join` — a new authenticated endpoint that verifies ownership, confirms a dead predecessor exists in this session, creates the `RoomParticipant`, and writes `pendingArrivalContext` onto the new Character row. Navigation to play only happens after this succeeds. See the "New Character Join" section for full auth checks and writes.

The only constraint is that the party must not be in active combat when the new character lands on the play page — if they are, action chips are disabled and they see the "waiting for combat to end" notice (see §7).

---

### 6. Dead Character in the Party Screen

**While downed (hp = 0, not yet sacrificed):**
- Character portrait shown with a dark red overlay and the compact death save tracker (two rows of 3 circles) below their name.
- No HP bar shown — replaced by the circles.
- Character is listed in normal initiative order position.

**After `isDead: true` is set (sacrifice confirmed):**
- Portrait shown with a skull icon overlay, name in italic, greyed out.
- Label: `"Fallen"` in small text below the name.
- Remains in the party list until the new character joins the session. Acts as a visual memorial / empty slot.
- Does not take up action space — no action chips, no "your turn" indicator.

**After new character joins:**
- The fallen character's slot is replaced by the new character's portrait and name.
- A subtle separator or transition animation (opacity fade in) marks the swap.
- The new character starts without any "Fallen" context — clean slate visually.

---

### 7. New Character — What They See On Join

There are two distinct problems here: **what they see in the chat log** (history they weren't present for) and **what the AI gets told** when narrating their arrival (context about what happened while they were gone).

---

#### The chat log problem

The new character's chat log is scoped to the room they join. If the party has moved rooms since the battle, the death narrative is in a different `RoomInstance` — not visible here at all. Even in the same room, there may be many messages from other players they've never seen.

**Solution: catch-up card**, shown at the top of the chat log on first load, using the same `ExplorationResumeCard` component that already exists for returning players. It appears above the oldest visible message and is dismissable.

```
┌─────────────────────────────────────────────┐
│  You're joining the party as Kael.          │
│                                             │
│  Mira fell in battle. The party has since  │
│  [moved to / remained in] [RoomName].      │
│  The messages below are from this room.    │
│                                             │
│  Take your first action to enter the story.│
│                                 [ Got it ] │
└─────────────────────────────────────────────┘
```

This card is rendered client-side when `characterStats.pendingArrivalContext` is non-null in the
room state response. `pendingArrivalContext` is already fetched as part of the character record
loaded by the room state API — no extra API call needed. It disappears once dismissed or after
the first action fires (the server clears it atomically; the next poll returns it as null).

---

#### The AI prompt problem

`pendingArrivalContext` stores `{ fallenName, fallenClass, recentContext }`. Without
`recentContext`, the AI has no idea what the party has done since the battle — they might have
looted the room, healed up, had a conversation, or entered a completely different area. Without
that context the arrival narrative can contradict what's already been established.

`recentContext` is built at join time from the last 5 non-mechanical messages in the current
room, capped at 200 chars per message and 800 chars total. See the join endpoint write above.
It is injected into the AI prompt via the atomic claim result (already shown in the Arrival
Narrative section).

---

#### Action input placeholder and combat gate

- Before first action: input placeholder reads `"Describe your arrival..."` instead of `"What do you do?"`.
- If the party is in active combat when they join: input is disabled entirely, chips hidden, a notice shown:

```
┌─────────────────────────────────────────────┐
│  ⚔ The party is in combat.                 │
│  You'll enter the story once the            │
│  encounter ends.                            │
└─────────────────────────────────────────────┘
```

After their first action fires, `pendingArrivalContext` is atomically claimed and cleared server-side. The next room state poll returns it as null, the catch-up card is gone, the placeholder reverts, and all UI returns to normal.

---

## Known Gaps / Out of Scope

- **Instant death (massive damage):** 5E allows instant death if damage in one hit exceeds remaining HP + max HP. Not currently modelled. Heroic sacrifice trigger only fires via accumulated death save failures.
- **Healing a downed character:** Allies can heal a downed character (hp → positive). This already works via the item/spell system and pre-empts the death save path entirely.
- **Multiple downed characters same round:** The while-loop processes one downed character per pass. If two characters are both downed and both reach 0 HP in the same round, each auto-resolves on their own initiative slot in sequence. No race condition.
- **New character level cap:** `predecessor.level` (read from the fallen Character row) is the authoritative source after `confirm-sacrifice` clears the queue. Server re-validates via `predecessorCharacterId` in `POST /api/v2/me/characters`.
- **Session without a current party room:** The join endpoint picks the most-occupied room (highest `RoomParticipant` count) to enroll the new character and write the catch-up log message. `pendingArrivalContext` lives on `Character` so it fires regardless of which room the character is in when they act.

---

## Tests

See `lib/v2/__tests__/heroic-sacrifice.test.ts` for full coverage.

### Unit: auto-resolve death saves
- [ ] Downed character's turn is auto-resolved without player input
- [ ] Auto-resolve fires the same `resolveDeathSave` path as the manual chip
- [ ] Turn advances past downed character after auto-resolve
- [ ] Non-downed character's turn breaks the loop and returns control to the player
- [ ] Stabilized character (isStabilized=true) is skipped, not auto-resolved
- [ ] Roll badge written to MessageLog for every auto-resolved death save
- [ ] Console log emitted: `[stage3:death-save:auto]`

### Unit: `resolveDeathSave` outcomes
- [ ] Roll 20: outcome = 'revived', hp set to 1, counters reset
- [ ] Roll 1: outcome = 'failure', failures += 2
- [ ] Roll 1 with 2 existing failures: outcome = 'dead', characterDied = true
- [ ] Roll 10–19: outcome = 'success', successes += 1
- [ ] Roll 10+ with 2 existing successes: outcome = 'stabilized', isStabilized = true
- [ ] Roll 2–9: outcome = 'failure', failures += 1
- [ ] Roll 2–9 with 2 existing failures: outcome = 'dead', characterDied = true

### Unit: heroic sacrifice trigger
- [ ] 3rd failure via own death save roll → `heroic_sacrifice` pushed to `pendingChoicesQueue`
- [ ] 3rd failure via enemy attack auto-fail → same trigger fires
- [ ] `isDead` is NOT set to true at trigger time
- [ ] `isStabilized = true` set on initiative entry after trigger
- [ ] Public MessageLog entry written with `type: 'heroic_sacrifice'`
- [ ] Public entry text contains character name and continuity hint
- [ ] `pendingChoicesQueue` entry includes `fallenName`, `fallenClass`, `fallenLevel`
- [ ] 1st and 2nd failures do NOT trigger heroic sacrifice
- [ ] Natural 20 revive clears failure/success counters and sets hp = 1

### Unit: `advanceTurn` after heroic sacrifice
- [ ] Character with `isStabilized = true` (post-sacrifice) is skipped on subsequent rounds
- [ ] Other characters and enemies continue to take turns normally
- [ ] Combat can end (checkCombatEnd) with a sacrifice-pending character in initiative order

### Unit: combat independence from popup
- [ ] `checkCombatEnd` returns true when all enemies dead, regardless of `heroic_sacrifice` pending
- [ ] `checkCombatEnd` returns false when enemies alive + character has sacrifice pending
- [ ] Remaining alive characters can still act after one character has sacrifice pending

### Unit: confirm-sacrifice endpoint
- [ ] Sets `isDead: true` on character
- [ ] Removes `heroic_sacrifice` entry from `pendingChoicesQueue`
- [ ] Returns `redirectLevel` matching `fallenLevel` from the queue entry
- [ ] Returns 403 if `pendingChoicesQueue` does not contain `heroic_sacrifice`
- [ ] Returns 404 if character not found
- [ ] Idempotent: second call returns 403 (queue entry already cleared)

### Unit: death save roll badge
- [ ] `resolveCombatAction` with `death_save` emits `combat_roll` in rollLogs
- [ ] Roll badge: action = 'Death Save', vsTarget = 'DC 10'
- [ ] Natural 20: `isCrit: true` on roll badge
- [ ] Revive result: `dbHpUpdates` contains `{ id: characterId, hpDelta: 1 }`
- [ ] Non-revive: `dbHpUpdates` is empty

### Unit: `pendingArrivalContext`
- [ ] Written to the new Character row (not RoomInstance) on session join
- [ ] Contains `fallenName`, `fallenClass`, `recentContext`
- [ ] `recentContext` is capped at 800 characters total; individual messages capped at 200 characters
- [ ] Brief public MessageLog entry written at same time (in the same $transaction)
- [ ] Cleared atomically from `Character` on first narrative generation via UPDATE...RETURNING (not separate read-then-write)
- [ ] Second narrative generation for new character does NOT include arrival context (flag already NULL)
- [ ] If `pendingArrivalContext` is null, no extra context injected (existing characters unaffected)
- [ ] Fires correctly even if party moved to a different room between join and first action

---

### Unit: higher-level character creation (`startingLevel`)

These tests cover `POST /api/v2/me/characters` with `startingLevel > 1`. They verify HP, `level`, `xp`, `pendingChoicesQueue` entries, and `featuresUnlocked` for every class at all levels where something changes, up to 20.

#### HP at starting level

| Test | Class | startingLevel | Expected maxHp formula |
|---|---|---|---|
| Level 1 baseline | Fighter (d10, CON 14) | 1 | 10 + 2 = 12 |
| Level 5 | Fighter (d10, CON 14) | 5 | `maxHpAtLevel('Fighter', 14, 5)` |
| Level 10 | Wizard (d6, CON 10) | 10 | `maxHpAtLevel('Wizard', 10, 10)` |
| Level 20 | Barbarian (d12, CON 16) | 20 | `maxHpAtLevel('Barbarian', 16, 20)` |

- [ ] `maxHp` at startingLevel=1 matches `hitDie + conMod` (baseline unchanged)
- [ ] `maxHp` at startingLevel=5 is greater than level-1 maxHp for same class/CON
- [ ] `maxHp` at startingLevel=20 matches `maxHpAtLevel` output (not a hardcoded value)
- [ ] `currentHp` equals `maxHp` on creation at every startingLevel

#### Level and XP

- [ ] `level` is set to `startingLevel` on the created character
- [ ] `xp` is set to `XP_THRESHOLDS[startingLevel - 1]` (minimum XP for that level)
- [ ] startingLevel=1 → xp=0, level=1 (unchanged baseline)
- [ ] startingLevel=5 → xp=XP_THRESHOLDS[4]
- [ ] startingLevel=20 → xp=XP_THRESHOLDS[19] (max level XP floor)

#### Subclass: applied at creation vs. queued

The subclass must be applied at creation time (not queued) when `startingLevel >= subclassLevel`. If `startingLevel < subclassLevel`, no subclass entry in the queue and no subclass on the character.

**L1 subclass classes (Cleric, Sorcerer, Warlock) — subclass always required:**
- [ ] startingLevel=1, subclassKey provided → `character.subclass = key`, no queue entry
- [ ] startingLevel=10, subclassKey provided → `character.subclass = key`, no queue entry
- [ ] startingLevel=1, no subclassKey → API returns 400 (required for L1 classes)

**L2 subclass classes (Wizard, Druid):**
- [ ] startingLevel=1, no subclassKey → no subclass on character, no queue entry (haven't reached level 2 yet)
- [ ] startingLevel=2, subclassKey provided → `character.subclass = key`, no queue entry
- [ ] startingLevel=2, no subclassKey → API returns 400 (required at or above subclass level)
- [ ] startingLevel=10, subclassKey provided → `character.subclass = key`, no queue entry

**L3 subclass classes (Artificer, Barbarian, Bard, Fighter, Monk, Paladin, Ranger, Rogue):**
- [ ] startingLevel=1, no subclassKey → no subclass, no queue entry
- [ ] startingLevel=2, no subclassKey → no subclass, no queue entry
- [ ] startingLevel=3, subclassKey provided → `character.subclass = key`, no queue entry
- [ ] startingLevel=3, no subclassKey → API returns 400 (required at or above subclass level)
- [ ] startingLevel=10, subclassKey provided → `character.subclass = key`, no queue entry
- [ ] startingLevel=20, subclassKey provided → `character.subclass = key`, no queue entry

#### ASI queue entries by class and level

Each class's ASI schedule from `xp-helpers.ts`:

| Class | ASI levels | Total by L20 |
|---|---|---|
| Fighter | 4, 6, 8, 12, 14, 16, 19 | 7 |
| Rogue | 4, 8, 10, 12, 16, 19 | 6 |
| All others | 4, 8, 12, 16, 19 | 5 |

For a character created at `startingLevel=N`, the queue must contain exactly one `{ type: 'asi', level: L }` entry for every ASI level L ≤ N.

**Fighter ASI queue at each critical level:**
- [ ] startingLevel=3 → 0 ASI entries
- [ ] startingLevel=4 → 1 ASI entry: `[{type:'asi', level:4}]`
- [ ] startingLevel=5 → 1 ASI entry: `[{type:'asi', level:4}]`
- [ ] startingLevel=6 → 2 ASI entries: levels 4, 6
- [ ] startingLevel=7 → 2 ASI entries: levels 4, 6
- [ ] startingLevel=8 → 3 ASI entries: levels 4, 6, 8
- [ ] startingLevel=12 → 4 ASI entries: levels 4, 6, 8, 12
- [ ] startingLevel=14 → 5 ASI entries: levels 4, 6, 8, 12, 14
- [ ] startingLevel=16 → 6 ASI entries: levels 4, 6, 8, 12, 14, 16
- [ ] startingLevel=19 → 7 ASI entries: levels 4, 6, 8, 12, 14, 16, 19
- [ ] startingLevel=20 → 7 ASI entries (no ASI at level 20 for Fighter)

**Rogue ASI queue at each critical level:**
- [ ] startingLevel=4 → 1 ASI entry: level 4
- [ ] startingLevel=8 → 2 ASI entries: levels 4, 8
- [ ] startingLevel=10 → 3 ASI entries: levels 4, 8, 10
- [ ] startingLevel=12 → 4 ASI entries: levels 4, 8, 10, 12
- [ ] startingLevel=16 → 5 ASI entries: levels 4, 8, 10, 12, 16
- [ ] startingLevel=19 → 6 ASI entries: levels 4, 8, 10, 12, 16, 19
- [ ] startingLevel=20 → 6 ASI entries (no ASI at level 20 for Rogue)

**Default class (e.g. Barbarian, Bard, Cleric, Druid, Monk, Paladin, Ranger, Sorcerer, Warlock, Wizard, Artificer) at each critical level:**
- [ ] startingLevel=3 → 0 ASI entries
- [ ] startingLevel=4 → 1 ASI entry: level 4
- [ ] startingLevel=8 → 2 ASI entries: levels 4, 8
- [ ] startingLevel=12 → 3 ASI entries: levels 4, 8, 12
- [ ] startingLevel=16 → 4 ASI entries: levels 4, 8, 12, 16
- [ ] startingLevel=19 → 5 ASI entries: levels 4, 8, 12, 16, 19
- [ ] startingLevel=20 → 5 ASI entries (no ASI at level 20 for default)

#### No double-queuing

- [ ] `subclass` entry is never in `pendingChoicesQueue` when `subclassKey` was provided at creation
- [ ] `subclass` entry is never queued at a level below the class's subclass level
- [ ] No duplicate `asi` entries for the same level (idempotent — `applyLevelEffects` called once per level)

#### Combined: subclass + ASI at level 20 per class

One end-to-end check per class verifying the complete queue shape at max level:

| Class | subclassKey required? | Expected ASI count in queue at L20 |
|---|---|---|
| Fighter | yes (provided at creation) | 7 |
| Rogue | yes (provided at creation) | 6 |
| Wizard | yes (provided at creation) | 5 |
| Druid | yes (provided at creation) | 5 |
| Cleric | yes (provided at creation) | 5 |
| Sorcerer | yes (provided at creation) | 5 |
| Warlock | yes (provided at creation) | 5 |
| Barbarian | yes (provided at creation) | 5 |
| Bard | yes (provided at creation) | 5 |
| Monk | yes (provided at creation) | 5 |
| Paladin | yes (provided at creation) | 5 |
| Ranger | yes (provided at creation) | 5 |
| Artificer | yes (provided at creation) | 5 |

- [ ] Each class at startingLevel=20: `character.subclass` is set, `pendingChoicesQueue` has exactly N ASI entries (see table), no `subclass` entries in queue

#### Server-side `startingLevel` validation

- [ ] `startingLevel` not matching `fallenLevel` in the sacrificed character's queue → API returns 400
- [ ] `startingLevel < 1` or `startingLevel > 20` → API returns 400
- [ ] `startingLevel` missing → defaults to 1 (normal creation, unchanged baseline)
- [ ] `startingLevel` provided without a valid `heroic_sacrifice` queue entry on the predecessor → API returns 403

### Integration: full death → sacrifice → replacement arc
- [ ] Character downed → auto-rolls each turn → hits 3 failures → `heroic_sacrifice` in queue
- [ ] Other players can still act after the sacrifice trigger
- [ ] Combat ends when enemies die, independent of sacrifice popup state
- [ ] New character joins during exploration → `pendingArrivalContext` set on new Character row
- [ ] New character's first action → arrival narrative fires, flag cleared
- [ ] New character's second action → no arrival context injected

### Regression: existing death save behavior preserved
- [ ] Enemy attack on downed character still applies auto-fail (existing behavior)
- [ ] 3 auto-fails from enemy attacks triggers heroic sacrifice (not just self-rolled failures)
- [ ] Downed character with hp=0 and live enemies: combat does NOT end
- [ ] Stabilized character (via 3 successes before 3 failures) is skipped in initiative
- [ ] Stabilized character is NOT given `heroic_sacrifice` queue entry
- [ ] Healing a downed character (hpDelta > 0) before 3 failures: character re-enters combat normally
- [ ] `isDead: true` gate still blocks all actions for truly dead characters
- [ ] Dying character gate still blocks all combat actions except death save (or auto-resolve path)
