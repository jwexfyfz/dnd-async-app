"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma";
import { DM_MODEL, DM_MAX_TOKENS } from "../../lib/ai-config";
import { parseCombatEffects, clampHp } from "../../lib/combat-effect";
import { abilityModifier } from "../../lib/dice";
import type { InitiativeSlot } from "../../lib/initiative";
import { lineOfSight } from "../../lib/grid";

const anthropic = new Anthropic({ maxRetries: 4 });

export interface NpcBatchResult {
  narrative:      string;
  combatEffects:  { targetId: string; delta: number; type: string; newHp: number }[];
  sessionDeleted: boolean;
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
  if (!combatSession) return { narrative: "", combatEffects: [], sessionDeleted: false };

  const order = combatSession.initiativeOrder as unknown as InitiativeSlot[];
  if (order.length === 0) return { narrative: "", combatEffects: [], sessionDeleted: false };

  // Preload all actors
  const enemyIds = order.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
  const charIds  = order.filter(s => s.actorType === "CHARACTER").map(s => s.actorId);

  const [enemies, characters, partyMembers, game] = await Promise.all([
    prisma.enemy.findMany({ where: { id: { in: enemyIds } } }),
    prisma.character.findMany({ where: { id: { in: charIds } } }),
    prisma.partyMember.findMany({ where: { gameId } }),
    prisma.game.findUnique({ where: { id: gameId }, select: { map: { select: { data: true } }, currentSceneId: true } }),
  ]);

  const mapData  = (game?.map?.data ?? {}) as Record<string, any>;
  const enemyMap = new Map(enemies.map(e => [e.id, e]));
  const charMap  = new Map(characters.map(c => [c.id, c]));
  const pmMap    = new Map(partyMembers.map(pm => [pm.characterId, pm]));

  // Iterate forward from currentTurnIndex + 1, collecting consecutive NPCs
  const updatedOrder = order.map(s => ({ ...s }));
  let idx = combatSession.currentTurnIndex;
  let newRoundNumber = combatSession.currentRoundNumber;

  const npcBatch: { enemy: (typeof enemies)[0]; slotIdx: number; hasReaction: boolean }[] = [];

  for (let i = 0; i < order.length; i++) {
    const nextIdx = (idx + 1) % order.length;
    if (nextIdx < idx) {
      // Wrapped to round 0 — new round, reset all reactions
      newRoundNumber++;
      for (const slot of updatedOrder) slot.hasReaction = true;
    }
    idx = nextIdx;
    const slot = updatedOrder[idx];

    if (slot.actorType === "CHARACTER") break; // Human player — stop

    // ENEMY slot
    const enemy = enemyMap.get(slot.actorId);
    if (!enemy || enemy.currentHp <= 0) continue; // Dead — skip

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

  if (npcBatch.length === 0) {
    await prisma.combatSession.update({
      where: { gameId },
      data:  { initiativeOrder: updatedOrder, currentTurnIndex: newTurnIndex, currentRoundNumber: newRoundNumber },
    });
    return { narrative: "", combatEffects: [], sessionDeleted: false };
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
    const target = livingChars.reduce((a, b) => a.currentHp <= b.currentHp ? a : b);
    const roll   = Math.ceil(Math.random() * 20);
    const total  = roll + enemy.attackBonus;
    const hit    = total >= target.ac;
    attacks.push({ npcId: enemy.id, npcName: enemy.name, targetId: target.id, targetName: target.name,
                   roll, bonus: enemy.attackBonus, total, ac: target.ac, hit,
                   damage: hit ? rollDamageDice(enemy.damageDice) : 0 });
  }

  // Build one-shot AI prompt via dedicated builder
  const systemPrompt = buildNpcPrompt(
    npcBatch,
    livingChars,
    attacks,
    mapData,
    newRoundNumber,
    mapData.tiles as string[][] | undefined,
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
  const rawEffects = parseCombatEffects(rawText);

  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];
  let sessionDeleted = false;

  await prisma.$transaction(async (tx) => {
    if (narrative) {
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: narrative, sceneId: game?.currentSceneId },
      });
    }

    // Apply HP changes — route to character OR enemy table
    if (rawEffects.length > 0) {
      const affectedIds = [...new Set(rawEffects.map(e => e.targetId))];
      const affectedChars   = await tx.character.findMany({ where: { id: { in: affectedIds } }, select: { id: true, currentHp: true, maxHp: true } });
      const affectedEnemies = await tx.enemy.findMany({ where: { id: { in: affectedIds } }, select: { id: true, currentHp: true, maxHp: true } });
      const charIds   = new Set(affectedChars.map(c => c.id));
      const enemyIds2 = new Set(affectedEnemies.map(e => e.id));
      const charHpMap  = new Map(affectedChars.map(c => [c.id, c]));
      const enemyHpMap = new Map(affectedEnemies.map(e => [e.id, e]));

      resolvedEffects = rawEffects
        .filter(e => charIds.has(e.targetId) || enemyIds2.has(e.targetId))
        .map(e => {
          const actor = charHpMap.get(e.targetId) ?? enemyHpMap.get(e.targetId)!;
          return { ...e, newHp: clampHp(actor.currentHp, e.delta, actor.maxHp) };
        });

      for (const eff of resolvedEffects) {
        if (charIds.has(eff.targetId)) {
          await tx.character.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } });
        } else {
          await tx.enemy.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } });
        }
      }
    }

    // Combat-end check: all ENEMY slots dead + encounterResult = "completed"
    const encounterCompleted = parsed.encounterResult === "completed";
    const enemySlotIds = updatedOrder.filter(s => s.actorType === "ENEMY").map(s => s.actorId);
    if (encounterCompleted && enemySlotIds.length > 0) {
      const hpOverrides = new Map(resolvedEffects.map(e => [e.targetId, e.newHp]));
      const enemyHps = await tx.enemy.findMany({ where: { id: { in: enemySlotIds } }, select: { id: true, currentHp: true } });
      const allDead  = enemyHps.every(e => (hpOverrides.get(e.id) ?? e.currentHp) <= 0);
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
    }

    await tx.game.update({ where: { id: gameId }, data: { version: { increment: 1 } } });
  });

  return { narrative, combatEffects: resolvedEffects, sessionDeleted };
}
