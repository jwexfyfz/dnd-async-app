import { describe, it, expect } from 'vitest';
import type { PendingLevelUpChoice } from '@/types/v2-game';

// Pure logic tests for Phase 7 pending choice UI indicators.

// ─── Strip text ───────────────────────────────────────────────────────────────

function pendingStripText(queue: PendingLevelUpChoice[]): string | null {
  const active = queue[0] ?? null;
  if (!active || active.type === 'heroic_sacrifice') return null;
  const desc = active.type === 'asi' ? 'Ability Score Improvement' : 'Choose your subclass';
  if (queue.length > 1) {
    return `1 of ${queue.length} — Level ${active.level}: ${desc}`;
  }
  return `✦ Level ${active.level} reached — ${active.type === 'asi' ? 'Ability Score Improvement waiting' : 'Choose your subclass'}`;
}

describe('pending strip text', () => {
  it('single ASI choice', () => {
    const text = pendingStripText([{ type: 'asi', level: 4 }]);
    expect(text).toContain('Level 4');
    expect(text).toContain('Ability Score Improvement');
    expect(text).toContain('✦');
  });

  it('single subclass choice', () => {
    const text = pendingStripText([{ type: 'subclass', level: 3 }]);
    expect(text).toContain('Level 3');
    expect(text).toContain('Choose your subclass');
  });

  it('multiple choices shows "1 of N" prefix, not ✦', () => {
    const queue: PendingLevelUpChoice[] = [
      { type: 'subclass', level: 3 },
      { type: 'asi', level: 4 },
    ];
    const text = pendingStripText(queue);
    expect(text).toBe('1 of 2 — Level 3: Choose your subclass');
    expect(text).not.toContain('✦');
  });

  it('empty queue returns null', () => {
    expect(pendingStripText([])).toBeNull();
  });
});

// ─── hasPendingChoice derived flag ────────────────────────────────────────────

function hasPendingChoice(queue: PendingLevelUpChoice[]): boolean {
  return queue.length > 0;
}

describe('hasPendingChoice', () => {
  it('true when queue is non-empty', () => {
    expect(hasPendingChoice([{ type: 'asi', level: 4 }])).toBe(true);
  });

  it('false when queue is empty', () => {
    expect(hasPendingChoice([])).toBe(false);
  });

  it('true with two choices', () => {
    expect(hasPendingChoice([{ type: 'subclass', level: 3 }, { type: 'asi', level: 4 }])).toBe(true);
  });
});

// ─── Queue invariants ─────────────────────────────────────────────────────────

describe('queue invariants', () => {
  it('index 0 is always the active (next to resolve) choice', () => {
    const queue: PendingLevelUpChoice[] = [{ type: 'subclass', level: 3 }, { type: 'asi', level: 4 }];
    expect(queue[0].type).toBe('subclass');
    expect((queue[0] as { type: 'subclass'; level: number }).level).toBe(3);
  });

  it('strip shows index 0 content even when multiple choices queued', () => {
    const queue: PendingLevelUpChoice[] = [{ type: 'subclass', level: 3 }, { type: 'asi', level: 4 }];
    const text = pendingStripText(queue);
    expect(text).toContain('Level 3');
    expect(text).not.toContain('Level 4');
  });
});
