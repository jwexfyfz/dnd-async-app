import { describe, it, expect } from 'vitest';
import type { CombatState, InitiativeEntry, TurnUsage, ViewStatePayload } from '@/types/v2-game';

describe('CombatState structure', () => {
  it('InitiativeEntry with all required fields serializes to valid JSON', () => {
    const entry: InitiativeEntry = {
      id: 'abc-123',
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
    };
    const serialized = JSON.stringify(entry);
    const parsed = JSON.parse(serialized) as InitiativeEntry;
    expect(parsed.id).toBe('abc-123');
    expect(parsed.type).toBe('enemy');
    expect(parsed.hp).toBe(11);
    expect(parsed.proximity).toBe('close');
  });

  it('TurnUsage defaults all false', () => {
    const usage: TurnUsage = {
      actionUsed: false,
      bonusActionUsed: false,
      movementUsed: false,
      reactionUsed: false,
    };
    expect(Object.values(usage).every(v => v === false)).toBe(true);
  });

  it('combatState null is valid for exploration sessions', () => {
    const state: CombatState | null = null;
    expect(state).toBeNull();
  });

  it('ViewStatePayload extends to include combatState and gameState', () => {
    const payload: ViewStatePayload = {
      roomInstanceId: 'room-1',
      currentNarrative: [],
      activeState: 'exploration',
      gameState: 'exploration',
      combatState: null,
      poiIndex: {},
      poiStates: {},
      uiLayoutAnchors: { open_space: [] },
      characterInventory: { bag: [], equipped: {} },
      openSpaceItems: [],
      adjacentRoomPreviews: {},
      characterStats: { name: 'Tomas', currentHp: 18, maxHp: 18, ac: 12, level: 3, xp: 0, characterClass: 'Rogue', attackBonus: 4, weaponDamage: { main: null, off: null }, initiativeMod: 2, baseStrength: 10, baseDexterity: 14, baseConstitution: 12, baseIntelligence: 10, baseWisdom: 10, baseCharisma: 10, skillsModifiers: {}, skillProficiencies: [], isHiding: false, pendingChoicesQueue: [], subclass: null, critThreshold: 20, featuresUnlocked: [], resourceStates: [], canShortRest: false, classFeatureDetails: [] },
      combatAlert: null, remoteCombat: null, partyMembers: [],
    };
    expect(payload.gameState).toBe('exploration');
    expect(payload.combatState).toBeNull();
  });

  it('ViewStatePayload with active combatState includes round and initiativeOrder', () => {
    const combat: CombatState = {
      round: 2,
      activeActorId: 'player-1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'player-1', type: 'character', name: 'Tomas', initiative: 17, hp: 14, maxHp: 18, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
        { id: 'enemy-1', type: 'enemy', name: 'Guard', initiative: 9, hp: 4, maxHp: 11, ac: 13, surprised: false, acted: true, proximity: 'close', status_effects: [] },
      ],
    };
    const payload: ViewStatePayload = {
      roomInstanceId: 'room-1',
      currentNarrative: [],
      activeState: 'combat',
      gameState: 'combat',
      combatState: combat,
      poiIndex: {},
      poiStates: {},
      uiLayoutAnchors: { open_space: [] },
      characterInventory: { bag: [], equipped: {} },
      openSpaceItems: [],
      adjacentRoomPreviews: {},
      characterStats: { name: 'Tomas', currentHp: 14, maxHp: 18, ac: 12, level: 3, xp: 0, characterClass: 'Rogue', attackBonus: 4, weaponDamage: { main: null, off: null }, initiativeMod: 2, baseStrength: 10, baseDexterity: 14, baseConstitution: 12, baseIntelligence: 10, baseWisdom: 10, baseCharisma: 10, skillsModifiers: {}, skillProficiencies: [], isHiding: false, pendingChoicesQueue: [], subclass: null, critThreshold: 20, featuresUnlocked: [], resourceStates: [], canShortRest: false, classFeatureDetails: [] },
      combatAlert: null, remoteCombat: null, partyMembers: [],
    };
    expect(payload.gameState).toBe('combat');
    expect(payload.combatState?.round).toBe(2);
    expect(payload.combatState?.initiativeOrder).toHaveLength(2);
    expect(payload.combatState?.activeActorId).toBe('player-1');
  });
});
