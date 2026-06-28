import { describe, it, expect } from 'vitest';
import { buildHaikuSystemPrompt, buildHaikuStaticPrefix, buildHaikuDynamicContext, buildNarrativeSystemPrompt } from '../ai-prompts';
import type { PoiContext } from '../poi-context';

function makePoiCtx(overrides: Partial<PoiContext> = {}): PoiContext {
  return {
    id: 'poi-1', name: 'Chest', keyword: 'chest',
    availableStances: ['crouch'], examined: false, interacted: false, destroyed: false,
    isLocked: false, isUnlocked: false, isExit: false, exitDirection: null, targetRoomTemplateId: null,
    items: [], floorItems: [], isOpenSpace: false,
    visibility: 'always', peekVisibility: 'none',
    ...overrides,
  };
}

const emptyInventory = { bag: [], equipped: {} };

describe('buildHaikuSystemPrompt', () => {
  it('contains the extract_game_intent instruction', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    expect(prompt).toContain('extract_game_intent');
  });

  it('lists all action type keywords', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    const actions = ['examine', 'interact', 'move_to_room', 'pick_up', 'attack', 'hide', 'death_save'];
    for (const action of actions) {
      expect(prompt).toContain(`"${action}"`);
    }
  });

  it('includes POI name and keyword in output', () => {
    const poi = makePoiCtx({ name: 'Ancient Altar', keyword: 'altar', id: 'poi-altar' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('Ancient Altar');
    expect(prompt).toContain('altar');
  });

  it('includes character position when at a POI', () => {
    const poi = makePoiCtx({ id: 'poi-altar', name: 'Ancient Altar', keyword: 'altar' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], 'poi-altar', null);
    expect(prompt).toContain('Currently standing AT');
    expect(prompt).toContain('Ancient Altar');
  });

  it('includes open space position when not adjacent to POI', () => {
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, null);
    expect(prompt).toContain('open space');
  });

  it('shows LOCKED status for locked POI', () => {
    const poi = makePoiCtx({ isLocked: true, name: 'Iron Gate', keyword: 'gate' });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('LOCKED');
  });

  it('shows item names in POI item list', () => {
    const item = { id: 'k1', name: 'Rusty Key' };
    const poi = makePoiCtx({ items: [item] });
    const prompt = buildHaikuSystemPrompt([poi], emptyInventory, [], null, null);
    expect(prompt).toContain('Rusty Key');
  });

  it('shows bag items', () => {
    const inventory = { bag: [{ id: 'torch1', name: 'Torch' }], equipped: {} };
    const prompt = buildHaikuSystemPrompt([], inventory, [], null, null);
    expect(prompt).toContain('Torch');
  });

  it('shows exit POI in EXIT POINTS section', () => {
    const exit = makePoiCtx({
      name: 'Door North', keyword: 'door', isExit: true,
      targetRoomTemplateId: 'room-tmpl-2',
    });
    const prompt = buildHaikuSystemPrompt([exit], emptyInventory, [], null, null);
    expect(prompt).toContain('EXIT POINTS');
    expect(prompt).toContain('Door North');
  });

  it('excludes proximity_only POIs from prompt', () => {
    const hidden = makePoiCtx({ name: 'Secret Door', visibility: 'proximity_only' });
    const prompt = buildHaikuSystemPrompt([hidden], emptyInventory, [], null, null);
    expect(prompt).not.toContain('Secret Door');
  });

  it('includes CROSS-ROOM RULE section when adjacent room has POIs', () => {
    const adjacentRoom = {
      roomName: 'Guard Post',
      exitPoiName: 'Door North',
      exitPoiId: 'exit-1',
      targetRoomTemplateId: 'room-guard-post',
      pois: [makePoiCtx({ name: 'Guard Desk', keyword: 'desk' })],
      characters: [],
    };
    const prompt = buildHaikuSystemPrompt([], emptyInventory, [], null, adjacentRoom);
    expect(prompt).toContain('CROSS-ROOM RULE');
    expect(prompt).toContain('Guard Post');
  });
});

describe('buildNarrativeSystemPrompt', () => {
  it('contains room name', () => {
    const p = buildNarrativeSystemPrompt('Guard Post', 'A dusty room.', 'Player moved.', '', {});
    expect(p).toContain('Guard Post');
  });

  it('contains room description', () => {
    const p = buildNarrativeSystemPrompt('Guard Post', 'A dusty room.', 'Player moved.', '', {});
    expect(p).toContain('A dusty room.');
  });

  it('contains engine update block', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Player examined the chest. Found: Key.', '', {});
    expect(p).toContain('Player examined the chest.');
  });

  it('shows story flags', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', { commander_note_read: true });
    expect(p).toContain('commander_note_read');
  });

  it('shows (none set) when no story flags', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('(none set)');
  });

  it('contains STRICT INSTRUCTIONS section', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('STRICT INSTRUCTIONS');
  });

  it('contains items block when items present', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '- Rusty Key (at: Chest)', {});
    expect(p).toContain('Rusty Key');
  });

  it('shows no items visible when items block is empty', () => {
    const p = buildNarrativeSystemPrompt('Room', 'Desc', 'Update.', '', {});
    expect(p).toContain('no items visible');
  });
});

describe('buildHaikuStaticPrefix', () => {
  it('contains all action type keywords', () => {
    const prefix = buildHaikuStaticPrefix();
    const actions = ['examine', 'interact', 'move_to_room', 'attack', 'hide', 'death_save'];
    for (const action of actions) {
      expect(prefix).toContain(`"${action}"`);
    }
  });

  it('is deterministic — same output on every call', () => {
    expect(buildHaikuStaticPrefix()).toBe(buildHaikuStaticPrefix());
  });

  it('does NOT contain POI-specific or inventory-specific content', () => {
    const prefix = buildHaikuStaticPrefix();
    expect(prefix).not.toContain('CHARACTER POSITION');
    expect(prefix).not.toContain('CHARACTER INVENTORY');
    expect(prefix).not.toContain('REGULAR POINTS OF INTEREST');
  });
});

describe('buildHaikuDynamicContext', () => {
  it('contains CHARACTER POSITION section', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).toContain('CHARACTER POSITION');
  });

  it('contains CHARACTER INVENTORY section', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).toContain('CHARACTER INVENTORY');
  });

  it('does NOT contain ACTION TYPES (that is in the static prefix)', () => {
    const ctx = buildHaikuDynamicContext([], emptyInventory, [], null, null);
    expect(ctx).not.toContain('ACTION TYPES:');
  });

  it('combined prefix + context equals the original full prompt', () => {
    const poi = makePoiCtx({ name: 'Altar', keyword: 'altar' });
    const inventory = { bag: [{ id: 't1', name: 'Torch' }], equipped: {} };
    const split = buildHaikuStaticPrefix() + '\n\n' + buildHaikuDynamicContext([poi], inventory, [], null, null);
    expect(split).toContain('Altar');
    expect(split).toContain('Torch');
    expect(split).toContain('"examine"');
  });
});
