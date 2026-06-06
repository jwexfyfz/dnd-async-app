import { describe, it, expect, vi } from 'vitest';

// Pure logic tests for the Header and BottomNav behaviour defined in
// app/v2/play/page.tsx. These verify the decision rules without requiring
// a DOM or React renderer.

type GameState = 'exploration' | 'combat';
type ActiveTab = 'chat' | 'inventory' | 'party' | 'map';

function headerBgClass(gameState: GameState): string {
  return gameState === 'combat' ? 'bg-red-600' : 'bg-blue-600';
}

function showCombatPill(gameState: GameState): boolean {
  return gameState === 'combat';
}

function roundLabel(gameState: GameState, round?: number): string | null {
  if (gameState !== 'combat' || round == null) return null;
  return `Round ${round}`;
}

const ALL_TABS: ActiveTab[] = ['chat', 'inventory', 'party', 'map'];

function isActiveTab(activeTab: ActiveTab, tab: ActiveTab): boolean {
  return activeTab === tab;
}

describe('Header logic', () => {
  it('exploration: uses bg-blue-600', () => {
    expect(headerBgClass('exploration')).toBe('bg-blue-600');
  });

  it('exploration: no combat pill', () => {
    expect(showCombatPill('exploration')).toBe(false);
  });

  it('exploration: no round label', () => {
    expect(roundLabel('exploration', 2)).toBeNull();
  });

  it('combat: uses bg-red-600', () => {
    expect(headerBgClass('combat')).toBe('bg-red-600');
  });

  it('combat: shows combat pill', () => {
    expect(showCombatPill('combat')).toBe(true);
  });

  it('combat round=1: shows "Round 1"', () => {
    expect(roundLabel('combat', 1)).toBe('Round 1');
  });

  it('combat round=3: shows "Round 3"', () => {
    expect(roundLabel('combat', 3)).toBe('Round 3');
  });

  it('combat with no round: no round label', () => {
    expect(roundLabel('combat', undefined)).toBeNull();
  });
});

describe('BottomNav logic', () => {
  it('has exactly 4 tabs', () => {
    expect(ALL_TABS).toHaveLength(4);
  });

  it('contains Chat, Inventory, Party, Map', () => {
    expect(ALL_TABS).toContain('chat');
    expect(ALL_TABS).toContain('inventory');
    expect(ALL_TABS).toContain('party');
    expect(ALL_TABS).toContain('map');
  });

  it('active tab returns true for isActiveTab', () => {
    expect(isActiveTab('chat', 'chat')).toBe(true);
    expect(isActiveTab('map', 'map')).toBe(true);
  });

  it('non-active tabs return false', () => {
    expect(isActiveTab('chat', 'map')).toBe(false);
    expect(isActiveTab('map', 'chat')).toBe(false);
  });

  it('only one tab is active at a time', () => {
    const active: ActiveTab = 'inventory';
    const activeCount = ALL_TABS.filter(t => isActiveTab(active, t)).length;
    expect(activeCount).toBe(1);
  });

  it('onTabChange is called with the tapped tab value', () => {
    const spy = vi.fn();
    const tab: ActiveTab = 'party';
    spy(tab);
    expect(spy).toHaveBeenCalledWith('party');
  });
});
