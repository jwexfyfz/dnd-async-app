import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';

const longsword: ItemDefinition = { id: 'starting_longsword', name: 'Longsword', description: 'A versatile blade, equally effective in one or two hands.', damage_dice: '1d8', weapon_type: 'melee', equip_slot: 'main_hand' };
const shortsword: ItemDefinition = { id: 'starting_shortsword', name: 'Shortsword', description: 'A nimble, double-edged blade favored for quick, precise strikes.', damage_dice: '1d6', weapon_type: 'finesse', equip_slot: 'main_hand' };
const rapier: ItemDefinition = { id: 'starting_rapier', name: 'Rapier', description: 'A slender thrusting sword that rewards accuracy over brute strength.', damage_dice: '1d8', weapon_type: 'finesse', equip_slot: 'main_hand' };
const greataxe: ItemDefinition = { id: 'starting_greataxe', name: 'Greataxe', description: 'A massive two-handed axe that cleaves through enemies with brutal force.', damage_dice: '1d12', weapon_type: 'melee', equip_slot: 'main_hand', two_handed: true };
const mace: ItemDefinition = { id: 'starting_mace', name: 'Mace', description: 'A heavy blunt weapon that can crush armor and bone alike.', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand' };
const scimitar: ItemDefinition = { id: 'starting_scimitar', name: 'Scimitar', description: 'A curved slashing blade that flows with speed and finesse.', damage_dice: '1d6', weapon_type: 'finesse', equip_slot: 'main_hand' };
const quarterstaff: ItemDefinition = { id: 'starting_quarterstaff', name: 'Quarterstaff', description: 'A sturdy wooden staff that can be used to strike or deflect blows.', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand' };
const dagger: ItemDefinition = { id: 'starting_dagger', name: 'Dagger', description: 'A small, concealable blade that can be thrown or used in close quarters.', damage_dice: '1d4', weapon_type: 'finesse', equip_slot: 'main_hand', throwable: true };
const shield: ItemDefinition = { id: 'starting_shield', name: 'Shield', description: 'A sturdy buckler strapped to the forearm that deflects incoming blows.', equip_slot: 'off_hand', equip_bonus: { ac: 2 } };
const woodenShield: ItemDefinition = { id: 'starting_wooden_shield', name: 'Wooden Shield', description: 'A simple wooden shield that offers reliable protection.', equip_slot: 'off_hand', equip_bonus: { ac: 2 } };
const chainMail: ItemDefinition = { id: 'starting_chain_mail', name: 'Chain Mail', description: 'Interlocking metal rings that cover the body in flexible, reliable armor.', equip_slot: 'chest', equip_bonus: { ac: 6 } };
const scaleMail: ItemDefinition = { id: 'starting_scale_mail', name: 'Scale Mail', description: 'Overlapping metal scales sewn onto a leather backing.', equip_slot: 'chest', equip_bonus: { ac: 4 } };
const leatherArmor: ItemDefinition = { id: 'starting_leather_armor', name: 'Leather Armor', description: 'Boiled and hardened leather that moves with you.', equip_slot: 'chest', equip_bonus: { ac: 1 } };
const shortbow: ItemDefinition = { id: 'starting_shortbow', name: 'Shortbow', description: 'A compact recurve bow for reliable mid-range attacks.', damage_dice: '1d6', weapon_type: 'ranged', equip_slot: 'main_hand' };
const lightCrossbow: ItemDefinition = { id: 'starting_light_crossbow', name: 'Light Crossbow', description: 'A mechanical crossbow that fires bolts with consistent force.', damage_dice: '1d8', weapon_type: 'ranged', equip_slot: 'main_hand' };
const handaxe: ItemDefinition = { id: 'starting_handaxe', name: 'Handaxe', description: 'A lightweight axe balanced for throwing or close combat.', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand', throwable: true };
const handaxe2: ItemDefinition = { ...handaxe, id: 'starting_handaxe_2' };
const javelin: ItemDefinition = { id: 'starting_javelin', name: 'Javelin', description: 'A balanced throwing spear that also serves in melee.', damage_dice: '1d6', weapon_type: 'melee', equip_slot: 'main_hand', throwable: true };
const dart: ItemDefinition = { id: 'starting_dart', name: 'Dart', description: 'A small weighted dart — quick to throw and easy to carry multiples of.', damage_dice: '1d4', weapon_type: 'ranged', throwable: true };

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
};
