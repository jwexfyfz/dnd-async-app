import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: vi.fn() } } }));
vi.mock('@/lib/dice', () => ({
  rollD20Check: vi.fn(),
  abilityModifier: (score: number) => Math.floor((score - 10) / 2),
  rollDice: vi.fn(() => ({ total: 6, rolls: [6] })),
  rollInitiative: vi.fn(),
}));
vi.mock('@/lib/mechanical-damage', () => ({
  computeAttackDamage: vi.fn(() => ({ total: 5, expr: '[3]+2' })),
}));
vi.mock('@/lib/stealth', () => ({
  rollStealthCheck: vi.fn(() => 14),
}));

import { resolveCombatAction, resolveBodyDiscovery } from '../game-controller';
import { rollD20Check } from '@/lib/dice';
import { rollStealthCheck } from '@/lib/stealth';
import { computeAttackDamage } from '@/lib/mechanical-damage';
import type { CombatState, InitiativeEntry } from '@/types/v2-game';

const mockHit = { roll: 15, total: 18, success: true, critical: false, fumble: false, modifier: 3, dc: 12, dcType: 'AC' as const };
const mockMiss = { roll: 4, total: 7, success: false, critical: false, fumble: false, modifier: 3, dc: 12, dcType: 'AC' as const };
const mockCrit = { roll: 20, total: 23, success: true, critical: true, fumble: false, modifier: 3, dc: 12, dcType: 'AC' as const };

function makeChar(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'char-1',
    type: 'character',
    name: 'Tomas',
    initiative: 17,
    hp: 14,
    maxHp: 18,
    ac: 12,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    ...overrides,
  };
}

function makeEnemy(overrides: Partial<InitiativeEntry> = {}): InitiativeEntry {
  return {
    id: 'enemy-1',
    type: 'enemy',
    name: 'Guard',
    initiative: 9,
    hp: 10,
    maxHp: 10,
    ac: 13,
    surprised: false,
    acted: false,
    proximity: 'close',
    status_effects: [],
    passive_perception: 11,
    ...overrides,
  };
}

function makeCs(char: InitiativeEntry, enemy: InitiativeEntry): CombatState {
  return {
    round: 1,
    initiativeOrder: [char, enemy],
    activeActorId: char.id,
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
  };
}

// ─── Stealth Kills ────────────────────────────────────────────────────────────

describe('stealth kills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    vi.mocked(computeAttackDamage).mockReturnValue({ total: 5, expr: '[3]+2' });
  });

  it('hidden attacker + unaware target: advantage on attack (two rolls, best taken)', () => {
    const char = makeChar();
    const enemy = makeEnemy({ surprised: true });
    const cs = makeCs(char, enemy);
    vi.mocked(rollD20Check)
      .mockReturnValueOnce({ ...mockHit, roll: 8, total: 11, success: false })
      .mockReturnValueOnce({ ...mockHit, roll: 15, total: 18, success: true });
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10, isHiding: false },
      { damageDice: '1d6', weaponType: 'melee' },
    );
    expect(result.facts.some(f => f.includes('hit') || f.includes('HIT'))).toBe(true);
    expect(vi.mocked(rollD20Check)).toHaveBeenCalledTimes(2);
  });

  it('instant kill with silent weapon + hidden player: no propagation tracked (silentKillIds populated)', () => {
    vi.mocked(computeAttackDamage).mockReturnValue({ total: 999, expr: '[6]+2' });
    const char = makeChar();
    const enemy = makeEnemy({ hp: 5, maxHp: 5 });
    const cs = makeCs(char, enemy);
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Rogue', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10, isHiding: true },
      { damageDice: '1d6', weaponType: 'melee', silent: true },
    );
    expect(result.deadEnemyPoiIds).toContain('enemy-1');
    expect(result.silentKillIds.has('enemy-1')).toBe(true);
  });

  it('instant kill with non-silent weapon: silentKillIds is empty (propagation fires)', () => {
    vi.mocked(computeAttackDamage).mockReturnValue({ total: 999, expr: '[6]+2' });
    const char = makeChar();
    const enemy = makeEnemy({ hp: 5, maxHp: 5 });
    const cs = makeCs(char, enemy);
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10, isHiding: false },
      { damageDice: '1d6', weaponType: 'melee', silent: false },
    );
    expect(result.deadEnemyPoiIds).toContain('enemy-1');
    expect(result.silentKillIds.has('enemy-1')).toBe(false);
    expect(result.silentKillIds.size).toBe(0);
  });
});

