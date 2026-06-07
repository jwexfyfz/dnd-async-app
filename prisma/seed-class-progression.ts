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

// Full-caster spell slot totals per level
const CASTER_POOL: Record<number, number> = {
  1: 2, 2: 3, 3: 6, 4: 7, 5: 9, 6: 10, 7: 11, 8: 12,
  9: 14, 10: 15, 11: 16, 12: 16, 13: 17, 14: 17, 15: 18,
  16: 18, 17: 19, 18: 20, 19: 21, 20: 22,
};

// Half-caster spell slot totals per level (Paladin, Ranger)
const HALF_CASTER_POOL: Record<number, number | null> = {
  1: null, 2: 2, 3: 3, 4: 3, 5: 6, 6: 6, 7: 7, 8: 7, 9: 9, 10: 9,
  11: 10, 12: 10, 13: 11, 14: 11, 15: 12, 16: 12, 17: 14, 18: 14, 19: 15, 20: 15,
};

// Warlock pact magic slots per level (recharge on short rest)
const WARLOCK_POOL: Record<number, number> = {
  1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2,
  11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 4, 18: 4, 19: 4, 20: 4,
};

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

// ─── Fighter ─────────────────────────────────────────────────────────────────────

const FIGHTER: ClassSeed = {
  characterClass: "Fighter",
  levels: [
    {
      level: 1,
      proficiencyBonus: prof(1),
      resourcePoolMax: 0, // No superiority dice yet
      featuresUnlocked: ["fighting-style", "second-wind"],
      features: [
        { name: "Fighting Style", description: "Adopt a particular style of combat as your specialty (e.g., Archery, Defense)." },
        { name: "Second Wind", description: "Bonus action: Regain 1d10 + fighter level HP. Uses reset on short/long rest." },
      ],
    },
    {
      level: 2,
      proficiencyBonus: prof(2),
      resourcePoolMax: 0,
      featuresUnlocked: ["action-surge"],
      features: [
        { name: "Action Surge", description: "Take one additional action on your turn. Once per short or long rest." },
      ],
    },
    {
      level: 3,
      proficiencyBonus: prof(3),
      resourcePoolMax: 4, // Gains 4 Superiority Dice
      featuresUnlocked: ["martial-archetype", "combat-maneuvers"],
      features: [
        { name: "Martial Archetype", description: "Choose a subclass (Champion, Battle Master, etc). Features at 3, 7, 10, 15, 18." },
        { name: "Combat Maneuvers (d8)", description: "Spend a superiority die to fuel tactical maneuvers. Dice refresh on short/long rest." },
      ],
    },
    {
      level: 4,
      proficiencyBonus: prof(4),
      resourcePoolMax: 4,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5,
      proficiencyBonus: prof(5),
      resourcePoolMax: 4,
      featuresUnlocked: ["extra-attack"],
      features: [
        { name: "Extra Attack", description: "Attack twice whenever you take the Attack action on your turn." },
      ],
    },
    {
      level: 6,
      proficiencyBonus: prof(6),
      resourcePoolMax: 4,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "Fighter bonus ASI: +2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 7,
      proficiencyBonus: prof(7),
      resourcePoolMax: 5, // Dice pool increases to 5
      featuresUnlocked: ["martial-archetype-feature"],
      features: [
        { name: "Martial Archetype Feature", description: "Subclass feature unlock." },
      ],
    },
    {
      level: 8,
      proficiencyBonus: prof(8),
      resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 9,
      proficiencyBonus: prof(9),
      resourcePoolMax: 5,
      featuresUnlocked: ["indomitable"],
      features: [
        { name: "Indomitable", description: "Reroll a failed saving throw. Must use the new roll. Once per long rest." },
      ],
    },
    {
      level: 10,
      proficiencyBonus: prof(10),
      resourcePoolMax: 5,
      featuresUnlocked: ["martial-archetype-feature", "improved-superiority-d10"],
      features: [
        { name: "Martial Archetype Feature", description: "Subclass feature unlock." },
        { name: "Improved Combat Maneuvers (d10)", description: "Your superiority dice turn into d10s." },
      ],
    },
    {
      level: 11,
      proficiencyBonus: prof(11),
      resourcePoolMax: 5,
      featuresUnlocked: ["extra-attack-2"],
      features: [
        { name: "Extra Attack (2)", description: "Attack three times whenever you take the Attack action." },
      ],
    },
    {
      level: 12,
      proficiencyBonus: prof(12),
      resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13,
      proficiencyBonus: prof(13),
      resourcePoolMax: 5,
      featuresUnlocked: ["indomitable-2"],
      features: [
        { name: "Indomitable (2 uses)", description: "You can use Indomitable twice between long rests." },
      ],
    },
    {
      level: 14,
      proficiencyBonus: prof(14),
      resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "Fighter bonus ASI: +2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 15,
      proficiencyBonus: prof(15),
      resourcePoolMax: 6, // Dice pool increases to 6
      featuresUnlocked: ["martial-archetype-feature"],
      features: [
        { name: "Martial Archetype Feature", description: "Subclass feature unlock." },
      ],
    },
    {
      level: 16,
      proficiencyBonus: prof(16),
      resourcePoolMax: 6,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17,
      proficiencyBonus: prof(17),
      resourcePoolMax: 6,
      featuresUnlocked: ["action-surge-2", "indomitable-3"],
      features: [
        { name: "Action Surge (2 uses)", description: "You can use Action Surge twice before resting, but only once per turn." },
        { name: "Indomitable (3 uses)", description: "You can use Indomitable three times between long rests." },
      ],
    },
    {
      level: 18,
      proficiencyBonus: prof(18),
      resourcePoolMax: 6,
      featuresUnlocked: ["martial-archetype-feature", "improved-superiority-d12"],
      features: [
        { name: "Martial Archetype Feature", description: "Subclass feature unlock." },
        { name: "Improved Combat Maneuvers (d12)", description: "Your superiority dice turn into d12s." },
      ],
    },
    {
      level: 19,
      proficiencyBonus: prof(19),
      resourcePoolMax: 6,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20,
      proficiencyBonus: prof(20),
      resourcePoolMax: 6,
      featuresUnlocked: ["extra-attack-3"],
      features: [
        { name: "Extra Attack (3)", description: "Attack four times whenever you take the Attack action." },
      ],
    },
  ],
};

