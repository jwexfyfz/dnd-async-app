import { describe, it, expect } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() } } }));

import { vi } from 'vitest';
import { detectCombatTrigger } from '../game-controller';
import type { ExtractedAction } from '@/types/v2-game';

// Minimal PoiContext shape used by detectCombatTrigger
function makePoiCtx(opts: {
  awareness?: string;
  hostileTo?: string[];
  recognitionException?: string;
} = {}) {
  return {
    id: 'poi-1',
    name: 'Guard',
    keyword: 'guard',
    availableStances: [],
    examined: false,
    interacted: false,
    destroyed: false,
    isLocked: false,
    isUnlocked: false,
    isExit: false,
    targetRoomTemplateId: null,
    items: [],
    floorItems: [],
    isOpenSpace: false,
    visibility: 'always' as const,
    peekVisibility: 'none' as const,
    _currentAwareness: opts.awareness,
    _hostileTo: opts.hostileTo,
    _recognitionException: opts.recognitionException,
  };
}

function makeAction(type: string): ExtractedAction {
  return {
    action_type: type as ExtractedAction['action_type'],
    target_poi_instance_id: null,
    resulting_stance: null,
    interaction_result: null,
    target_room_template_id: null,
    item_id: null,
    target_character_id: null,
  };
}

describe('detectCombatTrigger', () => {
  it('returns true when action_type is attack', () => {
    expect(detectCombatTrigger(makeAction('attack'), [], 'exploration', {})).toBe(true);
  });

  it('returns true when alert+hostile enemy is in the room regardless of action type', () => {
    const pois = [makePoiCtx({ awareness: 'alert', hostileTo: ['player'] })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'exploration', {})).toBe(true);
  });

  it('returns false when enemy is alert but not hostile (empty hostileTo)', () => {
    const pois = [makePoiCtx({ awareness: 'alert', hostileTo: [] })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'exploration', {})).toBe(false);
  });

  it('returns false when enemy is alert but recognition_exception matches story flag', () => {
    const pois = [makePoiCtx({ awareness: 'alert', hostileTo: ['player'], recognitionException: 'beren_roused' })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'exploration', { beren_roused: true })).toBe(false);
  });

  it('returns false when enemy is only suspicious and player does not attack', () => {
    const pois = [makePoiCtx({ awareness: 'suspicious', hostileTo: ['player'] })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'exploration', {})).toBe(false);
  });

  it('returns false during exploration with no alert enemies', () => {
    const pois = [makePoiCtx({ awareness: 'unaware', hostileTo: ['player'] })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'exploration', {})).toBe(false);
  });

  it('returns false when already in combat (gameState=combat)', () => {
    const pois = [makePoiCtx({ awareness: 'alert', hostileTo: ['player'] })];
    expect(detectCombatTrigger(makeAction('examine'), pois, 'combat', {})).toBe(false);
  });
});
