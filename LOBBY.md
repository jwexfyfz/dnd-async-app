# Lobby + Multiplayer Plan

Covers: lobby phase, party tab, player avatars in chat, player names in narrative, and the four open design questions.

---

## Design Decisions (answer these before building)

### 1. Party splitting — recommendation: allow freely, including fleeing combat

The current architecture handles splits cleanly. `RoomParticipant` is per-character-per-room, `MessageLog` is per-room, so players in different rooms naturally see different chat streams and share a party tab that shows everyone.

**Movement is free**, including during combat. Fleeing is a legitimate D&D tactic. Any character can `move_to_room` at any time, even if they are the last one in a room with living enemies.

**When all players leave a room during combat**: combat ends for that room. Enemies remain with whatever HP they had — this is persisted to `PoiInstance.currentProperties.current_hp` on every hit (see Phase K), so no special flush is needed on exit. When any player re-enters, the room's enemies are still hostile and combat resumes immediately.

**What doesn't work across rooms**: combat targeting (you can only attack enemies in your room), item handoffs (no long-range trading), and healing (can't stabilize someone in another room). These are intentional constraints, not bugs.

### 2. Death — recommendation: async-friendly death save flow

V2 already has the `death_save` action type in the intent parser. Use it:

- **0 HP**: Character is "downed." `currentHp` stays at 0. They can only take `death_save` actions on their turn.
- **3 successes**: Stabilized at 1 HP, removed from incapacitated state.
- **3 failures**: **Permanent death**. Character is marked `isDead = true` (new column on Character). They stay visible in the party tab as a tombstone entry (greyed out). Cannot act. Cannot rejoin as a new character mid-session — the loss is real. The session continues for survivors.
- **Stabilization by ally**: Any adjacent party member can use a `Medicine` check (DC 10) as an action to stabilize a downed character at 1 HP, saving them from needing to roll.
- **Dead = spectator**: A dead character's `RoomParticipant` remains so their player can still read the chat. They just can't send actions. The game action API rejects requests from dead characters.

### 3. Leaving mid-game — recommendation: dormant state, rejoin anytime

- When a player disconnects or explicitly leaves: their character goes **dormant**. In exploration, they simply don't get a DM turn. In combat, `advanceTurn` skips dormant characters (same as dead enemies at 0 HP are skipped now).
- A dormant character is NOT removed from the session. Their player can rejoin at any time using the session share URL and picking up where they left off.
- **Dormancy detection**: `RoomParticipant.lastActiveAt` is already updated on every action. If `lastActiveAt` is more than 48 hours ago, the play page shows a "Player X is away" badge in the party header. Combat auto-skips them so the party isn't blocked.
- **Explicit leave**: A "Leave session" option in the party tab. Sets `lastActiveAt` to a sentinel epoch date to immediately mark them dormant. The host can also kick a dormant player (removes their `RoomParticipant` from all rooms in the session).
- **Session cleanup**: If the host has been dormant for 7 days, a banner appears to all other players offering them the option to promote another player to host.

### 4. What to skip for now

- No cross-room actions (healing across rooms, shouting warnings, etc.). Too complex for async.
- No real-time push. Polling every 3 seconds is sufficient for async play.
- No split-party combat bridging. If players are in different rooms and both rooms enter combat, those are two independent combat instances.

---

## Schema Migration

**Requires one migration across GameSession/Character/User/RoomInstance.** Confirm before running `npx prisma migrate dev`.

### `GameSession` — add 4 columns

```prisma
model GameSession {
  // ... existing fields ...
  hostCharacterId    String?          // character who created the session; has Start button
  lobbyState         Json             @default("[]")
  kickedCharacterIds Json             @default("[]")  // prevents kicked players from rejoining
  lobbyVersion       Int              @default(0)     // optimistic lock for concurrent lobby joins
  // gameState already exists as String — values are now "lobby" | "active" | "completed"
  // exploration vs combat is tracked per-room on RoomInstance (see below)
}
```

