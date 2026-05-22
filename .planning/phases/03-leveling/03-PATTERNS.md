# Phase 3: Leveling - Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 7 (2 new, 5 modified)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `lib/leveling.ts` | utility | transform | `lib/xp.ts` | exact |
| `lib/leveling.test.ts` | test | transform | `lib/xp.test.ts` | exact |
| `prisma/schema.prisma` | config | — | existing `Character` model | exact (additive) |
| `app/actions/create-character.ts` | service | CRUD | itself (edit) | exact |
| `app/actions/start-adventure.ts` | service | CRUD | itself (edit) | exact |
| `app/actions/take-turn.ts` | service | request-response | itself (edit) | exact |
| `app/game/[id]/page.tsx` | component | request-response | itself (edit — DiceCard pattern) | exact |

---

## Pattern Assignments

### `lib/leveling.ts` (utility, transform)

**Analog:** `lib/xp.ts`

**File header / module declaration** (`lib/xp.ts` lines 1–5):
```typescript
// ─── XP Engine ───────────────────────────────────────────────────────────────
// Pure TypeScript XP functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────
```
Replicate verbatim with "Leveling Engine" as the title.

**Imports pattern** — `lib/leveling.ts` imports from `lib/dice.ts` only (no Prisma, no Next.js):
```typescript
import { abilityModifier, proficiencyBonus } from "./dice";
export { proficiencyBonus };
```

**SCREAMING_SNAKE_CASE constant with JSDoc** (`lib/xp.ts` lines 7–19):
```typescript
// ─── XP Thresholds ───────────────────────────────────────────────────────────

/**
 * Cumulative XP required to reach each level tier.
 * Index 0 = level 1 start (0 XP). Index N = cumulative XP required for level N+1.
 * Source: REQUIREMENTS.md XP-02 (authoritative).
 * ...
 */
export const XP_THRESHOLDS: readonly number[] = [0, 300, 900, 2700, 6500];
```
Replicate for `HIT_DIE_BY_CLASS`, citing `REQUIREMENTS.md LVL-01` as the authoritative source.

**Core export function** (`lib/xp.ts` lines 38–58, `computeLevel`):
```typescript
/**
 * Compute the character level corresponding to a cumulative XP total.
 * ...
 * @param xp - Cumulative XP total (non-negative; ...)
 * @returns Level in the range [1, 5]
 */
export function computeLevel(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}
```
`maxHpAtLevel` uses the same JSDoc style (`@param` / `@returns`) and same iterative loop pattern.

**Error guard** — `lib/dice.ts` style: throw a descriptive `Error` on unknown input:
```typescript
// from lib/dice.ts (abilityModifier / rollDie — implicit guard on input type)
// Pattern: throw new Error(`Unknown class: ${characterClass}`) when
// HIT_DIE_BY_CLASS[characterClass] is undefined.
```

---

### `lib/leveling.test.ts` (test, transform)

**Analog:** `lib/xp.test.ts`

**File header and imports** (`lib/xp.test.ts` lines 1–8):
```typescript
// ─── XP Engine Unit Tests (XP-05) ────────────────────────────────────────────
// Tests all four exports of lib/xp.ts at boundary conditions.
// Covers all 10 required computeLevel threshold boundaries plus edge cases.
// Requires explicit vitest imports (globals: false in vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { computeLevel, xpForNextLevel, XP_THRESHOLDS, XP_BY_DIFFICULTY } from './xp'
```
Replace with leveling exports: `import { maxHpAtLevel, HIT_DIE_BY_CLASS } from './leveling'`
Note: `globals: false` is enforced by `vitest.config.ts` line 8 — explicit vitest imports are mandatory.

**describe/it structure** (`lib/xp.test.ts` lines 12–60):
```typescript
describe('computeLevel', () => {
  it('0 XP → level 1 (level 1 start, exactly at threshold[0])', () => {
    expect(computeLevel(0)).toBe(1)
  })
  // ...boundary case per threshold
})
```
Replicate: one `describe` block per function/constant (`maxHpAtLevel`, `HIT_DIE_BY_CLASS`), with `it` descriptions in `input → output (explanation)` format.

**Test run command** (from `vitest.config.ts` and RESEARCH.md):
```bash
npm run test:run -- lib/leveling.test.ts
```

---

