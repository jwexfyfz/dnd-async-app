import { prisma } from '@/lib/prisma';

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function applyShortRest(tx: PrismaTx, characterId: string): Promise<string[]> {
  const pools = await tx.featureResourcePool.findMany({
    where: { resetOn: 'SHORT_REST' },
    select: { poolKey: true, maxByLevel: true },
  });

  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { level: true, resourceStates: true },
  });

  const restored: string[] = [];
  for (const pool of pools) {
    const state = character.resourceStates.find(s => s.poolKey === pool.poolKey);
    const maxByLevel = pool.maxByLevel as Record<string, number>;
    let max = 0;
    for (let l = 1; l <= character.level; l++) {
      if (maxByLevel[String(l)] !== undefined) max = maxByLevel[String(l)];
    }
    await tx.characterResourceState.upsert({
      where: { characterId_poolKey: { characterId, poolKey: pool.poolKey } },
      create: { characterId, poolKey: pool.poolKey, current: max },
      update: state && state.current < max ? { current: max } : {},
    });
    if (state && state.current < max) {
      restored.push(pool.poolKey);
    }
  }
  return restored;
}

export async function applyLongRest(tx: PrismaTx, characterId: string): Promise<void> {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { level: true, maxHp: true, resourceStates: true },
  });

  const pools = await tx.featureResourcePool.findMany({
    select: { poolKey: true, maxByLevel: true },
  });

  for (const pool of pools) {
    const maxByLevel = pool.maxByLevel as Record<string, number>;
    let max = 0;
    for (let l = 1; l <= character.level; l++) {
      if (maxByLevel[String(l)] !== undefined) max = maxByLevel[String(l)];
    }
    await tx.characterResourceState.upsert({
      where: { characterId_poolKey: { characterId, poolKey: pool.poolKey } },
      create: { characterId, poolKey: pool.poolKey, current: max },
      update: { current: max },
    });
  }

  await tx.character.update({
    where: { id: characterId },
    data: { currentHp: character.maxHp, lastLongRest: new Date() },
  });
}

export async function checkAutoLongRest(characterId: string): Promise<boolean> {
  const character = await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { lastLongRest: true },
  });
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  return !character.lastLongRest || character.lastLongRest < eightHoursAgo;
}