`lobbyState` is a JSON array of members who have joined the session URL:
```ts
type LobbyMember = {
  characterId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  characterName: string;
  characterClass: string;
  status: 'joined' | 'ready';
};
```

### `Character` — add 1 column

```prisma
model Character {
  // ... existing fields ...
  isDead   Boolean @default(false)
}
```

### `User` — add 2 columns

```prisma
model User {
  // ... existing fields ...
  avatarUrl   String?    // Google OAuth profile picture; populated at first sign-in
  lastSeenAt  DateTime?  // updated on every authenticated page load; used for "last seen" display
}
```

### `RoomInstance` — add 2 columns

```prisma
model RoomInstance {
  // ... existing fields ...
  gameState   String  @default("exploration")  // "exploration" | "combat" — moved from GameSession
  combatState Json?                            // CombatState JSON — moved from GameSession
}
```

`combatState` and `gameState` move to `RoomInstance` so split-party rooms can independently be in combat or exploration. `GameSession.gameState` tracks only lobby/active/completed. `GameSession.combatState` is no longer written after this migration — it becomes dead weight and can be dropped in a follow-up cleanup.

**Note**: `RoomParticipant.lastActiveAt` already exists in the schema — do not add it again.

---

## What Changes and Where

### Files created (new)

| File | Purpose |
|------|---------|
| `app/v2/lobby/[sessionId]/page.tsx` | Lobby UI — party list, ready toggle, start button, share URL |
| `app/api/v2/lobby/[sessionId]/route.ts` | GET (poll state), POST (join), PATCH (toggle ready), DELETE (leave) |
| `app/api/v2/lobby/[sessionId]/start/route.ts` | POST — host-only; initializes rooms, flips gameState to exploration |
| `app/api/v2/lobby/[sessionId]/kick/route.ts` | DELETE — host-only; removes a member from lobbyState |
| `app/api/v2/sessions/[sessionId]/kick/route.ts` | DELETE — host-only mid-game kick; removes RoomParticipant records, splices from combatState, adds to kickedCharacterIds |
| `lib/v2/session-starter.ts` | Pure logic: room initialization, opening narrative generation (moved from sessions/route.ts and extended for multi-character) |

### Files modified

| File | What changes |
|------|-------------|
| `app/api/v2/sessions/route.ts` | `POST` keeps room + narrative creation unchanged; adds `hostCharacterId`, `lobbyState` (host entry), `gameState="lobby"` to the session. Returns `{ sessionId, roomInstanceId }` as before. `GET` extended to return `partyMembers[]` (avatar, class, name) per session for the session card roster. |
| `app/v2/setup/page.tsx` | After `POST /api/v2/sessions` succeeds, redirect to `/v2/lobby/[sessionId]` instead of `/v2/play`. Session cards show a compact avatar+class strip so returning players can identify games by their party. |
| `lib/v2/game-controller.ts` | `handleGameAction` rejects requests when `gameState === "lobby"` or `character.isDead === true`. `advanceTurn` skips dormant characters. `move_to_room` guard for last-person-leaving-combat. |
| `types/v2-game.ts` | Add `partyMembers` to `ViewStatePayload`. Add `avatarUrl` to whatever type surfaces in chat history. |
| `lib/v2/game-controller.ts` → `buildViewState` | Add session-wide party member query. Include `partyMembers` in returned payload. |
| `app/v2/play/page.tsx` | `PartyTab` shows all party members (not just self). Chat messages show avatar. `PlayContent` handles dormancy banner. |
| `app/api/v2/room/state/route.ts` | Pass `avatarUrl` through for party members. |
| `prisma/schema.prisma` | As above — new columns on GameSession, Character, User, RoomInstance. |

---

## Implementation Phases

### Phase A — Schema migration

1. Add to `GameSession`: `hostCharacterId String?`, `lobbyState Json @default("[]")`, `kickedCharacterIds Json @default("[]")`, `lobbyVersion Int @default(0)`. Update `gameState` comment to `"lobby" | "active" | "completed"`.
2. Add `isDead Boolean @default(false)` to `Character`.
3. Add `avatarUrl String?` and `lastSeenAt DateTime?` to `User`.
4. Add `gameState String @default("exploration")` and `combatState Json?` to `RoomInstance`.
5. Do **not** add `lastActiveAt` — it already exists on `RoomParticipant`.
6. Run `npx prisma migrate dev --name lobby_and_multiplayer`.
7. Run `npx prisma generate`.

