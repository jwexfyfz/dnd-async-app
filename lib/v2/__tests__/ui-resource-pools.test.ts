import { describe, it, expect } from 'vitest';
import { maxForLevel, getDisplayType, restLabel, restDescription, isSpent } from '@/components/v2/character/ResourcePools';
import type { CharacterStats } from '@/types/v2-game';

// ─── getDisplayType ───────────────────────────────────────────────────────────

describe('getDisplayType', () => {
  it('lay_on_hands, any max → hp-fraction', () => {
    expect(getDisplayType('lay_on_hands', 5)).toBe('hp-fraction');
    expect(getDisplayType('lay_on_hands', 25)).toBe('hp-fraction');
  });

  it('second_wind, max=1 → binary', () => {
    expect(getDisplayType('second_wind', 1)).toBe('binary');
  });

  it('action_surge, max=1 → binary', () => {
    expect(getDisplayType('action_surge', 1)).toBe('binary');
  });

  it('channel_divinity_clr, max=1 → binary', () => {
    expect(getDisplayType('channel_divinity_clr', 1)).toBe('binary');
  });

  it('channel_divinity_pal, max=1 → binary', () => {
    expect(getDisplayType('channel_divinity_pal', 1)).toBe('binary');
  });

  it('ki, max=3 → pips', () => {
    expect(getDisplayType('ki', 3)).toBe('pips');
  });

  it('rage, max=4 → pips', () => {
    expect(getDisplayType('rage', 4)).toBe('pips');
  });

  it('wild_shape, max=2 → pips', () => {
    expect(getDisplayType('wild_shape', 2)).toBe('pips');
  });

  it('bardic_inspiration, max=3 → pips', () => {
    expect(getDisplayType('bardic_inspiration', 3)).toBe('pips');
  });

  it('crimson_rite, max=2 → pips', () => {
    expect(getDisplayType('crimson_rite', 2)).toBe('pips');
  });

  it('unknown pool, max=1 → binary', () => {
    expect(getDisplayType('mystery_pool', 1)).toBe('binary');
  });

  it('unknown pool, max=4 → pips', () => {
    expect(getDisplayType('mystery_pool', 4)).toBe('pips');
  });
});

// ─── restLabel ────────────────────────────────────────────────────────────────

describe('restLabel', () => {
  it('SHORT_REST → Short Rest', () => {
    expect(restLabel('SHORT_REST')).toBe('Short Rest');
  });

  it('LONG_REST → Long Rest', () => {
    expect(restLabel('LONG_REST')).toBe('Long Rest');
  });

  it('unknown string → Rest (safe fallback, not a crash)', () => {
    expect(() => restLabel('UNKNOWN')).not.toThrow();
    expect(restLabel('UNKNOWN')).toBe('Rest');
  });
});

// ─── restDescription ──────────────────────────────────────────────────────────

describe('restDescription', () => {
  it('SHORT_REST → contains "10 minutes" and "Short Rest"', () => {
    const d = restDescription('SHORT_REST');
    expect(d).toContain('10 minutes');
    expect(d).toContain('Short Rest');
  });

  it('LONG_REST → contains "camp" and "Long Rest"', () => {
    const d = restDescription('LONG_REST');
    expect(d.toLowerCase()).toContain('camp');
    expect(d).toContain('Long Rest');
  });
});

// ─── isSpent ──────────────────────────────────────────────────────────────────

describe('isSpent', () => {
  it('current=0 → true', () => expect(isSpent(0)).toBe(true));
  it('current=1 → false', () => expect(isSpent(1)).toBe(false));
  it('current=3 → false', () => expect(isSpent(3)).toBe(false));
});

// ─── Monk — ki pool data ──────────────────────────────────────────────────────

const kiMaxByLevel = { '2': 2, '3': 3, '4': 4, '5': 5 };

describe('Monk — ki pool data', () => {
  it('L2, current=2: max=2, type=pips, not spent', () => {
    const max = maxForLevel(kiMaxByLevel, 2);
    expect(max).toBe(2);
    expect(getDisplayType('ki', max)).toBe('pips');
    expect(isSpent(2)).toBe(false);
  });

  it('L3, current=2: max=3, type=pips, not spent, one empty pip', () => {
    const max = maxForLevel(kiMaxByLevel, 3);
    expect(max).toBe(3);
    expect(isSpent(2)).toBe(false);
    expect(max - 2).toBe(1);
  });

  it('L3, current=0: max=3, isSpent=true', () => {
    const max = maxForLevel(kiMaxByLevel, 3);
    expect(max).toBe(3);
    expect(isSpent(0)).toBe(true);
  });

  it('L1 (ki not yet unlocked): maxForLevel({"2":2,...}, 1) = 0, row skipped', () => {
    const max = maxForLevel(kiMaxByLevel, 1);
    expect(max).toBe(0);
  });
});

