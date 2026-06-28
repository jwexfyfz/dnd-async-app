# Leveling Mechanics — Phases 9–12: Feature Engine

> **Design reference:** `PLAN-leveling-mechanics.md`
> **Previous file:** `PLAN-leveling-phases-5-8.md` (UI layer — must be complete)
>
> These phases implement the class feature system, subclass choice, feature resolution
> in combat, and rest mechanics. Phase 9 and Phase 10 are each split into sub-phases
> to contain scope and protect production flows.

---

## Design Context

### Rest Mechanics Design

**Short rest button:** visible in PartyTab only when (a) not in active combat AND (b) at least one `SHORT_REST` resource is below max. Hidden (not disabled) otherwise — a disabled button creates noise; absence creates clarity.

**Long rest triggers:**
1. `"Make Camp"` action — present only in rooms with `canLongRest: true` metadata; absent everywhere else.
2. Auto long rest — fires on session load when `character.lastActivity > 8 hours ago`. Reported in the `"While you were away…"` modal: *"Your party rested. HP and abilities restored."*

**Post-combat rest prompt:** the situation summary may surface a short-rest nudge in the AI narration after combat when resources are depleted. This is DM-authored ambient suggestion, not a forced UI gate.

---

### Character Creation Flow

The 2-column emoji class grid in `app/v2/setup/page.tsx` is replaced by a three-state overlay. All state is local component state — no routing changes. The outer form (point-buy, skill selection) is unchanged.

**Overlay states:**

| State | Shown when | What's displayed | Primary action |
|---|---|---|---|
| 1 — Class detail | Any class card tapped | Role, playstyle blurb, key stat, hit die, signature feature, subclass teaser list | `"Choose [Class]"` (L3 classes) or transitions to State 2 (L1/L2 classes) |
| 2 — Subclass picker | L1/L2 subclass classes only | `SubclassPicker` component (same as Phase 10B, reused) | Pick a subclass card |
| 3 — Confirmation | After subclass card tapped | Subclass name, unlocked features, `"This choice is permanent."` | `"Confirm — [Name]"` → closes overlay |

After overlay closes, the class grid shows a chip with a `✎` icon to re-open:

```
L3 class:                               L1 class with subclass:
┌────────────────────────┐              ┌──────────────────────────────────┐
│ ⚔ Fighter          ✎  │              │ ✟ Cleric · Life Domain       ✎  │
└────────────────────────┘              └──────────────────────────────────┘
```

The `✎` icon is only active before form submission. The chip becomes read-only after submit.

**Class/subclass timing at creation:**
- **L1 classes (Cleric, Sorcerer, Warlock):** State 2 is required — form cannot be submitted without a subclass selection.
- **L2 classes (Wizard, Druid):** Wizard uses no State 2 at creation — subclass deferred to L2 in-game pending-choice flow. Druid L2 follows the same in-game path.
- **L3 classes (Fighter, Rogue, Barbarian, etc.):** No State 2 at creation — subclass picker fires in-game at L3.

---

### Data Model

**New enums (added to `prisma/schema.prisma`):**

```prisma
enum FeatureType {
  PASSIVE
  STAT_MODIFIER
  RESOURCE_POOL
  ACTIVE_ABILITY
  TRIGGERED_EFFECT
  REACTION
  CHOICE_GATE
  SPELLCASTING
}

enum ActionType {
  ACTION
  BONUS_ACTION
  REACTION
  FREE
}

enum RestType {
  SHORT_REST
  LONG_REST
}
```

**New tables:**

```prisma
model ClassFeature {
  id             String         @id @default(cuid())
  characterClass CharacterClass
  level          Int
  name           String
  description    String
  featureType    FeatureType
  mechanicsJson  Json?
  actionType     ActionType?
  requiresChoice Boolean        @default(false)
  subclass       String?
  implemented    Boolean        @default(false)
}

model FeatureResourcePool {
  poolKey    String       @id
  featureId  String
  maxByLevel Json         // sparse map: { "1": 1, "5": 2 } — fill gaps downward
  resetOn    RestType
  dieSize    Int?         // for Hit Dice pools
  feature    ClassFeature @relation(fields: [featureId], references: [id])
}

model CharacterResourceState {
  characterId String
  poolKey     String
  current     Int
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  @@id([characterId, poolKey])
}

model Subclass {
  id             String         @id @default(cuid())
  characterClass CharacterClass
  key            String
  name           String
  blurb          String
  playstyleTag   String
  keyStat        String
  available      Boolean        @default(true)
  @@unique([characterClass, key])
}
```

**Additions to `Character` (Phase 2 migration):**

```prisma
featuresUnlocked     String[]  @default([])
subclass             String?
critThreshold        Int       @default(20)
pendingChoicesQueue  Json[]    @default([])
```

**`CLASS_DEFINITIONS` interface (TypeScript, `lib/v2/class-definitions.ts`):**

```typescript
interface ClassDefinition {
  role: string;             // e.g. "Martial striker"
  playstyleBlurb: string;   // 1-sentence pitch shown in creation overlay
  keyStats: string[];       // e.g. ['STR', 'CON']
  hitDie: number;           // e.g. 10
  highlightFeature: string; // e.g. "Action Surge"
  subclassTerm: string;     // e.g. "Martial Archetype"
  subclassLevel: number;    // 1, 2, or 3
}
```

This is a **static constant** — no DB table. Display metadata only; never used in engine resolution.

---

### mechanicsJson Schemas by Feature Type

All interfaces live in `types/v2-feature-mechanics.ts`. PASSIVE and SPELLCASTING features always have `mechanicsJson: null`.

**STAT_MODIFIER** — directly mutates a `Character` field on level-up:
```typescript
type StatModifier = {
  field: 'critThreshold' | 'speed' | 'armorClass';
  operation: 'set' | 'add';
  value: number;
};
// Example — Champion Improved Critical:
// { field: 'critThreshold', operation: 'set', value: 19 }
```

**ACTIVE_ABILITY** — player-triggered, costs a resource:
```typescript
type ActiveAbility = {
  cost: Array<{ poolKey: string; amount: number }>;
  effect: {
    type: 'heal_self' | 'grant_advantage' | 'bonus_attack';
    value?: number | string; // e.g. "1d10+prof"
  };
};
// Example — Second Wind:
// { cost: [{ poolKey: 'second_wind', amount: 1 }], effect: { type: 'heal_self', value: '1d10+prof' } }
```

