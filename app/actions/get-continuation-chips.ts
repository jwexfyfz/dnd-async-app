"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL } from "../../lib/ai-config";
import type { Chip, ChipType } from "../../types/chips";

const anthropic = new Anthropic({ maxRetries: 2 });

interface AvailableResources {
  bonusAction:  number;
  movementFeet: number;
}

interface ChipContext {
  narrative:      string;
  characterName:  string;
  characterClass: string;
}

interface ContinuationChipsResponse {
  success: boolean;
  chips?:  Chip[];
  error?:  string;
}

const VALID_CHIP_TYPES = new Set<ChipType>([
  "athletics", "strength", "acrobatics", "sleight_of_hand", "stealth", "dexterity",
  "constitution", "arcana", "history", "investigation", "nature", "religion", "intelligence",
  "animal_handling", "insight", "medicine", "perception", "survival", "wisdom",
  "deception", "intimidation", "performance", "persuasion", "charisma",
]);

export async function getContinuationChips(
  gameId:    string,
  resources: AvailableResources,
  context:   ChipContext,
): Promise<ContinuationChipsResponse> {
  // Single outer try-catch: any throw (auth, DB, AI, JSON) returns a clean
  // failure instead of propagating a rejected promise to the client.
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated." };

    // Lightweight membership check only — narrative and character metadata
    // are passed from the client, eliminating the expensive messages join.
    const game = await prisma.game.findUnique({
      where:   { id: gameId },
      include: {
        character:    { select: { userId: true } },
        partyMembers: { where: { userId: user.id }, select: { id: true } },
      },
    });

    if (!game) return { success: false, error: "Game not found." };
    const isMember = game.partyMembers.length > 0 || game.character.userId === user.id;
    if (!isMember) return { success: false, error: "Access denied." };

    if (!context.narrative) return { success: true, chips: [] };

    const resourceDesc: string[] = [];
    if (resources.bonusAction > 0)  resourceDesc.push(`bonus action`);
    if (resources.movementFeet > 0) resourceDesc.push(`${resources.movementFeet} ft of movement`);

    const allowedCostTypes: string[] = [];
    if (resources.bonusAction > 0)  allowedCostTypes.push('"bonusAction"');
    if (resources.movementFeet > 0) allowedCostTypes.push('"movementFeet"');
    const allowedCostTypeList = allowedCostTypes.join(" or ");

    const prompt = `You are a D&D 5e Dungeon Master. The player has used their main action. They have ONLY these resources left: ${resourceDesc.join(" and ")}.

Current scene: "${context.narrative}"
Character: ${context.characterName} (${context.characterClass})

Suggest up to 5 contextual follow-up actions using ONLY the resources listed above.

HARD RULES — any chip that breaks a rule must be omitted entirely:
1. costType MUST be one of: ${allowedCostTypeList}. Do NOT suggest any other costType.
2. A chip with costType "movementFeet" must describe PURE repositioning only (walk, dash, retreat, step to cover, back away, move behind something). It must NOT include any attack, skill check, spell cast, or bonus action — those require a separate action economy entry.
3. If an action would require BOTH movement AND a bonus action (or any other action type), do NOT suggest it at all.
4. costType "bonusAction" → costValue must be 1.
5. costType "movementFeet" → costValue = feet used (max ${resources.movementFeet}).
6. Chip text must be under 6 words and tied to the specific scene.
7. type must be one of: athletics, acrobatics, sleight_of_hand, stealth, arcana, history, investigation, nature, religion, animal_handling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion, strength, dexterity, constitution, intelligence, wisdom, charisma

Return ONLY valid JSON (no markdown fences, no explanation):
{"chips":[{"text":"short action","type":"skillType","costType":"bonusAction or movementFeet","costValue":number}]}`;

    const response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: 400,
      messages:   [{ role: "user", content: prompt }],
    });

    let raw = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    const parsed = JSON.parse(raw) as {
      chips: Array<{ text: string; type: string; costType: string; costValue: number }>;
    };

    const chips: Chip[] = (parsed.chips ?? [])
      .slice(0, 5)
      .filter((c) => VALID_CHIP_TYPES.has(c.type as ChipType))
      .filter((c) => {
        if (c.costType === "bonusAction"  && resources.bonusAction  === 0) return false;
        if (c.costType === "movementFeet" && resources.movementFeet === 0) return false;
        return true;
      })
      .map((c) => ({
        text:         c.text.slice(0, 50),
        type:         c.type as ChipType,
        resourceCost: { type: c.costType, value: c.costValue },
      }));

    return { success: true, chips };
  } catch {
    return { success: false, error: "Failed to generate suggestions." };
  }
}
