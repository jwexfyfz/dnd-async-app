// prisma/seed-items.ts
// Reads every Map row and seeds 2-3 contextually appropriate EquippableItems
// derived from each map's JSON data fields (rooms, pois, width, height).
//
// Classification pipeline per map:
//   1. parseMapData     — typed view of the JSON blob
//   2. classifyEnv      — keyword scan of room names/descriptions + map name → EnvironmentType
//   3. computeComplexity — rooms.length + grid area → 0.0–1.0 danger tier
//   4. poiSignals       — POI names that hint at specific loot (lantern → oil flask, etc.)
//   5. buildItems       — assembles 2-3 ItemBlueprint records, scales stats to complexity
//   6. prisma.equippableItem.create — inserts each item linked by mapId
//
// Safe to re-run: skips maps that already have items.
// Run with: npx tsx prisma/seed-items.ts

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter });

// ─── Map data shape ───────────────────────────────────────────────────────────

interface Room { name: string; description: string; }
interface Poi  { id: string; name: string; x: number; y: number; symbol: string; }

interface MapData {
  width:       number;
  height:      number;
  rooms:       Room[];
  pois:        Poi[];
  playerStart: { x: number; y: number };
}

function parseMapData(raw: unknown): MapData {
  const d = raw as Record<string, unknown>;
  return {
    width:       (d.width  as number)  ?? 0,
    height:      (d.height as number)  ?? 0,
    rooms:       (d.rooms  as Room[])  ?? [],
    pois:        (d.pois   as Poi[])   ?? [],
    playerStart: (d.playerStart as { x: number; y: number }) ?? { x: 0, y: 0 },
  };
}

// ─── Environment classification ───────────────────────────────────────────────

type EnvironmentType =
  | "underground-storage"   // cellar, crypt, vault, warehouse
  | "mining"                // mine, shaft, excavation, tunnel
  | "combat-arena"          // arena, proving grounds, colosseum
  | "wilderness"            // forest, grove, swamp, hills
  | "dungeon"               // keep, tower, fortress, dungeon
  | "generic";

const ENV_KEYWORDS: Record<EnvironmentType, string[]> = {
  "underground-storage": ["cellar", "storage", "crypt", "vault", "chamber", "basement", "warehouse"],
  "mining":              ["mine", "shaft", "excavation", "tunnel", "vein", "ore", "mineshaft"],
  "combat-arena":        ["arena", "proving", "gladiator", "colosseum", "pit", "fighting"],
  "wilderness":          ["forest", "grove", "swamp", "marsh", "hills", "plains", "jungle", "woods"],
  "dungeon":             ["dungeon", "keep", "tower", "fortress", "castle", "catacombs", "ruins"],
  "generic":             [],
};

function classifyEnv(mapName: string, rooms: Room[]): EnvironmentType {
  const corpus = [
    mapName,
    ...rooms.map((r) => r.name),
    ...rooms.map((r) => r.description),
  ].join(" ").toLowerCase();

  for (const [env, keywords] of Object.entries(ENV_KEYWORDS) as [EnvironmentType, string[]][]) {
    if (env === "generic") continue;
    if (keywords.some((kw) => corpus.includes(kw))) return env;
  }
  return "generic";
}

// ─── Complexity score (0.0 – 1.0) ─────────────────────────────────────────────
// Derived from room count (up to 5 expected) and grid area (up to ~150 tiles).
// Higher score → larger bonuses and heavier items.

function computeComplexity(data: MapData): number {
  const roomScore = Math.min(data.rooms.length / 5, 1);
  const areaScore = Math.min((data.width * data.height) / 150, 1);
  return parseFloat(((roomScore + areaScore) / 2).toFixed(2));
}

// ─── POI signal extraction ─────────────────────────────────────────────────────
// Returns a Set of lowercase keywords extracted from POI names/IDs so item
// generation can conditionally add thematic consumables.

function poiSignals(pois: Poi[]): Set<string> {
  const signals = new Set<string>();
  for (const p of pois) {
    const text = `${p.name} ${p.id}`.toLowerCase();
    for (const kw of ["lantern", "chest", "ore", "vein", "gate", "pickaxe", "forge", "altar"]) {
      if (text.includes(kw)) signals.add(kw);
    }
  }
  return signals;
}

// ─── Item blueprint ────────────────────────────────────────────────────────────

interface ItemBlueprint {
  name:              string;
  category:          "Weapon" | "Armor" | "Consumable" | "Held";
  description:       string;
  weightLbs:         number;
  quantity:          number;
  isEquipped:        boolean;
  combatImpactLabel: string;
}

// ─── Per-environment item builders ────────────────────────────────────────────

