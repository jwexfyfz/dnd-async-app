import { abilityModifier, proficiencyBonus as calcProfBonus } from "./dice";

// ─── Types ────────────────────────────────────────────────────────────────────

type AbilityKey = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

interface CharacterInput {
  characterClass:      string;
  level:               number;
  baseStrength:        number;
  baseDexterity:       number;
  baseConstitution:    number;
  baseIntelligence:    number;
  baseWisdom:          number;
  baseCharisma:        number;
  skillProficiencies?: string[];
}

export interface StatEntry {
  key:            AbilityKey;
  label:          string;
  score:          number;
  modifier:       number;
  saveMod:        number;
  saveProficient: boolean;
}

export interface SkillEntry {
  name:       string;
  ability:    AbilityKey;
  modifier:   number;
  proficient: boolean;
}

export interface CharacterSheetData {
  profBonus: number;
  stats:     StatEntry[];
  skills:    SkillEntry[];
}

// ─── Class proficiency tables ─────────────────────────────────────────────────

// Saving throw proficiencies per D&D 5e Basic Rules (2 saves per class).
const SAVE_PROFS: Record<string, AbilityKey[]> = {
  Barbarian: ["strength",     "constitution"],
  Bard:      ["dexterity",    "charisma"],
  Cleric:    ["wisdom",       "charisma"],
  Druid:     ["intelligence", "wisdom"],
  Fighter:   ["strength",     "constitution"],
  Monk:      ["strength",     "dexterity"],
  Paladin:   ["wisdom",       "charisma"],
  Ranger:    ["strength",     "dexterity"],
  Rogue:     ["dexterity",    "intelligence"],
  Sorcerer:  ["constitution", "charisma"],
  Warlock:   ["wisdom",       "charisma"],
  Wizard:    ["intelligence", "wisdom"],
};

// ─── Static tables ────────────────────────────────────────────────────────────

const ABILITY_META: { key: AbilityKey; label: string }[] = [
  { key: "strength",     label: "STR" },
  { key: "dexterity",    label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom",       label: "WIS" },
  { key: "charisma",     label: "CHA" },
];

// All 18 D&D 5e skills, ordered alphabetically.
const SKILLS: { name: string; ability: AbilityKey }[] = [
  { name: "Acrobatics",      ability: "dexterity"   },
  { name: "Animal Handling", ability: "wisdom"       },
  { name: "Arcana",          ability: "intelligence" },
  { name: "Athletics",       ability: "strength"     },
  { name: "Deception",       ability: "charisma"     },
  { name: "History",         ability: "intelligence" },
  { name: "Insight",         ability: "wisdom"       },
  { name: "Intimidation",    ability: "charisma"     },
  { name: "Investigation",   ability: "intelligence" },
  { name: "Medicine",        ability: "wisdom"       },
  { name: "Nature",          ability: "intelligence" },
  { name: "Perception",      ability: "wisdom"       },
  { name: "Performance",     ability: "charisma"     },
  { name: "Persuasion",      ability: "charisma"     },
  { name: "Religion",        ability: "intelligence" },
  { name: "Sleight of Hand", ability: "dexterity"   },
  { name: "Stealth",         ability: "dexterity"   },
  { name: "Survival",        ability: "wisdom"       },
];

// ─── Main function ────────────────────────────────────────────────────────────

// Maps D&D ability keys to their base* field names on CharacterInput.
const ABILITY_FIELD: Record<AbilityKey, keyof CharacterInput> = {
  strength:     "baseStrength",
  dexterity:    "baseDexterity",
  constitution: "baseConstitution",
  intelligence: "baseIntelligence",
  wisdom:       "baseWisdom",
  charisma:     "baseCharisma",
};

export function getCharacterSheetData(char: CharacterInput): CharacterSheetData {
  const profBonus  = calcProfBonus(char.level);
  const saveProfs  = new Set<AbilityKey>(SAVE_PROFS[char.characterClass] ?? []);
  const skillProfs = new Set<string>(char.skillProficiencies ?? []);

  const stats: StatEntry[] = ABILITY_META.map(({ key, label }) => {
    const score          = char[ABILITY_FIELD[key]] as number;
    const modifier       = abilityModifier(score);
    const saveProficient = saveProfs.has(key);
    return {
      key, label, score, modifier,
      saveMod:        saveProficient ? modifier + profBonus : modifier,
      saveProficient,
    };
  });

  const skills: SkillEntry[] = SKILLS.map(({ name, ability }) => {
    const baseMod    = abilityModifier(char[ABILITY_FIELD[ability]] as number);
    const proficient = skillProfs.has(name);
    return { name, ability, modifier: proficient ? baseMod + profBonus : baseMod, proficient };
  });

  return { profBonus, stats, skills };
}
