# Combat Engagement Overhaul — Implementation Plan

## Goals

Make every combat turn feel like an event. Four concrete improvements:
1. **CombatRollSheet** — a bottom sheet with dice animation that makes the attack roll a participatory moment
2. **Contextual chips** — chips relabel and highlight based on the current situation; position is stable except in emergency survival situations
3. **Flavor text narration** — attack chips submit without requiring text; typed flavor is honored literally
4. **Severity-aware narration** — the d20 value (1 vs 18 vs 20) shapes the DM's prose

Shove mechanic added as part of contextual chips (only surfaces when close to an enemy).

Target selection added to all targeted actions — when multiple valid enemies exist, the roll sheet shows a picker.

---

## Architecture Contracts (read before implementing anything)

### 1. CombatRollSheet does NOT own the fetch

The sheet receives `onRoll: (flavorText: string, targetId: string | null) => Promise<RollSheetResult>` from `page.tsx`. It calls `onRoll()` on ROLL tap and drives animation independently of when the promise resolves. `page.tsx` implements `onRoll` by calling `executeDirectAction` (or its successor). This keeps all API state management — history merging, gameState, combatState, characterStats, etc. — in one place.

### 2. Extract `applyActionResponse` before wiring the roll sheet (prerequisite)

`executeDirectAction` in `page.tsx` has a ~35-line block that applies the API response to local state (merging history, setting combatState, characterStats, etc.). Before the roll sheet lands, extract this into a standalone function:

```typescript
function applyActionResponse(
  data: Record<string, unknown>,
  prevGs: 'exploration' | 'combat',
  setters: { setHistory, setGameState, setCombatState, setCharacterStats, ... }
): { d20: number | null; isCrit: boolean; success: boolean }
```

Both `executeDirectAction` and the roll sheet's `onRoll` implementation call it. This eliminates state update duplication and makes the `onRoll` response testable.

### 3. `sending` lock

`onRoll` calls `executeDirectAction`, which guards against double-submits via the `sending` state. ROLL button must be disabled when `sending` is true — pass `isSending: boolean` as a prop to the sheet. Once ROLL fires, the sheet enters `rolling` state and the ROLL button is hidden.

### 4. `attackBonus` — use the server value, no client recomputation

`characterStats.attackBonus` is already computed server-side in `view-state.ts:389`, accounting for weapon type (finesse → `max(STR, DEX)`), equipped weapon's `toHitBonus`, sacred weapon bonus, and proficiency. Pass it directly to `CombatRollSheet`. Do not recompute it on the client.

### 5. Target selection

Any action with a contested roll or that specifies an enemy target uses `target_poi_instance_id` in the action payload. The roll sheet handles target selection: when `validTargets.length === 1`, auto-select silently; when `> 1`, show a target picker. The engine at `combat-engine.ts:970` already handles `target_poi_instance_id` for attack with a fallback to first alive enemy if the target dies.

### 6. Animation window = narrative budget

The 2100ms animation window is not arbitrary — it is sized to cover P50 Haiku narrative generation time (~1500ms) plus server processing (~250ms). Two changes to `game-controller.ts` make this hold:

**Optimisation A — bypass intent parse for roll-sheet actions (~300–600ms saved)**

Roll-sheet actions send `target_poi_instance_id` as a top-level body field alongside `action_hint`. When both are present, `game-controller.ts` constructs `ExtractedAction` directly without calling Haiku. Free-text input paths (no `target_poi_instance_id` in the body) are completely unaffected.

```typescript
const COMBAT_DIRECT_HINTS = new Set(['attack','shove','hide','provoke','dodge','dash','disengage']);

if (action_hint && COMBAT_DIRECT_HINTS.has(action_hint) && body.target_poi_instance_id !== undefined) {
  parsedActions = [{
    action_type: action_hint as ActionType,
    target_poi_instance_id: body.target_poi_instance_id ?? null,
    item_id: null, target_character_id: null,
    resulting_stance: null, interaction_result: null, target_room_template_id: null,
  }];
} else {
  parsedActions = await parseIntentWithHaiku(...);
}
```

**Optimisation B — fire-and-forget narrative (~1000–3000ms saved from response time)**

After combat resolution, call `generateAndPersistNarrative` without `await` and return immediately. Haiku begins generating prose at the exact moment the client receives the mechanical result and starts the animation. Only the main combat action path (line 1684) changes — lines 328 and 601 (end_turn, death_save) stay awaited since those have no animation window.

```typescript
// Before
const [narrativeResult, rawViewState] = await Promise.all([
  generateAndPersistNarrative(...),
  prefetchViewStateData(...),
]);

// After
generateAndPersistNarrative(...).catch(async (err) => {
  // First failure: retry once — most Haiku failures are transient (rate limit spike, timeout).
  console.warn('[narrative] generation failed, retrying once:', err);
  try {
    await generateAndPersistNarrative(...);
  } catch (retryErr) {
    // Retry also failed: write a mechanical summary from engine facts so the poll resolves.
    // Never leave the shimmer frozen — the player deserves to know what happened mechanically.
    console.error('[narrative] retry failed, writing mechanical summary:', retryErr);
    await persistMechanicalSummary(sessionId, roomInstanceId, combatResult);
  }
});
const rawViewState = await prefetchViewStateData(...);
```

`persistMechanicalSummary` formats a message directly from `combatResult.rollLogs[0]` — e.g. `"You attack the Skeleton Guard — roll 17 + 5 = 22 vs AC 11. Hit. 8 damage dealt."` It writes this to the history table so the poll finds real information within its 4-second window. Rendered in chat with muted/monospace styling to signal it is a system message rather than DM prose.

**Combined timeline:**
```
t=0ms      Tap ROLL
t=~250ms   Server returns rollResult → animation starts
t=~250ms   Server: Haiku narrative starts (fire-and-forget)
t=~2350ms  Animation lands, sheet dismisses

Haiku ~1s:    narrative in DB at t=~1250ms → poll hits before animation ends
Haiku ~1.5s:  narrative in DB at t=~1750ms → poll hits ~350ms after dismiss
Haiku ~3s+:   shimmer visible briefly as tail-case fallback
Haiku fails:  retry fires immediately; retry succeeds → narrative in DB within ~2s
Both fail:    mechanical summary in DB within ~100ms → poll resolves on next tick
```

The shimmer is a tail-case fallback, not the expected path. **Polling starts the moment `onRoll` resolves** — during the animation, not after the sheet dismisses.

---

## Feature 1 — CombatRollSheet with Dice Animation

### What it replaces
Currently the player types "attack", hits send, and 1–2 seconds later sees a `CombatRollBadge` pill appear in the chat. No participation in the roll. No moment of suspense. No way to choose a target.

### New flow (Attack chip)
1. Player taps **Attack** chip (or Shove, Hide, Provoke — any action with a contested roll)
2. A bottom sheet slides up from below the action chips — it stays above the keyboard/safe area
3. Sheet shows (top to bottom):
   - **Target picker** (only if `validTargets.length > 1`): horizontal scroll of enemy chips — each shows name, a 5-dot HP bar, and a `Close`/`Far` badge. Tapping selects; default = first `Close` alive enemy, else first alive enemy.
   - **Optional flavor text field**: placeholder "How do you attack? (optional)"
   - **Modifier + Target line**: `+5 · vs. Skeleton Guard · AC 11` — uses `characterStats.attackBonus`, selected target name and AC
   - **ROLL button**: full-width, dark background, large tap target. Disabled when `isSending`.
