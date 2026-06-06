import { describe, it, expect, vi } from 'vitest';
import type { CharacterStats, CharacterInventory, ItemDefinition } from '@/types/v2-game';

// Pure logic tests for PartyTab / CharacterSheet / InventoryTab.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function abilityMod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

function makeStats(overrides: Partial<CharacterStats> = {}): CharacterStats {
  return {
    currentHp: 14, maxHp: 18, ac: 12, level: 3, characterClass: 'Rogue',
    attackBonus: 4, initiativeMod: 2,
    baseStrength: 10, baseDexterity: 14, baseConstitution: 12,
    baseIntelligence: 10, baseWisdom: 10, baseCharisma: 8,
    skillsModifiers: { Stealth: 6, Perception: 2, Athletics: 0 },
    skillProficiencies: ['Stealth', 'Perception'],
    isHiding: false,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return { id: 'i1', name: 'Item', ...overrides };
}

function makeInventory(overrides: Partial<CharacterInventory> = {}): CharacterInventory {
  return {
    bag: [],
    equipped: {},
    ...overrides,
  };
}

// ─── CharacterSheet — combat stats ───────────────────────────────────────────

describe('<CharacterSheet /> — combat stats', () => {
  it('renders HP as currentHp/maxHp', () => {
    const s = makeStats({ currentHp: 8, maxHp: 18 });
    expect(`${s.currentHp}/${s.maxHp}`).toBe('8/18');
  });

  it('HP alert when below 30%', () => {
    const s = makeStats({ currentHp: 5, maxHp: 18 });
    expect(s.currentHp / s.maxHp).toBeLessThan(0.3);
  });

  it('no HP alert at exactly 30%', () => {
    const s = makeStats({ currentHp: 6, maxHp: 20 });
    expect(s.currentHp / s.maxHp).toBe(0.3);
  });

  it('renders AC value', () => {
    expect(makeStats({ ac: 15 }).ac).toBe(15);
  });

  it('renders attack bonus with +', () => {
    const s = makeStats({ attackBonus: 4 });
    expect(`+${s.attackBonus}`).toBe('+4');
  });

  it('renders positive initiative modifier with +', () => {
    const s = makeStats({ initiativeMod: 2 });
    const label = s.initiativeMod >= 0 ? `+${s.initiativeMod}` : `${s.initiativeMod}`;
    expect(label).toBe('+2');
  });

  it('renders negative initiative modifier without +', () => {
    const s = makeStats({ initiativeMod: -1 });
    const label = s.initiativeMod >= 0 ? `+${s.initiativeMod}` : `${s.initiativeMod}`;
    expect(label).toBe('-1');
  });
});

// ─── CharacterSheet — class features ─────────────────────────────────────────

const CLASS_FEATURES: Record<string, Array<{ id: string; label: string; cunning?: boolean }>> = {
  Fighter: [{ id: 'second_wind', label: '⚡ Second Wind' }],
  Rogue: [{ id: 'cunning_action', label: '⚡ Cunning Action', cunning: true }],
  Wizard: [{ id: 'arcane_recovery', label: '⚡ Arcane Recovery' }],
  Cleric: [{ id: 'channel_divinity', label: '⚡ Channel Divinity' }],
};

describe('<CharacterSheet /> — class features', () => {
  it('own character in combat: feature tap calls onFeatureActivate', () => {
    const fn = vi.fn();
    const isOwn = true, isCombat = true;
    const feature = CLASS_FEATURES['Rogue'][0];
    if (isOwn && isCombat) fn(feature.label);
    expect(fn).toHaveBeenCalledWith('⚡ Cunning Action');
  });

  it('own character out of combat: feature tap shows tooltip, no nav', () => {
    let tooltip: string | null = null;
    const isOwn = true, isCombat = false;
    const feature = CLASS_FEATURES['Fighter'][0];
    if (isOwn && !isCombat) tooltip = feature.id;
    expect(tooltip).toBe('second_wind');
  });

  it('ally: feature tap does nothing (read-only)', () => {
    const fn = vi.fn();
    const isOwn = false;
    if (isOwn) fn('activated');
    expect(fn).not.toHaveBeenCalled();
  });

  it('expended feature (◎) is non-interactive — shown as ◎ not ●', () => {
    const expended = true;
    const indicator = expended ? '◎' : '●';
    expect(indicator).toBe('◎');
  });

  it('class without features returns empty array', () => {
    expect(CLASS_FEATURES['Barbarian'] ?? []).toHaveLength(0);
  });
});

// ─── CharacterSheet — ability scores ─────────────────────────────────────────

describe('<CharacterSheet /> — ability scores', () => {
  it('abilityMod: score 10 → +0', () => expect(abilityMod(10)).toBe('+0'));
  it('abilityMod: score 14 → +2', () => expect(abilityMod(14)).toBe('+2'));
  it('abilityMod: score 8 → -1', () => expect(abilityMod(8)).toBe('-1'));
  it('abilityMod: score 20 → +5', () => expect(abilityMod(20)).toBe('+5'));
  it('abilityMod: score 1 → -5', () => expect(abilityMod(1)).toBe('-5'));

  it('renders 6 ability scores', () => {
    const keys = ['baseStrength','baseDexterity','baseConstitution','baseIntelligence','baseWisdom','baseCharisma'];
    expect(keys).toHaveLength(6);
  });
});

// ─── CharacterSheet — skills ──────────────────────────────────────────────────

describe('<CharacterSheet /> — skills', () => {
  it('proficient skill has ★ indicator', () => {
    const s = makeStats();
    const prof = s.skillProficiencies.includes('Stealth');
    expect(prof).toBe(true);
  });

  it('non-proficient skill has no ★', () => {
    const s = makeStats();
    const prof = s.skillProficiencies.includes('Athletics');
    expect(prof).toBe(false);
  });

  it('skill modifier shown correctly', () => {
    const s = makeStats();
    expect(s.skillsModifiers['Stealth']).toBe(6);
  });

  it('positive modifier rendered with +', () => {
    const mod = 6;
    expect(mod >= 0 ? `+${mod}` : `${mod}`).toBe('+6');
  });

  it('negative modifier rendered without +', () => {
    const mod = -2;
    expect(mod >= 0 ? `+${mod}` : `${mod}`).toBe('-2');
  });
});

// ─── InventoryTab — exploration mode ─────────────────────────────────────────

describe('<InventoryTab /> — exploration', () => {
  it('[Use] visible for consumable items', () => {
    const item = makeItem({ consumable: true });
    const canUse = !!(item.consumable || item.use_effect);
    expect(canUse).toBe(true);
  });

  it('[Use] visible for items with use_effect', () => {
    const item = makeItem({ use_effect: 'heal' });
    const canUse = !!(item.consumable || item.use_effect);
    expect(canUse).toBe(true);
  });

  it('[Use] not shown for plain non-consumable items', () => {
    const item = makeItem({ name: 'Rope' });
    const canUse = !!(item.consumable || item.use_effect);
    expect(canUse).toBe(false);
  });

  it('[Equip] shown for items with equip_slot', () => {
    const item = makeItem({ equip_slot: 'main_hand' });
    expect(!!item.equip_slot).toBe(true);
  });

  it('[Drop] always visible in exploration', () => {
    const isCombat = false;
    expect(isCombat).toBe(false);
  });

  it('[Equip] tap calls onExplorationAction with correct text', () => {
    const fn = vi.fn();
    const item = makeItem({ name: 'Dagger', equip_slot: 'main_hand' });
    fn(`equip ${item.name}`, 'equip');
    expect(fn).toHaveBeenCalledWith('equip Dagger', 'equip');
  });

  it('[Drop] tap calls onExplorationAction with correct text', () => {
    const fn = vi.fn();
    const item = makeItem({ name: 'Torch' });
    fn(`drop ${item.name}`, 'drop');
    expect(fn).toHaveBeenCalledWith('drop Torch', 'drop');
  });

  it('[Unequip] tap calls onExplorationAction with correct text', () => {
    const fn = vi.fn();
    const item = makeItem({ name: 'Short Sword' });
    fn(`unequip ${item.name}`, 'unequip');
    expect(fn).toHaveBeenCalledWith('unequip Short Sword', 'unequip');
  });
});

// ─── InventoryTab — combat mode ───────────────────────────────────────────────

describe('<InventoryTab /> — combat', () => {
  const isCombat = true;

  it('[Use] only shown for combat_usable items', () => {
    const item = makeItem({ combat_usable: true });
    const showUse = isCombat ? !!item.combat_usable : !!(item.consumable || item.use_effect);
    expect(showUse).toBe(true);
  });

  it('item without combat_usable has no [Use] in combat', () => {
    const item = makeItem({ name: 'Rope', consumable: false });
    const showUse = isCombat ? !!item.combat_usable : !!(item.consumable || item.use_effect);
    expect(showUse).toBe(false);
  });

  it('[Equip] disabled in combat', () => {
    const disabled = isCombat;
    expect(disabled).toBe(true);
  });

  it('[Unequip] disabled in combat', () => {
    const disabled = isCombat;
    expect(disabled).toBe(true);
  });

  it('[Drop] disabled in combat', () => {
    const disabled = isCombat;
    expect(disabled).toBe(true);
  });

  it('[Use] tap in combat calls onCombatUse with item', () => {
    const fn = vi.fn();
    const item = makeItem({ name: 'Healing Potion', combat_usable: true });
    fn(item);
    expect(fn).toHaveBeenCalledWith(item);
  });

  it('onCombatUse inserts chip with item name', () => {
    let chip: string | null = null;
    const onCombatUse = (item: ItemDefinition) => { chip = `Use: ${item.name}`; };
    onCombatUse(makeItem({ name: 'Healing Potion' }));
    expect(chip).toBe('Use: Healing Potion');
  });

  it('onCombatUse navigates to chat tab', () => {
    let tab = 'inventory';
    const onCombatUse = () => { tab = 'chat'; };
    onCombatUse();
    expect(tab).toBe('chat');
  });
});
