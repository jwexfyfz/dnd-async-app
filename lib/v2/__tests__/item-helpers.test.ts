import { describe, it, expect } from 'vitest';
import { normalizeInventory, inventorySummary, extractPoiItems } from '../item-helpers';

describe('normalizeInventory', () => {
  it('null → empty', () => expect(normalizeInventory(null)).toEqual({ bag: [], equipped: {} }));
  it('array → empty', () => expect(normalizeInventory([])).toEqual({ bag: [], equipped: {} }));
  it('valid object → preserved', () => {
    const item = { id: 'i1', name: 'Sword' };
    const r = normalizeInventory({ bag: [item], equipped: {} });
    expect(r.bag[0].id).toBe('i1');
  });
});

describe('inventorySummary', () => {
  it('empty inventory', () => {
    const r = inventorySummary({ bag: [], equipped: {} });
    expect(r).toBe('bag=0 item(s)');
  });

  it('bag with 2 items, no equipped', () => {
    const r = inventorySummary({
      bag: [{ id: 'a', name: 'Dagger' }, { id: 'b', name: 'Torch' }],
      equipped: {},
    });
    expect(r).toBe('bag=2 item(s)');
  });

  it('equipped main_hand slot appears in summary', () => {
    const r = inventorySummary({
      bag: [],
      equipped: { main_hand: { id: 'sw', name: 'Shortsword' } },
    });
    expect(r).toContain('main_hand:Shortsword');
  });

  it('undefined equipped slots are excluded', () => {
    const r = inventorySummary({ bag: [], equipped: { main_hand: undefined } });
    expect(r).not.toContain('main_hand');
  });
});

describe('extractPoiItems', () => {
  it('empty defaults and current → empty lists', () => {
    const { items, floorItems } = extractPoiItems({}, {});
    expect(items).toHaveLength(0);
    expect(floorItems).toHaveLength(0);
  });

  it('non-hidden item in template is visible', () => {
    const defaults = { items: [{ id: 'k1', name: 'Key', hidden: false }] };
    const { items } = extractPoiItems(defaults, {});
    expect(items[0].id).toBe('k1');
  });

  it('hidden item not in revealed_items is excluded', () => {
    const defaults = { items: [{ id: 'k1', name: 'Secret Key', hidden: true }] };
    const { items } = extractPoiItems(defaults, {});
    expect(items).toHaveLength(0);
  });

  it('hidden item in revealed_items is visible', () => {
    const defaults = { items: [{ id: 'k1', name: 'Secret Key', hidden: true }] };
    const current = { revealed_items: ['k1'] };
    const { items } = extractPoiItems(defaults, current);
    expect(items[0].id).toBe('k1');
  });

  it('taken item is excluded', () => {
    const defaults = { items: [{ id: 'k1', name: 'Key' }] };
    const current = { items_taken: ['k1'] };
    const { items } = extractPoiItems(defaults, current);
    expect(items).toHaveLength(0);
  });

  it('floor_items from current properties are returned', () => {
    const current = { floor_items: [{ id: 'f1', name: 'Dropped Torch' }] };
    const { floorItems } = extractPoiItems({}, current);
    expect(floorItems[0].id).toBe('f1');
  });
});
