# Phase 3: Leveling - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Add automatic level progression to the game loop: when a character's XP crosses a D&D Basic Rules threshold, `character.level` and `character.maxHp` both update inside the existing `take-turn` Prisma transaction. Max HP grows by the class-specific hit die average + CON modifier per level. Character creation stores the correct class-aware starting maxHp. Claude is locked out of all mechanical values via the existing RULES_ENGINE_KEYS allowlist.

This phase does NOT include skill proficiencies (Phase 4), additional classes beyond the 4 supported, or levels 6–20.

</domain>

<decisions>
## Implementation Decisions

### maxHp Storage
- **D-01:** Add `maxHp Int` column to the `Character` model via Prisma migration. This makes maxHp canonical and persistent across game sessions — not recalculated per session.
- **D-02:** `create-character.ts` calls `maxHpAtLevel(characterClass, constitution, 1)` when creating the character and stores the result in `character.maxHp`. No magic numbers; the function owns the formula.
- **D-03:** `start-adventure.ts` reads `character.maxHp` directly from the DB when initializing `Game.state.partyMaxHp` — no recalculation at adventure start. Trusts the canonical column.
- **D-04:** `take-turn.ts` updates `character.maxHp` inside the `$transaction` when a level-up occurs — compare `maxHpAtLevel(class, con, newLevel)` to current `character.maxHp` to get the HP delta, then write the new total. Updates alongside `character.level` and `character.xp` in the same atomic write.

### Level-up HP Notification
- **D-05:** New level-up info card in the chat UI, rendered in the same position and using the same visual pattern as the Phase 1 dice result card.
- **D-06:** Card content: old level → new level, old maxHp → new maxHp, proficiency bonus (show only if it changed — i.e., the level-5 transition from +2 to +3).
- **D-07:** `take-turn.ts` returns `levelUpResult: { oldLevel, newLevel, oldMaxHp, newMaxHp, proficiencyBonus }` in the server action response when a level-up occurs — same pattern as the existing `diceResult` return field. Client renders the card above the narrative.

### lib/leveling.ts Module
- **D-08:** New pure module `lib/leveling.ts` — zero Prisma imports, zero framework dependencies, same pattern as `lib/dice.ts` and `lib/xp.ts`.
- **D-09:** Exports `maxHpAtLevel(characterClass: string, constitution: number, level: number): number` — returns total max HP for a given class, CON score, and level. Level 1 = max die + CON mod; levels 2–5 = prior total + average die + CON mod.
- **D-10:** Exports `HIT_DIE_BY_CLASS` constant: `{ Fighter: { die: 10, avg: 6 }, Rogue: { die: 8, avg: 5 }, Cleric: { die: 8, avg: 5 }, Wizard: { die: 6, avg: 4 } }`. Exported so tests can reference exact values.
- **D-11:** Re-exports `proficiencyBonus` from `lib/dice.ts`. Phase 4 should import from `lib/leveling.ts` for all leveling-related math — single import source.

### stateDeltas Allowlist (LVL-04)
- **D-12:** RULES_ENGINE_KEYS = `["hp", "maxHp", "xp", "level", "proficiencyBonus"]` already strips these keys silently in `take-turn.ts` (line 299). This is the allowlist LVL-04 requires. Silent strip is sufficient — no additional validation needed. This requirement is largely already met.

### Claude's Discretion
- `levelUpNote` system prompt injection: continue injecting the narrative hook (Phase 2 D-06 pattern) even though a UI card now also shows the data. Card handles mechanical display; levelUpNote handles narrative momentum.
- Migration backfill: data migration for existing characters should compute the correct class HP using `maxHpAtLevel(class, con, character.level)` for each row (handles legacy data created before this column existed).
- Multi-level-up HP: use `maxHpAtLevel(class, con, newLevel) - character.maxHp` as the HP delta rather than an intermediate loop — `maxHpAtLevel` is a total-HP function, so final level gives the correct cumulative total.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — LVL-01 through LVL-05 are the phase requirements (authoritative). Also defines hit die averages for each class (LVL-01) and the multi-level-up loop constraint (LVL-02).
- `.planning/ROADMAP.md` — Phase 3 success criteria, dependency on Phase 2

### Existing Code (MUST read before modifying)
- `app/actions/take-turn.ts` — central file; add `character.maxHp` update inside `$transaction`, `levelUpResult` in return value; RULES_ENGINE_KEYS already at line 299
- `app/actions/create-character.ts` — add `maxHpAtLevel` call to set initial `maxHp` at character creation
- `app/actions/start-adventure.ts` — fix line 49 (hardcoded `10 + conMod`) to read `character.maxHp` from DB
- `prisma/schema.prisma` — add `maxHp Int` to `Character` model; requires migration
- `app/game/[id]/page.tsx` — game UI; add level-up card rendering following the dice result card pattern

