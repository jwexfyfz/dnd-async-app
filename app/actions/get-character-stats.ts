"use server";

import { computeCharacterStats } from "../../lib/character-stats";
import type { CharacterStats } from "../../lib/character-stats";

export async function getCharacterStats(characterId: string): Promise<CharacterStats> {
  return computeCharacterStats(characterId);
}