4. Player taps **ROLL** (or submits with Enter from flavor text field)
5. `onRoll(flavorText, selectedTarget.id)` fires → dispatches `POST /api/v2/game/action` with `target_poi_instance_id: selectedTarget.id` in the body (alongside `action_hint`). Simultaneously: dice animation starts. The presence of `target_poi_instance_id` in the body triggers the intent-parse bypass on the server (see Architecture Contracts §6).
6. **Dice animation**: a d20-shaped container cycles through random numbers 1–20. The easing curve decelerates in four phases to build suspense before landing:
   - Phase 1 (0–600ms): update every 40ms — rapid blur, numbers unreadable
   - Phase 2 (600–1100ms): update every 100ms — slowing, numbers legible but fast
   - Phase 3 (1100–1600ms): update every 220ms — clearly decelerating
   - Phase 4 (1600–2100ms): update every 450ms — crawling; one or two more numbers before landing. This is the suspense window — the player can almost read each number before the next one hits.
   - `onRoll` resolves before 2100ms: store result, let animation complete normally, land on server's d20 value at the 2100ms mark
   - `onRoll` resolves after 2100ms: hold in Phase 4 cadence (one tick per 450ms) until promise resolves, then land on the next tick
7. Landing state:
   - Background color: amber-400 (CRITICAL HIT), emerald-500 (HIT), red-400 (MISS), red-700 (FUMBLE)
   - Scale pulse on landing: standard outcomes → 1.0 → 1.15 → 1.0 (200ms); critical hit → 1.0 → 1.25 → 1.0 (300ms, bigger pop)
   - Outcome label appears: **CRITICAL HIT!** / **HIT!** / **MISS!** / **FUMBLE!**
   - If hit: damage roll appears below with its own smaller animation (500ms number spin)
   - If enemy HP drops to 0: **DEFEATED** in amber replaces the damage counter; enemy name appears below in smaller text (e.g., "Skeleton falls")
8. The moment `onRoll` resolves (~250ms after tap), the client starts polling `/api/v2/room/history?since={newestTimestamp}` every 500ms. In the happy path, the narrative arrives before or just as the animation finishes — the chat updates seamlessly with no gap. If the poll hasn't resolved by the time the sheet auto-dismisses, a shimmer placeholder appears in chat as a tail-case fallback (see Feature 6).
9. Sheet auto-dismisses after 2.5s (hit/miss/fumble), 4s (critical hit), or 3.5s (enemy defeated). Tap-outside or swipe-down dismisses the sheet only before ROLL is tapped — once ROLL fires the API is committed and the sheet cannot be cancelled.

### CombatRollSheet component spec
**File**: `components/v2/combat/CombatRollSheet.tsx`

**Supporting type**:
```typescript
export interface TargetOption {
  id: string;
  name: string;
  ac: number;
  hp: number;
  maxHp: number;
  proximity: 'close' | 'far';
}
```

**Props**:
```typescript
interface CombatRollSheetProps {
  actionHint: 'attack' | 'hide' | 'provoke' | 'shove';
  attackBonus: number;              // characterStats.attackBonus — server-computed, no client recomputation
  validTargets: TargetOption[];     // filtered by caller: shove = close only; attack/provoke = all alive
  isSending: boolean;               // disables ROLL button; prevents double-submit
  onRoll: (flavorText: string, targetId: string | null) => Promise<RollSheetResult>;
  onDismiss: () => void;
}

interface RollSheetResult {
  d20: number;
  success: boolean;
  isCrit: boolean;
  damageDealt?: number;
  targetDefeated?: boolean;
}
```

**Internal state machine**:
```
idle → rolling → (animating + awaiting onRoll) → landed → dismissed
```

**Target picker** (renders when `validTargets.length > 1`):
- Horizontal scroll above the flavor text field
- Each chip: `[name] · ████░ · Close` — name, 5-dot HP bar (filled = alive HP proportion), proximity badge
- Selected chip: `bg-slate-800 text-white border-slate-800`
- Unselected: `border-slate-300 text-slate-600`
- Default selection: first target with `proximity === 'close'`, else `validTargets[0]`
- For `actionHint === 'hide'`: no target picker (stealth check, no enemy target)

**Modifier + Target line**: `+{attackBonus} · vs. {selectedTarget.name} · AC {selectedTarget.ac}` — updates live as the player taps different targets in the picker. No re-render delay; this is derived state from `selectedTargetIndex`.
- For `hide`: `Stealth Check · vs. highest enemy Perception`
- For `provoke`: `Intimidation · DC 12`

**D20 shape**: CSS hexagon via `clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)` with a subtle drop shadow. Size: 96×96px.

**Flavor text**: single-line field, 100 character limit (show counter `42/100` after 60 chars typed). Sent as `playerActionText` when non-empty; `'attack'` when blank. When the keyboard opens, the sheet must reflow to keep the modifier/target line visible above it; if available height < ~280px, collapse to a single inline line (`+5 · vs Skeleton Guard · AC 11`) and pin ROLL to the keyboard top edge.

### Where it mounts
In `app/v2/play/page.tsx`, alongside the existing modals. Triggered by a new `rollSheetAction` state:
```typescript
const [rollSheetAction, setRollSheetAction] = useState<{
  hint: 'attack' | 'hide' | 'provoke' | 'shove';
  validTargets: TargetOption[];
} | null>(null);
```

ActionChips gains a new `onOpenRollSheet` prop instead of emitting text for attack-type actions.

**Which chips open the roll sheet vs. direct-fire**:
- `attack` → roll sheet (contested roll; target picker)
- `shove` → roll sheet (Strength contest; target picker, close-only)
- `hide` → roll sheet (Stealth check; no target picker)
- `provoke` → roll sheet (Intimidation check; target picker)
- `dodge` / `dash` / `disengage` → direct-fire via `executeDirectAction` (no roll)
- `use_item` → existing item picker sheet
- class features → existing `handleFeatureActivate` flow

### Computing `validTargets` (replaces old `attackBonus` + `closestEnemyTarget` derivation)

In `play/page.tsx`, derive before passing to ActionChips:

```typescript
const validTargets = useMemo((): TargetOption[] => {
  if (!displayCombatState) return [];
  return displayCombatState.initiativeOrder
    .filter(e => e.type === 'enemy' && e.hp > 0)
    .map(e => ({ id: e.id, name: e.name, ac: e.ac, hp: e.hp, maxHp: e.maxHp, proximity: e.proximity }));
}, [displayCombatState]);

// For shove: caller filters to close-only when building the roll sheet action
const validShoveTargets = useMemo(
  () => validTargets.filter(t => t.proximity === 'close'),
  [validTargets]
);
```

Pass `characterStats?.attackBonus ?? 0` directly as the `attackBonus` prop — no client-side recomputation.

### `onRoll` implementation in page.tsx

```typescript
const handleRoll = useCallback(async (
  hint: 'attack' | 'hide' | 'provoke' | 'shove',
  flavorText: string,
  targetId: string | null,
): Promise<RollSheetResult> => {
  const text = flavorText.trim() || hint;
  // executeDirectAction returns void today — enhance it to return the parsed result
  // or inline the fetch here and call applyActionResponse on the data
  const data = await dispatchAction(text, hint, targetId);
  return {
    d20: data.rollResult?.d20 ?? 0,
    success: data.rollResult?.success ?? false,
    isCrit: data.rollResult?.isCrit ?? false,
    damageDealt: data.rollResult?.damage,
    targetDefeated: data.rollResult?.targetDefeated,
  };
}, [dispatchAction]);
```

`executeDirectAction` needs to be refactored into `dispatchAction` that returns the API response data (not void). `applyActionResponse` is called inside `dispatchAction` to update local state. See Architecture Contracts §2.

**Note**: The server must return `rollResult: { d20, success, isCrit, damage?, targetDefeated? }` in the action response. This requires a small addition to the `ViewStatePayload` type and the action API handler to forward the combat roll result. The engine already has this data in `combatResult.rollLogs[0]`.

---

## Feature 2 — Contextual Chips

### Scoring function
**File**: `components/v2/combat/chip-scoring.ts` (new)

Each chip receives a `score` (0–4), `label` override, `variant`, and `visible` flag. **Chip position is stable between turns** — score does not drive reordering on every turn. Exception: if `myHpPct ≤ 0.25` AND ≥1 enemy is close, Dodge and Back Off are pinned to positions 1 and 2 regardless of score. This reorder happens once when the player enters the danger threshold and does not shuffle further.

