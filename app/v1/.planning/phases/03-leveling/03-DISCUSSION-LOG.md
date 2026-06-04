# Phase 3: Leveling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 3-leveling
**Areas discussed:** maxHp canonical home, Level-up HP notification, lib/leveling.ts scope, Scope check (new classes)

---

## maxHp Canonical Home

| Option | Description | Selected |
|--------|-------------|----------|
| Add Character.maxHp column | Prisma migration adds maxHp Int to Character. Canonical, survives across games, readable at adventure start. create-character.ts sets it; start-adventure.ts reads it. | ✓ |
| Keep in Game.state only | No migration. maxHp stays in Game.state.partyMaxHp per session. start-adventure.ts calls maxHpAtLevel(class, con, character.level) to compute it fresh each game. | |

**User's choice:** Add Character.maxHp column

---

### maxHp initial value at character creation

| Option | Description | Selected |
|--------|-------------|----------|
| Compute in create-character.ts using maxHpAtLevel | create-character.ts calls maxHpAtLevel(class, constitution, 1) when creating — stores correct class-aware HP immediately. | ✓ |
| Use schema default (10), fix at adventure start | Schema default of 10, then start-adventure.ts overwrites with real class HP when game begins. | |

**User's choice:** Compute in create-character.ts using maxHpAtLevel

---

### start-adventure.ts HP initialization after migration

| Option | Description | Selected |
|--------|-------------|----------|
| Read character.maxHp from DB | Trust the canonical column. start-adventure.ts reads character.maxHp directly — no recalculation. | ✓ |
| Recalculate from maxHpAtLevel each time | Always calls maxHpAtLevel(class, con, level) at game start. Handles legacy characters. | |

**User's choice:** Read character.maxHp from DB

---

## Level-up HP Notification

| Option | Description | Selected |
|--------|-------------|----------|
| Expand levelUpNote with HP numbers | Extend existing pattern: 'Thora advanced to Level 3. Max HP increased from 18 to 23.' Injected into system prompt, Claude weaves it in. No new UI. | |
| New level-up info card in chat UI | Add a UI card in the chat feed alongside the dice result card — explicit numbers, old→new level, old→new maxHp, proficiency bonus if changed. | ✓ |
| Narration-only (no numbers) | System prompt just says 'character leveled up' — Claude narrates HP gain vaguely, no exact numbers. | |

**User's choice:** New level-up info card in chat UI

---

### Level-up card content

| Option | Description | Selected |
|--------|-------------|----------|
| Level + HP gain + proficiency bonus change | Shows all mechanical changes: level up, max HP old→new, proficiency bonus (if changed). | ✓ |
| Level + HP gain only | Simpler — skip proficiency bonus since it only changes at level 5. | |

**User's choice:** Level + HP gain + proficiency bonus change

---

### Level-up card data transport

| Option | Description | Selected |
|--------|-------------|----------|
| levelUpResult in take-turn return value | Same pattern as diceResult — returned in server action response, client renders card above narrative. | ✓ |
| Store in Message row as structured JSON | Persist in a new 'levelUp' field on the Message table. Survives page refreshes, requires schema change. | |

**User's choice:** levelUpResult in take-turn return value (same pattern as diceResult)

---

## lib/leveling.ts Scope

### proficiencyBonus re-export

| Option | Description | Selected |
|--------|-------------|----------|
| Re-export from lib/dice.ts | lib/leveling.ts re-exports proficiencyBonus. Phase 4 imports from leveling.ts only — single source. | ✓ |
| Keep separate | Phase 4 imports proficiencyBonus from lib/dice.ts directly. Two import sources. | |

**User's choice:** Yes — re-export from lib/dice.ts

---

### HIT_DIE_BY_CLASS constant placement

| Option | Description | Selected |
|--------|-------------|----------|
| Export from lib/leveling.ts | Exported constant, testable and referenceable. Self-contained module. | ✓ |
| Inline inside maxHpAtLevel only | Local const inside the function — not exported, not referenceable. | |

**User's choice:** Export HIT_DIE_BY_CLASS from lib/leveling.ts

---

## Scope Check: New Classes / Skills

| Option | Description | Selected |
|--------|-------------|----------|
| Note additional classes for backlog | Capture new classes as a future phase (after Phase 4 ships). | ✓ |
| Note both classes and skills | Classes are a future phase; skills are already Phase 4. | |
| Skip backlog notes | Don't track right now. | |

**User's choice:** Note additional classes only (skills already planned as Phase 4)

---

## Claude's Discretion

- `levelUpNote` system prompt injection: continue injecting narrative hook even though UI card exists — card handles mechanical data, levelUpNote handles narrative momentum
- Migration backfill: data migration should compute correct class HP for existing Character rows using `maxHpAtLevel(class, con, character.level)`
- Multi-level-up HP: use `maxHpAtLevel(class, con, newLevel) - character.maxHp` as the delta (total-HP function, no intermediate loop needed)
- stateDeltas allowlist: RULES_ENGINE_KEYS already covers LVL-04 — silent strip is sufficient

## Deferred Ideas

- Additional character classes beyond Fighter/Rogue/Cleric/Wizard — separate future phase after Phase 4 ships; requires new hit dice, skill lists, character creation wiring