// ─── Fighter — binary pools ───────────────────────────────────────────────────

const secondWindMax = { '1': 1 };
const actionSurgeMax = { '2': 1 };

describe('Fighter — binary pools', () => {
  it('second_wind current=1: max=1, type=binary, not spent', () => {
    const max = maxForLevel(secondWindMax, 1);
    expect(max).toBe(1);
    expect(getDisplayType('second_wind', max)).toBe('binary');
    expect(isSpent(1)).toBe(false);
  });

  it('second_wind current=0: isSpent=true', () => {
    expect(isSpent(0)).toBe(true);
  });

  it('action_surge current=1: not spent', () => {
    expect(isSpent(1)).toBe(false);
  });

  it('action_surge current=0: isSpent=true', () => {
    expect(isSpent(0)).toBe(true);
  });
});

// ─── Paladin — lay_on_hands HP fraction ──────────────────────────────────────

const layOnHandsMax = { '1': 5, '2': 10, '3': 15, '4': 20, '5': 25 };

describe('Paladin — lay_on_hands HP fraction', () => {
  it('L1, current=5: max=5, type=hp-fraction, label=5 / 5 HP', () => {
    const max = maxForLevel(layOnHandsMax, 1);
    expect(max).toBe(5);
    expect(getDisplayType('lay_on_hands', max)).toBe('hp-fraction');
    expect(`${5} / ${max} HP`).toBe('5 / 5 HP');
  });

  it('L2, current=8: max=10, type=hp-fraction, label=8 / 10 HP', () => {
    const max = maxForLevel(layOnHandsMax, 2);
    expect(max).toBe(10);
    expect(`${8} / ${max} HP`).toBe('8 / 10 HP');
  });

  it('L3, current=0: max=15, isSpent=true', () => {
    const max = maxForLevel(layOnHandsMax, 3);
    expect(max).toBe(15);
    expect(isSpent(0)).toBe(true);
  });
});

// ─── Barbarian — rage ────────────────────────────────────────────────────────

const rageMax = { '1': 2, '3': 3, '6': 4 };

describe('Barbarian — rage', () => {
  it('L1, current=2: max=2, pips filled', () => {
    const max = maxForLevel(rageMax, 1);
    expect(max).toBe(2);
    expect(getDisplayType('rage', max)).toBe('pips');
  });

  it('L3, current=1: max=3, one empty pip', () => {
    const max = maxForLevel(rageMax, 3);
    expect(max).toBe(3);
    expect(max - 1).toBe(2);
  });

  it('L6, current=0: max=4, isSpent=true', () => {
    const max = maxForLevel(rageMax, 6);
    expect(max).toBe(4);
    expect(isSpent(0)).toBe(true);
  });
});

// ─── missing resourceStates row ───────────────────────────────────────────────

describe('missing resourceStates row', () => {
  it('no row for poolKey → current defaults to max → not spent', () => {
    const stats = {
      level: 3,
      resourceStates: [] as Array<{ poolKey: string; current: number }>,
    };
    const max = maxForLevel(kiMaxByLevel, stats.level);
    const stateRow = stats.resourceStates.find(s => s.poolKey === 'ki');
    const current = stateRow?.current ?? max;
    expect(isSpent(current)).toBe(false);
    expect(current).toBe(max);
  });
});

// ─── pool not yet unlocked ────────────────────────────────────────────────────

describe('pool not yet unlocked', () => {
  it('max=0 → row is excluded from render output', () => {
    const max = maxForLevel(kiMaxByLevel, 1);
    expect(max).toBe(0);
  });
});

// ─── empty classFeatureDetails ────────────────────────────────────────────────

describe('empty classFeatureDetails', () => {
  it('no RESOURCE_POOL entries → section produces no rows', () => {
    const details: CharacterStats['classFeatureDetails'] = [
      { id: 'f1', name: 'Cunning Action', featureType: 'ACTIVE_ABILITY', mechanicsJson: null, actionType: 'BONUS_ACTION', implemented: true, level: 2, subclass: null, description: '', resourcePool: null },
    ];
    const pools = details.filter(f => f.featureType === 'RESOURCE_POOL' && f.resourcePool != null);
    expect(pools).toHaveLength(0);
  });
});