**Gate**: `npm run build` — no type errors.

---

### Phase B — Avatar persistence

**Goal**: Persist Google profile picture URL when a user authenticates, so it's available for all subsequent queries without hitting Google's API per-request.

In `app/auth/callback/route.ts` (the Supabase OAuth callback), after the user is confirmed, upsert `User.avatarUrl` from `user.user_metadata.avatar_url`:

```ts
await prisma.user.upsert({
  where: { id: user.id },
  update: { displayName, avatarUrl: user.user_metadata?.avatar_url ?? null },
  create: { id: user.id, email: user.email!, displayName, avatarUrl: user.user_metadata?.avatar_url ?? null },
});
```

This fires once per login — zero per-request overhead afterward.

**Gate**: Log in with Google, verify `User.avatarUrl` is populated in the DB.

---

### Phase C — Session creation → lobby redirect

`POST /api/v2/sessions` keeps its existing behavior (creates session + RoomInstance + PoiInstances + RoomParticipant for the host + opening narrative). The only changes are:

1. Add `hostCharacterId`, `gameState: 'lobby'`, and `lobbyState` (host's entry, status `'ready'`) to the `gameSession.create` call.
2. Write `gameState: 'exploration'` and `combatState: null` on the `RoomInstance` (new columns from Phase A) instead of on the session.
3. Response shape is unchanged — still returns `{ sessionId, roomInstanceId }`.

**Modify `app/v2/setup/page.tsx`**: change the post-creation redirect from `/v2/play?session=...&char=...` to `/v2/lobby/${sessionId}`. This is the only client-side change.

**Extend `GET /api/v2/sessions`** to return party members per session for the session card avatar strip:

```ts
partyMembers: session.roomInstances
  .flatMap(ri => ri.participants)
  .filter((p, i, arr) => arr.findIndex(x => x.characterId === p.characterId) === i)
  .map(p => ({
    characterName: p.character.name,
    characterClass: p.character.characterClass,
    avatarUrl: p.character.user.avatarUrl ?? null,
  })),
```

**Session card in setup page**: render a compact `[avatar][avatar][avatar] +N` strip above the room name. 24px circles, fallback to class emoji in a coloured circle.

**Gate**: Creating a session lands on the lobby page URL. The `sessionId` and `roomInstanceId` are both valid in the DB from the moment the host creates the session.

---

### Phase D — Lobby API routes

**`GET /api/v2/lobby/[sessionId]`** — poll endpoint, returns:
```ts
{
  sessionId: string;
  hostCharacterId: string;
  gameState: 'lobby' | 'exploration';
  dungeonName: string;
  members: LobbyMember[];
  shareUrl: string;
}
```

If `gameState !== 'lobby'`, return `{ gameState: 'exploration', redirectTo: '/v2/play?...' }` — this is how polling clients know the host started the session.

**`POST /api/v2/lobby/[sessionId]`** — join:
- Auth-gated. Character must belong to the requesting user.
- Validates: `gameState === 'lobby'`, max 4 members, character not already in a live session.
- Appends to `lobbyState` JSON with status `'joined'`.

**`PATCH /api/v2/lobby/[sessionId]`** — toggle ready:
- Auth-gated. Finds the requesting user's entry in `lobbyState`, flips `'joined' ↔ 'ready'`.
- Host's entry cannot be set to `'joined'` — they're always `'ready'`.

**`DELETE /api/v2/lobby/[sessionId]`** — leave:
- Removes the requesting user's entry from `lobbyState`.
- If the host leaves: either promote the first `'ready'` non-host member to host (`hostCharacterId` update), or if they're the only member, delete the session.

**`DELETE /api/v2/lobby/[sessionId]/kick`** — host-only kick:
- Body: `{ characterId }`. Removes that entry from `lobbyState`.

**Gate**: `npx tsc --noEmit` — all route handler types resolve.

---

### Phase E — `lib/v2/session-starter.ts`

This is the most complex piece. Extracted from `sessions/route.ts` and extended for multi-character.

```ts
export async function startSession(sessionId: string, hostUserId: string): Promise<void>
```

Steps inside:
1. Load session, verify `hostCharacterId` belongs to `hostUserId`, verify `gameState === 'lobby'`.
2. Load dungeon start room template and all its POI templates.
3. Create `RoomInstance` with all `PoiInstance`s.
4. For each lobby member, create a `RoomParticipant` in that room instance.
5. Flip `gameState` to `'exploration'` on the session.
6. Generate opening narrative with full party context (see Phase H).
7. Write the narrative as a `MessageLog` on the room instance.

All steps 2–6 inside a single `prisma.$transaction`.

**Gate**: `npm test` — write a unit test for the pure party-context-building logic (the part that formats party member names into the AI prompt).

---

### Phase F — Lobby page `app/v2/lobby/[sessionId]/page.tsx`

UI mirrors V1's lobby page but uses V2 patterns (fetch API, not server actions).

**Party roster** — rendered at the top regardless of whether the viewer has joined yet. A horizontal row of avatar + class stacks, one per lobby member:

```
[avatar]  [avatar]  [empty slot]  [empty slot]
  🗡️ Fighter   🗝️ Rogue      —            —
  Theron       Syla
  ✓ Ready      Joined
```

Each stack: 40px Google avatar circle (fallback: class emoji in a coloured circle), class emoji below, character name below that, ready chip below that. Empty slots render as dashed circles to show room for more players up to the party cap of 4. This is the first thing every visitor sees — before the join picker, before any buttons.

**Gate logic for visitors**:
- Not logged in → "Sign in to join" (Google OAuth link), roster still visible
- Logged in, no characters → "You need a hero first — [Create a character]" (link to `/v2/setup`), roster still visible
- Logged in, has characters, not yet in lobby → character join picker below the roster
- Already in lobby → Ready toggle + Leave button

**Other behaviour**:
- Poll `GET /api/v2/lobby/[sessionId]` every 3 seconds.
- On `gameState === 'exploration'` in poll response: `router.replace('/v2/play?sessionId=...&characterId=...')` — all polling clients redirect simultaneously.
- **Share URL**: Copy button that copies `window.location.href`. Label: `"Invite link"`.
- **Ready button**: Toggle for non-hosts. Host entry is always `ready` and the button is hidden for them.
- **Start button**: Host only. Enabled when every member is `'ready'`. Calls `POST /api/v2/lobby/[sessionId]/start`.
- **Leave button**: Calls `DELETE /api/v2/lobby/[sessionId]`.

**Gate**: Manual smoke test — create session → lobby shows roster with host avatar, share link copies, second user joins and appears in roster within one poll cycle.

---

### Phase G — Party tab + ViewStatePayload

**Add `partyMembers` to `ViewStatePayload`**:

```ts
export interface PartyMemberInfo {
  characterId: string;
  characterName: string;
  characterClass: string;
  currentHp: number;
  maxHp: number;
  currentRoom: string;        // room template name
  isInSameRoom: boolean;
  isDormant: boolean;         // lastActiveAt > 48h ago
  isDead: boolean;
  avatarUrl: string | null;
}

export interface ViewStatePayload {
  // ... existing fields ...
  partyMembers: PartyMemberInfo[];
}
```

**In `buildViewState`**, add one additional parallel query:

```ts
// Find all RoomParticipants across all rooms in this session, not just the current room
const sessionParticipants = await prisma.roomParticipant.findMany({
  where: { roomInstance: { sessionId } },
  include: {
    character: {
      select: {
        id: true, name: true, characterClass: true,
        currentHp: true, maxHp: true, isDead: true,
        user: { select: { avatarUrl: true } },
      },
    },
    roomInstance: { select: { template: { select: { name: true } } } },
  },
});
```

Map to `PartyMemberInfo[]`. `isDormant` = `lastActiveAt < new Date(Date.now() - 48 * 60 * 60 * 1000)`.

**Update `PartyTab` in `play/page.tsx`**: Render all party members from `partyMembers`, not just the current character. Show avatar image (fallback: class emoji) + HP bar + room name if different room + dormant/dead badge.

**Gate**: `npm test` + `npx tsc --noEmit`. The `partyMembers` field is a pure addition to `ViewStatePayload` — no existing code breaks.

---

### Phase H — Player avatars in chat

**`MessageLog` currently has `characterId`** — enough to resolve the avatar. Don't add `avatarUrl` to the log row; resolve it at query time.

In `buildViewState`, extend the `recentNarrative` query to join character → user:

```ts
prisma.messageLog.findMany({
  where: { roomInstanceId, isMechanicalEvent: false },
  orderBy: { createdAt: 'desc' },
  take: ROLLING_WINDOW_SIZE,
  select: {
    id: true, text: true, isMechanicalEvent: true,
    mechanicalSummary: true, createdAt: true,
    characterId: true,
    character: {
      select: {
        name: true,
        characterClass: true,
        user: { select: { avatarUrl: true } },
      },
    },
  },
})
```

Add `authorAvatarUrl: string | null` and `authorName: string | null` to the `NarrativeLog` type in `types/v2-game.ts`.

In `ChatMessage` component: if `entry.authorAvatarUrl` is set, render a 24px `<img>` (with `rounded-full`). Fallback: class emoji badge. DM messages (no characterId) show a `🎲` icon or a dungeon-shield icon.

**Gate**: `npx tsc --noEmit`. No behavioral tests needed — purely display.

---

### Phase I — Player names in narrative

**Goal**: The opening narrative and in-game DM responses reference actual party member names, not "the party" or "the adventurers."

**`buildNarrativeSystemPrompt`** (in `lib/v2/ai-prompts.ts`) already receives `appliedActions` which includes character name. Add a `partyContext` parameter:

```ts
export function buildNarrativeSystemPrompt(
  roomName: string,
  roomDescription: string,
  mechanicalFactBlock: string,
  itemsBlock: string,
  storyFlags: Record<string, unknown>,
  partyNames: string[],   // ← new
): string {
  const partyLine = partyNames.length > 1
    ? `PARTY MEMBERS IN THIS ROOM: ${partyNames.join(', ')}`
    : '';
  // Prepend partyLine to the STRICT INSTRUCTIONS block
}
```

**`generateAndPersistNarrative`** already has `characterName` for the acting character. Extend it to accept `roomParticipantNames: string[]` from the mutation result — these are the characters present in the room at the time of the action.

**`lookupDatabaseContext`** already loads `roomInstance.participants` with character names. Pass them through to the narrative stage.

**Opening narrative** (in `session-starter.ts`): Include full party names and classes:

```
PARTY ARRIVING: Theron (Fighter, lvl 1), Syla (Rogue, lvl 1)
```

**Gate**: `npx tsc --noEmit` — verify the new parameter doesn't break existing callers (it's additive with a default of `[]`).

