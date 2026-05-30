// Temporary: seeds test items for game 93445297-c78d-4fca-8271-7e5b2dc45b52
// Run with: npx tsx prisma/seed-test-items.ts
// Safe to delete after testing.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Items are now tracked in GameMap.data.items (per-game, per-act).
  // This seed is obsolete. Use the backfill script (prisma/backfill-game-maps.mjs) instead.
  console.log("seed-test-items: no-op (items moved to GameMap.data)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
