# Phase 3: Leveling — Research

**Researched:** 2026-05-22
**Domain:** D&D hit point / level progression math, Prisma 7 migration, server action transaction extension, React UI card pattern
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**maxHp Storage**
- D-01: Add `maxHp Int` column to the `Character` model via Prisma migration. Persistent and canonical — not recalculated per session.
- D-02: `create-character.ts` calls `maxHpAtLevel(characterClass, constitution, 1)` at character creation and stores the result in `character.maxHp`.
- D-03: `start-adventure.ts` reads `character.maxHp` directly from the DB — no recalculation at adventure start.
- D-04: `take-turn.ts` updates `character.maxHp` inside the `$transaction` when a level-up occurs; uses `maxHpAtLevel(class, con, newLevel)` as the new total, written alongside `character.level` and `character.xp`.

**Level-up HP Notification**
- D-05: New level-up info card in the chat UI, same visual pattern as the Phase 1 dice result card.
- D-06: Card content: old level → new level, old maxHp → new maxHp, proficiency bonus (show only if it changed — i.e., the level-5 transition from +2 to +3).
- D-07: `take-turn.ts` returns `levelUpResult: { oldLevel, newLevel, oldMaxHp, newMaxHp, proficiencyBonus }` in the server action response when a level-up occurs — same return-value pattern as `diceResult`. Client renders the card above the narrative.

**lib/leveling.ts Module**
- D-08: New pure module `lib/leveling.ts` — zero Prisma imports, zero framework dependencies, same pattern as `lib/dice.ts` and `lib/xp.ts`.
- D-09: Exports `maxHpAtLevel(characterClass: string, constitution: number, level: number): number`. Level 1 = max die + CON mod; levels 2–5 = prior total + average die + CON mod.
- D-10: Exports `HIT_DIE_BY_CLASS` constant: `{ Fighter: { die: 10, avg: 6 }, Rogue: { die: 8, avg: 5 }, Cleric: { die: 8, avg: 5 }, Wizard: { die: 6, avg: 4 } }`.
- D-11: Re-exports `proficiencyBonus` from `lib/dice.ts`. Phase 4 imports from `lib/leveling.ts` for all leveling math.

**stateDeltas Allowlist (LVL-04)**
- D-12: RULES_ENGINE_KEYS = `["hp", "maxHp", "xp", "level", "proficiencyBonus"]` already strips these keys silently in `take-turn.ts` (line 299). This requirement is largely already met. No additional validation needed.

### Claude's Discretion
- `levelUpNote` system prompt injection: continue injecting the narrative hook (Phase 2 D-06 pattern) even though a UI card now also shows the data. Card handles mechanical display; levelUpNote handles narrative momentum.
- Migration backfill: data migration for existing characters should compute the correct class HP using `maxHpAtLevel(class, con, character.level)` for each row.
- Multi-level-up HP: use `maxHpAtLevel(class, con, newLevel) - character.maxHp` as the HP delta rather than an intermediate loop — `maxHpAtLevel` is a total-HP function.

### Deferred Ideas (OUT OF SCOPE)
- Additional character classes beyond Fighter, Rogue, Cleric, Wizard
- Levels 6–20
- Ability Score Improvements at level 4
- Expertise (double proficiency for Rogue)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LVL-01 | `lib/leveling.ts` exports `maxHpAtLevel` and re-exports `proficiencyBonus`; `HIT_DIE_BY_CLASS` constant for all 4 classes | Pure module pattern verified from `lib/dice.ts` and `lib/xp.ts`; hit die values confirmed in REQUIREMENTS.md |
| LVL-02 | Level-up logic inside `take-turn` Prisma transaction; handles multi-level-up via loop; updates `character.level`, `character.maxHp`, `character.xp` | `$transaction` block at lines 324–340 in take-turn.ts is the exact extension point; existing `computeLevel` and `didLevelUp` logic already wired |
| LVL-03 | Character creation stores class-correct starting max HP instead of hardcoded 10 | `create-character.ts` currently stores no `maxHp` field — after migration, must call `maxHpAtLevel(class, con, 1)` and write to new column |
| LVL-04 | `stateDeltas` allowlist rejects `hp`, `maxHp`, `xp`, `level` from Claude | Already implemented at line 299 of `take-turn.ts`; `maxHp` already in the array; requirement is fully met |
| LVL-05 | Unit tests for `maxHpAtLevel` (all 4 classes × levels 1–5 × 3 CON edge cases) and multi-level-up path | Test file `lib/leveling.test.ts` does not exist yet — Wave 0 gap |
</phase_requirements>

