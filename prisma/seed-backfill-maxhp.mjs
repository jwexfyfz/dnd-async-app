// prisma/seed-backfill-maxhp.mjs
// One-shot post-migration backfill: sets every Character.maxHp to the
// class-correct value computed by maxHpAtLevel(characterClass, constitution, level).
//
// Run with: npm run db:backfill-maxhp
//
// Mirror of lib/leveling.ts maxHpAtLevel — kept inline because this is a
// one-shot ESM backfill script and importing .ts files directly from .mjs is
// unsupported without tsx or a build step. If lib/leveling.ts formula changes,
// regenerate this file from it.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Inline leveling math (mirrors lib/leveling.ts exactly) ──────────────────

/** Class hit dice per D&D Basic Rules 2014. Mirror of HIT_DIE_BY_CLASS in lib/leveling.ts. */
const HIT_DIE_BY_CLASS = {
  Fighter: { die: 10, avg: 6 },
  Rogue:   { die: 8,  avg: 5 },
  Cleric:  { die: 8,  avg: 5 },
  Wizard:  { die: 6,  avg: 4 },
};

/** floor((score - 10) / 2) — mirrors abilityModifier in lib/dice.ts. */
function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

/**
 * Returns total max HP for a character at the given level.
 * Mirrors maxHpAtLevel in lib/leveling.ts exactly.
 * Throws Error("Unknown class: <value>") for unrecognised classes.
 */
function maxHpAtLevel(characterClass, constitution, level) {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  const conMod = abilityModifier(constitution);
  let hp = hitDie.die + conMod;
  for (let l = 2; l <= level; l++) {
    hp += hitDie.avg + conMod;
  }
  return hp;
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, characterClass: true, constitution: true, level: true, maxHp: true },
  });

  let updated = 0;
  const total = characters.length;

  for (const row of characters) {
    let correctMaxHp;
    try {
      correctMaxHp = maxHpAtLevel(row.characterClass, row.constitution, row.level);
    } catch (err) {
      console.warn(`Skipping character ${row.id}: unknown class "${row.characterClass}"`);
      continue;
    }

    if (correctMaxHp !== row.maxHp) {
      await prisma.character.update({
        where: { id: row.id },
        data:  { maxHp: correctMaxHp },
      });
      updated++;
    }
  }

  console.log(`Updated ${updated} of ${total} characters`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
