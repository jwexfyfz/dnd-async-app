import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roomInstance: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    roomParticipant: {
      findMany: vi.fn(),
    },
    character: {
      findUnique: vi.fn(),
    },
    messageLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/initiative', () => ({
  rollInitiative: vi.fn(),
}));

vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 3, rolls: [3] })),
}));

vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => ({ total: 5, expr: '[5]' })),
}));

vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => 15),
}));

import { prisma } from '@/lib/prisma';
import { rollInitiative } from '@/lib/initiative';
import { rollD20Check } from '@/lib/dice';
import {
  enterCombat, joinCombat, resolveOpportunityAttacks, resolveEnemyTurn, resolveCombatAction,
} from '../combat-engine';
import { assembleViewState } from '../view-state';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';

const mockHit = { modifier: 4, dc: 13, dcType: 'AC' as const, roll: 15, total: 19, success: true, critical: false, fumble: false };

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const COMBAT_ROOM_ID = 'combat-room-1';
const COMBAT_ROOM_TEMPLATE_ID = 'tmpl-combat-room';
const ENTRY_CHAMBER_ID = 'entry-chamber-1';
const SESSION_ID = 'session-1';

function makeCombatRoom(poiOverrides: Array<Record<string, unknown>> = []) {
  return {
    id: COMBAT_ROOM_ID,
    roomTemplateId: COMBAT_ROOM_TEMPLATE_ID,
    template: { name: 'The Flooded Passage' },
    poiInstances: poiOverrides.length > 0 ? poiOverrides as never[] : [
      {
        id: 'enemy-poi-1',
        poiTemplateId: 'tmpl-restless-dead',
        currentProperties: { awareness_state: 'alert', current_hp: 11 },
        template: {
          name: 'Restless Dead',
          grid_slot: 'NW',
          defaultProperties: { combat_stats: { max_hp: 11, ac: 12, dex_score: 10, attack_bonus: 3, damage: '1d6' } },
        },
      },
    ] as never[],
  };
}

function makeExitPoi(opts: { id: string; grid_slot: string; peek: string; interacted?: boolean; locked?: boolean }) {
  return {
    id: opts.id,
    template: {
      grid_slot: opts.grid_slot,
      defaultProperties: {
        poi_type: 'exit',
        enter: { target_room_template_id: COMBAT_ROOM_TEMPLATE_ID },
        peek_visibility: opts.peek,
        ...(opts.locked ? { locked_by: ['key'] } : {}),
      },
    },
    currentProperties: { interacted: opts.interacted ?? false, unlocked: false, destroyed: false },
  };
}

function makeOutsideParticipant(overrides: Record<string, unknown> = {}) {
  return {
    characterId: 'char-jeff',
    roomInstanceId: ENTRY_CHAMBER_ID,
    lastActiveAt: new Date(),
    character: {
      id: 'char-jeff',
      name: 'Jeff',
      baseDexterity: 14,
      currentHp: 20,
      maxHp: 20,
      isHiding: false,
    },
    roomInstance: {
      gameState: 'exploration',
      poiInstances: [makeExitPoi({ id: 'exit-dark-passage', grid_slot: 'N', peek: 'full', interacted: true })],
    },
    ...overrides,
  };
}

function setupPrismaMocks(opts: {
  roomParticipants?: unknown[];
  outsideParticipants?: unknown[];
  enrolledElsewhereRooms?: unknown[];
}) {
  vi.mocked(prisma.roomInstance.findUnique).mockResolvedValue({ gameState: 'exploration', combatState: null } as never);
  vi.mocked(prisma.roomInstance.findMany).mockResolvedValue((opts.enrolledElsewhereRooms ?? []) as never);
  vi.mocked(prisma.roomInstance.update).mockResolvedValue({} as never);
  vi.mocked(prisma.messageLog.create).mockResolvedValue({} as never);
  (prisma.roomParticipant.findMany as any).mockImplementation((args: unknown) => {
    const where = (args as { where: { roomInstanceId?: string | { not?: string } } }).where;
    if (where.roomInstanceId === COMBAT_ROOM_ID) return Promise.resolve(opts.roomParticipants ?? []);
    return Promise.resolve(opts.outsideParticipants ?? []);
  });
}

let initiativeCounter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  initiativeCounter = 0;
  vi.mocked(rollInitiative).mockImplementation((actors: Array<{ actorId: string; actorType: 'CHARACTER' | 'ENEMY' }>) =>
    actors.map(a => {
      initiativeCounter += 1;
      return {
        actorId: a.actorId,
        actorType: a.actorType,
        initiative: 30 - initiativeCounter,
        d20Roll: 15,
        modifier: 0,
        hasReaction: true,
        isSurprised: false,
      };
    }),
  );
});