---

### Phase J — Dormancy + in-combat skip

**In `advanceTurn`** (`lib/v2/combat-engine.ts` after the refactor, currently in game-controller.ts):

The function already skips dead actors (hp=0). Extend it to also skip characters flagged as dormant. The `CombatState.initiativeOrder` entries for players should include an `isDormant` flag — set it from `RoomParticipant.lastActiveAt` when combat is entered via `enterCombat`.

Add `isDormant?: boolean` to `InitiativeEntry` in `types/v2-game.ts`.

In `enterCombat`, when building the initiative order for player characters, check if their `lastActiveAt` is stale and set the flag.

**Gate**: Unit test in `lib/v2/__tests__/enemy-ai.test.ts` — add a case where a dormant player entry is skipped by `advanceTurn`.

---

### Phase K — Enemy HP persistence

**Goal**: `PoiInstance.currentProperties.current_hp` is the authoritative HP for enemies at all times — not `combatState`, which is cleared when combat ends. This makes fleeing work correctly and survives log out/log in at any point.

**`enterCombat`** — when building `InitiativeEntry` for each enemy, read HP from the PoiInstance first:

```ts
const currentHp =
  (poi.currentProperties as Record<string, unknown>).current_hp as number | undefined
  ?? combatStats.max_hp;
```

