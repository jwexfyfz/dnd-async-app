# V2 UX Audit — Sign-in to Session Creation

**Scope**: `/v2/setup` (login → character select → session select)  
**Audited against**: `app/v2/setup/page.tsx`, `components/login-screen.tsx`, `components/character-list.tsx`, `components/character-form.tsx`  
**Note**: Play screen (`/v2/play`) is excluded — that UI is being redesigned as part of COMBAT_IMPL_PLAN.

---

## App Identity

### The app needs a name

"D&D Async" is a placeholder, not a product name. It describes the tech constraint ("async"), not the experience. The target user is someone who loves D&D but can't commit to a scheduled 3-hour session — they want to fit adventures into the gaps of a busy life.

**Chosen name: Delve**

Rationale: one word, strong verb, instantly evokes dungeon exploration, mobile-app feel, no D&D trademark risk, works as a URL. Tagline: *"Explore when you can."*

---

## Screen 1 — Login (the start screen)

**File**: `app/v2/setup/page.tsx` lines 200–211

The login screen is the only screen a new user will ever see before deciding whether to trust the app with their Google account. It currently renders a bold title and an indigo button. Nothing about it communicates what the app is, who it's for, or why it's worth signing in.

### 1.1 No pitch — nothing earns the sign-in

The current screen does not answer: *What is this? Why should I care?*

**Recommendation**: The start screen should do three things before the sign-in button: name the product, state the value prop, and give a concrete feel for what playing looks like.

Proposed layout (all within the existing centered card, no new routing):

```
┌──────────────────────────────────┐
│                                  │
│   ⚔️  Delve                       │
│   Explore when you can.          │
│                                  │
│   ─────────────────────────────  │
│                                  │
│   Play D&D with friends (or      │
│   solo) without scheduling a     │
│   session. Take your turn when   │
│   you have five minutes.         │
│                                  │
│   ─────────────────────────────  │
│                                  │
│   [  G  Sign in with Google  ]   │
│                                  │
│   New here? You'll pick a        │
│   character and start a dungeon  │
│   in under 2 minutes.            │
│                                  │
└──────────────────────────────────┘
```

The dividers are optional — a bit of vertical whitespace achieves the same grouping.

**Implementation notes**:
- This is entirely within the `step === 'login'` branch in `app/v2/setup/page.tsx`
- The card is already `flex flex-col items-center justify-center h-screen gap-6` — change to a `max-w-sm mx-auto` centered card on a dark or parchment background
- The Google button should use the proper multi-color Google "G" SVG and a white button style, matching `components/login-screen.tsx` in V1. That component's button markup can be copy-pasted; only the `onClick` handler differs (`handleLogin` instead of `handleDynamicRoute`)

### 1.2 No visual treatment — the background is white

The start screen background is plain white (inherited from the page). This gives no sense of atmosphere.

**Recommendation**: Use a dark stone or parchment background behind the card. A simple `bg-slate-900` full-screen background with a white card on top reads immediately as dramatic and thematic. Alternatively a subtle texture using a CSS `background-image` with a repeating SVG pattern (stone, parchment) via Tailwind arbitrary value syntax. Start with `bg-slate-900` — it costs one class name.

### 1.3 No error feedback if OAuth fails

If the Google redirect fails, the button re-enables silently.

**Recommendation**: Wrap `handleLogin` in a try/catch. On failure, show an error string beneath the button: `"Sign-in failed — please try again."` in `text-red-500 text-sm`.

---

## Screen 2 — Character Selection (`step === 'character'`)

**File**: `app/v2/setup/page.tsx` lines 214–313

### 2.1 Character buttons have no visual hierarchy

Each character is a plain `<button>` with name left, metadata right. No icons, no weight. All characters look identical.

**Recommendation**: Add a class emoji before the character name. `lib/class-emoji.ts` exports `classEmoji()` — it's already in the project. Make the name `font-semibold`, the metadata `text-slate-400 text-sm`. Add a `→` chevron on the right edge to signal the button navigates deeper.

### 2.2 "+ New Character" has very low affordance

It's an underlined `text-indigo-600 text-sm` text link at the bottom of the list.

**Recommendation**: Replace with a dashed-border card matching the character button height. Inside: a `+` icon and "New Character" label in `text-slate-400`. This pattern already exists in V1's `CharacterList` (the dashed card at the end of the grid). On click, open the creation form in a modal (see 2.7).

### 2.3 Empty state is inadequate for new users

Zero characters shows `"No characters yet."` in small gray text. A new user has no guidance.

**Recommendation**: When `characters.length === 0`, show a centered empty-state block with a headline and immediate CTA:
```
No heroes yet.
Create your first character to begin your adventure.
[Create Character]  ← prominent button, not a link
```
Auto-open the creation modal so the user doesn't need a second click.

### 2.4 Character creation — stats use free-form number inputs, not point buy

The inline form uses `<input type="number" min={3} max={18}>` defaulting to 10. V1's `CharacterForm` (`components/character-form.tsx`) implements D&D 5e point-buy: starts at 8, 27-point budget, costs 2 points for values above 13.

**Recommendation**: Reuse V1's `CharacterForm` component inside the creation modal. Its `onCharacterCreated` callback prop maps cleanly to `loadCharacters` + close modal. The only wiring needed is calling `/api/v2/me/characters` instead of the V1 `createCharacter` server action — either update the form's submit handler or pass an `onSubmit` override prop.

### 2.5 Skill count label is ambiguous

`"Skills (2 of 8)"` reads as "you've selected 2" but means "pick 2 from 8 options."

