import { prisma } from '@/lib/prisma';
import { xpForNextLevel } from '@/lib/xp';

export const roomInstanceQuery = (roomInstanceId: string) =>
  prisma.roomInstance.findUniqueOrThrow({
    where: { id: roomInstanceId },
    include: {
      template: true,
      session: { select: { id: true, gameState: true, storyFlags: true, kickedCharacterIds: true } },
      poiInstances: { include: { template: true } },
      participants: { include: { character: { select: { id: true, name: true } } } },
    },
  });

// Extra Attack loop count per class and level (D&D 5e PHB)
export function attacksPerAction(characterClass: string, level: number): number {
  if (characterClass === 'Fighter') {
    if (level >= 20) return 4;
    if (level >= 11) return 3;
    if (level >= 5) return 2;
  }
  if (['Paladin', 'Ranger', 'Barbarian', 'Monk'].includes(characterClass)) {
    if (level >= 5) return 2;
  }
  return 1;
}

export async function lookupDatabaseContext(characterId: string, roomInstanceId: string) {
  const [character, roomInstance] = await Promise.all([
    prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        characterClass: true,
        level: true,
        xp: true,
        maxHp: true,
        currentHp: true,
        skillsModifiers: true,
        skillProficiencies: true,
        inventory: true,
        baseStrength: true,
        baseDexterity: true,
        baseConstitution: true,
        baseIntelligence: true,
        baseWisdom: true,
        baseCharisma: true,
        isHiding: true,
        stealthRoll: true,
        pendingChoicesQueue: true,
        subclass: true,
        critThreshold: true,
        featuresUnlocked: true,
        resourceStates: { select: { poolKey: true, current: true } },
      },
    }),
    roomInstanceQuery(roomInstanceId),
  ]);

  // Fetch implemented ClassFeature rows for this character
  let classFeatures: Array<{
    id: string;
    name: string;
    featureType: string;
    mechanicsJson: unknown;
    actionType: string | null;
    implemented: boolean;
    subclass: string | null;
  }> = [];
  if (character.featuresUnlocked.length > 0) {
    classFeatures = await prisma.classFeature.findMany({
      where: { id: { in: character.featuresUnlocked }, implemented: true },
      select: {
        id: true, name: true, featureType: true, mechanicsJson: true,
        actionType: true, implemented: true, subclass: true,
      },
    });
  }

  const existingTemplateIds = new Set(roomInstance.poiInstances.map(pi => pi.poiTemplateId));
  const allTemplates = await prisma.poiTemplate.findMany({
    where: { roomTemplateId: roomInstance.roomTemplateId },
    select: { id: true },
  });
  const missing = allTemplates.filter(t => !existingTemplateIds.has(t.id));

  if (missing.length > 0) {
    console.log(`[db] lazy-syncing ${missing.length} missing PoiInstance(s) for room ${roomInstanceId}`);
    await prisma.poiInstance.createMany({
      data: missing.map(t => ({ roomInstanceId, poiTemplateId: t.id, currentProperties: {} })),
    });
    return { character, roomInstance: await roomInstanceQuery(roomInstanceId), classFeatures };
  }

  return { character, roomInstance, classFeatures };
}