`InitiativeEntry.id` for enemies **must** be the `PoiInstance.id` (not a synthetic ID) so the write-back path can resolve the correct row. Verify this in `enterCombat` and fix if needed.

**`resolveCombatAction`** — after every HP-changing hit, write back to the PoiInstance inside the same transaction:

```ts
await tx.poiInstance.update({
  where: { id: entry.id },   // entry.id is the PoiInstance.id
  data: {
    currentProperties: {
      ...(existingProps as object),
      current_hp: newHp,
    },
  },
});
```

**`exitCombat` (flee path)** — no extra work needed. HP is already in the DB from the per-hit writes. Clearing `combatState` is safe.

**`exitCombat` (victory path)** — enemies at `current_hp: 0` are already written. No change needed.

**Gate**: Unit test — simulate two hits on an enemy, call `exitCombat`, reload the PoiInstance from the mock DB, assert `current_hp` matches the post-combat value.

---

### Phase L — Mid-game host kick

**New route `DELETE /api/v2/sessions/[sessionId]/kick`**:

```ts
// Body: { characterId: string }
// Auth: requesting user must own the hostCharacterId of this session
```

Steps:
1. Verify requester owns `session.hostCharacterId`.
2. Delete all `RoomParticipant` rows for the target `characterId` in this session (across all rooms).
3. If `session.gameState === 'combat'`: load `combatState`, filter out the kicked character's `InitiativeEntry`, fix `activeActorIndex` if it pointed at or past the removed entry, write back.
4. Append `characterId` to `session.kickedCharacterIds` JSON array.
5. All steps in a single `prisma.$transaction`.

