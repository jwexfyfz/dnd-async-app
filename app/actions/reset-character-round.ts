"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { computeCaps } from "../../lib/turn-caps";

interface ActionResponse {
  success: boolean;
  error?:  string;
}

export async function resetCharacterRound(characterId: string): Promise<ActionResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  try {
    const character = await prisma.character.findUnique({
      where:  { id: characterId },
      select: { userId: true, characterClass: true, level: true },
    });
    if (!character)                   return { success: false, error: "Character not found." };
    if (character.userId !== user.id) return { success: false, error: "Not authorized."      };

    const { maxAction, maxBonusAction, maxMovementFeet } =
      computeCaps(character.characterClass, character.level);

    await prisma.character.update({
      where: { id: characterId },
      data:  {
        remainingActions:      maxAction,
        remainingBonusActions: maxBonusAction,
        remainingMovementFeet: maxMovementFeet,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Reset failed.";
    return { success: false, error: msg };
  }
}
