"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function deleteCharacter(characterId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const character = await prisma.character.findUnique({
    where:   { id: characterId },
    include: { games: { where: { status: "ACTIVE" } } },
  });
  if (!character)                      return { success: false, error: "Character not found." };
  if (character.userId !== user.id)    return { success: false, error: "Not your character." };

  // For each game the character hosts, delete all child records before the game.
  for (const game of character.games) {
    await prisma.message.deleteMany({ where: { gameId: game.id } });
    await prisma.partyMember.deleteMany({ where: { gameId: game.id } });
    await prisma.game.delete({ where: { id: game.id } });
  }

  // Remove any remaining party memberships (non-host games the char joined).
  await prisma.partyMember.deleteMany({ where: { characterId } });

  await prisma.character.delete({ where: { id: characterId } });
  return { success: true };
}
