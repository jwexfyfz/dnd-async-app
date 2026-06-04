"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../../lib/prisma";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS } from "../../../lib/ai-config";

const anthropic = new Anthropic({ maxRetries: 4 });

export async function startAdventure(gameId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      story:        { include: { acts: { select: { order: true, title: true, summary: true }, orderBy: { order: "asc" } } } },
      currentAct:   true,
      currentScene: true,
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

  const mapData = ((game as any).gameMaps?.[0]?.data ?? {}) as { playerStart?: { x: number; y: number }; name?: string; rooms?: any[]; pois?: any[] };

  const partyPositions: Record<string, { x: number; y: number }> = {};
  const partyHp:        Record<string, number> = {};
  const partyMaxHp:     Record<string, number> = {};

  const turnUpdates = sorted.map((member, i) => {
    const hp = member.character.maxHp;
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
        phase:                  "ACTIVE",
        currentTurnCharacterId: sorted[0].characterId,
        state:                  newState,
      },
    }),
  ]);

  // Generate and persist the opening DM narrative so every player sees it on load.
  try {
    const story       = (game as any).story;
    const currentAct  = (game as any).currentAct;
    const currentScene = (game as any).currentScene;

    const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
    const pois  = mapData.pois?.map((p: any) => `${p.name} [${p.symbol}] at (${p.x},${p.y})`).join(", ") ?? "—";
    const actSummaries = story?.acts?.map((a: any) => `  Act ${a.order}: ${a.title} — ${a.summary}`).join("\n") ?? "";
    const actBlock     = currentAct  ? `CURRENT ACT ${currentAct.order}: ${currentAct.title}\n${currentAct.playerFacingDescription}` : "";
    const sceneBlock   = currentScene ? `CURRENT SCENE ${currentScene.order}: ${currentScene.title}\n${currentScene.description}` : "";

    const partyLine = sorted.map(m =>
      `${m.character.name} (${m.character.characterClass}, LVL ${m.character.level})`
    ).join(", ");

    const systemPrompt = `You are a skilled, atmospheric Dungeon Master running an async D&D 5e campaign. Your prose is vivid but concise.

PARTY: ${partyLine}

OVERARCHING STORY: ${story?.title ?? "Unknown"}
${actSummaries}

${actBlock}

${sceneBlock}

MAP: ${mapData.name ?? "Unknown Location"}
Rooms: ${rooms}
Points of interest: ${pois}

RESPONSE RULES
Reply with a single JSON object only — no markdown fences.
{
  "narrative": "3–5 sentences. Vivid, present tense. Set the scene: what the party sees, hears, smells, feels as they arrive.",
  "chips": [{"text": "Under 6 words", "type": "perception"}]
}
chips: 3–4 situationally specific options. Types: perception, investigation, athletics, stealth, insight, arcana, survival.`;

    const response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: "user", content: "The party has just arrived at their starting location. Open the scene." }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    const rawText   = textBlock?.text ?? "";

    let parsed: { narrative: string; chips: any[] };
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match?.[0] ?? rawText);
    } catch {
      parsed = {
        narrative: "You arrive at the threshold of your adventure. The air is thick with anticipation as the dungeon stretches before you.",
        chips: [{ text: "Look around", type: "perception" }, { text: "Search for traps", type: "investigation" }],
      };
    }

    await prisma.message.create({
      data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips },
    });
  } catch (err: any) {
    console.error("[start-adventure] opening narrative failed:", err.message);
    // Non-fatal — game is active, opening narrative just won't be pre-generated.
  }

  return { success: true };
}
