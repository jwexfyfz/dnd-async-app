import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';

const longsword: ItemDefinition = { id: 'starting_longsword', name: 'Longsword', damage_dice: '1d8', weapon_type: 'melee', equip_slot: 'main_hand' };
const shortsword: ItemDefinition = { id: 'starting_shortsword', name: 'Shortsword', damage_dice: '1d6', weapon_type: 'finesse', equip_slot: 'main_hand' };
const rapier: ItemDefinition = { id: 'starting_rapier', name: 'Rapier', damage_dice: '1d8', weapon_type: 'finesse', equip_slot: 'main_hand' };
const greataxe: ItemDefinition = { id: 'starting_greataxe', name: 'Greataxe', damage_dice: '1d12', weapon_type: 'melee', equip_slot: 'main_hand', two_handed: true };
const mace: ItemDefinition = { id: 'starting_mace', name: 'Mace', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand' };
const scimitar: ItemDefinition = { id: 'starting_scimitar', name: 'Scimitar', damage_dice: '1d6', weapon_type: 'finesse', equip_slot: 'main_hand' };
const quarterstaff: ItemDefinition = { id: 'starting_quarterstaff', name: 'Quarterstaff', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand' };
const dagger: ItemDefinition = { id: 'starting_dagger', name: 'Dagger', damage_dice: '1d4', weapon_type: 'finesse', equip_slot: 'main_hand', throwable: true };
const shield: ItemDefinition = { id: 'starting_shield', name: 'Shield', equip_slot: 'off_hand', equip_bonus: { ac: 2 } };
const woodenShield: ItemDefinition = { id: 'starting_wooden_shield', name: 'Wooden Shield', equip_slot: 'off_hand', equip_bonus: { ac: 2 } };
const chainMail: ItemDefinition = { id: 'starting_chain_mail', name: 'Chain Mail', equip_slot: 'chest', equip_bonus: { ac: 6 } };
const scaleMail: ItemDefinition = { id: 'starting_scale_mail', name: 'Scale Mail', equip_slot: 'chest', equip_bonus: { ac: 4 } };
const leatherArmor: ItemDefinition = { id: 'starting_leather_armor', name: 'Leather Armor', equip_slot: 'chest', equip_bonus: { ac: 1 } };
const shortbow: ItemDefinition = { id: 'starting_shortbow', name: 'Shortbow', damage_dice: '1d6', weapon_type: 'ranged', equip_slot: 'main_hand' };
const lightCrossbow: ItemDefinition = { id: 'starting_light_crossbow', name: 'Light Crossbow', damage_dice: '1d8', weapon_type: 'ranged', equip_slot: 'main_hand' };
const handaxe: ItemDefinition = { id: 'starting_handaxe', name: 'Handaxe', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand', throwable: true };
const handaxe2: ItemDefinition = { ...handaxe, id: 'starting_handaxe_2' };
const javelin: ItemDefinition = { id: 'starting_javelin', name: 'Javelin', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand', throwable: true };
const dart: ItemDefinition = { id: 'starting_dart', name: 'Dart', damage_dice: '1d4', weapon_type: 'ranged', throwable: true };

export const STARTING_EQUIPMENT: Record<string, CharacterInventory> = {
  Fighter: {
    equipped: { main_hand: longsword, off_hand: shield, chest: chainMail },
    bag: [{ ...lightCrossbow, id: 'starting_fighter_crossbow' }],
  },
  Paladin: {
    equipped: { main_hand: longsword, off_hand: shield, chest: chainMail },
    bag: [{ ...javelin, id: 'starting_javelin_1' }, { ...javelin, id: 'starting_javelin_2' }],
  },
  Ranger: {
    equipped: { main_hand: shortsword, chest: scaleMail },
    bag: [shortbow],
  },
  Barbarian: {
    equipped: { main_hand: greataxe },
    bag: [handaxe, handaxe2],
  },
  Monk: {
    equipped: { main_hand: shortsword },
    bag: [{ ...dart, id: 'starting_dart_1' }, { ...dart, id: 'starting_dart_2' }, { ...dart, id: 'starting_dart_3' }],
  },
  Rogue: {
    equipped: { main_hand: rapier, chest: leatherArmor },
    bag: [shortbow, { ...dagger, id: 'starting_dagger_2' }],
  },
  Bard: {
    equipped: { main_hand: rapier, chest: leatherArmor },
    bag: [{ ...dagger, id: 'starting_bard_dagger' }],
  },
  Cleric: {
    equipped: { main_hand: mace, off_hand: shield, chest: scaleMail },
    bag: [{ ...lightCrossbow, id: 'starting_cleric_crossbow' }],
  },
  Druid: {
    equipped: { main_hand: scimitar, off_hand: woodenShield, chest: leatherArmor },
    bag: [],
  },
  Wizard: {
    equipped: { main_hand: quarterstaff },
    bag: [{ ...dagger, id: 'starting_wizard_dagger' }],
  },
  Sorcerer: {
    equipped: { main_hand: dagger },
    bag: [lightCrossbow],
  },
  Warlock: {
    equipped: { main_hand: shortsword, chest: leatherArmor },
    bag: [{ ...dagger, id: 'starting_warlock_dagger' }],
  },
  Artificer: {
    equipped: { main_hand: { id: 'starting_hand_crossbow', name: 'Hand Crossbow', damage_dice: '1d6', weapon_type: 'ranged', equip_slot: 'main_hand' }, chest: scaleMail },
    bag: [{ ...dagger, id: 'starting_artificer_dagger' }],
  },
};