---

## Summary

This phase adds automatic HP-aware leveling to the game loop. The scope is narrow and the codebase already has 80% of the scaffolding in place from Phase 2. The main new artifact is `lib/leveling.ts` — a pure math module that computes class-correct max HP. Four existing files require surgical edits: `prisma/schema.prisma` (add column), `create-character.ts` (store initial maxHp), `start-adventure.ts` (read from DB instead of hardcoded formula), and `take-turn.ts` (extend the transaction and return shape).

The Prisma migration situation requires attention: the project currently uses `prisma db push` (no migrations directory exists). The additional context states this phase requires `npx prisma migrate dev`. This means the migration must be performed first — the schema edit happens before any other code changes, and existing characters need a backfill for the new `maxHp` column.

The level-up UI card is a direct clone of the existing `DiceCard` component pattern. The `TurnResult` return type in `take-turn.ts` already has `leveledUp` and `newLevel` but lacks the full `levelUpResult` shape specified in D-07 — that interface needs to be extended.

**Primary recommendation:** Build in four sequential slices — (1) schema migration + `lib/leveling.ts`, (2) character creation and adventure start fixes, (3) take-turn transaction extension + return shape, (4) UI card rendering. Each slice is independently testable.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HP formula math | Pure lib (no tier) | — | Zero-dependency function; must be testable without DB or framework |
| Schema migration | Database | — | `maxHp Int` is a persistent canonical column — lives in Prisma schema |
| Level-up computation | API / Backend (server action) | — | Code owns all mechanical values; Claude cannot touch them |
| stateDeltas allowlist | API / Backend (server action) | — | Enforced server-side at line 299 of take-turn.ts; already in place |
| Level-up card rendering | Browser / Client | — | React component in game page; same layer as DiceCard |
| maxHp persistence at creation | API / Backend (server action) | Database | create-character.ts writes to DB |
| maxHp at adventure start | API / Backend (server action) | Database | start-adventure.ts reads from DB instead of computing |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 7.8.0 [VERIFIED: npm registry] | Schema migration, ORM | Already in use; `npx prisma migrate dev` adds the `maxHp` column |
| TypeScript | 5.x [VERIFIED: project tsconfig] | All application code | Project standard |
| Vitest | installed [VERIFIED: vitest.config.ts exists] | Unit tests for `lib/leveling.ts` | Project test framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lib/dice.ts` (internal) | — | `abilityModifier`, `proficiencyBonus` | `maxHpAtLevel` imports `abilityModifier`; re-exports `proficiencyBonus` |
| `lib/xp.ts` (internal) | — | Module pattern reference | `lib/leveling.ts` replicates this exact structure |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npx prisma migrate dev` | `prisma db push` | `migrate dev` creates a migration file and history — safer for additive changes; `db push` already used for previous schema changes but per CLAUDE.md, `migrate dev` is the correct approach for schema changes |

**Installation:** No new npm packages required for this phase. All dependencies already installed.

---

## Package Legitimacy Audit

No external packages are installed in this phase. All additions are internal TypeScript modules and a Prisma schema column.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Character Creation Request
         │
         ▼
  create-character.ts
  maxHpAtLevel(class, con, 1) ──────► lib/leveling.ts
         │                            HIT_DIE_BY_CLASS[class].die
         │                            + abilityModifier(con)
         ▼
  prisma.character.create({ maxHp })
         │
         ▼
  PostgreSQL: Character.maxHp = N

Player Take Turn
         │
         ▼
  take-turn.ts
  XP award + computeLevel()
  if didLevelUp:
    newMaxHp = maxHpAtLevel(class, con, newLevel) ─► lib/leveling.ts
         │
         ▼
  $transaction:
    tx.character.update({ xp, level, maxHp })
    tx.game.update({ state, version++ })
         │
         ▼
  return { ..., levelUpResult: { oldLevel, newLevel, oldMaxHp, newMaxHp, proficiencyBonus } }
         │
         ▼
  app/game/[id]/page.tsx
  LevelUpCard rendered above narrative (same slot as DiceCard)

