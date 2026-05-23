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


// ─── Registry — append new classes here ──────────────────────────────────────

const CLASSES: ClassSeed[] = [BARBARIAN, BARD, FIGHTER, ROGUE, WIZARD, CLERIC];

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
