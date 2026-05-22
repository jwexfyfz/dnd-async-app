# Architecture Research: Dice Engine + Game State

**Project:** Async AI D&D Web App
**Researched:** 2026-05-21
**Confidence:** HIGH — based on direct codebase inspection of take-turn.ts, schema.prisma, and the existing server action pattern

---

## Dice Engine Module Design

**Recommendation: `lib/dice.ts` — a plain TypeScript module with no framework dependencies.**

### Where It Lives

```
lib/
  dice.ts          ← pure functions, zero side effects
  dice.test.ts     ← Vitest unit tests co-located (or tests/dice.test.ts)
```

Do not create a separate npm package. The codebase is a Next.js monolith with no mono-repo structure; a package would add build complexity with zero benefit at this scale.

### What It Exports

```typescript
// lib/dice.ts

/** Roll a single die with n sides. Returns 1–n. */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/** Roll XdY and return individual results + total. */
export function rollDice(count: number, sides: number): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

/** Standard D&D ability modifier: floor((score - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Roll d20 + modifier vs a DC. Returns full audit trail. */
export interface D20Result {
  roll: number;          // raw d20 face value (1–20)
  modifier: number;      // applied modifier
  total: number;         // roll + modifier
  dc: number;            // difficulty class being checked against
  success: boolean;      // total >= dc
  critical: boolean;     // roll === 20
  fumble: boolean;       // roll === 1
}

export function rollD20Check(modifier: number, dc: number): D20Result {
  const roll = rollDie(20);
  const total = roll + modifier;
  return {
    roll,
    modifier,
    total,
    dc,
    success: total >= dc,
    critical: roll === 20,
    fumble: roll === 1,
  };
}

/** Proficiency bonus by level (D&D Basic Rules 2014, levels 1–5). */
export function proficiencyBonus(level: number): number {
  if (level <= 4) return 2;
  return 3; // level 5
}
```

### How It Is Called

`take-turn.ts` parses Claude's detected skill/action type from the JSON command, then calls `rollD20Check` **before** the narration call. The result object is injected into the narration prompt — Claude sees the outcome, not the roll request.

The module must never be called from client components. It uses `Math.random()` (sufficient for game use; no cryptographic randomness needed). Tests mock `Math.random` via `vi.spyOn` to produce deterministic outcomes.

---

## XP Storage Decision

**Recommendation: Dedicated columns on the `Character` model, not the `Game.state` JSON blob.**

### Rationale

| Concern | Column approach | JSON blob approach |
|---|---|---|
| Query efficiency | `WHERE xp >= threshold` is a native SQL comparison with an index | Requires `->>'xp'` JSON path extraction; unindexable without a generated column |
| Schema clarity | `xp INT`, `level INT` are self-documenting, type-safe in Prisma | Blob shape is implicit; easy to drift across games |
| Cross-game persistence | XP is a character property that persists beyond individual games | Blob is wiped/reset per game by design |
| Level-up detection | `character.xp` is always current and authoritative | Would need to reconcile blob vs character state |
| Prisma type safety | Generated types enforce `Int`; Prisma catches null | `(game.state as any).xp` — TypeScript can't verify |

XP and level belong to the `Character`, not the `Game`. A character carries their XP and level from game to game. The `Game.state` blob is already documented as world state (positions, HP, inventory, plot flags) — not character advancement.

### Required Migration

```prisma
model Character {
  // ... existing fields ...
  xp    Int @default(0)
  level Int @default(1)
}
```

HP (max HP) is currently computed at game-start as `10 + conModifier` and stored in the `Game.state` blob. After leveling is introduced, `maxHp` needs to be recalculated at level-up and stored on `Character` as well, so the game-start code can read it authoritatively rather than recomputing it.

---

## Atomic State Update Pattern

**Recommendation: Prisma interactive transaction with a stale-state guard.**

### The Current Problem

`take-turn.ts` lines 225–233 use `Promise.all([message.create, game.update])`. This is non-atomic. Between the game state read (line 122) and the write (line 229), a concurrent submission can overwrite HP or turn order with stale data. `Promise.all` does not open a DB transaction — it fires two independent queries in parallel.

### The Fix: Interactive Transaction + Optimistic Version Check

PostgreSQL's `serializable` isolation is overkill for this access pattern. The correct approach is:

1. Add a `version` integer column to `Game` (optimistic locking sentinel).
2. Wrap the read-mutate-write cycle in `prisma.$transaction(async (tx) => { ... })`.
3. Inside the transaction, re-read the game row and assert `game.version === expectedVersion` before writing.
4. If versions diverge, throw — Prisma rolls back and the caller returns `"concurrent update, retry"`.

```typescript
// Pattern inside take-turn.ts (after AI narration completes)

await prisma.$transaction(async (tx) => {
  // Re-read inside the transaction to get the lock.
  const current = await tx.game.findUnique({
    where: { id: gameId },
    select: { version: true, state: true, currentTurnCharacterId: true },
  });

  // Stale-state guard: reject if another write beat us here.
  if (!current || current.version !== expectedVersion) {
    throw new Error("STALE_TURN");
  }

  await tx.message.create({
    data: { gameId, role: "DUNGEON_MASTER", content: narrative, chips },
  });

  await tx.game.update({
    where: { id: gameId },
    data: { state: newState, currentTurnCharacterId: nextCharId, version: { increment: 1 } },
  });
});
```