Start Adventure
         │
         ▼
  start-adventure.ts
  member.character.maxHp ──────────► PostgreSQL read (was hardcoded 10 + conMod)
  partyMaxHp[characterId] = member.character.maxHp
```

### Recommended Project Structure
```
lib/
├── dice.ts           # existing — abilityModifier, proficiencyBonus (re-exported by leveling.ts)
├── dice.test.ts      # existing
├── leveling.ts       # NEW — HIT_DIE_BY_CLASS, maxHpAtLevel, re-export proficiencyBonus
├── leveling.test.ts  # NEW — LVL-05 unit tests
├── xp.ts             # existing — reference pattern for leveling.ts module structure
└── xp.test.ts        # existing — reference pattern for leveling.test.ts structure

app/actions/
├── create-character.ts   # EDIT — import maxHpAtLevel, add maxHp to character.create
├── start-adventure.ts    # EDIT — read character.maxHp from DB, add maxHp to character select
└── take-turn.ts          # EDIT — extend $transaction + TurnResult interface

app/game/[id]/page.tsx    # EDIT — add LevelUpCard component, wire levelUpResult state

prisma/schema.prisma      # EDIT — add maxHp Int to Character model
```

### Pattern 1: Pure Utility Module (lib/leveling.ts)

**What:** Zero-dependency TypeScript module — no Prisma, no Next.js, no framework imports.
**When to use:** All leveling math. Imported by server actions; tested by Vitest without any mocks.

**Example (replicate from lib/xp.ts and lib/dice.ts):**
```typescript
// Source: lib/xp.ts (existing pattern) + CONTEXT.md D-09/D-10
// ─── Hit Die Table ────────────────────────────────────────────────────────────
/**
 * Class hit dice per D&D Basic Rules 2014 (levels 1–5 scope).
 * die  = face value (rolled at level 1 for max HP).
 * avg  = fixed average used for all subsequent level-ups.
 * Source: REQUIREMENTS.md LVL-01.
 */
export const HIT_DIE_BY_CLASS: Record<string, { die: number; avg: number }> = {
  Fighter: { die: 10, avg: 6 },
  Rogue:   { die: 8,  avg: 5 },
  Cleric:  { die: 8,  avg: 5 },
  Wizard:  { die: 6,  avg: 4 },
};

import { abilityModifier, proficiencyBonus } from "./dice";
export { proficiencyBonus };

export function maxHpAtLevel(
  characterClass: string,
  constitution: number,
  level: number,
): number {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  const conMod = abilityModifier(constitution);
  // Level 1: max die face (not average)
  let hp = hitDie.die + conMod;
  // Levels 2–N: add average die + CON mod per level
  for (let l = 2; l <= level; l++) {
    hp += hitDie.avg + conMod;
  }
  return hp;
}
```

### Pattern 2: Extending the $transaction in take-turn.ts

**What:** Add `character.maxHp` update to the existing transaction block.
**When to use:** Any level-up turn.

```typescript
// Source: take-turn.ts lines 324–340 (existing pattern)
// Inside $transaction:
if (xpAwarded > 0 || didLevelUp) {
  const newMaxHp = didLevelUp
    ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
    : currentCharacter.maxHp;   // no change if no level-up
  await tx.character.update({
    where: { id: currentCharId },
    data:  { xp: currentXp, level: newLevel, maxHp: newMaxHp },
  });
}
```

**Note:** The `oldMaxHp` for the `levelUpResult` return value must be captured BEFORE the transaction writes — read `currentCharacter.maxHp` (the pre-turn value).

### Pattern 3: LevelUpCard Component (UI)

**What:** Info card displayed above the narrative in the Field tab when a level-up occurs.
**When to use:** When `levelUpResult` is non-null in the server action response.

```typescript
// Source: DiceCard component in app/game/[id]/page.tsx lines 471–505 (exact visual pattern)
// Rendered in the same space as DiceCard — both ephemeral, above situationText.

interface LevelUpResult {
  oldLevel:        number;
  newLevel:        number;
  oldMaxHp:        number;
  newMaxHp:        number;
  proficiencyBonus: number;
}

