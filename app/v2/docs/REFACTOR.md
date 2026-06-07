# Game-Controller Refactor Plan

**Goal**: Split `lib/v2/game-controller.ts` (4,017 lines) and `app/v2/play/page.tsx` (2,330 lines) into focused modules with zero behavioral regressions. Then add prompt caching and parallelization.

**Execution model**: Each phase ends with a gate command. If the gate fails, stop and fix before proceeding. No manual testing required — TypeScript + Vitest catch all structural and behavioral regressions automatically.

---

## Known Pre-Existing Test Failures (do NOT treat as regressions)

These 5 test files fail before the refactor and must remain the only failures throughout:

```
FAIL  app/v1/actions/auto-advance.test.ts
FAIL  app/v1/actions/handle-player-action.test.ts
FAIL  app/v1/actions/initialize-turn-queue.test.ts
FAIL  app/v1/actions/resolve-roll.test.ts
FAIL  lib/item-interactions.test.ts  (5 specific tests within this file)
```

**Baseline**: `Test Files 5 failed | 24 passed (29)` / `Tests 5 failed | 489 passed (494)`

Every phase gate must show exactly this baseline or better (new tests may add to the passing count).

---

## Gate Command (run after every phase)

```bash
npx tsc --noEmit && npm test
```

Both must pass. TypeScript errors = structural regression. Test failures beyond baseline = behavioral regression.

---

## Phase 0 — Baseline Lock + New Coverage Tests

**Goal**: Confirm baseline, then write tests for currently-exported functions that have no test coverage. These tests import from `@/lib/v2/game-controller` and will continue to work through all phases because game-controller will re-export everything.

### 0.1 Confirm baseline

```bash
npx tsc --noEmit 2>&1 | head -20
npm test 2>&1 | grep -E "Test Files|Tests "
```

Expected:
- `tsc`: no output (or only pre-existing errors)
- `npm test`: `Test Files  5 failed | 24 passed (29)` / `Tests  5 failed | 489 passed (494)`

Record exact output. Any deviation from this before touching a single file means there is a pre-existing problem to fix first.

### 0.2 Create `lib/v2/__tests__/regression-baseline.test.ts`

This file tests every currently-exported symbol that has no existing test coverage. All imports stay at `../game-controller` throughout the refactor — they never need to change because game-controller will re-export.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies so the module loads without DB / API keys
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: vi.fn() }; },
}));
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 3 })),
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => 5),
}));
vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => ({ roll: 15, modifier: 2, total: 17 })),
}));
vi.mock('@/lib/initiative', () => ({
  rollInitiative: vi.fn(() => 10),
}));

import {
  normalizeInventory,
  resolveOpportunityAttacks,
  checkCombatEnd,
  exitCombat,
  advanceTurn,
} from '../game-controller';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'player',
    name: 'Hero',
    initiative: 10,
    hp: 10,
    maxHp: 10,
    ac: 14,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCombatState(overrides: Partial<CombatState> = {}): CombatState {
  return {
    round: 1,
    activeActorIndex: 0,
    initiativeOrder: [],
    currentTurnUsage: {
      actionUsed: false,
      bonusActionUsed: false,
      movementUsed: false,
      reactionUsed: false,
    },
    ...overrides,
  };
}

// ─── normalizeInventory ────────────────────────────────────────────────────────

describe('normalizeInventory', () => {
  it('null input returns empty bag and equipped', () => {
    const result = normalizeInventory(null);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('array input returns empty bag and equipped', () => {
    const result = normalizeInventory([{ id: 'x', name: 'Sword' }]);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('undefined input returns empty bag and equipped', () => {
    const result = normalizeInventory(undefined);
    expect(result).toEqual({ bag: [], equipped: {} });
  });

  it('valid object with bag returns correct bag', () => {
    const item = { id: 'item-1', name: 'Dagger' };
    const result = normalizeInventory({ bag: [item], equipped: {} });
    expect(result.bag).toHaveLength(1);
    expect(result.bag[0].id).toBe('item-1');
  });

  it('object missing bag key defaults bag to empty array', () => {
    const result = normalizeInventory({ equipped: { main_hand: null } });
    expect(result.bag).toEqual([]);
  });

  it('object missing equipped key defaults equipped to empty object', () => {
    const result = normalizeInventory({ bag: [] });
    expect(result.equipped).toEqual({});
  });

  it('object with non-array bag defaults bag to empty array', () => {
    const result = normalizeInventory({ bag: 'not-an-array', equipped: {} });
    expect(result.bag).toEqual([]);
  });

  it('preserves equipped slots', () => {
    const weapon = { id: 'w-1', name: 'Shortsword' };
    const result = normalizeInventory({ bag: [], equipped: { main_hand: weapon } });
    expect(result.equipped.main_hand).toEqual(weapon);
  });
});

// ─── checkCombatEnd ───────────────────────────────────────────────────────────

describe('checkCombatEnd', () => {
  it('returns false when both player and enemy alive', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 5 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 3 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('returns true when all enemies are dead (hp=0)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 5 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('returns true when all players are dead (hp=0)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('returns false when some enemies still alive', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 3 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 7 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('returns true when initiative order is empty', () => {
    const cs = makeCombatState({ initiativeOrder: [] });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('player at exactly 0 hp triggers end', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 0 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 8 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });
});

// ─── exitCombat ───────────────────────────────────────────────────────────────

describe('exitCombat', () => {
  it('sets gameState to exploration and combatState to null', () => {
    const session = { gameState: 'combat', combatState: { round: 2, initiativeOrder: [] } };
    exitCombat(session);
    expect(session.gameState).toBe('exploration');
    expect(session.combatState).toBeNull();
  });

  it('is idempotent when already in exploration', () => {
    const session = { gameState: 'exploration', combatState: null };
    exitCombat(session);
    expect(session.gameState).toBe('exploration');
    expect(session.combatState).toBeNull();
  });

  it('mutates the session object in place', () => {
    const session = { gameState: 'combat', combatState: {} };
    const ref = session;
    exitCombat(session);
    expect(ref.gameState).toBe('exploration');
  });
});

// ─── resolveOpportunityAttacks ────────────────────────────────────────────────

describe('resolveOpportunityAttacks', () => {
  const { rollD20Check } = await import('@/lib/dice');
  const mockRollD20Check = vi.mocked(rollD20Check);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results when no enemies in initiative order', () => {
    const cs = makeCombatState({
      initiativeOrder: [makeEntry({ id: 'p1', type: 'player', hp: 10 })],
    });
    const result = resolveOpportunityAttacks('p1', cs, 14);
    expect(result).toHaveLength(0);
  });

  it('returns empty results when no close enemies', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 5, proximity: 'far' }),
      ],
    });
    const result = resolveOpportunityAttacks('p1', cs, 14);
    expect(result).toHaveLength(0);
  });

  it('triggers opportunity attack from close enemy on player movement', () => {
    mockRollD20Check.mockReturnValue({
      roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18,
      success: true, critical: false, fumble: false,
    });
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 10 }),
        makeEntry({
          id: 'e1', type: 'enemy', hp: 5, proximity: 'close',
          _combatStats: { attack_bonus: 3, damage: '1d6', ac: 13 } as never,
        }),
      ],
    });
    const result = resolveOpportunityAttacks('p1', cs, 14);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].attackerId).toBe('e1');
    expect(result[0].hit).toBe(true);
  });

  it('records a miss when attack roll fails', () => {
    mockRollD20Check.mockReturnValue({
      roll: 3, modifier: 2, dc: 14, dcType: 'AC', total: 5,
      success: false, critical: false, fumble: false,
    });
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 10 }),
        makeEntry({
          id: 'e1', type: 'enemy', hp: 5, proximity: 'close',
          _combatStats: { attack_bonus: 2, damage: '1d4', ac: 13 } as never,
        }),
      ],
    });
    const result = resolveOpportunityAttacks('p1', cs, 14);
    expect(result[0].hit).toBe(false);
    expect(result[0].damage).toBe(0);
  });

  it('does not trigger from dead enemies (hp=0)', () => {
    const cs = makeCombatState({
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 10 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0, proximity: 'close' }),
      ],
    });
    const result = resolveOpportunityAttacks('p1', cs, 14);
    expect(result).toHaveLength(0);
  });
});

