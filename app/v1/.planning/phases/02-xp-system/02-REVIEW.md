---
phase: 02-xp-system
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - app/actions/take-turn.ts
  - app/game/[id]/page.tsx
  - lib/xp.ts
  - lib/xp.test.ts
  - prisma/schema.prisma
findings:
  critical: 2
  warning: 5
  info: 2
  deferred: 1
  total: 10
status: issues_found
---

# Phase 02: XP System — Code Review Report

**Reviewed:** 2026-05-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The XP engine itself (`lib/xp.ts`) is correct and well-tested. `computeLevel` and `xpForNextLevel` handle all boundary values properly and the test suite is thorough. The schema additions (`xp`, `level` on `Character`) are sound.

The critical defects are concentrated in `app/actions/take-turn.ts`: a player message is written to the database before the AI call and before the optimistic-lock transaction, meaning it persists even on failure; XP is accumulated from a stale in-memory snapshot, opening a double-award race window; and the turn-enforcement guard has a null-state bypass that lets any party member act when `currentTurnCharacterId` is null. Two additional warnings touch the game page's XP bar rendering and a diagnostic console.log leaking user identity in production.

---

## Critical Issues

### CR-01: Player message persisted before optimistic-lock transaction — survives AI failure and STALE_TURN rollback

**File:** `app/actions/take-turn.ts:214`

**Issue:** `prisma.message.create` (role: PLAYER) is called unconditionally before the Anthropic API call and before the transaction that holds the optimistic version check. If the AI call throws (caught at line 251), or if the transaction fails with `STALE_TURN` (thrown at line 326), the PLAYER message row remains in the database. The next render of the Chronicle will show a player action with no DM response, and the message is never cleaned up. On a STALE_TURN retry the user's action appears twice.

**Fix:**
Move the PLAYER message creation inside the `prisma.$transaction` block, after the version check passes:

```typescript
// Inside the $transaction callback, after the version check:
const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");

// Now it's safe to write — only persists if the whole transaction commits.
await tx.message.create({
  data: { gameId, role: "PLAYER", content: sanitizedAction },
});
await tx.message.create({
  data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips },
});
await tx.game.update({ ... });
if (xpAwarded > 0 || didLevelUp) {
  await tx.character.update({ ... });
}
```

---

### CR-02 [DEFERRED — Future Optimization]: XP accumulation reads stale pre-transaction snapshot — double-award race window

**File:** `app/actions/take-turn.ts:278–280`
**Status:** Deferred by product decision. Low priority for current single-player async MVP; concurrent encounter submissions are practically impossible in this game's turn structure.

**Issue:** `currentXp` is computed from `currentCharacter.xp` fetched at request start, not inside the transaction. Two overlapping requests for the same character could both read the same base XP and both write `base + award`, effectively under-awarding. A client retry after a transient error could also re-award XP on the same encounter.

**Suggested fix when prioritized:** Re-read `character.xp` inside the `prisma.$transaction` block before computing the new total. Track `encounterResult` in game state to prevent re-award on retry.

---

### CR-03: Turn-enforcement bypass when `currentTurnCharacterId` is null

**File:** `app/actions/take-turn.ts:200–208`

**Issue:** The guard at line 201 reads:
```typescript
if (game.partyMembers.length > 0 && game.currentTurnCharacterId) {
```
When `currentTurnCharacterId` is `null` (the game has party members but `startAdventure` has not yet set the first turn), the entire block is skipped. The code falls through to the solo-game fallback at line 206, which checks `game.character.userId !== user.id`. Any authenticated party member who is NOT the host passes both checks and can submit a turn action before the adventure starts, writing a PLAYER message and potentially triggering an AI call against an uninitialized game state.

**Fix:**
Add an explicit null guard for the party-game path:

```typescript
if (game.partyMembers.length > 0) {
  if (!callerMember) return { success: false, error: "You are not in this game." };
  if (!game.currentTurnCharacterId) {
    return { success: false, error: "The adventure has not started yet." };
  }
  if (game.currentTurnCharacterId !== callerMember.characterId) {
    return { success: false, error: "It's not your turn." };
  }
} else if (game.character.userId !== user.id) {
  return { success: false, error: "Access denied." };
}
```

---

## Warnings

### WR-01: `xpForNextLevel` returns semantically wrong value for level 0

**File:** `lib/xp.ts:69–72`

**Issue:** `xpForNextLevel(0)` returns `XP_THRESHOLDS[0]` which is `0` — it says "0 XP needed for the next level." Level 0 is not a valid game state, but the function has no guard and the return value would be actively misleading to any caller that doesn't first validate the level argument. The page component at `app/game/[id]/page.tsx:584` calls `xpForNextLevel(level)` where `level` comes from `m.character.level` which is a database value — if that row ever has level=0 due to a bad migration or seed, the XP bar silently renders with a 0-division calculation.

**Fix:**
```typescript
export function xpForNextLevel(level: number): number | null {
  if (level <= 0 || level >= XP_THRESHOLDS.length) return null; // invalid or at cap
  return XP_THRESHOLDS[level];
}
```