// ─── Body Discovery ───────────────────────────────────────────────────────────

describe('body discovery', () => {
  it('roll beats DC 8: enemy escalates to suspicious', () => {
    const result = resolveBodyDiscovery(10, undefined, 'visible', () => 9);
    // wis 10 → mod 0, roll 9+0=9 >= DC 8
    expect(result.escalate).toBe(true);
    expect(result.dc).toBe(8);
  });

  it('roll fails DC 8: enemy unchanged', () => {
    const result = resolveBodyDiscovery(10, undefined, 'visible', () => 6);
    // roll 6+0=6 < DC 8
    expect(result.escalate).toBe(false);
  });

  it('DC 12 for partially obscured body', () => {
    const result = resolveBodyDiscovery(10, undefined, 'partial', () => 11);
    expect(result.dc).toBe(12);
    expect(result.escalate).toBe(false);
  });

  it('DC 16 for fully hidden body', () => {
    const result = resolveBodyDiscovery(10, undefined, 'full', () => 15);
    expect(result.dc).toBe(16);
    expect(result.escalate).toBe(false);
  });

  it('WIS bonus applies to roll', () => {
    // wis 14 → mod +2, roll 6+2=8 >= DC 8
    const result = resolveBodyDiscovery(14, undefined, 'visible', () => 6);
    expect(result.escalate).toBe(true);
    expect(result.roll).toBe(8);
  });
});

// ─── Prone Status Effect ──────────────────────────────────────────────────────

describe('prone status effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    vi.mocked(computeAttackDamage).mockReturnValue({ total: 5, expr: '[3]+2' });
  });

  it('melee attack vs prone target: advantage (two rolls, best taken)', () => {
    const char = makeChar();
    // enemy has high AC so a low roll misses and a high roll hits — verifies best is taken
    const enemy = makeEnemy({ status_effects: ['prone'], ac: 18 });
    const cs = makeCs(char, enemy);
    vi.mocked(rollD20Check)
      .mockReturnValueOnce({ ...mockMiss, roll: 4, total: 6, success: false })
      .mockReturnValueOnce({ ...mockHit, roll: 18, total: 20, success: true });
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      { damageDice: '1d6', weaponType: 'melee' },
    );
    // Advantage: best roll (18) taken → hit
    expect(result.facts.some(f => f.includes('hit') || f.includes('HIT'))).toBe(true);
  });

  it('ranged attack vs prone target: disadvantage (two rolls, worst taken)', () => {
    const char = makeChar();
    const enemy = makeEnemy({ status_effects: ['prone'] });
    const cs = makeCs(char, enemy);
    vi.mocked(rollD20Check)
      .mockReturnValueOnce({ ...mockHit, roll: 16, total: 19, success: true })
      .mockReturnValueOnce({ ...mockMiss, roll: 4, total: 7, success: false });
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      { damageDice: '1d4', weaponType: 'ranged' },
    );
    // Should take the miss (worst roll)
    expect(result.facts.some(f => f.includes('miss'))).toBe(true);
  });

  it('standing action (change_proximity while prone): removes prone status', () => {
    const char = makeChar({ status_effects: ['prone'] });
    const enemy = makeEnemy();
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'change_proximity', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      null,
    );
    const charEntry = result.updatedCombatState.initiativeOrder.find(e => e.id === 'char-1');
    expect(charEntry?.status_effects).not.toContain('prone');
    expect(result.facts.some(f => f.includes('stands up'))).toBe(true);
  });
});

// ─── Damage Resistances ───────────────────────────────────────────────────────