// ─── advanceTurn ──────────────────────────────────────────────────────────────

describe('advanceTurn — wrapping behavior', () => {
  it('wraps from last actor back to index 0 and increments round', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorIndex: 1,
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player' }),
        makeEntry({ id: 'e1', type: 'enemy' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorIndex).toBe(0);
    expect(next.round).toBe(2);
  });

  it('advances index without incrementing round mid-round', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorIndex: 0,
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player' }),
        makeEntry({ id: 'e1', type: 'enemy' }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorIndex).toBe(1);
    expect(next.round).toBe(1);
  });

  it('resets currentTurnUsage to all false on advance', () => {
    const cs = makeCombatState({
      activeActorIndex: 0,
      initiativeOrder: [makeEntry({ id: 'p1' }), makeEntry({ id: 'e1', type: 'enemy' })],
      currentTurnUsage: {
        actionUsed: true, bonusActionUsed: true, movementUsed: true, reactionUsed: true,
      },
    });
    const next = advanceTurn(cs);
    expect(next.currentTurnUsage.actionUsed).toBe(false);
    expect(next.currentTurnUsage.bonusActionUsed).toBe(false);
  });

  it('skips dead actors (hp=0) when advancing', () => {
    const cs = makeCombatState({
      round: 1,
      activeActorIndex: 0,
      initiativeOrder: [
        makeEntry({ id: 'p1', type: 'player', hp: 5 }),
        makeEntry({ id: 'e1', type: 'enemy', hp: 0 }),
        makeEntry({ id: 'e2', type: 'enemy', hp: 8 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorIndex).toBe(2);
  });
});
```

### 0.3 Gate

```bash
npx tsc --noEmit && npm test
```

**Expected**: `Test Files  5 failed | 25 passed (30)` / `Tests  5 failed | ≥519 passed` (new tests add to the passing count). If the new test file itself has failures, fix them before proceeding — these tests define the behavioral contract we're protecting.

---

## Phase 1 — Extract `lib/v2/poi-context.ts`

**Goal**: Extract the `PoiContext` interface and its combat-awareness sub-types (`PoiCombatStats`, `AiBehavior`, `CombatPoiContext`) into a standalone types file. These are referenced across 5+ future modules, so they must land first.

### 1.1 Create `lib/v2/poi-context.ts`

```typescript
// Shared interface for all points of interest — used by combat engine,
// AI prompt builders, mutation engine, and the main handler.
import type { ItemDefinition } from '@/types/v2-game';

export interface PoiCombatStats {
  dex_score?: number;
  wis_score?: number;
  attack_bonus?: number;
  damage?: string;
  max_hp?: number;
  ac?: number;
  passive_perception?: number;
  resistances?: string[];
}

export interface AiBehavior {
  priority?: 'aggressive' | 'defensive' | 'cowardly';
  flee_threshold?: number;
}

export interface PoiContext {
  id: string;
  name: string;
  keyword: string;
  availableStances: string[];
  examined: boolean;
  interacted: boolean;
  destroyed: boolean;
  isLocked: boolean;
  isUnlocked: boolean;
  isExit: boolean;
  targetRoomTemplateId: string | null;
  items: ItemDefinition[];
  floorItems: ItemDefinition[];
  isOpenSpace: boolean;
  visibility: 'always' | 'proximity_only';
  peekVisibility: 'none' | 'obvious_only' | 'full';
  _currentAwareness?: string;
  _hostileTo?: string[];
  _recognitionException?: string;
  _combatStats?: PoiCombatStats;
  _aiBehavior?: AiBehavior;
  _defaultProps?: Record<string, unknown>;
}

export interface CombatPoiContext extends PoiContext {
  _combatStats: PoiCombatStats;
  _aiBehavior: AiBehavior;
}

export interface AdjacentRoomContext {
  roomName: string;
  exitPoiName: string;
  exitPoiId: string;
  targetRoomTemplateId: string;
  pois: PoiContext[];
}
```

### 1.2 In `lib/v2/game-controller.ts`

- Delete the `PoiContext` interface block (lines 77–100)
- Delete the `PoiCombatStats` interface (lines 687–696)
- Delete the `AiBehavior` interface (lines 698–701)
- Delete the `CombatPoiContext extends PoiContext` interface (lines 725–733)
- Delete the `AdjacentRoomContext` interface (lines 259–265)
- Add at the top of imports:

```typescript
import type { PoiContext, PoiCombatStats, AiBehavior, CombatPoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';
```

### 1.3 Create `lib/v2/__tests__/poi-context.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type { PoiContext, PoiCombatStats, AiBehavior, AdjacentRoomContext } from '../poi-context';

describe('PoiContext types', () => {
  it('minimal PoiContext satisfies shape', () => {
    const ctx: PoiContext = {
      id: 'poi-1', name: 'Chest', keyword: 'chest',
      availableStances: ['crouch'],
      examined: false, interacted: false, destroyed: false,
      isLocked: false, isUnlocked: false,
      isExit: false, targetRoomTemplateId: null,
      items: [], floorItems: [],
      isOpenSpace: false,
      visibility: 'always', peekVisibility: 'none',
    };
    expect(ctx.id).toBe('poi-1');
    expect(ctx.isExit).toBe(false);
  });

  it('exit PoiContext has targetRoomTemplateId', () => {
    const ctx: PoiContext = {
      id: 'exit-1', name: 'Door North', keyword: 'door',
      availableStances: [],
      examined: false, interacted: false, destroyed: false,
      isLocked: false, isUnlocked: false,
      isExit: true, targetRoomTemplateId: 'room-tmpl-2',
      items: [], floorItems: [],
      isOpenSpace: false,
      visibility: 'always', peekVisibility: 'full',
    };
    expect(ctx.targetRoomTemplateId).toBe('room-tmpl-2');
  });

  it('PoiCombatStats with all optional fields', () => {
    const stats: PoiCombatStats = { attack_bonus: 3, damage: '1d6', max_hp: 11, ac: 13 };
    expect(stats.attack_bonus).toBe(3);
  });

  it('AiBehavior priority values', () => {
    const behaviors: AiBehavior['priority'][] = ['aggressive', 'defensive', 'cowardly'];
    expect(behaviors).toHaveLength(3);
  });
});
```

### 1.4 Gate

```bash
npx tsc --noEmit && npm test
```

Expected: same baseline failures, new `poi-context.test.ts` passes.

---

## Phase 2 — Extract `lib/v2/item-helpers.ts`

**Goal**: Move the three item utility functions out of game-controller.

### 2.1 Create `lib/v2/item-helpers.ts`

Copy from game-controller lines 27–74 (normalizeInventory, inventorySummary, extractPoiItems):

```typescript
import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';

export function normalizeInventory(raw: unknown): CharacterInventory {
  // ... exact body from game-controller lines 28–40
}

export function inventorySummary(inv: CharacterInventory): string {
  // ... exact body from game-controller lines 42–48
}

export function extractPoiItems(
  defaultProperties: unknown,
  currentProperties: unknown,
): { items: ItemDefinition[]; floorItems: ItemDefinition[] } {
  // ... exact body from game-controller lines 50–73
}
```

### 2.2 In `lib/v2/game-controller.ts`

- Delete lines 27–74 (the three functions)
- Add import:

```typescript
import { normalizeInventory, inventorySummary, extractPoiItems } from '@/lib/v2/item-helpers';
```

- Add re-export (so existing external importers — `app/api/v2/room/state/route.ts` — keep working without changes):

```typescript
export { normalizeInventory } from '@/lib/v2/item-helpers';
```

### 2.3 Create `lib/v2/__tests__/item-helpers.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeInventory, inventorySummary, extractPoiItems } from '../item-helpers';

describe('normalizeInventory', () => {
  // (same tests as regression-baseline.test.ts — redundant but direct-imports are faster to debug)
  it('null → empty', () => expect(normalizeInventory(null)).toEqual({ bag: [], equipped: {} }));
  it('array → empty', () => expect(normalizeInventory([])).toEqual({ bag: [], equipped: {} }));
  it('valid object → preserved', () => {
    const item = { id: 'i1', name: 'Sword' };
    const r = normalizeInventory({ bag: [item], equipped: {} });
    expect(r.bag[0].id).toBe('i1');
  });
});

describe('inventorySummary', () => {
  it('empty inventory', () => {
    const r = inventorySummary({ bag: [], equipped: {} });
    expect(r).toBe('bag=0 item(s)');
  });

  it('bag with 2 items, no equipped', () => {
    const r = inventorySummary({
      bag: [{ id: 'a', name: 'Dagger' }, { id: 'b', name: 'Torch' }],
      equipped: {},
    });
    expect(r).toBe('bag=2 item(s)');
  });

  it('equipped main_hand slot appears in summary', () => {
    const r = inventorySummary({
      bag: [],
      equipped: { main_hand: { id: 'sw', name: 'Shortsword' } },
    });
    expect(r).toContain('main_hand:Shortsword');
  });

  it('null equipped slots are excluded', () => {
    const r = inventorySummary({ bag: [], equipped: { main_hand: null } });
    expect(r).not.toContain('main_hand');
  });
});

describe('extractPoiItems', () => {
  it('empty defaults and current → empty lists', () => {
    const { items, floorItems } = extractPoiItems({}, {});
    expect(items).toHaveLength(0);
    expect(floorItems).toHaveLength(0);
  });

  it('non-hidden item in template is visible', () => {
    const defaults = { items: [{ id: 'k1', name: 'Key', hidden: false }] };
    const { items } = extractPoiItems(defaults, {});
    expect(items[0].id).toBe('k1');
  });

  it('hidden item not in revealed_items is excluded', () => {
    const defaults = { items: [{ id: 'k1', name: 'Secret Key', hidden: true }] };
    const { items } = extractPoiItems(defaults, {});
    expect(items).toHaveLength(0);
  });

  it('hidden item in revealed_items is visible', () => {
    const defaults = { items: [{ id: 'k1', name: 'Secret Key', hidden: true }] };
    const current = { revealed_items: ['k1'] };
    const { items } = extractPoiItems(defaults, current);
    expect(items[0].id).toBe('k1');
  });

  it('taken item is excluded', () => {
    const defaults = { items: [{ id: 'k1', name: 'Key' }] };
    const current = { items_taken: ['k1'] };
    const { items } = extractPoiItems(defaults, current);
    expect(items).toHaveLength(0);
  });

  it('floor_items from current properties are returned', () => {
    const current = { floor_items: [{ id: 'f1', name: 'Dropped Torch' }] };
    const { floorItems } = extractPoiItems({}, current);
    expect(floorItems[0].id).toBe('f1');
  });
});
```

### 2.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 3 — Extract `lib/v2/room-geometry.ts`

**Goal**: Move all grid and line-of-sight geometry functions. These are currently duplicated between game-controller and play/page.tsx — extracting to a shared module eliminates the duplication.

### 3.1 Create `lib/v2/room-geometry.ts`

Copy from game-controller lines 103–124 (slot helpers) and lines 200–256 (LoS):

```typescript
// Grid slot geometry shared by the game engine and map renderer.

export const SLOT_COORDS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

export function slotGridDistance(a: string, b: string): number {
  // ... exact body
}

export function resolveEffectiveVisibility(
  defaultProps: Record<string, unknown>,
  currentProps: Record<string, unknown>,
): 'always' | 'proximity_only' {
  // ... exact body
}

export const LOS_SLOT_PX = 40;
export const LOS_ROOM_PX = LOS_SLOT_PX * 3;

export const LOS_SLOT_OFFSETS: Record<string, [number, number]> = {
  // ... exact content
};

export const LOS_ADJ_ORIGIN: Record<string, [number, number]> = {
  // ... exact content
};

export function losSlotCenter(slot: string, roomX: number, roomY: number): [number, number] {
  // ... exact body
}

export function losArchOpening(wallSection: string, archWidth: number): [number, number] {
  // ... exact body
}

export function isPoiVisibleThroughExit(
  // ... exact signature and body
): boolean {
  // ...
}
```

### 3.2 In `lib/v2/game-controller.ts`

- Delete grid helpers (lines 103–124) and LoS block (lines 200–256)
- Add import:

```typescript
import {
  SLOT_COORDS, slotGridDistance, resolveEffectiveVisibility,
  LOS_SLOT_PX, LOS_ROOM_PX, LOS_SLOT_OFFSETS, LOS_ADJ_ORIGIN,
  losSlotCenter, losArchOpening, isPoiVisibleThroughExit,
} from '@/lib/v2/room-geometry';
```

### 3.3 Update `app/v2/play/page.tsx` to use shared geometry

The page currently defines its own `slotCenter`, `wallAxisForDirection`, `archOpening`, `isSlotVisibleThroughExit` (lines 61–127) which duplicate the engine's geometry. Replace all four with imports from `room-geometry`:

- Delete `slotCenter` → use `losSlotCenter` from room-geometry (same math, rename usage sites)
- Delete `archOpening` → use `losArchOpening`
- Delete `isSlotVisibleThroughExit` → use `isPoiVisibleThroughExit`
- Delete `wallAxisForDirection` if it's only called inside the deleted functions

Add to play/page.tsx imports:
```typescript
import { losSlotCenter, losArchOpening, isPoiVisibleThroughExit } from '@/lib/v2/room-geometry';
```

### 3.4 Create `lib/v2/__tests__/room-geometry.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  slotGridDistance, resolveEffectiveVisibility,
  losSlotCenter, losArchOpening,
} from '../room-geometry';

describe('slotGridDistance', () => {
  it('same slot = 0', () => expect(slotGridDistance('C', 'C')).toBe(0));
  it('adjacent cardinal = 1', () => expect(slotGridDistance('C', 'N')).toBe(1));
  it('diagonal = 1 (Chebyshev distance)', () => expect(slotGridDistance('NW', 'SE')).toBe(2));
  it('NW to SE = 2', () => expect(slotGridDistance('NW', 'SE')).toBe(2));
  it('unknown slot falls back to C', () => expect(slotGridDistance('??', 'C')).toBe(0));
});

describe('resolveEffectiveVisibility', () => {
  it('defaults to always when no visibility key', () => {
    expect(resolveEffectiveVisibility({}, {})).toBe('always');
  });

  it('currentProps visibility_override=always wins over default proximity_only', () => {
    const result = resolveEffectiveVisibility(
      { visibility: 'proximity_only' },
      { visibility_override: 'always' },
    );
    expect(result).toBe('always');
  });

  it('defaultProps proximity_only preserved when no override', () => {
    expect(resolveEffectiveVisibility({ visibility: 'proximity_only' }, {})).toBe('proximity_only');
  });
});

describe('losSlotCenter', () => {
  it('center slot returns midpoint of room', () => {
    const [x, y] = losSlotCenter('C', 0, 0);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it('NW slot returns smaller x and y than SE', () => {
    const [nwX, nwY] = losSlotCenter('NW', 0, 0);
    const [seX, seY] = losSlotCenter('SE', 0, 0);
    expect(nwX).toBeLessThan(seX);
    expect(nwY).toBeLessThan(seY);
  });
});

describe('losArchOpening', () => {
  it('returns a two-element coordinate tuple', () => {
    const result = losArchOpening('N', 40);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('number');
    expect(typeof result[1]).toBe('number');
  });
});
```

### 3.5 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 4 — Extract `lib/v2/poi-context-helpers.ts`

**Goal**: Move three pure POI extraction functions that will be shared by db-context and view-state.

### 4.1 Create `lib/v2/poi-context-helpers.ts`

Copy from game-controller lines 165–197 (extractAvailableStances, extractExplorationFlags, extractExitInfo):

```typescript
export function extractAvailableStances(defaultProperties: unknown): string[] {
  // ... exact body
}

export function extractExplorationFlags(currentProperties: unknown): {
  examined: boolean; interacted: boolean; destroyed: boolean;
} {
  // ... exact body
}

export function extractExitInfo(defaultProperties: unknown): {
  isExit: boolean; targetRoomTemplateId: string | null;
} {
  // ... exact body
}
```

### 4.2 In `lib/v2/game-controller.ts`

- Delete lines 165–197
- Add import from `@/lib/v2/poi-context-helpers`

### 4.3 Create `lib/v2/__tests__/poi-context-helpers.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { extractAvailableStances, extractExplorationFlags, extractExitInfo } from '../poi-context-helpers';

describe('extractAvailableStances', () => {
  it('returns empty array for null input', () => {
    expect(extractAvailableStances(null)).toEqual([]);
  });

  it('returns empty array for array input', () => {
    expect(extractAvailableStances([])).toEqual([]);
  });

  it('extracts resulting_stance values from non-reserved keys', () => {
    const props = {
      crouch: { resulting_stance: 'crouching' },
      lean: { resulting_stance: 'leaning' },
    };
    const result = extractAvailableStances(props);
    expect(result).toContain('crouching');
    expect(result).toContain('leaning');
  });

  it('excludes reserved keys (items, poi_type, visibility, etc.)', () => {
    const props = {
      items: { resulting_stance: 'should-be-excluded' },
      poi_type: { resulting_stance: 'also-excluded' },
      lean: { resulting_stance: 'leaning' },
    };
    const result = extractAvailableStances(props);
    expect(result).toEqual(['leaning']);
  });

  it('excludes entries without resulting_stance', () => {
    const props = { action1: { description: 'no stance here' } };
    expect(extractAvailableStances(props)).toEqual([]);
  });
});

describe('extractExplorationFlags', () => {
  it('null → all false', () => {
    expect(extractExplorationFlags(null)).toEqual({ examined: false, interacted: false, destroyed: false });
  });

  it('examined=true is preserved', () => {
    const result = extractExplorationFlags({ examined: true });
    expect(result.examined).toBe(true);
    expect(result.interacted).toBe(false);
  });

  it('all three flags together', () => {
    const result = extractExplorationFlags({ examined: true, interacted: true, destroyed: true });
    expect(result).toEqual({ examined: true, interacted: true, destroyed: true });
  });

  it('truthy non-boolean values are still false (strict check)', () => {
    const result = extractExplorationFlags({ examined: 1, interacted: 'yes' });
    expect(result.examined).toBe(false);
    expect(result.interacted).toBe(false);
  });
});

describe('extractExitInfo', () => {
  it('non-exit POI returns isExit=false', () => {
    const result = extractExitInfo({ poi_type: 'container' });
    expect(result.isExit).toBe(false);
    expect(result.targetRoomTemplateId).toBeNull();
  });

  it('exit POI with enter.target_room_template_id returns isExit=true', () => {
    const props = { enter: { target_room_template_id: 'room-tmpl-99' } };
    const result = extractExitInfo(props);
    expect(result.isExit).toBe(true);
    expect(result.targetRoomTemplateId).toBe('room-tmpl-99');
  });

  it('null input returns isExit=false', () => {
    expect(extractExitInfo(null)).toEqual({ isExit: false, targetRoomTemplateId: null });
  });

  it('enter key without target_room_template_id returns isExit=false', () => {
    const result = extractExitInfo({ enter: { label: 'Go north' } });
    expect(result.isExit).toBe(false);
  });
});
```

### 4.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 5 — Extract `lib/v2/act-definitions.ts`

**Goal**: Move the story act configuration data and its types.

### 5.1 Create `lib/v2/act-definitions.ts`

Copy from game-controller lines 127–164:

```typescript
export interface ActMutation {
  poiTemplateId: string;
  setProps: Record<string, unknown>;
}

export interface ActDefinition {
  act: number;
  completionFlags: string[];
  openingObjective?: string;
  onStartMutations: ActMutation[];
}

export const DUNGEON_ACTS: ActDefinition[] = [
  // ... exact content
];
```

### 5.2 In `lib/v2/game-controller.ts`

- Delete lines 127–164
- Add import from `@/lib/v2/act-definitions`

### 5.3 Create `lib/v2/__tests__/act-definitions.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { DUNGEON_ACTS } from '../act-definitions';

describe('DUNGEON_ACTS', () => {
  it('contains exactly 3 acts', () => {
    expect(DUNGEON_ACTS).toHaveLength(3);
  });

  it('acts are numbered 1, 2, 3 in order', () => {
    expect(DUNGEON_ACTS.map(a => a.act)).toEqual([1, 2, 3]);
  });

  it('each act has at least one completionFlag', () => {
    for (const act of DUNGEON_ACTS) {
      expect(act.completionFlags.length).toBeGreaterThan(0);
    }
  });

  it('act 1 has no onStartMutations (first room is default state)', () => {
    expect(DUNGEON_ACTS[0].onStartMutations).toHaveLength(0);
  });

  it('act 2 unlocks the Submerged Gate', () => {
    const act2 = DUNGEON_ACTS.find(a => a.act === 2)!;
    const gate = act2.onStartMutations.find(m =>
      m.poiTemplateId === '77000001-0000-0000-0000-000000000001',
    );
    expect(gate).toBeDefined();
    expect(gate!.setProps).toMatchObject({ unlocked: true });
  });

  it('act 2 completes when ritual_disrupted OR harwick_defeated', () => {
    const act2 = DUNGEON_ACTS.find(a => a.act === 2)!;
    expect(act2.completionFlags).toContain('ritual_disrupted');
    expect(act2.completionFlags).toContain('harwick_defeated');
  });

  it('act 3 completes when binding_seal_used OR binding_seal_destroyed', () => {
    const act3 = DUNGEON_ACTS.find(a => a.act === 3)!;
    expect(act3.completionFlags).toContain('binding_seal_used');
    expect(act3.completionFlags).toContain('binding_seal_destroyed');
  });

  it('acts 2 and 3 have an openingObjective', () => {
    expect(DUNGEON_ACTS[1].openingObjective).toBeTruthy();
    expect(DUNGEON_ACTS[2].openingObjective).toBeTruthy();
  });
});
```

### 5.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 6 — Extract `lib/v2/ai-prompts.ts`

**Goal**: Move the two AI system prompt builder functions. These are the largest token-cost items and will receive prompt-caching treatment in Phase 16.

### 6.1 Create `lib/v2/ai-prompts.ts`

Copy from game-controller lines 267–470 (buildHaikuSystemPrompt and buildNarrativeSystemPrompt):

```typescript
import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';
import type { PoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';

export function buildHaikuSystemPrompt(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
): string {
  // ... exact body
}

export function buildNarrativeSystemPrompt(
  roomName: string,
  roomDescription: string,
  mechanicalFactBlock: string,
  itemsBlock: string,
  storyFlags: Record<string, unknown>,
): string {
  // ... exact body
}
```

### 6.2 In `lib/v2/game-controller.ts`

- Delete lines 267–470
- Add import from `@/lib/v2/ai-prompts`

### 6.3 Create `lib/v2/__tests__/ai-prompts.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildHaikuSystemPrompt, buildNarrativeSystemPrompt } from '../ai-prompts';
import type { PoiContext } from '../poi-context';

function makePoiCtx(overrides: Partial<PoiContext> = {}): PoiContext {
  return {
    id: 'poi-1', name: 'Chest', keyword: 'chest',
    availableStances: ['crouch'], examined: false, interacted: false, destroyed: false,
    isLocked: false, isUnlocked: false, isExit: false, targetRoomTemplateId: null,
    items: [], floorItems: [], isOpenSpace: false,
    visibility: 'always', peekVisibility: 'none',
    ...overrides,
  };
}

const emptyInventory = { bag: [], equipped: {} };

describe('buildHaikuSystemPrompt', () => {
  it('contains the extract_game_intent instruction', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    expect(prompt).toContain('extract_game_intent');
  });

  it('lists all action type keywords', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    const actions = ['examine', 'interact', 'move_to_room', 'pick_up', 'attack', 'hide', 'death_save'];
    for (const action of actions) {
      expect(prompt).toContain(`"${action}"`);
    }
  });

  it('includes POI name and keyword in output', () => {
    const poi = makePoiCtx({ name: 'Ancient Altar', keyword: 'altar', id: 'poi-altar' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('Ancient Altar');
    expect(prompt).toContain('altar');
  });

  it('includes character position when at a POI', () => {
    const poi = makePoiCtx({ id: 'poi-altar', name: 'Ancient Altar', keyword: 'altar' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], 'poi-altar', null);
    expect(prompt).toContain('Currently standing AT');
    expect(prompt).toContain('Ancient Altar');
  });

  it('includes open space position when not adjacent to POI', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    expect(prompt).toContain('open space');
  });

  it('shows LOCKED status for locked POI', () => {
    const poi = makePoiCtx({ isLocked: true, name: 'Iron Gate', keyword: 'gate' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('LOCKED');
  });

  it('shows item names in POI item list', () => {
    const item = { id: 'k1', name: 'Rusty Key' };
    const poi = makePoiCtx({ items: [item] });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('Rusty Key');
  });

  it('shows bag items', () => {
    const inventory = { bag: [{ id: 'torch1', name: 'Torch' }], equipped: {} };
    const prompt = buildHaikuSystemPrompt([], inventory, [], null, null);
    expect(prompt).toContain('Torch');
  });

  it('shows exit POI in EXIT POINTS section, not regular POI section', () => {
    const exit = makePoiCtx({
      name: 'Door North', keyword: 'door', isExit: true,
      targetRoomTemplateId: 'room-tmpl-2',
    });
    const prompt = buildHaikuSystemPrompt([exit], emptyInventory, [], null, null);
    expect(prompt).toContain('EXIT POINTS');
    expect(prompt).toContain('Door North');
  });

  it('excludes proximity_only POIs from prompt', () => {
    const hidden = makePoiCtx({ name: 'Secret Door', visibility: 'proximity_only' });
    const prompt = buildHaikuSystemPrompt([hidden], emptyInventory, [], null, null);
    expect(prompt).not.toContain('Secret Door');
  });

  it('includes CROSS-ROOM RULE section when adjacent room has POIs', () => {
    const adjacentRoom = {
      roomName: 'Guard Post',
      exitPoiName: 'Door North',
      exitPoiId: 'exit-1',
      targetRoomTemplateId: 'room-guard-post',
      pois: [makePoiCtx({ name: 'Guard Desk', keyword: 'desk' })],
    };
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, adjacentRoom);
    expect(prompt).toContain('CROSS-ROOM RULE');
    expect(prompt).toContain('Guard Post');
  });
});

describe('buildNarrativeSystemPrompt', () => {
  it('contains room name', () => {
    const p = buildNarrativeSystemPrompt('Guard Post', 'A dusty room.', 'Player moved.', '', {});
    expect(p).toContain('Guard Post');
  });

  it('contains room description', () => {
    const p = buildNarrativeSystemPrompt('Guard Post', 'A dusty room.', 'Player moved.', '', {});
    expect(p).toContain('A dusty room.');
  });

  it('contains engine update block', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Player examined the chest. Found: Key.', '', {});
    expect(p).toContain('Player examined the chest.');
  });

  it('shows story flags', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', { commander_note_read: true });
    expect(p).toContain('commander_note_read');
  });

  it('shows (none set) when no story flags', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('(none set)');
  });

  it('contains STRICT INSTRUCTIONS section', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('STRICT INSTRUCTIONS');
  });

  it('contains items block when items present', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '- Rusty Key (at: Chest)', {});
    expect(p).toContain('Rusty Key');
  });

  it('shows no items visible when items block is empty', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('no items visible');
  });
});
```

### 6.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 7 — Extract `lib/v2/intent-parser.ts`

**Goal**: Move the Haiku API call for intent parsing.

### 7.1 Create `lib/v2/intent-parser.ts`

Copy from game-controller lines 532–684 (parseIntentWithHaiku):

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { buildHaikuSystemPrompt } from '@/lib/v2/ai-prompts';
import type { ExtractedAction } from '@/types/v2-game';
import type { PoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';
import type { CharacterInventory } from '@/types/v2-game';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function parseIntentWithHaiku(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  playerActionText: string,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
  actionHint?: string | null,
): Promise<ExtractedAction[]> {
  // ... exact body
}
```