function buildItems(
  env:        EnvironmentType,
  complexity: number,
  signals:    Set<string>,
): ItemBlueprint[] {
  const hi = complexity >= 0.6; // high-complexity tier
  const items: ItemBlueprint[] = [];

  switch (env) {

    case "underground-storage":
      items.push(
        hi
          ? { name: "Bone-Handled Stiletto", category: "Weapon",     description: "A slender dagger with a grip carved from old bone. Unsettling to hold.",             weightLbs: 0.75, quantity: 1, isEquipped: false, combatImpactLabel: "+5 Damage, +1 to Hit" }
          : { name: "Rusty Dagger",          category: "Weapon",     description: "A short blade eaten by rust. Still cuts, but not prettily.",                         weightLbs: 1.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+3 Damage" },
        hi
          ? { name: "Padded Leather Vest",   category: "Armor",      description: "Layered leather panels stitched with coarse thread. Better than nothing.",            weightLbs: 5.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+2 AC" }
          : { name: "Tattered Cloak",        category: "Armor",      description: "A moth-eaten wool cloak. Offers little warmth and less respect.",                    weightLbs: 2.5,  quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC" },
        signals.has("chest")
          ? { name: "Arcane Vial",           category: "Consumable", description: "A sealed glass tube pulsing with faint blue energy.",                                weightLbs: 0.25, quantity: 1, isEquipped: false, combatImpactLabel: "+10 Temp HP" }
          : { name: "Healing Potion",        category: "Consumable", description: "A vial of shimmering red liquid. Tastes of copper and honey.",                       weightLbs: 0.5,  quantity: 2, isEquipped: false, combatImpactLabel: "Heal 8 HP" },
      );
      break;

    case "mining":
      items.push(
        hi
          ? { name: "Reinforced Mining Pick", category: "Weapon",     description: "A heavy iron pick with a reinforced steel head. Doubles as a brutal weapon.",        weightLbs: 7.0, quantity: 1, isEquipped: false, combatImpactLabel: "+6 Damage, Armor Piercing" }
          : { name: "Miner's Pickaxe",        category: "Weapon",     description: "A standard-issue pickaxe, worn smooth from years of use.",                          weightLbs: 5.0, quantity: 1, isEquipped: false, combatImpactLabel: "+4 Damage" },
        hi
          ? { name: "Studded Leather Apron",  category: "Armor",      description: "Thick leather set with iron rivets. Covers the torso against rock and blade alike.", weightLbs: 8.0, quantity: 1, isEquipped: false, combatImpactLabel: "+3 AC" }
          : { name: "Leather Work Gloves",    category: "Armor",      description: "Hardened leather gloves that protect hands in tight tunnels.",                       weightLbs: 0.5, quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC, +2 Grapple" },
        signals.has("lantern") || signals.has("ore")
          ? { name: "Flask of Lamp Oil",      category: "Consumable", description: "A sealed tin flask of refined lamp oil. Burns long and hot.",                        weightLbs: 1.0, quantity: 3, isEquipped: false, combatImpactLabel: "+6 Fire Damage (thrown)" }
          : { name: "Smelling Salts",         category: "Consumable", description: "A cloth pouch of sharp ammonia crystals. Snapped under the nose, it jolts the unconscious awake.", weightLbs: 0.1, quantity: 2, isEquipped: false, combatImpactLabel: "Remove Stunned condition" },
      );
      break;

    case "combat-arena":
      // Arena loot starts equipped — fighters enter the ring ready.
      items.push(
        hi
          ? { name: "Gladiator's Blade",      category: "Weapon", description: "A broad-bladed short sword etched with arena tallies.",                              weightLbs: 2.5, quantity: 1, isEquipped: true, combatImpactLabel: "+7 Damage, +2 to Hit" }
          : { name: "Gladiator's Shortsword", category: "Weapon", description: "A well-balanced shortsword issued to arena fighters. The grip is wrapped in leather.", weightLbs: 2.0, quantity: 1, isEquipped: true, combatImpactLabel: "+6 Damage, +1 to Hit" },
        hi
          ? { name: "Banded Arena Shield",  category: "Armor",  description: "An iron-banded wooden shield bearing the arena crest.",                              weightLbs: 7.5, quantity: 1, isEquipped: true, combatImpactLabel: "+3 AC, Block Reaction" }
          : { name: "Iron Shield",          category: "Armor",  description: "A plain round shield of hammered iron. Heavy but dependable.",                        weightLbs: 6.0, quantity: 1, isEquipped: true, combatImpactLabel: "+2 AC" },
      );
      if (hi) {
        items.push({ name: "Battle Stimulant", category: "Consumable", description: "A vial of alchemical tincture. Drinking it burns the throat and sharpens the body.", weightLbs: 0.1, quantity: 1, isEquipped: false, combatImpactLabel: "+4 Damage for 2 turns" });
      }
      break;

    case "wilderness":
      items.push(
        hi
          ? { name: "Recurve Hunting Bow",    category: "Weapon",     description: "A recurve bow of laminated horn and wood. Pulls hard; shoots true.",               weightLbs: 2.0, quantity: 1, isEquipped: false, combatImpactLabel: "+5 Damage, 60ft Range" }
          : { name: "Hunter's Shortbow",      category: "Weapon",     description: "A simple shortbow carved from a single ash stave.",                               weightLbs: 1.5, quantity: 1, isEquipped: false, combatImpactLabel: "+4 Damage, 40ft Range" },
        hi
          ? { name: "Ranger's Studded Cloak", category: "Armor",      description: "A hooded cloak set with iron studs. Breaks up your silhouette in tree cover.",     weightLbs: 4.0, quantity: 1, isEquipped: false, combatImpactLabel: "+2 AC, Stealth Advantage" }
          : { name: "Ranger's Cloak",         category: "Armor",      description: "A mottled green-brown cloak favoured by wilderness scouts.",                       weightLbs: 2.0, quantity: 1, isEquipped: false, combatImpactLabel: "+1 AC, Stealth Advantage" },
        { name: "Healing Herb Bundle",        category: "Consumable", description: "A tied bundle of dried medicinal herbs. Chewed or brewed into a paste.",           weightLbs: 0.2, quantity: 3, isEquipped: false, combatImpactLabel: "Heal 6 HP over 2 turns" },
      );
      break;

    case "dungeon":
      items.push(
        hi
          ? { name: "Tempered Longsword",  category: "Weapon",     description: "A well-tempered longsword with a single fuller. Holds an edge in the cold dark.",    weightLbs: 3.5,  quantity: 1, isEquipped: false, combatImpactLabel: "+7 Damage, Crit on 19-20" }
          : { name: "Dungeon Shortsword",  category: "Weapon",     description: "A shortsword built for the cramped corridors of old keeps.",                          weightLbs: 2.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+5 Damage" },
        hi
          ? { name: "Chainmail Hauberk",   category: "Armor",      description: "Interlocked iron rings covering the torso. Heavy but reliable in sustained fighting.", weightLbs: 40.0, quantity: 1, isEquipped: false, combatImpactLabel: "+4 AC" }
          : { name: "Banded Leather Vest", category: "Armor",      description: "Stiff leather reinforced with riveted iron bands across the chest.",                  weightLbs: 12.0, quantity: 1, isEquipped: false, combatImpactLabel: "+3 AC" },
        signals.has("altar")
          ? { name: "Blessed Scroll",      category: "Consumable", description: "Parchment inscribed with a warding prayer. Crumbles to ash after use.",               weightLbs: 0.1,  quantity: 1, isEquipped: false, combatImpactLabel: "Cast Shield of Faith" }
          : { name: "Antitoxin Vial",      category: "Consumable", description: "A bitter liquid that neutralises common poisons for about an hour.",                  weightLbs: 0.2,  quantity: 2, isEquipped: false, combatImpactLabel: "Resist Poison 1 hour" },
      );
      break;

    default: // generic
      items.push(
        { name: "Short Sword",    category: "Weapon",     description: "A plain double-edged sword of modest length. The adventurer's standard.", weightLbs: 2.0,  quantity: 1, isEquipped: false, combatImpactLabel: "+4 Damage" },
        { name: "Leather Armour", category: "Armor",      description: "Boiled and hardened leather shaped into a fitted cuirass.",                weightLbs: 10.0, quantity: 1, isEquipped: false, combatImpactLabel: "+2 AC" },
        { name: "Trail Ration",   category: "Consumable", description: "Hard tack and dried meat wrapped in cloth. Keeps for weeks.",             weightLbs: 0.5,  quantity: 3, isEquipped: false, combatImpactLabel: "Restore 2 HP" },
      );
  }

  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const maps = await prisma.map.findMany({
    include: { equippableItems: { select: { id: true } } },
  });

  console.log(`\nFound ${maps.length} map(s) in the database.\n`);

  for (const map of maps) {
    if (map.equippableItems.length > 0) {
      console.log(`  [skip]  "${map.name}" — already has ${map.equippableItems.length} item(s).`);
      continue;
    }

    const data       = parseMapData(map.data);
    const env        = classifyEnv(map.name, data.rooms);
    const complexity = computeComplexity(data);
    const signals    = poiSignals(data.pois);
    const blueprints = buildItems(env, complexity, signals);

    const created = await prisma.$transaction(
      blueprints.map((bp) =>
        prisma.equippableItem.create({ data: { ...bp, mapId: map.id } }),
      ),
    );

    const names = created.map((c) => c.name).join(", ");
    console.log(`  [seed]  "${map.name}"`);
    console.log(`          env=${env}  complexity=${complexity}  rooms=${data.rooms.length}  pois=${data.pois.length}`);
    console.log(`          → ${created.length} items: ${names}\n`);
  }

  console.log("Done.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
