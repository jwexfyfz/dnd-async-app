# Lobby + Multiplayer Plan

Covers: lobby phase, party tab, player avatars in chat, player names in narrative, and the four open design questions.

---

## Progress

Check off phases as they complete. If work stops mid-phase, mark the last completed step with `[x]` so the next session knows exactly where to resume.

- [ ] **Phase A** — Schema migration
- [ ] **Phase B** — Avatar persistence
- [ ] **Phase C** — Session creation → lobby redirect
- [ ] **Phase D** — Lobby API routes
- [ ] **Phase E** — session-starter.ts
- [ ] **Phase F** — Lobby page UI
- [ ] **Phase G** — Party tab + ViewStatePayload + polling
- [ ] **Phase H** — Player avatars in chat
- [ ] **Phase I** — Player names in narrative
- [ ] **Phase J** — Dormancy + in-combat skip
- [ ] **Phase K** — Enemy HP persistence
- [ ] **Phase L** — Mid-game host kick
- [ ] **Phase M** — Combat turn indicator
- [ ] **Phase N** — Session resume screen
- [ ] **Phase O** — Multi-PC combat initialization
- [ ] **Phase P** — Exploration action serialization

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

### `RoomInstance` — add 3 columns

```prisma
model RoomInstance {
  // ... existing fields ...
  gameState        String  @default("exploration")  // "exploration" | "combat" — moved from GameSession
  combatState      Json?                            // CombatState JSON — moved from GameSession
  processingAction Boolean @default(false)          // exploration action lock (Phase P)
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
| `app/api/v2/lobby/[sessionId]/start/route.ts` | POST — host-only; adds party members, flips gameState to active |
| `app/api/v2/lobby/[sessionId]/kick/route.ts` | DELETE — host-only; removes a member from lobbyState |
| `app/api/v2/sessions/[sessionId]/kick/route.ts` | DELETE — host-only mid-game kick; removes RoomParticipant records, splices from combatState, adds to kickedCharacterIds |
| `app/api/v2/user/ping/route.ts` | POST — updates User.lastSeenAt; called on play page mount |
| `lib/v2/session-starter.ts` | Pure logic: adds non-host party members, generates full-party opening narrative |

### Files modified

| File | What changes |
|------|-------------|
| `app/api/v2/sessions/route.ts` | `POST` keeps room + narrative creation unchanged; adds `hostCharacterId`, `lobbyState` (host entry), `gameState="lobby"` to the session. Writes `gameState`/`combatState` to `RoomInstance` instead of `GameSession`. Returns `{ sessionId, roomInstanceId }` as before. `GET` extended to return `partyMembers[]` per session for the session card roster. |
| `app/v2/setup/page.tsx` | After `POST /api/v2/sessions` succeeds, redirect to `/v2/lobby/[sessionId]` instead of `/v2/play`. Session cards show a compact avatar+class strip. |
| `lib/v2/game-controller.ts` | `handleGameAction` rejects when `session.gameState === "lobby"` or `character.isDead === true`. `enterCombat` iterates all room participants (Phase O). `advanceTurn` skips dormant characters (Phase J). Exploration action lock (Phase P). All combat state reads/writes target `roomInstance`. |
| `types/v2-game.ts` | Add `partyMembers` to `ViewStatePayload`. Add `authorAvatarUrl`/`authorName` to `NarrativeLog`. Add `isDormant` to `InitiativeEntry`. |
| `lib/v2/game-controller.ts` → `buildViewState` | Session-wide party member query. `partyMembers` in payload. `lastSeenAt` included via User join. |
| `app/v2/play/page.tsx` | `PartyTab` shows all party members. Chat messages show avatar. Polling `useEffect`. `ResumeScreen` component. `/api/v2/user/ping` on mount. |
| `app/api/v2/room/state/route.ts` | Remove partial `partyMembers` implementation (replaced by `buildViewState`). Add `resumeData` to response. |
| `prisma/schema.prisma` | As above — new columns on GameSession, Character, User, RoomInstance. |

---

## Implementation Phases

### Phase A — Schema migration

- [ ] Add to `GameSession`: `hostCharacterId String?`, `lobbyState Json @default("[]")`, `kickedCharacterIds Json @default("[]")`, `lobbyVersion Int @default(0)`. Update `gameState` comment to `"lobby" | "active" | "completed"`.
- [ ] Add `isDead Boolean @default(false)` to `Character`.
- [ ] Add `avatarUrl String?` and `lastSeenAt DateTime?` to `User`.
- [ ] Add `gameState String @default("exploration")`, `combatState Json?`, `processingAction Boolean @default(false)` to `RoomInstance`.
- [ ] Confirm `lastActiveAt` already exists on `RoomParticipant` — do **not** add it again.
- [ ] Run `npx prisma migrate dev --name lobby_and_multiplayer`.
- [ ] Run `npx prisma generate`.

### Tests — Phase A

**Migration correctness:**
- [ ] `npx prisma migrate dev --dry-run` lists exactly the expected new columns — no unexpected table drops, renames, or index changes
- [ ] After migration, query a `GameSession` row: `hostCharacterId` is `null`, `lobbyState` deserializes to `[]` (array, not string `"[]"`), `kickedCharacterIds` is `[]`, `lobbyVersion` is integer `0`
- [ ] After migration, query a `RoomInstance` row: `gameState` is string `"exploration"` (not null), `combatState` is `null`, `processingAction` is boolean `false` (not null)
- [ ] After migration, query a `Character` row: `isDead` is boolean `false` (not null)
- [ ] After migration, query a `User` row: `avatarUrl` is `null`, `lastSeenAt` is `null`
- [ ] Existing `GameSession` rows have their prior field values intact (no existing column values changed or zeroed)
- [ ] Existing `RoomInstance` rows are not deleted or modified beyond the new column defaults
- [ ] `RoomParticipant` table: `lastActiveAt` column already present — migration does NOT add a duplicate

**Post-migration build:**
- [ ] `npm run build` — zero TypeScript errors
- [ ] `npx tsc --noEmit` — zero type errors
- [ ] `npm test` — all pre-existing tests still pass (no regressions from generated client changes)

---

### Phase B — Avatar persistence

- [ ] In `app/auth/callback/route.ts`, upsert `User.avatarUrl` and `User.lastSeenAt`:

```ts
await prisma.user.upsert({
  where: { id: user.id },
  update: { displayName, avatarUrl: user.user_metadata?.avatar_url ?? null, lastSeenAt: new Date() },
  create: { id: user.id, email: user.email!, displayName, avatarUrl: user.user_metadata?.avatar_url ?? null, lastSeenAt: new Date() },
});
```

### Tests — Phase B

**First login:**
- [ ] `User.avatarUrl` is set to the Google profile picture URL from `user.user_metadata.avatar_url`
- [ ] `User.lastSeenAt` is set to a timestamp within a few seconds of the request

**Re-login (existing user):**
- [ ] `avatarUrl` updated if Google provides a new URL — old value not preserved
- [ ] `lastSeenAt` updated to current timestamp — confirms the upsert hits the `update` branch
- [ ] `avatarUrl` set to `null` if `user.user_metadata.avatar_url` is absent or undefined — does not keep the previous value

**Edge cases:**
- [ ] `user.user_metadata` entirely missing (non-Google OAuth or test user): `avatarUrl = null`, no crash
- [ ] `user.user_metadata.avatar_url` is an empty string `""`: treat as `null`, do not store empty string
- [ ] Two concurrent logins for the same user (two tabs): upsert is idempotent — no duplicate rows, no constraint violation
- [ ] Manual smoke test: log in with Google → open DB → `User.avatarUrl` is a valid `https://` URL, `lastSeenAt` is recent