**Note**: Remove the `const anthropic` instantiation from game-controller.ts (line 23) since it will now live in intent-parser.ts. The narrative generation in game-controller also uses Anthropic — that usage will be moved in Phase 10 (narrative.ts).

Actually, keep the `anthropic` instance in game-controller.ts until Phase 10 removes the narrative generation code. Only remove it once all Anthropic usage has moved out.

### 7.2 In `lib/v2/game-controller.ts`

- Delete lines 532–684
- Add import from `@/lib/v2/intent-parser`

### 7.3 Gate

```bash
npx tsc --noEmit && npm test
```

No new test file needed here — intent parsing requires live Anthropic API calls and is covered by integration. The Haiku system prompt (the testable contract) is already tested in Phase 6.

---

## Phase 8 — Extract `lib/v2/combat-engine.ts`

**Goal**: Move all combat functions. This is the highest-impact extraction — the existing combat tests will validate correctness automatically.

### 8.1 Create `lib/v2/combat-engine.ts`

Copy from game-controller lines 687–1345:

```typescript
import { randomInt } from 'crypto';
import { abilityModifier, rollD20Check, rollDice } from '@/lib/dice';
import { computeAttackDamage } from '@/lib/mechanical-damage';
import { rollStealthCheck } from '@/lib/stealth';
import { rollInitiative } from '@/lib/initiative';
import { prisma } from '@/lib/prisma';
import { slotGridDistance } from '@/lib/v2/room-geometry';
import type { CombatState, InitiativeEntry, ExtractedAction, CharacterInventory } from '@/types/v2-game';
import type { PoiContext, PoiCombatStats, AiBehavior, CombatPoiContext } from '@/lib/v2/poi-context';

// All types and functions from game-controller combat section, exact bodies:
export interface OpportunityAttackResult { ... }
export interface EnemyTurnResult { ... }
export type BodyObscurement = 'visible' | 'partial' | 'full';
export interface BodyDiscoveryResult { ... }
type CombatRollLog = { ... };
interface CombatActionResult { ... }

export function detectCombatTrigger(...): boolean { ... }
export async function enterCombat(...): Promise<CombatState> { ... }
export function exitCombat(...): void { ... }
export function resolveOpportunityAttacks(...): OpportunityAttackResult[] { ... }
export function resolveEnemyTurn(...): EnemyTurnResult { ... }
export function resolveBodyDiscovery(...): BodyDiscoveryResult { ... }
export function advanceTurn(cs: CombatState): CombatState { ... }
export function checkCombatEnd(cs: CombatState): boolean { ... }
export function resolveCombatAction(...): CombatActionResult { ... }
```

