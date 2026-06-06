# V2 UI Flows — Mobile Play Interface

> **Scope: mobile-first.** Desktop layout is not planned. All mocks are portrait mobile (~390px wide).
> Combat-specific UI decisions (proximity model, action economy, chip rules) live in [COMBAT_PLAN.md](./COMBAT_PLAN.md) §13–19.

---

## 1. Global Layout

The play page is a single `flex flex-col h-screen` root. A sticky header sits at the top; a sticky bottom nav sits at the bottom. Everything between is the active tab's content area (`flex-1 overflow-hidden`).

```
┌─────────────────────────────────────┐  ← <Header />  sticky top-0 z-30
│  Header                             │
├─────────────────────────────────────┤
│                                     │
│  <TabContent />                     │  ← flex-1 overflow-hidden
│  (active tab fills this space)      │
│                                     │
├─────────────────────────────────────┤  ← <BottomNav />  sticky bottom-0 z-30
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

### Header

**Exploration mode** — blue background (`bg-blue-600` text white):
```
┌─────────────────────────────────────┐
│  The Guard Post                     │  ← room name, left-aligned
└─────────────────────────────────────┘
```

**Combat mode** — red background (`bg-red-600` text white):
```
┌─────────────────────────────────────┐
│  The Guard Post  [In Combat]  Round 2│  ← [In Combat] pill chip; Round N right-aligned small
└─────────────────────────────────────┘
```

`[In Combat]` is a small pill/badge (white text, slightly darker red bg) between the room name and the round number. Round number exists only as a duration reference for status effects (e.g. "provoked for 2 rounds") — not a headline.

The header color is the primary visual signal of mode change. Players notice the red immediately on returning to a session mid-combat.

### Bottom nav

Four tabs, equal width, icon + label each:

```
┌──────────┬──────────┬──────────┬──────────┐
│  💬       │  🎒       │  👥       │  🗺       │
│  Chat    │ Inventory│  Party   │   Map    │
└──────────┴──────────┴──────────┴──────────┘
```

Active tab: accent color underline + label bold. Inactive: muted. No badge counts in v1.

---

## 2. Chat Tab — Exploration Mode

```
┌─────────────────────────────────────┐
│  The Guard Post              blue   │  ← <Header /> blue bg
├─────────────────────────────────────┤
│                                     │
│  ┄ Load earlier messages ┄          │  ← only shown if hasMore
│                                     │
│  🧙 The cellar is damp and cold…    │  ← <DmBubble />  left-aligned, DM avatar left
│                                     │
│     [You: I examine the chest]  👤  │  ← <PlayerBubble />  right-aligned, avatar right
│                                     │
│  🎲 Thieves' Tools  14+2=16         │  ← <RollBadge />
│     vs DC 15  ✓ lock opens          │
│                                     │
│  🧙 The hasp clicks open. Inside…   │
│                                     │
│                    ↑ scroll anchor  │
├─────────────────────────────────────┤
│  What do you do?                    │  ← <ChatInput />  shrink-0
│  [________________________________] │
│                          [Send ↑]   │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │  ← <BottomNav />
└─────────────────────────────────────┘
```

### Message avatars

Each message row shows a small circular avatar (32px) to the left of DM bubbles and to the right of player bubbles.

| Sender | Avatar source |
|---|---|
| DM (AI) | Static dungeon/die icon — same for all sessions |
| Player (you) | `user.user_metadata.avatar_url` from Supabase Google OAuth |
| Ally player | Their own Google OAuth avatar |

Avatars are shown once per consecutive block — if the DM sends three messages in a row, only the first shows the avatar (same pattern as iMessage/Slack).

### Chat message types

| `mechanicalSummary.type` | Component | Alignment |
|---|---|---|
| `player_action` | `<PlayerBubble>` | Right, indigo bg, player avatar right |
| `dm_narrative` | `<DmBubble>` | Left, white card, DM avatar left |
| `roll_result` | `<RollBadge>` | Left, pill row, no avatar |
| `combat_start` | `<CombatBanner>` | Full-width, sticky in log, no avatar |

### `<ChatInput />` — exploration

Single textarea + Send button. No chips row. Enter submits (shift+Enter = newline).

```
┌─────────────────────────────────────┐
│  What do you do?                    │
│  [________________________________] │
│                          [Send ↑]   │
└─────────────────────────────────────┘
```

---

## 3. Chat Tab — Combat Mode

```
┌─────────────────────────────────────┐
│  Guard Post  [In Combat]   Round 2  │  ← <Header /> red bg
├─────────────────────────────────────┤
│  <InitiativeStrip />                │  ← sticky below header, z-20
│           ▼                         │
│  ┌──┐  ┌────┐  ┌──┐  ┌─╴ fade      │
│  │T │  │ H  │  │G │  │      →      │  ← scroll right for more
│  └──┘  └────┘  └──┘  └─╴           │
│  14/18  22/22  11/11                │
├─────────────────────────────────────┤
│                                     │
│  ╔═══════════════════════════════╗  │
│  ║ ⚔ Combat started — Round 1   ║  │  ← <CombatBanner />  sticky in log
│  ║ [Show snapshot]               ║  │    tap expands full state at that moment
│  ╚═══════════════════════════════╝  │
│                                     │
│  🧙 Harwick steps forward, blade    │  ← <DmBubble />
│     drawn. The guard circles left.  │
│                                     │
│     [You: I attack Harwick]     👤  │  ← <PlayerBubble />
│                                     │
│  🎲 Attack   17+5=22 vs AC 15  ✓   │  ← <RollBadge />
│     Damage   1d8+3 = 7              │
│                                     │
│  🧙 Harwick staggers. The guard     │
│     raises his spear.               │
│                                     │
├─────────────────────────────────────┤
│  [Attack][Dodge][Disengage][Hide]   │  ← <ActionChips />  shrink-0
│  [Use Item][Provoke][⚡Cunning ●]   │    horizontally scrollable
├─────────────────────────────────────┤
│  [Attack ×] slash at his wrist      │  ← chip-in-input state
│                          [Send ↑]   │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