// ─── Rogue ─────────────────────────────────────────────────────────────────────

const ROGUE: ClassSeed = {
  characterClass: "Rogue",
  levels: [
    {
      level: 1,
      proficiencyBonus: prof(1),
      resourcePoolMax: 1, // 1d6 Sneak Attack
      featuresUnlocked: ["expertise", "sneak-attack", "thieves-cant"],
      features: [
        { name: "Expertise", description: "Double your proficiency bonus for 2 proficient skills or thieves' tools." },
        { name: "Sneak Attack", description: "Deal extra damage once per turn to a target you have advantage against with a finesse/ranged weapon." },
        { name: "Thieves' Cant", description: "Understand and convey secret, hidden messages within seemingly normal conversation." },
      ],
    },
    {
      level: 2,
      proficiencyBonus: prof(2),
      resourcePoolMax: 1,
      featuresUnlocked: ["cunning-action"],
      features: [
        { name: "Cunning Action", description: "Take a bonus action on each of your turns to Dash, Disengage, or Hide." },
      ],
    },
    {
      level: 3,
      proficiencyBonus: prof(3),
      resourcePoolMax: 2, // 2d6 Sneak Attack
      featuresUnlocked: ["roguish-archetype"],
      features: [
        { name: "Roguish Archetype", description: "Choose a subclass (Thief, Assassin, Arcane Trickster, etc). Features at 3, 9, 13, 17." },
      ],
    },
    {
      level: 4,
      proficiencyBonus: prof(4),
      resourcePoolMax: 2,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5,
      proficiencyBonus: prof(5),
      resourcePoolMax: 3, // 3d6 Sneak Attack
      featuresUnlocked: ["uncanny-dodge"],
      features: [
        { name: "Uncanny Dodge", description: "Reaction: Halve the damage from an attack that hits you from an attacker you can see." },
      ],
    },
    {
      level: 6,
      proficiencyBonus: prof(6),
      resourcePoolMax: 3,
      featuresUnlocked: ["expertise"],
      features: [
        { name: "Expertise", description: "Double your proficiency bonus for 2 additional proficient skills." },
      ],
    },
    {
      level: 7,
      proficiencyBonus: prof(7),
      resourcePoolMax: 4, // 4d6 Sneak Attack
      featuresUnlocked: ["evasion"],
      features: [
        { name: "Evasion", description: "Area effects that allow a DEX save deal 0 damage on a success, and only half damage on a fail." },
      ],
    },
    {
      level: 8,
      proficiencyBonus: prof(8),
      resourcePoolMax: 4,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 9,
      proficiencyBonus: prof(9),
      resourcePoolMax: 5, // 5d6 Sneak Attack
      featuresUnlocked: ["roguish-archetype-feature"],
      features: [
        { name: "Roguish Archetype Feature", description: "Roguish Archetype subclass feature." },
      ],
    },
    {
      level: 10,
      proficiencyBonus: prof(10),
      resourcePoolMax: 5,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "Rogue bonus ASI: +2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 11,
      proficiencyBonus: prof(11),
      resourcePoolMax: 6, // 6d6 Sneak Attack
      featuresUnlocked: ["reliable-talent"],
      features: [
        { name: "Reliable Talent", description: "Treat any d20 roll of 9 or lower as a 10 for skills you are proficient in." },
      ],
    },
    {
      level: 12,
      proficiencyBonus: prof(12),
      resourcePoolMax: 6,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13,
      proficiencyBonus: prof(13),
      resourcePoolMax: 7, // 7d6 Sneak Attack
      featuresUnlocked: ["roguish-archetype-feature"],
      features: [
        { name: "Roguish Archetype Feature", description: "Roguish Archetype subclass feature." },
      ],
    },
    {
      level: 14,
      proficiencyBonus: prof(14),
      resourcePoolMax: 7,
      featuresUnlocked: ["blindsense"],
      features: [
        { name: "Blindsense", description: "If you can hear, you know the location of hidden/invisible creatures within 10 feet." },
      ],
    },
    {
      level: 15,
      proficiencyBonus: prof(15),
      resourcePoolMax: 8, // 8d6 Sneak Attack
      featuresUnlocked: ["slippery-mind"],
      features: [
        { name: "Slippery Mind", description: "Gain proficiency in Wisdom saving throws." },
      ],
    },
    {
      level: 16,
      proficiencyBonus: prof(16),
      resourcePoolMax: 8,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17,
      proficiencyBonus: prof(17),
      resourcePoolMax: 9, // 9d6 Sneak Attack
      featuresUnlocked: ["roguish-archetype-feature"],
      features: [
        { name: "Roguish Archetype Feature", description: "Roguish Archetype subclass feature." },
      ],
    },
    {
      level: 18,
      proficiencyBonus: prof(18),
      resourcePoolMax: 9,
      featuresUnlocked: ["elusive"],
      features: [
        { name: "Elusive", description: "No attack roll can have advantage against you as long as you aren't incapacitated." },
      ],
    },
    {
      level: 19,
      proficiencyBonus: prof(19),
      resourcePoolMax: 10, // 10d6 Sneak Attack
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20,
      proficiencyBonus: prof(20),
      resourcePoolMax: 10,
      featuresUnlocked: ["stroke-of-genius"],
      features: [
        { name: "Stroke of Luck", description: "Once per short/long rest, turn a missed attack into a hit, or a failed ability check into a 20." },
      ],
    },
  ],
};

// ─── Wizard ─────────────────────────────────────────────────────────────────────