---

### Phase C — Session creation → lobby redirect

- [ ] In `POST /api/v2/sessions`, add to `gameSession.create`: `hostCharacterId`, `gameState: 'lobby'`, `lobbyState` (single host entry, `status: 'ready'`), `kickedCharacterIds: []`, `lobbyVersion: 0`.
- [ ] Write `gameState: 'exploration'` and `combatState: null` on the `RoomInstance` (new columns). Do **not** write `combatState` or change `gameState` on `GameSession`.
- [ ] Confirm response shape is unchanged — still `{ sessionId, roomInstanceId }`.
- [ ] In `app/v2/setup/page.tsx`, change redirect from `/v2/play?session=...&char=...` to `/v2/lobby/${sessionId}`.
- [ ] Extend `GET /api/v2/sessions` to return `partyMembers[]` per session (deduped across rooms).
- [ ] Render compact avatar+class strip on session cards in setup page.

### Tests — Phase C

**POST — GameSession fields:**
- [ ] `GameSession.gameState` = `'lobby'`
- [ ] `GameSession.hostCharacterId` = requesting character ID
- [ ] `GameSession.lobbyState` = exactly 1 entry (host), `status: 'ready'`, all fields populated
- [ ] `GameSession.lobbyVersion` = `0`
- [ ] `GameSession.kickedCharacterIds` = `[]`
- [ ] `GameSession.combatState` is `null` — not written, not inherited from any prior value

**POST — RoomInstance fields:**
- [ ] `RoomInstance.gameState` = `'exploration'`
- [ ] `RoomInstance.combatState` = `null`
- [ ] `RoomInstance.processingAction` = `false`

**POST — Response and side effects:**
- [ ] Response shape is exactly `{ sessionId: string, roomInstanceId: string }` — no added or removed fields
- [ ] Host's `RoomParticipant` row exists in DB with correct `characterId`, `roomInstanceId`, and recent `lastActiveAt`
- [ ] `PoiInstance` rows exist for the start room's POIs (existing behavior unchanged)
- [ ] Opening narrative `MessageLog` entry exists (existing behavior unchanged) — contains host character name

**POST — Failure cases:**
- [ ] Invalid `dungeonTemplateId` → 400
- [ ] `characterId` belonging to a different user → 403
- [ ] Unauthenticated request → 401
- [ ] If session creation transaction fails mid-way: no orphaned `RoomInstance` or `RoomParticipant` rows (atomic)

**Setup page:**
- [ ] After successful POST, browser navigates to `/v2/lobby/[sessionId]`
- [ ] Setup page does NOT redirect to `/v2/play` — old redirect path is gone

**GET sessions:**
- [ ] Each session includes `partyMembers: []` or populated array
- [ ] `partyMembers` deduped when a character has `RoomParticipant`s in multiple rooms of the same session
- [ ] `avatarUrl` included per party member (may be null)

**Regression:**
- [ ] Solo play end-to-end still works: create session → room exists → narrative exists → can navigate to `/v2/lobby/[sessionId]` and proceed to play

---

### Phase D — Lobby API routes

- [ ] Implement `GET /api/v2/lobby/[sessionId]`.
- [ ] When `gameState !== 'lobby'`, return `{ gameState: 'active', redirectTo: '/v2/play?...' }`.
- [ ] Implement `POST /api/v2/lobby/[sessionId]` (join) with `lobbyVersion` optimistic lock.
- [ ] Implement `PATCH /api/v2/lobby/[sessionId]` (ready toggle). Host always stays `'ready'`.
- [ ] Implement `DELETE /api/v2/lobby/[sessionId]` (leave) with host promotion logic.
- [ ] Implement `DELETE /api/v2/lobby/[sessionId]/kick` (host-only lobby kick).

### Tests — Phase D

**GET:**
- [ ] Returns `members` array matching current `lobbyState`
- [ ] Returns `shareUrl` = origin + `/v2/lobby/[sessionId]`
- [ ] Returns `hostCharacterId` correctly
- [ ] Returns `dungeonName` from the dungeon template
- [ ] `gameState === 'active'`: returns `{ gameState: 'active', redirectTo: '...' }` — no `members` field
- [ ] `gameState === 'completed'`: returns appropriate completed state (no redirect to play)
- [ ] Session not found → 404
- [ ] Unauthenticated → 401

