// prisma/seed-equippable-items.ts
// Seeds EquippableItem rows for every Map in the database.
// Each map gets 2-3 contextually appropriate items based on its name/theme.
// Safe to re-run: skips maps that already have items seeded.
//
// Run with: npx tsx prisma/seed-equippable-items.ts

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Item Templates ───────────────────────────────────────────────────────────
// Keyed by a substring of the map name so new maps can be matched easily.
// Each entry is an array of items to seed for that map.

interface ItemTemplate {
  name:              string;
  category:          "Weapon" | "Armor" | "Consumable";
  weightLbs:         number;
  quantity:          number;
  isEquipped:        boolean;
  combatImpactLabel: string;
}

const ITEM_TEMPLATES: Record<string, ItemTemplate[]> = {
  "Cellar": [
    {
      name:              "Rusty Dagger",
      category:          "Weapon",
      weightLbs:         1.0,
      quantity:          1,
      isEquipped:        false,
      combatImpactLabel: "+3 Damage",
    },
    {
      name:              "Tattered Cloak",
      category:          "Armor",
      weightLbs:         2.5,
      quantity:          1,
      isEquipped:        false,
      combatImpactLabel: "+1 AC",
    },
    {
      name:              "Healing Potion",
      category:          "Consumable",
      weightLbs:         0.5,
      quantity:          2,
      isEquipped:        false,
      combatImpactLabel: "Heal 8 HP",
    },
  ],

  "Mine": [
    {
      name:              "Reinforced Mining Pick",
      category:          "Weapon",
      weightLbs:         6.0,
      quantity:          1,
      isEquipped:        false,
      combatImpactLabel: "+5 Damage",
    },
    {
      name:              "Leather Work Gloves",
      category:          "Armor",
      weightLbs:         0.5,
      quantity:          1,
      isEquipped:        false,
      combatImpactLabel: "+1 AC, +2 Grapple",
    },
    {
      name:              "Flask of Lamp Oil",
      category:          "Consumable",
      weightLbs:         1.0,
      quantity:          3,
      isEquipped:        false,
      combatImpactLabel: "+6 Fire Damage (thrown)",
    },
  ],

  "Arena": [
    {
      name:              "Gladiator's Shortsword",
      category:          "Weapon",
      weightLbs:         2.0,
      quantity:          1,
      isEquipped:        true,
      combatImpactLabel: "+6 Damage, +2 to Hit",
    },
    {
      name:              "Iron Shield",
      category:          "Armor",
      weightLbs:         6.0,
      quantity:          1,
      isEquipped:        true,
      combatImpactLabel: "+2 AC",
    },
  ],
};

// ─── Fallback items for unrecognised maps ──────────────────────────────────────

const FALLBACK_ITEMS: ItemTemplate[] = [
  {
    name:              "Short Sword",
    category:          "Weapon",
    weightLbs:         2.0,
    quantity:          1,
    isEquipped:        false,
    combatImpactLabel: "+4 Damage",
  },
  {
    name:              "Leather Armour",
    category:          "Armor",
    weightLbs:         10.0,
    quantity:          1,
    isEquipped:        false,
    combatImpactLabel: "+1 AC",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const maps = await prisma.map.findMany({
    include: { items: { select: { id: true }, where: { mapId: { not: null } } } },
  });

  console.log(`Found ${maps.length} map(s).`);

  for (const map of maps) {
    if (map.items.length > 0) {
      console.log(`  [skip] "${map.name}" — already has ${map.items.length} item(s).`);
      continue;
    }

    // Match on a keyword in the map name; fall back to defaults.
    const matchKey = Object.keys(ITEM_TEMPLATES).find((k) => map.name.includes(k));
    const templates = matchKey ? ITEM_TEMPLATES[matchKey] : FALLBACK_ITEMS;

    const created = await prisma.$transaction(
      templates.map((t) =>
        prisma.item.create({
          data: { ...t, mapId: map.id, type: t.category.toUpperCase() },
        }),
      ),
    );

    console.log(`  [seed] "${map.name}" — inserted ${created.length} item(s): ${created.map((c) => c.name).join(", ")}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