// ─── enterCombat — LoS remote enrollment ───────────────────────────────────────

describe('enterCombat — LoS remote enrollment (no-teleport redesign)', () => {
  it('enrolls an LoS ally as a remote participant without moving roomParticipant', async () => {
    setupPrismaMocks({ outsideParticipants: [makeOutsideParticipant()] });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    const entry = cs.initiativeOrder.find(e => e.id === 'char-jeff');
    expect(entry).toBeDefined();
    expect(entry?.remoteRoomInstanceId).toBe(ENTRY_CHAMBER_ID);
    expect(entry?.proximity).toBe('far');
    expect(entry?.grid_slot).toBe('N');
    expect(entry?.status_effects).toEqual([]);
    expect(entry?.isDormant).toBe(false);

    // No roomParticipant.update at all — LoS allies are never physically moved.
    expect((prisma as unknown as { roomParticipant: Record<string, unknown> }).roomParticipant.update).toBeUndefined();
  });

  it('preserves isHiding (-> "hiding" status effect) and isDormant for the LoS ally', async () => {
    const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h ago > 48h dormant threshold
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant({
        lastActiveAt: longAgo,
        character: { id: 'char-jeff', name: 'Jeff', baseDexterity: 14, currentHp: 20, maxHp: 20, isHiding: true },
      })],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    const entry = cs.initiativeOrder.find(e => e.id === 'char-jeff');
    expect(entry?.status_effects).toContain('hiding');
    expect(entry?.isDormant).toBe(true);
  });

  it('does not enroll a 0 HP character and does not send them a combat_alert', async () => {
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant({
        character: { id: 'char-jeff', name: 'Jeff', baseDexterity: 14, currentHp: 0, maxHp: 20, isHiding: false },
      })],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    expect(cs.initiativeOrder.find(e => e.id === 'char-jeff')).toBeUndefined();
    const alertCalls = vi.mocked(prisma.messageLog.create).mock.calls.filter(
      ([arg]) => (arg as { data: { mechanicalSummary?: { type?: string } } }).data.mechanicalSummary?.type === 'combat_alert',
    );
    expect(alertCalls).toHaveLength(0);
  });

  it('skips a character whose own room is already in combat, but still sends a combat_alert there (S7)', async () => {
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant({
        roomInstance: { gameState: 'combat', poiInstances: [makeExitPoi({ id: 'exit-dark-passage', grid_slot: 'N', peek: 'full', interacted: true })] },
      })],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    expect(cs.initiativeOrder.find(e => e.id === 'char-jeff')).toBeUndefined();
    const alertCalls = vi.mocked(prisma.messageLog.create).mock.calls.filter(
      ([arg]) => (arg as { data: { roomInstanceId?: string; mechanicalSummary?: { type?: string } } }).data.mechanicalSummary?.type === 'combat_alert'
        && (arg as { data: { roomInstanceId?: string } }).data.roomInstanceId === ENTRY_CHAMBER_ID,
    );
    expect(alertCalls).toHaveLength(1);
  });

  it('double-enrollment guard: skips a character already enrolled in another room\'s combat', async () => {
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant()],
      enrolledElsewhereRooms: [{ combatState: { initiativeOrder: [{ id: 'char-jeff' }] } }],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    expect(cs.initiativeOrder.find(e => e.id === 'char-jeff')).toBeUndefined();
    // Not enrolled here, but still gets a combat_alert for their actual room.
    const alertCalls = vi.mocked(prisma.messageLog.create).mock.calls.filter(
      ([arg]) => (arg as { data: { mechanicalSummary?: { type?: string } } }).data.mechanicalSummary?.type === 'combat_alert',
    );
    expect(alertCalls).toHaveLength(1);
  });

  it('two LoS exits to the same room enroll the character once, using the first matching exit\'s grid_slot', async () => {
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant({
        roomInstance: {
          gameState: 'exploration',
          poiInstances: [
            makeExitPoi({ id: 'exit-north-door', grid_slot: 'N', peek: 'full' }),
            makeExitPoi({ id: 'exit-south-door', grid_slot: 'S', peek: 'full' }),
          ],
        },
      })],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    const matches = cs.initiativeOrder.filter(e => e.id === 'char-jeff');
    expect(matches).toHaveLength(1);
    expect(matches[0].grid_slot).toBe('N');
  });

  it('no LoS exit to the combat room: character is not enrolled but their room gets a combat_alert', async () => {
    setupPrismaMocks({
      outsideParticipants: [makeOutsideParticipant({
        roomInstance: {
          gameState: 'exploration',
          poiInstances: [makeExitPoi({ id: 'exit-elsewhere', grid_slot: 'N', peek: 'none' })],
        },
      })],
    });

    const cs = await enterCombat(makeCombatRoom(), SESSION_ID);

    expect(cs.initiativeOrder.find(e => e.id === 'char-jeff')).toBeUndefined();
    const alertCalls = vi.mocked(prisma.messageLog.create).mock.calls.filter(
      ([arg]) => (arg as { data: { mechanicalSummary?: { type?: string } } }).data.mechanicalSummary?.type === 'combat_alert',
    );
    expect(alertCalls).toHaveLength(1);
  });
});

