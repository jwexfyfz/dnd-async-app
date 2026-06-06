import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { prisma } = await import('../lib/prisma');
  const pois = await prisma.poiTemplate.findMany({
    where: { roomTemplate: { dungeonTemplateId: '11111111-1111-1111-1111-111111111111' } },
    select: { id: true, name: true, keywordIdentifier: true, defaultProperties: true, roomTemplateId: true },
  });
  for (const poi of pois) {
    const dp = poi.defaultProperties as Record<string, unknown>;
    if (dp.poi_type === 'npc') {
      console.log(`\n${poi.id} [${poi.roomTemplateId}] ${poi.name}`);
      console.log('  npc_name:', dp.npc_name);
      console.log('  combat_stats:', dp.combat_stats || '(none)');
      console.log('  ai_behavior:', dp.ai_behavior || '(none)');
    }
  }
  await prisma.$disconnect();
}
main();
