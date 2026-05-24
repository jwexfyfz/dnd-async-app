// ─── Skills Engine ─────────────────────────────────────────────────────────────
// Pure TypeScript skills functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic given the injectable rollFn pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { abilityModifier, proficiencyBonus, rollDie } from "./dice";

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Character input required for skill check resolution. */
export interface SkillCharacterInput {
  characterClass: string;
  level: number;
  baseStrength: number;
  baseDexterity: number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom: number;
  baseCharisma: number;
  skillProficiencies: string[];
}

/** Full audit trail for a skill check result. */
export interface SkillCheckResult {
  skill: string;
  abilityScore: string;
  roll: number;
  modifier: number;
  proficiencyBonus: number;
  total: number;
  dc: number;
  success: boolean;
  proficient: boolean;
}

// ─── SKILL_ABILITY_MAP ────────────────────────────────────────────────────────

/**
 * Maps all 18 D&D 5e skills to their governing ability score.
 * Source: D&D Basic Rules 2014; values extracted from lib/character-sheet.ts.
 */
export const SKILL_ABILITY_MAP: Record<string, keyof SkillCharacterInput> = {
  Acrobatics:        "baseDexterity",
  "Animal Handling": "baseWisdom",
  Arcana:            "baseIntelligence",
  Athletics:         "baseStrength",
  Deception:         "baseCharisma",
  History:           "baseIntelligence",
  Insight:           "baseWisdom",
  Intimidation:      "baseCharisma",
  Investigation:     "baseIntelligence",
  Medicine:          "baseWisdom",
  Nature:            "baseIntelligence",
  Perception:        "baseWisdom",
  Performance:       "baseCharisma",
  Persuasion:        "baseCharisma",
  Religion:          "baseIntelligence",
  "Sleight of Hand": "baseDexterity",
  Stealth:           "baseDexterity",
  Survival:          "baseWisdom",
};

/** Alias for REQUIREMENTS.md SKILL-03 literal compliance. Use SKILL_ABILITY_MAP internally. */
export const SKILLS = SKILL_ABILITY_MAP;

// ─── CLASS_SKILL_POOL ─────────────────────────────────────────────────────────

/**
 * Per-class list of skills available to choose proficiency in at character
 * creation. Source: D&D Basic Rules 2014.
 */
export const CLASS_SKILL_POOL: Record<string, string[]> = {
  Fighter: [
    "Acrobatics",
    "Animal Handling",
    "Athletics",
    "History",
    "Insight",
    "Intimidation",
    "Perception",
    "Survival",
  ],
  Rogue: [
    "Acrobatics",
    "Athletics",
    "Deception",
    "Insight",
    "Intimidation",
    "Investigation",
    "Perception",
    "Performance",
    "Persuasion",
    "Sleight of Hand",
    "Stealth",
  ],
  Cleric: ["History", "Insight", "Medicine", "Persuasion", "Religion"],
  Wizard: ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
};

// ─── SKILL_PICK_COUNT ─────────────────────────────────────────────────────────

/**
 * Number of skill proficiencies each class picks at character creation.
 * Source: D&D Basic Rules 2014.
 */
export const SKILL_PICK_COUNT: Record<string, number> = {
  Fighter: 2,
  Rogue:   4,
  Cleric:  2,
  Wizard:  2,
};

// ─── resolveSkillCheck ────────────────────────────────────────────────────────

/**
 * Resolve a D&D 5e skill check.
 *
 * Formula: d20 + abilityModifier(abilityScore) + proficiencyBonus(level) if proficient.
 * Success when total >= dc (DC boundary: exactly at DC is success).
 *
 * The rollFn parameter is injectable for deterministic testing without
 * vi.spyOn or vi.mock — pass () => fixedValue in tests.
 *
 * Throws a descriptive Error when skillName is not a key of SKILL_ABILITY_MAP
 * (T-04-03-01 mitigation).
 *
 * @param skillName  - Skill name; must be a key of SKILL_ABILITY_MAP
 * @param character  - Character data including ability scores and skill proficiencies
 * @param dc         - Difficulty Class to meet or exceed
 * @param rollFn     - Injectable die roller; defaults to a real d20 roll
 */
export function resolveSkillCheck(
  skillName: string,
  character: SkillCharacterInput,
  dc: number,
  rollFn?: () => number,
): SkillCheckResult {
  const abilityKey = SKILL_ABILITY_MAP[skillName];
  if (!abilityKey) throw new Error(`Unknown skill: ${skillName}`);

  const roll = rollFn ? rollFn() : rollDie(20);
  const abilityScore = character[abilityKey] as number;
  const modifier = abilityModifier(abilityScore);
  const proficient = character.skillProficiencies.includes(skillName);
  const profBonus = proficient ? proficiencyBonus(character.level) : 0;
  const total = roll + modifier + profBonus;

  return {
    skill: skillName,
    abilityScore: abilityKey,
    roll,
    modifier,
    proficiencyBonus: profBonus,
    total,
    dc,
    success: total >= dc,
    proficient,
  };
}
