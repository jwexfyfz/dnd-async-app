import { describe, it, expect } from 'vitest';
import {
  slotGridDistance, resolveEffectiveVisibility,
  losSlotCenter, losArchOpening,
} from '../room-geometry';

describe('slotGridDistance', () => {
  it('same slot = 0', () => expect(slotGridDistance('C', 'C')).toBe(0));
  it('adjacent cardinal = 1', () => expect(slotGridDistance('C', 'N')).toBe(1));
  it('NW to SE = 2', () => expect(slotGridDistance('NW', 'SE')).toBe(2));
  it('unknown slot falls back to C', () => expect(slotGridDistance('??', 'C')).toBe(0));
});

describe('resolveEffectiveVisibility', () => {
  it('defaults to always when no visibility key', () => {
    expect(resolveEffectiveVisibility({}, {})).toBe('always');
  });

  it('currentProps visibility_override=always wins over default proximity_only', () => {
    const result = resolveEffectiveVisibility(
      { visibility: 'proximity_only' },
      { visibility_override: 'always' },
    );
    expect(result).toBe('always');
  });

  it('defaultProps proximity_only preserved when no override', () => {
    expect(resolveEffectiveVisibility({ visibility: 'proximity_only' }, {})).toBe('proximity_only');
  });
});

describe('losSlotCenter', () => {
  it('center slot returns midpoint of room', () => {
    const [x, y] = losSlotCenter('C', 0, 0);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it('NW slot returns smaller x and y than SE', () => {
    const [nwX, nwY] = losSlotCenter('NW', 0, 0);
    const [seX, seY] = losSlotCenter('SE', 0, 0);
    expect(nwX).toBeLessThan(seX);
    expect(nwY).toBeLessThan(seY);
  });
});

describe('losArchOpening', () => {
  it('returns a two-element coordinate tuple', () => {
    const result = losArchOpening('N', 40);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('number');
    expect(typeof result[1]).toBe('number');
  });

  it('section N starts at 0', () => {
    const [start] = losArchOpening('N', 1);
    expect(start).toBe(0);
  });

  it('section C starts at 1', () => {
    const [start] = losArchOpening('C', 1);
    expect(start).toBe(1);
  });
});
