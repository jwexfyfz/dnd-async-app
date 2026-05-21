"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

// Non-host party members can leave a game from the lobby or during play.
// The host cannot leave — they can disband the game instead (future feature).
export async function leaveGame(gameId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    select:  { characterId: true, phase: true },
  });
  if (!game) return { success: false, error: "Game not found." };

  const member = await prisma.partyMember.findFirst({
    where: { gameId, userId: user.id },
  });
  if (!member) return { success: false, error: "Not in this game." };

  // The host (creator) cannot leave — they own the game.
  if (member.characterId === game.characterId) {
    return { success: false, error: "The host cannot leave. You can disband the game instead." };
  }

  await prisma.partyMember.delete({ where: { id: member.id } });
  return { success: true };
}
