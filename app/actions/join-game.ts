"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

const MAX_PARTY_SIZE = 4;

interface JoinResult {
  success: boolean;
  error?: string;
}

export async function joinGame(gameId: string, characterId: string): Promise<JoinResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: { partyMembers: true },
  });
  if (!game) return { success: false, error: "Game not found." };
  if (game.phase !== "LOBBY") return { success: false, error: "This game has already started." };
  if (game.partyMembers.length >= MAX_PARTY_SIZE) {
    return { success: false, error: "This party is full (max 4 players)." };
  }

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.userId !== user.id) {
    return { success: false, error: "Character not found." };
  }

  // Prevent the same user or character from joining twice.
  const alreadyIn = game.partyMembers.some(
    (m) => m.userId === user.id || m.characterId === characterId
  );
  if (alreadyIn) return { success: false, error: "Already in this game." };

  // Upsert display name so party cards are populated immediately.
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name    as string | undefined) ||
    user.email?.split("@")[0] || "Adventurer";

  await prisma.user.upsert({
    where:  { id: user.id },
    update: { displayName },
    create: { id: user.id, email: user.email!, displayName },
  });

  await prisma.partyMember.create({
    data: {
      gameId,
      characterId,
      userId:    user.id,
      status:    "JOINED",
      turnOrder: game.partyMembers.length, // provisional; overwritten by startAdventure
    },
  });

  return { success: true };
}
