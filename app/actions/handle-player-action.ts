"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE } from "../../lib/ai-config";
import { abilityModifier } from "../../lib/dice";
import { computeCharacterStats } from "../../lib/character-stats";
import type { Chip, ChipType } from "../../types/chips";
import type { SuggestionChip } from "../../types/suggestion-chip";
import { randomUUID } from "crypto";

const anthropic = new Anthropic({ maxRetries: 4 });

// ─── Deterministic chip engine ────────────────────────────────────────────────
// Pure function: same inputs always produce the same chips.
// No LLM call — chips are derived from class, roll outcome, and action result.

const FUMBLE_CHIPS: Chip[] = [
  { text: "Regain your footing", type: "athletics"  },
  { text: "Stay on guard",        type: "perception" },
  { text: "Assess the damage",    type: "insight"    },
];

const CRIT_CHIPS: Chip[] = [
  { text: "Press your advantage", type: "athletics"    },
  { text: "Rally your allies",    type: "persuasion"   },
  { text: "Survey the aftermath", type: "perception"   },
  { text: "Claim your prize",     type: "investigation"},
];

type ChipSet = { success: Chip[]; failure: Chip[] };

const CLASS_CHIP_POOLS: Record<string, ChipSet> = {
  Fighter: {
    success: [
      { text: "Press the assault",  type: "athletics"    },
      { text: "Hold your ground",   type: "strength"     },
      { text: "Scan for threats",   type: "perception"   },
      { text: "Shout a war cry",    type: "intimidation" },
    ],
    failure: [
      { text: "Fall back and regroup",  type: "athletics"    },
      { text: "Raise your shield",      type: "constitution" },
      { text: "Watch for an opening",   type: "perception"   },
      { text: "Grit your teeth",        type: "strength"     },
    ],
  },
  Rogue: {
    success: [
      { text: "Vanish into shadow",  type: "stealth"        },
      { text: "Snatch the prize",    type: "sleight_of_hand"},
      { text: "Scout the path ahead",type: "perception"     },
      { text: "Deceive the enemy",   type: "deception"      },
    ],
    failure: [
      { text: "Dodge and retreat",   type: "acrobatics" },
      { text: "Blend into the dark", type: "stealth"    },
      { text: "Find an exit",        type: "perception" },
      { text: "Read the threat",     type: "insight"    },
    ],
  },
  Wizard: {
    success: [
      { text: "Identify the magic",  type: "arcana"       },
      { text: "Search for lore",     type: "history"      },
      { text: "Examine the runes",   type: "investigation"},
      { text: "Channel the arcane",  type: "arcana"       },
    ],
    failure: [
      { text: "Recall an old text",    type: "arcana"       },
      { text: "Step back to safety",   type: "intelligence" },
      { text: "Reassess the puzzle",   type: "investigation"},
      { text: "Study the situation",   type: "intelligence" },
    ],
  },
  Cleric: {
    success: [
      { text: "Invoke divine blessing", type: "religion" },
      { text: "Tend to the wounded",    type: "medicine" },
      { text: "Discern true intent",    type: "insight"  },
      { text: "Channel holy light",     type: "religion" },
    ],
    failure: [
      { text: "Pray for guidance",   type: "religion" },
      { text: "Heal your wounds",    type: "medicine" },
      { text: "Seek divine clarity", type: "wisdom"   },
      { text: "Protect your allies", type: "insight"  },
    ],
  },
  Barbarian: {
    success: [
      { text: "Smash the obstacle",  type: "strength"     },
      { text: "Roar your triumph",   type: "intimidation" },
      { text: "Charge the next foe", type: "athletics"    },
      { text: "Endure through pain", type: "constitution" },
    ],
    failure: [
      { text: "Rage through the pain",  type: "constitution" },
      { text: "Shake off the blow",     type: "strength"     },
      { text: "Find your footing",      type: "athletics"    },
      { text: "Frighten the enemy",     type: "intimidation" },
    ],
  },
  Paladin: {
    success: [
      { text: "Smite with righteousness", type: "religion"    },
      { text: "Lay on hands",             type: "medicine"    },
      { text: "Inspire the faithful",     type: "persuasion"  },
      { text: "Hold the line",            type: "athletics"   },
    ],
    failure: [
      { text: "Draw on faith",      type: "religion"    },
      { text: "Protect the weak",   type: "insight"     },
      { text: "Rally with courage", type: "persuasion"  },
      { text: "Stand firm",         type: "constitution"},
    ],
  },
  Ranger: {
    success: [
      { text: "Track the quarry",     type: "survival"   },
      { text: "Spot the hidden foe",  type: "perception" },
      { text: "Move through brush",   type: "stealth"    },
      { text: "Read the wildlife",    type: "nature"     },
    ],
    failure: [
      { text: "Reposition to cover", type: "stealth"    },
      { text: "Read the terrain",    type: "survival"   },
      { text: "Listen for movement", type: "perception" },
      { text: "Camouflage yourself", type: "nature"     },
    ],
  },
  Bard: {
    success: [
      { text: "Inspire your companions", type: "performance" },
      { text: "Charm the opposition",    type: "persuasion"  },
      { text: "Spread a useful rumor",   type: "deception"   },
      { text: "Perform for the crowd",   type: "performance" },
    ],
    failure: [
      { text: "Talk your way out",   type: "persuasion"  },
      { text: "Distract with melody",type: "performance" },
      { text: "Read the room",       type: "insight"     },
      { text: "Tell a clever lie",   type: "deception"   },
    ],
  },
  Druid: {
    success: [
      { text: "Commune with nature",  type: "nature"        },
      { text: "Sense the land's mood",type: "animal_handling"},
      { text: "Track through the wild",type: "survival"     },
      { text: "Read the weather",     type: "nature"        },
    ],
    failure: [
      { text: "Seek the forest's aid", type: "nature"        },
      { text: "Calm a nervous beast",  type: "animal_handling"},
      { text: "Find natural cover",    type: "survival"      },
      { text: "Channel earth wisdom",  type: "wisdom"        },
    ],
  },
  Monk: {
    success: [
      { text: "Flow with momentum",    type: "acrobatics" },
      { text: "Strike pressure points",type: "insight"    },
      { text: "Move like water",       type: "stealth"    },
      { text: "Channel inner peace",   type: "wisdom"     },
    ],
    failure: [
      { text: "Redirect their force", type: "acrobatics" },
      { text: "Center yourself",      type: "wisdom"     },
      { text: "Read their movements", type: "insight"    },
      { text: "Step aside nimbly",    type: "acrobatics" },
    ],
  },
  Sorcerer: {
    success: [
      { text: "Channel the surge",    type: "arcana"      },
      { text: "Overwhelm with power", type: "charisma"    },
      { text: "Shape the wild magic", type: "arcana"      },
      { text: "Bend reality slightly",type: "intelligence"},
    ],
    failure: [
      { text: "Recover your focus",  type: "arcana"      },
      { text: "Suppress the surge",  type: "constitution"},
      { text: "Redirect the energy", type: "intelligence"},
      { text: "Soothe the wild magic",type: "charisma"   },
    ],
  },
  Warlock: {
    success: [
      { text: "Invoke patron's favor",     type: "arcana"      },
      { text: "Intimidate the weakened",   type: "intimidation"},
      { text: "Probe forbidden knowledge", type: "arcana"      },
      { text: "Beguile with dark charm",   type: "deception"   },
    ],
    failure: [
      { text: "Bargain for power",    type: "charisma"   },
      { text: "Draw on dark reserves",type: "arcana"     },
      { text: "Retreat into shadow",  type: "stealth"    },
      { text: "Inspire eldritch fear",type: "intimidation"},
    ],
  },
};

