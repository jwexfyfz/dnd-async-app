"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { DM_MODEL, DM_MAX_TOKENS } from "../../lib/ai-config";
import { clampHp } from "../../lib/combat-effect";
import { abilityModifier } from "../../lib/dice";
import { computeCaps } from "../../lib/turn-caps";
import type { InitiativeSlot } from "../../lib/initiative";
import { lineOfSight } from "../../lib/grid";
import type { GameTile } from "../../lib/tile-types";
import { tilesToStringGrid } from "../../lib/game-map-utils";
import { getActorVisibleTiles, debugLogVisibilityGrid } from "../../lib/visibility";

const anthropic = new Anthropic({ maxRetries: 4 });

export interface NpcBatchResult {
  narrative:      string;
  combatEffects:  { targetId: string; delta: number; type: string; newHp: number }[];
  sessionDeleted: boolean;
  actionsReset:   boolean;
}

function rollDamageDice(formula: string): number {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 1;
  let total = 0;
  for (let i = 0; i < parseInt(m[1]); i++) {
    total += Math.ceil(Math.random() * parseInt(m[2]));
  }
  if (m[3]) total += parseInt(m[3]);
  return Math.max(1, total);
}

interface AttackOutcome {
  npcId:      string;
  npcName:    string;
  targetId:   string;
  targetName: string;
  roll:       number;
  bonus:      number;
  total:      number;
  ac:         number;
  hit:        boolean;
  damage:     number;
}

function buildNpcPrompt(
  npcBatch:    { enemy: { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number }; hasReaction: boolean }[],
  livingChars: { id: string; name: string; currentHp: number; maxHp: number; posX: number; posY: number; ac: number; isHiding: boolean }[],
  attacks:     AttackOutcome[],
  mapData:     Record<string, any>,
  roundNumber: number,
  mapTiles?:   string[][],
): string {
  const rooms = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";

  const npcLines = npcBatch.map(({ enemy, hasReaction }) =>
    `${enemy.name}[HP:${enemy.currentHp}/${enemy.maxHp},Pos:${enemy.posX},${enemy.posY},Speed:30ft,Actions:1,Reaction:${hasReaction}]`
  ).join("\n");

  // LoS-filtered and hidden-player-masked targets
  const visibleTargets = livingChars.filter(c => {
    if (c.isHiding) return false;
    if (!mapTiles)  return true;
    return npcBatch.some(({ enemy }) =>
      lineOfSight({ x: enemy.posX, y: enemy.posY }, { x: c.posX, y: c.posY }, mapTiles),
    );
  });

  const charLines = visibleTargets.length > 0
    ? visibleTargets.map(c =>
        `${c.name}[id:${c.id},HP:${c.currentHp}/${c.maxHp},Pos:${c.posX},${c.posY}]`
      ).join("\n")
    : "none";

  const battleResults = attacks.length > 0
    ? attacks.map((a, i) => a.hit
        ? `${i + 1}. ${a.npcName} → ${a.targetName}: HIT (${a.roll}+${a.bonus}=${a.total} vs AC ${a.ac}) — ${a.damage} damage`
        : `${i + 1}. ${a.npcName} → ${a.targetName}: MISS (${a.roll}+${a.bonus}=${a.total} vs AC ${a.ac})`
      ).join("\n")
    : "All NPCs pass their turns this round.";

  return `You are a Dungeon Master narrating NPC combat turns in D&D 5e. Round ${roundNumber}.
Write 2–4 sentences of vivid, present-tense narration for all NPC actions below.
Name enemies, describe attacks making contact or glancing off. No vague filler.

MAP: ${mapData.name ?? "Unknown"} — Rooms: ${rooms}

NPC ACTORS:
${npcLines}

PLAYER TARGETS:
${charLines}

BATTLE RESULTS — narrate EXACTLY these outcomes, no invented dice:
${battleResults}

Reply with one JSON object only (no markdown fences):
{"narrative":"2–4 sentences, present tense","encounterResult":null}

For each HIT above, append one tag after the JSON closing brace:
<combat_effect target_id="CHAR_ID" delta="-N" type="damage" />
Do not emit tags for misses.`;
}