function LevelUpCard({ result }: { result: LevelUpResult }) {
  const profChanged = result.newLevel === 5; // only level-5 changes proficiency bonus
  return (
    <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm">
      <span className="text-base">⬆</span>
      <span className="font-semibold text-indigo-700">
        Level {result.oldLevel} → {result.newLevel}
      </span>
      <span className="text-slate-500">
        Max HP: {result.oldMaxHp} → {result.newMaxHp}
      </span>
      {profChanged && (
        <span className="text-slate-500">
          Proficiency Bonus: +{result.proficiencyBonus}
        </span>
      )}
    </div>
  );
}
```

### Pattern 4: Prisma Migration (adding maxHp column)

**What:** Add `maxHp Int` to the `Character` model, then run `npx prisma migrate dev`.
**When to use:** First task in Wave 1.

**Important — no migrations directory exists:** The project has been using `prisma db push` (no `prisma/migrations/` folder). Running `prisma migrate dev` for the first time will create the migrations directory and baseline the current schema, then apply the new column as a migration. This is the correct flow per CLAUDE.md.

**Migration workflow:**
```bash
# 1. Edit prisma/schema.prisma: add maxHp Int to Character model
# 2. Run migration (creates prisma/migrations/ on first run)
npx prisma migrate dev --name add-character-max-hp
# 3. Regenerate client (postinstall does this automatically but explicit is safe)
npx prisma generate
```

**Backfill consideration:** Existing characters created before this column will get a default. Because no `@default(N)` is specified in the schema addition, Prisma migrate dev will prompt for a default value or fail on non-nullable columns with existing rows. Two valid approaches:
1. Add `@default(10)` in schema (safe, but wrong for Rogues/Wizards) — then a backfill migration corrects each row to its true class-correct value using `maxHpAtLevel(class, con, level)`
2. Add `@default(10)` temporarily, then run a post-migration Prisma update in a separate seed/backfill script

Per Claude's Discretion in CONTEXT.md, backfill should compute correct class HP. This means the migration should use `@default(10)` (valid for Fighters and as a safe placeholder) and then a separate backfill step updates each existing Character row.

### Anti-Patterns to Avoid
- **Hardcoded HP arithmetic in server actions:** Never write `10 + conMod` or `8 + conMod` directly in action files. Always call `maxHpAtLevel` — it owns the formula.
- **Reading character.maxHp before migration column exists:** The `start-adventure.ts` edit must include `maxHp` in the `character` select clause. If the select omits it, the field will be undefined at runtime.
- **Capturing oldMaxHp inside the transaction:** Read `currentCharacter.maxHp` (the object fetched before the transaction begins) — it holds the pre-update value. Do not try to re-read it inside the `$transaction` callback.
- **Forgetting to clear levelUpResult between turns:** The `levelUpResult` state should be cleared on each new turn start (same as `diceResult` is cleared via `setDiceResult(null)` before `takeTurn` is called).
- **Returning levelUpResult on non-level-up turns:** The field should be `undefined` (not `null`) on turns without a level-up so that the client's truthiness check works cleanly: `if (result.levelUpResult)`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CON modifier formula | Custom `Math.floor((con - 10) / 2)` inline | `abilityModifier(constitution)` from `lib/dice.ts` | Already implemented and tested; consistency |
| Level-to-proficiency mapping | Inline `if level >= 5 return 3` | `proficiencyBonus(level)` from `lib/dice.ts` (re-exported by `lib/leveling.ts`) | Tested in DICE-05; single source of truth |
| XP threshold lookup | Inline threshold numbers | `computeLevel()` from `lib/xp.ts` (already called in take-turn.ts) | Already wired; don't duplicate |
| Hit die average lookup | Magic numbers inline | `HIT_DIE_BY_CLASS[class].avg` | Constants are exported precisely so tests can verify exact values |

**Key insight:** The entire mechanical computation chain is already modular. Phase 3 adds one new module (`lib/leveling.ts`) and wires it into three existing call sites. The goal is surgical, not architectural.

---

## Common Pitfalls

### Pitfall 1: character select missing maxHp in start-adventure.ts

**What goes wrong:** After migration, `member.character.maxHp` is `undefined` at runtime because the Prisma query's `include: { character: true }` does not auto-include new columns until the client is regenerated — and more critically, if the column is excluded from a `select`, it returns undefined.
**Why it happens:** The current `start-adventure.ts` includes `{ character: true }` (full include, no explicit select), so after regenerating the Prisma client, `member.character.maxHp` will be present. However, `get-game.ts` or other query shapes that use explicit `select` may omit the new column.
**How to avoid:** After running the migration and `prisma generate`, verify all call sites that read `character.maxHp` use either a full include or an explicit select that names `maxHp`.
**Warning signs:** TypeScript will error on `character.maxHp` if the generated Prisma type doesn't include it — a TypeScript error here is a correct signal that the client needs regeneration.

### Pitfall 2: Multi-level-up HP delta undercount

**What goes wrong:** Computing HP gain as `(newLevel - oldLevel) * (hitDie.avg + conMod)` rather than using `maxHpAtLevel(class, con, newLevel)` as the total. These produce the same result for a clean 1-level jump, but `maxHpAtLevel` is the single source of truth for the total — using it avoids floating-point or rounding inconsistencies and stays correct if the formula ever changes.
**Why it happens:** The loop approach feels natural but requires independent knowledge of the per-level increment formula.
**How to avoid:** Always call `maxHpAtLevel(class, con, newLevel)` and write that value as the new total. The delta is `newMaxHp - currentCharacter.maxHp` for game state updates.
**Warning signs:** Tests for multi-level-up paths (required in LVL-05) will catch this.

### Pitfall 3: levelUpResult shape mismatch between server action and client

**What goes wrong:** The existing `TurnResult` interface in `take-turn.ts` has `leveledUp?: boolean` and `newLevel?: number` (lines 174–175). Phase 3 replaces/extends this with `levelUpResult?: LevelUpResult`. If the client still checks `result.leveledUp` and the server now returns `result.levelUpResult`, the card never renders.
**Why it happens:** The existing Phase 2 return shape is partial — it carried forward the minimum needed and deferred the UI card to Phase 3.
**How to avoid:** Update both the `TurnResult` interface in `take-turn.ts` and the client-side handler in `page.tsx` together, in the same task. Add `levelUpResult` as the canonical field; keep `leveledUp` only if other code paths depend on it.
**Warning signs:** Card never appears after a level-up; check the server response shape in the browser network tab.

### Pitfall 4: Unknown class in HIT_DIE_BY_CLASS

**What goes wrong:** `maxHpAtLevel` is called with a `characterClass` string that is not one of the four supported classes (typo, new class, empty string).
**Why it happens:** `character.characterClass` is a free-text column — there is no enum constraint at the DB level.
**How to avoid:** `maxHpAtLevel` should throw a descriptive error on unknown class (e.g., `throw new Error(\`Unknown class: \${characterClass}\`)`). This surfaces the error immediately rather than silently returning NaN or 0.
**Warning signs:** LVL-05 tests should include an unknown-class case; TypeScript strict mode will catch it if `HIT_DIE_BY_CLASS[characterClass]` is accessed on the result.

