import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function prof(level: number): number {
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

// Spell-slot totals per level (used as resourcePoolMax for caster classes)
const CASTER_POOL: Record<number, number> = {
  1: 2, 2: 3, 3: 6, 4: 7, 5: 9, 6: 10, 7: 11, 8: 12,
  9: 14, 10: 15, 11: 16, 12: 16, 13: 17, 14: 17, 15: 18,
  16: 18, 17: 19, 18: 20, 19: 21, 20: 22,
};

// ─── Class Progression skeletons (needed for FK before ClassFeature inserts) ─

const CLERIC_PROGRESSION: Record<number, { featuresUnlocked: string[]; resourcePoolMax: number }> = {
  1:  { featuresUnlocked: ["spellcasting", "divine-domain"],                                  resourcePoolMax: CASTER_POOL[1]  },
  2:  { featuresUnlocked: ["channel-divinity", "divine-domain-feature"],                      resourcePoolMax: CASTER_POOL[2]  },
  3:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[3]  },
  4:  { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[4]  },
  5:  { featuresUnlocked: ["destroy-undead-cr12"],                                            resourcePoolMax: CASTER_POOL[5]  },
  6:  { featuresUnlocked: ["channel-divinity-2", "divine-domain-feature"],                    resourcePoolMax: CASTER_POOL[6]  },
  7:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[7]  },
  8:  { featuresUnlocked: ["asi", "divine-domain-feature", "destroy-undead-cr1"],             resourcePoolMax: CASTER_POOL[8]  },
  9:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[9]  },
  10: { featuresUnlocked: ["divine-intervention"],                                             resourcePoolMax: CASTER_POOL[10] },
  11: { featuresUnlocked: ["destroy-undead-cr2"],                                             resourcePoolMax: CASTER_POOL[11] },
  12: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[12] },
  13: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[13] },
  14: { featuresUnlocked: ["destroy-undead-cr3"],                                             resourcePoolMax: CASTER_POOL[14] },
  15: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[15] },
  16: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[16] },
  17: { featuresUnlocked: ["divine-domain-feature", "destroy-undead-cr4"],                    resourcePoolMax: CASTER_POOL[17] },
  18: { featuresUnlocked: ["channel-divinity-3"],                                             resourcePoolMax: CASTER_POOL[18] },
  19: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[19] },
  20: { featuresUnlocked: ["divine-intervention-improvement"],                                resourcePoolMax: CASTER_POOL[20] },
};

const WIZARD_PROGRESSION: Record<number, { featuresUnlocked: string[]; resourcePoolMax: number }> = {
  1:  { featuresUnlocked: ["spellcasting", "arcane-recovery"],                                resourcePoolMax: CASTER_POOL[1]  },
  2:  { featuresUnlocked: ["arcane-tradition"],                                               resourcePoolMax: CASTER_POOL[2]  },
  3:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[3]  },
  4:  { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[4]  },
  5:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[5]  },
  6:  { featuresUnlocked: ["arcane-tradition-feature"],                                       resourcePoolMax: CASTER_POOL[6]  },
  7:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[7]  },
  8:  { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[8]  },
  9:  { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[9]  },
  10: { featuresUnlocked: ["arcane-tradition-feature"],                                       resourcePoolMax: CASTER_POOL[10] },
  11: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[11] },
  12: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[12] },
  13: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[13] },
  14: { featuresUnlocked: ["arcane-tradition-feature"],                                       resourcePoolMax: CASTER_POOL[14] },
  15: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[15] },
  16: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[16] },
  17: { featuresUnlocked: [],                                                                  resourcePoolMax: CASTER_POOL[17] },
  18: { featuresUnlocked: ["spell-mastery"],                                                  resourcePoolMax: CASTER_POOL[18] },
  19: { featuresUnlocked: ["asi"],                                                             resourcePoolMax: CASTER_POOL[19] },
  20: { featuresUnlocked: ["signature-spells"],                                               resourcePoolMax: CASTER_POOL[20] },
};

