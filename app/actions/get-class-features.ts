"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

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
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  return prisma.classFeature.findMany({
    where:   { characterClass, level: { lte: maxLevel } },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    select: {
      id: true, characterClass: true, level: true, name: true, description: true,
    },
  });
}
