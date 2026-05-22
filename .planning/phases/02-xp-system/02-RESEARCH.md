# Phase 2: XP System - Research

**Researched:** 2026-05-21
**Domain:** Game progression — XP accumulation, level computation, UI display
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Claude signals encounter completion via `encounterResult: "completed" | null` in its JSON response alongside `narrative`, `stateDeltas`, and `chips`.
- **D-02:** Static system prompt includes explicit rules telling Claude when to set `encounterResult: "completed"` (combat fully resolves: enemy defeated/fled, boss dies, room cleared).
- **D-03:** Code never trusts Claude to determine XP amount — only the `encounterResult` signal is consumed. XP amount comes from a code-owned lookup table.
- **D-04:** Difficulty-based XP table keyed on `StoryPrompt.difficulty`: Beginner → 50 XP, Standard → 100 XP, Veteran → 200 XP. Table lives in `lib/xp.ts`.
- **D-05:** XP is written to `Character.xp` inside the existing `prisma.$transaction` in `take-turn.ts`, alongside the `game.update`.
- **D-06:** When a level-up occurs, `take-turn.ts` injects a `LEVEL UP` note into the dynamic state system prompt: `"LEVEL UP: [CharacterName] advanced to Level [N] this turn."` Claude weaves it into the narrative.
- **D-07:** No new UI component for level-up in Phase 2 — Claude narration is the only signal.
- **D-08:** XP and level displayed in the Party tab on each member card — compact XP progress bar below the HP bar, matching the HP bar visual pattern.
- **D-09:** Label format: `Level N  ·  XP: 250 / 300` above a slim progress bar. At level cap (5): `Level 5  ·  MAX` with a full bar.
- **D-10:** XP/level data is server-authoritative — read from `partyMembers[].character` returned by the existing `getGame` re-fetch. No client-side XP state.
- **D-11:** `getGame` must include `xp` and `level` in the character select inside `partyMembers`. `getCharacters` on the roster page does NOT need XP/level in Phase 2.

