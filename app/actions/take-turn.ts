"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE } from "../../lib/ai-config";

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildStaticPrompt(character: any, allMembers: any[], storyPrompt: any, mapData: any): string {
  const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois  = mapData.pois?.map((p: any) => `${p.name} [${p.symbol}] at (${p.x},${p.y})`).join(", ") ?? "—";

  // Describe all party members so the DM can reference them by name.
  const partyLines = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name} (${m.character.characterClass}): STR${m.character.strength} DEX${m.character.dexterity} CON${m.character.constitution} INT${m.character.intelligence} WIS${m.character.wisdom} CHA${m.character.charisma}`
      ).join("\n")
    : `  ${character.name} (${character.characterClass}): STR${character.strength} DEX${character.dexterity} CON${character.constitution} INT${character.intelligence} WIS${character.wisdom} CHA${character.charisma}`;

  return `You are a skilled, atmospheric Dungeon Master running an async D&D 5e campaign. Your prose is vivid but concise — 2–4 sentences of present-tense narration per turn. You create tension, wonder, and consequence without overwrought description.

PARTY
${partyLines}

SCENARIO: ${storyPrompt.title}
${storyPrompt.description}

MAP: ${mapData.name ?? "Unknown Location"}
Rooms: ${rooms}
Points of interest: ${pois}

RESPONSE RULES
Always reply with a single JSON object — no markdown fences, no extra text.
{
  "narrative": "2–4 sentences. Vivid, present tense. Address the active character by name.",
  "stateDeltas": {
    // Only include fields that changed this turn. Omit everything else.
    // "hp": 15               (active character's new HP)
    // "playerPos": {x,y}    (active character's new position)
    // "inventory": [...]     (full updated shared inventory)
    // "plotFlags": [...]     (full updated list)
    // "activeObjective": "..." (if the objective changed)
    // "npcsEncountered": [{name, disposition, note}]
  },
  "chips": ["Short action 1", "Short action 2", "Short action 3", "Short action 4"]
}
chips: 3–5 options, each under 6 words. Situationally specific to what just happened.`;
}

function buildDynamicStatePrompt(
  gameState: any,
  partyMembers: any[],
  currentCharId: string,
): string {
  const inv   = gameState.inventory?.length ? gameState.inventory.join(", ") : "empty";
  const flags = gameState.plotFlags?.length ? gameState.plotFlags.join(", ") : "none";

  if (partyMembers.length > 1 && gameState.partyHp) {
    // Party game — describe each member's current status.
    const memberLines = partyMembers
      .map((m: any) => {
        const hp    = gameState.partyHp?.[m.characterId] ?? "?";
        const maxHp = gameState.partyMaxHp?.[m.characterId] ?? "?";
        const pos   = gameState.partyPositions?.[m.characterId] ?? { x: 0, y: 0 };
        const arrow = m.characterId === currentCharId ? "→ " : "  ";
        return `${arrow}${m.character.name}: HP ${hp}/${maxHp}, pos (${pos.x},${pos.y})`;
      })
      .join("\n");

    return `PARTY STATE (→ = active character this turn)
${memberLines}
Shared inventory: ${inv}
Objective: ${gameState.activeObjective}
Plot flags: ${flags}`;
  }

  // Solo / legacy game.
  return `CURRENT STATE
