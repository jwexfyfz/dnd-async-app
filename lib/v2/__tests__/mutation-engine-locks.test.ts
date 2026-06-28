import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('crypto')>()),
  randomInt: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { randomInt } from 'crypto';
import { mutateGameState } from '../mutation-engine';
import type { CharacterContext } from '../mutation-engine';
import type { ExtractedAction, ItemDefinition } from '@/types/v2-game';

const roomInstanceId = 'room-1';
const sessionId = 'session-1';
const validPoiMap = new Map([['poi-1', 'Iron-Bound Chest']]);
const exitPoiMap = new Map<string, string>();
const openSpacePoiId: string | null = null;

function makeCharacter(overrides: Partial<CharacterContext> = {}): CharacterContext {
  return {
    id: 'char-1',
    name: 'Tomas',
    characterClass: 'Fighter',
    level: 3,
    skillsModifiers: { Athletics: 4 },
    skillProficiencies: [],
    baseWisdom: 10,
    baseDexterity: 14,
    baseStrength: 14,
    baseCharisma: 10,
    currentHp: 10,
    maxHp: 10,
    isHiding: false,
    ...overrides,
  };
}

function makePoi({
  id = 'poi-1',
  name = 'Iron-Bound Chest',
  defaultProperties = {},
  currentProperties = {},
}: {
  id?: string;
  name?: string;
  defaultProperties?: Record<string, unknown>;
  currentProperties?: Record<string, unknown>;
} = {}) {
  return {
    id,
    currentProperties,
    template: { name, defaultProperties },
  };
}

function makeAction(overrides: Partial<ExtractedAction> = {}): ExtractedAction {
  return {
    action_type: 'force_open',
    target_poi_instance_id: 'poi-1',
    resulting_stance: null,
    interaction_result: null,
    target_room_template_id: null,
    item_id: null,
    target_character_id: null,
    ...overrides,
  };
}

function makeTx() {
  return {
    poiInstance: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(makePoi()),
      update: vi.fn().mockResolvedValue({}),
    },
    messageLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    character: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        inventory: { bag: [], equipped: {} },
        currentHp: 10,
        maxHp: 10,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

let currentTx: ReturnType<typeof makeTx>;

beforeEach(() => {
  vi.clearAllMocks();
  currentTx = makeTx();
  (prisma.$transaction as any).mockImplementation((fn: any) => fn(currentTx));
});

function findRollResultCall() {
  return currentTx.messageLog.create.mock.calls.find(
    ([arg]: any) => arg.data.mechanicalSummary?.type === 'roll_result',
  );
}

// ─── force_open ─────────────────────────────────────────────────────────────

describe('mutateGameState — force_open', () => {
  it('success: unlocks + destroys the POI, reveals hidden items, writes roll_result with rolls[]', async () => {
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: {
        locked_by: ['rusty_key'],
        lock_dc: 14,
        items: [{ id: 'gem', name: 'Gem', hidden: true }],
      },
      currentProperties: {},
    }));
    (randomInt as any).mockReturnValue(15); // 15 + Athletics(4) = 19 = breakDc (14+5)

    const character = makeCharacter();
    const result = await mutateGameState(
      [makeAction({ action_type: 'force_open' })],
      character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
    );

    expect(currentTx.poiInstance.update).toHaveBeenCalledTimes(1);
    const updateArg = currentTx.poiInstance.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'poi-1' });
    expect(updateArg.data.currentProperties.unlocked).toBe(true);
    expect(updateArg.data.currentProperties.destroyed).toBe(true);
    expect(updateArg.data.currentProperties.revealed_items).toContain('gem');

    const rollCall = findRollResultCall();
    expect(rollCall).toBeDefined();
    expect(rollCall![0].data.mechanicalSummary.rolls[0]).toMatchObject({
      item: 'Lock',
      skill: 'Athletics',
      d20: 15,
      modifier: 4,
      total: 19,
      dc: 19,
      success: true,
      poi: 'Iron-Bound Chest',
    });

    expect(result.appliedActions[0].overrideFact).toContain('Iron-Bound Chest');
    expect(result.appliedActions[0].overrideFact).toContain('Gem');
  });

  it('failure: state unchanged (no poiInstance.update), roll logged as failure, overrideFact mentions retry', async () => {
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: { locked_by: ['rusty_key'], lock_dc: 14 },
      currentProperties: {},
    }));
    (randomInt as any).mockReturnValue(5); // 5 + Athletics(4) = 9 < breakDc (19)

    const character = makeCharacter();
    const result = await mutateGameState(
      [makeAction({ action_type: 'force_open' })],
      character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
    );

    expect(currentTx.poiInstance.update).not.toHaveBeenCalled();

    const rollCall = findRollResultCall();
    expect(rollCall![0].data.mechanicalSummary.rolls[0].success).toBe(false);

    expect(result.appliedActions[0].overrideFact).toContain('remains locked');
  });

  it('throws when the POI is not lockable', async () => {
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: {},
      currentProperties: {},
    }));

    const character = makeCharacter();
    await expect(
      mutateGameState(
        [makeAction({ action_type: 'force_open' })],
        character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
      ),
    ).rejects.toThrow(/isn't locked/);
  });

  it('throws when the POI is already unlocked', async () => {
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: { locked_by: ['key'] },
      currentProperties: { unlocked: true },
    }));

    const character = makeCharacter();
    await expect(
      mutateGameState(
        [makeAction({ action_type: 'force_open' })],
        character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
      ),
    ).rejects.toThrow(/already unlocked/);
  });

  it('uses break_dc override instead of lock_dc + 5', async () => {
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: { locked_by: ['key'], lock_dc: 14, break_dc: 25 },
      currentProperties: {},
    }));
    (randomInt as any).mockReturnValue(10);

    const character = makeCharacter();
    await mutateGameState(
      [makeAction({ action_type: 'force_open' })],
      character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
    );

    const rollCall = findRollResultCall();
    expect(rollCall![0].data.mechanicalSummary.rolls[0].dc).toBe(25);
  });
});

