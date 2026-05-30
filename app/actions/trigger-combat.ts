"use server";

import { prisma } from "../../lib/prisma";
import { rollInitiative } from "../../lib/initiative";
import { abilityModifier } from "../../lib/dice";
import { getActorVisibleTiles } from "../../lib/visibility";
import type { GameTile } from "../../lib/tile-types";
import type { InitiativeSlot } from "../../lib/initiative";

export interface TriggerCombatResult {
  success:      boolean;
  error?:       string;
  combatStarted?: boolean;
}

export async function triggerCombat(
  gameId:   string,
  enemyIds: string[],
): Promise<TriggerCombatResult> {
  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    { select: { id: true, baseDexterity: true } },
      partyMembers: {
        include: { character: { select: { id: true, baseDexterity: true } } },
      },
    },
    // Also need currentActId and state for visibility check
  });
  if (!game) return { success: false, error: "Game not found." };

  // Already in combat — no-op
  const existing = await prisma.combatSession.findUnique({ where: { gameId } });
  if (existing) return { success: true, combatStarted: false };

  // ── Visibility filter: only enemies with LoS to at least one player ──────────
  const gameForVisibility = await prisma.game.findUnique({
    where:  { id: gameId },
    select: { currentActId: true, state: true, partyMembers: { select: { posX: true, posY: true } } },
  });
  const activeGM = gameForVisibility?.currentActId
    ? await prisma.gameMap.findUnique({
        where:  { gameId_actId: { gameId, actId: gameForVisibility.currentActId } },
        select: { data: true },
      })
    : null;
  const gmTiles: GameTile[][] = (activeGM?.data as any)?.tiles ?? [];
  const isPartyGame = game.partyMembers.length > 0;
  const playerPositions: { x: number; y: number }[] = isPartyGame
    ? (gameForVisibility?.partyMembers ?? []).map((m) => ({ x: m.posX, y: m.posY }))
    : [{ x: (gameForVisibility?.state as any)?.playerPos?.x ?? 0, y: (gameForVisibility?.state as any)?.playerPos?.y ?? 0 }];

  // Build tile position map for every enemy actor
  const tilePos = new Map<string, { x: number; y: number }>();
  for (let ty = 0; ty < gmTiles.length; ty++) {
    for (let tx = 0; tx < gmTiles[ty].length; tx++) {
      const actor = (gmTiles[ty][tx] as any)?.actor;
      if (actor?.kind === "enemy") tilePos.set(actor.id, { x: tx, y: ty });
    }
  }

  // Compute union of all tiles visible from any player position
  const visibleTiles = new Set<string>();
  if (gmTiles.length > 0) {
    for (const pos of playerPositions) {
      for (const tile of getActorVisibleTiles(gmTiles, pos.x, pos.y)) {
        visibleTiles.add(tile);
      }
    }
  }

  // Filter: keep enemy if no tile map (can't check), no tile position (can't check),
  // or tile position is in the visible set.
  const visibleEnemyIds = enemyIds.filter((id) => {
    if (gmTiles.length === 0) return true;
    const pos = tilePos.get(id);
    if (!pos) return true; // not on tile grid — let through, processNpcTurns will skip it
    return visibleTiles.has(`${pos.x},${pos.y}`);
  });

  if (visibleEnemyIds.length === 0) {
    console.log(`[triggerCombat] game=${gameId} — no visible enemies, skipping combat start`);
    return { success: true, combatStarted: false };
  }

  const enemies = await prisma.enemy.findMany({
    where:  { id: { in: visibleEnemyIds } },
    select: { id: true, dexterity: true, wisdom: true },
  });

  // Build actor list
  const isParty = game.partyMembers.length > 0;
  const playerActors = isParty
    ? game.partyMembers.map((m) => ({
        actorId:   m.character.id,
        actorType: "CHARACTER" as const,
        dexterity: m.character.baseDexterity,
      }))
    : [{ actorId: game.character.id, actorType: "CHARACTER" as const, dexterity: game.character.baseDexterity }];

  const enemyActors = enemies.map((e) => ({
    actorId:   e.id,
    actorType: "ENEMY" as const,
    dexterity: e.dexterity,
  }));

  const slots: InitiativeSlot[] = rollInitiative([...playerActors, ...enemyActors]);

  // Surprise evaluation: gather hidden players and their stealth rolls
  const hiddenPlayers = isParty
    ? await prisma.partyMember.findMany({
        where:  { gameId, isHiding: true },
        select: { character: { select: { id: true } }, stealthRoll: true },
      })
    : [];

  // Solo games have no PartyMember records, so no stealth tracking yet (Phase E adds this)
  const hiddenStealthRolls: number[] = hiddenPlayers.map((p) => p.stealthRoll);

  // Mutate isSurprised on enemy slots
  for (const slot of slots) {
    if (slot.actorType !== "ENEMY") continue;
    const enemy = enemies.find((e) => e.id === slot.actorId);
    if (!enemy) continue;
    const passivePerception = 10 + abilityModifier(enemy.wisdom);
    // Surprised only if ALL hidden players beat this enemy's passive perception
    if (hiddenStealthRolls.length > 0 && hiddenStealthRolls.every((r) => r > passivePerception)) {
      slot.isSurprised = true;
    }
  }

  await prisma.combatSession.create({
    data: {
      gameId,
      initiativeOrder:    slots as any,
      currentTurnIndex:   0,
      currentRoundNumber: 1,
    },
  });

  return { success: true, combatStarted: true };
}
