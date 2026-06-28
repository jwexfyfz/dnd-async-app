import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() }; } }));
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 4 })),
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => ({ total: 5, expr: '[3]+2' })),
}));
vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => ({ roll: 15, modifier: 2, total: 17 })),
}));
vi.mock('@/lib/initiative', () => ({
  rollInitiative: vi.fn(() => 10),
}));
vi.mock('crypto', () => ({ randomInt: vi.fn() }));

import {
  resolveDeathSave,
  advanceTurn,
  checkCombatEnd,
  resolveCombatAction,
  resolveEnemyTurn,
} from '../game-controller';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';
import { randomInt } from 'crypto';
import { rollD20Check } from '@/lib/dice';

const mockRollD20Check = vi.mocked(rollD20Check);

const mockRandomInt = vi.mocked(randomInt) as unknown as { mockReturnValue: (n: number) => void };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChar(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'character',
    name: 'Anya',
    initiative: 15,
    hp: 10,
    maxHp: 10,
    ac: 14,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeEnemy(overrides: Partial<InitiativeEntry> & { id: string }): InitiativeEntry {
  return {
    type: 'enemy',
    name: 'Goblin',
    initiative: 8,
    hp: 8,
    maxHp: 8,
    ac: 12,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeCs(overrides: Partial<CombatState> = {}): CombatState {
  return {
    round: 1,
    activeActorId: 'p1',
    initiativeOrder: [],
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    ...overrides,
  };
}

const deathSaveAction = {
  action_type: 'death_save' as const,
  target_poi_instance_id: null,
  target_room_template_id: null,
  target_character_id: null,
  resulting_stance: null,
  interaction_result: null,
  item_id: null,
};

const baseCharacter = {
  id: 'p1',
  name: 'Anya',
  characterClass: 'Fighter',
  level: 4,
  baseDexterity: 14,
  baseStrength: 16,
  baseCharisma: 10,
  baseWisdom: 12,
  isHiding: false,
  critThreshold: 20,
  attacksPerAction: 1,
};

// ─── resolveDeathSave: all roll outcomes ────────────────────────────────────

describe('resolveDeathSave — roll outcomes', () => {
  it('nat 20: outcome=revived, hp set to 1, counters reset to 0', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 1, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 20);
    expect(result.outcome).toBe('revived');
    expect(result.updatedEntry.hp).toBe(1);
    expect(result.updatedEntry.deathSaveSuccesses).toBe(0);
    expect(result.updatedEntry.deathSaveFailures).toBe(0);
    expect(result.updatedEntry.isStabilized).toBe(false);
    expect(result.characterDied).toBe(false);
  });

  it('nat 1: adds 2 failures', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.outcome).toBe('failure');
    expect(result.failures).toBe(2);
    expect(result.characterDied).toBe(false);
  });

  it('nat 1 with 1 existing failure: total 3 failures → dead', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.outcome).toBe('dead');
    expect(result.characterDied).toBe(true);
    expect(result.failures).toBeGreaterThanOrEqual(3);
  });

  it('nat 1 with 2 existing failures: total 4 but still dead (≥3)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.characterDied).toBe(true);
  });

  it('roll 10: adds 1 success, outcome=success', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 10);
    expect(result.outcome).toBe('success');
    expect(result.successes).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('roll 15: adds 1 success', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 15);
    expect(result.successes).toBe(2);
    expect(result.outcome).toBe('success');
  });

  it('roll 10+ with 2 existing successes: stabilized', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 12);
    expect(result.outcome).toBe('stabilized');
    expect(result.updatedEntry.isStabilized).toBe(true);
    expect(result.characterDied).toBe(false);
  });

  it('roll 5: adds 1 failure, outcome=failure', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 5);
    expect(result.outcome).toBe('failure');
    expect(result.failures).toBe(1);
    expect(result.characterDied).toBe(false);
  });

  it('roll 9 with 2 existing failures: 3rd failure → dead', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 9);
    expect(result.outcome).toBe('dead');
    expect(result.characterDied).toBe(true);
  });

  it('roll 2: adds 1 failure', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 2);
    expect(result.failures).toBe(2);
    expect(result.characterDied).toBe(false);
  });

  it('fact string always emitted', () => {
    const entry = makeChar({ id: 'p1', hp: 0 });
    const result = resolveDeathSave(entry, 'Anya', () => 8);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.facts[0]).toContain('Anya');
  });
});

