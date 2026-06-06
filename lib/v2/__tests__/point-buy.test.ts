import { describe, it, expect } from 'vitest';
import { getStatCost } from '../point-buy';

describe('getStatCost', () => {
  describe('incrementing', () => {
    it('costs 1 point for values below 13', () => {
      expect(getStatCost(8,  true)).toBe(1);
      expect(getStatCost(12, true)).toBe(1);
    });
    it('costs 2 points at 13 (crossing into elite tier)', () => {
      expect(getStatCost(13, true)).toBe(2);
      expect(getStatCost(14, true)).toBe(2);
    });
  });

  describe('decrementing', () => {
    it('refunds 1 point for values below 14', () => {
      expect(getStatCost(13, false)).toBe(1);
      expect(getStatCost(8,  false)).toBe(1);
    });
    it('refunds 2 points at 14 and 15 (leaving elite tier)', () => {
      expect(getStatCost(14, false)).toBe(2);
      expect(getStatCost(15, false)).toBe(2);
    });
  });
});
