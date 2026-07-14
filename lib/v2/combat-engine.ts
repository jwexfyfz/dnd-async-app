import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { abilityModifier, rollD20Check, rollDice } from '@/lib/dice';
import { computeAttackDamage } from '@/lib/mechanical-damage';
import { rollStealthCheck } from '@/lib/stealth';
import { rollInitiative } from '@/lib/initiative';
import { prisma } from '@/lib/prisma';
import { slotGridDistance } from '@/lib/v2/room-geometry';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';
import type { CombatState, InitiativeEntry, ExtractedAction, CharacterInventory } from '@/types/v2-game';
import type { PoiContext, PoiCombatStats, AiBehavior } from '@/lib/v2/poi-context';

// ─── Combat: Enter / Exit ─────────────────────────────────────────────────────

async function isCharacterEnrolledInAnySessionCombat(
  characterId: string,
  sessionId: string,
  excludeRoomInstanceId?: string,
): Promise<boolean> {
  const combatRooms = await prisma.roomInstance.findMany({
    where: {
      sessionId,
      gameState: 'combat',
      ...(excludeRoomInstanceId ? { id: { not: excludeRoomInstanceId } } : {}),
    },
    select: { combatState: true },
  });
  return combatRooms.some(room => {
    const cs = room.combatState as { initiativeOrder?: Array<{ id: string }> } | null;
    return cs?.initiativeOrder?.some(e => e.id === characterId) ?? false;
  });
}

export function detectCombatTrigger(
  extractedAction: ExtractedAction,
  poiContexts: PoiContext[],
  sessionGameState: string,
  storyFlags: Record<string, unknown>,
): boolean {
  if (extractedAction.action_type === 'attack') {
    // Only trigger combat if there is at least one living enemy in this room.
    // Prevents entering an empty combat when the player attacks through LoS into an adjacent room.
    return poiContexts.some(poi => {
      const awareness = (poi as unknown as { _currentAwareness?: string })._currentAwareness;
      return awareness !== undefined && awareness !== null && awareness !== 'dead';
    });
  }
  if (sessionGameState !== 'exploration') return false;
  for (const poi of poiContexts) {
    const dp = (poi as unknown as { _defaultProps?: Record<string, unknown> })._defaultProps;
    const awareness = poi._currentAwareness;
    if (!awareness) continue;
    if (awareness !== 'alert') continue;
    const hostileTo = poi._hostileTo as string[] | undefined;
    if (!hostileTo || hostileTo.length === 0) continue;
    const recognitionException = poi._recognitionException as string | undefined;
    if (recognitionException && storyFlags[recognitionException]) continue;
    return true;
  }
  return false;
}

export async function enterCombat(
  roomInstance: {
    id: string;
    roomTemplateId: string;
    template: { name: string };
    poiInstances: Array<{ id: string; poiTemplateId: string; currentProperties: unknown; template: { defaultProperties: unknown; name: string; grid_slot?: string | null } }>;
  },
  sessionId: string,
): Promise<CombatState> {
  const DORMANT_MS = 48 * 60 * 60 * 1000;

  // Already-in-combat guard
  const roomRow = await prisma.roomInstance.findUnique({ where: { id: roomInstance.id }, select: { gameState: true, combatState: true } });
  if (roomRow?.gameState === 'combat' && roomRow.combatState) {
    return roomRow.combatState as unknown as CombatState;
  }

  // Load all room participants with character stats + lastActiveAt
  const roomParticipants = await prisma.roomParticipant.findMany({
    where: { roomInstanceId: roomInstance.id },
    include: {
      character: {
        select: { id: true, name: true, baseDexterity: true, baseConstitution: true, currentHp: true, maxHp: true },
      },
    },
  });

  // Collect alert enemies (skip already-dead ones)
  const alertEnemies: Array<{ poiInstanceId: string; name: string; combatStats: PoiCombatStats; currentHp: number; ac: number }> = [];
  for (const poi of roomInstance.poiInstances) {
    const dp = poi.template.defaultProperties as Record<string, unknown>;
    const cp = poi.currentProperties as Record<string, unknown>;
    if (cp.awareness_state !== 'alert') continue;
    const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
    const maxHp = combatStats.max_hp ?? 10;
    const currentHp = typeof cp.current_hp === 'number' ? cp.current_hp : maxHp;
    if (currentHp <= 0) continue;
    alertEnemies.push({ poiInstanceId: poi.id, name: poi.template.name, combatStats, currentHp, ac: combatStats.ac ?? 10 });
  }

  // Build actors for initiative
  const actors = [
    ...roomParticipants.map(rp => ({
      actorId: rp.characterId,
      actorType: 'CHARACTER' as const,
      dexterity: rp.character.baseDexterity,
    })),
    ...alertEnemies.map(e => ({
      actorId: e.poiInstanceId,
      actorType: 'ENEMY' as const,
      dexterity: e.combatStats.dex_score ?? 10,
    })),
  ];

  const slots = rollInitiative(actors);

  // Check unaware enemies (surprised)
  const unawarePoiIds = new Set(
    roomInstance.poiInstances
      .filter(pi => (pi.currentProperties as Record<string, unknown>).awareness_state === 'unaware')
      .map(pi => pi.id),
  );

  // Build initiative order with isDormant stamping
  const initiativeOrder: InitiativeEntry[] = slots.map(slot => {
    const rp = roomParticipants.find(p => p.characterId === slot.actorId);
    if (rp) {
      return {
        id: rp.characterId,
        type: 'character',
        name: rp.character.name,
        initiative: slot.initiative,
        hp: rp.character.currentHp,
        maxHp: rp.character.maxHp,
        ac: 10 + abilityModifier(rp.character.baseDexterity),
        surprised: false,
        acted: false,
        proximity: 'close',
        status_effects: [],
        constitutionSave: abilityModifier(rp.character.baseConstitution),
        isDormant: Date.now() - rp.lastActiveAt.getTime() > DORMANT_MS,
      };
    }
    const enemy = alertEnemies.find(e => e.poiInstanceId === slot.actorId)!;
    const enemyPoi = roomInstance.poiInstances.find(p => p.id === slot.actorId);
    return {
      id: slot.actorId,
      type: 'enemy',
      name: enemy.name,
      initiative: slot.initiative,
      hp: enemy.currentHp,
      maxHp: enemy.combatStats.max_hp ?? 10,
      ac: enemy.ac,
      surprised: unawarePoiIds.has(slot.actorId),
      acted: false,
      proximity: 'close',
      grid_slot: enemyPoi?.template.grid_slot ?? 'C',
      status_effects: [],
      str_score: enemy.combatStats.str_score,
      resistances: enemy.combatStats.resistances ?? [],
      passive_perception: enemy.combatStats.passive_perception ?? (10 + abilityModifier(enemy.combatStats.wis_score ?? 10)),
    };
  });

  // ─── LoS scan: enroll adjacent allies, collect alert rooms ─────────────────
  const outsideParticipants = await prisma.roomParticipant.findMany({
    where: {
      roomInstance: { sessionId },
      roomInstanceId: { not: roomInstance.id },
    },
    include: {
      character: {
        select: { id: true, name: true, baseDexterity: true, currentHp: true, maxHp: true, isHiding: true },
      },
      roomInstance: {
        include: { poiInstances: { include: { template: true } } },
      },
    },
  });

  const enrolledIds = new Set(initiativeOrder.map(e => e.id));

  for (const outsideP of outsideParticipants) {
    const char = outsideP.character;
    if (char.currentHp <= 0) continue;
    if (enrolledIds.has(char.id)) continue;
    if (await isCharacterEnrolledInAnySessionCombat(char.id, sessionId, roomInstance.id)) continue;

    // S7: already in own combat — they get an alert (handled below) but not enrolled
    const adjGameState = (outsideP.roomInstance as { gameState: string }).gameState;
    if (adjGameState === 'combat') continue;

    // Check for LoS exit in their room leading to the combat room
    let losExitGridSlot: string | null = null;
    for (const poi of outsideP.roomInstance.poiInstances) {
      const dp = poi.template.defaultProperties as Record<string, unknown>;
      if (dp.poi_type !== 'exit') continue;
      const enterVerb = dp.enter as Record<string, unknown> | undefined;
      if (enterVerb?.target_room_template_id !== roomInstance.roomTemplateId) continue;
      const cp = poi.currentProperties as Record<string, unknown>;
      const effectivePeek = computeEffectivePeek(
        (dp.peek_visibility as string) ?? 'none',
        computeIsLockable(dp.locked_by) && cp.unlocked !== true,
        cp.interacted === true,
        cp.destroyed === true,
      );
      if (effectivePeek === 'full' || effectivePeek === 'obvious_only') {
        losExitGridSlot = poi.template.grid_slot ?? 'C';
        break;
      }
    }
    if (!losExitGridSlot) continue;

    // LoS ally: enrolled as a remote participant — stays physically in their own room.
    // roomParticipant.roomInstanceId is never changed for LoS allies (no-teleport redesign).
    const losSlots = rollInitiative([{ actorId: char.id, actorType: 'CHARACTER' as const, dexterity: char.baseDexterity }]);
    const hidingEffects = char.isHiding ? ['hiding'] : [];
    initiativeOrder.push({
      id: char.id,
      type: 'character',
      name: char.name,
      initiative: losSlots[0].initiative,
      hp: char.currentHp,
      maxHp: char.maxHp,
      ac: 10 + abilityModifier(char.baseDexterity),
      surprised: false,
      acted: false,
      proximity: 'far',
      grid_slot: losExitGridSlot,
      status_effects: hidingEffects,
      isDormant: Date.now() - outsideP.lastActiveAt.getTime() > DORMANT_MS,
      remoteRoomInstanceId: outsideP.roomInstanceId,
    });
    enrolledIds.add(char.id);
    console.log(`[stage3:combat] LoS remote-enroll — char=${char.name} fromRoom=${outsideP.roomInstanceId} slot=${losExitGridSlot} initiative=${losSlots[0].initiative}`);
  }

  // Sort final initiative order descending
  initiativeOrder.sort((a, b) => b.initiative - a.initiative);

  // Collect rooms to alert: outside participants who are alive and not enrolled
  const alertRoomIds = new Map<string, void>();
  for (const outsideP of outsideParticipants) {
    if (outsideP.character.currentHp <= 0) continue;
    if (enrolledIds.has(outsideP.character.id)) continue;
    alertRoomIds.set(outsideP.roomInstanceId, undefined);
  }

  // First valid (non-dormant, non-dead) actor goes first
  const firstValid = initiativeOrder.find(e => !e.isDormant && !(e.type === 'enemy' && e.hp <= 0));
  const combatState: CombatState = {
    round: 1,
    initiativeOrder,
    activeActorId: firstValid?.id ?? initiativeOrder[0]?.id ?? '',
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
  };

  // Build the rich roll breakdown for the combat_start message (same-room actors only)
  const initiativeRolls = slots.map(slot => {
    const entry = initiativeOrder.find(e => e.id === slot.actorId);
    return {
      id: slot.actorId,
      name: entry?.name ?? slot.actorId,
      type: slot.actorType === 'CHARACTER' ? 'character' : 'enemy',
      d20Roll: slot.d20Roll,
      modifier: slot.modifier,
      initiative: slot.initiative,
    };
  });

  const fightingNames = initiativeOrder.filter(e => e.type === 'character').map(e => e.name);

  await Promise.all([
    prisma.roomInstance.update({
      where: { id: roomInstance.id },
      data: { gameState: 'combat', combatState: combatState as object },
    }),
    prisma.messageLog.create({
      data: {
        roomInstanceId: roomInstance.id,
        isMechanicalEvent: false,
        mechanicalSummary: {
          type: 'combat_start',
          round: 1,
          initiativeRolls,
          activeActorId: combatState.activeActorId,
        },
        text: `[COMBAT] Initiative rolled — ${initiativeRolls.map(r => `${r.name} ${r.d20Roll}${r.modifier !== 0 ? (r.modifier > 0 ? `+${r.modifier}` : `${r.modifier}`) : ''}=${r.initiative}`).join(', ')}. First to act: ${initiativeOrder.find(e => e.id === combatState.activeActorId)?.name ?? 'unknown'}.`,
      },
    }),
    ...[...alertRoomIds.keys()].map(rid =>
      prisma.messageLog.create({
        data: {
          roomInstanceId: rid,
          isMechanicalEvent: false,
          mechanicalSummary: { type: 'combat_alert', roomName: roomInstance.template.name, fightingCharacters: fightingNames },
          text: `[COMBAT] Nearby combat — ${fightingNames.length > 0 ? fightingNames.join(', ') + (fightingNames.length === 1 ? ' is' : ' are') + ' fighting in ' + roomInstance.template.name : 'Combat started in ' + roomInstance.template.name}.`,
        },
      })
    ),
  ]);

  console.log(`[stage3:combat] entering combat — room=${roomInstance.id} pcs=${roomParticipants.length} enemies=${alertEnemies.length} losAllies=${initiativeOrder.filter(e => e.type === 'character').length - roomParticipants.length} alertRooms=${alertRoomIds.size}`);
  console.log(`[stage3:initiative] order=[${initiativeOrder.map(e => e.name).join(' → ')}]`);

  return combatState;
}

