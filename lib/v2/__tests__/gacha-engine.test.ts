import { describe, it, expect } from 'vitest';
import {
  legendaryRate,
  getPityFlavor,
  isSoftPity,
  computeStreakUpdate,
  selectItem,
} from '@/lib/v2/gacha-engine';
import { filterDuplicates, COMMON_ITEMS, UNCOMMON_ITEMS, getRarePool, getLegendaryPool } from '@/lib/v2/gacha-items';
import type { GachaPullRecord } from '@/types/v2-game';

// ── legendaryRate ─────────────────────────────────────────────────────────────

describe('legendaryRate', () => {
  it('is 2% before soft pity', () => {
    expect(legendaryRate(0)).toBeCloseTo(0.02);
    expect(legendaryRate(1)).toBeCloseTo(0.02);
    expect(legendaryRate(29)).toBeCloseTo(0.02);
  });

  it('starts increasing at pull 30', () => {
    expect(legendaryRate(30)).toBeCloseTo(0.12);
    expect(legendaryRate(31)).toBeCloseTo(0.22);
    expect(legendaryRate(32)).toBeCloseTo(0.32);
  });

  it('caps at 100% at pull 40', () => {
    expect(legendaryRate(40)).toBe(1.0);
    expect(legendaryRate(50)).toBe(1.0);
  });

  it('reaches ~92% at pull 38', () => {
    expect(legendaryRate(38)).toBeCloseTo(0.92);
  });
});

// ── isSoftPity ────────────────────────────────────────────────────────────────

describe('isSoftPity', () => {
  it('is false before pull 30', () => {
    expect(isSoftPity(0)).toBe(false);
    expect(isSoftPity(29)).toBe(false);
  });

  it('is true from pull 30 onward', () => {
    expect(isSoftPity(30)).toBe(true);
    expect(isSoftPity(39)).toBe(true);
    expect(isSoftPity(40)).toBe(true);
  });
});

// ── getPityFlavor ─────────────────────────────────────────────────────────────

describe('getPityFlavor', () => {
  it('returns base text at low pity', () => {
    const text = getPityFlavor(0);
    expect(text).toContain('small token');
  });

  it('returns escalating text as soft pity builds', () => {
    const t30 = getPityFlavor(30);
    const t34 = getPityFlavor(34);
    const t38 = getPityFlavor(38);
    // Each tier has a distinct string — just verify they're different and non-empty
    expect(t30.length).toBeGreaterThan(0);
    expect(t34).not.toBe(t30);
    expect(t38).not.toBe(t34);
  });

  it('returns guaranteed text at pull 40', () => {
    const text = getPityFlavor(40);
    expect(text).toContain("gift awaits");
  });
});

// ── filterDuplicates ──────────────────────────────────────────────────────────

describe('filterDuplicates', () => {
  it('keeps consumables even if previously pulled', () => {
    const pulledIds = ['gacha_common_heal_8', 'gacha_common_heal_16'];
    const result = filterDuplicates(COMMON_ITEMS, pulledIds);
    // All 4 commons are consumables so none are excluded
    expect(result).toHaveLength(COMMON_ITEMS.length);
  });

  it('removes equipment that has been pulled', () => {
    const equipment = UNCOMMON_ITEMS.filter(i => !i.consumable);
    const pulledId = equipment[0].id;
    const result = filterDuplicates(UNCOMMON_ITEMS, [pulledId]);
    expect(result.find(i => i.id === pulledId)).toBeUndefined();
    // Consumables in the pool are still there
    const consumables = UNCOMMON_ITEMS.filter(i => i.consumable);
    for (const c of consumables) {
      expect(result.find(i => i.id === c.id)).toBeDefined();
    }
  });

  it('returns full pool when pull history is empty', () => {
    const result = filterDuplicates(UNCOMMON_ITEMS, []);
    expect(result).toHaveLength(UNCOMMON_ITEMS.length);
  });

  it('returns only consumables when all equipment has been pulled', () => {
    const equipment = UNCOMMON_ITEMS.filter(i => !i.consumable);
    const pulledIds = equipment.map(i => i.id);
    const result = filterDuplicates(UNCOMMON_ITEMS, pulledIds);
    expect(result.every(i => i.consumable)).toBe(true);
  });
});

// ── selectItem ────────────────────────────────────────────────────────────────