**POST (join) — happy path:**
- [ ] Member appears in `lobbyState` with `status: 'joined'`, all fields populated
- [ ] `lobbyVersion` incremented by exactly 1

**POST (join) — concurrency:**
- [ ] Two requests sent simultaneously with the same `lobbyVersion`: exactly one succeeds (200), the other returns 409
- [ ] The 409 response body contains a human-readable retry message
- [ ] After the race, `lobbyState` has exactly one new member (not two, not zero)
- [ ] `lobbyVersion` incremented by exactly 1 (not 2) after the race resolves

**POST (join) — validation rejections:**
- [ ] Lobby at 4 members → 400 ("Party is full")
- [ ] `gameState !== 'lobby'` → 400 with clear message ("Session has already started")
- [ ] `gameState === 'completed'` → 400
- [ ] Character in `kickedCharacterIds` → 403
- [ ] Character already present in `lobbyState` → 400 (no duplicate entry)
- [ ] Character currently in another live (non-lobby) session → 400
- [ ] Character with `isDead = true` → 400 (dead characters cannot join new sessions)
- [ ] `characterId` not belonging to authenticated user → 403
- [ ] Request body missing `characterId` → 400
- [ ] Unauthenticated → 401

**PATCH (ready toggle):**
- [ ] Non-host `'joined'` → `'ready'`: updated in `lobbyState`
- [ ] Non-host `'ready'` → `'joined'`: updated in `lobbyState`
- [ ] Host's entry: PATCH ignored or returns 400 — host stays `'ready'` regardless
- [ ] Character not in `lobbyState` → 404
- [ ] `gameState !== 'lobby'` → 400

**DELETE (leave):**
- [ ] Non-host leaves: entry removed from `lobbyState`
- [ ] `lobbyVersion` incremented on leave (invalidates in-flight join attempts)
- [ ] Host leaves with ≥1 `'ready'` non-host member: first `'ready'` member set as `hostCharacterId`
- [ ] Host leaves with only `'joined'` (not ready) members: first member in array promoted regardless
- [ ] Host leaves as only member: session is deleted from DB entirely
- [ ] Character not in `lobbyState` → 404

**DELETE (lobby kick):**
- [ ] Host kicks non-host: that entry removed from `lobbyState`
- [ ] `lobbyVersion` incremented after kick
- [ ] Non-host attempting kick → 403
- [ ] Host attempting to kick themselves → 400
- [ ] Kicking a character not in `lobbyState` → 404

---

### Phase E — `lib/v2/session-starter.ts`

Invoked when the host clicks "Start Adventure". The `RoomInstance` already exists (created at session creation) — this function adds remaining party members and starts play.

```ts
export async function startSession(sessionId: string, hostUserId: string): Promise<void>
```

- [ ] Load session, verify `hostCharacterId` belongs to `hostUserId`, verify `gameState === 'lobby'`.
- [ ] Load existing `RoomInstance` for this session.
- [ ] For each non-host lobby member, create a `RoomParticipant` with `lastActiveAt = now`.
- [ ] Flip `GameSession.gameState` to `'active'`.
- [ ] Generate new opening narrative with full party context (all names and classes).
- [ ] Write narrative as `MessageLog` on the room instance.
- [ ] Wrap steps 3–6 in a single `prisma.$transaction`.

### Tests — Phase E

**Happy path:**
- [ ] `startSession` creates one `RoomParticipant` per non-host lobby member
- [ ] Host's `RoomParticipant` is NOT duplicated (was created at session creation)
- [ ] Each new `RoomParticipant` has `lastActiveAt` set to a recent timestamp
- [ ] `GameSession.gameState` = `'active'` after call
- [ ] A new `MessageLog` entry exists containing all party member names and classes
- [ ] The solo narrative written at session creation is superseded — the new multi-party narrative is the latest entry in the log

**Authorization and state guards:**
- [ ] Called by a user who does not own `hostCharacterId` → error (403 or thrown)
- [ ] Called when `gameState !== 'lobby'` → error without modifying DB (idempotency guard)
- [ ] Double-click (two concurrent calls): second call sees `gameState = 'active'` and returns early — DB not corrupted, no duplicate `RoomParticipant`s

**Transaction atomicity:**
- [ ] If the AI narrative call fails: transaction rolled back — no new `RoomParticipant`s created, `gameState` still `'lobby'`
- [ ] If a `RoomParticipant` create fails (e.g., constraint violation): entire transaction rolled back

**Edge cases:**
- [ ] Lobby member whose `Character` row was deleted between join and start: error surfaced clearly, not a silent partial start
- [ ] Lobby with only the host (no other members): `startSession` still succeeds — `gameState` flips to `'active'`, narrative written (solo start)

**Observable side effects:**
- [ ] After `startSession`, `GET /api/v2/lobby/[sessionId]` returns `{ gameState: 'active', redirectTo: '...' }`
- [ ] Unit test: party-context-builder pure function formats `"PARTY ARRIVING: Theron (Fighter, lvl 1), Syla (Rogue, lvl 1)"` correctly from a `LobbyMember[]`
- [ ] Unit test: builder handles a single member (no comma, no plural)
- [ ] Unit test: builder handles names containing apostrophes or special characters without breaking the prompt string

---

### Phase F — Lobby page `app/v2/lobby/[sessionId]/page.tsx`

- [ ] Party roster at top: avatar+class stacks per member, dashed empty slots up to 4.
- [ ] Gate logic: unauthenticated / no characters / not joined / already joined.
- [ ] Poll `GET /api/v2/lobby/[sessionId]` every 3 seconds.
- [ ] On `gameState === 'active'` in poll: `router.replace('/v2/play?...')`.
- [ ] Share URL: copy button copies `window.location.href`. Label: `"Invite link"`.
- [ ] Ready button: non-hosts only. Start button: host only, enabled when all `'ready'`.
- [ ] Leave button calls `DELETE /api/v2/lobby/[sessionId]`.

