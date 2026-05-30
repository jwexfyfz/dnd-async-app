"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE } from "../../lib/ai-config";
import { parseCombatEffects, clampHp } from "../../lib/combat-effect";
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
import { maxHpAtLevel, proficiencyBonus } from "../../lib/leveling";
import type { QueueRoll, SuggestionChip } from "../../types/suggestion-chip";
import { processNpcTurns } from "./process-npc-turns";
import { lineOfSight } from "../../lib/grid";
import { checkSceneTrigger } from "../../lib/scene-advance";
import { buildChipCandidates, candidatesToChips } from "../../lib/chip-candidates";
import { createGameMap } from "../../lib/create-game-map";
import { findActor, tilesToStringGrid } from "../../lib/game-map-utils";
import type { GameTile, EnemyInstance, GameMapData } from "../../lib/tile-types";
import { getActorVisibleTiles, VP_RADIUS } from "../../lib/visibility";

const anthropic = new Anthropic({ maxRetries: 4 });

// ─── Prompt builders ──────────────────────────────────────────────────────────

interface CombatPromptInfo {
  roundNumber:           number;
  initiativeNames:       string;
  activeName:            string;
  activeRole:            "PLAYER" | "NPC";
  remainingMovementFeet: number;
  remainingActions:      number;
}

function buildStaticContext(
  character:    any,
  allMembers:   any[],
  story:        any,
  currentAct:   any,
  currentScene: any,
  mapData:      any,
  combatInfo?:  CombatPromptInfo,
): string {
  const rooms    = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois     = mapData.pois?.map((p: any) => `${p.name} at (${p.x},${p.y})`).join(", ") ?? "—";
  const partyStr = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name}[id:${m.character.id},${m.character.characterClass}]`
      ).join("\n")
    : `  ${character.name}[id:${character.id},${character.characterClass}]`;

  const actSummaries = story?.acts
    ?.map((a: any) => `  Act ${a.order}: ${a.title} — ${a.summary}`)
    .join("\n") ?? "";

  const actBlock = currentAct
    ? `CURRENT ACT ${currentAct.order}: ${currentAct.title}\n${currentAct.playerFacingDescription}`
    : "";

  const sceneBlock = currentScene
    ? `CURRENT SCENE ${currentScene.order}: ${currentScene.title}\n${currentScene.description}\nObjectives: ${(currentScene.objectives as string[]).join("; ")}`
    : "";

  return `You are an immersive Dungeon Master running an async D&D 5e campaign. Write 3–4 sentences of specific, present-tense narration. Every sentence must name something concrete — a weapon connecting, an enemy recoiling, a door groaning open, a trap clicking. Never write vague filler ("the dungeon stirs", "you press on"). Describe: (1) the exact result of the player's action, (2) how the environment or enemy reacts, (3) what the character now faces so the next choices are obvious.

PARTY
${partyStr}

OVERARCHING STORY: ${story?.title ?? "Unknown"}
${actSummaries}

${actBlock}

${sceneBlock}

MAP: ${mapData.name ?? "Unknown"}
Rooms: ${rooms}
Points of interest: ${pois}

SPATIAL RULES
Pos: values are tile coordinates. Use them to determine and narrate spatial reality every turn:
- Distance ≤ 1 tile → melee reach; describe the closeness physically (smell, breathing, blade contact).
- Distance 2–4 tiles → near-range; describe positioning, charging, closing the gap.
- Distance 5+ tiles → ranged; describe throws, spells, projectiles arcing across the room.
- After any character (player or enemy) moves, their new x,y MUST appear in stateDeltas (playerPos for the active character; updated enemies array for NPCs). Never let a movement go unrecorded.${combatInfo ? `

IN COMBAT — Round ${combatInfo.roundNumber}
Initiative order (do not alter): ${combatInfo.initiativeNames} (active: ${combatInfo.activeName})
Active actor role: ${combatInfo.activeRole}
STRICT RULE: initiativeOrder is set at combat start and NEVER changes. You cannot add, remove, or reorder actors. You cannot invent enemies not listed in CURRENT STATE.` : ""}${combatInfo
  ? (combatInfo.remainingMovementFeet === 0 ? "\nDo not generate movement chips — remaining movement is 0." : "")
    + (combatInfo.remainingActions === 0 ? "\nDo not generate mainAction chips — remaining actions is 0." : "")
  : ""}`;
}

function buildRollSummary(rolls: QueueRoll[]): string {
  return rolls
    .map((r, i) => {
      if (r.skipped) return `${i + 1}. ${r.type} — ${r.label}: SKIPPED`;
      const outcome = r.isSuccess === true ? "SUCCESS" : r.isSuccess === false ? "FAILURE" : "—";
      const crit    = r.naturalResult === 20 ? " (CRITICAL HIT)" : r.naturalResult === 1 ? " (FUMBLE)" : "";
      return `${i + 1}. ${r.type} — ${r.label}: rolled ${r.naturalResult ?? "—"} (total ${r.totalResult ?? "—"}) vs ${r.dc ?? "—"} → ${outcome}${crit}`;
    })
    .join("\n");
}

interface MechanicalAttackResult {
  enemyName:   string;
  damage:      number;
  enemyHpAfter: number;
  isCrit:      boolean;
}

function buildDynamicContext(
  worldState:    Record<string, any> | null,
  gameState:     Record<string, any>,
  currentChar:   any,
  partyMembers:  any[],
  currentCharId: string,
  chipLabel:     string,
  rolls:         QueueRoll[],
  consecutiveMisses: number,
  lastEncounterCompleted: boolean,
  mapItems:      { id: string; name: string; isEquipped: boolean; posX: number | null; posY: number | null }[],
  mapTiles?:     string[][],
  hiddenEnemyIds?: Set<string>,
  dbEnemies?:    { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number }[],
  endPosition?:  { x: number; y: number },
  mechanicalAttack?: MechanicalAttackResult,
): string {
  // worldState columns → fall back to game.state JSON
  const ws  = worldState ?? {};
  const obj = (ws.activeObjective ?? gameState.activeObjective ?? "") as string;
  const flags = ((ws.plotFlags ?? gameState.plotFlags ?? []) as string[]);

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

  let stateStr: string;
  if (partyMembers.length > 0) {
    const tags = partyMembers
      .map((m: any) => charTag(m.character, { x: m.posX, y: m.posY }, m.characterId === currentCharId))
      .join("  ");
    stateStr = `${tags}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}`;
  } else {
    const pos = (gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    stateStr = `${charTag(currentChar, pos, true)}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}`;
  }

  const missDirective = consecutiveMisses >= 3
    ? `\nNARRATION DIRECTIVE: After ${consecutiveMisses} consecutive misses, engineer a dramatic opening — enemy stumbles, environment intervenes, or an NPC assists. Do not alter the roll outcomes.`
    : "";

  const attackLine = mechanicalAttack
    ? `\nMECHANICAL RESULT: Hit ${mechanicalAttack.enemyName} for ${mechanicalAttack.damage} damage${mechanicalAttack.isCrit ? " (CRITICAL HIT)" : ""}. ${mechanicalAttack.enemyName} now has ${mechanicalAttack.enemyHpAfter} HP${mechanicalAttack.enemyHpAfter <= 0 ? " — DEFEATED" : ""}. HP applied by engine; DO NOT emit combat_effect for this attack.`
    : "";

  const turnSection = rolls.length > 0
    ? `TURN RESOLUTION — narrate around these exact results:\n${buildRollSummary(rolls)}${attackLine}`
    : `TURN RESOLUTION — free action, no dice roll required.\nPlayer action: ${chipLabel}`;

  const hasLivingEnemies = dbEnemies
    ? dbEnemies.some(e => e.currentHp > 0)
    : ((gameState.enemies ?? []) as any[]).some((e: any) => (e.hp ?? 0) > 0);
  const postCombatDirective = lastEncounterCompleted && !hasLivingEnemies
    ? `\nPOST-COMBAT NOTE: Combat just resolved. After narrating the player's current action normally, briefly weave in what the party discovers in the aftermath (loot, a clue, the silence settling). Chips must be exploration, investigation, movement, or social — not attacks.`
    : "";

  const groundingRule = `\nNARRATIVE GROUNDING: Do not invent new characters or enemies not listed in CURRENT STATE. You may narrate objects and environmental details described in the recent conversation even if they lack coordinates.`;
  const endPosHint = endPosition
    ? `\nMOVEMENT TARGET: destination tile is (${endPosition.x}, ${endPosition.y}). You MUST include "playerPos": {"x": ${endPosition.x}, "y": ${endPosition.y}} in stateDeltas.`
    : "";
  return `CURRENT STATE\n${stateStr}\n\n${turnSection}\nconsecutiveMisses:${consecutiveMisses}${missDirective}${postCombatDirective}${groundingRule}${endPosHint}`;
}

