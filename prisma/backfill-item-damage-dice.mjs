// prisma/backfill-item-damage-dice.mjs
// Sets damageDice on all existing Item rows using best-judgement defaults by name/weaponType.
// Run with: node prisma/backfill-item-damage-dice.mjs

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Map item name substrings (lowercase) → damageDice / attackBonus
const NAME_MAP = [
  { match: "shortsword",   damageDice: "1d6",   attackBonus: 0 },
  { match: "gladiator",    damageDice: "1d6",   attackBonus: 2 },
  { match: "longsword",    damageDice: "1d8",   attackBonus: 0 },
  { match: "dagger",       damageDice: "1d4",   attackBonus: 0 },
  { match: "mining pick",  damageDice: "1d6+2", attackBonus: 0 },
  { match: "pickaxe",      damageDice: "1d6",   attackBonus: 0 },
  { match: "handaxe",      damageDice: "1d6",   attackBonus: 0 },
  { match: "greataxe",     damageDice: "1d12",  attackBonus: 0 },
  { match: "greatsword",   damageDice: "2d6",   attackBonus: 0 },
  { match: "mace",         damageDice: "1d6",   attackBonus: 0 },
  { match: "staff",        damageDice: "1d6",   attackBonus: 0 },
  { match: "bow",          damageDice: "1d8",   attackBonus: 0 },
  { match: "crossbow",     damageDice: "1d8",   attackBonus: 0 },
];

async function main() {
  const items = await prisma.item.findMany({ select: { id: true, name: true, type: true, weaponType: true } });
  console.log(`Found ${items.length} item(s).`);

  let updated = 0;
  for (const item of items) {
    const lower = item.name.toLowerCase();
    const match = NAME_MAP.find(m => lower.includes(m.match));
    const damageDice  = match?.damageDice  ?? "1d4";
    const attackBonus = match?.attackBonus ?? 0;

    await prisma.item.update({
      where: { id: item.id },
      data:  { damageDice, attackBonus },
    });
    console.log(`  [set] "${item.name}" → damageDice="${damageDice}" attackBonus=${attackBonus}`);
    updated++;
  }

  console.log(`Done. Updated ${updated} item(s).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
