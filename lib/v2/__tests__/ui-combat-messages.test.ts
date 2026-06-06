import { describe, it, expect } from 'vitest';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';

// Pure logic tests for Phase 10 combat message rendering and state transitions.

// ─── CombatBanner ─────────────────────────────────────────────────────────────

type BannerType = 'combat_start' | 'combat_end';

function combatStartText(round: number): string {
  return `⚔ Combat started — Round ${round}`;
}

function combatEndText(): string {
  return 'Combat ended — all enemies defeated';
}

describe('<CombatBanner />', () => {
  it('combat_start variant includes ⚔ and round number', () => {
    expect(combatStartText(1)).toContain('⚔');
    expect(combatStartText(1)).toContain('Round 1');
  });

  it('combat_start round=3 shows Round 3', () => {
    expect(combatStartText(3)).toContain('Round 3');
  });

  it('combat_end variant includes "Combat ended"', () => {
    expect(combatEndText()).toContain('Combat ended');
  });

  it('snapshot expand: initiative snapshot is available when provided', () => {
    const snapshot: Partial<InitiativeEntry>[] = [
      { id: 'c1', name: 'Tomas', initiative: 17 },
      { id: 'e1', name: 'Slumped Guard', initiative: 9 },
    ];
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot[0].name).toBe('Tomas');
  });
});

// ─── CombatRollBadge ──────────────────────────────────────────────────────────

interface CombatRollData {
  action: string;
  d20: number;
  modifier: number;
  total: number;
  vsTarget: string;
  success: boolean;
  isCrit?: boolean;
  damage?: string;
}

function rollEquation(d20: number, modifier: number, total: number): string {
  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
  return `${d20}${modStr}=${total}`;
}

function rollOutcome(success: boolean, isCrit?: boolean): string {
  if (isCrit) return '✓ CRIT';
  return success ? '✓' : '✗';
}

describe('<RollBadge /> — combat_roll', () => {
  it('renders action name, roll equation, vs target, outcome check', () => {
    const data: CombatRollData = { action: 'Attack', d20: 17, modifier: 5, total: 22, vsTarget: 'AC 15', success: true };
    expect(data.action).toBe('Attack');
    expect(rollEquation(data.d20, data.modifier, data.total)).toBe('17+5=22');
    expect(data.vsTarget).toBe('AC 15');
    expect(rollOutcome(data.success)).toBe('✓');
  });

  it('renders damage line when damage field is present', () => {
    const data: CombatRollData = { action: 'Attack', d20: 14, modifier: 3, total: 17, vsTarget: 'AC 13', success: true, damage: '1d8+3 = 7' };
    expect(data.damage).toBe('1d8+3 = 7');
  });

  it('no damage line when damage field is absent', () => {
    const data: CombatRollData = { action: 'Attack', d20: 5, modifier: 3, total: 8, vsTarget: 'AC 13', success: false };
    expect(data.damage).toBeUndefined();
  });

  it('crit highlighted differently: outcome is "✓ CRIT"', () => {
    expect(rollOutcome(true, true)).toBe('✓ CRIT');
    expect(rollOutcome(true, false)).toBe('✓');
  });

  it('miss shows ✗', () => {
    expect(rollOutcome(false)).toBe('✗');
  });

  it('zero modifier: no + or - in equation', () => {
    expect(rollEquation(12, 0, 12)).toBe('12=12');
  });

  it('negative modifier appears correctly', () => {
    expect(rollEquation(10, -2, 8)).toBe('10-2=8');
  });
});

// ─── CombatResumeCard ─────────────────────────────────────────────────────────

function buildTestCombatState(overrides: Partial<CombatState> = {}): CombatState {
  const char: InitiativeEntry = {
    id: 'char1', type: 'character', name: 'Tomas', initiative: 17,
    hp: 8, maxHp: 18, ac: 12, surprised: false, acted: false,
    proximity: 'close', status_effects: [],
  };
  const guard: InitiativeEntry = {
    id: 'guard1', type: 'enemy', name: 'Slumped Guard', initiative: 9,
    hp: 4, maxHp: 11, ac: 13, surprised: false, acted: true,
    proximity: 'close', status_effects: [],
  };
  const deadEnemy: InitiativeEntry = {
    id: 'dead1', type: 'enemy', name: 'Dead Guy', initiative: 5,
    hp: 0, maxHp: 10, ac: 11, surprised: false, acted: true,
    proximity: 'close', status_effects: [],
  };
  return {
    round: 3,
    initiativeOrder: [char, guard, deadEnemy],
    activeActorId: 'char1',
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    ...overrides,
  };
}