---

### WR-02: XP bar renders `NaN%` width when `level` is 0 or negative

**File:** `app/game/[id]/page.tsx:585–588`

**Issue:** `prevXp = XP_THRESHOLDS[level - 1]`. When `level = 0`, this is `XP_THRESHOLDS[-1]` which is `undefined`. `xpInLevel = xp - undefined = NaN`. `xpPct = NaN`, and the inline style `width: NaN%` causes a completely invisible progress bar with no error surfaced to the user. The `atCap` guard only fires when `level >= 5`, so level 0 is not protected. While level 0 should not exist in production data, defensive rendering is appropriate for UI code.

**Fix:**
```typescript
const safeLevel = Math.max(1, Math.min(5, level)); // clamp to valid range
const atCap     = safeLevel >= 5;
const nextXp    = atCap ? null : xpForNextLevel(safeLevel);
const prevXp    = XP_THRESHOLDS[safeLevel - 1] ?? 0;
```

---

### WR-03: Dice modifier ignores character class — wizard attacks using strength

**File:** `app/actions/take-turn.ts:225`

**Issue:** Attack rolls (`dcType === "AC"`) always use `currentCharacter.strength` as the base score, and non-attack checks always use `currentCharacter.wisdom`. A Wizard or Sorcerer with strength 8 (modifier -1) will systematically miss attacks that they should have a chance to hit, while a Barbarian rolling wisdom for a Perception check (DC 12) uses a dump stat. This is not an edge case — it affects every roll for characters with class/stat mismatches.

**Fix:** Map character class to the appropriate primary ability score. At minimum, use DEX for Rogues/Rangers and INT for Wizard/Sorcerer on attack-type actions:

```typescript
function getPrimaryAbilityScore(characterClass: string, dcType: "AC" | "DC"): keyof typeof character {
  if (dcType === "AC") {
    const dexClasses = ["Rogue", "Ranger", "Monk"];
    const intClasses = ["Wizard", "Sorcerer"];
    if (dexClasses.includes(characterClass)) return "dexterity";
    if (intClasses.includes(characterClass)) return "intelligence";
    return "strength";
  }
  // DC checks: wisdom is fine as a default perception/insight stat
  return "wisdom";
}
```

---

### WR-04: `response.content.find()` called twice — second call can return undefined if content changes

**File:** `app/actions/take-turn.ts:256–257`

**Issue:**
```typescript
const rawText = response.content.find((b) => b.type === "text")
  ? (response.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
  : "";
```
`find()` is called twice on `response.content`. While Anthropic's SDK returns a stable array reference, the pattern is brittle: the truthiness check and the extraction are separate operations. If `response.content` were modified between calls (e.g., by a middleware), the type cast would throw. The idiomatic fix also eliminates the redundant traversal.

**Fix:**
```typescript
const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
const rawText   = textBlock?.text ?? "";
```

---

### WR-05: `getGame` leaks user identity to production logs

**File:** `app/actions/get-game.ts:10,34,44,51`

**Issue:** Four `console.log` calls log `user.id` and `gameId` (user-identifying data) on every game load. In a production deployment these appear in server-side logs which may be indexed by log aggregation services. While `get-game.ts` is not in the review scope, it is imported and called by the reviewed page (`app/game/[id]/page.tsx:8`) and the logs fire on every page render.

**Fix:** Remove the diagnostic `console.log` statements, or gate them behind a `process.env.DEBUG` flag:
```typescript
if (process.env.NODE_ENV === "development") {
  console.log("[getGame] userId:", user?.id ?? "anonymous", "gameId:", gameId);
}
```

---

## Info

### IN-01: Redundant array copy in `currentChips` computation on every render

**File:** `app/game/[id]/page.tsx:185`

**Issue:**
```typescript
const currentChips: string[] =
  [...localMessages].reverse().find((m) => m.role === "DUNGEON_MASTER")?.chips ?? [];
```
`[...localMessages].reverse()` creates a new array copy and mutates it in-place on every render. As `localMessages` grows this allocation is unnecessary. `Array.prototype.findLast` is available in all modern environments targeted by Next.js 16.

**Fix:**
```typescript
const currentChips: string[] =
  localMessages.findLast((m) => m.role === "DUNGEON_MASTER")?.chips ?? [];
```

---

### IN-02: Solo game PartyTab renders no cards when `partyMembers` is empty

**File:** `app/game/[id]/page.tsx:526–528`

**Issue:**
```typescript
const members = partyMembers.length > 0
  ? partyMembers
  : [];
```
This assignment is a no-op (both branches produce the same value — an empty array or the existing array). The comment above says "Solo games show a single character card" but the code does not implement that — a solo player viewing the Party tab sees an empty grid with no content and no explanation. The character data is available via `gameData.character`.

**Fix:** Either render the solo character card from `gameData.character` when `partyMembers.length === 0`, or remove the Party tab from `TABS` for solo games so the empty state is never reachable.

---

_Reviewed: 2026-05-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
