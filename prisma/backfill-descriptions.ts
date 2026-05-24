// prisma/backfill-descriptions.ts
// Adds short descriptions to all EquippableItem rows that have description = "".
// Run with: npx tsx prisma/backfill-descriptions.ts

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

const DESCRIPTIONS: Record<string, string> = {
  // Underground-storage tier
  "Bone-Handled Stiletto":   "A slender dagger with a grip carved from old bone. Unsettling to hold.",
  "Rusty Dagger":            "A short blade eaten by rust. Still cuts, but not prettily.",
  "Padded Leather Vest":     "Layered leather panels stitched with coarse thread. Better than nothing.",
  "Tattered Cloak":          "A moth-eaten wool cloak. Offers little warmth and less respect.",
  "Arcane Vial":             "A sealed glass tube pulsing with faint blue energy.",
  "Healing Potion":          "A vial of shimmering red liquid. Tastes of copper and honey.",

  // Mining tier
  "Reinforced Mining Pick":  "A heavy iron pick with a reinforced steel head. Doubles as a brutal weapon.",
  "Miner's Pickaxe":         "A standard-issue pickaxe, worn smooth from years of use.",
  "Studded Leather Apron":   "Thick leather set with iron rivets. Covers the torso against rock and blade alike.",
  "Leather Work Gloves":     "Hardened leather gloves that protect hands in tight tunnels.",
  "Flask of Lamp Oil":       "A sealed tin flask of refined lamp oil. Burns long and hot.",
  "Smelling Salts":          "A cloth pouch of sharp ammonia crystals. Snapped under the nose, it jolts the unconscious awake.",

  // Arena tier
  "Gladiator's Blade":       "A broad-bladed short sword etched with arena tallies.",
  "Gladiator's Shortsword":  "A well-balanced shortsword issued to arena fighters. The grip is wrapped in leather.",
  "Banded Arena Shield":     "An iron-banded wooden shield bearing the arena crest.",
  "Iron Shield":             "A plain round shield of hammered iron. Heavy but dependable.",
  "Battle Stimulant":        "A vial of alchemical tincture. Drinking it burns the throat and sharpens the body.",

  // Wilderness tier
  "Recurve Hunting Bow":     "A recurve bow of laminated horn and wood. Pulls hard; shoots true.",
  "Hunter's Shortbow":       "A simple shortbow carved from a single ash stave.",
  "Ranger's Studded Cloak":  "A hooded cloak set with iron studs. Breaks up your silhouette in tree cover.",
  "Ranger's Cloak":          "A mottled green-brown cloak favoured by wilderness scouts.",
  "Healing Herb Bundle":     "A tied bundle of dried medicinal herbs. Chewed or brewed into a paste.",

  // Dungeon tier
  "Tempered Longsword":      "A well-tempered longsword with a single fuller. Holds an edge in the cold dark.",
  "Dungeon Shortsword":      "A shortsword built for the cramped corridors of old keeps.",
  "Chainmail Hauberk":       "Interlocked iron rings covering the torso. Heavy but reliable in sustained fighting.",
  "Banded Leather Vest":     "Stiff leather reinforced with riveted iron bands across the chest.",
  "Blessed Scroll":          "Parchment inscribed with a warding prayer. Crumbles to ash after use.",
  "Antitoxin Vial":          "A bitter liquid that neutralises common poisons for about an hour.",

  // Generic tier
  "Short Sword":             "A plain double-edged sword of modest length. The adventurer's standard.",
  "Leather Armour":          "Boiled and hardened leather shaped into a fitted cuirass.",
  "Trail Ration":            "Hard tack and dried meat wrapped in cloth. Keeps for weeks.",

  // Test items (seed-test-items.ts)
  "Iron Longsword":          "A heavy longsword of dark iron. Shows nicks from past battles.",
  "Tower Shield":            "A tall rectangular shield of wood and iron. Slow to move with, hard to get past.",
};

async function main() {
  const items = await prisma.equippableItem.findMany({ where: { description: "" } });
  console.log(`\nFound ${items.length} item(s) with no description.\n`);

  let updated = 0;
  for (const item of items) {
    const desc = DESCRIPTIONS[item.name];
    if (!desc) {
      console.log(`  [skip]  "${item.name}" — no description defined.`);
      continue;
    }
    await prisma.equippableItem.update({ where: { id: item.id }, data: { description: desc } });
    console.log(`  [set]   "${item.name}"`);
    updated++;
  }

  console.log(`\nUpdated ${updated} / ${items.length} item(s).\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