### `prisma/schema.prisma` (config, additive)

**Analog:** existing `Character` model (`prisma/schema.prisma` lines 22–40)

**Existing column block to extend** (`prisma/schema.prisma` lines 28–38):
```prisma
  strength     Int @default(8)
  dexterity    Int @default(8)
  constitution Int @default(8)
  intelligence Int @default(8)
  wisdom       Int @default(8)
  charisma     Int @default(8)
  xp           Int @default(0)
  level        Int @default(1)
```
Add immediately after `level Int @default(1)`:
```prisma
  maxHp        Int @default(10)   // class-aware starting HP; backfill required for existing rows
```
`@default(10)` is a safe placeholder for migration (Fighter level-1 with CON 10 = 10 HP exactly). Backfill step follows migration.

**Separator style** — existing schema uses `// ─── Section ───` separators between model groups; no new separator needed for a single field addition.

---

### `app/actions/create-character.ts` (service, CRUD)

**Analog:** itself — surgical edit to `prisma.character.create` call

**Current import block** (`create-character.ts` lines 1–5):
```typescript
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
```
Add one import line:
```typescript
import { maxHpAtLevel } from "../../lib/leveling";
```

**Current `prisma.character.create` data block** (`create-character.ts` lines 59–71):
```typescript
    await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma,
      },
    });
```
Compute `maxHp` before the create call (not inline in the data object — cleaner):
```typescript
    const maxHp = maxHpAtLevel(characterClass, constitution, 1);
    await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma,
        maxHp,
      },
    });
```

**Error handling pattern** (`create-character.ts` lines 77–81 — unchanged):
```typescript
  } catch (error: any) {
    console.error("Database error:", error);
    return { success: false, error: error.message || "Failed to save character." };
  }
```
No change needed.

---

### `app/actions/start-adventure.ts` (service, CRUD)

**Analog:** itself — surgical one-line fix at line 49

**Current hardcoded HP line** (`start-adventure.ts` line 49):
```typescript
    const hp = 10 + Math.floor((member.character.constitution - 10) / 2);
```
Replace with:
```typescript
    const hp = member.character.maxHp;   // canonical, stored at character creation
```
No import needed (pure field read from Prisma-included character object).

**Existing `include` clause** (`start-adventure.ts` lines 13–17):
```typescript
    include: {
      character:    true,
      map:          true,
      partyMembers: { include: { character: true } },
    },
```
After `prisma generate`, `member.character.maxHp` will be present in the generated type automatically because `{ character: true }` is a full include. No select-field changes needed.

---

### `app/actions/take-turn.ts` (service, request-response)

**Analog:** itself — three surgical edits

**1. Import addition** (`take-turn.ts` lines 11–13):
```typescript
import { rollD20Check, abilityModifier } from "../../lib/dice";
import type { D20Result } from "../../lib/dice";
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
```
Add:
```typescript
import { maxHpAtLevel } from "../../lib/leveling";
```

**2. TurnResult interface extension** (`take-turn.ts` lines 166–175):
```typescript
interface TurnResult {
  success:     boolean;
  narrative?:  string;
  chips?:      string[];
  newState?:   Record<string, unknown>;
  error?:      string;
  diceResult?: D20Result;
  leveledUp?:  boolean;   // true if the character leveled up this turn
  newLevel?:   number;    // the new level value if leveledUp is true
}
```
Extend with the `LevelUpResult` interface and new field:
```typescript
interface LevelUpResult {
  oldLevel:         number;
  newLevel:         number;
  oldMaxHp:         number;
  newMaxHp:         number;
  proficiencyBonus: number;
}

interface TurnResult {
  success:         boolean;
  narrative?:      string;
  chips?:          string[];
  newState?:       Record<string, unknown>;
  error?:          string;
  diceResult?:     D20Result;
  leveledUp?:      boolean;   // keep for existing usage
  newLevel?:       number;    // keep for existing usage
  levelUpResult?:  LevelUpResult;  // NEW — full card data
}
```