**Why not `$transaction([op1, op2])`** (the sequential array form)? The array form does not give you a re-read inside the transaction — you cannot gate on stale version. Interactive transactions (`async (tx) => { ... }`) give full control and are the correct primitive here.

**Required schema addition:**

```prisma
model Game {
  // ... existing fields ...
  version Int @default(0)   // optimistic lock counter
}
```

The PLAYER message (recording the raw action) is written before the AI call and is intentionally outside the transaction — it is a log entry and does not require atomicity with the state update.

---

## Refactored take-turn Flow

The current flow violates CLAUDE.md's Gameplay Transaction Loop in steps 2–4. The corrected execution order:

```
Step 1 — Auth & turn-ownership gate (existing, correct)
  └─ supabase.auth.getUser()
  └─ verify currentTurnCharacterId === caller's characterId

Step 2 — Input sanitization (NEW — fixes prompt injection)
  └─ Strip / reject chipText containing prompt-injection patterns
  └─ Enforce max length (e.g., 200 chars)
  └─ Reject characters outside printable ASCII / Unicode text
  └─ Store sanitized value; use ONLY sanitized value from here on

Step 3 — Log the player action (existing, move before AI call)
  └─ prisma.message.create({ role: "PLAYER", content: sanitizedAction })
  └─ Note: this write is intentionally outside the transaction

Step 4 — Intent parsing (Claude call #1, NARROWED scope)
  └─ System prompt instructs Claude to return ONLY:
       { "actionType": "ATTACK" | "SEARCH" | "MOVE" | "SKILL_CHECK" | "OTHER",
         "targetEntity": string | null,
         "skillName": string | null }
  └─ Claude DOES NOT receive chipText in the system prompt
  └─ sanitizedAction goes in the user message only

Step 5 — Boundary & prerequisite validation (pure TypeScript)
  └─ Verify action is legal given current game state (position, HP, inventory)
  └─ If illegal: return early with error narrative, no state mutation

Step 6 — Dice roll (NEW — fixes AI-invented rolls)
  └─ Identify relevant ability score from character row + actionType
  └─ Compute modifier = abilityModifier(score) + (proficient ? proficiencyBonus(level) : 0)
  └─ Determine DC from game state / NPC table
  └─ const rollResult = rollD20Check(modifier, dc)   ← lib/dice.ts
  └─ rollResult is a plain object with roll, modifier, total, success, critical, fumble

Step 7 — Narration (Claude call #2, outcome provided)
  └─ System prompt is static world context (cached) — NO user input embedded here
  └─ Dynamic state prompt reflects current world state
  └─ User turn message includes:
       "Player action: {sanitizedAction}
        Dice result: {roll} + {modifier} = {total} vs DC {dc} — {SUCCESS|FAILURE}{critical/fumble note}"
  └─ Claude narrates the outcome; it cannot invent a different result
  └─ Claude returns { narrative, stateDeltas, chips }

Step 8 — Atomic state mutation (NEW — fixes race condition)
  └─ prisma.$transaction(async (tx) => {
       re-read game.version inside tx
       assert version === expectedVersion (throw STALE_TURN if not)
       apply stateDeltas to newState
       check XP grant condition (encounter end flag in stateDeltas)
       if xp grant: tx.character.update({ xp: { increment: amount } })
       check level-up: if newXp >= XP_THRESHOLD[currentLevel]: tx.character.update({ level: ... })
       tx.message.create({ role: "DUNGEON_MASTER", content: narrative, chips })
       tx.game.update({ state: newState, currentTurnCharacterId: nextChar, version: { increment: 1 } })
     })

Step 9 — Return result to client
  └─ { success: true, narrative, chips, newState }
```

### Prompt Injection Fix Detail

The injection risk is on line 177 of take-turn.ts:
```typescript
messages: buildConversationMessages(contextWindow, chipText),
```
and line 103:
```typescript
out.push({ role: "user", content: `Player action: ${currentAction}` });
```
The raw `chipText` flows directly into the user message. The system prompt itself does not embed `chipText` currently (the injection concern in CONCERNS.md is that the system prompt *could* receive it via future changes, and the user message has no sanitization). The fix is sanitization before any use, plus the two-call split that confines user input to the narration call's user-turn message only — never the system prompt.

---

## Level-Up Detection

**Recommendation: Synchronous, inside the `$transaction` block in `take-turn`.**

### Rationale

| Approach | Pros | Cons |
|---|---|---|
| Inside take-turn transaction | Single atomic write; level reflects immediately in returned state; no extra infra | Slightly longer transaction hold time (microseconds for a simple comparison) |
| Separate triggered action | Decoupled; cleaner separation | Requires either a DB trigger (adds Postgres complexity outside Prisma migrations) or a second server action call (two round trips, two transactions, window for inconsistency) |
| Background job / queue | Scales to many players | Complete overkill for async turn-based game; adds infrastructure not in scope |

