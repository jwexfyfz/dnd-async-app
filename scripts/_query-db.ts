import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const { prisma } = await import('../lib/prisma');
  const [dungeon, rooms, user, character] = await Promise.all([
    prisma.dungeonTemplate.findFirst({ select: { id: true, name: true } }),
    prisma.roomTemplate.findMany({ select: { id: true, name: true }, take: 15 }),
    prisma.user.findFirst({ where: { email: 'jwexfyfz@gmail.com' }, select: { id: true, email: true } }),
    prisma.character.findFirst({ where: { user: { email: 'jwexfyfz@gmail.com' } }, select: { id: true, name: true, characterClass: true, level: true } }),
  ]);
  console.log('dungeon:', JSON.stringify(dungeon));
  console.log('rooms:', JSON.stringify(rooms));
  console.log('user:', JSON.stringify(user));
  console.log('character:', JSON.stringify(character));
  await prisma.$disconnect();
}
main();
