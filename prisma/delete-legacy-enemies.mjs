/**
 * One-time cleanup: delete Enemy rows whose IDs are UUID-format (legacy pre-slug-migration records).
 * Slug-format IDs look like "a1s2_cultist"; UUID-format IDs look like "fcd0cac3-5e41-...".
 *
 * Also removes stale UUID-format enemies from any Game.state.enemies JSON blobs.
 *
 * Usage: node prisma/delete-legacy-enemies.mjs
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  // 1. Find all legacy UUID-format enemies
  const allEnemies = await prisma.enemy.findMany({ select: { id: true, name: true, sceneId: true } });
  const legacy = allEnemies.filter(e => UUID_RE.test(e.id));

  if (legacy.length === 0) {
    console.log("No legacy UUID-format enemies found. Nothing to do.");
    return;
  }

  console.log(`Found ${legacy.length} legacy enemies to delete:`);
  for (const e of legacy) console.log(`  ${e.id} (${e.name}, scene=${e.sceneId})`);

  // 2. Delete them
  const { count } = await prisma.enemy.deleteMany({
    where: { id: { in: legacy.map(e => e.id) } },
  });
  console.log(`Deleted ${count} legacy Enemy rows.`);

  // 3. Scrub UUID enemy IDs from Game.state.enemies JSON blobs
  const games = await prisma.game.findMany({ select: { id: true, state: true } });
  let patchedGames = 0;
  const legacyIds = new Set(legacy.map(e => e.id));

  for (const game of games) {
    const state = game.state;
    if (!state || !Array.isArray(state.enemies)) continue;
    const cleaned = state.enemies.filter(e => !legacyIds.has(e.id));
    if (cleaned.length === state.enemies.length) continue;

    await prisma.game.update({
      where: { id: game.id },
      data:  { state: { ...state, enemies: cleaned } },
    });
    console.log(`  Patched game ${game.id}: removed ${state.enemies.length - cleaned.length} legacy enemies from state.`);
    patchedGames++;
  }

  console.log(`Patched ${patchedGames} game state(s).`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
