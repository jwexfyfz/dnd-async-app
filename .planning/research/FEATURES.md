# Features Research: D&D Basic Rules Mechanics

**Source Authority:** D&D Basic Rules 2014 (Wizards of the Coast, free PDF / dndbeyond.com)
**Scope:** Levels 1–5 only, per PROJECT.md constraints
**Confidence:** HIGH — these are static, published rules unchanged since 2014; no version ambiguity
**Researched:** 2026-05-21

---

## XP Thresholds (Levels 1–5)

These are the *cumulative* XP totals required to reach each level. A character levels up
the moment their total XP meets or exceeds the threshold.

| Level | Total XP Required | XP Needed from Previous Level |
|-------|-------------------|-------------------------------|
| 1     | 0 (starting)      | —                             |
| 2     | 300               | 300                           |
| 3     | 900               | 600                           |
| 4     | 2,700             | 1,800                         |
| 5     | 6,500             | 3,800                         |

**Source:** D&D Basic Rules 2014, Chapter 1 — "Beyond 1st Level", Character Advancement table.

### When Does Level-Up Occur?

Per Basic Rules: level-up happens immediately when XP crosses the threshold — there is no
"rest required" gate for gaining the level itself. However, rolling for new HP (class hit die)
is traditionally done at that moment. The rule text says "you gain a level", not "you gain a
level after a rest."

**Implementation decision required:** The app can either (a) auto-apply level-up at the end
of the turn that pushes XP over the threshold, or (b) queue a pending level-up that the player
must manually confirm. Option (a) is simpler and matches the rule text. See Implementation Notes.

### XP Award Sources (Milestone vs. Monster XP)

Basic Rules provides two methods:

1. **Monster XP (default):** Each monster has an XP value tied to its Challenge Rating (CR).
   XP is divided equally among all characters who participated in defeating it.

2. **Milestone (optional DM variant):** DM awards a level at narrative checkpoints. No XP math.

**For this app:** The PROJECT.md states "XP granted at encounter end (code, not AI)." Use
monster CR → XP table. Milestone is explicitly out of scope.

### Monster CR → XP Table (Relevant CRs for Levels 1–5)

These are the standard XP values per monster, before party splitting:

| CR    | XP per Monster |
|-------|----------------|
| 0     | 10             |
| 1/8   | 25             |
| 1/4   | 50             |
| 1/2   | 100            |
| 1     | 200            |
| 2     | 450            |
| 3     | 700            |
| 4     | 1,100          |
| 5     | 1,800          |

For party play: divide total monster XP by the number of participating characters.
Fractional results should be floored (Math.floor).

---

## Proficiency Bonus by Level

Universal across ALL classes. The same table applies to Fighter, Wizard, Rogue, and Cleric.

| Level | Proficiency Bonus |
|-------|-------------------|
| 1     | +2                |
| 2     | +2                |
| 3     | +2                |
| 4     | +2                |
| 5     | +3                |

**Source:** D&D Basic Rules 2014, Chapter 1 — "Proficiency Bonus" table.

The proficiency bonus is added to:
- Attack rolls (if proficient with the weapon)
- Saving throws (if proficient in that save — class-defined)
- Skill checks (if proficient in that skill)
- Spell attack rolls (if a spellcaster)

---

## Hit Points on Level-Up

### Starting HP at Level 1 (already implemented in codebase)

```
HP at Level 1 = Maximum hit die value + CON modifier
```

The codebase (`start-game.ts` line 39) computes `startingHp = 10 + conModifier`, which matches
a Fighter's d10. This is class-specific — see per-class table below.

### HP Gained on Level-Up (Levels 2–5)

```
HP gained = Roll class hit die (or take average) + CON modifier
```

Basic Rules gives players a choice: roll the hit die OR take the fixed average (rounded up).
For a deterministic app, the **fixed average** is the better default — it removes RNG from
level-up and is widely used in digital D&D implementations.

### Hit Die and Fixed Average by Class

| Class   | Hit Die | Max (Level 1) | Average (Levels 2+) |
|---------|---------|---------------|---------------------|
| Fighter | d10     | 10            | 6                   |
| Wizard  | d6      | 6             | 4                   |
| Rogue   | d8      | 8             | 5                   |
| Cleric  | d8      | 8             | 5                   |

**Note:** The d6 average is 3.5, rounded up to 4. The d8 average is 4.5, rounded up to 5.
The d10 average is 5.5, rounded up to 6. Basic Rules confirms rounding up for the fixed average.

### Full Level-Up HP Formula

```typescript
// HP added when leveling up from level N to level N+1
function hpGainOnLevelUp(characterClass: string, conModifier: number): number {
  const hitDieAverage: Record<string, number> = {
    Fighter: 6,
    Wizard:  4,
    Rogue:   5,
    Cleric:  5,
  };
  return hitDieAverage[characterClass] + conModifier;
}

// New max HP after level-up
newMaxHp = character.maxHp + hpGainOnLevelUp(character.characterClass, conModifier);
```

