# Roadmap: D&D Mechanics — Leveling, XP & Skills

**Project:** Async AI D&D Web App
**Milestone:** Mechanics v1 — Levels 1–5
**Created:** 2026-05-21
**Granularity:** standard

---

## Phases

- [x] **Phase 1: Dice Engine & Critical Bug Fixes** - Replace AI-invented rolls with a deterministic TypeScript engine; fix prompt injection and race condition; establish test infrastructure.
- [x] **Phase 2: XP System** - Players earn XP at encounter end via code; XP persists on Character; level computed from cumulative total; progress visible in UI.
- [x] **Phase 3: Leveling** - Characters auto-level when XP crosses D&D Basic Rules thresholds (levels 1–5); max HP and proficiency bonus update per class hit die; Claude locked out of HP/XP/level via stateDeltas allowlist. (completed 2026-05-23)
- [ ] **Phase 4: Skills & Abilities Integration** - `Character.skillProficiencies` stored per-character; skill checks resolved in TypeScript with token-efficient keyword for Claude; Abilities sub-tab wired to ClassFeature DB; Stats sub-tab proficiency live-wired from DB.

---

## Phase Details

### Phase 1: Dice Engine & Critical Bug Fixes

**Goal:** A deterministic TypeScript dice engine replaces all AI-invented rolls; prompt injection and race conditions in take-turn are eliminated; Vitest is installed and core dice functions are fully tested.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** DICE-01, DICE-02, DICE-03, DICE-04, DICE-05
**Success Criteria:**

1. Running `npm test` executes the Vitest suite and all dice unit tests pass without database connectivity (pure functions have zero Prisma imports).
2. A submitted player action produces a dice roll result computed entirely in TypeScript — the Claude narration call receives the completed `D20Result` object and cannot alter the roll value.
3. Submitting a `chipText` value containing injection patterns (e.g., `SYSTEM:`, backticks) does not alter the system prompt; the input is sanitized before use.
4. Two concurrent turn submissions for the same game return one success and one `STALE_TURN` error — the database state reflects exactly one mutation.
5. The `rollD20Check` function returns an audit-trail object `{ roll, modifier, total, dc, success }` verifiable in test output at DC boundary conditions.

**Plans:** 5/5 complete

Plans:

- [x] 01-01-PLAN.md — Vitest install and configuration
- [x] 01-02-PLAN.md — lib/dice.ts engine + lib/dice.test.ts unit tests
- [x] 01-03-PLAN.md — Schema migration: Game.version column
- [x] 01-04-PLAN.md — take-turn.ts refactor: sanitization + $transaction + dice integration
- [x] 01-05-PLAN.md — Dice card UI in FieldTab

### Phase 2: XP System

**Goal:** Players earn experience points at encounter end through code-owned logic; XP accumulates on the Character record across games; level is derived from cumulative XP; the game UI surfaces current XP, level, and progress to next level.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** XP-01, XP-02, XP-03, XP-04, XP-05
**Success Criteria:**

1. After defeating an encounter, the character's `xp` column in the database increments by the correct CR-derived value — Claude's response has no path to alter this number.
2. A character whose XP crosses a threshold (e.g., reaches 300) has their `level` column updated to 2 within the same database transaction that awarded the XP.
3. The character status panel displays current XP, current level, and XP remaining to the next level without a page reload after a turn completes.
4. Unit tests for `computeLevel` pass at all 10 boundary values (0, 299, 300, 301, 899, 900, 2699, 2700, 6499, 6500).
5. XP awarded to a character persists when they join a new game — it is stored on `Character`, not inside the `Game.state` blob.

**Plans:** 3/3 plans complete

Plans:

- [x] 02-01-PLAN.md — Schema (xp/level on Character + db:push) + lib/xp.ts engine + lib/xp.test.ts unit tests
- [x] 02-02-PLAN.md — take-turn.ts integration: encounterResult parsing, XP award in $transaction, levelUpNote prompt injection
- [x] 02-03-PLAN.md — Party tab XP bar UI: CharacterData extension + XP progress bar in PartyTab

### Phase 3: Leveling

**Goal:** Characters automatically level from 1 to 5 as XP thresholds are crossed; max HP increases by the correct class hit die average plus CON modifier at each level; the proficiency bonus updates at level 5; Claude cannot write HP, XP, or level values through stateDeltas.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** LVL-01, LVL-02, LVL-03, LVL-04, LVL-05
**Success Criteria:**

1. A character that gains enough XP to skip from level 1 to level 3 in one encounter has their `maxHp` increased for each intermediate level individually — no HP gain is skipped.
2. A newly created Fighter has starting max HP of 10 + CON modifier; a Wizard has 6 + CON modifier — the character creation flow no longer hardcodes 10 for all classes.
3. At level 5, `proficiencyBonus(level)` returns 3; at levels 1–4 it returns 2 — confirmed by unit tests with no formula involved.
4. A Claude response that includes `hp`, `maxHp`, `xp`, or `level` in its `stateDeltas` payload is rejected; the rules engine applies no change for those keys.
5. Unit tests cover `maxHpAtLevel` for all 4 classes at levels 1–5 with CON modifiers of −2, 0, and +3.

