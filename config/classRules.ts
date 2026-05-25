export type ActionCostType = 'mainAction' | 'bonusAction' | 'movementSteps' | 'free';

export interface ClassFeature {
  id: string;
  name: string;
  icon: string;
  cost: { type: ActionCostType; value: number };
  description: string;
}

export type SupportedClass = 'barbarian' | 'bard' | 'cleric' | 'fighter' | 'rogue' | 'wizard';

export interface LevelEntry {
  level: number;
  proficiencyBonus: number;
  featuresUnlocked: string[];
}

export const CHARACTER_BASELINES: Record<SupportedClass, {
  baseActions: number;
  baseBonusActions: number;
  baseSpeedSteps: number;
}> = {
  barbarian: { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
  bard:      { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
  cleric:    { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
  fighter:   { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
  rogue:     { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
  wizard:    { baseActions: 1, baseBonusActions: 1, baseSpeedSteps: 6 },
};

export const CLASS_FEATURES: Record<string, ClassFeature> = {
  // ── Barbarian ──────────────────────────────────────────────────────────────
  barbarian_rage: {
    id: 'barbarian_rage',
    name: 'Rage',
    icon: '😡',
    cost: { type: 'bonusAction', value: 1 },
    description:
      'Enter a rage as a bonus action. While raging you gain advantage on Strength checks and saving throws, a bonus to melee damage rolls (+2 at levels 1–8, scaling higher), and resistance to bludgeoning, piercing, and slashing damage. Rage lasts 1 minute and ends early if you are knocked unconscious or if you end your turn without attacking an enemy or taking damage.',
  },
  barbarian_unarmored_defense: {
    id: 'barbarian_unarmored_defense',
    name: 'Unarmored Defense',
    icon: '🛡️',
    cost: { type: 'free', value: 0 },
    description:
      'While you are not wearing armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit.',
  },
  barbarian_reckless_attack: {
    id: 'barbarian_reckless_attack',
    name: 'Reckless Attack',
    icon: '⚔️',
    cost: { type: 'free', value: 0 },
    description:
      'When you make your first attack on your turn, you can decide to attack recklessly. Doing so gives you advantage on melee weapon attack rolls using Strength during that turn, but attack rolls against you also have advantage until your next turn.',
  },
  barbarian_danger_sense: {
    id: 'barbarian_danger_sense',
    name: 'Danger Sense',
    icon: '👁️',
    cost: { type: 'free', value: 0 },
    description:
      'You have advantage on Dexterity saving throws against effects you can see, such as traps and spells. This benefit does not apply if you are blinded, deafened, or incapacitated.',
  },

  // ── Bard ───────────────────────────────────────────────────────────────────
  bard_spellcasting: {
    id: 'bard_spellcasting',
    name: 'Spellcasting',
    icon: '🎶',
    cost: { type: 'mainAction', value: 1 },
    description:
      'You have learned to reshape reality through music and words. Charisma is your spellcasting ability (spell save DC = 8 + proficiency bonus + CHA modifier). You know 2 1st-level spells and 3 cantrips at level 1, learning additional spells as you level. Bards use a spellbook-free system — all known spells are always available.',
  },
  bard_bardic_inspiration: {
    id: 'bard_bardic_inspiration',
    name: 'Bardic Inspiration',
    icon: '🎸',
    cost: { type: 'bonusAction', value: 1 },
    description:
      'As a bonus action, inspire one creature other than yourself within 60 feet who can hear you. That creature gains one Bardic Inspiration die (d6 at levels 1–4, d8 at 5–9, d10 at 10–14, d12 at 15–20). Within the next 10 minutes the creature can roll the die and add it to one ability check, attack roll, or saving throw. You can use this a number of times equal to your Charisma modifier (minimum 1) per long rest.',
  },
  bard_jack_of_all_trades: {
    id: 'bard_jack_of_all_trades',
    name: 'Jack of All Trades',
    icon: '🃏',
    cost: { type: 'free', value: 0 },
    description:
      'You can add half your proficiency bonus, rounded down, to any ability check you make that does not already include your proficiency bonus.',
  },
  bard_song_of_rest: {
    id: 'bard_song_of_rest',
    name: 'Song of Rest',
    icon: '🎵',
    cost: { type: 'free', value: 0 },
    description:
      'You can use soothing music or oration to help revitalize wounded allies during a short rest. Any ally who hears your performance and spends one or more Hit Dice during the short rest regains an extra 1d6 hit points (1d6 at levels 2–8, 1d8 at 9–12, 1d10 at 13–16, 1d12 at 17–20).',
  },

  // ── Cleric ─────────────────────────────────────────────────────────────────
  cleric_spellcasting: {
    id: 'cleric_spellcasting',
    name: 'Spellcasting',
    icon: '🙏',
    cost: { type: 'mainAction', value: 1 },
    description:
      'As a conduit for divine power you can cast cleric spells. Wisdom is your spellcasting ability (spell save DC = 8 + proficiency bonus + WIS modifier). You know 3 cantrips at level 1 and prepare a number of cleric spells each long rest equal to your Wisdom modifier + your cleric level (minimum 1). Domain spells are always prepared and do not count against this limit.',
  },
  cleric_divine_domain: {
    id: 'cleric_divine_domain',
    name: 'Divine Domain',
    icon: '⛪',
    cost: { type: 'free', value: 0 },
    description:
      'Choose a Divine Domain related to your deity (e.g., Life, Light, War, Trickery, Knowledge, Nature, Tempest). Your choice grants Domain Spells that are always prepared, plus a level-1 Domain Feature. You gain additional domain features at levels 2, 6, 8, and 17.',
  },
  cleric_channel_divinity: {
    id: 'cleric_channel_divinity',
    name: 'Channel Divinity',
    icon: '✨',
    cost: { type: 'mainAction', value: 1 },
    description:
      'You can channel divine energy directly from your deity to fuel magical effects. You have one use per short or long rest at level 2 (two uses at level 6, three at level 18). Every cleric can use Channel Divinity to Turn Undead (forcing undead within 30 ft to flee on a failed Wisdom save). Your Divine Domain grants at least one additional Channel Divinity option.',
  },

  // ── Fighter ────────────────────────────────────────────────────────────────
  fighter_fighting_style: {
    id: 'fighter_fighting_style',
    name: 'Fighting Style',
    icon: '🗡️',
    cost: { type: 'free', value: 0 },
    description:
      'Adopt one Fighting Style specialty: Archery (+2 to ranged attack rolls), Defense (+1 AC while wearing armor), Dueling (+2 damage when wielding a melee weapon in one hand and no other weapons), Great Weapon Fighting (reroll 1s and 2s on damage dice for two-handed/versatile weapons — must use the new roll), Protection (impose disadvantage on an attack against a creature within 5 ft using your reaction when you have a shield), or Two-Weapon Fighting (add ability modifier to the damage of your off-hand attack).',
  },
  fighter_second_wind: {
    id: 'fighter_second_wind',
    name: 'Second Wind',
    icon: '💨',
    cost: { type: 'bonusAction', value: 1 },
    description:
      'On your turn, use a bonus action to regain hit points equal to 1d10 + your fighter level. You must finish a short or long rest before you can use this feature again.',
  },
  fighter_action_surge: {
    id: 'fighter_action_surge',
    name: 'Action Surge',
    icon: '⚡',
    cost: { type: 'free', value: 0 },
    description:
      'On your turn, take one additional action on top of your regular action and possible bonus action. Once used, you must finish a short or long rest before using it again. Starting at level 17, you can use Action Surge twice before a rest, but only once per turn.',
  },

  // ── Rogue ──────────────────────────────────────────────────────────────────
  rogue_expertise: {
    id: 'rogue_expertise',
    name: 'Expertise',
    icon: '🔍',
    cost: { type: 'free', value: 0 },
    description:
      'Choose two of your skill proficiencies, or one skill proficiency and your thieves\' tools proficiency. Your proficiency bonus is doubled for any ability check using the chosen proficiencies. You gain two more Expertise choices at level 6.',
  },
  rogue_sneak_attack: {
    id: 'rogue_sneak_attack',
    name: 'Sneak Attack',
    icon: '🗡️',
    cost: { type: 'free', value: 0 },
    description:
      'Once per turn, deal extra damage to one creature you hit with an attack if you have advantage on the roll, or if at least one ally is within 5 ft of the target and you do not have disadvantage. The attack must use a finesse or ranged weapon. Extra damage starts at 1d6 at level 1, increasing by 1d6 at every odd rogue level (2d6 at 3, 3d6 at 5, etc.).',
  },
  rogue_thieves_cant: {
    id: 'rogue_thieves_cant',
    name: "Thieves' Cant",
    icon: '🤫',
    cost: { type: 'free', value: 0 },
    description:
      "You know Thieves' Cant: a secret mix of dialect, jargon, and code that lets you hide messages in seemingly normal conversation. Only another creature that knows Thieves' Cant understands such messages, though conveying information this way takes four times as long as speaking plainly. You also know a set of secret signs and symbols used to convey short, simple messages to other rogues.",
  },
  rogue_cunning_action: {
    id: 'rogue_cunning_action',
    name: 'Cunning Action',
    icon: '💨',
    cost: { type: 'bonusAction', value: 1 },
    description:
      'Your quick thinking and agility let you move and act quickly. On each of your turns you can use a bonus action to take the Dash, Disengage, or Hide action.',
  },

  // ── Wizard ─────────────────────────────────────────────────────────────────
  wizard_spellcasting: {
    id: 'wizard_spellcasting',
    name: 'Spellcasting',
    icon: '📖',
    cost: { type: 'mainAction', value: 1 },
    description:
      'Your arcane research and the magic infused in your spellbook give you mastery of spells. Intelligence is your spellcasting ability (spell save DC = 8 + proficiency bonus + INT modifier). You begin with a spellbook containing 6 first-level wizard spells. You know 3 cantrips at level 1. Each long rest you prepare a number of wizard spells equal to your Intelligence modifier + half your wizard level (rounded down, minimum 1).',
  },
  wizard_arcane_recovery: {
    id: 'wizard_arcane_recovery',
    name: 'Arcane Recovery',
    icon: '🔮',
    cost: { type: 'free', value: 0 },
    description:
      'Once per day when you finish a short rest, you can recover expended spell slots. The slots recovered can have a combined level up to half your wizard level (rounded up, minimum 1) and none of the recovered slots can be 6th level or higher. For example, a level-1 wizard can recover one 1st-level slot; a level-5 wizard can recover any combination totaling 3 levels or fewer.',
  },
  wizard_arcane_tradition: {
    id: 'wizard_arcane_tradition',
    name: 'Arcane Tradition',
    icon: '🏛️',
    cost: { type: 'free', value: 0 },
    description:
      'At 2nd level, choose an arcane tradition that shapes your magic: Abjuration, Conjuration, Divination, Enchantment, Evocation, Illusion, Necromancy, or Transmutation. Your tradition grants a feature at level 2 and additional features at levels 6, 10, and 14.',
  },
};

// D&D 5e proficiency bonus: +2 at L1, increases by +1 every 4 levels
const pb = (level: number): number => Math.ceil(level / 4) + 1;

export const CLASS_PROGRESSION: Record<SupportedClass, LevelEntry[]> = {
  barbarian: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['barbarian_rage', 'barbarian_unarmored_defense'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['barbarian_reckless_attack', 'barbarian_danger_sense'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
  bard: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['bard_spellcasting', 'bard_bardic_inspiration'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['bard_jack_of_all_trades', 'bard_song_of_rest'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
  cleric: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['cleric_spellcasting', 'cleric_divine_domain'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['cleric_channel_divinity'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
  fighter: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['fighter_fighting_style', 'fighter_second_wind'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['fighter_action_surge'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
  rogue: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['rogue_expertise', 'rogue_sneak_attack', 'rogue_thieves_cant'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['rogue_cunning_action'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
  wizard: [
    { level:  1, proficiencyBonus: pb(1),  featuresUnlocked: ['wizard_spellcasting', 'wizard_arcane_recovery'] },
    { level:  2, proficiencyBonus: pb(2),  featuresUnlocked: ['wizard_arcane_tradition'] },
    { level:  3, proficiencyBonus: pb(3),  featuresUnlocked: [] },
    { level:  4, proficiencyBonus: pb(4),  featuresUnlocked: [] },
    { level:  5, proficiencyBonus: pb(5),  featuresUnlocked: [] },
    { level:  6, proficiencyBonus: pb(6),  featuresUnlocked: [] },
    { level:  7, proficiencyBonus: pb(7),  featuresUnlocked: [] },
    { level:  8, proficiencyBonus: pb(8),  featuresUnlocked: [] },
    { level:  9, proficiencyBonus: pb(9),  featuresUnlocked: [] },
    { level: 10, proficiencyBonus: pb(10), featuresUnlocked: [] },
    { level: 11, proficiencyBonus: pb(11), featuresUnlocked: [] },
    { level: 12, proficiencyBonus: pb(12), featuresUnlocked: [] },
    { level: 13, proficiencyBonus: pb(13), featuresUnlocked: [] },
    { level: 14, proficiencyBonus: pb(14), featuresUnlocked: [] },
    { level: 15, proficiencyBonus: pb(15), featuresUnlocked: [] },
    { level: 16, proficiencyBonus: pb(16), featuresUnlocked: [] },
    { level: 17, proficiencyBonus: pb(17), featuresUnlocked: [] },
    { level: 18, proficiencyBonus: pb(18), featuresUnlocked: [] },
    { level: 19, proficiencyBonus: pb(19), featuresUnlocked: [] },
    { level: 20, proficiencyBonus: pb(20), featuresUnlocked: [] },
  ],
};
