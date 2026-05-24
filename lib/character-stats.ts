// ─── Active Character Stats ───────────────────────────────────────────────────
// Computes effective ability scores by layering item bonuses on top of base
// stats. Two-pass pipeline: flat additives first, overrides second.
//
// statBonuses JSON shape (per schema comment):
//   Flat additive : { "strength": 2 }
//   Override      : { "strength": { "type": "override", "value": 19 } }

import { prisma } from "./prisma";

// ─── Types ────────────────────────────────────────────────────────────────────

type AbilityStat = "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";

const ABILITIES: AbilityStat[] = [
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
];

// Maps the base* field names on Character to the canonical ability key.
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

type StatBonusEntry = number | { type: "override"; value: number };
type StatBonusMap   = Partial<Record<AbilityStat, StatBonusEntry>>;

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
      mainHand: { select: { statBonuses: true } },
      offHand:  { select: { statBonuses: true } },
      armor:    { select: { statBonuses: true } },
      ring:     { select: { statBonuses: true } },
    },
  });

  // Collect the statBonuses from each occupied slot.
  const slotBonuses: StatBonusMap[] = [
    character.mainHand?.statBonuses,
    character.offHand?.statBonuses,
    character.armor?.statBonuses,
    character.ring?.statBonuses,
  ].filter(Boolean).map((raw) => raw as StatBonusMap);

  // Seed accumulators from base stats.
  const running: Record<AbilityStat, number> = {} as Record<AbilityStat, number>;
  const bonuses: Record<AbilityStat, number> = {} as Record<AbilityStat, number>;

  const baseRecord = character as unknown as Record<string, number>;
  for (const ability of ABILITIES) {
    running[ability] = baseRecord[BASE_FIELD[ability]];
    bonuses[ability] = 0;
  }

  // Pass 1: apply all flat additives.
  for (const bonusMap of slotBonuses) {
    for (const ability of ABILITIES) {
      const entry = bonusMap[ability];
      if (typeof entry === "number") {
        running[ability] += entry;
        bonuses[ability] += entry;
      }
    }
  }

  // Pass 2: apply overrides — only if the override value exceeds current total.
  for (const bonusMap of slotBonuses) {
    for (const ability of ABILITIES) {
      const entry = bonusMap[ability];
      if (typeof entry === "object" && entry.type === "override" && entry.value > running[ability]) {
        const gain = entry.value - running[ability];
        bonuses[ability] += gain;
        running[ability]  = entry.value;
      }
    }
  }

  // Build the output payload.
  const result = {} as CharacterStats;
  for (const ability of ABILITIES) {
    const base = baseRecord[BASE_FIELD[ability]];
    result[ability] = { base, bonus: bonuses[ability], total: running[ability] };
  }

  return result;
}