The scoring function is pure: `scoreChips(combatState: CombatState, characterId: string, characterClass: string, hasHealingItems: boolean): ScoredChip[]`. It receives only what it needs; no React context.

```typescript
export interface ScoredChip {
  id: string;
  label: string;
  score: number;           // 0–4; used only for emergency danger reorder
  variant: ChipVariant;
  killBlow: boolean;       // attack chip only — fires a single CSS pulse when true
  visible: boolean;
  hint: string;            // action_hint to send
}

export type ChipVariant =
  | 'default'    // slate border, normal
  | 'primary'    // indigo — top recommended action
  | 'success'    // emerald — player buff active (hiding, advantage)
  | 'danger'     // red — escape/defensive
  | 'class'      // purple — class feature synergy
  | 'dim';       // faded — available but not recommended

export function myHpPct(combatState: CombatState, characterId: string): number {
  const entry = combatState.initiativeOrder.find(e => e.id === characterId);
  if (!entry || entry.maxHp === 0) return 1;
  return entry.hp / entry.maxHp;
}
```

**Note on ActionChips renderer**: `chip-scoring.ts` produces metadata (label, variant, visible, killBlow) for the chips that already exist. It does **not** replace the renderer's internal state machine. The sub-picker expansion states for Cunning Action and Ki, the `chip`/`setChip` state, and class feature list detection remain inside `ActionChips.tsx`. Scoring feeds the *display properties* of each chip; the renderer still owns interaction.

**Scoring rules** (evaluated in order, additive):

### `attack`
| Condition | score delta | label | variant | killBlow |
|---|---|---|---|---|
| baseline | +1 | "Attack" | default | false |
| `myEntry.status_effects.includes('hiding')` | +3 | "Sneak Attack" | success | false |
| `myEntry.status_effects.includes('smite_pending')` | +2 | "Attack + Smite" | class | false |
| `myEntry.status_effects` has `concentrating:hex:*` matching alive enemy | +1 | "Attack + Hex" | class | false |
| `myEntry.status_effects` has `concentrating:hunters_mark:*` matching alive enemy | +1 | "Attack + Mark" | class | false |
| Enemy min HP ≤ 25% of maxHp (killing blow likely) | +2 | label unchanged | primary | **true** |
| All enemies `proximity === 'far'` | −1 | label unchanged | dim | false |

When `killBlow` is true, the attack chip fires `animate-[pulse_1s_ease-in-out_1]` once — a single pulse, not looping. This is the only animated chip in the system.

### `shove` (new chip)
| Condition | score | label | variant | visible |
|---|---|---|---|---|
| No enemy at `proximity === 'close'` | — | — | — | false |
| Enemy at `close`, baseline | +1 | "Shove" | default | true |
| Enemy at `close` AND myHpPct > 0.6 AND enemy HP > 10 | +2 | "Shove" | default | true |

### `dodge`
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline | +0 | "Dodge" | default |
| `myHpPct ≤ 0.25` | +3 | "Dodge" | danger |
| `myHpPct > 0.25 && ≤ 0.5` AND ≥2 enemies close | +2 | "Dodge" | danger |
| `myHpPct > 0.25 && ≤ 0.5` | +1 | "Dodge" | default |

### `disengage` — displayed as "Back Off"
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline | +0 | "Back Off" | default |
| `myHpPct ≤ 0.25` AND ≥1 enemy close | +3 | "Back Off" | danger |
| `myHpPct ≤ 0.4` AND ≥1 enemy close | +1 | "Back Off" | default |

### `dash`
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline | +0 | "Dash" | default |
| All alive enemies are `proximity === 'far'` | +2 | "Close In" | primary |
| `myHpPct ≤ 0.25` (fleeing scenario) | +1 | "Dash" | danger |
| All enemies close, no reason to dash | −1 | "Dash" | dim |

### `hide`
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline | +0 | "Hide" | default |
| `characterClass === 'Rogue'` AND not already hiding | +2 | "Hide" | class |
| Already hiding | — | — | — (chip hidden; state shown as status badge) |

When already hiding, do not render a chip. Instead render a status badge above the chip row: `● Hidden — Sneak Attack active`. This reads as state, not as an action the player is expected to tap.

### `use_item`
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline (has combat items) | +0 | "Use Item" | default |
| `myHpPct ≤ 0.2` AND has healing items | +3 | "Use Potion" | danger |
| `myHpPct ≤ 0.4` AND has healing items | +2 | "Use Potion" | danger |
| No combat items | — | — | — (invisible) |

### `provoke`
| Condition | score delta | label | variant |
|---|---|---|---|
| baseline | +0 | "Provoke" | default |
| `characterClass` in `['Fighter', 'Barbarian', 'Paladin']` AND enemy has no priority target | +1 | "Taunt" | default |

### Visual treatment per variant
```
primary  → bg-indigo-500 text-white border-indigo-500
success  → bg-emerald-500 text-white border-emerald-500
danger   → bg-red-500 text-white border-red-400
class    → bg-purple-500 text-white border-purple-400
default  → border-slate-300 text-slate-600 bg-white
dim      → border-slate-200 text-slate-300 opacity-60 pointer-events-none
```

Recommended/active chips use a solid filled background. Solid fill reads immediately as "this is the one" without animation. The `dim` variant is non-interactive.

Add a `"?"` chip at the far right of the chip row. Tapping it opens a bottom sheet glossary with each available action and a one-line description — the only in-combat discovery path for unfamiliar actions.

### Existing class feature chips
Class feature chips (Rage, Smite, Ki, etc.) always render after the standard chips, unchanged. They already have their own border treatment.

---

## Feature 3 — Flavor Text Narration

### Requirement
- Attack chip tap opens the roll sheet (no text required)
- The roll sheet has an optional flavor text field
- When text is provided ("kick him in the nuts"), the DM must literally incorporate it and mirror the tone
- When blank, DM uses default combat language

### Tone: the DM is a yes-and improv partner
The DM never sanitizes or generalizes what the player described. Whatever absurdity the player offers, the world responds to it seriously while honoring the comedy. A bad roll means the absurd plan fails in an even more absurd way. A critical hit means the universe rewards the audacity.

### Data flow
1. Roll sheet collects `flavorText: string` (may be empty)
2. On submit: `playerActionText = flavorText.trim() || hint` (hint = 'attack', 'shove', etc.)
3. This flows unchanged through the existing `POST /api/v2/game/action` body
4. In `game-controller.ts`, when processing a combat action, check if `playerActionText` is more than a bare action word:
   ```typescript
   const BARE_ATTACK_WORDS = new Set(['attack', 'i attack', 'hit', 'strike', 'shove', 'i shove', 'hide', 'i hide', 'dodge', 'i dodge', 'provoke', 'i provoke', 'disengage', 'dash']);
   const hasFlavorText = !BARE_ATTACK_WORDS.has(parsedActionText.toLowerCase().trim()) && parsedActionText.trim().length > 0;
   if (hasFlavorText) {
     allCombatFacts.push(
       `PLAYER FLAVOR: "${parsedActionText}". You MUST incorporate this exact action into your narration verbatim and match the player's tone precisely.`
     );
   }
   ```

### Narrative prompt addition — flavor text rule
Replace the vague STRICT INSTRUCTIONS note with this concrete block in `buildNarrativeSystemPrompt`:

```
- FLAVOR TEXT RULE: If the ENGINE UPDATE contains a "PLAYER FLAVOR:" line, you are bound to honor it. Rules:
  1. Use the player's described action literally — if they say "kick him in the nuts", the narration must involve a kick to the groin specifically. Do not substitute a generic "strike" or "attack."
  2. Mirror tone exactly. Comedic input (belly slam, sneeze attack, pretending to be a statue) demands comedy in return — the enemy reacts with appropriate humiliation, confusion, or wounded pride. Dramatic input demands drama.
  3. The world takes the action seriously even when it's absurd. A sneeze attack is still an attack. A belly slam is still a shove. Commit to the bit.
  4. On a miss or fumble, the failure must also honor the flavor — "Kira winds up for the groin kick and catches her boot on a loose stone, spinning completely around" not "Kira misses."
  5. On a hit, the enemy's reaction must match — "the cultist keels over, grabbing himself and muttering 'that's so mean'" not "the enemy takes damage."
  6. On a critical, go further — the universe rewards audacity. Something extra happens. The remaining enemies reconsider their life choices.