**CON modifier formula (already used in codebase):**
```typescript
const conModifier = Math.floor((constitution - 10) / 2);
```

### Retroactive CON Modifier Increases

If CON score increases (Ability Score Improvement at level 4), max HP is recalculated
retroactively for all past levels. Since ASI is deferred for this milestone, this edge case
can be ignored for levels 1–5 v1.

---

## Universal Level-Up Changes (Non-Class-Specific)

These apply to ALL characters at specific levels, regardless of class:

| Level | Universal Change                              | Scope for This App            |
|-------|-----------------------------------------------|-------------------------------|
| 1     | Starting equipment, class proficiencies, HP   | Handled at character creation |
| 2     | +HP (class die + CON mod)                     | Implement                     |
| 3     | +HP                                           | Implement                     |
| 4     | +HP; Ability Score Improvement available      | HP only — ASI deferred        |
| 5     | +HP; Proficiency bonus increases to +3        | Implement both                |

**Ability Score Improvement (ASI) at Level 4** is explicitly out of scope per PROJECT.md
("Class-specific features beyond proficiency bonus and HP"). ASI is technically universal but
operates as a class feature slot, so deferring it is consistent.

**Proficiency bonus** recalculation is the only non-HP universal change in levels 1–5.
It must be recomputed whenever the character's level changes (not stored as a static column —
derive it from level at query time, or update when leveling).

---

## Skills Reference

All 18 D&D 5e skills with their governing ability scores:

| Skill            | Ability Score  |
|------------------|----------------|
| Acrobatics       | Dexterity      |
| Animal Handling  | Wisdom         |
| Arcana           | Intelligence   |
| Athletics        | Strength       |
| Deception        | Charisma       |
| History          | Intelligence   |
| Insight          | Wisdom         |
| Intimidation     | Charisma       |
| Investigation    | Intelligence   |
| Medicine         | Wisdom         |
| Nature           | Intelligence   |
| Perception       | Wisdom         |
| Performance      | Charisma       |
| Persuasion       | Charisma       |
| Religion         | Intelligence   |
| Sleight of Hand  | Dexterity      |
| Stealth          | Dexterity      |
| Survival         | Wisdom         |

**Source:** D&D Basic Rules 2014, Chapter 7 — "Using Ability Scores", Skills section.

---

## Skill Proficiency Rules

### Base Skill Check Formula

```
d20 + ability modifier [+ proficiency bonus if proficient]
```

Where:
- `ability modifier = Math.floor((abilityScore - 10) / 2)`
- `proficiency bonus` is added only if the character has proficiency in that specific skill
- The same d20 roll mechanic applies to all skill checks (no separate skill dice pool)

### Advantage / Disadvantage

Roll two d20s, take the higher (advantage) or lower (disadvantage). Not a separate feature —
it is a modifier on the d20 roll itself. Relevant for: Stealth checks against enemies with
Perception, Perception checks in darkness, etc. Include in dice engine — it applies to skills.

### Passive Skill Score

```
Passive [Skill] = 10 + ability modifier [+ proficiency bonus if proficient]
```

This is used WITHOUT rolling — it represents a character's constant, background awareness.
Critical for the perception filtering rule in CLAUDE.md:

> "Filter out hidden elements from map payload queries unless the character's passive
> perception clears the object's hidden DC, or a record exists in DiscoveredObjects."

**Passive Perception** is the most critical passive skill for this app:
```typescript
function passivePerception(wisdom: number, perceptionProficient: boolean, profBonus: number): number {
  const wisModifier = Math.floor((wisdom - 10) / 2);
  return 10 + wisModifier + (perceptionProficient ? profBonus : 0);
}
```

---

## Starting Skill Proficiencies (Class-Based, Levels 1–5)

Skill proficiencies are chosen at character creation (level 1) and do NOT change on level-up
within levels 1–5 (excluding ASI and class features that grant extra proficiencies, all deferred).

| Class   | Number of Skill Proficiencies | Choose From                                                                                          |
|---------|-------------------------------|------------------------------------------------------------------------------------------------------|
| Fighter | 2                             | Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, Survival         |
| Wizard  | 2                             | Arcana, History, Insight, Investigation, Medicine, Religion                                          |
| Rogue   | 4                             | Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Performance, Persuasion, Sleight of Hand, Stealth |
| Cleric  | 2                             | History, Insight, Medicine, Persuasion, Religion                                                     |

**Source:** D&D Basic Rules 2014, Chapter 3 — class descriptions.

**Implementation note:** The character creation UI currently has no skill selection step. A
new step must be added to `character-form.tsx` (or a separate flow) to capture which specific
skills the character is proficient in. These choices must be stored on the `Character` model.

---

## Expertise Rule

Expertise doubles the proficiency bonus on a chosen skill:
```
Expertise check = d20 + ability modifier + (proficiency bonus × 2)
```

In Basic Rules 2014, only Rogues gain Expertise (at level 1: 2 skills; at level 6: 2 more).
Bards also get it (level 3), but Bard is not in scope.