// ─── resolveOpportunityAttacks — remote entries never targeted ────────────────

describe('resolveOpportunityAttacks — remote allies are never targeted', () => {
  it('returns no facts/damage when the acting character is remote, even with a close enemy', () => {
    const cs: CombatState = {
      round: 1,
      activeActorId: 'char-jeff',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 12, hp: 18, maxHp: 20, ac: 12, surprised: false, acted: true, proximity: 'far', status_effects: [], remoteRoomInstanceId: ENTRY_CHAMBER_ID },
        { id: 'enemy-1', type: 'enemy', name: 'Restless Dead', initiative: 9, hp: 11, maxHp: 11, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    const poiInstances = [{ id: 'enemy-1', template: { defaultProperties: { combat_stats: { attack_bonus: 3, damage: '1d6', ac: 12 } } } }];

    const result = resolveOpportunityAttacks(cs, 'char-jeff', 'Jeff', poiInstances);

    expect(result.facts).toHaveLength(0);
    expect(result.hpDamage).toBe(0);
    expect(result.updatedCombatState).toBe(cs);
    expect(rollD20Check).not.toHaveBeenCalled();
  });
});

// ─── resolveEnemyTurn — remote targets are out of melee range ─────────────────

const aggressiveProps = {
  combat_stats: { attack_bonus: 3, damage: '1d6', max_hp: 11, ac: 12, dex_score: 10 },
  ai_behavior: { priority: 'aggressive', flee_threshold: 0 },
};

function makeEnemyEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return { id: 'enemy-1', type: 'enemy', name: 'Restless Dead', initiative: 9, hp: 11, maxHp: 11, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [], ...overrides };
}

function makeRemoteCharEntry(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 14, hp: 18, maxHp: 20, ac: 12, surprised: false, acted: false, proximity: 'far', status_effects: [], remoteRoomInstanceId: ENTRY_CHAMBER_ID, ...overrides };
}

function makeCs(enemy: InitiativeEntry, char: InitiativeEntry): CombatState {
  return { round: 1, activeActorId: enemy.id, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false }, initiativeOrder: [char, enemy] };
}

describe('resolveEnemyTurn — remote ally is out of melee range', () => {
  it('aggressive enemy already close to a remote target holds instead of attacking', () => {
    const entry = makeEnemyEntry({ proximity: 'close' });
    const cs = makeCs(entry, makeRemoteCharEntry({ proximity: 'close' }));

    const result = resolveEnemyTurn(entry, cs, 'char-jeff', 'Jeff', aggressiveProps);

    expect(result.hpDamage).toBe(0);
    expect(rollD20Check).not.toHaveBeenCalled();
    expect(result.facts[0]).toMatch(/no target in melee range/i);
    expect(result.updatedEntry.proximity).toBe('close');
  });

  it('aggressive enemy far from a remote target still approaches the doorway (move), but cannot attack it', () => {
    const entry = makeEnemyEntry({ proximity: 'far' });
    const cs = makeCs(entry, makeRemoteCharEntry({ grid_slot: 'N' }));

    const result = resolveEnemyTurn(entry, cs, 'char-jeff', 'Jeff', aggressiveProps, 'N');

    expect(result.hpDamage).toBe(0);
    expect(rollD20Check).not.toHaveBeenCalled();
    expect(result.updatedEntry.proximity).toBe('close');
    expect(result.updatedEntry.grid_slot).toBe('N');
    expect(result.facts[0]).toMatch(/close range/);
  });
});

// ─── joinCombat — remote ally physically arrives ──────────────────────────────

