// Temporary: seeds test items for game 93445297-c78d-4fca-8271-7e5b2dc45b52
// Run with: npx tsx prisma/seed-test-items.ts
// Safe to delete after testing.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const game = await prisma.game.findUnique({
    where: { id: "93445297-c78d-4fca-8271-7e5b2dc45b52" },
    include: { map: { select: { id: true, name: true } } },
  });

  if (!game?.map) { console.error("Game or map not found."); return; }
  console.log(`Map: "${game.map.name}" (${game.map.id})`);

  const items = [
    { name: "Iron Longsword",      category: "Weapon",     description: "A heavy longsword of dark iron. Shows nicks from past battles.",                      weightLbs: 3.5,  quantity: 1, isEquipped: false, combatImpactLabel: "+5 Damage, +1 to Hit" },
    { name: "Chainmail Hauberk",   category: "Armor",      description: "Interlocked iron rings covering the torso. Heavy but reliable in sustained fighting.", weightLbs: 40.0, quantity: 1, isEquipped: false, combatImpactLabel: "+4 AC" },
    { name: "Recurve Hunting Bow", category: "Weapon",     description: "A recurve bow of laminated horn and wood. Pulls hard; shoots true.",                  weightLbs: 2.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+3 Damage" },
    { name: "Tower Shield",        category: "Armor",      description: "A tall rectangular shield of wood and iron. Slow to move with, hard to get past.",    weightLbs: 8.5,  quantity: 1, isEquipped: false, combatImpactLabel: "+3 AC" },
    { name: "Healing Potion",      category: "Consumable", description: "A vial of shimmering red liquid. Tastes of copper and honey.",                        weightLbs: 0.5,  quantity: 3, isEquipped: false, combatImpactLabel: "+8 HP" },
  ];

  const created = await prisma.$transaction(
    items.map((it) => prisma.item.create({ data: { ...it, mapId: game.map!.id, type: it.category.toUpperCase() } })),
  );

  console.log(`Inserted ${created.length} items: ${created.map((c) => c.name).join(", ")}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