**TRIGGERED_EFFECT** — fires automatically on a trigger condition:
```typescript
type TriggeredEffect = {
  trigger: 'on_hit' | 'on_crit' | 'on_kill' | 'on_attack_roll';
  condition?: string; // e.g. 'ally_adjacent_to_target', 'has_advantage'
  effect: {
    type: 'add_damage' | 'grant_bardic_inspiration';
    dice?: string; // e.g. "1d6"
  };
};
// Example — Sneak Attack:
// { trigger: 'on_hit', condition: 'ally_adjacent_to_target', effect: { type: 'add_damage', dice: '1d6' } }
```

**REACTION** — fires in response to another character's action:
```typescript
type ReactionEffect = {
  trigger: 'on_ally_hit' | 'on_enemy_attack';
  cost: Array<{ poolKey: string; amount: number }>;
  effect: { type: 'protect_ally' | 'counter_attack' };
};
```

**CHOICE_GATE** — player must make a selection before this feature resolves:
```typescript
type ChoiceGate = {
  choiceType: 'maneuver' | 'spell' | 'fighting_style';
  options?: string[]; // explicit list, or null = fetch from DB
  minSelections: number;
  maxSelections: number;
};
```

---

### Extra Attack — Special Case

Extra Attack is `featureType: PASSIVE` in the schema, but cannot be expressed as `mechanicsJson` — it requires a loop count known before the first attack roll. The engine reads it from a hardcoded lookup in `lib/v2/db-context.ts`:

```typescript
function attacksPerAction(characterClass: CharacterClass, level: number): number {
  if (characterClass === 'FIGHTER') {
    if (level >= 20) return 4;
    if (level >= 11) return 3;
    if (level >= 5) return 2;
  }
  if (['PALADIN', 'RANGER', 'BARBARIAN', 'MONK'].includes(characterClass)) {
    if (level >= 5) return 2;
  }
  return 1; // Rogue always 1; all casters always 1
}
```

This value is included in `CharacterStats` and consumed by `combat-engine.ts` before the round begins. The `ClassFeature` row still exists for `featuresUnlocked` tracking and character sheet display — it just has `mechanicsJson: null`.

---

### How mechanicsJson Is Processed at Runtime

**At combat start,** `combat-engine.ts` builds a `FeatureMap`:

```typescript
type FeatureMap = { [trigger: string]: ClassFeature[] };
```

Built by: batch-query `ClassFeature` rows for all IDs in `featuresUnlocked` across enrolled characters → filter to `implemented: true` → group by the `trigger` field in `mechanicsJson`.

**STAT_MODIFIER features** are not in the FeatureMap — they were applied to `Character` at level-up. The character's `critThreshold`, `speed`, etc. are the source of truth at runtime.

**At each trigger point** (`on_hit`, `on_crit`, `on_kill`, `on_attack_roll`): engine reads `FeatureMap[trigger]`, evaluates each feature's `condition` string against current game state, and applies `effect` if the condition holds.

**Condition identifiers:**
- `'ally_adjacent_to_target'` → another enrolled character is adjacent to the target PoiInstance
- `'has_advantage'` → character's current advantage state in the combat round

---

### Seeding Targets

13 classes × ~3 subclasses = **39 `Subclass` rows**. `ClassProgression` + `ClassFeature` rows for L1–5 per class.

| Class | Subclasses | Subclass level | Notes |
|---|---|---|---|
| Fighter | Champion, Battle Master†, Eldritch Knight† | L3 | BM/EK deferred |
| Rogue | Thief, Arcane Trickster†, Assassin | L3 | AT deferred (spellcasting) |
| Barbarian | Berserker, Totem Warrior, Wild Magic | L3 | |
| Ranger | Hunter, Beast Master, Gloom Stalker | L3 | |
| Paladin | Oath of Devotion, Oath of the Ancients, Oath of Vengeance | L3 | |
| Monk | Open Hand, Shadow, Four Elements† | L3 | FE deferred (spellcasting) |
| Cleric | Life, Light, War | L1 | Subclass at creation |
| Druid | Land, Moon, Spores | L2 | In-game pending-choice path |
| Wizard | Evocation, Abjuration, Illusion | L2 | In-game pending-choice path |
| Bard | Lore, Valor, Glamour | L3 | |
| Sorcerer | Draconic, Wild Magic, Storm | L1 | Subclass at creation |
| Warlock | Fiend, Archfey, Great Old One | L1 | Subclass at creation |
| Blood Hunter | Order of the Crimson Rite, Ghostslayer | L3 | |

† Deferred (`available: false`) — CHOICE_GATE has no resolution path or requires the spellcasting subsystem.

Spellcasting class features use `featureType: SPELLCASTING`, `mechanicsJson: null`. Each must have a useful `description` string (e.g. `"You can cast spells using your spell slots. Full spellcasting support arrives in a future update."`) so the character sheet roadmap renders a readable placeholder.

---

### Subclass Progression Display on Character Sheet

**Before (current — no feature display):**
```
⚔ Kira — Fighter L3
HP: 28 / 28
STR 16  DEX 14  CON 15  INT 10  WIS 12  CHA 8
```

**After (with feature roadmap):**
```
⚔ Kira — Fighter L3 · Champion

FEATURES
✓ Fighting Style (L1)       ✓ Second Wind (L1)
✓ Action Surge (L2)           Extra Attack (L5) ↑
✓ Martial Archetype (L3)      Feat/ASI (L4) ↑

CHAMPION PATH
✓ Improved Critical (L3)
  Remarkable Athlete (L7) ↑
  Additional Fighting Style (L10) ↑
```

`↑` = locked; shown with unlock level. SPELLCASTING rows show their placeholder description. The roadmap motivates return visits — players can see exactly what is coming next for their character.

---

### How New Features Enter the Arsenal

