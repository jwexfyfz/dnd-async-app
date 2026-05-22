---
phase: 02-xp-system
verified: 2026-05-22T00:31:30Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open any active game in a browser, navigate to the Party tab, and confirm the XP progress bar renders below the HP bar on each party member card."
    expected: "A slim blue bar (h-1.5, bg-blue-500) appears below the HP bar. Label reads 'Level 1  ·  XP: 0 / 300' for a fresh character. Bar fill is proportional to within-level progress. No console errors in browser DevTools."
    why_human: "JSX rendering can only be confirmed visually. TypeScript passes and the code is present, but an environment cache issue was documented in the 02-03 SUMMARY (the Next.js .next cache required clearing during development). The executor reported visual approval, but this is unverifiable by grep."
  - test: "Complete an encounter in-game and confirm XP is awarded and the bar updates after the chip-click re-fetch."
    expected: "After an encounter-completing turn, the character's XP increases by 50/100/200 based on difficulty. If level threshold is crossed, level increments. The Party tab bar fill increases on next load."
    why_human: "Requires a live Claude API call to set encounterResult = 'completed' in the JSON response. Cannot simulate end-to-end without running the dev server and interacting with the AI DM."
---

# Phase 2: XP System Verification Report

**Phase Goal:** Implement a complete XP and leveling system — award XP on encounter completion, track level in the database, and display an XP progress bar in the Party tab.
**Verified:** 2026-05-22T00:31:30Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | prisma/schema.prisma contains `xp Int @default(0)` and `level Int @default(1)` on the Character model | VERIFIED | Lines 35–36 of schema.prisma confirmed present; `grep -c "xp.*Int" prisma/schema.prisma` returns 1, `grep -c "level.*Int"` returns 1 |
| 2 | lib/xp.ts exports XP_THRESHOLDS, XP_BY_DIFFICULTY, computeLevel, and xpForNextLevel with zero Prisma imports | VERIFIED | File has no import statements; all four exports present at lines 19, 30, 48, 69 |
| 3 | All 22 unit tests pass covering all XP-05 boundary cases | VERIFIED | `npm run test:run -- lib/xp.test.ts` output: 22/22 passed (run live during verification) |
| 4 | encounterResult field is parsed from Claude's JSON response using strict `=== 'completed'` equality | VERIFIED | Line 274: `const encounterCompleted = parsed.encounterResult === "completed"` |
| 5 | When encounterResult is 'completed', XP is awarded from XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0 | VERIFIED | Lines 275–277: `xpAwarded = encounterCompleted ? (XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0) : 0` |
| 6 | character.update({ xp, level }) runs inside the existing prisma.$transaction after tx.game.update | VERIFIED | Lines 334–339: conditional `tx.character.update` inside `$transaction`, placed after `tx.game.update` |
| 7 | When level increases, newState.levelUpNote is set; when it did not increase, it is deleted | VERIFIED | Lines 307–311: `if (didLevelUp) { newState.levelUpNote = ... } else { delete newState.levelUpNote; }` |
| 8 | buildDynamicStatePrompt injects levelUpNote from gameState.levelUpNote when present | VERIFIED | Lines 139–141: `levelUpDirective` reads `gameState.levelUpNote` and appends to return string |
| 9 | buildStaticPrompt RESPONSE RULES block documents encounterResult field and trigger conditions | VERIFIED | Lines 77–80: `"encounterResult": "completed" \| null` in JSON schema + rule paragraph |
| 10 | RULES_ENGINE_KEYS strips xp and level from stateDeltas | VERIFIED | Line 299: `["hp", "maxHp", "xp", "level", "proficiencyBonus"]` — both xp and level present |
| 11 | CharacterData interface includes xp: number and level: number fields | VERIFIED | Lines 42–43 of page.tsx: `xp: number; level: number` inside CharacterData |
| 12 | XP_THRESHOLDS and xpForNextLevel imported from lib/xp in page.tsx | VERIFIED | Line 13: `import { xpForNextLevel, XP_THRESHOLDS } from "../../../lib/xp"` |
| 13 | XP bar renders below HP bar in PartyTab with h-1.5, bg-blue-500 fill, within-level progress | VERIFIED (code) | Lines 579–603: IIFE computes xp, level, atCap, prevXp, xpPct, label; renders `h-1.5 ... bg-blue-500` with clamped `xpPct`; reads from `m.character.xp` and `m.character.level` |

