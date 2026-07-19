import type { ItemDefinition, GachaRarity } from '@/types/v2-game';

export interface GachaItemDef extends ItemDefinition {
  gachaRarity: GachaRarity;
  classRestriction?: string;
}

// ─── Common (60%) — consumables, shared ──────────────────────────────────────

export const COMMON_ITEMS: GachaItemDef[] = [
  {
    id: 'gacha_common_heal_8',
    name: 'Healing Potion',
    description: 'A vial of red liquid that tastes of copper and herbs. Drink to restore 8 HP.',
    consumable: true,
    use_effect: 'heal_8',
    gachaRarity: 'common',
  },
  {
    id: 'gacha_common_heal_16',
    name: 'Greater Healing Potion',
    description: 'A rich, glowing draught mixed by a skilled alchemist. Drink to restore 16 HP.',
    consumable: true,
    use_effect: 'heal_16',
    gachaRarity: 'common',
  },
  {
    id: 'gacha_common_alchemists_fire',
    name: "Alchemist's Fire",
    description: 'A volatile flask of magical oil that ignites on contact. Throw at an enemy to set them ablaze, dealing ongoing fire damage.',
    throwable: true,
    consumable: true,
    throw_effect: 'ignite',
    gachaRarity: 'common',
  },
  {
    id: 'gacha_common_smoke_pellet',
    name: 'Smoke Pellet',
    description: 'A clay pellet packed with enchanted powder. Throw it at your feet during combat to erupt a cloud of thick smoke. All enemies who were actively targeting you lose their priority focus for one round. Your next attempt to hide this turn also has advantage — the smoke provides enough cover to slip away or reposition. Has no effect outside of combat.',
    throwable: true,
    consumable: true,
    combat_usable: true,
    target: 'self',
    use_effect: 'smoke',
    gachaRarity: 'common',
  },
];

// ─── Uncommon (28%) — equipment + consumables, shared ────────────────────────

export const UNCOMMON_ITEMS: GachaItemDef[] = [
  {
    id: 'gacha_uncommon_ring_of_protection',
    name: 'Ring of Protection',
    description: 'A plain iron band etched with warding runes. Passively grants +1 AC while worn.',
    equip_slot: 'ring',
    equip_bonus: { ac: 1 },
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_amulet_of_warding',
    name: 'Amulet of Warding',
    description: 'A carved bone pendant on a leather cord. Passively grants +1 AC while worn.',
    equip_slot: 'amulet',
    equip_bonus: { ac: 1 },
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_bracers_of_accuracy',
    name: 'Bracers of Accuracy',
    description: 'Snug leather bracers threaded with enchanted sinew. Steadies your aim regardless of weapon — grants +1 to all attack rolls while worn.',
    equip_slot: 'hands',
    equip_bonus: { to_hit: 1 },
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_boots_of_swiftness',
    name: 'Boots of Swiftness',
    description: 'Soft boots with a quicksilver lining. Your feet move before your mind catches up — grants an initiative bonus at the start of combat.',
    equip_slot: 'feet',
    passive_effect: 'initiative_bonus',
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_potion_of_heroism',
    name: 'Potion of Heroism',
    description: 'A bubbling red-gold liquid that floods you with battlefield confidence. Drink to gain advantage on your next attack roll this combat. Single use.',
    consumable: true,
    use_effect: 'heroism',
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_bead_of_force',
    name: 'Bead of Force',
    description: 'A crystalline bead charged with compressed magical force. Throw at one enemy to deal 1d4 force damage automatically — no attack roll needed. Costs your main action.',
    throwable: true,
    throw_effect: 'ignite', // placeholder until force throw is implemented
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_potion_of_iron_will',
    name: 'Potion of Iron Will',
    description: 'A gritty iron-colored tonic that hardens the body against the next blow. Drink to halve the next source of damage you take this combat. Does not stack.',
    consumable: true,
    use_effect: 'half_damage_once',
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_battle_draught',
    name: 'Battle Draught',
    description: 'A sharp-smelling red liquid that sends the limbs moving before the mind catches up. Drink before entering combat — you act first in the initiative roll regardless of your d20 result. Cannot be used once combat has started.',
    consumable: true,
    use_effect: 'initiative_top',
    gachaRarity: 'uncommon',
  },
  {
    id: 'gacha_uncommon_oil_of_sharpness',
    name: 'Oil of Sharpness',
    description: 'A vial of shimmering oil applied to your weapon before the next strike. Grants +1 to your next attack roll. Single use.',
    consumable: true,
    use_effect: 'sharpen_next_attack',
    gachaRarity: 'uncommon',
  },
];

// ─── Rare (10%) — per-class sets + 2 standalone ──────────────────────────────