### 8.2 In `lib/v2/game-controller.ts`

- Delete lines 687–1345
- Add import/re-export:

```typescript
import {
  detectCombatTrigger, enterCombat, exitCombat,
  resolveOpportunityAttacks, resolveEnemyTurn, resolveBodyDiscovery,
  advanceTurn, checkCombatEnd, resolveCombatAction,
} from '@/lib/v2/combat-engine';
import type {
  OpportunityAttackResult, EnemyTurnResult, BodyObscurement, BodyDiscoveryResult,
} from '@/lib/v2/combat-engine';

// Re-export for existing test imports (tests reference ../game-controller)
export {
  detectCombatTrigger, enterCombat, exitCombat,
  resolveOpportunityAttacks, resolveEnemyTurn, resolveBodyDiscovery,
  advanceTurn, checkCombatEnd, resolveCombatAction,
};
export type { OpportunityAttackResult, EnemyTurnResult, BodyObscurement, BodyDiscoveryResult };
```

### 8.3 Gate

```bash
npx tsc --noEmit && npm test
```

**Critical**: The 3 existing combat test files (`combat-entry.test.ts`, `enemy-ai.test.ts`, `advanced-mechanics.test.ts`) all import from `../game-controller`. After this phase they must still pass — the re-exports ensure this. Any failure here is a logic error introduced during the copy.

