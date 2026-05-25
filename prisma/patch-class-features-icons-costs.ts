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

type CostType = "mainAction" | "bonusAction" | "movementSteps" | "free";

interface Patch {
  name: string;
  icon: string;
  costType: CostType;
}

// ─── Barbarian ───────────────────────────────────────────────────────────────
// Names sourced from seed-class-progression.ts BARBARIAN.levels[*].features[*].name

const BARBARIAN: Patch[] = [
  // Activation features
  { name: "Rage",              icon: "🔥", costType: "bonusAction" }, // PHB: "On your turn, you can enter a rage as a bonus action"

  // Passive / always-on
  { name: "Unarmored Defense", icon: "🛡️", costType: "free"        },
  { name: "Reckless Attack",   icon: "⚔️", costType: "free"        }, // decision on first attack, not a separate action
  { name: "Danger Sense",      icon: "👁️", costType: "free"        },
  { name: "Primal Path",       icon: "🐾", costType: "free"        }, // subclass choice
  { name: "Path Feature",      icon: "🐾", costType: "free"        }, // subclass feature (varies, default free)
  { name: "Extra Attack",      icon: "⚔️", costType: "free"        }, // passive Attack action modifier
  { name: "Fast Movement",     icon: "💨", costType: "free"        },
  { name: "Feral Instinct",    icon: "🦅", costType: "free"        }, // passive initiative advantage
  { name: "Brutal Critical",   icon: "💥", costType: "free"        }, // passive crit modifier (covers L9/13/17)
  { name: "Relentless Rage",   icon: "😤", costType: "free"        }, // reactive CON save trigger, no action
  { name: "Persistent Rage",   icon: "♾️", costType: "free"        },
  { name: "Indomitable Might", icon: "💪", costType: "free"        },
  { name: "Primal Champion",   icon: "👑", costType: "free"        },
  { name: "ASI",               icon: "⬆️", costType: "free"        }, // covers L4/8/12/16/19
];

// ─── Bard ─────────────────────────────────────────────────────────────────────

const BARD: Patch[] = [
  // Activation features
  { name: "Spellcasting",            icon: "🎶", costType: "mainAction"  }, // casting a spell is a main action
  { name: "Bardic Inspiration (d6)", icon: "🎸", costType: "bonusAction" }, // PHB: "As a bonus action"
  { name: "Bardic Inspiration (d8)", icon: "🎸", costType: "bonusAction" },
  { name: "Bardic Inspiration (d10)",icon: "🎸", costType: "bonusAction" },
  { name: "Bardic Inspiration (d12)",icon: "🎸", costType: "bonusAction" },
  { name: "Countercharm",            icon: "🎭", costType: "mainAction"  }, // PHB: "you can start a performance...as an action"

  // Passive
  { name: "Jack of All Trades",  icon: "🃏", costType: "free" },
  { name: "Song of Rest (d6)",   icon: "🎵", costType: "free" }, // used during short rest, no in-combat action
  { name: "Song of Rest (d8)",   icon: "🎵", costType: "free" },
  { name: "Song of Rest (d10)",  icon: "🎵", costType: "free" },
  { name: "Song of Rest (d12)",  icon: "🎵", costType: "free" },
  { name: "Expertise",           icon: "🔍", costType: "free" }, // covers L3 and L10
  { name: "Bard College",        icon: "🎓", costType: "free" },
  { name: "Bard College Feature",icon: "🎓", costType: "free" }, // covers L6 and L14
  { name: "Font of Inspiration", icon: "✨", costType: "free" }, // passive recharge upgrade
  { name: "Magical Secrets",     icon: "📚", costType: "free" }, // covers L10, L14, L18
  { name: "Superior Inspiration",icon: "💫", costType: "free" },
  { name: "ASI",                 icon: "⬆️", costType: "free" }, // covers L4/8/12/16/19
];

// ─── Fighter ─────────────────────────────────────────────────────────────────

