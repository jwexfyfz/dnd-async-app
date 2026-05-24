---
phase: 04-skills-abilities-integration
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - app/actions/create-character.ts
  - app/actions/create-character.test.ts
  - app/actions/get-class-features.ts
  - app/actions/take-turn.ts
  - app/game/[id]/page.tsx
  - components/character-form.tsx
  - lib/character-sheet.ts
  - lib/skills.ts
  - lib/skills.test.ts
  - prisma/schema.prisma
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Ten files implementing the skills/abilities integration were reviewed. The core skills engine (`lib/skills.ts`, `lib/character-sheet.ts`) and schema (`prisma/schema.prisma`) are sound. The critical failures are concentrated in: (1) combat-effect tags being parsed from the wrong AI response in the two-call skill-check path, silently dropping or misapplying HP damage; (2) missing authentication on the `getClassFeatures` server action exposing the class progression DB to unauthenticated callers; (3) duplicate skill picks not being rejected by the server, allowing a character to gain the same proficiency twice; and (4) a missing `try/catch` in the chip handler leaving the UI permanently locked on network errors.

---

## Critical Issues

### CR-01: Combat effects parsed from first AI call, but narrative comes from second call — HP changes are always silently dropped on skill-check turns

**File:** `app/actions/take-turn.ts:375`

**Issue:** When the AI returns a non-null `skillName`, the code makes a second Anthropic call and uses `finalParsed` (from `rawText2`) for the narrative, state deltas, and encounter result. However, `parseCombatEffects` is always called on `rawText` (line 375) — the *first* response — regardless of whether a second call was made. The system prompt instructs the DM to emit `<combat_effect …/>` tags only in the response it generates, and the second call is the one that includes the `[SKILL …]` mechanical context and produces the final narrative. Any `<combat_effect>` tags the DM appends to `rawText2` are never parsed, so damage or healing that occurs on a skill-check turn is silently dropped. Conversely, if the first response happened to emit a tag, it would be applied against a narrative the player never saw.

**Fix:**
```typescript
// After the skill-check branch, use rawText2 for combat effects when available:
const effectsSource = validSkillName !== null ? rawText2 : rawText;
const rawEffects = parseCombatEffects(effectsSource);
```
Introduce `rawText2` into the outer scope (initialise to `""`) and assign it inside the `if (validSkillName !== null)` block so the post-branch code can use it.

---

### CR-02: `getClassFeatures` server action has no authentication guard

**File:** `app/actions/get-class-features.ts:13`

**Issue:** `getClassFeatures` is a `"use server"` function that queries the `classFeature` table and returns every feature row for the supplied `(characterClass, maxLevel)` pair with no session check. Any unauthenticated HTTP client can call it by invoking the server action endpoint directly, enumerating the full class feature catalogue. Beyond information disclosure, the `characterClass` and `maxLevel` parameters are passed unsanitised to Prisma — while Prisma parameterises values, an extremely long string or integer overflow could stress the DB. More importantly, the project security posture requires all server actions that touch the DB to verify the caller's identity.

**Fix:**
```typescript
export async function getClassFeatures(
  characterClass: string,
  maxLevel: number,
): Promise<ClassFeatureData[]> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];          // or throw — callers handle empty gracefully

  return prisma.classFeature.findMany({ … });
}
```

---

### CR-03: Duplicate skill picks not rejected server-side — character can gain the same proficiency twice

**File:** `app/actions/create-character.ts:68-76`

**Issue:** The server validates that the submitted skills array has exactly `requiredCount` entries and that every entry is in `allowedSkills`, but it never checks for duplicates. A crafted POST can submit `["Athletics", "Athletics"]` for a Fighter, pass both checks (length = 2, both in pool), and write `["Athletics", "Athletics"]` to `character.skillProficiencies`. The `resolveSkillCheck` function then applies the proficiency bonus for "Athletics" only once (because `Array.includes` short-circuits), so the double-entry does not double the bonus — but the stored data is incorrect, the character sheet will show "Athletics" listed twice, and it may confuse future logic.

**Fix:**
```typescript
// After parsing skillProficiencies, before the length check:
const deduped = [...new Set(skillProficiencies)];
if (deduped.length !== skillProficiencies.length) {
  return { success: false, error: "Duplicate skills are not allowed." };
}
```

---

### CR-04: `handleChipClick` has no `try/catch` — an unhandled rejection from `takeTurn` leaves `isTakingTurn` permanently `true` and the UI deadlocked

**File:** `app/game/[id]/page.tsx:227-300`

**Issue:** `handleChipClick` is an `async` function that calls `await takeTurn(...)` with no surrounding `try/catch`. If `takeTurn` throws (e.g., a network error, a Next.js serialisation error, or an unexpected Prisma error that escapes the server action boundary), the function rejects without ever reaching `setIsTakingTurn(false)` (line 299). After that, `isTakingTurn` stays `true` forever, all action chips are disabled, and the game cannot be continued without a page reload.

**Fix:**
```typescript
async function handleChipClick(chip: string) {
  if (isTakingTurn || isInitializing || !localState) return;
  setIsTakingTurn(true);
  // … setup …
  try {
    const result = await takeTurn(gameId, chip);
    // … existing success/error branches …
  } catch {
    setLocalMessages((prev) => prev.filter((m) => m.id !== playerMsg.id));
    setTurnError("The Dungeon Master is temporarily unavailable. Please try again.");
  } finally {
    setIsTakingTurn(false);
  }
}
```

---

## Warnings

### WR-01: Skill check uses the combat DC (always 12 for non-attack actions) instead of a skill-specific DC

**File:** `app/actions/take-turn.ts:331`

