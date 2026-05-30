// prisma/seed-enemy-weapons.mjs
// Backfills mainHand weapon Items for all existing Enemy rows that have no mainHandId.
// Derives weapon from enemy name. Safe to re-run: skips enemies that already have mainHandId.
//
// Run with: npx tsx prisma/seed-enemy-weapons.mjs

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon }   = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma  = new PrismaClient({ adapter });

// ─── Weapon catalogue ─────────────────────────────────────────────────────────
// Keyed by substring of enemy name (lowercase). First match wins.

const ENEMY_WEAPONS = [
  {
    match:     "cellar rat",
    name:      "Rat Fangs",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d3", attackBonus: 0,
    description: "Needle-sharp incisors — oversized from ritual corruption.",
    combatImpactLabel: "1d3 piercing",
  },
  {
    match:     "tunnel rat",
    name:      "Crystal-Warped Bite",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d4", attackBonus: 0,
    description: "Teeth partially crystallised by dark-relic exposure.",
    combatImpactLabel: "1d4 piercing",
  },
  {
    match:     "cultist guard",
    name:      "Rusty Shortsword",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d6+1", attackBonus: 0,
    description: "A pitted blade with a leather-wrapped hilt.",
    combatImpactLabel: "1d6+1 slashing",
  },
  {
    match:     "cultist acolyte",
    name:      "Ceremonial Dagger",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "2d6", attackBonus: 0,
    description: "Obsidian blade etched with cult sigils.",
    combatImpactLabel: "2d6 necrotic",
  },
  {
    match:     "cult acolyte",
    name:      "Corrupted Holy Symbol",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "2d8+3", attackBonus: 0,
    description: "A sunburst symbol corroded to black. Its touch draws life.",
    combatImpactLabel: "2d8+3 necrotic",
  },
  {
    match:     "cultist",
    name:      "Cultist Dagger",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d4+1", attackBonus: 0,
    description: "A plain iron dagger stamped with the cult's mark.",
    combatImpactLabel: "1d4+1 piercing",
  },
  {
    match:     "cave spider",
    name:      "Spider Fangs",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d6+1", attackBonus: 0,
    description: "Curved hollow fangs that inject paralytic venom.",
    combatImpactLabel: "1d6+1 piercing + poison",
  },
  {
    match:     "corrupted miner",
    name:      "Fused Pickaxe Arm",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d8+3", attackBonus: 0,
    description: "The pickaxe has bonded with flesh and crystal.",
    combatImpactLabel: "1d8+3 piercing",
  },
  {
    match:     "mine foreman",
    name:      "Crystal-Fused Gauntlets",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "2d8+4", attackBonus: 0,
    description: "Both fists encased in jagged black crystal grown from within.",
    combatImpactLabel: "2d8+4 bludgeoning + piercing",
  },
  {
    match:     "arena guard",
    name:      "Gladiatorial Spear",
    weaponType:"reach", rangeFeet: 10,
    damageDice: "1d8+2", attackBonus: 0,
    description: "A balanced ash-wood spear tipped with hardened iron. Reach property — threatens 10 ft.",
    combatImpactLabel: "1d8+2 piercing, reach 10ft",
  },
  {
    match:     "arena brute",
    name:      "Iron Greatclub",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "2d8+4", attackBonus: 0,
    description: "A length of iron-banded timber thick as a man's thigh.",
    combatImpactLabel: "2d8+4 bludgeoning",
  },
  {
    match:     "arena champion",
    name:      "Champion's Shortsword",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d8+3", attackBonus: 0,
    description: "Nicked and re-edged a hundred times. The blade knows exactly where to find gaps in armour.",
    combatImpactLabel: "1d8+3 slashing",
  },
  {
    match:     "elite guard",
    name:      "Arena Master's Longsword",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "1d10+3", attackBonus: 0,
    description: "Stamped with the arena master's seal. Awarded only to the undefeated.",
    combatImpactLabel: "1d10+3 slashing",
  },
  {
    match:     "shadow assassin",
    name:      "Twin Shadow Blades",
    weaponType:"melee", rangeFeet: 5,
    damageDice: "2d6+4", attackBonus: 0,
    description: "Matched black-iron shortswords that seem to absorb light.",
    combatImpactLabel: "2d6+4 slashing",
  },
  {
    match:     "thornwood architect",
    name:      "Ancient Runic Staff",
    weaponType:"reach", rangeFeet: 10,
    damageDice: "3d8+5", attackBonus: 0,
    description: "Carved from a wood that no longer exists. Runes pulse with the relic's frequency. Reach 10 ft.",
    combatImpactLabel: "3d8+5 necrotic, reach 10ft",
  },
];

function findWeapon(enemyName) {
  const lower = enemyName.toLowerCase();
  // Sort by match-string length descending so "cult acolyte" wins over "cultist"
  const sorted = [...ENEMY_WEAPONS].sort((a, b) => b.match.length - a.match.length);
  return sorted.find((w) => lower.includes(w.match));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const enemies = await prisma.enemy.findMany({
    where: { mainHandId: null },
  });

  console.log(`\nFound ${enemies.length} enemy/enemies without a weapon.\n`);

  let seeded = 0;
  let skipped = 0;

  for (const enemy of enemies) {
    const weapon = findWeapon(enemy.name);

    if (!weapon) {
      console.log(`  [skip]  "${enemy.name}" — no weapon match found`);
      skipped++;
      continue;
    }

    const item = await prisma.item.create({
      data: {
        name:              weapon.name,
        category:          "Weapon",
        type:              "WEAPON",
        weaponType:        weapon.weaponType,
        rangeFeet:         weapon.rangeFeet,
        damageDice:        weapon.damageDice,
        attackBonus:       weapon.attackBonus,
        description:       weapon.description,
        combatImpactLabel: weapon.combatImpactLabel,
        weightLbs:         0,
        quantity:          1,
        isEquipped:        true,
      },
    });

    await prisma.enemy.update({
      where: { id: enemy.id },
      data:  { mainHandId: item.id },
    });

    console.log(`  [seed]  "${enemy.name}" → "${weapon.name}" (${weapon.weaponType}, ${weapon.rangeFeet}ft)`);
    seeded++;
  }

  console.log(`\nDone. ${seeded} seeded, ${skipped} skipped.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