### Pitfall 5: First-ever prisma migrate dev overwrites push history

**What goes wrong:** Running `prisma migrate dev` on a project that used `prisma db push` previously requires a baselining step. Without it, Prisma may try to replay the existing schema as a "new" migration and fail.
**Why it happens:** `migrate dev` tracks applied migrations in a `_prisma_migrations` table. A `db push` project has no such history. The first `migrate dev` run will create a baseline migration representing the current schema state.
**How to avoid:** The Phase 2 XP-01 requirement already noted "migration is applied cleanly after baselining the existing pushed schema" — XP-01 is marked complete, meaning this baselining was done for Phase 2. Phase 3's `migrate dev` call should work cleanly as a follow-on migration, not a first-ever migration.
**Warning signs:** Check whether `prisma/migrations/` was created during Phase 2 execution. If it exists, Phase 3 is a normal incremental migration. If it doesn't exist (as the current `ls prisma/` shows), the first `migrate dev` in this project is happening in Phase 3.

---

## Code Examples

### Exact formula: maxHpAtLevel
```typescript
// Source: CONTEXT.md specifics section + REQUIREMENTS.md LVL-01
// Level 1: die face (max, not average) + CON mod
// Level N > 1: previous total + average die + CON mod (recursive / iterative)
//
// Example — Fighter, CON 14 (mod +2):
//   Level 1: 10 + 2 = 12
//   Level 2: 12 + 6 + 2 = 20
//   Level 3: 20 + 6 + 2 = 28
//   Level 4: 28 + 6 + 2 = 36
//   Level 5: 36 + 6 + 2 = 44
//
// Example — Wizard, CON 8 (mod -1):
//   Level 1: 6 + (-1) = 5
//   Level 2: 5 + 4 + (-1) = 8
//   Level 3: 8 + 4 + (-1) = 11
```

