"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { takeTurn } from "./take-turn";
import type { TurnResult } from "./take-turn";

/**
 * Resolves a turn whose dice roll was pre-seeded via /api/rolls/secure-seed.
 *
 * Looks up the stored d20 by rollRequestId, delegates to takeTurn() with the
 * pre-verified value (bypassing its internal rollD20Check), then deletes the
 * PendingRoll record so the seed cannot be replayed.
 */
export async function completeTurn(
  gameId:        string,
  chipText:      string,
  rollRequestId: string,
): Promise<TurnResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const pendingRoll = await prisma.pendingRoll.findUnique({
    where: { requestId: rollRequestId },
  });
  if (!pendingRoll) {
    return { success: false, error: "Roll request not found or expired." };
  }
  if (pendingRoll.expiresAt < new Date()) {
    await prisma.pendingRoll.delete({ where: { requestId: rollRequestId } }).catch(() => {});
    return { success: false, error: "Roll request expired." };
  }

  const result = await takeTurn(gameId, chipText, undefined, pendingRoll.d20);

  // Delete regardless of takeTurn outcome — a failed turn should not allow replay.
  await prisma.pendingRoll.delete({ where: { requestId: rollRequestId } }).catch(() => {});

  return result;
}
