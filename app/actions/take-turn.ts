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
import { buildRollContext } from "../../lib/roll-context";
import type { ActiveRollContext } from "../../lib/roll-context";
import type { ChipType } from "../../types/chips";
import type { SuggestionChip } from "../../types/suggestion-chip";
import { randomUUID } from "crypto";
import { computeCharacterStats } from "../../lib/character-stats";
import type { CharacterStats } from "../../lib/character-stats";
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
import { maxHpAtLevel, proficiencyBonus } from "../../lib/leveling";
import { parseCombatEffects, clampHp } from "../../lib/combat-effect"
import { resolveSkillCheck, SKILL_ABILITY_MAP } from "../../lib/skills"
import type { SkillCheckResult } from "../../lib/skills";
import { triggerCombat } from "./trigger-combat";
import { checkSceneTrigger } from "../../lib/scene-advance";
import { diagonalDistance, lineOfSight, checkAttackOfOpportunity } from "../../lib/grid";
import { isCovered, rollStealthCheck, breaksStealth } from "../../lib/stealth";
import { buildChipCandidates, candidatesToChips } from "../../lib/chip-candidates";
import type { ChipCandidate } from "../../lib/chip-candidates";
import type { GameTile } from "../../lib/tile-types";
import { findActor } from "../../lib/game-map-utils";
import { getActorVisibleTiles, debugLogVisibilityGrid } from "../../lib/visibility";

// ─── Damage expression roller ────────────────────────────────────────────────

import { rollDice } from "../../lib/dice";
import { computeAttackDamage, rollDamageExpr } from "../../lib/mechanical-damage";

// ─── Response helpers ─────────────────────────────────────────────────────────

// When JSON.parse fails (e.g. the model wraps the response in ```json fences or
// produces malformed JSON), try to salvage just the "narrative" string so the
// user never sees raw JSON rendered as story text.
function salvageNarrative(rawText: string): string {
  const m = rawText.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) return m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
  return "The dungeon stirs around you.";
}

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
  // DC 12 is a deliberate design constraint for Phase 04: all non-attack actions
  // use a uniform difficulty to keep the MVP simple. A future iteration should
  // either request a suggestedDc field from the first AI response or use a
  // per-skill lookup table keyed by skill tier (easy/medium/hard).
  return { dcType: "DC", dc: 12 };
}

