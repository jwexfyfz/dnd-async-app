import type { Chip, ChipType } from "../types/chips";
import type { ResourceCost } from "../types/turn-actions";

type AbilityKey = "baseStrength" | "baseDexterity" | "baseConstitution" | "baseIntelligence" | "baseWisdom" | "baseCharisma";

// All skill checks consume one main action by default (D&D 5e PHB, p. 192).
const SKILL_COST: ResourceCost = { type: "mainAction", value: 1 };

// Object interactions (drop item, open unlocked door, etc.) require no action.
const FREE_COST: ResourceCost = { type: "free", value: 0 };

export const SKILL_MAP: Record<ChipType, {
  emoji:       string;
  label:       string;
  tw:          string;
  abilityKey:  AbilityKey;
  defaultCost: ResourceCost;
}> = {
  athletics:      { emoji: "💪", label: "Athletics",      tw: "bg-blue-50 border-blue-200 text-blue-700",      abilityKey: "baseStrength",     defaultCost: SKILL_COST },
  strength:       { emoji: "💪", label: "Strength",       tw: "bg-blue-50 border-blue-200 text-blue-700",      abilityKey: "baseStrength",     defaultCost: SKILL_COST },
  acrobatics:     { emoji: "👤", label: "Acrobatics",     tw: "bg-teal-50 border-teal-200 text-teal-700",      abilityKey: "baseDexterity",    defaultCost: SKILL_COST },
  sleight_of_hand:{ emoji: "👤", label: "Sleight of Hand",tw: "bg-teal-50 border-teal-200 text-teal-700",      abilityKey: "baseDexterity",    defaultCost: SKILL_COST },
  stealth:        { emoji: "👤", label: "Stealth",        tw: "bg-teal-50 border-teal-200 text-teal-700",      abilityKey: "baseDexterity",    defaultCost: SKILL_COST },
  dexterity:      { emoji: "👤", label: "Dexterity",      tw: "bg-teal-50 border-teal-200 text-teal-700",      abilityKey: "baseDexterity",    defaultCost: SKILL_COST },
  constitution:   { emoji: "🛡️", label: "Constitution",   tw: "bg-red-50 border-red-200 text-red-700",         abilityKey: "baseConstitution", defaultCost: SKILL_COST },
  arcana:         { emoji: "🧠", label: "Arcana",         tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  history:        { emoji: "🧠", label: "History",        tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  investigation:  { emoji: "🧠", label: "Investigation",  tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  nature:         { emoji: "🧠", label: "Nature",         tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  religion:       { emoji: "🧠", label: "Religion",       tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  intelligence:   { emoji: "🧠", label: "Intelligence",   tw: "bg-purple-50 border-purple-200 text-purple-700",abilityKey: "baseIntelligence", defaultCost: SKILL_COST },
  animal_handling:{ emoji: "🦉", label: "Animal Handling",tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  insight:        { emoji: "🦉", label: "Insight",        tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  medicine:       { emoji: "🦉", label: "Medicine",       tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  perception:     { emoji: "🦉", label: "Perception",     tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  survival:       { emoji: "🦉", label: "Survival",       tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  wisdom:         { emoji: "🦉", label: "Wisdom",         tw: "bg-green-50 border-green-200 text-green-700",   abilityKey: "baseWisdom",       defaultCost: SKILL_COST },
  deception:      { emoji: "💬", label: "Deception",      tw: "bg-yellow-50 border-yellow-200 text-yellow-700",abilityKey: "baseCharisma",     defaultCost: SKILL_COST },
  intimidation:   { emoji: "💬", label: "Intimidation",   tw: "bg-yellow-50 border-yellow-200 text-yellow-700",abilityKey: "baseCharisma",     defaultCost: SKILL_COST },
  performance:    { emoji: "💬", label: "Performance",    tw: "bg-yellow-50 border-yellow-200 text-yellow-700",abilityKey: "baseCharisma",     defaultCost: SKILL_COST },
  persuasion:     { emoji: "💬", label: "Persuasion",     tw: "bg-yellow-50 border-yellow-200 text-yellow-700",abilityKey: "baseCharisma",     defaultCost: SKILL_COST },
  charisma:       { emoji: "💬", label: "Charisma",       tw: "bg-yellow-50 border-yellow-200 text-yellow-700",abilityKey: "baseCharisma",     defaultCost: SKILL_COST },
};

/**
 * Resolves the effective resource cost for a chip using a three-tier priority:
 * 1. Explicit `chip.resourceCost` — narrowed from the stored string type.
 * 2. The `defaultCost` declared on the chip's skill entry in SKILL_MAP.
 * 3. FREE_COST — catches object interactions (drop item, open door, etc.)
 *    that arrive as chips without a matching skill type.
 */
export function resolveChipCost(chip: Chip): ResourceCost {
  if (chip.resourceCost) {
    // chip.resourceCost.type is stored as string (Json field); cast to the
    // strict union here, at the single point where it re-enters typed code.
    return chip.resourceCost as ResourceCost;
  }
  return SKILL_MAP[chip.type]?.defaultCost ?? FREE_COST;
}
