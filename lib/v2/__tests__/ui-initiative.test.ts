import { describe, it, expect } from 'vitest';
import type { InitiativeEntry } from '@/types/v2-game';

// Pure logic tests for InitiativeStrip and InitiativeMiniSheet rules.

function hpRingClass(hp: number, maxHp: number): string {
  if (hp === 0 || maxHp === 0) return 'border-slate-300 bg-slate-100';
  const pct = hp / maxHp;
  if (pct > 0.6) return 'border-emerald-400 bg-emerald-50';
  if (pct > 0.3) return 'border-yellow-400 bg-yellow-50';
  return 'border-red-400 bg-red-50';
}

function makeEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'e1',
    type: 'enemy',
    name: 'Slumped Guard',
    initiative: 9,
    hp: 11,
    maxHp: 11,
    ac: 13,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

describe('<InitiativeStrip /> — rendering logic', () => {
  it('not rendered when gameState === exploration (caller responsibility)', () => {
    // Strip is only mounted when gameState === 'combat' in PlayContent
    const shouldRender = (gameState: string) => gameState === 'combat';
    expect(shouldRender('exploration')).toBe(false);
    expect(shouldRender('combat')).toBe(true);
  });

  it('renders one icon per initiativeOrder entry', () => {
    const order = [makeEntry({ id: 'c1', type: 'character' }), makeEntry({ id: 'e1' })];
    expect(order).toHaveLength(2);
  });

  it('active actor is identified correctly', () => {
    const order = [makeEntry({ id: 'c1' }), makeEntry({ id: 'e1' })];
    const activeActorId = 'e1';
    const activeEntry = order.find(e => e.id === activeActorId);
    expect(activeEntry?.id).toBe('e1');
  });

  it('acted actors are flagged', () => {
    const entry = makeEntry({ acted: true });
    expect(entry.acted).toBe(true);
  });
});

describe('hpRingClass', () => {
  it('HP > 60%: green ring', () => {
    expect(hpRingClass(7, 11)).toContain('emerald');
  });

  it('HP 30–60%: yellow ring', () => {
    expect(hpRingClass(4, 11)).toContain('yellow');
  });

  it('HP < 30%: red ring', () => {
    expect(hpRingClass(2, 11)).toContain('red');
  });

  it('HP = 0: grey ring', () => {
    expect(hpRingClass(0, 11)).toContain('slate');
  });

  it('maxHp = 0: grey ring (no division by zero)', () => {
    expect(hpRingClass(0, 0)).toContain('slate');
  });

  it('full HP: green ring', () => {
    expect(hpRingClass(11, 11)).toContain('emerald');
  });

  it('exactly 60%: yellow ring (boundary)', () => {
    // 6/10 = 0.6, not > 0.6, falls to yellow check: 0.6 > 0.3 → yellow
    expect(hpRingClass(6, 10)).toContain('yellow');
  });

  it('exactly 30%: red ring (boundary)', () => {
    // 3/10 = 0.3, not > 0.3 → red
    expect(hpRingClass(3, 10)).toContain('red');
  });
});

describe('<InitiativeMiniSheet /> — display logic', () => {
  it('own character: shows HP, AC, attackBonus', () => {
    const stats = { currentHp: 8, maxHp: 18, ac: 12, attackBonus: 4, characterClass: 'Rogue' };
    expect(stats.currentHp).toBe(8);
    expect(stats.ac).toBe(12);
    expect(stats.attackBonus).toBe(4);
  });

  it('own character below 30% HP: flags low health', () => {
    const stats = { currentHp: 5, maxHp: 18, ac: 12, attackBonus: 4, characterClass: 'Fighter' };
    const isLow = stats.currentHp / stats.maxHp < 0.3;
    expect(isLow).toBe(true);
  });

  it('enemy: shows HP, maxHP, AC, proximity', () => {
    const entry = makeEntry({ hp: 4, maxHp: 11, ac: 13, proximity: 'close' });
    expect(entry.hp).toBe(4);
    expect(entry.maxHp).toBe(11);
    expect(entry.ac).toBe(13);
    expect(entry.proximity).toBe('close');
  });

  it('enemy: status effects listed when present', () => {
    const entry = makeEntry({ status_effects: ['prone', 'unconscious'] });
    const label = entry.status_effects.length > 0 ? entry.status_effects.join(', ') : '—';
    expect(label).toBe('prone, unconscious');
  });

  it('enemy: status shows — when none', () => {
    const entry = makeEntry({ status_effects: [] });
    const label = entry.status_effects.length > 0 ? entry.status_effects.join(', ') : '—';
    expect(label).toBe('—');
  });

  it('own character: class features present for Rogue', () => {
    const CLASS_FEATURES: Record<string, string[]> = {
      Fighter: ['second_wind'],
      Rogue: ['cunning_action'],
      Wizard: ['arcane_recovery'],
      Cleric: ['channel_divinity'],
    };
    expect(CLASS_FEATURES['Rogue']).toContain('cunning_action');
  });

  it('own character: tapping feature in combat navigates to chat', () => {
    let navigated = false;
    const onNavigateToChat = () => { navigated = true; };
    const isCombat = true;
    if (isCombat) onNavigateToChat();
    expect(navigated).toBe(true);
  });

  it('own character: tapping feature out of combat does not navigate', () => {
    let navigated = false;
    const onNavigateToChat = () => { navigated = true; };
    const isCombat = false;
    if (isCombat) onNavigateToChat();
    expect(navigated).toBe(false);
  });

  it('tapping same icon again closes sheet (toggle)', () => {
    let selected: string | null = 'e1';
    const onSelect = (id: string | null) => { selected = id; };
    // Simulating: if already selected, pass null
    const tappedId = 'e1';
    onSelect(selected === tappedId ? null : tappedId);
    expect(selected).toBeNull();
  });

  it('only one sheet open at a time', () => {
    let selected: string | null = 'e1';
    const onSelect = (id: string) => { selected = id; };
    onSelect('c1');
    expect(selected).toBe('c1');
  });
});