**Score:** 13/13 truths verified (code level)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | Character model with xp and level fields | VERIFIED | Lines 35–36 present; both fields use Int @default |
| `lib/xp.ts` | XP engine — thresholds, difficulty table, computeLevel, xpForNextLevel | VERIFIED | 73 lines; zero imports; all four exports substantively implemented with real for-loop logic and null-at-cap handling |
| `lib/xp.test.ts` | 22 unit tests across 4 describe blocks | VERIFIED | 117 lines; 22 test cases; explicit vitest imports; all 22 pass live |
| `app/actions/take-turn.ts` | XP award, levelUpNote, character.update in $transaction | VERIFIED | 349 lines; all integration points present and wired |
| `app/game/[id]/page.tsx` | CharacterData with xp/level; XP bar in PartyTab | VERIFIED (code) | CharacterData extended at lines 42–43; XP bar JSX at lines 579–603; IIFE pattern reading live `m.character.xp` and `m.character.level` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lib/xp.ts` | `lib/xp.test.ts` | named imports | VERIFIED | Line 8 of xp.test.ts: `import { computeLevel, xpForNextLevel, XP_THRESHOLDS, XP_BY_DIFFICULTY } from './xp'` |
| `app/actions/take-turn.ts` | `lib/xp.ts` | `import { computeLevel, XP_BY_DIFFICULTY }` | VERIFIED | Line 13 of take-turn.ts confirmed |
| `app/actions/take-turn.ts` | `prisma.character` | `tx.character.update` inside `$transaction` | VERIFIED | Lines 334–339; conditional on `xpAwarded > 0 \|\| didLevelUp` |
| `buildDynamicStatePrompt` | `gameState.levelUpNote` | template string conditional | VERIFIED | Lines 139–143; `levelUpDirective` reads the field and appends to return |
| `app/game/[id]/page.tsx (PartyTab)` | `lib/xp.ts` | `import { xpForNextLevel, XP_THRESHOLDS }` | VERIFIED | Line 13 of page.tsx |
| `PartyTab` | `m.character.xp` and `m.character.level` | `partyMembers` from `gameData` (getGame re-fetch) | VERIFIED | Lines 581–582 read directly from `m.character.xp` and `m.character.level`; getGame re-fetch fires at line 216 after each chip click |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `app/game/[id]/page.tsx (PartyTab)` | `m.character.xp`, `m.character.level` | `getGame(gameId)` re-fetch → Prisma `character: true` include → DB columns added in Plan 02-01 | Yes — reads from live DB columns; no hardcoded fallbacks in XP bar rendering | FLOWING |
| `app/actions/take-turn.ts` (XP award) | `currentXp`, `newLevel` | `currentCharacter.xp ?? 0` from Prisma game query + `XP_BY_DIFFICULTY[difficulty]` from server-side DB `storyPrompt.difficulty` | Yes — both sources are server-side DB data, not client-supplied | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| computeLevel boundary correctness | `npm run test:run -- lib/xp.test.ts` | 22/22 passed | PASS |
| xpForNextLevel returns null at cap | Covered by xp.test.ts | 22/22 passed | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | No errors | PASS |
| Full test suite (no regressions) | `npm run test:run` | 50/50 passed (lib/dice.test.ts + lib/xp.test.ts) | PASS |
| All commit hashes exist in git log | `git log --oneline <hashes>` | All 8 commits verified in repo history | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no probe files declared in PLAN frontmatter; no `scripts/*/tests/probe-*.sh` conventional probes found.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| XP-01 | 02-01 | Character schema: xp + level columns | SATISFIED | Both fields present in schema.prisma lines 35–36 |
| XP-02 | 02-01 | lib/xp.ts — XP table + computeLevel | SATISFIED | All four exports present and substantive; XP_THRESHOLDS = [0,300,900,2700,6500] |
| XP-03 | 02-02 | Grant XP at encounter end (code) | SATISFIED | encounterResult parsed with strict equality; XP from difficulty table; tx.character.update in transaction |
| XP-04 | 02-03 | Display XP/level in game UI | SATISFIED (code verified; human visual check needed) | XP bar in PartyTab reads m.character.xp and m.character.level; label shows "Level N · XP: current / next" |
| XP-05 | 02-01 | XP threshold unit tests | SATISFIED | 22/22 tests pass live; all 10 required boundary values covered plus edge cases |

**Note on XP-04 checkbox:** REQUIREMENTS.md has XP-04 marked as `[ ]` (incomplete) despite the implementation being present and verified in the codebase. This is a documentation synchronization gap. The code satisfies the requirement. The checkbox should be updated to `[x]`.

**Note on XP-04 wording vs. implementation:** REQUIREMENTS.md says "XP remaining to next level" but the label shows `"Level N · XP: current / next_threshold"` — users can compute the remainder. The PLAN's own must_have explicitly specifies this label format ("Label reads 'Level N · XP: currentXp / nextThreshold'"), so the implementation matches the PLAN contract. Minor wording deviation from the original requirement, not a blocker.

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None found | — | — | — |

Scanned `lib/xp.ts`, `lib/xp.test.ts`, `app/actions/take-turn.ts`, `app/game/[id]/page.tsx` for TBD/FIXME/XXX (none), TODO/HACK/PLACEHOLDER (none), suspicious empty returns (only the intentional `return null` in xpForNextLevel at level cap — not a stub; it is the documented API contract). No stubs detected.

---

### Human Verification Required

#### 1. XP Bar Visual Rendering in Browser

**Test:** Run `npm run dev`, open any active game, navigate to the Party tab, confirm each party member card shows a slim blue bar below the HP bar.
**Expected:** Bar is visible; label reads "Level 1  ·  XP: 0 / 300" for a fresh character; fill is 0% (new character); no console errors in browser DevTools.
**Why human:** JSX rendering requires browser execution. An environment cache issue (Next.js .next cache) was documented during development and required `rm -rf .next/cache` to resolve. Visual confirmation guards against stale compiled output.

#### 2. XP Award End-to-End Flow

**Test:** With the dev server running, play through a combat encounter until it resolves, confirm the Party tab updates with increased XP after the next chip click triggers a re-fetch.
**Expected:** Character XP increases by 50 (Beginner), 100 (Standard), or 200 (Veteran) based on the game's story difficulty. If a level threshold is crossed, the level increments and the bar resets to show progress within the new level.
**Why human:** Requires a live Anthropic API call where Claude sets `encounterResult: "completed"` in the JSON response. Cannot simulate the full XP award path without a running server and an actual encounter completion.

---

### Gaps Summary

No code gaps found. All 13 observable truths are verified at the code level. All commits exist in git history. TypeScript passes. Tests pass 50/50.

Two items require human verification:
1. Visual rendering of the XP bar in the browser (guarding against stale Next.js cache)
2. End-to-end XP award confirming Claude sets encounterResult correctly and the DB write persists

One documentation gap (non-blocking): REQUIREMENTS.md XP-04 checkbox should be updated from `[ ]` to `[x]`.

---

_Verified: 2026-05-22T00:31:30Z_
_Verifier: Claude (gsd-verifier)_
