---
phase: 03-leveling
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - app/actions/create-character.test.ts
  - app/actions/create-character.ts
  - app/actions/start-adventure.ts
  - app/actions/take-turn.ts
  - app/game/[id]/page.tsx
  - lib/leveling.test.ts
  - lib/leveling.ts
  - prisma/migrations/0_init/migration.sql
  - prisma/migrations/20260522210049_add_character_max_hp/migration.sql
  - prisma/seed-backfill-maxhp.mjs
findings:
  critical: 3
  warning: 3
  info: 2
  total: 8
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-22
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 3 introduces a leveling system: `maxHp` persisted in the DB, leveling math in `lib/leveling.ts`, and atomic level-up inside `take-turn.ts`. The core math is correct and well-tested. Three blockers were found: (1) `partyMaxHp` in game state is never updated when a party member levels up, causing the HP bar to permanently show the old cap; (2) a player `PLAYER` message is written outside the atomic transaction, leaving orphaned messages whenever a STALE_TURN is detected; (3) `maxHpAtLevel` is called a second time in the `return` block, outside any try/catch — if the character class is somehow unexpected at that point, it throws an unhandled 500 rather than returning a clean error. Two warnings cover a missing minimum HP floor (negative maxHp is possible with extreme CON) and proficiency-bonus display that only fires at level 5 but silently skips the level 1→2 and 2→3→4 transitions where the value is still +2 and nothing changed — making the UI hint misleading. Two info items cover `error: any` suppression and a magic default in the migration.

---

## Critical Issues

### CR-01: `partyMaxHp` game-state entry is never updated on level-up

**File:** `app/actions/take-turn.ts:342-352`

**Issue:** When a party-game character levels up, the DB `Character.maxHp` is updated correctly inside the transaction. However, `newState.partyMaxHp[currentCharId]` — the value the DM prompt and the PartyTab HP bar read from — is never touched. From the next turn onward, every party member's HP bar continues to show the pre-level-up cap; if the character takes damage the bar will compute an incorrect percentage and can even overflow 100 % if current HP exceeds the stale max. This is a data-consistency bug that silently serves wrong information to both the AI DM and the UI.

**Fix:**
```typescript
// Inside the transaction, after computing newMaxHp:
if (xpAwarded > 0 || didLevelUp) {
  const newMaxHp = didLevelUp
    ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
    : currentCharacter.maxHp;
  await tx.character.update({
    where: { id: currentCharId },
    data:  { xp: currentXp, level: newLevel, maxHp: newMaxHp },
  });
  // Also patch the game-state partyMaxHp so the DM prompt and UI stay correct.
  if (didLevelUp && newState.partyMaxHp) {
    newState.partyMaxHp = { ...newState.partyMaxHp, [currentCharId]: newMaxHp };
  }
}
// Pass the mutated newState (now containing the updated partyMaxHp) to tx.game.update above.
// Note: the game.update call must come AFTER this block, or newState must be finalised first.
```

---

### CR-02: PLAYER message is written outside the atomic transaction — orphaned on STALE_TURN

**File:** `app/actions/take-turn.ts:224-226`

**Issue:** The player's `PLAYER` role message is persisted to the `Message` table before the version check and before the Claude API call (line 224). If the subsequent transaction throws `STALE_TURN` (line 336), the action returns `{ success: false, error: "STALE_TURN" }`, but the `PLAYER` message already committed. The DB now has a player message with no corresponding DM reply. The client-side code at `page.tsx:233` correctly removes the optimistic local message on failure, but the DB row remains. Subsequent game loads will include this orphaned message in the context window, polluting the rolling history and potentially confusing the AI DM on the next turn.

**Fix:** Move the PLAYER message creation inside the `$transaction` block, after the version check:

```typescript
await prisma.$transaction(async (tx) => {
  const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
  if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");

  // Now safe — version confirmed, write PLAYER message atomically.
  await tx.message.create({
    data: { gameId, role: "PLAYER", content: sanitizedAction },
  });
  await tx.message.create({
    data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips },
  });
  // ... rest of updates
});
```

---

