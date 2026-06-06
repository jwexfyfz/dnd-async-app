import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { prisma } = await import('../lib/prisma');
  const pois = await prisma.poiTemplate.findMany({
    where: { roomTemplateId: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' },
    select: { id: true, name: true, keywordIdentifier: true, defaultProperties: true },
  });
  for (const poi of pois) {
    console.log(poi.id, poi.name);
    const dp = poi.defaultProperties as Record<string, unknown>;
    if (dp.poi_type === 'npc' || dp.awareness_state || dp.combat_stats) {
      console.log('  props:', JSON.stringify(dp, null, 2));
    } else {
      console.log('  poi_type:', dp.poi_type);
    }
  }
  await prisma.$disconnect();
}
main();