**Data flow:**
1. Level-up fires → `applyXpAward` appends `ClassFeature.id` strings to `character.featuresUnlocked`
2. `db-context.ts` batch-queries `ClassFeature` rows for all IDs in `featuresUnlocked`; includes them in `CharacterStats`
3. Client receives feature list in ViewState → character sheet renders sorted by level
4. `InitiativeStrip` renders buttons only for `ACTIVE_ABILITY` features with `implemented: true`

**CLIENT MAP GAP:** Always fetch feature details from the API, never from a client-side static feature map. A static map will diverge from the DB as seed rows are added or corrected. `CLASS_DEFINITIONS` is safe as a static constant — it's presentation metadata, not game state.

**Feature rendering by type:**

| FeatureType | Character sheet | InitiativeStrip | Combat behavior |
|---|---|---|---|
| PASSIVE | Listed; no button | — | Engine reads derived value (e.g. `attacksPerAction`) |
| STAT_MODIFIER | Listed; effect in prose | — | Already applied to `Character` at level-up |
| RESOURCE_POOL | Counter (`"Hit Dice  2/3"`) | — | — |
| ACTIVE_ABILITY (`implemented: true`) | Counter + tap hint | Button with resource counter | Decrements pool; engine resolves effect |
| ACTIVE_ABILITY (`implemented: false`) | Listed; no button | Not rendered | No-op until Phase 12 |
| TRIGGERED_EFFECT | Listed; auto-fires note | — | Fires on trigger condition |
| REACTION | Listed; "Reaction window not yet implemented" | — | Deferred |
| CHOICE_GATE | Pending choice banner | — | Blocks feature resolution until choice made |
| SPELLCASTING | Placeholder description | — | Deferred |

**`implemented` gate:** `InitiativeStrip` reads `ClassFeature.implemented`. Only `true` rows generate buttons. This is the production gate preventing unlimited-use exploits. Never set `implemented: true` without a corresponding decrement path in the mutation engine.

**Tap-to-confirm bottom sheet (`AbilitySheet.tsx`):**
```
┌──────────────────────────────────────┐
│ Second Wind                    1/1   │
│                                      │
│ Bonus action. Recover 1d10+2 HP.     │
│                                      │
│         [Use Bonus Action]           │
└──────────────────────────────────────┘
```
Opens on tap of an ability button in `InitiativeStrip`. Confirm button label matches `actionType` (e.g., `"Use Bonus Action"`, `"Use Action"`). Dismisses on cancel or after confirmation.

---

### Feature Impact on Game Mechanics

Five categories of engine change this feature system introduces:

1. **Auto-apply on level-up (STAT_MODIFIER):** `applyXpAward` reads `mechanicsJson` and writes directly to `Character` at level-up (e.g., `critThreshold = 19` for Champion). No runtime evaluation needed.

2. **Minor engine change (PASSIVE):** Engine reads a derived value instead of a hardcode. Extra Attack — `combat-engine.ts` loops `attacksPerAction(class, level)` times instead of always rolling once. Small edit; no new trigger system.

3. **New action types (ACTIVE_ABILITY, TRIGGERED_EFFECT):** New branches in the mutation engine's intent parser. Player declares intent (use Second Wind); engine dispatches to the feature handler; resource decrements; effect applies.

4. **Extra Attack (special-case PASSIVE):** Requires a loop in the combat engine, not just a stat read. Computed from `attacksPerAction` before the round starts. Intentionally not expressed in `mechanicsJson` — the loop count must be stable for the whole round.

5. **Deferred subsystems:** SPELLCASTING, REACTION window, and CHOICE_GATE maneuver resolution are out of scope for this milestone. Seed rows exist with `implemented: false`. They render as locked feature cards; no buttons appear in combat.

---

## Status

| Phase | Name | Status |
|---|---|---|
| 9A | ClassFeature Schema Migration | ✅ DONE |
| 9B | Fighter Seed + Zod Validation | ✅ DONE |
| 9C | Remaining 12 Classes | ✅ DONE |
| 10A | CLASS_DEFINITIONS + Subclass Endpoint | ✅ DONE |
| 10B | In-Game Subclass Picker | ⬜ TODO (UI component only — SubclassPicker.tsx) |
| 10C | Character Creation Overlay Redesign | ⬜ TODO |
| 11 | Feature Engine + Extra Attack | ✅ DONE |
| 12 | Rest Mechanics | ✅ DONE (endpoint + decrement; UI buttons pending) |

---

## Phase 9A — ClassFeature Schema Migration `✅ DONE`

**Implementation notes (2026-06-20):**
- Batched into migration `20260620030917_leveling_foundation` alongside Phase 2 changes.
- New enums: `FeatureType` (PASSIVE/STAT_MODIFIER/RESOURCE_POOL/ACTIVE_ABILITY/TRIGGERED_EFFECT/
  REACTION/CHOICE_GATE/SPELLCASTING), `FeatureActionType` (ACTION/BONUS_ACTION/REACTION/FREE —
  named `FeatureActionType` not `ActionType` to avoid collision with the existing TypeScript
  `ActionType` union in `types/v2-game.ts`), `RestType` (SHORT_REST/LONG_REST).
- `ClassFeature` extended: `featureType FeatureType @default(PASSIVE)`, `mechanicsJson Json?`,
  `actionType FeatureActionType?`, `requiresChoice Boolean @default(false)`, `subclass String?`,
  `implemented Boolean @default(false)`.
- New tables: `FeatureResourcePool`, `CharacterResourceState` (with CASCADE from Character),
  `Subclass`.
- `types/v2-feature-mechanics.ts` — NOT YET CREATED (listed in phase spec as new file).

**What remains:**
- `types/v2-feature-mechanics.ts` — TypeScript interfaces for all `mechanicsJson` shapes
- Smoke test assertions in `regression-baseline.test.ts` (tables queryable, correct defaults)

## Phase 9A — ClassFeature Schema Migration (original spec)

**Scope:** Migration only. No seed data. No application code changes. The schema is the
prerequisite for everything in Phase 9B onward; it can be deployed and left idle safely.