const DEFAULT_CHIP_SET: ChipSet = {
  success: [
    { text: "Survey the area",   type: "perception"   },
    { text: "Move carefully",    type: "stealth"      },
    { text: "Search for clues",  type: "investigation"},
    { text: "Assess the scene",  type: "insight"      },
  ],
  failure: [
    { text: "Retreat to safety",  type: "athletics"  },
    { text: "Regroup and assess", type: "insight"    },
    { text: "Look for cover",     type: "perception" },
    { text: "Stay alert",         type: "perception" },
  ],
};

export function generateDeterministicChips(
  characterClass: string,
  rollResult:     number,
  success:        boolean,
): Chip[] {
  if (rollResult === 1)  return FUMBLE_CHIPS;
  if (rollResult === 20) return CRIT_CHIPS;
  const pool = CLASS_CHIP_POOLS[characterClass] ?? DEFAULT_CHIP_SET;
  return success ? pool.success : pool.failure;
}

// ─── Narrative prompt ─────────────────────────────────────────────────────────

export function buildNarrativeMessages(
  storyTitle:       string,
  actTitle:         string,
  sceneTitle:       string,
  sceneDescription: string,
  characterName:    string,
  characterClass:   string,
  recentNarratives: string[],
  actionId:         string,
  rollResult:       number,
  dc:               number,
  modifier:         number,
  success:          boolean,
): { role: "user" | "assistant"; content: string }[] {
  const total   = rollResult + modifier;
  const outcome = success
    ? (rollResult === 20 ? "CRITICAL SUCCESS" : "SUCCESS")
    : (rollResult === 1  ? "FUMBLE"           : "FAILURE");

  const historyBlock = recentNarratives.length > 0
    ? `\nRecent events:\n${recentNarratives.slice(-3).map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  const content = `You are a skilled Dungeon Master narrating a D&D 5e campaign.

Story: ${storyTitle} | Act: ${actTitle} | Scene: ${sceneTitle}
${sceneDescription}
Character: ${characterName} (${characterClass})${historyBlock}

The player takes this action: "${actionId}"
Dice result: ${rollResult} + ${modifier} = ${total} vs DC ${dc} — ${outcome}

Write 2-4 sentences of vivid, present-tense narration for this action's result. Address the character by name. Do not reveal mechanical numbers (roll values, DC, modifiers) in your prose.`;

  return [{ role: "user", content }];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export interface PlayerActionResult {
  success:    boolean;
  narrative?: string;
  chips?:     Chip[];
  error?:     string;
}

/**
 * Handles a player action on The Field tab.
 *
 * @param gameId     - The active game.
 * @param actionId   - Text description of the action the player took (chip text).
 * @param rollResult - Raw d20 roll value (1–20); modifier is applied server-side.
 *
 * Execution contract:
 *   Step 1  — Call Claude exactly once to generate the narrative scene.
 *   Step 2  — Append the narrative to game.state.narrative_history.
 *   Step 3  — Generate a fresh chip set via the deterministic rules engine and
 *             overwrite game.state.active_suggestion_chips.
 *   Steps 2+3 execute inside a single $transaction so the DB never holds a
 *   partially-updated state if anything fails mid-write.
 */
export async function handlePlayerAction(
  gameId:     string,
  actionId:   string,
  rollResult: number,
): Promise<PlayerActionResult> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  // ── Load game ─────────────────────────────────────────────────────────────
  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      story:        true,
      currentAct:   true,
      currentScene: true,
      map:          true,
      messages:    { orderBy: { createdAt: "asc" } },
      partyMembers: {
        include:  { character: true },
        orderBy:  { turnOrder: "asc" },
      },
    },
  });
  if (!game) return { success: false, error: "Game not found." };

  // ── Authorization ─────────────────────────────────────────────────────────
  const callerMember = game.partyMembers.find((m) => m.userId === user.id);
  if (game.partyMembers.length > 0) {
    if (!callerMember)                        return { success: false, error: "You are not in this game." };
    if (!game.currentTurnCharacterId)         return { success: false, error: "The adventure has not started yet." };
    if (game.currentTurnCharacterId !== callerMember.characterId) {
      return { success: false, error: "It's not your turn." };
    }
  } else if (game.character.userId !== user.id) {
    return { success: false, error: "Access denied." };
  }

  const currentCharId  = callerMember?.characterId ?? game.characterId;
  const currentChar    = callerMember ? callerMember.character : game.character;
  const expectedVersion = game.version;
  const gameState      = game.state as Record<string, any>;

  // ── Determine roll outcome ────────────────────────────────────────────────
  const stats    = await computeCharacterStats(currentCharId);
  const dc       = (gameState.targetAC as number | undefined) ?? 12;
  const modifier = abilityModifier(stats.wisdom.total);
  const success  = rollResult + modifier >= dc;

  // ── Step 1: Claude call (exactly once) ───────────────────────────────────
  const recentNarratives = game.messages
    .slice(-ROLLING_WINDOW_SIZE)
    .filter((m) => m.role === "DUNGEON_MASTER")
    .map((m) => m.content);

  const sanitizedAction = actionId.slice(0, 200).replace(/[\r\n]+/g, " ").trim();

  let narrative: string;
  try {
    const response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      messages:   buildNarrativeMessages(
        game.story?.title ?? "",
        game.currentAct?.title ?? "",
        game.currentScene?.title ?? "",
        game.currentScene?.description ?? "",
        currentChar.name,
        currentChar.characterClass,
        recentNarratives,
        sanitizedAction,
        rollResult,
        dc,
        modifier,
        success,
      ),
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    narrative = textBlock?.text?.trim() || "The dungeon stirs around you.";
  } catch (err: any) {
    console.error("handlePlayerAction AI error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  // ── Deterministic chip generation (no LLM) ────────────────────────────────
  const chips = generateDeterministicChips(currentChar.characterClass, rollResult, success);
  // Promote to SuggestionChip format for the new dedicated column.
  const suggestionChips: SuggestionChip[] = chips.map((c) => ({
    id:             randomUUID(),
    label:          c.text,
    type:           c.type,
    requiresRoll:   true,
    advantageState: "NONE",
    action_type:    "mainAction",
    movementFeet:   0,
    spellLevel:     0,
  }));

  // ── Steps 2 + 3: Atomic transaction ──────────────────────────────────────
  // Both narrative_history and active_suggestion_chips are committed together.
  // If either write fails the transaction rolls back, leaving the DB consistent.
  try {
    await prisma.$transaction(async (tx) => {
      // Optimistic lock — reject concurrent submissions.
      const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
      if (!current || current.version !== expectedVersion) throw new Error("STALE_ACTION");

      // Step 2: Append narrative to narrative_history.
      const existingHistory: string[] = Array.isArray(gameState.narrative_history)
        ? (gameState.narrative_history as string[])
        : [];
      const updatedState: Record<string, any> = {
        ...gameState,
        narrative_history:        [...existingHistory, narrative],
        // Step 3: Overwrite active_suggestion_chips.
        active_suggestion_chips:  chips,
      };

      await tx.message.create({
        data: { gameId, role: "PLAYER", content: sanitizedAction, sceneId: game.currentSceneId },
      });
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: narrative, chips, sceneId: game.currentSceneId },
      });
      await tx.game.update({
        where: { id: gameId },
        data:  {
          state:                 updatedState,
          activeSuggestionChips: suggestionChips as any,
          narrativeHistory:      { push: narrative },
          version:               { increment: 1 },
        },
      });
    });
  } catch (err: any) {
    if (err.message === "STALE_ACTION") {
      return { success: false, error: "STALE_ACTION" };
    }
    throw err;
  }

  return { success: true, narrative, chips };
}