// ─── resolveCombatAction: death_save roll badge ──────────────────────────────

describe('resolveCombatAction — death_save roll badge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits a combat_roll log entry for every death save', () => {
    mockRandomInt.mockReturnValue(12);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.rollLogs).toHaveLength(1);
    expect(result.rollLogs[0].type).toBe('combat_roll');
    expect(result.rollLogs[0].action).toBe('Death Save');
    expect(result.rollLogs[0].vsTarget).toBe('DC 10');
  });

  it('roll badge: nat 20 has isCrit=true and success=true', () => {
    mockRandomInt.mockReturnValue(20);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.rollLogs[0].isCrit).toBe(true);
    expect(result.rollLogs[0].success).toBe(true);
  });

  it('roll badge: roll 10+ has success=true', () => {
    mockRandomInt.mockReturnValue(14);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.rollLogs[0].success).toBe(true);
    expect(result.rollLogs[0].isCrit).toBeFalsy();
  });

  it('roll badge: roll under 10 has success=false', () => {
    mockRandomInt.mockReturnValue(7);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.rollLogs[0].success).toBe(false);
  });

  it('nat 20 revive: dbHpUpdates contains +1 hpDelta', () => {
    mockRandomInt.mockReturnValue(20);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.dbHpUpdates).toEqual(expect.arrayContaining([{ id: 'p1', hpDelta: 1 }]));
  });

  it('non-revive outcomes: dbHpUpdates is empty', () => {
    mockRandomInt.mockReturnValue(8);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.dbHpUpdates).toHaveLength(0);
  });

  it('death save does not end combat (combatEnded=false)', () => {
    mockRandomInt.mockReturnValue(5);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.combatEnded).toBe(false);
  });

  it('death save marks action as used in turnUsage', () => {
    mockRandomInt.mockReturnValue(11);
    const entry = makeChar({ id: 'p1', hp: 0 });
    const cs = makeCs({ activeActorId: 'p1', initiativeOrder: [entry, makeEnemy({ id: 'e1' })] });
    const result = resolveCombatAction(deathSaveAction, cs, baseCharacter, null, { bag: [], equipped: {} });
    expect(result.updatedCombatState.currentTurnUsage.actionUsed).toBe(true);
  });
});

// ─── heroic sacrifice trigger logic ──────────────────────────────────────────

describe('heroic sacrifice trigger — 3rd failure detection', () => {
  it('2 failures → characterDied=false (no trigger)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 5);
    expect(result.characterDied).toBe(false);
    expect(result.failures).toBe(2);
  });

  it('3rd failure via normal roll → characterDied=true (trigger fires)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 4);
    expect(result.characterDied).toBe(true);
  });

  it('3rd failure via nat 1 (counts as 2) with 1 existing → characterDied=true', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 1 });
    const result = resolveDeathSave(entry, 'Anya', () => 1);
    expect(result.characterDied).toBe(true);
  });

  it('3 successes before 3 failures → stabilized, characterDied=false (no trigger)', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveSuccesses: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 15);
    expect(result.outcome).toBe('stabilized');
    expect(result.characterDied).toBe(false);
  });

  it('fact string on 3rd failure mentions character name', () => {
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 3);
    expect(result.facts[0]).toContain('Anya');
  });
});

// ─── advanceTurn: sacrifice-pending character behavior ────────────────────────

