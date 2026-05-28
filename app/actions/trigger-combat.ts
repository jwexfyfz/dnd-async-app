"use server";

import { prisma } from "../../lib/prisma";
import { rollInitiative } from "../../lib/initiative";
import { abilityModifier } from "../../lib/dice";
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
  });
  if (!game) return { success: false, error: "Game not found." };

  // Already in combat — no-op
  const existing = await prisma.combatSession.findUnique({ where: { gameId } });
  if (existing) return { success: true, combatStarted: false };

  const enemies = await prisma.enemy.findMany({
    where:  { id: { in: enemyIds } },
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