// ─── lockpick (use_item) ────────────────────────────────────────────────────

describe('mutateGameState — use_item lockpick', () => {
  const thievesTools: ItemDefinition = {
    id: 'thieves_tools',
    name: "Thieves' Tools",
    use_effect: 'lockpick',
  };

  it('success (proficient): rolls[] reflects success and unlocks the POI', async () => {
    currentTx.character.findUniqueOrThrow.mockResolvedValue({
      inventory: { bag: [thievesTools], equipped: {} },
      currentHp: 10,
      maxHp: 10,
    });
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: { locked_by: ['rusty_key'], lock_dc: 14 },
      currentProperties: {},
    }));
    // dexMod (+2) + profBonus (+2 at level 3) + d20(15) = 19 >= DC 14
    (randomInt as any).mockReturnValue(15);

    const character = makeCharacter({
      baseDexterity: 14,
      level: 3,
      skillProficiencies: ['Thieves Tools'],
    });
    await mutateGameState(
      [makeAction({ action_type: 'use_item', item_id: 'thieves_tools', target_poi_instance_id: 'poi-1' })],
      character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
    );

    const rollCall = findRollResultCall();
    expect(rollCall).toBeDefined();
    const summary = rollCall![0].data.mechanicalSummary;
    expect(Array.isArray(summary.rolls)).toBe(true);
    expect(summary.d20).toBeUndefined();
    expect(summary.dc).toBeUndefined();
    expect(summary.rolls[0]).toMatchObject({
      item: 'Lock',
      skill: "Thieves' Tools",
      d20: 15,
      modifier: 4,
      total: 19,
      dc: 14,
      success: true,
      poi: 'Iron-Bound Chest',
    });

    expect(currentTx.poiInstance.update).toHaveBeenCalledTimes(1);
    expect(currentTx.poiInstance.update.mock.calls[0][0].data.currentProperties.unlocked).toBe(true);
  });

  it('failure (no proficiency): rolls[] reflects failure and the POI is left unchanged', async () => {
    currentTx.character.findUniqueOrThrow.mockResolvedValue({
      inventory: { bag: [thievesTools], equipped: {} },
      currentHp: 10,
      maxHp: 10,
    });
    currentTx.poiInstance.findUniqueOrThrow.mockResolvedValue(makePoi({
      defaultProperties: { locked_by: ['rusty_key'], lock_dc: 14 },
      currentProperties: {},
    }));
    // dexMod (0) + no proficiency bonus + d20(5) = 5 < DC 14
    (randomInt as any).mockReturnValue(5);

    const character = makeCharacter({
      baseDexterity: 10,
      level: 3,
      skillProficiencies: [],
    });
    await mutateGameState(
      [makeAction({ action_type: 'use_item', item_id: 'thieves_tools', target_poi_instance_id: 'poi-1' })],
      character, roomInstanceId, sessionId, exitPoiMap, validPoiMap, openSpacePoiId,
    );

    const rollCall = findRollResultCall();
    const summary = rollCall![0].data.mechanicalSummary;
    expect(Array.isArray(summary.rolls)).toBe(true);
    expect(summary.rolls[0]).toMatchObject({
      item: 'Lock',
      skill: "Thieves' Tools",
      d20: 5,
      modifier: 0,
      total: 5,
      dc: 14,
      success: false,
      poi: 'Iron-Bound Chest',
    });

    expect(currentTx.poiInstance.update).not.toHaveBeenCalled();
  });
});
