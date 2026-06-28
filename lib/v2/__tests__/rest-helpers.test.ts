import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    character: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    characterResourceState: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    featureResourcePool: {
      findMany: vi.fn(),
    },
  },
}));

import { applyShortRest, applyLongRest, checkAutoLongRest } from '../rest-helpers';
import { prisma } from '@/lib/prisma';

const mockPrisma = vi.mocked(prisma);

function makeTx() {
  return {
    featureResourcePool: mockPrisma.featureResourcePool,
    character: mockPrisma.character,
    characterResourceState: mockPrisma.characterResourceState,
  } as unknown as Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyShortRest', () => {
  it('restores a short-rest pool that is below max', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'ki', maxByLevel: { '2': 2, '3': 3 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 3,
      resourceStates: [{ poolKey: 'ki', current: 1 }],
    } as never);

    const result = await applyShortRest(makeTx(), 'char-1');

    expect(result).toEqual(['ki']);
    expect(mockPrisma.characterResourceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { current: 3 },
    }));
  });

  it('does not restore a pool that is already at max', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'ki', maxByLevel: { '2': 2 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 2,
      resourceStates: [{ poolKey: 'ki', current: 2 }],
    } as never);

    const result = await applyShortRest(makeTx(), 'char-1');

    expect(result).toEqual([]);
    expect(mockPrisma.characterResourceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: {},
    }));
  });

  it('creates the state row via upsert when it is missing', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'ki', maxByLevel: { '2': 2 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 2,
      resourceStates: [],
    } as never);

    await applyShortRest(makeTx(), 'char-1');

    expect(mockPrisma.characterResourceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { characterId: 'char-1', poolKey: 'ki', current: 2 },
    }));
  });

  it('ignores long-rest pools', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 2,
      resourceStates: [{ poolKey: 'rage', current: 1 }],
    } as never);

    const result = await applyShortRest(makeTx(), 'char-1');

    expect(result).toEqual([]);
    expect(mockPrisma.characterResourceState.upsert).not.toHaveBeenCalled();
  });

  it('returns the list of restored poolKeys', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'ki', maxByLevel: { '2': 2 } } as never,
      { poolKey: 'wild_shape', maxByLevel: { '2': 2 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 2,
      resourceStates: [
        { poolKey: 'ki', current: 0 },
        { poolKey: 'wild_shape', current: 1 },
      ],
    } as never);

    const result = await applyShortRest(makeTx(), 'char-1');

    expect(result).toContain('ki');
    expect(result).toContain('wild_shape');
    expect(result).toHaveLength(2);
  });
});

describe('applyLongRest', () => {
  it('restores all pools to max', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'rage', maxByLevel: { '1': 2, '3': 3 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 3, maxHp: 30,
      resourceStates: [{ poolKey: 'rage', current: 0 }],
    } as never);

    await applyLongRest(makeTx(), 'char-1');

    expect(mockPrisma.characterResourceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { current: 3 },
    }));
  });

  it('restores HP to maxHp', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 1, maxHp: 20, resourceStates: [],
    } as never);

    await applyLongRest(makeTx(), 'char-1');

    expect(vi.mocked(mockPrisma.character.update)).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentHp: 20 }) }),
    );
  });

  it('upserts state rows that were missing (creates them at max)', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([
      { poolKey: 'bardic_inspiration', maxByLevel: { '1': 3 } } as never,
    ]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 1, maxHp: 10, resourceStates: [],
    } as never);

    await applyLongRest(makeTx(), 'char-1');

    expect(mockPrisma.characterResourceState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { characterId: 'char-1', poolKey: 'bardic_inspiration', current: 3 },
      update: { current: 3 },
    }));
  });

  it('handles a character with no pools without crashing', async () => {
    vi.mocked(mockPrisma.featureResourcePool.findMany).mockResolvedValue([]);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      level: 1, maxHp: 10, resourceStates: [],
    } as never);

    await expect(applyLongRest(makeTx(), 'char-1')).resolves.toBeUndefined();
    expect(mockPrisma.characterResourceState.upsert).not.toHaveBeenCalled();
  });
});

describe('checkAutoLongRest', () => {
  it('returns true when lastLongRest is null', async () => {
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      lastLongRest: null,
    } as never);

    const result = await checkAutoLongRest('char-1');
    expect(result).toBe(true);
  });

  it('returns true when lastLongRest was more than 8h ago', async () => {
    const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      lastLongRest: nineHoursAgo,
    } as never);

    const result = await checkAutoLongRest('char-1');
    expect(result).toBe(true);
  });

  it('returns false when lastLongRest was less than 8h ago', async () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    vi.mocked(mockPrisma.character.findUniqueOrThrow).mockResolvedValue({
      lastLongRest: oneHourAgo,
    } as never);

    const result = await checkAutoLongRest('char-1');
    expect(result).toBe(false);
  });
});