**3. $transaction block extension** (`take-turn.ts` lines 323–339):
```typescript
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
      if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips },
      });
      await tx.game.update({
        where: { id: gameId },
        data:  { state: newState, currentTurnCharacterId: nextCharId, version: { increment: 1 } },
      });
      if (xpAwarded > 0 || didLevelUp) {
        await tx.character.update({
          where: { id: currentCharId },
          data:  { xp: currentXp, level: newLevel },
        });
      }
    });
```
Capture `oldMaxHp` BEFORE the transaction (read from `currentCharacter.maxHp` — available on the pre-fetched object), then extend the character update:
```typescript
      if (xpAwarded > 0 || didLevelUp) {
        const newMaxHp = didLevelUp
          ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
          : currentCharacter.maxHp;
        await tx.character.update({
          where: { id: currentCharId },
          data:  { xp: currentXp, level: newLevel, maxHp: newMaxHp },
        });
      }
```

**4. Return value extension** (`take-turn.ts` line 348):
```typescript
  return { success: true, narrative: parsed.narrative, chips: parsed.chips, newState, diceResult, leveledUp: didLevelUp, newLevel: didLevelUp ? newLevel : undefined };
```
Extend:
```typescript
  return {
    success:   true,
    narrative: parsed.narrative,
    chips:     parsed.chips,
    newState,
    diceResult,
    leveledUp: didLevelUp,
    newLevel:  didLevelUp ? newLevel : undefined,
    levelUpResult: didLevelUp ? {
      oldLevel:         previousLevel,
      newLevel,
      oldMaxHp:         currentCharacter.maxHp,
      newMaxHp:         maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel),
      proficiencyBonus: proficiencyBonus(newLevel),
    } : undefined,
  };
```
Note: `proficiencyBonus` must be imported from `lib/leveling.ts` (which re-exports it from `lib/dice.ts`), or imported directly from `lib/dice.ts`. Either is correct.

---

### `app/game/[id]/page.tsx` (component, request-response)

**Analog:** itself — DiceCard component (lines 469–505) and chip handler (lines 188–232)

**DiceCard component** (`page.tsx` lines 471–505) — exact visual pattern to replicate:
```typescript
// ─── Dice card ────────────────────────────────────────────────────────────────

function DiceCard({ result }: { result: D20Result }) {
  // ...outcome text logic...
  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
      <span className="text-base">🎲</span>
      <span className="font-mono text-slate-700">
        {result.roll} + {result.modifier} = {result.total}
      </span>
      <span className="text-slate-400">vs {result.dcType} {result.dc}</span>
      <span className={outcomeColor}>{outcomeText}</span>
    </div>
  );
}
```
`LevelUpCard` uses the same container `className` shape but `bg-indigo-50 border-indigo-200` instead of amber, and renders level/HP/proficiency fields instead of roll fields.

**DiceCard render location** (`page.tsx` lines 407–413) — exact slot to add LevelUpCard beside it:
```tsx
            {/* Dice card — ephemeral, above narrative, hidden while loading */}
            {isTakingTurn && (
              <div className="h-6 bg-amber-100 rounded animate-pulse" />
            )}
            {!isTakingTurn && diceResult && (
              <DiceCard result={diceResult} />
            )}
```
`LevelUpCard` renders in the same `space-y-2` block, directly below `DiceCard` (or first if no dice result):
```tsx
            {!isTakingTurn && levelUpResult && (
              <LevelUpCard result={levelUpResult} />
            )}
```

**State declaration pattern** (`page.tsx` line 127 — diceResult state):
```typescript
  const [diceResult, setDiceResult] = useState<D20Result | null>(null);
```
Add alongside it:
```typescript
  const [levelUpResult, setLevelUpResult] = useState<LevelUpResult | null>(null);
```

**Chip handler — clear + set on each turn** (`page.tsx` lines 188–231):
```typescript
  async function handleChipClick(chip: string) {
    if (isTakingTurn || isInitializing || !localState) return;
    setIsTakingTurn(true);
    setDiceResult(null);       // ← clear before each turn
    setTurnError(null);
    // ...
    if (result.success && result.narrative) {
      // ...
      setDiceResult(result.diceResult ?? null);   // ← set after success
    } else {
      setDiceResult(null);     // ← clear on failure too
    }
  }
```
Add parallel `setLevelUpResult(null)` at the clear points and `setLevelUpResult(result.levelUpResult ?? null)` at the set point.

**FieldTab props** (`page.tsx` lines 365–381) — `diceResult` prop pattern to replicate for `levelUpResult`:
```typescript
function FieldTab({
  // ...existing props...
  diceResult?:    D20Result | null;
  turnError?:     string | null;
}: {
  // ...
  diceResult?:    D20Result | null;
  turnError?:     string | null;
})
```
Add `levelUpResult?: LevelUpResult | null` in the same position.