// Returns the effective ability score (base + equipment) used for attack rolls,
// keyed by class per D&D 5e. DEX-primary: finesse/ranged. INT/CHA: spell attacks.
// Fallback: strength (melee martial default).
function primaryAttackScore(characterClass: string, stats: CharacterStats): number {
  if (["Rogue", "Ranger", "Monk"].includes(characterClass))      return stats.dexterity.total;
  if (["Wizard", "Sorcerer"].includes(characterClass))           return stats.intelligence.total;
  if (["Warlock", "Bard"].includes(characterClass))              return stats.charisma.total;
  return stats.strength.total;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

interface CombatPromptInfo {
  roundNumber:           number;
  initiativeNames:       string;
  activeName:            string;
  activeRole:            "PLAYER" | "NPC";
  remainingMovementFeet: number;
  remainingActions:      number;
}

function buildStaticPrompt(character: any, allMembers: any[], story: any, currentAct: any, currentScene: any, mapData: any, combatInfo?: CombatPromptInfo): string {
  const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois  = mapData.pois?.map((p: any) => `${p.name} [${p.symbol}] at (${p.x},${p.y})`).join(", ") ?? "—";

  const partyLines = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name}[id:${m.character.id},${m.character.characterClass},S${m.character.baseStrength}D${m.character.baseDexterity}C${m.character.baseConstitution}I${m.character.baseIntelligence}W${m.character.baseWisdom}Ch${m.character.baseCharisma}]`
      ).join("\n")
    : `  ${character.name}[id:${character.id},${character.characterClass},S${character.baseStrength}D${character.baseDexterity}C${character.baseConstitution}I${character.baseIntelligence}W${character.baseWisdom}Ch${character.baseCharisma}]`;

  const actSummaries = story?.acts
    ?.map((a: any) => `  Act ${a.order}: ${a.title} — ${a.summary}`)
    .join("\n") ?? "";

  const actBlock = currentAct
    ? `CURRENT ACT ${currentAct.order}: ${currentAct.title}\n${currentAct.playerFacingDescription}`
    : "";

  const sceneBlock = currentScene
    ? `CURRENT SCENE ${currentScene.order}: ${currentScene.title}\n${currentScene.description}\nObjectives: ${(currentScene.objectives as string[]).join("; ")}`
    : "";

  const combatBlock = combatInfo ? `IN COMBAT — Round ${combatInfo.roundNumber}
Initiative order (do not alter): ${combatInfo.initiativeNames} (active: ${combatInfo.activeName})
Active actor role: ${combatInfo.activeRole}
STRICT RULE: initiativeOrder is set at combat start and NEVER changes. You cannot add, remove, or reorder actors. You cannot invent enemies not listed in CURRENT STATE.

` : "";
  const combatChipRules = combatInfo
    ? (combatInfo.remainingMovementFeet === 0 ? " Do not generate movement chips — remaining movement is 0." : "")
      + (combatInfo.remainingActions === 0 ? " Do not generate mainAction chips — remaining actions is 0." : "")
    : "";

  return `${combatBlock}You are a skilled, atmospheric Dungeon Master running an async D&D 5e campaign. Your prose is vivid but concise — 2–4 sentences of present-tense narration per turn. You create tension, wonder, and consequence without overwrought description.

PARTY
${partyLines}

OVERARCHING STORY: ${story?.title ?? "Unknown"}
${actSummaries}

${actBlock}

${sceneBlock}

MAP: ${mapData.name ?? "Unknown Location"}
Rooms: ${rooms}
Points of interest: ${pois}

RESPONSE RULES
Always reply with a single JSON object — no markdown fences, no extra text.
{
  "narrative": "2–4 sentences. Vivid, present tense. Address the active character by name.",
  "stateDeltas": {
    // Only include fields that changed this turn. Omit everything else.
    // "playerPos": {x,y}    REQUIRED when character moves — exact integer tile coords.
    //   Advance 1–2 tiles toward the destination using POI coordinates from the MAP section.
    //   Never omit playerPos for movement actions; never use null or fractional values.
    // "inventory": [...]     (full updated shared inventory)
    // "plotFlags": [...]     (full updated list)
    // "activeObjective": "..." (if the objective changed)
    // "npcsEncountered": [{name, disposition, note}]
    // "enemies": [{"id":"kebab-slug","name":"...","x":N,"y":N}]
    //   Full list whenever any enemy appears or moves. Use existing id from CURRENT STATE; assign new kebab slug for new enemies. Never include "hp" — HP is computed from dice rolls only. Omit when no enemy changes.
    // "mapUpdate": [{"x":N,"y":N,"tile":"F"}, ...]
    //   Include when opening a door (D→F) or revealing unknown tiles (?→F). Copy coordinates from the POI's interactEffect.mapUpdate. Only D→F and ?→F are accepted.
  },
  "encounterResult": "completed" | null,
  "skillName": "ExactSkillName" | null
}
encounterResult: set to "completed" ONLY when a combat encounter fully resolves this turn — enemy defeated, fled, or room cleared. Set to null on all other turns including exploration, dialogue, and non-combat actions. Do not set "completed" for partial victories or ongoing combat.
skillName: if this player action narratively warrants a skill check, return the EXACT canonical skill name from this list — Acrobatics, Animal Handling, Arcana, Athletics, Deception, History, Insight, Intimidation, Investigation, Medicine, Nature, Perception, Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival. Return null on all other turns (combat attacks, exploration without a check, dialogue without a roll).

DICE RULES — YOU MUST FOLLOW THESE EXACTLY
The DICE RESULT in your context is code-generated and final. You MUST narrate around it — never contradict, alter, or invent a different outcome. The roll is a mechanical fact.

COMBAT EFFECT TAG — ENGINE SIGNAL, HIDDEN FROM PLAYERS
Player weapon attack damage is computed mechanically from dice rolls — DO NOT emit combat_effect for it.
Only emit combat_effect for: healing (potions, spells), environmental/trap damage, AoE spell damage, poison/condition damage not from a direct weapon attack roll.
Format: <combat_effect target_id="ENTITY_ID" delta="N" type="TYPE" />
  • target_id — for ENEMIES use the exact [id:…] value from the ENEMIES list; for party members use their character ID
  • delta     — integer HP change; negative for damage (e.g. "-8"), positive for healing (e.g. "5")
  • type      — short source label: "damage" | "healing" | "poison" | "fire" | "fall" | etc.
Omit entirely if no HP changes this turn.`;
}

function buildDynamicStatePrompt(
  worldState:    Record<string, any> | null,
  gameState:     any,
  currentChar:   any,
  partyMembers:  any[],
  currentCharId: string,
  diceResult:    D20Result,
  consecutiveMisses: number,
  mapItems:      { id: string; name: string; type: string; isEquipped: boolean; posX: number | null; posY: number | null }[],
  mapTiles?:     string[][],
  mechanicalContext?: string,
  hiddenEnemyIds?: Set<string>,
  dbEnemies?:    { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number }[],
): string {
  // worldState columns → fall back to game.state JSON
  const ws    = worldState ?? {};
  const obj   = (ws.activeObjective ?? gameState.activeObjective ?? "") as string;
  const flags = ((ws.plotFlags ?? gameState.plotFlags ?? []) as string[]);
  const npcs  = ((ws.npcsEncountered ?? gameState.npcsEncountered ?? []) as any[]);

  // Token-compressed character tag (D4)
  function charTag(char: any, pos: { x: number; y: number }, isActive: boolean): string {
    const prefix = isActive ? "→" : " ";
    const weap  = (char.mainHand as { name: string } | null)?.name ?? "none";
    const armor = (char.armor    as { name: string } | null)?.name ?? "none";
    const cond  = Array.isArray(char.activeConditions) && char.activeConditions.length > 0
      ? (char.activeConditions as string[]).join("+")
      : "none";
    return `${prefix}${char.name}[LVL:${char.level},HP:${char.currentHp}/${char.maxHp},Pos:${pos.x},${pos.y},Weap:${weap},Armor:${armor},Cond:${cond}]`;
  }

  const enemies = dbEnemies
    ? dbEnemies.map(e => ({ id: e.id, name: e.name, hp: e.currentHp, maxHp: e.maxHp, x: e.posX, y: e.posY }))
    : ((gameState.enemies as { id: string; name: string; hp: number; maxHp: number; x: number; y: number }[] | undefined) ?? []);
  const visibleEnemies = enemies.filter(e => e.hp > 0 && !hiddenEnemyIds?.has(e.id));

  // Resolve active actor position for LoS filtering
  const actorPos: { x: number; y: number } | null = partyMembers.length > 0
    ? (() => { const m = partyMembers.find((m: any) => m.characterId === currentCharId); return m ? { x: m.posX, y: m.posY } : null; })()
    : ((gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 });

  const enemyStr = visibleEnemies.length > 0
    ? visibleEnemies.map((e) => {
        const concealed = mapTiles && actorPos && !lineOfSight(actorPos, { x: e.x, y: e.y }, mapTiles);
        return concealed
          ? `${e.name}[CONCEALED]`
          : `${e.name}[id:${e.id},HP:${e.hp}/${e.maxHp},Pos:${e.x},${e.y}]`;
      }).join(" ")
    : "none";

  const groundItems = mapItems.filter((i) => !i.isEquipped && i.posX !== null && i.posY !== null);
  const itemStr = groundItems.length > 0
    ? groundItems.map((i) => `${i.name}@(${i.posX},${i.posY})`).join(", ")
    : "none";

  let stateSection: string;

  if (partyMembers.length > 0) {
    const tags = partyMembers
      .map((m: any) => charTag(m.character, { x: m.posX, y: m.posY }, m.characterId === currentCharId))
      .join("  ");
    stateSection = `CURRENT STATE\n${tags}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}`;
  } else {
    const pos = (gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    const npcStr = npcs.length > 0 ? npcs.map((n: any) => `${n.name}(${n.disposition})`).join(",") : "none";
    stateSection = `CURRENT STATE\n${charTag(currentChar, pos, true)}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}\nNPCs:${npcStr}`;
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

  const hasLivingEnemies = dbEnemies
    ? dbEnemies.some(e => e.currentHp > 0)
    : ((gameState.enemies ?? []) as any[]).some((e: any) => (e.hp ?? 0) > 0);
  const postCombatDirective = gameState.lastEncounterCompleted === true && !hasLivingEnemies
    ? `\n\nPOST-COMBAT NOTE: Combat just resolved. After narrating the player's current action normally, briefly weave in what the party discovers in the aftermath (loot, a clue, the silence settling). Chips must be exploration, investigation, movement, or social — not attacks.`
    : "";

  const groundingRule = `\nNARRATIVE GROUNDING: Only reference entities and objects with explicit coordinates in CURRENT STATE above. Do not invent assets, obstacles, or enemies not listed.`;
  return `${stateSection}${diceSection}${missDirective}${levelUpDirective}${mechanicalContextBlock}${postCombatDirective}${groundingRule}`;
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

