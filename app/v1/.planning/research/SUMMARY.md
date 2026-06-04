# Research Summary: D&D Mechanics Implementation

**Synthesized:** 2026-05-21
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, PROJECT.md
**Scope:** Levels 1–5, D&D Basic Rules 2014

---

## Stack Recommendation

### Install (dev dependencies)

```bash
npm install -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

### Minimal `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/generated/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/actions/**'],
      exclude: ['lib/prisma.ts', 'lib/supabase-*.ts', 'lib/ai-config.ts', '**/*.d.ts'],
    },
  },
})
```

Add to `package.json`: `"test": "vitest"`, `"test:run": "vitest run"`, `"test:coverage": "vitest run --coverage"`.
Use `test:run` in CI — `vitest` alone hangs non-interactive terminals.

### Critical Gotcha: `lib/prisma.ts` throws at import time

`lib/prisma.ts` has an unconditional `throw` on line 7 if `DATABASE_URL` is missing. Every pure function module (`lib/dice.ts`, `lib/xp.ts`, `lib/leveling.ts`, `lib/skills.ts`) must have zero imports from `lib/prisma.ts`. Use type-only imports when Prisma types are needed:

```ts
import type { Character } from '@prisma/client'  // safe — erased at runtime
```

---

## D&D Rules Reference (Levels 1–5)

### XP Thresholds — Cumulative Totals (NOT deltas)

| Level | Total XP Required | XP Gain from Previous |
|-------|-------------------|-----------------------|
| 1     | 0                 | —                     |
| 2     | 300               | 300                   |
| 3     | 900               | 600                   |
| 4     | 2,700             | 1,800                 |
| 5     | 6,500             | 3,800                 |

Store `character.xp` as a monotonically increasing integer. Compute level by table lookup. Never reset XP on level-up. Never store `xpToNextLevel`.

### Monster CR → XP (Party-relevant CRs)

| CR  | XP  | CR  | XP    |
|-----|-----|-----|-------|
| 0   | 10  | 1   | 200   |
| 1/8 | 25  | 2   | 450   |
| 1/4 | 50  | 3   | 700   |
| 1/2 | 100 | 4   | 1,100 |

For party play: `Math.floor(totalXp / participantCount)` per character.

### Proficiency Bonus by Level

| Levels | Bonus |
|--------|-------|
| 1–4    | +2    |
| 5      | +3    |

Use `if (level >= 5) return 3; return 2;` — do NOT use a formula. Do NOT store as a column; derive from level.

### HP Per Class

| Class   | Hit Die | Level 1 HP (max die) | Levels 2–5 gain (avg)    |
|---------|---------|----------------------|--------------------------|
| Fighter | d10     | 10 + CON mod         | 6 + CON mod              |
| Rogue   | d8      | 8 + CON mod          | 5 + CON mod              |
| Cleric  | d8      | 8 + CON mod          | 5 + CON mod              |
| Wizard  | d6      | 6 + CON mod          | 4 + CON mod              |

Level-up formula: `floor(die/2) + 1 + CON mod`. Do NOT roll — use fixed average for async play.

### Skills (18 total, governing ability in parens)

Acrobatics (DEX), Animal Handling (WIS), Arcana (INT), Athletics (STR), Deception (CHA), History (INT), Insight (WIS), Intimidation (CHA), Investigation (INT), Medicine (WIS), Nature (INT), Perception (WIS), Performance (CHA), Persuasion (CHA), Religion (INT), Sleight of Hand (DEX), Stealth (DEX), Survival (WIS).

### Skill Check Formula

```
Active check:  d20 + ability mod + (proficiency bonus if proficient)
Passive check: 10  + ability mod + (proficiency bonus if proficient)
```

Passive Perception is a stored value, re-evaluated only when stats change — never rolled per-move.

### Class Skill Proficiency Counts at Creation

| Class   | Count | Choose From                                                                                                                             |
|---------|-------|-----------------------------------------------------------------------------------------------------------------------------------------|
| Fighter | 2     | Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, Survival                                            |
| Wizard  | 2     | Arcana, History, Insight, Investigation, Medicine, Religion                                                                             |
| Rogue   | 4     | Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Performance, Persuasion, Sleight of Hand, Stealth   |
| Cleric  | 2     | History, Insight, Medicine, Persuasion, Religion                                                                                        |

---

## Architecture Decisions

### `lib/dice.ts` — Pure Function Module

Zero framework dependencies. Co-locate `dice.test.ts` beside it. Key exports:

- `rollDie(sides): number` — 1 to n
- `rollDice(count, sides): { rolls, total }` — XdY
- `abilityModifier(score): number` — `floor((score-10)/2)`
- `rollD20Check(modifier, dc): D20Result` — full audit trail: `{ roll, modifier, total, dc, success, critical, fumble }`
- `proficiencyBonus(level): number` — table lookup, not formula

Called from `take-turn.ts` Step 6 — before narration, never after. Make `rollFn` injectable in `resolveSkillCheck` so tests pass `() => fixedValue` without module mocking.

### XP and Level as Character Columns (not Game JSON blob)

```prisma
model Character {
  xp    Int @default(0)
  level Int @default(1)
}
```

XP persists across games. The `Game.state` blob is world state (positions, HP, plot flags) — not character advancement. `maxHp` must also migrate to `Character` (currently lives in `Game.state`). After migration, `Game.state` can carry current `hp` but `maxHp` is authoritative on `Character`.

### Prisma Interactive Transaction + Optimistic Lock

Add `version Int @default(0)` to `Game`. Current `Promise.all` in `take-turn.ts` lines 225–233 is non-atomic. Replace with:

```ts
await prisma.$transaction(async (tx) => {
  const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
  if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");
  // apply deltas, grant XP, check level-up, write message, advance turn
  await tx.game.update({ data: { ..., version: { increment: 1 } } });
});
```

Use the interactive (`async (tx) => {}`) form — the array form cannot re-read inside the transaction.

### Two-Call Claude Flow

| Call   | Input                         | Claude's Job                           | Claude Cannot Do               |
|--------|-------------------------------|----------------------------------------|--------------------------------|
| #1     | sanitizedAction               | Return `{ actionType, targetEntity, skillName }` | Emit HP, rolls, or state deltas |
| #2     | sanitizedAction + `D20Result` | Write immersive narrative around the given outcome | Change the outcome             |

User input embeds only in Call #2's user-turn message. Static system prompt is never contaminated with user input.

### Level-Up Inside the Transaction

Use a loop to handle multi-level jumps. Never use direct assignment from `computeLevel`:

```ts
while (computeLevel(newXp) > character.level) {
  character.level += 1;
  character.maxHp += hpGainForLevel(character);
}
```

Direct assignment skips intermediate HP gains (see Critical Pitfalls #5).

### Migration Sequencing (No Existing Migration History)

No `prisma/migrations/` directory exists — schema was applied via `db push`.

1. `prisma migrate dev --name init` to baseline current schema first.
2. Add columns with safe defaults: `xp Int @default(0)`, `level Int @default(1)`, `maxHp Int @default(10)`, `skillProficiencies String[] @default([])`.
3. Write backfill script to set correct `maxHp` for existing characters from class + CON.

### Build Order (Hard Dependencies)

```
1. lib/dice.ts + lib/xp.ts       (pure functions — no deps)
   vitest install + vitest.config.ts
   dice.test.ts, xp.test.ts