**Import extension** (`page.tsx` lines 1–13 — add leveling type):
```typescript
import type { D20Result } from "../../../lib/dice";
```
Extend to also import the `LevelUpResult` type (defined locally in `take-turn.ts` — re-declare it in `page.tsx` or import from a shared types file if one is created):
```typescript
// Declare locally in page.tsx, matching take-turn.ts LevelUpResult shape:
interface LevelUpResult {
  oldLevel:         number;
  newLevel:         number;
  oldMaxHp:         number;
  newMaxHp:         number;
  proficiencyBonus: number;
}
```

**CharacterData interface** (`page.tsx` lines 32–44) — does NOT currently include `maxHp`; no change needed. LevelUpCard receives all data from the server action return value, not from CharacterData.

---

## Shared Patterns

### Pure Utility Module Structure
**Source:** `lib/xp.ts` and `lib/dice.ts`
**Apply to:** `lib/leveling.ts`

All pure utility modules in this project share:
1. `// ─── Module Name ───` header comment block (lines 1–5 of xp.ts)
2. Zero framework / Prisma imports at top level
3. SCREAMING_SNAKE_CASE module-level constants with JSDoc citing the authoritative source (`Source: REQUIREMENTS.md X-XX`)
4. `// ─── Section ───` separator style between logical groups
5. JSDoc `@param` / `@returns` on every exported function

### Auth Pattern (server actions)
**Source:** `app/actions/create-character.ts` lines 14–20, `app/actions/take-turn.ts` lines 180–183
**Apply to:** all server action files (no new server actions in Phase 3 — edits only)
```typescript
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { success: false, error: "Not authenticated." };
```

### Optimistic-Lock $transaction Pattern
**Source:** `app/actions/take-turn.ts` lines 323–346
**Apply to:** `take-turn.ts` (extended, not changed structurally)
```typescript
await prisma.$transaction(async (tx) => {
  const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
  if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");
  // ...writes...
});
```
The `maxHp` update goes INSIDE this transaction alongside the existing `character.update`.

### RULES_ENGINE_KEYS Allowlist
**Source:** `app/actions/take-turn.ts` line 299
**Apply to:** `take-turn.ts` (already in place — no change)
```typescript
const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
for (const key of RULES_ENGINE_KEYS) {
  delete deltas[key];
}
```
`maxHp` is already in this array. D-12 requirement is fully met.

### Vitest Test File Conventions
**Source:** `lib/xp.test.ts` lines 1–8, `lib/dice.test.ts` lines 1–14
**Apply to:** `lib/leveling.test.ts`
- Explicit vitest imports required (`globals: false` in `vitest.config.ts` line 8)
- `it()` descriptions use format: `'input → output (explanation)'`
- No `beforeEach`/`afterEach` — pure functions need no setup/teardown
- Injectable parameters avoid `vi.spyOn` or `vi.mock`

### Ephemeral Card Render Pattern
**Source:** `app/game/[id]/page.tsx` lines 407–413 (DiceCard slot)
**Apply to:** `app/game/[id]/page.tsx` (LevelUpCard addition)
```tsx
{/* Card — ephemeral, above narrative, hidden while loading */}
{isTakingTurn && (
  <div className="h-6 bg-amber-100 rounded animate-pulse" />
)}
{!isTakingTurn && diceResult && (
  <DiceCard result={diceResult} />
)}
```
Both DiceCard and LevelUpCard live in the `space-y-2` div inside the white narrative card. LevelUpCard is added in the same slot — clear on turn start, set on turn success, clear on turn failure.

---

## No Analog Found

All files have close analogs in the codebase. No entries.

---

## Metadata

**Analog search scope:** `lib/`, `app/actions/`, `app/game/[id]/`, `prisma/`
**Files scanned:** 10 (lib/xp.ts, lib/xp.test.ts, lib/dice.ts, lib/dice.test.ts, app/actions/take-turn.ts, app/actions/create-character.ts, app/actions/start-adventure.ts, app/game/[id]/page.tsx, prisma/schema.prisma, vitest.config.ts)
**Pattern extraction date:** 2026-05-22
