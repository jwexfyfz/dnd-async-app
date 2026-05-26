/**
 * Seed script: inject realistic SuggestionChips into all active games so the
 * FieldTab has chips to display during local development.
 *
 * Usage:
 *   npx tsx scripts/seed-test-chips.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

// Load env before any Prisma import resolves — use sync config() then dynamic import.
config({ path: resolve(process.cwd(), ".env.local") });

const TEST_CHIPS = [
  {
    id:             "seed-1",
    label:          "Strike with weapon",
    type:           "none",
    requiresRoll:   true,
    advantageState: "NONE",
    action_type:    "mainAction",
    movementFeet:   0,
    spellLevel:     0,
  },
  {
    id:             "seed-2",
    label:          "Scan the shadows",
    type:           "perception",
    requiresRoll:   true,
    advantageState: "NONE",
    action_type:    "mainAction",
    movementFeet:   0,
    spellLevel:     0,
  },
  {
    id:             "seed-3",
    label:          "Attempt to sneak past",
    type:           "stealth",
    requiresRoll:   true,
    advantageState: "NONE",
    action_type:    "mainAction",
    movementFeet:   0,
    spellLevel:     0,
  },
  {
    id:             "seed-4",
    label:          "Dash for cover",
    type:           "none",
    requiresRoll:   false,
    advantageState: "NONE",
    action_type:    "movement",
    movementFeet:   30,
    spellLevel:     0,
  },
  {
    id:             "seed-5",
    label:          "Investigate the runes",
    type:           "investigation",
    requiresRoll:   true,
    advantageState: "NONE",
    action_type:    "mainAction",
    movementFeet:   0,
    spellLevel:     0,
  },
];

async function main() {
  // Dynamic import so Prisma initialises after dotenv has populated process.env.
  const { prisma } = await import("../lib/prisma");

  const games = await prisma.game.findMany({
    where:  { status: "ACTIVE" },
    select: { id: true, character: { select: { name: true } } },
  });

  if (games.length === 0) {
    console.log("No active games found.");
    return;
  }

  for (const game of games) {
    await prisma.game.update({
      where: { id: game.id },
      data:  { activeSuggestionChips: TEST_CHIPS as any },
    });
    console.log(`✓ seeded chips for game ${game.id} (${game.character.name})`);
  }

  console.log(`Done — seeded ${games.length} game(s).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
