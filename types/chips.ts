export type ChipType =
  | "athletics" | "acrobatics" | "sleight_of_hand" | "stealth"
  | "arcana" | "history" | "investigation" | "nature" | "religion"
  | "animal_handling" | "insight" | "medicine" | "perception" | "survival"
  | "deception" | "intimidation" | "performance" | "persuasion"
  | "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma"
  | "none"; // suppresses modifier badge display

// resourceCost.type is stored as a plain string in the DB (Json field).
// Use resolveChipCost() from config/skills.ts to get a narrowly-typed ResourceCost.
export type Chip = {
  text:          string;
  type:          ChipType;
  resourceCost?: { type: string; value: number };
};