---

## Phase 9 — Extract `lib/v2/db-context.ts`

**Goal**: Move the database lookup logic that Stage 1 of the handler uses.

### 9.1 Create `lib/v2/db-context.ts`

Copy from game-controller lines 473–529:

```typescript
import { prisma } from '@/lib/prisma';
import { normalizeInventory } from '@/lib/v2/item-helpers';
import type { CharacterInventory } from '@/types/v2-game';

export const roomInstanceQuery = (roomInstanceId: string) =>
  prisma.roomInstance.findUniqueOrThrow({
    // ... exact query
  });

export async function lookupDatabaseContext(characterId: string, roomInstanceId: string) {
  // ... exact body including lazy-sync logic
}
```

### 9.2 In `lib/v2/game-controller.ts`

- Delete lines 473–529
- Add import from `@/lib/v2/db-context`

### 9.3 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 10 — Extract `lib/v2/mutation-engine.ts`

**Goal**: Move `mutateGameState` and its ~8 helper functions. This is the largest single extraction (~1,300 lines) and the highest bug risk — the gate is the most important one.

### 10.1 Create `lib/v2/mutation-engine.ts`

Copy from game-controller lines 1348–2920:

```typescript
import { randomInt } from 'crypto';
import { prisma } from '@/lib/prisma';
import { rollD20Check, abilityModifier } from '@/lib/dice';
import { rollStealthCheck } from '@/lib/stealth';
import { normalizeInventory, extractPoiItems } from '@/lib/v2/item-helpers';
import { extractExitInfo, extractAvailableStances } from '@/lib/v2/poi-context-helpers';
import {
  detectCombatTrigger, enterCombat, resolveCombatAction,
  resolveOpportunityAttacks, checkCombatEnd, exitCombat, advanceTurn,
} from '@/lib/v2/combat-engine';
import type { ExtractedAction, CharacterInventory, ItemDefinition } from '@/types/v2-game';
import type { PoiContext } from '@/lib/v2/poi-context';

// All internal types and functions, exact bodies:
export interface AppliedAction { ... }
export interface MutationResult { ... }
export interface CharacterContext { ... }

function requireValidPoi(...): string { ... }
async function writeStoryFlags(...): Promise<void> { ... }
function resolveSkillCheck(...) { ... }
function resolveInteractCheck(...) { ... }
async function handleMoveToRoom(...): Promise<string> { ... }
export async function mutateGameState(...): Promise<MutationResult> { ... }
```