### Tests — Phase F

**Gate logic:**
- [ ] Unauthenticated: roster visible, "Sign in to join" shown, no join picker
- [ ] Authenticated, no characters: "You need a hero first" link shown, no join picker
- [ ] Authenticated with character, not in lobby: join picker shown below roster
- [ ] Already in lobby: Ready toggle + Leave button visible; join picker not rendered
- [ ] Character with `isDead = true` in join picker: not shown as a selectable option

**Roster rendering:**
- [ ] Each roster slot shows Google avatar (or class emoji fallback) + class label + character name + status chip
- [ ] Empty slots (up to 4 total) rendered as dashed circles
- [ ] Class emoji fallback renders when `avatarUrl` is null or image fails to load

**Buttons and interactions:**
- [ ] Start button disabled when any member has `status: 'joined'`
- [ ] Start button enabled when all members have `status: 'ready'`
- [ ] Start button not rendered for non-hosts
- [ ] Ready button not rendered for host
- [ ] Invite link button writes `window.location.href` to clipboard on click
- [ ] Clipboard API unavailable (HTTP context or denied permission): fallback shown (e.g., selectable URL input), no crash
- [ ] Host double-clicks Start: only one `startSession` call fires (button disabled after first click)

**Polling behavior:**
- [ ] Poll detects `gameState: 'active'` and navigates to play page
- [ ] Non-host browser auto-navigates when host starts — no user action required
- [ ] Poll fails with network error: stale UI preserved, no crash, no error modal
- [ ] Poll returns 404 (session deleted): graceful error state shown ("Session no longer exists")
- [ ] Host leaving with 2 members: remaining member sees updated roster (new host) within one poll cycle

**Full lobby:**
- [ ] Join link opened when lobby is full (4/4): roster visible, join picker shows "Party Full", POST not sent

**Manual smoke test:**
- [ ] Create session → lobby shows host avatar → copy invite link → second account navigates → joins → appears in roster within 3 seconds → both toggle ready → Start button enables → host starts → both tabs navigate to play

---

### Phase G — Party tab + ViewStatePayload + polling

