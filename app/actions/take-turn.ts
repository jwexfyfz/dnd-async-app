"use server";

import Anthropic from "@anthropic-ai/sdk";

// Module-level singleton — avoids re-creating the client on every server action call.
// maxRetries: 4 covers transient 529 overload bursts with SDK exponential backoff.
const anthropic = new Anthropic({ maxRetries: 4 });
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE } from "../../lib/ai-config";
import { rollD20Check, abilityModifier } from "../../lib/dice";
import type { D20Result } from "../../lib/dice";
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
import { maxHpAtLevel, proficiencyBonus } from "../../lib/leveling";
import { parseCombatEffects, clampHp } from "../../lib/combat-effect"
import { resolveSkillCheck, SKILL_ABILITY_MAP } from "../../lib/skills"
import type { SkillCheckResult } from "../../lib/skills";

// ─── Input sanitization ───────────────────────────────────────────────────────

function sanitizeChipText(raw: string): string {
  let s = raw.slice(0, 200);
  s = s.replace(/[\r\n]+/g, " ");
  s = s.replace(/SYSTEM:|ASSISTANT:|USER:/gi, "");
  s = s.replace(/`/g, "");
  s = s.replace(/ignore previous/gi, "");
  return s.trim();
}

// ─── Action type detection ────────────────────────────────────────────────────

function detectActionType(
  sanitizedAction: string,
  gameState: Record<string, unknown>,
): { dcType: "AC" | "DC"; dc: number } {
  const lower = sanitizedAction.toLowerCase();
  const attackKeywords = ["attack", "strike", "hit", "shoot", "stab", "slash", "smash", "fire"];
  if (attackKeywords.some((kw) => lower.includes(kw))) {
    return { dcType: "AC", dc: (gameState.targetAC as number | undefined) ?? 14 };
  }
  return { dcType: "DC", dc: 12 };
}

// Returns the ability score used for attack rolls, keyed by class per D&D 5e.
// DEX-primary: finesse/ranged weapons. INT/CHA: spell attack rolls.
// Fallback: strength (melee martial default).
function primaryAttackScore(
  characterClass: string,
  character: { strength: number; dexterity: number; intelligence: number; charisma: number },
): number {
  if (["Rogue", "Ranger", "Monk"].includes(characterClass))      return character.dexterity;
  if (["Wizard", "Sorcerer"].includes(characterClass))           return character.intelligence;
  if (["Warlock", "Bard"].includes(characterClass))              return character.charisma;
  return character.strength;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildStaticPrompt(character: any, allMembers: any[], storyPrompt: any, mapData: any): string {
  const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois  = mapData.pois?.map((p: any) => `${p.name} [${p.symbol}] at (${p.x},${p.y})`).join(", ") ?? "—";

  const partyLines = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name} [id:${m.character.id}] (${m.character.characterClass}): STR${m.character.strength} DEX${m.character.dexterity} CON${m.character.constitution} INT${m.character.intelligence} WIS${m.character.wisdom} CHA${m.character.charisma}`
      ).join("\n")
    : `  ${character.name} [id:${character.id}] (${character.characterClass}): STR${character.strength} DEX${character.dexterity} CON${character.constitution} INT${character.intelligence} WIS${character.wisdom} CHA${character.charisma}`;

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
    // "playerPos": {x,y}    (active character's new position)
    // "inventory": [...]     (full updated shared inventory)
    // "plotFlags": [...]     (full updated list)
    // "activeObjective": "..." (if the objective changed)
    // "npcsEncountered": [{name, disposition, note}]
  },
  "chips": ["Short action 1", "Short action 2", "Short action 3", "Short action 4"],
  "encounterResult": "completed" | null,
  "skillName": "ExactSkillName" | null
}
chips: 3–5 options, each under 6 words. Situationally specific to what just happened.
encounterResult: set to "completed" ONLY when a combat encounter fully resolves this turn — enemy defeated, fled, or room cleared. Set to null on all other turns including exploration, dialogue, and non-combat actions. Do not set "completed" for partial victories or ongoing combat.
skillName: if this player action narratively warrants a skill check, return the EXACT canonical skill name from this list — Acrobatics, Animal Handling, Arcana, Athletics, Deception, History, Insight, Intimidation, Investigation, Medicine, Nature, Perception, Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival. Return null on all other turns (combat attacks, exploration without a check, dialogue without a roll).

DICE RULES — YOU MUST FOLLOW THESE EXACTLY
The DICE RESULT in your context is code-generated and final. You MUST narrate around it — never contradict, alter, or invent a different outcome. The roll is a mechanical fact.

