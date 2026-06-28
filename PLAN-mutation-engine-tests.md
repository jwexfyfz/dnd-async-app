# Plan: Prisma-mocked tests for mutation-engine.ts (locks/breaking)

## Context
We just fixed a bug and added a feature in `lib/v2/mutation-engine.ts`:

1. **Lockpick roll display fix** — the `use_item` branch where `item.use_effect === 'lockpick'`
   (search for `"Thieves' Tools"` or `use_effect === 'lockpick'`) now writes
   `mechanicalSummary: { type: 'roll_result', event: 'lockpick', rolls: [{ item, skill, d20, modifier, total, dc, success, poi }] }`
   instead of flat fields. This matches what `RollBadge` (`components/v2/combat/RollBadge.tsx`)
   expects (`rolls: RollResult[]`), where `RollResult = { item, skill, d20, modifier, total, dc, success, poi? }`.

2. **New `force_open` action** (search for `'force_open'` in mutation-engine.ts, inserted right
   after the `destroy_poi` branch, before `look_around`). 5e-style single retryable
   Strength(Athletics) check vs `break_dc` (defaults to `lock_dc + 5`, `lock_dc` defaults to 15).
   - Throws if POI not lockable (`computeIsLockable(defaultProps.locked_by)` false) — message
     contains "isn't locked".
   - Throws if `currentProperties.unlocked === true` — message contains "already unlocked".
   - Rolls via `resolveSkillCheck(character, 'Athletics', breakDc)` (private fn near top of file,
     ~line 79, uses `character.skillsModifiers['Athletics']` + `randomInt(1,21)` from `'crypto'`).
   - Always logs a `roll_result` message (`rolls: [{ item: 'Lock', skill: 'Athletics', ... }]`).
   - On success: `poiInstance.update` sets `unlocked: true, destroyed: true`, reveals hidden
     items (mirrors `destroy_poi`'s reveal logic — items with `hidden: true` not yet in
     `revealed_items`/`items_taken`), plus `interacted: true, lastInteraction: 'forced open'`
     if `poi_type === 'exit'`. Also writes a `[MECHANICAL] ... forced open ...` event message.
   - On failure: no `poiInstance.update` at all — state unchanged, retryable.
   - `appliedActions[0].overrideFact` differs for success vs failure (success mentions "the lock
     breaks apart"/revealed items; failure mentions "remains locked... could try again").

There is currently **no test file that exercises `mutateGameState` with mocked Prisma** —
all existing `lib/v2/__tests__/*.test.ts` either test pure functions or stub
`vi.mock('@/lib/prisma', () => ({ prisma: {} }))` for code paths that don't actually call prisma.

## Goal
Add `lib/v2/__tests__/mutation-engine-locks.test.ts` covering `force_open` and the `lockpick`
roll-display fix, with a real (mocked) `$transaction`/`tx` so the actual branch logic runs.

## Step 0 — re-orient (do this first, things may have shifted)
- Re-read `lib/v2/mutation-engine.ts`:
  - `mutateGameState` signature (~line 275): params are
    `(parsedActions, character: CharacterContext, roomInstanceId, sessionId, exitPoiMap,
    validPoiMap, openSpacePoiId, inCombat)`, returns `{ appliedActions, newRoomInstanceId }`.
  - The `force_open` block (search `'force_open'`).
  - The `lockpick` block (search `use_effect === 'lockpick'`).
  - `CharacterContext` interface (~line 32) — note required fields: `id, name, characterClass,
    level, skillsModifiers, skillProficiencies, baseWisdom, baseDexterity, baseStrength,
    baseCharisma, currentHp, maxHp, isHiding`.
  - `requireValidPoi` (~line 48) — throws if `target_poi_instance_id` not in `validPoiMap`.

## Step 1 — build the Prisma mock harness
`mutateGameState` calls `prisma.$transaction(async tx => {...})` per action. For force_open/lockpick
the `tx` calls needed are roughly:
- `tx.poiInstance.findUniqueOrThrow({ where: { id }, include: { template: true } })`
- `tx.poiInstance.update({ where: { id }, data: { currentProperties: {...} } })`
- `tx.messageLog.create({ data: {...} })`
- (lockpick `use_item` path may also read `tx.character.findUniqueOrThrow` for inventory —
  confirm by reading the `use_item` branch's preamble before the lockpick sub-branch)

Approach:
```ts
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from '@/lib/prisma';

function makeTx(overrides) {
  return {
    poiInstance: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.poi),
      update: vi.fn().mockResolvedValue({}),
    },
    messageLog: { create: vi.fn().mockResolvedValue({}) },
    character: { findUniqueOrThrow: vi.fn().mockResolvedValue(overrides.character) },
    // add gameSession/roomParticipant stubs only if a test path hits them
  };
}

beforeEach(() => {
  (prisma.$transaction as any).mockImplementation((fn: any) => fn(currentTx));
});
```

Mock dice rolls deterministically:
```ts
vi.mock('crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('crypto')>()),
  randomInt: vi.fn(),
}));
import { randomInt } from 'crypto';
```
Set `(randomInt as any).mockReturnValue(N)` per test to control the d20 result (1-20 inclusive,
since `randomInt(1, 21)` is exclusive of 21).

## Step 2 — fixture builders
- `makeCharacter(overrides)`: baseStrength 14 (mod +2), `skillsModifiers: { Athletics: 4 }`,
  level 3, etc.
- `makePoi({ defaultProperties, currentProperties })`: shape returned by
  `findUniqueOrThrow({ include: { template: true } })` — i.e.
  `{ id, currentProperties, template: { defaultProperties, name } }`.
- `validPoiMap = new Map([[poiId, 'Iron-Bound Chest']])`.

## Step 3 — test cases
**force_open**
1. Success: `defaultProperties = { locked_by: ['rusty_key'], lock_dc: 14, items: [{ id:'gem', name:'Gem', hidden:true }] }`,
   `currentProperties = {}`. Mock `randomInt` so `total >= breakDc (19)`.
   - Assert `tx.poiInstance.update` called with `currentProperties.unlocked === true`,
     `.destroyed === true`, `.revealed_items` includes `'gem'`.
   - Assert one `tx.messageLog.create` call has
     `data.mechanicalSummary.type === 'roll_result'` and
     `data.mechanicalSummary.rolls[0]` matches `{ item:'Lock', skill:'Athletics', dc:19, success:true, poi:'Iron-Bound Chest', d20, modifier, total }`.
   - Assert `appliedActions[0].overrideFact` mentions the POI name and "Gem".
2. Failure: mock `randomInt` so `total < breakDc`.
   - Assert `tx.poiInstance.update` is **not called**.
   - Assert roll message has `success:false`.
   - Assert `overrideFact` mentions "remains locked".
3. Error — not lockable: `defaultProperties = {}` (no `locked_by`).
   - Assert `mutateGameState(...)` rejects with message containing "isn't locked".
4. Error — already unlocked: `defaultProperties.locked_by = ['key']`,
   `currentProperties.unlocked = true`.
   - Assert rejects with message containing "already unlocked".
5. `break_dc` override: `defaultProperties.break_dc = 25` — assert the roll's `dc` is 25, not
   `lock_dc + 5`.

**lockpick** (action_type `'use_item'`, `item_id` = a thieves'-tools-like item with
`use_effect: 'lockpick'` — find the exact item shape/id expected by reading the `use_item`
branch's item lookup first)
6. Success and failure paths: assert `mechanicalSummary.rolls` is an array (not flat `d20`/`dc`
   keys directly on `mechanicalSummary`), with `item:'Lock'`, `skill:"Thieves' Tools"`,
   and correct `poi`.

## Step 4 — verify
```bash
npx vitest run lib/v2/__tests__/mutation-engine-locks.test.ts
npx tsc --noEmit -p tsconfig.json   # confirm no new type errors
```

## Notes / gotchas
- `resolveSkillCheck` and `requireValidPoi` are NOT exported — test through `mutateGameState`
  only, don't try to import internals.
- `randomInt(1, 21)` from `'crypto'` is the only source of randomness in these branches —
  mocking it is sufficient for determinism (no need to mock `Math.random`).
- Keep `validPoiMap` keys consistent with `action.target_poi_instance_id` and `poi.id`.
- If the `use_item`/lockpick branch reads `character.skillProficiencies` for "thieves tools" /
  "sleight of hand" (lowercase match) — make sure fixture includes one of those strings for the
  success-with-proficiency case, and omit for the no-proficiency case.
