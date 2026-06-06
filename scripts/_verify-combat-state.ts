import { config } from 'dotenv'; import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
async function main() {
  const { prisma } = await import('../lib/prisma');
  const session = await prisma.gameSession.findFirst({
    where: { id: 'a583d602-6826-4514-a532-0208fce9a985' },
    select: { gameState: true, combatState: true },
  });
  console.log('gameState:', session?.gameState);
  console.log('combatState:', JSON.stringify(session?.combatState, null, 2));
  await prisma.$disconnect();
}
main();
