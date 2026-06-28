# Plan: Resource Pools UI

Show each character's class resource pools (Ki, Rage, Second Wind, etc.) in the
CharacterSheet with current/max, reset condition, and tap-to-expand descriptions.
New players don't know what these abilities are — the UI must answer three
questions without prior D&D knowledge:
- How many uses do I have left?
- What does this ability let me do?
- When do I get it back?

---

## Pool inventory

| poolKey                | Class        | Max (by level)    | Reset      | Display  |
|------------------------|--------------|-------------------|------------|----------|
| `second_wind`          | Fighter      | 1 always          | Short Rest | binary   |
| `action_surge`         | Fighter      | 1 always          | Short Rest | binary   |
| `rage`                 | Barbarian    | 2–4               | Long Rest  | pips     |
| `lay_on_hands`         | Paladin      | 5/10/15/20/25     | Long Rest  | HP frac. |
| `channel_divinity_pal` | Paladin      | 1 at L3           | Short Rest | binary   |
| `ki`                   | Monk         | 2–5               | Short Rest | pips     |
| `channel_divinity_clr` | Cleric       | 1 always          | Short Rest | binary   |
| `wild_shape`           | Druid        | 2 always          | Short Rest | pips     |
| `bardic_inspiration`   | Bard         | 3 always          | Long Rest  | pips     |
| `crimson_rite`         | Blood Hunter | 2 always          | Long Rest  | pips     |

Display type rules (client-computed):
- `lay_on_hands` → **HP fraction** ("15 / 25 HP")
- `max === 1` → **binary badge** ("Ready" / "Spent")
- else → **pip dots** (● ○, up to 8; fallback to fraction beyond that)

Wild Shape note: `implemented: false`, no beast form state exists anywhere in
the engine. Show the pool (2 pips) and the description as-is.

---

## Lo-fi mocks

### Exploration — collapsed by default, tap row to expand

```
┌─────────────────────────────────────────────┐
│ RESOURCES                                   │
│                                             │
│  ☯️  Ki           ● ● ○   2/3  [Short Rest] ›│
│  😤  Rage         ● ●     2/2  [Long Rest]  ›│
│  💨  Second Wind  [ Ready ]    [Short Rest] ›│
│  🤲  Lay on Hands  15 / 25 HP  [Long Rest]  ›│
└─────────────────────────────────────────────┘
```

### Tap row → expands inline (one open at a time)

```
│  ☯️  Ki           ● ● ○   2/3  [Short Rest] ˅│
│ ┌─────────────────────────────────────────┐  │
│ │ Harness mystic energy to fuel special   │  │
│ │ moves. Spend 1 Ki to use the 🌀 Ki     │  │
│ │ action in combat (Flurry of Blows,      │  │
│ │ Patient Defense, Step of the Wind).     │  │
│ │                                         │  │
│ │ Resets on a Short Rest — take 10        │  │
│ │ minutes to catch your breath outside    │  │
│ │ combat. Use 💤 Short Rest in this tab.  │  │
│ └─────────────────────────────────────────┘  │
│  😤  Rage         ● ●     2/2  [Long Rest]  ›│
```

### Spent row (dims entire row)

```
│  ☯️  Ki           ○ ○ ○   Spent  [Short Rest] ›│  ← text-slate-400
```

### Combat mode — all descriptions always visible (no tap)

```
┌─────────────────────────────────────────────┐
│ RESOURCES                                   │
│                                             │
│  ☯️  Ki       ● ● ○   2/3   Short Rest      │
│     Spend 1 Ki → 🌀 Ki action (Flurry,     │
│     Patient Defense, Step of the Wind).     │
│                                             │
│  💨  Second Wind  [ Ready ]   Short Rest    │
│     Heal 1d10+level HP as a bonus action.  │
└─────────────────────────────────────────────┘
```

### Rest badge colours

```
[Short Rest]  bg-blue-50  text-blue-600  border-blue-200
[Long Rest]   bg-amber-50 text-amber-600 border-amber-200
```

### Rest explanation in expanded panel

SHORT_REST: "Resets on a Short Rest — take 10 minutes to catch your breath
outside of combat. Use the 💤 Short Rest button in this tab."

LONG_REST: "Resets on a Long Rest — sleep at camp. Use the 🏕 Make Camp
button in this tab."

---

## Architecture notes

### Problem: two data paths for the same shape
`view-state.ts` (SSR play page) and `room/state/route.ts` (client API) both
assemble `CharacterStats` independently, duplicating AC/attackBonus/profBonus
formulas. `classFeatureDetails` only exists in the view-state path — the room
state API omits it. Fix by extracting a shared `buildClassFeatureDetails` helper
so the logic lives in one place.