COMBAT EFFECT TAG — ENGINE SIGNAL, HIDDEN FROM PLAYERS
Whenever the narrative causes HP to change for any character (damage or healing), append one self-closing XML tag per affected character on its own line, placed after the closing brace of the JSON object:
<combat_effect target_id="CHAR_ID" delta="N" type="TYPE" />
  • target_id — the [id:…] value for that character from the PARTY list above
  • delta     — integer HP change; negative for damage (e.g. "-8"), positive for healing (e.g. "5")
  • type      — short source label: "damage" | "healing" | "poison" | "fire" | "fall" | etc.
If multiple characters are affected in one turn, emit one tag per character. If no HP changes this turn, omit the tag entirely — do not emit it for exploration, dialogue, or non-HP events.`;
}

function buildDynamicStatePrompt(
  gameState: any,
  partyMembers: any[],
  currentCharId: string,
  diceResult: D20Result,
  consecutiveMisses: number,
  mechanicalContext?: string,
): string {
  const inv   = gameState.inventory?.length ? gameState.inventory.join(", ") : "empty";
  const flags = gameState.plotFlags?.length ? gameState.plotFlags.join(", ") : "none";

  let stateSection: string;

  if (partyMembers.length > 1 && gameState.partyHp) {
    const memberLines = partyMembers
      .map((m: any) => {
        const hp    = gameState.partyHp?.[m.characterId] ?? "?";
        const maxHp = gameState.partyMaxHp?.[m.characterId] ?? "?";
        const pos   = gameState.partyPositions?.[m.characterId] ?? { x: 0, y: 0 };
        const arrow = m.characterId === currentCharId ? "→ " : "  ";
        return `${arrow}${m.character.name}: HP ${hp}/${maxHp}, pos (${pos.x},${pos.y})`;
      })
      .join("\n");

    stateSection = `PARTY STATE (→ = active character this turn)
${memberLines}
Shared inventory: ${inv}
Objective: ${gameState.activeObjective}
Plot flags: ${flags}`;
  } else {
    stateSection = `CURRENT STATE
Position: (${gameState.playerPos?.x ?? 0}, ${gameState.playerPos?.y ?? 0})
HP: ${gameState.hp}/${gameState.maxHp}
Inventory: ${inv}
Weapon: ${gameState.equipped?.weapon ?? "none"} | Armor: ${gameState.equipped?.armor ?? "none"}
Objective: ${gameState.activeObjective}
Plot flags: ${flags}
NPCs met: ${gameState.npcsEncountered?.map((n: any) => `${n.name} (${n.disposition})`).join(", ") ?? "none"}`;
  }

  const outcomeLabel = diceResult.dcType === "AC"
    ? (diceResult.success ? "HIT" : "MISS")
    : (diceResult.success ? "SUCCESS" : "FAILURE");
  const critNote = diceResult.critical ? " (CRITICAL HIT)" : diceResult.fumble ? " (FUMBLE)" : "";

  const diceSection = `
DICE RESULT
Roll: ${diceResult.roll} + ${diceResult.modifier} = ${diceResult.total} vs ${diceResult.dcType} ${diceResult.dc} — ${outcomeLabel}${critNote}
consecutiveMisses: ${consecutiveMisses}`;

  const missDirective = consecutiveMisses >= 3
    ? `\nNARRATION DIRECTIVE: After ${consecutiveMisses} consecutive misses, engineer a dramatic opening before the player's action — enemy stumbles, environment intervenes, or an NPC assists. Do not alter the roll outcome.`
    : "";

  const levelUpDirective = gameState.levelUpNote
    ? `\n\nLEVEL UP: ${gameState.levelUpNote} Weave this advancement into your narration as a dramatic, triumphant moment.`
    : "";

  const mechanicalContextBlock = mechanicalContext
    ? `\n\nMECHANICAL CONTEXT\n${mechanicalContext}\nNarration rules: Do NOT reproduce the skill name, outcome, DC, roll value, or proficiency bonus in your narrative. Describe the result dramatically without mechanical exposition.`
    : "";

  return `${stateSection}${diceSection}${missDirective}${levelUpDirective}${mechanicalContextBlock}`;
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

interface LevelUpResult {
  oldLevel:         number;
  newLevel:         number;
  oldMaxHp:         number;
  newMaxHp:         number;
  proficiencyBonus: number;
}

interface TurnResult {
  success:       boolean;
  narrative?:    string;
  chips?:        string[];
  newState?:     Record<string, unknown>;
  error?:        string;
  diceResult?:   D20Result;
  leveledUp?:    boolean;          // true if the character leveled up this turn
  newLevel?:     number;           // the new level value if leveledUp is true
  levelUpResult?: LevelUpResult;   // full level-up payload; undefined when no level-up occurred
  combatEffects?: { targetId: string; delta: number; type: string; newHp: number }[];
  skillCheckResult?: SkillCheckResult;
}