**Recommendation**: Change to `"Choose your skills — pick 2"` before selection starts. Once the user picks at least one, update to `"Skills: 1 / 2 chosen"`.

### 2.6 Disabled "Create Character" button has no explanation

The button disables until all required skills are selected, with no message explaining why. Users who complete name and class but skip skills hit a silent wall.

**Recommendation**: Add an inline note beneath the skills section when the count is not met: `"Choose 1 more skill to continue."` in `text-amber-600 text-xs`. This surfaces as soon as the first skill is picked and the deficit is obvious.

### 2.7 Inline form causes disorienting layout shift

The creation form toggles in/out with `showNewChar`, pushing the character list off-screen.

**Recommendation**: Move the form into a `fixed inset-0 bg-black/40` overlay modal (same pattern as V1's delete confirmation dialog in `CharacterList`). The form content is `max-w-md mx-auto bg-white rounded-2xl p-6`. This isolates creation from the list and matches existing patterns in the codebase.

---

## Screen 3 — Session Selection (`step === 'session'`)

**File**: `app/v2/setup/page.tsx` lines 316–391

### 3.1 Session deletion uses `window.confirm()`

`handleDeleteSession` calls `window.confirm(...)`. This is an unstyled native browser dialog.

**Recommendation**: On clicking ✕, replace the session row in-place with a compact confirmation:
```
┌─────────────────────────────────────────┐
│  Abandon "The Sunken Cellar"?           │
│                       [Keep it]  [Yes] │
└─────────────────────────────────────────┘
```
Track `pendingDeleteId` in local state; render the confirmation version of the row when it matches. No modal needed — inline is faster and less disruptive.

### 3.2 "Begin →" is a text link

Starting a dungeon — the primary CTA on this screen — is a small `text-indigo-600` text link.

**Recommendation**: Replace with a proper button: `bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700`. Reserve text links for secondary/cancel actions.

### 3.3 "+ Begin New Adventure" is a text toggle

The entry point to starting a new adventure is hidden behind a low-visibility toggle link.

**Recommendation**: When `sessions.length === 0`, skip the toggle and show dungeon cards immediately. When sessions exist, add a visible card below the session list with a `+` and "Begin New Adventure" label (dashed border, same pattern as the new character card in 2.2).

### 3.4 Character HP missing on the session screen

The header shows "Fighter · Level 1" but not HP. In an async game, HP is important context when picking up a session.

**Recommendation**: Append HP to the subheader: `"Fighter · Level 1 · HP 8/10"`. The `selectedChar` state already has `currentHp` and `maxHp`. Optionally color the HP red when below 50% (`currentHp / maxHp < 0.5`).

### 3.5 Session cards have no last-played timestamp

Each card shows dungeon name and current room, but not when it was last active. This is the primary disambiguation signal in an async game.

**Recommendation**: Show `lastActiveAt` as a relative string (`"Today"`, `"3 days ago"`) in small text beneath the room name. The `Session` type already includes `lastActiveAt: string`. Use a simple relative-time function — no library needed for coarse buckets (today / N days ago / N weeks ago).

### 3.6 Dungeon synopsis is hidden until toggled

Users can't see what adventures are available until they click the toggle. This adds friction to the most exciting part of the flow.

**Recommendation**: Always render dungeon cards below the session list. Remove the `showNewSession` toggle entirely. The cards are compact enough (`name + synopsis + tags + button`) that 2–3 of them fit without overwhelming the page. If the list is long, a max-height scroll container handles it.

---

## Cross-Cutting

### URL state doesn't survive navigation

All three steps live at `/v2/setup` with no URL changes between them. Browser back from the session step leaves the app entirely.

**Recommendation**: Encode step in the URL: `router.push('/v2/setup?char=<id>')` when entering session selection. Read `searchParams.get('char')` on load to restore state after a back-navigation. Or split into separate pages: `/v2/setup` (character list) and `/v2/setup/[charId]` (session list). Separate pages are easier to reason about and enable correct browser history.

### Design token inconsistency

V1 uses `slate-900` as its primary color; V2 uses `indigo-600`. No shared token file.

**Recommendation**: Commit to `indigo-600` for V2. If/when V1 components are reused in V2, update their primary buttons to indigo at the callsite via prop overrides or wrapper classes.

---

## Priority Ranking

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | App name + start screen pitch (1.1) | Low | High |
| 2 | Start screen dark background (1.2) | Low | High |
| 3 | Google button styling (1.3 / V1 reuse) | Low | High |
| 4 | Session deletion — replace `confirm()` (3.1) | Low | High |
| 5 | "Begin →" button affordance (3.2) | Low | High |
| 6 | "Begin New Adventure" toggle → visible card (3.3) | Low | High |
| 7 | New character — dashed card affordance (2.2) | Low | Medium |
| 8 | Empty state for new users (2.3) | Low | Medium |
| 9 | Character HP on session screen (3.4) | Low | Medium |
| 10 | Session last-played timestamp (3.5) | Low | Medium |
| 11 | Dungeon cards always visible (3.6) | Low | Medium |
| 12 | Class emoji + visual hierarchy on char buttons (2.1) | Low | Medium |
| 13 | Skill label wording (2.5) | Low | Low |
| 14 | Disabled button explanation (2.6) | Low | Low |
| 15 | Character creation — point-buy (2.4) | Medium | High |
| 16 | Character creation — modal (2.7) | Medium | High |
| 17 | URL-based step state (Cross-cutting) | Medium | Medium |
