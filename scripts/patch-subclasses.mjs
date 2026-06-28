import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Upserts all subclass rows. Safe to run multiple times.
const SUBCLASSES = [
  // Fighter
  { characterClass: "Fighter", key: "champion",       name: "Champion",          blurb: "A master of raw physical power. Simple, devastating, and brutally effective.",         playstyleTag: "high damage",       keyStat: "STR or DEX", available: true  },
  { characterClass: "Fighter", key: "battle_master",  name: "Battle Master",     blurb: "A tactical fighter who studies combat maneuvers. Precision over brute force.",          playstyleTag: "tactical",          keyStat: "STR",        available: false },
  { characterClass: "Fighter", key: "eldritch_knight",name: "Eldritch Knight",   blurb: "A warrior who weaves magic into their combat. Steel and spell as one.",                 playstyleTag: "arcane warrior",    keyStat: "STR/INT",    available: false },
  // Rogue
  { characterClass: "Rogue",   key: "thief",          name: "Thief",             blurb: "Quick fingers and quicker feet. Masters of stealth and larceny.",                       playstyleTag: "stealth & loot",    keyStat: "DEX",        available: true  },
  { characterClass: "Rogue",   key: "assassin",       name: "Assassin",          blurb: "Patient, precise, and lethal. You plan the kill before combat begins.",                 playstyleTag: "burst damage",      keyStat: "DEX",        available: true  },
  { characterClass: "Rogue",   key: "arcane_trickster",name: "Arcane Trickster", blurb: "Magic enhances your thievery. Illusions and enchantments are your tools.",              playstyleTag: "arcane stealth",    keyStat: "DEX/INT",    available: false },
  // Barbarian
  { characterClass: "Barbarian", key: "berserker",    name: "Berserker",         blurb: "Fury without limit. You can frenzy for additional bonus action attacks.",               playstyleTag: "max damage",        keyStat: "STR",        available: true  },
  { characterClass: "Barbarian", key: "totem_warrior",name: "Totem Warrior",     blurb: "A spiritual warrior who channels the power of animal spirits.",                         playstyleTag: "versatile",         keyStat: "STR/CON",    available: true  },
  { characterClass: "Barbarian", key: "wild_magic",   name: "Wild Magic",        blurb: "Chaos surges from you in battle. Unpredictable and explosive.",                         playstyleTag: "chaos",             keyStat: "STR",        available: true  },
  // Ranger
  { characterClass: "Ranger",  key: "hunter",         name: "Hunter",            blurb: "A relentless pursuer. Colossus Slayer and multi-target techniques.",                    playstyleTag: "damage dealer",     keyStat: "DEX",        available: true  },
  { characterClass: "Ranger",  key: "beast_master",   name: "Beast Master",      blurb: "You and your animal companion fight as one.",                                            playstyleTag: "companion",         keyStat: "DEX/WIS",    available: true  },
  { characterClass: "Ranger",  key: "gloom_stalker",  name: "Gloom Stalker",     blurb: "Hunter of the dark. Terrifying to enemies who rely on darkness.",                       playstyleTag: "ambush predator",   keyStat: "DEX/WIS",    available: true  },
  // Paladin
  { characterClass: "Paladin", key: "devotion",       name: "Oath of Devotion",  blurb: "The classic holy warrior. Sacred Weapon and Turn the Unholy.",                          playstyleTag: "holy protector",    keyStat: "STR/CHA",    available: true  },
  { characterClass: "Paladin", key: "ancients",       name: "Oath of the Ancients", blurb: "Light in the darkness. Nature's guardian with strong defensive auras.",              playstyleTag: "nature defender",   keyStat: "STR/CHA",    available: true  },
  { characterClass: "Paladin", key: "vengeance",      name: "Oath of Vengeance", blurb: "Punishing the wicked without mercy. Vow of Enmity locks onto one target.",              playstyleTag: "damage focused",    keyStat: "STR/CHA",    available: true  },
  // Monk
  { characterClass: "Monk",    key: "open_hand",      name: "Way of the Open Hand", blurb: "Master of unarmed combat. Control enemies with pushes, trips, and denials.",         playstyleTag: "control & mobility",keyStat: "DEX/WIS",    available: true  },
  { characterClass: "Monk",    key: "shadow",         name: "Way of Shadow",     blurb: "A monk trained in the art of darkness. Teleport between shadows.",                      playstyleTag: "stealth striker",   keyStat: "DEX/WIS",    available: true  },
  { characterClass: "Monk",    key: "four_elements",  name: "Way of the Four Elements", blurb: "Channel elemental power through your ki.",                                        playstyleTag: "elemental",         keyStat: "DEX/WIS",    available: false },
  // Cleric
  { characterClass: "Cleric",  key: "life",           name: "Life Domain",       blurb: "Master healer. Disciple of Life makes your spells mend more HP.",                       playstyleTag: "healer",            keyStat: "WIS",        available: true  },
  { characterClass: "Cleric",  key: "light",          name: "Light Domain",      blurb: "Radiance and fire. Ward off darkness with Warding Flare.",                              playstyleTag: "offensive caster",  keyStat: "WIS",        available: true  },
  { characterClass: "Cleric",  key: "war",            name: "War Domain",        blurb: "A battle cleric who strikes down foes with divine fury.",                                playstyleTag: "battle support",    keyStat: "WIS/STR",    available: true  },
  // Druid
  { characterClass: "Druid",   key: "land",           name: "Circle of the Land",blurb: "Recovers spell slots. Bonus spells based on terrain mastery.",                          playstyleTag: "spell recovery",    keyStat: "WIS",        available: true  },
  { characterClass: "Druid",   key: "moon",           name: "Circle of the Moon",blurb: "Wild Shape into powerful combat beasts. Fight as the wild.",                            playstyleTag: "wild shape combat", keyStat: "WIS/CON",    available: true  },
  { characterClass: "Druid",   key: "spores",         name: "Circle of Spores",  blurb: "Animate the dead, spread fungal rot. A druid of decay.",                                playstyleTag: "necromantic",       keyStat: "WIS/CON",    available: true  },
  // Wizard
  { characterClass: "Wizard",  key: "evocation",      name: "School of Evocation",  blurb: "Master of raw magical energy. Sculpt spells to protect allies in your blasts.",     playstyleTag: "blaster",           keyStat: "INT",        available: true  },
  { characterClass: "Wizard",  key: "abjuration",     name: "School of Abjuration", blurb: "Ward and protect. Arcane Ward absorbs damage for you.",                              playstyleTag: "defender",          keyStat: "INT",        available: true  },
  { characterClass: "Wizard",  key: "illusion",       name: "School of Illusion",   blurb: "Deceive and manipulate. Improved Minor Illusion and malleable illusions.",           playstyleTag: "deceiver",          keyStat: "INT",        available: true  },
  // Bard
  { characterClass: "Bard",    key: "lore",           name: "College of Lore",   blurb: "Collect knowledge and weaken foes. Cutting Words disrupts attacks.",                    playstyleTag: "control & support", keyStat: "CHA",        available: true  },
  { characterClass: "Bard",    key: "valor",          name: "College of Valor",  blurb: "A battle bard in heavy armor who fights alongside heroes.",                              playstyleTag: "melee support",     keyStat: "CHA/STR",    available: true  },
  { characterClass: "Bard",    key: "glamour",        name: "College of Glamour",blurb: "Channel Feywild magic. Mesmerize foes, inspire allies.",                                playstyleTag: "enchanter",         keyStat: "CHA",        available: true  },
  // Sorcerer
  { characterClass: "Sorcerer",key: "draconic",       name: "Draconic Bloodline",blurb: "Descended from dragons. Natural armor and powerful draconic magic.",                    playstyleTag: "tanky blaster",     keyStat: "CHA/CON",    available: true  },
  { characterClass: "Sorcerer",key: "wild_magic",     name: "Wild Magic",        blurb: "Chaos made flesh. Every spell risks a wild surge — or a boon.",                        playstyleTag: "chaos",             keyStat: "CHA",        available: true  },
  { characterClass: "Sorcerer",key: "storm",          name: "Storm Sorcery",     blurb: "Born of tempests. Ride the wind and call lightning.",                                   playstyleTag: "mobile caster",     keyStat: "CHA",        available: true  },
  // Warlock
  { characterClass: "Warlock", key: "fiend",          name: "The Fiend",         blurb: "Pact with a devil. Temporary HP on kills and devastating fire magic.",                  playstyleTag: "tanky striker",     keyStat: "CHA",        available: true  },
  { characterClass: "Warlock", key: "archfey",        name: "The Archfey",       blurb: "Fey lord patron. Beguiling Defenses and Misty Escape tricks.",                          playstyleTag: "trickster",         keyStat: "CHA",        available: true  },
  { characterClass: "Warlock", key: "great_old_one",  name: "The Great Old One", blurb: "An unknowable cosmic entity. Telepathy and horrifying awakenings.",                     playstyleTag: "mindbender",        keyStat: "CHA",        available: true  },
  // Blood Hunter
  { characterClass: "Blood Hunter", key: "crimson_rite_order", name: "Order of the Crimson Rite", blurb: "Hunters who imbue blades with primal rites. High damage, high cost.", playstyleTag: "burst damage",      keyStat: "STR/DEX",    available: true  },
  { characterClass: "Blood Hunter", key: "ghostslayer",        name: "Order of the Ghostslayer",  blurb: "Ancient order that hunts the undead and those who practice foul magic.",playstyleTag: "undead hunter",     keyStat: "STR/WIS",    available: true  },
  { characterClass: "Blood Hunter", key: "lycan",              name: "Order of the Lycan",        blurb: "Embrace the curse of lycanthropy for savage power in battle.",          playstyleTag: "berserker hybrid",  keyStat: "STR/CON",    available: true  },
];

async function main() {
  console.log(`Upserting ${SUBCLASSES.length} subclass rows...`);
  let inserted = 0;
  let updated = 0;
  for (const sub of SUBCLASSES) {
    const result = await prisma.subclass.upsert({
      where: { characterClass_key: { characterClass: sub.characterClass, key: sub.key } },
      create: sub,
      update: sub,
    });
    const existed = result.id && SUBCLASSES.find(s => s.key === sub.key && s.characterClass === sub.characterClass);
    // Count via a pre-check is expensive; just report totals after
    inserted++;
  }
  const total = await prisma.subclass.count();
  console.log(`Done. DB now has ${total} subclass rows.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
