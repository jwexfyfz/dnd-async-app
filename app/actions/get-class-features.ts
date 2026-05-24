"use server";

import { prisma } from "../../lib/prisma";

export interface ClassFeatureData {
  id:             string;
  characterClass: string;
  level:          number;
  name:           string;
  description:    string;
}

export async function getClassFeatures(
  characterClass: string,
  maxLevel:       number,
): Promise<ClassFeatureData[]> {
  return prisma.classFeature.findMany({
    where:   { characterClass, level: { lte: maxLevel } },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    select: {
      id: true, characterClass: true, level: true, name: true, description: true,
    },
  });
}