```

### Flavor text examples baked into prompt
Append these as reference examples inside the system prompt (so the model has concrete anchors):

```
FLAVOR EXAMPLES (reference — do not reproduce verbatim, use as tone calibration):

"kick him in the nuts" + roll 18 (hit):
→ "Kira's boot connects squarely. The cultist's eyes go wide, his chanting stops mid-syllable, and he folds forward with a pained wheeze, clutching himself as he staggers back — muttering something about how that's really not fair."

"kick him in the nuts" + roll 1 (fumble):
→ "Kira winds up for a devastating low blow and catches her boot on a loose floor stone, spinning herself completely around and stumbling into the wall. The cultist watches, briefly confused, then raises his dagger."

"I sneak attack him with the feather I found" + roll 20 (crit):
→ "Dane flicks the feather with surgical precision — directly into the guard's eye, which turns out to be a critical weakness nobody anticipated, least of all the guard. He staggers, clawing at his face, taking 14 damage from what is technically a feather. A bard two towns over feels a sudden urge to write something down."

"I use my belly to body slam him" + roll 7 (failed shove contest):
→ "Brom thunders forward with tremendous conviction and bounces off the guard like a rubber ball off a castle gate. He ends up right where he started. The guard is now braced, grinning, and personally insulted that it didn't work."

"I pretend to be a decorative statue and hold my breath" + roll 4 (failed hide):
→ "Tomas freezes in his most heroic pose — arm raised, chin lifted. The guard looks directly at him, then at the empty pedestal two feet away, then back at Tomas. 'Okay,' the guard says, and raises his crossbow."

"I say 'I just remembered I left the oven on' and walk away calmly" + disengage:
→ "'Oh no,' says Vex, with sudden, urgent calm. 'The oven.' She begins walking toward the door at a measured pace. The orc, briefly thrown, does not swing. By the time he remembers he should, she's already past him."

"I tell him his helmet makes him look like a bucket" + roll 15 (successful provoke):
→ "The guard's jaw tightens. His hand goes involuntarily to the helmet. Something behind his eyes shifts. 'You,' he says, pointing at Dane with his sword. He is now very personally invested in your death specifically."

"I tell him his helmet makes him look like a bucket" + roll 1 (failed provoke — enemy gains advantage):
→ "'It does look like a bucket,' the guard admits, almost warmly. 'My wife got it from the market.' He seems genuinely charmed. He's also going to kill you now, and he feels great about himself."

"I close my eyes and hope for the best" + dodge:
→ "Perrin squeezes his eyes shut, tucks his chin, and braces. Somehow, this works. The skeleton's sword trims a lock of hair but finds nothing else. Perrin opens one eye. Still alive."

"I do a backflip and land on his head" + roll 20 (crit):
→ "Against all reasonable expectation, the backflip works. Sable's boots connect with the top of the cultist's skull on the way down — 16 damage, zero dignity remaining for anyone involved. The second cultist stops mid-chant to stare."
```

### No text required
The roll sheet submits the bare `hint` word as `playerActionText` when flavor is empty. The intent parser already handles bare action words. No pipeline changes needed for the no-flavor path.

### Direct-fire action flavor (follow-on, not a blocker)
Dodge, Dash, and Back Off fire immediately with no roll sheet. As a follow-on after Feature 1 ships, these can accept optional flavor: tapping the chip reveals a single-line text input inline above the chip row with a **Go** button. If the player taps elsewhere without typing, the action fires normally with the bare action word.

---

## Feature 4 — Severity-Aware Narration

### Requirement
A d20 roll of 2 vs 18 should produce noticeably different prose, even when both are hits or both are misses. The tone should track the number, not just the binary outcome.

### Data flow
The `resolveCombatAction` function already returns `rollLogs` with `d20` values. In `game-controller.ts`, extract the primary roll and inject severity context:
```typescript
const primaryRoll = combatResult.rollLogs[0];
if (primaryRoll) {
  const d20 = primaryRoll.d20;
  const outcome = primaryRoll.isCrit ? 'critical hit' : primaryRoll.success ? 'hit' : d20 === 1 ? 'fumble' : 'miss';
  allCombatFacts.push(`ROLL SEVERITY: d20=${d20}, outcome=${outcome}`);
}
```

This injection happens on the attack branch only. Add a unit test asserting that after `resolveCombatAction` returns with a roll, `allCombatFacts` contains a `ROLL SEVERITY:` entry — this is not covered by the existing test suite.

### Narrative prompt addition — severity rule
In `buildNarrativeSystemPrompt`, add to STRICT INSTRUCTIONS:

```
- ROLL SEVERITY RULE: If the ENGINE UPDATE contains "ROLL SEVERITY:", scale your narration's drama, length, and specificity to match the d20 value. The tone ladder:

  d20=1  (FUMBLE): Something goes wrong beyond just missing. The failure is specific, physical, slightly humiliating. One extra sentence describing what went wrong. If flavor text exists, the failure must honor it literally.
  
  d20=2–5 (BAD MISS): Embarrassingly off-target. The enemy barely had to move. Short, slightly deflating.
  
  d20=6–11 (CLEAN MISS): A genuine attempt that didn't connect. Neutral, matter-of-fact. No pity, no drama.
  
  d20=12–16 (SOLID HIT): Workmanlike. Confident. The blow lands with impact. Don't over-dramatize — a 14 is not a legend-making moment.
  
  d20=17–19 (DECISIVE HIT): Clearly felt. The enemy is affected. One concrete physical detail about the impact or the enemy's reaction.
  
  d20=20 (CRITICAL HIT): Legendary. The universe rewards the audacity. Longer sentence — one extra detail about the enemy's reaction or something unexpected that happens. If anyone else in the room is watching, they notice.

EXAMPLES calibrating the ladder:

"kick him in the nuts" — d20=1:
  "Kira winds up for a devastating low blow and catches her boot on a loose floor stone, spinning herself completely around and stumbling into the wall. The cultist watches, briefly confused, then raises his dagger."

"kick him in the nuts" — d20=8 (miss):
  "Kira aims low, but the cultist sidesteps at the last moment, leaving her kicking enthusiastically at empty air. He takes a polite step back."

"kick him in the nuts" — d20=14 (hit):
  "Kira's boot connects squarely. The cultist's eyes go wide, his chanting stops mid-syllable, and he folds forward with a pained wheeze."

"kick him in the nuts" — d20=18 (hit):
  "The kick lands with a crack that echoes off the stone walls. The cultist keels over, grabbing himself and muttering through gritted teeth — 'that's so mean' — before collapsing to one knee."

"kick him in the nuts" — d20=20 (crit):
  "Kira's boot connects with the force of divine judgment. The cultist lets out a sound that hasn't been heard in this dungeon in centuries, corkscrews slowly to the ground, and lies there whispering something about retirement. The remaining guard takes one look and backs against the wall."

---

Non-flavor severity examples (default attack narration, no flavor text):

d20=1 (fumble): "The swing goes wide — badly. [Character]'s momentum carries them past the target entirely and they have to catch themselves on the wall. [Enemy] doesn't even bother to step back."

d20=4 (miss): "[Character] slashes at [enemy] but the blow glances off armor without finding purchase. [Enemy] barely shifts."

d20=13 (hit): "The blade finds a gap and bites. [Enemy] grunts and absorbs the blow, but [X] damage has been done."

d20=19 (hit): "The strike is clean and hard — [enemy] staggers, clearly hurt, breathing through the pain. [X] damage."

d20=20 (crit): "A perfect hit. The blade drives home with [X] damage and [enemy] reels — this fight just changed."
```

---

## Feature 5 — Shove Mechanic (Engine)

### `PoiCombatStats` addition (`lib/v2/poi-context.ts`)
```typescript
export interface PoiCombatStats {
  // ... existing fields ...
  str_score?: number;  // used for Shove contest; defaults to 10
}
```

### `ActionType` addition (`types/v2-game.ts`)
```typescript
export type ActionType =
  // ... existing ...
  | 'shove';
