"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function getGame(gameId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:     true,
      story:         true,
      currentAct:    true,
      currentScene:  true,
      combatSession: true,
      gameMaps: {
        orderBy: { createdAt: "desc" as const },
        take:    1,
        include: { map: { select: { id: true, name: true } } },
      },
      messages:      { orderBy: { createdAt: "asc" } },
      partyMembers:  {
        include: {
          character: true,
          user:      { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { turnOrder: "asc" },
      },
    },
  });

  if (!game) {
    return { success: false, error: "Game not found." };
  }

  // Lobby games are publicly viewable — unauthenticated users need to see the
  // party list and story prompt before they can decide whether to sign in.
  if (game.phase === "LOBBY") {
    return { success: true, data: game };
  }

  // Active / completed games require authentication and membership.
  if (!user) {
    return { success: false, error: "Not authenticated." };
  }

  const isMember = game.partyMembers.some((m) => m.userId === user.id);
  const isHost   = game.character.userId === user.id;
  if (!isMember && !isHost) {
    return { success: false, error: "Access denied." };
  }

  // Build a synthetic `map` from the active GameMap so page.tsx stays compatible.
  const activeGM = (game as any).gameMaps?.[0];
  const syntheticMap = activeGM
    ? { id: activeGM.mapId, name: activeGM.map?.name ?? "Unknown", data: activeGM.data }
    : null;

  return { success: true, data: { ...game, map: syntheticMap } };
}