function buildResponseInstruction(): string {
  return `RESPONSE RULES
Reply with exactly one JSON object. No markdown fences, no prose before or after.
{
  "narrative": "3–4 sentences, present tense, name the active character. S1: exact outcome of their action (hit/miss/crit/spell effect). S2: enemy or environment reaction. S3–4: what the character now faces (sets up next actions).",
  "stateDeltas": {},
  "encounterResult": null
}

Field details:
narrative — 3–4 sentences: (1) exact outcome of the action, (2) enemy/NPC/environment reaction, (3–4) what the character now faces. Be specific — name enemies, objects, distances, damage amounts. No vague filler.
stateDeltas — key/value pairs for any game state changes. Omit party HP — use the combat effect tag instead. PLAYER MOVEMENT: when the active character moves, "playerPos" is REQUIRED with exact integer {x,y} tile coordinates (1–2 tiles toward destination; never null or fractional). ENEMY MOVEMENT: "enemies": [{"id":"kebab-slug","name":"...","x":N,"y":N}] — include the FULL enemy list whenever any enemy acts or moves. Never include "hp" — HP is computed from dice rolls only. Omit "enemies" key only if nothing about any enemy changed this turn. MAP UPDATE: when a player opens a door (symbol D) or reveals an unknown area (?), include "mapUpdate": [{"x":N,"y":N,"tile":"F"}, ...] with all tiles to change — copy the exact coordinates from the POI's interactEffect.mapUpdate field. Only D→F and ?→F transitions are accepted; do not invent coordinates.
encounterResult — use the string "completed" if combat fully resolves this turn; otherwise null.

COMBAT EFFECT TAG (engine-only, not shown to players)
Player weapon attack damage is computed mechanically from dice rolls — DO NOT emit combat_effect for it (see MECHANICAL RESULT above).
Only emit combat_effect for: healing (potions, spells), environmental/trap damage, AoE spell damage, poison/condition damage, and damage not from a direct weapon attack roll.
Format: <combat_effect target_id="ENTITY_ID" delta="N" type="TYPE" />
• For ENEMIES use the exact [id:...] value from the ENEMIES list (e.g. target_id="a1s1_rat_1")
• delta: negative integer for damage (e.g. "-5"), positive for healing (e.g. "3")
• type: "damage" | "healing" | "poison" | "fire" | etc.
Emit one tag per affected entity. Omit entirely if no HP changed this turn.`;
}


// ─── Action ───────────────────────────────────────────────────────────────────

export interface AutoAdvanceResult {
  success:           boolean;
  narrative?:        string;
  chips?:            SuggestionChip[];
  newState?:         Record<string, any>;
  combatEffects?:    { targetId: string; delta: number; type: string; newHp: number }[];
  npcNarrative?:     string;
  npcCombatEffects?: { targetId: string; delta: number; type: string; newHp: number }[];
  actionsReset?:     boolean;
  levelUpResult?:    { oldLevel: number; newLevel: number; oldMaxHp: number; newMaxHp: number; proficiencyBonus: number };
  error?:            string;
}