export async function processNpcTurns(gameId: string): Promise<NpcBatchResult> {
  const combatSession = await prisma.combatSession.findUnique({ where: { gameId } });
  if (!combatSession) return { narrative: "", combatEffects: [], sessionDeleted: false, actionsReset: false };

  const order = combatSession.initiativeOrder as unknown as InitiativeSlot[];
  if (order.length === 0) return { narrative: "", combatEffects: [], sessionDeleted: false, actionsReset: false };

  // Preload all actors
  const enemyIds = order.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
  const charIds  = order.filter(s => s.actorType === "CHARACTER").map(s => s.actorId);

  const [enemyTemplates, characters, partyMembers, game] = await Promise.all([
    prisma.enemy.findMany({ where: { id: { in: enemyIds } }, select: { id: true, name: true, attackBonus: true, damageDice: true, maxHp: true } }),
    prisma.character.findMany({ where: { id: { in: charIds } } }),
    prisma.partyMember.findMany({ where: { gameId } }),
    prisma.game.findUnique({ where: { id: gameId }, select: { currentActId: true, currentSceneId: true } }),
  ]);

  const activeGM = game?.currentActId
    ? await prisma.gameMap.findUnique({
        where:  { gameId_actId: { gameId, actId: game.currentActId } },
        select: { id: true, data: true },
      })
    : null;
  const gmData = (activeGM?.data ?? {}) as Record<string, any>;
  const mapData = gmData;
  const gmEnemyState = (gmData.enemyState ?? {}) as Record<string, { currentHp: number; maxHp: number }>;
  const gmTilesNpc      = (gmData.tiles ?? []) as GameTile[][];
  const gmStringTilesNpc = gmTilesNpc.length > 0 ? tilesToStringGrid(gmTilesNpc) : null;
  // Build a position map by scanning tiles
  const tileActorPos = new Map<string, { posX: number; posY: number }>();
  for (let _y = 0; _y < gmTilesNpc.length; _y++) {
    for (let _x = 0; _x < gmTilesNpc[_y].length; _x++) {
      const act = gmTilesNpc[_y][_x].actor;
      if (act?.kind === "enemy") tileActorPos.set(act.id, { posX: _x, posY: _y });
    }
  }

  const enemies = enemyTemplates
    .filter(e => {
      const st = gmEnemyState[e.id];
      if (!st) return gmTilesNpc.length === 0; // no tilemap — include all DB enemies
      return st.status === "ACTIVE";            // tilemap present — only ACTIVE enemies act
    })
    .map(e => {
      const st  = gmEnemyState[e.id];
      const pos = tileActorPos.get(e.id);
      return { ...e, currentHp: st?.currentHp ?? e.maxHp, posX: pos?.posX ?? 0, posY: pos?.posY ?? 0 };
    });
  const enemyMap = new Map(enemies.map(e => [e.id, e]));
  const charMap  = new Map(characters.map(c => [c.id, c]));
  const pmMap    = new Map(partyMembers.map(pm => [pm.characterId, pm]));

  // Iterate forward from currentTurnIndex + 1, collecting consecutive NPCs
  const updatedOrder = order.map(s => ({ ...s }));
  let idx = combatSession.currentTurnIndex;
  let newRoundNumber = combatSession.currentRoundNumber;

  const npcBatch: { enemy: (typeof enemies)[0]; slotIdx: number; hasReaction: boolean }[] = [];
  let roundWrapped = false;

  for (let i = 0; i < order.length; i++) {
    const nextIdx = (idx + 1) % order.length;
    if (nextIdx < idx) {
      // Wrapped to round 0 — new round, reset reactions and flag for player resource reset
      newRoundNumber++;
      for (const slot of updatedOrder) slot.hasReaction = true;
      roundWrapped = true;
    }
    idx = nextIdx;
    const slot = updatedOrder[idx];

    if (slot.actorType === "CHARACTER") break; // Human player — stop

    // ENEMY slot
    const enemy = enemyMap.get(slot.actorId);
    if (!enemy || enemy.currentHp <= 0) continue; // Dead — skip

    // When a tile map exists, skip enemies with no tile position — their posX/posY
    // would default to (0,0), making every LoS check unreliable.
    if (gmTilesNpc.length > 0 && !tileActorPos.has(enemy.id)) {
      console.log(`[npc-turn] ${enemy.name} (id:${enemy.id}) has no tile position — skipping (orphaned slot)`);
      continue;
    }

    if (slot.isSurprised) {
      // Surprised — force-pass, consume surprise
      updatedOrder[idx].isSurprised = false;
      updatedOrder[idx].hasReaction = true;
      continue;
    }

    // Active NPC — accumulate in batch
    updatedOrder[idx].hasReaction = true;
    npcBatch.push({ enemy, slotIdx: idx, hasReaction: true });
  }

  const newTurnIndex = idx;

  if (gmTilesNpc.length > 0 && npcBatch.length > 0) {
    const partyMarkers: { x: number; y: number; char: string }[] = [];
    for (let _y = 0; _y < gmTilesNpc.length; _y++) {
      for (let _x = 0; _x < gmTilesNpc[_y].length; _x++) {
        if (gmTilesNpc[_y][_x].actor?.kind === "party") partyMarkers.push({ x: _x, y: _y, char: "P" });
      }
    }
    for (const { enemy } of npcBatch) {
      if (!tileActorPos.has(enemy.id)) continue;
      const npcVisSet = getActorVisibleTiles(gmTilesNpc, enemy.posX, enemy.posY);
      debugLogVisibilityGrid(gmTilesNpc, npcVisSet, enemy.posX, enemy.posY, `NPC ${enemy.name}`, partyMarkers);
    }
  }

  if (npcBatch.length === 0) {
    // If every enemy slot is orphaned (not ACTIVE, no tile position, or HP ≤ 0), end combat now.
    // Without this, orphaned enemies in initiativeOrder permanently block the session from closing.
    const allEnemiesGone = enemyIds.length > 0 && enemyIds.every(id => {
      const e = enemyMap.get(id);
      if (!e) return true;
      if (gmTilesNpc.length > 0 && !tileActorPos.has(id)) return true;
      return e.currentHp <= 0;
    });
    if (allEnemiesGone) {
      await prisma.combatSession.delete({ where: { gameId } });
      console.log(`[npc-turn] all enemies orphaned/dead — combat session ended for game ${gameId}`);
      return { narrative: "", combatEffects: [], sessionDeleted: true, actionsReset: false };
    }

    await prisma.$transaction(async (tx) => {
      await tx.combatSession.update({
        where: { gameId },
        data:  { initiativeOrder: updatedOrder, currentTurnIndex: newTurnIndex, currentRoundNumber: newRoundNumber },
      });
      if (roundWrapped) {
        for (const char of characters) {
          const { maxAction, maxBonusAction, maxMovementFeet } = computeCaps(char.characterClass, char.level);
          await tx.character.update({
            where: { id: char.id },
            data:  { remainingActions: maxAction, remainingBonusActions: maxBonusAction, remainingMovementFeet: maxMovementFeet },
          });
        }
        console.log(`[npc-turn] new round ${newRoundNumber} (empty batch) — reset actions/movement for: ${characters.map(c => c.name).join(", ")}`);
      }
    });
    return { narrative: "", combatEffects: [], sessionDeleted: false, actionsReset: false };
  }

  // Living characters as attack targets (prefer lowest HP)
  const livingChars = characters
    .filter(c => c.currentHp > 0)
    .map(c => {
      const pm = pmMap.get(c.id);
      return { id: c.id, name: c.name, currentHp: c.currentHp, maxHp: c.maxHp,
               posX: pm?.posX ?? c.posX, posY: pm?.posY ?? c.posY,
               ac: 10 + abilityModifier(c.baseDexterity),
               isHiding: pm?.isHiding ?? false };
    });

  // Pre-roll all NPC attacks in code — dice math is never delegated to AI
  const attacks: AttackOutcome[] = [];
  for (const { enemy } of npcBatch) {
    if (livingChars.length === 0) break;
    // Only attack characters visible to this enemy (LoS + not hiding)
    const visibleToEnemy = gmStringTilesNpc
      ? livingChars.filter(c => !c.isHiding && lineOfSight({ x: enemy.posX, y: enemy.posY }, { x: c.posX, y: c.posY }, gmStringTilesNpc))
      : livingChars.filter(c => !c.isHiding);
    if (visibleToEnemy.length === 0) {
      console.log(`[npc-turn] ${enemy.name} @ (${enemy.posX},${enemy.posY}) has no visible targets — skipping attack`);
      continue;
    }
    const target = visibleToEnemy.reduce((a, b) => a.currentHp <= b.currentHp ? a : b);
    const roll   = Math.ceil(Math.random() * 20);
    const total  = roll + enemy.attackBonus;
    const hit    = total >= target.ac;
    const damage = hit ? rollDamageDice(enemy.damageDice) : 0;
    const beforeHp = target.currentHp;
    const afterHp  = hit ? Math.max(0, beforeHp - damage) : beforeHp;
    attacks.push({ npcId: enemy.id, npcName: enemy.name, targetId: target.id, targetName: target.name,
                   roll, bonus: enemy.attackBonus, total, ac: target.ac, hit, damage });
    console.log(`[npc-turn] action: ${enemy.name} @ (${enemy.posX},${enemy.posY}) attacks ${target.name} @ (${target.posX},${target.posY})`);
    console.log(`[npc-turn] target: ${target.name} (id:${target.id}) @ (${target.posX},${target.posY})`);
    console.log(`[npc-turn] toHit roll: d20=${roll} + bonus=${enemy.attackBonus} = ${total}`);
    console.log(`[npc-turn] toHit DC: ${total} vs AC ${target.ac}`);
    console.log(`[npc-turn] toHit result: ${hit ? "HIT" : "MISS"}`);
    if (hit) {
      console.log(`[npc-turn] damage formula: ${enemy.damageDice}`);
      console.log(`[npc-turn] damage result: ${damage}`);
      console.log(`[npc-turn] ${target.name} HP before: ${beforeHp}`);
      console.log(`[npc-turn] ${target.name} HP after: ${afterHp}`);
      // Update currentHp in livingChars so subsequent attacks this batch see the correct HP
      target.currentHp = afterHp;
    }
  }

  // Build one-shot AI prompt via dedicated builder
  const systemPrompt = buildNpcPrompt(
    npcBatch,
    livingChars,
    attacks,
    mapData,
    newRoundNumber,
    gmStringTilesNpc ?? undefined,
  );

  let rawText = "";
  try {
    const resp = await anthropic.messages.create({
      model: DM_MODEL, max_tokens: DM_MAX_TOKENS,
      messages: [{ role: "user", content: systemPrompt }],
    });
    const block = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    rawText = block?.text ?? "";
  } catch (err: any) {
    console.error("[processNpcTurns] AI error:", err.message);
    rawText = JSON.stringify({ narrative: attacks.length > 0 ? attacks.map(a => a.hit ? `${a.npcName} hits ${a.targetName} for ${a.damage}.` : `${a.npcName} misses ${a.targetName}.`).join(" ") : "The enemies hold their ground.", encounterResult: null });
  }

  let parsed: { narrative: string; encounterResult: "completed" | null } =
    { narrative: "The enemies press their assault.", encounterResult: null };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? rawText);
  } catch {
    parsed.narrative = rawText.slice(0, 500) || "The enemies act.";
  }

  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "The enemies act.";
  // Use code-rolled attack outcomes as the authoritative source of HP deltas.
  // AI-emitted combat_effect tags are unreliable — skip parseCombatEffects entirely.
  const rawEffects = attacks
    .filter(a => a.hit && a.damage > 0)
    .map(a => ({ targetId: a.targetId, delta: -a.damage, type: "damage" }));

  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];
  let sessionDeleted = false;

  await prisma.$transaction(async (tx) => {
    if (narrative) {
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: narrative, sceneId: game?.currentSceneId },
      });
    }

    // Apply HP changes — route to character OR GameMap.data.enemies for enemies
    if (rawEffects.length > 0) {
      const affectedIds   = [...new Set(rawEffects.map(e => e.targetId))];
      const affectedChars = await tx.character.findMany({ where: { id: { in: affectedIds } }, select: { id: true, currentHp: true, maxHp: true } });
      const charIds       = new Set(affectedChars.map(c => c.id));
      const charHpMap     = new Map(affectedChars.map(c => [c.id, c]));

      // Live GM data for enemy HP (re-read inside tx for consistency)
      const liveGM = activeGM
        ? await tx.gameMap.findUnique({ where: { id: activeGM.id }, select: { id: true, data: true } })
        : null;
      const liveGMEnemyState = ((liveGM?.data as any)?.enemyState ?? {}) as Record<string, { currentHp: number; maxHp: number; status?: string }>;
      const enemyIds2 = new Set(affectedIds.filter(id => !charIds.has(id) && id in liveGMEnemyState));

      resolvedEffects = rawEffects
        .filter(e => charIds.has(e.targetId) || enemyIds2.has(e.targetId))
        .map(e => {
          if (charIds.has(e.targetId)) {
            const actor = charHpMap.get(e.targetId)!;
            return { ...e, newHp: clampHp(actor.currentHp, e.delta, actor.maxHp) };
          }
          const gmes = liveGMEnemyState[e.targetId];
          return { ...e, newHp: clampHp(gmes.currentHp, e.delta, gmes.maxHp) };
        });

      for (const eff of resolvedEffects) {
        if (charIds.has(eff.targetId)) {
          await tx.character.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } });
        }
      }
      const enemyEffects = resolvedEffects.filter(e => !charIds.has(e.targetId));
      if (enemyEffects.length > 0 && liveGM) {
        const updatedEnemyState = { ...liveGMEnemyState };
        for (const eff of enemyEffects) {
          if (updatedEnemyState[eff.targetId]) {
            updatedEnemyState[eff.targetId] = { ...updatedEnemyState[eff.targetId], currentHp: eff.newHp };
          }
        }
        await tx.gameMap.update({ where: { id: liveGM.id }, data: { data: { ...(liveGM.data as any), enemyState: updatedEnemyState } } });
      }
    }

    // Combat-end check: all ENEMY slots dead + encounterResult = "completed"
    const encounterCompleted = parsed.encounterResult === "completed";
    const enemySlotIds = updatedOrder.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
    if (encounterCompleted && enemySlotIds.length > 0) {
      const hpOverrides = new Map(resolvedEffects.map(e => [e.targetId, e.newHp]));
      const liveGMForCheck = activeGM
        ? await tx.gameMap.findUnique({ where: { id: activeGM.id }, select: { data: true } })
        : null;
      const liveGMEnemyStateForCheck = ((liveGMForCheck?.data as any)?.enemyState ?? {}) as Record<string, { currentHp: number }>;
      const gmCheckMap = new Map(Object.entries(liveGMEnemyStateForCheck).map(([id, e]) => [id, e.currentHp]));
      const allDead = enemySlotIds.every(id => (hpOverrides.get(id) ?? gmCheckMap.get(id) ?? 0) <= 0);
      if (allDead) {
        await tx.combatSession.delete({ where: { gameId } });
        sessionDeleted = true;
      }
    }

    if (!sessionDeleted) {
      await tx.combatSession.update({
        where: { gameId },
        data:  { initiativeOrder: updatedOrder, currentTurnIndex: newTurnIndex, currentRoundNumber: newRoundNumber },
      });

      // Reset player action economy at the start of each new round.
      if (roundWrapped) {
        for (const char of characters) {
          const { maxAction, maxBonusAction, maxMovementFeet } = computeCaps(char.characterClass, char.level);
          await tx.character.update({
            where: { id: char.id },
            data:  { remainingActions: maxAction, remainingBonusActions: maxBonusAction, remainingMovementFeet: maxMovementFeet },
          });
        }
        console.log(`[npc-turn] new round ${newRoundNumber} — reset actions/movement for: ${characters.map(c => c.name).join(", ")}`);
      }

      // Log which actor's turn it now is
      const nextSlot = updatedOrder[newTurnIndex];
      const nextName = charMap.get(nextSlot?.actorId)?.name ?? enemyMap.get(nextSlot?.actorId)?.name ?? "Unknown";
      console.log(`[npc-turn] turn passed to: ${nextName} (id:${nextSlot?.actorId}, type:${nextSlot?.actorType})`);
    }

    await tx.game.update({ where: { id: gameId }, data: { version: { increment: 1 } } });
  });

  return { narrative, combatEffects: resolvedEffects, sessionDeleted, actionsReset: roundWrapped };
}
