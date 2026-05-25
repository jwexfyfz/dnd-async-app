"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import type { TurnCostType } from "../../types/turn-actions";

interface SyncPayload {
  characterId: string;
  costType:    TurnCostType;
  value:       number;
}

interface ActionResponse {
  success: boolean;
  error?:  string;
}

export async function syncConsumedResource(
  { characterId, costType, value }: SyncPayload,
): Promise<ActionResponse> {
  // Free actions carry no resource cost — skip the round-trip entirely.
  if (costType === "free") return { success: true };

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  try {
    const character = await prisma.character.findUnique({
      where:  { id: characterId },
      select: { userId: true },
    });
    if (!character)               return { success: false, error: "Character not found." };
    if (character.userId !== user.id) return { success: false, error: "Not authorized."    };

    // Decrement the named column but floor it at 0 so it can never go negative.
    const colMap: Record<string, string> = {
      mainAction:   "remainingActions",
      bonusAction:  "remainingBonusActions",
      movementFeet: "remainingMovementFeet",
    };
    const col = colMap[costType];
    if (!col) return { success: false, error: "Invalid cost type." };

    await prisma.$executeRawUnsafe(
      `UPDATE "Character" SET "${col}" = GREATEST("${col}" - $1::int, 0) WHERE id = $2`,
      value,
      characterId,
    );
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Sync failed.";
    return { success: false, error: msg };
  }
}