### TurnResult interface extension
```typescript
// Source: take-turn.ts lines 166–175 (existing) + CONTEXT.md D-07
interface LevelUpResult {
  oldLevel:        number;
  newLevel:        number;
  oldMaxHp:        number;
  newMaxHp:        number;
  proficiencyBonus: number;
}

interface TurnResult {
  success:          boolean;
  narrative?:       string;
  chips?:           string[];
  newState?:        Record<string, unknown>;
  error?:           string;
  diceResult?:      D20Result;
  leveledUp?:       boolean;   // keep for backwards compat if needed
  newLevel?:        number;    // keep for backwards compat if needed
  levelUpResult?:   LevelUpResult;  // NEW — full card data
}
```

### start-adventure.ts fix (line 49)
```typescript
// Source: start-adventure.ts line 49 (current) — BEFORE
const hp = 10 + Math.floor((member.character.constitution - 10) / 2);

// AFTER — reads canonical value from DB
const hp    = member.character.maxHp;   // canonical, stored at character creation
const maxHp = member.character.maxHp;
```

### Schema addition
```prisma
// Source: prisma/schema.prisma — Character model
model Character {
  // ... existing fields ...
  xp           Int @default(0)
  level        Int @default(1)
  maxHp        Int @default(10)   // NEW — class-aware starting HP (backfill required for existing rows)
  // ... rest of model ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `10 + conMod` everywhere | `maxHpAtLevel(class, con, level)` via `lib/leveling.ts` | Phase 3 | Correct HP for all 4 classes; single source of truth |
| `character.maxHp` recalculated at adventure start | Read from canonical DB column | Phase 3 | Persistent max HP survives level-ups across sessions |
| `TurnResult.leveledUp: boolean` only | `TurnResult.levelUpResult: LevelUpResult` | Phase 3 | Full card data for UI rendering |

**Deprecated/outdated after this phase:**
- `10 + conMod` inline formula in `start-adventure.ts` line 49: replaced by `member.character.maxHp`
- `TurnResult.leveledUp` and `TurnResult.newLevel` fields: superseded by `levelUpResult`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@default(10)` is a safe temporary default for the migration (handles existing rows without erroring) | Schema addition code example | If existing characters have `NULL` after migration, `maxHp` reads will break until backfill runs — medium risk |
| A2 | Phase 2 XP-01 "baselining the existing pushed schema" created a `prisma/migrations/` directory | Pitfall 5 | If migrations dir doesn't exist, Phase 3 is the first `migrate dev` and needs explicit baselining — see Pitfall 5 |
| A3 | `CharacterData` interface in `app/game/[id]/page.tsx` does not currently include `maxHp` | UI integration | If it does, the `LevelUpCard` wiring is simpler; if not, the interface needs extending (LOW risk — confirmed by reading page.tsx lines 32–44) |

**Note on A3:** Verified by reading the file — `CharacterData` interface at line 32–44 does NOT include `maxHp`. The field is read from `localState.maxHp` (game state) rather than the character object in the game page. The `LevelUpCard` receives its data from the server action return value, not from `CharacterData`, so this is not a blocker.

---

## Open Questions

1. **Does prisma/migrations/ exist on the live database?**
   - What we know: `ls prisma/` shows only `schema.prisma` and `seed.mjs` — no migrations directory in the repo
   - What's unclear: Whether `prisma migrate dev` was run but `.gitignore` excludes the migrations folder, or whether migrations were truly never used
   - Recommendation: The plan's Wave 0 (schema migration task) should check for `prisma/migrations/` before running. If absent, it's a first-ever `migrate dev` and Prisma will create and baseline it automatically. This is expected and safe — the task should proceed.

2. **Default value for existing Character rows**
   - What we know: `maxHp Int` without `@default` will fail Prisma migrate on a non-empty table
   - What's unclear: How many existing characters are in the database (could be 0 in dev)
   - Recommendation: Use `@default(10)` in the schema (safe placeholder) and add a backfill step that updates all rows using `maxHpAtLevel(characterClass, constitution, level)` for each row. Backfill runs immediately after `npx prisma generate`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Prisma CLI | Schema migration | Yes | 7.8.0 | — |