### `<InitiativeStrip />`

Horizontally scrollable `overflow-x-auto` row. Positioned sticky below the header.

**Icon states:**

| State | Visual |
|---|---|
| Active (current turn) | Full size, full opacity, ▼ above icon |
| Already acted | 80% size, 50% opacity |
| Waiting | Full size, full opacity, no marker |
| Dead | Grey ring, skull overlay |

**Ring color = HP status:**

| HP % | Color |
|---|---|
| > 60% | Green |
| 30–60% | Yellow |
| < 30% | Red |
| 0 | Grey |

Rightmost visible icon is ~30% cropped to signal scroll. Active actor always scrolled into view.

**Tap any icon → `<InitiativeMiniSheet />`** drops inline below the strip:

```
│           ▼                         │
│  ┌──┐  ┌────┐  ┌──┐                │
│  │T │  │ H  │  │G │                │
│  └──┘  └────┘  └──┘                │
│  ╔══════════════════════╗           │
│  ║ Tomas · Rogue 3      ║           │  ← own character
│  ║ AC 12   ATK +5       ║           │
│  ║ [⚡Cunning Action ●] ║           │  ← class features only; tappable if own char
│  ║ [⚡Second Wind ●]    ║           │
│  ╚══════════════════════╝           │

│  ╔══════════════════════╗           │
│  ║ Harwick Vorne        ║           │  ← enemy
│  ║ HP 22/22  AC 15      ║           │
│  ║ Proximity: Close     ║           │
│  ║ Status: —            ║           │
│  ╚══════════════════════╝           │
```

Mini-sheet shows stats and class features only. **Skills are not shown here** — they live in the Party tab. Tapping a class feature (own character, combat only) triggers the same flow as the action chip: sub-picker if needed, then navigates to Chat and inserts the chip.

Tap outside or tap icon again to dismiss.

### `<ActionChips />`

Horizontally scrollable row. Combat only — not rendered during exploration.

**Standard chips** (greyed if action already used this turn):
`[Attack]` `[Dodge]` `[Dash]` `[Disengage]` `[Hide]` `[Use Item]` `[Provoke]`

**Class feature chips** (keyed to character class):
`[⚡ Second Wind ●]` `[⚡ Cunning Action ●]`

`●` = available · `◎` = expended (visible but non-interactive, as a reminder)

Cunning Action tap → **inline sub-picker** appears above the chips row:

```
┌─────────────────────────────────────┐
│  Cunning Action — use as:           │
│  [Hide]    [Dash]    [Disengage]    │
└─────────────────────────────────────┘
```

Selection inserts `[Cunning Action: Hide ×]` into the input and dismisses the picker.

### `<ChatInput />` — combat variant

Chip-in-input: tapping any action chip inserts a removable pill tag at the start of the input.

```
Empty:        [ What do you do?              ]
Chip added:   [ [Attack ×] |                 ]
With text:    [ [Attack ×] slash at his wrist]
```

