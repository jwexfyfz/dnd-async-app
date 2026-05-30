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
  weaponType:        string;
  rangeFeet:         number;
  damageDice:        string;
  attackBonus:       number;
  blocksMovement?:   boolean;
}

const ITEM_TEMPLATES: Record<string, ItemTemplate[]> = {
  "Cellar": [
    { name: "Rusty Dagger",   category: "Weapon",     weaponType: "melee", rangeFeet: 5, weightLbs: 1.0, quantity: 1, isEquipped: false, combatImpactLabel: "+3 Damage",  damageDice: "1d4", attackBonus: 0 },
    { name: "Tattered Cloak", category: "Armor",      weaponType: "melee", rangeFeet: 5, weightLbs: 2.5, quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC",       damageDice: "1d4", attackBonus: 0 },
    { name: "Healing Potion", category: "Consumable", weaponType: "melee", rangeFeet: 5, weightLbs: 0.5, quantity: 2, isEquipped: false, combatImpactLabel: "Heal 8 HP",   damageDice: "1d4", attackBonus: 0 },
  ],

  "Mine": [
    { name: "Reinforced Mining Pick", category: "Weapon",     weaponType: "melee",  rangeFeet: 5,  weightLbs: 6.0, quantity: 1, isEquipped: false, combatImpactLabel: "+5 Damage",             damageDice: "1d6+2", attackBonus: 0 },
    { name: "Leather Work Gloves",    category: "Armor",      weaponType: "melee",  rangeFeet: 5,  weightLbs: 0.5, quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC, +2 Grapple",     damageDice: "1d4",   attackBonus: 0 },
    { name: "Flask of Lamp Oil",      category: "Consumable", weaponType: "thrown", rangeFeet: 20, weightLbs: 1.0, quantity: 3, isEquipped: false, combatImpactLabel: "+6 Fire Damage (thrown)", damageDice: "1d6",   attackBonus: 0 },
  ],

  "Arena": [
    { name: "Gladiator's Shortsword", category: "Weapon", weaponType: "melee", rangeFeet: 5, weightLbs: 2.0, quantity: 1, isEquipped: true, combatImpactLabel: "+6 Damage, +2 to Hit", damageDice: "1d6", attackBonus: 2 },
    { name: "Iron Shield",            category: "Armor",  weaponType: "melee", rangeFeet: 5, weightLbs: 6.0, quantity: 1, isEquipped: true, combatImpactLabel: "+2 AC",                damageDice: "1d4", attackBonus: 0 },
  ],
};

// ─── Fallback items for unrecognised maps ──────────────────────────────────────

const FALLBACK_ITEMS: ItemTemplate[] = [
  { name: "Short Sword",    category: "Weapon", weaponType: "melee", rangeFeet: 5, weightLbs: 2.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+4 Damage", damageDice: "1d6", attackBonus: 0 },
  { name: "Leather Armour", category: "Armor",  weaponType: "melee", rangeFeet: 5, weightLbs: 10.0, quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC",     damageDice: "1d4", attackBonus: 0 },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const maps = await prisma.map.findMany({ select: { id: true, name: true } });

  console.log(`Found ${maps.length} map(s).`);

  const existingCount = await prisma.item.count();
  if (existingCount > 0) {
    console.log(`  [skip] ${existingCount} item(s) already exist in item table.`);
    console.log("Done.");
    return;
  }

  for (const map of maps) {
    // Match on a keyword in the map name; fall back to defaults.
    const matchKey = Object.keys(ITEM_TEMPLATES).find((k) => map.name.includes(k));
    const templates = matchKey ? ITEM_TEMPLATES[matchKey] : FALLBACK_ITEMS;

    const created = await prisma.$transaction(
      templates.map((t) =>
        prisma.item.create({
          data: { ...t, type: t.category.toUpperCase(), blocksMovement: t.blocksMovement ?? false },
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