| Node.js | All server-side code | Yes | 24.15.0 | — |
| Vitest | LVL-05 unit tests | Yes (vitest.config.ts present) | installed | — |
| PostgreSQL (Neon) | Migration apply | Yes (Neon remote) | n/a | — |

**Missing dependencies with no fallback:** none

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (globals: false) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm run test:run -- lib/leveling.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LVL-01 | `maxHpAtLevel` returns correct values for all 4 classes at levels 1–5 | unit | `npm run test:run -- lib/leveling.test.ts` | No — Wave 0 gap |
| LVL-01 | `HIT_DIE_BY_CLASS` has correct die/avg values for Fighter, Rogue, Cleric, Wizard | unit | `npm run test:run -- lib/leveling.test.ts` | No — Wave 0 gap |
| LVL-02 | Multi-level-up path: XP jump from 0 to 6500 processes 4 level-ups and correct maxHp delta | unit | `npm run test:run -- lib/leveling.test.ts` | No — Wave 0 gap |
| LVL-03 | Character creation stores class-correct maxHp (implicit via LVL-01 test — manual verify) | manual | — | N/A |
| LVL-04 | stateDeltas allowlist already tested by existing behavior; no new test needed | n/a | — | N/A |
| LVL-05 | Edge-case CON modifiers: −2 (CON 6), 0 (CON 10), +3 (CON 16) at levels 1–5 for all classes | unit | `npm run test:run -- lib/leveling.test.ts` | No — Wave 0 gap |

### Sampling Rate
- **Per task commit:** `npm run test:run -- lib/leveling.test.ts`
- **Per wave merge:** `npm run test:run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `lib/leveling.test.ts` — covers LVL-01, LVL-02, LVL-05
- [ ] Framework: already installed (vitest.config.ts exists, dice.test.ts and xp.test.ts passing)

*(No framework installation needed — gap is test file only)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `characterClass` string must match a known class in `HIT_DIE_BY_CLASS` — throw on unknown |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Claude injecting mechanical values via stateDeltas | Tampering | RULES_ENGINE_KEYS allowlist at take-turn.ts line 299 — already implemented; `maxHp` already in array (D-12 confirmed) |
| Invalid characterClass string causing NaN HP | Tampering | `maxHpAtLevel` throws on unknown class; character creation validates class server-side |

---

## Sources

### Primary (HIGH confidence)
- `lib/dice.ts` — exact module pattern replicated for `lib/leveling.ts`; `abilityModifier` and `proficiencyBonus` signatures confirmed
- `lib/xp.ts` — exact module structure, SCREAMING_SNAKE_CASE constants, JSDoc pattern, zero-import rule confirmed
- `app/actions/take-turn.ts` — `$transaction` block (lines 324–340), `TurnResult` interface (lines 166–175), `RULES_ENGINE_KEYS` (line 299), `diceResult` return pattern confirmed
- `app/actions/create-character.ts` — current absence of `maxHp` field confirmed
- `app/actions/start-adventure.ts` — hardcoded `10 + conMod` at line 49 confirmed
- `app/game/[id]/page.tsx` — `DiceCard` pattern (lines 471–505), `CharacterData` interface (lines 32–44) confirmed
- `prisma/schema.prisma` — Character model columns confirmed; `maxHp` absent
- `.planning/phases/03-leveling/03-CONTEXT.md` — all locked decisions (D-01 through D-12)
- `vitest.config.ts` — `globals: false`, test pattern, exclude list confirmed
- `prisma/schema.prisma` — no migrations directory confirmed via `ls prisma/`

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md LVL-01 — hit die values: Fighter d10/avg6, Rogue d8/avg5, Cleric d8/avg5, Wizard d6/avg4 [CITED: REQUIREMENTS.md — authoritative for this project]
- Prisma 7.8.0 `migrate dev` behavior on first run (no existing migrations directory) [ASSUMED — based on Prisma docs knowledge, not verified against live Prisma 7 docs in this session]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from existing project files
- Architecture: HIGH — all integration points verified by reading source files directly
- Pitfalls: HIGH — pitfalls derived from direct code inspection, not assumptions
- Migration approach: MEDIUM — Prisma `migrate dev` first-run behavior is assumed, not verified against live Prisma 7 docs

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (stable stack; valid until Prisma 7 breaks compatibility)