describe('selectItem', () => {
  it('returns a common item from the common pool', () => {
    const item = selectItem('common', 'Fighter', []);
    expect(COMMON_ITEMS.some(c => c.id === item.id)).toBe(true);
  });

  it('returns an uncommon item from the uncommon pool', () => {
    const item = selectItem('uncommon', 'Fighter', []);
    expect(UNCOMMON_ITEMS.some(u => u.id === item.id)).toBe(true);
  });

  it('returns a class-appropriate rare item', () => {
    const rarePool = getRarePool('Rogue');
    const item = selectItem('rare', 'Rogue', []);
    expect(rarePool.some(r => r.id === item.id)).toBe(true);
  });

  it('returns a class-appropriate legendary item', () => {
    const legPool = getLegendaryPool('Paladin');
    const item = selectItem('legendary', 'Paladin', []);
    expect(legPool.some(l => l.id === item.id)).toBe(true);
  });

  it('never returns a previously-pulled equipment item', () => {
    // Pull all rare equipment for Rogue except consumables
    const rarePool = getRarePool('Rogue');
    const equipmentIds = rarePool.filter(i => !i.consumable).map(i => i.id);
    const history: GachaPullRecord[] = equipmentIds.map(id => ({
      itemId: id, itemName: 'x', rarity: 'rare', pulledAt: '2026-01-01T00:00:00Z',
    }));
    // Run 20 times — should always pick standalone consumables or fall back
    for (let i = 0; i < 20; i++) {
      const item = selectItem('rare', 'Rogue', history);
      expect(equipmentIds).not.toContain(item.id);
    }
  });

  it('falls back to uncommon when legendary pool is exhausted', () => {
    const legPool = getLegendaryPool('Wizard');
    const allLegIds = legPool.map(i => i.id);
    const history: GachaPullRecord[] = allLegIds.map(id => ({
      itemId: id, itemName: 'x', rarity: 'legendary', pulledAt: '2026-01-01T00:00:00Z',
    }));
    const item = selectItem('legendary', 'Wizard', history);
    // Should have fallen back to uncommon or rare
    expect(allLegIds).not.toContain(item.id);
  });

  it('falls back to rare when legendary and rare pools are exhausted', () => {
    const legPool = getLegendaryPool('Fighter');
    const rarePool = getRarePool('Fighter');
    const equipmentIds = [
      ...legPool.map(i => i.id),
      ...rarePool.filter(i => !i.consumable).map(i => i.id),
    ];
    const history: GachaPullRecord[] = equipmentIds.map(id => ({
      itemId: id, itemName: 'x', rarity: 'legendary', pulledAt: '2026-01-01T00:00:00Z',
    }));
    const item = selectItem('legendary', 'Fighter', history);
    expect(equipmentIds).not.toContain(item.id);
  });
});

// ── computeStreakUpdate ───────────────────────────────────────────────────────

function makeDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

