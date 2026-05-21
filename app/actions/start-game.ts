"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

interface StartGameResult {
  success: boolean;
  gameId?: string;
  error?: string;
}

export async function startGame(
  characterId: string,
  storyPromptId: string
): Promise<StartGameResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  // If this character already has a lobby or active game, return it.
  const existingGame = await prisma.game.findFirst({
    where:  { characterId, status: "ACTIVE" },
    select: { id: true },
  });
  if (existingGame) return { success: true, gameId: existingGame.id };

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.userId !== user.id) {
    return { success: false, error: "Character not found." };
  }

  const storyPrompt = await prisma.storyPrompt.findUnique({
    where:   { id: storyPromptId },
    include: { map: true },
  });
  if (!storyPrompt) return { success: false, error: "Story not found." };

  const conModifier = Math.floor((character.constitution - 10) / 2);
  const startingHp  = 10 + conModifier;
  const mapData     = storyPrompt.map.data as { playerStart: { x: number; y: number } };

  const initialState = {
    playerPos:       mapData.playerStart,
    hp:              startingHp,
    maxHp:           startingHp,
    inventory:       [] as string[],
    equipped:        { weapon: null as string | null, armor: null as string | null },
    npcsEncountered: [] as { name: string; disposition: string; note: string }[],
    plotFlags:       [] as string[],
    activeObjective: storyPrompt.title,
  };

  // Upsert the user's display name so party cards show their Google name.
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name    as string | undefined) ||
    user.email?.split("@")[0] || "Adventurer";

  await prisma.user.upsert({
    where:  { id: user.id },
    update: { displayName },
    create: { id: user.id, email: user.email!, displayName },
  });

  try {
    // Create the game in LOBBY phase — the host starts the actual adventure
    // from the lobby page once other players have joined.
    const game = await prisma.game.create({
      data: {
        characterId,
        storyPromptId,
        mapId: storyPrompt.mapId,
        state:  initialState,
        status: "ACTIVE",
        phase:  "LOBBY",
        // Add the host as the first party member.
        partyMembers: {
          create: {
            characterId,
            userId:    user.id,
            status:    "JOINED",
            turnOrder: 0,
          },
        },
      },
    });

    return { success: true, gameId: game.id };
  } catch (error: any) {
    console.error("Failed to create game:", error);
    return { success: false, error: error.message };
  }
}
