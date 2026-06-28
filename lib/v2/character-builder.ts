import { prisma } from '@/lib/prisma';
export { maxForLevel } from '@/lib/v2/level-utils';

export async function buildClassFeatureDetails(featureIds: string[]) {
  if (featureIds.length === 0) return [];
  return prisma.classFeature.findMany({
    where: { id: { in: featureIds } },
    select: {
      id: true, name: true, featureType: true, mechanicsJson: true,
      actionType: true, implemented: true, level: true, subclass: true,
      description: true, icon: true,
      resourcePool: {
        select: { poolKey: true, maxByLevel: true, resetOn: true, dieSize: true },
      },
    },
    orderBy: { level: 'asc' },
  });
}