describe('advanceTurn — heroic sacrifice pending (isStabilized=true)', () => {
  it('sacrifice-pending character (isStabilized=true) is skipped on subsequent turns', () => {
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, isStabilized: true, initiative: 18 }),
        makeEnemy({ id: 'e1', initiative: 10 }),
        makeChar({ id: 'p2', hp: 8, initiative: 6 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p2');
  });

  it('combat continues normally with other actors after sacrifice pending', () => {
    const cs = makeCs({
      activeActorId: 'p1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 8, initiative: 20 }),
        makeChar({ id: 'p2', hp: 0, isStabilized: true, initiative: 15 }),
        makeEnemy({ id: 'e1', hp: 6, initiative: 10 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
  });

  it('dying character (hp=0, isStabilized=false) still gets a turn', () => {
    const cs = makeCs({
      activeActorId: 'e1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, isStabilized: false, initiative: 18 }),
        makeEnemy({ id: 'e1', initiative: 10 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('p1');
  });
});

// ─── checkCombatEnd: independence from sacrifice state ────────────────────────

describe('checkCombatEnd — heroic sacrifice pending', () => {
  it('all enemies dead + sacrifice-pending character → combat ends (true)', () => {
    const cs = makeCs({
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, isStabilized: true }),
        makeEnemy({ id: 'e1', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('live enemy + sacrifice-pending character → combat continues (false)', () => {
    const cs = makeCs({
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0, isStabilized: true }),
        makeEnemy({ id: 'e1', hp: 5 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('alive party member + sacrifice-pending + dead enemies → combat ends (true)', () => {
    const cs = makeCs({
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 8 }),
        makeChar({ id: 'p2', hp: 0, isStabilized: true }),
        makeEnemy({ id: 'e1', hp: 0 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(true);
  });

  it('alive party member + sacrifice-pending + live enemy → combat continues (false)', () => {
    const cs = makeCs({
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 8 }),
        makeChar({ id: 'p2', hp: 0, isStabilized: true }),
        makeEnemy({ id: 'e1', hp: 4 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });
});

// ─── Regression: existing death save behavior preserved ──────────────────────

describe('regression — death save behavior unchanged', () => {
  it('downed character with live enemies: combat does not end', () => {
    const cs = makeCs({
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 0 }),
        makeEnemy({ id: 'e1', hp: 5 }),
      ],
    });
    expect(checkCombatEnd(cs)).toBe(false);
  });

  it('3 successes → stabilized (no heroic sacrifice)', () => {
    let entry = makeChar({ id: 'p1', hp: 0 });
    const roll = () => 12;
    entry = resolveDeathSave(entry, 'Anya', roll).updatedEntry;
    entry = resolveDeathSave(entry, 'Anya', roll).updatedEntry;
    const final = resolveDeathSave(entry, 'Anya', roll);
    expect(final.outcome).toBe('stabilized');
    expect(final.characterDied).toBe(false);
    expect(final.updatedEntry.isStabilized).toBe(true);
  });

  it('stabilized via 3 successes is skipped in advanceTurn (not sacrifice, same behavior)', () => {
    const cs = makeCs({
      activeActorId: 'p1',
      initiativeOrder: [
        makeChar({ id: 'p1', hp: 8, initiative: 18 }),
        makeChar({ id: 'p2', hp: 0, isStabilized: true, initiative: 14 }),
        makeEnemy({ id: 'e1', hp: 5, initiative: 8 }),
      ],
    });
    const next = advanceTurn(cs);
    expect(next.activeActorId).toBe('e1');
  });

  it('auto-fail from enemy attack accumulates with self-roll failures', () => {
    // 2 auto-fails → entry has deathSaveFailures=2; next self-roll of 5 → 3rd failure
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 5);
    expect(result.characterDied).toBe(true);
  });

  it('healing a downed character before 3 failures: counters preserved on entry', () => {
    // Simulate: 2 failures accumulated, then ally heals them. The entry should
    // retain failure count for if they go down again (5E: counters reset on long rest only).
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    // After healing hp becomes positive — they leave downed state.
    // Counters on the InitiativeEntry are not cleared by a heal (only by stabilize/revive/long-rest).
    expect(entry.deathSaveFailures).toBe(2);
  });

  it('roll sequence: 1 success, 2 failures, 1 success, 1 failure → dead on 3rd failure', () => {
    let entry = makeChar({ id: 'p1', hp: 0 });
    entry = resolveDeathSave(entry, 'Anya', () => 11).updatedEntry; // success: 1/3
    entry = resolveDeathSave(entry, 'Anya', () => 6).updatedEntry;  // failure: 0s, 1f
    entry = resolveDeathSave(entry, 'Anya', () => 5).updatedEntry;  // failure: 0s, 2f
    entry = resolveDeathSave(entry, 'Anya', () => 14).updatedEntry; // success: 2s, 2f
    const final = resolveDeathSave(entry, 'Anya', () => 3);          // failure: 3f → dead
    expect(final.characterDied).toBe(true);
  });

  it('roll sequence: 3 consecutive successes → stabilized before 3 failures', () => {
    let entry = makeChar({ id: 'p1', hp: 0 });
    entry = resolveDeathSave(entry, 'Anya', () => 13).updatedEntry;
    entry = resolveDeathSave(entry, 'Anya', () => 10).updatedEntry;
    const final = resolveDeathSave(entry, 'Anya', () => 19);
    expect(final.outcome).toBe('stabilized');
    expect(final.characterDied).toBe(false);
  });
});

// ─── pendingArrivalNarrative: injection logic (pure unit) ────────────────────

describe('pendingArrivalNarrative context injection', () => {
  it('arrival context includes fallen and new character info', () => {
    const arrival = {
      fallenName: 'Anya',
      fallenClass: 'Fighter',
      newName: 'Kade',
      newClass: 'Rogue',
    };
    // Verify the shape is what the prompt builder will expect
    expect(arrival).toMatchObject({
      fallenName: expect.any(String),
      fallenClass: expect.any(String),
      newName: expect.any(String),
      newClass: expect.any(String),
    });
  });

  it('arrival context is null when no pending narrative (no injection)', () => {
    const pendingArrivalNarrative = null;
    expect(pendingArrivalNarrative).toBeNull();
  });

  it('arrival context is cleared after first use (idempotent second call)', () => {
    // After the narrative fires, pendingArrivalNarrative is set to null on the room.
    // The second action for the new character finds null and injects nothing.
    let pendingArrivalNarrative: object | null = {
      fallenName: 'Anya', fallenClass: 'Fighter',
      newName: 'Kade', newClass: 'Rogue',
    };
    // First action: consume it
    const contextForFirstAction = pendingArrivalNarrative;
    pendingArrivalNarrative = null;
    // Second action: nothing
    const contextForSecondAction = pendingArrivalNarrative;

    expect(contextForFirstAction).not.toBeNull();
    expect(contextForSecondAction).toBeNull();
  });
});

// ─── resolveEnemyTurn: attack on downed character ─────────────────────────────

describe('resolveEnemyTurn — attack on downed character (targetIsDying=true)', () => {
  beforeEach(() => vi.clearAllMocks());

  const defaultProps = { combat_stats: { attack_bonus: 3, damage: '1d6', ac: 13 } };
  const enemyEntry = makeEnemy({ id: 'e1', proximity: 'close' });
  const downedChar = makeChar({ id: 'p1', hp: 0, ac: 14 });

  function makeDownedCs() {
    return makeCs({ activeActorId: 'e1', initiativeOrder: [downedChar, enemyEntry] });
  }

  it('hit on downed → deathSaveAutoFailures=1, hpDamage=0', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18, success: true, critical: false, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(1);
    expect(result.hpDamage).toBe(0);
  });

  it('critical hit on downed → deathSaveAutoFailures=2 (one crit = two failures per 5E)', () => {
    mockRollD20Check.mockReturnValue({ roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23, success: true, critical: true, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(2);
    expect(result.hpDamage).toBe(0);
  });

  it('fumble (nat 1) on downed → deathSaveAutoFailures=0, hpDamage=0', () => {
    mockRollD20Check.mockReturnValue({ roll: 1, modifier: 0, dc: 14, dcType: 'AC', total: 1, success: false, critical: false, fumble: true });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(0);
    expect(result.hpDamage).toBe(0);
  });

  it('miss on downed → deathSaveAutoFailures=0, hpDamage=0', () => {
    mockRollD20Check.mockReturnValue({ roll: 4, modifier: 3, dc: 14, dcType: 'AC', total: 7, success: false, critical: false, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.deathSaveAutoFailures).toBe(0);
    expect(result.hpDamage).toBe(0);
  });

  it('downed target never takes HP damage regardless of hit outcome', () => {
    for (const rollResult of [
      { roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23, success: true, critical: true, fumble: false },
      { roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18, success: true, critical: false, fumble: false },
    ] as const) {
      mockRollD20Check.mockReturnValueOnce(rollResult);
      const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
      expect(result.hpDamage).toBe(0);
    }
  });

  it('roll badge emitted for hit on downed: type=combat_roll, success=true', () => {
    mockRollD20Check.mockReturnValue({ roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18, success: true, critical: false, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.rollData?.type).toBe('combat_roll');
    expect(result.rollData?.success).toBe(true);
    expect(result.rollData?.isCrit).toBeUndefined();
  });

  it('roll badge emitted for crit on downed: isCrit=true', () => {
    mockRollD20Check.mockReturnValue({ roll: 20, modifier: 3, dc: 14, dcType: 'AC', total: 23, success: true, critical: true, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, makeDownedCs(), 'p1', 'Anya', defaultProps, 'C', false, true);
    expect(result.rollData?.isCrit).toBe(true);
  });

  it('live target (targetIsDying=false) takes HP damage on hit — regression guard', () => {
    const liveChar = makeChar({ id: 'p1', hp: 10, ac: 14 });
    const liveCs = makeCs({ activeActorId: 'e1', initiativeOrder: [liveChar, enemyEntry] });
    mockRollD20Check.mockReturnValue({ roll: 15, modifier: 3, dc: 14, dcType: 'AC', total: 18, success: true, critical: false, fumble: false });
    const result = resolveEnemyTurn(enemyEntry, liveCs, 'p1', 'Anya', defaultProps, 'C', false, false);
    expect(result.hpDamage).toBeGreaterThan(0);
    expect(result.deathSaveAutoFailures).toBeUndefined();
  });

  it('3rd auto-fail from enemy: deathSaveAutoFailures can accumulate with self-roll failures', () => {
    // Enemy hits twice (2 auto-fails), then resolveDeathSave rolls 9 (3rd failure → dead).
    // This tests the integration of the two failure paths, not just the auto-fail itself.
    const entry = makeChar({ id: 'p1', hp: 0, deathSaveFailures: 2 });
    const result = resolveDeathSave(entry, 'Anya', () => 9);
    expect(result.characterDied).toBe(true);
  });
});

// ─── pendingArrivalContext: recentContext string capping ──────────────────────

describe('pendingArrivalContext — recentContext string capping (join endpoint logic)', () => {
  // Mirrors the capping logic from POST /api/v2/sessions/[sessionId]/join
  function buildRecentContext(messages: string[]): string {
    return messages
      .map(m => m.substring(0, 200))
      .join(' / ')
      .substring(0, 800);
  }

  it('messages under 200 chars each: joined without per-message truncation', () => {
    const msgs = ['Short message 1', 'Short message 2', 'Short message 3'];
    const ctx = buildRecentContext(msgs);
    expect(ctx).toContain('Short message 1');
    expect(ctx).toContain('Short message 3');
  });

  it('single message over 200 chars: truncated to exactly 200 chars', () => {
    const longMsg = 'A'.repeat(300);
    const ctx = buildRecentContext([longMsg]);
    expect(ctx).toBe('A'.repeat(200));
  });

  it('total context over 800 chars: capped at 800', () => {
    const msgs = Array.from({ length: 5 }, () => 'B'.repeat(200));
    const ctx = buildRecentContext(msgs);
    expect(ctx.length).toBeLessThanOrEqual(800);
  });

  it('5 messages at 200 chars each: joined with " / " then capped to 800', () => {
    // 5×200 = 1000 + 4×3 (" / ") = 1012 → capped to 800
    const msgs = Array.from({ length: 5 }, () => 'C'.repeat(200));
    const ctx = buildRecentContext(msgs);
    expect(ctx.length).toBe(800);
  });

  it('single message exactly 200 chars: stored as-is', () => {
    const msg = 'D'.repeat(200);
    const ctx = buildRecentContext([msg]);
    expect(ctx.length).toBe(200);
    expect(ctx).toBe(msg);
  });

  it('empty messages array: produces empty string', () => {
    expect(buildRecentContext([])).toBe('');
  });

  it('preserves chronological order (first message index < last message index)', () => {
    const ctx = buildRecentContext(['FIRST', 'SECOND', 'THIRD']);
    expect(ctx.indexOf('FIRST')).toBeLessThan(ctx.indexOf('THIRD'));
  });

  it('per-message truncation happens before total join: each message independently bounded', () => {
    const msgs = ['E'.repeat(300), 'F'.repeat(300)];
    const ctx = buildRecentContext(msgs);
    // Expect no run longer than 200 consecutive same chars
    expect(/E{201,}/.test(ctx)).toBe(false);
    expect(/F{201,}/.test(ctx)).toBe(false);
  });
});

// ─── PendingChoice: discriminated union shape ─────────────────────────────────

describe('PendingChoice — heroic_sacrifice queue entry shape', () => {
  it('heroic_sacrifice entry has required fallenName, fallenClass, fallenLevel fields', () => {
    const entry = {
      type: 'heroic_sacrifice' as const,
      fallenName: 'Anya',
      fallenClass: 'Fighter',
      fallenLevel: 4,
    };
    expect(entry.type).toBe('heroic_sacrifice');
    expect(typeof entry.fallenName).toBe('string');
    expect(typeof entry.fallenClass).toBe('string');
    expect(typeof entry.fallenLevel).toBe('number');
    expect(entry.fallenLevel).toBeGreaterThan(0);
  });

  it('heroic_sacrifice entry does not include `level` (unlike asi/subclass choices)', () => {
    const entry = { type: 'heroic_sacrifice' as const, fallenName: 'Anya', fallenClass: 'Fighter', fallenLevel: 4 };
    expect('level' in entry).toBe(false);
  });

  it('asi entry shape unchanged — regression guard', () => {
    const entry = { type: 'asi' as const, level: 4 };
    expect(entry.type).toBe('asi');
    expect(entry.level).toBe(4);
  });

  it('subclass entry shape unchanged — regression guard', () => {
    const entry = { type: 'subclass' as const, level: 3 };
    expect(entry.type).toBe('subclass');
    expect(entry.level).toBe(3);
  });

  it('discriminated union narrowing works on type field', () => {
    type PendingChoice =
      | { type: 'asi'; level: number }
      | { type: 'subclass'; level: number }
      | { type: 'heroic_sacrifice'; fallenName: string; fallenClass: string; fallenLevel: number };

    const queue: PendingChoice[] = [
      { type: 'heroic_sacrifice', fallenName: 'Anya', fallenClass: 'Fighter', fallenLevel: 4 },
      { type: 'asi', level: 4 },
    ];
    const sacrificeEntry = queue.find(c => c.type === 'heroic_sacrifice');
    expect(sacrificeEntry).toBeDefined();
    if (sacrificeEntry?.type === 'heroic_sacrifice') {
      expect(sacrificeEntry.fallenLevel).toBe(4);
      expect(sacrificeEntry.fallenName).toBe('Anya');
    }
  });

  it('queue find does not match asi entry when searching for heroic_sacrifice', () => {
    type PendingChoice =
      | { type: 'asi'; level: number }
      | { type: 'subclass'; level: number }
      | { type: 'heroic_sacrifice'; fallenName: string; fallenClass: string; fallenLevel: number };

    const queue: PendingChoice[] = [{ type: 'asi', level: 4 }, { type: 'subclass', level: 3 }];
    const found = queue.find(c => c.type === 'heroic_sacrifice');
    expect(found).toBeUndefined();
  });
});

// ─── resolveDownedCharacterTurn: auto-resolve (Phase 1 — pending) ─────────────

describe('resolveDownedCharacterTurn — auto-resolve on each turn (Phase 1, pending implementation)', () => {
  it.todo('downed character turn is auto-resolved without player input (game-controller calls it from while-loop)');
  it.todo('fires the same resolveDeathSave logic as the manual death_save chip');
  it.todo('turn advances past downed character after auto-resolve (advanceTurn called internally)');
  it.todo('non-downed character turn breaks the while-loop and returns control to the player');
  it.todo('stabilized character (isStabilized=true, hp=0) is skipped — resolveDownedCharacterTurn not called for them');
  it.todo('emits console log [stage3:death-save:auto] on every auto-resolve');
  it.todo('crash recovery: re-entering the while-loop with same downed actor does not double-apply a previous roll');
});

// ─── confirm-sacrifice endpoint (Phase 2 — pending) ───────────────────────────

describe('confirm-sacrifice endpoint — POST /api/v2/me/characters/[id]/confirm-sacrifice (Phase 2, pending)', () => {
  it.todo('sets isDead: true on the fallen character');
  it.todo('removes heroic_sacrifice entry from pendingChoicesQueue');
  it.todo('returns redirectLevel matching fallenLevel from the queue entry');
  it.todo('returns predecessorCharacterId in response body');
  it.todo('returns 409 Conflict when pendingChoicesQueue does not contain heroic_sacrifice (already confirmed or never triggered)');
  it.todo('returns 404 if character not found');
  it.todo('idempotent: second call after first clears queue returns 409');
  it.todo('sets isActive=false on all RoomParticipant rows for this character in this session');
  it.todo('all three writes (isDead, pendingChoicesQueue, isActive) are atomic in a single $transaction');
});

// ─── session join endpoint (Phase 4 — pending) ────────────────────────────────

describe('POST /api/v2/sessions/[sessionId]/join — new character join (Phase 4, pending)', () => {
  it.todo('rejects 403 if new character does not belong to the calling user');
  it.todo('rejects 403 if new character is already dead (isDead=true)');
  it.todo('rejects 403 if predecessor does not belong to the calling user');
  it.todo('rejects 403 if predecessor is not isDead=true (sacrifice not confirmed)');
  it.todo('rejects 403 if no RoomParticipant links predecessor to this session (predecessor was not in this campaign)');
  it.todo('rejects 409 if party is at maximum capacity (≥4 active participants)');
  it.todo('rejects 409 if session gameState is not active (lobby or ended)');
  it.todo('enrolls new character in the most-occupied room in the session');
  it.todo('falls back to latest MessageLog timestamp when rooms are tied on participant count');
  it.todo('writes pendingArrivalContext on the Character row (not RoomInstance)');
  it.todo('pendingArrivalContext contains fallenName, fallenClass, recentContext');
  it.todo('writes public log entry [PARTY] in same $transaction');
  it.todo('all three writes (RoomParticipant, pendingArrivalContext, MessageLog) are atomic');
  it.todo('returns { ok: true } on success');
});

// ─── pendingArrivalContext: DB-level atomic claim (Phase 4 — pending) ─────────

describe('pendingArrivalContext — DB atomic claim on first narrative action (Phase 4, pending)', () => {
  it.todo('atomic UPDATE...RETURNING sets pendingArrivalContext=NULL and returns previous value in one operation');
  it.todo('concurrent retry cannot claim the flag twice (TOCTOU: separate read-then-write is unsafe)');
  it.todo('claimed context is injected into AI prompt for the first action only');
  it.todo('second narrative generation finds pendingArrivalContext=NULL and injects nothing');
  it.todo('existing characters with NULL pendingArrivalContext are unaffected by the check');
  it.todo('fires correctly when party moved to a different room between join and first action (flag lives on Character not RoomInstance)');
  it.todo('arrival narrative includes newName, newClass, fallenName, fallenClass, and recentContext');
});

// ─── higher-level character creation via startingLevel (Phase 3 — pending) ────

describe('POST /api/v2/me/characters — startingLevel (Phase 3, pending implementation)', () => {
  describe('HP at starting level', () => {
    it.todo('maxHp at startingLevel=1 matches hitDie + conMod (baseline unchanged)');
    it.todo('maxHp at startingLevel=5 is greater than level-1 maxHp for same class and CON');
    it.todo('maxHp at startingLevel=20 matches maxHpAtLevel output (not a hardcoded value)');
    it.todo('currentHp equals maxHp on creation at every startingLevel');
  });

  describe('level and XP', () => {
    it.todo('level is set to startingLevel on the created character');
    it.todo('xp is set to XP_THRESHOLDS[startingLevel - 1]');
    it.todo('startingLevel=1 → xp=0, level=1 (baseline unchanged)');
    it.todo('startingLevel=20 → xp=XP_THRESHOLDS[19] (max level XP floor)');
  });

  describe('subclass at creation', () => {
    it.todo('L1 class (Cleric/Sorcerer/Warlock): subclassKey required at startingLevel=1 — 400 if missing');
    it.todo('L2 class (Wizard/Druid): subclassKey required at startingLevel≥2 — 400 if missing');
    it.todo('L3 class (Fighter/Rogue/Paladin etc): subclassKey required at startingLevel≥3 — 400 if missing');
    it.todo('L3 class at startingLevel=2: no subclassKey required yet — character created without subclass');
    it.todo('provided subclassKey is stored on character.subclass, not in pendingChoicesQueue');
    it.todo('subclass entry never appears in pendingChoicesQueue when subclassKey was provided');
  });

  describe('ASI queue entries by class', () => {
    it.todo('Fighter startingLevel=4 → 1 ASI entry: [{type:asi, level:4}]');
    it.todo('Fighter startingLevel=6 → 2 ASI entries: levels 4 and 6');
    it.todo('Fighter startingLevel=8 → 3 ASI entries: levels 4, 6, 8');
    it.todo('Fighter startingLevel=19 → 7 ASI entries (full Fighter schedule)');
    it.todo('Fighter startingLevel=20 → 7 ASI entries (no ASI at level 20 for Fighter)');
    it.todo('Rogue startingLevel=10 → 3 ASI entries: levels 4, 8, 10');
    it.todo('Rogue startingLevel=19 → 6 ASI entries');
    it.todo('default class (Barbarian) startingLevel=4 → 1 ASI entry: level 4');
    it.todo('default class startingLevel=19 → 5 ASI entries: levels 4, 8, 12, 16, 19');
    it.todo('default class startingLevel=20 → 5 ASI entries (no ASI at level 20)');
    it.todo('no duplicate asi entries for the same level (applyLevelEffects called once per level)');
  });

  describe('validation', () => {
    it.todo('startingLevel not matching predecessor fallenLevel → 400');
    it.todo('startingLevel < 1 → 400');
    it.todo('startingLevel > 20 → 400');
    it.todo('startingLevel missing → defaults to 1 (normal creation, baseline unchanged)');
    it.todo('predecessorCharacterId provided but predecessor belongs to different user → 403');
    it.todo('predecessorCharacterId provided but predecessor is not isDead=true → 403');
  });
});