function makeRemoteCombatState(): CombatState {
  return {
    round: 2,
    activeActorId: 'enemy-1',
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    initiativeOrder: [
      { id: 'enemy-1', type: 'enemy', name: 'Restless Dead', initiative: 18, hp: 11, maxHp: 11, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 14, hp: 18, maxHp: 20, ac: 12, surprised: false, acted: false, proximity: 'far', grid_slot: 'N', status_effects: [], isDormant: false, remoteRoomInstanceId: ENTRY_CHAMBER_ID },
    ],
  };
}

describe('joinCombat — remote ally physically arrives', () => {
  beforeEach(() => {
    vi.mocked(prisma.character.findUnique).mockResolvedValue({ id: 'char-jeff', name: 'Jeff', baseDexterity: 14, currentHp: 18, maxHp: 20 } as never);
    vi.mocked(prisma.roomInstance.update).mockResolvedValue({} as never);
    vi.mocked(prisma.messageLog.create).mockResolvedValue({} as never);
  });

  it('clears remoteRoomInstanceId, sets proximity close, and keeps the existing initiative (no re-roll)', async () => {
    const cs = makeRemoteCombatState();
    vi.mocked(prisma.roomInstance.findUnique).mockResolvedValue({ combatState: cs, gameState: 'combat', sessionId: SESSION_ID } as never);

    await joinCombat('char-jeff', COMBAT_ROOM_ID, false);

    expect(rollInitiative).not.toHaveBeenCalled();
    const updateCall = vi.mocked(prisma.roomInstance.update).mock.calls[0][0] as unknown as { data: { combatState: CombatState } };
    const updatedEntry = updateCall.data.combatState.initiativeOrder.find(e => e.id === 'char-jeff')!;
    expect(updatedEntry.remoteRoomInstanceId).toBeUndefined();
    expect(updatedEntry.proximity).toBe('close');
    expect(updatedEntry.isDormant).toBe(false);
    expect(updatedEntry.initiative).toBe(14);

    const messageCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0] as unknown as { data: { mechanicalSummary: { type: string; round: number; arrival: boolean } } };
    expect(messageCall.data.mechanicalSummary).toMatchObject({ type: 'join_combat', round: 2, arrival: true });
  });

  it('a hidden remote ally arrives with the "hiding" status effect set', async () => {
    const cs = makeRemoteCombatState();
    vi.mocked(prisma.roomInstance.findUnique).mockResolvedValue({ combatState: cs, gameState: 'combat', sessionId: SESSION_ID } as never);

    await joinCombat('char-jeff', COMBAT_ROOM_ID, true);

    const updateCall = vi.mocked(prisma.roomInstance.update).mock.calls[0][0] as unknown as { data: { combatState: CombatState } };
    const updatedEntry = updateCall.data.combatState.initiativeOrder.find(e => e.id === 'char-jeff')!;
    expect(updatedEntry.status_effects).toContain('hiding');
  });

  it('is a no-op for a character already physically present (no remoteRoomInstanceId)', async () => {
    const cs = makeRemoteCombatState();
    cs.initiativeOrder = cs.initiativeOrder.map(e => e.id === 'char-jeff' ? { ...e, remoteRoomInstanceId: undefined, proximity: 'close' as const } : e);
    vi.mocked(prisma.roomInstance.findUnique).mockResolvedValue({ combatState: cs, gameState: 'combat', sessionId: SESSION_ID } as never);

    await joinCombat('char-jeff', COMBAT_ROOM_ID, false);

    expect(prisma.roomInstance.update).not.toHaveBeenCalled();
    expect(prisma.messageLog.create).not.toHaveBeenCalled();
  });
});

// ─── assembleViewState — remoteCombat population ──────────────────────────────

const OWN_ROOM_ID = 'room-entry-chamber';

function makeRawViewState(overrides: Record<string, unknown> = {}) {
  return {
    recentNarrative: [],
    participants: [],
    charRow: {
      name: 'Jeff', inventory: { bag: [], equipped: {} }, currentHp: 18, maxHp: 20, level: 3, characterClass: 'Rogue',
      baseStrength: 10, baseDexterity: 14, baseConstitution: 12, baseIntelligence: 10, baseWisdom: 10, baseCharisma: 10,
      skillsModifiers: {}, skillProficiencies: [], isHiding: false,
    },
    poiInstances: [],
    roomRow: { gameState: 'exploration', combatState: null },
    sessionPartyData: [],
    sessionCombatRooms: [],
    ...overrides,
  } as never;
}