Rules:
- One chip maximum — tapping another replaces
- `×` removes chip; input returns to freeform
- Free text without a chip is always valid; Stage 2 infers
- Chip value passed as `action_hint` to Stage 2 alongside player text
- Sending with a class feature chip (`[⚡ Second Wind ×]`) tells Stage 3 to consume the resource — no separate confirmation modal

### Class feature validation

Stage 2 identifies the intent from the chip + player text. **Stage 3 performs all mechanical validation:**

| Check | Failure response |
|---|---|
| Is it the player's turn? | 409 "It's not your turn" |
| `bonusActionUsed === false` (for Cunning Action) | Narrative: "You've already used your bonus action this round" |
| Feature not expended (Second Wind per-rest) | Narrative: "You've already used Second Wind — it recharges on a short rest" |
| Character has the feature at all | Stage 2 should catch this; Stage 3 rejects if it slips through |

Stage 2 is LLM intent parsing — not the right place for deterministic resource checks. Stage 3 is pure code and owns all validation.

---

## 4. Inventory Tab

```
┌─────────────────────────────────────┐
│  The Guard Post              blue   │  ← Header, same color as current game mode
├─────────────────────────────────────┤
│  EQUIPPED                           │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Dagger        1d4+3 pierce [Unequip│
│  Leather Armor AC 12        [Unequip│
│                                     │
│  CARRIED                            │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Healing Potion ×2                  │
│  Restore 2d4+2          [Use][Drop] │
│                                     │
│  Thieves' Tools ×1                  │
│  Pick a lock            [Use][Drop] │
│                                     │
│  Rope (50ft)                 [Drop] │
│  Silver Key                  [Drop] │
│                                     │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

The header reflects the current game mode color (blue in exploration, red in combat) across all tabs — consistent orientation signal regardless of which tab is active.

### Button behavior

**During exploration:**
- `[Use]` executes directly (Thieves' Tools → attempts lock on adjacent POI; potion → heals immediately)
- `[Equip]` / `[Unequip]` updates equipment state immediately
- `[Drop]` places item as a POI in the current room

**During combat:**
- `[Use]` navigates to Chat tab and inserts the chip (`[Use: Healing Potion ×]`) — item use must go through the action economy
- `[Equip]` / `[Unequip]` fully disabled — players load out before engaging (v1)
- `[Drop]` disabled in combat

Items with no `combat_usable` flag do not show `[Use]` during combat.

---

## 5. Party Tab

```
┌─────────────────────────────────────┐
│  The Guard Post              blue   │  ← Header, mode color
├─────────────────────────────────────┤
│  <PartyHeader />                    │  ← sticky top of tab, z-10
│  ┌──┐      ┌──┐      ┌──┐          │
│  │T │      │B │      │M │          │  ← tap to switch character below
│  └──┘      └──┘      └──┘          │
│  Tomas    Brennan   Miriel          │
│  ♥14/18   ♥8/22    ♥12/12          │  ← HP always visible for party awareness
├─────────────────────────────────────┤
│  ── Tomas Blackwood · Rogue 3 ──    │  ← <CharacterSheet />  scrollable
│                                     │
│  COMBAT STATS                       │
│  HP 14/18  AC 12  Speed 30ft        │
│  Attack +5  Damage 1d6+3            │
│  Initiative +3                      │
│                                     │
│  CLASS FEATURES                     │
│  Sneak Attack   2d6 (auto on adv.)  │
│  Cunning Action        ● available  │  ← ● tappable during combat (own char only)
│  Second Wind           ● available  │
│                                     │
│  ABILITY SCORES                     │
│  STR  8 −1    DEX 16 +3             │
│  CON 12 +1    INT 14 +2             │
│  WIS 10 +0    CHA 13 +1             │
│                                     │
│  SKILLS  (★ = proficient)           │
│  Acrobatics  +5 ★   Stealth  +5 ★  │
│  Deception   +3     Perception +2   │
│  ...                                │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

### `<PartyHeader />`

Same avatar + HP component as `<InitiativeStrip />` but without turn indicators (▼) or HP rings — HP status color is retained. Single player: one avatar shown, no toggling needed but supports N avatars for multiplayer.

Ally characters: full sheet visible, read-only. No class feature activation, no chip insertion.

### Class feature activation (own character, combat only)

Tapping `●` on a class feature:
1. Sub-picker appears inline if needed (Cunning Action → Hide / Dash / Disengage)
2. App navigates to Chat tab
3. Chip inserted into input (`[Cunning Action: Hide ×]`)

Same outcome as tapping from the initiative mini-sheet or the action chips row — Party tab is just an alternate entry point.