The D&D Basic Rules XP thresholds for levels 1–5 are a static lookup table — five integer comparisons. This is trivially cheap inside a transaction. There is no scaling argument for deferring it.

The level-up check uses a constant table, not Claude:

```typescript
// lib/xp.ts
export const XP_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
};

export function computeLevel(xp: number): number {
  let level = 1;
  for (const [lvl, threshold] of Object.entries(XP_THRESHOLDS)) {
    if (xp >= threshold) level = Number(lvl);
  }
  return level;
}

export function proficiencyBonusForLevel(level: number): number {
  return level <= 4 ? 2 : 3;
}

export function maxHpOnLevelUp(
  currentMaxHp: number,
  constitutionScore: number,
  characterClass: string,
): number {
  // D&D Basic Rules: Fighter d10, Cleric/Druid d8, Rogue/Ranger d8, Wizard d6
  const hitDie: Record<string, number> = {
    Fighter: 10, Paladin: 10, Barbarian: 12,
    Cleric: 8, Druid: 8, Ranger: 8, Rogue: 8,
    Wizard: 6, Sorcerer: 6,
  };
  const die = hitDie[characterClass] ?? 8;
  const conMod = Math.floor((constitutionScore - 10) / 2);
  // Average HP gain per level (PHB alternative): floor(die/2) + 1 + conMod
  return currentMaxHp + Math.floor(die / 2) + 1 + conMod;
}
```

Inside the transaction, after applying `stateDeltas`:

```typescript
if (stateDeltas.xpGrant) {
  const newXp = character.xp + stateDeltas.xpGrant;
  const newLevel = computeLevel(newXp);
  const didLevelUp = newLevel > character.level;

  await tx.character.update({
    where: { id: currentCharId },
    data: {
      xp: newXp,
      level: newLevel,
      ...(didLevelUp ? {
        maxHp: maxHpOnLevelUp(character.maxHp ?? currentMaxHp, character.constitution, character.characterClass),
      } : {}),
    },
  });
}
```

XP grants are code-controlled: the intent-parsing step (Step 4) identifies encounter-end events. The dice engine or a separate `resolveEncounterEnd` function emits the XP amount based on a lookup table — Claude does not decide XP values.

---

## Build Order

Dependencies flow strictly in one direction. Each item must be complete before the next starts.

```
1. lib/dice.ts + lib/xp.ts          (zero deps — pure functions)
   └─ Vitest install + vitest.config.ts
   └─ dice.test.ts, xp.test.ts

2. Schema migration: Character.xp, Character.level, Game.version
   └─ npx prisma migrate dev --name add-xp-level-version
   └─ Regenerate Prisma client

3. Refactor take-turn.ts
   └─ Depends on (1): dice functions must exist before they can be called
   └─ Depends on (2): Game.version column must exist for the stale guard
   └─ Input sanitization (Step 2) — can be extracted to lib/sanitize.ts
   └─ Two-call Claude split (Steps 4 + 7)
   └─ $transaction wrapping state mutation (Step 8)
   └─ Level-up check inside transaction (also Step 8)

4. UI: display XP bar + level on character status tab
   └─ Depends on (2): columns must exist

5. Tests: take-turn integration tests
   └─ Depends on (3): tests can't run against broken action
```

**Critical path:** Dice engine (1) → Migration (2) → take-turn refactor (3). Steps 4 and 5 are parallel after step 3.

---

## Confidence

| Area | Confidence | Reasoning |
|---|---|---|
| Dice engine placement (`lib/dice.ts`) | HIGH | Direct inspection of existing `lib/` pattern; no framework-specific API; standard Next.js monolith convention |
| XP on Character columns | HIGH | Schema inspection confirms no XP/level columns exist yet; cross-game persistence requirement is definitive; JSON blob shape documented as world state not character advancement |
| Prisma `$transaction` interactive form | HIGH | `$prisma/client` 7.8.0 confirmed in package.json; interactive transactions are documented since Prisma 2.x and stable through 7.x; direct inspection of the non-atomic `Promise.all` in take-turn.ts line 225 confirms the bug |
| Optimistic version column | HIGH | Industry-standard pattern for detecting concurrent writes; no Prisma-specific complexity; single INT column increment is sufficient |
| Two-call Claude split | HIGH | Aligns with CLAUDE.md spec ("AI parses intent; code rolls dice; AI narrates outcome"); the current one-call structure is the root cause of the AI-invented rolls bug |
| Synchronous level-up inside transaction | HIGH | Five integer comparisons; no I/O; fits cleanly in the transaction; no infrastructure beyond what already exists |
| `proficiencyBonus` table (levels 1–5) | HIGH | D&D Basic Rules 2014 is a fixed published table; levels 1–4 = +2, level 5 = +3 is correct |
| Hit die by class | MEDIUM | Standard D&D 5e values from PHB; class strings in DB are free-form (no enum enforced), so the lookup must handle unknown classes gracefully with a default |