2. Schema migration               (Character.xp, .level, .maxHp, .skillProficiencies; Game.version)
   npx prisma migrate dev --name add-xp-level-skills-version
   Regenerate Prisma client

3. take-turn.ts refactor          (depends on 1 and 2)
   Input sanitization
   Two-call Claude split
   $transaction wrapping + level-up inside it

4. UI: XP bar + level badge       (depends on 2, parallel with 3)

5. Character creation skill step  (depends on 2)
```

---

## Critical Pitfalls

Ranked by likelihood of causing silent data corruption or a required rewrite.

| # | Pitfall | Impact | Prevention |
|---|---------|--------|------------|
| 1 | **AI owns HP deltas right now** | All leveling math is overwritten by AI on next turn | Build dice engine first; remove `hp` from AI-writable `stateDeltas` keys once engine is live |
| 2 | **XP thresholds are cumulative totals, not deltas** | Silent wrong levels | Store monotonic `xp` int; test all 10 boundary values: 0, 299, 300, 301, 899, 900, 2699, 2700, 6499, 6500 |
| 3 | **Race condition on concurrent submissions blocks XP grant** | XP double-awarded; state corruption | `$transaction` with version guard must land before XP grant is wired |
| 4 | **`maxHp` drifts between `Character` table and `Game.state` blob** | Level-up updates one; game reads the other | Migrate `maxHp` to `Character`; update both in same transaction on level-up |
| 5 | **Multi-level jump skips intermediate HP gains** | Character HP too low after large XP awards | Use `while` loop over `computeLevel`, not direct level assignment |

Additional pitfalls addressed per phase:

- Prompt injection via `chipText` — fix in Phase 1 while `take-turn.ts` is open; allowlist `stateDeltas` keys
- Passive Perception is a stored number, not a roll — design before coding Phase 4
- Natural 20 is NOT auto-success on skill checks — enforce in dice engine
- No `expertiseBonus` column — compute as `2 * getProficiencyBonus(level)`
- Do not use a formula for proficiency bonus — use `if (level >= 5) return 3; return 2;`

---

## Phase Implications

### Phase 1: Dice Engine + take-turn.ts Fixes

**Delivers:** `lib/dice.ts`, `lib/xp.ts`, Vitest setup, sanitized input, two-call Claude split, atomic transaction.

**Must include:**
- All dice functions with injectable `rollFn` for testing
- Sanitize `chipText`: strip newlines, enforce 200-char max, reject injection patterns (`SYSTEM:`, backticks, `ignore previous`)
- Allowlist `stateDeltas` keys — reject `hp`, `xp`, `level`, `maxHp`, `proficiencyBonus` from AI response
- Replace `Promise.all` with `$transaction` + version guard
- `Game.version` column migration

**Tests:** All 10 XP boundary values, proficient vs. non-proficient paths, critical/fumble flags.

**Research flag:** Standard patterns — no additional research needed.

---

### Phase 2: XP System

**Delivers:** XP granted at encounter end, `Character.xp` persists, XP progress visible in UI.

**Must include:**
- Baseline migration, then `Character.xp` and `Character.level` columns
- Monster CR → XP lookup table (code-owned; Claude never decides XP values)
- `grantXp()` inside the Phase 1 `$transaction` block
- `computeLevel()` called after XP grant; level-up detected by `newLevel > character.level`
- Explicit design decision logged for party XP split (recommended: full XP per participant for async play)

**Depends on:** Phase 1 transaction pattern in place first.

**Research flag:** Standard patterns — no additional research needed.

---

### Phase 3: Leveling

**Delivers:** Auto-level-up on XP threshold; `maxHp` and proficiency bonus recalculated correctly.

**Must include:**
- `maxHp` migrated from `Game.state` blob to `Character` table; backfill existing rows
- Level-up `while` loop — not direct assignment
- HP gain uses fixed average, not a roll
- Level 4 ASI is an explicit commented no-op
- Level-up event stored as a non-AI message type (or filtered from rolling window) to avoid context bloat

**Depends on:** Phase 1 transaction; Phase 2 XP migration.

**Research flag:** Migration baseline (M4 pitfall) is the setup risk — baseline migration must run before adding columns.

---

### Phase 4: Skills & Abilities Integration

**Context shift:** Phases 1–3 are complete. Between Phase 3 and the planning of Phase 4, the following was manually implemented and is now live:
- Party tab with three sub-tabs: **Stats** (`MemberStatsPane` — 6-stat grid + Actions & Skills list), **Inventory** (`MemberInventoryPane` — equipment slots + backpack), **Abilities** (`MemberAbilitiesPane` — proficiency bonus + class feature list)
- `EquippableItem` schema, seeded per-map, with `combatImpactLabel` as a token-efficient metadata keyword
- `ClassProgression` and `ClassFeature` schemas, seeded for Fighter/Rogue/Cleric/Wizard levels 1–20
- `Character.currentHp` column
- `lib/character-sheet.ts` — computes stats, save proficiencies, and skill modifiers from a `CharacterInput`

**Gap:** Both the skills displayed in the Stats sub-tab and the class features in the Abilities sub-tab currently use hardcoded lookup maps (`SKILL_PROFS` and `CLASS_FEATURES`). `Character` has no `skillProficiencies` column. No in-game skill check resolution exists.

**Delivers:**
- `Character.skillProficiencies String[]` migration + character creation skill-pick UI
- `lib/skills.ts` — `resolveSkillCheck()` with injectable `rollFn` for testing
- `take-turn.ts` skill check integration with **token-efficient metadata keyword** format for Claude context: `[SKILL skill=X outcome=Y]` — Claude narrates around the fact, not the numbers
- Abilities sub-tab wired to `ClassFeature` DB — removes hardcoded map; shows newly-unlocked features on level-up
- Stats sub-tab live proficiency — `getCharacterSheetData()` reads `skillProficiencies` from DB; removes `SKILL_PROFS` hardcoded fallback

**Must include:**
- `skillProficiencies String[]` migration on `Character` with `@default([])`
- Character creation inline skill-pick: after class selection, conditional multi-select renders class-allowed skills only; submit disabled until correct count selected; class change resets picks; server-side validation checks both count and allowed-list membership
- Backfill script: existing characters seeded with **thematic class defaults** — Fighter → Athletics + Intimidation, Rogue → Stealth + Perception, Cleric → Insight + Religion, Wizard → Arcana + Investigation (not first-N alphabetically)
- No level-up skill selection: picks are fixed at creation through level 5; proficiency bonus step at level 5 auto-improves all proficient skills via existing `proficiencyBonus(char.level)` — no UI interaction required
- `SKILL_ABILITY_MAP`: 18 skills mapped to governing ability — same structure as existing `SKILLS` array in `character-sheet.ts`
- `resolveSkillCheck(skillName, character, rollFn?)`: returns `SkillCheckResult { skill, ability, roll, modifier, proficiencyBonus, total, dc, success, proficient }`
- `take-turn.ts` intent detection: Call #1 output schema extended with optional `skillName`; if present, run `resolveSkillCheck()` before Call #2; inject compact keyword `[SKILL skill=X outcome=Y dc=N]` into Call #2 system prompt under `MECHANICAL CONTEXT` block (Claude instructed to consume silently, not reproduce)
- Failed skill checks write a **`stateDeltas` flag** (e.g. `guardsAlerted: true`); flag lands in `Game.state`; downstream gameplay consequences of the flag deferred to a future phase
- Narration guardrail additions: forbid reproducing the `MECHANICAL CONTEXT` block; forbid mentioning roll number, DC value, or proficiency bonus by name
- `getClassFeatures(characterClass, maxLevel)` server action: returns all `ClassFeature` records where `level ≤ maxLevel`, ordered by level — **cumulative reference list** (not just current-level features)
- `MemberAbilitiesPane` grouped-by-level display with "New" badge on features at exactly `character.level`
- Passive Perception as a computed stored value: `10 + WIS modifier + (Perception proficient ? profBonus : 0)` — never rolled

**Key constraints carried forward:**
- `lib/skills.ts` must have zero Prisma imports (pure functions only — same pattern as `lib/dice.ts`, `lib/xp.ts`, `lib/leveling.ts`)
- `rollFn` injectable: tests pass `() => fixedValue`, no module mocking
- Natural 20 on a skill check is NOT automatic success — only raises the total by 20; DC still governs outcome
- Rogue Expertise deferred: explicit commented no-op in `resolveSkillCheck()` expertise branch
- DCs are fixed values (5/10/15/20/25) — not scaled by level (bounded accuracy principle)

**Depends on:** Phases 1–3 complete; post-Phase 03 manual work (Party tab, ClassProgression/ClassFeature tables) live in codebase.

**Research flag:** No additional external research needed — D&D rules are stable and architecture patterns established.

---

## Open Questions

| Question | Phase | Recommendation |
|----------|-------|----------------|
| Heal on level-up? | 3 | No — `maxHp` increases, current `hp` unchanged. Standard D&D behavior. |
| XP split in party play? | 2 | Full XP per participant (not divided). Penalizing async absence breaks the UX contract. Must be explicit in code comments. |
| Level-up notification format? | 3 | DM narrative message announces level-up. Store as non-AI message type to avoid context bloat. |
| Rogue Expertise deferral? | 4 | Defer entirely for v1. Note the gap in code with a comment. Rogue is slightly underpowered but other classes are unaffected. |
| Passive Perception UX? | 4 | Map silently reveals objects when passive Perception clears the DC. No popup needed — object simply appears. Confirm before coding. |
| Backfill strategy for existing characters? | 4 | **Resolved:** thematic class defaults — Fighter → Athletics + Intimidation, Rogue → Stealth + Perception, Cleric → Insight + Religion, Wizard → Arcana + Investigation. |
| Failed skill check consequence scope? | 4 | **Resolved:** failed checks write a `stateDeltas` flag (e.g. `guardsAlerted: true`) into `Game.state`; downstream gameplay consequences of that flag are deferred to a later phase. |
| Abilities sub-tab: current level only or cumulative? | 4 | **Resolved:** cumulative — all features unlocked up to current level, grouped by level. Serves as a permanent reference sheet. |
| Skill pick timing — creation only or also level-up? | 4 | **Resolved:** creation only for levels 1–5. Proficiency bonus step at level 5 auto-improves all proficient skills; no additional UI required. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Vitest setup | HIGH | Official Next.js 16 docs (fetched 2026-05-19) explicitly recommend Vitest. Config matches actual project tsconfig. |
| D&D Rules | HIGH | Basic Rules 2014 is a fixed published document. Tables are static and unambiguous for levels 1–5. |
| Architecture | HIGH | Derived from direct codebase inspection of `take-turn.ts`, `schema.prisma`, `lib/prisma.ts`. Known bugs confirmed in actual code. |
| Pitfalls | HIGH | High-risk pitfalls confirmed against actual code paths, not speculation. |
| Migration approach | MEDIUM | No `migrations/` directory exists — baseline behavior on a schema-pushed DB should be verified before production. |
| Multi-player XP split | MEDIUM | Rules are clear; the async-specific design choice (full vs. split) is a product decision. Either is technically valid. |

**Overall: HIGH** — all four research areas converged on consistent, specific recommendations with direct codebase evidence.

---

## Sources

- D&D Basic Rules 2014 (Wizards of the Coast / dndbeyond.com)
- Next.js 16.2.6 official Vitest guide (fetched 2026-05-19)
- Prisma 7.8.0 documentation — interactive transactions
- Direct codebase inspection: `take-turn.ts`, `schema.prisma`, `lib/prisma.ts`, `start-game.ts`, `initialize-game.ts`
