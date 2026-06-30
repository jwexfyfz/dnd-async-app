import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // ⚠️ DESTRUCTIVE: the deleteMany() calls below wipe ALL game state (rooms, sessions,
  // characters' room/combat state, message logs, items, etc.) and rebuild from scratch.
  // NEVER add/modify deleteMany() calls here, and NEVER run this script against a
  // database with live game data, without explicit user permission.
  // For incremental item/template changes on a live DB, write a one-off merge-patch
  // script in scripts/ instead (see scripts/patch-weapon-stats.mjs for the pattern) —
  // it edits PoiTemplate.defaultProperties / PoiInstance.currentProperties /
  // Character.inventory in place without deleting anything.
  console.log("🧼 Clearing old data...");
  // Delete in dependency order (children first)
  await prisma.activeTurnQueue.deleteMany();
  await prisma.combatSession.deleteMany();
  await prisma.pendingRoll.deleteMany();
  await prisma.message.deleteMany();
  await prisma.partyMember.deleteMany();
  await prisma.gameMap.deleteMany();
  await prisma.game.deleteMany();
  // V2 instance tables (templates are stable — seeded with fixed IDs, never deleted)
  await prisma.messageLog.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.poiInstance.deleteMany();
  await prisma.roomInstance.deleteMany();
  await prisma.gameSession.deleteMany();
  await prisma.featureResourcePool.deleteMany();
  await prisma.classFeature.deleteMany();
  await prisma.subclass.deleteMany();
  await prisma.classProgression.deleteMany();
  await prisma.enemy.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.map.deleteMany();
  await prisma.act.deleteMany();
  await prisma.story.deleteMany();
  await prisma.item.deleteMany();

  // ─── Items ─────────────────────────────────────────────────────────────────
  console.log("⚔️  Seeding items...");

  const shortSword = await prisma.item.create({
    data: {
      name: "Short Sword",
      type: "WEAPON",
      category: "Martial",
      description: "A light, fast blade favored by rogues and scouts.",
      weightLbs: 2,
      weaponType: "melee",
      rangeFeet: 5,
      damageDice: "1d6",
      attackBonus: 2,
      combatImpactLabel: "+2 to hit, 1d6+2 piercing",
      interactionTags: ["piercing"],
    },
  });

  const warhammer = await prisma.item.create({
    data: {
      name: "Warhammer",
      type: "WEAPON",
      category: "Martial",
      description: "A heavy hammer capable of demolishing barriers as well as bones.",
      weightLbs: 5,
      weaponType: "melee",
      rangeFeet: 5,
      damageDice: "1d8",
      attackBonus: 3,
      combatImpactLabel: "+3 to hit, 1d8+3 bludgeoning",
      interactionTags: ["blunt", "heavy_demolition"],
    },
  });

  const leatherArmor = await prisma.item.create({
    data: {
      name: "Leather Armor",
      type: "ARMOR",
      category: "Light Armor",
      description: "Cured leather formed into a protective vest.",
      weightLbs: 10,
      combatImpactLabel: "AC 11 + Dex modifier",
    },
  });

  const ironKey = await prisma.item.create({
    data: {
      name: "Iron Key",
      type: "MISC",
      category: "Key",
      description: "A heavy iron key etched with a crown symbol.",
      weightLbs: 0.1,
      keyId: "cellar_key_01",
    },
  });

  const ratClaws = await prisma.item.create({
    data: {
      name: "Giant Rat Claws",
      type: "MISC",
      category: "Trophy",
      description: "Glistening claws stripped from a defeated giant rat.",
      weightLbs: 0.2,
    },
  });

  // ─── Class Progressions, Features, Subclasses ─────────────────────────────
  console.log("📖 Seeding class progressions, features, and subclasses...");

  // ── Fighter ──────────────────────────────────────────────────────────────
  const fighterProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Fighting Style", "Second Wind"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Action Surge"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Martial Archetype"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack"] },
  ];
  for (const p of fighterProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Fighter", ...p } });
  }

  const fightingStyle = await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 1, name: "Fighting Style",
    description: "Choose a fighting style specialty: Archery, Defense, Dueling, or Great Weapon Fighting.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  const secondWind = await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 1, name: "Second Wind",
    description: "Bonus action: recover 1d10 + your Fighter level in HP. Recharges on a short rest.",
    icon: "🌬️", costType: "bonus_action", featureType: "ACTIVE_ABILITY", actionType: "BONUS_ACTION",
    mechanicsJson: { cost: [{ poolKey: "second_wind", amount: 1 }], effect: { type: "heal_self", value: "1d10+prof" } },
    implemented: true,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "second_wind", featureId: secondWind.id,
    maxByLevel: { "1": 1 }, resetOn: "SHORT_REST",
  }});

  const actionSurge = await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 2, name: "Action Surge",
    description: "Once per short rest, take one additional action on your turn.",
    icon: "⚡", costType: "free", featureType: "ACTIVE_ABILITY", actionType: "ACTION",
    mechanicsJson: { cost: [{ poolKey: "action_surge", amount: 1 }], effect: { type: "grant_action" } },
    implemented: true,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "action_surge", featureId: actionSurge.id,
    maxByLevel: { "2": 1 }, resetOn: "SHORT_REST",
  }});

  await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 3, name: "Martial Archetype",
    description: "Choose your martial archetype: the path that shapes your combat style.",
    icon: "🛡️", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});

  await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: true,
  }});

  // Champion subclass features (L3)
  await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 3, name: "Improved Critical",
    description: "Your weapon attacks score a critical hit on a roll of 19 or 20.",
    icon: "🎯", costType: "free", featureType: "STAT_MODIFIER", subclass: "champion",
    mechanicsJson: { field: "critThreshold", operation: "set", value: 19 },
    implemented: true,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Fighter", level: 3, name: "Eldritch Knight Spellcasting",
    description: "You can cast spells using your spell slots. Full spellcasting support arrives in a future update.",
    icon: "✨", costType: "free", featureType: "SPELLCASTING", subclass: "eldritch_knight",
    implemented: false,
  }});

  // Fighter subclasses
  await prisma.subclass.create({ data: {
    characterClass: "Fighter", key: "champion", name: "Champion",
    blurb: "A master of raw physical power. Simple, devastating, and brutally effective.",
    playstyleTag: "high damage", keyStat: "STR or DEX", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Fighter", key: "battle_master", name: "Battle Master",
    blurb: "A tactical fighter who studies combat maneuvers. Precision over brute force.",
    playstyleTag: "tactical", keyStat: "STR", available: false,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Fighter", key: "eldritch_knight", name: "Eldritch Knight",
    blurb: "A warrior who weaves magic into their combat. Steel and spell as one.",
    playstyleTag: "arcane warrior", keyStat: "STR/INT", available: false,
  }});

  // ── Rogue ────────────────────────────────────────────────────────────────
  const rogueProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Expertise", "Sneak Attack", "Thieves' Cant"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Cunning Action"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Roguish Archetype"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Uncanny Dodge"] },
  ];
  for (const p of rogueProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Rogue", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 1, name: "Expertise",
    description: "Double your proficiency bonus for two chosen skills.",
    icon: "🎓", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 1, name: "Sneak Attack",
    description: "Deal extra damage when you have advantage or an ally is adjacent to your target.",
    icon: "🗡️", costType: "free", featureType: "TRIGGERED_EFFECT",
    mechanicsJson: { trigger: "on_hit", condition: "ally_adjacent_to_target", effect: { type: "add_damage", dice: "1d6" } },
    implemented: true,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 1, name: "Thieves' Cant",
    description: "A secret mix of dialect, jargon, and code used among rogues.",
    icon: "🤫", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 2, name: "Cunning Action",
    description: "Use a bonus action to Dash, Disengage, or Hide.",
    icon: "💨", costType: "bonus_action", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 3, name: "Roguish Archetype",
    description: "Choose your rogue archetype: a specialty that defines your criminal expertise.",
    icon: "🎭", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Rogue", level: 5, name: "Uncanny Dodge",
    description: "When an attacker you can see hits you, use your reaction to halve the damage.",
    icon: "🏃", costType: "reaction", featureType: "REACTION", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Rogue", key: "thief", name: "Thief",
    blurb: "Quick fingers and quicker feet. Masters of stealth and larceny.",
    playstyleTag: "stealth & loot", keyStat: "DEX", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Rogue", key: "assassin", name: "Assassin",
    blurb: "Patient, precise, and lethal. You plan the kill before combat begins.",
    playstyleTag: "burst damage", keyStat: "DEX", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Rogue", key: "arcane_trickster", name: "Arcane Trickster",
    blurb: "Magic enhances your thievery. Illusions and enchantments are your tools.",
    playstyleTag: "arcane stealth", keyStat: "DEX/INT", available: false,
  }});

  // ── Barbarian ────────────────────────────────────────────────────────────
  const barbarianProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Rage", "Unarmored Defense"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Reckless Attack", "Danger Sense"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Primal Path"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack", "Fast Movement"] },
  ];
  for (const p of barbarianProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Barbarian", ...p } });
  }

  const rage = await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 1, name: "Rage",
    description: "Enter a battle fury: advantage on STR checks, bonus damage, resistance to physical damage. Lasts 1 minute.",
    icon: "😤", costType: "bonus_action", featureType: "ACTIVE_ABILITY", actionType: "BONUS_ACTION",
    mechanicsJson: { cost: [{ poolKey: "rage", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "rage", featureId: rage.id,
    maxByLevel: { "1": 2, "3": 3, "6": 4 }, resetOn: "LONG_REST",
  }});

  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 1, name: "Unarmored Defense",
    description: "While not wearing armor, your AC equals 10 + DEX modifier + CON modifier.",
    icon: "💪", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 2, name: "Reckless Attack",
    description: "Attack with advantage, but grant attackers advantage against you until next turn.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 2, name: "Danger Sense",
    description: "Advantage on DEX saving throws against effects you can see.",
    icon: "👁️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 3, name: "Primal Path",
    description: "Choose your primal path: the source of your rage.",
    icon: "🐻", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: true,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Barbarian", level: 5, name: "Fast Movement",
    description: "Your speed increases by 10 feet while not wearing heavy armor.",
    icon: "💨", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Barbarian", key: "berserker", name: "Berserker",
    blurb: "Fury without limit. You can frenzy for additional bonus action attacks.",
    playstyleTag: "max damage", keyStat: "STR", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Barbarian", key: "totem_warrior", name: "Totem Warrior",
    blurb: "A spiritual warrior who channels the power of animal spirits.",
    playstyleTag: "versatile", keyStat: "STR/CON", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Barbarian", key: "zealot", name: "Path of the Zealot",
    blurb: "A divine warrior who rages in the name of a god. Near-impossible to kill in battle.",
    playstyleTag: "divine tank", keyStat: "STR/CON", available: true,
  }});
  // ── Ranger ───────────────────────────────────────────────────────────────
  const rangerProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Favored Enemy", "Natural Explorer"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Fighting Style", "Spellcasting"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Ranger Archetype", "Primeval Awareness"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack"] },
  ];
  for (const p of rangerProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Ranger", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 1, name: "Favored Enemy",
    description: "Advantage on Survival checks to track and on INT checks to recall information about chosen enemy types.",
    icon: "🏹", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 1, name: "Natural Explorer",
    description: "Master of one terrain type: difficult terrain doesn't slow you, double proficiency on INT/WIS checks.",
    icon: "🌲", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 2, name: "Fighting Style",
    description: "Choose a fighting style specialty suited to your ranger training.",
    icon: "🎯", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 2, name: "Spellcasting",
    description: "You can cast spells using your spell slots. Full spellcasting support arrives in a future update.",
    icon: "✨", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 3, name: "Ranger Archetype",
    description: "Choose your ranger archetype.",
    icon: "🌿", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 3, name: "Primeval Awareness",
    description: "Expend a spell slot to sense the presence of certain creature types within range.",
    icon: "🔮", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Ranger", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "🏹", costType: "free", featureType: "PASSIVE", implemented: true,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Ranger", key: "hunter", name: "Hunter",
    blurb: "A relentless pursuer. Colossus Slayer and multi-target techniques.",
    playstyleTag: "damage dealer", keyStat: "DEX", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Ranger", key: "beast_master", name: "Beast Master",
    blurb: "You and your animal companion fight as one.",
    playstyleTag: "companion", keyStat: "DEX/WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Ranger", key: "gloom_stalker", name: "Gloom Stalker",
    blurb: "Hunter of the dark. Terrifying to enemies who rely on darkness.",
    playstyleTag: "ambush predator", keyStat: "DEX/WIS", available: true,
  }});

  // ── Paladin ──────────────────────────────────────────────────────────────
  const paladinProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Divine Sense", "Lay on Hands"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Divine Smite", "Spellcasting", "Fighting Style"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Sacred Oath", "Channel Divinity"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack"] },
  ];
  for (const p of paladinProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Paladin", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 1, name: "Divine Sense",
    description: "Detect the presence of strong evil or good within 60 feet.",
    icon: "✝️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  const layOnHands = await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 1, name: "Lay on Hands",
    description: "Heal a creature with a touch. You have a pool of HP equal to 5 × Paladin level.",
    icon: "🤲", costType: "action", featureType: "ACTIVE_ABILITY", actionType: "ACTION",
    mechanicsJson: { cost: [{ poolKey: "lay_on_hands", amount: 5 }], effect: { type: "heal_self", value: 5 } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "lay_on_hands", featureId: layOnHands.id,
    maxByLevel: { "1": 5, "2": 10, "3": 15, "4": 20, "5": 25 }, resetOn: "LONG_REST",
  }});

  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 2, name: "Divine Smite",
    description: "Expend a spell slot on hit to deal 2d8 + 1d8 per slot level above 1st radiant damage.",
    icon: "✨", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 2, name: "Spellcasting",
    description: "You can cast paladin spells. Full spellcasting support arrives in a future update.",
    icon: "🙏", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 2, name: "Fighting Style",
    description: "Choose a fighting style specialty.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 3, name: "Sacred Oath",
    description: "Swear your sacred oath, defining your path as a paladin.",
    icon: "🛡️", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  const channelDivinityPal = await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 3, name: "Channel Divinity",
    description: "Channel divine energy to fuel magical effects.",
    icon: "☀️", costType: "action", featureType: "RESOURCE_POOL", actionType: "ACTION",
    mechanicsJson: { cost: [{ poolKey: "channel_divinity_pal", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "channel_divinity_pal", featureId: channelDivinityPal.id,
    maxByLevel: { "3": 1 }, resetOn: "SHORT_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Paladin", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: true,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Paladin", key: "devotion", name: "Oath of Devotion",
    blurb: "The classic holy warrior. Sacred Weapon and Turn the Unholy.",
    playstyleTag: "holy protector", keyStat: "STR/CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Paladin", key: "ancients", name: "Oath of the Ancients",
    blurb: "Light in the darkness. Nature's guardian with strong defensive auras.",
    playstyleTag: "nature defender", keyStat: "STR/CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Paladin", key: "vengeance", name: "Oath of Vengeance",
    blurb: "Punishing the wicked without mercy. Vow of Enmity locks onto one target.",
    playstyleTag: "damage focused", keyStat: "STR/CHA", available: true,
  }});

  // ── Monk ─────────────────────────────────────────────────────────────────
  const monkProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Unarmored Defense", "Martial Arts"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Ki", "Unarmored Movement"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Monastic Tradition", "Deflect Missiles"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: ["Slow Fall"] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack", "Stunning Strike"] },
  ];
  for (const p of monkProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Monk", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 1, name: "Unarmored Defense",
    description: "While wearing no armor and not wielding a shield, your AC equals 10 + DEX + WIS.",
    icon: "🥋", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 1, name: "Martial Arts",
    description: "Use DEX for unarmed strikes, deal 1d4 damage, and make a bonus unarmed attack.",
    icon: "👊", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  const ki = await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 2, name: "Ki",
    description: "Harness mystic energy. Spend ki points to fuel Flurry of Blows, Patient Defense, or Step of the Wind.",
    icon: "☯️", costType: "free", featureType: "RESOURCE_POOL",
    mechanicsJson: null,
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "ki", featureId: ki.id,
    maxByLevel: { "2": 2, "3": 3, "4": 4, "5": 5 }, resetOn: "SHORT_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 2, name: "Unarmored Movement",
    description: "Your speed increases by 10 feet while not wearing armor or a shield.",
    icon: "💨", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 3, name: "Monastic Tradition",
    description: "Commit to a monastic tradition.",
    icon: "🏯", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 3, name: "Deflect Missiles",
    description: "Use your reaction to deflect or catch ranged weapon attacks.",
    icon: "🛡️", costType: "reaction", featureType: "REACTION", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 4, name: "Slow Fall",
    description: "Use your reaction to reduce falling damage by 5× Monk level.",
    icon: "🪶", costType: "reaction", featureType: "REACTION", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "👊", costType: "free", featureType: "PASSIVE", implemented: true,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Monk", level: 5, name: "Stunning Strike",
    description: "Spend 1 ki on a hit to force a CON save. On failure, target is stunned until your next turn.",
    icon: "⚡", costType: "free", featureType: "ACTIVE_ABILITY", actionType: "FREE",
    mechanicsJson: { cost: [{ poolKey: "ki", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Monk", key: "open_hand", name: "Way of the Open Hand",
    blurb: "Master of unarmed combat. Control enemies with pushes, trips, and denials.",
    playstyleTag: "control & mobility", keyStat: "DEX/WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Monk", key: "shadow", name: "Way of Shadow",
    blurb: "A monk trained in the art of darkness. Teleport between shadows.",
    playstyleTag: "stealth striker", keyStat: "DEX/WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Monk", key: "four_elements", name: "Way of the Four Elements",
    blurb: "Channel elemental power through your ki.",
    playstyleTag: "elemental", keyStat: "DEX/WIS", available: false,
  }});

  // ── Cleric ───────────────────────────────────────────────────────────────
  const clericProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Spellcasting", "Divine Domain"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Channel Divinity", "Divine Domain Feature"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Destroy Undead"] },
  ];
  for (const p of clericProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Cleric", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Cleric", level: 1, name: "Spellcasting",
    description: "You can cast cleric spells. Full spellcasting support arrives in a future update.",
    icon: "📿", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Cleric", level: 1, name: "Divine Domain",
    description: "Choose your divine domain at creation — it defines your specialty and bonus spells.",
    icon: "⛪", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  const channelDivinity = await prisma.classFeature.create({ data: {
    characterClass: "Cleric", level: 2, name: "Channel Divinity",
    description: "Channel divine energy to fuel your domain's effects. Recharges on short rest.",
    icon: "☀️", costType: "action", featureType: "ACTIVE_ABILITY", actionType: "ACTION",
    mechanicsJson: { cost: [{ poolKey: "channel_divinity_clr", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "channel_divinity_clr", featureId: channelDivinity.id,
    maxByLevel: { "2": 1 }, resetOn: "SHORT_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Cleric", level: 2, name: "Divine Domain Feature",
    description: "Your chosen domain grants an additional feature at 2nd level.",
    icon: "✨", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Cleric", level: 5, name: "Destroy Undead",
    description: "When you turn undead, low CR undead are destroyed instead.",
    icon: "💀", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Cleric", key: "life", name: "Life Domain",
    blurb: "Master healer. Disciple of Life makes your spells mend more HP.",
    playstyleTag: "healer", keyStat: "WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Cleric", key: "light", name: "Light Domain",
    blurb: "Radiance and fire. Ward off darkness with Warding Flare.",
    playstyleTag: "offensive caster", keyStat: "WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Cleric", key: "war", name: "War Domain",
    blurb: "A battle cleric who strikes down foes with divine fury.",
    playstyleTag: "battle support", keyStat: "WIS/STR", available: true,
  }});

  // ── Druid ────────────────────────────────────────────────────────────────
  const druidProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Druidic", "Spellcasting"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Wild Shape", "Druid Circle"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: ["Wild Shape Improvement"] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: [] },
  ];
  for (const p of druidProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Druid", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Druid", level: 1, name: "Druidic",
    description: "Speak the secret language of druids. Leave hidden messages in nature.",
    icon: "🌿", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Druid", level: 1, name: "Spellcasting",
    description: "You can cast druid spells. Full spellcasting support arrives in a future update.",
    icon: "🌙", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  const wildShape = await prisma.classFeature.create({ data: {
    characterClass: "Druid", level: 2, name: "Wild Shape",
    description: "Transform into a beast you've seen. Use twice per short rest.",
    icon: "🐺", costType: "bonus_action", featureType: "ACTIVE_ABILITY", actionType: "BONUS_ACTION",
    mechanicsJson: { cost: [{ poolKey: "wild_shape", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "wild_shape", featureId: wildShape.id,
    maxByLevel: { "2": 2 }, resetOn: "SHORT_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Druid", level: 2, name: "Druid Circle",
    description: "Choose your druid circle at level 2.",
    icon: "🌺", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Druid", level: 4, name: "Wild Shape Improvement",
    description: "Wild Shape now allows CR 1/2 beasts with a swim speed (CR 1 at L8).",
    icon: "🦁", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Druid", key: "land", name: "Circle of the Land",
    blurb: "Recovers spell slots. Bonus spells based on terrain mastery.",
    playstyleTag: "spell recovery", keyStat: "WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Druid", key: "moon", name: "Circle of the Moon",
    blurb: "Wild Shape into powerful combat beasts. Fight as the wild.",
    playstyleTag: "wild shape combat", keyStat: "WIS/CON", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Druid", key: "spores", name: "Circle of Spores",
    blurb: "Animate the dead, spread fungal rot. A druid of decay.",
    playstyleTag: "necromantic", keyStat: "WIS/CON", available: true,
  }});

  // ── Wizard ───────────────────────────────────────────────────────────────
  const wizardProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Arcane Recovery", "Spellcasting"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Arcane Tradition"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: [] },
  ];
  for (const p of wizardProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Wizard", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Wizard", level: 1, name: "Arcane Recovery",
    description: "Once per long rest, recover spell slots totaling half your Wizard level (round up).",
    icon: "📚", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Wizard", level: 1, name: "Spellcasting",
    description: "You can cast wizard spells. Full spellcasting support arrives in a future update.",
    icon: "🔮", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Wizard", level: 2, name: "Arcane Tradition",
    description: "Choose your arcane tradition at level 2.",
    icon: "📖", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Wizard", key: "evocation", name: "School of Evocation",
    blurb: "Master of raw magical energy. Sculpt spells to protect allies in your blasts.",
    playstyleTag: "blaster", keyStat: "INT", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Wizard", key: "abjuration", name: "School of Abjuration",
    blurb: "Ward and protect. Arcane Ward absorbs damage for you.",
    playstyleTag: "defender", keyStat: "INT", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Wizard", key: "illusion", name: "School of Illusion",
    blurb: "Deceive and manipulate. Improved Minor Illusion and malleable illusions.",
    playstyleTag: "deceiver", keyStat: "INT", available: true,
  }});

  // ── Bard ─────────────────────────────────────────────────────────────────
  const bardProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Spellcasting", "Bardic Inspiration"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Jack of All Trades", "Song of Rest"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Bard College", "Expertise"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Bardic Inspiration d8", "Font of Inspiration"] },
  ];
  for (const p of bardProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Bard", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 1, name: "Spellcasting",
    description: "You can cast bard spells. Full spellcasting support arrives in a future update.",
    icon: "🎵", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  const bardicInspiration = await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 1, name: "Bardic Inspiration",
    description: "Grant a creature a d6 inspiration die to add to an ability check, attack, or save. Bonus action.",
    icon: "🎶", costType: "bonus_action", featureType: "ACTIVE_ABILITY", actionType: "BONUS_ACTION",
    mechanicsJson: { cost: [{ poolKey: "bardic_inspiration", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "bardic_inspiration", featureId: bardicInspiration.id,
    maxByLevel: { "1": 3 }, resetOn: "LONG_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 2, name: "Jack of All Trades",
    description: "Add half your proficiency bonus to any ability check not already using proficiency.",
    icon: "🃏", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 2, name: "Song of Rest",
    description: "Perform a song during a short rest. Each creature that hears it regains extra HP.",
    icon: "🎼", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 3, name: "Bard College",
    description: "Choose your bard college.",
    icon: "🎭", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 3, name: "Expertise",
    description: "Double proficiency on two chosen skills.",
    icon: "🎓", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 5, name: "Bardic Inspiration d8",
    description: "Your Bardic Inspiration die is now a d8.",
    icon: "🎶", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Bard", level: 5, name: "Font of Inspiration",
    description: "You regain Bardic Inspiration on a short or long rest.",
    icon: "🌊", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Bard", key: "lore", name: "College of Lore",
    blurb: "Collect knowledge and weaken foes. Cutting Words disrupts attacks.",
    playstyleTag: "control & support", keyStat: "CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Bard", key: "valor", name: "College of Valor",
    blurb: "A battle bard in heavy armor who fights alongside heroes.",
    playstyleTag: "melee support", keyStat: "CHA/STR", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Bard", key: "glamour", name: "College of Glamour",
    blurb: "Channel Feywild magic. Mesmerize foes, inspire allies.",
    playstyleTag: "enchanter", keyStat: "CHA", available: true,
  }});

  // ── Sorcerer ─────────────────────────────────────────────────────────────
  const sorcererProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Spellcasting", "Sorcerous Origin"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Font of Magic"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Metamagic"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: [] },
  ];
  for (const p of sorcererProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Sorcerer", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Sorcerer", level: 1, name: "Spellcasting",
    description: "You can cast sorcerer spells. Full spellcasting support arrives in a future update.",
    icon: "🔥", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Sorcerer", level: 1, name: "Sorcerous Origin",
    description: "Choose the magical source of your power at creation.",
    icon: "✨", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Sorcerer", level: 2, name: "Font of Magic",
    description: "Sorcery points to fuel your Metamagic and convert to/from spell slots.",
    icon: "💫", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Sorcerer", level: 3, name: "Metamagic",
    description: "Spend sorcery points to alter your spells: Quicken, Twin, Empower, and more.",
    icon: "🌀", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Sorcerer", key: "draconic", name: "Draconic Bloodline",
    blurb: "Descended from dragons. Natural armor and powerful draconic magic.",
    playstyleTag: "tanky blaster", keyStat: "CHA/CON", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Sorcerer", key: "wild_magic", name: "Wild Magic",
    blurb: "Chaos made flesh. Every spell risks a wild surge — or a boon.",
    playstyleTag: "chaos", keyStat: "CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Sorcerer", key: "storm", name: "Storm Sorcery",
    blurb: "Born of tempests. Ride the wind and call lightning.",
    playstyleTag: "mobile caster", keyStat: "CHA", available: true,
  }});

  // ── Warlock ──────────────────────────────────────────────────────────────
  const warlockProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Otherworldly Patron", "Spellcasting", "Eldritch Blast"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Eldritch Invocations"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Pact Boon"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: [] },
  ];
  for (const p of warlockProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Warlock", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Warlock", level: 1, name: "Otherworldly Patron",
    description: "Strike a bargain with an eldritch patron at creation.",
    icon: "👁️", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Warlock", level: 1, name: "Spellcasting",
    description: "You can cast warlock spells. Full spellcasting support arrives in a future update.",
    icon: "🌑", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Warlock", level: 1, name: "Eldritch Blast",
    description: "A beam of crackling energy. Your primary offensive cantrip.",
    icon: "⚫", costType: "action", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Warlock", level: 2, name: "Eldritch Invocations",
    description: "Learn eldritch invocations that grant you dark boons.",
    icon: "📜", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Warlock", level: 3, name: "Pact Boon",
    description: "Choose your pact boon: Pact of the Chain, Blade, or Tome.",
    icon: "🔮", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Warlock", key: "fiend", name: "The Fiend",
    blurb: "Pact with a devil. Temporary HP on kills and devastating fire magic.",
    playstyleTag: "tanky striker", keyStat: "CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Warlock", key: "archfey", name: "The Archfey",
    blurb: "Fey lord patron. Beguiling Defenses and Misty Escape tricks.",
    playstyleTag: "trickster", keyStat: "CHA", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Warlock", key: "great_old_one", name: "The Great Old One",
    blurb: "An unknowable cosmic entity. Telepathy and horrifying awakenings.",
    playstyleTag: "mindbender", keyStat: "CHA", available: true,
  }});

  // ── Blood Hunter ─────────────────────────────────────────────────────────
  const bloodHunterProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Blood Curse", "Crimson Rite"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Blood Maledict"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["Order Feature"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Extra Attack"] },
  ];
  for (const p of bloodHunterProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Blood Hunter", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Blood Hunter", level: 1, name: "Blood Curse",
    description: "Use your life force to curse enemies, reducing their effectiveness.",
    icon: "🩸", costType: "bonus_action", featureType: "PASSIVE", implemented: false,
  }});
  const crimsonRite = await prisma.classFeature.create({ data: {
    characterClass: "Blood Hunter", level: 1, name: "Crimson Rite",
    description: "Sacrifice HP to imbue your weapon with elemental energy, adding 1d4 elemental damage.",
    icon: "🔥", costType: "bonus_action", featureType: "ACTIVE_ABILITY", actionType: "BONUS_ACTION",
    mechanicsJson: { cost: [{ poolKey: "crimson_rite", amount: 1 }], effect: { type: "grant_advantage" } },
    implemented: false,
  }});
  await prisma.featureResourcePool.create({ data: {
    poolKey: "crimson_rite", featureId: crimsonRite.id,
    maxByLevel: { "1": 2 }, resetOn: "LONG_REST",
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Blood Hunter", level: 2, name: "Blood Maledict",
    description: "Invoke a blood curse that hinders your prey.",
    icon: "🩸", costType: "bonus_action", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Blood Hunter", level: 3, name: "Order Feature",
    description: "Choose your Order and gain your first order feature.",
    icon: "⚔️", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Blood Hunter", level: 5, name: "Extra Attack",
    description: "You can attack twice whenever you take the Attack action.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: true,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Blood Hunter", key: "crimson_rite_order", name: "Order of the Crimson Rite",
    blurb: "Hunters who imbue blades with primal rites. High damage, high cost.",
    playstyleTag: "burst damage", keyStat: "STR/DEX", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Blood Hunter", key: "ghostslayer", name: "Order of the Ghostslayer",
    blurb: "Ancient order that hunts the undead and those who practice foul magic.",
    playstyleTag: "undead hunter", keyStat: "STR/WIS", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Blood Hunter", key: "lycan", name: "Order of the Lycan",
    blurb: "Embrace the curse of lycanthropy for savage power in battle.",
    playstyleTag: "berserker hybrid", keyStat: "STR/CON", available: true,
  }})

  // ── Artificer ────────────────────────────────────────────────────────────
  const artificerProgressions = [
    { level: 1, proficiencyBonus: 2, featuresUnlocked: ["Magical Tinkering", "Spellcasting"] },
    { level: 2, proficiencyBonus: 2, featuresUnlocked: ["Infuse Item"] },
    { level: 3, proficiencyBonus: 2, featuresUnlocked: ["The Right Tool for the Job", "Artificer Specialist"] },
    { level: 4, proficiencyBonus: 2, featuresUnlocked: [] },
    { level: 5, proficiencyBonus: 3, featuresUnlocked: ["Arcane Armament", "Tool Expertise"] },
  ];
  for (const p of artificerProgressions) {
    await prisma.classProgression.create({ data: { characterClass: "Artificer", ...p } });
  }

  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 1, name: "Magical Tinkering",
    description: "Imbue a tiny nonmagical object with a minor magical property: bright light, recorded message, faint odor, or a static visual effect.",
    icon: "🔧", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 1, name: "Spellcasting",
    description: "Cast artificer spells using INT. You use tools as your spellcasting focus. Full spellcasting support arrives in a future update.",
    icon: "⚙️", costType: "free", featureType: "SPELLCASTING", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 2, name: "Infuse Item",
    description: "Infuse magic into mundane items during a long rest. You know 4 infusions and can have 2 active at a time.",
    icon: "✨", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 3, name: "The Right Tool for the Job",
    description: "Over 1 hour of work, produce any artisan's tool you need from raw materials.",
    icon: "🛠️", costType: "free", featureType: "PASSIVE", implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 3, name: "Artificer Specialist",
    description: "Choose your Artificer Specialist: Alchemist, Armorer, or Artillerist. Each defines your focus and grants bonus spells.",
    icon: "🔬", costType: "free", featureType: "CHOICE_GATE", requiresChoice: true,
    mechanicsJson: { choiceType: "subclass", minSelections: 1, maxSelections: 1 },
    implemented: false,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 5, name: "Arcane Armament",
    description: "When using the Attack action, you can make two attacks. One attack must be made with a magic weapon or tool.",
    icon: "⚔️", costType: "free", featureType: "PASSIVE", implemented: true,
  }});
  await prisma.classFeature.create({ data: {
    characterClass: "Artificer", level: 5, name: "Tool Expertise",
    description: "Your proficiency bonus is doubled for any ability check using a tool you are proficient with.",
    icon: "📐", costType: "free", featureType: "PASSIVE", implemented: false,
  }});

  await prisma.subclass.create({ data: {
    characterClass: "Artificer", key: "alchemist", name: "Alchemist",
    blurb: "A master of potions, elixirs, and chemical reactions. Heals allies, poisons enemies, and produces magical concoctions from a long rest.",
    playstyleTag: "healer & blaster", keyStat: "INT", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Artificer", key: "armorer", name: "Armorer",
    blurb: "Infuses armor with arcane power, becoming a walking magical suit. Choose Guardian (melee tank) or Infiltrator (ranged striker) mode.",
    playstyleTag: "arcane tank", keyStat: "INT/STR", available: true,
  }});
  await prisma.subclass.create({ data: {
    characterClass: "Artificer", key: "artillerist", name: "Artillerist",
    blurb: "Constructs a magical Eldritch Cannon that fights alongside you. Place it as a turret or carry it as a sidearm.",
    playstyleTag: "ranged artillery", keyStat: "INT", available: true,
  }});

  // ─── Story ─────────────────────────────────────────────────────────────────
  console.log("📜 Seeding story...");

  const story = await prisma.story.create({
    data: {
      title: "The Sunken Cellar",
      description: "A merchant's cellar beneath Thornfield Village has gone silent. Rats, shadows, and something worse lurk below.",
      difficulty: "Standard",
    },
  });

  // Act 1
  const act1 = await prisma.act.create({
    data: {
      storyId: story.id,
      order: 1,
      title: "Into the Dark",
      summary: "The party descends into the merchant's cellar to investigate strange disappearances.",
      playerFacingDescription:
        "The wooden hatch creaks open. The smell of mildew and copper hits you before you even reach the bottom rung.",
    },
  });

  // Map — 7×7 template. Tiles use MapTile format: { t, enemy?, item? }
  // Layout (y=row, x=col):
  //   Row 0: all walls
  //   Row 1: W F F [D] F  F  W   ← iron door at (3,1), locked
  //   Row 2: W F F  F  F  F  W
  //   Row 3: W F F  F  F [🔨]W   ← warhammer ground item at (5,3)
  //   Row 4: W F F [🐀]F  F  W   ← giant rat spawn at (3,4)
  //   Row 5: W F F  F  F  F  W
  //   Row 6: all walls
  const act1Map = await prisma.map.create({
    data: {
      name: "Merchant's Cellar",
      actId: act1.id,
      data: {
        width: 7,
        height: 7,
        playerStart: { x: 1, y: 1 },
        rooms: [
          {
            name: "Entry Alcove",
            description: "A cramped landing at the base of the stairs. Barrels are stacked against the east wall.",
          },
          {
            name: "Storage Chamber",
            description: "Wide shelves of rotting crates line the walls. A locked iron door leads north.",
          },
        ],
        pois: [
          {
            id: "poi-crate-1",
            name: "Battered Crate",
            x: 2,
            y: 2,
            symbol: "C",
            isContainer: true,
            containerInventory: [
              { itemId: ironKey.id,  investigationAc: 10 },
              { itemId: ratClaws.id, investigationAc: 0  },
            ],
          },
          {
            id: "poi-door-1",
            name: "Iron Cellar Door",
            x: 3,
            y: 1,
            symbol: "D",
            maxHp: 15,
            armorClass: 13,
            damageThreshold: 5,
            lockId: "cellar_key_01",
            eligibleInteractions: ["tool_demolition", "strength_bash"],
            effectiveTools: ["blunt"],
          },
        ],
        tiles: [
          [{ t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "D" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F", item: warhammer.id }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F", enemy: "e1-rat-1" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }],
        ],
      },
    },
  });

  // Scenes
  const scene1 = await prisma.scene.create({
    data: {
      actId: act1.id,
      order: 1,
      title: "The Entry Alcove",
      description:
        "You land in a cramped alcove. Barrels line the east wall. A scrabbling sound echoes from deeper in the cellar. An iron door to the north is locked.",
      objectives: ["Explore the cellar", "Find out what happened to the merchant's workers"],
      triggerType: "ACT_START",
    },
  });

  const scene2 = await prisma.scene.create({
    data: {
      actId: act1.id,
      order: 2,
      title: "The Rat Nest",
      description:
        "Deeper in, the floor is carpeted with gnawed bones and shredded cloth. A massive dire rat rears up from the shadows.",
      objectives: ["Defeat the dire rat", "Search for the missing workers"],
      triggerType: "AREA_REACHED",
      triggerAreaX: 3,
      triggerAreaY: 4,
    },
  });

  // Enemies — e1-rat-1 ID matches the tile spawn reference above
  const rat1 = await prisma.enemy.create({
    data: {
      id: "e1-rat-1",
      actId: act1.id,
      sceneId: scene1.id,
      name: "Giant Rat",
      description: "A rat the size of a terrier, maddened by hunger.",
      maxHp: 7,
      strength: 7,
      dexterity: 15,
      constitution: 11,
      intelligence: 2,
      wisdom: 10,
      charisma: 4,
      armorClass: 12,
      attackBonus: 4,
      damageDice: "1d4+2",
      mainHandId: ratClaws.id,
    },
  });

  const rat2 = await prisma.enemy.create({
    data: {
      actId: act1.id,
      sceneId: scene2.id,
      name: "Dire Rat",
      description: "A hulking specimen with yellow teeth the length of fingers.",
      maxHp: 14,
      strength: 10,
      dexterity: 12,
      constitution: 12,
      intelligence: 2,
      wisdom: 10,
      charisma: 4,
      armorClass: 11,
      attackBonus: 3,
      damageDice: "1d6+2",
    },
  });

  // ─── User & Character ──────────────────────────────────────────────────────
  console.log("🧙 Seeding user and character...");

  const testUser = await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "test@example.com",
      displayName: "Test Player",
    },
  });

  // Level 3 Fighter: proficiency bonus +2
  // STR 16 (+3), DEX 13 (+1), CON 14 (+2), INT 10 (+0), WIS 12 (+1), CHA 8 (-1)
  const aldricSkillsModifiers = {
    // STR
    "Athletics":        5,  // +3 + prof +2
    // DEX
    "Acrobatics":       1,  // +1
    "Sleight of Hand":  1,  // +1
    "Stealth":          1,  // +1
    // INT
    "Arcana":           0,
    "History":          0,
    "Investigation":    0,
    "Nature":           0,
    "Religion":         0,
    // WIS
    "Animal Handling":  1,
    "Insight":          1,
    "Medicine":         1,
    "Perception":       1,
    "Survival":         1,
    // CHA
    "Deception":       -1,
    "Intimidation":     1,  // -1 + prof +2
    "Performance":     -1,
    "Persuasion":      -1,
  };
  const aldricFields = {
    level: 3,
    xp: 900,
    maxHp: 26,
    currentHp: 26,
    skillProficiencies: ["Athletics", "Intimidation"],
    skillsModifiers: aldricSkillsModifiers,
  };
  const testChar = await prisma.character.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: aldricFields,
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Aldric",
      userId: testUser.id,
      characterClass: "Fighter",
      baseStrength: 16,
      baseDexterity: 13,
      baseConstitution: 14,
      baseIntelligence: 10,
      baseWisdom: 12,
      baseCharisma: 8,
      mainHandId: shortSword.id,
      armorId: leatherArmor.id,
      remainingActions: 1,
      remainingBonusActions: 1,
      remainingMovementFeet: 30,
      remainingReactions: 1,
      remainingObjectInteractions: 1,
      posX: 1,
      posY: 1,
      ...aldricFields,
    },
  });

  // Backfill: seed character featuresUnlocked from ClassProgression L1-3
  const fighterFeatureIds = await prisma.classFeature.findMany({
    where: { characterClass: "Fighter", level: { lte: 3 }, subclass: null },
    select: { id: true, name: true, featureType: true },
  });
  const secondWindDb = fighterFeatureIds.find(f => f.name === "Second Wind");
  const actionSurgeDb = fighterFeatureIds.find(f => f.name === "Action Surge");
  await prisma.character.update({
    where: { id: testChar.id },
    data: { featuresUnlocked: fighterFeatureIds.map(f => f.id) },
  });
  // Create resource states for Second Wind and Action Surge
  if (secondWindDb) {
    await prisma.characterResourceState.upsert({
      where: { characterId_poolKey: { characterId: testChar.id, poolKey: "second_wind" } },
      create: { characterId: testChar.id, poolKey: "second_wind", current: 1 },
      update: { current: 1 },
    });
  }
  if (actionSurgeDb) {
    await prisma.characterResourceState.upsert({
      where: { characterId_poolKey: { characterId: testChar.id, poolKey: "action_surge" } },
      create: { characterId: testChar.id, poolKey: "action_surge", current: 1 },
      update: { current: 1 },
    });
  }

  // ─── Game ──────────────────────────────────────────────────────────────────
  console.log("🎲 Seeding game...");

  const game = await prisma.game.create({
    data: {
      characterId: testChar.id,
      storyId: story.id,
      currentActId: act1.id,
      currentSceneId: scene1.id,
      status: "ACTIVE",
      phase: "ACTIVE",
      state: {
        hp: 12,
        maxHp: 12,
        playerPos: { x: 1, y: 1 },
        enemies: [
          { id: rat1.id, name: "Giant Rat", hp: 7, maxHp: 7, x: 3, y: 4 },
        ],
        narrative_history: ["The hatch slams shut above you. You are alone in the dark."],
        active_suggestion_chips: [],
        consecutiveMisses: 0,
      },
      worldState: {
        activeObjective: "Explore the cellar",
        plotFlags: [],
        consecutiveMisses: 0,
        npcsEncountered: [],
      },
    },
  });

  // ─── V2: Dungeon Template & Rooms ─────────────────────────────────────────
  console.log("🏰 Seeding V2 dungeon template...");

  const dungeonTemplate = await prisma.dungeonTemplate.upsert({
    where: { id: "11111111-1111-1111-1111-111111111111" },
    create: {
      id: "11111111-1111-1111-1111-111111111111",
      name: "The Sunken Cellar",
      globalStyle: "Damp Stone Dungeon",
      synopsis: "Thornfield's most trusted merchant has gone silent. Workers sent to investigate his cellar never returned — and now strange sounds echo beneath the market square at night. You've been hired to find out what lurks below, but the deeper you descend, the more it becomes clear that something far older than missing workers is stirring in the dark.",
      difficulty: "Standard",
      length: "Short",
      tone: "Dark Fantasy",
      startRoomTemplateId: "22222222-2222-2222-2222-222222222222",
    },
    update: {
      synopsis: "Thornfield's most trusted merchant has gone silent. Workers sent to investigate his cellar never returned — and now strange sounds echo beneath the market square at night. You've been hired to find out what lurks below, but the deeper you descend, the more it becomes clear that something far older than missing workers is stirring in the dark.",
      difficulty: "Standard",
      length: "Short",
      tone: "Dark Fantasy",
      startRoomTemplateId: "22222222-2222-2222-2222-222222222222",
    },
  });

  const roomTemplate = await prisma.roomTemplate.upsert({
    where: { id: "22222222-2222-2222-2222-222222222222" },
    create: {
      id: "22222222-2222-2222-2222-222222222222",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Entry Chamber",
      baseDescription:
        "A low-ceilinged stone chamber. Torchlight wavers across damp walls. A stone fountain dominates the northwest corner, and a heavy wooden barricade blocks the western passage. An iron pillar near the northeastern wall bears deep claw marks. A wide archway to the east opens into the armory. A dark passage to the north leads deeper into the cellar.",
      searchFailureNarrative:
        "You sweep the chamber but find nothing beyond dust and the smell of old water.",
      map_x: 0,
      map_y: 0,
    },
    update: {
      map_x: 0,
      map_y: 0,
      baseDescription:
        "A low-ceilinged stone chamber. Torchlight wavers across damp walls. A stone fountain dominates the northwest corner, and a heavy wooden barricade blocks the western passage. An iron pillar near the northeastern wall bears deep claw marks. A wide archway to the east opens into the armory. A dark passage to the north leads deeper into the cellar.",
    },
  });

  const entryChamberPois = [
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Stone Fountain",
      keywordIdentifier: "fountain",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A broad stone basin, long unused. A shallow pool of stagnant water has collected at the bottom from ceiling seepage. Faint angular runes ring the interior lip, worn smooth by many hands.",
        examine_details: [
          { skill: "religion", dc: 12, text: "The runes are a supplication to Bane, god of tyranny — a prayer for dominion over the weak." },
          { skill: "investigation", dc: 15, text: "Fresh candle wax is pooled at the basin's base. Someone performed a ritual here recently." },
          { skill: "investigation", dc: 12, text: "The basin drains through a narrow pipe set into the west wall near the base. The pipe is wide enough for a careful arm. It connects to a stone shelf above the waterline in the flooded passage." },
        ],
        perception_details: [
          { dc: 10, text: "Wax residue coats the basin lip — candles were burned here recently." },
          { dc: 14, text: "A single dark hair is caught in a rune groove. Someone knelt over this basin within the last few days." },
        ],
        interact_options: [
          {
            label: "Drink from the collected water",
            random_outcome: {
              dice: "1d6",
              check_first: { skill: "nature", dc: 12, reveal: "The water has a faint sulphurous tint. Drinking it unexamined would be unwise." },
              outcomes: [
                { range: [1, 3], narrative: "The water is brackish and foul. Something in it disagrees with you immediately.", effect: "curse_next_death_save_disadvantage" },
                { range: [4, 5], narrative: "It tastes of old stone and nothing else. Nothing happens.", effect: null },
                { range: [6, 6], narrative: "Cold and unexpectedly clean — almost supernaturally so. A faint warmth spreads through your chest.", effect: "heal_1d4" },
              ],
            },
          },
          {
            label: "Reach into the drain pipe",
            check: { skill: "athletics", dc: 10, note: "Small characters succeed automatically" },
            success: "Your arm reaches along a stone shelf above the waterline and closes around a waterproof satchel — stashed here deliberately, well above any flood level.",
            success_items: [
              { id: "pipe_gold", name: "15 Gold Pieces", description: "A small handful of tarnished gold coins, tied in a scrap of cloth.", throwable: true, value_gp: 15, obvious: true },
              { id: "pipe_dagger", name: "Explorer's Dagger", description: "A finely balanced dagger with a faint enchantment. 1d4+1 piercing, finesse.", equip_slot: "main_hand", throwable: true, damage_dice: "1d4+1", weapon_type: "finesse", equip_bonus: { to_hit: 1, damage: 1 }, obvious: true },
              { id: "grocery_list", name: "Mundane Grocery List", description: "A short list in a merchant's hand: flour, salt, lamp oil, candles. Utterly unremarkable.", throwable: false, obvious: true },
            ],
            failure: "The pipe is too tight for your arm. A smaller character might manage it.",
          },
        ],
        climb:       { resulting_stance: "elevated_ground" },
        hide_behind: { resulting_stance: "crouching" },
        items: [
          {
            id: "healing_vial",
            name: "Healing Vial",
            description: "A small glass vial of shimmering red liquid. Restores 4 HP when consumed.",
            consumable: true,
            throwable: true,
            use_effect: "heal_4",
            hidden: true,
            reveal_check: { skill: "perception", dc: 10 },
          },
          {
            id: "silver_ring",
            name: "Silver Ring",
            description: "A plain silver band, tarnished with age but still wearable. Worth a few coins to the right buyer.",
            equip_slot: "ring",
            throwable: true,
            value_gp: 8,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 11 },
          },
        ],
      },
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Wooden Barricade",
      keywordIdentifier: "barricade",
      grid_slot: "W",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "Rough-hewn planks nailed in haste. Dark stains seep between the boards — old blood, or pitch.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The planks are cracked near the base. A hard kick might bring the whole thing down." },
          { skill: "investigation", dc: 14, text: "Scratch marks on the floor show the barricade was dragged here from the western alcove — something was sealed in, not out." },
        ],
        perception_details: [
          { dc: 10, text: "The bloodstains have browned and cracked — at least a week old, maybe more." },
          { dc: 14, text: "Fresh scrape marks on the floor near the base suggest the barricade was shifted again very recently." },
        ],
        hide_behind:  { resulting_stance: "behind_cover" },
        peek_around:  { resulting_stance: "flanking_position" },
        items: [
          {
            id: "old_dagger",
            name: "Old Dagger",
            description: "A worn iron dagger. 1d4 piercing, finesse.",
            equip_slot: "main_hand",
            damage_dice: "1d4",
            weapon_type: "finesse",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 8 },
          },
          {
            id: "carved_token",
            name: "Carved Token",
            description: "A disc of dark wood carved with an unfamiliar sigil — the mark of some faction operating in the cellar.",
            throwable: true,
            hidden: true,
            story_flag: "faction_sigil",
            reveal_check: { skill: "investigation", dc: 15 },
          },
        ],
      },
    },
    {
      id: "55555555-5555-5555-5555-555555555555",
      name: "Iron Pillar",
      keywordIdentifier: "pillar",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "A thick iron pillar bolted to the floor. Deep parallel gouges run from knee-height to the ceiling.",
        examine_details: [
          { skill: "nature", dc: 11, text: "The claw marks are from something large — wider than any wolf. The spacing suggests a creature that walks upright." },
          { skill: "investigation", dc: 14, text: "The gouges are fresh. Fragments of iron dust still cling to the deepest cuts." },
        ],
        perception_details: [
          { dc: 10, text: "The claw marks carry a faint animal musk — whatever made them passed through not long ago." },
          { dc: 14, text: "A dark smear at the pillar's base, low to the ground — pitch or alchemist's fire, still slightly tacky." },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        climb:      { resulting_stance: "elevated_ground" },
        items: [
          {
            id: "coin_pouch",
            name: "Coin Pouch",
            description: "A small leather pouch, heavy with coin.",
            throwable: true,
            value_gp: 5,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 12 },
          },
        ],
      },
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      name: "Dark Passage North",
      keywordIdentifier: "passage",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "77777777-7777-7777-7777-777777777777" },
        perception_details: [
          { dc: 10, text: "Cold air seeps through the gap — the space beyond is lower and wetter than this chamber." },
          { dc: 14, text: "A faint rhythmic dripping echoes through the passage, too steady to be random water movement." },
        ],
      },
    },
    {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      name: "Wide Archway East",
      keywordIdentifier: "archway",
      grid_slot: "E",
      visibility_level: 2,
      exit_direction: "E",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "obvious_only",
        stand_at:     { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
        perception_details: [
          { dc: 10, text: "The faint smell of weapon oil drifts from the chamber to the east." },
          { dc: 14, text: "Dust on the threshold is scuffed in two directions — someone passed through recently, moving quickly." },
        ],
      },
    },
    {
      id: "ec000001-ec00-ec00-ec00-ec0000000001",
      name: "Cultist Acolyte",
      keywordIdentifier: "cultist",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        initial_awareness_state: "alert",
        examine_text: "A lean figure in a grey robe, hood drawn back. Eyes too wide, jaw set. A short blade at their hip, a Bane sigil burned into their right palm.",
        examine_details: [
          { skill: "insight", dc: 11, text: "They're scared but committed. The kind of scared that makes people do reckless things." },
          { skill: "religion", dc: 13, text: "The brand on their palm is a Bane initiation mark — this person took a formal oath of service within the last month." },
        ],
        perception_details: [
          { dc: 10, text: "Their eyes track movement toward the northern passage. Whatever they're guarding is up there." },
          { dc: 13, text: "Their breathing is fast and shallow. Not seasoned — this may be their first real assignment." },
        ],
        combat_stats: {
          ac: 11,
          max_hp: 10,
          damage: "1d6",
          attack_bonus: 2,
        },
      },
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The flagstones near the north wall sound hollow when stepped on." },
          { dc: 14, text: "A faint chemical smell lingers near the center of the room — something was spilled here and mopped up." },
        ],
        items: [
          {
            id: "loose_stone",
            name: "Loose Stone",
            description: "A fist-sized chunk of broken masonry. Crude, but it'll do in a pinch as a thrown weapon.",
            throwable: true,
            improvised: true,
            obvious: true,
          },
          {
            id: "thieves_tools",
            name: "Thieves' Tools",
            description: "A slim leather roll of picks, tension wrenches, and files. Useful for opening locks without a key.",
            use_effect: "lockpick",
            obvious: true,
          },
        ],
      },
    },
  ];

  for (const poi of entryChamberPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: roomTemplate.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Flooded Passage (north of Entry) ────────────────────────────────
  const floodedPassage = await prisma.roomTemplate.upsert({
    where: { id: "77777777-7777-7777-7777-777777777777" },
    create: {
      id: "77777777-7777-7777-7777-777777777777",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Flooded Passage",
      baseDescription:
        "A long stone corridor half-submerged in black, knee-deep water. The ceiling drips steadily. A collapsed pillar leans against the eastern wall, its carved surface thick with algae. At the far end, a stagnant pool glimmers faintly in the dark. A rusted iron gate to the south leads back to the entry chamber.",
      searchFailureNarrative:
        "You wade through the cold water and find nothing but slick stone and the smell of rot.",
      map_x: 0,
      map_y: -1,
    },
    update: { map_x: 0, map_y: -1 },
  });

  const floodedPassagePois = [
    {
      id: "88888888-8888-8888-8888-888888888888",
      name: "Collapsed Pillar",
      keywordIdentifier: "pillar",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "A broad stone pillar snapped at the base, leaning against the eastern wall. Algae coats every surface; old carved script runs along the shaft.",
        examine_details: [
          { skill: "history", dc: 13, text: "The script is Old Imperial — a dedication to a garrison commander named Arev the Steadfast. This was once a fortified military outpost. A secondary inscription below, in a different hand, appears to be a ritual notation of some kind." },
          { skill: "arcana", dc: 14, text: "Below the dedication, a second inscription: a pre-Imperial ward phrase — 'Varath vel anath korum' — used to anchor a binding and protect the binder from compulsion corruption. Knowing this phrase provides a foundation for completing the vault's binding seal.", story_flag: "ward_phrase_known" },
          { skill: "perception", dc: 11, text: "A thin crack runs along the pillar's underside. Something is wedged into the gap." },
        ],
        perception_details: [
          { dc: 10, text: "The algae on the eastern face is smeared in a long streak — something brushed against it recently." },
          { dc: 14, text: "Beneath the algae, faint chisel marks form a row of numbers: a supply inventory count, partially legible." },
        ],
        interact_options: [
          {
            label: "Read the inscription backwards",
            easter_egg: true,
            narrative: "You reverse the syllables aloud. The algae on the pillar vibrates faintly. A single bubble rises from the water below your feet. Nothing else happens — but you feel briefly certain that something heard you.",
          },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        climb:      { resulting_stance: "elevated_ground" },
        items: [
          {
            id: "iron_key",
            name: "Iron Key",
            description: "A corroded iron key, wedged into a crack in the stone. It looks like it might fit a padlock somewhere nearby.",
            throwable: true,
            hidden: true,
            consumable: true,
            use_effect: "unlock",
            reveal_check: { skill: "perception", dc: 12 },
          },
          {
            id: "dried_herb",
            name: "Dried Herb Bundle",
            description: "A bundle of dried medicinal herbs, bound with twine. Chewing them eases pain and closes minor wounds. Restores 2 HP.",
            throwable: true,
            hidden: true,
            consumable: true,
            use_effect: "heal_2",
            reveal_check: { skill: "investigation", dc: 10 },
          },
        ],
      },
    },
    {
      id: "99999999-9999-9999-9999-999999999999",
      name: "Stagnant Pool",
      keywordIdentifier: "pool",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Still, black water. A faint phosphorescence pulses near the bottom — something glimmers just below the surface.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The glow comes from a small object resting in the silt, partially buried." },
          { skill: "nature", dc: 13, text: "The bioluminescence matches cave moss that only grows near underground springs. This pool connects to a deeper water source." },
          { skill: "investigation", dc: 12, text: "The journal's author was an occultist who worked in this cellar decades ago. The final readable entry describes a failed attempt to bind an entity named Varath, and a key insight: 'It cannot manipulate one who genuinely wants nothing. Greed, fear, and ambition are its handholds. A mind at rest gives it nothing to grip.' Knowing this grants advantage on resisting Varath's compulsions in the vault.", story_flag: "occultist_notes" },
        ],
        perception_details: [
          { dc: 10, text: "The phosphorescence pulses in a slow, even rhythm — almost like breathing." },
          { dc: 14, text: "The water near the pool's western edge is slightly warmer than the rest of the passage water." },
        ],
        crouch_beside: { resulting_stance: "crouching" },
        wade_into:     { resulting_stance: "exposed" },
        items: [
          {
            id: "occultist_journal",
            name: "Occultist's Journal",
            description: "A water-damaged leather journal, its pages filled with cramped notes on a binding ritual gone wrong.",
            throwable: true,
            story_flag: "occultist_notes",
            obvious: true,
          },
          {
            id: "bronze_amulet",
            name: "Bronze Amulet",
            description: "A tarnished bronze amulet on a corroded chain, etched with warding sigils. Wearing it steadies the mind against outside influence.",
            equip_slot: "amulet",
            throwable: true,
            value_gp: 12,
            passive_effect: "disadvantage_varath_will",
            hidden: true,
            reveal_check: { skill: "perception", dc: 14 },
          },
          {
            id: "folded_map",
            name: "Folded Map",
            description: "A water-stained map of the cellar's lower passages, hand-drawn in fading ink.",
            throwable: true,
            hidden: true,
            story_flag: "dungeon_layout",
            reveal_check: { skill: "investigation", dc: 13 },
          },
        ],
      },
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Rusted Iron Gate",
      keywordIdentifier: "gate",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "22222222-2222-2222-2222-222222222222" },
        perception_details: [
          { dc: 10, text: "Despite the rust coating the bars, the gate's hinges are freshly oiled — it was used recently." },
          { dc: 14, text: "Scrape marks on the sill show the gate was last pulled open from the north side." },
        ],
      },
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The waterline on the walls shows this passage floods knee-deep during heavy rains." },
          { dc: 14, text: "Two sets of boot prints press into the silt, both heading north — neither set returning south." },
        ],
        interact_options: [
          {
            label: "Speak to the rats (requires Speak with Animals)",
            requires_ability: "speak_with_animals",
            easter_egg: true,
            narrative: "A cluster of rats on a dry ledge above the waterline stops moving and looks at you with an unsettling degree of collective attention. Their designated speaker — a grey rat with a notched ear — approaches. They have watched everything. They know Mira is in the hanging cage in the north chamber, that Harwick paces the ritual circle every three minutes, and that the woman in the vault has been speaking to herself in a language none of them recognize. They know where Harwick keeps his personal coin purse (tucked under the stone altar's left leg). They want cheese. A full ration counts as adequate. Half a ration is accepted with visible contempt, and they share only two of three pieces of information.",
            payment: { item: "ration", reward_tier: [{ quantity: 1, info_count: 3 }, { quantity: 0.5, info_count: 2 }] },
          },
        ],
        items: [],
      },
    },
    {
      id: "fp000001-fp00-fp00-fp00-fp0000000001",
      name: "Restless Dead",
      keywordIdentifier: "restless_dead",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        initial_awareness_state: "unaware",
        examine_text: "A body half-submerged in the black water, face-down. Worker's clothes, waterlogged and dark. It moves — a slow, rhythmic drift that doesn't match any current.",
        examine_details: [
          { skill: "arcana", dc: 12, text: "The dark energy animating it is diffuse — residual corruption from sustained ritual work nearby. It has no real will, just proximity to the binding ritual." },
          { skill: "medicine", dc: 11, text: "The body has been dead for days at least. Whatever is moving it isn't life." },
        ],
        perception_details: [
          { dc: 10, text: "It hasn't noticed you. Its movements are aimless — no head turning, no orientation toward sound." },
          { dc: 14, text: "A coin pouch still attached to the belt. One of the missing workers." },
        ],
        combat_stats: {
          ac: 10,
          max_hp: 8,
          damage: "1d4+1",
          attack_bonus: 1,
        },
      },
    },
    {
      id: "77000001-0000-0000-0000-000000000001",
      name: "Submerged Gate North",
      keywordIdentifier: "submerged_gate",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        locked_by:       ["submerged_gate_key"],
        lock_dc:         18,
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
        examine_text: "A heavy iron portcullis set into the northern wall, its lower bars submerged in the black water. Rust has welded the bars to the frame in places — but the locking mechanism looks new.",
        perception_details: [
          { dc: 10, text: "The lock is newer than the gate itself — installed within the last year." },
          { dc: 14, text: "Beyond the bars, faint torchlight flickers on a stone ceiling. Someone is using the passage on the other side." },
        ],
      },
    },
  ];

  for (const poi of floodedPassagePois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: floodedPassage.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: The Armory (east of Entry, arch_width=2) ─────────────────────────
  const armoryTemplate = await prisma.roomTemplate.upsert({
    where: { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
    create: {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Armory",
      baseDescription:
        "A vaulted stone chamber lined with weapon racks and hunting trophies. Faded banners hang from iron brackets on the northern wall. A heavy crate sits against the western wall, lid ajar. A wide archway to the west connects back to the entry chamber.",
      searchFailureNarrative:
        "You check the racks and corners but find nothing more than dust and old rust.",
      map_x: 1,
      map_y: 0,
    },
    update: { map_x: 1, map_y: 0 },
  });

  const armoryPois = [
    {
      id: "ff000000-0000-0000-0000-000000000001",
      name: "Weapon Rack",
      keywordIdentifier: "rack",
      grid_slot: "NW",
      visibility_level: 2,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Iron brackets bolted into stone, holding a mix of old weapons. One bracket is bent sharply outward — something heavy hung here and was removed in a hurry.",
        examine_details: [
          { skill: "perception", dc: 10, text: "Fresh scratches on the empty bracket suggest it held a larger weapon until very recently." },
          { skill: "investigation", dc: 13, text: "A thin smear of dark oil on the stone beneath the empty bracket — weapon-maintenance oil, still tacky." },
        ],
        perception_details: [
          { dc: 10, text: "The empty bracket's height and spread is exactly right for a halberd or long spear." },
          { dc: 14, text: "A cut length of leather binding cord lies on the floor below the rack — sliced cleanly, not untied." },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        interact_options: [
          {
            label: "Try on the old Vorne plate armor",
            check: null,
            narrative: "The armor is old but well-kept — someone oiled it recently. It fits as though it was made for you. The Vorne crest on the chest catches the light. For the rest of this dungeon, those who recognize the Vorne name react differently: Beren is more deferential; Harwick is briefly rattled. In combat, the crest gives +1 AC and -1 Charisma (the Vorne name carries weight, and not all of it good).",
            story_flag: "vorne_armor_worn",
            equip_item: { id: "vorne_plate", name: "Vorne Family Plate", description: "Old plate armor bearing the Vorne crest. +1 AC.", equip_slot: "chest", equip_bonus: { ac: 1 }, passive_effect: "vorne_presence", obvious: true },
          },
        ],
        items: [
          {
            id: "hand_axe",
            name: "Hand Axe",
            description: "A well-balanced hand axe. 1d6 slashing, melee, can be thrown.",
            equip_slot: "main_hand",
            damage_dice: "1d6",
            weapon_type: "melee",
            throwable: true,
            obvious: true,
          },
          {
            id: "hunting_bow",
            name: "Hunting Bow",
            description: "A simple recurve hunting bow. 1d6 piercing, ranged, and nearly silent.",
            equip_slot: "main_hand",
            damage_dice: "1d6",
            weapon_type: "ranged",
            silent: true,
            throwable: false,
            hidden: true,
            reveal_check: { skill: "perception", dc: 9 },
          },
          {
            id: "vorne_plate",
            name: "Vorne Family Plate",
            description: "Old plate armor bearing the Vorne crest. +1 AC.",
            equip_slot: "chest",
            equip_bonus: { ac: 1 },
            throwable: false,
            passive_effect: "vorne_presence",
            hidden: true,
            reveal_check: { skill: "perception", dc: 11 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000002",
      name: "Trophy Wall",
      keywordIdentifier: "trophies",
      grid_slot: "N",
      visibility_level: 2,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Mounted skulls, antlers, and pelts — some from creatures you don't recognise. A faded banner above bears a crest: a crossed pick and torch on a field of black.",
        examine_details: [
          { skill: "history", dc: 12, text: "The crest belongs to House Vorne — a minor noble family that funded dungeon expeditions two decades ago. They were declared extinct after a scandal involving grave robbery." },
          { skill: "perception", dc: 11, text: "One of the mounted skulls has been disturbed recently — the dust ring around its base is broken." },
        ],
        perception_details: [
          { dc: 10, text: "The dust ring around one mounted skull is broken — it was handled recently." },
          { dc: 14, text: "Behind a pair of mounted antlers, a small iron hook is screwed into the stone. Something hung here until not long ago." },
        ],
        examine_closely: { resulting_stance: "standing" },
        interact_options: [
          {
            label: "Pry the crest off the wall",
            check: { skill: "athletics", dc: 12 },
            success: "The crest comes away with a crack of old mortar. Behind it: a shallow hollow in the stone. Inside is a small brass locket on a chain. You open it — two portraits, carefully painted on ivory. A woman and a young child. Not Harwick's wife; the clothing is wrong by a generation. On the locket's inner face, engraved in small letters: 'For H, when you find your way back.'",
            success_items: [
              { id: "vorne_locket", name: "Vorne Family Locket", description: "A small brass locket on a broken chain, holding two faded portraits — a woman and a child.", throwable: false, story_flag: "locket_found", obvious: true },
            ],
            failure: "The crest is fixed firmly. You'd need more leverage or a better grip.",
          },
        ],
        items: [
          {
            id: "signet_ring",
            name: "Signet Ring",
            description: "A heavy gold ring stamped with the crossed pick and torch of House Vorne — a noble seal of some standing.",
            equip_slot: "ring",
            throwable: true,
            value_gp: 15,
            hidden: true,
            story_flag: "noble_house",
            reveal_check: { skill: "investigation", dc: 13 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000003",
      name: "Heavy Crate",
      keywordIdentifier: "crate",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A rough-cut wooden crate, lid cracked open at one corner. Smells of pine tar and old canvas.",
        examine_details: [
          { skill: "perception", dc: 9, text: "There's a second, smaller crate tucked underneath — completely sealed and heavier-looking." },
          { skill: "investigation", dc: 12, text: "The stencil on the side reads 'VORNE EST. SUPPLY — DO NOT OPEN'. The same House Vorne crest from the trophy wall." },
        ],
        perception_details: [
          { dc: 10, text: "The crate shifts unevenly when nudged — heavier on the left side than the right." },
          { dc: 14, text: "A knothole in the side panel is plugged with pale wood putty — recently applied, still soft at the center." },
        ],
        hide_behind: { resulting_stance: "behind_cover" },
        items: [
          {
            id: "torch_bundle",
            name: "Torch Bundle",
            description: "Several pitch-soaked torches bundled with cord. Each burns long enough to light a room for an hour.",
            throwable: true,
            throw_damage_type: "fire",
            throw_effect: "ignite",
            consumable: false,
            obvious: true,
          },
          {
            id: "rope_coil",
            name: "Rope Coil",
            description: "Fifty feet of sturdy hemp rope, neatly coiled.",
            throwable: false,
            obvious: true,
          },
          {
            id: "ration_pack",
            name: "Ration Pack",
            description: "Dried meat, hardtack, and a wedge of waxed cheese — enough food for a day on the road.",
            consumable: true,
            throwable: false,
            hidden: true,
            reveal_check: { skill: "perception", dc: 8 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000006",
      name: "Locked Chest",
      keywordIdentifier: "chest",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A banded iron chest, padlocked with a heavy crown-stamped lock. The ironwork matches the key you may have found in the flooded passage.",
        examine_details: [
          { skill: "investigation", dc: 13, text: "Pry marks ring the lid — someone tried to force it open and gave up. The lock itself is undamaged." },
          { skill: "perception", dc: 14, text: "A faint metallic scraping from inside when you nudge the chest — something loose, possibly coins or a vial." },
        ],
        perception_details: [
          { dc: 10, text: "The chest is slightly warm to the touch — noticeably warmer than the surrounding stone floor." },
          { dc: 14, text: "Fresh scratches ring the lock's shackle — someone attempted to pick it, and recently." },
        ],
        locked_by: ["iron_key"],
        lock_dc: 14,
        crouch_before: { resulting_stance: "crouching" },
        items: [
          {
            id: "chest_healing_potion",
            name: "Healing Potion",
            description: "A corked vial of glowing crimson liquid, sealed with wax. Restores 8 HP when consumed.",
            consumable: true,
            use_effect: "heal_8",
            throwable: true,
            hidden: true,
          },
          {
            id: "chest_gold_coins",
            name: "Gold Coins (15)",
            description: "A small stack of gold coins, still bearing the royal mint mark.",
            throwable: true,
            value_gp: 15,
            hidden: true,
          },
          {
            id: "chest_commanders_note",
            name: "Commander's Note",
            description: "A folded note bearing Vorne's seal, detailing payments for a job described only as 'site security.'",
            throwable: false,
            story_flag: "vorne_orders",
            hidden: true,
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000004",
      name: "Wide Archway West",
      keywordIdentifier: "archway",
      grid_slot: "W",
      visibility_level: 2,
      exit_direction: "W",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "obvious_only",
        stand_at:     { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "22222222-2222-2222-2222-222222222222" },
        perception_details: [
          { dc: 10, text: "Torchlight from the entry chamber flickers at the arch's far edge — air is moving on the other side." },
          { dc: 14, text: "A faint drag mark cuts across the archway threshold — something heavy was pulled through here." },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000005",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "Three flagstones near the room's center are noticeably newer than those around them." },
          { dc: 14, text: "The mortar between two northern flagstones is a different shade — disturbed and re-laid within the last year." },
        ],
        items: [],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000007",
      name: "Loose Stone Behind Rack",
      keywordIdentifier: "loose_stone_cache",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "flag_gated",
        reveal_flag: "mira_freed",
        reveal_dc_fallback: 18,
        examine_text: "Behind the weapon rack, a section of the stone wall sounds hollow when knuckled. One stone is slightly proud of the rest, its mortar cracked around the edges.",
        examine_details: [
          { skill: "investigation", dc: 10, text: "The stone is a deliberate cache — the mortar was mixed thin so it could be broken and re-set repeatedly. Someone has used this hiding spot many times." },
        ],
        perception_details: [
          { dc: 10, text: "The stone is dustier on the right side than the left — it's been pulled from the left repeatedly." },
        ],
        interact_options: [
          {
            label: "Pull out the loose stone",
            check: null,
            success: "The stone slides free. Behind it: a small oilskin pouch and a folded note. Mira's stash — exactly where she said it would be.",
            success_items: [
              {
                id: "oil_of_silence",
                name: "Oil of Silence",
                description: "A small vial of inky oil. Pour it across a 10-foot area to dampen sound completely for a short time.",
                consumable: true,
                throwable: true,
                use_effect: "silence_area_10ft",
                obvious: true,
              },
              {
                id: "conspiracy_note",
                name: "Planted Evidence Note",
                description: "A hastily scrawled note implicating an innocent party — planted evidence, by the look of the forced handwriting.",
                throwable: false,
                story_flag: "conspiracy_known",
                obvious: true,
              },
            ],
          },
        ],
      },
    },
  ];

  for (const poi of armoryPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: armoryTemplate.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Guard Post (north of Flooded Passage) ───────────────────────────
  const guardPost = await prisma.roomTemplate.upsert({
    where: { id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
    create: {
      id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Guard Post",
      baseDescription:
        "A low-ceilinged checkpoint room carved from pale stone. A rough wooden table dominates the center, covered in empty tin cups and a half-eaten loaf of bread. A guard slumps in a chair against the east wall, chin to chest, breathing slowly. The air smells of tallow and unwashed wool. A heavy iron door leads north; a stone passage drops south toward the flooded corridor.",
      searchFailureNarrative:
        "You check the corners and surfaces but find nothing beyond mold and old crumbs.",
      map_x: 0,
      map_y: -2,
    },
    update: { map_x: 0, map_y: -2 },
  });

  const guardPostPois = [
    {
      id: "a1000001-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Guard's Table",
      keywordIdentifier: "table",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A scarred wooden table covered in the remnants of a meal — bread crusts, a tin plate, two cups with dried ale rings. A ring of keys hangs from a nail hammered into the table's side.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The ring holds two keys: one plain iron key and one engraved with the Vorne crest. The crested key is newer — cut recently." },
          { skill: "investigation", dc: 12, text: "Beneath the bread cloth, a small iron key on a worn leather thong. It's been hidden deliberately — tucked under the cloth, not just dropped there." },
        ],
        perception_details: [
          { dc: 10, text: "The ale in the cups is recent — still faintly fragrant. Someone was here within the last few hours." },
          { dc: 14, text: "A faint bitter chemical smell beneath the ale — something was dissolved into it." },
        ],
        items: [
          {
            id: "submerged_gate_key",
            name: "Submerged Gate Key",
            description: "A heavy iron key, slick with damp, stamped with a sigil matching the submerged gate to the north.",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 12 },
          },
        ],
      },
    },
    {
      id: "a1000002-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Slumped Guard",
      keywordIdentifier: "guard",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "beren_vorne_guard",
        npc_name:   "Beren",
        examine_text: "A broad-shouldered man in Vorne livery, slumped in a wooden chair with his chin on his chest. His chest rises and falls — he's alive, just deeply unconscious. A ring of keys is clipped to his belt.",
        examine_details: [
          { skill: "medicine", dc: 12, text: "He's been drugged — the breathing pattern is too slow for sleep, too regular for unconsciousness from injury. A full dose of dreamroot, probably in his drink. He can be roused with effort." },
          { skill: "perception", dc: 11, text: "The keys on his belt include a heavy brass key engraved with a stylised flame — a Vorne family motif." },
        ],
        perception_details: [
          { dc: 10, text: "His weapons are still sheathed. He wasn't attacked — he sat down and went under." },
          { dc: 14, text: "There's no cup or bowl near him. Whatever he drank, someone removed the evidence." },
        ],
        interact_options: [
          {
            label: "Rouse him (Medicine DC 12)",
            check: { skill: "medicine", dc: 12 },
            success: "Beren stirs, blinks, and grabs your wrist — then lets go as his eyes focus. 'Who — ' He swallows. 'He drugged me. The lord drugged me.' He reaches for his belt. 'The key. Iron door north. Take it — whatever he's doing down there has to stop.'",
            success_flag: "beren_roused",
            failure: "You shake him and slap his face but he doesn't rouse. He'll need time — or something stronger than your efforts.",
          },
          {
            label: "Tickle him",
            easter_egg: true,
            check: { skill: "perception", dc: 20, note: "Only a natural 20 catches what follows" },
            success: "Beren snort-laughs in his sleep and rolls over, mumbling something. You catch it clearly: 'Lena... the merchant said...' He's dreaming about someone who knew Maren Ashwick. He knows more than he let on.",
            failure: "He doesn't react. He's too deeply under.",
          },
          {
            label: "Tell him Harwick drugged him deliberately",
            requires_flag: "beren_roused",
            check: { skill: "persuasion", dc: 12 },
            success: "Beren's jaw tightens. He's quiet for a long moment. 'He didn't want a witness.' He stands, steadier than he looks. 'I won't fight him — he's still my lord. But I'll make sure he can't run. If he tries to flee through here, I'll hold the passage.' He also tells you: the merchant woman is in the vault, east of the ritual chamber. He heard her voice through the wall two days ago.",
            success_flag: "beren_loyal",
            failure: "He shakes his head. 'He has his reasons. He always has his reasons.' He doesn't believe you.",
          },
        ],
        items: [
          {
            id: "vorne_key",
            name: "Vorne Key",
            description: "A brass key engraved with the Vorne crest — a stylized flame. It looks like it opens something important.",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 11 },
            story_flag: "vorne_key_found",
            use_effect: "unlock",
            consumable: true,
          },
        ],
      },
    },
    {
      id: "a1000003-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Vorne Iron Door North",
      keywordIdentifier: "iron_door_north",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        locked_by:       ["vorne_key"],
        lock_dc:         16,
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
        examine_text: "A solid iron door set with a single lock bearing the Vorne crest — the crossed pick and torch. No handle on this side; it opens toward you.",
        perception_details: [
          { dc: 10, text: "Faint candlelight bleeds under the door's lower edge, flickering unevenly." },
          { dc: 14, text: "A low, irregular muttering carries through the door — a voice reciting something rhythmically. It doesn't sound like a prayer." },
        ],
      },
    },
    {
      id: "a1000004-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Stone Passage South",
      keywordIdentifier: "passage_south",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "77777777-7777-7777-7777-777777777777" },
        examine_text: "A low archway cut into the southern wall, the floor dropping slightly into a flooded passage beyond. Cold air rises from it, carrying the smell of standing water.",
        perception_details: [
          { dc: 10, text: "The stonework around the arch shows water staining — this floods to chest height during heavy rains." },
          { dc: 14, text: "Boot scuff marks on the archway's threshold, heading both directions. Recent, multiple sets." },
        ],
      },
    },
    {
      id: "a1000005-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "A thin tallow candle stub on the floor near the east wall — someone waited here in the dark recently." },
          { dc: 14, text: "Scratched into the stone near floor level: a series of tally marks, four groups of five. Twenty days." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of guardPostPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: guardPost.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Ritual Chamber (north of Guard Post) ────────────────────────────
  const ritualChamber = await prisma.roomTemplate.upsert({
    where: { id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
    create: {
      id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Ritual Chamber",
      baseDescription:
        "A vaulted chamber lit by a ring of stubby candles arrayed around a circle carved into the floor. The carvings glow faintly — pale silver that dims and brightens in slow pulses. An iron cage hangs from a ceiling chain in the northwest corner, a figure huddled inside. A stone altar against the north wall holds an open grimoire and a lacquered box. A man in travel-worn noble clothes stands at the circle's edge, murmuring with his back to the door. A heavy iron door leads south. In the northeast corner, the stone wall shows a faint hairline seam — almost invisible.",
      searchFailureNarrative:
        "You search the perimeter but the ritual circle's light makes the shadows deeper at the edges.",
      map_x: 0,
      map_y: -3,
    },
    update: { map_x: 0, map_y: -3 },
  });

  const ritualChamberPois = [
    {
      id: "b2000001-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Ritual Circle",
      keywordIdentifier: "circle",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A complex diagram of interlocking rings, glyphs, and radial lines carved deep into the stone floor. The silver light pulses from the grooves themselves — not from any candle. The air above it feels slightly wrong, like pressure before a storm.",
        examine_details: [
          { skill: "arcana", dc: 14, text: "Pre-Imperial binding architecture. The outer ring is correctly formed but the anchor glyphs at the cardinal points are inverted — whoever carved this made a fundamental error. The inverted anchors mean the binding will fail and reverse, releasing rather than containing the entity." },
          { skill: "religion", dc: 13, text: "The central glyph is a Varath-class containment seal — designed for entities that feed on compulsion and influence. Someone is attempting to bind a demon of extraordinary cunning. The inverted anchors terrify you." },
        ],
        perception_details: [
          { dc: 10, text: "The light from the grooves pulses in an irregular pattern — almost like a heartbeat with occasional skips." },
          { dc: 14, text: "Three of the cardinal glyphs show tool marks around their edges — someone has deliberately re-carved them since the original inscription." },
        ],
        disrupt: {
          check: { skill: "arcana", dc: 13 },
          story_flag: "ritual_disrupted",
          narrative: "You drag your blade through three connecting glyphs in rapid succession. The silver light flares white, then sputters out. The air pressure releases. In the sudden dark and silence, you hear Harwick's voice break off mid-syllable.",
        },
        interact_options: [
          {
            label: "Pour a liquid into the circle",
            context_resolved: true,
            outcomes_by_liquid: {
              water: { narrative: "The water hisses as it hits the glowing grooves. The silver light sputters and dims noticeably — the circle is weakened.", effect: "harwick_ritual_penalty_2", story_flag: "circle_water_doused" },
              oil:   { narrative: "The oil spreads across the carved grooves. The circle is now flammable — a torch would end this ritual permanently and start a fire.", story_flag: "circle_oiled", note: "Torching now counts as ritual_disrupted but starts a fire hazard" },
              blood: { narrative: "The blood hits the seal and the light surges brilliant white. Harwick wheels around, eyes wide. 'Yes — yes, that's it.' You've accidentally advanced the ritual.", story_flag: "blood_in_circle", effect: "ritual_advanced" },
              other: { narrative: "It sizzles and evaporates before reaching the glyph floor. No meaningful effect.", effect: null },
            },
          },
          {
            label: "Try to fix the ritual circle",
            check: { skill: "arcana", dc: 16 },
            success: "You identify three cardinal glyphs that Harwick has carved inverted and carefully re-cut them with the tip of your blade. The light shifts from cold silver to a warmer gold — more stable. Whatever binding happens in the vault will be somewhat easier.",
            success_flag: "circle_partially_corrected",
            failure: "You attempt to correct the anchor glyphs but you're not certain which errors are Harwick's and which are Varath's guidance. You stop before making things worse.",
          },
          {
            label: "Sing or hum near the circle",
            easter_egg: true,
            narrative: "You hum a few bars of something simple. The silver light in the nearest glyph groove brightens fractionally, then dims — as if something noticed and caught itself. Harwick, from across the room, says nothing. But his muttering stops for three full seconds.",
          },
        ],
      },
    },
    {
      id: "b2000002-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Prisoner Cage",
      keywordIdentifier: "cage",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "mira",
        npc_name:   "Mira",
        examine_text: "A young woman sits cross-legged in the hanging cage, watching the door with sharp dark eyes. She's filthy and clearly hasn't slept properly in days, but her posture suggests she's been watching and waiting rather than despairing.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The cage lock is a simple padlock — the same type as the Locked Chest in the armory. An iron key would likely open it." },
          { skill: "insight", dc: 12, text: "She's afraid but not broken. She's been cataloguing everything in this room — she'll know things." },
        ],
        perception_details: [
          { dc: 10, text: "She mouths something at you — it takes a moment to read: 'The altar. Look at the altar.'" },
          { dc: 14, text: "Her left forearm shows a faded guild tattoo — the Thieves' Guild knot mark from the city." },
        ],
        interact_options: [
          {
            label: "Open the cage (iron_key or lockpick DC 12)",
            check: { item: "iron_key", fallback: { skill: "thieves_tools", dc: 12 } },
            success: "The lock clicks. Mira drops to the floor and rolls her neck. 'Mira. I'm a thief, not a spy, and I want out of here.' She looks at the ritual circle. 'That thing — it changes every day. He re-carves it himself, and every time he does it gets worse. Whatever he's trying to bind, it's telling him to make mistakes.'",
            story_flag: "mira_freed",
          },
        ],
      },
    },
    {
      id: "b2000003-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Stone Altar",
      keywordIdentifier: "altar",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A flat stone altar pressed against the north wall, its surface covered in melted wax and ink stains. An open grimoire sits at the center, pages weighted open with a smooth river stone. Beside it, a lacquered wooden box with a brass clasp.",
        examine_details: [
          { skill: "arcana", dc: 12, text: "The grimoire is a hand-copied ritual manual — sections are crossed out and re-annotated in a cramped, increasingly erratic hand. Margin notes show the author repeatedly correcting the same binding steps, then correcting the corrections. The final annotated page reads: 'The entity says the anchors must face inward. I believe it.'" },
          { skill: "investigation", dc: 11, text: "The lacquered box is unlocked. Inside: six glass vials of a silver-black reagent, each sealed with wax. The labels are in Old Imperial — 'anchor reagent.' Three vials are empty." },
        ],
        perception_details: [
          { dc: 10, text: "The grimoire's most recent pages are written in a different hand than the early sections — shakier, more rushed." },
          { dc: 14, text: "Beneath the grimoire, a folded letter addressed to 'H. Vorne, care of the cellar road.' Unsigned." },
        ],
        interact_options: [
          {
            label: "Read the grimoire aloud",
            easter_egg: true,
            check: { skill: "arcana", dc: 10, note: "Failure just means you mispronounce things; the imp arrives either way" },
            narrative: "You read three lines aloud. A small crack appears in the air above the altar — no wider than a hand span — and something falls through it onto the stone surface. It's about the size of a large cat and very angry. It rights itself, smooths what might be hair, and fixes you with a glare of profound offence. 'That,' it says, in a voice like a nail dragged across slate, 'was my nap. I am Glet. I was resting inside the binding diffusion until someone began shouting.' It wants nothing to do with Varath, Harwick, or this ritual. It will answer one honest question about the vault before blinking away. It does not fight. It hates Harwick specifically.",
            success_flag: "glet_summoned",
            glet_knowledge: [
              "The Binding Seal is correctly constructed — the fault is in the ritual circle above, not the vault.",
              "Varath's partial binding has lasted because of the original pre-Imperial architecture, not Harwick's work.",
              "The merchant woman in the vault knows the correct completion procedure.",
            ],
          },
        ],
        items: [
          {
            id: "harwick_grimoire",
            name: "Harwick's Grimoire",
            description: "A hand-copied ritual manual, its margins crowded with increasingly frantic annotations and corrections.",
            throwable: false,
            story_flag: "grimoire_read",
          },
          {
            id: "reagent_vials",
            name: "Anchor Reagent (3 remaining)",
            description: "Glass vials of a silver-black reagent, sealed with wax and labeled in Old Imperial: 'anchor reagent.'",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 11 },
          },
        ],
      },
    },
    {
      id: "b2000004-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Harwick Vorne",
      keywordIdentifier: "harwick",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "harwick_vorne",
        npc_name:   "Harwick Vorne",
        examine_text: "A lean man in his late forties, wearing travel clothes over a padded doublet bearing the Vorne crest. His face is gaunt and over-focused, the look of someone who has not slept properly in weeks. He holds a halberd loosely in one hand — the blade is polished. He's watching the ritual circle, not you.",
        examine_details: [
          { skill: "insight", dc: 13, text: "He's brittle. The confidence in his posture is performance — underneath it he's terrified. He knows something is wrong but will not admit it even to himself." },
          { skill: "history", dc: 12, text: "The halberd's blade bears the Vorne family mark. This is the weapon that was missing from the armory weapon rack." },
        ],
        perception_details: [
          { dc: 10, text: "His lips move constantly, just below audible — repeating something to himself like a ward." },
          { dc: 14, text: "His hands are shaking slightly. Not fear — exhaustion. He hasn't stopped the ritual work in days." },
        ],
        combat_stats: {
          ac: 14,
          max_hp: 38,
          weapon: "family_halberd",
          damage: "1d10+2",
          reach: true,
          flee_threshold: 0.5,
          flee_flag: "harwick_fled",
          defeat_flag: "harwick_defeated",
        },
      },
    },
    {
      id: "b2000005-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Iron Door South",
      keywordIdentifier: "iron_door_south",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
        examine_text: "The iron door you came through, now behind you. Its south face bears no lock — it opens freely from this side.",
        perception_details: [
          { dc: 10, text: "The door's hinges are freshly oiled. It opens without a sound." },
          { dc: 14, text: "Scratch marks on the floor on this side suggest the door was barricaded from within at some point — recently cleared." },
        ],
      },
    },
    {
      id: "b2000006-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Hidden Door East",
      keywordIdentifier: "hidden_door",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: "E",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "proximity_only",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3" },
        examine_text: "A section of wall that, up close, reveals a hairline seam running floor to ceiling. The stone here is slightly smoother than the surrounding wall — cut and fitted, not quarried in place. A small recessed latch is set at chest height, nearly invisible.",
        perception_details: [
          { dc: 10, text: "The stone in this section of wall is noticeably cooler than the surrounding walls — air is moving behind it." },
          { dc: 14, text: "The latch mechanism shows bright metal wear at contact points — used regularly and recently." },
        ],
      },
    },
    {
      id: "b2000007-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The candles in the ring are burned down to stubs — this ritual has been running for hours, possibly longer." },
          { dc: 14, text: "The silver light from the ritual circle casts faint shadows that move independently of the candle flames — the circle has its own logic." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of ritualChamberPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: ritualChamber.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Sealed Vault (east of Ritual Chamber) ────────────────────────────
  const sealedVault = await prisma.roomTemplate.upsert({
    where: { id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3" },
    create: {
      id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Sealed Vault",
      baseDescription:
        "A small chamber cut from living rock, the walls smooth and featureless except for a raised dais in the center. On the dais sits a flat stone disc — the Binding Seal — its surface covered in fine silver script that writhes slightly when viewed directly. The air here is cold and absolutely still. In the far corner, a woman in merchant's clothing is chained to an iron ring sunk into the wall. She looks up at you with exhausted, watchful eyes. A heavy wooden shelf along the south wall holds ledger books. The vault door west stands ajar.",
      searchFailureNarrative:
        "The vault is bare stone and shelves. There is nothing to find that isn't already visible.",
      map_x: 1,
      map_y: -3,
    },
    update: { map_x: 1, map_y: -3 },
  });

  const sealedVaultPois = [
    {
      id: "c3000001-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Binding Seal",
      keywordIdentifier: "seal",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A stone disc roughly two feet across, set into the top of a low dais. The silver script on its surface is pre-Imperial — dense, layered, and moving. Not visibly, but when you look away and back, individual glyphs have shifted. The air directly above the disc is cold enough to see your breath.",
        examine_details: [
          { skill: "arcana", dc: 16, text: "This is the anchor point of the binding architecture — a Varath-class seal, pre-Imperial, correctly constructed. The outer ritual circle upstairs was meant to feed power into this. With the correct reagents and the binding incantation spoken in Old Imperial, the seal can be completed, containing Varath permanently. Without guidance, the incantation check is DC 18 and failure reverses the binding." },
          { skill: "religion", dc: 14, text: "The script is partially active — Varath is already partially touching this world through the seal. Whatever you do here will determine whether it crosses fully or is pushed back." },
        ],
        perception_details: [
          { dc: 10, text: "You hear your own name spoken quietly from nowhere in particular. The sound comes from the seal." },
          { dc: 14, text: "The script nearest the seal's edge is different from the rest — larger, more urgent. It reads, in fragmented Old Imperial: 'break me. break me. break me.'" },
        ],
        interact_options: [
          {
            label: "Complete the binding (with Maren's guidance)",
            requires_flag: "maren_rescued",
            check: {
              skill: "arcana",
              dc: 12,
              dc_modifiers: [
                { requires_flag: "ward_phrase_known", amount: -3, note: "You speak the ward phrase at the anchor points as Maren directs" },
                { requires_flag: "circle_partially_corrected", amount: -2 },
              ],
            },
            success_flag: "binding_seal_used",
            narrative: "Maren stands beside you, reading the incantation from memory in precise Old Imperial. You apply the anchor reagents at the cardinal points as she directs. The script flares white. The cold air rushes inward like a held breath releasing. The script locks — every glyph freezes in place. Silence. Then, distantly, something that might be a scream, cut short. The seal is complete. Varath is contained.",
          },
          {
            label: "Attempt binding without guidance",
            check: {
              skill: "arcana",
              dc: 18,
              dc_modifiers: [
                { requires_flag: "ward_phrase_known", amount: -4, note: "The ward phrase anchors you against compulsion during the incantation" },
                { requires_flag: "circle_partially_corrected", amount: -4 },
                { requires_flag: "occultist_notes", amount: -2, note: "You apply the occultist's insight: you want nothing from this" },
                { requires_equipped: "bronze_amulet", amount: -2 },
              ],
            },
            success_flag: "binding_seal_used",
            failure_flag: "binding_seal_destroyed",
            narrative_success: "With no guide but the script itself, you work through the incantation syllable by syllable. The seal activates — correctly. Varath's presence contracts and disappears. The chamber warms.",
            narrative_failure: "You reach the anchor phrase and the script inverts. The cold turns to heat. The disc cracks down the center. In the sudden silence you realize: Varath is free.",
          },
          {
            label: "Destroy the seal",
            story_flag: "binding_seal_destroyed",
            narrative: "You bring your weapon down on the disc. The script screams — actually screams, a sound that comes from everywhere at once. The disc shatters. The cold releases. The chamber is just a room. But something that was held here is no longer held.",
          },
          {
            label: "Sing or hum near the seal",
            easter_egg: true,
            narrative: "You hum something simple. The script on the disc shifts — individual glyphs realigning fractionally, as if listening. For just a moment the whispers from the seal harmonize with the melody before catching themselves. Varath, whatever it is, has been alone and contained for a very long time. It craves attention of any kind. This is a foothold, if you choose to use it.",
          },
        ],
      },
    },
    {
      id: "c3000002-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Chained Merchant",
      keywordIdentifier: "merchant",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "maren_ashwick",
        npc_name:   "Maren Ashwick",
        examine_text: "A woman in her mid-thirties with a merchant's practical clothing — now dirty, worn, and torn at the sleeve. She's chained at the wrist to an iron ring but is sitting upright, watching you assess the room with the focused attention of someone taking inventory. Her expression when she looks at you is relief, quickly mastered into wariness.",
        examine_details: [
          { skill: "insight", dc: 11, text: "She's frightened but functional. She's been using her time in here to think, not panic. She has information and she knows it's leverage." },
          { skill: "perception", dc: 10, text: "The chain is old but the lock is new — same Vorne-style brass clasp as the others in this cellar. Any Vorne key or lockpick will open it." },
        ],
        perception_details: [
          { dc: 10, text: "'I've been waiting four days. Whatever you need to know about that seal, I'll tell you. Just get me out of here first.'" },
          { dc: 14, text: "She keeps glancing at the Binding Seal with the expression of someone who has been listening to it whisper for four days and is holding together through sheer stubbornness." },
        ],
        interact_options: [
          {
            label: "Free her (vorne_key or lockpick DC 12)",
            check: { item: "vorne_key", fallback: { skill: "thieves_tools", dc: 12 } },
            success: "The chain drops. Maren stands and rolls her wrists. 'Maren Ashwick. I delivered reagents to Vorne six months ago — I didn't know what they were for. When I came back to collect payment he locked me in here.' She looks at the seal. 'I know how to complete that correctly. Vorne was doing it wrong — the entity told him to. I can fix it, if you'll let me.'",
            story_flag: "maren_rescued",
          },
        ],
      },
    },
    {
      id: "c3000003-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Vorne Family Ledgers",
      keywordIdentifier: "ledgers",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A wooden shelf holding a dozen ledger books, their spines embossed with the Vorne crest and year dates going back twenty-two years. The most recent volume is open on the shelf, its last pages covered in columns of debts, owed favors, and names.",
        examine_details: [
          { skill: "investigation", dc: 12, text: "The final entries detail payments made in exchange for silence from eight named individuals — minor nobles, city officials, a guild recorder. Harwick has been buying complicity for his operation. This ledger is evidence of criminal conspiracy." },
          { skill: "history", dc: 13, text: "The older ledgers document the original grave-robbery scandal in careful euphemism — 'site reclamation fees,' 'preservation charges,' 'artifact handling costs.' The full scope of what House Vorne did is here, annotated in Harwick's hand as if he's proud of it." },
        ],
        perception_details: [
          { dc: 10, text: "The ledgers smell of tallow and age. They've been kept carefully — this was a deliberate archive, not just records." },
          { dc: 14, text: "Inside the back cover of the most recent volume, a folded document: a royal pardon template, blank, with an official seal already applied. Harwick had planned to coerce someone into signing it." },
        ],
        items: [
          {
            id: "vorne_ledger",
            name: "Vorne Family Ledger (recent)",
            description: "A leather-bound ledger documenting two decades of House Vorne's dealings — the most recent pages detail bribes and silenced witnesses.",
            throwable: false,
            story_flag: "ledger_found",
          },
          {
            id: "blank_pardon",
            name: "Blank Pardon Document",
            description: "An official pardon document, blank but for a royal seal already affixed — meant to be filled in with whoever's name was needed.",
            throwable: false,
            hidden: true,
            value_gp: 0,
            story_flag: "pardon_found",
            reveal_check: { skill: "investigation", dc: 12 },
          },
        ],
      },
    },
    {
      id: "c3000004-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Vault Door West",
      keywordIdentifier: "vault_door",
      grid_slot: "W",
      visibility_level: 1,
      exit_direction: "W",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
        examine_text: "The vault door — heavy stone fitted into a flush frame. It stands ajar, the latch mechanism exposed. From the outside it would be nearly invisible; from inside, it opens easily.",
        perception_details: [
          { dc: 10, text: "The stone door is perfectly balanced — it would take no effort to swing open or closed." },
          { dc: 14, text: "The door's inner face has a single sentence carved in small letters at eye height: 'What is bound here will not stay bound by stone alone.'" },
        ],
      },
    },
    {
      id: "c3000005-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The vault is entirely silent — no echo, no drip, no breath of air. The stillness feels deliberate." },
          { dc: 14, text: "In the absolute silence you can hear your own heartbeat clearly. And then, briefly, something that isn't yours." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of sealedVaultPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: sealedVault.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: The Proving Grounds ─────────────────────────────────────────────────
  // targetLevelRange: [1, 5]
  // Standalone 4-room dungeon for rapid XP and ability testing.
  // XP per full clear: 150 (Skirmish Pit) + 400 (Proving Ring) + 850 (Arena Floor) = 1,400 XP
  console.log("🏋️  Seeding V2 Proving Grounds dungeon...");

  const provingGroundsDungeon = await prisma.dungeonTemplate.upsert({
    where: { id: "d9d00001-d9d0-d9d0-d9d0-d9d000000001" },
    create: {
      id: "d9d00001-d9d0-d9d0-d9d0-d9d000000001",
      name: "The Proving Grounds",
      globalStyle: "Martial Training Facility",
      synopsis: "A sealed stone facility built by an order of warriors to test recruits against increasingly dangerous foes. The Iron Covenant is long gone, but the enchantments that animate its constructs and bind its mercenaries remain active. Used by adventurers who need fast experience before venturing into more dangerous territory.",
      difficulty: "Standard",
      length: "Short",
      tone: "Action",
      startRoomTemplateId: "d9d00002-d9d0-d9d0-d9d0-d9d000000002",
    },
    update: {
      synopsis: "A sealed stone facility built by an order of warriors to test recruits against increasingly dangerous foes. The Iron Covenant is long gone, but the enchantments that animate its constructs and bind its mercenaries remain active. Used by adventurers who need fast experience before venturing into more dangerous territory.",
      difficulty: "Standard",
      length: "Short",
      tone: "Action",
      startRoomTemplateId: "d9d00002-d9d0-d9d0-d9d0-d9d000000002",
    },
  });

  // Quartermaster's Hub (0, 0) — safe starting room
  const pgHub = await prisma.roomTemplate.upsert({
    where: { id: "d9d00002-d9d0-d9d0-d9d0-d9d000000002" },
    create: {
      id: "d9d00002-d9d0-d9d0-d9d0-d9d000000002",
      dungeonTemplateId: provingGroundsDungeon.id,
      name: "Quartermaster's Hub",
      baseDescription: "A stone chamber lit by a banked fire in a wide hearth, its warmth steady and constant. A supply cache of shelves lines the northwest wall, stocked with basic provisions. A wooden training post stands in the southwest corner. A cork notice board by the northeast wall is covered in standing orders and challenge records. Three passages lead out: north to the arena floor, south to the proving ring, and east to the skirmish pit.",
      searchFailureNarrative: "The hub yields nothing beyond what is already visible. Everything here is accounted for and put away.",
      map_x: 0,
      map_y: 0,
      canLongRest: true,
    },
    update: { map_x: 0, map_y: 0, canLongRest: true },
  });

  const pgHubPois = [
    {
      id: "d9a10001-d9a1-d9a1-d9a1-d9a100000001",
      name: "Passage to Arena Floor",
      keywordIdentifier: "arena_passage",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00003-d9d0-d9d0-d9d0-d9d000000003" },
        perception_details: [
          { dc: 10, text: "A wide stone archway. The sound of deliberate footsteps echoes from beyond — something is moving in the arena." },
          { dc: 14, text: "The torchlight beyond burns cold and fuel-free. Iron Covenant enchantment work — the arena is always lit, always ready." },
        ],
      },
    },
    {
      id: "d9a10002-d9a1-d9a1-d9a1-d9a100000002",
      name: "Passage to Proving Ring",
      keywordIdentifier: "ring_passage",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00004-d9d0-d9d0-d9d0-d9d000000004" },
        perception_details: [
          { dc: 10, text: "A carved stone archway. The low sound of disciplined movement carries from beyond — organized, military cadence." },
          { dc: 14, text: "Boot marks on the threshold are recent and numerous. This passage sees regular traffic." },
        ],
      },
    },
    {
      id: "d9a10003-d9a1-d9a1-d9a1-d9a100000003",
      name: "Passage to Skirmish Pit",
      keywordIdentifier: "pit_passage",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: "E",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00005-d9d0-d9d0-d9d0-d9d000000005" },
        perception_details: [
          { dc: 10, text: "An eastern passage smelling faintly of hay and dust. A rustling sound comes from somewhere beyond." },
          { dc: 14, text: "The floor just inside the passage bears parallel drag marks — straw dummies being repositioned." },
        ],
      },
    },
    {
      id: "d9a10004-d9a1-d9a1-d9a1-d9a100000004",
      name: "Supply Cache",
      keywordIdentifier: "supply_cache",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "interactive",
        visibility: "always",
        examine_text: "A set of rough shelves bolted to the northwest wall. Bandages, ration tins, and sealed vials are arranged in neat rows. A small open lock box sits on the lowest shelf.",
        examine_details: [
          { skill: "medicine", dc: 10, text: "The bandages are fresh-wrapped and properly sterilized. Whoever restocks this cache knows their craft." },
          { skill: "investigation", dc: 13, text: "The lock box is empty except for a folded slip of paper: 'Resupply due. Quartermasters reminded twice. — R.'" },
        ],
        perception_details: [
          { dc: 10, text: "Two healing vials sit on the second shelf, sealed with wax. They are available to take." },
          { dc: 13, text: "One bandage roll has a faded stamp: 'OFFICER USE ONLY'. The rest are unmarked." },
          { dc: 16, text: "A faint enchantment hum runs through the shelving — restocking magic, still active after a century." },
        ],
        items: [
          {
            id: "pg_healing_potion_1",
            name: "Healing Potion",
            description: "A small vial of rose-red liquid. Restores 4 HP when consumed.",
            consumable: true,
            throwable: true,
            use_effect: "heal_4",
            obvious: true,
            combat_usable: true,
            target: "self",
          },
          {
            id: "pg_healing_potion_2",
            name: "Healing Potion",
            description: "A small vial of rose-red liquid. Restores 4 HP when consumed.",
            consumable: true,
            throwable: true,
            use_effect: "heal_4",
            obvious: true,
            combat_usable: true,
            target: "self",
          },
        ],
      },
    },
    {
      id: "d9a10005-d9a1-d9a1-d9a1-d9a100000005",
      name: "Notice Board",
      keywordIdentifier: "notice_board",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "interactive",
        visibility: "always",
        examine_text: "A cork board crowded with pinned papers: challenge records, standing orders, and a ranked list of completion times for each wing of the grounds.",
        examine_details: [
          { skill: "investigation", dc: 10, text: "The fastest recorded clear of the proving ring is 4 minutes and 22 seconds, attributed to 'T.H.' The time is impressive." },
          { skill: "history", dc: 14, text: "A faded poster near the bottom bears the seal of the Iron Covenant — the order that built this facility. They dissolved over a century ago, but their wards and constructs remain active.", story_flag: "iron_covenant_history" },
        ],
        perception_details: [
          { dc: 10, text: "One notice is written in fresh ink: 'DO NOT approach the Proving Master without clearing the ring first. This is not a suggestion.'" },
          { dc: 13, text: "A brass plaque in one corner reads: 'In memory of those who did not emerge. The grounds do not forgive impatience.'" },
          { dc: 16, text: "The ranked completion list is written in at least six different hands spanning decades. The most recent entry is three years old." },
        ],
      },
    },
    {
      id: "d9a10006-d9a1-d9a1-d9a1-d9a100000006",
      name: "Training Post",
      keywordIdentifier: "training_post",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "positional",
        visibility: "always",
        examine_text: "A thick oak post sunk into the floor, its surface worn smooth where countless hands have braced against it. A rope ring at shoulder height serves as a target marker.",
        examine_details: [
          { skill: "athletics", dc: 10, text: "Solid — firmly rooted in the stone. Would provide limited cover if you needed to break line of sight." },
          { skill: "perception", dc: 13, text: "Someone has carved a series of small hash marks into the post at waist height — a tally. You count 312 marks." },
        ],
        perception_details: [
          { dc: 10, text: "The wood is polished to a dull sheen from years of repeated contact." },
          { dc: 13, text: "The rope ring has been replaced recently — the fibers are not yet frayed." },
          { dc: 16, text: "Faint traces of chalk are visible on the target ring. Someone was still practicing here not long ago." },
        ],
        take_cover: { resulting_stance: "using_cover" },
      },
    },
    {
      id: "d9a10007-d9a1-d9a1-d9a1-d9a100000007",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The hub is quiet and warm. The fire crackles steadily. No enemies here." },
          { dc: 13, text: "The flagstones are cleaner than those in the combat wings. Someone sweeps this room regularly." },
          { dc: 16, text: "A faint magical hum underlies the ambient sound. The hub's warmth and peace may be deliberate enchantment, not incidental comfort." },
        ],
        items: [],
        interact_options: [
          {
            label: "Make Camp",
            requires_no_combat: true,
            success: "You settle in by the fire. The warmth is steady and the hub is secure. After a long rest, your wounds close and your strength returns.",
            effect: "long_rest",
          },
        ],
      },
    },
  ];

  for (const poi of pgHubPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: pgHub.id },
      update: {
        name: poi.name, defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot, visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction, exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // Arena Floor (0, -1) — hard: 2×CR1 Arena Veteran + CR2 Proving Master (850 XP)
  const pgArena = await prisma.roomTemplate.upsert({
    where: { id: "d9d00003-d9d0-d9d0-d9d0-d9d000000003" },
    create: {
      id: "d9d00003-d9d0-d9d0-d9d0-d9d000000003",
      dungeonTemplateId: provingGroundsDungeon.id,
      name: "Arena Floor",
      baseDescription: "A vaulted stone chamber with a high ceiling and a sand floor dark from years of combat training. Torches burn cold and fuel-free along the walls — Iron Covenant enchantments, permanent and patient. A trophy shelf and a weapon stand flank the southern exit. At the far northern end, the arena opens into a wide fighting platform where the Proving Master holds their post.",
      searchFailureNarrative: "The sand floor hides nothing. Weapons are mounted and accounted for. Nothing here is lost or unclaimed.",
      map_x: 0,
      map_y: -1,
    },
    update: { map_x: 0, map_y: -1 },
  });

  const pgArenaPois = [
    {
      id: "d9a20001-d9a2-d9a2-d9a2-d9a200000001",
      name: "Return to Hub",
      keywordIdentifier: "hub_passage_south",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00002-d9d0-d9d0-d9d0-d9d000000002" },
        perception_details: [
          { dc: 10, text: "The archway south leads back to the hub — the warmth of the fire is faintly detectable from here." },
          { dc: 13, text: "The threshold stones on the hub side are cleaner. The hub is maintained; the arena is not." },
        ],
      },
    },
    {
      id: "d9a20002-d9a2-d9a2-d9a2-d9a200000002",
      name: "Arena Veteran",
      keywordIdentifier: "arena_veteran_1",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "arena_veteran_1",
        npc_name: "Arena Veteran",
        initial_awareness_state: "alert",
        xp_value: 200,
        examine_text: "A broad-shouldered fighter in banded mail, scarred hands resting on a shortsword hilt. Their stance is wide and economical — someone who has survived many fights.",
        examine_details: [
          { skill: "insight", dc: 12, text: "No hesitation, no posturing. They're already evaluating your reach and footing. The fight has started in their mind." },
          { skill: "athletics", dc: 14, text: "Their center of gravity is low and stable. They'll be hard to knock down and harder to disarm." },
        ],
        perception_details: [
          { dc: 10, text: "Their eyes track your movement without turning their head — peripheral battlefield awareness." },
          { dc: 14, text: "A shallow scar runs from their left jaw to their collarbone. Someone got past their guard once." },
        ],
        combat_stats: {
          ac: 13,
          max_hp: 28,
          damage: "1d8+3",
          attack_bonus: 5,
          strength: 15,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 12,
          charisma: 10,
        },
      },
    },
    {
      id: "d9a20003-d9a2-d9a2-d9a2-d9a200000003",
      name: "Arena Veteran",
      keywordIdentifier: "arena_veteran_2",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "arena_veteran_2",
        npc_name: "Arena Veteran",
        initial_awareness_state: "alert",
        xp_value: 200,
        examine_text: "Another fighter in banded mail, stationed on the opposite side of the arena. They move in small, precise circles — warming up, or simply maintaining motion as a defensive habit.",
        examine_details: [
          { skill: "insight", dc: 12, text: "They coordinate with the other veteran without speaking — subtle shifts in position opening and closing angles. They've fought as a pair before." },
          { skill: "perception", dc: 13, text: "Their grip shifts when you move toward their partner. They're covering each other's flanks." },
        ],
        perception_details: [
          { dc: 10, text: "They breathe steadily and deliberately — controlled, not nervous." },
          { dc: 13, text: "A small iron badge on their chest bears a stylized flame — a rank insignia from the Iron Covenant." },
        ],
        combat_stats: {
          ac: 13,
          max_hp: 28,
          damage: "1d8+3",
          attack_bonus: 5,
          strength: 15,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 12,
          charisma: 10,
        },
      },
    },
    {
      id: "d9a20004-d9a2-d9a2-d9a2-d9a200000004",
      name: "Proving Master",
      keywordIdentifier: "proving_master",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "proving_master",
        npc_name: "Proving Master",
        initial_awareness_state: "alert",
        xp_value: 450,
        examine_text: "A tall figure in heavy plate armor, a greatsword resting point-down in the sand before them. No helmet — their face is weathered and deliberate, already measuring you. This is the last test of the Proving Grounds, and they have been waiting.",
        examine_details: [
          { skill: "insight", dc: 14, text: "There is no cruelty here — only assessment. They will fight you as hard as necessary and no harder. They are a test, not an executioner." },
          { skill: "history", dc: 15, text: "The greatsword bears an Iron Covenant insignia, but the rank mark differs from the veterans — a circle instead of a flame. The Covenant's highest rank: Proving Master, the one who certifies all others.", story_flag: "proving_master_identity" },
        ],
        perception_details: [
          { dc: 10, text: "They draw the greatsword slowly and deliberately. The sound of steel fills the arena." },
          { dc: 14, text: "The plate armor is old but perfectly maintained — not a spot of rust or misaligned strap." },
        ],
        combat_stats: {
          ac: 14,
          max_hp: 60,
          damage: "2d6+3",
          attack_bonus: 6,
          strength: 18,
          dexterity: 12,
          constitution: 16,
          intelligence: 12,
          wisdom: 12,
          charisma: 14,
          specialAbility: "battle_surge",
          defeat_flag: "proving_master_defeated",
          lootTable: [
            {
              id: "champion_token",
              name: "Champion's Token",
              description: "A heavy iron disc bearing the crest of the Iron Covenant. Proof of mastering the Proving Grounds at the highest level.",
              throwable: true,
              story_flag: "champion_token_claimed",
              obvious: true,
              value_gp: 25,
              chance: 1.0,
            },
          ],
        },
      },
    },
    {
      id: "d9a20005-d9a2-d9a2-d9a2-d9a200000005",
      name: "Trophy Shelf",
      keywordIdentifier: "trophy_shelf",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "interactive",
        visibility: "always",
        examine_text: "A heavy stone shelf bearing a row of iron plaques, each engraved with a name and a date. The most recent is dated decades ago. A wooden case at the end of the shelf holds a sealed vial that glows faintly.",
        examine_details: [
          { skill: "history", dc: 11, text: "The plaques commemorate fighters who completed the Proving Grounds. The naming convention stopped abruptly 47 years ago — when the Iron Covenant dissolved." },
          { skill: "investigation", dc: 13, text: "The wooden case has a small latch. The vial inside is sealed with red wax and labeled: 'FOR THE WORTHY — APPLY AFTER TRIAL'. A restorative left by a previous generation, still potent." },
        ],
        perception_details: [
          { dc: 10, text: "The vial in the wooden case glows faintly — a healing tincture of some kind." },
          { dc: 13, text: "The shelf is free of dust despite the arena's age. The same enchantment that animates the constructs maintains the room." },
          { dc: 16, text: "One plaque near the end bears only initials: T.H. — the same initials from the hub notice board's fastest ring completion." },
        ],
        items: [
          {
            id: "pg_covenant_badge",
            name: "Iron Covenant Badge",
            description: "A worn iron badge stamped with the Covenant flame. A small piece of military history, worth a few coins to a collector.",
            throwable: true,
            obvious: true,
            value_gp: 8,
          },
          {
            id: "pg_worthy_vial",
            name: "Tincture of the Worthy",
            description: "A sealed vial left by a previous generation of the Iron Covenant. Restores 8 HP when consumed.",
            consumable: true,
            throwable: true,
            use_effect: "heal_8",
            hidden: true,
            reveal_check: { skill: "investigation", dc: 13 },
            combat_usable: true,
            target: "self",
          },
        ],
      },
    },
    {
      id: "d9a20006-d9a2-d9a2-d9a2-d9a200000006",
      name: "Weapon Stand",
      keywordIdentifier: "weapon_stand",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "positional",
        visibility: "always",
        examine_text: "A heavy iron stand holding dulled practice blades and weighted training staves. The real weapons are elsewhere; these are for inspection only. A strong enchantment binding hums from the iron base.",
        examine_details: [
          { skill: "athletics", dc: 10, text: "The practice weapons are properly balanced despite being dulled. Designed for genuine training, not decoration." },
          { skill: "arcana", dc: 14, text: "Binding runes are carved into the base: 'vara' — binding — and 'keth' — permanence. These weapons cannot be removed. The enchantment is old but firm." },
        ],
        perception_details: [
          { dc: 10, text: "The weapons are mounted with care — each in its designated slot, none removed." },
          { dc: 13, text: "A faint hum runs through the stand. The weapons are sealed here deliberately." },
          { dc: 16, text: "One of the practice shortswords is balanced for a left-handed fighter. Custom-made. No name. No date." },
        ],
        take_cover: { resulting_stance: "using_cover" },
      },
    },
    {
      id: "d9a20007-d9a2-d9a2-d9a2-d9a200000007",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The sand floor is disturbed from recent combat. The arena has been used today." },
          { dc: 13, text: "A faint outline in the sand marks the original combat circle — a ring about ten paces across, worn larger by years of use." },
          { dc: 16, text: "The torches burn cold and fuel-free. Light without smoke, steady without wind. Iron Covenant enchantment — practical, durable, permanent." },
        ],
        items: [
          {
            id: "pg_arena_sand",
            name: "Arena Sand",
            description: "A handful of coarse arena sand. Could be thrown to blind a target, or just dropped harmlessly.",
            throwable: true,
            improvised: true,
            obvious: true,
          },
        ],
      },
    },
  ];

  for (const poi of pgArenaPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: pgArena.id },
      update: {
        name: poi.name, defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot, visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction, exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // Proving Ring (0, 1) — 3×CR1/2 Militia Guard + 1×CR1/2 Crossbow Scout (400 XP)
  const pgRing = await prisma.roomTemplate.upsert({
    where: { id: "d9d00004-d9d0-d9d0-d9d0-d9d000000004" },
    create: {
      id: "d9d00004-d9d0-d9d0-d9d0-d9d000000004",
      dungeonTemplateId: provingGroundsDungeon.id,
      name: "Proving Ring",
      baseDescription: "A circular stone chamber with walls worn smooth from years of weapons contact. The flagstone floor is scuffed from countless drills. A guard post with a low table and a map of the grounds occupies the northeast corner. The room is designed for group combat training — multiple attack angles, no natural cover.",
      searchFailureNarrative: "The ring is spartan by design. Nothing is hidden and nothing is decorative.",
      map_x: 0,
      map_y: 1,
    },
    update: { map_x: 0, map_y: 1 },
  });

  const pgRingPois = [
    {
      id: "d9a30001-d9a3-d9a3-d9a3-d9a300000001",
      name: "Return to Hub",
      keywordIdentifier: "hub_passage_north",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00002-d9d0-d9d0-d9d0-d9d000000002" },
        perception_details: [
          { dc: 10, text: "The north archway leads back to the hub. The fire's warmth is faintly detectable." },
          { dc: 13, text: "Boot marks on the threshold show recent, heavy traffic in both directions." },
        ],
      },
    },
    {
      id: "d9a30002-d9a3-d9a3-d9a3-d9a300000002",
      name: "Militia Guard",
      keywordIdentifier: "militia_guard_1",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "militia_guard_1",
        npc_name: "Militia Guard",
        initial_awareness_state: "alert",
        xp_value: 100,
        examine_text: "A stocky figure in ringmail with a shortsword and round shield. Alert but unhurried — they've run this drill before.",
        examine_details: [
          { skill: "insight", dc: 11, text: "Holding a defensive posture — waiting for you to commit before responding. A patient fighter." },
          { skill: "athletics", dc: 12, text: "Their shield is worn on the forearm, not gripped — a practiced carry, faster to raise." },
        ],
        perception_details: [
          { dc: 10, text: "They watch the entrance, not your face. Perimeter awareness before personal threat assessment." },
          { dc: 13, text: "A faded insignia on their shoulder marks them as a former city watch recruit, now bound by the Covenant's enchantments." },
        ],
        combat_stats: {
          ac: 12,
          max_hp: 18,
          damage: "1d6+2",
          attack_bonus: 4,
          strength: 13,
          dexterity: 12,
          constitution: 13,
          intelligence: 8,
          wisdom: 11,
          charisma: 9,
        },
      },
    },
    {
      id: "d9a30003-d9a3-d9a3-d9a3-d9a300000003",
      name: "Militia Guard",
      keywordIdentifier: "militia_guard_2",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "militia_guard_2",
        npc_name: "Militia Guard",
        initial_awareness_state: "alert",
        xp_value: 100,
        examine_text: "Another militia fighter at the southwest corner, already moving to cover a flanking angle as you enter.",
        examine_details: [
          { skill: "insight", dc: 11, text: "Already thinking two moves ahead — shifting to cut off your movement options before you've made them." },
          { skill: "perception", dc: 13, text: "Their footwork is practiced — small, controlled steps rather than lunges. Trained to maintain balance in close quarters." },
        ],
        perception_details: [
          { dc: 10, text: "They move toward the center, cutting off the middle ground." },
          { dc: 14, text: "Their breathing is controlled — nasal, not mouth. Arena-trained respiratory discipline." },
        ],
        combat_stats: {
          ac: 12,
          max_hp: 18,
          damage: "1d6+2",
          attack_bonus: 4,
          strength: 13,
          dexterity: 12,
          constitution: 13,
          intelligence: 8,
          wisdom: 11,
          charisma: 9,
        },
      },
    },
    {
      id: "d9a30004-d9a3-d9a3-d9a3-d9a300000004",
      name: "Militia Guard",
      keywordIdentifier: "militia_guard_3",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "militia_guard_3",
        npc_name: "Militia Guard",
        initial_awareness_state: "alert",
        xp_value: 100,
        examine_text: "The third guard at the southeast corner. Of the three, they look the most experienced — steadier posture, fewer nervous ticks.",
        examine_details: [
          { skill: "insight", dc: 12, text: "Something different here — less mechanical, more reading you. They'll respond to feints." },
          { skill: "athletics", dc: 13, text: "Weight back on their heels, not forward. Ready to react rather than initiate." },
        ],
        perception_details: [
          { dc: 10, text: "They watch the scout's position as much as yours — waiting for a coordinated moment." },
          { dc: 14, text: "A small nick on their sword blade has been carefully filed. They maintain their equipment." },
        ],
        combat_stats: {
          ac: 12,
          max_hp: 18,
          damage: "1d6+2",
          attack_bonus: 4,
          strength: 13,
          dexterity: 12,
          constitution: 13,
          intelligence: 8,
          wisdom: 11,
          charisma: 9,
          defeat_flag: "proving_ring_cleared",
        },
      },
    },
    {
      id: "d9a30005-d9a3-d9a3-d9a3-d9a300000005",
      name: "Crossbow Scout",
      keywordIdentifier: "crossbow_scout",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "crossbow_scout",
        npc_name: "Crossbow Scout",
        initial_awareness_state: "alert",
        xp_value: 100,
        examine_text: "A lean figure in studded leather, a light crossbow raised and leveled from the eastern wall — maximum distance, already aimed at the center of the room.",
        examine_details: [
          { skill: "insight", dc: 11, text: "Calm in a close space. Either they trust the guards to maintain range, or they're confident in their own movement." },
          { skill: "perception", dc: 12, text: "The crossbow is pre-loaded. They fired, reloaded, and are ready to fire again within seconds." },
        ],
        perception_details: [
          { dc: 10, text: "The crossbow is already aimed at the center of the room. They picked their shot before you arrived." },
          { dc: 13, text: "A bolt case on their hip holds six more rounds." },
        ],
        combat_stats: {
          ac: 12,
          max_hp: 18,
          damage: "1d6+2",
          attack_bonus: 4,
          strength: 11,
          dexterity: 14,
          constitution: 12,
          intelligence: 8,
          wisdom: 12,
          charisma: 9,
          rangedAttack: {
            damageDice: "1d6+2",
            range: 2,
            attackBonus: 4,
          },
        },
      },
    },
    {
      id: "d9a30006-d9a3-d9a3-d9a3-d9a300000006",
      name: "Guard Post",
      keywordIdentifier: "guard_post",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "interactive",
        visibility: "always",
        examine_text: "A low table with a stool, a map of the Proving Grounds, and a half-eaten ration tin. A small lockbox sits beneath the table, latched but not locked.",
        examine_details: [
          { skill: "investigation", dc: 10, text: "The map on the table shows patrol routes in faded ink. The routes haven't changed in decades — the guards walk the same patterns they were assigned when the Covenant was active." },
          { skill: "investigation", dc: 14, text: "The lockbox holds a folded note: 'Emergency resupply — Hub, Level 2 shelf, code 7.' Under the table, scratched into the stone: 'If you can read this, you already beat them. Good work. — T.H.'", story_flag: "resupply_code_found" },
        ],
        perception_details: [
          { dc: 10, text: "The ration tin is recent — within a day or two. The guards eat, or something mimics their habits." },
          { dc: 13, text: "The map has a penciled note at the edge: 'Do not provoke the Master.' The handwriting is shaky, unlike the printed patrol routes." },
          { dc: 16, text: "A corner of the map has been torn away — removed deliberately, not through wear." },
        ],
        items: [
          {
            id: "pg_guard_ration",
            name: "Guard's Ration",
            description: "A standard-issue tin of preserved food. Not appetizing, but restorative.",
            consumable: true,
            throwable: true,
            use_effect: "heal_2",
            obvious: true,
          },
        ],
      },
    },
    {
      id: "d9a30007-d9a3-d9a3-d9a3-d9a300000007",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The ring is open and exposed — designed that way. No good cover here." },
          { dc: 13, text: "The flagstones are scoured clean of debris. In a fight, you won't trip on anything." },
          { dc: 16, text: "The walls are slightly curved — designed to prevent sound from carrying out. What happens in the ring stays in the ring." },
        ],
        items: [
          {
            id: "pg_ring_stone",
            name: "Loose Flagstone",
            description: "A fist-sized chunk of broken flagstone. Crude, but throwable in a pinch.",
            throwable: true,
            improvised: true,
            obvious: true,
          },
        ],
      },
    },
  ];

  for (const poi of pgRingPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: pgRing.id },
      update: {
        name: poi.name, defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot, visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction, exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // Skirmish Pit (1, 0) — easy: 3×CR1/4 Straw Sentinel (150 XP)
  const pgPit = await prisma.roomTemplate.upsert({
    where: { id: "d9d00005-d9d0-d9d0-d9d0-d9d000000005" },
    create: {
      id: "d9d00005-d9d0-d9d0-d9d0-d9d000000005",
      dungeonTemplateId: provingGroundsDungeon.id,
      name: "Skirmish Pit",
      baseDescription: "A wide earthen pit with a sand floor and low stone barriers along the walls. Hay training constructs — iron frames stuffed with straw and wrapped in burlap — occupy the pit. The enchantment on them is old and simple, but effective: they move, they react, and they hit back.",
      searchFailureNarrative: "The pit is sand and hay. Nothing of value has been left here.",
      map_x: 1,
      map_y: 0,
    },
    update: { map_x: 1, map_y: 0 },
  });

  const pgPitPois = [
    {
      id: "d9a40001-d9a4-d9a4-d9a4-d9a400000001",
      name: "Return to Hub",
      keywordIdentifier: "hub_passage_west",
      grid_slot: "W",
      visibility_level: 1,
      exit_direction: "W",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type: "exit",
        visibility: "always",
        peek_visibility: "partial",
        stand_at: { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter: { target_room_template_id: "d9d00002-d9d0-d9d0-d9d0-d9d000000002" },
        perception_details: [
          { dc: 10, text: "The western exit leads back to the hub. The fire's warmth reaches even here." },
          { dc: 13, text: "Sand has drifted across the threshold from the pit." },
        ],
      },
    },
    {
      id: "d9a40002-d9a4-d9a4-d9a4-d9a400000002",
      name: "Straw Sentinel",
      keywordIdentifier: "straw_sentinel_1",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "straw_sentinel_1",
        npc_name: "Straw Sentinel",
        initial_awareness_state: "alert",
        xp_value: 50,
        examine_text: "An iron-framed construct packed with straw and wrapped in burlap. It moves with mechanical purpose — not graceful, but persistent. Crude enchantment work, but it has weight behind it.",
        examine_details: [
          { skill: "arcana", dc: 10, text: "Simple enchantment — a movement loop and a basic attack response. No target evaluation, no pain response. It will fight until destroyed." },
          { skill: "investigation", dc: 12, text: "The burlap wrapping is thin in places. Concentrated attacks to the center mass would be most effective." },
        ],
        perception_details: [
          { dc: 10, text: "Its movement is repetitive — advance, reset, advance. A training loop." },
          { dc: 12, text: "The iron frame underneath the straw is jointed at the shoulders and hips. More articulated than it looks." },
        ],
        combat_stats: {
          ac: 11,
          max_hp: 14,
          damage: "1d4+1",
          attack_bonus: 3,
          strength: 10,
          dexterity: 13,
          constitution: 11,
          intelligence: 3,
          wisdom: 6,
          charisma: 1,
        },
      },
    },
    {
      id: "d9a40003-d9a4-d9a4-d9a4-d9a400000003",
      name: "Straw Sentinel",
      keywordIdentifier: "straw_sentinel_2",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "straw_sentinel_2",
        npc_name: "Straw Sentinel",
        initial_awareness_state: "alert",
        xp_value: 50,
        examine_text: "A second straw construct at the northern end of the pit. This one has a dent in its chest frame — someone hit it hard before.",
        examine_details: [
          { skill: "arcana", dc: 10, text: "Identical enchantment to the first construct. Standard training template, mass-produced." },
          { skill: "athletics", dc: 12, text: "The dent in the frame has bent the straw packing outward — less armored there." },
        ],
        perception_details: [
          { dc: 10, text: "Already turning to face you as you enter — the enchantment detects presence, not just movement." },
          { dc: 12, text: "The dent in its chest is old. Whatever hit it there hit it hard." },
        ],
        combat_stats: {
          ac: 11,
          max_hp: 14,
          damage: "1d4+1",
          attack_bonus: 3,
          strength: 10,
          dexterity: 13,
          constitution: 11,
          intelligence: 3,
          wisdom: 6,
          charisma: 1,
        },
      },
    },
    {
      id: "d9a40004-d9a4-d9a4-d9a4-d9a400000004",
      name: "Straw Sentinel",
      keywordIdentifier: "straw_sentinel_3",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "npc",
        visibility: "always",
        npc_id: "straw_sentinel_3",
        npc_name: "Straw Sentinel",
        initial_awareness_state: "alert",
        xp_value: 50,
        examine_text: "The third construct at the northeast corner. Its burlap wrap is tighter and newer — recently refurbished after being destroyed in a previous run.",
        examine_details: [
          { skill: "arcana", dc: 10, text: "The enchantment seal on this one is slightly different — refreshed recently. It may be marginally more responsive than the worn originals." },
          { skill: "investigation", dc: 11, text: "The new burlap has been stitched over the frame more tightly than the others. Whoever repairs these takes their work seriously." },
        ],
        perception_details: [
          { dc: 10, text: "Standing straighter than the others — fresh refurbishment, not worn down yet." },
          { dc: 12, text: "The iron joints on this one are cleaner and recently oiled." },
        ],
        combat_stats: {
          ac: 11,
          max_hp: 14,
          damage: "1d4+1",
          attack_bonus: 3,
          strength: 10,
          dexterity: 13,
          constitution: 11,
          intelligence: 3,
          wisdom: 6,
          charisma: 1,
          defeat_flag: "sentinels_cleared",
        },
      },
    },
    {
      id: "d9a40005-d9a4-d9a4-d9a4-d9a400000005",
      name: "Hay Bale",
      keywordIdentifier: "hay_bale",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "positional",
        visibility: "always",
        examine_text: "A compressed hay bale bound with twine, used as a target marker or cover point in training drills. It smells of dry grass and old wood.",
        examine_details: [
          { skill: "perception", dc: 10, text: "Solid — several layers of tightly compressed hay. Would stop a thrown object and absorb a hit. Good cover." },
          { skill: "investigation", dc: 13, text: "A practice arrow is lodged in the far side. Someone was working on their aim before you arrived." },
        ],
        perception_details: [
          { dc: 10, text: "Wide enough to crouch behind and low enough to fire over." },
          { dc: 13, text: "The twine binding is frayed on one side. A strong pull might scatter it." },
          { dc: 16, text: "Under the bale, a small hollowed section — a hidden resting spot. Someone used to sleep here." },
        ],
        take_cover: { resulting_stance: "behind_cover" },
      },
    },
    {
      id: "d9a40006-d9a4-d9a4-d9a4-d9a400000006",
      name: "Sand Pit",
      keywordIdentifier: "sand_pit",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "interactive",
        visibility: "always",
        examine_text: "A shallow square pit filled with pale sand, bordered by low stone edging. Used for ground work and grappling drills. A crude diagram scratched into the border shows basic wrestling positions.",
        examine_details: [
          { skill: "athletics", dc: 10, text: "The sand is deep enough to soften a fall and treacherous enough to slow movement. Poor footing for anyone fighting in the pit." },
          { skill: "investigation", dc: 13, text: "A small iron token is half-buried in the sand — a previous competitor's good luck piece, long abandoned." },
        ],
        perception_details: [
          { dc: 10, text: "The sand has been recently raked — the constructs maintain the pit even without being told." },
          { dc: 13, text: "A pattern of depressions in the sand shows where someone knelt — then didn't get up. Old marks, long buried." },
          { dc: 16, text: "The stone border shows impact marks at knee height — consistent with someone being thrown repeatedly against the edge." },
        ],
        items: [
          {
            id: "pg_iron_token",
            name: "Worn Iron Token",
            description: "A small iron disc stamped with a stylized fist. A competitor's good luck piece, long abandoned in the sand.",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 13 },
            obvious: false,
            value_gp: 2,
          },
        ],
      },
    },
    {
      id: "d9a40007-d9a4-d9a4-d9a4-d9a400000007",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type: "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The pit is open and compact. The sentinels are already closing." },
          { dc: 12, text: "The floor is sand over stone — footing is solid but the surface will shift under sharp turns." },
          { dc: 15, text: "The air smells faintly of old straw and something mineral — the enchantment substrate used in construct animation." },
        ],
        items: [
          {
            id: "pg_pit_stone",
            name: "Loose Stone",
            description: "A fist-sized chunk of broken masonry from the pit wall. Crude, but throwable.",
            throwable: true,
            improvised: true,
            obvious: true,
          },
        ],
      },
    },
  ];

  for (const poi of pgPitPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: pgPit.id },
      update: {
        name: poi.name, defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot, visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction, exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  console.log("\n✅ Seed complete!");
  console.log("=================================================");
  console.log(`Story:      ${story.id}  (${story.title})`);
  console.log(`Act 1:      ${act1.id}`);
  console.log(`Map:        ${act1Map.id}  (${act1Map.name})`);
  console.log(`Scene 1:    ${scene1.id}  (${scene1.title})`);
  console.log(`Scene 2:    ${scene2.id}  (${scene2.title})`);
  console.log(`Enemy 1:    ${rat1.id}  (${rat1.name})`);
  console.log(`Enemy 2:    ${rat2.id}  (${rat2.name})`);
  console.log(`User:       ${testUser.id}  (${testUser.email})`);
  console.log(`Character:  ${testChar.id}  (${testChar.name})`);
  console.log(`Game:       ${game.id}`);
  console.log("-------------------------------------------------");
  console.log("V2 Templates (stable IDs — use /setup to create sessions):");
  console.log(`  Dungeon:  11111111-1111-1111-1111-111111111111  (The Sunken Cellar)`);
  console.log(`  Room A:   22222222-2222-2222-2222-222222222222  (The Entry Chamber)`);
  console.log(`  POIs A:   33333333 Stone Fountain (healing_vial hidden) | 44444444 Wooden Barricade | 55555555 Iron Pillar (coin_pouch hidden) | 66666666 Dark Passage North → | bbbbbbbb Open Space (loose_stone)`);
  console.log(`  Room B:   77777777-7777-7777-7777-777777777777  (The Flooded Passage) map(0,-1)`);
  console.log(`  POIs B:   88888888 Collapsed Pillar NE | 99999999 Stagnant Pool SE | aaaaaaaa Rusted Iron Gate S→ | cccccccc Open Space C`);
  console.log(`  Room C:   eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee  (The Armory) map(1,0)`);
  console.log(`  POIs C:   ff000001 Weapon Rack NW(vis=2) | ff000002 Trophy Wall N(vis=2) | ff000003 Heavy Crate SW(vis=1) | ff000004 Wide Archway West W(arch=2) | ff000005 Open Space C`);
  console.log(`  Room D:   a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1  (The Guard Post) map(0,-2)`);
  console.log(`  POIs D:   a1000001 Guard's Table C | a1000002 Slumped Guard E(npc:beren) | a1000003 Iron Door North N(locked:vorne_key) | a1000004 Stone Passage South S | a1000005 Open Space SW`);
  console.log(`  Room E:   b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2  (The Ritual Chamber) map(0,-3)`);
  console.log(`  POIs E:   b2000001 Ritual Circle C | b2000002 Prisoner Cage NW(npc:mira) | b2000003 Stone Altar N | b2000004 Harwick Vorne NE(npc/enemy) | b2000005 Iron Door South S | b2000006 Hidden Door East E(proximity_only) | b2000007 Open Space SW`);
  console.log(`  Room F:   c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3  (The Sealed Vault) map(1,-3)`);
  console.log(`  POIs F:   c3000001 Binding Seal C | c3000002 Chained Merchant NE(npc:maren) | c3000003 Vorne Family Ledgers S | c3000004 Vault Door West W | c3000005 Open Space SE`);
  console.log("  Scenarios: 1=Entry alone | 2=Entry@E archway obvious_only | 3=Entry@E archway full | 4=Entry@C wide arch");
  console.log("-------------------------------------------------");
  console.log("V2 Proving Grounds (targetLevelRange: [1,5] | 1,400 XP per full clear):");
  console.log(`  Dungeon:  d9d00001-d9d0-d9d0-d9d0-d9d000000001  (The Proving Grounds)`);
  console.log(`  Hub:      d9d00002-d9d0-d9d0-d9d0-d9d000000002  (Quartermaster's Hub) map(0,0) — SAFE ROOM`);
  console.log(`  Arena:    d9d00003-d9d0-d9d0-d9d0-d9d000000003  (Arena Floor) map(0,-1) — 850 XP (2×Veteran + Proving Master)`);
  console.log(`  Ring:     d9d00004-d9d0-d9d0-d9d0-d9d000000004  (Proving Ring) map(0,1)  — 400 XP (3×Guard + Scout)`);
  console.log(`  Pit:      d9d00005-d9d0-d9d0-d9d0-d9d000000005  (Skirmish Pit) map(1,0)  — 150 XP (3×Straw Sentinel)`);
  console.log("=================================================");
  console.log("Run createGameMap(game.id, act1.id) to initialise the live tile map.");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
