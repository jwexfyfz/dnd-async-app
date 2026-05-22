# Requirements: D&D Mechanics — Leveling, XP & Skills

**Project:** Async AI D&D Web App
**Milestone:** Mechanics v1 — Levels 1–5
**Rules Authority:** D&D Basic Rules 2014
**Date:** 2026-05-21

---

## v1 Requirements

### Phase 1: Dice Engine & Critical Bug Fixes

- [ ] **DICE-01**: Developer can run `npm test` (Vitest installed with `vitest`, `@vitest/coverage-v8`, `vite-tsconfig-paths`; scripts `test`, `test:run`, `test:coverage` added to `package.json`)
- [ ] **DICE-02**: `lib/dice.ts` exports `rollDie(sides)`, `rollDice(count, sides)`, `abilityModifier(score)`, `proficiencyBonus(level)`, and `rollD20Check({ baseScore, proficient, proficiencyBonus, dc })` returning a full audit-trail object `{ roll, modifier, total, dc, success }`
- [ ] **DICE-03**: `take-turn.ts` sanitizes `chipText` input before use (strip/escape special characters, enforce max length); `chipText` is placed only in the user-turn message of the narration call — never embedded in the system prompt
- [ ] **DICE-04**: `take-turn.ts` wraps all state mutation in a Prisma interactive transaction using `Game.version` as an optimistic lock; concurrent submissions return a `STALE_TURN` error instead of silently corrupting state

**Tests (DICE phase):**
- [ ] **DICE-05**: Unit tests cover `rollDie` (min/max bounds), `rollDice` (sum), `abilityModifier` (stat 1–20 boundary cases), `proficiencyBonus` (levels 1–5 exact values), `rollD20Check` (success/fail at DC boundary)

---

### Phase 2: XP System

- [ ] **XP-01**: Prisma migration adds `xp Int @default(0)` and `level Int @default(1)` columns to the `Character` model; migration is applied cleanly after baselining the existing pushed schema
- [ ] **XP-02**: `lib/xp.ts` exports `XP_THRESHOLDS` (cumulative table: 0/300/900/2700/6500), `computeLevel(xp: number): number`, `xpForNextLevel(level: number): number | null` (null at level cap)
- [ ] **XP-03**: At encounter end, `take-turn.ts` awards XP from code (not Claude); XP is added to `character.xp` inside the transaction; `computeLevel()` is called and if level increased, the new level is written to `character.level`
- [ ] **XP-04**: Game UI displays current XP, current level, and XP remaining to next level on the character status panel

**Tests (XP phase):**
- [ ] **XP-05**: Unit tests cover `computeLevel` at every threshold boundary (exact value, one below, one above) and `xpForNextLevel` at levels 1–5

---

### Phase 3: Leveling

- [ ] **LVL-01**: `lib/leveling.ts` exports `maxHpAtLevel(characterClass, constitution, level): number` (class-aware hit die: Fighter d10/6, Rogue d8/5, Cleric d8/5, Wizard d6/4; level 1 = max die + CON mod; subsequent levels = average die + CON mod); `proficiencyBonus(level)` moved here or re-exported from `lib/dice.ts`
- [ ] **LVL-02**: Level-up logic runs synchronously inside the `take-turn` Prisma transaction: when XP crosses a threshold, `character.level` increments, `character.maxHp` increases by the correct class hit die average + CON mod, and if multiple thresholds are crossed the loop processes each level individually
- [ ] **LVL-03**: Character creation correctly calculates starting max HP per class (Fighter: 10 + CON mod, Rogue: 8 + CON mod, Cleric: 8 + CON mod, Wizard: 6 + CON mod) instead of hardcoding 10 for all classes
- [ ] **LVL-04**: Claude's `stateDeltas` response is validated against an allowlist before being applied; keys `hp`, `maxHp`, `xp`, `level` are rejected if present in `stateDeltas` — the rules engine owns these exclusively

**Tests (Leveling phase):**
- [ ] **LVL-05**: Unit tests cover `maxHpAtLevel` for all 4 classes at levels 1–5 with edge-case CON modifiers (−2, 0, +3); multi-level-up path (XP jump from 0 to 6500 processes 4 level-ups)

---

### Phase 4: Skills

- [ ] **SKILL-01**: Prisma migration adds `skillProficiencies String[]` column to `Character` (array of skill name strings from the 18-skill canonical list)
- [ ] **SKILL-02**: Character creation UI includes a skill selection step; player chooses the correct number of starting proficiencies for their class (Fighter: 2 from list of 6, Rogue: 4 from list of 11, Cleric: 2 from list of 8, Wizard: 2 from list of 5)
- [ ] **SKILL-03**: `lib/skills.ts` exports `SKILLS` (all 18 skills mapped to their ability score), `resolveSkillCheck(skillName, character)` returning a full audit-trail object `{ skill, abilityScore, roll, modifier, proficiencyBonus, total, dc, success, proficient }`
- [ ] **SKILL-04**: In the `take-turn` loop, Claude's structured intent output identifies the relevant skill (if any); code calls `resolveSkillCheck()` and passes the result (not the raw roll request) back to Claude's narration call

**Tests (Skills phase):**
- [ ] **SKILL-05**: Unit tests cover `resolveSkillCheck` for proficient vs non-proficient characters, all 18 skill-to-ability mappings, and DC boundary conditions (exactly at DC, one below, one above)

---

## v2 Requirements (Deferred)

- Levels 6–20 — after levels 1–5 are stable
- Expertise (double proficiency for Rogue) — deferred with skills system
- Ability Score Improvements at level 4 — deferred
- Saving throw proficiencies — deferred
- Spell slot progression (Wizard/Cleric) — separate system
- Passive Perception in map filtering — depends on skills being shipped first
- Real-time UI updates (WebSocket/Supabase Realtime) — separate initiative
- Notification system (Resend/Discord) — separate initiative

---

## Out of Scope

- Levels 6–20 — reduces complexity; levels 1–5 cover the majority of play
- Class-specific features beyond HP/proficiency (subclasses, Extra Attack, spell slots) — too complex for this milestone
- Expertise — adds edge-case complexity; defer until basic proficiency is solid
- Rolling HP on level-up — fixed average per Basic Rules recommendation; simpler and fairer

---

## Traceability

| REQ-ID | Phase | Requirement Summary |
|--------|-------|---------------------|
| DICE-01 | 1 | Vitest installed, scripts wired |
| DICE-02 | 1 | lib/dice.ts — core dice functions |
| DICE-03 | 1 | take-turn prompt injection fix |
| DICE-04 | 1 | take-turn DB transaction fix |
| DICE-05 | 1 | Dice engine unit tests |
| XP-01 | 2 | Character schema: xp + level columns |
| XP-02 | 2 | lib/xp.ts — XP table + computeLevel |
| XP-03 | 2 | Grant XP at encounter end (code) |
| XP-04 | 2 | Display XP/level in game UI |
| XP-05 | 2 | XP threshold unit tests |
| LVL-01 | 3 | lib/leveling.ts — HP + proficiency formulas |
| LVL-02 | 3 | Level-up in take-turn transaction |
| LVL-03 | 3 | Class-aware HP at character creation |
| LVL-04 | 3 | stateDeltas allowlist |
| LVL-05 | 3 | Leveling unit tests |
| SKILL-01 | 4 | Character schema: skillProficiencies |
| SKILL-02 | 4 | Skill selection at character creation |
| SKILL-03 | 4 | lib/skills.ts — resolveSkillCheck |
| SKILL-04 | 4 | Skill checks hooked into take-turn |
| SKILL-05 | 4 | Skills unit tests |