### CR-03: Second call to `maxHpAtLevel` in return block is outside any try/catch

**File:** `app/actions/take-turn.ts:373`

**Issue:** `maxHpAtLevel` throws `Error("Unknown class: ...")` for unrecognised character classes. It is called once inside the `$transaction` block (line 346, protected by the outer `try/catch`). It is then called a **second time** in the bare `return` statement at line 373 to populate `levelUpResult.newMaxHp`. This second call is after the transaction's try/catch has closed. If the class is somehow invalid (e.g., a DB record with a class string not in `HIT_DIE_BY_CLASS`, which the schema does not constrain), the transaction would have already thrown at line 346 and been caught — but if the class changes between the two calls (e.g., a concurrent update, though unlikely), or if the DB has a non-canonical casing (e.g., `"fighter"` vs `"Fighter"`), the second call throws an uncaught exception that propagates as a 500 to the caller.

Beyond the edge case, there is a simpler code-quality issue: `newMaxHp` is already computed inside the transaction at line 345-347 but is scoped to the transaction closure and thrown away. The return block recomputes it, duplicating work and introducing divergence risk. Cache the value instead:

**Fix:**
```typescript
// Hoist newMaxHp out of the closure so the return block can reuse it.
let committedNewMaxHp = currentCharacter.maxHp;

await prisma.$transaction(async (tx) => {
  const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
  if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");
  await tx.message.create({ data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips } });
  await tx.game.update({ where: { id: gameId }, data: { state: newState, currentTurnCharacterId: nextCharId, version: { increment: 1 } } });
  if (xpAwarded > 0 || didLevelUp) {
    committedNewMaxHp = didLevelUp
      ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
      : currentCharacter.maxHp;
    await tx.character.update({ where: { id: currentCharId }, data: { xp: currentXp, level: newLevel, maxHp: committedNewMaxHp } });
  }
});

// In the return block, reuse committedNewMaxHp instead of calling maxHpAtLevel again.
return {
  // ...
  levelUpResult: didLevelUp ? {
    oldLevel:         previousLevel,
    newLevel,
    oldMaxHp:         currentCharacter.maxHp,
    newMaxHp:         committedNewMaxHp,   // no second call
    proficiencyBonus: proficiencyBonus(newLevel),
  } : undefined,
};
```

---

## Warnings

### WR-01: No minimum HP floor — negative `maxHp` is possible with extreme CON scores

**File:** `lib/leveling.ts:53-58`

**Issue:** `maxHpAtLevel` can return 0 or a negative integer. A Wizard with CON 1 (modifier −5) at level 2 returns `maxHp = 0`; at level 3 it returns −1. While the UI's point-buy form likely prevents CON below 8 in practice, the server action in `create-character.ts` falls back to `8` only when `parseInt` returns `NaN` — a valid but crafted submission of `constitution=1` would persist `maxHp = 1` at level 1 (still valid) but `constitution=2` (modifier −4) at level 2 would yield `maxHp = 0`, making `hpBarColor(0, 0)` perform a 0/0 division in the UI (evaluating to `NaN`, silently falling through to `bg-red-500`).

D&D 5e Basic Rules require maxHp to be at least 1 per level. A `Math.max(1, hp)` floor at the end of `maxHpAtLevel` matches the rules and prevents this:

**Fix:**
```typescript
export function maxHpAtLevel(characterClass: string, constitution: number, level: number): number {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  const conMod = abilityModifier(constitution);
  let hp = hitDie.die + conMod;
  for (let l = 2; l <= level; l++) {
    hp += hitDie.avg + conMod;
  }
  return Math.max(1, hp);  // D&D 5e: minimum 1 HP at any level
}
```

---

### WR-02: `LevelUpCard` proficiency-bonus display only triggers at level 5, incorrectly

**File:** `app/game/[id]/page.tsx:527`