**Plans:** 4/4 plans complete

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Schema migration (Character.maxHp) + lib/leveling.ts + lib/leveling.test.ts + post-migration backfill (LVL-01, LVL-05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Character creation + adventure start wire-up: maxHpAtLevel on create, read canonical maxHp on adventure start (LVL-03)
- [x] 03-03-PLAN.md — take-turn.ts $transaction extension: atomic maxHp update + levelUpResult return shape + LVL-04 allowlist verification + multi-level-up test (LVL-02, LVL-04, LVL-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-04-PLAN.md — LevelUpCard UI in FieldTab: indigo info card showing level/HP/proficiency deltas (LVL-02 user-facing slice)

### Phase 4: Skills & Abilities Integration

**Goal:** Integrate Skills and Abilities mechanics into the existing Party tab sub-tabs. `Character.skillProficiencies` stores per-character picks chosen at creation; in-game skill checks resolve as d20 + ability modifier + proficiency bonus in TypeScript and reach Claude as a compact token-efficient keyword — not raw numbers; the Abilities sub-tab is wired to the `ClassFeature` DB table and surfaces newly-unlocked features on level-up.
**Mode:** mvp
**Depends on:** Phase 3 + post-Phase 03 manual work (Party tab sub-tabs, ClassProgression/ClassFeature tables, EquippableItem)
**Requirements:** SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05
**Success Criteria:**

1. A Fighter character's Stats sub-tab shows their 2 chosen skills highlighted with proficiency bonus applied — proficiency data is read from `Character.skillProficiencies` in the DB, not the hardcoded `SKILL_PROFS` fallback in `lib/character-sheet.ts`.
2. During character creation, a Fighter can select exactly 2 skills from the Fighter-allowed list; attempting to submit more than 2 is rejected server-side; the selection is persisted to `Character.skillProficiencies`.
3. When a player action triggers a Stealth check, `resolveSkillCheck("Stealth", character)` runs in `take-turn.ts` and Claude's narration call receives a compact metadata keyword `[SKILL skill=Stealth outcome=SUCCESS]` — Claude's narrative describes the result without mentioning the roll number, DC, or proficiency bonus.
4. A proficient character's skill check total equals d20 roll + ability modifier + proficiency bonus; a non-proficient character's total equals d20 roll + ability modifier only — both paths confirmed by unit tests in `lib/skills.test.ts`; all 18 skill-to-ability mappings tested.
5. The Abilities sub-tab fetches `ClassFeature` records from the DB for each character's class and level range; the hardcoded `CLASS_FEATURES` map in `page.tsx` is removed; when a character's level increases, the Abilities sub-tab on next render shows newly-unlocked features with a visual indicator.

**Plans:** 5 plans

**Wave 1 — parallel (no inter-dependencies):**

- [ ] 04-01-PLAN.md — `Character.skillProficiencies String[]` migration; inline class-gated skill-pick at character creation (multi-select, count enforced, class change resets picks, server-side allowed-list validation); backfill script seeds existing characters with thematic class defaults (e.g. Fighter → Athletics + Intimidation, Rogue → Stealth + Perception)
- [ ] 04-02-PLAN.md — Abilities sub-tab DB wiring: `getClassFeatures(characterClass, maxLevel)` server action returns all features unlocked up to current level, grouped by level (cumulative reference list); `MemberAbilitiesPane` reads from `ClassFeature` DB; "New" badge on features at `character.level`; removes hardcoded `CLASS_FEATURES`
- [ ] 04-03-PLAN.md — `lib/skills.ts` pure module: `resolveSkillCheck()` with injectable `rollFn`; `SKILL_ABILITY_MAP` (18 entries); `lib/skills.test.ts` unit tests (proficient, non-proficient, all 18 mappings)

**Wave 2 — depends on 04-01 + 04-03:**

- [ ] 04-04-PLAN.md — `take-turn.ts` skill check integration: Call #1 output schema extended with optional `skillName`; `resolveSkillCheck()` runs before Call #2; compact `[SKILL skill=X outcome=Y dc=N]` keyword injected into Call #2 system prompt `MECHANICAL CONTEXT` block; failed checks write a `stateDeltas` flag (e.g. `guardsAlerted: true`) — downstream consequences of flags deferred to a later phase; narration rules updated to forbid raw number exposure; `SkillCheckCard` UI component in FieldTab

**Wave 3 — depends on 04-01 + 04-04:**

- [ ] 04-05-PLAN.md — Stats sub-tab live proficiency wire-up: `getCharacterSheetData()` accepts `skillProficiencies` from DB; `MemberStatsPane` passes live data; `SKILL_PROFS` hardcoded fallback removed

**UI hint**: yes — Stats sub-tab proficiency highlight, Abilities sub-tab level-unlock badge, SkillCheckCard in FieldTab

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Dice Engine & Critical Bug Fixes | 5/5 | Complete | 2026-05-22 |
| 2. XP System | 3/3 | Complete | 2026-05-22 |
| 3. Leveling | 4/4 | Complete    | 2026-05-23 |
| 4. Skills & Abilities Integration | 0/5 | Planned — ready to execute | - |