describe('damage resistances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rollD20Check).mockReturnValue(mockHit);
    vi.mocked(computeAttackDamage).mockReturnValue({ total: 10, expr: '[8]+2' });
  });

  it('attack type matches resistance: damage halved (round down)', () => {
    const char = makeChar();
    const enemy = makeEnemy({ resistances: ['melee'] });
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      { damageDice: '1d6', weaponType: 'melee' },
    );
    const enemy2 = result.updatedCombatState.initiativeOrder.find(e => e.id === 'enemy-1');
    // 10 damage halved → 5 → hp 10-5=5
    expect(enemy2?.hp).toBe(5);
    expect(result.facts.some(f => f.includes('resisted'))).toBe(true);
  });

  it('attack type not in resistance: full damage', () => {
    const char = makeChar();
    // hp=25 so it survives the 10-damage hit and stays in the order
    const enemy = makeEnemy({ hp: 25, maxHp: 25, resistances: ['ranged'] });
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'attack', target_poi_instance_id: 'enemy-1', resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Fighter', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      { damageDice: '1d6', weaponType: 'melee' },
    );
    const enemy2 = result.updatedCombatState.initiativeOrder.find(e => e.id === 'enemy-1');
    // 10 damage not resisted → hp 25-10=15
    expect(enemy2?.hp).toBe(15);
    expect(result.facts.some(f => f.includes('resisted'))).toBe(false);
  });
});

// ─── Re-hiding Mid-Combat ─────────────────────────────────────────────────────

describe('re-hiding mid-combat', () => {
  it('hide action: stealth roll vs all enemies passive perception', () => {
    vi.mocked(rollStealthCheck).mockReturnValue(14);
    const char = makeChar();
    const enemy = makeEnemy({ passive_perception: 11 });
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'hide', target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Rogue', level: 1, baseDexterity: 14, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      null,
    );
    expect(result.facts[0]).toContain('Stealth 14');
    expect(result.facts[0]).toContain('Perception 11');
  });

  it('stealth roll beats highest enemy perception: player gains hidden status', () => {
    vi.mocked(rollStealthCheck).mockReturnValue(14);
    const char = makeChar();
    const enemy = makeEnemy({ passive_perception: 11 });
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'hide', target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Rogue', level: 1, baseDexterity: 14, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      null,
    );
    expect(result.playerGainedHidden).toBe(true);
    expect(result.facts[0]).toContain('Now hidden');
  });

  it('any enemy beats stealth: no hidden status', () => {
    vi.mocked(rollStealthCheck).mockReturnValue(8);
    const char = makeChar();
    const enemy = makeEnemy({ passive_perception: 11 });
    const cs = makeCs(char, enemy);
    const result = resolveCombatAction(
      { action_type: 'hide', target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Rogue', level: 1, baseDexterity: 10, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      null,
    );
    expect(result.playerGainedHidden).toBe(false);
    expect(result.facts[0]).toContain('fails');
  });

  it('uses highest passive perception when multiple enemies', () => {
    vi.mocked(rollStealthCheck).mockReturnValue(14);
    const char = makeChar();
    const enemy1 = makeEnemy({ id: 'enemy-1', passive_perception: 11 });
    const enemy2 = makeEnemy({ id: 'enemy-2', passive_perception: 15 });
    const cs: CombatState = {
      round: 1,
      initiativeOrder: [char, enemy1, enemy2],
      activeActorId: 'char-1',
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
    };
    const result = resolveCombatAction(
      { action_type: 'hide', target_poi_instance_id: null, resulting_stance: null, interaction_result: null, target_room_template_id: null, item_id: null, target_character_id: null },
      cs,
      { id: 'char-1', name: 'Tomas', characterClass: 'Rogue', level: 1, baseDexterity: 14, baseStrength: 10, baseCharisma: 10, baseWisdom: 10 },
      null,
    );
    // stealth 14 < perception 15 → fail
    expect(result.playerGainedHidden).toBe(false);
    expect(result.facts[0]).toContain('Perception 15');
  });
});