**Issue:** `const profChanged = result.newLevel === 5`. Proficiency bonus in this game is +2 for levels 1–4 and +3 at level 5. This means proficiency bonus never changes going from level 1 to 4 — but the intent of the condition is to show the `proficiencyBonus` badge only when it increased. `newLevel === 5` does correctly catch the +2→+3 jump. However, the condition name `profChanged` implies generality; if the XP thresholds or proficiency table are ever extended beyond level 5, this hardcode silently breaks. More critically, the `LevelUpCard` receives `result.proficiencyBonus` for all level-up events (set in `take-turn.ts:375`) but the badge is suppressed for levels 1–4. A user leveling from 1→2 sees no proficiency information at all, which is fine mechanically (it didn't change), but the structure is brittle.

The immediate observable bug: if the codebase ever supports levels beyond 5, `profChanged` will miss every proficiency-bonus increase past level 5 because it hardcodes `=== 5`. Use a comparison against the previous level's bonus instead:

**Fix:**
```typescript
// In LevelUpCard:
import { proficiencyBonus } from "../../../lib/dice"; // or lib/leveling

function LevelUpCard({ result }: { result: LevelUpResult }) {
  const oldProf = proficiencyBonus(result.oldLevel);
  const newProf = proficiencyBonus(result.newLevel);
  const profChanged = newProf !== oldProf;
  // ...
}
```

---

### WR-03: `parseInt(...) || 8` silently maps `constitution=0` to 8

**File:** `app/actions/create-character.ts:31`

**Issue:** The pattern `parseInt(value) || 8` treats both `NaN` (unparseable string) and `0` as "missing", falling back to `8`. In D&D 5e a CON score of `0` is not a valid game value, but a legitimate client submit of `constitution=0` will be silently reassigned to `8` without any error message to the user. More relevant to security: a client-controlled string like `"0"` is accepted without validation bounds, and scores outside [1, 20] are never rejected. While the UI presumably constrains this, no server-side bounds check exists for any ability score.

**Fix:** Replace the `|| fallback` pattern with explicit `NaN` detection and a separate range check:
```typescript
function parseAbilityScore(raw: FormDataEntryValue | null, fieldName: string): number | null {
  const n = parseInt(raw as string, 10);
  if (isNaN(n) || n < 1 || n > 20) return null;
  return n;
}
// Then validate each score and return an error if any is out of range.
```

---

## Info

### IN-01: Migration default value of 10 is inconsistent with leveling formula

**File:** `prisma/migrations/20260522210049_add_character_max_hp/migration.sql:2`

**Issue:** `DEFAULT 10` is used for the `maxHp` column. This is a reasonable migration safety value, but it does not match the formula for any class: Fighter at level 1 with the baseline CON 8 (modifier −1) would be 9, and Wizard would be 5. The backfill script corrects this, but any character row that was not backfilled (e.g., if the script is skipped in a new environment, or a future test fixture inserts a row without going through `createCharacter`) will silently carry `maxHp=10` regardless of class. A comment in the migration explaining that the backfill script must be run would help.

**Fix:** Document the dependency:
```sql
-- DEFAULT 10 is a placeholder; run `npm run db:backfill-maxhp` after applying
-- this migration to set class-correct values for all existing characters.
ALTER TABLE "Character" ADD COLUMN "maxHp" INTEGER NOT NULL DEFAULT 10;
```

---

### IN-02: `error: any` suppression in catch blocks

**File:** `app/actions/create-character.ts:80`, `app/actions/take-turn.ts:261`, `app/actions/take-turn.ts:354`

**Issue:** Three `catch (err: any)` / `catch (error: any)` blocks suppress TypeScript's `unknown` error type. This is a project-wide pattern issue but it is worth flagging because `error.message` access without checking `error instanceof Error` first is technically unsafe — non-Error throwables (e.g., a plain string throw) would produce `undefined` for `.message`. The `create-character.ts` fallback `error.message || "Failed to save character."` handles the `undefined` case, but `take-turn.ts:261` does `console.error("AI DM error:", err.message)` which would print `undefined` for non-Error throws.

**Fix:** Use `instanceof Error` narrowing or the `unknown` type with a helper:
```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("AI DM error:", message);
  return { success: false, error: "The DM is temporarily unavailable." };
}
```

---

_Reviewed: 2026-05-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
