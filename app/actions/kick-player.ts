"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

// Host-only: remove another player from the lobby.
export async function kickPlayer(gameId: string, targetMemberId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: { character: true },
  });
  if (!game) return { success: false, error: "Game not found." };
  if (game.character.userId !== user.id) {
    return { success: false, error: "Only the host can kick players." };
  }

  const target = await prisma.partyMember.findUnique({
    where: { id: targetMemberId },
  });
  if (!target || target.gameId !== gameId) {
    return { success: false, error: "Player not found in this game." };
  }
  // Prevent the host from kicking themselves.
  if (target.characterId === game.characterId) {
    return { success: false, error: "Cannot kick the host." };
  }

  await prisma.partyMember.delete({ where: { id: targetMemberId } });
  return { success: true };
}
