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
  storyId: string
): Promise<StartGameResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const existingGame = await prisma.game.findFirst({
    where:  { characterId, status: "ACTIVE" },
    select: { id: true },
  });
  if (existingGame) return { success: true, gameId: existingGame.id };

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character || character.userId !== user.id) {
    return { success: false, error: "Character not found." };
  }

  // Load Act 1 and its map to get the starting position.
  const act1 = await prisma.act.findFirst({
    where:   { storyId, order: 1 },
    include: { map: true, scenes: { where: { order: 1 } } },
  });
  if (!act1 || !act1.map) return { success: false, error: "Story not found or missing map." };

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return { success: false, error: "Story not found." };

  const mapData     = act1.map.data as { playerStart: { x: number; y: number } };
  const startingHp  = character.maxHp;
  const act1scene1  = act1.scenes[0];

  const initialState = {
    playerPos:       mapData.playerStart,
    hp:              startingHp,
    maxHp:           startingHp,
    inventory:       [] as string[],
    equipped:        { weapon: null as string | null, armor: null as string | null },
    npcsEncountered: [] as { name: string; disposition: string; note: string }[],
    plotFlags:       [] as string[],
    activeObjective: act1.title,
  };

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
    const game = await prisma.game.create({
      data: {
        characterId,
        storyId,
        currentActId:   act1.id,
        currentSceneId: act1scene1?.id ?? null,
        mapId:          act1.map.id,
        state:          initialState,
        status:         "ACTIVE",
        phase:          "LOBBY",
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
