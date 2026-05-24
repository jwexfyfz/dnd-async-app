// prisma/seed-backfill-skills.mjs
// Idempotent post-migration backfill: for every Character with an empty
// skillProficiencies array, assigns thematic class defaults drawn from
// D&D Basic Rules 2014.
//
// Run with: npm run db:backfill-skills
//
// Defaults are inlined — this is a .mjs script and cannot import .ts files
// directly without a build step. If CLASS_SKILL_POOL in lib/skills.ts changes,
// update BACKFILL_DEFAULTS here to match.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Thematic defaults per class (mirrors CLASS_SKILL_POOL picks) ─────────────
// Source: D&D Basic Rules 2014 — most representative two skills per class.
// These match the class flavour: Fighter = physical might, Rogue = stealth/awareness,
// Cleric = divine insight, Wizard = arcane knowledge.

const BACKFILL_DEFAULTS = {
  Fighter: ["Athletics", "Intimidation"],
  Rogue:   ["Stealth", "Perception"],
  Cleric:  ["Insight", "Religion"],
  Wizard:  ["Arcana", "Investigation"],
};

// ─── Backfill ─────────────────────────────────────────────────────────────────

async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, characterClass: true, skillProficiencies: true },
  });

  let updated = 0;
  const total = characters.length;

  for (const row of characters) {
    // Idempotent: skip characters that already have skill proficiencies set.
    if (row.skillProficiencies.length > 0) {
      continue;
    }

    const defaults = BACKFILL_DEFAULTS[row.characterClass];
    if (!defaults) {
      console.warn(
        `Skipping character ${row.id}: unknown class "${row.characterClass}" — no backfill defaults defined`
      );
      continue;
    }

    await prisma.character.update({
      where: { id: row.id },
      data:  { skillProficiencies: defaults },
    });
    updated++;
  }

  console.log(`Updated ${updated} of ${total} characters`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