export async function takeTurn(gameId: string, chipText: string): Promise<TurnResult> {
  const sanitizedAction = sanitizeChipText(chipText);

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
  if (game.partyMembers.length > 0) {
    if (!callerMember) return { success: false, error: "You are not in this game." };
    if (!game.currentTurnCharacterId) return { success: false, error: "The adventure has not started yet." };
    if (game.currentTurnCharacterId !== callerMember.characterId) {
      return { success: false, error: "It's not your turn." };
    }
  } else if (game.character.userId !== user.id) {
    return { success: false, error: "Access denied." };
  }

  const currentCharId   = callerMember?.characterId ?? game.characterId;
  const expectedVersion = game.version;

  const contextWindow     = game.messages.slice(-ROLLING_WINDOW_SIZE);
  const gameState         = game.state as Record<string, any>;
  const mapData           = game.map.data as Record<string, any>;
  const currentCharacter  = callerMember ? callerMember.character : game.character;

  // Compute dice roll before the Claude narration call (D-06: code owns all rolls).
  const { dcType, dc } = detectActionType(sanitizedAction, gameState);
  const relevantScore  = dcType === "AC"
    ? primaryAttackScore(currentCharacter.characterClass, currentCharacter)
    : currentCharacter.wisdom;
  const modifier       = abilityModifier(relevantScore);
  const diceResult     = rollD20Check(modifier, dc, dcType);

  // Track consecutiveMisses in gameState.
  const prevMisses      = (gameState.consecutiveMisses as number | undefined) ?? 0;
  const consecutiveMisses = diceResult.success ? 0 : prevMisses + 1;

  let response;
  try {
    response = await anthropic.messages.create({
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
          text: buildDynamicStatePrompt(gameState, game.partyMembers, currentCharId, diceResult, consecutiveMisses),
        },
      ],
      messages: buildConversationMessages(contextWindow, sanitizedAction),
    });
  } catch (err: any) {
    console.error("AI DM error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText   = textBlock?.text ?? "";

  let parsed: { narrative: string; stateDeltas: Record<string, any>; chips: string[]; encounterResult?: "completed" | null; skillName?: string | null };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? rawText);
  } catch {
    parsed = {
      narrative:       rawText || "The dungeon stirs around you.",
      stateDeltas:     {},
      chips:           ["Look around carefully", "Listen for sounds", "Check your gear"],
      encounterResult: null,
    };
  }

  // ─── Skill Check — two-call architecture ─────────────────────────────────
  const rawSkillName = (parsed as any).skillName as string | null | undefined;
  const validSkillName: string | null = (rawSkillName && Object.keys(SKILL_ABILITY_MAP).includes(rawSkillName)) ? rawSkillName : null;

  let finalParsed = parsed;
  let skillCheckResult: SkillCheckResult | undefined;
  // rawText2 is populated inside the skill-check branch; hoisted here so the
  // combat-effects section can use it as the effects source when a skill check
  // ran (the second AI call is the one that emits <combat_effect> tags).
  let rawText2 = "";

  if (validSkillName !== null) {
    skillCheckResult = resolveSkillCheck(validSkillName, {
      characterClass:     currentCharacter.characterClass,
      level:              currentCharacter.level,
      strength:           currentCharacter.strength,
      dexterity:          currentCharacter.dexterity,
      constitution:       currentCharacter.constitution,
      intelligence:       currentCharacter.intelligence,
      wisdom:             currentCharacter.wisdom,
      charisma:           currentCharacter.charisma,
      skillProficiencies: currentCharacter.skillProficiencies,
    }, dc);
    const outcome = skillCheckResult.success ? "SUCCESS" : "FAILURE";
    const mechanicalContext = `[SKILL skill=${validSkillName} outcome=${outcome} dc=${skillCheckResult.dc}]`;

    let response2;
    try {
      response2 = await anthropic.messages.create({
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
            text: buildDynamicStatePrompt(gameState, game.partyMembers, currentCharId, diceResult, consecutiveMisses, mechanicalContext),
          },
        ],
        messages: buildConversationMessages(contextWindow, sanitizedAction),
      });
    } catch (err: any) {
      console.error("AI DM skill narration error:", err.message);
      return { success: false, error: "The DM is temporarily unavailable." };
    }

    const textBlock2 = response2.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    rawText2 = textBlock2?.text ?? "";

    try {
      const match2 = rawText2.match(/\{[\s\S]*\}/);
      finalParsed = JSON.parse(match2?.[0] ?? rawText2);
    } catch {
      finalParsed = {
        narrative:       rawText2 || "The dungeon stirs around you.",
        stateDeltas:     {},
        chips:           ["Look around carefully", "Listen for sounds", "Check your gear"],
        encounterResult: null,
      };
    }
  }

  // ─── Combat Effects — resolve HP deltas from AI tags ─────────────────────
  // When a skill check ran, the second AI response (rawText2) is the one the DM
  // narrated from and where <combat_effect> tags will appear. Fall back to
  // rawText on non-skill turns.
  const effectsSource = validSkillName !== null ? rawText2 : rawText;
  const rawEffects = parseCombatEffects(effectsSource);
  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];

  if (rawEffects.length > 0) {
    const affectedIds  = [...new Set(rawEffects.map((e) => e.targetId))];
    const affectedChars = await prisma.character.findMany({
      where:  { id: { in: affectedIds } },
      select: { id: true, currentHp: true, maxHp: true },
    });
    const charMap = new Map(affectedChars.map((c) => [c.id, c]));
    resolvedEffects = rawEffects
      .filter((e) => charMap.has(e.targetId))
      .map((e) => {
        const c = charMap.get(e.targetId)!;
        return { ...e, newHp: clampHp(c.currentHp, e.delta, c.maxHp) };
      });
  }

  // ─── XP Award ─────────────────────────────────────────────────────────────
  const encounterCompleted = finalParsed.encounterResult === "completed";
  const xpAwarded = encounterCompleted
    ? (XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0)
    : 0;
  const currentXp     = (currentCharacter.xp ?? 0) + xpAwarded;
  const previousLevel  = currentCharacter.level ?? 1;
  const newLevel       = computeLevel(currentXp);
  const didLevelUp     = newLevel > previousLevel;

  // Apply stateDeltas. For party games, route per-character fields into party-scoped maps.
  const newState: Record<string, any> = { ...gameState, consecutiveMisses };
  const deltas = { ...finalParsed.stateDeltas };

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

  // Strip keys the rules engine owns exclusively — Claude cannot override mechanical values (H7).
  const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
  for (const key of RULES_ENGINE_KEYS) {
    delete deltas[key];
  }

  Object.assign(newState, deltas);

  // Level-up narration injection (one-turn delay: stored now, read by next call to buildDynamicStatePrompt)
  if (didLevelUp) {
    newState.levelUpNote = `${currentCharacter.name} advanced to Level ${newLevel} this turn.`;
  } else {
    delete newState.levelUpNote;
  }

  // Advance to the next party member in turn order.
  let nextCharId = currentCharId;
  if (game.partyMembers.length > 1) {
    const sorted  = [...game.partyMembers].sort((a, b) => a.turnOrder - b.turnOrder);
    const curIdx  = sorted.findIndex((m) => m.characterId === currentCharId);
    const nextIdx = (curIdx + 1) % sorted.length;
    nextCharId    = sorted[nextIdx].characterId;
  }

  // Atomic write with optimistic lock — concurrent submissions return STALE_TURN.
  // committedMaxHp is hoisted so the return block can reuse it without a second maxHpAtLevel call.
  let committedMaxHp = currentCharacter.maxHp;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
      if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");
      await tx.message.create({
        data: { gameId, role: "PLAYER", content: sanitizedAction },
      });
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: finalParsed.narrative, chips: finalParsed.chips },
      });
      if (xpAwarded > 0 || didLevelUp) {
        committedMaxHp = didLevelUp
          ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.constitution, newLevel)
          : currentCharacter.maxHp;
        if (didLevelUp && newState.partyMaxHp) {
          newState.partyMaxHp = { ...newState.partyMaxHp, [currentCharId]: committedMaxHp };
        }
        await tx.character.update({
          where: { id: currentCharId },
          data:  { xp: currentXp, level: newLevel, maxHp: committedMaxHp },
        });
      }
      await tx.game.update({
        where: { id: gameId },
        data:  { state: newState, currentTurnCharacterId: nextCharId, version: { increment: 1 } },
      });
      for (const eff of resolvedEffects) {
        await tx.character.update({
          where: { id: eff.targetId },
          data:  { currentHp: eff.newHp },
        });
      }
    });
  } catch (err: any) {
    if (err.message === "STALE_TURN") {
      return { success: false, error: "STALE_TURN" };
    }
    throw err;
  }

  return {
    success:   true,
    narrative: finalParsed.narrative,
    chips:     finalParsed.chips,
    newState,
    diceResult,
    leveledUp: didLevelUp,
    newLevel:  didLevelUp ? newLevel : undefined,
    levelUpResult: didLevelUp ? {
      oldLevel:         previousLevel,
      newLevel,
      oldMaxHp:         currentCharacter.maxHp,
      newMaxHp:         committedMaxHp,
      proficiencyBonus: proficiencyBonus(newLevel),
    } : undefined,
    combatEffects: resolvedEffects.length > 0 ? resolvedEffects : undefined,
    skillCheckResult,
  };
}