### Prior Phase Context (carry-forward decisions)
- `.planning/phases/01-dice-engine-critical-bug-fixes/01-CONTEXT.md` — D-06/D-07 (Claude cannot alter mechanical values), RULES_ENGINE_KEYS pattern, dice card UI pattern to reuse
- `.planning/phases/02-xp-system/02-CONTEXT.md` — D-05 (character.update inside $transaction), D-06 (levelUpNote injection), D-07 (HP notification deferred to Phase 3), XP_THRESHOLDS

### New File
- `lib/leveling.ts` — create this file (does not yet exist); pure module, zero imports from prisma/frameworks

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — server action pattern, $transaction location in take-turn
- `.planning/codebase/STACK.md` — Prisma 7 + Neon adapter; migration workflow

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/dice.ts` `proficiencyBonus(level)` — already implemented and tested; `lib/leveling.ts` re-exports it
- `lib/xp.ts` — pure module pattern (zero Prisma imports, module-level constants, exported functions) to replicate for `lib/leveling.ts`
- `lib/dice.ts` `abilityModifier(score)` — needed by `maxHpAtLevel` to compute CON modifier; import from `lib/dice.ts`
- dice result card in `app/game/[id]/page.tsx` — exact visual pattern to reuse for level-up card (rendered above narrative)
- `take-turn.ts` `diceResult` return field (lines ~348) — same return-value pattern for `levelUpResult`
- `take-turn.ts` `$transaction` block (lines ~324–340) — already updates `character.xp` and `character.level`; add `character.maxHp` here
- `take-turn.ts` `buildDynamicStatePrompt()` levelUpNote injection (lines ~139–143) — keep this for narrative; it complements the UI card

### Established Patterns
- Pure utility modules (`lib/dice.ts`, `lib/xp.ts`) have zero Prisma imports — `lib/leveling.ts` MUST follow this (testable without DB)
- `// ─── Section ───` separator style throughout
- Module-level constants in SCREAMING_SNAKE_CASE with JSDoc comments citing the authoritative source
- Server action `$transaction` extends cleanly — add `tx.character.update` for maxHp alongside the existing level/xp write

### Integration Points
- `create-character.ts` → import `maxHpAtLevel` from `lib/leveling.ts`; pass `characterClass`, `constitution`, `1` to get starting HP; add `maxHp` to `prisma.character.create({ data: { ..., maxHp } })`
- `start-adventure.ts` → replace hardcoded `hp = 10 + conMod` (line 49) with `hp = member.character.maxHp` (read from DB); requires `maxHp` in the character select
- `take-turn.ts` → import `maxHpAtLevel` from `lib/leveling.ts`; compute `newMaxHp = maxHpAtLevel(class, con, newLevel)` when `didLevelUp`; add to `$transaction` character update; add `levelUpResult` to return

</code_context>

<specifics>
## Specific Ideas

- Level-up card format: `⬆ Level 3  |  Max HP: 18 → 23  |  Proficiency Bonus: +2` (proficiency bonus line omitted unless it changed)
- `levelUpResult` return shape: `{ oldLevel: number, newLevel: number, oldMaxHp: number, newMaxHp: number, proficiencyBonus: number }`
- `HIT_DIE_BY_CLASS` shape: `{ Fighter: { die: 10, avg: 6 }, Rogue: { die: 8, avg: 5 }, Cleric: { die: 8, avg: 5 }, Wizard: { die: 6, avg: 4 } }`
- `maxHpAtLevel` formula: level 1 = `HIT_DIE_BY_CLASS[class].die + abilityModifier(constitution)`; level N (N > 1) = `maxHpAtLevel(class, con, N-1) + HIT_DIE_BY_CLASS[class].avg + abilityModifier(constitution)`

</specifics>

<deferred>
## Deferred Ideas

- Additional character classes beyond Fighter, Rogue, Cleric, Wizard — would require new hit dice entries, potentially new skill lists (Phase 4 dependency), and character creation wiring; separate phase after Phase 4 ships.
- Levels 6–20 — explicitly out of scope for this milestone per REQUIREMENTS.md
- Ability Score Improvements at level 4 — deferred to v2 per REQUIREMENTS.md
- Expertise (double proficiency for Rogue) — deferred with skills system

</deferred>

---

*Phase: 3-leveling*
*Context gathered: 2026-05-22*