**Migration adds:**
- `ClassFeature`: `featureType FeatureType`, `mechanicsJson Json?`, `actionType ActionType?`, `requiresChoice Boolean @default(false)`, `subclass String?`, `implemented Boolean @default(false)`
- New enum `FeatureType` (PASSIVE, STAT_MODIFIER, RESOURCE_POOL, ACTIVE_ABILITY, TRIGGERED_EFFECT, REACTION, CHOICE_GATE, SPELLCASTING)
- New enum `ActionType` (ACTION, BONUS_ACTION, REACTION, FREE)
- New enum `RestType` (SHORT_REST, LONG_REST)
- New table `FeatureResourcePool` (poolKey, featureId, maxByLevel Json, resetOn RestType, dieSize Int?)
- New table `CharacterResourceState` (characterId, poolKey, current — with CASCADE delete from Character)
- New table `Subclass` (characterClass, key, name, blurb, playstyleTag, keyStat)

**Files:**
- `prisma/schema.prisma`
- `prisma/migrations/` (generated)
- `types/v2-feature-mechanics.ts` (new — TypeScript interfaces for all `mechanicsJson` shapes;
  see design doc "mechanicsJson schemas by feature type")

**Test suite:**

*Regression:* migration runs without error; all existing tests pass with no schema conflict.

*Smoke tests (add to regression-baseline):*
- New tables are queryable and return empty arrays (no data yet)
- `ClassFeature` columns have correct defaults (`implemented=false`, `requiresChoice=false`)

**Game-works checklist:**
- [ ] `npx prisma migrate dev` runs without error
- [ ] `npx prisma generate` completes
- [ ] All existing tests still pass
- [ ] Existing gameplay unaffected (new columns/tables are additive, not read by engine yet)

---

## Phase 9B — Fighter Seed + Zod Validation `⬜ TODO`

**Scope:** Seed one class end-to-end as the canonical template. Fighter is chosen because
it has the widest feature variety (active abilities, resource pools, subclass at L3, Extra
Attack at L5) and all three subclasses (Champion, Battle Master, Eldritch Knight) cover
every `featureType` except SPELLCASTING. Everything seeded here unblocks Phase 3's
ClassProgression test gap, Phase 10B's subclass picker, and Phase 11's feature engine.

> **Battle Master note:** The `CHOICE_GATE` row for maneuver selection is seeded in this
> phase, but the `Subclass` row for Battle Master is marked `available: false` in the
> picker until individual maneuver `ClassFeature` rows (TRIGGERED_EFFECT / ACTIVE_ABILITY)
> are seeded in a future pass. Shipping a `CHOICE_GATE` with no resolution path creates a
> live pending choice the engine cannot resolve. Battle Master subclass will not appear in
> `SubclassPicker` until that work is complete.

**New in this phase:**
- `lib/v2/seed-schemas.ts` (new): Zod schemas for validating `ClassFeature.mechanicsJson`
  against `types/v2-feature-mechanics.ts`. Run at seed time — a row with invalid
  `mechanicsJson` fails the seed script before writing to the DB.
- `prisma/seed.mjs`: Fighter L1–5 `ClassFeature` + `ClassProgression` rows (full `mechanicsJson`)
- `prisma/seed.mjs`: `FeatureResourcePool` rows for `second_wind`, `action_surge`
- `prisma/seed.mjs`: `Subclass` rows for Champion, Eldritch Knight (and Battle Master
  with `available: false`)
- `prisma/seed.mjs`: Fighter `ClassFeature` rows for Champion L3 (Improved Critical) and
  Eldritch Knight L3 (Spellcasting — `featureType: SPELLCASTING`, `mechanicsJson: null`)

**Files:**
- `lib/v2/seed-schemas.ts` (new)
- `prisma/seed.mjs` (edit — Fighter block only)

**Test suite** (`lib/v2/__tests__/seed-validation.test.ts` — new file, reads from DB after seed):

*Happy path:*
- Fighter `ClassProgression` rows exist for L1–5 with non-empty `featuresUnlocked`
- Fighter `ClassFeature` rows: Second Wind (`ACTIVE_ABILITY`, `mechanicsJson` present, `implemented=false`), Action Surge (`ACTIVE_ABILITY`), Extra Attack (`PASSIVE`)
- Champion L3: `ClassFeature` with `featureType=STAT_MODIFIER`, `mechanicsJson={field:'critThreshold',operation:'set',value:19}`
- `FeatureResourcePool` row exists for `second_wind` with `resetOn=SHORT_REST`, `maxByLevel={"1":1}`
- All 3 Fighter `Subclass` rows seeded; Battle Master has `available=false`
- No duplicate `(characterClass, level, name)` ClassFeature rows

*Schema validation:*
- `mechanicsJson` on ACTIVE_ABILITY features is valid per Zod schema (cost[] + effect present)
- PASSIVE features: `mechanicsJson` is null — no Zod error
- SPELLCASTING features: `mechanicsJson` is null — no Zod error
- Malformed `mechanicsJson` in seed → seed script throws before writing to DB

**Also seeded in this phase (to unblock Phase 10C early):**
- `Subclass` rows for Cleric (Life, Light, War), Sorcerer (Draconic, Wild Magic, Storm), Warlock (Fiend, Archfey, Great Old One) — these are required at character creation for L1 subclass classes. Adding them here means Phase 10C can merge as soon as Phase 10B ships, without waiting for Phase 9C.

**Backfill migration (required before Phase 9B merges):**
- For every `Character` whose `featuresUnlocked` contains IDs that do not exist in `ClassFeature` (catches both empty arrays and arrays containing Phase 3 placeholder stub strings): replace the entire array with correct IDs from `ClassProgression` for their class and level, and create missing `CharacterResourceState` rows for any `RESOURCE_POOL` features. Without this migration, characters who leveled up during the Phase 3–9B gap will have no features after Phase 11 ships.

**Backfill assertion (add to `lib/v2/__tests__/seed-validation.test.ts`):**
- After seed + backfill: assert that zero `Character` rows have a `featuresUnlocked` entry whose ID does not exist in `ClassFeature`. Any dangling ID means the backfill predicate missed a character or the seed inserted IDs that don't match the seeded `ClassFeature` rows.

**Zod `implemented` gate extension:**
- Extend `lib/v2/seed-schemas.ts` to assert: any `ClassFeature` row with `implemented: true` AND `featureType === 'ACTIVE_ABILITY'` must have a matching case in `mutation-engine.ts`'s ability dispatch table. Seed fails at run time if this is violated — prevents the unlimited-use exploit from shipping silently.

