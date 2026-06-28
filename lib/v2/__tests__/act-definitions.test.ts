import { describe, it, expect } from 'vitest';
import { DUNGEON_ACTS } from '../act-definitions';

describe('DUNGEON_ACTS', () => {
  it('contains exactly 3 acts', () => {
    expect(DUNGEON_ACTS).toHaveLength(3);
  });

  it('acts are numbered 1, 2, 3 in order', () => {
    expect(DUNGEON_ACTS.map(a => a.act)).toEqual([1, 2, 3]);
  });

  it('each act has at least one completionFlag', () => {
    for (const act of DUNGEON_ACTS) {
      expect(act.completionFlags.length).toBeGreaterThan(0);
    }
  });

  it('act 1 has no onStartMutations (first room is default state)', () => {
    expect(DUNGEON_ACTS[0].onStartMutations).toHaveLength(0);
  });

  it('act 2 unlocks the Submerged Gate', () => {
    const act2 = DUNGEON_ACTS.find(a => a.act === 2)!;
    const gate = act2.onStartMutations.find(m =>
      m.poiTemplateId === '77000001-0000-0000-0000-000000000001',
    );
    expect(gate).toBeDefined();
    expect(gate!.setProps).toMatchObject({ unlocked: true });
  });

  it('act 2 completes when ritual_disrupted OR harwick_defeated', () => {
    const act2 = DUNGEON_ACTS.find(a => a.act === 2)!;
    expect(act2.completionFlags).toContain('ritual_disrupted');
    expect(act2.completionFlags).toContain('harwick_defeated');
  });

  it('act 3 completes when binding_seal_used OR binding_seal_destroyed', () => {
    const act3 = DUNGEON_ACTS.find(a => a.act === 3)!;
    expect(act3.completionFlags).toContain('binding_seal_used');
    expect(act3.completionFlags).toContain('binding_seal_destroyed');
  });

  it('acts 2 and 3 have an openingObjective', () => {
    expect(DUNGEON_ACTS[1].openingObjective).toBeTruthy();
    expect(DUNGEON_ACTS[2].openingObjective).toBeTruthy();
  });
});
