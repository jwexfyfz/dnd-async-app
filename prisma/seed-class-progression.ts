import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Types ───────────────────────────────────────────────────────────────────

interface FeatureSeed {
  name: string;
  description: string;
}

interface LevelSeed {
  level: number;
  proficiencyBonus: number;
  featuresUnlocked: string[];
  resourcePoolMax: number | null;
  features: FeatureSeed[];
}

interface ClassSeed {
  characterClass: string;
  levels: LevelSeed[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prof(level: number): number {
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

// ─── Barbarian ───────────────────────────────────────────────────────────────

const BARBARIAN: ClassSeed = {
  characterClass: "Barbarian",
  levels: [
    {
      level: 1, proficiencyBonus: prof(1), resourcePoolMax: 2,
      featuresUnlocked: ["rage", "unarmored-defense"],
      features: [
        { name: "Rage", description: "Bonus action: enter rage. +2 melee dmg, adv on STR checks/saves, resistance to B/P/S dmg. 1 min." },
        { name: "Unarmored Defense", description: "AC = 10 + DEX mod + CON mod when unarmored." },
      ],
    },
    {
      level: 2, proficiencyBonus: prof(2), resourcePoolMax: 2,
      featuresUnlocked: ["reckless-attack", "danger-sense"],
      features: [
        { name: "Reckless Attack", description: "Adv on first STR attack; attackers gain adv vs you until next turn." },
        { name: "Danger Sense", description: "Adv on DEX saves vs visible effects (traps, spells). Not incapacitated required." },
      ],
    },
    {
      level: 3, proficiencyBonus: prof(3), resourcePoolMax: 3,
      featuresUnlocked: ["primal-path"],
      features: [
        { name: "Primal Path", description: "Choose subclass (Berserker, Totem Warrior, etc). Features at 3, 6, 10, 14." },
      ],
    },
    {
      level: 4, proficiencyBonus: prof(4), resourcePoolMax: 3,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5, proficiencyBonus: prof(5), resourcePoolMax: 3,
      featuresUnlocked: ["extra-attack", "fast-movement"],
      features: [
        { name: "Extra Attack", description: "Attack twice when taking Attack action." },
        { name: "Fast Movement", description: "+10 ft speed when not wearing heavy armor." },
      ],
    },
    {
      level: 6, proficiencyBonus: prof(6), resourcePoolMax: 4,
      featuresUnlocked: ["path-feature"],
      features: [
        { name: "Path Feature", description: "Primal Path subclass feature." },
      ],
    },
    {
      level: 7, proficiencyBonus: prof(7), resourcePoolMax: 4,
      featuresUnlocked: ["feral-instinct"],
      features: [
        { name: "Feral Instinct", description: "Adv on initiative. Can enter rage to act normally when surprised." },
      ],
    },
    {
      level: 8, proficiencyBonus: prof(8), resourcePoolMax: 4,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 9, proficiencyBonus: prof(9), resourcePoolMax: 4,
      featuresUnlocked: ["brutal-critical"],
      features: [
        { name: "Brutal Critical", description: "Roll 1 extra weapon die on crit melee hit." },
      ],
    },
    {
      level: 10, proficiencyBonus: prof(10), resourcePoolMax: 4,
      featuresUnlocked: ["path-feature"],
      features: [
        { name: "Path Feature", description: "Primal Path subclass feature." },
      ],
    },
    {
      level: 11, proficiencyBonus: prof(11), resourcePoolMax: 4,
      featuresUnlocked: ["relentless-rage"],
      features: [
        { name: "Relentless Rage", description: "At 0 HP while raging, DC 10 CON save to drop to 1 HP. DC +5 per use per rest." },
      ],
    },
    {
      level: 12, proficiencyBonus: prof(12), resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13, proficiencyBonus: prof(13), resourcePoolMax: 5,
      featuresUnlocked: ["brutal-critical"],
      features: [
        { name: "Brutal Critical", description: "Roll 2 extra weapon dice on crit melee hit." },
      ],
    },
    {
      level: 14, proficiencyBonus: prof(14), resourcePoolMax: 5,
      featuresUnlocked: ["path-feature"],
      features: [
        { name: "Path Feature", description: "Primal Path subclass feature." },
      ],
    },
    {
      level: 15, proficiencyBonus: prof(15), resourcePoolMax: 5,
      featuresUnlocked: ["persistent-rage"],
      features: [
        { name: "Persistent Rage", description: "Rage ends only if unconscious or you choose to end it." },
      ],
    },
    {
      level: 16, proficiencyBonus: prof(16), resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17, proficiencyBonus: prof(17), resourcePoolMax: 6,
      featuresUnlocked: ["brutal-critical"],
      features: [
        { name: "Brutal Critical", description: "Roll 3 extra weapon dice on crit melee hit." },
      ],
    },
    {
      level: 18, proficiencyBonus: prof(18), resourcePoolMax: 6,
      featuresUnlocked: ["indomitable-might"],
      features: [
        { name: "Indomitable Might", description: "If STR check total < STR score, use STR score instead." },
      ],
    },
    {
      level: 19, proficiencyBonus: prof(19), resourcePoolMax: 6,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20, proficiencyBonus: prof(20), resourcePoolMax: null, // unlimited rages
      featuresUnlocked: ["primal-champion"],
      features: [
        { name: "Primal Champion", description: "+4 STR, +4 CON. Rage uses become unlimited." },
      ],
    },
  ],
};

// ─── Bard ─────────────────────────────────────────────────────────────────────
// resourcePoolMax = bardic inspiration die size (6/8/10/12 tracks upgrade steps)

const BARD: ClassSeed = {
  characterClass: "Bard",
  levels: [
    {
      level: 1, proficiencyBonus: prof(1), resourcePoolMax: 6,
      featuresUnlocked: ["spellcasting", "bardic-inspiration"],
      features: [
        { name: "Spellcasting", description: "Cast bard spells using CHA. Start with 2 cantrips, 4 spells known." },
        { name: "Bardic Inspiration (d6)", description: "Bonus action: grant d6 inspiration die to creature within 60 ft. Uses = CHA mod per long rest." },
      ],
    },
    {
      level: 2, proficiencyBonus: prof(2), resourcePoolMax: 6,
      featuresUnlocked: ["jack-of-all-trades", "song-of-rest"],
      features: [
        { name: "Jack of All Trades", description: "Add half proficiency bonus to non-proficient ability checks." },
        { name: "Song of Rest (d6)", description: "Creatures regain extra 1d6 HP on short rest while you perform." },
      ],
    },
    {
      level: 3, proficiencyBonus: prof(3), resourcePoolMax: 6,
      featuresUnlocked: ["expertise", "bard-college"],
      features: [
        { name: "Expertise", description: "Double proficiency bonus on 2 chosen proficient skills." },
        { name: "Bard College", description: "Choose subclass (Lore, Valor, etc). Features at 3, 6, 14." },
      ],
    },
    {
      level: 4, proficiencyBonus: prof(4), resourcePoolMax: 6,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5, proficiencyBonus: prof(5), resourcePoolMax: 8,
      featuresUnlocked: ["bardic-inspiration-d8", "font-of-inspiration"],
      features: [
        { name: "Bardic Inspiration (d8)", description: "Inspiration die upgrades to d8." },
        { name: "Font of Inspiration", description: "Regain all bardic inspiration uses on short or long rest." },
      ],
    },
    {
      level: 6, proficiencyBonus: prof(6), resourcePoolMax: 8,
      featuresUnlocked: ["countercharm", "bard-college-feature"],
      features: [
        { name: "Countercharm", description: "Action: grant adv on saves vs frightened/charmed to creatures within 30 ft that can hear you." },
        { name: "Bard College Feature", description: "Bard College subclass feature." },
      ],
    },
    {
      level: 7, proficiencyBonus: prof(7), resourcePoolMax: 8,
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 8, proficiencyBonus: prof(8), resourcePoolMax: 8,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 9, proficiencyBonus: prof(9), resourcePoolMax: 8,
      featuresUnlocked: ["song-of-rest-d8"],
      features: [
        { name: "Song of Rest (d8)", description: "Short rest healing die upgrades to d8." },
      ],
    },
    {
      level: 10, proficiencyBonus: prof(10), resourcePoolMax: 10,
      featuresUnlocked: ["bardic-inspiration-d10", "expertise", "magical-secrets"],
      features: [
        { name: "Bardic Inspiration (d10)", description: "Inspiration die upgrades to d10." },
        { name: "Expertise", description: "Double proficiency bonus on 2 additional proficient skills." },
        { name: "Magical Secrets", description: "Learn 2 spells from any class spell list." },
      ],
    },
    {
      level: 11, proficiencyBonus: prof(11), resourcePoolMax: 10,
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 12, proficiencyBonus: prof(12), resourcePoolMax: 10,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13, proficiencyBonus: prof(13), resourcePoolMax: 10,
      featuresUnlocked: ["song-of-rest-d10"],
      features: [
        { name: "Song of Rest (d10)", description: "Short rest healing die upgrades to d10." },
      ],
    },
    {
      level: 14, proficiencyBonus: prof(14), resourcePoolMax: 10,
      featuresUnlocked: ["magical-secrets", "bard-college-feature"],
      features: [
        { name: "Magical Secrets", description: "Learn 2 additional spells from any class spell list." },
        { name: "Bard College Feature", description: "Bard College subclass feature." },
      ],
    },
    {
      level: 15, proficiencyBonus: prof(15), resourcePoolMax: 12,
      featuresUnlocked: ["bardic-inspiration-d12"],
      features: [
        { name: "Bardic Inspiration (d12)", description: "Inspiration die upgrades to d12." },
      ],
    },
    {
      level: 16, proficiencyBonus: prof(16), resourcePoolMax: 12,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17, proficiencyBonus: prof(17), resourcePoolMax: 12,
      featuresUnlocked: ["song-of-rest-d12"],
      features: [
        { name: "Song of Rest (d12)", description: "Short rest healing die upgrades to d12." },
      ],
    },
    {
      level: 18, proficiencyBonus: prof(18), resourcePoolMax: 12,
      featuresUnlocked: ["magical-secrets"],
      features: [
        { name: "Magical Secrets", description: "Learn 2 additional spells from any class spell list." },
      ],
    },
    {
      level: 19, proficiencyBonus: prof(19), resourcePoolMax: 12,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20, proficiencyBonus: prof(20), resourcePoolMax: 12,
      featuresUnlocked: ["superior-inspiration"],
      features: [
        { name: "Superior Inspiration", description: "Roll initiative with 0 bardic inspiration uses: regain 1 use." },
      ],
    },
  ],
};

// ─── Registry — append new classes here ──────────────────────────────────────

const CLASSES: ClassSeed[] = [BARBARIAN, BARD];

// ─── Seed engine ─────────────────────────────────────────────────────────────

async function seedClass(seed: ClassSeed): Promise<void> {
  const { characterClass, levels } = seed;
  console.log(`Seeding ${characterClass}...`);

  // Delete features first (FK dependency on ClassProgression)
  await prisma.classFeature.deleteMany({ where: { characterClass } });

  for (const lvl of levels) {
    await prisma.classProgression.upsert({
      where: { characterClass_level: { characterClass, level: lvl.level } },
      update: {
        proficiencyBonus: lvl.proficiencyBonus,
        featuresUnlocked: lvl.featuresUnlocked,
        resourcePoolMax:  lvl.resourcePoolMax,
      },
      create: {
        characterClass,
        level:            lvl.level,
        proficiencyBonus: lvl.proficiencyBonus,
        featuresUnlocked: lvl.featuresUnlocked,
        resourcePoolMax:  lvl.resourcePoolMax,
      },
    });

    if (lvl.features.length > 0) {
      await prisma.classFeature.createMany({
        data: lvl.features.map((f) => ({
          characterClass,
          level:       lvl.level,
          name:        f.name,
          description: f.description,
        })),
      });
    }
  }

  console.log(`  ✓ ${characterClass}: ${levels.length} levels seeded`);
}

async function main(): Promise<void> {
  console.log(`Seeding class progression data (${CLASSES.length} classes)...`);
  for (const cls of CLASSES) {
    await seedClass(cls);
  }
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
