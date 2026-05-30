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
      gameMaps:     { orderBy: { createdAt: "desc" as const }, take: 1, select: { data: true } },
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
    if (b.character.baseDexterity !== a.character.baseDexterity) {
      return b.character.baseDexterity - a.character.baseDexterity;
    }
    const totalA = a.character.baseStrength + a.character.baseDexterity + a.character.baseConstitution +
                   a.character.baseIntelligence + a.character.baseWisdom + a.character.baseCharisma;
    const totalB = b.character.baseStrength + b.character.baseDexterity + b.character.baseConstitution +
                   b.character.baseIntelligence + b.character.baseWisdom + b.character.baseCharisma;
    if (totalB !== totalA) return totalB - totalA;
    return a.character.name.localeCompare(b.character.name);
  });

  const mapData = ((game as any).gameMaps?.[0]?.data ?? {}) as { playerStart?: { x: number; y: number } };

  // Build party-scoped position and HP maps, initialising everyone at the
  // map's start tile with HP derived from their CON modifier.
  const partyPositions: Record<string, { x: number; y: number }> = {};
  const partyHp:        Record<string, number> = {};
  const partyMaxHp:     Record<string, number> = {};

  const turnUpdates = sorted.map((member, i) => {
    const hp = member.character.maxHp;   // canonical, stored at character creation (D-03)
    partyPositions[member.characterId] = mapData.playerStart ?? { x: 0, y: 0 };
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