Kicked characters are rejected at `POST /api/v2/lobby/[sessionId]` (join) and at `handleGameAction` entry — check `kickedCharacterIds` contains their `characterId`.

The host cannot kick themselves.

**UI**: "Kick" button in `PartyTab` next to dormant or disruptive players, visible only to the host. Fires the route, then triggers a poll refresh.

**Gate**: `npx tsc --noEmit`.

---

### Phase M — Combat turn indicator

**Principle**: indicate "not your turn" by removing the action surface, not by adding a new indicator.

**When it is your turn**: no change — chat input + ActionChips appear as normal.

**When it is NOT your turn**: replace the entire bottom input row (text field + send button) with a single muted waiting pill:

```tsx
// In ChatTab, bottom input area:
const isMyTurn = combatState
  ? combatState.initiativeOrder[combatState.activeActorIndex]?.id === characterId
  : true; // exploration: always your turn

{isMyTurn
  ? <ChatInput ... />
  : (
    <div className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-slate-400 border-t border-slate-100">
      <span>⌛</span>
      <span>{combatState.initiativeOrder[combatState.activeActorIndex]?.name}'s turn</span>
    </div>
  )
}
```

No new component needed. No header change. The subtractive approach — the input disappearing — is more immediately obvious than any additive indicator because the player's thumb instinctively goes to the bottom to act.

**Gate**: `npx tsc --noEmit`. Touches `ChatTab` only, extracted in REFACTOR Phase 15.

---

## Refactor compatibility

These changes are structured to **not conflict with REFACTOR.md**:

| REFACTOR.md concern | LOBBY.md approach |
|--------------------|-------------------|
| `game-controller.ts` split | Lobby logic lives in new files (`session-starter.ts`, lobby API routes) — zero overlap with the split modules |
| `buildViewState` extraction to `view-state.ts` | `partyMembers` is added to the query in that function before it's extracted — the refactor just moves it as-is |
| `buildNarrativeSystemPrompt` extraction | `partyNames` parameter is additive; tests updated in REFACTOR Phase 6 already cover this |
| `advanceTurn` extraction to `combat-engine.ts` | `isDormant` flag addition is a type-safe additive change to `InitiativeEntry` |
| `play/page.tsx` split | `PartyTab` is one of the components extracted in REFACTOR Phase 15 — lobby changes go in that component before extraction |