const FIGHTER: Patch[] = [
  // Activation features
  { name: "Second Wind",   icon: "💨", costType: "bonusAction" }, // PHB: "use a bonus action to regain hit points"
  // Action Surge is a free "declare on your turn" that grants +1 action; no action type itself
  { name: "Action Surge",         icon: "⚡", costType: "free" },
  { name: "Action Surge (2 uses)",icon: "⚡", costType: "free" },

  // Passive
  { name: "Fighting Style",                  icon: "🗡️", costType: "free" },
  { name: "Martial Archetype",               icon: "⚔️", costType: "free" }, // subclass choice
  { name: "Martial Archetype Feature",       icon: "⚔️", costType: "free" }, // covers L7/10/15/18
  { name: "Combat Maneuvers (d8)",           icon: "🎯", costType: "free" }, // grants access; individual maneuver cost varies
  { name: "Improved Combat Maneuvers (d10)", icon: "🎯", costType: "free" },
  { name: "Improved Combat Maneuvers (d12)", icon: "🎯", costType: "free" },
  { name: "Extra Attack",                    icon: "⚔️", costType: "free" },
  { name: "Extra Attack (2)",                icon: "⚔️", costType: "free" },
  { name: "Extra Attack (3)",                icon: "⚔️", costType: "free" },
  // Indomitable triggers reactively when failing a save — no action cost
  { name: "Indomitable",          icon: "🛡️", costType: "free" },
  { name: "Indomitable (2 uses)", icon: "🛡️", costType: "free" },
  { name: "Indomitable (3 uses)", icon: "🛡️", costType: "free" },
  { name: "ASI",                  icon: "⬆️", costType: "free" }, // covers L4/6/8/12/14/16/19
];

// ─── Rogue ────────────────────────────────────────────────────────────────────

const ROGUE: Patch[] = [
  // Activation features
  { name: "Cunning Action", icon: "💨", costType: "bonusAction" }, // PHB: "you can take a bonus action on each of your turns"

  // Passive / reactive
  { name: "Expertise",              icon: "🔍", costType: "free" }, // covers L1 and L6
  { name: "Sneak Attack",           icon: "🗡️", costType: "free" }, // passive once-per-turn bonus
  { name: "Thieves' Cant",          icon: "🤫", costType: "free" },
  { name: "Roguish Archetype",      icon: "🎭", costType: "free" }, // subclass choice
  { name: "Roguish Archetype Feature",icon:"🎭", costType: "free" }, // covers L9/13/17
  // Uncanny Dodge uses your reaction when hit — no standard action type
  { name: "Uncanny Dodge",   icon: "🛡️", costType: "free" },
  { name: "Evasion",         icon: "🌀", costType: "free" },
  { name: "Reliable Talent", icon: "✨", costType: "free" },
  { name: "Blindsense",      icon: "👁️", costType: "free" },
  { name: "Slippery Mind",   icon: "🧠", costType: "free" }, // WIS save proficiency
  { name: "Elusive",         icon: "👻", costType: "free" }, // no-advantage-against-you
  // Stroke of Luck: reactive trigger when missing/failing — no action cost
  { name: "Stroke of Luck",  icon: "🍀", costType: "free" },
  { name: "ASI",             icon: "⬆️", costType: "free" }, // covers L4/8/10/12/16/19
];

// ─── Engine ───────────────────────────────────────────────────────────────────

async function patchClass(characterClass: string, patches: Patch[]): Promise<void> {
  console.log(`Patching ${characterClass}...`);
  let totalRows = 0;

  for (const { name, icon, costType } of patches) {
    const result = await prisma.classFeature.updateMany({
      where: { characterClass, name },
      data:  { icon, costType },
    });
    totalRows += result.count;
  }

  console.log(`  ✓ ${characterClass}: ${totalRows} rows updated`);
}

async function main(): Promise<void> {
  await patchClass("Barbarian", BARBARIAN);
  await patchClass("Bard",      BARD);
  await patchClass("Fighter",   FIGHTER);
  await patchClass("Rogue",     ROGUE);
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