### Claude's Discretion
- Exact wording Claude uses for level-up narration (system prompt provides the fact, Claude writes the story)
- Visual bar color for XP progress (blue `bg-blue-500` suggested — distinct from HP's green/amber/red)
- Whether `encounterResult` field appears in the JSON schema comment in the system prompt or only in the rules section

### Deferred Ideas (OUT OF SCOPE)
- XP/level on roster character cards (home page) — deferred
- Bonus XP for critical hits, roleplaying moments — out of scope
- XP recap at end of game session — separate feature
- Partial XP on encounter flee or partial completion — zero on anything other than `completed`
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| XP-01 | Prisma migration adds `xp Int @default(0)` and `level Int @default(1)` columns to `Character` model | Schema section: exact field declarations and `db push` command |
| XP-02 | `lib/xp.ts` exports `XP_THRESHOLDS`, `computeLevel`, `xpForNextLevel` | lib/xp.ts design section: full algorithm and table values |
| XP-03 | At encounter end, `take-turn.ts` awards XP from code; XP added to `character.xp` inside transaction; `computeLevel()` called and level written if increased | take-turn.ts integration section: exact insertion points and transaction pattern |
| XP-04 | Game UI displays current XP, current level, and XP remaining to next level on the character status panel | get-game.ts and Party tab sections: exact field additions and JSX pattern |
| XP-05 | Unit tests cover `computeLevel` at every threshold boundary and `xpForNextLevel` at levels 1–5 | Test plan section: all 10 boundary values specified |
</phase_requirements>

---

## Summary

Phase 2 adds XP accumulation and level display to the game loop. It touches five files: `prisma/schema.prisma` (two new columns), `lib/xp.ts` (new pure module), `app/actions/take-turn.ts` (encounterResult parsing and XP award in the existing transaction), `app/actions/get-game.ts` (two new select fields), and `app/game/[id]/page.tsx` (XP bar in PartyTab).

All architectural decisions are locked in CONTEXT.md. This research documents the exact code patterns, insertion points, and boundary values the planner needs to write precise task actions. No new dependencies are required — all five files use patterns already present in the codebase.

The XP thresholds (0 / 300 / 900 / 2700 / 6500 for levels 1–5) are authoritative in REQUIREMENTS.md. The `db push` schema workflow is confirmed established from Phase 1. The `$transaction` pattern in `take-turn.ts` is already in place at lines 297–313 — `character.update` is appended inside it alongside the existing `message.create` and `game.update`.

**Primary recommendation:** Implement in file dependency order — schema first, then `lib/xp.ts`, then `take-turn.ts`, then `get-game.ts`, then the UI. Each step is unblocked by the previous.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| XP threshold table and level computation | Pure utility module (`lib/xp.ts`) | — | No DB or framework dependency; must be testable in isolation |
| Encounter detection signal | AI layer (Claude JSON output) | — | Claude signals `encounterResult`; code owns the XP amount |
| XP award and level write | Server action (`take-turn.ts`) | Database (Prisma transaction) | Atomic write inside existing `$transaction`; rules engine owns the values |
| XP/level read for display | Server action (`get-game.ts`) | — | Added to existing character select; server-authoritative re-fetch pattern |
| XP bar rendering | Client component (`page.tsx` PartyTab) | — | Reads from `gameData.partyMembers` post-getGame re-fetch; no client state |

---

## Standard Stack

No new packages required. All capabilities are implemented with the existing stack.

### Existing Stack Used

| Tool | Version | Role in Phase 2 |
|------|---------|-----------------|
| Prisma 7.8.0 | [VERIFIED: codebase] | Schema change (`db push`), `character.update` in `$transaction` |
| `@prisma/adapter-neon` 7.8.0 | [VERIFIED: codebase] | Neon WebSocket adapter — no changes, already wired in `lib/prisma.ts` |
| TypeScript 5.x | [VERIFIED: codebase] | Pure module `lib/xp.ts`, type extensions |
| Vitest 4.1.7 | [VERIFIED: codebase] | Unit tests for `lib/xp.ts` |
| TailwindCSS 4.x | [VERIFIED: codebase] | XP bar markup in `PartyTab` |

### Package Legitimacy Audit

No new external packages are installed in this phase. Audit not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Player submits chip action
         │
         ▼
  take-turn.ts
  ├── sanitizeChipText()
  ├── auth check (Supabase)
  ├── game load (includes storyPrompt.difficulty via Prisma include)
  ├── rollD20Check() ─────── dice engine (lib/dice.ts)
  ├── anthropic.messages.create()
  │     └── system prompt includes ENCOUNTER RULES block
  │           └── Claude returns { narrative, stateDeltas, chips, encounterResult }
  ├── parse encounterResult from Claude JSON
  │     ├── "completed" → look up XP_BY_DIFFICULTY[storyPrompt.difficulty]
  │     │                  → computeLevel(character.xp + xpAwarded)
  │     │                  → if level up: inject "LEVEL UP: ..." into buildDynamicStatePrompt (next call)
  │     └── null / missing → xpAwarded = 0
  └── prisma.$transaction(tx)
        ├── tx.game.findUnique (version check — optimistic lock)
        ├── tx.message.create (DM narrative)
        ├── tx.game.update (state, version increment, nextCharId)
        └── tx.character.update (xp, level) ← NEW in Phase 2
                │
                ▼
         PostgreSQL (Neon)
                │
         getGame re-fetch (after chip click response)
                │
                ▼
         PartyTab renders XP bar
         reading m.character.xp / m.character.level
```

### Recommended Project Structure

No new directories. New file at:
```
lib/
├── dice.ts          # existing — pure dice engine
├── xp.ts            # NEW — XP_THRESHOLDS, XP_BY_DIFFICULTY, computeLevel, xpForNextLevel
├── dice.test.ts     # existing — dice unit tests
└── xp.test.ts       # NEW — XP unit tests (co-located, matching dice.test.ts pattern)
```

---

## XP-01: Schema Change

### Exact Fields to Add to Character Model

```prisma
// Source: REQUIREMENTS.md XP-01 + CONTEXT.md D-05
model Character {
  // ... existing fields ...
  xp    Int @default(0)
  level Int @default(1)
}
```

Add these two lines directly below the `charisma` field (last stat field) in the Character model block.

### Workflow

```bash
# 1. Edit prisma/schema.prisma (add xp and level fields)
# 2. Push schema to database
npm run db:push
# 3. Regenerate Prisma client (postinstall does this, but run explicitly after schema edit)
npx prisma generate
```

**Important:** This project uses `prisma db push` (not `prisma migrate dev`). There is no `migrations/` directory. This is the confirmed pattern from Phase 1 — `npm run db:push` maps to `prisma db push`. [VERIFIED: codebase — package.json scripts, STACK.md, Phase 1 CONTEXT.md]

**Neon adapter note:** `prisma db push` with the Neon adapter requires `DIRECT_URL` (not `DATABASE_URL`) for schema operations. This is already configured in `prisma.config.ts` reading from `.env.local`. [VERIFIED: codebase STACK.md]

### Existing Columns Not Affected

The current `Character` model has no `hp` or `maxHp` columns — HP is stored in `Game.state` JSON, not on the Character record. `xp` and `level` on the Character record are the correct location (they persist across games). [VERIFIED: codebase — `prisma/schema.prisma`]

---

## XP-02: lib/xp.ts Design

### Module Contract

`lib/xp.ts` is a pure TypeScript module — zero imports from Prisma, Supabase, Next.js, or any framework. [VERIFIED: codebase — `lib/dice.ts` establishes this pattern]

### XP_THRESHOLDS Array

```typescript
// Source: REQUIREMENTS.md XP-02 (authoritative)
// Index = level - 1. XP_THRESHOLDS[0] is the minimum XP for level 1 (always 0).
// XP_THRESHOLDS[N] is the cumulative XP required to reach level N+1.
export const XP_THRESHOLDS: readonly number[] = [0, 300, 900, 2700, 6500];
//                                                L1   L2   L3    L4    L5
```

Authoritative values from REQUIREMENTS.md XP-02: 0 / 300 / 900 / 2700 / 6500. [VERIFIED: codebase REQUIREMENTS.md]

### computeLevel Algorithm

```typescript
// Source: derived from XP_THRESHOLDS — level is the count of thresholds the character has met or exceeded
export function computeLevel(xp: number): number {
  // Find the highest level whose threshold the character has reached.
  // XP_THRESHOLDS has 5 entries for levels 1–5.
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

- `computeLevel(0)` → 1 (below first threshold, at level 1 start)
- `computeLevel(299)` → 1 (just below level 2 threshold)
- `computeLevel(300)` → 2 (exactly at level 2 threshold)
- `computeLevel(301)` → 2
- `computeLevel(899)` → 2
- `computeLevel(900)` → 3
- `computeLevel(2699)` → 3
- `computeLevel(2700)` → 4
- `computeLevel(6499)` → 4
- `computeLevel(6500)` → 5 (level cap)

### xpForNextLevel

```typescript
// Returns cumulative XP required for the NEXT level, or null if already at level cap.
export function xpForNextLevel(level: number): number | null {
  if (level >= XP_THRESHOLDS.length) return null; // level 5 = cap
  return XP_THRESHOLDS[level]; // XP_THRESHOLDS[level] is the threshold for (level + 1)
}
```

- `xpForNextLevel(1)` → 300
- `xpForNextLevel(2)` → 900
- `xpForNextLevel(3)` → 2700
- `xpForNextLevel(4)` → 6500
- `xpForNextLevel(5)` → null (at cap)

### XP_BY_DIFFICULTY Table

```typescript
// Source: CONTEXT.md D-04
export const XP_BY_DIFFICULTY: Record<string, number> = {
  Beginner: 50,
  Standard: 100,
  Veteran:  200,
};
```

`StoryPrompt.difficulty` is typed as `String` in the Prisma schema. The lookup uses the string value directly. If the difficulty value is not in the table (unexpected value), `XP_BY_DIFFICULTY[difficulty] ?? 0` safely defaults to 0 — no XP awarded for unknown difficulty strings. [VERIFIED: codebase — `prisma/schema.prisma` StoryPrompt model]

### Full lib/xp.ts Structure

```typescript
// ─── XP Engine ───────────────────────────────────────────────────────────────
// Pure TypeScript XP functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

export const XP_THRESHOLDS: readonly number[] = [0, 300, 900, 2700, 6500];

export const XP_BY_DIFFICULTY: Record<string, number> = {
  Beginner: 50,
  Standard: 100,
  Veteran:  200,
};

export function computeLevel(xp: number): number { ... }

export function xpForNextLevel(level: number): number | null { ... }
```

---

## XP-03: take-turn.ts Integration

### Insertion Points

The integration has four insertion points in `take-turn.ts`:

**1. Import lib/xp.ts** (top of file, after existing lib imports):
```typescript
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
```

**2. Extend TurnResult interface** (lines 159–166 in current file):
```typescript
interface TurnResult {
  success:      boolean;
  narrative?:   string;
  chips?:       string[];
  newState?:    Record<string, unknown>;
  error?:       string;
  diceResult?:  D20Result;
  leveledUp?:   boolean;   // NEW — true if character leveled up this turn
  newLevel?:    number;    // NEW — new level value if leveled up
}
```

**3. Parse encounterResult and compute XP award** (after `parsed` JSON is available, before the `$transaction` block — approximately after line 261 in the current file):

```typescript
// ─── XP Award ────────────────────────────────────────────────────────────────
const encounterCompleted = parsed.encounterResult === "completed";
const xpAwarded = encounterCompleted
  ? (XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0)
  : 0;

const currentXp    = (currentCharacter.xp ?? 0) + xpAwarded;
const previousLevel = currentCharacter.level ?? 1;
const newLevel      = computeLevel(currentXp);
const didLevelUp    = newLevel > previousLevel;
```

**4a. Level-up injection into buildDynamicStatePrompt** — The level-up narration directive must be injected at the time of the Claude API call, not post-hoc. Since the turn flow is:

1. Compute dice result
2. Call Claude for narration (uses `buildDynamicStatePrompt`)
3. Parse Claude JSON (get `encounterResult`)
4. Award XP and determine level-up
5. Write to DB in `$transaction`

The level-up signal cannot be injected into the CURRENT turn's narration (Claude has already been called). It must be injected in the NEXT turn. However, CONTEXT.md D-06 says: "take-turn.ts injects a LEVEL UP note into the dynamic state system prompt sent to Claude." This is interpreted as: the system prompt for the CURRENT turn's narration call must include the level-up note IF a level-up is happening THIS turn.

The correct approach is to compute the XP award and level-up BEFORE the Claude API call, using the pre-transaction state:

```
// Before the Claude API call:
const xpAwarded = ...;   // can be computed before Claude (encounterResult comes FROM Claude)
```

This creates a circular dependency: encounterResult comes from Claude, but we need to inject the level-up into the same Claude call. **Resolution:** The level-up injection goes into `buildDynamicStatePrompt` for the NEXT turn. Store `didLevelUp` and `newLevel` as part of game state OR inject them into the dynamic prompt on the subsequent call by reading them from the character record after the transaction.

**Simpler resolution aligned with CONTEXT.md:** Do the computation after Claude returns, then include the level-up fact in the SAME `buildDynamicStatePrompt` output by restructuring:

Actually the cleanest reading of D-06 is: parse encounterResult from Claude's JSON response → if level up → the SAME turn's response to the player includes the level-up narrative because the level-up injection happens before Claude writes the narrative for that turn.

Since `encounterResult` comes from Claude and we need it to know whether to inject, there is a sequencing issue. **Practical resolution (consistent with D-06):** After the STALE_TURN check and before writing to DB, check if level-up occurred, then make a second brief narration injection — OR accept that the level-up narrative happens on the NEXT turn. This is consistent with async gameplay where players review results after a re-fetch.

**Recommended approach (least invasive, no second Claude call):** The level-up injection is included in `buildDynamicStatePrompt` by passing a `levelUpNote` parameter. Since the XP award happens AFTER Claude returns, `levelUpNote` is always empty string on the CURRENT turn. The level-up note is stored in `newState` as a transient field `levelUpNote` and injected on the NEXT call. This is the minimal-change path.

**Alternative simpler approach (recommended for Phase 2 scope):** Simply log the level-up in the `$transaction` and have Claude weave it in on the NEXT turn by reading a `levelUpNote` field injected into `buildDynamicStatePrompt` from `gameState.levelUpNote`. This stores the note in `Game.state` for one turn.

```typescript
// In buildDynamicStatePrompt, add at the end:
if (gameState.levelUpNote) {
  return `${stateSection}${diceSection}${missDirective}\n\nLEVEL UP: ${gameState.levelUpNote}`;
}
// Then in newState before transaction:
if (didLevelUp) {
  newState.levelUpNote = `${currentCharacter.name} advanced to Level ${newLevel} this turn.`;
} else {
  delete newState.levelUpNote; // clear after one turn
}
```

**4b. character.update inside the $transaction** (inside the `prisma.$transaction` callback, after the existing `tx.game.update` call):

```typescript
// Inside prisma.$transaction(async (tx) => { ... }):
if (xpAwarded > 0 || didLevelUp) {
  await tx.character.update({
    where: { id: currentCharId },
    data:  { xp: currentXp, level: newLevel },
  });
}
```

Only update when there is something to write. This avoids a no-op write on every turn.

### storyPrompt.difficulty Availability

`game.storyPrompt.difficulty` is already available without any Prisma include change. The initial `prisma.game.findUnique` at the top of `takeTurn` already includes `storyPrompt: true` [VERIFIED: codebase — `take-turn.ts` line 179]. The `difficulty` field is a column on `StoryPrompt` [VERIFIED: codebase — `prisma/schema.prisma`].

### encounterResult JSON Parse

`encounterResult` is a new top-level field in the Claude JSON response. The existing parse block already handles malformed responses gracefully:

```typescript
// Existing parse block (lines ~251-261):
let parsed: { narrative: string; stateDeltas: Record<string, any>; chips: string[] };
try {
  const match = rawText.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(match?.[0] ?? rawText);
} catch {
  parsed = { narrative: rawText || "...", stateDeltas: {}, chips: [...] };
}
```

Extend the type:
```typescript
let parsed: {
  narrative:       string;
  stateDeltas:     Record<string, any>;
  chips:           string[];
  encounterResult?: "completed" | null;
};
```

Access `parsed.encounterResult` after the parse. If Claude omits the field entirely (old system prompt still in effect), `parsed.encounterResult` is `undefined` — treat as `null` (no XP). The fallback parse object must also initialize `encounterResult: null`.

### RULES_ENGINE_KEYS Allowlist

The existing `RULES_ENGINE_KEYS` at line 279 already includes `"xp"` and `"level"`:
```typescript
const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
```
[VERIFIED: codebase — `take-turn.ts` line 279] These are already stripped from `stateDeltas` before merging. No change needed here.

### System Prompt: encounterResult Rules Block

Add to `buildStaticPrompt` inside the `RESPONSE RULES` section (after the chips schema):

```typescript
// Add after the chips line in the RESPONSE RULES JSON block:
`  "encounterResult": "completed" | null
// Set "completed" ONLY when a combat encounter fully resolves this turn:
// enemy is defeated, flees, or the room is cleared. Null on all other turns.
// Do not set "completed" for non-combat actions, exploration, or partial victories.`
```

---

## XP-04: get-game.ts Change

### Exact Character Select Modification

Current `get-game.ts` line 19–26:
```typescript
partyMembers: {
  include: {
    character: true,   // ← currently fetches full Character row
    user:      { select: { id: true, displayName: true, email: true } },
  },
  orderBy: { turnOrder: "asc" },
},
```

`character: true` already fetches all columns. After adding `xp` and `level` to the schema and running `db push`, these fields will be available on the returned `character` object automatically — no query change needed.

However, if the `include: { character: true }` pattern is already selecting all fields, the `xp` and `level` columns will appear on the returned object after the schema is updated. The CONTEXT.md D-11 note about "adding `xp` and `level` to the character select" refers to a select-based query. Since the current query uses `character: true` (not `character: { select: { ... } }`), the new columns appear automatically.

**Action required:** Verify `character: true` behavior — `true` means include all columns. After `db push` adds `xp` and `level`, they will be present in the response. No query modification needed in `get-game.ts`. [VERIFIED: codebase — `get-game.ts` line 22: `character: true`]

**TypeScript side:** The `CharacterData` interface in `page.tsx` must be extended to include `xp: number` and `level: number` so the TypeScript compiler accepts `m.character.xp` and `m.character.level` in the PartyTab.

### CharacterData Interface Extension in page.tsx

```typescript
// Current (lines 32-41 in page.tsx):
interface CharacterData {
  id:             string;
  name:           string;
  characterClass: string;
  strength:       number;
  // ... stats ...
}

// Extended:
interface CharacterData {
  id:             string;
  name:           string;
  characterClass: string;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
  xp:             number;   // NEW
  level:          number;   // NEW
}
```

---

## XP-04 (continued): Party Tab UI

### XP Bar Markup Pattern

The existing HP bar pattern in `PartyTab` (lines 563–574) is the exact template to replicate:

```tsx
{/* HP bar — EXISTING pattern */}
<div className="space-y-1">
  <div className="flex justify-between text-xs text-slate-500">
    <span>HP</span>
    <span className="font-mono">{hp} / {maxHp}</span>
  </div>
  <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
    <div
      className={`h-full rounded-full ${hpBarColor(hp, maxHp)}`}
      style={{ width: `${hpPct}%` }}
    />
  </div>
</div>
```

XP bar reuses the same structure. Insert directly below the HP bar `</div>` closing tag:

```tsx
{/* XP bar — NEW */}
{(() => {
  const xp        = m.character.xp;
  const level     = m.character.level;
  const atCap     = level >= 5;
  const nextXp    = atCap ? null : xpForNextLevel(level);
  const prevXp    = XP_THRESHOLDS[level - 1];   // cumulative XP at start of this level
  const xpInLevel = xp - prevXp;
  const xpNeeded  = nextXp !== null ? nextXp - prevXp : 1;
  const xpPct     = atCap ? 100 : Math.max(0, Math.min(100, (xpInLevel / xpNeeded) * 100));
  const label     = atCap
    ? `Level ${level}  ·  MAX`
    : `Level ${level}  ·  XP: ${xp} / ${nextXp}`;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{label}</span>
      </div>
      <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${xpPct}%` }}
        />
      </div>
    </div>
  );
})()}
```

**Notes:**
- `h-1.5` makes the XP bar slightly slimmer than the HP bar (`h-2`) to establish visual hierarchy.
- `bg-blue-500` is distinct from HP colors (green/amber/red). [ASSUMED — specific shade; adjust to taste]
- The bar fill represents progress within the current level, not cumulative XP. E.g., level 2 starts at 300 XP and level 3 begins at 900 XP — a character with 600 XP is 50% of the way through level 2.
- Import `xpForNextLevel` and `XP_THRESHOLDS` from `lib/xp` at the top of `page.tsx`.

### Data Availability

`m.character.xp` and `m.character.level` are available on `gameData.partyMembers` after the `getGame` re-fetch triggered in `handleChipClick` (lines 213–217 in `page.tsx`). The re-fetch fires after every successful turn and updates `gameData` via `setGameData`. `PartyTab` receives `partyMembers` from `gameData` (line 347). [VERIFIED: codebase — `page.tsx` lines 213–217, 347]

---

## XP-05: Test Plan

### Test File

`lib/xp.test.ts` — co-located with `lib/xp.ts`, matching the `lib/dice.test.ts` pattern exactly. [VERIFIED: codebase — `vitest.config.ts` includes `**/*.test.ts`]

### Test Framework Pattern

```typescript
// Source: lib/dice.test.ts — established project pattern
import { describe, it, expect } from 'vitest'
import { computeLevel, xpForNextLevel, XP_THRESHOLDS } from './xp'
```

No `globals: true` — must import `describe`, `it`, `expect` explicitly. [VERIFIED: codebase — `vitest.config.ts`: `globals: false`]

### computeLevel Boundary Values (XP-05)

All 10 boundary cases from the requirements:

| XP Input | Expected Level | Boundary Description |
|----------|----------------|----------------------|
| 0 | 1 | Level 1 start (exactly at threshold[0]) |
| 299 | 1 | One below level 2 threshold |
| 300 | 2 | Exactly at level 2 threshold |
| 301 | 2 | One above level 2 threshold |
| 899 | 2 | One below level 3 threshold |
| 900 | 3 | Exactly at level 3 threshold |
| 2699 | 3 | One below level 4 threshold |
| 2700 | 4 | Exactly at level 4 threshold |
| 6499 | 4 | One below level 5 threshold (cap) |
| 6500 | 5 | Exactly at level 5 threshold (cap) |

Additional cases to consider:
- Very large XP (e.g., 99999) → 5 (does not exceed level cap)
- Negative XP → 1 (graceful floor)

### xpForNextLevel Tests (XP-05)

| Level Input | Expected Output | Boundary Description |
|-------------|-----------------|----------------------|
| 1 | 300 | Next threshold for level 1 character |
| 2 | 900 | Next threshold for level 2 character |
| 3 | 2700 | Next threshold for level 3 character |
| 4 | 6500 | Next threshold for level 4 character |
| 5 | null | At cap — no next level |

### Test Pattern (following dice.test.ts)

```typescript
describe('computeLevel', () => {
  it('0 XP → level 1 (level 1 start)', () => {
    expect(computeLevel(0)).toBe(1)
  })
  it('299 XP → level 1 (one below L2 threshold)', () => {
    expect(computeLevel(299)).toBe(1)
  })
  it('300 XP → level 2 (exactly at L2 threshold)', () => {
    expect(computeLevel(300)).toBe(2)
  })
  // ... continue for all 10 values
})

describe('xpForNextLevel', () => {
  it('level 1 → 300', () => expect(xpForNextLevel(1)).toBe(300))
  it('level 2 → 900', () => expect(xpForNextLevel(2)).toBe(900))
  it('level 3 → 2700', () => expect(xpForNextLevel(3)).toBe(2700))
  it('level 4 → 6500', () => expect(xpForNextLevel(4)).toBe(6500))
  it('level 5 → null (at cap)', () => expect(xpForNextLevel(5)).toBeNull())
})
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XP progress bar percentage | Custom clamp logic scattered across components | Inline `Math.max(0, Math.min(100, ...))` pattern (one-liner) | Already used in PartyTab for `hpPct` |
| Level lookup | Binary search or complex formula | Simple `for` loop over 5-element `XP_THRESHOLDS` | 5 levels — O(1) in practice |
| XP award race condition | Client-side XP tracking | Authoritative DB write inside existing `$transaction` | Prevents desync with concurrent turns |

**Key insight:** The XP_THRESHOLDS array has only 5 entries. Clarity beats cleverness — a plain `for` loop is correct and readable.

---

## Common Pitfalls

### Pitfall 1: character.update Inside $transaction with Neon Adapter

**What goes wrong:** Attempting to call `tx.character.update()` inside `prisma.$transaction()` may fail or behave unexpectedly with the Neon serverless WebSocket adapter if the transaction times out on a cold Vercel function start.

**Why it happens:** The Neon adapter uses WebSocket connections. Serverless transactions have shorter timeouts than traditional Postgres. The existing `$transaction` in `take-turn.ts` is already proven to work (Phase 1 shipped it) — adding a single `character.update` call does not increase transaction complexity materially.

**How to avoid:** Keep the `character.update` as the last operation inside the transaction (after `game.update`). Do not add any async operations between the version check and the writes. The existing STALE_TURN error handling already covers transaction abort.

**Warning signs:** `STALE_TURN` errors on every turn after the character.update is added → inspect whether the character query is adding latency before the version check.

### Pitfall 2: JSON Parse of encounterResult from Claude

**What goes wrong:** Claude may return `encounterResult` as a truthy string other than `"completed"` (e.g., `"true"`, `"yes"`, `"done"`), or may omit the field entirely.

**Why it happens:** Claude follows instructions imperfectly, especially for newly added JSON fields. The system prompt rules must be explicit. The code must only accept the exact string `"completed"` — nothing else triggers XP.

**How to avoid:**
```typescript
const encounterCompleted = parsed.encounterResult === "completed";
// Not: if (parsed.encounterResult) — truthy check would accept any string
```

**Warning signs:** XP being awarded every turn → Claude is setting `encounterResult` to a non-null truthy value on every response.

### Pitfall 3: Level Cap Handling at Level 5

**What goes wrong:** `computeLevel` returns 5 for any XP >= 6500. If `character.level` is already 5, `character.update` should still update `character.xp` (XP can accumulate beyond 6500 even at cap) but should not write `level: 6`. The `newLevel = computeLevel(currentXp)` call correctly caps at 5 since `XP_THRESHOLDS` has only 5 entries.

**Why it happens:** Off-by-one in the level computation, or confusion between "level cap" and "XP cap."

**How to avoid:** XP is always accumulated (`character.xp = currentXp` always written when encounter completes). Level is written only when it changes. At level 5 with more XP: `newLevel = 5`, `previousLevel = 5`, `didLevelUp = false`. The `character.update` still writes the new `xp` value but `level` stays 5.

**`xpForNextLevel` at cap:** Returns `null`. The UI bar shows `Level 5  ·  MAX` with 100% fill. No division by zero possible if the code checks `atCap` before computing percentage.

### Pitfall 4: XP Bar Progress Within-Level vs. Cumulative

**What goes wrong:** Using `(xp / xpForNextLevel) * 100` as the percentage gives the wrong bar fill. A character with 600 XP (level 2) would show 600/900 = 67% but they are actually 50% through level 2 (level 2 spans 300–900 XP).

**Why it happens:** XP_THRESHOLDS are cumulative. Progress within a level is `(xp - prevThreshold) / (nextThreshold - prevThreshold)`.

**How to avoid:** Use `xpInLevel / xpNeeded` where `xpInLevel = xp - XP_THRESHOLDS[level-1]` and `xpNeeded = nextXp - XP_THRESHOLDS[level-1]`. This is shown in the UI pattern above.

### Pitfall 5: Prisma Type After Schema Change

**What goes wrong:** `currentCharacter.xp` and `currentCharacter.level` may show TypeScript errors until `prisma generate` is run after `db push`. The Prisma client types are generated — they do not auto-update from schema edits.

**Why it happens:** The generated client at `generated/prisma/client/` is a snapshot from the last `prisma generate` run.

**How to avoid:** Run `npx prisma generate` (or `npm install` which runs the postinstall hook) after `db push`. Until then, the fields are available at runtime but TypeScript will not know about them.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (exists — verified) |
| Quick run command | `npm run test:run -- lib/xp.test.ts` |
| Full suite command | `npm run test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| XP-02 | `computeLevel` returns correct level at all 10 boundary XP values | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |
| XP-02 | `xpForNextLevel` returns correct threshold or null at levels 1–5 | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |
| XP-05 | All 10 threshold boundary values pass | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |

XP-01, XP-03, XP-04 involve DB schema, server actions, and UI — not unit-testable in isolation. Verification is by:
- XP-01: `npm run db:push` exits 0; `npx prisma studio` shows `xp`/`level` columns on Character
- XP-03: End-to-end via manual game turn with a "Beginner" story prompt
- XP-04: Visual inspection of Party tab after a turn that triggers `encounterResult: "completed"`

### Sampling Rate

- Per task commit: `npm run test:run -- lib/xp.test.ts`
- Per wave merge: `npm run test:run`
- Phase gate: Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/xp.test.ts` — covers XP-02 and XP-05 (does not exist yet)

*(Existing `lib/dice.test.ts` and `vitest.config.ts` are present and require no changes.)*

---

## Security Domain

XP award logic is server-authoritative and runs exclusively inside a server action. No client input influences the XP amount — the only client input is `chipText` (already sanitized). The `encounterResult` field from Claude is parsed and validated as strictly `=== "completed"` before any XP is awarded. The `RULES_ENGINE_KEYS` allowlist already blocks `xp` and `level` from being set via `stateDeltas`. [VERIFIED: codebase — `take-turn.ts` line 279]

| ASVS Category | Applies | Control |
|---------------|---------|---------|
| V5 Input Validation | yes | `encounterResult === "completed"` strict equality check; `XP_BY_DIFFICULTY[...] ?? 0` safe default |
| V4 Access Control | yes | XP awarded only after `currentCharId` is verified in the existing auth/turn-order check |
| V6 Cryptography | no | No cryptographic operations in this phase |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Prisma CLI | XP-01 (db push) | ✓ | 7.8.0 | — |
| Node.js | All | ✓ | 24.15.0 | — |
| Vitest | XP-05 (tests) | ✓ | 4.1.7 | — |

No missing dependencies. All required tools are present.

---

## Open Questions

1. **Level-up narration timing (D-06 sequencing)**
   - What we know: `encounterResult` comes FROM Claude's response; level-up injection needs to go INTO Claude's system prompt.
   - What's unclear: Whether the level-up note is in the same turn's narration or the next turn's.
   - Recommendation: Store `levelUpNote` in `Game.state` after the transaction. `buildDynamicStatePrompt` reads it on the next turn and then clears it from state. This is a one-turn delay but avoids a second API call and stays within the existing prompt structure. This matches the `consecutiveMisses` pattern already in the codebase.

2. **`character.update` when xpAwarded = 0 (non-encounter turns)**
   - What we know: Most turns will not have `encounterResult: "completed"`.
   - Recommendation: Skip `character.update` entirely when `xpAwarded === 0` and `didLevelUp === false`. This avoids a no-op DB write on every turn.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bg-blue-500` is a suitable XP bar color (distinct from HP colors) | Party tab UI | Visual only — no functional risk; adjust color in that task |
| A2 | Level-up note stored in `Game.state.levelUpNote` for one turn is the correct D-06 interpretation | take-turn.ts integration | If user wants same-turn level-up narration, requires a second Claude call — high cost |

---

## Sources

### Primary (HIGH confidence)
- `.planning/phases/02-xp-system/02-CONTEXT.md` — locked decisions D-01 through D-11
- `.planning/REQUIREMENTS.md` — XP_THRESHOLDS authoritative values (0/300/900/2700/6500), XP-01 through XP-05
- `app/actions/take-turn.ts` — verified $transaction location, RULES_ENGINE_KEYS content, parsed JSON shape, storyPrompt include
- `app/actions/get-game.ts` — verified `character: true` include pattern
- `app/game/[id]/page.tsx` — verified HP bar pattern, PartyTab structure, getGame re-fetch after chip click
- `lib/dice.ts` — verified pure module pattern (no Prisma imports), injectable rollFn, export style
- `lib/dice.test.ts` — verified test pattern (explicit vitest imports, co-located file)
- `prisma/schema.prisma` — verified Character model columns, StoryPrompt.difficulty type, no existing xp/level fields
- `vitest.config.ts` — verified globals: false, include pattern, coverage config
- `.planning/codebase/STACK.md` — Prisma 7.8.0 + Neon adapter, `db push` workflow confirmed
- `.planning/codebase/ARCHITECTURE.md` — server action pattern, Prisma singleton, $transaction location

### Secondary (MEDIUM confidence)
- `.planning/phases/01-dice-engine-critical-bug-fixes/01-CONTEXT.md` — `db push` workflow confirmation, $transaction pattern establishment

---

## Metadata

**Confidence breakdown:**
- Schema change: HIGH — exact fields from REQUIREMENTS.md, workflow confirmed in codebase
- lib/xp.ts: HIGH — threshold values authoritative from REQUIREMENTS.md, algorithm is straightforward math
- take-turn.ts integration: HIGH — insertion points verified by reading the file; level-up timing is MEDIUM (open question A2)
- get-game.ts: HIGH — `character: true` already fetches all columns; no query change needed
- UI: HIGH — HP bar pattern directly reused; XP bar color is ASSUMED (A1)
- Tests: HIGH — threshold values authoritative, test pattern directly mirrors dice.test.ts

**Research date:** 2026-05-21
**Valid until:** 2026-06-21 (stable stack — Prisma/Next.js versions pinned in package-lock.json)
