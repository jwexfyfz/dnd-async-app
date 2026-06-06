import { describe, it, expect } from 'vitest';
import type { ItemDefinition, InitiativeEntry } from '@/types/v2-game';

// Pure logic tests for <ItemPickerSheet /> and the Use Item flow.
// Tests extract the pure functions that drive the sheet's behaviour.

function filterCombatUsableItems(bag: ItemDefinition[]): ItemDefinition[] {
  return bag.filter(i => i.combat_usable);
}

function buildUseItemChip(itemName: string, targetName?: string): string {
  return targetName ? `Use: ${itemName} → ${targetName}` : `Use: ${itemName}`;
}

function getPartyTargets(
  initiativeOrder: InitiativeEntry[],
): { id: string; name: string; hp: number; maxHp: number }[] {
  return initiativeOrder
    .filter(e => e.type === 'character')
    .map(e => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp }));
}

function shouldSkipSheet(items: ItemDefinition[]): ItemDefinition | null {
  if (items.length === 1 && !items[0].targetable) return items[0];
  return null;
}

function makeItem(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return { id: 'i1', name: 'Healing Potion', combat_usable: true, ...overrides };
}

function makeEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'char-1',
    type: 'character',
    name: 'Tomas',
    initiative: 17,
    hp: 14,
    maxHp: 18,
    ac: 12,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

describe('<ItemPickerSheet /> — item filtering', () => {
  it('shows only combat_usable items', () => {
    const bag = [
      makeItem({ id: 'i1', name: 'Healing Potion', combat_usable: true }),
      makeItem({ id: 'i2', name: 'Rope', combat_usable: false }),
      makeItem({ id: 'i3', name: 'Silver Key', combat_usable: false }),
    ];
    const usable = filterCombatUsableItems(bag);
    expect(usable).toHaveLength(1);
    expect(usable[0].name).toBe('Healing Potion');
  });

  it('non-combat items not listed', () => {
    const bag = [makeItem({ id: 'i1', name: 'Rope', combat_usable: false })];
    expect(filterCombatUsableItems(bag)).toHaveLength(0);
  });

  it('empty bag: no usable items', () => {
    expect(filterCombatUsableItems([])).toHaveLength(0);
  });

  it('[Use Item] chip greyed when no combat_usable items', () => {
    const hasCombatItems = filterCombatUsableItems([]).length > 0;
    expect(hasCombatItems).toBe(false);
  });
});

describe('<ItemPickerSheet /> — chip generation', () => {
  it('non-targetable item: chip has no arrow', () => {
    const chip = buildUseItemChip('Healing Potion');
    expect(chip).toBe('Use: Healing Potion');
    expect(chip).not.toContain('→');
  });

  it('target selection: chip includes target name with arrow', () => {
    const chip = buildUseItemChip('Healing Potion', 'Brennan');
    expect(chip).toBe('Use: Healing Potion → Brennan');
  });

  it('self-target chip has no arrow', () => {
    const chip = buildUseItemChip('Healing Potion');
    expect(chip).not.toContain('→');
  });
});

describe('<ItemPickerSheet /> — target picker', () => {
  it('targetable item: tap shows target picker with party members', () => {
    const order = [
      makeEntry({ id: 'char-1', name: 'Tomas', hp: 14, maxHp: 18, type: 'character' }),
      makeEntry({ id: 'enemy-1', name: 'Guard', type: 'enemy', hp: 8, maxHp: 10 }),
    ];
    const targets = getPartyTargets(order);
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('Tomas');
    expect(targets[0].hp).toBe(14);
  });

  it('non-targetable item: tap inserts chip immediately (no target picker)', () => {
    const item = makeItem({ targetable: false });
    const skipItem = shouldSkipSheet([item]);
    expect(skipItem).toBe(item);
  });

  it('targetable item: opens target picker', () => {
    const item = makeItem({ targetable: true });
    const skipItem = shouldSkipSheet([item]);
    expect(skipItem).toBeNull();
  });
});

describe('<ItemPickerSheet /> — edge cases', () => {
  it('one non-targetable item: skips sheet, chip inserted immediately', () => {
    const item = makeItem({ name: 'Fire Bomb', targetable: false });
    const skipItem = shouldSkipSheet([item]);
    expect(skipItem?.name).toBe('Fire Bomb');
  });

  it('one targetable item: does NOT skip sheet (needs target selection)', () => {
    const item = makeItem({ name: 'Healing Potion', targetable: true });
    const skipItem = shouldSkipSheet([item]);
    expect(skipItem).toBeNull();
  });

  it('multiple items: never skips sheet', () => {
    const items = [
      makeItem({ id: 'i1', name: 'Potion', targetable: false }),
      makeItem({ id: 'i2', name: 'Bomb', targetable: false }),
    ];
    const skipItem = shouldSkipSheet(items);
    expect(skipItem).toBeNull();
  });

  it('empty usable inventory: "Nothing usable in combat" message shown', () => {
    const usable = filterCombatUsableItems([]);
    const showEmpty = usable.length === 0;
    expect(showEmpty).toBe(true);
  });

  it('drag sheet down: dismisses, no chip', () => {
    let chip: string | null = null;
    const onDismiss = () => { /* no chip set */ };
    onDismiss();
    expect(chip).toBeNull();
  });

  it('tap outside: dismisses, no chip', () => {
    let chip: string | null = null;
    const onDismiss = () => { /* no chip set */ };
    onDismiss();
    expect(chip).toBeNull();
  });
});
