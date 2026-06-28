import { describe, it, expect } from 'vitest';
import type { PoiContext, PoiCombatStats, AiBehavior, AdjacentRoomContext } from '../poi-context';

describe('PoiContext types', () => {
  it('minimal PoiContext satisfies shape', () => {
    const ctx: PoiContext = {
      id: 'poi-1', name: 'Chest', keyword: 'chest',
      availableStances: ['crouch'],
      examined: false, interacted: false, destroyed: false,
      isLocked: false, isUnlocked: false,
      isExit: false, exitDirection: null, targetRoomTemplateId: null,
      items: [], floorItems: [],
      isOpenSpace: false,
      visibility: 'always', peekVisibility: 'none',
    };
    expect(ctx.id).toBe('poi-1');
    expect(ctx.isExit).toBe(false);
  });

  it('exit PoiContext has targetRoomTemplateId', () => {
    const ctx: PoiContext = {
      id: 'exit-1', name: 'Door North', keyword: 'door',
      availableStances: [],
      examined: false, interacted: false, destroyed: false,
      isLocked: false, isUnlocked: false,
      isExit: true, exitDirection: 'N', targetRoomTemplateId: 'room-tmpl-2',
      items: [], floorItems: [],
      isOpenSpace: false,
      visibility: 'always', peekVisibility: 'full',
    };
    expect(ctx.targetRoomTemplateId).toBe('room-tmpl-2');
  });

  it('PoiCombatStats with all optional fields', () => {
    const stats: PoiCombatStats = { attack_bonus: 3, damage: '1d6', max_hp: 11, ac: 13 };
    expect(stats.attack_bonus).toBe(3);
  });

  it('AiBehavior priority values', () => {
    const behaviors: AiBehavior['priority'][] = ['aggressive', 'defensive', 'cowardly'];
    expect(behaviors).toHaveLength(3);
  });

  it('AdjacentRoomContext has required fields', () => {
    const ctx: AdjacentRoomContext = {
      roomName: 'Guard Post',
      exitPoiId: 'exit-1',
      exitPoiName: 'Door North',
      targetRoomTemplateId: 'room-guard-post',
      pois: [],
      characters: [],
    };
    expect(ctx.roomName).toBe('Guard Post');
  });
});
