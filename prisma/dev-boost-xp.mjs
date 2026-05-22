// prisma/dev-boost-xp.mjs
// Sets a character's XP to just below a level threshold for fast level-up testing.
// Run with: npm run db:boost-xp [characterName] [targetLevel]
//
// Examples:
//   npm run db:boost-xp                    → list all characters + current XP
//   npm run db:boost-xp "Thora" 2          → set Thora to 250 XP (50 below level-2 at 300)
//   npm run db:boost-xp "Thora" 5          → set Thora to 6450 XP (50 below level-5 at 6500)

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Inline math (mirrors lib/leveling.ts + lib/xp.ts) ───────────────────────

const XP_THRESHOLDS = [0, 300, 900, 2700, 6500];

const HIT_DIE_BY_CLASS = {
  Fighter: { die: 10, avg: 6 },
  Rogue:   { die: 8,  avg: 5 },
  Cleric:  { die: 8,  avg: 5 },
  Wizard:  { die: 6,  avg: 4 },
};

function abilityModifier(score) { return Math.floor((score - 10) / 2); }

function computeLevel(xp) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1; else break;
  }
  return level;
}

function maxHpAtLevel(characterClass, constitution, level) {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  const conMod = abilityModifier(constitution);
  let hp = hitDie.die + conMod;
  for (let l = 2; l <= level; l++) hp += hitDie.avg + conMod;
  return hp;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, charName, targetLevelArg] = process.argv;

async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, name: true, characterClass: true, constitution: true, xp: true, level: true, maxHp: true },
    orderBy: { name: "asc" },
  });

  if (!charName) {
    console.log("\nAll characters:\n");
    for (const c of characters) {
      const nextThreshold = XP_THRESHOLDS[c.level] ?? null;
      const toNext = nextThreshold !== null ? `(${nextThreshold - c.xp} XP to level ${c.level + 1})` : "(max level)";
      console.log(`  ${c.name.padEnd(20)} ${c.characterClass.padEnd(10)} XP: ${String(c.xp).padStart(5)}  Level: ${c.level}  maxHp: ${c.maxHp}  ${toNext}`);
    }
    console.log(`\nUsage: npm run db:boost-xp "<name>" <targetLevel>`);
    console.log(`  Levels: 2 (300 XP), 3 (900 XP), 4 (2700 XP), 5 (6500 XP)`);
    console.log(`  One Veteran encounter (200 XP) + "The Proving Grounds" story = fastest test path.`);
    return;
  }

  const targetLevel = parseInt(targetLevelArg ?? "2", 10);
  if (targetLevel < 2 || targetLevel > 5) {
    console.error("Target level must be 2–5."); process.exit(1);
  }

  const char = characters.find(c => c.name.toLowerCase() === charName.toLowerCase());
  if (!char) {
    console.error(`"${charName}" not found. Available: ${characters.map(c => c.name).join(", ")}`);
    process.exit(1);
  }

  // 50 XP below the threshold — one Veteran encounter (200 XP) crosses it.
  const threshold = XP_THRESHOLDS[targetLevel - 1];
  const newXp = Math.max(threshold - 50, 0);
  const newLevel = computeLevel(newXp);
  const newMaxHp = maxHpAtLevel(char.characterClass, char.constitution, newLevel);

  await prisma.character.update({
    where: { id: char.id },
    data:  { xp: newXp, level: newLevel, maxHp: newMaxHp },
  });

  console.log(`\n✓ ${char.name} (${char.characterClass})`);
  console.log(`  XP:    ${char.xp} → ${newXp}  (${threshold - newXp} XP from level ${targetLevel})`);
  console.log(`  Level: ${char.level} → ${newLevel}`);
  console.log(`  maxHp: ${char.maxHp} → ${newMaxHp}`);
  console.log(`\nNext step: start a game with "The Proving Grounds" (Veteran).`);
  console.log(`One encounter resolves → level ${targetLevel} + LevelUpCard appears.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