describe('assembleViewState — remoteCombat', () => {
  it('is populated for a remote initiativeOrder entry with HP taken from charRow', async () => {
    const cs: CombatState = {
      round: 2,
      activeActorId: 'enemy-1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 14, hp: 5, maxHp: 20, ac: 12, surprised: false, acted: false, proximity: 'far', status_effects: [], remoteRoomInstanceId: OWN_ROOM_ID },
      ],
    };
    const raw = makeRawViewState({ sessionCombatRooms: [{ id: COMBAT_ROOM_ID, combatState: cs, template: { name: 'The Flooded Passage' } }] });

    const result = await assembleViewState(raw, OWN_ROOM_ID, 'exploration', 'char-jeff', SESSION_ID, null);

    expect(result.remoteCombat).not.toBeNull();
    expect(result.remoteCombat?.roomInstanceId).toBe(COMBAT_ROOM_ID);
    expect(result.remoteCombat?.roomName).toBe('The Flooded Passage');
    const entry = result.remoteCombat?.combatState.initiativeOrder.find(e => e.id === 'char-jeff');
    expect(entry?.hp).toBe(18); // overridden from charRow.currentHp, not the stale combatState value (5)
  });

  it('is null when there are no active combat rooms', async () => {
    const raw = makeRawViewState({ sessionCombatRooms: [] });
    const result = await assembleViewState(raw, OWN_ROOM_ID, 'exploration', 'char-jeff', SESSION_ID, null);
    expect(result.remoteCombat).toBeNull();
  });

  it('is null when the character is not in any other room\'s initiativeOrder', async () => {
    const cs: CombatState = {
      round: 1,
      activeActorId: 'enemy-1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'enemy-1', type: 'enemy', name: 'Restless Dead', initiative: 9, hp: 11, maxHp: 11, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    const raw = makeRawViewState({ sessionCombatRooms: [{ id: COMBAT_ROOM_ID, combatState: cs, template: { name: 'The Flooded Passage' } }] });
    const result = await assembleViewState(raw, OWN_ROOM_ID, 'exploration', 'char-jeff', SESSION_ID, null);
    expect(result.remoteCombat).toBeNull();
  });

  it('is null for the character\'s own combat room (surfaced via combatState instead)', async () => {
    const cs: CombatState = {
      round: 1,
      activeActorId: 'char-jeff',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 14, hp: 18, maxHp: 20, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    const raw = makeRawViewState({
      roomRow: { gameState: 'combat', combatState: cs },
      sessionCombatRooms: [{ id: OWN_ROOM_ID, combatState: cs, template: { name: 'Entry Chamber' } }],
    });
    const result = await assembleViewState(raw, OWN_ROOM_ID, 'combat', 'char-jeff', SESSION_ID, null);
    expect(result.remoteCombat).toBeNull();
    expect(result.combatState).not.toBeNull();
  });
});

// ─── resolveCombatAction — remote players get the full action set ─────────────

describe('resolveCombatAction — remote players are not restricted', () => {
  it('a player entry with remoteRoomInstanceId can attack normally (no observe/wait restriction)', () => {
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    const cs: CombatState = {
      round: 2,
      activeActorId: 'char-jeff',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: 'char-jeff', type: 'character', name: 'Jeff', initiative: 14, hp: 18, maxHp: 20, ac: 12, surprised: false, acted: false, proximity: 'far', status_effects: [], remoteRoomInstanceId: ENTRY_CHAMBER_ID },
        { id: 'enemy-1', type: 'enemy', name: 'Restless Dead', initiative: 9, hp: 11, maxHp: 11, ac: 13, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    const character = { id: 'char-jeff', name: 'Jeff', characterClass: 'Rogue', level: 3, baseDexterity: 14, baseStrength: 10, baseCharisma: 10, baseWisdom: 10, isHiding: false };
    const action = { action_type: 'attack' as const, target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null };

    const result = resolveCombatAction(action, cs, character, { damageDice: '1d6', weaponType: 'melee' });

    expect(result.facts[0]).toMatch(/attacked/);
    const updatedEnemy = result.updatedCombatState.initiativeOrder.find(e => e.id === 'enemy-1')!;
    expect(updatedEnemy.hp).toBeLessThan(11);
    const playerEntry = result.updatedCombatState.initiativeOrder.find(e => e.id === 'char-jeff')!;
    expect(playerEntry.remoteRoomInstanceId).toBe(ENTRY_CHAMBER_ID);
  });
});
