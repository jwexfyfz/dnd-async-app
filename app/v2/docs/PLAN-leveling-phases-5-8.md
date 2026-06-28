# Leveling Mechanics — Phases 5–8: UI Layer

> **Design reference:** `PLAN-leveling-mechanics.md`
> **Previous file:** `PLAN-leveling-phases-0-4.md` (foundation — must be complete)
> **Next file:** `PLAN-leveling-phases-9-12.md` (feature engine — class features, subclass, rest)
>
> These phases build the player-facing XP visibility and choice UI. All work here is
> display and interaction — no new schema migrations, no new engine logic. They consume
> data exposed by Phases 3–5.

---

## Design Context

### Level-Up User Flow

Three scenarios cover all level-up cases:

**Scenario A — Automatic (no player choice needed)**
Example: Fighter L2 (just Second Wind and Action Surge unlocked).
```
XP pill appears in feed: "+200 XP — Guard Sergeant"
       ↓
level_up card fires immediately: "⬆ Level 2 — HP 10 → 19 · Second Wind · Action Surge"
       ↓
HP bar animates to new max
       ↓
Play continues — no interruption
```
No `pendingChoicesQueue` entry is pushed. The player reads the card and keeps going.

**Scenario B — ASI (L4, L8, L12, L16, L19 for most classes)**
```
XP pill → level_up card: "⬆ Level 4 — Ability Score Improvement waiting"
       ↓
pendingChoicesQueue = [{ type: 'asi', level: 4 }]
       ↓
Tab badge + amber strip appear; strip: "✦ Level 4 reached — Ability Score Improvement waiting [Go] ×"
       ↓
Player opens character sheet → ASI stepper banner at top
       ↓
PATCH /level-up { type: 'asi', choices: { strength: 2 } }
       ↓
Badge + strip clear; level_up_confirmed card in feed
```

**Scenario C — Subclass (L3 for most classes; L1 for Cleric/Sorcerer/Warlock; L2 for Wizard)**
```
XP pill → level_up card: "⬆ Level 3 — Choose your Martial Archetype"
       ↓
pendingChoicesQueue = [{ type: 'subclass', level: 3 }]
       ↓
Amber strip: "✦ Level 3 reached — Choose your Martial Archetype [Go] ×"
       ↓
Player taps "Go" → SubclassPicker full-screen
       ↓
Swipes cards, picks, confirms → PATCH /level-up { type: 'subclass', subclassKey: 'champion' }
       ↓
Badge + strip clear; subclass features appear in character sheet roadmap
```

---

### Progress Visibility

Three layers, from most to least frequent:

1. **XP pill** (narrative feed) — appears after every kill or act milestone. Keeps XP feeling active even when the level bar barely moves.
2. **XP bar + next feature** (party tab) — `[=======---] 250/300 XP · Next: Action Surge (L2)`. Updates optimistically from the pill amount without waiting for a poll.
3. **Narrative hint** — AI prompt receives `levelUpThisFight` (names of characters whose `xp + combatXpPool >= xpForNextLevel(level)`). The DM narration can reference it naturally.

**XP surfaces:**

| Surface | What's shown |
|---|---|
| Narrative feed | XP pill after kill or act milestone; `level_up` card at threshold |
| Party tab | XP bar + `Next: [Feature] (LN)` per member |
| Character sheet | Full feature list; upcoming features highlighted with unlock level |
| Setup page | XP bar per character card |
| "While you were away…" | XP gained during offline session |

`xpToNextLevel` is always the **gap** (`xpForNextLevel(level) - character.xp`), not the raw threshold. At L20, `xpToNextLevel = null` → bar replaced with `"Max level"` label.

---

### Mid-Battle Level-Up Rules

- Level-up fires **immediately** when XP crosses the threshold — not deferred to end of combat.
- Automatic effects (HP restored to new max, features unlocked) apply in the same transaction.
- **Pending choices (ASI, subclass) are deferred.** `{ type, level }` is pushed to `pendingChoicesQueue[]`, but no choice UI interrupts combat.
- Downed character (`currentHp === 0`): `maxHp` is updated; `currentHp` stays at 0. No combat revival.
- **Flow A (automatic mid-battle):** HP bar updates on next poll; `level_up` card in feed; combat continues uninterrupted.
- **Flow B (pending choice, mid-battle):** `level_up` card appears with pending note; amber strip becomes visible after combat ends.

---

### Persistent UI — Pending Choice Indicators

Three surfaces keep the pending state visible until resolved:

