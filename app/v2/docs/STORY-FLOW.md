# Story & User Flow

End-to-end user flow from login to game completion. This document covers the intended
architecture for V2 — some phases (lobby, multiplayer, act progression) are not yet
implemented and are marked accordingly.

---

## 1. Authentication

User hits `/v2/setup` → Supabase Google OAuth → returns to `/v2/setup` as authenticated user.

---

## 2. Character Selection / Creation

- Authenticated user is shown their existing characters.
- Each character card shows: name, class, level, HP.
- User can create a new character: name, class, stat array, skill proficiencies (class-gated).
- On character select → advances to Story step.

**Schema**: `Character` (linked to `User` via `userId`)

---

## 3. Story Selection

- User is shown the story picker: one card per `DungeonTemplate`.
- Each card shows: title, synopsis, difficulty badge, length badge, tone badge.
- Selecting a story advances to the **Game Lobby**.

**Schema**: `DungeonTemplate` (synopsis, difficulty, length, tone, startRoomTemplateId)

---

## 4. Game Lobby *(not yet implemented — to be ported from V1)*

The lobby is the pre-game staging area between story selection and gameplay.

### Behaviour
- A `Lobby` record is created, linked to the `DungeonTemplate` and the initiating character.
- The creating player receives a shareable invite code or link.
- Up to 4 player slots. Any unfilled slots can be set to **Solo** (AI-controlled or simply absent).
- Each joining player selects their character from their own character list.
- The lobby creator can start the game once at least 1 player is ready (no minimum beyond the creator).
- Players can set their status to **Ready**; game cannot start until all joined players are ready.

### Lobby → Game transition
When the creator presses **Start**, the system:

1. Creates a `GameSession` record, linked to the `DungeonTemplate` and all participating `Character` IDs.
2. Sets `currentObjective` to the first act's opening objective.
3. Instantiates the **first act's rooms** (see §6 below).
4. Redirects all players to `/v2/play`.

**Schema needed**: `Lobby` (dungeonTemplateId, creatorCharacterId, inviteCode, status), `LobbyMember` (lobbyId, characterId, userId, isReady)

---

## 5. Room & POI Instantiation

When a game starts (or when a player first enters a new room), templates are copied into
live instances:

```
DungeonTemplate
  └── RoomTemplate          → RoomInstance  (linked to GameSession)
        └── PoiTemplate     → PoiInstance   (linked to RoomInstance, currentProperties = {})
```

- **At game start**: only the first act's entry room is instantiated. Subsequent rooms are
  instantiated on first entry (lazy) to avoid creating stale state.
- `currentProperties` starts as `{}` on every `PoiInstance` and accumulates mutations
  (e.g. `{ interacted: true, unlocked: true, revealed_items: ["iron_key"] }`).
- `GameSession.dungeonTemplateId` links the session back to the story for display purposes.

---

## 6. Act Structure & Progression

A dungeon is divided into **acts**. Each act is a thematic chapter with its own rooms,
enemies, and objectives. Acts are ordered and unlock sequentially.

### Act model *(V2 act model not yet implemented — V1 has Act/Scene, not yet ported)*

Acts are a **narrative overlay**, not room containers. All `RoomTemplate`s live flat under
`DungeonTemplate` and their instances persist across the full story. An act defines what is
*happening* in those rooms — which enemies are present, which objectives are active, which
NPCs have new dialogue — not which rooms exist.

```
DungeonTemplate
  └── RoomTemplate[]        ← all rooms, shared across all acts
  └── Act (order: 1, 2, 3…)
        ├── completionTrigger
        ├── openingObjective  String
        ├── summary           String?   ← AI-generated at act close
        └── onStartMutations  Json?     ← state changes applied to PoiInstances on act start
```

`onStartMutations` is a list of targeted changes the engine applies to existing `PoiInstance`
records when the act begins — spawning a new NPC, unsealing a passage, adding a clue item
to a room the player has already visited. Rooms are not re-instantiated; their accumulated
state carries forward.

This means a player returning to the Entry Chamber in Act 2 finds the same open doors and
looted chest from Act 1, but may also find a new patrol or a note that wasn't there before.
Previously-seen details (a crest, a symbol, a name) can now be referenced by the DM with
new meaning, because the room state — and the player's memory of it — is continuous.

### Advancing to the next act
An act completes when its `completionTrigger` fires. Trigger types (mirroring V1):

| Trigger | Description |
|---|---|
| `ACT_START` | Auto-fires when act begins (used for act 1) |
| `ENEMY_DEFEATED` | Specific enemy ID is killed |
| `ITEM_FOUND` | Specific item ID is picked up |
| `AREA_REACHED` | Player enters a specific room template |
| `TURN_LIMIT` | AI DM forces progression after N turns |