const WIZARD: ClassSeed = {
  characterClass: "Wizard",
  levels: [
    {
      level: 1,
      proficiencyBonus: prof(1),
      resourcePoolMax: 2, // Two 1st-level slots
      featuresUnlocked: ["spellcasting", "arcane-recovery"],
      features: [
        { name: "Spellcasting", description: "Cast wizard spells using INT. Start with 3 cantrips and 6 1st-level spells in your spellbook." },
        { name: "Arcane Recovery", description: "Once per day on a short rest, recover expended spell slots with a combined level equal to half your wizard level (rounded up)." },
      ],
    },
    {
      level: 2,
      proficiencyBonus: prof(2),
      resourcePoolMax: 3, // Three 1st-level slots
      featuresUnlocked: ["arcane-tradition"],
      features: [
        { name: "Arcane Tradition", description: "Choose your wizard subclass school (Evocation, Necromancy, etc). Features at 2, 6, 10, 14." },
      ],
    },
    {
      level: 3,
      proficiencyBonus: prof(3),
      resourcePoolMax: 6, // Four 1st, two 2nd-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 4,
      proficiencyBonus: prof(4),
      resourcePoolMax: 7, // Four 1st, three 2nd-level slots
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5,
      proficiencyBonus: prof(5),
      resourcePoolMax: 9, // Four 1st, three 2nd, two 3rd-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 6,
      proficiencyBonus: prof(6),
      resourcePoolMax: 10, // Four 1st, three 2nd, three 3rd-level slots
      featuresUnlocked: ["arcane-tradition-feature"],
      features: [
        { name: "Arcane Tradition Feature", description: "Arcane Tradition subclass feature." },
      ],
    },
    {
      level: 7,
      proficiencyBonus: prof(7),
      resourcePoolMax: 11, // Standard slot scaling plus unlocking 4th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 8,
      proficiencyBonus: prof(8),
      resourcePoolMax: 12, // Standard slot scaling plus second 4th-level slot
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 9,
      proficiencyBonus: prof(9),
      resourcePoolMax: 14, // Standard slot scaling plus unlocking 5th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 10,
      proficiencyBonus: prof(10),
      resourcePoolMax: 15, // Standard slot scaling plus second 5th-level slot
      featuresUnlocked: ["arcane-tradition-feature"],
      features: [
        { name: "Arcane Tradition Feature", description: "Arcane Tradition subclass feature." },
      ],
    },
    {
      level: 11,
      proficiencyBonus: prof(11),
      resourcePoolMax: 16, // Slots total increases; unlocks 6th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 12,
      proficiencyBonus: prof(12),
      resourcePoolMax: 16, // Slots stay flat; focus is on ASI
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13,
      proficiencyBonus: prof(13),
      resourcePoolMax: 17, // Slots total increases; unlocks 7th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 14,
      proficiencyBonus: prof(14),
      resourcePoolMax: 17, // Slots stay flat; focus on subclass capstone
      featuresUnlocked: ["arcane-tradition-feature"],
      features: [
        { name: "Arcane Tradition Feature", description: "Arcane Tradition subclass capstone feature." },
      ],
    },
    {
      level: 15,
      proficiencyBonus: prof(15),
      resourcePoolMax: 18, // Slots total increases; unlocks 8th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 16,
      proficiencyBonus: prof(16),
      resourcePoolMax: 18,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17,
      proficiencyBonus: prof(17),
      resourcePoolMax: 19, // Slots total increases; unlocks tier 9 spells (Wish)
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 18,
      proficiencyBonus: prof(18),
      resourcePoolMax: 20, // Gains extra low level slot allocation capability
      featuresUnlocked: ["spell-mastery"],
      features: [
        { name: "Spell Mastery", description: "Choose a 1st-level and 2nd-level wizard spell in your spellbook. You can cast them at their lowest level without expending a spell slot." },
      ],
    },
    {
      level: 19,
      proficiencyBonus: prof(19),
      resourcePoolMax: 21, // Final regular spell slot tier scaling
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20,
      proficiencyBonus: prof(20),
      resourcePoolMax: 22, // Max slot ceiling achieved
      featuresUnlocked: ["signature-spells"],
      features: [
        { name: "Signature Spells", description: "Choose two 3rd-level wizard spells as signature spells. They are always prepared, don't count against prep limits, and can be cast once each at 3rd level for free per short/long rest." },
      ],
    },
  ],
};


// ─── Cleric ─────────────────────────────────────────────────────────────────────