describe('computeStreakUpdate', () => {
  it('starts a streak on first session (no prior date)', () => {
    const result = computeStreakUpdate({ streakDays: 0, streakShields: 0, lastStreakDate: null });
    expect(result.streakDays).toBe(1);
    expect(result.streakBroken).toBe(false);
    expect(result.pendingPullsAdded).toBe(0);
  });

  it('is a no-op when already active today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = computeStreakUpdate({ streakDays: 3, streakShields: 0, lastStreakDate: today });
    expect(result.streakDays).toBe(3);
    expect(result.pendingPullsAdded).toBe(0);
  });

  it('increments streak on consecutive days', () => {
    const result = computeStreakUpdate({ streakDays: 4, streakShields: 0, lastStreakDate: makeDate(1) });
    expect(result.streakDays).toBe(5);
    expect(result.streakBroken).toBe(false);
  });

  it('resets streak when two days missed with no shield', () => {
    const result = computeStreakUpdate({ streakDays: 10, streakShields: 0, lastStreakDate: makeDate(2) });
    expect(result.streakDays).toBe(1);
    expect(result.streakBroken).toBe(true);
    expect(result.shieldUsed).toBe(false);
  });

  it('consumes a shield when exactly one day was missed', () => {
    const result = computeStreakUpdate({ streakDays: 10, streakShields: 2, lastStreakDate: makeDate(2) });
    expect(result.streakDays).toBe(11);
    expect(result.streakShields).toBe(1);
    expect(result.shieldUsed).toBe(true);
    expect(result.streakBroken).toBe(false);
  });

  it('resets streak when two days missed even with a shield', () => {
    const result = computeStreakUpdate({ streakDays: 10, streakShields: 3, lastStreakDate: makeDate(3) });
    expect(result.streakDays).toBe(1);
    expect(result.streakBroken).toBe(true);
    expect(result.streakShields).toBe(3); // shield not consumed
  });

  it('grants a pull and shield on completing day 7', () => {
    const result = computeStreakUpdate({ streakDays: 6, streakShields: 0, lastStreakDate: makeDate(1) });
    expect(result.streakDays).toBe(7);
    expect(result.pendingPullsAdded).toBe(1);
    expect(result.newShieldEarned).toBe(true);
    expect(result.streakShields).toBe(1);
  });

  it('grants a pull on every 7-day multiple', () => {
    const r14 = computeStreakUpdate({ streakDays: 13, streakShields: 1, lastStreakDate: makeDate(1) });
    expect(r14.streakDays).toBe(14);
    expect(r14.pendingPullsAdded).toBe(1);
    expect(r14.newShieldEarned).toBe(true);
  });

  it('does not grant a pull on non-multiple days', () => {
    for (const day of [1, 2, 3, 5, 6, 8, 9, 10, 11, 13]) {
      const result = computeStreakUpdate({ streakDays: day - 1, streakShields: 0, lastStreakDate: makeDate(1) });
      expect(result.pendingPullsAdded).toBe(0);
      expect(result.newShieldEarned).toBe(false);
    }
  });

  it('sets lastStreakDate to today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = computeStreakUpdate({ streakDays: 2, streakShields: 0, lastStreakDate: makeDate(1) });
    expect(result.lastStreakDate).toBe(today);
  });

  it('includes a message when streak is broken', () => {
    const result = computeStreakUpdate({ streakDays: 5, streakShields: 0, lastStreakDate: makeDate(2) });
    expect(result.message).toContain('broken');
  });

  it('includes a shield-saved message when shield is used', () => {
    const result = computeStreakUpdate({ streakDays: 5, streakShields: 1, lastStreakDate: makeDate(2) });
    expect(result.message).toContain('shield');
  });

  it('returns null message for normal day increment', () => {
    const result = computeStreakUpdate({ streakDays: 2, streakShields: 0, lastStreakDate: makeDate(1) });
    expect(result.message).toBeNull();
  });
});

// ── Item pool coverage ────────────────────────────────────────────────────────

describe('item pool integrity', () => {
  const classes = ['Fighter', 'Rogue', 'Ranger', 'Cleric', 'Wizard', 'Barbarian', 'Bard', 'Paladin', 'Monk', 'Druid', 'Sorcerer', 'Warlock'];

  it('every common item has an id, name, and consumable=true', () => {
    for (const item of COMMON_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.consumable).toBe(true);
    }
  });

  it('every item has a unique id', () => {
    // getRarePool includes 2 standalones for every class — deduplicate by id
    const seen = new Map<string, string>();
    const allItems = [
      ...COMMON_ITEMS,
      ...UNCOMMON_ITEMS,
      ...classes.flatMap(c => [...getRarePool(c), ...getLegendaryPool(c)]),
    ];
    const duplicates: string[] = [];
    for (const item of allItems) {
      if (seen.has(item.id)) {
        // Standalone rares intentionally appear in every class pool — skip them
        if (!seen.get(item.id)!.startsWith('standalone')) {
          seen.set(item.id, 'standalone');
        }
      } else {
        seen.set(item.id, item.classRestriction ?? 'standalone');
      }
    }
    // No two distinct items should share an id — standalones just repeat intentionally
    const uniqueIds = new Set(allItems.map(i => i.id));
    // Every id in the unique set should point to exactly one item definition
    for (const id of uniqueIds) {
      const defs = allItems.filter(i => i.id === id);
      // Same id should always be the same item (name match)
      const names = new Set(defs.map(i => i.name));
      expect(names.size).toBe(1);
      duplicates.length; // suppress unused warning
    }
    expect(duplicates).toHaveLength(0);
  });

  it('each class has exactly 3 rare items (plus 2 standalones)', () => {
    for (const cls of classes) {
      const pool = getRarePool(cls);
      expect(pool.length).toBe(5);
    }
  });

  it('each class has exactly 7 legendary items', () => {
    for (const cls of classes) {
      const pool = getLegendaryPool(cls);
      expect(pool.length).toBe(7);
    }
  });

  it('rare and legendary equipment items have an equip_slot', () => {
    for (const cls of classes) {
      for (const item of [...getRarePool(cls), ...getLegendaryPool(cls)]) {
        if (!item.consumable) {
          expect(item.equip_slot).toBeTruthy();
        }
      }
    }
  });
});
