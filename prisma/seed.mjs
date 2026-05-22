// prisma/seed.mjs
// Populates the database with the initial set of maps and story prompts.
// Run with: npm run db:seed
//
// Uses dynamic imports so that dotenv has already set process.env before
// Prisma reads DATABASE_URL.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Map data ─────────────────────────────────────────────────────────────────
// Tile key: "W" = wall, "F" = floor, "D" = door
// Maps are designed to be readable as grids — read left-to-right, top-to-bottom.

const cellarMap = {
  width: 10,
  height: 5,
  // Two rooms connected by a door in column 4.
  // Left room: storage area where the player starts.
  // Right room: hidden chamber with a locked chest.
  tiles: [
    ["W","W","W","W","W","W","W","W","W","W"],
    ["W","F","F","F","W","F","F","F","F","W"],
    ["W","F","F","F","D","F","F","F","F","W"],
    ["W","F","F","F","W","F","F","F","F","W"],
    ["W","W","W","W","W","W","W","W","W","W"],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Storage Room",    description: "Dusty shelves and forgotten crates. Something smells off." },
    { name: "Hidden Chamber",  description: "Arcane symbols scratch the stone. Someone was working here." },
  ],
  pois: [
    { id: "chest_1",   name: "Locked Chest",  x: 7, y: 3, symbol: "C" },
    { id: "stairs_up", name: "Stairs Up",      x: 2, y: 3, symbol: "^" },
  ],
};

const mineMap = {
  width: 12,
  height: 7,
  // Mine shaft with two tunnels connected by doors.
  // Entry tunnel (top-left), main shaft (center), deeper section (right).
  tiles: [
    ["W","W","W","W","W","W","W","W","W","W","W","W"],
    ["W","F","F","W","W","W","W","W","W","W","W","W"],
    ["W","F","F","D","F","F","F","W","W","W","W","W"],
    ["W","W","W","W","F","F","F","W","W","W","W","W"],
    ["W","W","W","W","F","F","F","D","F","F","F","W"],
    ["W","W","W","W","W","W","W","F","F","F","F","W"],
    ["W","W","W","W","W","W","W","W","W","W","W","W"],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Mine Entrance",   description: "Pickaxes lean against the wall. Fresh air comes from above." },
    { name: "Main Shaft",      description: "Ore-veins run through the walls. A collapsed beam blocks one passage." },
    { name: "Deep Excavation", description: "The foreman's lantern still burns. Nobody has been here in days." },
  ],
  pois: [
    { id: "pickaxe",    name: "Miner's Pickaxe", x: 2,  y: 2,  symbol: "P" },
    { id: "ore_vein",   name: "Silver Vein",      x: 5,  y: 3,  symbol: "O" },
    { id: "lantern",    name: "Foreman's Lantern", x: 9,  y: 5,  symbol: "L" },
  ],
};

// Small 6×4 arena: one open room, no doors, nowhere to hide.
// Every turn is a fight — perfect for testing level-up without navigating story.
const arenaMap = {
  width: 6,
  height: 4,
  tiles: [
    ["W","W","W","W","W","W"],
    ["W","F","F","F","F","W"],
    ["W","F","F","F","F","W"],
    ["W","W","W","W","W","W"],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Proving Grounds", description: "Sand. Blood. An endless stream of challengers." },
  ],
  pois: [
    { id: "gate", name: "Iron Gate", x: 4, y: 2, symbol: "G" },
  ],
};

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding maps and story prompts...");

  // upsert by name so re-running the seed is safe.
  const cellar = await prisma.map.upsert({
    where:  { name: "Abandoned Cellar" },
    update: { data: cellarMap },
    create: { name: "Abandoned Cellar", data: cellarMap },
  });

  const mine = await prisma.map.upsert({
    where:  { name: "Thornwood Mine, Level 1" },
    update: { data: mineMap },
    create: { name: "Thornwood Mine, Level 1", data: mineMap },
  });

  await prisma.storyPrompt.upsert({
    where:  { title: "The Innkeeper's Debt" },
    update: {},
    create: {
      title:      "The Innkeeper's Debt",
      description:
        "A desperate innkeeper pulls you aside at closing time. Coin has gone missing from the cellar — and so has her nephew. She suspects foul play but can't involve the town guard. She needs someone quiet.",
      difficulty: "Beginner",
      mapId:      cellar.id,
    },
  });

  await prisma.storyPrompt.upsert({
    where:  { title: "Collapse at Thornwood Mine" },
    update: {},
    create: {
      title:      "Collapse at Thornwood Mine",
      description:
        "Three miners are missing after a partial collapse in the Thornwood shafts. The mining company is stalling. The miners' families are not. They've pooled what little coin they have — and they're looking at you.",
      difficulty: "Standard",
      mapId:      mine.id,
    },
  });

  const arena = await prisma.map.upsert({
    where:  { name: "Proving Grounds Arena" },
    update: { data: arenaMap },
    create: { name: "Proving Grounds Arena", data: arenaMap },
  });

  await prisma.storyPrompt.upsert({
    where:  { title: "The Proving Grounds" },
    update: {},
    create: {
      title:      "The Proving Grounds",
      // Heavy-combat description: Claude reads this in the system prompt and
      // treats every player action as triggering an immediate enemy attack.
      // Each exchange ends with a defeated enemy so encounterResult fires fast.
      description:
        "You are locked in a gladiatorial proving grounds. Wave after wave of enemies floods the arena. There is no story here — only combat. IMPORTANT DUNGEON MASTER RULES FOR THIS SCENARIO: (1) Begin combat immediately on the very first turn. (2) Every player action results in a fight with one enemy. (3) Resolve each fight completely within 1-2 turns — the enemy is defeated quickly. (4) Set encounterResult to 'completed' as soon as the enemy falls. (5) Immediately spawn a new enemy for the next turn. Keep the player in constant back-to-back combat with no downtime.",
      difficulty: "Veteran",
      mapId:      arena.id,
    },
  });

  console.log("Done. 3 maps, 3 story prompts seeded.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