const RARE_STANDALONE: GachaItemDef[] = [
  {
    id: 'gacha_rare_shadowweave_cloak',
    name: 'Shadowweave Cloak',
    description: 'A travel cloak woven from enchanted shadow-silk. When you are actively hiding, grants advantage on Stealth checks. Provides no benefit while in the open.',
    equip_slot: 'chest',
    passive_effect: 'stealth_adv_while_hiding',
    gachaRarity: 'rare',
  },
  {
    id: 'gacha_rare_ring_of_sharpness',
    name: 'Ring of Sharpness',
    description: 'A silver ring engraved with a cutting edge motif. Grants +1 to attack rolls.',
    equip_slot: 'ring',
    equip_bonus: { to_hit: 1 },
    gachaRarity: 'rare',
  },
];

const RARE_CLASS_SETS: Record<string, GachaItemDef[]> = {
  Fighter: [
    { id: 'gacha_rare_fighter_soldiers_edge', name: "Soldier's Edge", description: "A veteran's blade, well-worn but impeccably balanced. Deals 1d8 damage with +1 to attack rolls.", equip_slot: 'main_hand', damage_dice: '1d8', weapon_type: 'melee', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Fighter' },
    { id: 'gacha_rare_fighter_veterans_plate', name: "Veteran's Plate", description: 'Battle-worn plate mail bearing campaign marks from a dozen fights. Grants +6 AC.', equip_slot: 'chest', equip_bonus: { ac: 6 }, gachaRarity: 'rare', classRestriction: 'Fighter' },
    { id: 'gacha_rare_fighter_veterans_signet', name: "Veteran's Signet", description: "A steel ring stamped with a crossed-swords crest. Grants +1 to attack rolls.", equip_slot: 'ring', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Fighter' },
  ],
  Rogue: [
    { id: 'gacha_rare_rogue_shadowfang', name: 'Shadowfang', description: 'A narrow blade honed for silent work. Deals 1d6 finesse damage with +1 to attack rolls. Makes no sound on impact.', equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'finesse', silent: true, equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Rogue' },
    { id: 'gacha_rare_rogue_shadowrunner_leathers', name: "Shadowrunner's Leathers", description: 'Supple leather treated to muffle both sound and silhouette. Grants +4 AC.', equip_slot: 'chest', equip_bonus: { ac: 4 }, gachaRarity: 'rare', classRestriction: 'Rogue' },
    { id: 'gacha_rare_rogue_shadowrunner_boots', name: "Shadowrunner's Boots", description: 'Thin-soled boots with a silence-dampening weave. Grants an initiative bonus at the start of combat.', equip_slot: 'feet', passive_effect: 'initiative_bonus', gachaRarity: 'rare', classRestriction: 'Rogue' },
  ],
  Ranger: [
    { id: 'gacha_rare_ranger_wardenbow', name: 'Wardenbow', description: 'A recurve bow of seasoned yew strung with spider silk. Deals 1d8 ranged damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8', weapon_type: 'ranged', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Ranger' },
    { id: 'gacha_rare_ranger_trail_vest', name: "Warden's Trail Vest", description: 'A layered leather vest built for long travel and fast draws. Grants +4 AC.', equip_slot: 'chest', equip_bonus: { ac: 4 }, gachaRarity: 'rare', classRestriction: 'Ranger' },
    { id: 'gacha_rare_ranger_trail_hood', name: "Warden's Trail Hood", description: 'A weather-worn hood that narrows the eye to movement in the trees. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'rare', classRestriction: 'Ranger' },
  ],
  Cleric: [
    { id: 'gacha_rare_cleric_ironclad_mace', name: 'Ironclad Mace', description: 'A heavy mace blessed with divine certainty. Deals 1d6 damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'melee', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Cleric' },
    { id: 'gacha_rare_cleric_faithful_mail', name: "Faithful's Mail", description: 'Chain mail blessed at the altar and worn with conviction. Grants +5 AC.', equip_slot: 'chest', equip_bonus: { ac: 5 }, gachaRarity: 'rare', classRestriction: 'Cleric' },
    { id: 'gacha_rare_cleric_amulet_minor_heal', name: 'Amulet of Minor Healing', description: 'A simple holy symbol storing one healing prayer. Use to restore 8 HP. 1 charge — resets on long rest.', equip_slot: 'amulet', charges: 1, use_effect: 'heal_8', gachaRarity: 'rare', classRestriction: 'Cleric' },
  ],
  Wizard: [
    { id: 'gacha_rare_wizard_sages_staff', name: "Sage's Staff", description: 'A carved hardwood staff capped with a resonance crystal. Deals 1d6 damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'melee', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Wizard' },
    { id: 'gacha_rare_wizard_sages_robes', name: "Sage's Robes", description: 'Layered robes inscribed with warding glyphs at every hem. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'rare', classRestriction: 'Wizard' },
    { id: 'gacha_rare_wizard_ring_of_focus', name: 'Ring of Focus', description: "A crystal ring that sharpens the mind's eye into more precise strikes. Grants +1 to attack rolls.", equip_slot: 'ring', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Wizard' },
  ],
  Barbarian: [
    { id: 'gacha_rare_barb_forgeborn_axe', name: 'Forgeborn Axe', description: 'A massive two-handed axe forged from volcanic iron. Deals 1d12 damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d12', weapon_type: 'melee', two_handed: true, equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Barbarian' },
    { id: 'gacha_rare_barb_forgeborn_hide', name: 'Forgeborn Hide', description: 'Cured beast hide reinforced with iron studs and volcanic resin. Grants +5 AC.', equip_slot: 'chest', equip_bonus: { ac: 5 }, gachaRarity: 'rare', classRestriction: 'Barbarian' },
    { id: 'gacha_rare_barb_forgeborn_warhelm', name: 'Forgeborn Warhelm', description: 'A dented but unbroken iron helm built to take whatever comes. Grants +2 AC.', equip_slot: 'head', equip_bonus: { ac: 2 }, gachaRarity: 'rare', classRestriction: 'Barbarian' },
  ],
  Bard: [
    { id: 'gacha_rare_bard_duelists_rapier', name: "Duelist's Rapier", description: 'A slender blade favored by those who fight with flair. Deals 1d8 finesse damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8', weapon_type: 'finesse', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Bard' },
    { id: 'gacha_rare_bard_duelists_coat', name: "Duelist's Coat", description: 'A tailored longcoat with a hidden mail lining. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'rare', classRestriction: 'Bard' },
    { id: 'gacha_rare_bard_silver_tongue', name: 'Amulet of the Silver Tongue', description: 'A carved mask pendant storing a healing word. Use to restore 6 HP. 1 charge — resets on long rest.', equip_slot: 'amulet', charges: 1, use_effect: 'heal_6', gachaRarity: 'rare', classRestriction: 'Bard' },
  ],
  Paladin: [
    { id: 'gacha_rare_paladin_wardens_warhammer', name: "Warden's Warhammer", description: 'A divine warhammer etched with oaths of protection. Deals 1d8 damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8', weapon_type: 'melee', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Paladin' },
    { id: 'gacha_rare_paladin_sworn_plate', name: 'Sworn Plate', description: 'Ceremonial full plate engraved with the tenets of your oath. Grants +7 AC.', equip_slot: 'chest', equip_bonus: { ac: 7 }, gachaRarity: 'rare', classRestriction: 'Paladin' },
    { id: 'gacha_rare_paladin_lay_on_hands', name: 'Amulet of Lay on Hands', description: 'A holy amulet containing a reserve of healing power. Use to restore 10 HP. 1 charge — resets on long rest.', equip_slot: 'amulet', charges: 1, use_effect: 'heal_10', gachaRarity: 'rare', classRestriction: 'Paladin' },
  ],
  Monk: [
    { id: 'gacha_rare_monk_wind_kama', name: 'Wind Kama', description: "A curved blade that flows with the wielder's movement. Deals 1d6 finesse damage with +1 to attack rolls.", equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'finesse', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Monk' },
    { id: 'gacha_rare_monk_wind_wraps', name: 'Wind Wraps', description: 'Cloth hand wraps threaded with ki-focusing cord. Grants +1 to all attack rolls including unarmed strikes.', equip_slot: 'hands', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Monk' },
    { id: 'gacha_rare_monk_wind_sandals', name: 'Wind Sandals', description: 'Sandals that barely touch the ground. Grants an initiative bonus at the start of combat.', equip_slot: 'feet', passive_effect: 'initiative_bonus', gachaRarity: 'rare', classRestriction: 'Monk' },
  ],
  Druid: [
    { id: 'gacha_rare_druid_thornwood_staff', name: 'Thornwood Staff', description: 'A gnarled staff of living wood, still faintly growing at the tips. Deals 1d6 damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'melee', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Druid' },
    { id: 'gacha_rare_druid_thornwood_vestments', name: 'Thornwood Vestments', description: 'Woven bark-cloth grown in a sacred grove, still breathing slowly. Grants +4 AC.', equip_slot: 'chest', equip_bonus: { ac: 4 }, gachaRarity: 'rare', classRestriction: 'Druid' },
    { id: 'gacha_rare_druid_amulet_of_grove', name: 'Amulet of the Grove', description: 'A seed pendant from a dying elder tree. Use to restore 6 HP. 1 charge — resets on long rest.', equip_slot: 'amulet', charges: 1, use_effect: 'heal_6', gachaRarity: 'rare', classRestriction: 'Druid' },
  ],
  Sorcerer: [
    { id: 'gacha_rare_sorc_arcane_dagger', name: 'Arcane Dagger', description: 'A slender blade crackling with unstable arcane energy. Deals 1d4 finesse damage with +1 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d4', weapon_type: 'finesse', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Sorcerer' },
    { id: 'gacha_rare_sorc_arcane_silks', name: 'Arcane Silks', description: 'Enchanted robes that crackle faintly with untethered potential. Grants +2 AC.', equip_slot: 'chest', equip_bonus: { ac: 2 }, gachaRarity: 'rare', classRestriction: 'Sorcerer' },
    { id: 'gacha_rare_sorc_ring_of_unstable_power', name: 'Ring of Unstable Power', description: 'A ring of solidified wild magic that channels chaos into precision. Grants +1 to attack rolls.', equip_slot: 'ring', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Sorcerer' },
  ],
  Warlock: [
    { id: 'gacha_rare_warlock_hexblade_shortblade', name: "Hexblade's Shortblade", description: "A blade bound to your pact, drinking from the patron's power. Deals 1d6 finesse damage with +1 to attack rolls.", equip_slot: 'main_hand', damage_dice: '1d6', weapon_type: 'finesse', equip_bonus: { to_hit: 1 }, gachaRarity: 'rare', classRestriction: 'Warlock' },
    { id: 'gacha_rare_warlock_hexblade_mantle', name: "Hexblade's Mantle", description: 'A dark cloak-coat that absorbs ambient shadow. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'rare', classRestriction: 'Warlock' },
    { id: 'gacha_rare_warlock_ring_of_lesser_pact', name: 'Ring of the Lesser Pact', description: "A signet ring bearing your patron's lesser seal. Use to restore 10 HP. 1 charge — resets on long rest.", equip_slot: 'ring', charges: 1, use_effect: 'heal_10', gachaRarity: 'rare', classRestriction: 'Warlock' },
  ],
};

// ─── Legendary (2%) — per-class sets ─────────────────────────────────────────

const LEGENDARY_CLASS_SETS: Record<string, GachaItemDef[]> = {
  Fighter: [
    { id: 'gacha_leg_fighter_ironclad_cleaver', name: 'Ironclad Cleaver', description: 'A heavy cleaver forged from folded iron ore, balanced for relentless swings. Deals 1d8+2 damage with +2 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'melee', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ironclad_bulwark', name: 'Ironclad Bulwark', description: 'A tower shield bearing the Ironclad crest, proof against anything short of a siege weapon. Grants +3 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ironclad_helm', name: 'Ironclad Helm', description: 'A full-face iron helm, dented from old battles and still standing. Grants +2 AC.', equip_slot: 'head', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ironclad_breastplate', name: 'Ironclad Breastplate', description: 'Interlocked iron plates proven in a hundred fights. Grants +8 AC.', equip_slot: 'chest', equip_bonus: { ac: 8 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ironclad_greaves', name: 'Ironclad Greaves', description: 'Shin and knee protection forged to match the full set. Grants +2 AC.', equip_slot: 'legs', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ironclad_sabatons', name: 'Ironclad Sabatons', description: 'Iron-plated boots that ring on stone with every step. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Fighter' },
    { id: 'gacha_leg_fighter_ring_of_second_wind', name: 'Ring of Second Wind', description: 'A steel ring carved with lungs mid-breath. Use to recover 10 HP once. 1 charge — resets on long rest.', equip_slot: 'ring', charges: 1, use_effect: 'heal_10', gachaRarity: 'legendary', classRestriction: 'Fighter' },
  ],
  Rogue: [
    { id: 'gacha_leg_rogue_whisperblade', name: 'Whisperblade', description: 'A blade so narrow it leaves no sound on impact. Deals 1d6+2 finesse damage with +2 to attack rolls. Silent.', equip_slot: 'main_hand', damage_dice: '1d6+2', weapon_type: 'finesse', silent: true, equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_parrying_dagger', name: 'Parrying Dagger', description: 'A notched dagger designed to catch and redirect blades. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_shadowveil_hood', name: 'Shadowveil Hood', description: 'A thin cloth hood that seems to absorb ambient light. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_shadowveil_leathers', name: 'Shadowveil Leathers', description: 'Treated leather that muffles both sound and silhouette. Grants +4 AC.', equip_slot: 'chest', equip_bonus: { ac: 4 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_shadowveil_legwraps', name: 'Shadowveil Legwraps', description: 'Close-fitting wraps that reduce the rustle of movement. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_whisperstep_boots', name: 'Whisperstep Boots', description: 'Boots soled with compressed wool and shadowweave. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Rogue' },
    { id: 'gacha_leg_rogue_ring_of_evasion', name: 'Ring of Evasion', description: 'A tarnished silver ring worn smooth by anxious handling. Use as a bonus action — you can still attack. Absorbs the next hit you take this round entirely, dealing 0 damage. 1 charge — resets on long rest.', equip_slot: 'ring', charges: 1, use_effect: 'evade', gachaRarity: 'legendary', classRestriction: 'Rogue' },
  ],
  Barbarian: [
    { id: 'gacha_leg_barb_stormfang_axe', name: 'Stormfang Axe', description: "A massive axe whose blade crackles faintly even in still air. Deals 1d12+2 damage with +2 to attack rolls. Two-handed.", equip_slot: 'main_hand', damage_dice: '1d12+2', weapon_type: 'melee', two_handed: true, equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_stormfang_talisman', name: 'Stormfang Talisman', description: 'A carved fang hung on iron wire, a trophy from something larger. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_stormfang_warhelm', name: 'Stormfang Warhelm', description: 'A horned iron helm fitted for battle at full fury. Grants +2 AC.', equip_slot: 'head', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_stormfang_hide', name: 'Stormfang Hide', description: 'Thick beast hide cured in storm-salt brine and hammered flat. Grants +7 AC.', equip_slot: 'chest', equip_bonus: { ac: 7 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_stormfang_legguards', name: 'Stormfang Legguards', description: 'Layered hide wrappings reinforced at the knee with iron bands. Grants +2 AC.', equip_slot: 'legs', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_stormfang_stompers', name: 'Stormfang Stompers', description: 'Heavy boots that shake the floor with each step. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
    { id: 'gacha_leg_barb_amulet_of_reckless_power', name: 'Amulet of Reckless Power', description: 'An iron amulet etched with claw marks over claw marks. Grants +1 AC.', equip_slot: 'amulet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Barbarian' },
  ],
  Ranger: [
    { id: 'gacha_leg_ranger_sureshot_bow', name: 'Sureshot Bow', description: "A recurve bow of ironwood with a spider-silk string that never needs re-stringing. Deals 1d8+2 ranged damage with +2 to attack rolls.", equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'ranged', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_wardens_bracer', name: "Warden's Bracer", description: 'A leather bracer worn on the bow arm to deflect bowstring snap. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_wardens_cowl', name: "Warden's Cowl", description: 'A hood stitched with natural patterns that blend into forest movement. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_wardens_cloak', name: "Warden's Cloak", description: 'A layered travel cloak built for long watches in rough terrain. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_wardens_legguards', name: "Warden's Legguards", description: 'Reinforced leather greaves with silent-step backing. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_wardens_striders', name: "Warden's Striders", description: 'Light boots with gum-sole silencing and ankle support for uneven ground. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
    { id: 'gacha_leg_ranger_ring_of_huntsman', name: 'Ring of the Huntsman', description: 'A copper ring etched with prey-tracks circling the band. Grants +1 AC.', equip_slot: 'ring', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Ranger' },
  ],
  Paladin: [
    { id: 'gacha_leg_paladin_oathkeeper', name: 'Oathkeeper', description: 'A warhammer engraved with every word of your oath. Deals 1d8+2 damage with +2 to attack rolls. Use to channel a minor heal (8 HP). 2 charges — resets on long rest.', equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'melee', equip_bonus: { to_hit: 2 }, charges: 2, use_effect: 'heal_8', gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_oathkeeper_shield', name: 'Oathkeeper Shield', description: "A kite shield bearing your order's sigil, never tarnished. Grants +3 AC.", equip_slot: 'off_hand', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_oathkeeper_helm', name: 'Oathkeeper Helm', description: 'A full-face battle helm with a flame motif at the crest. Grants +2 AC.', equip_slot: 'head', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_oathkeeper_plate', name: 'Oathkeeper Plate', description: "Full ceremonial plate that never seems to dull no matter what it's put through. Grants +9 AC.", equip_slot: 'chest', equip_bonus: { ac: 9 }, gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_oathkeeper_greaves', name: 'Oathkeeper Greaves', description: 'Plate greaves worn by those who do not retreat. Grants +2 AC.', equip_slot: 'legs', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_oathkeeper_sabatons', name: 'Oathkeeper Sabatons', description: 'Heavy plate boots that ring like a bell on stone. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Paladin' },
    { id: 'gacha_leg_paladin_ring_of_divine_grace', name: 'Ring of Divine Grace', description: 'A gold ring set with a white stone that glows faintly in the dark. Use to restore 12 HP. 1 charge — resets on long rest.', equip_slot: 'ring', charges: 1, use_effect: 'heal_12', gachaRarity: 'legendary', classRestriction: 'Paladin' },
  ],
  Monk: [
    { id: 'gacha_leg_monk_ironweave_wraps', name: 'Ironweave Wraps', description: 'Silk hand wraps threaded with wire of enchanted iron, bound to your strikes. Grants +2 to all attack rolls including unarmed.', equip_slot: 'hands', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_focus_beads', name: 'Ironweave Focus Beads', description: 'A loop of smooth stone beads used to count breath and strikes. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_headband', name: 'Ironweave Headband', description: 'A plain cloth headband that channels focus inward. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_gi', name: 'Ironweave Gi', description: 'A reinforced training gi worn over lightweight armor weave. Grants +4 AC.', equip_slot: 'chest', equip_bonus: { ac: 4 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_trousers', name: 'Ironweave Trousers', description: 'Close-fitting trousers with flexible knee reinforcement for ground fighting. Grants +2 AC.', equip_slot: 'legs', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_sandals', name: 'Ironweave Sandals', description: 'Thin sandals that keep ground-feel without sacrificing speed. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
    { id: 'gacha_leg_monk_amulet_of_open_palm', name: 'Amulet of the Open Palm', description: 'A jade disk carved with an outstretched hand, hung on braided cord. Grants +1 AC.', equip_slot: 'amulet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Monk' },
  ],
  Cleric: [
    { id: 'gacha_leg_cleric_blessed_mace', name: 'Blessed Mace', description: 'A devotional mace that hums with stored prayer. Deals 1d6+2 damage with +2 to attack rolls. Use to heal 6 HP. 3 charges — resets on long rest.', equip_slot: 'main_hand', damage_dice: '1d6+2', weapon_type: 'melee', equip_bonus: { to_hit: 2 }, charges: 3, use_effect: 'heal_6', gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_blessed_aegis', name: 'Blessed Aegis', description: "A round shield inscribed with the full symbol of your deity. Grants +3 AC.", equip_slot: 'off_hand', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_blessed_mitre', name: 'Blessed Mitre', description: 'A ceremonial headdress that broadcasts divine authority. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_blessed_vestments', name: 'Blessed Vestments', description: 'Layered ceremonial robes reinforced with hidden chainmail panels. Grants +6 AC.', equip_slot: 'chest', equip_bonus: { ac: 6 }, gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_blessed_greaves', name: 'Blessed Greaves', description: "Plate greaves worn by the church's field clerics through long campaigns. Grants +2 AC.", equip_slot: 'legs', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_blessed_sandals', name: 'Blessed Sandals', description: 'Simple sandals blessed at the altar on the day of their making. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Cleric' },
    { id: 'gacha_leg_cleric_ring_of_divine_favor', name: 'Ring of Divine Favor', description: 'A bronze ring inscribed with a prayer wheel. Use to heal 8 HP. 2 charges — resets on long rest.', equip_slot: 'ring', charges: 2, use_effect: 'heal_8', gachaRarity: 'legendary', classRestriction: 'Cleric' },
  ],
  Druid: [
    { id: 'gacha_leg_druid_moonbeam_sickle', name: 'Moonbeam Sickle', description: 'A stone-tipped sickle that glows faintly under moonlight. Deals 1d6+2 finesse damage with +2 to attack rolls. Use to restore 8 HP. 2 charges — resets on long rest.', equip_slot: 'main_hand', damage_dice: '1d6+2', weapon_type: 'finesse', equip_bonus: { to_hit: 2 }, charges: 2, use_effect: 'heal_8', gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_moonbeam_totem', name: 'Moonbeam Totem', description: 'A carved antler totem wrapped in living moonlit moss. Grants +1 AC. Use to restore 6 HP. 1 charge — resets on long rest.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, charges: 1, use_effect: 'heal_6', gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_antler_crown', name: 'Moonbeam Antler Crown', description: 'A crown of shed antlers wrapped in living vines that bloom in moonlight. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_barkweave', name: 'Moonbeam Barkweave', description: 'Armor woven from living bark strips, still breathing in rhythm with the forest. Grants +5 AC.', equip_slot: 'chest', equip_bonus: { ac: 5 }, gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_legwraps', name: 'Moonbeam Legwraps', description: 'Vine-woven wraps that harden on impact like bark. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_treads', name: 'Moonbeam Treads', description: 'Soft-soled shoes grown from living moss over a carved wood frame. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Druid' },
    { id: 'gacha_leg_druid_amulet_of_wild', name: 'Amulet of the Wild', description: 'A green stone amulet shaped like a curled leaf, warm to the touch. Grants +1 AC.', equip_slot: 'amulet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Druid' },
  ],
  Wizard: [
    { id: 'gacha_leg_wizard_arcanist_staff', name: "Arcanist's Staff", description: 'A gnarled staff topped with an arcane lens that focuses magical force into a beam. Deals 1d8+2 damage with +2 to attack rolls. Use to fire a ranged arcane blast (2d6 force). 3 charges — resets on long rest.', equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'melee', equip_bonus: { to_hit: 2 }, charges: 3, use_effect: 'arcane_blast', gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_arcanist_tome', name: "Arcanist's Tome", description: 'A leather-bound spellbook bound to your wrist by a silver chain. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_arcanist_hat', name: "Arcanist's Hat", description: 'A wide-brimmed hat stitched with memory-binding runes along the brim. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_arcanist_robes', name: "Arcanist's Robes", description: 'Layered silk robes woven with deflection sigils at every layer. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_arcanist_legwraps', name: "Arcanist's Legwraps", description: 'Enchanted wraps that insulate against magical backlash. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_arcanist_boots', name: "Arcanist's Boots", description: 'Boots with a faint hover that cushions magical recoil. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
    { id: 'gacha_leg_wizard_ring_of_arcane_might', name: 'Ring of Arcane Might', description: "A blue-stoned ring that amplifies the wearer's magical focus into physical precision. Grants +1 to attack rolls.", equip_slot: 'ring', equip_bonus: { to_hit: 1 }, gachaRarity: 'legendary', classRestriction: 'Wizard' },
  ],
  Bard: [
    { id: 'gacha_leg_bard_silvered_rapier', name: 'Silvered Rapier', description: 'A rapier with a blade silvered for style and function in equal measure. Deals 1d8+2 finesse damage with +2 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'finesse', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_lute_shard', name: "Muse's Lute Shard", description: 'A fragment of a legendary lute, still strung with one resonant string. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_muses_cap', name: "Muse's Cap", description: 'A velvet cap with a single iridescent feather that never loses its color. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_muses_coat', name: "Muse's Coat", description: 'A long embroidered coat with a mail lining hidden beneath the silk. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_muses_leggings', name: "Muse's Leggings", description: 'Fitted performance leggings reinforced at the knees for long stage fights. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_dancing_boots', name: "Muse's Dancing Boots", description: "Heeled boots whose soles seem to anticipate the next step. Grants +1 AC.", equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Bard' },
    { id: 'gacha_leg_bard_amulet_of_muse', name: 'Amulet of the Muse', description: 'A coin-shaped amulet engraved with a comedy mask. Use to heal 6 HP. 2 charges — resets on long rest.', equip_slot: 'amulet', charges: 2, use_effect: 'heal_6', gachaRarity: 'legendary', classRestriction: 'Bard' },
  ],
  Sorcerer: [
    { id: 'gacha_leg_sorc_chaos_shard', name: 'Chaos Shard', description: 'A crystallized fragment of a wild magic storm, sharpened to a blade and barely contained. Deals 1d6+2 finesse damage with +2 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d6+2', weapon_type: 'finesse', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_chaos_orb', name: 'Chaos Orb', description: 'A glass orb containing a miniature storm that rages in silence. Grants +1 AC.', equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_chaos_crown', name: 'Chaos Crown', description: 'A circlet of fused crystalline energy, never quite the same color twice. Grants +1 AC.', equip_slot: 'head', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_chaos_robes', name: 'Chaos Robes', description: 'Robes that shift color unpredictably, making the wearer difficult to track. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_chaos_legwraps', name: 'Chaos Legwraps', description: 'Silk wraps suffused with residual wild magic that sparks faintly. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_chaos_steps', name: 'Chaos Steps', description: 'Boots that occasionally leave faintly glowing footprints. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
    { id: 'gacha_leg_sorc_amulet_of_wild_magic', name: 'Amulet of Wild Magic', description: 'A cracked amulet containing bottled chaos, sealed with wax and luck. Grants +1 AC.', equip_slot: 'amulet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Sorcerer' },
  ],
  Warlock: [
    { id: 'gacha_leg_warlock_soul_reaver', name: 'Soul Reaver', description: 'A blade that drinks faintly from the life of those it cuts, feeding the pact. Deals 1d8+2 finesse damage with +2 to attack rolls.', equip_slot: 'main_hand', damage_dice: '1d8+2', weapon_type: 'finesse', equip_bonus: { to_hit: 2 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_soul_tome', name: 'Soul Tome', description: "A bound grimoire that whispers in your patron's voice when you hold it. Grants +1 AC.", equip_slot: 'off_hand', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_soul_cowl', name: 'Soul Cowl', description: 'A deep hood that obscures the face from mundane and magical sight alike. Grants +2 AC.', equip_slot: 'head', equip_bonus: { ac: 2 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_soul_cloak', name: 'Soul Cloak', description: 'A shadowy cloak that drifts even in still air, as though it has somewhere to be. Grants +3 AC.', equip_slot: 'chest', equip_bonus: { ac: 3 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_soul_legwraps', name: 'Soul Legwraps', description: 'Wrappings of shadow-threaded cloth that dampen sound and light. Grants +1 AC.', equip_slot: 'legs', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_soul_treads', name: 'Soul Treads', description: 'Boots that make no sound and leave no tracks on any surface. Grants +1 AC.', equip_slot: 'feet', equip_bonus: { ac: 1 }, gachaRarity: 'legendary', classRestriction: 'Warlock' },
    { id: 'gacha_leg_warlock_ring_of_pact', name: 'Ring of the Pact', description: "A black iron ring bearing your patron's seal, warm even in cold. Use to restore 10 HP. 1 charge — resets on long rest.", equip_slot: 'ring', charges: 1, use_effect: 'heal_10', gachaRarity: 'legendary', classRestriction: 'Warlock' },
  ],
};

// ─── Milestone definitions ────────────────────────────────────────────────────

export type MilestoneCategory = 'Combat' | 'Exploration' | 'Loot & Equipment' | 'Social' | 'Progression' | 'Engagement';

export interface MilestoneDef {
  id: string;
  name: string;
  description: string;
  category: MilestoneCategory;
}

export const MILESTONES: MilestoneDef[] = [
  { id: 'first_steps', name: 'First Steps', description: 'Complete your first session', category: 'Engagement' },
  { id: 'explorer', name: 'Explorer', description: 'Discover your first new room', category: 'Exploration' },
  { id: 'treasure_hunter', name: 'Treasure Hunter', description: 'Loot your first item', category: 'Loot & Equipment' },
  { id: 'armed_and_ready', name: 'Armed & Ready', description: 'Equip your first weapon', category: 'Loot & Equipment' },
  { id: 'bloodied', name: 'Bloodied', description: 'Enter combat for the first time', category: 'Combat' },
  { id: 'silver_tongue', name: 'Silver Tongue', description: 'Complete your first NPC dialogue', category: 'Social' },
  { id: 'survivor', name: 'Survivor', description: 'Reach 0 HP and survive', category: 'Combat' },
  { id: 'battle_hardened', name: 'Battle-Hardened', description: 'Reach character level 2', category: 'Progression' },
  { id: 'decisive_blow', name: 'Decisive Blow', description: 'Land your first critical hit', category: 'Combat' },
  { id: 'cutpurse', name: 'Cutpurse', description: "Accumulate 100 gold across your character's lifetime", category: 'Loot & Equipment' },
  { id: 'hidden_path', name: 'Hidden Path', description: 'Discover your first secret room or hidden POI', category: 'Exploration' },
  { id: 'full_kit', name: 'Full Kit', description: 'Fill every equipment slot simultaneously', category: 'Loot & Equipment' },
  { id: 'marked_for_death', name: 'Marked for Death', description: 'Have an enemy target you with priority', category: 'Combat' },
  { id: 'pack_rat', name: 'Pack Rat', description: 'Carry 10 items in your bag at once', category: 'Loot & Equipment' },
  { id: 'against_the_odds', name: 'Against the Odds', description: 'Win a combat encounter while at 5 HP or below', category: 'Combat' },
  { id: 'graverobber', name: 'Graverobber', description: 'Loot a body after combat', category: 'Loot & Equipment' },
  { id: 'true_companion', name: 'True Companion', description: 'Play 3 sessions with the same party member', category: 'Social' },
  { id: 'ascended', name: 'Ascended', description: 'Reach character level 5', category: 'Progression' },
  { id: 'seasoned', name: 'Seasoned', description: 'Take 500 exploration actions', category: 'Exploration' },
  { id: 'veteran', name: 'Veteran', description: 'Win 100 combat encounters', category: 'Combat' },
  { id: 'untouchable', name: 'Untouchable', description: 'Complete a combat encounter without taking damage', category: 'Combat' },
  { id: 'devoted', name: 'Devoted', description: 'Maintain a 30-day streak', category: 'Engagement' },
];

// ─── Pool selection helpers ───────────────────────────────────────────────────

export function getRarePool(characterClass: string): GachaItemDef[] {
  const classItems = RARE_CLASS_SETS[characterClass] ?? [];
  return [...classItems, ...RARE_STANDALONE];
}

export function getLegendaryPool(characterClass: string): GachaItemDef[] {
  return LEGENDARY_CLASS_SETS[characterClass] ?? [];
}

export function filterDuplicates(pool: GachaItemDef[], pullHistoryIds: string[]): GachaItemDef[] {
  const pulledSet = new Set(pullHistoryIds);
  return pool.filter(item => item.consumable || !pulledSet.has(item.id));
}