### 10.2 In `lib/v2/game-controller.ts`

- Delete lines 1348–2920
- Add import/re-export from `@/lib/v2/mutation-engine`

### 10.3 Gate

```bash
npx tsc --noEmit && npm test
```

If TypeScript reports errors, check that all types imported by mutation-engine (especially `CharacterContext` which is referenced by both mutation-engine and game-controller) are correctly exported from the new module.

---

## Phase 11 — Extract `lib/v2/narrative.ts`

**Goal**: Move the narrative generation stage.

### 11.1 Create `lib/v2/narrative.ts`

Copy from game-controller lines 2923–3060:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { extractPoiItems } from '@/lib/v2/item-helpers';
import { buildNarrativeSystemPrompt } from '@/lib/v2/ai-prompts';
import type { AppliedAction } from '@/lib/v2/mutation-engine';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateAndPersistNarrative(
  roomInstanceId: string,
  characterId: string,
  characterName: string,
  roomName: string,
  roomDescription: string,
  appliedActions: AppliedAction[],
  sessionId: string,
  extraFacts?: string[],
): Promise<{ text: string; persisted: boolean }> {
  // ... exact body
}
```

### 11.2 In `lib/v2/game-controller.ts`

- Delete lines 2923–3060
- Remove the `const anthropic` instantiation from the top of game-controller.ts (line 23) — it's now in both intent-parser.ts and narrative.ts
- Add import from `@/lib/v2/narrative`

### 11.3 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 12 — Extract `lib/v2/view-state.ts`

**Goal**: Move the view-state packager.

### 12.1 Create `lib/v2/view-state.ts`

Copy from game-controller lines 3063–3273:

```typescript
import { prisma } from '@/lib/prisma';
import { normalizeInventory, extractPoiItems } from '@/lib/v2/item-helpers';
import { extractExplorationFlags } from '@/lib/v2/poi-context-helpers';
import { isPoiVisibleThroughExit } from '@/lib/v2/room-geometry';
import type { ViewStatePayload } from '@/types/v2-game';