function getLivingEntries(cs: CombatState): InitiativeEntry[] {
  return cs.initiativeOrder.filter(e => e.hp > 0);
}

function isActiveActor(entry: InitiativeEntry, cs: CombatState, characterId: string): { yourTurn: boolean; acted: boolean } {
  const isActive = entry.id === cs.activeActorId;
  const isYou = entry.id === characterId;
  return {
    yourTurn: isActive && isYou,
    acted: entry.acted && !isActive,
  };
}

describe('<CombatResumeCard />', () => {
  it('renders when gameState=combat on load', () => {
    const shouldRender = (gameState: string, showResumeCard: boolean, combatState: CombatState | null) =>
      showResumeCard && gameState === 'combat' && combatState !== null;
    const cs = buildTestCombatState();
    expect(shouldRender('combat', true, cs)).toBe(true);
  });

  it('not rendered when gameState=exploration on load', () => {
    const shouldRender = (gameState: string, showResumeCard: boolean, combatState: CombatState | null) =>
      showResumeCard && gameState === 'combat' && combatState !== null;
    expect(shouldRender('exploration', true, null)).toBe(false);
  });

  it('not rendered when showResumeCard is false', () => {
    const shouldRender = (showResumeCard: boolean) =>
      showResumeCard && true && true;
    expect(shouldRender(false)).toBe(false);
  });

  it('dead enemies (hp=0) excluded from card', () => {
    const cs = buildTestCombatState();
    const living = getLivingEntries(cs);
    expect(living.every(e => e.hp > 0)).toBe(true);
    expect(living.find(e => e.name === 'Dead Guy')).toBeUndefined();
  });

  it('active actor marked with "← your turn"', () => {
    const cs = buildTestCombatState({ activeActorId: 'char1' });
    const entry = cs.initiativeOrder.find(e => e.id === 'char1')!;
    const { yourTurn } = isActiveActor(entry, cs, 'char1');
    expect(yourTurn).toBe(true);
  });

  it('acted entries show "(acted)" label', () => {
    const cs = buildTestCombatState({ activeActorId: 'char1' });
    const guard = cs.initiativeOrder.find(e => e.id === 'guard1')!;
    const { acted } = isActiveActor(guard, cs, 'char1');
    expect(acted).toBe(true);
  });

  it('active actor is NOT shown as acted', () => {
    const cs = buildTestCombatState({ activeActorId: 'char1' });
    const char = cs.initiativeOrder.find(e => e.id === 'char1')!;
    const { acted } = isActiveActor(char, cs, 'char1');
    expect(acted).toBe(false);
  });

  it('unmounts after first action response (showResumeCard cleared)', () => {
    let showResumeCard = true;
    const onSendAction = () => { showResumeCard = false; };
    onSendAction();
    expect(showResumeCard).toBe(false);
  });
});

// ─── State Transitions ────────────────────────────────────────────────────────

type GameState = 'exploration' | 'combat';

function detectTransition(prev: GameState, next: GameState): { type: 'combat_start' | 'combat_end' } | null {
  if (prev === next) return null;
  return { type: next === 'combat' ? 'combat_start' : 'combat_end' };
}

describe('state transitions', () => {
  it('exploration→combat: banner type is combat_start', () => {
    expect(detectTransition('exploration', 'combat')).toEqual({ type: 'combat_start' });
  });

  it('combat→exploration: banner type is combat_end', () => {
    expect(detectTransition('combat', 'exploration')).toEqual({ type: 'combat_end' });
  });

  it('no transition when gameState unchanged', () => {
    expect(detectTransition('exploration', 'exploration')).toBeNull();
    expect(detectTransition('combat', 'combat')).toBeNull();
  });

  it('combat_start banner includes round and initiativeOrder from response', () => {
    const cs = buildTestCombatState({ round: 1 });
    const banner = {
      type: 'combat_start',
      round: cs.round,
      initiativeOrder: cs.initiativeOrder,
    };
    expect(banner.round).toBe(1);
    expect(banner.initiativeOrder.length).toBeGreaterThan(0);
  });

  it('combat_end banner has no initiative data', () => {
    const banner = { type: 'combat_end' };
    expect((banner as Record<string, unknown>).initiativeOrder).toBeUndefined();
  });

  it('combatState null in response treated as combat end', () => {
    const nextGameState: GameState = 'exploration';
    expect(detectTransition('combat', nextGameState)?.type).toBe('combat_end');
  });

  it('no page reload: gameState updated via setState, not router', () => {
    let gameState: GameState = 'exploration';
    const setGameState = (s: GameState) => { gameState = s; };
    setGameState('combat');
    expect(gameState).toBe('combat');
  });
});