- **Tab badge:** amber dot on the character tab in the bottom nav. Present whenever `pendingChoicesQueue.length > 0`.
- **Amber strip:** above the narrative feed. Text: `"✦ Level [N] reached — [Description] [Go] ×"`. Tapping × collapses to a thin amber line for the session; restores to full strip on next page load. Multiple choices cycle: `"1 of 2 — Level 3: Choose your Martial Archetype"`.
- **Avatar ring:** pulsing amber ring on the player's own avatar in the party tab.

Nothing in gameplay is blocked by pending choices — players can ignore them across sessions.

---

## Status

| Phase | Name | Status |
|---|---|---|
| 5 | ViewState XP Fields | ✅ DONE |
| 6 | XP Visibility UI | ✅ DONE |
| 7 | Pending Choice UI (Persistent Indicators) | ✅ DONE |
| 8 | ASI Choice | ✅ DONE |

---

## Phase 5 — ViewState XP Fields `🔄 PARTIAL`

**Implementation notes (2026-06-20):**
- `types/v2-game.ts`: `PartyMemberInfo` extended with `xp`, `xpToNextLevel`, `nextFeature`;
  `CharacterStats` extended with `xp`, `pendingChoicesQueue`, `subclass`, `critThreshold`,
  `featuresUnlocked`. `PendingLevelUpChoice` and `NextFeature` interfaces added.
- `lib/v2/db-context.ts`: character select extended with `xp/pendingChoicesQueue/subclass/
  critThreshold/featuresUnlocked`; `xpForNextLevel` imported.
- `lib/v2/view-state.ts`: character select extended with new fields; partyMembers select
  extended with `xp`.
- `app/api/v2/room/state/route.ts`: charRow select and characterStats object extended;
  partyMembers output extended with `xp/xpToNextLevel` (gap from threshold); `nextFeature: null`
  placeholder (ClassProgression query not yet wired).
- `app/api/v2/room/state/route.ts`: sessionPartyData character select extended with `xp`.

**Type errors remaining (blockers before ✅ DONE):**
- `lib/v2/view-state.ts` line 339: `characterStats` object literal in `assembleViewState` missing
  new `CharacterStats` fields — charRow select updated but the literal construction not yet patched
- `lib/v2/view-state.ts` line 290: `partyMembers.push(...)` missing `xp/xpToNextLevel/nextFeature`
- `lib/v2/view-state.ts` line 327: `NarrativeLog.mechanicalSummary` is `JsonValue` from Prisma,
  not assignable to `MechanicalSummaryType | null` — fix: cast to `unknown` then our type, or
  relax `NarrativeLog.mechanicalSummary` back to `unknown`
- `components/v2/character/PartyTab.tsx` line 9: test stub missing new CharacterStats fields

**What remains to make Phase 5 ✅ DONE:**
1. Fix `assembleViewState` characterStats object in view-state.ts
2. Fix partyMembers push in view-state.ts (add xp/xpToNextLevel/nextFeature)
3. Fix NarrativeLog mechanicalSummary type assignment (cast or relax)
4. Fix PartyTab.tsx CharacterStats stub
5. Wire `nextFeature` from ClassProgression (currently hardcoded `null`)
6. Write `view-state-xp.test.ts` test file

## Phase 5 — ViewState XP Fields (original spec)

**Scope:** The API exposes XP data so the client can display progress. No UI yet — just
making the data available and typed.

**New fields:**
- `PartyMemberInfo`: add `xp: number`, `xpToNextLevel: number | null`, `nextFeature: { name: string; level: number } | null`
- `CharacterStats`: add `pendingChoicesQueue: PendingLevelUpChoice[]` (always an array, empty when nothing pending)

**Files:**
- `lib/v2/db-context.ts` (add fields to `PartyMemberInfo` query and `CharacterStats`)
- `types/v2-game.ts` (add types)
- `app/api/v2/room/state/route.ts` (verify new fields pass through)

**Test suite** (add to `lib/v2/__tests__/poi-context.test.ts` or new `view-state-xp.test.ts`):

*Happy path:*
- Character with `xp=250`, `level=1`: `xp=250`, `xpToNextLevel=50` (gap to 300, not the threshold), `nextFeature={name:'Action Surge',level:2}`
- Character at L5 (`xp=6500`): `xpToNextLevel=null`, `nextFeature` is first feature above L5 or `null`
- `pendingChoicesQueue=[{type:'asi',level:4}]` when one choice pending; `[]` when nothing pending
- `pendingChoicesQueue=[{type:'subclass',level:3},{type:'asi',level:4}]` when two choices queued from a multi-level jump (index 0 is always the active choice)

*Edge cases:*
- Character with no `ClassProgression` rows above current level: `nextFeature=null`
- `xpToNextLevel` is the gap (`xpForNextLevel(level) - character.xp`), not the raw threshold
- `xpToNextLevel=null` at L20