export async function autoAdvance(
  gameId:       string,
  turnId:       string,
  chipLabel:    string,
  endPosition?: { x: number; y: number },
  itemId?:      string,
): Promise<AutoAdvanceResult> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  // ── Load queue ────────────────────────────────────────────────────────────
  const queue = await prisma.activeTurnQueue.findUnique({ where: { id: turnId } });
  if (!queue || queue.gameId !== gameId) return { success: false, error: "Turn not found." };
  if (queue.status !== "COMPLETED")      return { success: false, error: "Rolls not yet resolved." };

  const rolls = queue.rolls as unknown as QueueRoll[];

  // ── Load game ─────────────────────────────────────────────────────────────
  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    { include: { mainHand: { select: { name: true, rangeFeet: true } }, armor: { select: { name: true } } } },
      story:        { include: { acts: { select: { order: true, title: true, summary: true }, orderBy: { order: "asc" } } } },
      currentAct:   true,
      currentScene: true,
      partyMembers: {
        include: { character: { include: { mainHand: { select: { name: true, rangeFeet: true } }, armor: { select: { name: true } } } } },
        orderBy:  { turnOrder: "asc" },
      },
      messages:      { orderBy: { createdAt: "asc" }, take: ROLLING_WINDOW_SIZE },
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

  console.log("[auto-advance] scene:", {
    id:          game.currentScene?.id ?? null,
    triggerType: game.currentScene?.triggerType ?? null,
    triggerAreaX: game.currentScene?.triggerAreaX ?? null,
    triggerAreaY: game.currentScene?.triggerAreaY ?? null,
  });

  const callerMember  = game.partyMembers.find((m) => m.userId === user.id);
  const currentCharId = callerMember?.characterId ?? game.characterId;
  const currentChar   = callerMember ? callerMember.character : game.character;
  const gameState     = game.state as Record<string, any>;
  const expectedVersion = game.version;

  // Pre-load scene enemies into gameState if missing or stale (IDs don't match DB).
  // Prevents the AI from inventing enemy IDs which break HP resolution.
  if (game.currentScene) {
    const gmEnemyState = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
    const gmTiles      = (gmData.tiles ?? []) as GameTile[][];
    const validSceneIds = gmTiles.length > 0 ? Object.keys(gmEnemyState) : null;
    const sceneEnemyTemplates = await prisma.enemy.findMany({
      where:  { sceneId: game.currentScene.id, ...(validSceneIds ? { id: { in: validSceneIds } } : {}) },
      select: { id: true, name: true, maxHp: true },
    });
    if (sceneEnemyTemplates.length > 0) {
      const currentIds = new Set((gameState.enemies as any[] | undefined ?? []).map((e: any) => e.id));
      const sceneIds   = new Set(sceneEnemyTemplates.map(e => e.id));
      const idsStale   = !sceneEnemyTemplates.every(e => currentIds.has(e.id));
      const hasGhosts  = (gameState.enemies as any[] | undefined ?? []).some((e: any) => !sceneIds.has(e.id));
      if (!gameState.enemies || (gameState.enemies as any[]).length === 0 || idsStale || hasGhosts) {
        gameState.enemies = sceneEnemyTemplates.flatMap(e => {
          const st  = gmEnemyState[e.id];
          const pos = gmTiles.length > 0 ? findActor(gmTiles, e.id) : null;
          // When a tile map exists, skip enemies with no tile position — they are DB ghosts.
          if (gmTiles.length > 0 && !pos) return [];
          return [{ id: e.id, name: e.name, hp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, x: pos?.x ?? 0, y: pos?.y ?? 0 }];
        });
        await prisma.game.update({ where: { id: gameId }, data: { state: gameState } });
      }
    }
  }

  // ── consecutiveMisses ─────────────────────────────────────────────────────
  const primaryRoll   = rolls.find((r) => r.type !== "DAMAGE");
  // Free actions (no rolls) and successes both reset the miss streak.
  const turnSucceeded = rolls.length === 0 || (primaryRoll?.isSuccess ?? false);
  const consecutiveMisses = turnSucceeded
    ? 0
    : (gameState.consecutiveMisses ?? 0) + 1;

  // ── Phase F: combat context for prompt grounding ──────────────────────────
  const combatSessionNow = await prisma.combatSession.findUnique({ where: { gameId } });
  let combatInfo: CombatPromptInfo | undefined;
  let combatEnemyIdSet = new Set<string>();
  let dbEnemies: { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number }[] | undefined;
  if (combatSessionNow) {
    const order = combatSessionNow.initiativeOrder as { actorId: string; actorType: string }[];
    const nameMap = new Map<string, string>();
    for (const pm of game.partyMembers) nameMap.set(pm.characterId, pm.character.name);
    if (game.partyMembers.length === 0) nameMap.set(game.characterId, game.character.name);
    for (const e of ((gameState.enemies as { id: string; name: string }[] | undefined) ?? [])) nameMap.set(e.id, e.name);
    const initiativeNames = order.map(s => nameMap.get(s.actorId) ?? "Unknown").join(" → ");
    const activeSlot = order[combatSessionNow.currentTurnIndex];
    const activeRole: "PLAYER" | "NPC" = activeSlot?.actorType === "CHARACTER" ? "PLAYER" : "NPC";
    combatInfo = {
      roundNumber:           combatSessionNow.currentRoundNumber,
      initiativeNames,
      activeName:            nameMap.get(activeSlot?.actorId ?? "") ?? "Unknown",
      activeRole,
      remainingMovementFeet: currentChar.remainingMovementFeet ?? 30,
      remainingActions:      currentChar.remainingActions ?? 1,
    };
    const enemySlotIds = order.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
    combatEnemyIdSet = new Set(enemySlotIds);

    // ── Sync: remove stale enemy slots (dead, fled, or out of LoS) ────────────
    const gmTilesSync      = (gmData.tiles ?? []) as GameTile[][];
    const gmEnemyStateSync = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
    if (gmTilesSync.length > 0 && combatEnemyIdSet.size > 0) {
      const playerPositions: { x: number; y: number }[] = game.partyMembers.length > 0
        ? game.partyMembers.map((m: any) => ({ x: m.posX, y: m.posY }))
        : [{ x: (gameState.playerPos as any)?.x ?? 0, y: (gameState.playerPos as any)?.y ?? 0 }];

      const tilePosSync = new Map<string, { x: number; y: number }>();
      for (let ty = 0; ty < gmTilesSync.length; ty++) {
        for (let tx = 0; tx < gmTilesSync[ty].length; tx++) {
          const actor = gmTilesSync[ty][tx]?.actor;
          if (actor?.kind === "enemy" && combatEnemyIdSet.has(actor.id)) {
            tilePosSync.set(actor.id, { x: tx, y: ty });
          }
        }
      }

      const visibleTilesSync = new Set<string>();
      for (const pos of playerPositions) {
        for (const tile of getActorVisibleTiles(gmTilesSync, pos.x, pos.y)) {
          visibleTilesSync.add(tile);
        }
      }

      const staleIds = new Set<string>();
      for (const id of combatEnemyIdSet) {
        const pos = tilePosSync.get(id);
        const st  = gmEnemyStateSync[id];
        if (!pos)                                                  { staleIds.add(id); continue; }
        if (st?.status === "DEFEATED" || st?.status === "FLED")    { staleIds.add(id); continue; }
        if (!visibleTilesSync.has(`${pos.x},${pos.y}`))           { staleIds.add(id); continue; }
      }

      if (staleIds.size > 0) {
        console.log(`[autoAdvance] combat sync — removing ${staleIds.size} stale slot(s): ${[...staleIds].join(", ")}`);
        const cleanedOrder      = order.filter(s => !staleIds.has(s.actorId));
        const remainingEnemies  = cleanedOrder.filter(s => s.actorType === "ENEMY");
        if (remainingEnemies.length === 0) {
          await prisma.combatSession.delete({ where: { gameId } });
          console.log(`[autoAdvance] combat sync — no enemies remain, session deleted`);
        } else {
          const currentSlot  = order[combatSessionNow.currentTurnIndex];
          const newTurnIndex = currentSlot && !staleIds.has(currentSlot.actorId)
            ? cleanedOrder.findIndex(s => s.actorId === currentSlot.actorId)
            : 0;
          await prisma.combatSession.update({
            where: { gameId },
            data:  { initiativeOrder: cleanedOrder as any, currentTurnIndex: newTurnIndex },
          });
        }
        for (const id of staleIds) combatEnemyIdSet.delete(id);
      }
    }

    if (enemySlotIds.length > 0) {
      const gmEnemyStateCombat = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
      const gmTilesCombat      = (gmData.tiles ?? []) as GameTile[][];
      const validCombatIds = gmTilesCombat.length > 0 ? enemySlotIds.filter(id => !!gmEnemyStateCombat[id]) : enemySlotIds;
      const enemyTemplates = await prisma.enemy.findMany({
        where:  { id: { in: validCombatIds } },
        select: { id: true, name: true, maxHp: true },
      });
      dbEnemies = enemyTemplates.map(e => {
        const st  = gmEnemyStateCombat[e.id];
        const pos = gmTilesCombat.length > 0 ? findActor(gmTilesCombat, e.id) : null;
        return { id: e.id, name: e.name, currentHp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, posX: pos?.x ?? 0, posY: pos?.y ?? 0 };
      });
    }
  }

  // Fallback: populate dbEnemies from gmEnemyState when no combatSession row exists.
  // This handles attacks that occur before a combat session is created, or in
  // encounter flows that don't use the initiative system.
  if (!dbEnemies) {
    const gmesFallback   = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
    const fallbackIds    = Object.keys(gmesFallback);
    if (fallbackIds.length > 0) {
      const gmTilesFallback = (gmData.tiles ?? []) as GameTile[][];
      const fallbackTemplates = await prisma.enemy.findMany({
        where:  { id: { in: fallbackIds } },
        select: { id: true, name: true, maxHp: true },
      });
      dbEnemies = fallbackTemplates.map(e => {
        const st  = gmesFallback[e.id];
        const pos = gmTilesFallback.length > 0 ? findActor(gmTilesFallback, e.id) : null;
        return { id: e.id, name: e.name, currentHp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, posX: pos?.x ?? 0, posY: pos?.y ?? 0 };
      });
      console.log("[autoAdvance] dbEnemies fallback from gmEnemyState:", dbEnemies.map(e => `${e.id}:${e.currentHp}`));
    }
  }

  // ── Mechanical attack damage ──────────────────────────────────────────────
  // Use the DAMAGE roll's totalResult directly as mechanical damage instead of
  // relying on AI-emitted <combat_effect> tags, which are unreliable for attacks.
  const attackRoll  = rolls.find(r => r.type === "ATTACK" && r.isSuccess === true);
  const damageRoll  = rolls.find(r => r.type === "DAMAGE" && !r.skipped && r.totalResult !== null);
  const attackTargetId = (attackRoll as any)?.targetEnemyId as string | undefined;
  const pendingDamage  = (attackRoll && damageRoll) ? (damageRoll.totalResult ?? 0) : 0;

  console.log("[autoAdvance] mechanical attack:", {
    attackTargetId,
    pendingDamage,
    attackRollFound:  !!attackRoll,
    damageRollFound:  !!damageRoll,
    dbEnemiesCount:   dbEnemies?.length ?? "undefined (no combatSession?)",
    dbEnemyIds:       dbEnemies?.map(e => e.id) ?? [],
  });

  let mechanicalAttack: MechanicalAttackResult | undefined;
  let mechanicalEffect: { targetId: string; delta: number; type: string } | null = null;
  if (attackTargetId && pendingDamage > 0) {
    const targetEnemy = dbEnemies?.find(e => e.id === attackTargetId);
    if (targetEnemy) {
      const enemyHpAfter = Math.max(0, targetEnemy.currentHp - pendingDamage);
      console.log("[autoAdvance] mechanical damage resolved:", {
        attackTargetId,
        pendingDamage,
        currentHp:    targetEnemy.currentHp,
        enemyHpAfter,
      });
      mechanicalAttack  = { enemyName: targetEnemy.name, damage: pendingDamage, enemyHpAfter, isCrit: attackRoll?.naturalResult === 20 };
      mechanicalEffect  = { targetId: attackTargetId, delta: -pendingDamage, type: "damage" };
    } else {
      console.warn("[autoAdvance] attackTargetId not matched in dbEnemies:", {
        attackTargetId,
        dbEnemyIds: dbEnemies?.map(e => e.id) ?? "dbEnemies undefined",
      });
    }
  }

  // ── Claude call ───────────────────────────────────────────────────────────
  // Load hidden enemy IDs for prompt scrubbing.
  const hiddenEnemyIds = new Set<string>();
  const gmEnemyStateHiding = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
  for (const [enemyId, st] of Object.entries(gmEnemyStateHiding)) {
    if (st.isHiding) hiddenEnemyIds.add(enemyId);
  }

  // Build candidate enemies from authoritative tile positions + enemyState HP.
  // gameState.enemies is stale after combat ends; tiles are cleared when an enemy is defeated.
  const gmTilesCand       = (gmData.tiles ?? []) as GameTile[][];
  const gmStringTilesCand = gmTilesCand.length > 0 ? tilesToStringGrid(gmTilesCand) : undefined;
  const gmEnemyStateCand = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
  const gsEnemyNameMap   = new Map(((gameState.enemies as any[] | undefined) ?? []).map((e: any) => [e.id as string, e.name as string]));

  let candidateEnemies: { id: string; name: string; hp: number; maxHp: number; x: number; y: number }[];
  if (gmTilesCand.length > 0) {
    candidateEnemies = [];
    for (let ty = 0; ty < gmTilesCand.length; ty++) {
      for (let tx = 0; tx < gmTilesCand[ty].length; tx++) {
        const actor = gmTilesCand[ty][tx]?.actor;
        if (actor?.kind !== "enemy") continue;
        if (combatEnemyIdSet.size > 0 && !combatEnemyIdSet.has(actor.id)) continue;
        const st = gmEnemyStateCand[actor.id];
        const rawHp     = st?.currentHp ?? 0;
        const currentHp = (mechanicalEffect?.targetId === actor.id && mechanicalEffect.delta < 0)
          ? Math.max(0, rawHp + mechanicalEffect.delta)
          : rawHp;
        console.log("[autoAdvance] tile enemy scan", {
          id:     actor.id,
          st:     st ? { currentHp: st.currentHp, maxHp: st.maxHp, status: st.status } : "MISSING",
          currentHp,
          skipped: (st?.status === "DEFEATED" || st?.status === "FLED") ? "status" : currentHp <= 0 ? "hp<=0" : "no",
        });
        if (st?.status === "DEFEATED" || st?.status === "FLED") continue;
        if (currentHp <= 0) continue;
        candidateEnemies.push({
          id:    actor.id,
          name:  gsEnemyNameMap.get(actor.id) ?? actor.id,
          hp:    currentHp,
          maxHp: st?.maxHp ?? currentHp,
          x:     tx,
          y:     ty,
        });
      }
    }
  } else {
    candidateEnemies = dbEnemies
      ? dbEnemies.map(e => ({ id: e.id, name: e.name, hp: e.currentHp, maxHp: e.maxHp, x: e.posX, y: e.posY }))
      : ((gameState.enemies as any[] | undefined) ?? []).map((e: any) => ({ id: e.id, name: e.name, hp: e.hp ?? 0, maxHp: e.maxHp ?? 0, x: e.x ?? 0, y: e.y ?? 0 }));
  }
  const candidatePlayerPos = (() => {
    const m = game.partyMembers.find((m: any) => m.characterId === currentCharId);
    if (m) return { x: m.posX, y: m.posY };
    return (gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
  })();

  // Apply pending mechanical damage before chip generation — the DB write is deferred
  // to the transaction below, so gmData.enemyState still reflects pre-attack HP here.
  if (mechanicalEffect && mechanicalEffect.delta < 0) {
    candidateEnemies = candidateEnemies
      .map(e => e.id === mechanicalEffect.targetId ? { ...e, hp: Math.max(0, e.hp + mechanicalEffect.delta) } : e)
      .filter(e => e.hp > 0);
  }

  // Compute visible tile set once — reused for both enemy and POI filtering.
  const visibleForChips = new Set<string>();
  if (gmTilesCand.length > 0) {
    for (const tile of getActorVisibleTiles(gmTilesCand, candidatePlayerPos.x, candidatePlayerPos.y)) {
      visibleForChips.add(tile);
    }
  }

  // Filter enemies to those with LoS from the player.
  if (gmTilesCand.length > 0) {
    const before = candidateEnemies.length;
    candidateEnemies = candidateEnemies.filter(e => visibleForChips.has(`${e.x},${e.y}`));
    if (candidateEnemies.length < before) {
      console.log(`[autoAdvance] chip visibility filter: ${before} → ${candidateEnemies.length} enemies`);
    }
  }

  // Filter POIs to those visible. For each out-of-LoS POI, walk the Bresenham
  // path and collect the first blocking door as a substitute candidate.
  const allPois = (mapData.pois ?? []) as { name: string; x: number; y: number }[];
  let candidatePois: { name: string; x: number; y: number }[];
  if (gmTilesCand.length > 0) {
    candidatePois = allPois.filter(p => visibleForChips.has(`${p.x},${p.y}`));
    const doorCandidates = new Map<string, { name: string; x: number; y: number }>();
    for (const poi of allPois) {
      if (visibleForChips.has(`${poi.x},${poi.y}`)) continue;
      // Walk Bresenham path from player to POI; stop at first door or wall.
      let x = candidatePlayerPos.x, y = candidatePlayerPos.y;
      const dx = Math.abs(poi.x - x), dy = Math.abs(poi.y - y);
      const sx = x < poi.x ? 1 : -1, sy = y < poi.y ? 1 : -1;
      let err = dx - dy;
      let found = false;
      while (!(x === poi.x && y === poi.y)) {
        const tile = gmTilesCand[y]?.[x];
        if (!tile) break;
        if ((x !== candidatePlayerPos.x || y !== candidatePlayerPos.y) && tile.t === "D") {
          doorCandidates.set(`${x},${y}`, { name: "Door", x, y });
          found = true; break;
        }
        if ((x !== candidatePlayerPos.x || y !== candidatePlayerPos.y) && tile.t === "W") break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx)  { err += dx; y += sy; }
      }
      if (!found) {
        // No door on direct path — check adjacent tiles around the POI for a nearby door.
        for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
          const nx = poi.x + ddx, ny = poi.y + ddy;
          if (gmTilesCand[ny]?.[nx]?.t === "D") {
            doorCandidates.set(`${nx},${ny}`, { name: "Door", x: nx, y: ny });
          }
        }
      }
    }
    candidatePois = [...candidatePois, ...doorCandidates.values()];
  } else {
    candidatePois = allPois;
  }

  const chipBuildInput = {
    playerPos:             candidatePlayerPos,
    enemies:               candidateEnemies,
    weaponRangeFeet:       (currentChar.mainHand as any)?.rangeFeet ?? 5,
    remainingMovementFeet: currentChar.remainingMovementFeet ?? 30,
    mapTiles:              gmStringTilesCand,
    pois:                  candidatePois,
  };
  console.log("[autoAdvance] buildChipCandidates input", {
    playerPos:             chipBuildInput.playerPos,
    enemyCount:            chipBuildInput.enemies.length,
    enemies:               chipBuildInput.enemies.map(e => ({ id: e.id, name: e.name, hp: e.hp, x: e.x, y: e.y })),
    weaponRangeFeet:       chipBuildInput.weaponRangeFeet,
    remainingMovementFeet: chipBuildInput.remainingMovementFeet,
    hasTileMap:            !!chipBuildInput.mapTiles,
  });
  const candidates = buildChipCandidates(chipBuildInput);
  console.log("[autoAdvance] buildChipCandidates output", candidates.map(c => ({ action_type: c.action_type, targetName: c.targetName, requiresMovement: c.requiresMovement, movementFeet: c.movementFeet })));

  const staticCtx  = buildStaticContext(currentChar, game.partyMembers, game.story, game.currentAct, game.currentScene, mapData, combatInfo);
  const dynamicCtx = buildDynamicContext(
    game.worldState as Record<string, any> | null,
    gameState,
    currentChar,
    game.partyMembers,
    currentCharId,
    chipLabel,
    rolls,
    consecutiveMisses,
    gameState.lastEncounterCompleted === true,
    ((gmData.items ?? []) as { itemId: string; posX: number; posY: number; isPickedUp: boolean; isVisible: boolean }[])
      .filter(i => !i.isPickedUp && i.isVisible)
      .map(i => ({ id: i.itemId, name: i.itemId, type: "", isEquipped: false, posX: i.posX, posY: i.posY })),
    gmStringTilesCand,
    hiddenEnemyIds,
    dbEnemies,
    endPosition,
    mechanicalAttack,
  );
  console.log("[autoAdvance] prompt lengths — static:", staticCtx.length, "dynamic:", dynamicCtx.length);
  const responseInstr = buildResponseInstruction();

  const recentMessages = game.messages.map((m) => ({
    role:    m.role === "PLAYER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
  if (recentMessages.length === 0 || recentMessages[0].role === "assistant") {
    recentMessages.unshift({ role: "user", content: "The adventure begins." });
  }
  recentMessages.push({ role: "user", content: `Player action: ${chipLabel}` });
  // Prefill the first character of the assistant's response to guarantee JSON output.
  recentMessages.push({ role: "assistant", content: "{" });

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system: [
        { type: "text", text: staticCtx,    cache_control: { type: "ephemeral" } },
        { type: "text", text: `${dynamicCtx}\n\n${responseInstr}` },
      ],
      messages: recentMessages,
    });
    const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    // Prepend the prefill character so the full JSON object can be parsed.
    rawText = "{" + (block?.text ?? "");
  } catch (err: any) {
    console.error("autoAdvance AI error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  console.log("[autoAdvance] raw Claude response:", rawText.slice(0, 800));

  // ── Parse Claude response ─────────────────────────────────────────────────
  let parsed: {
    narrative:      string;
    stateDeltas:    Record<string, any>;
    encounterResult:"completed" | null;
  };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    const candidate = match?.[0] ?? rawText;
    // Repair common AI JSON mistakes: trailing commas and missing commas between array elements.
    const repaired = candidate
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([}\]])\s*\n(\s*[{[])/g, '$1,\n$2');
    parsed = JSON.parse(repaired);
  } catch (parseErr) {
    console.error("[autoAdvance] JSON parse failed:", parseErr, "\nrawText:", rawText.slice(0, 800));
    parsed = {
      narrative:       "The immediate danger passes. You take stock of your surroundings and consider your next move.",
      stateDeltas:     {},
      encounterResult: null,
    };
  }

  const actorCurrentPos: { x: number; y: number } = (() => {
    const m = game.partyMembers.find((m: any) => m.characterId === currentCharId);
    if (m) return { x: m.posX, y: m.posY };
    return (gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
  })();

  const weaponRangeFeet = (currentChar.mainHand as any)?.rangeFeet ?? 5;
  const chips = candidatesToChips(candidates, weaponRangeFeet, actorCurrentPos);
  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "The immediate danger passes. You take stock of your surroundings.";

  // ── Combat effects ────────────────────────────────────────────────────────
  // Merge mechanical attack effect (from dice rolls) with any AI-emitted tags.
  // Filter out AI tags for the mechanical attack target to prevent double-counting.
  const aiEffects = parseCombatEffects(rawText);
  const rawEffects = mechanicalEffect
    ? [mechanicalEffect, ...aiEffects.filter(e => e.targetId !== mechanicalEffect!.targetId)]
    : aiEffects;
  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];

  // ── XP / level-up ────────────────────────────────────────────────────────
  const encounterCompleted = parsed.encounterResult === "completed";
  const xpAwarded   = encounterCompleted ? (XP_BY_DIFFICULTY[game.story?.difficulty ?? "Standard"] ?? 0) : 0;
  const currentXp   = (currentChar.xp ?? 0) + xpAwarded;
  const previousLevel = currentChar.level ?? 1;
  const newLevel    = computeLevel(currentXp);
  const didLevelUp  = newLevel > previousLevel;

  // ── State delta application ───────────────────────────────────────────────
  const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
  const newState: Record<string, any> = {
    ...gameState,
    consecutiveMisses,
    sceneTurnCount: ((gameState.sceneTurnCount as number | undefined) ?? 0) + 1,
  };
  const deltas = { ...(parsed.stateDeltas ?? {}) };
  for (const key of RULES_ENGINE_KEYS) delete deltas[key];

  // Discard playerPos if coordinates are not valid integers within map bounds.
  if (deltas.playerPos !== undefined) {
    const p = deltas.playerPos as any;
    const w = (mapData.width  as number) ?? 999;
    const h = (mapData.height as number) ?? 999;
    const valid =
      typeof p?.x === "number" && Number.isInteger(p.x) && p.x >= 0 && p.x < w &&
      typeof p?.y === "number" && Number.isInteger(p.y) && p.y >= 0 && p.y < h;
    console.log("[autoAdvance] playerPos delta:", JSON.stringify(p), "valid:", valid, "bounds:", { w, h });
    if (!valid) delete deltas.playerPos;
  } else {
    console.log("[autoAdvance] no playerPos in stateDeltas. action:", chipLabel, "stateDeltas keys:", Object.keys(parsed.stateDeltas ?? {}));
  }

  // Capture position before deletion so D5 transaction write has the value.
  // endPosition (from chip) is authoritative fallback when AI omits playerPos.
  if (!deltas.playerPos && endPosition) {
    const w = (mapData.width  as number) ?? 999;
    const h = (mapData.height as number) ?? 999;
    if (endPosition.x >= 0 && endPosition.x < w && endPosition.y >= 0 && endPosition.y < h) {
      deltas.playerPos = endPosition;
      console.log("[autoAdvance] using chip endPosition as playerPos fallback:", endPosition);
    }
  }
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
  Object.assign(newState, deltas);

  // Compute enemy hp from DB (dice-authoritative) + rawEffects delta. Never trust AI-authored hp.
  // Always base the enemy list on prev canonical state — AI stateDeltas.enemies may carry fake IDs.
  if (Array.isArray(newState.enemies)) {
    const aiEnemies      = newState.enemies as any[];
    const prevEnemies    = (gameState.enemies as any[] | undefined) ?? [];
    const dbEnemyMap     = new Map((dbEnemies ?? []).map(e => [e.id, e]));
    const effectDeltaMap = new Map(rawEffects.map(e => [e.targetId, e.delta]));
    const base = prevEnemies.length > 0 ? prevEnemies : aiEnemies;
    newState.enemies = base.map((e: any) => {
      const db     = dbEnemyMap.get(e.id);
      const maxHp  = e.maxHp ?? db?.maxHp;
      const baseHp = db?.currentHp ?? e.hp;
      const hp = baseHp !== undefined
        ? clampHp(baseHp, effectDeltaMap.get(e.id) ?? 0, maxHp ?? baseHp)
        : e.hp;
      // Only accept AI position updates when the ID matches exactly.
      // Name-match is unreliable: two "Cellar Rat" entries can have different IDs/positions.
      const aiById  = aiEnemies.find((ae: any) => ae.id === e.id);
      return {
        ...e,
        hp,
        maxHp,
        x: aiById?.x ?? e.x ?? db?.posX,
        y: aiById?.y ?? e.y ?? db?.posY,
      };
    });
  }

  if (didLevelUp) {
    newState.levelUpNote = `${currentChar.name} advanced to Level ${newLevel} this turn.`;
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

  // ── Turn rotation ─────────────────────────────────────────────────────────
  let nextCharId = currentCharId;
  if (game.partyMembers.length > 1) {
    const sorted  = [...game.partyMembers].sort((a, b) => a.turnOrder - b.turnOrder);
    const curIdx  = sorted.findIndex((m) => m.characterId === currentCharId);
    nextCharId    = sorted[(curIdx + 1) % sorted.length].characterId;
  }

  // ── worldState for dedicated column (Phase D will fully migrate reads here) ─
  const worldState = {
    activeObjective:   newState.activeObjective   ?? gameState.activeObjective,
    plotFlags:         newState.plotFlags          ?? gameState.plotFlags          ?? [],
    consecutiveMisses,
    npcsEncountered:   newState.npcsEncountered    ?? gameState.npcsEncountered    ?? [],
  };

  // ── Atomic transaction ────────────────────────────────────────────────────
  const sceneIdForMessages = game.currentSceneId;
  let committedMaxHp = currentChar.maxHp;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
      if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");


      if (xpAwarded > 0 || didLevelUp) {
        committedMaxHp = didLevelUp
          ? maxHpAtLevel(currentChar.characterClass, currentChar.baseConstitution, newLevel)
          : currentChar.maxHp;
        await tx.character.update({
          where: { id: currentCharId },
          data:  { xp: currentXp, level: newLevel, maxHp: committedMaxHp },
        });
      }

      // Resolve combat HP deltas — route to character OR GameMap.data.enemies for enemies.
      if (rawEffects.length > 0) {
        const ids   = [...new Set(rawEffects.map((e) => e.targetId))];
        const chars = await tx.character.findMany({ where: { id: { in: ids } }, select: { id: true, currentHp: true, maxHp: true } });
        const charIds = new Set(chars.map((c) => c.id));
        const charMap = new Map(chars.map((c) => [c.id, c]));

        // Load live GameMap data for enemy HP
        const liveGM = activeGameMap
          ? await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } })
          : null;
        const liveGMEnemyState = ((liveGM?.data as any)?.enemyState ?? {}) as Record<string, EnemyInstance>;
        const dbEnemyHpMap = new Map((dbEnemies ?? []).map(e => [e.id, e]));
        const enemyIds = new Set(ids.filter(id => !charIds.has(id) && (id in liveGMEnemyState || dbEnemyHpMap.has(id))));
        console.log("[autoAdvance] tx enemy filter:", {
          rawEffectIds:       ids,
          charIds:            [...charIds],
          liveGMEnemyStateKeys: Object.keys(liveGMEnemyState),
          dbEnemyHpMapKeys:   [...dbEnemyHpMap.keys()],
          enemyIdsResolved:   [...enemyIds],
        });

        resolvedEffects = rawEffects
          .filter((e) => charIds.has(e.targetId) || enemyIds.has(e.targetId))
          .map((e) => {
            if (charIds.has(e.targetId)) {
              const actor = charMap.get(e.targetId)!;
              return { ...e, newHp: clampHp(actor.currentHp, e.delta, actor.maxHp) };
            }
            const gmes = liveGMEnemyState[e.targetId];
            const dbe  = dbEnemyHpMap.get(e.targetId);
            const currentHp = gmes?.currentHp ?? dbe?.currentHp ?? 0;
            const maxHp     = gmes?.maxHp     ?? dbe?.maxHp     ?? currentHp;
            return { ...e, newHp: clampHp(currentHp, e.delta, maxHp) };
          });

        // Parallel character HP updates + single batched GameMap enemyState update.
        const charEffects  = resolvedEffects.filter(e => charIds.has(e.targetId));
        const enemyEffects = resolvedEffects.filter(e => enemyIds.has(e.targetId));
        await Promise.all(charEffects.map(eff =>
          tx.character.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } })
        ));
        if (liveGM && enemyEffects.length > 0) {
          const hpChanges = new Map(enemyEffects.map(e => [e.targetId, e.newHp]));
          const updatedEnemyState = { ...liveGMEnemyState };
          for (const [enemyId, newHp] of hpChanges) {
            const existing = updatedEnemyState[enemyId];
            if (existing) {
              updatedEnemyState[enemyId] = { ...existing, currentHp: newHp, status: newHp <= 0 ? "DEFEATED" : existing.status };
            } else {
              const dbe = dbEnemyHpMap.get(enemyId);
              if (dbe) {
                updatedEnemyState[enemyId] = { currentHp: newHp, maxHp: dbe.maxHp, status: newHp <= 0 ? "DEFEATED" : "ACTIVE", isHiding: false, stealthRoll: 0, hasReaction: true, isSurprised: false, lootItemIds: [] };
              }
            }
          }
          // Clear defeated enemies from tiles
          let updatedTiles = ((liveGM.data as any)?.tiles ?? []) as GameTile[][];
          let tilesChanged = false;
          for (const [enemyId, newHp] of hpChanges) {
            if (newHp <= 0 && updatedTiles.length > 0) {
              const pos = findActor(updatedTiles, enemyId);
              if (pos) {
                updatedTiles = updatedTiles.map((row, ry) =>
                  row.map((tile, rx) => {
                    if (rx === pos.x && ry === pos.y && tile.actor?.id === enemyId) {
                      const { actor: _a, ...rest } = tile;
                      return rest as GameTile;
                    }
                    return tile;
                  }),
                );
                tilesChanged = true;
              }
            }
          }
          await tx.gameMap.update({
            where: { id: liveGM.id },
            data: { data: { ...(liveGM.data as any), enemyState: updatedEnemyState, ...(tilesChanged ? { tiles: updatedTiles } : {}) } },
          });
        }
      }

      // Activate DORMANT enemies that have LoS to the player's current position.
      if (activeGameMap && gmStringTilesCand) {
        const playerPosNow = newPlayerPos ?? actorCurrentPos;
        const activationGM = await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } });
        if (activationGM) {
          const activationEnemyState = { ...((activationGM.data as any).enemyState ?? {}) } as Record<string, EnemyInstance>;
          const activationTiles = ((activationGM.data as any).tiles ?? []) as GameTile[][];
          let anyActivated = false;
          for (const [eid, est] of Object.entries(activationEnemyState)) {
            if (est.status !== "DORMANT") continue;
            const pos = findActor(activationTiles, eid);
            if (!pos) continue;
            if (lineOfSight(playerPosNow, pos, gmStringTilesCand)) {
              activationEnemyState[eid] = { ...est, status: "ACTIVE" };
              anyActivated = true;
              console.log(`[auto-advance] activated enemy ${eid} @ (${pos.x},${pos.y}) — has LoS to player @ (${playerPosNow.x},${playerPosNow.y})`);
            }
          }
          if (anyActivated) {
            await tx.gameMap.update({
              where: { id: activationGM.id },
              data:  { data: { ...(activationGM.data as any), enemyState: activationEnemyState } },
            });
          }
        }
      }

      await tx.game.update({
        where: { id: gameId },
        data: {
          state:                 newState,
          worldState,
          narrativeHistory:      { push: narrative },
          activeSuggestionChips: chips as any,
          currentTurnCharacterId:nextCharId,
          version:               { increment: 1 },
        },
      });

      // D5: write PartyMember.posX/posY for party games
      if (newPlayerPos) {
        const callerRecord = game.partyMembers.find((m) => m.characterId === currentCharId);
        if (callerRecord) {
          await tx.partyMember.update({
            where: { id: callerRecord.id },
            data:  { posX: newPlayerPos.x, posY: newPlayerPos.y },
          });
        }
      }

      // POI interact effect — apply mapUpdate tile changes from interactEffect when player uses a door/POI.
      // Only accepts "D"→"F" (open door) and "?"→"F" (reveal) transitions to prevent AI map abuse.
      if (activeGameMap && newState.mapUpdate) {
        const changes = newState.mapUpdate as Array<{ x: number; y: number; tile: string }>;
        delete newState.mapUpdate;
        const gmForMap = await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } });
        if (gmForMap) {
          const tiles = (gmForMap.data as any).tiles as Array<Array<{ t: string; [k: string]: any }>>;
          let changed = false;
          for (const c of changes) {
            const cell = tiles[c.y]?.[c.x];
            if (cell && (cell.t === "D" || cell.t === "?") && c.tile === "F") {
              tiles[c.y][c.x] = { ...cell, t: "F" };
              changed = true;
            }
          }
          if (changed) {
            await tx.gameMap.update({ where: { id: gmForMap.id }, data: { data: { ...(gmForMap.data as any), tiles } } });
          }
        }
      }

      // Item pickup — triggered when the chip carried an itemId.
      if (itemId) {
        const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, type: true } });
        const gmForPickup = activeGameMap
          ? await tx.gameMap.findUnique({ where: { id: activeGameMap.id }, select: { id: true, data: true } })
          : null;
        const gmPickupItemState = ((gmForPickup?.data as any)?.itemState ?? {}) as Record<string, { isPickedUp: boolean; [k: string]: any }>;
        const gmItemState = gmPickupItemState[itemId];
        if (item && gmItemState && !gmItemState.isPickedUp) {
          // Mark picked up in GameMap.data itemState and remove from tile
          const updatedItemState = { ...gmPickupItemState, [itemId]: { ...gmItemState, isPickedUp: true } };
          let updatedPickupTiles = ((gmForPickup?.data as any)?.tiles ?? []) as GameTile[][];
          if (updatedPickupTiles.length > 0) {
            const itemPos = updatedPickupTiles.flatMap((row, y) => row.map((t, x) => t.item === itemId ? { x, y } : null)).find(Boolean);
            if (itemPos) {
              updatedPickupTiles = updatedPickupTiles.map((row, ry) =>
                row.map((tile, rx) => {
                  if (rx === itemPos.x && ry === itemPos.y) { const { item: _i, ...rest } = tile; return rest as GameTile; }
                  return tile;
                }),
              );
            }
          }
          if (gmForPickup) {
            await tx.gameMap.update({ where: { id: gmForPickup.id }, data: { data: { ...(gmForPickup.data as any), itemState: updatedItemState, tiles: updatedPickupTiles } } });
          }

          const EQUIPPABLE: Record<string, "mainHandId" | "offHandId" | "armorId" | "ringId"> = {
            WEAPON: "mainHandId",
            SHIELD: "offHandId",
            ARMOR:  "armorId",
            RING:   "ringId",
            FOCUS:  "offHandId",
          };
          const slotField = EQUIPPABLE[item.type ?? ""];
          const char = await tx.character.findUnique({
            where:  { id: currentCharId },
            select: { mainHandId: true, offHandId: true, armorId: true, ringId: true, backpack: true },
          });
          if (char) {
            if (slotField && !char[slotField]) {
              // Slot is open — equip directly.
              await tx.character.update({ where: { id: currentCharId }, data: { [slotField]: itemId } });
            } else {
              // No open slot (or not equippable) — put in backpack.
              await tx.character.update({
                where: { id: currentCharId },
                data:  { backpack: { push: itemId } },
              });
            }
          }
        }
      }

      // Purge completed queue row.
      await tx.activeTurnQueue.delete({ where: { id: turnId } });

    }, { timeout: 15000 });
  } catch (err: any) {
    if (err.message === "STALE_TURN") return { success: false, error: "STALE_TURN" };
    throw err;
  }

  // Messages written outside the transaction — they don't need ACID with state.
  await prisma.message.create({ data: { gameId, role: "PLAYER", content: chipLabel, sceneId: sceneIdForMessages } });
  await prisma.message.create({
    data: { gameId, role: "DUNGEON_MASTER", content: narrative, chips: chips as any, sceneId: sceneIdForMessages },
  });

  // Mechanical scene advancement — runs after main transaction so HP and position are visible.
  if (game.currentScene) {
    const callerRecord = game.partyMembers.find((m: any) => m.characterId === currentCharId);
    const resolvedPos = newPlayerPos ?? actorCurrentPos;
    const { triggered, nextScene } = await checkSceneTrigger(prisma, game.currentScene, {
      gameId,
      currentActId:   (game as any).currentActId ?? null,
      activeCharId:   currentCharId,
      isPartyGame:    game.partyMembers.length > 1,
      callerMemberId: callerRecord?.id,
      sceneTurnCount: newState.sceneTurnCount as number,
      callerPos:      resolvedPos,
    });
    if (triggered && nextScene) {
      newState.sceneTurnCount = 0;
      const nextGMEnemyState = (gmData.enemyState ?? {}) as Record<string, EnemyInstance>;
      const nextGMTiles      = (gmData.tiles ?? []) as GameTile[][];
      const validNextSceneIds = nextGMTiles.length > 0 ? Object.keys(nextGMEnemyState) : null;
      const nextSceneEnemyTemplates = await prisma.enemy.findMany({
        where:  { sceneId: nextScene.id, ...(validNextSceneIds ? { id: { in: validNextSceneIds } } : {}) },
        select: { id: true, name: true, maxHp: true },
      });
      newState.enemies = nextSceneEnemyTemplates.map((e: { id: string; name: string; maxHp: number }) => {
        const st  = nextGMEnemyState[e.id];
        const pos = nextGMTiles.length > 0 ? findActor(nextGMTiles, e.id) : null;
        return { id: e.id, name: e.name, hp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, x: pos?.x ?? 0, y: pos?.y ?? 0 };
      });
      console.log(`[scene-advance] game=${gameId} → "${nextScene.title}"`);
      await prisma.game.update({
        where: { id: gameId },
        data:  { currentSceneId: nextScene.id, state: newState },
      });
    }
  }

  // Act transition via stairs — fires when the player steps onto a "^" POI
  // and no further scenes remain in the current act (i.e. this is the last scene).
  if (newPlayerPos && game.currentAct && game.currentScene) {
    const pois = (mapData.pois as Array<{ symbol: string; x: number; y: number }> | undefined) ?? [];
    const onStairs = pois.some(p => p.symbol === "^" && p.x === newPlayerPos.x && p.y === newPlayerPos.y);
    if (onStairs) {
      const nextSceneInAct = await prisma.scene.findFirst({
        where:  { actId: (game.currentScene as any).actId, order: (game.currentScene as any).order + 1 },
        select: { id: true },
      });
      if (!nextSceneInAct) {
        const nextAct = await (prisma as any).act.findFirst({
          where:  { storyId: (game.currentAct as any).storyId, order: (game.currentAct as any).order + 1 },
          select: { id: true, title: true },
        });
        if (nextAct) {
          const firstScene = await prisma.scene.findFirst({ where: { actId: nextAct.id, order: 1 } });
          if (firstScene) {
            const nextGM = await createGameMap(gameId, nextAct.id);
            const nextActGMData    = (nextGM.data as any) as GameMapData;
            const nextActEnemySt   = (nextActGMData.enemyState ?? {}) as Record<string, EnemyInstance>;
            const nextActTiles     = (nextActGMData.tiles ?? []) as GameTile[][];
            const validActIds      = nextActTiles.length > 0 ? Object.keys(nextActEnemySt) : null;
            const nextEnemyTemplates = await prisma.enemy.findMany({
              where:  { sceneId: firstScene.id, ...(validActIds ? { id: { in: validActIds } } : {}) },
              select: { id: true, name: true, maxHp: true },
            });
            newState.playerPos      = nextActGMData.playerStart ?? { x: 0, y: 0 };
            newState.sceneTurnCount = 0;
            newState.enemies = nextEnemyTemplates.map((e: { id: string; name: string; maxHp: number }) => {
              const st  = nextActEnemySt[e.id];
              const pos = nextActTiles.length > 0 ? findActor(nextActTiles, e.id) : null;
              return { id: e.id, name: e.name, hp: st?.currentHp ?? e.maxHp, maxHp: st?.maxHp ?? e.maxHp, x: pos?.x ?? 0, y: pos?.y ?? 0 };
            });
            await prisma.game.update({
              where: { id: gameId },
              data:  { currentActId: nextAct.id, currentSceneId: firstScene.id, state: newState },
            });
            await prisma.character.update({
              where: { id: currentCharId },
              data:  { posX: newState.playerPos.x, posY: newState.playerPos.y },
            });
            if (game.partyMembers.length > 1) {
              const callerRecord2 = game.partyMembers.find((m: any) => m.characterId === currentCharId);
              if (callerRecord2) {
                await prisma.partyMember.update({
                  where: { id: callerRecord2.id },
                  data:  { posX: newState.playerPos.x, posY: newState.playerPos.y },
                });
              }
            }
            console.log(`[act-advance] game=${gameId} → act "${nextAct.title}"`);
          }
        }
      }
    }
  }

  // After player turn commits, run consecutive NPC turns if combat is still active.
  const sessionAfter = await prisma.combatSession.findUnique({ where: { gameId } });
  let npcNarrative: string | undefined;
  let npcCombatEffects: { targetId: string; delta: number; type: string; newHp: number }[] | undefined;
  let actionsReset: boolean | undefined;
  if (sessionAfter) {
    try {
      const npcResult = await processNpcTurns(gameId);
      if (npcResult.narrative) npcNarrative = npcResult.narrative;
      if (npcResult.combatEffects.length > 0) npcCombatEffects = npcResult.combatEffects;
      if (npcResult.actionsReset) actionsReset = true;
    } catch (npcErr: any) {
      console.error("[autoAdvance] processNpcTurns failed:", npcErr?.message ?? npcErr);
    }
  }

  return {
    success:          true,
    narrative,
    chips,
    newState,
    combatEffects:    resolvedEffects.length > 0 ? resolvedEffects : undefined,
    npcNarrative,
    npcCombatEffects,
    actionsReset,
    levelUpResult: didLevelUp ? {
      oldLevel:         previousLevel,
      newLevel,
      oldMaxHp:         currentChar.maxHp,
      newMaxHp:         committedMaxHp,
      proficiencyBonus: proficiencyBonus(newLevel),
    } : undefined,
  };
}
