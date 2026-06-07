import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

async function main() {
  // Find test and lucy characters
  const chars = await prisma.character.findMany({
    where: { name: { in: ["test", "lucy"], mode: "insensitive" } },
    include: {
      participants: {
        orderBy: { lastActiveAt: "desc" },
        take: 1,
        include: {
          roomInstance: {
            include: { session: true },
          },
        },
      },
    },
  });

  if (chars.length < 2) {
    console.error(`❌ Expected 2 characters, found ${chars.length}: ${chars.map(c => c.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`✅ Found characters: ${chars.map(c => `${c.name} (${c.characterClass})`).join(", ")}`);

  // Find their shared room (most recently active)
  const roomIds = chars.map(c => c.participants[0]?.roomInstanceId).filter(Boolean);
  const sharedRoomId = roomIds.find(id => roomIds.filter(x => x === id).length > 1)
    ?? chars[0].roomParticipants[0]?.roomInstanceId;

  if (!sharedRoomId) {
    console.error("❌ Could not find a shared room instance");
    process.exit(1);
  }

  console.log(`📍 Using room: ${sharedRoomId}`);

  // Build initiative order
  const initiativeOrder = [];

  for (const c of chars) {
    const dexMod = abilityModifier(c.baseDexterity);
    const strMod = abilityModifier(c.baseStrength);
    const profBonus = c.level >= 5 ? 3 : 2;
    const roll = Math.floor(Math.random() * 20) + 1 + dexMod;
    initiativeOrder.push({
      id: c.id,
      type: "character",
      name: c.name,
      initiative: roll,
      hp: c.currentHp,
      maxHp: c.maxHp,
      ac: 10 + dexMod,
      surprised: false,
      acted: false,
      proximity: "close",
      status_effects: [],
      isDormant: false,
    });
  }

  // Add a synthetic enemy (Skeleton Warrior) — sufficient for UI testing
  const enemyId = `seed-enemy-skeleton-${Date.now()}`;
  const enemyInitiative = Math.floor(Math.random() * 20) + 1 + 1; // +1 dex mod
  initiativeOrder.push({
    id: enemyId,
    type: "enemy",
    name: "Skeleton Warrior",
    initiative: enemyInitiative,
    hp: 13,
    maxHp: 13,
    ac: 13,
    surprised: false,
    acted: false,
    proximity: "close",
    status_effects: [],
    resistances: ["piercing"],
    passive_perception: 9,
  });

  // Sort by initiative descending
  initiativeOrder.sort((a, b) => b.initiative - a.initiative);

  const combatState = {
    round: 1,
    initiativeOrder,
    activeActorId: initiativeOrder[0].id,
    currentTurnUsage: {
      actionUsed: false,
      bonusActionUsed: false,
      movementUsed: false,
      reactionUsed: false,
    },
  };

  await prisma.roomInstance.update({
    where: { id: sharedRoomId },
    data: {
      gameState: "combat",
      combatState: combatState,
    },
  });

  console.log(`⚔️  Room set to combat!`);
  console.log(`   Initiative order:`);
  for (const e of initiativeOrder) {
    console.log(`     ${e.initiative.toString().padStart(2)} — ${e.name} (${e.type})`);
  }
  console.log(`   Active actor: ${initiativeOrder[0].name}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