async function upsertProgression(
  characterClass: string,
  progression: Record<number, { featuresUnlocked: string[]; resourcePoolMax: number }>
): Promise<void> {
  for (const [lvlStr, data] of Object.entries(progression)) {
    const level = Number(lvlStr);
    await prisma.classProgression.upsert({
      where: { characterClass_level: { characterClass, level } },
      update: {
        proficiencyBonus:  prof(level),
        featuresUnlocked:  data.featuresUnlocked,
        resourcePoolMax:   data.resourcePoolMax,
      },
      create: {
        characterClass,
        level,
        proficiencyBonus:  prof(level),
        featuresUnlocked:  data.featuresUnlocked,
        resourcePoolMax:   data.resourcePoolMax,
      },
    });
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type CostType = "mainAction" | "bonusAction" | "movementSteps" | "free";

interface FeatureSeed {
  level: number;
  name: string;
  description: string;
  icon: string;
  costType: CostType;
}

// ─── Cleric ──────────────────────────────────────────────────────────────────

const CLERIC_FEATURES: FeatureSeed[] = [
  // ── Level 1 ────────────────────────────────────────────────────────────────
  {
    level: 1,
    name: "Spellcasting",
    icon: "🙏",
    costType: "mainAction",
    description:
      "Wisdom is your spellcasting ability (spell save DC = 8 + proficiency bonus + WIS modifier; spell attack bonus = proficiency bonus + WIS modifier). You know 3 cantrips chosen from the cleric spell list at 1st level, gaining additional cantrips at levels 4 and 10. After each long rest, prepare a list of cleric spells: choose a number equal to your Wisdom modifier + your cleric level (minimum 1). Prepared spells must be of a level for which you have spell slots. Casting a spell of 1st level or higher expends a spell slot of that level or higher. Ritual Casting: you can cast any prepared cleric spell that has the ritual tag as a ritual without expending a spell slot, adding 10 minutes to the casting time. Spellcasting Focus: you can use a holy symbol as a focus for cleric spells.",
  },
  {
    level: 1,
    name: "Divine Domain",
    icon: "⛪",
    costType: "free",
    description:
      "Choose a Divine Domain associated with your deity: Knowledge, Life, Light, Nature, Tempest, Trickery, or War (additional domains appear in supplemental sources). Your choice grants Domain Spells — a fixed list of extra spells that are always considered prepared and do not count against the number of spells you can prepare each day. You also gain a Domain Feature at 1st level. You gain additional domain features at levels 2 (a domain-specific Channel Divinity option), 6, 8, and 17.",
  },

  // ── Level 2 ────────────────────────────────────────────────────────────────
  {
    level: 2,
    name: "Channel Divinity: Turn Undead",
    icon: "✨",
    costType: "mainAction",
    description:
      "You can channel divine energy directly from your deity to fuel magical effects. You begin with two uses: the universal Turn Undead option and a domain-specific option. You regain all expended uses when you finish a short or long rest (1 use/rest at level 2, 2 uses at level 6, 3 uses at level 18). Turn Undead: as an action, present your holy symbol and speak a prayer censuring the undead. Each undead that can see or hear you within 30 feet must make a Wisdom saving throw against your spell save DC. On a failed save, the creature is turned for 1 minute or until it takes any damage. A turned creature must spend its turns trying to move as far away from you as possible, cannot willingly move to a space within 30 feet of you, cannot take reactions, and can only take the Dash action or try to escape from an effect preventing it from moving.",
  },
  {
    level: 2,
    name: "Divine Domain Feature",
    icon: "🌟",
    costType: "mainAction",
    description:
      "Your chosen Divine Domain grants a domain-specific Channel Divinity option at level 2, used alongside Turn Undead. Representative examples: Life Domain — Preserve Life (restore HP totaling 5× your cleric level distributed among any creatures within 30 ft, capped at half each target's max HP); Light Domain — Radiance of the Dawn (dispel magical darkness and deal 2d10 + cleric level radiant damage to hostile creatures in 30 ft, Dex save for half); Tempest Domain — Destructive Wrath (maximize thunder or lightning damage from a spell instead of rolling); Trickery Domain — Invoke Duplicity (create an illusory duplicate of yourself for 1 minute); War Domain — Guided Strike (grant +10 to an attack roll after seeing the die but before the outcome is declared). Consult your domain for exact wording.",
  },

  // ── Level 4 ────────────────────────────────────────────────────────────────
  {
    level: 4,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score of your choice by 2, or increase two different ability scores by 1 each. No score can be raised above 20 using this feature. Alternatively, you may forgo the ability score increase and take a Feat instead. Clerics gain this improvement at levels 4, 8, 12, 16, and 19.",
  },

  // ── Level 5 ────────────────────────────────────────────────────────────────
  {
    level: 5,
    name: "Destroy Undead (CR 1/2)",
    icon: "💀",
    costType: "free",
    description:
      "When an undead creature fails its saving throw against your Turn Undead feature, it is instantly destroyed if its Challenge Rating is 1/2 or lower, rather than merely being turned. The creature crumbles to dust immediately, with no further action required. As you gain cleric levels, the CR threshold increases: CR 1 at level 8, CR 2 at level 11, CR 3 at level 14, and CR 4 at level 17.",
  },

  // ── Level 6 ────────────────────────────────────────────────────────────────
  {
    level: 6,
    name: "Channel Divinity (2 uses)",
    icon: "✨",
    costType: "free",
    description:
      "You can now use Channel Divinity twice per short or long rest instead of once. Both uses recharge when you finish a short or long rest. You may use any combination of your available Channel Divinity options across the two uses — for example, Turn Undead twice, or once each of Turn Undead and your domain option.",
  },
  {
    level: 6,
    name: "Divine Domain Feature",
    icon: "🌟",
    costType: "free",
    description:
      "Your Divine Domain grants an expanded feature at level 6, typically broadening or enhancing your core divine abilities. Representative examples: Life Domain — Blessed Healer (when you cast a spell of 1st level or higher that restores HP to another creature, you regain HP equal to 2 + the spell's level); Light Domain — Improved Flare (you can use your Warding Flare reaction against attacks targeting any creature within 30 ft that you can see, not just yourself); Nature Domain — Dampen Elements (when you or a creature within 30 ft takes acid, cold, fire, lightning, or thunder damage, use your reaction to grant resistance to that instance); War Domain — War God's Blessing (use a Channel Divinity charge as a reaction to grant an ally within 30 ft +10 to an attack roll). Consult your domain.",
  },

  // ── Level 8 ────────────────────────────────────────────────────────────────
  {
    level: 8,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },
  {
    level: 8,
    name: "Divine Domain Feature",
    icon: "⚡",
    costType: "free",
    description:
      "Your Divine Domain grants a powerful feature at level 8, usually adding a once-per-turn damage bonus to your weapon attacks or enhancing your spellcasting. Representative examples: Life Domain — Blessed Strikes (once per turn when you hit with a weapon attack or deal damage with a cleric cantrip, deal an extra 1d8 radiant damage); Light Domain — Potent Spellcasting (add your Wisdom modifier to the damage of cleric cantrips you cast); Nature Domain — Divine Strike (once per turn, weapon attacks deal +1d8 cold, fire, or lightning damage, your choice at level 8, scaling to 2d8 at level 14); Tempest Domain — Divine Strike (once per turn, weapon attacks deal +1d8 thunder damage, scaling to 2d8 at level 14); War Domain — Divine Strike (once per turn, weapon attacks deal +1d8 damage of the weapon's type, scaling to 2d8 at level 14). Consult your domain.",
  },
  {
    level: 8,
    name: "Destroy Undead (CR 1)",
    icon: "💀",
    costType: "free",
    description:
      "The threshold for your Destroy Undead feature increases. When an undead of CR 1 or lower fails its saving throw against Turn Undead, it is instantly destroyed rather than turned.",
  },

  // ── Level 10 ───────────────────────────────────────────────────────────────
  {
    level: 10,
    name: "Divine Intervention",
    icon: "🌟",
    costType: "mainAction",
    description:
      "You can implore your deity to intervene on your behalf when your need is great. Using your action, describe the assistance you seek and roll percentile dice (d100). If you roll equal to or lower than your cleric level, your deity intervenes. The DM chooses the nature of the intervention; the effect of any cleric spell or cleric domain spell would be appropriate. If your deity intervenes, you cannot use this feature again for 7 days. If the deity does not intervene (roll too high), you can try again after a long rest. At 20th level, your call for intervention always succeeds automatically.",
  },

  // ── Level 11 ───────────────────────────────────────────────────────────────
  {
    level: 11,
    name: "Destroy Undead (CR 2)",
    icon: "💀",
    costType: "free",
    description:
      "The threshold for your Destroy Undead feature increases. When an undead of CR 2 or lower fails its saving throw against Turn Undead, it is instantly destroyed rather than turned.",
  },

  // ── Level 12 ───────────────────────────────────────────────────────────────
  {
    level: 12,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 14 ───────────────────────────────────────────────────────────────
  {
    level: 14,
    name: "Destroy Undead (CR 3)",
    icon: "💀",
    costType: "free",
    description:
      "The threshold for your Destroy Undead feature increases. When an undead of CR 3 or lower fails its saving throw against Turn Undead, it is instantly destroyed rather than turned.",
  },

  // ── Level 16 ───────────────────────────────────────────────────────────────
  {
    level: 16,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 17 ───────────────────────────────────────────────────────────────
  {
    level: 17,
    name: "Divine Domain Feature",
    icon: "🌟",
    costType: "free",
    description:
      "Your Divine Domain grants its most powerful capstone feature at level 17. Representative examples: Life Domain — Supreme Healing (when you would normally roll one or more dice to restore HP with a spell, instead use the highest number possible for each die; e.g., a Cure Wounds always restores maximum HP); Light Domain — Corona of Light (as an action, activate a 60-ft radius aura of sunlight for 1 minute; creatures of your choice in the aura have disadvantage on saving throws against spells that deal fire or radiant damage, and sunlight-sensitive creatures suffer disadvantage on attack rolls in it); Tempest Domain — Stormborn (you have a flying speed equal to your current walking speed whenever you are not underground or indoors); War Domain — Avatar of Battle (you gain resistance to bludgeoning, piercing, and slashing damage from nonmagical weapons). Consult your domain.",
  },
  {
    level: 17,
    name: "Destroy Undead (CR 4)",
    icon: "💀",
    costType: "free",
    description:
      "The threshold for your Destroy Undead feature increases. When an undead of CR 4 or lower fails its saving throw against Turn Undead, it is instantly destroyed rather than turned. This is the final threshold increase for this feature.",
  },

  // ── Level 18 ───────────────────────────────────────────────────────────────
  {
    level: 18,
    name: "Channel Divinity (3 uses)",
    icon: "✨",
    costType: "free",
    description:
      "You can now use Channel Divinity three times per short or long rest instead of twice. All uses recharge when you finish a short or long rest. This is the final increase to your Channel Divinity uses; the feature progression is now complete.",
  },

  // ── Level 19 ───────────────────────────────────────────────────────────────
  {
    level: 19,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 20 ───────────────────────────────────────────────────────────────
  {
    level: 20,
    name: "Divine Intervention (Improved)",
    icon: "🌟",
    costType: "mainAction",
    description:
      "Your Divine Intervention no longer requires a percentile roll — it succeeds automatically whenever you use it. As an action, call on your deity for aid and describe the assistance you seek; your deity intervenes with an effect appropriate to a cleric spell or domain spell of your choice. After the intervention, you must wait 7 days before using Divine Intervention again. This represents the pinnacle of your faith: your deity answers every call, every time.",
  },
];

// ─── Wizard ──────────────────────────────────────────────────────────────────

const WIZARD_FEATURES: FeatureSeed[] = [
  // ── Level 1 ────────────────────────────────────────────────────────────────
  {
    level: 1,
    name: "Spellcasting",
    icon: "📖",
    costType: "mainAction",
    description:
      "Intelligence is your spellcasting ability (spell save DC = 8 + proficiency bonus + INT modifier; spell attack bonus = proficiency bonus + INT modifier). You begin with a spellbook containing 6 first-level wizard spells of your choice. At each wizard level beyond 1st, you may add 2 wizard spells of any level you can cast to your spellbook for free; copying a spell from a found scroll or another wizard's spellbook costs 50 gp and 2 hours per spell level. You know 3 cantrips at 1st level, gaining more at levels 4 and 10. After each long rest, prepare a number of wizard spells from your spellbook equal to your Intelligence modifier + half your wizard level (rounded down, minimum 1). Casting a spell of 1st level or higher expends a spell slot of that level or higher. Ritual Casting: you can cast any wizard spell in your spellbook as a ritual if it has the ritual tag, without expending a spell slot and without needing it prepared (adds 10 minutes to the casting time). Spellcasting Focus: you can use an arcane focus for wizard spells.",
  },
  {
    level: 1,
    name: "Arcane Recovery",
    icon: "🔮",
    costType: "free",
    description:
      "Once per day when you finish a short rest, you can choose expended spell slots to recover. The slots can have a combined level that is equal to or less than half your wizard level (rounded up), and none of the slots can be 6th level or higher. For example, a 1st-level wizard can recover one 1st-level slot; a 5th-level wizard can recover one 3rd-level slot, or one 2nd-level and one 1st-level slot, or three 1st-level slots. You choose which specific slots to recover at the end of the short rest.",
  },

  // ── Level 2 ────────────────────────────────────────────────────────────────
  {
    level: 2,
    name: "Arcane Tradition",
    icon: "🏛️",
    costType: "free",
    description:
      "Choose an arcane tradition that represents your specialization within the study of magic: Abjuration, Conjuration, Divination, Enchantment, Evocation, Illusion, Necromancy, or Transmutation (additional traditions appear in supplemental sources). Your choice grants a feature at 2nd level and additional features at levels 6, 10, and 14. Each tradition also reduces the gold and time cost to copy spells of its school into your spellbook — typically the cost is halved — and may grant other passive benefits related to that school.",
  },

  // ── Level 4 ────────────────────────────────────────────────────────────────
  {
    level: 4,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score of your choice by 2, or increase two different ability scores by 1 each. No score can exceed 20 using this feature. Alternatively, you may forgo the improvement and take a Feat instead. Wizards gain this feature at levels 4, 8, 12, 16, and 19.",
  },

  // ── Level 6 ────────────────────────────────────────────────────────────────
  {
    level: 6,
    name: "Arcane Tradition Feature",
    icon: "🏛️",
    costType: "free",
    description:
      "Your Arcane Tradition grants its 6th-level feature, deepening your mastery of your chosen school. Representative examples: Abjuration — Projected Ward (when a creature within 30 ft is hit by an attack, use your reaction to expend an Arcane Ward charge to absorb damage for them instead); Conjuration — Benign Transposition (teleport up to 30 ft to an unoccupied space you can see as a bonus action; recharges on short rest, or upon casting a Conjuration spell of 1st level or higher); Divination — The Third Eye (use an action to gain one of: darkvision 60 ft, ethereal sight out to 60 ft, see through lightly obscured areas, or read any language — until your next short rest); Evocation — Potent Cantrip (when a creature succeeds on a saving throw against your cantrip, it still takes half damage but no additional effects); Necromancy — Undead Thralls (Animate Dead can target one additional corpse, and undead you raise gain bonus HP equal to your wizard level and +proficiency bonus to weapon damage rolls); Transmutation — Transmuter's Stone (create a magic stone that grants the holder one of several benefits: darkvision, extra speed, Constitution proficiency, or resistance to a damage type). Consult your chosen tradition.",
  },

  // ── Level 8 ────────────────────────────────────────────────────────────────
  {
    level: 8,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 10 ───────────────────────────────────────────────────────────────
  {
    level: 10,
    name: "Arcane Tradition Feature",
    icon: "🏛️",
    costType: "free",
    description:
      "Your Arcane Tradition grants its 10th-level feature, representing near-mastery of your school's most advanced techniques. Representative examples: Abjuration — Improved Abjuration (add your proficiency bonus to ability checks made as part of casting abjuration spells such as Counterspell and Dispel Magic — the checks to overcome a spell's level); Conjuration — Focused Conjuration (concentration on Conjuration spells cannot be broken by taking damage); Divination — Greater Portent (roll three d20s instead of two for Portent, replacing any roll with a stored result up to three times per long rest); Enchantment — Split Enchantment (when casting an Enchantment spell that targets only one creature, you may target two creatures within range with the same spell instead); Evocation — Empowered Evocation (add your Intelligence modifier to the damage roll of any Evocation wizard spell you cast); Necromancy — Inured to Undeath (resistance to necrotic damage and your HP maximum cannot be reduced); Illusion — Illusory Reality (once per day, use a bonus action to make one inanimate object within an illusion you cast of 1st level or higher real for 1 minute). Consult your tradition.",
  },

  // ── Level 12 ───────────────────────────────────────────────────────────────
  {
    level: 12,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 14 ───────────────────────────────────────────────────────────────
  {
    level: 14,
    name: "Arcane Tradition Feature",
    icon: "🏛️",
    costType: "free",
    description:
      "Your Arcane Tradition grants its capstone feature at level 14, representing the pinnacle of your school's power. Representative examples: Abjuration — Spell Resistance (advantage on saving throws against spells, and resistance to damage from spells); Conjuration — Durable Summons (any creature summoned or created by your Conjuration spells gains 30 temporary HP); Divination — Recovered Divination (regain a 2nd-level or lower spell slot when you cast a Divination spell of 2nd level or higher using a slot); Enchantment — Alter Memories (force a charmed humanoid to forget up to 1 hour per cleric level of time it spent charmed by you; the target makes an Intelligence saving throw or forgets entirely); Evocation — Overchannel (when dealing damage with a wizard spell of 1st through 5th level, you can maximize the damage; subsequent uses before a long rest deal 2d12 necrotic to you per spell level); Illusion — Illusory Self (create an illusory duplicate as a reaction when attacked; the attack targets the duplicate, which is destroyed, causing the attack to miss); Necromancy — Command Undead (attempt to dominate an undead creature within 60 ft with a Charisma check vs. its Wisdom, DC = 8 + proficiency + INT mod); Transmutation — Master Transmuter (expend your Transmuter's Stone to cast a powerful transmutation effect). Consult your tradition.",
  },

  // ── Level 16 ───────────────────────────────────────────────────────────────
  {
    level: 16,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 18 ───────────────────────────────────────────────────────────────
  {
    level: 18,
    name: "Spell Mastery",
    icon: "✨",
    costType: "free",
    description:
      "You have achieved such mastery over certain spells that you can cast them at will. Choose one 1st-level wizard spell and one 2nd-level wizard spell from your spellbook. You can cast each of those spells at their lowest level without expending a spell slot whenever you wish. If you want to cast either spell at a higher level, you must expend a spell slot as normal. By spending 8 hours in study, you can exchange one or both of the chosen spells for different wizard spells of the same respective levels. The spells must be in your spellbook to be chosen.",
  },

  // ── Level 19 ───────────────────────────────────────────────────────────────
  {
    level: 19,
    name: "Ability Score Improvement",
    icon: "⬆️",
    costType: "free",
    description:
      "Increase one ability score by 2, or two ability scores by 1 each (maximum 20 per score). Alternatively take a Feat.",
  },

  // ── Level 20 ───────────────────────────────────────────────────────────────
  {
    level: 20,
    name: "Signature Spells",
    icon: "🌟",
    costType: "free",
    description:
      "You gain mastery over two powerful spells and can cast them with little effort. Choose two 3rd-level wizard spells in your spellbook as your signature spells. You always have these spells prepared — they do not count against the number of spells you can prepare each day — and you can cast each of them once at 3rd level without expending a spell slot. Once you cast a signature spell for free this way, you cannot do so again until you finish a short or long rest. If you want to cast a signature spell at a higher level, you must expend a spell slot as normal.",
  },
];

// ─── Seed engine ─────────────────────────────────────────────────────────────

async function seedClassFeatures(
  characterClass: string,
  features: FeatureSeed[]
): Promise<void> {
  console.log(`Seeding ${characterClass} ClassFeatures...`);

  await prisma.classFeature.deleteMany({ where: { characterClass } });

  await prisma.classFeature.createMany({
    data: features.map((f) => ({
      characterClass,
      level: f.level,
      name: f.name,
      description: f.description,
      icon: f.icon,
      costType: f.costType,
    })),
  });

  console.log(`  ✓ ${characterClass}: ${features.length} features seeded`);
}

async function main(): Promise<void> {
  console.log("Upserting ClassProgression rows...");
  await upsertProgression("Cleric", CLERIC_PROGRESSION);
  await upsertProgression("Wizard", WIZARD_PROGRESSION);
  await seedClassFeatures("Cleric", CLERIC_FEATURES);
  await seedClassFeatures("Wizard", WIZARD_FEATURES);
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