Out of combat: tapping a feature shows a short description tooltip. No navigation, no chip.

---

## 6. Map Tab

```
┌─────────────────────────────────────┐
│  The Guard Post              blue   │  ← Header, mode color
├─────────────────────────────────────┤
│                                     │
│  <DungeonMap />                     │  ← SVG map, full-screen
│  (LoS, peek visibility,             │
│   door gaps, character tokens,      │
│   enemy tokens in exploration       │
│   and combat)                       │
│                                     │
│  <MapLegend />                      │  ← POI abbreviation key, bottom of map
│                                     │
├─────────────────────────────────────┤
│  [ Chat ] [Inventory] [Party] [Map] │
└─────────────────────────────────────┘
```

Enemy tokens appear on the map during both exploration and combat. The existing `<DungeonMap />` and `<MapLegend />` components move here from the pull-up bottom sheet. Map rendering otherwise unchanged for v1.

---

## 7. Use Item Flow (Combat)

Full user journey when a player uses an item during their turn.

**Step 1 — Trigger**

Player taps `[Use Item]` chip. Bottom sheet slides up from below the input (~50% screen height). Chat partially visible above for combat context.

```
┌─────────────────────────────────────┐
│  ...Harwick steps forward, blade    │  ← chat, partially visible
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤
│           ── drag handle ──         │  ← <ItemPickerSheet />
│  Use an item                        │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  Healing Potion  ×2  Restore 2d4+2  │  ← only combat_usable items
│  Thieves' Tools  ×1  Pick a lock    │
└─────────────────────────────────────┘
```

**Step 2 — Target selection (if `targetable: true`)**

Selecting an item with valid targets replaces the item list inline:

```
│  Healing Potion — use on:   [← back]│
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│  ● Tomas (you)      ♥ 8/18          │
│    Brennan          ♥ 8/22          │  ← party members in same room only
└─────────────────────────────────────┘
```

Items without `targetable` skip this step — chip inserts immediately on selection.

**Step 3 — Chip insertion**

Sheet dismisses. Input shows:

```
[ [Use: Healing Potion ×]             ]          (self / untargeted)
[ [Use: Healing Potion → Brennan ×]   ]          (targeted)
```

Player types flavor text or sends directly.

**Edge cases:**

| Scenario | Behavior |
|---|---|
| No `combat_usable` items | `[Use Item]` chip greyed; tap shows "Nothing usable in combat" |
| One item, no target | Sheet skips both steps; chip inserted immediately |
| Cancel | Drag sheet down or tap outside; no chip, no navigation |
| Free text input | "I drink my healing potion" bypasses this flow; Stage 2 handles normally |

---

## 8. State Transitions

### Exploration → Combat

Triggered when `gameState` flips to `"combat"` in the Stage 5 response:

1. Header background switches from blue to red; `[In Combat]` chip and "Round 1" appear
2. `<InitiativeStrip />` renders above the chat stream
3. `<ActionChips />` renders above the input
4. A `<CombatBanner />` entry is injected into the chat log — sticky, shows who initiated and starting initiative order; tap expands full snapshot

### Combat → Exploration

Triggered when `combatState` is null in the Stage 5 response (all enemies dead / fled / combat resolved):

1. Header background switches back to blue; `[In Combat]` chip and round number removed
2. `<InitiativeStrip />` unmounts
3. `<ActionChips />` unmounts
4. Input returns to exploration variant (no chip row)
5. A `<CombatBanner />` entry ("Combat ended") is injected into the log

No page reload. Both transitions are driven by the existing `sendAction` response handler updating local state.

---

## 9. Auth & Routing

Reads `?session=` and `?char=` from URL query params on load. Redirects to `/v2/setup` if either is missing.

**On load:**
- `GET /api/v2/session/current-room?sessionId=&characterId=` → resolves `roomInstanceId`
- `GET /api/v2/room/history?sessionId=` → pre-populates chat
- `GET /api/v2/room/state?roomInstanceId=` → room name, POI states

**On action:**
- `POST /api/v2/game/action` → appends new entries to chat, updates `activeRoomInstanceId` if room changed, triggers map refresh

**Token verification** (unchanged):
```
GET ${SUPABASE_URL}/auth/v1/user
Headers: { Authorization: Bearer <token>, apikey: <anon_key> }
```

---

## 10. Known Gaps

| Gap | Notes |
|---|---|
| Multi-player polling | No live updates; second player's actions invisible until page refresh. |
| Inventory equip/unequip in combat | Disabled in v1. Weapon swap as a free interaction (once per turn, no action cost) is the correct 5e model — deferred. |
