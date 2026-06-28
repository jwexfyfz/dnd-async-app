import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    classFeature: {
      findMany: vi.fn(),
    },
  },
}));

import { maxForLevel, buildClassFeatureDetails } from '../character-builder';
import { prisma } from '@/lib/prisma';

const mockFindMany = vi.mocked(prisma.classFeature.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('maxForLevel', () => {
  it('fills gaps downward: { "1": 2, "3": 3 } at L2 → 2', () => {
    expect(maxForLevel({ '1': 2, '3': 3 }, 2)).toBe(2);
  });

  it('returns 0 when level is below the first entry: { "2": 2 } at L1 → 0', () => {
    expect(maxForLevel({ '2': 2 }, 1)).toBe(0);
  });

  it('exact match: { "3": 3 } at L3 → 3', () => {
    expect(maxForLevel({ '3': 3 }, 3)).toBe(3);
  });

  it('picks highest key that does not exceed level: { "1":2,"3":3,"6":4 } at L5 → 3', () => {
    expect(maxForLevel({ '1': 2, '3': 3, '6': 4 }, 5)).toBe(3);
  });

  it('handles level beyond all keys: { "5": 5 } at L20 → 5', () => {
    expect(maxForLevel({ '5': 5 }, 20)).toBe(5);
  });

  it('empty map → 0', () => {
    expect(maxForLevel({}, 5)).toBe(0);
  });
});

describe('buildClassFeatureDetails', () => {
  it('returns empty array when featureIds is empty (no DB call)', async () => {
    const result = await buildClassFeatureDetails([]);
    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('includes resourcePool when feature has a pool', async () => {
    const mockFeature = {
      id: 'f1', name: 'Ki', featureType: 'RESOURCE_POOL', mechanicsJson: null,
      actionType: null, implemented: false, level: 2, subclass: null,
      description: 'Harness mystic energy', icon: '☯️',
      resourcePool: { poolKey: 'ki', maxByLevel: { '2': 2, '3': 3 }, resetOn: 'SHORT_REST', dieSize: null },
    };
    mockFindMany.mockResolvedValue([mockFeature] as never);

    const result = await buildClassFeatureDetails(['f1']);

    expect(result[0].resourcePool).toBeDefined();
    expect(result[0].resourcePool?.poolKey).toBe('ki');
  });

  it('resourcePool is null for non-RESOURCE_POOL features', async () => {
    const mockFeature = {
      id: 'f2', name: 'Second Wind', featureType: 'ACTIVE_ABILITY', mechanicsJson: null,
      actionType: 'BONUS_ACTION', implemented: true, level: 1, subclass: null,
      description: 'Heal yourself', icon: '💨',
      resourcePool: null,
    };
    mockFindMany.mockResolvedValue([mockFeature] as never);

    const result = await buildClassFeatureDetails(['f2']);

    expect(result[0].resourcePool).toBeNull();
  });

  it('orders results by level ascending', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'f1', level: 2, resourcePool: null, name: 'Ki', featureType: 'RESOURCE_POOL', mechanicsJson: null, actionType: null, implemented: false, subclass: null, description: '', icon: '☯️' },
      { id: 'f2', level: 1, resourcePool: null, name: 'Second Wind', featureType: 'ACTIVE_ABILITY', mechanicsJson: null, actionType: null, implemented: true, subclass: null, description: '', icon: '💨' },
    ] as never);

    const result = await buildClassFeatureDetails(['f1', 'f2']);

    expect(result[0].level).toBe(2);
    expect(result[1].level).toBe(1);
  });

  it('includes all required fields', async () => {
    const mockFeature = {
      id: 'f1', name: 'Ki', featureType: 'RESOURCE_POOL', mechanicsJson: null,
      actionType: null, implemented: false, level: 2, subclass: null,
      description: 'Harness mystic energy', icon: '☯️',
      resourcePool: { poolKey: 'ki', maxByLevel: { '2': 2 }, resetOn: 'SHORT_REST', dieSize: null },
    };
    mockFindMany.mockResolvedValue([mockFeature] as never);

    const result = await buildClassFeatureDetails(['f1']);
    const f = result[0];

    expect(f).toHaveProperty('id');
    expect(f).toHaveProperty('name');
    expect(f).toHaveProperty('featureType');
    expect(f).toHaveProperty('mechanicsJson');
    expect(f).toHaveProperty('actionType');
    expect(f).toHaveProperty('implemented');
    expect(f).toHaveProperty('level');
    expect(f).toHaveProperty('subclass');
    expect(f).toHaveProperty('description');
    expect(f).toHaveProperty('icon');
    expect(f).toHaveProperty('resourcePool');
  });
});
