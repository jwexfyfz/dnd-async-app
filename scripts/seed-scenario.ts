/**
 * Seeds the most-recently-updated active game with a vivid opening scenario
 * and a contextual set of SuggestionChips for manual testing.
 *
 * Usage:  npx tsx scripts/seed-scenario.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const { prisma } = await import("../lib/prisma");

  const game = await prisma.game.findFirst({
    where:   { status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    include: { character: true, story: true, currentAct: true, currentScene: true, map: true },
  });

  if (!game) { console.log("No active games found."); return; }

  const char = game.character;
  console.log(`Seeding game ${game.id} — ${char.name} the ${char.characterClass} (${game.story?.title ?? game.currentScene?.title ?? "Unknown"})`);

  const scenario = `${char.name} steps into a torchlit guard room. Two goblin sentries snap to attention — one levels a rusty crossbow from behind an overturned table, the other grips a jagged shortsword and bares its teeth. A heavy iron door on the far wall bears a padlock; beside it hangs a ring of keys, just out of reach. The air reeks of damp fur and stale ale.`;

  const chips = [
    {
      id: "seed-atk-1",
      label: "Strike the sword goblin",
      type: "strength",
      requiresRoll: true,
      advantageState: "NONE",
      action_type: "mainAction",
      movementFeet: 0,
      spellLevel: 0,
    },
    {
      id: "seed-atk-2",
      label: "Charge the crossbow goblin",
      type: "strength",
      requiresRoll: true,
      advantageState: "NONE",
      action_type: "mainAction",
      movementFeet: 0,
      spellLevel: 0,
    },
    {
      id: "seed-stealth-1",
      label: "Duck behind the table",
      type: "stealth",
      requiresRoll: true,
      advantageState: "NONE",
      action_type: "movement",
      movementFeet: 15,
      spellLevel: 0,
    },
    {
      id: "seed-perc-1",
      label: "Scan for other exits",
      type: "perception",
      requiresRoll: true,
      advantageState: "NONE",
      action_type: "mainAction",
      movementFeet: 0,
      spellLevel: 0,
    },
    {
      id: "seed-free-1",
      label: "Grab the key ring",
      type: "none",
      requiresRoll: false,
      advantageState: "NONE",
      action_type: "free",
      movementFeet: 0,
      spellLevel: 0,
    },
  ];

  await prisma.game.update({
    where: { id: game.id },
    data: {
      narrativeHistory:      { set: [scenario] },
      activeSuggestionChips: chips as any,
      // Also patch game.state so the map renderer / objective line still has data
      state: {
        ...(game.state as object),
        activeObjective: "Clear the guard room and get through the iron door.",
        narrative_history: [scenario],
        active_suggestion_chips: chips,
      },
    },
  });

  console.log("✓ scenario seeded");
  console.log("✓ chips seeded:", chips.map((c) => c.label).join(", "));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