export async function exitCombat(roomInstanceId: string): Promise<void> {
  await prisma.roomInstance.update({
    where: { id: roomInstanceId },
    data: { gameState: 'exploration', combatState: Prisma.JsonNull },
  });
  console.log('[stage3:combat] combat ended — all enemies dead');
}

export async function joinCombat(
  characterId: string,
  roomInstanceId: string,
  resolvedIsHiding: boolean,
  enrolledFromRoomId?: string,
): Promise<void> {
  const [roomRow, character] = await Promise.all([
    prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      select: { combatState: true, gameState: true, sessionId: true },
    }),
    prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, name: true, baseDexterity: true, baseConstitution: true, currentHp: true, maxHp: true },
    }),
  ]);

  if (!roomRow || roomRow.gameState !== 'combat' || !roomRow.combatState || !character) return;
  if (character.currentHp <= 0) return;

  const cs = roomRow.combatState as unknown as CombatState;

  const existingEntry = cs.initiativeOrder.find(e => e.id === characterId);

  // Physical arrival: a remote-enrolled LoS ally walks into the combat room —
  // clear remoteRoomInstanceId and mark them as physically present. No new
  // initiative roll; they keep their existing slot in the turn order.
  if (existingEntry) {
    if (!existingEntry.remoteRoomInstanceId) return; // already fully present — no-op
    // Still remote and being re-enrolled from outside (e.g. LoS re-check) — no-op.
    if (enrolledFromRoomId) return;

    const updatedOrder = cs.initiativeOrder.map(e => {
      if (e.id !== characterId) return e;
      const updated: InitiativeEntry = {
        ...e,
        proximity: 'close',
        isDormant: false,
        status_effects: resolvedIsHiding
          ? Array.from(new Set([...e.status_effects, 'hiding']))
          : e.status_effects.filter(s => s !== 'hiding'),
      };
      delete updated.remoteRoomInstanceId;
      return updated;
    });

    await Promise.all([
      prisma.roomInstance.update({
        where: { id: roomInstanceId },
        data: { combatState: { ...cs, initiativeOrder: updatedOrder } as object },
      }),
      prisma.messageLog.create({
        data: {
          roomInstanceId,
          characterId,
          isMechanicalEvent: false,
          mechanicalSummary: { type: 'join_combat', round: cs.round, arrival: true },
          text: `[COMBAT] ${character.name} arrives in the fight.`,
        },
      }),
    ]);

    console.log(`[stage3:combat] joinCombat — char=${character.name} arrived physically (was remote, now at slot ${existingEntry.grid_slot ?? 'C'})`);
    return;
  }

  // Double-enrollment guard
  if (await isCharacterEnrolledInAnySessionCombat(characterId, roomRow.sessionId, roomInstanceId)) return;

  const dexMod = abilityModifier(character.baseDexterity);
  const slots = rollInitiative([{ actorId: characterId, actorType: 'CHARACTER' as const, dexterity: character.baseDexterity }]);
  const slot = slots[0];
  const newInitiative = slot.initiative;

  // §G: if new initiative > active actor's initiative, that slot has already passed this round
  const activeEntry = cs.initiativeOrder.find(e => e.id === cs.activeActorId);
  const slotAlreadyPassed = activeEntry ? newInitiative > activeEntry.initiative : false;

  const newEntry: InitiativeEntry = {
    id: characterId,
    type: 'character',
    name: character.name,
    initiative: newInitiative,
    hp: character.currentHp,
    maxHp: character.maxHp,
    ac: 10 + dexMod,
    surprised: false,
    acted: slotAlreadyPassed,
    proximity: 'close',
    grid_slot: 'C',
    status_effects: resolvedIsHiding ? ['hiding'] : [],
    constitutionSave: abilityModifier(character.baseConstitution),
    isDormant: false,
    ...(enrolledFromRoomId ? { remoteRoomInstanceId: enrolledFromRoomId } : {}),
  };

  const insertIdx = cs.initiativeOrder.findIndex(e => e.initiative < newInitiative);
  const newOrder = insertIdx === -1
    ? [...cs.initiativeOrder, newEntry]
    : [...cs.initiativeOrder.slice(0, insertIdx), newEntry, ...cs.initiativeOrder.slice(insertIdx)];

  const slotPosition = insertIdx === -1 ? newOrder.length : insertIdx + 1;
  const modStr = dexMod > 0 ? `+${dexMod}` : dexMod < 0 ? `${dexMod}` : '';

  await Promise.all([
    prisma.roomInstance.update({
      where: { id: roomInstanceId },
      data: { combatState: { ...cs, initiativeOrder: newOrder } as object },
    }),
    prisma.messageLog.create({
      data: {
        roomInstanceId,
        characterId,
        isMechanicalEvent: false,
        mechanicalSummary: {
          type: 'join_combat',
          round: cs.round,
          d20: slot.d20Roll,
          modifier: dexMod,
          total: newInitiative,
          slotPosition,
        },
        text: `[COMBAT] ${character.name} joins the fight — Round ${cs.round}. Initiative: ${slot.d20Roll}${modStr}=${newInitiative} (slot #${slotPosition}).`,
      },
    }),
  ]);

  console.log(`[stage3:combat] joinCombat — char=${character.name} initiative=${newInitiative} slot=${slotPosition} acted=${slotAlreadyPassed}`);
}

// ─── Combat: Opportunity Attacks (Phase 5) ───────────────────────────────────

export interface OpportunityAttackResult {
  facts: string[];
  hpDamage: number;
  updatedCombatState: CombatState;
  rollData: NonNullable<EnemyTurnResult['rollData']>[];
}