**Game-works checklist:**
- [ ] Seed runs without error (idempotent — safe to re-run)
- [ ] Phase 3's ClassProgression gap is now closed for Fighter — level-up appends real feature IDs
- [ ] Cleric, Sorcerer, Warlock Subclass rows present and selectable in picker
- [ ] Backfill migration ran; existing leveled characters now have non-empty `featuresUnlocked`
- [ ] Existing Sunken Cellar gameplay unaffected
- [ ] Battle Master is not selectable in the subclass picker

---

## Phase 9C — Remaining 12 Classes `⬜ TODO`

**Scope:** Extend Phase 9B's seed pattern to all remaining classes. This phase is primarily
**content authoring**, not code. Budget it accordingly — it requires more time at a
keyboard writing JSON than writing TypeScript.

> **Parallelization:** Phase 9C does **not** block Phases 10A, 10B, 11, or 12. Start it as soon as Phase 9B merges and run it in parallel with engine and UI work. Phases 10B and 10C expand class-by-class as 9C completes. Phase 10C's merge gate requires only the L1 class Subclass rows (already in 9B) — not full 9C completion.

> **Content budget warning:** 12 classes × ~4 features per class × 5 levels = ~240
> additional `ClassFeature` rows, each requiring `featureType`, `mechanicsJson` (where
> applicable), and `implemented=false`. Additionally: 36 `Subclass` rows (12 classes × 3
> subclasses) each need hand-authored `blurb`, `playstyleTag`, `keyStat`. This is
> structured content authoring; do not estimate it as code. Allow 1–2 days per class for
> a thorough job. Skimping on `mechanicsJson` at this stage produces a broken feature
> engine in Phase 11.

**Spellcasting classes (Cleric, Druid, Wizard, Bard, Sorcerer, Warlock, Paladin, Ranger):**
L1–5 `ClassFeature` rows for spellcasting features use `featureType: SPELLCASTING`,
`mechanicsJson: null`. This is correct and expected — the spellcasting subsystem is
deferred. However, the character sheet roadmap will show these as placeholder rows. Each
placeholder must have a useful `description` string (e.g. `"You can cast spells using
your spell slots. Full spellcasting support arrives in a future update."`) so players
aren't dropped into a blank feature card.

**Deferred subclasses (cannot ship `available: true` until their CHOICE_GATE is resolved):**
- **Battle Master** (Fighter) — maneuver selection CHOICE_GATE has no resolution path
- **Eldritch Knight** (Fighter) — requires spellcasting subsystem; `available: false` is correct
- Any subclass whose L3 feature is exclusively SPELLCASTING with no non-spell features

Mark these as `available: false` in the `Subclass` seed row. They will appear in the picker
as coming-soon (dimmed) rather than selectable. Do not leave them out of the seed — the
roadmap display needs them as locked entries.

**Files:**
- `prisma/seed.mjs` (edit — all remaining classes)

**Test suite** (extend `lib/v2/__tests__/seed-validation.test.ts`):

*Happy path:*
- All 13 classes have `ClassProgression` + `ClassFeature` rows for L1–5
- All 39 `Subclass` rows seeded; `available=true` only when CHOICE_GATE has a resolution path
- No duplicate `(characterClass, level, name)` rows across all classes
- Every non-PASSIVE, non-SPELLCASTING `ClassFeature` has non-null `mechanicsJson` validated by Zod
- Every `RESOURCE_POOL` feature has a matching `FeatureResourcePool` row

**Game-works checklist:**
- [ ] Seed runs without error for all 13 classes
- [ ] Character level-up appends correct feature IDs for all classes
- [ ] Deferred subclasses visible-but-dimmed in picker, never selectable
- [ ] Spellcasting placeholder descriptions are readable in character sheet roadmap
- [ ] Manual play-through of one combat encounter per newly seeded class confirms features behave as expected (not just that seed runs without error)

---

## Phase 10A — CLASS_DEFINITIONS + Subclass Endpoint `⬜ TODO`

**Scope:** Pure logic, no UI. Creates the static class metadata constant and extends the
level-up endpoint with the subclass branch. This is a prerequisite for both Phase 10B
(in-game picker) and Phase 10C (character creation overlay), so it must ship first.

**New logic:**
- `lib/v2/class-definitions.ts` (new): `CLASS_DEFINITIONS` constant for all 13 classes
  (role, playstyleBlurb, keyStats, hitDie, highlightFeature, subclassTerm, subclassLevel).
  See `types/v2-game.ts` for the `ClassDefinition` interface. This is a static constant —
  no DB table.
