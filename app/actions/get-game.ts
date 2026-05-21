"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function getGame(gameId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  console.log("[getGame] userId:", user?.id ?? "anonymous", "gameId:", gameId);

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:   true,
      storyPrompt: true,
      map:         true,
      messages:    { orderBy: { createdAt: "asc" } },
      partyMembers: {
        include: {
          character: true,
          user:      { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { turnOrder: "asc" },
      },
    },
  });

  if (!game) {
    console.log("[getGame] game not found:", gameId);
    return { success: false, error: "Game not found." };
  }

  console.log("[getGame] phase:", game.phase, "members:", game.partyMembers.length);

  // Lobby games are publicly viewable — unauthenticated users need to see the
  // party list and story prompt before they can decide whether to sign in.
  if (game.phase === "LOBBY") {
    return { success: true, data: game };
  }

  // Active / completed games require authentication and membership.
  if (!user) {
    console.log("[getGame] unauthenticated request for non-lobby game:", gameId);
    return { success: false, error: "Not authenticated." };
  }

  const isMember = game.partyMembers.some((m) => m.userId === user.id);
  const isHost   = game.character.userId === user.id;
  if (!isMember && !isHost) {
    console.log("[getGame] access denied for user:", user.id);
    return { success: false, error: "Access denied." };
  }

  return { success: true, data: game };
}