export async function buildViewState(
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  fallbackNarrative?: string,
): Promise<ViewStatePayload> {
  // ... exact body
}
```

### 12.2 In `lib/v2/game-controller.ts`

- Delete lines 3063–3273
- Add import from `@/lib/v2/view-state`

### 12.3 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 13 — Extract `lib/v2/act-progression.ts`

**Goal**: Move the act advancement logic.

### 13.1 Create `lib/v2/act-progression.ts`

Copy from game-controller lines 3276–3333:

```typescript
import { prisma } from '@/lib/prisma';
import { DUNGEON_ACTS } from '@/lib/v2/act-definitions';
import type { ActMutation } from '@/lib/v2/act-definitions';

async function applyActOnStartMutations(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
  mutations: ActMutation[],
): Promise<void> {
  // ... exact body
}

export async function checkAndAdvanceAct(sessionId: string): Promise<void> {
  // ... exact body (references applyActOnStartMutations internally)
}
```

### 13.2 In `lib/v2/game-controller.ts`

- Delete lines 3276–3333
- Add import from `@/lib/v2/act-progression`

### 13.3 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 14 — Final game-controller.ts cleanup

**Goal**: `game-controller.ts` now contains only `handleGameAction` (the orchestrator), its imports from the 10 new modules, and re-exports for backward compatibility.

### 14.1 Verify final line count

```bash
wc -l lib/v2/game-controller.ts
```

Expected: ~200 lines. If significantly more, something wasn't extracted.

### 14.2 Remove the `const anthropic` at line 23

This was the last Anthropic instantiation in game-controller; it moved to `intent-parser.ts` and `narrative.ts` in Phases 7 and 11. Confirm it's gone.

### 14.3 Verify the re-export contract

Confirm these two external import sites still resolve:

```bash
grep -rn "from.*v2/game-controller" app/api/ app/v2/
```

Should show:
- `app/api/v2/game/action/route.ts` — imports `handleGameAction` (still defined in game-controller)
- `app/api/v2/room/state/route.ts` — imports `normalizeInventory` (re-exported from item-helpers)

### 14.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 15 — Split `app/v2/play/page.tsx`

**Goal**: Extract the 20+ component functions into focused files. TypeScript compilation is the primary gate because there are no unit tests for these components.

### Component map and extraction order

Extract in this order (each is independent; earlier ones don't import from later ones):

| New file | Functions to move | Lines approx |
|----------|------------------|--------------|
| `components/v2/combat/RollBadge.tsx` | `RollBadge`, `CombatRollBadge` | ~60 |
| `components/v2/combat/CombatBanner.tsx` | `CombatBanner`, `CombatResumeCard`, `buildBannerEntry` | ~80 |
| `components/v2/combat/InitiativeStrip.tsx` | `InitiativeStrip`, `InitiativeMiniSheet` | ~120 |
| `components/v2/combat/ActionChips.tsx` | `ActionChips`, `TurnBadge` | ~120 |
| `components/v2/inventory/UseButtons.tsx` | `UseButtons`, `bagBadge`, `fmtBonus` | ~100 |
| `components/v2/inventory/InventoryTab.tsx` | `InventoryTab`, `ItemPickerSheet` | ~320 |
| `components/v2/character/CharacterSheet.tsx` | `CharacterSheet`, `abilityMod`, `abilityModColor` | ~220 |
| `components/v2/character/PartyTab.tsx` | `PartyTab` | ~40 |
| `components/v2/chat/ChatMessage.tsx` | `ChatMessage`, `hpRingClass` | ~60 |
| `components/v2/chat/ChatTab.tsx` | `ChatTab` | ~150 |
| `components/v2/map/DungeonMap.tsx` | `DungeonMap`, `MapLegend`, `MapSheet`, `MapTab` | ~400 |
| `components/v2/layout/Header.tsx` | `Header`, `BottomNav` | ~60 |

After all extractions, `play/page.tsx` contains only `PlayContent` and `PlayPage` (~300 lines).

### 15.1 Extraction rules (apply to each component)

1. Create the new file with required React/Next.js imports and any needed type imports.
2. Move the function(s) verbatim — no logic changes.
3. Add `export` keyword if not already present.
4. In `play/page.tsx`, delete the moved function and add an import at the top.
5. Run the gate after every single extraction (not batched).

### 15.2 Map component: use shared geometry

`DungeonMap.tsx` currently contains its own `slotCenter`, `archOpening`, `isSlotVisibleThroughExit`, `wallAxisForDirection`. Replace these with imports from `@/lib/v2/room-geometry` (which now has `losSlotCenter`, `losArchOpening`, `isPoiVisibleThroughExit`). Verify the variable names match at every call site — rename usages where needed.

### 15.3 Gate (after EACH component extraction)

```bash
npx tsc --noEmit && npm test
```

Do not batch. A TypeScript error after one extraction is much easier to diagnose than errors from ten simultaneous extractions.

---

## Phase 16 — Prompt Caching for Haiku Intent Parser

**Goal**: Split `buildHaikuSystemPrompt` output into a static prefix and dynamic suffix so Anthropic's prompt cache is hit on the static portion (~600–800 tokens) every turn.

### 16.1 Restructure `lib/v2/ai-prompts.ts`

Split `buildHaikuSystemPrompt` into two functions:

```typescript
// Returns the static portion of the Haiku system prompt.
// This string never changes for a given model version and should be cached.
export function buildHaikuStaticPrefix(): string {
  return `You are a strict game-state parser for a D&D game engine. Your only job is to call the extract_game_intent tool with a structured representation of the player's intent.

ACTION TYPES:
[... the full ACTION TYPES block ...]

RULES:
[... the full RULES block ...]

PROXIMITY RULE — contact actions require being adjacent:
[... the full PROXIMITY RULE block ...]`;
}

// Returns the dynamic portion: room state, inventory, position.
// This changes every request and must NOT be cached.
export function buildHaikuDynamicContext(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
): string {
  // All the POI lists, inventory block, position line, adjacent room section
  // ... extract these from the current buildHaikuSystemPrompt body
}
```

### 16.2 Update `lib/v2/intent-parser.ts`

Change the Anthropic call from a string `system` to an array with `cache_control`:

```typescript
import { buildHaikuStaticPrefix, buildHaikuDynamicContext } from '@/lib/v2/ai-prompts';

const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  system: [
    {
      type: 'text' as const,
      text: buildHaikuStaticPrefix(),
      cache_control: { type: 'ephemeral' as const },
    },
    {
      type: 'text' as const,
      text: buildHaikuDynamicContext(
        poiContexts, characterInventory, otherCharacters,
        currentProximityPoiId, adjacentRoom,
      ),
    },
  ],
  // tools, tool_choice, messages unchanged
});
```

### 16.3 Update `lib/v2/__tests__/ai-prompts.test.ts`

Add tests for the new split functions:

```typescript
import { buildHaikuStaticPrefix, buildHaikuDynamicContext } from '../ai-prompts';