**Game-works checklist:**
- [ ] `/api/v2/room/state` response includes `xp`, `xpToNextLevel`, `nextFeature` for each party member
- [ ] `CharacterStats` includes `pendingChoicesQueue` (array, never null)
- [ ] No existing API consumers broken

---

## Phase 6 — XP Visibility UI `⬜ TODO`

**Scope:** Players can see XP moving. XP pills appear in the narrative feed after kills;
the level-up card announces the new level; the party tab shows a progress bar.

**New UI:**
- `components/v2/chat/ChatMessage.tsx`: render `xp_gained` as amber pill (`+100 XP — Giant Rat`)
- `components/v2/chat/ChatMessage.tsx`: render `level_up` as gold-bordered card (level, HP delta, new features listed)
- `components/v2/layout/PartyTab.tsx`: XP bar + `"Next: [Feature] (LN)"` per member
- `app/v2/setup/page.tsx`: XP bar under HP on each character card
- Optimistic XP update: when XP pill appears in feed, update the XP bar client-side without waiting for next poll (the pill's `amount` field drives the optimistic delta)

**Files:**
- `components/v2/chat/ChatMessage.tsx`
- `components/v2/layout/PartyTab.tsx`
- `app/v2/setup/page.tsx`

**Test suite** (new `lib/v2/__tests__/ui-xp.test.ts`):

*Happy path:*
- `xp_gained` message with `amount=100, source='Giant Rat'` → renders `+100 XP  (Giant Rat)`
- `level_up` message → renders level reached, HP change (`HP 14 → 20`), feature names
- XP bar at 250/300 XP → bar filled ~83%

*Edge cases:*
- XP bar clamped to 100% when `xp >= xpForNextLevel` (bar must not overflow)
- `xpToNextLevel=null` (at L20): bar not rendered — show `"Max level"` label instead
- `level_up` with no new features (e.g. L6 Fighter — no feature at L6 base): card renders without feature list section

*Regression:*
- Existing ChatMessage renders (roll result, narrative, etc.) unaffected

**Game-works checklist:**
- [ ] XP pill appears in feed after every kill or act milestone
- [ ] Level-up card shows new level, HP change, and any new features
- [ ] XP bar visible in party tab for each member
- [ ] XP bar visible on character selection screen
- [ ] Optimistic bar update matches pill amount without requiring a poll

---

## Phase 7 — Pending Choice UI (Persistent Indicators) `⬜ TODO`

**Scope:** Players who have unresolved ASI or subclass choices always know it. Covers the
login popup, tab badge, amber strip, and avatar ring. Nothing is blocked — these are
notifications, not gates.

**New UI:**
- Bottom-nav character tab: amber dot badge when `pendingChoicesQueue.length > 0`
- Amber strip above narrative feed: `"✦ Level 4 reached — Ability Score Improvement waiting [Go] ×"`
  - Tapping × collapses to thin amber line (re-expands on next login if unresolved)
  - Multiple choices: `"1 of 2 — Level 3: Choose your Martial Archetype"`
- Party tab avatar ring: pulsing amber ring on player's own avatar when pending
- `app/v2/setup/page.tsx`: amber badge on character card when `pendingChoicesQueue.length > 0`
- Login popup: fires on first load when `pendingChoicesQueue.length > 0`; `"Review now"` → character sheet tab, `"Later"` → dismiss for session

**Files:**
- `app/v2/play/page.tsx` (login popup, amber strip)
- `components/v2/layout/PartyTab.tsx` (avatar ring)
- `app/v2/setup/page.tsx` (character card badge)
- Bottom nav component (tab badge)

**Test suite** (`lib/v2/__tests__/ui-pending-choice.test.ts` — new file):

*Happy path:*
- `pendingChoicesQueue=[{type:'asi',level:4}]` → tab badge visible, strip shows correct text
- `pendingChoicesQueue=[{type:'subclass',level:3},{type:'asi',level:4}]` → strip shows `"1 of 2 — Level 3: Choose your Martial Archetype"` (index 0 is always displayed)
- Strip collapses to thin amber line on ×, does not fully dismiss
- Login popup fires on page load when `pendingChoicesQueue.length > 0`
- `"Review now"` navigates to character sheet tab
- `"Later"` dismisses popup; strip + badge remain

*Edge cases:*
- Strip does not re-appear mid-session after ×-collapse (only restores on fresh page load)
- Popup does not fire again within the same session after dismissal
- `pendingChoicesQueue=[]` → no badge, no strip, no popup, no ring

**Game-works checklist:**
- [ ] Tab badge appears/disappears correctly with pending state
- [ ] Amber strip shows correct pending text; collapses correctly; persists across navigation
- [ ] Login popup fires when appropriate; does not re-fire within session
- [ ] Nothing in normal gameplay is blocked by pending choice

---

## Phase 8 — ASI Choice `⬜ TODO`

**Scope:** Players can allocate the 2 ability score points from ASI levels. Choice is
enforced by a stepper UI with constraint validation on both client and server.

**New logic:**
- `PATCH /api/v2/me/characters/[id]/level-up` (new endpoint — ASI branch):
  - Body: `{ type: 'asi', choices: { strength?: 1|2, dexterity?: 1|2, ... } }`
  - Validates: total points === 2, no stat raised above 20, `pendingChoicesQueue[0].type === 'asi'`
  - Applies delta to stat columns, recalculates `maxHp` + `currentHp` if CON increased
  - Shifts `pendingChoicesQueue` (removes index 0; remaining choices stay queued)
  - Writes `level_up_confirmed` `MessageLog` entry
- The subclass branch of this endpoint ships in Phase 10A. The file is created here (ASI
  branch only); Phase 10A adds the subclass branch.

**New UI:**
- `CharacterSheet`: pending choice banner at top with 2-point stepper grid
- Per-stat consequence hints (CON: exact HP delta; STR/DEX: attack bonus change; others: description from `CLASS_DEFINITIONS`)
- Confirm button disabled until all 2 points spent; disabled label reads `"Spend all 2 points to continue"`
- Post-confirm: navigate to character sheet tab (or stay if already there)

**Files:**
- `app/api/v2/me/characters/[id]/level-up/route.ts` (new — ASI branch only; subclass added in Phase 10A)
- `components/v2/character/CharacterSheet.tsx` (pending choice banner + stepper)
- `components/v2/chat/ChatMessage.tsx` (render `level_up_confirmed` card)

**Test suite** (`app/api/v2/me/characters/[id]/level-up/route.test.ts` — new file):

*Happy path:*
- `+1 STR, +1 DEX` → both stats incremented, `pendingChoicesQueue` shifted (index 0 removed)
- `+2 STR` → STR incremented by 2, `pendingChoicesQueue` shifted
- `+1 CON` at L4 → `maxHp += 4`, `currentHp += 4` (clamped to new maxHp)
- `+1 CON` on downed character (`currentHp=0`) → `maxHp` updated, `currentHp` stays `0`
- `pendingChoicesQueue=[{type:'asi',level:4},{type:'asi',level:8}]` (two ASI levels from multi-level jump): after L4 ASI confirmed, queue shifts to `[{type:'asi',level:8}]`; after L8 ASI, queue is `[]`

*Unhappy path:*
- Total points `!== 2` (0 or 3) → 400
- Stat raised to 21 → 400
- `pendingChoicesQueue[0].type === 'subclass'` → 400 (wrong branch)
- `pendingChoicesQueue` empty → 400 (nothing to resolve)
- Character not owned by request user → 403

*Edge cases:*
- Confirm at exactly stat 19 (`+1` → reaches 20) → valid, not rejected
- `level_up_confirmed` MessageLog entry correctly names the stat raised and new value

**Game-works checklist:**
- [ ] Players can open character sheet and allocate ASI points
- [ ] Server validates and applies the choice
- [ ] CON increase raises max and current HP immediately
- [ ] Badge/strip/avatar ring clear after choice resolved
- [ ] `level_up_confirmed` card appears in narrative feed

---

## Handoff → `PLAN-leveling-phases-9-12.md`

**Entry criteria before starting Phase 9A:**

- [ ] Phase 8 green: ASI endpoint live, stepper UI working, `level_up_confirmed` card rendering
- [ ] Confirmed: `pendingChoicesQueue` array queuing works correctly (multi-level jump populates all choices in ascending level order; each resolve shifts index 0 off the array; array reaches `[]` when all resolved)
- [ ] `app/api/v2/me/characters/[id]/level-up/route.ts` created (ASI branch) — Phase 10A will extend it with the subclass branch

**What Phase 9A picks up:** Schema migration for class feature tables. This is the first
migration in this group and has no code changes — safe to run and deploy independently
before any seeding or engine work begins.

**Critical sequencing constraint carried forward:**
> No `ACTIVE_ABILITY` `ClassFeature` row may have `implemented: true` set until Phase 12
> (rest endpoint) has shipped. Setting `implemented: true` before the rest endpoint exists
> means the ability button appears in InitiativeStrip, the player can use it, the engine
> processes the effect — but `CharacterResourceState.current` is never decremented, granting
> unlimited uses. The `implemented` flag is the gate; do not open it early.