**Recommended implementation order**: Implement LOBBY Phases A–K first (before starting REFACTOR), then run the refactor. The refactor carries the multiplayer code into the new module structure without needing a second pass.

---

### Phase N — Session Resume Screen

**Goal**: When a player navigates back to an active session, show a full-screen orientation card before the chat UI renders. Replaces the current inline `CombatResumeCard` as the primary re-entry surface.

**Information hierarchy** (settled):
1. **Phase banner** — combat (red) or exploration (teal), + who's up / who's being waited on
2. **Party list** — class icon + character name + class label + last seen
3. **Last event** — final DM message, one line
4. **Resume CTA** — tapping it dismisses the card and shows the play UI

**Last seen derivation**: no schema change needed. Query `Message` where `role = PLAYER` and `gameId = <current>`, group by `characterId`, take `max(createdAt)`. Returns a per-character timestamp without any new columns.

**Implementation**:

Extract a `ResumeScreen` component inside `app/v2/play/page.tsx`. It gates on the existing `showResumeCard` boolean (line ~2060) — same lifecycle, new visual.

```tsx
function ResumeScreen({
  gameState, phase, activeActorName, waitingOnName,
  partyMembers, lastDmMessage, onResume,
}: {
  gameState: 'exploration' | 'combat';
  phase: string;           // display label
  activeActorName?: string;
  waitingOnName?: string;
  partyMembers: ResumePartyMember[];
  lastDmMessage: string;
  onResume: () => void;
}) { ... }

interface ResumePartyMember {
  characterId: string;
  name: string;
  characterClass: string;
  lastSeenAt: string | null;   // ISO string from Message.createdAt
  isYou: boolean;
}
```

**Phase banner colors**: `combat` → `bg-red-50 border-red-200 text-red-700`, `exploration` → `bg-teal-50 border-teal-200 text-teal-700`.

**Last seen formatting**: `< 5m ago` → "Online now", `< 1h` → "Xm ago", `< 24h` → "Xh ago", `≥ 24h` → "X days ago". Pure display logic, no store.

**API change**: extend `GET /api/v2/room/state` response to include:
```ts
resumeData: {
  partyMembers: ResumePartyMember[];   // includes lastSeenAt
  lastDmMessage: string;
} | null   // null after first dismissal (server tracks nothing; client state only)
```

`lastSeenAt` is computed in `buildViewState` by adding one grouped query alongside the existing `recentNarrative` fetch:
```ts
const lastPlayerMessages = await prisma.message.groupBy({
  by: ['characterId'],  // characterId is nullable — filter non-null
  where: { gameId, role: 'PLAYER', characterId: { not: null } },
  _max: { createdAt: true },
});
```

The `ResumeScreen` is dismissed client-side (`setShowResumeCard(false)`) — no write to the server. The existing `CombatResumeCard` in the chat scroll is retained as a lightweight in-chat reminder after dismissal.

**Gate**: `npx tsc --noEmit`. Manual smoke test: close the tab on an active session, reopen it — resume screen shows correct phase, party, and last event before the chat renders.

---

## Closed decisions

1. **Max party size**: 4, matching V1. Enforced at `POST /api/v2/lobby/[sessionId]` (join) — reject if `lobbyState.length >= 4`.
2. **Character required to join**: Nobody — host included — can enter the lobby without an existing character. In the setup page, character selection is already required before a session can be created, so the host is covered. On the lobby page, unauthenticated users and users with no characters see a gate: "You need a hero first" with a link to setup. The join picker only shows characters not already in a live session.
3. **Session name**: Use dungeon template name + live player count — `"The Sunken Cellar — 2 players"`. Updated dynamically as members join. The `name` column on `GameSession` is written at session creation using the dungeon name; player count is derived at query time.
4. **Simultaneous actions**: First write wins, second player gets a stale-state response and retries naturally. No locking needed for MVP.
