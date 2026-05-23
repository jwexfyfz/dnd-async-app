"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS } from "../../lib/ai-config";

interface InitResult {
  success: boolean;
  narrative?: string;
  chips?: string[];
  error?: string;
}

// Called once when a game's message log is empty — i.e. the player has just
// started this adventure for the first time. Generates the opening scene
// narration and the first set of suggestion chips.
//
// Shares the same cached system prompt prefix as takeTurn, so the cache
// written here is reused by every subsequent turn at no extra cost.
export async function initializeGame(gameId: string): Promise<InitResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      storyPrompt:  true,
      map:          true,
      messages:     { take: 1 },
      partyMembers: { select: { userId: true } },
    },
  });

  if (!game) return { success: false, error: "Game not found." };

  const isHost   = game.character.userId === user.id;
  const isMember = game.partyMembers.some((m) => m.userId === user.id);
  if (!isHost && !isMember) return { success: false, error: "Access denied." };

  // Guard against double-initialization (e.g. React strict mode firing twice).
  // Any party member or host can retrieve the existing opening scene.
  if (game.messages.length > 0) {
    const firstMsg = await prisma.message.findFirst({
      where: { gameId, role: "DUNGEON_MASTER" },
      orderBy: { createdAt: "asc" },
    });
    return {
      success:   true,
      narrative: firstMsg?.content ?? "",
      chips:     (firstMsg?.chips as string[] | null) ?? [],
    };
  }

  // Only the host can generate the opening scene.
  if (!isHost) return { success: false, error: "Access denied." };

  const client  = new Anthropic();
  const mapData = game.map.data as Record<string, any>;
  const gameState = game.state as Record<string, any>;

  // Build the same static/dynamic split used in takeTurn so that this
  // first call primes the cache for all future turns.
  const staticPrompt = buildStaticPrompt(game.character, game.storyPrompt, mapData);
  const dynamicPrompt = buildDynamicStatePrompt(gameState);

  let response;
  try {
    response = await client.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: staticPrompt,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: dynamicPrompt },
      ],
      messages: [
        {
          role: "user",
          content:
            "The player has just arrived at their starting location. " +
            "Set the opening scene: describe what they see, hear, and feel. " +
            "Respond with JSON only.",
        },
      ],
    });
  } catch (err: any) {
    console.error("AI DM init error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText   = textBlock?.text ?? "";

  let parsed: { narrative: string; stateDeltas: Record<string, any>; chips: string[] };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? rawText);
  } catch {
    parsed = {
      narrative:   rawText || "You stand at the threshold of your adventure.",
      stateDeltas: {},
      chips:       ["Look around", "Examine the area", "Listen carefully"],
    };
  }

  // Save the opening DM message.
  await prisma.message.create({
    data: {
      gameId,
      role:    "DUNGEON_MASTER",
      content: parsed.narrative,
      chips:   parsed.chips,
    },
  });

  // Apply any immediate state deltas (e.g. if the DM set a starting position).
  if (Object.keys(parsed.stateDeltas ?? {}).length > 0) {
    const newState = { ...gameState, ...parsed.stateDeltas };
    await prisma.game.update({ where: { id: gameId }, data: { state: newState } });
  }

  return { success: true, narrative: parsed.narrative, chips: parsed.chips };
}

// ─── Shared prompt helpers (duplicated from take-turn to avoid circular imports) ──

function buildStaticPrompt(character: any, storyPrompt: any, mapData: any): string {
  const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois  = mapData.pois?.map((p: any) => `${p.name} [${p.symbol}] at (${p.x},${p.y})`).join(", ") ?? "—";

  return `You are a skilled, atmospheric Dungeon Master running an async D&D 5e campaign. Your prose is vivid but concise — 2–4 sentences of present-tense narration per turn. You create tension, wonder, and consequence without overwrought description.

CHARACTER
Name: ${character.name} | Class: ${character.characterClass}
STR ${character.strength} | DEX ${character.dexterity} | CON ${character.constitution} | INT ${character.intelligence} | WIS ${character.wisdom} | CHA ${character.charisma}

SCENARIO: ${storyPrompt.title}
${storyPrompt.description}

MAP: ${mapData.name ?? "Unknown Location"}
Rooms: ${rooms}
Points of interest: ${pois}

RESPONSE RULES
Always reply with a single JSON object — no markdown fences, no extra text.
{
  "narrative": "2–4 sentences. Vivid, present tense. Describe what the character sees, hears, or feels.",
  "stateDeltas": {
    // Include ONLY fields that changed this turn. Omit everything else.
    // "hp": 15  "inventory": ["torch"]  "playerPos": {"x":1,"y":1}
    // "plotFlags": ["arrived"]  "activeObjective": "Find the merchant"
  },
  "chips": ["Short action 1", "Short action 2", "Short action 3", "Short action 4"]
}
chips: 3–5 options, each under 6 words. Make them situationally specific.`;
}

function buildDynamicStatePrompt(gameState: any): string {
  const inv   = gameState.inventory?.length ? gameState.inventory.join(", ") : "empty";
  const flags = gameState.plotFlags?.length ? gameState.plotFlags.join(", ") : "none";

  const isParty = gameState.partyHp != null;
  const hpLine  = isParty
    ? Object.entries(gameState.partyHp as Record<string, number>)
        .map(([id, hp]) => `${id}: ${hp}/${(gameState.partyMaxHp as Record<string, number>)?.[id] ?? "?"}`)
        .join(", ")
    : `${gameState.hp ?? "?"}/${gameState.maxHp ?? "?"}`;
  const posX = gameState.playerPos?.x ?? 0;
  const posY = gameState.playerPos?.y ?? 0;

  return `CURRENT STATE
Position: (${posX}, ${posY})
HP: ${hpLine}
Inventory: ${inv}
Objective: ${gameState.activeObjective ?? "Begin the adventure"}
Plot flags: ${flags}`;
}