### Dead column
`ClassProgression.resourcePoolMax: Int?` exists on the schema but is only read
by a v1 action. The actual max logic is in `FeatureResourcePool.maxByLevel`.
Note as tech debt; do not remove it in this work (schema change, out of scope).

### rest-helpers: silent no-op bug
`applyShortRest` and `applyLongRest` do `if (!state) continue` when a character
is missing a `CharacterResourceState` row. Characters whose state rows were never
created get no restoration on rest. Fix with `upsert`.

---

## Phase 0 — Data integrity
*No UI changes. Safest to ship first.*

### 0A: Fix seed — `prisma/seed.mjs`

1. Add missing `channel_divinity_pal` pool (Paladin, L3, 1 use, Short Rest).
   Use `upsert` so re-seeding is idempotent.

2. Audit every seeded test character: any character whose `featuresUnlocked`
   contains a `RESOURCE_POOL` feature must have a matching `CharacterResourceState`
   row. Add missing rows with `upsert`.

### 0B: Fix rest-helpers — `lib/v2/rest-helpers.ts`

In both `applyShortRest` and `applyLongRest`, replace `characterResourceState.update`
with `characterResourceState.upsert` (create the row if missing, update if present).

In `applyLongRest`, remove the `if (!state) continue` guard — upsert handles the
missing-row case by creating it at max. Keep the guard in `applyShortRest` because
short rest only restores pools that are below max (skipping a missing row is fine
there — it implies the pool was never spent, so upsert isn't needed).

### Phase 0 tests — `lib/v2/__tests__/rest-helpers.test.ts` (new file)

```
describe('applyShortRest')
  ✓ restores a short-rest pool that is below max
  ✓ does not restore a pool that is already at max
  ✓ creates the state row via upsert when it is missing
  ✓ ignores long-rest pools
  ✓ returns the list of restored poolKeys

describe('applyLongRest')
  ✓ restores all pools to max
  ✓ restores HP to maxHp
  ✓ upserts state rows that were missing (creates them at max)
  ✓ handles a character with no pools without crashing

describe('checkAutoLongRest')
  ✓ returns true when lastLongRest is null
  ✓ returns true when lastLongRest was more than 8h ago
  ✓ returns false when lastLongRest was less than 8h ago
```

All use a mocked `prisma`. The upsert tests verify that `characterResourceState.upsert`
is called with both `create` and `update` keys.

---

## Phase 1 — Shared character builder
*Extract duplicated assembly logic. No observable behaviour change.*

### 1A: New file `lib/v2/character-builder.ts`

Export two pure helpers:

**`maxForLevel(maxByLevel, level): number`**
Fill-down sparse level map: `{ "1": 2, "3": 3 }` at level 2 → 2.
Returns 0 if level is below the first entry.

**`buildClassFeatureDetails(featureIds): Promise<ClassFeatureDetail[]>`**
Replaces the inline `classFeature.findMany` in `view-state.ts`. Adds
`resourcePool` to the select:
```ts
resourcePool: {
  select: { poolKey: true, maxByLevel: true, resetOn: true, dieSize: true }
}
```
Returns empty array when `featureIds` is empty (avoids the DB call).

### 1B: Update types — `types/v2-game.ts`

Extend `classFeatureDetails` item:
```ts
resourcePool?: {
  poolKey: string;
  maxByLevel: Record<string, number>;
  resetOn: 'SHORT_REST' | 'LONG_REST';
  dieSize: number | null;
} | null;
```

Extend `PartyMemberInfo`:
```ts
resourceStates: Array<{ poolKey: string; current: number }>;
classFeatureDetails: CharacterStats['classFeatureDetails'];
```

### 1C: Update `lib/v2/view-state.ts`

Replace inline `classFeature.findMany` block with a call to
`buildClassFeatureDetails(featureIds)`. No other changes.

### Phase 1 tests — `lib/v2/__tests__/character-builder.test.ts` (new file)

```
describe('maxForLevel')
  ✓ fills gaps downward: { "1": 2, "3": 3 } at L2 → 2
  ✓ returns 0 when level is below the first entry: { "2": 2 } at L1 → 0
  ✓ exact match: { "3": 3 } at L3 → 3
  ✓ picks highest key that does not exceed level: { "1":2,"3":3,"6":4 } at L5 → 3
  ✓ handles level beyond all keys: { "5": 5 } at L20 → 5
  ✓ empty map → 0

describe('buildClassFeatureDetails')
  ✓ returns empty array when featureIds is empty (no DB call)
  ✓ includes resourcePool when feature has a pool
  ✓ resourcePool is null for non-RESOURCE_POOL features
  ✓ orders results by level ascending
  ✓ includes all required fields: id, name, featureType, mechanicsJson,
    actionType, implemented, level, subclass, description, resourcePool
```

Use mocked prisma with controlled fixture data.

### Phase 1 regression additions — `lib/v2/__tests__/view-state-xp.test.ts`

```
describe('view-state resource fields — regression')
  ✓ classFeatureDetails is [] when featuresUnlocked is empty
  ✓ resourceStates is [] when character has no pool rows
  ✓ canShortRest is false when all short-rest pools are at max
  ✓ canShortRest is true when any short-rest pool is below max
  ✓ canShortRest is false when character has no short-rest pools at all
```

These test the pure logic (`maxForLevel` + the `canShortRest` loop) without
hitting the DB.

---

## Phase 2 — API surface
*Make the room state API return resource data. No visible UI change.*

### 2A: Update `app/api/v2/room/state/route.ts`

1. Import `buildClassFeatureDetails` from `lib/v2/character-builder`.
2. Add `classFeatureDetails` to `characterStats` by calling
   `buildClassFeatureDetails(charRow.featuresUnlocked ?? [])`.
3. Add `featuresUnlocked` and `resourceStates` to the party member character
   select (the `sessionPartyData` query at line 42–50).
4. Batch-build `classFeatureDetails` for all party members: collect all unique
   feature IDs from all members, call `buildClassFeatureDetails` once, then
   distribute. Avoids N queries for N party members.
5. Add `resourceStates` and `classFeatureDetails` to each entry in `partyMembers`.

### 2B: Update `components/v2/character/PartyTab.tsx`

`partyMemberToStats()` currently hard-codes `resourceStates: []` and
`classFeatureDetails: []`. Pass the real values from the member object.

### Phase 2 tests

**`lib/v2/__tests__/ui-party-inventory.test.ts`** — add to existing file:

```
describe('partyMemberToStats — resource passthrough')
  ✓ resourceStates from PartyMemberInfo passes through to CharacterStats
  ✓ classFeatureDetails from PartyMemberInfo passes through to CharacterStats
  ✓ empty resourceStates → empty array in CharacterStats (no crash)
  ✓ empty classFeatureDetails → empty array in CharacterStats (no crash)
```

Pure function tests — `partyMemberToStats` is a simple object transform.

---

## Phase 3 — ResourcePools component
*The visible change. Phases 0–2 must be complete and green first.*

### 3A: New file `components/v2/character/ResourcePools.tsx`

Export pure helpers at the top (importable by tests without mounting React):

```ts
export function maxForLevel(maxByLevel: Record<string, number>, level: number): number
export function getDisplayType(poolKey: string, max: number): 'binary' | 'pips' | 'hp-fraction'
export function restLabel(resetOn: string): string
export function restDescription(resetOn: string): string
export function isSpent(current: number): boolean
```

`maxForLevel` re-exports from `lib/v2/character-builder` — single source of truth.

Component:
```ts
export function ResourcePools({ stats, isCombat }: { stats: CharacterStats; isCombat: boolean })
```

Internal state: `const [expandedPool, setExpandedPool] = useState<string | null>(null)`

Render logic:
1. Filter `classFeatureDetails` for `featureType === 'RESOURCE_POOL'` with non-null `resourcePool`.
2. For each, compute `max = maxForLevel(resourcePool.maxByLevel, stats.level)`.
3. Skip if `max === 0` (not unlocked yet at current level).
4. Look up `current` from `resourceStates`; default to `max` if row is missing.
5. Render row: icon + name, pips/badge/HP fraction, rest badge, chevron.
6. Exploration: row is a `<button>` toggling `expandedPool` (one open at a time).
7. Combat: skip toggle; render description + rest explanation always.

### 3B: Update `components/v2/character/CharacterSheet.tsx`

Import `ResourcePools` and insert between the Combat stats block and the
Features block:
```tsx
<ResourcePools stats={stats} isCombat={isCombat} />
```
No other changes to CharacterSheet.

### Phase 3 tests — `lib/v2/__tests__/ui-resource-pools.test.ts` (new file)

All are pure function tests — no React mounting, no DOM.

```
describe('getDisplayType')
  ✓ lay_on_hands, any max → 'hp-fraction'
  ✓ second_wind, max=1 → 'binary'
  ✓ action_surge, max=1 → 'binary'
  ✓ channel_divinity_clr, max=1 → 'binary'
  ✓ channel_divinity_pal, max=1 → 'binary'
  ✓ ki, max=3 → 'pips'
  ✓ rage, max=4 → 'pips'
  ✓ wild_shape, max=2 → 'pips'
  ✓ bardic_inspiration, max=3 → 'pips'
  ✓ crimson_rite, max=2 → 'pips'
  ✓ unknown pool, max=1 → 'binary'
  ✓ unknown pool, max=4 → 'pips'

describe('restLabel')
  ✓ 'SHORT_REST' → 'Short Rest'
  ✓ 'LONG_REST' → 'Long Rest'
  ✓ unknown string → 'Rest' (safe fallback, not a crash)

describe('restDescription')
  ✓ SHORT_REST → contains '10 minutes' and 'Short Rest'
  ✓ LONG_REST → contains 'camp' and 'Long Rest'

describe('isSpent')
  ✓ current=0 → true
  ✓ current=1 → false
  ✓ current=3 → false

describe('Monk — ki pool data')
  ✓ L2, current=2: max=2, type='pips', not spent
  ✓ L3, current=2: max=3, type='pips', not spent, one empty pip
  ✓ L3, current=0: max=3, isSpent=true
  ✓ L1 (ki not yet unlocked): maxForLevel({"2":2,...}, 1) = 0, row skipped

describe('Fighter — binary pools')
  ✓ second_wind current=1: max=1, type='binary', not spent
  ✓ second_wind current=0: isSpent=true
  ✓ action_surge current=1: not spent
  ✓ action_surge current=0: isSpent=true

describe('Paladin — lay_on_hands HP fraction')
  ✓ L1, current=5: max=5, type='hp-fraction', label='5 / 5 HP'
  ✓ L2, current=8: max=10, type='hp-fraction', label='8 / 10 HP'
  ✓ L3, current=0: max=15, isSpent=true

describe('Barbarian — rage')
  ✓ L1, current=2: max=2, pips=[●●]
  ✓ L3, current=1: max=3, pips=[●○○]
  ✓ L6, current=0: max=4, isSpent=true

describe('missing resourceStates row')
  ✓ no row for poolKey → current defaults to max → not spent

describe('pool not yet unlocked')
  ✓ max=0 → row is excluded from render output

describe('empty classFeatureDetails')
  ✓ no RESOURCE_POOL entries → section produces no rows
```

### Phase 3 regression additions — `lib/v2/__tests__/regression-baseline.test.ts`

```
describe('resource pools — regression')
  ✓ CharacterStats with resourceStates=[] does not produce any rows
  ✓ classFeatureDetails with no RESOURCE_POOL entries produces no rows
  ✓ canShortRest computation is unchanged after refactor (still uses maxForLevel)
  ✓ combat engine: Flurry of Blows adds { poolKey:'ki', delta:-1 } to resourceUsages
  ✓ combat engine: Patient Defense adds { poolKey:'ki', delta:-1 }
  ✓ combat engine: Step of the Wind adds { poolKey:'ki', delta:-1 }
  ✓ rest-helpers: character with existing state rows still gets restored correctly
    after the upsert change (update path of upsert is exercised)
```

---

## Execution order

```
Phase 0  →  npm test (rest-helpers suite must be green)
Phase 1  →  npm test (character-builder + view-state-xp suites must be green)
Phase 2  →  npm test (ui-party-inventory suite must be green)
Phase 3  →  npm test (ui-resource-pools + regression suites must be green)
         →  npm run build (no TS errors)
         →  manual smoke: open CharacterSheet for Monk, Fighter, Paladin
```

---

## Files changed per phase

| Phase | File | Change |
|-------|------|--------|
| 0 | `prisma/seed.mjs` | Add `channel_divinity_pal` pool; upsert state rows for all test chars |
| 0 | `lib/v2/rest-helpers.ts` | `update` → `upsert` in both rest functions |
| 0 | `lib/v2/__tests__/rest-helpers.test.ts` | **New** |
| 1 | `lib/v2/character-builder.ts` | **New**: `maxForLevel`, `buildClassFeatureDetails` |
| 1 | `types/v2-game.ts` | Add `resourcePool` to `classFeatureDetails`; add resource fields to `PartyMemberInfo` |
| 1 | `lib/v2/view-state.ts` | Call `buildClassFeatureDetails` |
| 1 | `lib/v2/__tests__/character-builder.test.ts` | **New** |
| 1 | `lib/v2/__tests__/view-state-xp.test.ts` | Add resource regression cases |
| 2 | `app/api/v2/room/state/route.ts` | Add `classFeatureDetails` + resource data to party members |
| 2 | `components/v2/character/PartyTab.tsx` | Pass real resource data in `partyMemberToStats` |
| 2 | `lib/v2/__tests__/ui-party-inventory.test.ts` | Add resource passthrough cases |
| 3 | `components/v2/character/ResourcePools.tsx` | **New** component + exported helpers |
| 3 | `components/v2/character/CharacterSheet.tsx` | Import and render `ResourcePools` |
| 3 | `lib/v2/__tests__/ui-resource-pools.test.ts` | **New** |
| 3 | `lib/v2/__tests__/regression-baseline.test.ts` | Add resource regression block |

No schema changes — `FeatureResourcePool` and `CharacterResourceState` already exist.