- [ ] Add `PartyMemberInfo` and `partyMembers: PartyMemberInfo[]` to `ViewStatePayload` in `types/v2-game.ts`.
- [ ] In `buildViewState`, add session-wide participants query including `user.lastSeenAt`.
- [ ] `isDormant` = `lastActiveAt < Date.now() - 48h`.
- [ ] Remove the partial `partyMembers` from `app/api/v2/room/state/route.ts` — `buildViewState` is the single source.
- [ ] Add polling `useEffect` to `play/page.tsx` (3s, skips when it's your combat turn).
- [ ] Update `PartyTab` to render all `partyMembers`.

### Tests — Phase G

**buildViewState query:**
- [ ] Returns `partyMembers` for all session participants, including those in other rooms
- [ ] Character in a different room: `isInSameRoom: false`, `currentRoom` = correct room template name
- [ ] `isDormant: true` when `RoomParticipant.lastActiveAt` > 48h ago
- [ ] `isDormant: false` when `RoomParticipant.lastActiveAt` < 48h ago
- [ ] `isDead: true` propagated correctly from `Character.isDead`
- [ ] `partyMembers` ordering is deterministic (e.g., by `RoomParticipant.createdAt`) — not random between calls
- [ ] `partyMembers` does not include duplicate entries when a character has stale records in multiple rooms
- [ ] Orphaned `RoomParticipant` (character row deleted): query does not crash; orphan excluded from results gracefully
- [ ] `user.lastSeenAt` included per party member in the query result

**Single source of truth:**
- [ ] `app/api/v2/room/state/route.ts` no longer has its own `partyMembers` computation — verify the old code is deleted, not just unused
- [ ] `GET /api/v2/room/state` response still includes `partyMembers` (now from `buildViewState`)

**Polling `useEffect`:**
- [ ] `setInterval` fires approximately every 3 seconds in exploration
- [ ] `clearInterval` called on component unmount — no memory leak (verify with React DevTools or test)
- [ ] Polling is skipped when `gameState === 'combat'` AND `combatState.activeActorId === characterId`
- [ ] Polling resumes within one cycle when `activeActorId` changes to a different actor
- [ ] Poll response with HTTP 4xx or 5xx: silently ignored, no crash, no state reset
- [ ] Poll response with stale/unchanged data: no unnecessary re-renders (state set only if values differ)
- [ ] Player B's UI reflects Player A's action within ≤ 3 seconds of Player A's response completing

**PartyTab rendering:**
- [ ] All party members rendered, not just self
- [ ] Avatar image shown when `avatarUrl` present; class emoji fallback when null
- [ ] Dormant badge shown when `isDormant: true`
- [ ] Dead/tombstone badge shown when `isDead: true`
- [ ] Room name shown when `isInSameRoom: false`
- [ ] `npx tsc --noEmit` — `partyMembers` addition causes zero type errors in existing consumers

---

### Phase H — Player avatars in chat

- [ ] Extend `recentNarrative` query to join `character → user → avatarUrl`.
- [ ] Add `authorAvatarUrl: string | null` and `authorName: string | null` to `NarrativeLog`.
- [ ] In `ChatMessage`: render 24px `<img>` (player with avatar), class emoji (player without), `🎲` (DM/no characterId).

### Tests — Phase H

**Rendering:**
- [ ] Player message with `avatarUrl` set: `<img src="...">` rendered at 24×24px with `rounded-full`
- [ ] Player message with `avatarUrl: null`: class emoji badge rendered — no broken `<img>` tag
- [ ] DM message (`characterId: null`): `🎲` icon shown, no `<img>`, no class emoji
- [ ] `<img>` has a non-empty `alt` attribute (accessibility — e.g., character name)
- [ ] Broken avatar URL (image 404s): layout does not shift; emoji fallback renders or img placeholder shown gracefully

**Security:**
- [ ] `avatarUrl` containing `javascript:alert(1)` is not rendered as `<img src>` — sanitize or validate `https://` scheme only before rendering
- [ ] `avatarUrl` containing an arbitrary non-Google domain: rendered normally (no domain allowlist required, but `javascript:` scheme must be blocked)

**Data integrity:**
- [ ] `authorAvatarUrl` resolved at query time from `User.avatarUrl` — not stored in `MessageLog` row
- [ ] `authorName` matches the `Character.name` on the message
- [ ] `MessageLog` with null `character` relation (historical data written before this phase): renders without crash; `authorAvatarUrl` defaults to null, `authorName` defaults to null
- [ ] `npx tsc --noEmit` — `NarrativeLog` additions cause zero errors in existing consumers

---

### Phase I — Player names in narrative

- [ ] Add `partyNames: string[] = []` to `buildNarrativeSystemPrompt`. Prepend party line when `partyNames.length > 1`.
- [ ] Extend `generateAndPersistNarrative` to accept `roomParticipantNames: string[]`.
- [ ] Pass participant names from `lookupDatabaseContext` through to narrative stage.
- [ ] Opening narrative in `session-starter.ts` includes all party names and classes.

### Tests — Phase I

**Prompt construction:**
- [ ] `buildNarrativeSystemPrompt` with `partyNames = ['Theron', 'Syla']`: rendered prompt contains `"PARTY MEMBERS IN THIS ROOM: Theron, Syla"`
- [ ] With `partyNames = ['Theron']` (solo): no `PARTY MEMBERS` line — existing solo behavior unchanged
- [ ] With `partyNames = []` (default): no line, no crash
- [ ] Names with apostrophes (`O'Brien`): prompt string not broken or truncated
- [ ] Names with quotes: prompt string not broken
- [ ] 4 party members: all 4 names appear in prompt; prompt length stays within reasonable token budget (< 50 additional tokens)

**Opening narrative:**
- [ ] Narrative generated by `session-starter.ts` textually references all party member names
- [ ] Format matches `"PARTY ARRIVING: Theron (Fighter, lvl 1), Syla (Rogue, lvl 1)"`

**Backward compatibility:**
- [ ] All existing callers of `buildNarrativeSystemPrompt` that do not pass `partyNames` still compile and produce valid prompts
- [ ] `npx tsc --noEmit` across all callers

---

### Phase J — Dormancy + in-combat skip

**Prerequisite**: Phase O must be complete.

- [ ] Add `isDormant?: boolean` to `InitiativeEntry`.
- [ ] In `enterCombat`, set `isDormant: true` for PCs where `lastActiveAt < Date.now() - 48h`.
- [ ] In `advanceTurn`, skip entries where `isDormant === true`.
- [ ] Guard against infinite loop: if all remaining entries are dormant or dead, end combat (or throw a detectable error).
- [ ] All `combatState` reads/writes target `roomInstance.combatState`.

### Tests — Phase J

**advanceTurn skip logic:**
- [ ] 1 dormant PC + 2 active PCs + 2 enemies: dormant PC's slot is skipped in every round
- [ ] Turn correctly advances to the next non-dormant, living actor after the dormant slot
- [ ] Dormant PC at the end of the initiative list: round wraps correctly without including them
- [ ] Dormant PC at position 0: first turn goes to position 1 (or next non-dormant)

**All-dormant / all-dead edge cases:**
- [ ] All PCs dormant, enemies alive: enemies cycle through their turns; no PC turn ever fires
- [ ] All PCs dead (hp=0), enemies alive: same as above — no PC turn fires, no infinite loop
- [ ] All PCs dormant AND all enemies dead: `advanceTurn` detects no valid actors and ends combat (does not loop forever)
- [ ] Mix of dormant + dead PCs, no living enemies: combat ends, `roomInstance.gameState` flips to `'exploration'`

**enterCombat dormancy stamping:**
- [ ] PC with `lastActiveAt` = 49h ago: `isDormant: true` in `InitiativeEntry`
- [ ] PC with `lastActiveAt` = 47h ago: `isDormant: false`
- [ ] PC with `lastActiveAt` = now: `isDormant: false`

**combatState location:**
- [ ] After `enterCombat`: `roomInstance.combatState` set, `session.combatState` NOT modified
- [ ] After `advanceTurn`: `roomInstance.combatState` updated with new `activeActorId`

**Unit test:**
- [ ] New test case in `lib/v2/__tests__/enemy-ai.test.ts`: dormant player skipped, turn passes to next valid actor

---

### Phase K — Enemy HP persistence

- [ ] In `enterCombat`, read `current_hp` from `PoiInstance.currentProperties`; fall back to `combatStats.max_hp`.
- [ ] Verify `InitiativeEntry.id` for enemies is `PoiInstance.id` (not synthetic). Fix if needed.
- [ ] In `resolveCombatAction`, write `current_hp` to `PoiInstance` inside the same transaction.
- [ ] `exitCombat`: clear `roomInstance.combatState`, set `roomInstance.gameState = 'exploration'`. Do not touch `session.combatState`.

### Tests — Phase K

**enterCombat HP loading:**
- [ ] Enemy `InitiativeEntry.hp` matches `PoiInstance.currentProperties.current_hp` when set
- [ ] Falls back to `combatStats.max_hp` when `current_hp` key absent from `currentProperties`
- [ ] Falls back to `combatStats.max_hp` when `PoiInstance.currentProperties` is entirely null
- [ ] Enemy with `current_hp = 0` in `PoiInstance`: excluded from combat entirely (already dead from a prior session) — does not appear in `initiativeOrder`
- [ ] `entry.id` for every enemy equals the `PoiInstance.id` in the DB (not a generated UUID)

**resolveCombatAction HP write:**
- [ ] After a hit, `PoiInstance.currentProperties.current_hp` updated in DB to new value
- [ ] Write is inside the same Prisma transaction as the `combatState` update — both succeed or both fail together
- [ ] Simulate transaction failure after HP write: `PoiInstance.currentProperties` unchanged, `roomInstance.combatState` unchanged
- [ ] Multiple hits in the same combat round: HP decrements are cumulative (each hit reads from DB or passes current value correctly)

**exitCombat:**
- [ ] Flee path: `roomInstance.combatState` = null, `roomInstance.gameState` = `'exploration'`
- [ ] Flee path: `session.combatState` NOT modified
- [ ] Victory path: same `roomInstance` update as flee

**Re-entry scenario:**
- [ ] Deal 5 damage to enemy (max HP 20) → flee → re-enter room → `enterCombat` → enemy appears with HP 15, not 20

---

### Phase L — Mid-game host kick

**Prerequisite**: Phase A migration must have run.

- [ ] Implement `DELETE /api/v2/sessions/[sessionId]/kick`.
- [ ] Verify requester owns `session.hostCharacterId`.
- [ ] Delete all `RoomParticipant` rows for target across all rooms.
- [ ] For each `RoomInstance` in combat: remove target's `InitiativeEntry`, advance turn if target was active.
- [ ] Append `characterId` to `session.kickedCharacterIds`.
- [ ] Wrap all steps in `prisma.$transaction`.
- [ ] Block kicked characters at `handleGameAction` and `POST /api/v2/lobby/[sessionId]`.
- [ ] Add "Kick" button in `PartyTab`, host-only.

### Tests — Phase L

**Core behavior:**
- [ ] Kick removes all `RoomParticipant` rows for target in this session (across all rooms, not just current room)
- [ ] Kick appends `characterId` to `session.kickedCharacterIds`
- [ ] Kicked character calling `handleGameAction` → 403
- [ ] Kicked character calling `POST /api/v2/lobby/[sessionId]` → 403

**Combat splice:**
- [ ] Target in active combat: their `InitiativeEntry` removed from `roomInstance.combatState`
- [ ] Target was the active actor: `activeActorId` advances to the next living, non-dormant actor
- [ ] Target was the active actor and was the last PC: if no other PCs remain, combat ends gracefully (enemies win or combat exits)
- [ ] Target in a different room's combat (not currently in the requesting player's room): their entry removed from that room's `combatState` as well

