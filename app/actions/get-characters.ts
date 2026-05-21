"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function getCharacters() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated.", data: [] };

  try {
    const characters = await prisma.character.findMany({
      where:   { userId: user.id },
      include: {
        // Hosted games (character is the game creator).
        games: {
          where:   { status: "ACTIVE" },
          take:    1,
          orderBy: { updatedAt: "desc" },
          include: {
            storyPrompt:  { select: { title: true } },
            partyMembers: {
              orderBy: { turnOrder: "asc" },
              include: {
                character: { select: { id: true, name: true, characterClass: true } },
              },
            },
          },
        },
        // Non-host party memberships — catches games the character joined
        // via an invite link where they are not the host.
        partyMemberships: {
          where: { game: { status: "ACTIVE" } },
          include: {
            game: {
              include: {
                storyPrompt:  { select: { title: true } },
                partyMembers: {
                  orderBy: { turnOrder: "asc" },
                  include: {
                    character: { select: { id: true, name: true, characterClass: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Characters mid-adventure float to the top; consider both hosting and
    // party-member games when comparing recency.
    characters.sort((a, b) => {
      const aTime = Math.max(
        a.games[0]?.updatedAt?.getTime() ?? 0,
        a.partyMemberships[0]?.game?.updatedAt?.getTime() ?? 0,
      );
      const bTime = Math.max(
        b.games[0]?.updatedAt?.getTime() ?? 0,
        b.partyMemberships[0]?.game?.updatedAt?.getTime() ?? 0,
      );
      return bTime - aTime;
    });

    return { success: true, data: characters };
  } catch (error: any) {
    console.error("Failed to fetch characters:", error);
    return { success: false, error: error.message, data: [] };
  }
}
