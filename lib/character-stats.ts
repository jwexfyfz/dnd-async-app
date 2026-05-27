// ─── Active Character Stats ───────────────────────────────────────────────────
// Computes effective ability scores by layering item bonuses on top of base
// stats. Items carry an explicit statKey (ability name) and statModifierBonus
// (flat integer), so no JSON parsing or override logic is needed.

import { prisma } from "./prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

type AbilityStat = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

const ABILITIES: AbilityStat[] = [
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
];

const BASE_FIELD: Record<AbilityStat, string> = {
  strength:     "baseStrength",
  dexterity:    "baseDexterity",
  constitution: "baseConstitution",
  intelligence: "baseIntelligence",
  wisdom:       "baseWisdom",
  charisma:     "baseCharisma",
};

interface StatRow {
  base:  number;
  bonus: number;
  total: number;
}

export type CharacterStats = Record<AbilityStat, StatRow>;

// ─── Main function ────────────────────────────────────────────────────────────

export async function computeCharacterStats(characterId: string): Promise<CharacterStats> {
  const character = await prisma.character.findUniqueOrThrow({
    where:  { id: characterId },
    select: {
      baseStrength:     true,
      baseDexterity:    true,
      baseConstitution: true,
      baseIntelligence: true,
      baseWisdom:       true,
      baseCharisma:     true,
      mainHand: { select: { statKey: true, statModifierBonus: true } },
      offHand:  { select: { statKey: true, statModifierBonus: true } },
      armor:    { select: { statKey: true, statModifierBonus: true } },
      ring:     { select: { statKey: true, statModifierBonus: true } },
    },
  });

  // Seed accumulators from base stats.
  const running: Record<AbilityStat, number> = {} as Record<AbilityStat, number>;
  const bonuses: Record<AbilityStat, number> = {} as Record<AbilityStat, number>;

  const baseRecord = character as unknown as Record<string, number>;
  for (const ability of ABILITIES) {
    running[ability] = baseRecord[BASE_FIELD[ability]];
    bonuses[ability] = 0;
  }

  // Apply flat bonus from each occupied slot that targets a known ability.
  const slots = [character.mainHand, character.offHand, character.armor, character.ring];
  for (const slot of slots) {
    if (!slot || !slot.statKey || slot.statModifierBonus === 0) continue;
    const ability = slot.statKey as AbilityStat;
    if (!ABILITIES.includes(ability)) continue;
    running[ability] += slot.statModifierBonus;
    bonuses[ability] += slot.statModifierBonus;
  }

  const result = {} as CharacterStats;
  for (const ability of ABILITIES) {
    const base = baseRecord[BASE_FIELD[ability]];
    result[ability] = { base, bonus: bonuses[ability], total: running[ability] };
  }

  return result;
}