**Authorization:**
- [ ] Non-host calling kick → 403
- [ ] Host kicking themselves → 400
- [ ] Target not in session → 404

**Atomicity:**
- [ ] Simulate failure after `RoomParticipant` delete but before `kickedCharacterIds` update: transaction rolled back — `RoomParticipant` rows restored, `kickedCharacterIds` unchanged
- [ ] All DB changes committed or none — no partial state

**Edge cases:**
- [ ] Kick a dead character (spectator): succeeds — removes `RoomParticipant`, character can no longer read chat
- [ ] Kick a dormant character: succeeds
- [ ] After kick, other players see target absent from `partyMembers` within ≤ one poll cycle

**UI:**
- [ ] Kick button visible only to host in `PartyTab`
- [ ] Kick button not rendered for the host's own entry

---

### Phase M — Combat turn indicator

- [ ] Derive `isMyTurn = combatState ? combatState.activeActorId === characterId : true`.
- [ ] When `isMyTurn`: render `ChatInput` + ActionChips.
- [ ] When `!isMyTurn`: replace bottom input row with muted waiting pill showing active actor's name.

### Tests — Phase M

**Turn state rendering:**
- [ ] `combatState.activeActorId === characterId`: `ChatInput` is rendered, waiting pill absent
- [ ] `combatState.activeActorId !== characterId` (another player's turn): waiting pill rendered, `ChatInput` absent
- [ ] `combatState.activeActorId` is an enemy ID (enemy's turn): waiting pill rendered showing enemy name
- [ ] `combatState === null` (exploration): `ChatInput` always rendered regardless of any other state

**Edge cases:**
- [ ] Waiting pill when `combatState.initiativeOrder` is empty: no crash, pill rendered with a safe fallback name
- [ ] `activeActorId` references a character that was just kicked (entry no longer in `initiativeOrder`): no crash; pill shows safe fallback or "Unknown"
- [ ] `combatState` arrives via poll update mid-render: UI correctly transitions from ChatInput → waiting pill (or vice versa) without flicker or stale state

**Gate:**
- [ ] `npx tsc --noEmit` — no type errors; touches `ChatTab` only

---

### Phase N — Session resume screen

- [ ] Add `POST /api/v2/user/ping` route (auth-gated, updates `User.lastSeenAt`, returns 204).
- [ ] Call `/api/v2/user/ping` on play page mount.
- [ ] Extract `ResumeScreen` component gated on `showResumeCard`.
- [ ] `ResumeScreen` shows: phase banner, active actor name (combat only), party list + last seen, last DM message, Resume CTA.
- [ ] Extend `GET /api/v2/room/state` response with `resumeData`.
- [ ] `gameState` on banner derived from `roomInstance.gameState`.

### Tests — Phase N

**`/api/v2/user/ping`:**
- [ ] POST → `User.lastSeenAt` updated in DB to current timestamp
- [ ] Unauthenticated POST → 401, `lastSeenAt` unchanged
- [ ] Concurrent pings for the same user: no constraint violation, last write wins

**ResumeScreen visibility:**
- [ ] Shown on first play page load (`showResumeCard === true`)
- [ ] Dismissed after tapping Resume (`showResumeCard === false`, resume screen unmounted)
- [ ] Page refresh: `showResumeCard` resets to `true` — resume screen shown again
- [ ] `/api/v2/user/ping` failing silently: page loads normally, no error shown to user

**Phase banner:**
- [ ] Combat: red color scheme (`bg-red-50`), `activeActorName` rendered
- [ ] Exploration: teal color scheme (`bg-teal-50`), no `activeActorName` rendered
- [ ] `gameState` sourced from `roomInstance.gameState`, not `session.gameState`
- [ ] Split-party scenario: Player A in Room 1 (combat) and Player B in Room 2 (exploration) each see their own room's correct phase banner

**Party list:**
- [ ] All session participants shown, not just same-room participants
- [ ] `lastSeenAt` < 5 min ago → "Online now"
- [ ] `lastSeenAt` = 30 min ago → "30m ago"
- [ ] `lastSeenAt` = 2 days ago → "2 days ago"
- [ ] `lastSeenAt = null` → "Never" (graceful fallback, no crash)
- [ ] `lastSeenAt` in the future (clock skew between server and client): treated as "Online now" (clamp to zero, don't show negative time)
- [ ] Solo play (1 party member): renders correctly with just the one entry

**Last DM message:**
- [ ] `lastDmMessage` = text of the most recent `MessageLog` where `characterId` is null
- [ ] No DM messages yet (fresh session): `lastDmMessage` shows graceful placeholder ("Adventure is just beginning…" or similar), not a crash or blank

**Layout:**
- [ ] `ResumeScreen` does not prevent scrolling the chat history behind it
- [ ] Manual smoke test: close tab on active session, reopen — resume screen appears with correct phase, party, and last message before chat renders

---

### Phase O — Multi-PC combat initialization

- [ ] Change `enterCombat` to accept `roomInstance` with `participants[]` instead of single `characterId`.
- [ ] Load all participant character stats in one `findMany` query.
- [ ] Build one `InitiativeEntry` per PC.
- [ ] Write `CombatState` to `roomInstance.combatState`; set `roomInstance.gameState = 'combat'`.
- [ ] Update all callers.

### Tests — Phase O

**Initiative order construction:**
- [ ] 3 PCs + 2 enemies: `initiativeOrder` has exactly 5 entries
- [ ] Each PC entry has correct `name`, `hp`, `maxHp`, `ac` from their `Character` row
- [ ] Each PC initiative roll is within valid range: `1d20 + dex_mod` (verify bounds, not exact value)
- [ ] Initiative ties between two PCs: broken deterministically (e.g., higher dex wins; same dex: alphabetical) — specify and test the tiebreaker
- [ ] Initiative ties between PC and enemy: same deterministic rule applied

**combatState persistence:**
- [ ] `roomInstance.combatState` written to DB with correct `initiativeOrder`, `round: 1`, valid `activeActorId`
- [ ] `session.combatState` NOT modified
- [ ] `roomInstance.gameState` = `'combat'`

**Edge cases:**
- [ ] `roomInstance.participants` is empty (all players left before combat triggered): `enterCombat` called — result is only enemies in initiative, no PC entries; or guard returns early without starting combat (define and test)
- [ ] `enterCombat` called when `roomInstance.gameState` is already `'combat'` (re-entry guard): does not overwrite existing `combatState`; returns existing state or throws
- [ ] Orphaned `RoomParticipant` (character row deleted): excluded from initiative gracefully; no crash
- [ ] Single-player regression: 1 participant → exactly 1 PC entry in `initiativeOrder`

**Callers:**
- [ ] `npx tsc --noEmit` — all callers of `enterCombat` compile after signature change

---

### Phase P — Exploration action serialization

- [ ] Add `processingAction` lock in `handleGameAction` before exploration actions.
- [ ] Return `409` if lock not acquired.
- [ ] Release lock in `finally` block.
- [ ] Exempt combat actions from lock.

### Tests — Phase P

**Lock acquisition:**
- [ ] First exploration action: `processingAction` set to `true` in DB while in-flight
- [ ] Second exploration action sent while first is processing: receives 409 with human-readable retry message
- [ ] After first action completes: `processingAction` reset to `false`

**Lock release reliability:**
- [ ] Action handler throws mid-processing (simulate with a mock): `processingAction` still reset to `false` via `finally` block
- [ ] Verify the lock-release `update` call in `finally` targets the correct `roomInstanceId` — not a global reset

**Scope isolation:**
- [ ] Two different `RoomInstance`s can process exploration actions concurrently — their locks are independent (Player A in Room 1 and Player B in Room 2 don't block each other)
- [ ] Combat action in the same room as a locked exploration: combat action succeeds without waiting for the lock

**Failure modes:**
- [ ] Server restart with `processingAction = true` in DB: subsequent requests to that room are permanently blocked with 409. **This is a known limitation** — document the manual resolution: `UPDATE "RoomInstance" SET "processingAction" = false WHERE id = '<id>'`. There is no automatic timeout for MVP.

**Solo play regression:**
- [ ] Single-player exploration: actions still process normally, no 409 on solo use

---

## E2E Test Scenarios

These are manual (or Playwright) flows that verify phase interactions end-to-end. Run after all phases complete.

### E2E-1: Full lobby → play flow

1. Host creates session → lands on `/v2/lobby/[sessionId]`
2. Host copies invite link → second account navigates to it
3. Player 2 joins → appears in roster within 3 seconds; status `'joined'`
4. Player 2 toggles Ready → status `'ready'`
5. Host's Start button enables
6. Host clicks Start (once) → `startSession` fires
7. Both browser tabs redirect to `/v2/play?...` within one poll cycle
8. Opening narrative visible on both tabs contains both character names and classes

**Pass criteria**: both players on play page, same narrative visible, party tab shows 2 members.

### E2E-2: Split-party rooms, independent game states

1. 2-player session, both in Room A (exploration)
2. Player 1 moves to Room B
3. Player 1 triggers combat in Room B
4. Player 2 remains in Room A

**Pass criteria**:
- Player 1 (Room B): combat UI, red phase banner on resume
- Player 2 (Room A): exploration UI, teal phase banner on resume, `ChatInput` always shown
- `session.gameState` remains `'active'` — not `'combat'`

### E2E-3: Async turn visibility

1. Both players in same room, combat started, Round 1
2. Player A is first in initiative → sends attack action
3. Player B has not acted; is polling (not their turn)

**Pass criteria**: within ≤ 3 seconds of Player A's action resolving, Player B's UI shows: new narrative message, Player A marked as `acted: true`, turn indicator shows it is now Player B's turn.

### E2E-4: Concurrent lobby join

1. Session with 3 members (3/4)
2. Two different users navigate to lobby URL simultaneously
3. Both click Join at the same moment

**Pass criteria**: lobby reaches exactly 4/4 — not 5. One user receives 409 with retry message. The 409 user's UI shows the message clearly (toast or inline). After the 409, the user sees the lobby is now full.

### E2E-5: Kick mid-combat

1. 4-player session, all in same room, combat Round 2
2. Player 3 (Korr) is the current active actor
3. Host opens `PartyTab` and kicks Korr

**Pass criteria**:
- Korr's `InitiativeEntry` removed from `roomInstance.combatState`
- Turn advances to the actor after Korr's position
- Other players' `partyMembers` reflect Korr's absence within one poll cycle
- Korr navigating to the session URL → `handleGameAction` returns 403

### E2E-6: Enemy HP persists across flee and re-enter

1. Player starts combat with enemy (max HP 20)
2. Player hits enemy for 8 damage (HP → 12)
3. Player flees room → `roomInstance.combatState` cleared
4. Player re-enters the same room

**Pass criteria**: `enterCombat` called again — enemy's `InitiativeEntry.hp` = 12, not 20. Confirmed via DB query before and after.

### E2E-7: Dormant player mid-combat

1. 3-player session in combat
2. Player 2's `RoomParticipant.lastActiveAt` is > 48h ago
3. Initiative reaches Player 2's slot

**Pass criteria**: `advanceTurn` skips Player 2 automatically. Round progresses without input from Player 2. Party tab shows Player 2 with "Away" badge. No combat stall.

### E2E-8: Resume screen per room

1. Player A in Room 1 (combat, Round 3, Syla's turn)
2. Player B in Room 2 (exploration)
3. Both close tabs and reopen

**Pass criteria**:
- Player A: red combat banner, "Syla's turn", correct party list, last DM message from Room 1
- Player B: teal exploration banner, no active actor line, correct party list, last DM message from Room 2

### E2E-9: processingAction stuck recovery

1. Player sends exploration action; server crashes mid-handler before `finally` runs
2. `processingAction` is stuck `true` in DB
3. Player attempts to send another action

**Pass criteria**: player receives 409 with retry message. The document for ops resolution (`UPDATE "RoomInstance" SET "processingAction" = false WHERE id = '...'`) is known and accessible.

---

## Refactor compatibility

These changes are structured to **not conflict with REFACTOR.md**:

| REFACTOR.md concern | LOBBY.md approach |
|--------------------|-------------------|
| `game-controller.ts` split | Lobby logic lives in new files (`session-starter.ts`, lobby API routes) — zero overlap with the split modules |
| `buildViewState` extraction to `view-state.ts` | `partyMembers` is added to the query in that function before it's extracted — the refactor just moves it as-is |
| `buildNarrativeSystemPrompt` extraction | `partyNames` parameter is additive; tests updated in REFACTOR Phase 6 already cover this |
| `advanceTurn` extraction to `combat-engine.ts` | `isDormant` flag addition is a type-safe additive change to `InitiativeEntry` |
| `combatState` / `gameState` move to `RoomInstance` | All game-controller reads/writes target `roomInstance` fields; `session.combatState` is never written after Phase A — the refactor carries the updated code as-is |
| `play/page.tsx` split | `PartyTab` is one of the components extracted in REFACTOR Phase 15 — lobby changes go in that component before extraction |

**Recommended implementation order**: Implement LOBBY Phases A–K, O, P first (before starting REFACTOR), then run the refactor. The refactor carries the multiplayer code into the new module structure without needing a second pass.

---

## Closed decisions

1. **Max party size**: 4, matching V1. Enforced at `POST /api/v2/lobby/[sessionId]` (join) — reject if `lobbyState.length >= 4`.
2. **Character required to join**: Nobody — host included — can enter the lobby without an existing character. In the setup page, character selection is already required before a session can be created, so the host is covered. On the lobby page, unauthenticated users and users with no characters see a gate: "You need a hero first" with a link to setup. The join picker only shows characters not already in a live session.
3. **Session name**: Use dungeon template name + live player count — `"The Sunken Cellar — 2 players"`. Updated dynamically as members join. The `name` column on `GameSession` is written at session creation using the dungeon name; player count is derived at query time.
4. **Simultaneous exploration actions**: First-in wins via `processingAction` lock. Second caller receives 409 with retry message. No queuing — the retry is the player's responsibility.
5. **Dormant rejoin mid-combat**: `isDormant` is stamped at `enterCombat` time. Rejoining mid-combat does not immediately clear the flag — the player must wait for the next combat (or for a host to kick and reinvite) to be re-added to initiative. Known limitation, acceptable for async play.
6. **`session.combatState` not removed immediately**: The column is left in place after the migration but never written. A follow-up migration can drop it once all code paths are confirmed to use `roomInstance.combatState`.
7. **`processingAction` stuck on server crash**: No automatic timeout for MVP. Manual DB resolution required: `UPDATE "RoomInstance" SET "processingAction" = false WHERE id = '<id>'`. Documented in Phase P tests and E2E-9.
8. **Initiative tiebreaker**: Higher dexterity modifier wins. Equal dex: alphabetical by character name. This is deterministic and specified so Phase O's test can assert the order.