export function resolveOpportunityAttacks(
  cs: CombatState,
  characterId: string,
  characterName: string,
  poiInstances: Array<{ id: string; template: { defaultProperties: unknown } }>,
): OpportunityAttackResult {
  const facts: string[] = [];
  const rollData: NonNullable<EnemyTurnResult['rollData']>[] = [];
  let hpDamage = 0;

  const playerEntry = cs.initiativeOrder.find(e => e.id === characterId);
  const hasDisengaged = playerEntry?.status_effects.includes('disengaged') ?? false;
  const isRemote = !!playerEntry?.remoteRoomInstanceId;
  if (hasDisengaged || isRemote) {
    return { facts, hpDamage, updatedCombatState: cs, rollData };
  }

  const charAc = playerEntry?.ac ?? 10;
  let order = cs.initiativeOrder.map(e => ({ ...e }));

  for (let i = 0; i < order.length; i++) {
    const entry = order[i];
    if (entry.type !== 'enemy') continue;
    if (entry.proximity !== 'close') continue;
    if (entry.reactionUsed) continue;
    if (entry.hp <= 0) continue;

    const poi = poiInstances.find(p => p.id === entry.id);
    const dp = (poi?.template?.defaultProperties ?? {}) as Record<string, unknown>;
    const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
    const attackBonus = combatStats.attack_bonus ?? 0;
    const damageDice = combatStats.damage ?? '1d4';

    const roll = rollD20Check(attackBonus, charAc, 'AC');
    order[i] = { ...entry, reactionUsed: true };

    if (roll.fumble) {
      facts.push(`${entry.name} swings at ${characterName} (opportunity) — rolled 1, miss.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=1 hit=false damage=0`);
      rollData.push({ type: 'combat_roll', action: `${entry.name} opportunity attack`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${charAc}`, success: false });
    } else if (roll.success || roll.critical) {
      const { total: damage, expr: dmgExpr } = computeAttackDamage(damageDice, 0, roll.critical);
      hpDamage += damage;
      facts.push(`${entry.name} strikes ${characterName} as they flee — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${charAc}, hit, dealt ${damage} damage.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=${roll.roll} vs AC=${charAc} hit=true damage=${dmgExpr}=${damage}`);
      rollData.push({ type: 'combat_roll', action: `${entry.name} opportunity attack`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${charAc}`, success: true, isCrit: roll.critical || undefined, damageRoll: { dice: `${damageDice}${roll.critical ? ' ×2' : ''}`, expr: dmgExpr, total: damage } });
    } else {
      facts.push(`${entry.name} swings at ${characterName} (opportunity) — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${charAc}, miss.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=${roll.roll} vs AC=${charAc} hit=false damage=0`);
      rollData.push({ type: 'combat_roll', action: `${entry.name} opportunity attack`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${charAc}`, success: false });
    }
  }

  return { facts, hpDamage, updatedCombatState: { ...cs, initiativeOrder: order }, rollData };
}

// ─── Combat: Enemy AI Turn Resolution (Phase 4) ──────────────────────────────

export interface EnemyTurnResult {
  facts: string[];
  hpDamage: number;
  deathSaveAutoFailures?: number;
  updatedEntry: InitiativeEntry;
  concentrationBreak?: { broke: boolean; fact: string };
  rollData?: {
    type: 'combat_roll';
    action: string;
    d20: number;
    modifier: number;
    total: number;
    vsTarget: string;
    success: boolean;
    isCrit?: boolean;
    damageRoll?: { dice: string; expr: string; total: number };
    rollMode?: 'advantage' | 'disadvantage';
    d20Rolls?: [number, number];
  };
}

export function resolveEnemyTurn(
  entry: InitiativeEntry,
  cs: CombatState,
  characterId: string,
  characterName: string,
  defaultProps: Record<string, unknown>,
  playerGridSlot = 'C',
  playerIsHiding = false,
  targetIsDying = false,
): EnemyTurnResult {
  const facts: string[] = [];
  let hpDamage = 0;
  let updatedEntry = { ...entry };

  // Clear prone at the start of this enemy's turn (they spend movement to stand)
  if (updatedEntry.status_effects.includes('prone')) {
    updatedEntry = { ...updatedEntry, status_effects: updatedEntry.status_effects.filter(s => s !== 'prone') };
    facts.push(`${entry.name} stands up.`);
  }

  if (entry.surprised) {
    updatedEntry = { ...updatedEntry, surprised: false };
    facts.push(`${entry.name} is surprised and loses their turn.`);
    console.log(`[stage3:enemy-turn] ${entry.name} — action=skip (surprised)`);
    return { facts, hpDamage, updatedEntry };
  }

  if (updatedEntry.status_effects.includes('turned')) {
    facts.push(`${entry.name} is turned — cowering in fear, unable to act.`);
    console.log(`[stage3:enemy-turn] ${entry.name} — action=skip (turned)`);
    return { facts, hpDamage, updatedEntry };
  }

  const combatStats = (defaultProps.combat_stats ?? {}) as PoiCombatStats;
  const aiBehavior = (defaultProps.ai_behavior ?? {}) as AiBehavior;
  const priority = aiBehavior.priority ?? 'aggressive';
  const fleeThreshold = aiBehavior.flee_threshold ?? 0;

  const charEntry = cs.initiativeOrder.find(e => e.id === characterId);
  const characterAc = charEntry?.ac ?? 10;
  const playerDodging = charEntry?.status_effects.includes('dodging') ?? false;
  const targetIsRemote = !!charEntry?.remoteRoomInstanceId;

  const hasPriorityTarget =
    entry.priority_target === characterId &&
    (entry.priority_target_until_round === undefined || cs.round <= entry.priority_target_until_round);

  type EnemyAction = 'attack' | 'move' | 'flee' | 'hold';
  let action: EnemyAction = 'hold';

  if (hasPriorityTarget || priority === 'aggressive') {
    action = entry.proximity === 'close' ? 'attack' : 'move';
  } else if (priority === 'defensive') {
    action = entry.proximity === 'close' ? 'attack' : 'hold';
  } else if (priority === 'cowardly') {
    const hpPercent = entry.maxHp > 0 ? entry.hp / entry.maxHp : 1;
    action = hpPercent <= fleeThreshold ? 'flee' : 'attack';
  }

  // Remote allies (LoS-enrolled, physically elsewhere) are out of melee range —
  // an enemy can approach the doorway ('move') but never lands an 'attack' on them.
  if (action === 'attack' && targetIsRemote) {
    action = 'hold';
  }

  console.log(`[stage3:enemy-turn] ${entry.name} — action=${action} target=${characterName}`);

  if (action === 'attack') {
    const attackBonus = combatStats.attack_bonus ?? 0;
    const damageDice = combatStats.damage ?? '1d4';
    const hasAdvantage = entry.status_effects.includes('advantage_next_attack');
    const hasDisadvantage = playerDodging || playerIsHiding;

    let roll = rollD20Check(attackBonus, characterAc, 'AC');
    let rollMode: 'advantage' | 'disadvantage' | undefined;
    let d20Rolls: [number, number] | undefined;
    if (hasAdvantage && !hasDisadvantage) {
      const roll2 = rollD20Check(attackBonus, characterAc, 'AC');
      d20Rolls = [roll.roll, roll2.roll];
      roll = roll2.roll > roll.roll ? roll2 : roll;
      rollMode = 'advantage';
    } else if (hasDisadvantage && !hasAdvantage) {
      const roll2 = rollD20Check(attackBonus, characterAc, 'AC');
      d20Rolls = [roll.roll, roll2.roll];
      roll = roll2.roll < roll.roll ? roll2 : roll;
      rollMode = 'disadvantage';
    }
    const rollModeFields = rollMode ? { rollMode, d20Rolls } : {};

    if (hasAdvantage) {
      updatedEntry = { ...updatedEntry, status_effects: updatedEntry.status_effects.filter(s => s !== 'advantage_next_attack') };
    }

    // Dying target: convert attack into death save auto-failures instead of HP damage
    if (targetIsDying) {
      updatedEntry = { ...updatedEntry, grid_slot: playerGridSlot };
      let rollData: EnemyTurnResult['rollData'];
      if (roll.fumble) {
        facts.push(`${entry.name} attacks the fallen ${characterName} — rolled 1 (fumble), miss.`);
        rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
        return { facts, hpDamage: 0, deathSaveAutoFailures: 0, updatedEntry, rollData };
      } else if (roll.success || roll.critical) {
        const autoFails = roll.critical ? 2 : 1;
        facts.push(`${entry.name} attacks the fallen ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, ${roll.critical ? 'CRITICAL HIT' : 'hit'} — ${autoFails} death save failure${autoFails > 1 ? 's' : ''}.`);
        rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: true, isCrit: roll.critical || undefined, ...rollModeFields };
        return { facts, hpDamage: 0, deathSaveAutoFailures: autoFails, updatedEntry, rollData };
      } else {
        facts.push(`${entry.name} attacks the fallen ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, miss.`);
        rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
        return { facts, hpDamage: 0, deathSaveAutoFailures: 0, updatedEntry, rollData };
      }
    }

    let rollData: EnemyTurnResult['rollData'];
    if (roll.fumble) {
      facts.push(`${entry.name} attacked ${characterName} — rolled 1 (fumble), miss.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=1 vs AC=${characterAc} hit=false damage=0`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
    } else if (roll.success || roll.critical) {
      const { total: damage, expr: dmgExpr } = computeAttackDamage(damageDice, 0, roll.critical);
      hpDamage = damage;
      facts.push(`${entry.name} attacked ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, ${roll.critical ? 'CRITICAL HIT' : 'hit'}, dealt ${damage} damage.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=${roll.roll} vs AC=${characterAc} hit=true damage=${damage}`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: true, isCrit: roll.critical || undefined, damageRoll: { dice: `${damageDice}${roll.critical ? ' ×2' : ''}`, expr: dmgExpr, total: damage }, ...rollModeFields };
    } else {
      facts.push(`${entry.name} attacked ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, miss.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=${roll.roll} vs AC=${characterAc} hit=false damage=0`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
    }
    updatedEntry = { ...updatedEntry, grid_slot: playerGridSlot };

    // Concentration break check: if player took damage and is concentrating, roll CON save
    let concentrationBreak: EnemyTurnResult['concentrationBreak'];
    if (hpDamage > 0) {
      const charEntry = cs.initiativeOrder.find(e => e.id === characterId);
      const concEffect = charEntry?.status_effects.find(s => s.startsWith('concentrating:'));
      if (concEffect) {
        const saveDC = Math.max(10, Math.floor(hpDamage / 2));
        const conMod = charEntry?.constitutionSave ?? 0;
        const saveRoll = randomInt(1, 21) + conMod;
        const spellName = concEffect.split(':')[1] ?? 'spell';
        if (saveRoll < saveDC) {
          concentrationBreak = { broke: true, fact: `${characterName} took ${hpDamage} damage — concentration DC ${saveDC}, rolled ${saveRoll}: FAILED. ${spellName} ends.` };
        } else {
          facts.push(`${characterName} took ${hpDamage} damage — concentration DC ${saveDC}, rolled ${saveRoll}: maintained ${spellName}.`);
        }
      }
    }

    return { facts, hpDamage, updatedEntry, rollData, concentrationBreak };
  } else if (action === 'move') {
    updatedEntry = { ...updatedEntry, proximity: 'close', grid_slot: playerGridSlot };
    facts.push(`${entry.name} moves to close range.`);
  } else if (action === 'flee') {
    facts.push(`${entry.name} attempts to flee!`);
  } else if (targetIsRemote) {
    facts.push(`${entry.name} has no target in melee range.`);
  } else {
    facts.push(`${entry.name} holds position.`);
  }

  return { facts, hpDamage, updatedEntry };
}

// ─── Combat: Body Discovery (Phase 13) ───────────────────────────────────────

export type BodyObscurement = 'visible' | 'partial' | 'full';

export interface BodyDiscoveryResult {
  roll: number;
  dc: number;
  escalate: boolean;
}

export function resolveBodyDiscovery(
  wisScore: number,
  passivePerception: number | undefined,
  obscurement: BodyObscurement,
  rollFn?: () => number,
): BodyDiscoveryResult {
  const dc = obscurement === 'full' ? 16 : obscurement === 'partial' ? 12 : 8;
  const wisMod = abilityModifier(wisScore);
  const rawRoll = rollFn ? rollFn() : randomInt(1, 21);
  const roll = rawRoll + wisMod;
  return { roll, dc, escalate: roll >= dc };
}

// ─── Combat: Death Saving Throws ─────────────────────────────────────────────

export interface DeathSaveResult {
  roll: number;
  outcome: 'revived' | 'stabilized' | 'dead' | 'success' | 'failure';
  successes: number;
  failures: number;
  facts: string[];
  updatedEntry: InitiativeEntry;
  characterDied: boolean;
}

export function resolveDeathSave(
  entry: InitiativeEntry,
  characterName: string,
  rollFn?: () => number,
): DeathSaveResult {
  const roll = rollFn ? rollFn() : randomInt(1, 21);
  const prevSuccesses = entry.deathSaveSuccesses ?? 0;
  const prevFailures = entry.deathSaveFailures ?? 0;

  if (roll === 20) {
    const updatedEntry = { ...entry, hp: 1, deathSaveSuccesses: 0, deathSaveFailures: 0, isStabilized: false };
    return {
      roll, outcome: 'revived', successes: 0, failures: 0, characterDied: false, updatedEntry,
      facts: [`${characterName} rolled a natural 20 on their death saving throw and regains 1 HP!`],
    };
  }

  if (roll === 1) {
    const newFailures = prevFailures + 2;
    if (newFailures >= 3) {
      const updatedEntry = { ...entry, deathSaveFailures: newFailures, isStabilized: true };
      return {
        roll, outcome: 'dead', successes: prevSuccesses, failures: newFailures, characterDied: true, updatedEntry,
        facts: [`${characterName} rolled a 1 — two failures (${Math.min(newFailures, 3)}/3). ${characterName} has died.`],
      };
    }
    const updatedEntry = { ...entry, deathSaveFailures: newFailures };
    return {
      roll, outcome: 'failure', successes: prevSuccesses, failures: newFailures, characterDied: false, updatedEntry,
      facts: [`${characterName} rolled a 1 — two failures (${newFailures}/3).`],
    };
  }

  if (roll >= 10) {
    const newSuccesses = prevSuccesses + 1;
    if (newSuccesses >= 3) {
      const updatedEntry = { ...entry, deathSaveSuccesses: newSuccesses, isStabilized: true };
      return {
        roll, outcome: 'stabilized', successes: newSuccesses, failures: prevFailures, characterDied: false, updatedEntry,
        facts: [`${characterName} rolled ${roll} — success (${newSuccesses}/3). ${characterName} stabilizes.`],
      };
    }
    const updatedEntry = { ...entry, deathSaveSuccesses: newSuccesses };
    return {
      roll, outcome: 'success', successes: newSuccesses, failures: prevFailures, characterDied: false, updatedEntry,
      facts: [`${characterName} rolled ${roll} — death save success (${newSuccesses}/3).`],
    };
  }

  // 2–9: single failure
  const newFailures = prevFailures + 1;
  if (newFailures >= 3) {
    const updatedEntry = { ...entry, deathSaveFailures: newFailures, isStabilized: true };
    return {
      roll, outcome: 'dead', successes: prevSuccesses, failures: newFailures, characterDied: true, updatedEntry,
      facts: [`${characterName} rolled ${roll} — failure (${newFailures}/3). ${characterName} has died.`],
    };
  }
  const updatedEntry = { ...entry, deathSaveFailures: newFailures };
  return {
    roll, outcome: 'failure', successes: prevSuccesses, failures: newFailures, characterDied: false, updatedEntry,
    facts: [`${characterName} rolled ${roll} — death save failure (${newFailures}/3).`],
  };
}

// ─── Auto-resolve downed character turn ──────────────────────────────────────

export interface DownedTurnResult {
  updatedCs: CombatState;
  characterDied: boolean;
  rollLog: ReturnType<typeof resolveDeathSave>;
}

export function resolveDownedCharacterTurn(
  entry: InitiativeEntry,
  workingCs: CombatState,
): DownedTurnResult {
  const dsResult = resolveDeathSave(entry, entry.name);
  const updatedCs = {
    ...workingCs,
    initiativeOrder: workingCs.initiativeOrder.map(e => e.id === entry.id ? dsResult.updatedEntry : e),
  };
  return {
    updatedCs: advanceTurn(updatedCs),
    characterDied: dsResult.characterDied,
    rollLog: dsResult,
  };
}

// ─── Combat: Turn Resolution (Phase 3) ───────────────────────────────────────

// Clear effects that expire when `actorId` starts their turn:
// - Turn-scoped self-buffs (dodging, disengaged, shielded) are removed from that actor's entry.
// - Effects encoded as `<name>_until:<actorId>` (e.g. stunned_until:<monkId>) are removed from any entry.
function clearTurnExpiredEffects(order: InitiativeEntry[], actorId: string): InitiativeEntry[] {
  const selfExpiry = new Set(['dodging', 'disengaged', 'shielded']);
  return order.map(e => {
    if (e.id === actorId) {
      return { ...e, status_effects: e.status_effects.filter(s => !selfExpiry.has(s)) };
    }
    const filtered = e.status_effects.filter(s => !s.endsWith(`_until:${actorId}`));
    if (filtered.length === e.status_effects.length) return e;
    return { ...e, status_effects: filtered };
  });
}

export function advanceTurn(cs: CombatState): CombatState {
  const order = cs.initiativeOrder;
  const currentIdx = order.findIndex(e => e.id === cs.activeActorId);
  const updated = order.map((e, i) => i === currentIdx ? { ...e, acted: true } : e);

  const isSkippable = (e: (typeof updated)[number]) =>
    e.isDormant ||
    (e.type === 'enemy' && e.hp <= 0) ||
    (e.type === 'character' && e.hp <= 0 && !!e.isStabilized);

  const nextIdx = updated.findIndex((e, i) => i > currentIdx && !e.acted && !isSkippable(e));
  if (nextIdx !== -1) {
    const nextId = updated[nextIdx].id;
    return { ...cs, initiativeOrder: clearTurnExpiredEffects(updated, nextId), activeActorId: nextId, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
  }
  // New round — reset acted flags but keep skipping dormant/dead
  const reset = updated.map(e => ({ ...e, acted: false }));
  const firstValid = reset.findIndex(e => !isSkippable(e));
  if (firstValid === -1) {
    return { ...cs, initiativeOrder: reset, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
  }
  const firstId = reset[firstValid].id;
  return { ...cs, round: cs.round + 1, initiativeOrder: clearTurnExpiredEffects(reset, firstId), activeActorId: firstId, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
}

export function checkCombatEnd(cs: CombatState): boolean {
  return cs.initiativeOrder.every(e => e.type === 'character' || e.hp <= 0);
}

type CombatRollLog = {
  type: 'combat_roll';
  action: string;
  d20: number;
  modifier: number;
  total: number;
  vsTarget: string;
  success: boolean;
  isCrit?: boolean;
  damageRoll?: { dice: string; expr: string; total: number };
  rollMode?: 'advantage' | 'disadvantage';
  d20Rolls?: [number, number];
};

interface CombatActionResult {
  facts: string[];
  updatedCombatState: CombatState;
  combatEnded: boolean;
  deadEnemyPoiIds: string[];
  silentKillIds: Set<string>;
  playerGainedHidden: boolean | null;
  dbHpUpdates: Array<{ id: string; hpDelta: number }>;
  resourceUsages: Array<{ poolKey: string; delta: number }>;
  rollLogs: CombatRollLog[];
  characterDied: boolean;
}

export function resolveCombatAction(
  action: ExtractedAction,
  cs: CombatState,
  character: { id: string; name: string; characterClass: string; level: number; baseDexterity: number; baseStrength: number; baseCharisma: number; baseWisdom: number; isHiding?: boolean; critThreshold?: number; attacksPerAction?: number },
  equippedWeapon: { damageDice: string; weaponType?: string; silent?: boolean; toHitBonus?: number } | null,
  inventory?: CharacterInventory | null,
): CombatActionResult {
  const facts: string[] = [];
  let order = [...cs.initiativeOrder];
  const playerEntry = order.find(e => e.id === character.id)!;
  let combatEnded = false;
  const deadEnemyPoiIds: string[] = [];
  const silentKillIds = new Set<string>();
  let playerGainedHidden: boolean | null = null;
  const dbHpUpdates: Array<{ id: string; hpDelta: number }> = [];
  const resourceUsages: Array<{ poolKey: string; delta: number }> = [];
  let turnUsage = { ...cs.currentTurnUsage };
  const rollLogs: CombatRollLog[] = [];

  if (action.action_type === 'death_save') {
    const result = resolveDeathSave(playerEntry, character.name);
    order = order.map(e => e.id === character.id ? result.updatedEntry : e);
    facts.push(...result.facts);
    turnUsage = { ...turnUsage, actionUsed: true };
    const finalCs = { ...cs, initiativeOrder: order, currentTurnUsage: turnUsage };
    const isNat20 = result.roll === 20;
    const succeeded = result.outcome === 'success' || result.outcome === 'stabilized' || result.outcome === 'revived';
    rollLogs.push({
      type: 'combat_roll',
      action: 'Death Save',
      d20: result.roll,
      modifier: 0,
      total: result.roll,
      vsTarget: 'DC 10',
      success: succeeded,
      isCrit: isNat20,
    });
    return {
      facts,
      updatedCombatState: finalCs,
      combatEnded: false,
      deadEnemyPoiIds: [],
      silentKillIds: new Set(),
      playerGainedHidden: null,
      dbHpUpdates: result.outcome === 'revived' ? [{ id: character.id, hpDelta: 1 }] : [],
      resourceUsages: [],
      rollLogs,
      characterDied: result.characterDied,
    };
  }

  if (action.action_type === 'attack') {
    playerGainedHidden = false; // attacking always reveals the character
    const numAttacks = character.attacksPerAction ?? 1;
    const critThreshold = character.critThreshold ?? 20;
    const strMod = abilityModifier(character.baseStrength);
    const dexMod = abilityModifier(character.baseDexterity);
    const chaMod = abilityModifier(character.baseCharisma);
    const isFinesse = equippedWeapon?.weaponType === 'finesse';
    const statMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
    const profBonus = character.level >= 5 ? 3 : 2;
    const isHidden = character.isHiding ?? false;
    const isRogue = character.characterClass === 'Rogue';
    let sneakUsedThisTurn = false;
    const smitePending = playerEntry.status_effects.includes('smite_pending');
    let smiteUsedThisTurn = false;
    const bardInspirationDie = playerEntry.status_effects.includes('inspired') ? rollDice(1, 6).total : 0;
    let bardInspirationUsed = false;

    // Encounter-scoped buff modifiers
    const isRaging = playerEntry.status_effects.includes('raging');
    const hasSacredWeapon = playerEntry.status_effects.includes('sacred_weapon');
    const vowEffect = playerEntry.status_effects.find(s => s.startsWith('vow_of_enmity:'));
    const vowTargetId = vowEffect ? vowEffect.split(':')[1] : null;
    const rageDmgBonus = isRaging && !isFinesse ? (character.level >= 16 ? 4 : character.level >= 9 ? 3 : 2) : 0;
    const sacredAtkBonus = hasSacredWeapon ? chaMod : 0;
    const attackBonus = statMod + profBonus + (equippedWeapon?.toHitBonus ?? 0) + sacredAtkBonus;

    for (let attackIdx = 0; attackIdx < numAttacks; attackIdx++) {
      const targetId = action.target_poi_instance_id;
      let currentTargetIdx = targetId
        ? order.findIndex(e => e.id === targetId && e.hp > 0)
        : order.findIndex(e => e.type === 'enemy' && e.hp > 0);

      // Targeted enemy is dead or absent — fall back to the first alive enemy
      if (currentTargetIdx === -1 && targetId) {
        const deadInOrder = order.some(e => e.id === targetId);
        console.log(`[stage3:attack] targeted ${targetId} not found alive (${deadInOrder ? 'dead in order' : 'absent from order'}) — falling back to first alive enemy`);
        currentTargetIdx = order.findIndex(e => e.type === 'enemy' && e.hp > 0);
      }

      if (currentTargetIdx === -1) {
        if (attackIdx === 0) facts.push('No valid target found for attack.');
        break;
      }

      const target = order[currentTargetIdx];
      const targetSurprised = target.surprised;
      const targetProne = target.status_effects.includes('prone');
      const targetStunned = target.status_effects.some(s => s.startsWith('stunned_until:'));
      const meleeAttack = equippedWeapon?.weaponType !== 'ranged';
      const hasVowVsTarget = vowTargetId === target.id;
      const hasAdvantage = isHidden || targetSurprised || (targetProne && meleeAttack) || targetStunned || hasVowVsTarget;
      const targetHiding = target.status_effects.includes('hiding');
      const hasDisadvantage = targetHiding
        || (!isHidden && equippedWeapon?.weaponType === 'ranged' && order.some(e => e.type === 'enemy' && e.proximity === 'close' && e.hp > 0))
        || (targetProne && !meleeAttack);

      const inspirBonus = !bardInspirationUsed && bardInspirationDie > 0 ? bardInspirationDie : 0;
      if (inspirBonus > 0) bardInspirationUsed = true;
      const atkBonus = attackBonus + inspirBonus;
      let roll1 = rollD20Check(atkBonus, target.ac, 'AC');
      let finalRoll = roll1;
      let rollMode: 'advantage' | 'disadvantage' | undefined;
      let d20Rolls: [number, number] | undefined;
      if (hasAdvantage && !hasDisadvantage) {
        const roll2 = rollD20Check(atkBonus, target.ac, 'AC');
        d20Rolls = [roll1.roll, roll2.roll];
        finalRoll = roll2.roll > roll1.roll ? roll2 : roll1;
        rollMode = 'advantage';
      } else if (hasDisadvantage && !hasAdvantage) {
        const roll2 = rollD20Check(atkBonus, target.ac, 'AC');
        d20Rolls = [roll1.roll, roll2.roll];
        finalRoll = roll2.roll < roll1.roll ? roll2 : roll1;
        rollMode = 'disadvantage';
      }
      const rollModeFields = rollMode ? { rollMode, d20Rolls } : {};

      // Apply critThreshold override
      const isCrit = finalRoll.roll >= critThreshold && !finalRoll.fumble;
      const effectiveRoll = { ...finalRoll, critical: isCrit, success: finalRoll.success || isCrit };

      if (effectiveRoll.fumble) {
        facts.push(`${character.name} attacked ${target.name} — rolled 1 (fumble), miss.`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${target.ac}`, success: false, ...rollModeFields });
      } else if (effectiveRoll.success || effectiveRoll.critical) {
        const damageDice = equippedWeapon?.damageDice ?? '1d4';
        const { total: damage, expr: dmgExpr } = computeAttackDamage(damageDice, statMod, effectiveRoll.critical);

        // Sneak attack fires once per turn (first hit only)
        let sneakDamage = 0;
        let sneakDiceCount = 0;
        let sneakExpr = '';
        const allyAdjacent = order.some(e => e.type === 'character' && e.id !== character.id && e.hp > 0 && e.proximity === 'close');
        if (isRogue && !sneakUsedThisTurn && (hasAdvantage || allyAdjacent)) {
          sneakDiceCount = Math.ceil(character.level / 2);
          const sneakRoll = rollDice(sneakDiceCount, 6);
          sneakDamage = sneakRoll.total;
          sneakExpr = ` + [${sneakRoll.rolls.join(', ')}] sneak`;
          sneakUsedThisTurn = true;
        }

        // Concentration spell damage bonuses (Hex, Hunter's Mark)
        let concDamage = 0;
        let concExpr = '';
        const hexEffect = playerEntry.status_effects.find(s => s.startsWith('concentrating:hex:'));
        const markEffect = playerEntry.status_effects.find(s => s.startsWith('concentrating:hunters_mark:'));
        if (hexEffect && hexEffect.split(':')[2] === target.id) {
          const hexRoll = rollDice(1, 6);
          concDamage = hexRoll.total;
          concExpr = ` + [${hexRoll.rolls[0]}] hex`;
        } else if (markEffect && markEffect.split(':')[2] === target.id) {
          const markRoll = rollDice(1, 6);
          concDamage = markRoll.total;
          concExpr = ` + [${markRoll.rolls[0]}] hunter's mark`;
        }

        // Crimson Rite bonus damage (1d4 elemental)
        let crimsonDamage = 0;
        let crimsonExpr = '';
        if (playerEntry.status_effects.includes('crimson_rite')) {
          const crimsonRoll = rollDice(1, 4);
          crimsonDamage = crimsonRoll.total;
          crimsonExpr = ` + [${crimsonRoll.rolls[0]}] rite`;
        }

        // Divine Smite — triggers on first hit, adds 2d8 radiant
        let smiteDamage = 0;
        let smiteExpr = '';
        if (smitePending && !smiteUsedThisTurn) {
          const smiteRoll = rollDice(2, 8);
          smiteDamage = smiteRoll.total;
          smiteExpr = ` + [${smiteRoll.rolls.join(', ')}] smite`;
          smiteUsedThisTurn = true;
        }

        const weaponType = equippedWeapon?.weaponType ?? 'melee';
        const isResisted = (target.resistances ?? []).includes(weaponType);
        const rawDamage = damage + sneakDamage + rageDmgBonus + concDamage + crimsonDamage + smiteDamage;
        const effectiveDamage = isResisted ? Math.max(1, Math.floor(rawDamage / 2)) : rawDamage;

        const newHp = Math.max(0, target.hp - effectiveDamage);
        order[currentTargetIdx] = { ...target, hp: newHp };

        const rageNote = rageDmgBonus > 0 ? ` +${rageDmgBonus} rage` : '';
        const inspirNote = inspirBonus > 0 ? ` +${inspirBonus} inspiration` : '';
        console.log(`[stage3:attack#${attackIdx + 1}] target=${target.name} roll=${effectiveRoll.roll} vs AC=${target.ac} hit=${effectiveRoll.success} damage=${effectiveDamage}${isResisted ? '(resisted)' : ''} crit=${effectiveRoll.critical}${rageNote}`);
        facts.push(`${character.name} attacked ${target.name} — rolled ${effectiveRoll.roll}+${atkBonus}=${effectiveRoll.total} vs AC ${target.ac}${inspirNote}, ${effectiveRoll.critical ? 'CRITICAL HIT' : 'hit'}, dealt ${effectiveDamage} damage${sneakDamage ? ` (incl. ${sneakDiceCount}d6 sneak attack)` : ''}${rageNote}${[concExpr, crimsonExpr, smiteExpr].filter(Boolean).length ? ` (${[concExpr, crimsonExpr, smiteExpr].filter(Boolean).join(', ').trim()})` : ''}${isResisted ? ' (resisted)' : ''}.`);
        const dmgModStr = statMod !== 0 ? (statMod > 0 ? `+${statMod}` : `${statMod}`) : '';
        const diceLabel = `${damageDice}${dmgModStr}${effectiveRoll.critical ? ' ×2' : ''}`;
        const dmgExprFull = `${dmgExpr}${sneakExpr}${concExpr}${crimsonExpr}${smiteExpr}${isResisted ? ' (resisted)' : ''}`;
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: effectiveRoll.roll, modifier: atkBonus, total: effectiveRoll.total, vsTarget: `AC ${target.ac}`, success: true, isCrit: effectiveRoll.critical || undefined, damageRoll: { dice: diceLabel, expr: dmgExprFull, total: effectiveDamage }, ...rollModeFields });

        if (newHp <= 0) {
          console.log(`[stage3:enemy-dead] ${target.name} dropped to 0 HP — removed from initiative`);
          const overkill = effectiveDamage - target.hp;
          const overkillNote = overkill > 0 ? ` (overkill by ${overkill} — they had ${target.hp} HP left)` : '';
          facts.push(`${target.name} dropped to 0 HP and is dead.${overkillNote}`);
          const isSilentKill = isHidden && (equippedWeapon?.silent ?? false);
          deadEnemyPoiIds.push(target.id);
          if (!isSilentKill) silentKillIds.delete(target.id);
          else silentKillIds.add(target.id);
          order = order.filter(e => e.id !== target.id);
        }
      } else {
        console.log(`[stage3:attack#${attackIdx + 1}] target=${target.name} roll=${effectiveRoll.roll} vs AC=${target.ac} hit=false damage=0 crit=false`);
        facts.push(`${character.name} attacked ${target.name} — rolled ${effectiveRoll.roll}+${atkBonus}=${effectiveRoll.total} vs AC ${target.ac}, miss.`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: effectiveRoll.roll, modifier: atkBonus, total: effectiveRoll.total, vsTarget: `AC ${target.ac}`, success: false, ...rollModeFields });
      }
    }

    // Clear one-shot statuses consumed during this attack sequence
    if (smiteUsedThisTurn || bardInspirationUsed) {
      const playerIdx = order.findIndex(e => e.id === character.id);
      if (playerIdx !== -1) {
        let fx = [...order[playerIdx].status_effects];
        if (smiteUsedThisTurn) fx = fx.filter(s => s !== 'smite_pending');
        if (bardInspirationUsed) fx = fx.filter(s => s !== 'inspired');
        order[playerIdx] = { ...order[playerIdx], status_effects: fx };
      }
    }

  } else if (action.action_type === 'dodge') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'dodging'), 'dodging'] };
    facts.push(`${character.name} takes the Dodge action — attackers have disadvantage until their next turn.`);

  } else if (action.action_type === 'dash') {
    facts.push(`${character.name} Dashes — movement doubled this turn.`);

  } else if (action.action_type === 'disengage') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'disengaged'), 'disengaged'] };
    facts.push(`${character.name} Disengages — no opportunity attacks this turn.`);

  } else if (action.action_type === 'hide') {
    const dexMod = abilityModifier(character.baseDexterity);
    const stealthRoll = rollStealthCheck(dexMod);
    const enemies = order.filter(e => e.type === 'enemy' && e.hp > 0);
    const highestPerception = enemies.length > 0
      ? Math.max(...enemies.map(e => e.passive_perception ?? 10))
      : 10;
    if (stealthRoll >= highestPerception) {
      facts.push(`${character.name} hides — Stealth ${stealthRoll} beats passive Perception ${highestPerception}. Now hidden.`);
      playerGainedHidden = true;
    } else {
      facts.push(`${character.name} attempts to hide — Stealth ${stealthRoll} vs passive Perception ${highestPerception}, fails.`);
      playerGainedHidden = false;
    }
    rollLogs.push({ type: 'combat_roll', action: `${character.name} stealth`, d20: stealthRoll - dexMod, modifier: dexMod, total: stealthRoll, vsTarget: `Perception ${highestPerception}`, success: stealthRoll >= highestPerception });

  } else if (action.action_type === 'provoke') {
    const targetId = action.target_poi_instance_id;
    const targetIdx = targetId ? order.findIndex(e => e.id === targetId) : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
    if (targetIdx !== -1) {
      const target = order[targetIdx];
      const chaMod = abilityModifier(character.baseCharisma);
      const intimidDC = 12;
      const check = rollD20Check(chaMod, intimidDC, 'DC');
      if (check.success) {
        order[targetIdx] = { ...target, priority_target: character.id, priority_target_until_round: cs.round + 2 };
        facts.push(`${character.name} provokes ${target.name} — Intimidation ${check.total} vs DC ${intimidDC}, success. ${target.name} focuses on ${character.name} for 2 rounds.`);
      } else {
        order[targetIdx] = { ...target, status_effects: [...target.status_effects, 'advantage_next_attack'] };
        facts.push(`${character.name} provokes ${target.name} — Intimidation ${check.total} vs DC ${intimidDC}, failure. ${target.name} gains advantage on next attack.`);
      }
      rollLogs.push({ type: 'combat_roll', action: `${character.name} intimidates ${target.name}`, d20: check.roll, modifier: chaMod, total: check.total, vsTarget: `DC ${intimidDC}`, success: check.success });
    }

  } else if (action.action_type === 'shove') {
    const targetId = action.target_poi_instance_id;
    const targetIdx = targetId
      ? order.findIndex(e => e.id === targetId && e.proximity === 'close' && e.hp > 0)
      : order.findIndex(e => e.type === 'enemy' && e.proximity === 'close' && e.hp > 0);

    if (targetIdx === -1) {
      facts.push(`${character.name} tries to shove but no enemy is close enough.`);
    } else {
      const target = order[targetIdx];
      const strMod = abilityModifier(character.baseStrength);
      const profBonus = character.level >= 5 ? 3 : 2;
      const playerContest = randomInt(1, 21) + strMod + profBonus;
      const d20Roll = playerContest - strMod - profBonus;

      const enemyStrScore = target.str_score ?? 10;
      const enemyContest = randomInt(1, 21) + abilityModifier(enemyStrScore);

      if (playerContest > enemyContest) {
        order[targetIdx] = { ...target, status_effects: [...target.status_effects.filter(s => s !== 'prone'), 'prone'] };
        facts.push(`${character.name} shoves ${target.name} — contest ${playerContest} vs ${enemyContest}, success. ${target.name} is knocked prone (attacks against them have advantage; their attacks have disadvantage).`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} shoves ${target.name}`, d20: d20Roll, modifier: strMod + profBonus, total: playerContest, vsTarget: `Contest ${enemyContest}`, success: true });
      } else {
        facts.push(`${character.name} attempts to shove ${target.name} — contest ${playerContest} vs ${enemyContest}, failed.`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} shoves ${target.name}`, d20: d20Roll, modifier: strMod + profBonus, total: playerContest, vsTarget: `Contest ${enemyContest}`, success: false });
      }
      turnUsage = { ...turnUsage, actionUsed: true };
    }

  } else if (action.action_type === 'change_proximity') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    const playerIsProne = playerIdx !== -1 && order[playerIdx].status_effects.includes('prone');
    if (playerIsProne) {
      // Standing up costs movement — remove prone, no proximity change
      order[playerIdx] = { ...order[playerIdx], status_effects: order[playerIdx].status_effects.filter(s => s !== 'prone') };
      facts.push(`${character.name} stands up, no longer prone.`);
    } else {
      const targetId = action.target_poi_instance_id;
      const targetIdx = targetId ? order.findIndex(e => e.id === targetId) : -1;
      if (targetIdx !== -1) {
        const target = order[targetIdx];
        const newProx = target.proximity === 'close' ? 'far' : 'close';
        order[targetIdx] = { ...target, proximity: newProx };
        facts.push(`${target.name} proximity changed to ${newProx}.`);
      }
    }

  } else if (action.action_type === 'use_item' || action.action_type === 'throw_item') {
    const itemId = action.item_id;
    const item = itemId ? (inventory?.bag.find(i => i.id === itemId) ?? null) : null;
    if (!item) {
      facts.push(`${character.name} tried to use an item but it wasn't found.`);
    } else {
      const targetId = action.target_character_id ?? action.target_poi_instance_id;
      const effect = item.use_effect ?? '';

      if (effect.startsWith('heal_')) {
        const amount = parseInt(effect.replace('heal_', ''), 10);
        const targetIdx = targetId
          ? order.findIndex(e => e.id === targetId)
          : order.findIndex(e => e.id === character.id);
        if (targetIdx !== -1) {
          const target = order[targetIdx];
          const healed = Math.min(amount, target.maxHp - target.hp);
          order[targetIdx] = { ...target, hp: target.hp + healed };
          facts.push(`${character.name} used ${item.name} on ${target.name} — restored ${healed} HP (${target.hp} → ${target.hp + healed}).`);
          if (target.type === 'character') dbHpUpdates.push({ id: target.id, hpDelta: healed });
        }
      } else if (effect === 'cure_poison') {
        const targetIdx = targetId
          ? order.findIndex(e => e.id === targetId)
          : order.findIndex(e => e.id === character.id);
        if (targetIdx !== -1) {
          const target = order[targetIdx];
          const wasPoisoned = target.status_effects.includes('poisoned');
          order[targetIdx] = { ...target, status_effects: target.status_effects.filter(s => s !== 'poisoned') };
          facts.push(`${character.name} used ${item.name} on ${target.name} — ${wasPoisoned ? 'cured poison' : 'not poisoned, no effect'}.`);
        }
      } else if (effect === 'shield_spell') {
        const playerIdx = order.findIndex(e => e.id === character.id);
        if (playerIdx !== -1) {
          order[playerIdx] = { ...order[playerIdx], status_effects: [...order[playerIdx].status_effects.filter(s => s !== 'shielded'), 'shielded'] };
          facts.push(`${character.name} used ${item.name} — +5 AC until next turn.`);
        }
      } else {
        // Generic damage effect: parse trailing number e.g. holy_damage_8, fire_damage_6
        const dmgMatch = effect.match(/(\d+)/);
        const baseDamage = dmgMatch ? parseInt(dmgMatch[1], 10) : 0;
        if (baseDamage > 0) {
          const targetIdx = targetId
            ? order.findIndex(e => e.id === targetId)
            : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
          if (targetIdx !== -1) {
            const target = order[targetIdx];
            const dexMod = abilityModifier(character.baseDexterity);
            const profBonus = character.level >= 5 ? 3 : 2;
            const attackBonus = dexMod + profBonus;
            const roll = rollD20Check(attackBonus, target.ac, 'AC');
            if (roll.fumble) {
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled 1 (fumble), miss.`);
            } else if (roll.success || roll.critical) {
              const damage = roll.critical ? baseDamage * 2 : baseDamage;
              const newHp = Math.max(0, target.hp - damage);
              order[targetIdx] = { ...target, hp: newHp };
              console.log(`[stage3:item-use] ${character.name} used ${item.name} on ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} hit damage=${damage}`);
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, hit, dealt ${damage} damage.`);
              if (newHp <= 0) {
                facts.push(`${target.name} dropped to 0 HP and is dead.`);
                if (target.type === 'enemy') deadEnemyPoiIds.push(target.id);
                order = order.filter(e => e.id !== target.id);
              }
            } else {
              console.log(`[stage3:item-use] ${character.name} used ${item.name} on ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} miss`);
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, miss.`);
            }
            rollLogs.push({ type: 'combat_roll', action: `${character.name} uses ${item.name}`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${target.ac}`, success: roll.success || roll.critical, isCrit: roll.critical || undefined });
          } else {
            facts.push(`${character.name} used ${item.name} — no valid target.`);
          }
        } else if (action.action_type === 'throw_item' && item.throwable && !item.damage_dice) {
          // Improvised thrown weapon (torch, rock, etc.): 1d4, DEX-based attack roll
          const targetIdx = targetId
            ? order.findIndex(e => e.id === targetId)
            : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
          if (targetIdx !== -1) {
            const target = order[targetIdx];
            const dexMod = abilityModifier(character.baseDexterity);
            const profBonus = character.level >= 5 ? 3 : 2;
            const attackBonus = dexMod + profBonus;
            const roll = rollD20Check(attackBonus, target.ac, 'AC');
            if (roll.fumble) {
              facts.push(`${character.name} threw ${item.name} at ${target.name} — rolled 1 (fumble), miss.`);
              rollLogs.push({ type: 'combat_roll', action: `${character.name} throws ${item.name} at ${target.name}`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${target.ac}`, success: false });
            } else if (roll.success || roll.critical) {
              const { total: baseDmg, expr: baseExpr } = computeAttackDamage('1d4', 0, roll.critical);
              let totalDamage = baseDmg;
              let dmgExprFull = baseExpr;
              let igniteNote = '';
              if (item.throw_effect === 'ignite') {
                const { total: igniteDmg, expr: igniteExpr } = computeAttackDamage('1d4', 0, false);
                totalDamage += igniteDmg;
                dmgExprFull += ` + ${igniteExpr} fire`;
                igniteNote = `, igniting them for ${igniteDmg} extra fire damage`;
              }
              const isResisted = !!item.throw_damage_type && (target.resistances ?? []).includes(item.throw_damage_type);
              const effectiveDamage = isResisted ? Math.max(1, Math.floor(totalDamage / 2)) : totalDamage;
              const newHp = Math.max(0, target.hp - effectiveDamage);
              order[targetIdx] = { ...target, hp: newHp };
              console.log(`[stage3:throw-item] ${character.name} threw ${item.name} at ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} hit damage=${effectiveDamage}${isResisted ? '(resisted)' : ''}`);
              facts.push(`${character.name} threw ${item.name} at ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, ${roll.critical ? 'CRITICAL HIT' : 'hit'}, dealt ${effectiveDamage} damage${igniteNote}${isResisted ? ' (resisted)' : ''}.`);
              rollLogs.push({ type: 'combat_roll', action: `${character.name} throws ${item.name} at ${target.name}`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${target.ac}`, success: true, isCrit: roll.critical || undefined, damageRoll: { dice: '1d4', expr: `${dmgExprFull}${isResisted ? ' (resisted)' : ''}`, total: effectiveDamage } });
              if (newHp <= 0) {
                facts.push(`${target.name} dropped to 0 HP and is dead.`);
                if (target.type === 'enemy') deadEnemyPoiIds.push(target.id);
                order = order.filter(e => e.id !== target.id);
              }
            } else {
              console.log(`[stage3:throw-item] ${character.name} threw ${item.name} at ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} miss`);
              facts.push(`${character.name} threw ${item.name} at ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, miss.`);
              rollLogs.push({ type: 'combat_roll', action: `${character.name} throws ${item.name} at ${target.name}`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${target.ac}`, success: false });
            }
          } else {
            facts.push(`${character.name} threw ${item.name} — no valid target.`);
          }
        } else {
          facts.push(`${character.name} used ${item.name}.`);
        }
      }
      turnUsage = { ...turnUsage, actionUsed: true };
    }
  } else if (action.action_type === 'use_class_feature') {
    const featureKey = action.interaction_result ?? '';
    const playerIdx = order.findIndex(e => e.id === character.id);
    const profBonus = character.level >= 5 ? 3 : 2;

    if (featureKey === 'rage') {
      if (playerEntry.status_effects.includes('raging')) {
        facts.push(`${character.name} is already raging.`);
      } else {
        const rageDmg = character.level >= 16 ? 4 : character.level >= 9 ? 3 : 2;
        order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects, 'raging'] };
        facts.push(`${character.name} enters a Rage — +${rageDmg} to STR damage rolls, resistance to bludgeoning/piercing/slashing until combat ends.`);
        resourceUsages.push({ poolKey: 'rage', delta: -1 });
      }

    } else if (featureKey === 'sacred_weapon') {
      if (playerEntry.status_effects.includes('sacred_weapon')) {
        facts.push(`${character.name}'s weapon is already consecrated.`);
      } else {
        const chaMod = abilityModifier(character.baseCharisma);
        order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects, 'sacred_weapon'] };
        facts.push(`${character.name} channels divine power into their weapon — +${chaMod} to attack rolls until combat ends.`);
        resourceUsages.push({ poolKey: 'channel_divinity_pal', delta: -1 });
      }

    } else if (featureKey === 'vow_of_enmity') {
      const targetId = action.target_poi_instance_id;
      const target = (targetId ? order.find(e => e.id === targetId && e.hp > 0) : order.find(e => e.type === 'enemy' && e.hp > 0));
      if (target) {
        const filtered = playerEntry.status_effects.filter(s => !s.startsWith('vow_of_enmity:'));
        order[playerIdx] = { ...playerEntry, status_effects: [...filtered, `vow_of_enmity:${target.id}`] };
        facts.push(`${character.name} swears a Vow of Enmity against ${target.name} — advantage on attacks against them until combat ends.`);
        resourceUsages.push({ poolKey: 'channel_divinity_pal', delta: -1 });
      } else {
        facts.push(`${character.name} could not find a target for Vow of Enmity.`);
      }

    } else if (featureKey === 'crimson_rite') {
      if (playerEntry.status_effects.includes('crimson_rite')) {
        facts.push(`${character.name}'s Crimson Rite is already active.`);
      } else {
        order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects, 'crimson_rite'] };
        facts.push(`${character.name} activates Crimson Rite — weapon deals +1d4 elemental damage until combat ends.`);
        resourceUsages.push({ poolKey: 'crimson_rite', delta: -1 });
      }

    } else if (featureKey === 'stunning_strike') {
      const targetId = action.target_poi_instance_id;
      const targetIdx = targetId
        ? order.findIndex(e => e.id === targetId && e.hp > 0)
        : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
      if (targetIdx !== -1) {
        const target = order[targetIdx];
        const wisMod = abilityModifier(character.baseWisdom);
        const stunDC = 8 + profBonus + wisMod;
        const combatStats = (target as unknown as { _combatStats?: { con_score?: number } })._combatStats;
        const enemyConSave = combatStats?.con_score ? abilityModifier(combatStats.con_score) : 0;
        const saveRoll = randomInt(1, 21) + enemyConSave;
        const stunKey = `stunned_until:${character.id}`;
        if (saveRoll < stunDC) {
          order[targetIdx] = { ...target, status_effects: [...target.status_effects.filter(s => s !== stunKey), stunKey] };
          facts.push(`${character.name} uses Stunning Strike on ${target.name} — CON save DC ${stunDC}, rolled ${saveRoll}: stunned until ${character.name}'s next turn.`);
        } else {
          facts.push(`${character.name} uses Stunning Strike on ${target.name} — CON save DC ${stunDC}, rolled ${saveRoll}: resisted.`);
        }
        rollLogs.push({ type: 'combat_roll', action: `Stunning Strike vs ${target.name}`, d20: saveRoll - enemyConSave, modifier: enemyConSave, total: saveRoll, vsTarget: `DC ${stunDC}`, success: saveRoll < stunDC });
        resourceUsages.push({ poolKey: 'ki', delta: -1 });
      } else {
        facts.push(`${character.name} found no valid target for Stunning Strike.`);
      }

    } else if (featureKey === 'second_wind') {
      const roll = rollDice(1, 10);
      const healed = roll.total + character.level;
      const playerIdx = order.findIndex(e => e.id === character.id);
      if (playerIdx !== -1) {
        const newHp = Math.min(playerEntry.maxHp, playerEntry.hp + healed);
        order[playerIdx] = { ...playerEntry, hp: newHp };
        facts.push(`${character.name} uses Second Wind — healed ${healed} HP (${roll.total}+${character.level}) [${playerEntry.hp} → ${newHp}/${playerEntry.maxHp}].`);
        dbHpUpdates.push({ id: character.id, hpDelta: healed });
      }
      resourceUsages.push({ poolKey: 'second_wind', delta: -1 });

    } else if (featureKey === 'action_surge') {
      turnUsage = { ...turnUsage, actionUsed: false };
      facts.push(`${character.name} surges with martial prowess — Action Surge! They may take one more action this turn.`);
      resourceUsages.push({ poolKey: 'action_surge', delta: -1 });

    } else if (featureKey === 'channel_divinity') {
      const wisMod = abilityModifier(character.baseWisdom);
      const turnDC = 8 + profBonus + wisMod;
      const enemies = order.filter(e => e.type === 'enemy' && e.hp > 0);
      if (enemies.length === 0) {
        facts.push(`${character.name} channels divine power — but there are no enemies to turn.`);
      } else {
        const results: string[] = [];
        for (const enemy of enemies) {
          const enemyIdx = order.findIndex(e => e.id === enemy.id);
          const enemyWis = (enemy as unknown as { _combatStats?: { wis_score?: number } })._combatStats?.wis_score ?? 10;
          const saveRoll = randomInt(1, 21) + abilityModifier(enemyWis);
          if (saveRoll < turnDC) {
            order[enemyIdx] = { ...order[enemyIdx], status_effects: [...order[enemyIdx].status_effects.filter(s => s !== 'turned'), 'turned'] };
            results.push(`${enemy.name} (save ${saveRoll} vs DC ${turnDC}: TURNED)`);
            rollLogs.push({ type: 'combat_roll', action: `Turn Undead vs ${enemy.name}`, d20: saveRoll - abilityModifier(enemyWis), modifier: abilityModifier(enemyWis), total: saveRoll, vsTarget: `DC ${turnDC}`, success: false });
          } else {
            results.push(`${enemy.name} (save ${saveRoll} vs DC ${turnDC}: resisted)`);
            rollLogs.push({ type: 'combat_roll', action: `Turn Undead vs ${enemy.name}`, d20: saveRoll - abilityModifier(enemyWis), modifier: abilityModifier(enemyWis), total: saveRoll, vsTarget: `DC ${turnDC}`, success: true });
          }
        }
        facts.push(`${character.name} channels divine power — Turn Undead (DC ${turnDC}): ${results.join(', ')}.`);
      }
      resourceUsages.push({ poolKey: 'channel_divinity_clr', delta: -1 });

    } else if (featureKey === 'lay_on_hands') {
      const playerIdx = order.findIndex(e => e.id === character.id);
      if (playerIdx !== -1) {
        const healed = 5;
        const newHp = Math.min(playerEntry.maxHp, playerEntry.hp + healed);
        order[playerIdx] = { ...playerEntry, hp: newHp };
        facts.push(`${character.name} uses Lay on Hands — healed 5 HP [${playerEntry.hp} → ${newHp}/${playerEntry.maxHp}].`);
        dbHpUpdates.push({ id: character.id, hpDelta: healed });
      }
      resourceUsages.push({ poolKey: 'lay_on_hands', delta: -5 });

    } else if (featureKey === 'divine_smite') {
      const playerIdx = order.findIndex(e => e.id === character.id);
      if (playerIdx !== -1) {
        order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'smite_pending'), 'smite_pending'] };
      }
      facts.push(`${character.name} channels radiant power into their weapon — Divine Smite ready. Next hit deals +2d8 radiant damage.`);

    } else if (featureKey === 'bardic_inspiration') {
      const targetId = action.target_character_id;
      const allyIdx = targetId ? order.findIndex(e => e.id === targetId && e.type === 'character' && e.hp > 0) : -1;
      if (allyIdx !== -1) {
        const ally = order[allyIdx];
        order[allyIdx] = { ...ally, status_effects: [...ally.status_effects.filter(s => s !== 'inspired'), 'inspired'] };
        facts.push(`${character.name} plays an inspiring refrain — ${ally.name} gains a Bardic Inspiration die (+d6 to their next attack roll).`);
      } else {
        facts.push(`${character.name} plays an inspiring refrain — no valid ally target.`);
      }
      resourceUsages.push({ poolKey: 'bardic_inspiration', delta: -1 });

    } else if (featureKey === 'flurry_of_blows') {
      const dexMod = abilityModifier(character.baseDexterity);
      const strMod = abilityModifier(character.baseStrength);
      const unarmedStatMod = Math.max(dexMod, strMod);
      const unarmedDie = character.level >= 17 ? 10 : character.level >= 11 ? 8 : character.level >= 5 ? 6 : 4;
      const targetId = action.target_poi_instance_id;
      let targetIdx = targetId
        ? order.findIndex(e => e.id === targetId && e.hp > 0)
        : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
      const strikeResults: string[] = [];
      for (let i = 0; i < 2; i++) {
        if (targetIdx === -1) break;
        const flurryTarget = order[targetIdx];
        const roll = rollD20Check(unarmedStatMod + profBonus, flurryTarget.ac, 'AC');
        if (roll.success || roll.critical) {
          const { total: dmg } = computeAttackDamage(`1d${unarmedDie}`, unarmedStatMod, roll.critical);
          const newHp = Math.max(0, flurryTarget.hp - dmg);
          order[targetIdx] = { ...flurryTarget, hp: newHp };
          strikeResults.push(`strike ${i + 1}: ${roll.roll}+${unarmedStatMod + profBonus}=${roll.total} vs AC ${flurryTarget.ac}, hit ${dmg} dmg`);
          rollLogs.push({ type: 'combat_roll', action: `${character.name} Flurry #${i + 1}`, d20: roll.roll, modifier: unarmedStatMod + profBonus, total: roll.total, vsTarget: `AC ${flurryTarget.ac}`, success: true });
          if (newHp <= 0) {
            facts.push(`${character.name} unleashes Flurry of Blows — ${strikeResults.join('; ')}. ${flurryTarget.name} drops to 0 HP!`);
            deadEnemyPoiIds.push(flurryTarget.id);
            order = order.filter(e => e.id !== flurryTarget.id);
            break;
          }
        } else {
          strikeResults.push(`strike ${i + 1}: ${roll.roll}+${unarmedStatMod + profBonus}=${roll.total} vs AC ${flurryTarget.ac}, miss`);
          rollLogs.push({ type: 'combat_roll', action: `${character.name} Flurry #${i + 1}`, d20: roll.roll, modifier: unarmedStatMod + profBonus, total: roll.total, vsTarget: `AC ${flurryTarget.ac}`, success: false });
        }
      }
      if (targetIdx === -1) {
        facts.push(`${character.name} finds no target for Flurry of Blows.`);
      } else if (strikeResults.length > 0 && !facts.some(f => f.includes('Flurry'))) {
        facts.push(`${character.name} unleashes Flurry of Blows — ${strikeResults.join('; ')}.`);
      }
      resourceUsages.push({ poolKey: 'ki', delta: -1 });

    } else if (featureKey === 'patient_defense') {
      const playerIdx = order.findIndex(e => e.id === character.id);
      order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'dodging'), 'dodging'] };
      facts.push(`${character.name} spends 1 Ki — Patient Defense. Attackers have disadvantage until their next turn.`);
      resourceUsages.push({ poolKey: 'ki', delta: -1 });

    } else if (featureKey === 'step_of_the_wind') {
      const playerIdx = order.findIndex(e => e.id === character.id);
      order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'disengaged'), 'disengaged'] };
      facts.push(`${character.name} spends 1 Ki — Step of the Wind. They may move without provoking opportunity attacks.`);
      resourceUsages.push({ poolKey: 'ki', delta: -1 });

    } else if (featureKey === 'hex' || featureKey === 'hunters_mark') {
      const targetId = action.target_poi_instance_id;
      const target = (targetId ? order.find(e => e.id === targetId && e.hp > 0) : order.find(e => e.type === 'enemy' && e.hp > 0));
      if (target) {
        const filtered = playerEntry.status_effects.filter(s => !s.startsWith('concentrating:'));
        const effectKey = `concentrating:${featureKey}:${target.id}`;
        order[playerIdx] = { ...playerEntry, status_effects: [...filtered, effectKey] };
        const spellName = featureKey === 'hex' ? 'Hex' : "Hunter's Mark";
        facts.push(`${character.name} concentrates on ${spellName}, targeting ${target.name} — +1d6 damage on hits against them.`);
      } else {
        facts.push(`${character.name} found no valid target.`);
      }

    } else {
      facts.push(`${character.name} uses ${featureKey}.`);
    }

    turnUsage = { ...turnUsage, bonusActionUsed: true };
  }

  // Mark main-action consumption for standard combat actions
  if (['attack', 'dodge', 'dash', 'disengage', 'hide', 'provoke'].includes(action.action_type)) {
    turnUsage = { ...turnUsage, actionUsed: true };
  }
  if (action.action_type === 'change_proximity') {
    turnUsage = { ...turnUsage, movementUsed: true };
  }

  let updatedCs = { ...cs, initiativeOrder: order, currentTurnUsage: turnUsage };
  combatEnded = checkCombatEnd(updatedCs);

  return { facts, updatedCombatState: updatedCs, combatEnded, deadEnemyPoiIds, silentKillIds, playerGainedHidden, dbHpUpdates, resourceUsages, rollLogs, characterDied: false };
}