- `app/api/v2/me/characters/[id]/level-up/route.ts` (edit — add subclass branch):
  - Body: `{ type: 'subclass', subclassKey: 'champion' }`
  - Validates: `pendingChoicesQueue[0].type === 'subclass'`; `subclassKey` is valid for this
    class; `character.subclass` is not already set (no re-pick)
  - Queries `Subclass` table to confirm `subclassKey` exists and `available: true`
  - Writes `character.subclass`; appends subclass `ClassFeature` IDs for the subclass level
    to `character.featuresUnlocked`; creates `CharacterResourceState` rows for any new
    RESOURCE_POOL features (same hook used in Phase 3's `applyXpAward`)
  - Shifts `pendingChoicesQueue` (removes index 0)
  - Writes `level_up_confirmed` MessageLog entry

**Files:**
- `lib/v2/class-definitions.ts` (new)
- `app/api/v2/me/characters/[id]/level-up/route.ts` (edit — extend, not replace)

**Test suite** (extend `app/api/v2/me/characters/[id]/level-up/route.test.ts`):

*Happy path:*
- `{type:'subclass', subclassKey:'champion'}` for Fighter L3 → `character.subclass='champion'`,
  Champion L3 features appended to `featuresUnlocked`, `CharacterResourceState` rows created
  for any new pools
- Cleric `{type:'subclass', subclassKey:'life'}` (subclass level L1) → applies at creation via
  this same endpoint (no separate creation-time path needed)
- After confirm, `pendingChoicesQueue` shifts; `[]` when all resolved

*Unhappy path:*
- Invalid `subclassKey` for class (e.g. `'champion'` for Cleric) → 400
- `subclassKey` is valid but `available=false` (e.g. Battle Master) → 400
- `pendingChoicesQueue[0].type === 'asi'` → 400 (wrong branch)
- `character.subclass` already set → 400 (cannot re-pick)
- Character not owned by request user → 403

*Edge cases:*
- Fighter at L3: `pendingChoicesQueue=[{type:'subclass',level:3},{type:'asi',level:4}]` — subclass at L3 resolves first (index 0); after confirm, queue shifts to `[{type:'asi',level:4}]`

**Game-works checklist:**
- [ ] Subclass endpoint returns correct responses for all branches
- [ ] `CLASS_DEFINITIONS` covers all 13 classes with no missing fields
- [ ] `CharacterResourceState` rows created for subclass RESOURCE_POOL features on confirm

---

## Phase 10B — In-Game Subclass Picker `⬜ TODO`

**Scope:** The in-game pending-choice flow for subclass selection. New isolated component;
does not touch the character creation path. This is the safe UI surface — it's only
reachable from the pending-choice banner and character sheet, not from any existing
production flow.

**New UI:**
- `components/v2/character/SubclassPicker.tsx` (new): swipeable full-screen cards,
  snap-to-card, ~15px partial edge reveal of adjacent card (signals more content without
  an explicit label), no momentum scrolling through multiple cards, pagination dots,
  static `"Choose This Path"` button fixed at bottom
- Confirmation screen (bottom sheet or modal within SubclassPicker): shows subclass name,
  unlocked features, `"This choice is permanent."`, `"← Back"` and `"Confirm — [Name]"`
- `app/v2/play/page.tsx` (edit): wire SubclassPicker to pending-choice flow — opens when
  player taps `"Go"` on the amber strip or `"Review now"` on the login popup

**Swipe behaviour:**
- Snap-to-card on release (always lands on a card boundary)
- Horizontal swipe gesture must not conflict with vertical card scroll — use `scrollEnabled=false`
  on the outer swiper; inner card scrolls vertically independently
- Deferred subclasses (`available=false`) appear as the last card(s), visually dimmed,
  with a `"Coming soon"` overlay; swipeable to read but `"Choose This Path"` disabled

**Files:**
- `components/v2/character/SubclassPicker.tsx` (new)
- `app/v2/play/page.tsx` (edit — wire to pending-choice flow)

**Test suite** (add to `lib/v2/__tests__/ui-pending-choice.test.ts`):

*Happy path:*
- SubclassPicker renders correct number of cards for class (3 for Fighter)
- Card content matches seeded `Subclass` data (name, blurb, playstyleTag)
- Tapping `"Choose This Path"` opens confirmation screen
- Confirming calls PATCH endpoint and clears pending choice
- Avatar ring and tab badge clear after confirmation

*Edge cases:*
- `available=false` subclass: card is visible but `"Choose This Path"` is disabled and shows `"Coming soon"` overlay
- Single subclass class (hypothetical): picker still renders without swipe, pagination dots hidden

**Prerequisite (before Phase 10C begins):**

Decide and document whether Phase 10C's E2E tests will use (a) Playwright with a real browser, or (b) React Testing Library against the `setup/page.tsx` component tree. If (b), rename the test path from `tests/e2e/character-creation.test.ts` to `lib/v2/__tests__/ui-character-creation.test.ts` in the Phase 10C spec. Whichever is chosen, the test runner must be runnable in CI before Phase 10C merges. Do not begin Phase 10C implementation until this decision is recorded — retrofitting a test runner mid-phase is a timeline killer.

**Game-works checklist:**
- [ ] Subclass picker opens from amber strip and login popup
- [ ] Cards are swipeable with snap-to-card; partial edge visible
- [ ] Vertical scroll inside cards does not trigger horizontal swipe
- [ ] Confirmation guard prevents accidental selection
- [ ] `level_up_confirmed` card appears in narrative feed after confirm
- [ ] CharacterSheet roadmap populates with subclass features after confirm
- [ ] E2E infrastructure decision made and documented (Playwright or RTL); test runner confirmed runnable in CI before Phase 10C starts

---

## Phase 10C — Character Creation Overlay Redesign `⬜ TODO`

**Scope:** Replaces the 2-column emoji class list in `app/v2/setup/page.tsx` with the
full class detail overlay and (for L1/2 subclass classes) the inline subclass picker.
**This is a production flow change.** It requires a separate staging review before
deploying — do not merge directly to main.

> **Risk gate:** This is the only phase in the leveling plan that modifies a production
> user flow that existing players actively use. Automated E2E tests (see test suite below)
> are required to pass before merging — the manual smoke checklist alone is not sufficient.
> A regression here blocks all new character creation.

> **Dependency clarification (Fix 1 + Fix 5):** Phase 10C does **not** require Phase 9C to
> be complete. Merge gate: (a) Phase 10B ships AND (b) L1 class Subclass rows are present
> (seeded in Phase 9B — Cleric, Sorcerer, Warlock). L3 classes only need `CLASS_DEFINITIONS`
> (Phase 10A static constant) — no Subclass seed rows required at creation. Phase 9C
> expands the picker progressively after 10C ships.

**New UI:**
- `app/v2/setup/page.tsx` (edit): tapping a class card opens a full-screen overlay instead
  of navigating away. Overlay has three states managed as local component state (no routing):
  - **State 1 — Class detail**: class role, playstyle blurb, key stat, hit die, signature
    feature, subclass teaser list (from `CLASS_DEFINITIONS`). `"← Back"` dismisses overlay.
    `"Choose [Class]"` closes overlay and marks the class as selected (for L3 classes).
    For L1/2 classes, `"Choose Cleric"` transitions to State 2 instead.
  - **State 2 — Subclass picker**: the same `SubclassPicker` component from Phase 10B,
    reused here. Bottom bar label changes to `"Choose This Path"` (same as in-game).
    State 2 only appears for Cleric (L1), Sorcerer (L1), Warlock (L1). Wizard (L2) goes
    through the in-game pending-choice flow — no State 2 at creation.
  - **State 3 — Confirmation** (same confirmation screen as Phase 10B's SubclassPicker)
- After the overlay closes, the class grid shows a filled chip: `"⚔ Fighter"` or `"✟ Cleric · Life Domain"`
- A small `✎` icon on the chip re-opens the overlay; only allowed before form submission

**Files:**
- `app/v2/setup/page.tsx` (edit)

**Staging smoke test (manual, required before merge):**
- [ ] Full creation flow: Fighter → all 3 steps → session join → land in game → no errors
- [ ] Full creation flow: Cleric (Life Domain) → subclass picker → confirmation → session join
- [ ] Back navigation at each overlay state returns to the previous state correctly
- [ ] Re-opening overlay via ✎ icon preserves previous selection
- [ ] Existing character cards unaffected on setup page
- [ ] Mobile: overlay renders correctly at phone viewport widths

**E2E tests (required before merge — `tests/e2e/character-creation.test.ts`):**
- Fighter (L3, no State 2): tap class card → overlay opens → `"Choose Fighter"` → chip shows → form submits → session joins → no errors
- Cleric Life Domain (L1, required State 2): tap Cleric → State 1 → `"Choose Cleric"` → State 2 SubclassPicker → tap Life Domain → State 3 confirm → chip shows `"✟ Cleric · Life Domain"` → form submits → session joins → `character.subclass === 'life'`
- Back navigation: overlay State 2 → `"← Back"` → returns to State 1 (not grid)
- Re-open via ✎: chip present → tap ✎ → State 1 opens with previous selection preserved

**Test suite** (extend `lib/v2/__tests__/ui-pending-choice.test.ts` or new `ui-character-creation.test.ts`):

*Happy path:*
- Tapping class card opens overlay with class detail
- L3 class (`"Choose Fighter"`) closes overlay, class chip shows
- L1 class (`"Choose Cleric"`) transitions to subclass picker within overlay
- Confirming Life Domain closes overlay, chip shows `"✟ Cleric · Life Domain"`

*Edge cases:*
- Wizard: no State 2 at creation (subclass deferred to L2 in-game)
- L3 class subclass teasers are read-only (tappable to preview, but no `"Choose This Path"` button)

**Game-works checklist:**
- [ ] Character creation completes without regression for all 13 classes
- [ ] Subclass chosen at creation is written to `character.subclass` on submit
- [ ] No entries in `pendingChoicesQueue` on new characters who completed the creation flow

---

## Phase 11 — Feature Engine + Extra Attack `⬜ TODO`

**Scope:** Features with `mechanicsJson` actually resolve mechanically in combat. Extra
Attack is the highest-priority feature — it affects almost every martial character at L5.

> **`implemented` gate:** Set `implemented: true` only for features whose resolution path
> is complete AND tested in `feature-engine.test.ts`. Do not set it for ACTIVE_ABILITY
> features until Phase 12 (rest endpoint) ships — an implemented active ability with no
> decrement path grants unlimited uses. Extra Attack and Improved Critical are PASSIVE /
> STAT_MODIFIER respectively and are safe to implement before Phase 12.

**New logic:**
- `lib/v2/db-context.ts`: compute `attacksPerAction(characterClass, level)` and include in `CharacterStats`:
  ```typescript
  Fighter: L5→2, L11→3, L20→4
  Paladin/Ranger/Barbarian/Monk: L5→2
  Rogue: always 1 (no Extra Attack)
  All others: 1
  ```
- `lib/v2/combat-engine.ts`: loop `attacksPerAction` attack rolls per Attack intent
- `lib/v2/combat-engine.ts`: build `FeatureMap` at combat start
  (`{ [trigger]: ClassFeature[] }` from enrolled characters' `featuresUnlocked`); after building, log `console.warn` (non-fatal) for any `TRIGGERED_EFFECT` or `ACTIVE_ABILITY` feature whose `mechanicsJson` contains a `condition` or `effect.type` value that has no registered handler in the engine — surfaces semantic 9C data gaps at runtime before players report them as bugs
- `lib/v2/combat-engine.ts`: evaluate TRIGGERED_EFFECT features at each trigger point
- `lib/v2/combat-engine.ts`: read `character.critThreshold` instead of hardcoded `20`
- `components/v2/combat/InitiativeStrip.tsx`: render ACTIVE_ABILITY feature buttons only
  when `ClassFeature.implemented === true`; show resource counter `"Second Wind  1/1"`
- `components/v2/combat/AbilitySheet.tsx` (new): tap-to-confirm bottom sheet for ability
  use (description, resource state, `"Use Action"` button)

**Files:**
- `lib/v2/db-context.ts`
- `lib/v2/combat-engine.ts`
- `components/v2/combat/InitiativeStrip.tsx`
- `components/v2/combat/AbilitySheet.tsx` (new)

**Features with `implemented: true` after this phase:**
- Extra Attack (PASSIVE — loop in combat engine)
- Improved Critical (STAT_MODIFIER — reads `critThreshold`)
- Sneak Attack (TRIGGERED_EFFECT — already in engine, just wire to FeatureMap)

**Features remaining `implemented: false` until Phase 12:**
- Second Wind, Action Surge, Rage, Ki, Superiority Dice — all ACTIVE_ABILITY with resource cost

**Test suite** (`lib/v2/__tests__/feature-engine.test.ts` — new file):

*Happy path — Extra Attack:*
- Fighter L5 Attack intent → 2 attack rolls generated
- Fighter L11 Attack intent → 3 rolls
- Paladin L5 → 2 rolls
- Rogue L5 → 1 roll (no Extra Attack)
- Monk L5 → 2 rolls

*Happy path — Improved Critical:*
- Champion (`critThreshold=19`): attack roll of 19 → `isCrit=true`
- Non-Champion (`critThreshold=20`): attack roll of 19 → `isCrit=false`
- Champion L15 (`critThreshold=18`): rolls 18, 19, 20 all → `isCrit=true`

*Happy path — Sneak Attack:*
- Rogue with advantage → Sneak Attack dice added to damage
- Rogue with `ally_adjacent_to_target` (no advantage) → Sneak Attack dice added
- Rogue with neither condition → no Sneak Attack dice

*InitiativeStrip gate:*
- ACTIVE_ABILITY with `implemented=false` → button not rendered
- ACTIVE_ABILITY with `implemented=true` → button rendered with resource counter

*`implemented` gate CI test (merge blocker — add to `lib/v2/__tests__/feature-engine.test.ts`):*
- Query all seed `ClassFeature` rows where `implemented: true` AND `featureType === 'ACTIVE_ABILITY'`
- For each: fire the corresponding action intent; assert `CharacterResourceState.current` decremented
- After Phase 11: this test passes trivially (no ACTIVE_ABILITY has `implemented: true` yet)
- After Phase 12 sets Second Wind + Action Surge to `implemented: true`: test asserts both decrement correctly
- **Any PR that sets `implemented: true` on an ACTIVE_ABILITY must make this test pass** — it will fail if the decrement path in `mutation-engine.ts` is missing

*Edge cases:*
- FeatureMap empty (character has no features): no crash, combat resolves normally
- Character with no `CharacterResourceState` for a pool: counter shows `0/0`, button disabled

**Game-works checklist:**
- [ ] Fighter L5 makes 2 attacks per Attack action in combat
- [ ] Champion crits on 19–20
- [ ] Sneak Attack fires only when condition is met
- [ ] Unimplemented ACTIVE_ABILITY features do not appear as buttons in InitiativeStrip
- [ ] Resource counter shows current/max for features with `CharacterResourceState`

---

## Phase 12 — Rest Mechanics `⬜ TODO`

**Scope:** Short and long rest restore resource pools and HP. This phase also sets
`implemented: true` for Second Wind and Action Surge — the rest endpoint must ship first
to prevent unlimited-use exploits.

> **CharacterResourceState row creation was moved to Phase 3 (`applyXpAward`) and Phase
> 10A (character creation). This phase handles only:** rest endpoint logic, UI, and
> auto-rest. The rows already exist from the moment features are unlocked.

**New logic:**
- `lib/v2/mutation-engine.ts` (edit): decrement `CharacterResourceState.current` when an
  ACTIVE_ABILITY is used (fires when action intent matches a feature with `implemented: true`)
- `POST /api/v2/me/characters/[id]/rest` (new endpoint):
  - `{ type: 'short' }`: resets all `CharacterResourceState` rows where
    `FeatureResourcePool.resetOn === SHORT_REST`. No HP recovery.
  - `{ type: 'long' }`: resets ALL pools; sets `character.currentHp = character.maxHp`.
    Only valid when in a room with `canLongRest: true` metadata, OR called from auto-rest path.
- Auto long rest: on session load, if `now() - character.lastLongRest > 8 hours` (or `lastLongRest` is null), apply long rest automatically; note it in the `"While you were away…"` modal. Wrap the check-and-apply in a single DB transaction with a `WHERE lastLongRest IS NULL OR lastLongRest < threshold` guard so concurrent requests from two players loading simultaneously are idempotent. After applying, write `lastLongRest = now()` in the same transaction.
- Short rest button: visible in PartyTab only when not in active combat AND at least one
  SHORT_REST resource is below max; hidden (not disabled) otherwise
- `"Make Camp"` action: present in rooms with `canLongRest: true`; absent (not greyed) elsewhere

**After this phase ships:** set `implemented: true` in seed for Second Wind and Action Surge.
Update their `ClassProgression` smoke tests to assert `implemented=true`.

**Schema note:** `lastLongRest DateTime?` must be added to the `Character` model to support the idempotent auto-rest guard. Include this in Phase 12's migration. If Phase 9A's migration has not yet run in production, batch this field into Phase 9A instead and note the dependency here.

**Files:**
- `prisma/schema.prisma` (add `lastLongRest DateTime?` to `Character`)
- `prisma/migrations/` (generated)
- `lib/v2/mutation-engine.ts` (edit — ACTIVE_ABILITY decrement path)
- `lib/v2/rest-helpers.ts` (new — shared short/long rest transaction logic)
- `app/api/v2/me/characters/[id]/rest/route.ts` (new)
- `components/v2/layout/PartyTab.tsx` (short rest button)
- `app/v2/play/page.tsx` (auto long rest on load)
- `prisma/seed.mjs` (edit — set `canLongRest: true` on safe rooms; set `implemented: true`
  on Second Wind + Action Surge)

**Test suite** (`lib/v2/__tests__/rest-mechanics.test.ts` — new file):

*Happy path:*
- Short rest with depleted `second_wind` → `CharacterResourceState.current` restored to max;
  `action_surge` unchanged if already at max
- Long rest → ALL resources restored, `currentHp` set to `maxHp`
- Auto long rest fires when `lastLongRest` is null or `now() - lastLongRest > 8h`: resources + HP restored; `lastLongRest` written; modal includes rest note
- Concurrent auto long rest: simulate two simultaneous session-load requests for the same character with `lastLongRest = null`. Assert that long rest is applied exactly once (resources restored to correct max values, not doubled) and `lastLongRest` is set to a single timestamp.
- Using Second Wind (now `implemented=true`) → `CharacterResourceState.current` decremented;
  `"Second Wind  0/1"` shown in InitiativeStrip; button disabled

*Unhappy path:*
- Short rest with all resources at max → 400 (nothing to restore); button is also hidden client-side
- `POST /rest` with `type='long'` in a non-safe room → 400
- `POST /rest` while enrolled in active combat → 400

*Edge cases:*
- Short rest resets SHORT_REST pools only; LONG_REST pools (e.g. Rage uses) remain depleted
- Long rest on a downed character (`currentHp=0`) → resources restored, `currentHp` restored
  to `maxHp` (long rest revives; different from combat level-up which does not)
- `"Make Camp"` absent (not disabled) in rooms without `canLongRest: true`

**Game-works checklist:**
- [ ] Short rest button visible when resources depleted, hidden when all full
- [ ] Short rest restores SHORT_REST pools only
- [ ] Long rest restores all pools and full HP
- [ ] `"Make Camp"` only available in designated safe rooms
- [ ] Auto long rest fires transparently on login after 8-hour gap
- [ ] `"While you were away…"` modal notes resting when auto long rest applied
- [ ] Second Wind decrements on use; recharges on short rest; infinite-use exploit closed
- [ ] Action Surge decrements on use; recharges on short rest
