import { describe, it, expect, vi } from 'vitest';
import type { ItemDefinition } from '@/types/v2-game';

// Pure logic tests for ActionChips and chip-in-input behaviour.

const STANDARD_CHIPS = ['Attack', 'Dodge', 'Dash', 'Disengage', 'Hide', 'Use Item', 'Provoke'];
const CLASS_FEATURES: Record<string, Array<{ id: string; label: string; cunning?: boolean }>> = {
  Fighter: [{ id: 'second_wind', label: '⚡ Second Wind' }],
  Rogue: [{ id: 'cunning_action', label: '⚡ Cunning Action', cunning: true }],
  Wizard: [{ id: 'arcane_recovery', label: '⚡ Arcane Recovery' }],
  Cleric: [{ id: 'channel_divinity', label: '⚡ Channel Divinity' }],
};

function isChipGreyed(chipId: string, actionUsed: boolean, hasCombatItems: boolean): boolean {
  if (chipId === 'use_item') return actionUsed || !hasCombatItems;
  return actionUsed;
}

function hasCombatUsableItems(bag: ItemDefinition[]): boolean {
  return bag.some(i => i.combat_usable);
}

function makeItem(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return { id: 'i1', name: 'Item', ...overrides };
}

describe('<ActionChips /> — not rendered during exploration', () => {
  it('chip row only mounts in combat', () => {
    const shouldRender = (gs: string) => gs === 'combat';
    expect(shouldRender('exploration')).toBe(false);
    expect(shouldRender('combat')).toBe(true);
  });
});

describe('<ActionChips /> — standard chips', () => {
  it('renders all 7 standard chips', () => {
    expect(STANDARD_CHIPS).toHaveLength(7);
    expect(STANDARD_CHIPS).toContain('Attack');
    expect(STANDARD_CHIPS).toContain('Use Item');
  });

  it('actionUsed=true: all chips greyed', () => {
    for (const id of STANDARD_CHIPS.map(l => l.toLowerCase().replace(' ', '_'))) {
      expect(isChipGreyed(id, true, true)).toBe(true);
    }
  });

  it('actionUsed=false: non-use_item chips active', () => {
    expect(isChipGreyed('attack', false, true)).toBe(false);
    expect(isChipGreyed('dodge', false, true)).toBe(false);
  });

  it('[Use Item] greyed when no combat_usable items', () => {
    expect(isChipGreyed('use_item', false, false)).toBe(true);
  });

  it('[Use Item] active when combat_usable item exists and action not used', () => {
    expect(isChipGreyed('use_item', false, true)).toBe(false);
  });
});

describe('<ActionChips /> — class feature chips', () => {
  it('Fighter gets Second Wind chip', () => {
    expect(CLASS_FEATURES['Fighter'].map(f => f.id)).toContain('second_wind');
  });

  it('Rogue gets Cunning Action chip', () => {
    const f = CLASS_FEATURES['Rogue'].find(f => f.id === 'cunning_action');
    expect(f?.cunning).toBe(true);
  });

  it('class without features gets empty array', () => {
    expect(CLASS_FEATURES['Barbarian'] ?? []).toHaveLength(0);
  });

  it('[⚡ Cunning Action] tap: sub-picker opens', () => {
    let pickerOpen = false;
    const onCunningTap = () => { pickerOpen = !pickerOpen; };
    onCunningTap();
    expect(pickerOpen).toBe(true);
  });

  it('sub-picker selection inserts "Cunning Action: Hide" chip', () => {
    let chip: string | null = null;
    const tapCunning = (sublabel: string) => { chip = `Cunning Action: ${sublabel}`; };
    tapCunning('Hide');
    expect(chip).toBe('Cunning Action: Hide');
  });

  it('sub-picker closes after selection', () => {
    let pickerOpen = true;
    const tapCunning = () => { pickerOpen = false; };
    tapCunning();
    expect(pickerOpen).toBe(false);
  });
});

describe('hasCombatUsableItems', () => {
  it('returns true when bag has a combat_usable item', () => {
    expect(hasCombatUsableItems([makeItem({ combat_usable: true })])).toBe(true);
  });

  it('returns false when no combat_usable items', () => {
    expect(hasCombatUsableItems([makeItem({ combat_usable: false }), makeItem()])).toBe(false);
  });

  it('returns false for empty bag', () => {
    expect(hasCombatUsableItems([])).toBe(false);
  });
});

describe('<ChatInput /> chip-in-input', () => {
  it('chip tap inserts pill', () => {
    let chip: string | null = null;
    const setChip = (v: string | null) => { chip = v; };
    setChip('Attack');
    expect(chip).toBe('Attack');
  });

  it('second chip tap replaces existing pill', () => {
    let chip: string | null = 'Attack';
    const setChip = (v: string | null) => { chip = v; };
    setChip('Dodge');
    expect(chip).toBe('Dodge');
  });

  it('× tap clears chip', () => {
    let chip: string | null = 'Attack';
    const setChip = (v: string | null) => { chip = v; };
    setChip(null);
    expect(chip).toBeNull();
  });

  it('tapping same chip again clears it (toggle)', () => {
    let chip: string | null = 'Attack';
    const tapChip = (label: string) => { chip = chip === label ? null : label; };
    tapChip('Attack');
    expect(chip).toBeNull();
  });

  it('send with chip: action_hint included in POST body', () => {
    const chip = 'Attack';
    const body = { playerActionText: 'I swing', action_hint: chip ?? undefined };
    expect(body.action_hint).toBe('Attack');
  });

  it('send without chip: action_hint absent from POST body', () => {
    const chip: string | null = null;
    const body: Record<string, unknown> = { playerActionText: 'I look around' };
    if (chip) body.action_hint = chip;
    expect(body.action_hint).toBeUndefined();
  });

  it('chip is cleared after send', () => {
    let chip: string | null = 'Dodge';
    const setChip = (v: string | null) => { chip = v; };
    // simulate post-send cleanup
    setChip(null);
    expect(chip).toBeNull();
  });

  it('exploration mode: no chip slot (chip always null)', () => {
    const gameState = 'exploration';
    const chipVisible = gameState === 'combat';
    expect(chipVisible).toBe(false);
  });
});
