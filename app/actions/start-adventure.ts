"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function startAdventure(gameId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      map:          true,
      partyMembers: { include: { character: true } },
    },
  });
  if (!game) return { success: false, error: "Game not found." };
  if (game.character.userId !== user.id) {
    return { success: false, error: "Only the host can start the game." };
  }
  if (game.phase !== "LOBBY") return { success: false, error: "Game already started." };
  if (game.partyMembers.length === 0) return { success: false, error: "No party members." };

  // Initiative order: sort by DEX score descending.
  // Ties broken by total ability score sum, then alphabetically by character name.
  const sorted = [...game.partyMembers].sort((a, b) => {
    if (b.character.dexterity !== a.character.dexterity) {
      return b.character.dexterity - a.character.dexterity;
    }
    const totalA = a.character.strength + a.character.dexterity + a.character.constitution +
                   a.character.intelligence + a.character.wisdom + a.character.charisma;
    const totalB = b.character.strength + b.character.dexterity + b.character.constitution +
                   b.character.intelligence + b.character.wisdom + b.character.charisma;
    if (totalB !== totalA) return totalB - totalA;
    return a.character.name.localeCompare(b.character.name);
  });

  const mapData = game.map.data as { playerStart: { x: number; y: number } };

  // Build party-scoped position and HP maps, initialising everyone at the
  // map's start tile with HP derived from their CON modifier.
  const partyPositions: Record<string, { x: number; y: number }> = {};
  const partyHp:        Record<string, number> = {};
  const partyMaxHp:     Record<string, number> = {};

  const turnUpdates = sorted.map((member, i) => {
    const hp = member.character.maxHp;   // canonical, stored at character creation (D-03)
    partyPositions[member.characterId] = mapData.playerStart;
    partyHp[member.characterId]        = hp;
    partyMaxHp[member.characterId]     = hp;
    return prisma.partyMember.update({
      where: { id: member.id },
      data:  { turnOrder: i },
    });
  });

  const existingState = game.state as Record<string, any>;
  const newState = { ...existingState, partyPositions, partyHp, partyMaxHp };

  await Promise.all([
    ...turnUpdates,
    prisma.game.update({
      where: { id: gameId },
      data:  {
        phase:                 "ACTIVE",
        currentTurnCharacterId: sorted[0].characterId,
        state:                 newState,
      },
    }),
  ]);

  return { success: true };
}