const CLERIC: ClassSeed = {
  characterClass: "Cleric",
  levels: [
    {
      level: 1,
      proficiencyBonus: prof(1),
      resourcePoolMax: 2, // Two 1st-level slots
      featuresUnlocked: ["spellcasting", "divine-domain"],
      features: [
        { name: "Spellcasting", description: "Cast cleric spells using WIS. You prepare a list of spells from the entire cleric list after a long rest." },
        { name: "Divine Domain", description: "Choose a religious subclass domain (Life, Light, etc.). Grants domain spells and features at 1, 2, 6, 8, 17." },
      ],
    },
    {
      level: 2,
      proficiencyBonus: prof(2),
      resourcePoolMax: 3, // Three 1st-level slots
      featuresUnlocked: ["channel-divinity", "divine-domain-feature"],
      features: [
        { name: "Channel Divinity (1/rest)", description: "Fuel divine effects (like Turn Undead or subclass powers). Regain on short or long rest." },
        { name: "Divine Domain Feature", description: "Subclass-specific Channel Divinity option." },
      ],
    },
    {
      level: 3,
      proficiencyBonus: prof(3),
      resourcePoolMax: 6, // Four 1st, two 2nd-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 4,
      proficiencyBonus: prof(4),
      resourcePoolMax: 7, // Four 1st, three 2nd-level slots
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 5,
      proficiencyBonus: prof(5),
      resourcePoolMax: 9, // Four 1st, three 2nd, two 3rd-level slots
      featuresUnlocked: ["destroy-undead-cr12"],
      features: [
        { name: "Destroy Undead (CR 1/2)", description: "When you use Turn Undead, lower-level undead are instantly destroyed if they fail their save." },
      ],
    },
    {
      level: 6,
      proficiencyBonus: prof(6),
      resourcePoolMax: 10, // Four 1st, three 2nd, three 3rd-level slots
      featuresUnlocked: ["channel-divinity-2", "divine-domain-feature"],
      features: [
        { name: "Channel Divinity (2/rest)", description: "You can now use Channel Divinity twice per short or long rest." },
        { name: "Divine Domain Feature", description: "Divine Domain subclass feature." },
      ],
    },
    {
      level: 7,
      proficiencyBonus: prof(7),
      resourcePoolMax: 11, // Unlocks 4th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 8,
      proficiencyBonus: prof(8),
      resourcePoolMax: 12,
      featuresUnlocked: ["asi", "divine-domain-feature", "destroy-undead-cr1"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
        { name: "Divine Domain Feature", description: "Subclass feature (usually Potent Spellcasting or Divine Strike)." },
        { name: "Destroy Undead (CR 1)", description: "Destroy Undead threshold increases to CR 1." },
      ],
    },
    {
      level: 9,
      proficiencyBonus: prof(9),
      resourcePoolMax: 14, // Unlocks 5th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 10,
      proficiencyBonus: prof(10),
      resourcePoolMax: 15,
      featuresUnlocked: ["divine-intervention"],
      features: [
        { name: "Divine Intervention", description: "Action: Roll percentile dice. If you roll equal to or lower than your cleric level, your deity intervenes." },
      ],
    },
    {
      level: 11,
      proficiencyBonus: prof(11),
      resourcePoolMax: 16, // Unlocks 6th-level slots
      featuresUnlocked: ["destroy-undead-cr2"],
      features: [
        { name: "Destroy Undead (CR 2)", description: "Destroy Undead threshold increases to CR 2." },
      ],
    },
    {
      level: 12,
      proficiencyBonus: prof(12),
      resourcePoolMax: 16,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 13,
      proficiencyBonus: prof(13),
      resourcePoolMax: 17, // Unlocks 7th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 14,
      proficiencyBonus: prof(14),
      resourcePoolMax: 17,
      featuresUnlocked: ["destroy-undead-cr3"],
      features: [
        { name: "Destroy Undead (CR 3)", description: "Destroy Undead threshold increases to CR 3." },
      ],
    },
    {
      level: 15,
      proficiencyBonus: prof(15),
      resourcePoolMax: 18, // Unlocks 8th-level slots
      featuresUnlocked: [],
      features: [],
    },
    {
      level: 16,
      proficiencyBonus: prof(16),
      resourcePoolMax: 18,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 17,
      proficiencyBonus: prof(17),
      resourcePoolMax: 19, // Unlocks 9th-level slots
      featuresUnlocked: ["divine-domain-feature", "destroy-undead-cr4"],
      features: [
        { name: "Divine Domain Feature", description: "Subclass capstone feature." },
        { name: "Destroy Undead (CR 4)", description: "Destroy Undead threshold increases to CR 4." },
      ],
    },
    {
      level: 18,
      proficiencyBonus: prof(18),
      resourcePoolMax: 20,
      featuresUnlocked: ["channel-divinity-3"],
      features: [
        { name: "Channel Divinity (3/rest)", description: "You can now use Channel Divinity three times per short or long rest." },
      ],
    },
    {
      level: 19,
      proficiencyBonus: prof(19),
      resourcePoolMax: 21,
      featuresUnlocked: ["asi"],
      features: [
        { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." },
      ],
    },
    {
      level: 20,
      proficiencyBonus: prof(20),
      resourcePoolMax: 22,
      featuresUnlocked: ["divine-intervention-improvement"],
      features: [
        { name: "Divine Intervention Improvement", description: "Your Divine Intervention no longer requires a roll; it succeeds automatically when used." },
      ],
    },
  ],
};


// ─── Druid ───────────────────────────────────────────────────────────────────

const DRUID: ClassSeed = {
  characterClass: "Druid",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: CASTER_POOL[1],  featuresUnlocked: ["spellcasting", "druidic"], features: [{ name: "Spellcasting", description: "WIS spellcasting. Prepare WIS mod + Druid level spells per long rest from the Druid list." }, { name: "Druidic", description: "Know the secret Druidic language and can leave hidden messages only other Druids can read." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: CASTER_POOL[2],  featuresUnlocked: ["wild-shape", "druid-circle"], features: [{ name: "Wild Shape", description: "Action: transform into a beast CR ≤ 1/4 (no fly/swim). 2 uses/short rest. Duration = half Druid level in hours." }, { name: "Druid Circle", description: "Choose Circle subclass (Land, Moon, etc). Features at 2, 6, 10, 14." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: CASTER_POOL[3],  featuresUnlocked: [], features: [] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: CASTER_POOL[4],  featuresUnlocked: ["wild-shape-cr12", "asi"], features: [{ name: "Wild Shape Improvement", description: "Wild Shape can now assume beasts with swim speed and CR ≤ 1/2." }, { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: CASTER_POOL[5],  featuresUnlocked: [], features: [] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: CASTER_POOL[6],  featuresUnlocked: ["circle-feature"], features: [{ name: "Circle Feature", description: "Druid Circle subclass feature." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: CASTER_POOL[7],  featuresUnlocked: [], features: [] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: CASTER_POOL[8],  featuresUnlocked: ["wild-shape-cr1", "asi"], features: [{ name: "Wild Shape Improvement", description: "Wild Shape can now assume beasts with fly speed and CR ≤ 1." }, { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: CASTER_POOL[9],  featuresUnlocked: [], features: [] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: CASTER_POOL[10], featuresUnlocked: ["circle-feature"], features: [{ name: "Circle Feature", description: "Druid Circle subclass feature." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: CASTER_POOL[11], featuresUnlocked: [], features: [] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: CASTER_POOL[12], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: CASTER_POOL[13], featuresUnlocked: [], features: [] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: CASTER_POOL[14], featuresUnlocked: ["circle-feature"], features: [{ name: "Circle Feature", description: "Druid Circle subclass feature." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: CASTER_POOL[15], featuresUnlocked: [], features: [] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: CASTER_POOL[16], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: CASTER_POOL[17], featuresUnlocked: [], features: [] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: CASTER_POOL[18], featuresUnlocked: ["timeless-body", "beast-spells"], features: [{ name: "Timeless Body", description: "No longer suffer age-related ability score penalties and cannot be magically aged." }, { name: "Beast Spells", description: "Cast Druid spells in Wild Shape form using verbal and somatic components." }] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: CASTER_POOL[19], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: CASTER_POOL[20], featuresUnlocked: ["archdruid"], features: [{ name: "Archdruid", description: "Unlimited Wild Shape uses. Ignore verbal and somatic components of Druid spells while transformed." }] },
  ],
};

// ─── Monk ────────────────────────────────────────────────────────────────────

const MONK: ClassSeed = {
  characterClass: "Monk",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: null, featuresUnlocked: ["unarmored-defense", "martial-arts"], features: [{ name: "Unarmored Defense", description: "AC = 10 + DEX mod + WIS mod when wearing no armor and no shield." }, { name: "Martial Arts", description: "Use DEX for unarmed/monk weapon attacks. Unarmed strike deals 1d4 (scales with level). Bonus unarmed strike after the Attack action." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: 2,    featuresUnlocked: ["ki", "unarmored-movement"], features: [{ name: "Ki", description: "2 Ki points/short rest. Flurry of Blows (2 unarmed strikes, bonus action), Patient Defense (Dodge, bonus action), Step of the Wind (Dash or Disengage, bonus action)." }, { name: "Unarmored Movement", description: "+10 ft speed when not wearing armor or shield. Improves at higher levels." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: 3,    featuresUnlocked: ["monastic-tradition", "deflect-missiles"], features: [{ name: "Monastic Tradition", description: "Choose subclass (Open Hand, Shadow, Four Elements, etc). Features at 3, 6, 11, 17." }, { name: "Deflect Missiles", description: "Reaction: reduce ranged weapon damage by 1d10 + DEX + Monk level. If reduced to 0, catch and throw it back for 1 Ki." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: 4,    featuresUnlocked: ["slow-fall", "asi"], features: [{ name: "Slow Fall", description: "Reaction: reduce falling damage by 5× Monk level." }, { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: 5,    featuresUnlocked: ["extra-attack", "stunning-strike"], features: [{ name: "Extra Attack", description: "Attack twice when taking the Attack action." }, { name: "Stunning Strike", description: "After hitting, spend 1 Ki: target makes CON save (DC 8 + prof + WIS) or is stunned until end of your next turn." }] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: 6,    featuresUnlocked: ["ki-empowered-strikes", "tradition-feature"], features: [{ name: "Ki-Empowered Strikes", description: "Unarmed strikes count as magical for overcoming resistance and immunity." }, { name: "Monastic Tradition Feature", description: "Subclass feature at level 6." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: 7,    featuresUnlocked: ["evasion", "stillness-of-mind"], features: [{ name: "Evasion", description: "On DEX saves: no damage on success, half on failure." }, { name: "Stillness of Mind", description: "Use your action to end one charmed or frightened effect on yourself." }] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: 8,    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: 9,    featuresUnlocked: ["unarmored-movement-improvement"], features: [{ name: "Unarmored Movement Improvement", description: "Move along vertical surfaces and across liquids without falling during your turn." }] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: 10,   featuresUnlocked: ["purity-of-body", "tradition-feature"], features: [{ name: "Purity of Body", description: "Immune to disease and poison." }, { name: "Monastic Tradition Feature", description: "Subclass feature at level 10." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: 11,   featuresUnlocked: ["tongue-of-sun-and-moon"], features: [{ name: "Tongue of the Sun and Moon", description: "Understand all spoken languages. Any creature that understands a language can understand you." }] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: 12,   featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: 13,   featuresUnlocked: ["diamond-soul"], features: [{ name: "Diamond Soul", description: "Proficiency in all saving throws. Spend 1 Ki to reroll a failed save." }] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: 14,   featuresUnlocked: ["timeless-body"], features: [{ name: "Timeless Body", description: "No longer need food or water, and suffer no aging penalties." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: 15,   featuresUnlocked: ["empty-body"], features: [{ name: "Empty Body", description: "4 Ki: become invisible 1 minute with resistance to all damage except force. 8 Ki: cast Astral Projection on yourself." }] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: 16,   featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: 17,   featuresUnlocked: ["tradition-feature"], features: [{ name: "Monastic Tradition Feature", description: "Subclass capstone feature at level 17." }] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: 18,   featuresUnlocked: [], features: [] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: 19,   featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: 20,   featuresUnlocked: ["perfect-self"], features: [{ name: "Perfect Self", description: "Regain 4 Ki points when you roll initiative and have no Ki remaining." }] },
  ],
};

// ─── Paladin ─────────────────────────────────────────────────────────────────

const PALADIN: ClassSeed = {
  characterClass: "Paladin",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: 5,                     featuresUnlocked: ["divine-sense", "lay-on-hands"], features: [{ name: "Divine Sense", description: "Action: detect celestials, fiends, and undead within 60 ft until end of next turn. 1 + CHA mod uses/long rest." }, { name: "Lay on Hands", description: "Pool of 5× Paladin level HP. Touch to restore HP, or spend 5 HP to cure a disease or neutralize a poison." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: 10,                    featuresUnlocked: ["fighting-style", "spellcasting", "divine-smite"], features: [{ name: "Fighting Style", description: "Choose Defense (+1 AC), Dueling (+2 one-hand damage), Great Weapon Fighting, or Protection." }, { name: "Spellcasting", description: "CHA spellcasting. Prepare CHA mod + half Paladin level spells. Spell slots per the half-caster table." }, { name: "Divine Smite", description: "When you hit with a melee attack, expend a spell slot to deal +2d8 radiant damage per slot level (max 5d8). +1d8 vs undead/fiends." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: 15,                    featuresUnlocked: ["sacred-oath", "divine-health"], features: [{ name: "Sacred Oath", description: "Choose your Oath (Devotion, Ancients, Vengeance, etc). Grants oath spells, Channel Divinity, and features at 3, 7, 15, 20." }, { name: "Divine Health", description: "Immune to disease." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: 20,                    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: 25,                    featuresUnlocked: ["extra-attack"], features: [{ name: "Extra Attack", description: "Attack twice when taking the Attack action." }] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: 30,                    featuresUnlocked: ["aura-of-protection"], features: [{ name: "Aura of Protection", description: "Allies within 10 ft add your CHA modifier to all saving throws while you're conscious." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: 35,                    featuresUnlocked: ["sacred-oath-feature"], features: [{ name: "Sacred Oath Feature", description: "Subclass feature at level 7." }] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: 40,                    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: 45,                    featuresUnlocked: [], features: [] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: 50,                    featuresUnlocked: ["aura-of-courage"], features: [{ name: "Aura of Courage", description: "Allies within 10 ft cannot be frightened while you are conscious." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: 55,                    featuresUnlocked: ["improved-divine-smite"], features: [{ name: "Improved Divine Smite", description: "All melee weapon hits deal +1d8 radiant damage automatically, stacking with Divine Smite." }] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: 60,                    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: 65,                    featuresUnlocked: [], features: [] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: 70,                    featuresUnlocked: ["cleansing-touch"], features: [{ name: "Cleansing Touch", description: "Action: end one spell effect on yourself or a willing creature you touch. CHA mod uses/long rest." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: 75,                    featuresUnlocked: ["sacred-oath-feature"], features: [{ name: "Sacred Oath Feature", description: "Subclass feature at level 15." }] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: 80,                    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: 85,                    featuresUnlocked: [], features: [] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: 90,                    featuresUnlocked: ["aura-improvement"], features: [{ name: "Aura Improvement", description: "Aura of Protection and Aura of Courage now extend to 30 ft." }] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: 95,                    featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: 100,                   featuresUnlocked: ["sacred-oath-capstone"], features: [{ name: "Sacred Oath Capstone", description: "Each Oath grants a unique level-20 transformation or ability, such as becoming a holy avenger or avatar of nature." }] },
  ],
};

// ─── Ranger ──────────────────────────────────────────────────────────────────

const RANGER: ClassSeed = {
  characterClass: "Ranger",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: HALF_CASTER_POOL[1],  featuresUnlocked: ["favored-enemy", "natural-explorer"], features: [{ name: "Favored Enemy", description: "Choose a creature type. Advantage on Survival to track them and INT checks to recall lore about them." }, { name: "Natural Explorer", description: "Choose a favored terrain. Benefits include ignoring difficult terrain penalties and doubling proficiency on terrain-related INT/WIS checks." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: HALF_CASTER_POOL[2],  featuresUnlocked: ["fighting-style", "spellcasting"], features: [{ name: "Fighting Style", description: "Choose Archery (+2 ranged attack), Defense (+1 AC), Dueling, or Two-Weapon Fighting." }, { name: "Spellcasting", description: "WIS spellcasting. Know 2 spells at level 2. Spell slots based on half Ranger level." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: HALF_CASTER_POOL[3],  featuresUnlocked: ["ranger-archetype", "primeval-awareness"], features: [{ name: "Ranger Archetype", description: "Choose Hunter, Beast Master, Gloom Stalker, etc. Features at 3, 7, 11, 15." }, { name: "Primeval Awareness", description: "Expend a spell slot to sense favored enemies within 1 mile (6 miles in favored terrain). Duration 1 min/slot level." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: HALF_CASTER_POOL[4],  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: HALF_CASTER_POOL[5],  featuresUnlocked: ["extra-attack"], features: [{ name: "Extra Attack", description: "Attack twice when taking the Attack action." }] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: HALF_CASTER_POOL[6],  featuresUnlocked: ["favored-enemy-2", "natural-explorer-2"], features: [{ name: "Favored Enemy", description: "Choose a second favored enemy type and learn one language it speaks." }, { name: "Natural Explorer", description: "Choose a second favored terrain type." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: HALF_CASTER_POOL[7],  featuresUnlocked: ["archetype-feature"], features: [{ name: "Ranger Archetype Feature", description: "Subclass feature at level 7." }] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: HALF_CASTER_POOL[8],  featuresUnlocked: ["lands-stride", "asi"], features: [{ name: "Land's Stride", description: "Nonmagical difficult terrain costs no extra movement. Advantage on saves vs magically created plants." }, { name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: HALF_CASTER_POOL[9],  featuresUnlocked: [], features: [] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: HALF_CASTER_POOL[10], featuresUnlocked: ["hide-in-plain-sight", "natural-explorer-3"], features: [{ name: "Hide in Plain Sight", description: "Spend 1 min to camouflage yourself: +10 to Stealth while motionless." }, { name: "Natural Explorer", description: "Choose a third favored terrain type." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: HALF_CASTER_POOL[11], featuresUnlocked: ["archetype-feature"], features: [{ name: "Ranger Archetype Feature", description: "Subclass feature at level 11." }] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: HALF_CASTER_POOL[12], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: HALF_CASTER_POOL[13], featuresUnlocked: [], features: [] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: HALF_CASTER_POOL[14], featuresUnlocked: ["vanish", "favored-enemy-3"], features: [{ name: "Vanish", description: "Hide as a bonus action. Cannot be tracked by nonmagical means unless you choose to leave a trail." }, { name: "Favored Enemy", description: "Choose a third favored enemy type." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: HALF_CASTER_POOL[15], featuresUnlocked: ["archetype-feature"], features: [{ name: "Ranger Archetype Feature", description: "Subclass feature at level 15." }] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: HALF_CASTER_POOL[16], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: HALF_CASTER_POOL[17], featuresUnlocked: [], features: [] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: HALF_CASTER_POOL[18], featuresUnlocked: ["feral-senses"], features: [{ name: "Feral Senses", description: "No penalty attacking invisible creatures. Aware of invisible creatures within 30 ft that aren't hidden from you." }] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: HALF_CASTER_POOL[19], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: HALF_CASTER_POOL[20], featuresUnlocked: ["foe-slayer"], features: [{ name: "Foe Slayer", description: "Once per turn, add your WIS modifier to an attack or damage roll against your favored enemy." }] },
  ],
};

// ─── Sorcerer ────────────────────────────────────────────────────────────────

const SORCERER: ClassSeed = {
  characterClass: "Sorcerer",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: CASTER_POOL[1],  featuresUnlocked: ["spellcasting", "sorcerous-origin"], features: [{ name: "Spellcasting", description: "CHA spellcasting. Know 2 cantrips + 2 spells at level 1. Spells are known (not prepared) — swap one per level-up." }, { name: "Sorcerous Origin", description: "Choose your innate power source: Draconic Bloodline, Wild Magic, Storm, etc. Features at 1, 6, 14, 18." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: CASTER_POOL[2],  featuresUnlocked: ["sorcery-points", "font-of-magic"], features: [{ name: "Sorcery Points", description: "2 sorcery points (= your level). Flexible Casting: spend points to create slots or convert slots to points." }, { name: "Font of Magic", description: "Regain all sorcery points on a long rest." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: CASTER_POOL[3],  featuresUnlocked: ["metamagic"], features: [{ name: "Metamagic", description: "Choose 2 options: Careful (+1 pt), Distant (+1 pt), Empowered (+1 pt), Extended (+1 pt), Heightened (+3 pts), Quickened (+2 pts), Subtle (+1 pt), Twinned (1–9 pts)." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: CASTER_POOL[4],  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: CASTER_POOL[5],  featuresUnlocked: [], features: [] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: CASTER_POOL[6],  featuresUnlocked: ["origin-feature"], features: [{ name: "Sorcerous Origin Feature", description: "Subclass feature at level 6." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: CASTER_POOL[7],  featuresUnlocked: [], features: [] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: CASTER_POOL[8],  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: CASTER_POOL[9],  featuresUnlocked: [], features: [] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: CASTER_POOL[10], featuresUnlocked: ["metamagic-2"], features: [{ name: "Metamagic", description: "Learn one additional Metamagic option." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: CASTER_POOL[11], featuresUnlocked: [], features: [] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: CASTER_POOL[12], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: CASTER_POOL[13], featuresUnlocked: [], features: [] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: CASTER_POOL[14], featuresUnlocked: ["origin-feature"], features: [{ name: "Sorcerous Origin Feature", description: "Subclass feature at level 14." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: CASTER_POOL[15], featuresUnlocked: [], features: [] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: CASTER_POOL[16], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: CASTER_POOL[17], featuresUnlocked: ["metamagic-3"], features: [{ name: "Metamagic", description: "Learn one additional Metamagic option." }] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: CASTER_POOL[18], featuresUnlocked: ["origin-feature"], features: [{ name: "Sorcerous Origin Feature", description: "Subclass feature at level 18." }] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: CASTER_POOL[19], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: CASTER_POOL[20], featuresUnlocked: ["sorcerous-restoration"], features: [{ name: "Sorcerous Restoration", description: "Regain 4 expended sorcery points whenever you finish a short rest." }] },
  ],
};

// ─── Warlock ─────────────────────────────────────────────────────────────────

const WARLOCK: ClassSeed = {
  characterClass: "Warlock",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: WARLOCK_POOL[1],  featuresUnlocked: ["otherworldly-patron", "pact-magic"], features: [{ name: "Otherworldly Patron", description: "Form a pact with The Archfey, The Fiend, The Great Old One, etc. Grants expanded spells and features at 1, 6, 10, 14." }, { name: "Pact Magic", description: "CHA spellcasting. Spell slots recharge on short rest. 1 slot at level 1, 2 at level 2. Slot level scales with Warlock level." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: WARLOCK_POOL[2],  featuresUnlocked: ["eldritch-invocations"], features: [{ name: "Eldritch Invocations", description: "Choose 2 invocations: Agonizing Blast (+CHA to Eldritch Blast), Devil's Sight (see in magical darkness), Mask of Many Faces (Disguise Self at will), and others." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: WARLOCK_POOL[3],  featuresUnlocked: ["pact-boon"], features: [{ name: "Pact Boon", description: "Choose Pact of the Chain (improved familiar), Pact of the Blade (summon pact weapon), or Pact of the Tome (Book of Shadows with 3 extra cantrips)." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: WARLOCK_POOL[4],  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: WARLOCK_POOL[5],  featuresUnlocked: [], features: [] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: WARLOCK_POOL[6],  featuresUnlocked: ["patron-feature"], features: [{ name: "Patron Feature", description: "Otherworldly Patron subclass feature at level 6." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: WARLOCK_POOL[7],  featuresUnlocked: [], features: [] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: WARLOCK_POOL[8],  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: WARLOCK_POOL[9],  featuresUnlocked: [], features: [] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: WARLOCK_POOL[10], featuresUnlocked: ["patron-feature"], features: [{ name: "Patron Feature", description: "Otherworldly Patron subclass feature at level 10." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: WARLOCK_POOL[11], featuresUnlocked: ["mystic-arcanum-6"], features: [{ name: "Mystic Arcanum (6th)", description: "Choose one 6th-level spell. Cast it once/long rest without a slot. Separate Arcana gained at 11 (6th), 13 (7th), 15 (8th), 17 (9th)." }] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: WARLOCK_POOL[12], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: WARLOCK_POOL[13], featuresUnlocked: ["mystic-arcanum-7"], features: [{ name: "Mystic Arcanum (7th)", description: "Choose one 7th-level spell. Cast it once/long rest without a slot." }] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: WARLOCK_POOL[14], featuresUnlocked: ["patron-feature"], features: [{ name: "Patron Feature", description: "Otherworldly Patron subclass feature at level 14." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: WARLOCK_POOL[15], featuresUnlocked: ["mystic-arcanum-8"], features: [{ name: "Mystic Arcanum (8th)", description: "Choose one 8th-level spell. Cast it once/long rest without a slot." }] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: WARLOCK_POOL[16], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: WARLOCK_POOL[17], featuresUnlocked: ["mystic-arcanum-9"], features: [{ name: "Mystic Arcanum (9th)", description: "Choose one 9th-level spell. Cast it once/long rest without a slot." }] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: WARLOCK_POOL[18], featuresUnlocked: [], features: [] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: WARLOCK_POOL[19], featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: WARLOCK_POOL[20], featuresUnlocked: ["eldritch-master"], features: [{ name: "Eldritch Master", description: "Spend 1 minute communing with your patron to regain all Pact Magic slots. Once/long rest." }] },
  ],
};

// ─── Artificer ───────────────────────────────────────────────────────────────

const ARTIFICER: ClassSeed = {
  characterClass: "Artificer",
  levels: [
    { level: 1,  proficiencyBonus: prof(1),  resourcePoolMax: null,                   featuresUnlocked: ["magical-tinkering", "spellcasting"], features: [{ name: "Magical Tinkering", description: "Imbue a tiny nonmagical object with one minor magical property: emit light, emit a recorded message, emit an odor, or display a static image." }, { name: "Spellcasting", description: "INT spellcasting. Prepare INT mod + half Artificer level spells. Always have spells prepared from your specialist list." }] },
    { level: 2,  proficiencyBonus: prof(2),  resourcePoolMax: 2,                      featuresUnlocked: ["infuse-item"], features: [{ name: "Infuse Item", description: "Learn 4 infusions; embed 2 in nonmagical items during a long rest. Infusions are permanent until you die or re-prepare. Gain more infusions as you level." }] },
    { level: 3,  proficiencyBonus: prof(3),  resourcePoolMax: HALF_CASTER_POOL[3]!,   featuresUnlocked: ["artificer-specialist", "right-tool"], features: [{ name: "Artificer Specialist", description: "Choose Alchemist, Armorer, Artillerist, or Battle Smith. Grants specialist spells and features at 3, 5, 9, 15." }, { name: "The Right Tool for the Job", description: "Spend 1 hour and 10 gp of materials to conjure one set of artisan's tools in an unoccupied space within 5 ft." }] },
    { level: 4,  proficiencyBonus: prof(4),  resourcePoolMax: HALF_CASTER_POOL[4]!,   featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 5,  proficiencyBonus: prof(5),  resourcePoolMax: HALF_CASTER_POOL[5]!,   featuresUnlocked: ["specialist-feature"], features: [{ name: "Specialist Feature", description: "Artificer Specialist feature at level 5." }] },
    { level: 6,  proficiencyBonus: prof(6),  resourcePoolMax: HALF_CASTER_POOL[6]!,   featuresUnlocked: ["tool-expertise"], features: [{ name: "Tool Expertise", description: "Double proficiency bonus on any ability check using a tool you're proficient with." }] },
    { level: 7,  proficiencyBonus: prof(7),  resourcePoolMax: HALF_CASTER_POOL[7]!,   featuresUnlocked: ["flash-of-genius"], features: [{ name: "Flash of Genius", description: "Reaction: add your INT modifier to one ability check or saving throw a creature within 30 ft just made. INT mod uses/long rest." }] },
    { level: 8,  proficiencyBonus: prof(8),  resourcePoolMax: HALF_CASTER_POOL[8]!,   featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 9,  proficiencyBonus: prof(9),  resourcePoolMax: HALF_CASTER_POOL[9]!,   featuresUnlocked: ["specialist-feature"], features: [{ name: "Specialist Feature", description: "Artificer Specialist feature at level 9." }] },
    { level: 10, proficiencyBonus: prof(10), resourcePoolMax: HALF_CASTER_POOL[10]!,  featuresUnlocked: ["magic-item-adept"], features: [{ name: "Magic Item Adept", description: "Attune to up to 4 magic items (instead of 3). Craft common and uncommon magic items in half the normal time and for half the gold cost." }] },
    { level: 11, proficiencyBonus: prof(11), resourcePoolMax: HALF_CASTER_POOL[11]!,  featuresUnlocked: ["spell-storing-item"], features: [{ name: "Spell-Storing Item", description: "After a long rest, store one 1st- or 2nd-level artificer spell in a simple/martial weapon or spellcasting focus. A creature holding it can use an action to cast the spell (INT-based). 2× INT mod charges." }] },
    { level: 12, proficiencyBonus: prof(12), resourcePoolMax: HALF_CASTER_POOL[12]!,  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 13, proficiencyBonus: prof(13), resourcePoolMax: HALF_CASTER_POOL[13]!,  featuresUnlocked: [], features: [] },
    { level: 14, proficiencyBonus: prof(14), resourcePoolMax: HALF_CASTER_POOL[14]!,  featuresUnlocked: ["magic-item-savant"], features: [{ name: "Magic Item Savant", description: "Attune to up to 5 magic items. Ignore class, race, spell, and level requirements on attuning to or using magic items." }] },
    { level: 15, proficiencyBonus: prof(15), resourcePoolMax: HALF_CASTER_POOL[15]!,  featuresUnlocked: ["specialist-feature"], features: [{ name: "Specialist Feature", description: "Artificer Specialist feature at level 15." }] },
    { level: 16, proficiencyBonus: prof(16), resourcePoolMax: HALF_CASTER_POOL[16]!,  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 17, proficiencyBonus: prof(17), resourcePoolMax: HALF_CASTER_POOL[17]!,  featuresUnlocked: [], features: [] },
    { level: 18, proficiencyBonus: prof(18), resourcePoolMax: HALF_CASTER_POOL[18]!,  featuresUnlocked: ["magic-item-master"], features: [{ name: "Magic Item Master", description: "Attune to up to 6 magic items at once." }] },
    { level: 19, proficiencyBonus: prof(19), resourcePoolMax: HALF_CASTER_POOL[19]!,  featuresUnlocked: ["asi"], features: [{ name: "ASI", description: "+2 to one ability score, or +1 to two, or a feat." }] },
    { level: 20, proficiencyBonus: prof(20), resourcePoolMax: HALF_CASTER_POOL[20]!,  featuresUnlocked: ["soul-of-artifice"], features: [{ name: "Soul of Artifice", description: "+1 to all saving throws per magic item you're attuned to. If reduced to 0 HP, use your reaction to end one of your artificer infusions and drop to 1 HP instead." }] },
  ],
};

// ─── Registry — append new classes here ──────────────────────────────────────

const CLASSES: ClassSeed[] = [ARTIFICER, BARBARIAN, BARD, DRUID, FIGHTER, MONK, PALADIN, RANGER, ROGUE, SORCERER, WARLOCK, WIZARD, CLERIC];

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
