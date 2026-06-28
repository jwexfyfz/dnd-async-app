import { describe, it, expect } from 'vitest';
import { validateAsiChoices, computeConHpDelta } from '@/lib/v2/asi-helpers';

function makeChar(overrides: Partial<{
  baseStrength: number; baseDexterity: number; baseConstitution: number;
  baseIntelligence: number; baseWisdom: number; baseCharisma: number;
  pendingChoicesQueue: Array<{ type: string; level: number }>;
}> = {}) {
  return {
    baseStrength: 10, baseDexterity: 10, baseConstitution: 10,
    baseIntelligence: 10, baseWisdom: 10, baseCharisma: 10,
    pendingChoicesQueue: [{ type: 'asi', level: 4 }],
    ...overrides,
  };
}

describe('validateAsiChoices — happy path', () => {
  it('+1 STR, +1 DEX → valid', () => {
    expect(validateAsiChoices(makeChar(), { strength: 1, dexterity: 1 })).toBeNull();
  });

  it('+2 STR → valid', () => {
    expect(validateAsiChoices(makeChar(), { strength: 2 })).toBeNull();
  });

  it('+1 CON → valid', () => {
    expect(validateAsiChoices(makeChar(), { constitution: 1, strength: 1 })).toBeNull();
  });

  it('+2 CON → valid', () => {
    expect(validateAsiChoices(makeChar(), { constitution: 2 })).toBeNull();
  });

  it('stat at 19 + 1 → reaches 20 (valid)', () => {
    expect(validateAsiChoices(makeChar({ baseStrength: 19 }), { strength: 1, dexterity: 1 })).toBeNull();
  });

  it('two ASI levels queued — resolves first (queue[0] is ASI)', () => {
    const char = makeChar({ pendingChoicesQueue: [{ type: 'asi', level: 4 }, { type: 'asi', level: 8 }] });
    expect(validateAsiChoices(char, { strength: 2 })).toBeNull();
  });
});

describe('validateAsiChoices — unhappy path', () => {
  it('total !== 2 (0 points) → error', () => {
    expect(validateAsiChoices(makeChar(), {})).toMatch(/2/);
  });

  it('total !== 2 (3 points) → error', () => {
    expect(validateAsiChoices(makeChar(), { strength: 1, dexterity: 1, constitution: 1 })).toMatch(/2/);
  });

  it('stat raised to 21 → error', () => {
    expect(validateAsiChoices(makeChar({ baseStrength: 20 }), { strength: 1, dexterity: 1 })).toMatch(/exceed 20/);
  });

  it('pendingChoicesQueue[0].type === subclass → wrong branch error', () => {
    const char = makeChar({ pendingChoicesQueue: [{ type: 'subclass', level: 3 }] });
    expect(validateAsiChoices(char, { strength: 2 })).toMatch(/not an ASI/);
  });

  it('empty pendingChoicesQueue → error', () => {
    const char = makeChar({ pendingChoicesQueue: [] });
    expect(validateAsiChoices(char, { strength: 2 })).toMatch(/No pending/);
  });
});

// ─── HP delta calculation ─────────────────────────────────────────────────────

describe('CON HP delta', () => {
  it('CON 10→12 at L4: +1 mod → +4 HP', () => {
    expect(computeConHpDelta(10, 2, 4)).toBe(4);
  });

  it('CON 11→12 at L4: +1 mod → +4 HP', () => {
    expect(computeConHpDelta(11, 1, 4)).toBe(4);
  });

  it('CON 10→11 at L4: no mod change → 0 HP', () => {
    expect(computeConHpDelta(10, 1, 4)).toBe(0);
  });

  it('CON 12→13 at L4: no mod change → 0 HP', () => {
    expect(computeConHpDelta(12, 1, 4)).toBe(0);
  });

  it('downed character: currentHp stays 0', () => {
    const currentHp = 0;
    const hpDelta = computeConHpDelta(10, 2, 4); // +4
    const newCurrentHp = currentHp === 0 ? 0 : Math.min(currentHp + hpDelta, 12 + hpDelta);
    expect(newCurrentHp).toBe(0);
  });

  it('normal character: currentHp increases with CON', () => {
    const currentHp = 8;
    const maxHp = 12;
    const hpDelta = computeConHpDelta(10, 2, 4); // +4
    const newCurrentHp = Math.min(currentHp + hpDelta, maxHp + hpDelta);
    expect(newCurrentHp).toBe(12);
  });
});