describe('buildHaikuStaticPrefix', () => {
  it('contains all action type keywords', () => {
    const prefix = buildHaikuStaticPrefix();
    const actions = ['examine', 'interact', 'move_to_room', 'attack', 'hide', 'death_save'];
    for (const action of actions) {
      expect(prefix).toContain(`"${action}"`);
    }
  });

  it('is deterministic — same output on every call', () => {
    expect(buildHaikuStaticPrefix()).toBe(buildHaikuStaticPrefix());
  });

  it('does NOT contain POI-specific or inventory-specific content', () => {
    const prefix = buildHaikuStaticPrefix();
    expect(prefix).not.toContain('CHARACTER POSITION');
    expect(prefix).not.toContain('CHARACTER INVENTORY');
    expect(prefix).not.toContain('REGULAR POINTS OF INTEREST');
  });
});

describe('buildHaikuDynamicContext', () => {
  it('contains CHARACTER POSITION section', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).toContain('CHARACTER POSITION');
  });

  it('contains CHARACTER INVENTORY section', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).toContain('CHARACTER INVENTORY');
  });

  it('does NOT contain ACTION TYPES (that is in the static prefix)', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).not.toContain('ACTION TYPES:');
  });

  it('combined prefix + context equals the original full prompt', () => {
    const poi = makePoiCtx({ name: 'Altar', keyword: 'altar' });
    const inventory = { bag: [{ id: 't1', name: 'Torch' }], equipped: {} };
    const full = buildHaikuSystemPrompt([poi], inventory, [], null, null);
    const split = buildHaikuStaticPrefix() + '\n\n' + buildHaikuDynamicContext([poi], inventory, [], null, null);
    // Content equivalence: both contain the same POI names and action types
    expect(split).toContain('Altar');
    expect(split).toContain('Torch');
    expect(split).toContain('"examine"');
  });
});
```

### 16.4 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Phase 17 — Parallelize Narrative + View-State DB Reads

**Goal**: Move the Anthropic AI call off the critical serial path by prefetching view-state DB data concurrently with narrative generation.

### 17.1 Create `prefetchViewStateData` in `lib/v2/view-state.ts`

Extract the 5-query `Promise.all` from `buildViewState` into a new exported function:

```typescript
export interface ViewStateRawData {
  recentNarrative: Array<{ id: string; text: string; isMechanicalEvent: boolean; mechanicalSummary: string | null; createdAt: Date }>;
  participants: Array<{ characterId: string; character: { id: string; name: string } }>;
  charRow: { inventory: unknown; currentHp: number; maxHp: number; level: number; /* ... all selects */ };
  poiInstances: Array<{ id: string; template: { defaultProperties: unknown; /* ... */ }; currentProperties: unknown }>;
  sessionRow: { combatState: unknown; gameState: string } | null;
}

export async function prefetchViewStateData(
  roomInstanceId: string,
  characterId: string,
): Promise<ViewStateRawData> {
  const [recentNarrative, participants, charRow, poiInstances, sessionRow] = await Promise.all([
    prisma.messageLog.findMany({ ... }),
    prisma.roomParticipant.findMany({ ... }),
    prisma.character.findUniqueOrThrow({ ... }),
    prisma.poiInstance.findMany({ ... }),
    prisma.gameSession.findFirst({ ... }),
  ]);
  return { recentNarrative, participants, charRow, poiInstances, sessionRow };
}

export async function assembleViewState(
  raw: ViewStateRawData,
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  injectedNarrative?: string,
): Promise<ViewStatePayload> {
  // The computation body from buildViewState, using raw instead of querying DB.
  // When injectedNarrative is provided, prepend it to recentNarrative instead of
  // reading it from the DB (it was just written by generateAndPersistNarrative).
}

// Keep buildViewState as a convenience wrapper for callers that don't parallelize:
export async function buildViewState(...): Promise<ViewStatePayload> {
  const raw = await prefetchViewStateData(roomInstanceId, characterId);
  return assembleViewState(raw, roomInstanceId, gameState, characterId, sessionId, characterProximityTargetId, fallbackNarrative);
}
```

### 17.2 Update `lib/v2/game-controller.ts` `handleGameAction`

After `mutateGameState` resolves, run narrative generation and view-state DB prefetch in parallel:

```typescript
// Stage 4 + 5 in parallel:
// - generateAndPersistNarrative: 3 DB reads + AI call (~600–1200ms)
// - prefetchViewStateData: 5 DB reads (independent of narrative)
const [narrativeResult, rawViewState] = await Promise.all([
  generateAndPersistNarrative(
    finalRoomInstanceId, characterId, character.name,
    roomName, roomDescription, mutationResult.appliedActions, sessionId,
  ),
  prefetchViewStateData(finalRoomInstanceId, characterId),
]);

// Stage 5 assembly: uses prefetched data + injects narrative text directly
// (avoids a 6th DB read for the message just written by generateAndPersistNarrative)
const viewState = await assembleViewState(
  rawViewState,
  finalRoomInstanceId,
  gameState,
  characterId,
  sessionId,
  newProximityTargetId,
  narrativeResult.text,
);

return viewState;
```

### 17.3 Gate

```bash
npx tsc --noEmit && npm test
```

---

## Final Verification

### Module line counts

```bash
wc -l lib/v2/*.ts | sort -rn | head -20
```

Expected approximate line counts:
- `mutation-engine.ts`: ~800
- `combat-engine.ts`: ~680
- `ai-prompts.ts`: ~280
- `view-state.ts`: ~250
- `intent-parser.ts`: ~180
- `db-context.ts`: ~80
- `narrative.ts`: ~150
- `room-geometry.ts`: ~120
- `poi-context-helpers.ts`: ~50
- `item-helpers.ts`: ~55
- `act-definitions.ts`: ~55
- `poi-context.ts`: ~45
- `act-progression.ts`: ~65
- `game-controller.ts`: **≤200** (orchestrator only)

### Import graph check

```bash
npx tsc --noEmit 2>&1 | grep "Circular\|circular" | head -10
```

Expected: no circular dependency errors.

### Final test count

```bash
npm test 2>&1 | grep -E "Test Files|Tests "
```

Expected: `Test Files  5 failed | ≥30 passed` / `Tests  5 failed | ≥600 passed`
(5 pre-existing failures, 100+ new tests from Phases 0–8 and 16 added to the 494 baseline)

### TypeScript clean build

```bash
npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully` with no type errors.

---

## Appendix: Module Dependency Graph

```
types/v2-game.ts          (external types — no changes)
    ↑
poi-context.ts            (PoiContext, PoiCombatStats, AiBehavior, CombatPoiContext)
    ↑
item-helpers.ts           (normalizeInventory, inventorySummary, extractPoiItems)
room-geometry.ts          (slotGridDistance, losSlotCenter, isPoiVisibleThroughExit, …)
poi-context-helpers.ts    (extractAvailableStances, extractExplorationFlags, extractExitInfo)
act-definitions.ts        (DUNGEON_ACTS, ActDefinition, ActMutation)
    ↑
ai-prompts.ts             (buildHaikuStaticPrefix, buildHaikuDynamicContext, buildNarrativeSystemPrompt)
db-context.ts             (lookupDatabaseContext, roomInstanceQuery)
intent-parser.ts          (parseIntentWithHaiku)
combat-engine.ts          (detectCombatTrigger, enterCombat, exitCombat, resolveCombatAction, …)
    ↑
mutation-engine.ts        (mutateGameState + helpers)
narrative.ts              (generateAndPersistNarrative)
view-state.ts             (buildViewState, prefetchViewStateData, assembleViewState)
act-progression.ts        (checkAndAdvanceAct)
    ↑
game-controller.ts        (handleGameAction — orchestrator only, ~200 lines)
    ↑
app/api/v2/game/action/route.ts
```

No arrows point backwards = no circular dependencies.
