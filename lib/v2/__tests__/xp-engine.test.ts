import { describe, it, expect, vi } from 'vitest';
import { awardCombatXp, applyXpAward } from '../xp-helpers';
import { XP_THRESHOLDS } from '@/lib/xp';

// ─── makeTx ──────────────────────────────────────────────────────────────────

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    messageLog: { create: vi.fn().mockResolvedValue({}) },
    character: { update: vi.fn().mockResolvedValue({}) },
    classProgression: { findUnique: vi.fn().mockResolvedValue({ featuresUnlocked: [] }) },
    classFeature: { findMany: vi.fn().mockResolvedValue([]) },
    featureResourcePool: { findUnique: vi.fn().mockResolvedValue(null) },
    characterResourceState: { upsert: vi.fn().mockResolvedValue({}) },
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeChar(overrides: Partial<{
  id: string; characterClass: string; baseConstitution: number;
  xp: number; level: number; currentHp: number; maxHp: number;
  pendingChoicesQueue: unknown[]; featuresUnlocked: string[];
}> = {}) {
  return {
    id: 'char-1', characterClass: 'Fighter', baseConstitution: 14,
    xp: 0, level: 1, currentHp: 12, maxHp: 12,
    pendingChoicesQueue: [], featuresUnlocked: [],
    ...overrides,
  };
}

// ─── awardCombatXp ───────────────────────────────────────────────────────────

describe('awardCombatXp', () => {
  it('single enemy 50 → 50', () => {
    expect(awardCombatXp([{ xpValue: 50 }])).toBe(50);
  });

  it('single enemy 200 → 200', () => {
    expect(awardCombatXp([{ xpValue: 200 }])).toBe(200);
  });

  it('three enemies sums correctly', () => {
    expect(awardCombatXp([{ xpValue: 50 }, { xpValue: 100 }, { xpValue: 200 }])).toBe(350);
  });

  it('enemy with xpValue 0 → 0', () => {
    expect(awardCombatXp([{ xpValue: 0 }])).toBe(0);
  });

  it('empty array → 0', () => {
    expect(awardCombatXp([])).toBe(0);
  });
});

// ─── applyXpAward — no level-up ──────────────────────────────────────────────

describe('applyXpAward — no level-up', () => {
  it('200 XP + 50 award → stays L1', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 200, level: 1 });
    const result = await applyXpAward(tx, char, 50, 'test', 'room-1');
    expect(result.newXp).toBe(250);
    expect(result.newLevel).toBe(1);
    expect(result.leveledUp).toBe(false);
    expect(result.levelsGained).toEqual([]);
    expect(tx.character.update).toHaveBeenCalledTimes(1);
    expect(tx.messageLog.create).toHaveBeenCalledTimes(1); // xp_gained only
  });

  it('0 XP award → no-op, no MessageLog written', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 200, level: 1 });
    const result = await applyXpAward(tx, char, 0, 'test', 'room-1');
    expect(result.newXp).toBe(200);
    expect(result.leveledUp).toBe(false);
    expect(tx.messageLog.create).not.toHaveBeenCalled();
    expect(tx.character.update).not.toHaveBeenCalled();
  });
});

// ─── applyXpAward — level-up ─────────────────────────────────────────────────

describe('applyXpAward — level-up', () => {
  it('250 XP + 100 → level-up to L2, no pending choice at L2', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 250, level: 1 });
    const result = await applyXpAward(tx, char, 100, 'test', 'room-1');
    expect(result.newXp).toBe(350);
    expect(result.newLevel).toBe(2);
    expect(result.leveledUp).toBe(true);
    expect(result.levelsGained).toEqual([2]);
    // xp_gained + level_up MessageLog entries
    expect(tx.messageLog.create).toHaveBeenCalledTimes(2);
  });

  it('exact threshold: xp=299, award 1 → reaches L2', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 299, level: 1 });
    const result = await applyXpAward(tx, char, 1, 'test', 'room-1');
    expect(result.newLevel).toBe(2);
    expect(result.leveledUp).toBe(true);
  });

  it('reaches L20 cap: xp=354900, award 200 → stays at 355000, no beyond-20', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 354900, level: 19 });
    const result = await applyXpAward(tx, char, 200, 'test', 'room-1');
    expect(result.newXp).toBe(XP_THRESHOLDS[XP_THRESHOLDS.length - 1]);
    expect(result.newLevel).toBe(20);
  });

  it('at L20 cap: award XP → no level-up, XP does not exceed cap', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 355000, level: 20 });
    const result = await applyXpAward(tx, char, 500, 'test', 'room-1');
    expect(result.newXp).toBe(355000);
    expect(result.leveledUp).toBe(false);
  });

  it('downed character (currentHp=0) gets level-up but currentHp stays 0', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 250, level: 1, currentHp: 0, maxHp: 12 });
    await applyXpAward(tx, char, 100, 'test', 'room-1');
    const updateCall = tx.character.update.mock.calls[0][0];
    expect(updateCall.data.currentHp).toBe(0);
    expect(updateCall.data.maxHp).toBeGreaterThan(12);
  });
});

// ─── applyXpAward — pending choices ──────────────────────────────────────────

describe('applyXpAward — pending choices (Fighter)', () => {
  it('xp=0, award 900 → L3 reached, subclass choice queued', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 0, level: 1 });
    const result = await applyXpAward(tx, char, 900, 'test', 'room-1');
    expect(result.newLevel).toBe(3);
    const updateCall = tx.character.update.mock.calls[0][0];
    expect(updateCall.data.pendingChoicesQueue).toContainEqual({ type: 'subclass', level: 3 });
  });

  it('multi-level jump L1→L4: pendingChoicesQueue sorted ascending (subclass L3 before ASI L4)', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 0, level: 1 });
    const result = await applyXpAward(tx, char, 2800, 'test', 'room-1');
    expect(result.newLevel).toBe(4);
    const updateCall = tx.character.update.mock.calls[0][0];
    const queue = updateCall.data.pendingChoicesQueue as Array<{ type: string; level: number }>;
    expect(queue.length).toBe(2);
    expect(queue[0].level).toBeLessThan(queue[1].level);
    expect(queue[0]).toEqual({ type: 'subclass', level: 3 });
    expect(queue[1]).toEqual({ type: 'asi', level: 4 });
  });

  it('multi-level jump writes level_up MessageLog entries in ascending order', async () => {
    const tx = makeTx();
    const char = makeChar({ xp: 0, level: 1 });
    await applyXpAward(tx, char, 2800, 'test', 'room-1');
    const levelUpCalls = tx.messageLog.create.mock.calls
      .map((c: [{ data: { mechanicalSummary: { type: string; newLevel?: number } } }]) => c[0].data.mechanicalSummary)
      .filter((ms: { type: string }) => ms.type === 'level_up');
    const levels = levelUpCalls.map((ms: { newLevel: number }) => ms.newLevel);
    expect(levels).toEqual([...levels].sort((a: number, b: number) => a - b));
  });
});
