# PLAN: LoS Combat Participants — No-Teleport Redesign

**Status:** Supersedes the "Option A" LoS-ally enrollment design in `PLAN-multiplayer-combat-join.md`
(the Design Principles bullet "...their `roomParticipant` is moved to the combat room at the
doorway grid slot (Option A...)", spec items §C/§E/§F where they describe moving
`roomParticipant` / `redirectRoomInstanceId`, scenario S2, and the "roomParticipant transfer for
LoS allies (Option A)" test section). Everything else in that doc — `combat_alert` for
non-LoS allies, `joinCombat` on physical room entry, the double-enrollment guard, S1/S3–S8 —
remains valid and unaffected.

---

## 1. The bug that surfaced this (2026-06-12, live session `08b2af61`)

**Root cause:** `computeEffectivePeek()` in `lib/v2/poi-utils.ts`:

```ts
if (rawPeek === 'none' && interacted) return 'full';
```

"Dark Passage North" (Entry Chamber's exit → The Flooded Passage) has `peek_visibility: 'none'`
by design — its `perception_details` are all sound/temperature cues ("cold air seeps through...
a faint rhythmic dripping"), with no visual cues. But its `currentProperties.interacted: true`
(Jeff opened/walked through it earlier), so `computeEffectivePeek` upgraded it to `'full'`.

**What happened as a result:**
1. Jeff (back in the Entry Chamber) took an unrelated narrative action ("walk to the trophy
   wall").
2. The adjacent-room combat-trigger check in `game-controller.ts` saw "full" LoS through Dark
   Passage North into the Flooded Passage, where "Restless Dead" had gone `alert` from Jeff's
   earlier visit.
3. `enterCombat` ran its LoS-enroll loop and found the same "full" LoS, so it **moved both
   Jeff's and Lolo's `roomParticipant.roomInstanceId`** into the Flooded Passage (grid slot `N`,
   Dark Passage North's slot) and added both to `initiativeOrder` — including Lolo, who was
   dormant and not even part of this action.
4. Separately, "Restless Dead" was placed at its template spawn slot (`NW`) since this was the
   room's first `enterCombat` call — not a bug per se, but it compounds the "wrong room, wrong
   positions" feeling once players are incorrectly there at all.

### Immediate, independent fix (do this regardless of the redesign below)
Remove the `rawPeek === 'none' && interacted → full` override — `peek_visibility: 'none'`
should mean "no LoS, period," matching Dark Passage North's flavor text and the docstring's
stated (but unimplemented) intent. **Before removing**, grep the seed for other
`peek_visibility: "none"` exits that might rely on this override for an intentional reveal
(e.g. a boarded window that becomes seeable once broken open) — none known currently, but
`computeEffectivePeek` is shared with `detectCombatTrigger`'s adjacent-room check, so verify.

### Live DB cleanup needed after the fix lands
Session `08b2af61-8afd-49f5-b505-c1d1ac9009ca`, room `7b35d744` (The Flooded Passage) currently
has `gameState: 'combat'` with Jeff and Lolo incorrectly relocated there (`roomParticipant.
roomInstanceId = 7b35d744`, `grid_slot: 'N'` for both). This combat never should have started
via this trigger. After the fix: move both `roomParticipant` rows back to the Entry Chamber
(`a1530d28-1dab-4e5d-aa3d-15eb9c70a77a`), and reset the Flooded Passage's `gameState` to
`'exploration'` / `combatState` to `null`.

---

## 2. Design correction: LoS allies join the fight but stay where they are

**User decision (2026-06-12):** the "teleport into the combat room" mechanic (Option A) is
wrong. Correct behavior: a character with LoS into a room where combat starts becomes part of
that combat's initiative order, but **remains physically in their own room** until they
choose to move.

### Core principle
- `roomParticipant.roomInstanceId` for an LoS ally is **never changed** by `enterCombat`.
- They ARE added to the combat room's `initiativeOrder` as a **remote participant** — needs a
  new marker on `InitiativeEntry`, e.g. `remoteRoomInstanceId: string`, set to their actual
  room's id. `grid_slot` can still record the exit/doorway they're watching from (useful if/when
  they later walk in).
- Their effective `proximity` is "out of melee range" — they cannot be targeted by melee attacks
  or opportunity attacks until they physically enter the room.

### View/UI implications
- A character can now be "in combat" (present in some room's `initiativeOrder`) while their
  physical room is elsewhere. This is a THIRD state, distinct from (a) physically in the combat
  room, and (b) the existing `combatAlert` (for allies not enrolled at all).
- Suggested: `ViewStatePayload.remoteCombat: { roomInstanceId, roomName, combatState } | null`,
  populated when the character is in some room's `initiativeOrder` but that room isn't their
  physical room.
- Client: when `remoteCombat` is present, render a combat UI (initiative order, HP, actions)
  sourced from `remoteCombat.combatState`, while the surrounding room/map context continues to
  reflect the character's own room.
- On a remote ally's turn: a restricted action set — e.g. "observe / wait", "move toward
  [exit]" (a normal `move_to_room` into the combat room — since they're already enrolled, this
  becomes a physical-arrival update, not a fresh `joinCombat` roll). Whether ranged attacks
  through the exit are allowed while remote is an open question — defer unless/until a scenario
  needs it.
- The `redirectRoomInstanceId` mechanism (built for Option A, to move the client's view to match
  a physically-relocated `roomParticipant`) is no longer needed for this path and should be
  removed or repurposed.

### combat-engine implications
- `enterCombat`'s LoS-enroll loop: drop the `roomParticipant.update` (no physical move). Push an
  `InitiativeEntry` with `remoteRoomInstanceId` set, `proximity` marked as out-of-melee-range,
  `grid_slot` = the exit's grid slot (for later arrival positioning). Preserve `isHiding` /
  `isDormant` handling as already specced.
- `resolveEnemyTurn` / `resolveOpportunityAttacks`: must skip entries with
  `remoteRoomInstanceId` set — they're not physically present to be melee'd.
- `advanceTurn`: a remote ally's turn still comes up in initiative order; existing
  dormancy/timeout handling should apply the same way for an unresponsive remote ally.

---

## 3. Open question (raised by user): should enemy LoS be symmetric?

If a passage has `peek_visibility: 'none'`, does that ALSO mean enemies on the other side
cannot perceive players through it (and thus cannot become `alert` / trigger combat via this
passage, and cannot target a remote LoS ally through it)?

**Recommendation: yes, treat `peek_visibility` as symmetric for now.**
- One value governs LoS in both directions — matches Dark Passage North's flavor text (neither
  side can see through it, regardless of who's looking).
- Consequence for this bug: once `computeEffectivePeek` is fixed, "Restless Dead" (in the
  Flooded Passage) also has no LoS to the Entry Chamber via Dark Passage North — consistent,
  no separate fix needed for "can the enemy see the players in the dark room" question.
- Future-proofing: if a creature with darkvision/blindsight should see through a `'none'`
  passage when players can't, that needs a new property (e.g. an `enemy_peek_visibility`
  override, or a `darkvision`/`blindsight` flag on the enemy checked against the passage).
  No current seed data needs this — defer until a concrete scenario requires it.

---

## 4. Action items for next session

1. **[Independent, do first]** Fix `computeEffectivePeek` — remove
   `rawPeek === 'none' && interacted → full`. Grep seed data for other
   `peek_visibility: "none"` exits with `interacted: true` potential to confirm no regressions.
2. Manually repair the live DB state described in §1 (move Jeff/Lolo's `roomParticipant` back to
   the Entry Chamber; reset the Flooded Passage to `exploration`/`combatState: null`).
3. Redesign `enterCombat`'s LoS-enroll loop per §2 — no `roomParticipant` move; add
   `remoteRoomInstanceId` to `InitiativeEntry` (`types/v2-game.ts`).
4. Add `ViewStatePayload.remoteCombat` field; populate in `view-state.ts` / `room/state` route.
5. Update the play UI to render a remote-combat overlay.
6. Update `resolveEnemyTurn` / `resolveOpportunityAttacks` to exclude remote entries from melee.
7. Remove/repurpose `redirectRoomInstanceId` (Option A artifact).
8. Update `PLAN-multiplayer-combat-join.md`: mark the Option A LoS-ally sections (Design
   Principles bullet, §B/§E/§F where they describe `roomParticipant` moves, scenario S2, and the
   "roomParticipant transfer for LoS allies (Option A)" test block) as superseded by this doc.

---

## 5. Status (2026-06-13) — implementation complete, tests + cleanup remain

Action items 1–8 above are all DONE:
1. ✅ `computeEffectivePeek` fixed (removed `none + interacted → full` override)
2. ✅ Live DB cleanup for session `08b2af61` (Jeff/Lolo back in Entry Chamber, Flooded Passage
   reset to `exploration`)
3. ✅ `enterCombat` LoS-enroll loop redesigned in `lib/v2/combat-engine.ts` — no `roomParticipant`
   move; `InitiativeEntry.remoteRoomInstanceId` added (`types/v2-game.ts`)
4. ✅ `ViewStatePayload.remoteCombat: RemoteCombatInfo | null` added; populated in
   `lib/v2/view-state.ts` / `app/api/v2/room/state/route.ts`
5. ✅ Play UI overlay: `app/v2/play/page.tsx` (`displayGameState`/`displayCombatState` derived
   values) + `components/v2/combat/CombatBanner.tsx` (`RemoteCombatBanner`)
6. ✅ `resolveEnemyTurn`/`resolveOpportunityAttacks` in `combat-engine.ts` skip entries with
   `remoteRoomInstanceId` set
7. ✅ `redirectRoomInstanceId` removed from `ViewStatePayload` / route / play-page poll
8. ✅ `PLAN-multiplayer-combat-join.md` annotated with inline "⚠️ SUPERSEDED" markers (§E, §F,
   Design Principles bullet, scenario S2, `enterCombat` §1, and 3 obsolete test blocks)

Also done (beyond the original list): `joinCombat` (`lib/v2/combat-engine.ts`) now converts a
remote ally's existing `InitiativeEntry` to physically-present (clears `remoteRoomInstanceId`,
sets normal `proximity`/`grid_slot`, no fresh initiative roll) when their `move_to_room` lands
in the combat room. `game-controller.ts` routes a remote ally's combat turn through the **full**
action set — per user decision, "treat it as if they're a normal player in the battle, just a
little further away" — NOT the restricted observe/wait set hedged in §2 above.

### Remaining work — DONE (2026-06-13)

**A. Task #9 — comprehensive edge-case tests for this redesign.** ✅ Added
`lib/v2/__tests__/remote-combat.test.ts` (18 tests, all passing), covering:
- `enterCombat`: LoS ally enrolled with `remoteRoomInstanceId` set, `roomParticipant` unchanged,
  `proximity: 'far'`, `grid_slot` = exit's slot, `isHiding`/`isDormant` preserved
- Skip conditions: 0 HP, already in own room's combat, already enrolled elsewhere
  (double-enrollment guard); two LoS exits to the same room → enroll once
- `resolveOpportunityAttacks`/`resolveEnemyTurn`: entries with `remoteRoomInstanceId` are never
  targeted and never act in melee
- `joinCombat`: remote ally's `move_to_room` into the combat room clears `remoteRoomInstanceId`,
  updates `proximity`/`grid_slot`, does NOT re-roll initiative
- `assembleViewState`: `remoteCombat` populated only when the character has a
  `remoteRoomInstanceId` entry in some *other* room's `initiativeOrder`, with HP overridden
  from `charRow`; `null` when no combat, not enrolled, or it's the character's own room
- `resolveCombatAction`: confirms remote players get the full action set (e.g. `attack`),
  not a restricted observe/wait set

**B. Stale comment cleanup** — ✅ `lib/v2/mutation-engine.ts:249` comment updated to drop the
removed `redirectRoomInstanceId` reference (now just `"map currentRoomInstanceId lookups"`).

This PLAN is now fully implemented and tested — no remaining action items.