**Issue:** `resolveSkillCheck(validSkillName, character, dc)` reuses the `dc` derived from `detectActionType`, which always returns `12` for any action that doesn't contain an attack keyword. Every skill check therefore runs against DC 12 regardless of context. The Difficulty Class for Perception versus Investigation versus Athletics should vary by situation — at minimum, the narrative prompt should request a DC from the AI or the code should use a lookup table keyed by skill. As written, all non-combat skill checks have an identical, hardcoded difficulty.

**Fix:** Either request a `suggestedDc` field in the first AI response alongside `skillName`, or define a `SKILL_DEFAULT_DC` lookup table per skill tier. At minimum, document this as a deliberate design constraint.

---

### WR-02: `parseCombatEffects` operates on stale HP from a pre-transaction DB read — concurrent actions cause incorrect `newHp`

**File:** `app/actions/take-turn.ts:376-390`

**Issue:** At line 379, `prisma.character.findMany` fetches `currentHp` for affected characters *outside* the transaction. The transaction begins at line 446. If two concurrent skill/combat turns hit the same character in quick succession, the second caller may load a `currentHp` value that hasn't yet reflected the first caller's delta. `clampHp` then computes an incorrect `newHp`, and the transaction writes a stale value. The existing optimistic lock on `game.version` prevents two turns from committing to the same *game state*, but it does not protect the HP calculation from using stale character rows in the parallel-read window between line 379 and the transaction start.

**Fix:** Move the `character.findMany` read *inside* the `$transaction` callback so it runs within the same serialisable snapshot:
```typescript
await prisma.$transaction(async (tx) => {
  // … version check …
  if (rawEffects.length > 0) {
    const affectedChars = await tx.character.findMany({ … });
    // recalculate resolvedEffects here
  }
  // … rest of transaction …
});
```

---

### WR-03: `setTimeout` in `handleChipClick` is not cleaned up — can call `setHpFlashing` on an unmounted component

**File:** `app/game/[id]/page.tsx:268-270`

**Issue:** A bare `setTimeout(() => setHpFlashing(false), 800)` is started with no cancellation handle. If the user navigates away within 800 ms (e.g., back to the roster), the callback fires on an unmounted component, triggering a React state-update-on-unmounted-component warning and potentially a runtime error in React 18 strict mode. The timer handle is never stored and can never be cancelled.

**Fix:**
```typescript
// Store the timer and cancel on cleanup, or use a ref:
const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// in handleChipClick:
if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
setHpFlashing(true);
flashTimerRef.current = setTimeout(() => setHpFlashing(false), 800);

// Add a cleanup effect:
useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);
```

---

### WR-04: `resolveSkillCheck` uses `rollDie(20)` directly rather than re-using the existing `D20Result` from `rollD20Check` — the turn contains two independent d20 rolls

**File:** `app/actions/take-turn.ts:321-331` / `lib/skills.ts:141`

**Issue:** `takeTurn` already rolls a d20 via `rollD20Check` (line 268) for the main action. When a `skillName` is detected, `resolveSkillCheck` calls `rollDie(20)` again independently (default `rollFn`). This means the skill check uses a *second*, separate d20 roll that is never reported to the client as part of `diceResult`. The `SkillCheckCard` displayed to the user shows only "SUCCESS" or "FAILURE" without the roll value, so the player cannot see what they rolled. This is a game-rules accuracy concern: the two rolls are logically different events, but the design of the system prompt asks the DM to narrate the dice result it was given — the skill roll is not in that result block, causing narrative/mechanical inconsistency.

**Fix:** Pass the existing `diceResult.roll` as the injectable `rollFn` to `resolveSkillCheck` when the DC types align, or expose the skill roll value in `SkillCheckResult` display and document the two-roll design explicitly.

---

### WR-05: Character name has no server-side maximum length — arbitrarily long names will be stored

**File:** `app/actions/create-character.ts:41-43`

**Issue:** The server only validates that `name` is non-empty after trimming; it does not cap the length. The Prisma schema has no `@db.VarChar` constraint on `Character.name`, so the underlying Postgres `text` column accepts any length. A 100 KB name string passes validation and is stored. It will also be injected verbatim into the AI DM system prompt (line 65–67 of `take-turn.ts`), consuming tokens and potentially pushing real context out of the rolling window.

**Fix:**
```typescript
if (name.trim().length > 50) {
  return { success: false, error: "Character name must be 50 characters or fewer." };
}
```

---

## Info

### IN-01: `getStatCost` / stat-change hint message has a copy-paste error ("attribute" instead of "stat")

**File:** `components/character-form.tsx:65`

**Issue:** The rule hint reads `"Elite tier reached: Raising a attribute to 14 or 15 costs 2 points per level."` — "a attribute" should be "an attribute", and "per level" is misleading (it costs 2 points per *point* increase, not per level). This is player-visible UI text.

**Fix:** `"Elite tier reached: raising a stat to 14 or 15 costs 2 points per increase."`

---

### IN-02: `SKILLS` alias export in `lib/skills.ts` duplicates `SKILL_ABILITY_MAP` under a generic name — risk of future divergence

**File:** `lib/skills.ts:64`

**Issue:** `export const SKILLS = SKILL_ABILITY_MAP` creates a second public name for the same object. The comment explains this is for "REQUIREMENTS.md SKILL-03 literal compliance." If this alias is only for internal test compliance, it should not be re-exported from the module; it leaks an ambiguous name into every consumer. `take-turn.ts` already correctly uses `SKILL_ABILITY_MAP` — only the test file uses `SKILLS`, and it could import `SKILL_ABILITY_MAP` directly.

**Fix:** If the alias must exist, mark it `@internal` via a JSDoc comment and consider not re-exporting it from the module barrel.

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
