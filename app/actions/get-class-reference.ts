"use server";

import { prisma } from "../../lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClassFeatureData {
  id:          string;
  name:        string;
  description: string;
}

export interface ClassReferenceData {
  characterClass:   string;
  level:            number;
  proficiencyBonus: number;
  featuresUnlocked: string[];
  resourcePoolMax:  number | null;
  features:         ClassFeatureData[];
}

// ─── Query ───────────────────────────────────────────────────────────────────

export async function getClassReference(
  classId: string,
  level: number,
): Promise<ClassReferenceData | null> {
  const row = await prisma.classProgression.findUnique({
    where:   { characterClass_level: { characterClass: classId, level } },
    include: { features: { select: { id: true, name: true, description: true } } },
  });

  if (!row) return null;

  return {
    characterClass:   row.characterClass,
    level:            row.level,
    proficiencyBonus: row.proficiencyBonus,
    featuresUnlocked: row.featuresUnlocked,
    resourcePoolMax:  row.resourcePoolMax,
    features:         row.features,
  };
}