```

### `str_score` on `InitiativeEntry` (`types/v2-game.ts`)
```typescript
export interface InitiativeEntry {
  // ... existing fields ...
  str_score?: number;  // stamped at enterCombat from PoiCombatStats; defaults to 10
}
```

Stamp it at `enterCombat` alongside `ac` and `passive_perception` — no need to pass `poiInstances` into `resolveCombatAction`.

### Engine resolution (`lib/v2/combat-engine.ts`)
In `resolveCombatAction`, add after the `provoke` branch:
```typescript
} else if (action.action_type === 'shove') {
  const targetId = action.target_poi_instance_id;
  const targetIdx = targetId
    ? order.findIndex(e => e.id === targetId && e.proximity === 'close' && e.hp > 0)
    : order.findIndex(e => e.type === 'enemy' && e.proximity === 'close' && e.hp > 0);
  
  if (targetIdx === -1) {
    facts.push(`${character.name} tries to shove but no enemy is close enough.`);
  } else {
    const target = order[targetIdx];
    const strMod = abilityModifier(character.baseStrength);
    const profBonus = character.level >= 5 ? 3 : 2;
    const playerContest = randomInt(1, 21) + strMod + profBonus;
    
    const enemyStrScore = target.str_score ?? 10;
    const enemyContest = randomInt(1, 21) + abilityModifier(enemyStrScore);
    
    if (playerContest > enemyContest) {
      order[targetIdx] = { ...target, status_effects: [...target.status_effects.filter(s => s !== 'prone'), 'prone'] };
      facts.push(`${character.name} shoves ${target.name} — contest ${playerContest} vs ${enemyContest}, success. ${target.name} is knocked prone (attacks against them have advantage; their attacks have disadvantage).`);
      rollLogs.push({ type: 'combat_roll', action: `${character.name} shoves ${target.name}`, d20: playerContest - strMod - profBonus, modifier: strMod + profBonus, total: playerContest, vsTarget: `Contest ${enemyContest}`, success: true });
    } else {
      facts.push(`${character.name} attempts to shove ${target.name} — contest ${playerContest} vs ${enemyContest}, failed.`);
      rollLogs.push({ type: 'combat_roll', action: `${character.name} shoves ${target.name}`, d20: playerContest - strMod - profBonus, modifier: strMod + profBonus, total: playerContest, vsTarget: `Contest ${enemyContest}`, success: false });
    }
    turnUsage = { ...turnUsage, actionUsed: true };
  }
```

### Target selection for shove
The roll sheet filters `validTargets` to close-only before passing them in (see Feature 1 — `validShoveTargets`). The selected target's `id` flows as `target_poi_instance_id`. If the Shove chip is tapped when only 1 close enemy exists, the single target is auto-selected in the sheet with no picker rendered.

### Intent parser addition (`lib/v2/ai-prompts.ts`)
In `buildHaikuStaticPrefix()`, add to the ACTION TYPES block:
```
- "shove"  — Player attempts to shove, push, trip, or knock down an enemy. Requires target_poi_instance_id. Only valid against enemies at close range. Uses a Strength contest.
- "back off" / "disengage" — maps to action_hint "disengage"
```

### Prone clearing (engine)

Prone is cleared at the **start of the prone combatant's next turn** in the enemy auto-resolve loop. This represents them spending half their movement to stand — handled passively by the engine rather than requiring an explicit `stand` action.

In the enemy auto-resolve loop in `combat-engine.ts`, before processing any action for an enemy entry:

```typescript
// At the top of each enemy's turn processing block:
if (entry.status_effects.includes('prone')) {
  order[idx] = {
    ...entry,
    status_effects: entry.status_effects.filter(s => s !== 'prone'),
  };
  facts.push(`${entry.name} stands up.`);
  entry = order[idx];  // rebind so the rest of this turn uses the updated entry
}
```

This runs before the enemy selects or executes its action, so the standing-up fact appears first in the narrative and the enemy's attack on that same turn does not have disadvantage. Prone clears only once per turn — if the enemy is shoved again later in the same round, the status re-applies.

**Boundary conditions**:
- If the combat ends while an enemy is prone, the status is discarded with the `combatState` — no cleanup needed.
- If the prone enemy is killed before their next turn (e.g., player kills them), the status is discarded with their `InitiativeEntry` — no cleanup needed.
- The player character cannot be knocked prone by any current mechanic, so prone clearing only needs to run in the enemy auto-resolve loop.

### Prone indicator (UI)
After a successful shove, the target's entry in the initiative order display must show `(prone)` appended to the enemy name. This updates to remove the badge at the start of that enemy's next turn (when the engine clears the status and returns the updated `combatState`). The prone status already exists in `status_effects` — this is a display-only change in the combat state UI component.

---

## Feature 6 — Narrative Arrival UX (poll + shimmer fallback)

Polling starts the moment `onRoll` resolves — during the animation, not after the sheet dismisses. The narrative is written to the DB by the fire-and-forget Haiku call that started at the same time. In the happy and median cases the poll resolves while the animation is still playing and the narrative slides into chat with no gap.

**Poll loop** (starts in `handleRoll` when the server responds):
```typescript
const pollNarrative = (since: string, maxAttempts = 8) => {
  let attempts = 0;
  const id = setInterval(async () => {
    attempts++;
    const res = await fetch(`/api/v2/room/history?roomInstanceId=...&since=${since}`);
    const { logs } = await res.json();
    if (logs?.length > 0) {
      clearInterval(id);
      applyNarrativeEntries(logs);  // merges into history, strips shimmer if present
    } else if (attempts >= maxAttempts) {
      clearInterval(id);  // 4s timeout — shimmer stays if something went wrong
    }
  }, 500);
};
```

**Shimmer** — injected only if the poll hasn't resolved by the time the sheet dismisses (~2.5s after tap). At that point the animation is done and the chat needs to show something:

```typescript
// In onDismiss handler — only inject if narrative not yet arrived
if (!narrativeArrived.current) {
  setHistory(prev => [...prev, {
    id: `shimmer-${Date.now()}`,
    role: 'assistant',
    content: '',
    isShimmer: true,
    createdAt: new Date().toISOString(),
  }]);
}
```

The poll's `applyNarrativeEntries` always strips any shimmer entries before merging real narrative, so there's no double-entry risk.

This requires:
- `isShimmer?: boolean` added to `HistoryEntry`
- Shimmer CSS component in the message renderer (2–3 gray bars, `animate-pulse`)
- `applyNarrativeEntries` strips `isShimmer` entries before merging

---

## Files Changed

| File | Change |
|---|---|
| `types/v2-game.ts` | Add `'shove'` to `ActionType`; add `str_score?: number` to `InitiativeEntry`; add `isShimmer?: boolean` to `HistoryEntry`; add `rollResult?: { d20, success, isCrit, damage?, targetDefeated? }` to `ViewStatePayload`; add `target_poi_instance_id?: string` to action request body type |
| `lib/v2/poi-context.ts` | Add `str_score?: number` to `PoiCombatStats` |
| `lib/v2/combat-engine.ts` | Add shove resolution; stamp `str_score` on enemy entries in `enterCombat`; clear `prone` at top of each enemy's turn in auto-resolve loop |
| `lib/v2/ai-prompts.ts` | Add `shove` action type; add flavor text + severity rules to `buildNarrativeSystemPrompt` |
| `lib/v2/game-controller.ts` | (1) Intent-parse bypass for roll-sheet actions (see §6); (2) fire-and-forget `generateAndPersistNarrative` at line 1684 with `.catch` fallback via `persistFallbackNarrative`; (3) inject flavor/severity facts into `allCombatFacts`; (4) forward `rollResult` from `combatResult.rollLogs[0]` in response |
| `lib/v2/game-controller.ts` (new helper) | `persistMechanicalSummary(sessionId, roomInstanceId, combatResult)` — formats and writes a mechanical summary from `combatResult.rollLogs[0]` to the history table; called only when both Haiku attempts fail |
| `lib/v2/view-state.ts` | Pass `rollResult` through to `ViewStatePayload` when present |
| `components/v2/combat/chip-scoring.ts` | New — pure scoring function |
| `components/v2/combat/ActionChips.tsx` | Consume chip-scoring for display metadata; add `onOpenRollSheet` prop; convert attack/shove/hide/provoke to open sheet; preserve sub-picker and class feature logic unchanged |
| `components/v2/combat/CombatRollSheet.tsx` | New — bottom sheet with target picker, d20 animation, `onRoll` callback pattern |
| `app/v2/play/page.tsx` | Extract `applyActionResponse`; refactor `executeDirectAction` → `dispatchAction` (returns data, sends `target_poi_instance_id`); add `rollSheetAction` state; mount `CombatRollSheet`; implement `handleRoll` with poll loop; compute `validTargets` + `validShoveTargets`; shimmer fallback logic |

---

## Implementation Order (layered, with test gates)

### Layer 0 — Pure types (no runtime risk)
1. `types/v2-game.ts` — add `'shove'`, `str_score`, `isShimmer`, `rollResult`
2. `lib/v2/poi-context.ts` — add `str_score` to `PoiCombatStats`
- **Gate**: `tsc --noEmit` passes

### Layer 1 — Pure functions, fully testable in isolation
3. `chip-scoring.ts` — pure scoring function
4. `chip-scoring.test.ts` — all scoring table rows
- **Gate**: all chip-scoring unit tests pass; no other files touched

### Layer 2 — UI-only, mock backend
5. `CombatRollSheet.tsx` — build with mock `onRoll: async () => ({ d20: 17, success: true, isCrit: false })`
6. Wire into a test harness or storybook-style page to visually verify: target picker renders, animation plays, outcome colors correct, keyboard reflow works
- **Gate**: visual smoke test confirms animation and target picker; no backend involved

### Layer 3 — page.tsx refactor (prerequisite for roll sheet integration)
7. Extract `applyActionResponse` from `executeDirectAction`
8. Refactor `executeDirectAction` → `dispatchAction` that returns parsed data
9. Verify: existing combat flow (direct-fire chips) unchanged
- **Gate**: existing manual smoke tests pass; regression checklist items for Dodge/Dash/Disengage/class features pass

### Layer 4 — Roll sheet integration
10. Add `rollSheetAction` state + `validTargets`/`validShoveTargets` memos to `page.tsx`
11. Implement `handleRoll` callback
12. Mount `CombatRollSheet`; wire `onRoll`, `onComplete`, `onDismiss`
13. Update `ActionChips` with `onOpenRollSheet` prop; chip-scoring display properties
14. Add shimmer placeholder logic
- **Gate**: manual — Attack/Shove/Provoke/Hide open sheet; sheet fires action; result lands; narrative arrives; shimmer replaced. Dodge/Dash/Back Off still direct-fire.

### Layer 5 — Backend mechanics (isolated from UI)
15. Shove engine in `combat-engine.ts`; stamp `str_score` at `enterCombat`
16. `ai-prompts.ts` — shove action type, flavor + severity rules
17. `game-controller.ts` — inject flavor/severity facts; forward `rollResult` in response
18. `view-state.ts` — pass `rollResult` through
- **Gate**: `combat-engine.test.ts` + `ai-prompts.test.ts` + new severity-injection test pass

### Layer 6 — Latency optimisations
19. `game-controller.ts` — intent-parse bypass (Architecture Contracts §6, Optimisation A)
20. `game-controller.ts` — fire-and-forget narrative at line 1684 (Optimisation B)
21. `page.tsx` — poll loop in `handleRoll`; shimmer fallback in `onDismiss`
- **Gate**: measure response time before and after — server response must arrive before 2100ms animation completes under normal conditions. Verify free-text (non-roll-sheet) actions still call `parseIntentWithHaiku`. Verify narrative still persists to DB (check message log after action).

### Layer 7 — Full integration + regression
22. End-to-end smoke tests (see Testing Plan)
23. Regression checklist (must not break)

---

## Testing Plan

### Unit tests

**`chip-scoring.test.ts`** — cover all scoring table rows:
- [ ] Hidden rogue → Sneak Attack chip, score ≥ 4, variant = success
- [ ] Smite pending → "Attack + Smite" chip, score ≥ 3
- [ ] Player HP ≤ 25% → Dodge and Disengage score ≥ 3; attack score unchanged
- [ ] All enemies far → "Close In" dash chip, score ≥ 2; attack variant = dim
- [ ] Enemy at close range → Shove chip visible
- [ ] No enemy close → Shove chip not visible
- [ ] Action already used → all action chips appear disabled
- [ ] Enemy near death → attack chip `killBlow = true`, variant = primary, single CSS pulse fires
- [ ] Single target → no target picker rendered
- [ ] Multiple alive enemies → target picker rendered, default = first close enemy

**`combat-engine.test.ts`** — extend existing tests:
- [ ] Shove success → target gains `prone` status effect
- [ ] Shove failure → target has no new status effects
- [ ] Shove with no close enemy → fact "no enemy close enough"
- [ ] Shove with `target_poi_instance_id` → targets specified enemy, not first close
- [ ] Existing attack with prone enemy → `hasAdvantage` is true (regression)
- [ ] Shove consumes action (`actionUsed = true`)
- [ ] `str_score` stamped on enemy `InitiativeEntry` at `enterCombat`
- [ ] Attack with `target_poi_instance_id` → targets specified enemy
- [ ] Attack with dead `target_poi_instance_id` → falls back to first alive enemy (regression)

**`ai-prompts.test.ts`** — narrative prompt content:
- [ ] `buildNarrativeSystemPrompt` with flavor fact → contains "FLAVOR TEXT RULE"
- [ ] `buildNarrativeSystemPrompt` with severity fact → contains "ROLL SEVERITY RULE"
- [ ] `buildHaikuStaticPrefix` → contains "shove" action type
- [ ] After attack resolves, `allCombatFacts` contains `ROLL SEVERITY: d20=...` entry

**`applyActionResponse` unit test** (new):
- [ ] History merging: new entries appended, existing IDs deduplicated
- [ ] Shimmer entry stripped before merging real narrative
- [ ] `gameState` transition from exploration → combat inserts banner entry
- [ ] `gameState` transition from combat → exploration inserts end banner

**Latency / bypass tests** (new):
- [ ] Action with `action_hint='attack'` + `target_poi_instance_id` in body → `parseIntentWithHaiku` is NOT called; `ExtractedAction` constructed directly with correct `action_type` and `target_poi_instance_id`
- [ ] Action with `action_hint='attack'` but NO `target_poi_instance_id` in body → `parseIntentWithHaiku` IS called (free-text path unaffected)
- [ ] After fire-and-forget change: server response arrives before `generateAndPersistNarrative` completes (assert `rollResult` present in response, narrative not yet in DB)
- [ ] Narrative eventually persists to DB after fire-and-forget (poll succeeds within 4s)
- [ ] `generateAndPersistNarrative` throws once → retry fires → retry succeeds → narrative in DB; `persistMechanicalSummary` not called
- [ ] Both `generateAndPersistNarrative` attempts throw → `persistMechanicalSummary` called with correct `combatResult` → mechanical summary written to DB → poll resolves within 4s
- [ ] Mechanical summary format (hit): contains d20 value, total, target name, AC, damage dealt
- [ ] Mechanical summary format (miss): contains d20 value, total, target AC, "Miss"

### Integration / smoke tests (manual)

**Haiku failure / mechanical summary:**
- [ ] Simulate both Haiku attempts failing → shimmer resolves to mechanical summary text (e.g. "You attack the Skeleton Guard — roll 17 + 5 = 22 vs AC 11. Hit. 8 damage dealt.") with muted/monospace styling; no frozen shimmer
- [ ] Mechanical summary renders visually distinct from DM prose (muted color or monospace treatment)
- [ ] After mechanical summary appears → chips are active; player can take next action without page refresh

**Roll sheet flow:**
- [ ] Tap Attack chip → roll sheet appears with correct `attackBonus` (matches `characterStats.attackBonus`)
- [ ] Multiple enemies alive → target picker shows all alive enemies with HP bars and proximity badges
- [ ] Tap different target in picker → modifier line updates to show new target's name and AC
- [ ] Single enemy alive → no target picker rendered; auto-selected
- [ ] Type flavor text + tap ROLL → animation plays, outcome revealed, shimmer appears in chat, narrative replaces shimmer
- [ ] Leave flavor text blank + tap ROLL → action submits, narrative appears without errors
- [ ] Narrative with flavor text "kick him in the nuts" → DM response references the kick
- [ ] Server responds in < 1s → animation still runs full 1.6s before landing
- [ ] Server responds in > 2s → animation cycles until response, then lands
- [ ] `sending` in progress when Attack tapped → ROLL button disabled in sheet

**Dice animation:**
- [ ] Numbers cycle during animation phase (visually confirm)
- [ ] Landing number matches the `CombatRollBadge` value that appears in chat
- [ ] CRIT → amber-400 background; HIT → emerald-500; MISS → red-400; FUMBLE → red-700
- [ ] Damage roll appears below attack roll on hit

**Contextual chips:**
- [ ] Start combat healthy, enemy close → chips in order: Attack, Shove, class feature, Dodge, ...
- [ ] Get below 25% HP with enemy close → Dodge and Back Off pin to positions 1 and 2 with solid red fill
- [ ] Activate hiding → "Sneak Attack" chip with solid emerald fill; status badge "● Hidden — Sneak Attack active" appears above chip row
- [ ] Activate Divine Smite → "Attack + Smite" chip with solid purple fill
- [ ] All enemies flee to far → "Close In" chip replaces standard Dash

**Shove mechanic:**
- [ ] "I shove the guard" → shove action resolves, prone applied on success
- [ ] Tap Shove chip (when close to enemy) → roll sheet opens with Strength bonus displayed; target picker shows close-only enemies
- [ ] After successful shove → next attack shows advantage (rollMode = 'advantage' in roll badge)
- [ ] No enemy close → Shove chip not visible
- [ ] Multiple close enemies → target picker in shove sheet, selected target receives prone on success

**Severity narration:**
- [ ] Roll of 1 → DM narrative describes a fumble / something going wrong
- [ ] Roll of 20 → DM narrative is noticeably more dramatic/expansive
- [ ] Roll of 12 (hit) vs roll of 18 (hit) → clearly different energy in prose

### Regression checklist (must not break)
- [ ] Existing combat round with attack → `CombatRollBadge` still appears in chat history
- [ ] Dodge / Dash / Back Off → still fire immediately without opening roll sheet
- [ ] Class feature chips (Rage, Smite setup, Ki, Cunning Action) → unchanged behavior including sub-pickers
- [ ] Death saving throw auto-resolve → unaffected
- [ ] End turn confirmation dialog → unchanged
- [ ] Opportunity attacks → still resolved server-side, badges still appear
- [ ] Concentration break → CON save still appears in narrative
- [ ] Item picker sheet → opens correctly from Use Item chip
- [ ] Remote combat (LoS ally) → roll sheet works in remote combat context
- [ ] Enemy auto-resolve loop → unaffected by new chip scoring
- [ ] Exploration mode → no chip-scoring code runs outside combat
- [ ] `applyActionResponse` refactor → direct-fire actions (Dodge, etc.) still update all state fields correctly

---

## Audit Findings — Test Engineer Review

Gaps found after first-pass review. Each item is either a required implementation fix or a missing test. Ordered by severity.

---

### Critical Gaps (require implementation changes)

#### 1. `generateAndPersistNarrative` failure is silent
Fire-and-forget removes the `await` but there is no `.catch`. If Haiku throws (rate limit, network error), the narrative never writes to DB, the poll exhausts all 8 attempts, and the shimmer persists indefinitely with no user feedback.

**Fix**: retry once on failure (most failures are transient), then fall back to a mechanical summary derived from `combatResult.rollLogs[0]`. Never leave the shimmer frozen. See Architecture Contracts §6 Optimisation B for the full code.

The mechanical summary (`persistMechanicalSummary`) formats from engine facts that are always available — e.g. `"You attack the Skeleton Guard — roll 17 + 5 = 22 vs AC 11. Hit. 8 damage dealt."` Rendered in chat with muted/monospace styling so it reads as a system message, not DM prose.

**Tests to add** (`game-controller.test.ts`):
- [ ] `generateAndPersistNarrative` throws once → retry fires → retry succeeds → narrative in DB; `persistMechanicalSummary` not called
- [ ] Both attempts throw → `persistMechanicalSummary` called with correct `combatResult` → mechanical summary written to DB → poll resolves
- [ ] Mechanical summary format: hit with damage → string contains d20 value, total, target name, AC, damage
- [ ] Mechanical summary format: miss → string contains d20 value, total, target AC, "Miss"

---

#### 2. Prone removal is never specified
Shove writes `prone` to `status_effects` but the plan contains no `stand` action type, no engine branch to clear it, and no test. "Persists until the enemy stands or combat ends" is stated but unimplemented.

**Fix**: in the enemy auto-resolve loop, at the start of each enemy turn, clear `prone` from that enemy's `status_effects` (representing them standing). Add a fact: `"${target.name} stands up."` Alternatively: implement as a passive — prone is cleared at the top of that combatant's next initiative entry processing.

**Tests to add** (`combat-engine.test.ts`):
- [ ] Enemy with `prone` has `prone` cleared at the start of their next turn
- [ ] Enemy with `prone` who has not yet taken a turn retains the status
- [ ] Prone enemy attacks after being cleared → no disadvantage applied

---

#### 3. Concurrent action race on `narrativeArrived.current`
If the user fires two actions in quick succession within a single combat turn, the second action's `onDismiss` reads `narrativeArrived.current` already set `true` by the first action's poll resolving. The shimmer is skipped for the second action and its narrative silently never renders.

**Fix**: scope `narrativeArrived` to each individual `handleRoll` call (local `let narrativeArrived = false` inside the async function) rather than a shared component ref. Pass it via closure into the poll loop and the `onDismiss` handler for that specific invocation.

**Test to add** (`page.tsx` integration):
- [ ] Two sequential actions within one turn → both narratives appear in history; shimmer injected and stripped for each independently

---

#### 4. Poll stops; late narrative never renders
After `maxAttempts = 8` (~4 seconds), the interval is cleared and the shimmer is frozen. If Haiku takes >4s (P95 tail), the narrative eventually persists to DB but the client never picks it up.

**Fix**: on the next user interaction after poll exhaustion (e.g., any chip tap, end-turn, scroll), re-fetch history from `since` once before proceeding. This acts as a lazy catch-up without keeping a permanent interval alive.

**Test to add**:
- [ ] Poll exhausts; user taps any chip → history re-fetch fires → late narrative appears; shimmer replaced

---

#### 5. `dispatchAction` has no timeout
If the network request hangs indefinitely, `sending` stays `true`, all chips become non-interactive, and combat is deadlocked with no recovery path.

**Fix**: wrap the `fetch` in `dispatchAction` with `AbortController` + a 15-second timeout. On timeout, set `sending = false` and surface an inline error: "The action timed out — try again."

**Test to add**:
- [ ] `dispatchAction` fetch hangs 15s → `sending` reset to `false`; error state shown; chips become interactive again

---

### Database Issues

#### 6. In-progress combats missing `str_score` after deploy
`str_score` is stamped at `enterCombat` for new combats. Any combat already in progress in the DB at deploy time has `str_score: undefined` on all `InitiativeEntry` rows for the duration of that session. The `?? 10` default applies silently — every enemy is treated as STR 10 mid-combat.

**No code fix needed** (default is acceptable), but the upgrade path must be documented and a test must confirm the fallback:

**Test to add** (`combat-engine.test.ts`):
- [ ] Shove against enemy with `str_score: undefined` in `InitiativeEntry` → defaults to STR 10; contest resolves without error

---

#### 7. `rollResult` missing-field path untested
If a client receives a cached or pre-deploy `ViewStatePayload` without `rollResult`, the `?? 0` fallbacks in `handleRoll` apply but the animation lands on `d20: 0` and `success: false`. No test confirms graceful degradation vs. a crash or visible glitch.

**Test to add**:
- [ ] Server returns action response with no `rollResult` field → animation still completes; sheet shows fallback outcome; no JS error

---

#### 8. History poll `since` timestamp source unspecified
The poll queries `?since={newestTimestamp}` but the plan does not specify what value this is. If it is derived from the client-side `createdAt` of the last local history entry (set during `applyActionResponse`), clock skew between client and DB can cause the narrative to be excluded from the poll response.

**Fix**: use the server-returned `createdAt` from the action API response (or the timestamp of the last persisted history entry returned from the action) as the `since` value, not a client-generated timestamp.

**Test to add**:
- [ ] Poll `since` value is derived from server timestamp, not `Date.now()` — assert value matches action response timestamp

---

### Edge Cases (missing unit/integration tests)

#### 9. Provoke via roll sheet sends `target_poi_instance_id`; engine branch may not handle it
The roll sheet sends `target_poi_instance_id` for `provoke` (Intimidation vs. DC 12 — no true enemy target). If the engine's provoke branch ignores `target_poi_instance_id`, the selected target and the taunted enemy may diverge.

**Tests to add** (`combat-engine.test.ts`):
- [ ] Provoke with `target_poi_instance_id` set → resolves against correct enemy's aggro; no crash
- [ ] Provoke via roll sheet path → `allCombatFacts` contains correct provoke result

---

#### 10. `hide` sends `target_poi_instance_id: null`; bypass condition must handle `null` vs `undefined`
The intent-parse bypass condition checks `body.target_poi_instance_id !== undefined`. For `hide`, the roll sheet sends `targetId: null` → `target_poi_instance_id: null` in the body. `null !== undefined` is `true`, so the bypass fires. This is correct, but must be an explicit test rather than an assumed side effect.

**Test to add** (bypass unit test):
- [ ] `action_hint='hide'` + `target_poi_instance_id: null` in body → bypass fires; `ExtractedAction` has `action_type: 'hide'`, `target_poi_instance_id: null`; `parseIntentWithHaiku` is NOT called

---

#### 11. Shove against already-prone enemy
The `filter(s => s !== 'prone'), 'prone'` pattern correctly prevents duplicates, but the action still consumes a full turn. In D&D 5e, shoving a prone enemy is legal but pointless. No test covers this path.

**Test to add** (`combat-engine.test.ts`):
- [ ] Shove success against enemy already `prone` → status effects unchanged (no duplicate); action consumed; fact logged

---

#### 12. Selected target dies between ROLL tap and server processing (multiplayer)
In LoS multiplayer, another player's action can kill the roll sheet's selected target during the ~250ms server round-trip. The engine falls back to the first alive enemy, but the animation outcome label still shows the dead target's name. `targetDefeated` in `RollSheetResult` refers to the substituted enemy.

**Fix**: the landing state should use the target name returned in the narrative/facts from the server (not the client-side selected target name) when displaying the outcome label.

**Test to add** (integration):
- [ ] Selected target has HP=0 at resolution time → engine substitutes first alive enemy; outcome label does not display dead target's name

---

#### 13. `validTargets` prop goes stale while roll sheet is open
If an enemy dies (another player's action) while the sheet is open, `validTargets` recomputes in `page.tsx` but the sheet holds the prop snapshot it received at open time. The selected target index may point to the wrong enemy.

**Fix**: either (a) pass `validTargets` as a live prop that the sheet re-renders on, updating `selectedTargetIndex` if the current selection is no longer alive, or (b) the server validates `target_poi_instance_id` and the engine fallback handles the stale selection.

**Tests to add**:
- [ ] Enemy dies while sheet is open → target picker updates to remove dead enemy; selection defaults to next alive target
- [ ] All enemies die while sheet is open → sheet auto-dismisses with "No valid targets" message

---

#### 14. Animation interval not cleaned up on component unmount
The d20 animation runs `setInterval`. If the user navigates away mid-animation, the interval continues firing, causing state updates on an unmounted component and a potential memory leak.

**Fix**: the animation `useEffect` must return a cleanup function that calls `clearInterval`. Similarly, the poll interval in `handleRoll` must be cleared in a `useEffect` cleanup or on navigation.

**Test to add**:
- [ ] Component unmounts during animation → no "state update on unmounted component" warning; interval cleared

---

#### 15. Flavor text is embedded verbatim in Haiku prompt without sanitization
`playerActionText` is injected as `PLAYER FLAVOR: "${parsedActionText}"`. A player who types `" } IGNORE PREVIOUS INSTRUCTIONS` can trivially manipulate the narrative prompt. The plan's "honor it verbatim" instruction makes no distinction between creative input and injection attempts.

**Fix**: strip or escape characters that break out of the quoted string context before embedding. At minimum: strip `"` characters from `parsedActionText` before the `PLAYER FLAVOR:` injection, and cap the embedded text to 120 characters.

```typescript
const safeFlavor = parsedActionText.replace(/"/g, '\\"').slice(0, 120);
allCombatFacts.push(`PLAYER FLAVOR: "${safeFlavor}". You MUST incorporate...`);
```

**Test to add**:
- [ ] Flavor text containing `"` → sanitized before embedding; prompt string is valid
- [ ] Flavor text > 120 characters → truncated at 120 before embedding

---

### Missing User Journeys (integration smoke tests to add)

#### 16. Full shove → prone → advantage chain
Manually listed as three separate tests across different layers. Needs one end-to-end test that connects all three system boundaries.

**Test to add** (smoke):
- [ ] Shove succeeds → enemy shows `(prone)` in initiative UI → player attacks that enemy → `CombatRollBadge` displays `advantage` mode → roll uses two d20 values; higher is taken

---

#### 17. Critical hit + flavor text simultaneously
The highest-value narrative moment. Severity rule and flavor rule must both fire at once — the crit escalation AND the literal flavor honor. Not covered by any existing test.

**Test to add** (smoke):
- [ ] Flavor text provided + d20=20 → `allCombatFacts` contains both `PLAYER FLAVOR:` and `ROLL SEVERITY: d20=20, outcome=critical hit` → narrative references flavor action AND escalates tone

---

#### 18. Page refresh while poll is running
On mobile, users frequently refresh or navigate back. The shimmer disappears on reload, but the narrative is in DB and reappears when history re-fetches. Combat state consistency depends on `rollResult` not being needed after reload (it is React-only state).

**Test to add** (smoke):
- [ ] Tap ROLL → immediately refresh page → on reload: narrative appears in history; combat state is consistent with action result; no orphaned shimmer

---

#### 19. End Turn fired while shimmer is visible
If the player taps End Turn before the narrative arrives, the end-turn flow fires while the poll is still running. When the narrative arrives, `applyNarrativeEntries` appends it — but the UI is already showing the next turn or enemy auto-resolve output.

**Fix**: either (a) block End Turn while `narrativeArrived.current` is false (warn the player "Waiting for narrative..."), or (b) allow it and let history append in order regardless. Document the intended behavior.

**Test to add** (smoke):
- [ ] Tap ROLL → tap End Turn immediately → narrative arrives during enemy auto-resolve → history order is correct: attack narrative appears before end-turn separator

---

#### 20. The "?" chip glossary
Mentioned once ("opens a bottom sheet glossary with each available action and a one-line description") with no component spec, no content, no props, and no test. As the only in-combat discovery path for unfamiliar actions, this needs a minimum spec before implementation.

**Required before Layer 4**: define the glossary sheet content (one line per action type listed in `COMBAT_DIRECT_HINTS` + class features), the component name, and at minimum one smoke test confirming it opens and is not empty.