**Verdict: Defer.** Expertise appears at level 1 for Rogues, but given the complexity of
adding a second proficiency tier to the schema and the fact that the app targets casual play,
defer expertise for the levels 1–5 v1. Note it as a known gap. The Rogue will be slightly
mechanically underpowered without it, but it will not break correctness on other classes.

---

## Deferred Mechanics

Explicitly NOT implementing in this milestone:

| Mechanic                         | Reason for Deferral                                        |
|----------------------------------|------------------------------------------------------------|
| Ability Score Improvements (ASI) | Complex, class feature slot, PROJECT.md out-of-scope       |
| Expertise (double proficiency)   | Rogue-only at levels 1–5, adds schema complexity           |
| Saving throw proficiencies       | Class-specific; needed for spell resistance, defer to later |
| Spell slot progression (Wizard, Cleric) | Explicitly out of scope per PROJECT.md              |
| Extra Attack (Fighter level 5)   | Class feature, out of scope per PROJECT.md                 |
| Levels 6–20                      | Explicitly out of scope per PROJECT.md                     |
| Milestone leveling               | PROJECT.md mandates monster-XP model                       |
| Jack of All Trades (Bard)        | Bard not in scope                                          |
| Half-proficiency on non-proficient checks | Not in Basic Rules — Bard-only feature, irrelevant |

---

## Implementation Notes

### 1. Schema Changes Required

The `Character` model currently stores stats but has no XP, level, or skill proficiency fields.
Required additions:

```prisma
model Character {
  // ... existing fields ...
  level            Int      @default(1)
  xp               Int      @default(0)
  skillProficiencies String[] @default([])  // e.g., ["Perception", "Stealth"]
  // maxHp is computed from class + level + CON; can be stored as a column
  // or derived. Storing is simpler given the async nature of the app.
}
```

`maxHp` is currently stored in the game's `state` JSON blob (`game.state.maxHp`), not on the
`Character` model itself. For the leveling system, `maxHp` must either be:
- Moved to `Character` (clean, persistent across games), OR
- Recalculated from `Character.level`, `Character.characterClass`, and `Character.constitution`
  on game initialization and level-up.

**Recommendation:** Add `maxHp` to `Character` model. Single source of truth. When a character
levels up, update both `Character.maxHp` and `Game.state.maxHp` (the game snapshot).

### 2. Level-Up Trigger: Immediate vs. Deferred

The rules say level-up is immediate on XP threshold crossing. For the async app:
- Level-up should be triggered automatically by the server action that grants XP (end of
  encounter), not by the player's next login.
- The `take-turn.ts` action (or a new `grant-xp.ts` action) should call a `checkLevelUp()`
  helper that computes the new level and updates `Character.level`, `Character.maxHp`,
  and `Game.state` in a single DB transaction.

### 3. Proficiency Bonus: Derive from Level, Don't Store

Proficiency bonus changes only at level 5 (within scope). It should be a pure function:

```typescript
function getProficiencyBonus(level: number): number {
  if (level >= 5) return 3;
  return 2; // Levels 1–4
}
```

Do not store proficiency bonus as a column — it is always derivable from level. This avoids
sync bugs.

### 4. Skill Check Resolution (Full Pipeline)

For the "In-game skill checks" feature in PROJECT.md:

```typescript
function resolveSkillCheck(
  d20Roll: number,          // from dice engine, never AI
  abilityScore: number,     // e.g., character.wisdom for Perception
  isProficient: boolean,    // character.skillProficiencies.includes("Perception")
  level: number,            // character.level — used to derive profBonus
): number {
  const abilityModifier = Math.floor((abilityScore - 10) / 2);
  const profBonus = isProficient ? getProficiencyBonus(level) : 0;
  return d20Roll + abilityModifier + profBonus;
}
```

### 5. Skill Proficiency Selection in Character Creation

The current `character-form.tsx` has no skill selection step. Adding it requires:
- A class-dependent `AVAILABLE_SKILLS` map
- A `selectedSkills` state array, capped at the class's allowed count
- The chosen skills stored on `Character.skillProficiencies`

This is a prerequisite for the "Skill proficiency tracking" feature in PROJECT.md.

### 6. Passive Perception for Map Filtering

Per CLAUDE.md, the map query must filter hidden objects using passive perception. The
`passivePerception` value should be computed server-side (in `get-game.ts` or a helper) and
used to filter `DiscoveredObjects` queries — never passed as a client-supplied parameter.

### 7. XP Splitting in Party Games

For multi-player games, XP from a defeated encounter is divided by the number of active
`PartyMember` rows for that game. Integer division (Math.floor) is the standard approach.
Each party member's `Character.xp` is updated individually so level-up checks happen per-character.

### 8. HP Cannot Drop Below 0 on Level-Up HP Grant

When granting level-up HP, add to `maxHp`. Do NOT automatically fill current HP to the new max
(the character might be injured). Standard D&D behavior: max HP increases, current HP stays the
same (or is also increased by the same amount if using the optional "heal on level-up" variant).
For simplicity, do not implement heal-on-level-up.

---

*Research by: GSD Features Researcher — 2026-05-21*