On act completion:
1. AI DM generates a compact act-closing summary (3-5 sentences) stored on `Act.summary`.
   This summary captures key beats: decisions made, discoveries, deaths, unresolved threads.
2. `onStartMutations` for the next act are applied to existing `PoiInstance` records.
3. `GameSession.currentObjective` is updated to the next act's `openingObjective`.
4. Any new rooms introduced by the next act are instantiated on first entry (lazy).
5. Players are routed into the new act's entry point.

Between acts there may be a brief interstitial screen showing the act summary and the new
objective — equivalent to a chapter break.

---

## 7. AI DM Context Management

As a story grows across multiple acts and rooms, the AI DM prompt must stay bounded and
focused. The architecture keeps context predictable through three layers:

### Layer 1 — Room state as facts (already implemented)

`currentProperties` on every `PoiInstance` is the pre-compressed answer to "what happened
here." The DM sees `Locked Chest: UNLOCKED, interacted, items taken` — not the message
history of how it got that way. The game controller already builds this structured snapshot
for every turn.

### Layer 2 — Act summaries as compression points

The full `MessageLog` is only provided for the **current act**. Past acts are replaced by
their `Act.summary` — a 3-5 sentence AI-generated recap written at act close. The DM
context structure for any given turn is:

```
[Act 1 Summary]              ← compact, written at act close, never changes
[Act 2 Summary]              ← same
[Current Act: message log]   ← full detail, current act only
[Current Room State]         ← POI facts, inventory, position, combat state
[Story Flags]                ← see Layer 3
```

This keeps the prompt size roughly constant regardless of how many acts have elapsed.

### Layer 3 — Story flags for durable facts

`GameSession.storyFlags` is a flat JSON key/value store for facts too important to risk
being compressed or omitted from a summary. The game controller writes to it when
significant story beats occur; the DM prompt always includes it verbatim.

Examples:
```json
{
  "player_knows_vorne_cult": true,
  "commander_note_read": true,
  "gate_opened_from_north": true,
  "aldric_spared_the_guard": true
}
```

Story flags are intentionally narrow — they record *conclusions*, not narrative. The DM
uses them to ensure callbacks and consequences land correctly even across act boundaries.

**Schema needed**: `GameSession.storyFlags Json @default("{}")` *(not yet added)*

---

## 8. Multiplayer Turn Order

*(Full implementation pending)*

- Each `GameSession` tracks all participating `Character` IDs.
- Turn order is determined at game start (initiative roll or fixed order).
- Each player takes their turn asynchronously; the game advances when all players have
  submitted actions for the round, or immediately in solo mode.
- `RoomParticipant` tracks each character's current room, proximity target, and combat state.
- Characters can be in different rooms simultaneously (the game engine scopes actions to the
  character's current `RoomInstance`).

---

## 8. Game Conclusion

The game concludes when the final act's `completionTrigger` fires.

1. `GameSession.gameState` transitions to `"completed"`.
2. AI DM generates a full epilogue narrative based on the session's `MessageLog`.
3. XP and loot are tallied and written back to each `Character`.
4. Players are routed to a **Game Over / Summary** screen showing:
   - Story title and total turns played
   - Key story beats (derived from act summaries)
   - Character XP gained, level-ups, items kept
   - Option to start a new run with the same or different characters

**Schema**: `GameSession.gameState` (`"exploration"` | `"combat"` | `"completed"`)

---

## Summary Flow Diagram

```
Login
  └─▶ Character select / create
        └─▶ Story picker  (DungeonTemplate cards)
              └─▶ Game Lobby  (invite up to 3 others, set ready)
                    └─▶ Game Start
                          ├─ Create GameSession (storyFlags = {})
                          ├─ Instantiate Act 1 entry room (lazy — first entry only)
                          └─▶ Gameplay Loop
                                ├─ Player submits action
                                ├─ Game controller mutates PoiInstances / inventory
                                ├─ Game controller writes story flags on key beats
                                ├─ AI DM narrates (context = room state + current act log
                                │                   + past act summaries + story flags)
                                ├─ [completionTrigger?] ──▶ Next Act
                                │       ├─ AI generates Act.summary (3-5 sentences)
                                │       ├─ Apply onStartMutations to existing PoiInstances
                                │       ├─ Update GameSession.currentObjective
                                │       └─ Act interstitial screen → continue
                                └─ [final act complete?] ──▶ Game Over
                                        ├─ AI generates epilogue from act summaries + flags
                                        ├─ Write XP / loot to Characters
                                        └─ Summary screen
```