export interface TurnResult {
  success:          boolean;
  narrative?:       string;
  chips?:           SuggestionChip[];
  newState?:        Record<string, unknown>;
  error?:           string;
  diceResult?:      D20Result;
  leveledUp?:       boolean;
  newLevel?:        number;
  levelUpResult?:   LevelUpResult;
  combatEffects?:   { targetId: string; delta: number; type: string; newHp: number }[];
  skillCheckResult?: SkillCheckResult;
  activeRollContext?: ActiveRollContext;
  combatStarted?:   boolean;
}

// _seededD20 is an internal escape hatch for complete-turn.ts: when provided,
// the dice roll step is skipped and this pre-verified value is used directly.
// Never pass this from client code — the server-seeded flow enforces integrity.
interface ChipSpatial {
  action_type?:  string;
  endPosition?:  { x: number; y: number };
  actionTarget?: { x: number; y: number };
  type?:         string;
}

export async function takeTurn(
  gameId:       string,
  chipText:     string,
  chipType?:    ChipType,
  _seededD20?:  number,
  chipSpatial?: ChipSpatial,
): Promise<TurnResult> {
  const sanitizedAction = sanitizeChipText(chipText);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    { include: { mainHand: { select: { name: true, rangeFeet: true, damageDice: true, attackBonus: true } }, armor: { select: { name: true } } } },
      story:        { include: { acts: { select: { order: true, title: true, summary: true }, orderBy: { order: "asc" } } } },
      currentAct:   true,
      currentScene: true,
      messages:    { orderBy: { createdAt: "asc" } },
      partyMembers: {
        include: { character: { include: { mainHand: { select: { name: true, rangeFeet: true, damageDice: true, attackBonus: true } }, armor: { select: { name: true } } } } },
        orderBy: { turnOrder: "asc" },
      },
    },
  });
  if (!game) return { success: false, error: "Game not found." };

  const activeGameMap = game.currentActId
    ? await prisma.gameMap.findUnique({
        where:  { gameId_actId: { gameId, actId: game.currentActId } },
        select: { id: true, data: true },
      })
    : null;
  const gmData  = (activeGameMap?.data ?? {}) as Record<string, any>;
  const mapData = gmData;

  console.log("[take-turn] scene:", {
    id:          game.currentScene?.id ?? null,
    triggerType: game.currentScene?.triggerType ?? null,
    triggerAreaX: game.currentScene?.triggerAreaX ?? null,
    triggerAreaY: game.currentScene?.triggerAreaY ?? null,
  });

  // ─── Combat intercept rule ────────────────────────────────────────────────
  // If no CombatSession exists and the chip is aggressive with living enemies,
  // roll initiative and start combat — discard the chip, no AI call.
  const combatSession = await prisma.combatSession.findUnique({ where: { gameId } });
  if (!combatSession) {
    const aggressiveKeywords = ["attack", "strike", "hit", "shoot", "stab", "slash", "smash", "fire", "cast", "charge"];
    const isAggressive = aggressiveKeywords.some((kw) => sanitizedAction.toLowerCase().includes(kw));
    const gameStateCheck = game.state as Record<string, any>;
    const livingEnemies = ((gameStateCheck.enemies ?? []) as any[]).filter((e: any) => (e.hp ?? 0) > 0);
    if (isAggressive && livingEnemies.length > 0) {
      const enemyIds = livingEnemies.map((e: any) => e.id as string);
      const result = await triggerCombat(gameId, enemyIds);
      if (!result.success) return { success: false, error: result.error };
      return { success: true, combatStarted: true };
    }
  }

  // ─── Verify it's this user's turn ────────────────────────────────────────
  const callerMember = game.partyMembers.find((m) => m.userId === user.id);
  if (game.partyMembers.length > 0) {
    if (!callerMember) return { success: false, error: "You are not in this game." };
    if (!game.currentTurnCharacterId) return { success: false, error: "The adventure has not started yet." };

    if (combatSession) {
      // Session-based turn gate: use initiative order instead of currentTurnCharacterId
      const order = combatSession.initiativeOrder as { actorId: string; actorType: string }[];
      const activeSlot = order[combatSession.currentTurnIndex];
      if (!activeSlot || activeSlot.actorId !== callerMember.characterId) {
        return { success: false, error: "It's not your turn." };
      }
    } else if (game.currentTurnCharacterId !== callerMember.characterId) {
      return { success: false, error: "It's not your turn." };
    }
  } else if (game.character.userId !== user.id) {
    return { success: false, error: "Access denied." };
  }

  const currentCharId   = callerMember?.characterId ?? game.characterId;
  const expectedVersion = game.version;

  const contextWindow     = game.messages.slice(-ROLLING_WINDOW_SIZE);
  const gameState         = game.state as Record<string, any>;
  const currentCharacter  = callerMember ? callerMember.character : game.character;

  if (game.currentScene) {
    const gmEnemyStateForInit = (gmData.enemyState ?? {}) as Record<string, { currentHp: number; maxHp: number }>;
    const gmTilesForInit      = (gmData.tiles ?? []) as GameTile[][];
    const validInitIds = gmTilesForInit.length > 0 ? Object.keys(gmEnemyStateForInit) : null;
    const sceneEnemyTemplates = await prisma.enemy.findMany({
      where:  { sceneId: game.currentScene.id, ...(validInitIds ? { id: { in: validInitIds } } : {}) },
      select: { id: true, name: true, maxHp: true },
    });
    if (sceneEnemyTemplates.length > 0) {
      const currentIds = new Set((gameState.enemies as any[] | undefined ?? []).map((e: any) => e.id));
      const idsStale   = !sceneEnemyTemplates.every((e: { id: string }) => currentIds.has(e.id));
      if (!gameState.enemies || (gameState.enemies as any[]).length === 0 || idsStale) {
        gameState.enemies = sceneEnemyTemplates.flatMap((e: { id: string; name: string; maxHp: number }) => {
          const st  = gmEnemyStateForInit[e.id];
          const pos = gmTilesForInit.length > 0 ? findActor(gmTilesForInit, e.id) : null;
          if (gmTilesForInit.length > 0 && !pos) return [];
          return [{ id: e.id, name: e.name, hp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, x: pos?.x ?? 0, y: pos?.y ?? 0 }];
        });
        await prisma.game.update({ where: { id: gameId }, data: { state: gameState } });
      }
    }
  }

  // Resolve effective stats (base + equipment bonuses) before any modifier math.
  // Must complete before the d20 roll so the modifier uses the equipment-adjusted total.
  const stats = await computeCharacterStats(currentCharId);

  // Compute dice roll before the Claude narration call (D-06: code owns all rolls).
  const { dcType, dc } = detectActionType(sanitizedAction, gameState);
  const relevantScore  = dcType === "AC"
    ? primaryAttackScore(currentCharacter.characterClass, stats)
    : stats.wisdom.total;
  const modifier       = abilityModifier(relevantScore);

  // ─── Spatial setup (needed for both first-call pre-checks and full execution) ─
  // Convert GameTile[][] → string[][] for lineOfSight / isCovered / buildChipCandidates.
  const rawGameTiles = (gmData.tiles ?? []) as Array<Array<{ t: string }>>;
  const tiles: string[][] | undefined = rawGameTiles.length > 0
    ? rawGameTiles.map(row => row.map(t => t.t))
    : undefined;
  const actorCurrentPos: { x: number; y: number } = callerMember
    ? { x: callerMember.posX, y: callerMember.posY }
    : { x: currentCharacter.posX, y: currentCharacter.posY };

  if (rawGameTiles.length > 0) {
    const playerVisSet = getActorVisibleTiles(rawGameTiles as unknown as GameTile[][], actorCurrentPos.x, actorCurrentPos.y);
    const enemyMarkers = ((gameState.enemies as { id: string; hp: number; x: number; y: number }[] | undefined) ?? [])
      .filter((e) => e.hp > 0)
      .map((e) => ({ x: e.x, y: e.y, char: "E" }));
    debugLogVisibilityGrid(rawGameTiles as unknown as GameTile[][], playerVisSet, actorCurrentPos.x, actorCurrentPos.y, `Player ${currentCharacter.name}`, enemyMarkers);
  }

  // Server-Seeded Roll: when the caller provides a chipType, do not complete the
  // turn. Return a pending roll context so the client can present the dice UI
  // before submitting the actual roll result in a follow-up request.
  if (chipType !== undefined) {
    // Phase E: reject stealth action if actor is not adjacent to a wall
    if (chipType === "stealth" && (!tiles || !isCovered(actorCurrentPos, tiles))) {
      return { success: false, error: "You need cover to hide." };
    }
    return { success: true, activeRollContext: buildRollContext(chipType, dc, modifier) };
  }

  // ─── Spatial validation (Phase D) ────────────────────────────────────────
  // Movement distance validation — only enforced during combat (outside combat the AI controls movement).
  let validatedMovDist = 0;
  if (chipSpatial?.action_type === "movement" && chipSpatial.endPosition && combatSession) {
    validatedMovDist = diagonalDistance(actorCurrentPos, chipSpatial.endPosition);
    if (validatedMovDist > currentCharacter.remainingMovementFeet) {
      return { success: false, error: "Movement exceeds remaining movement speed." };
    }
  }

  // LoS validation — reject ranged attacks with no line of sight to the target.
  if (chipSpatial?.actionTarget && combatSession && tiles) {
    if (!lineOfSight(actorCurrentPos, chipSpatial.actionTarget, tiles)) {
      return { success: false, error: "No line of sight to target." };
    }
  }

  // AoO pre-check — resolve before the AI call so we can apply effects in the transaction.
  type AoOPrepared = { enemyId: string; slotIdx: number; attackBonus: number; damageDice: string } | null;
  let preparedAoO: AoOPrepared = null;
  if (chipSpatial?.action_type === "movement" && chipSpatial.endPosition && combatSession) {
    const order = combatSession.initiativeOrder as { actorId: string; actorType: string; hasReaction: boolean; isSurprised: boolean }[];
    const reactiveSlots = order.filter((s) => s.actorType === "ENEMY" && s.hasReaction && !s.isSurprised);
    if (reactiveSlots.length > 0) {
      const reactiveIds = reactiveSlots.map((s) => s.actorId);
      const gmEnemyStateForAoO = (gmData.enemyState ?? {}) as Record<string, unknown>;
      const validReactiveIds = rawGameTiles.length > 0 ? reactiveIds.filter(id => !!gmEnemyStateForAoO[id]) : reactiveIds;
      const aooTemplates = await prisma.enemy.findMany({
        where: { id: { in: validReactiveIds } },
        select: { id: true, attackBonus: true, damageDice: true },
      });
      const gmEnemiesForAoO = (gmData.enemies ?? []) as Array<{ enemyId: string; posX: number; posY: number }>;
      const dbEnemies = aooTemplates.map(e => {
        const gm = gmEnemiesForAoO.find(g => g.enemyId === e.id);
        return { ...e, posX: gm?.posX ?? 0, posY: gm?.posY ?? 0 };
      });
      const aooEnemies = dbEnemies.map((e) => ({
        id: e.id, pos: { x: e.posX, y: e.posY }, hasReaction: true, isSurprised: false,
      }));
      const triggerId = checkAttackOfOpportunity(actorCurrentPos, chipSpatial.endPosition, aooEnemies);
      if (triggerId) {
        const rec = dbEnemies.find((e) => e.id === triggerId)!;
        preparedAoO = {
          enemyId:     triggerId,
          slotIdx:     order.findIndex((s) => s.actorId === triggerId),
          attackBonus: rec.attackBonus,
          damageDice:  rec.damageDice,
        };
      }
    }
  }

  // Phase F: build combat context for prompt grounding
  let combatInfo: CombatPromptInfo | undefined;
  let dbEnemies: { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number }[] | undefined;
  if (combatSession) {
    const order = combatSession.initiativeOrder as { actorId: string; actorType: string }[];
    const nameMap = new Map<string, string>();
    for (const pm of game.partyMembers) nameMap.set(pm.characterId, pm.character.name);
    if (game.partyMembers.length === 0) nameMap.set(game.characterId, game.character.name);
    for (const e of ((gameState.enemies as { id: string; name: string }[] | undefined) ?? [])) nameMap.set(e.id, e.name);
    const initiativeNames = order.map(s => nameMap.get(s.actorId) ?? "Unknown").join(" → ");
    const activeSlot = order[combatSession.currentTurnIndex];
    const activeRole: "PLAYER" | "NPC" = activeSlot?.actorType === "CHARACTER" ? "PLAYER" : "NPC";
    combatInfo = {
      roundNumber:           combatSession.currentRoundNumber,
      initiativeNames,
      activeName:            nameMap.get(activeSlot?.actorId ?? "") ?? "Unknown",
      activeRole,
      remainingMovementFeet: currentCharacter.remainingMovementFeet,
      remainingActions:      currentCharacter.remainingActions,
    };
    const enemySlotIds = order.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
    if (enemySlotIds.length > 0) {
      const gmEnemyStateForCombat = (gmData.enemyState ?? {}) as Record<string, { currentHp: number; maxHp: number }>;
      const gmTilesForCombat      = (gmData.tiles ?? []) as GameTile[][];
      const validCombatSlotIds    = gmTilesForCombat.length > 0 ? enemySlotIds.filter(id => !!gmEnemyStateForCombat[id]) : enemySlotIds;
      const enemyTemplatesForCombat = await prisma.enemy.findMany({
        where:  { id: { in: validCombatSlotIds } },
        select: { id: true, name: true, maxHp: true },
      });
      dbEnemies = enemyTemplatesForCombat.map(e => {
        const st  = gmEnemyStateForCombat[e.id];
        const pos = gmTilesForCombat.length > 0 ? findActor(gmTilesForCombat, e.id) : null;
        return { id: e.id, name: e.name, currentHp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, posX: pos?.x ?? 0, posY: pos?.y ?? 0 };
      });
    }
  }

  const candidateEnemies = dbEnemies
    ? dbEnemies.map(e => ({ id: e.id, name: e.name, hp: e.currentHp, maxHp: e.maxHp, x: e.posX, y: e.posY }))
    : ((gameState.enemies as { id: string; name: string; hp: number; maxHp: number; x: number; y: number }[] | undefined) ?? []);
  const weaponRangeFeet = (currentCharacter.mainHand as any)?.rangeFeet ?? 5;
  const candidates = buildChipCandidates({
    playerPos:             actorCurrentPos,
    enemies:               candidateEnemies,
    weaponRangeFeet,
    remainingMovementFeet: currentCharacter.remainingMovementFeet,
    mapTiles:              tiles,
    pois:                  ((mapData.pois ?? []) as { name: string; x: number; y: number }[]),
  });

  const diceResult: D20Result = _seededD20 !== undefined
    ? {
        roll:     _seededD20,
        modifier,
        total:    _seededD20 + modifier,
        dc,
        dcType,
        success:  _seededD20 + modifier >= dc,
        critical: _seededD20 === 20,
        fumble:   _seededD20 === 1,
      }
    : rollD20Check(modifier, dc, dcType);

  // Track consecutiveMisses in gameState.
  const prevMisses      = (gameState.consecutiveMisses as number | undefined) ?? 0;
  const consecutiveMisses = diceResult.success ? 0 : prevMisses + 1;

  // Phase E: actor hiding state + hidden enemy IDs for prompt scrubbing
  const actorIsHiding: boolean = callerMember
    ? callerMember.isHiding
    : ((currentCharacter as any).isHiding ?? false);

  const hiddenEnemyIds = new Set<string>();
  const gmEnemiesForHiding = (gmData.enemies ?? []) as Array<{ enemyId: string; isHiding: boolean }>;
  for (const e of gmEnemiesForHiding) {
    if (e.isHiding) hiddenEnemyIds.add(e.enemyId);
  }

  let response;
  try {
    response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system: [
        {
          type:          "text",
          text:          buildStaticPrompt(game.character, game.partyMembers, game.story, game.currentAct, game.currentScene, mapData, combatInfo),
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: buildDynamicStatePrompt(
            game.worldState as Record<string, any> | null,
            gameState,
            currentCharacter,
            game.partyMembers,
            currentCharId,
            diceResult,
            consecutiveMisses,
            (() => {
              const tileArr = (gmData.tiles ?? []) as Array<Array<{ t: string; item?: string }>>;
              const iState  = (gmData.itemState ?? {}) as Record<string, { isPickedUp: boolean; isVisible: boolean }>;
              const out: { id: string; name: string; type: string; isEquipped: boolean; posX: number; posY: number }[] = [];
              for (let _y = 0; _y < tileArr.length; _y++) {
                for (let _x = 0; _x < tileArr[_y].length; _x++) {
                  const tid = tileArr[_y][_x].item;
                  if (!tid) continue;
                  const st = iState[tid];
                  if (st && !st.isPickedUp && st.isVisible) out.push({ id: tid, name: tid, type: "", isEquipped: false, posX: _x, posY: _y });
                }
              }
              return out;
            })(),
            tiles,
            undefined,
            hiddenEnemyIds,
            dbEnemies,
          ),
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

  let parsed: { narrative: string; stateDeltas: Record<string, any>; encounterResult?: "completed" | null; skillName?: string | null };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    const candidate = match?.[0] ?? rawText;
    const repaired = candidate
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([}\]])\s*\n(\s*[{[])/g, '$1,\n$2');
    parsed = JSON.parse(repaired);
  } catch {
    parsed = {
      narrative:       salvageNarrative(rawText),
      stateDeltas:     {},
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
    // Two-roll design (deliberate): the main d20 roll from rollD20Check above
    // covers the initial action check (attack or non-attack DC). When the DM
    // returns a skillName, resolveSkillCheck rolls a SECOND independent d20
    // for the skill check itself. This is intentional — the two dice represent
    // distinct mechanical events (the attempt and the skill test). The skill
    // roll is reported back to the client via skillCheckResult; it is not
    // reflected in diceResult, which shows only the initial action roll.
    // A future enhancement could unify these or let the player choose which
    // roll applies, but the two-roll model is the agreed Phase 04 design.
    skillCheckResult = resolveSkillCheck(validSkillName, {
      characterClass:     currentCharacter.characterClass,
      level:              currentCharacter.level,
      baseStrength:       stats.strength.total,
      baseDexterity:      stats.dexterity.total,
      baseConstitution:   stats.constitution.total,
      baseIntelligence:   stats.intelligence.total,
      baseWisdom:         stats.wisdom.total,
      baseCharisma:       stats.charisma.total,
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
            text:          buildStaticPrompt(game.character, game.partyMembers, game.story, game.currentAct, game.currentScene, mapData, combatInfo),
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: buildDynamicStatePrompt(
              game.worldState as Record<string, any> | null,
              gameState,
              currentCharacter,
              game.partyMembers,
              currentCharId,
              diceResult,
              consecutiveMisses,
              ((gmData.items ?? []) as { itemId: string; posX: number; posY: number; isPickedUp: boolean; isVisible: boolean }[]).filter(i => !i.isPickedUp && i.isVisible).map(i => ({ id: i.itemId, name: i.itemId, type: "", isEquipped: false, posX: i.posX, posY: i.posY })),
              mapData.tiles as string[][] | undefined,
              mechanicalContext,
              hiddenEnemyIds,
              dbEnemies,
            ),
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
      const candidate2 = match2?.[0] ?? rawText2;
      const repaired2 = candidate2
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/([}\]])\s*\n(\s*[{[])/g, '$1,\n$2');
      finalParsed = JSON.parse(repaired2);
    } catch {
      finalParsed = {
        narrative:       salvageNarrative(rawText2),
        stateDeltas:     {},
        encounterResult: null,
      };
    }
  }

  // ─── Mechanical attack damage (direct path) ───────────────────────────────
  // When the player's d20 attack hits, compute damage from the weapon's damageDice
  // instead of relying on AI-emitted <combat_effect> tags.
  const isDirectAttackHit = diceResult.success && diceResult.dcType === "AC";
  const weaponDamageDice = (currentCharacter.mainHand as any)?.damageDice as string | null ?? null;
  const statModForDmg    = abilityModifier(primaryAttackScore(currentCharacter.characterClass, stats));
  const targetPos        = chipSpatial?.actionTarget;
  const attackTargetEnemy = (isDirectAttackHit && targetPos && dbEnemies)
    ? dbEnemies.find(e => e.posX === targetPos.x && e.posY === targetPos.y) ?? null
    : null;
  const mechanicalDmg = attackTargetEnemy
    ? computeAttackDamage(weaponDamageDice, statModForDmg, diceResult.critical)
    : 0;
  const mechanicalDmgEffect = (attackTargetEnemy && mechanicalDmg > 0)
    ? { targetId: attackTargetEnemy.id, delta: -mechanicalDmg, type: "damage" }
    : null;

  // ─── Combat Effects — resolve HP deltas from AI tags ─────────────────────
  // When a skill check ran, the second AI response (rawText2) is the one the DM
  // narrated from and where <combat_effect> tags will appear. Fall back to
  // rawText on non-skill turns.
  const effectsSource = validSkillName !== null ? rawText2 : rawText;
  const aiEffectsParsed = parseCombatEffects(effectsSource);
  // Merge mechanical damage with AI effects; filter AI tags for the same target to prevent double-counting.
  const rawEffects = mechanicalDmgEffect
    ? [mechanicalDmgEffect, ...aiEffectsParsed.filter(e => e.targetId !== mechanicalDmgEffect.targetId)]
    : aiEffectsParsed;
  // resolvedEffects is populated inside the $transaction so the HP read is
  // within the same serialisable snapshot as the HP write, preventing stale
  // newHp values from concurrent skill/combat turns.
  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];

  // ─── XP Award ─────────────────────────────────────────────────────────────
  const encounterCompleted = finalParsed.encounterResult === "completed";
  const xpAwarded = encounterCompleted
    ? (XP_BY_DIFFICULTY[game.story?.difficulty ?? "Standard"] ?? 0)
    : 0;
  const currentXp     = (currentCharacter.xp ?? 0) + xpAwarded;
  const previousLevel  = currentCharacter.level ?? 1;
  const newLevel       = computeLevel(currentXp);
  const didLevelUp     = newLevel > previousLevel;

  // Apply stateDeltas. For party games, route per-character fields into party-scoped maps.
  const newState: Record<string, any> = {
    ...gameState,
    consecutiveMisses,
    sceneTurnCount: ((gameState.sceneTurnCount as number | undefined) ?? 0) + 1,
  };
  const deltas = { ...finalParsed.stateDeltas };

  // Discard playerPos if coordinates are not valid integers within map bounds.
  if (deltas.playerPos !== undefined) {
    const p = deltas.playerPos as any;
    const w = (mapData.width  as number) ?? 999;
    const h = (mapData.height as number) ?? 999;
    if (
      typeof p?.x !== "number" || !Number.isInteger(p.x) || p.x < 0 || p.x >= w ||
      typeof p?.y !== "number" || !Number.isInteger(p.y) || p.y < 0 || p.y >= h
    ) {
      delete deltas.playerPos;
    }
  }

  // Capture position before deletion so D5 transaction write has the value
  const newPlayerPos = deltas.playerPos as { x: number; y: number } | undefined;

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

  // Compute enemy hp from DB (dice-authoritative) + rawEffects delta. Never trust AI-authored hp.
  if (Array.isArray(newState.enemies)) {
    const prevEnemies    = (gameState.enemies as any[] | undefined) ?? [];
    const dbEnemyMap     = new Map((dbEnemies ?? []).map(e => [e.id, e]));
    const effectDeltaMap = new Map(rawEffects.map(e => [e.targetId, e.delta]));
    newState.enemies = (newState.enemies as any[]).map((e: any) => {
      const prev   = prevEnemies.find((p: any) => p.id === e.id);
      const db     = dbEnemyMap.get(e.id);
      const maxHp  = e.maxHp ?? prev?.maxHp ?? db?.maxHp;
      const baseHp = db?.currentHp ?? prev?.hp;
      const hp = baseHp !== undefined
        ? clampHp(baseHp, effectDeltaMap.get(e.id) ?? 0, maxHp ?? baseHp)
        : e.hp;
      return {
        ...e,
        hp,
        maxHp,
        x: e.x ?? prev?.x ?? db?.posX,
        y: e.y ?? prev?.y ?? db?.posY,
      };
    });
  }

  // Level-up narration injection (one-turn delay: stored now, read by next call to buildDynamicStatePrompt)
  if (didLevelUp) {
    newState.levelUpNote = `${currentCharacter.name} advanced to Level ${newLevel} this turn.`;
  } else {
    delete newState.levelUpNote;
  }

  // Only trust encounterCompleted if no enemy in the updated state still has HP > 0.
  const stillHasLivingEnemies = ((newState.enemies ?? []) as any[]).some((e: any) => (e.hp ?? 0) > 0);
  if (encounterCompleted && !stillHasLivingEnemies) {
    newState.lastEncounterCompleted = true;
  } else {
    delete newState.lastEncounterCompleted;
  }

  const suggestionChips = candidatesToChips(candidates, weaponRangeFeet, actorCurrentPos);

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
        data: { gameId, role: "DUNGEON_MASTER", content: finalParsed.narrative, chips: suggestionChips as any },
      });
      if (xpAwarded > 0 || didLevelUp) {
        committedMaxHp = didLevelUp
          ? maxHpAtLevel(currentCharacter.characterClass, currentCharacter.baseConstitution, newLevel)
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
        data:  {
          state:                 newState,
          activeSuggestionChips: suggestionChips as any,
          narrativeHistory:      { push: finalParsed.narrative },
          currentTurnCharacterId:nextCharId,
          version:               { increment: 1 },
        },
      });
      // Resolve combat HP deltas — route to character OR GameMap.data.enemies for enemies.
      if (rawEffects.length > 0) {
        const affectedIds   = [...new Set(rawEffects.map((e) => e.targetId))];
        const affectedChars = await tx.character.findMany({ where: { id: { in: affectedIds } }, select: { id: true, currentHp: true, maxHp: true } });
        const charIds       = new Set(affectedChars.map((c) => c.id));
        const charHpMap     = new Map(affectedChars.map((c) => [c.id, c]));

        const liveGM = activeGameMap
          ? await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } })
          : null;
        const liveGMEnemies = ((liveGM?.data as any)?.enemies ?? []) as Array<{ enemyId: string; currentHp: number; maxHp: number; posX: number; posY: number; status?: string; isHiding?: boolean; stealthRoll?: number; hasReaction?: boolean; isSurprised?: boolean; lootItemIds?: string[] }>;
        const gmHpMap = new Map(liveGMEnemies.map(e => [e.enemyId, e]));
        // dbEnemies fallback for enemies not yet seeded into the GameMap
        const dbEnemyHpMap = new Map((dbEnemies ?? []).map(e => [e.id, e]));
        const enemyIds = new Set(affectedIds.filter(id => !charIds.has(id) && (gmHpMap.has(id) || dbEnemyHpMap.has(id))));

        resolvedEffects = rawEffects
          .filter((e) => charIds.has(e.targetId) || enemyIds.has(e.targetId))
          .map((e) => {
            if (charIds.has(e.targetId)) {
              const actor = charHpMap.get(e.targetId)!;
              return { ...e, newHp: clampHp(actor.currentHp, e.delta, actor.maxHp) };
            }
            // Prefer live GameMap HP; fall back to dbEnemies HP
            const gme = gmHpMap.get(e.targetId);
            const dbe = dbEnemyHpMap.get(e.targetId);
            const currentHp = gme?.currentHp ?? dbe?.currentHp ?? 0;
            const maxHp     = gme?.maxHp     ?? dbe?.maxHp     ?? currentHp;
            return { ...e, newHp: clampHp(currentHp, e.delta, maxHp) };
          });

        // Character HP updates
        for (const eff of resolvedEffects.filter(e => charIds.has(e.targetId))) {
          await tx.character.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } });
        }
        // Enemy HP upsert — update existing or insert if not yet in GameMap
        const enemyEffects = resolvedEffects.filter(e => enemyIds.has(e.targetId));
        if (liveGM && enemyEffects.length > 0) {
          const hpChanges = new Map(enemyEffects.map(e => [e.targetId, e.newHp]));
          const updatedEnemies = liveGMEnemies.map(e =>
            hpChanges.has(e.enemyId) ? { ...e, currentHp: hpChanges.get(e.enemyId)! } : e
          );
          for (const [enemyId, newHp] of hpChanges) {
            if (!gmHpMap.has(enemyId)) {
              const dbe = dbEnemyHpMap.get(enemyId);
              if (dbe) {
                updatedEnemies.push({ enemyId, currentHp: newHp, maxHp: dbe.maxHp, posX: dbe.posX, posY: dbe.posY, status: "ACTIVE", isHiding: false, stealthRoll: 0, hasReaction: true, isSurprised: false, lootItemIds: [] });
              }
            }
          }
          await tx.gameMap.update({ where: { id: liveGM.id }, data: { data: { ...(liveGM.data as any), enemies: updatedEnemies } } });
        }
      }

      // Combat-end: delete CombatSession when player kills the last enemy.
      if (encounterCompleted && combatSession) {
        const slotEnemyIds = (combatSession.initiativeOrder as { actorId: string; actorType: string }[])
          .filter((s) => s.actorType === "ENEMY")
          .map((s) => s.actorId);
        if (slotEnemyIds.length > 0) {
          const hpOverrides = new Map(resolvedEffects.map((e) => [e.targetId, e.newHp]));
          const liveGMForCheck = activeGameMap
            ? await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { data: true } })
            : null;
          const liveGMEnemiesForCheck = ((liveGMForCheck?.data as any)?.enemies ?? []) as Array<{ enemyId: string; currentHp: number }>;
          const gmCheckMap = new Map(liveGMEnemiesForCheck.map(e => [e.enemyId, e.currentHp]));
          const allDead = slotEnemyIds.every(id => (hpOverrides.get(id) ?? gmCheckMap.get(id) ?? 0) <= 0);
          if (allDead) {
            await tx.combatSession.delete({ where: { gameId } });
          }
        }
      }

      // AoO processing — attack roll + damage + clear enemy reaction slot
      if (preparedAoO) {
        const charAC = 10 + abilityModifier(stats.dexterity.total);
        const aooAtk = rollD20Check(preparedAoO.attackBonus, charAC, "AC");
        if (aooAtk.success) {
          const dmg  = rollDamageExpr(preparedAoO.damageDice);
          const cHp  = await tx.character.findUnique({ where: { id: currentCharId }, select: { currentHp: true, maxHp: true } });
          if (cHp) {
            const newHp = Math.max(0, cHp.currentHp - dmg);
            await tx.character.update({ where: { id: currentCharId }, data: { currentHp: newHp } });
            resolvedEffects.push({ targetId: currentCharId, delta: -dmg, type: "reaction_attack", newHp });
          }
        }
        // Clear hasReaction on the enemy's initiative slot
        const currentOrder = combatSession!.initiativeOrder as any[];
        const updatedOrder = currentOrder.map((slot, idx) =>
          idx === preparedAoO!.slotIdx ? { ...slot, hasReaction: false } : slot,
        );
        await tx.combatSession.update({ where: { gameId }, data: { initiativeOrder: updatedOrder } });
      }

      // D5: write position — chipSpatial.endPosition takes precedence over AI stateDeltas.playerPos
      const finalPos = chipSpatial?.endPosition ?? newPlayerPos;
      if (finalPos) {
        const callerRecord = game.partyMembers.find((m) => m.characterId === currentCharId);
        if (callerRecord) {
          await tx.partyMember.update({
            where: { id: callerRecord.id },
            data:  { posX: finalPos.x, posY: finalPos.y },
          });
        } else {
          // Solo game: write to Character.posX/posY
          await tx.character.update({ where: { id: currentCharId }, data: { posX: finalPos.x, posY: finalPos.y } });
        }
      }

      // Decrement remainingMovementFeet when a validated endPosition was used
      if (chipSpatial?.endPosition && validatedMovDist > 0) {
        await tx.character.update({
          where: { id: currentCharId },
          data:  { remainingMovementFeet: Math.max(0, currentCharacter.remainingMovementFeet - validatedMovDist) },
        });
      }

      // Phase E: stealth state management
      const finalPos2 = chipSpatial?.endPosition ?? newPlayerPos;
      if (chipSpatial?.type === "stealth") {
        const stealthRoll = rollStealthCheck(abilityModifier(stats.dexterity.total));
        if (callerMember) {
          await tx.partyMember.update({ where: { id: callerMember.id }, data: { isHiding: true, stealthRoll } });
        } else {
          await tx.character.update({ where: { id: currentCharId }, data: { isHiding: true, stealthRoll } });
        }
      } else if (actorIsHiding && breaksStealth(chipSpatial?.type ?? "")) {
        if (callerMember) {
          await tx.partyMember.update({ where: { id: callerMember.id }, data: { isHiding: false } });
        } else {
          await tx.character.update({ where: { id: currentCharId }, data: { isHiding: false } });
        }
      } else if (finalPos2 && actorIsHiding && tiles) {
        const stillCovered = isCovered(finalPos2, tiles);
        const gameEnemies = (gameState.enemies as { x: number; y: number }[] | undefined) ?? [];
        const exposed = !stillCovered && gameEnemies.some(e => lineOfSight(finalPos2, { x: e.x, y: e.y }, tiles!));
        if (exposed) {
          if (callerMember) {
            await tx.partyMember.update({ where: { id: callerMember.id }, data: { isHiding: false } });
          } else {
            await tx.character.update({ where: { id: currentCharId }, data: { isHiding: false } });
          }
        }
      }

      // POI interact effect — apply mapUpdate tile changes from interactEffect.
      // Only "D"→"F" (open door) and "?"→"F" (reveal) are accepted.
      if (activeGameMap && newState.mapUpdate) {
        const changes = newState.mapUpdate as Array<{ x: number; y: number; tile: string }>;
        delete newState.mapUpdate;
        const gmForMap = await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } });
        if (gmForMap) {
          const tiles2 = (gmForMap.data as any).tiles as Array<Array<{ t: string; [k: string]: any }>>;
          let changed2 = false;
          for (const c of changes) {
            const cell = tiles2[c.y]?.[c.x];
            if (cell && (cell.t === "D" || cell.t === "?") && c.tile === "F") {
              tiles2[c.y][c.x] = { ...cell, t: "F" };
              changed2 = true;
            }
          }
          if (changed2) {
            await tx.gameMap.update({ where: { id: gmForMap.id }, data: { data: { ...(gmForMap.data as any), tiles: tiles2 } } });
          }
        }
      }

      // Mechanical scene advancement — evaluate trigger conditions against live DB state.
      if (game.currentScene) {
        const resolvedPos2 = newPlayerPos ?? actorCurrentPos;
        const { triggered, nextScene } = await checkSceneTrigger(tx, game.currentScene, {
          gameId,
          currentActId:   game.currentActId ?? null,
          activeCharId:   currentCharId,
          isPartyGame:    game.partyMembers.length > 1,
          callerMemberId: callerMember?.id,
          sceneTurnCount: newState.sceneTurnCount as number,
          callerPos:      resolvedPos2,
        });
        if (triggered && nextScene) {
          newState.sceneTurnCount = 0;
          const nextSceneGMEnemySt = (gmData.enemyState ?? {}) as Record<string, { currentHp: number; maxHp: number }>;
          const nextSceneGMTiles   = (gmData.tiles ?? []) as GameTile[][];
          const validNextSceneIds2 = nextSceneGMTiles.length > 0 ? Object.keys(nextSceneGMEnemySt) : null;
          const nextSceneEnemyTemplates = await tx.enemy.findMany({
            where:  { sceneId: nextScene.id, ...(validNextSceneIds2 ? { id: { in: validNextSceneIds2 } } : {}) },
            select: { id: true, name: true, maxHp: true },
          });
          newState.enemies = nextSceneEnemyTemplates.map((e: { id: string; name: string; maxHp: number }) => {
            const st  = nextSceneGMEnemySt[e.id];
            const pos = nextSceneGMTiles.length > 0 ? findActor(nextSceneGMTiles, e.id) : null;
            return { id: e.id, name: e.name, hp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, x: pos?.x ?? 0, y: pos?.y ?? 0 };
          });
          console.log(`[scene-advance] game=${gameId} → "${nextScene.title}"`);
          await tx.game.update({
            where: { id: gameId },
            data:  { currentSceneId: nextScene.id, state: newState },
          });
        }
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
    chips:     suggestionChips,
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