Position: (${gameState.playerPos?.x ?? 0}, ${gameState.playerPos?.y ?? 0})
HP: ${gameState.hp}/${gameState.maxHp}
Inventory: ${inv}
Weapon: ${gameState.equipped?.weapon ?? "none"} | Armor: ${gameState.equipped?.armor ?? "none"}
Objective: ${gameState.activeObjective}
Plot flags: ${flags}
NPCs met: ${gameState.npcsEncountered?.map((n: any) => `${n.name} (${n.disposition})`).join(", ") ?? "none"}`;
}

function buildConversationMessages(
  recentMessages: { role: string; content: string }[],
  currentAction: string,
) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  if (recentMessages.length === 0 || recentMessages[0].role === "DUNGEON_MASTER") {
    out.push({ role: "user", content: "The adventure begins." });
  }
  for (const msg of recentMessages) {
    out.push({
      role:    msg.role === "PLAYER" ? "user" : "assistant",
      content: msg.content,
    });
  }
  out.push({ role: "user", content: `Player action: ${currentAction}` });
  return out;
}

// ─── Action ───────────────────────────────────────────────────────────────────

interface TurnResult {
  success:   boolean;
  narrative?: string;
  chips?:     string[];
  newState?:  Record<string, unknown>;
  error?:     string;
}

export async function takeTurn(gameId: string, chipText: string): Promise<TurnResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:   true,
      storyPrompt: true,
      map:         true,
      messages:    { orderBy: { createdAt: "asc" } },
      partyMembers: {
        include:  { character: true },
        orderBy:  { turnOrder: "asc" },
      },
    },
  });
  if (!game) return { success: false, error: "Game not found." };

  // Verify it's this user's turn when the game has a party.
  const callerMember = game.partyMembers.find((m) => m.userId === user.id);
  if (game.partyMembers.length > 0 && game.currentTurnCharacterId) {
    if (!callerMember) return { success: false, error: "You are not in this game." };
    if (game.currentTurnCharacterId !== callerMember.characterId) {
      return { success: false, error: "It's not your turn." };
    }
  } else if (game.character.userId !== user.id) {
    // Legacy solo game fallback.
    return { success: false, error: "Access denied." };
  }

  const currentCharId = callerMember?.characterId ?? game.characterId;

  await prisma.message.create({
    data: { gameId, role: "PLAYER", content: chipText },
  });

  const contextWindow = game.messages.slice(-ROLLING_WINDOW_SIZE);
  const client        = new Anthropic();
  const gameState     = game.state as Record<string, any>;
  const mapData       = game.map.data as Record<string, any>;

  let response;
  try {
    response = await client.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system: [
        {
          type:          "text",
          text:          buildStaticPrompt(game.character, game.partyMembers, game.storyPrompt, mapData),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: buildDynamicStatePrompt(gameState, game.partyMembers, currentCharId),
        },
      ],
      messages: buildConversationMessages(contextWindow, chipText),
    });
  } catch (err: any) {
    console.error("AI DM error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  const rawText = response.content.find((b) => b.type === "text")
    ? (response.content.find((b) => b.type === "text") as Anthropic.TextBlock).text
    : "";

  let parsed: { narrative: string; stateDeltas: Record<string, any>; chips: string[] };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? rawText);
  } catch {
    parsed = {
      narrative:   rawText || "The dungeon stirs around you.",
      stateDeltas: {},
      chips:       ["Look around carefully", "Listen for sounds", "Check your gear"],
    };
  }

  // Apply stateDeltas. For party games, route per-character fields (hp,
  // playerPos) into the party-scoped maps rather than overwriting global state.
  const newState: Record<string, any> = { ...gameState };
  const deltas = { ...parsed.stateDeltas };

  if (game.partyMembers.length > 1 && newState.partyHp) {
    if (deltas.hp !== undefined) {
      newState.partyHp = { ...newState.partyHp, [currentCharId]: deltas.hp };
      delete deltas.hp;
    }
    if (deltas.playerPos !== undefined) {
      newState.partyPositions = { ...newState.partyPositions, [currentCharId]: deltas.playerPos };
      delete deltas.playerPos;
    }
  }
  Object.assign(newState, deltas);

  // Advance to the next party member in turn order.
  let nextCharId = currentCharId;
  if (game.partyMembers.length > 1) {
    const sorted    = [...game.partyMembers].sort((a, b) => a.turnOrder - b.turnOrder);
    const curIdx    = sorted.findIndex((m) => m.characterId === currentCharId);
    const nextIdx   = (curIdx + 1) % sorted.length;
    nextCharId      = sorted[nextIdx].characterId;
  }

  await Promise.all([
    prisma.message.create({
      data: { gameId, role: "DUNGEON_MASTER", content: parsed.narrative, chips: parsed.chips },
    }),
    prisma.game.update({
      where: { id: gameId },
      data:  { state: newState, currentTurnCharacterId: nextCharId },
    }),
  ]);

  return { success: true, narrative: parsed.narrative, chips: parsed.chips, newState };
}
