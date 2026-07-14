import { randomInt } from 'crypto';
import type { PoiContext, PoiCombatStats, AiBehavior, CombatPoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';
import { rollInitiative } from '@/lib/initiative';
import { abilityModifier, rollD20Check, rollDice } from '@/lib/dice';
import { computeAttackDamage } from '@/lib/mechanical-damage';
import { rollStealthCheck } from '@/lib/stealth';
import { awardCombatXp, applyXpAward } from '@/lib/v2/xp-helpers';
import type {
  GameActionRequest,
  ActionType,
  ExtractedAction,
  ItemDefinition,
  CharacterInventory,
  EntityRef,
  UiLayoutAnchors,
  AdjacentRoomPreview,
  ViewStatePayload,
  CombatState,
  InitiativeEntry,
} from '@/types/v2-game';

// ─── Item Helpers ─────────────────────────────────────────────────────────────

import { normalizeInventory, inventorySummary, extractPoiItems } from '@/lib/v2/item-helpers';
export { normalizeInventory } from '@/lib/v2/item-helpers';

// ─── POI Context ──────────────────────────────────────────────────────────────


import {
  SLOT_COORDS, slotGridDistance, resolveEffectiveVisibility,
  LOS_SLOT_PX, LOS_ROOM_PX, LOS_SLOT_OFFSETS, LOS_ADJ_ORIGIN,
  losSlotCenter, losArchOpening, isPoiVisibleThroughExit,
} from '@/lib/v2/room-geometry';

import { DUNGEON_ACTS } from '@/lib/v2/act-definitions';
import type { ActMutation, ActDefinition } from '@/lib/v2/act-definitions';

import { extractAvailableStances, extractExplorationFlags, extractExitInfo } from '@/lib/v2/poi-context-helpers';


import { buildHaikuSystemPrompt, buildNarrativeSystemPrompt } from '@/lib/v2/ai-prompts';

import { lookupDatabaseContext, roomInstanceQuery, attacksPerAction as calcAttacksPerAction } from '@/lib/v2/db-context';


import { parseIntentWithHaiku } from '@/lib/v2/intent-parser';


import {
  detectCombatTrigger, enterCombat, exitCombat, joinCombat,
  resolveOpportunityAttacks, resolveEnemyTurn, resolveBodyDiscovery,
  advanceTurn, checkCombatEnd, resolveCombatAction, resolveDeathSave,
  resolveDownedCharacterTurn,
} from '@/lib/v2/combat-engine';
import type {
  OpportunityAttackResult, EnemyTurnResult, BodyObscurement, BodyDiscoveryResult, DeathSaveResult,
} from '@/lib/v2/combat-engine';

export {
  detectCombatTrigger, enterCombat, exitCombat, joinCombat,
  resolveOpportunityAttacks, resolveEnemyTurn, resolveBodyDiscovery,
  advanceTurn, checkCombatEnd, resolveCombatAction, resolveDeathSave,
};
export type { OpportunityAttackResult, EnemyTurnResult, BodyObscurement, BodyDiscoveryResult, DeathSaveResult };

import {
  mutateGameState,
} from '@/lib/v2/mutation-engine';
import type { AppliedAction, MutationResult, CharacterContext } from '@/lib/v2/mutation-engine';


import { generateAndPersistNarrative } from '@/lib/v2/narrative';


import { buildViewState, prefetchViewStateData, assembleViewState } from '@/lib/v2/view-state';


import { checkAndAdvanceAct } from '@/lib/v2/act-progression';


// Fetches the latest combat state for a room, auto-resolves all leading enemy turns,
// then writes the result back. Called after any joinCombat / enterCombat call where
// the enemy may hold the active slot.
async function autoResolveLeadingEnemyTurns(
  combatRoomId: string,
  characterId: string,
  characterName: string,
  characterCurrentHp: number,
  isHiding: boolean,
  playerGridSlot: string,
  allCombatFacts: string[],
): Promise<void> {
  const roomRow = await prisma.roomInstance.findUnique({
    where: { id: combatRoomId },
    include: { poiInstances: { include: { template: true } } },
  });
  if (!roomRow?.combatState) return;
  let workingCs = roomRow.combatState as unknown as CombatState;
  if (workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId)?.type !== 'enemy') return;

  let totalEnemyDamage = 0;
  const pendingRollData: NonNullable<EnemyTurnResult['rollData']>[] = [];

  while (true) {
    const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
    if (!activeEntry || activeEntry.type === 'character') break;

    const poiForEnemy = roomRow.poiInstances.find(p => p.id === activeEntry.id);
    const defaultProps = (poiForEnemy?.template?.defaultProperties ?? {}) as Record<string, unknown>;

    const targetIsDying = (characterCurrentHp - totalEnemyDamage) <= 0;
    const result = resolveEnemyTurn(activeEntry, workingCs, characterId, characterName, defaultProps, playerGridSlot, isHiding, targetIsDying);
    allCombatFacts.push(...result.facts);
    if (!targetIsDying) totalEnemyDamage += result.hpDamage;
    if (result.rollData) pendingRollData.push(result.rollData);

    // Apply enemy entry update + optional concentration break on the player's entry
    workingCs = {
      ...workingCs,
      initiativeOrder: workingCs.initiativeOrder.map(e => {
        if (e.id === activeEntry.id) return result.updatedEntry;
        if (e.id === characterId && result.concentrationBreak?.broke) {
          return { ...e, status_effects: e.status_effects.filter(s => !s.startsWith('concentrating:')) };
        }
        return e;
      }),
    };
    if (result.concentrationBreak?.broke) {
      allCombatFacts.push(result.concentrationBreak.fact);
    }

    workingCs = advanceTurn(workingCs);
  }

  if (totalEnemyDamage > 0) {
    await prisma.character.update({ where: { id: characterId }, data: { currentHp: Math.max(0, characterCurrentHp - totalEnemyDamage) } });
  }

  await prisma.roomInstance.update({ where: { id: combatRoomId }, data: { combatState: workingCs as object } });

  for (const rollData of pendingRollData) {
    await prisma.messageLog.create({
      data: {
        roomInstanceId: combatRoomId,
        characterId,
        isMechanicalEvent: false,
        mechanicalSummary: rollData,
        text: `[COMBAT] ${rollData.action}`,
      },
    });
  }
}

async function persistMechanicalSummary(
  roomInstanceId: string,
  sessionId: string,
  rollResult: NonNullable<ViewStatePayload['rollResult']>,
  characterId: string,
  targetName?: string,
): Promise<void> {
  const hitOrMiss = rollResult.success ? 'Hit' : 'Miss';
  let text = `You attack — roll ${rollResult.d20} = ${rollResult.d20} vs AC. ${hitOrMiss}.`;
  if (rollResult.success && rollResult.damage !== undefined) {
    text = `You attack ${targetName ?? 'the enemy'} — roll ${rollResult.d20}. ${rollResult.isCrit ? 'Critical hit!' : 'Hit.'} ${rollResult.damage} damage dealt.`;
    if (rollResult.targetDefeated) text += ' Enemy defeated.';
  } else if (!rollResult.success) {
    text = `You attack ${targetName ?? 'the enemy'} — roll ${rollResult.d20}. Miss.`;
  }
  await prisma.messageLog.create({
    data: {
      roomInstanceId,
      characterId,
      isMechanicalEvent: true,
      mechanicalSummary: { type: 'mechanical_summary', ...rollResult },
      text,
    },
  });
  console.log(`[narrative] mechanical summary written for session ${sessionId}`);
}

export async function handleGameAction(body: GameActionRequest): Promise<ViewStatePayload> {
  const { characterId, roomInstanceId, playerActionText, action_hint, target_poi_instance_id: bodyTargetPoiId } = body;

  if (!characterId || !roomInstanceId || !playerActionText) {
    throw new Error('Missing required fields: characterId, roomInstanceId, playerActionText');
  }

  {
    // Stage 1
    const { character, roomInstance, classFeatures } = await lookupDatabaseContext(characterId, roomInstanceId);
    const characterInventory = normalizeInventory(character.inventory);

    const poiContexts: PoiContext[] = roomInstance.poiInstances.map(poi => {
      const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
      const currentProps = poi.currentProperties as Record<string, unknown>;
      const { items, floorItems } = extractPoiItems(defaultProps, currentProps);
      const isLockable = computeIsLockable(defaultProps.locked_by);
      const isLocked = isLockable && currentProps.unlocked !== true;
      const isUnlocked = isLockable && currentProps.unlocked === true;
      return {
        id: poi.id,
        name: poi.template.name,
        keyword: poi.template.keywordIdentifier,
        availableStances: extractAvailableStances(poi.template.defaultProperties),
        ...extractExplorationFlags(poi.currentProperties),
        isLocked,
        isUnlocked,
        ...extractExitInfo(poi.template.defaultProperties),
        exitDirection: poi.template.exit_direction ?? null,
        items,
        floorItems,
        isOpenSpace: (defaultProps.poi_type as string) === 'open_space',
        visibility: resolveEffectiveVisibility(defaultProps, currentProps),
        peekVisibility: ((defaultProps.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
        // Combat awareness fields (underscore-prefixed to avoid conflict with existing PoiContext)
        _currentAwareness: currentProps.awareness_state as string | undefined,
        _hostileTo: Array.isArray(currentProps.hostile_to) ? (currentProps.hostile_to as string[]) : undefined,
        _recognitionException: (defaultProps.recognition_exception as string) ?? undefined,
        _combatStats: (defaultProps.combat_stats ?? {}) as PoiCombatStats,
        _aiBehavior: (defaultProps.ai_behavior ?? {}) as AiBehavior,
        _defaultProps: defaultProps,
      };
    });

    const validPoiMap = new Map(roomInstance.poiInstances.map(poi => [poi.id, poi.template.name]));
    const exitPoiMap = new Map(
      poiContexts
        .filter(p => p.isExit && p.targetRoomTemplateId)
        .map(p => [p.id, p.targetRoomTemplateId!]),
    );
    const openSpacePoiId = poiContexts.find(p => p.isOpenSpace)?.id ?? null;

    const otherCharacters = roomInstance.participants
      .filter(p => p.characterId !== characterId)
      .map(p => ({ id: p.characterId, name: p.character.name }));

    const selfParticipant = roomInstance.participants.find(p => p.characterId === characterId);
    const currentProximityPoiId =
      ((selfParticipant?.combatState as Record<string, unknown> | null)?.proximity_target_id as string) ?? null;

    // Persist player action before AI stages so it's in history
    await prisma.messageLog.create({
      data: {
        roomInstanceId,
        characterId,
        isMechanicalEvent: false,
        mechanicalSummary: { type: 'player_action' },
        text: playerActionText,
      },
    });

    // Gates: lobby, dead character, kicked
    if (roomInstance.session.gameState === 'lobby') {
      throw Object.assign(new Error('Session has not started yet'), { status: 403 });
    }
    const charForGate = await prisma.character.findUnique({ where: { id: characterId }, select: { isDead: true } });
    if (charForGate?.isDead) throw Object.assign(new Error('Dead characters cannot act'), { status: 403 });
    const kickedIds = (roomInstance.session.kickedCharacterIds ?? []) as string[];
    if (kickedIds.includes(characterId)) throw Object.assign(new Error('You have been removed from this session'), { status: 403 });

    // Read combat state from roomInstance
    const riRow = await prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      select: { gameState: true, combatState: true, processingAction: true },
    });

    // Remote-combat-turn detection: the character may be enrolled (LoS auto-enroll) in
    // another room's combat while physically remaining here. Only relevant when this
    // room isn't itself in combat.
    let remoteCombatRoomId: string | null = null;
    let remoteCs: CombatState | null = null;
    let remoteRoomData: {
      template: { name: string; baseDescription: string };
      poiInstances: Array<{ id: string; currentProperties: unknown; template: { defaultProperties: unknown; name: string } }>;
      participants: Array<{ character: { id: string; name: string } }>;
    } | null = null;

    if ((riRow?.gameState ?? 'exploration') !== 'combat') {
      const sessionCombatRooms = await prisma.roomInstance.findMany({
        where: { sessionId: roomInstance.session.id, gameState: 'combat', NOT: { id: roomInstanceId } },
        include: {
          template: { select: { name: true, baseDescription: true } },
          poiInstances: { include: { template: true } },
          participants: { include: { character: { select: { id: true, name: true } } } },
        },
      });
      for (const cr of sessionCombatRooms) {
        const candidateCs = cr.combatState as unknown as CombatState | null;
        if (!candidateCs) continue;
        if (candidateCs.initiativeOrder.some(e => e.id === characterId && e.remoteRoomInstanceId === roomInstanceId)) {
          remoteCombatRoomId = cr.id;
          remoteCs = candidateCs;
          remoteRoomData = { template: cr.template, poiInstances: cr.poiInstances, participants: cr.participants };
          break;
        }
      }
    }

    // Early-exit: end_turn bypasses intent parsing — just advance turn and run enemies
    if (action_hint === 'end_turn') {
      // Remote-combat turn: the character is enrolled in another room's combat (LoS
      // auto-enroll) and it's their turn there. Advance/resolve enemies in that room
      // and write back there — this room stays in exploration throughout.
      if (remoteCombatRoomId && remoteCs && remoteRoomData && remoteCs.activeActorId === characterId) {
        let workingCs = advanceTurn(remoteCs);
        let totalEnemyDamage = 0;
        const allEnemyFacts: string[] = [];
        const pendingRollData: NonNullable<EnemyTurnResult['rollData']>[] = [];
        const remoteEntry = remoteCs.initiativeOrder.find(e => e.id === characterId);
        const remotePlayerGridSlot = remoteEntry?.grid_slot ?? 'C';

        while (true) {
          const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
          if (!activeEntry || activeEntry.type === 'character') break;

          const poiForEnemy = remoteRoomData.poiInstances.find(p => p.id === activeEntry.id);
          const defaultProps = (poiForEnemy?.template?.defaultProperties ?? {}) as Record<string, unknown>;

          const targetIsDying = (character.currentHp - totalEnemyDamage) <= 0;
          const result = resolveEnemyTurn(activeEntry, workingCs, characterId, character.name, defaultProps, remotePlayerGridSlot, character.isHiding ?? false, targetIsDying);
          allEnemyFacts.push(...result.facts);
          if (!targetIsDying) totalEnemyDamage += result.hpDamage;
          if (result.rollData) pendingRollData.push(result.rollData);

          workingCs = {
            ...workingCs,
            initiativeOrder: workingCs.initiativeOrder.map(e => {
              if (e.id === activeEntry.id) return result.updatedEntry;
              if (e.id === characterId && result.concentrationBreak?.broke) {
                return { ...e, status_effects: e.status_effects.filter(s => !s.startsWith('concentrating:')) };
              }
              return e;
            }),
          };
          if (result.concentrationBreak?.broke) {
            allEnemyFacts.push(result.concentrationBreak.fact);
          }

          workingCs = advanceTurn(workingCs);
        }

        if (totalEnemyDamage > 0) {
          const newHp = Math.max(0, character.currentHp - totalEnemyDamage);
          await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
        }

        await prisma.roomInstance.update({
          where: { id: remoteCombatRoomId },
          data: { combatState: workingCs as object },
        });

        await generateAndPersistNarrative(
          remoteCombatRoomId,
          characterId,
          character.name,
          remoteRoomData.template.name,
          remoteRoomData.template.baseDescription,
          [],
          roomInstance.session.id,
          allEnemyFacts.length > 0 ? allEnemyFacts : undefined,
          remoteRoomData.participants.map(p => p.character.name),
        );

        for (const rollData of pendingRollData) {
          await prisma.messageLog.create({
            data: {
              roomInstanceId: remoteCombatRoomId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: rollData,
              text: `[COMBAT] ${rollData.action}`,
            },
          });
        }

        return buildViewState(roomInstanceId, (riRow?.gameState ?? 'exploration') as string, characterId, roomInstance.session.id, currentProximityPoiId);
      }

      const sessionGs = riRow?.gameState ?? 'exploration';
      const sessionCs = riRow?.combatState;
      if (sessionGs !== 'combat' || !sessionCs) {
        return buildViewState(roomInstanceId, sessionGs as string, characterId, roomInstance.session.id, currentProximityPoiId);
      }
      const cs = sessionCs as unknown as CombatState;
      const activeEntry = cs.initiativeOrder.find(e => e.id === cs.activeActorId);
      const characterEntry = cs.initiativeOrder.find(e => e.id === characterId);
      // Recovery path: activeActorId is an enemy and this character is enrolled — skip the
      // advanceTurn/death-save preamble and run the enemy loop from the current position.
      // Covers both the original "crashed mid-turn" case and any stuck-enemy-turn scenario.
      const alreadyAdvanced = activeEntry?.type === 'enemy' && !!characterEntry;
      if (cs.activeActorId !== characterId && !alreadyAdvanced) {
        throw Object.assign(new Error("It's not your turn"), { status: 409 });
      }

      // Advance past player (skip if we're already past)
      // If the calling character is downed, auto-resolve their death save before advancing
      let workingCs = alreadyAdvanced ? cs : cs;
      const callerEntry = cs.initiativeOrder.find(e => e.id === characterId);
      const downedAutoResolveRollLogs: NonNullable<EnemyTurnResult['rollData']>[] = [];
      const allEnemyFacts: string[] = [];

      if (!alreadyAdvanced && callerEntry && character.currentHp <= 0 && !callerEntry.isStabilized) {
        // Sync CS hp to 0 so advanceTurn's isSkippable correctly identifies this entry as downed.
        // Enemy damage updates the DB but not the CS hp field, leaving it at the combat-start value.
        const syncedEntry = callerEntry.hp > 0 ? { ...callerEntry, hp: 0 } : callerEntry;
        const syncedCs = callerEntry.hp > 0
          ? { ...cs, initiativeOrder: cs.initiativeOrder.map(e => e.id === characterId ? syncedEntry : e) }
          : cs;
        const { updatedCs, characterDied, rollLog } = resolveDownedCharacterTurn(syncedEntry, syncedCs);
        workingCs = updatedCs;
        console.log(`[stage3:death-save:auto] char=${characterId} roll=${rollLog.roll} outcome=${rollLog.outcome}`);
        downedAutoResolveRollLogs.push({
          type: 'combat_roll',
          action: 'Death Save',
          d20: rollLog.roll,
          modifier: 0,
          total: rollLog.roll,
          vsTarget: 'DC 10',
          success: rollLog.outcome !== 'failure' && rollLog.outcome !== 'dead',
          isCrit: rollLog.roll === 20,
        });
        allEnemyFacts.push(...rollLog.facts);
        if (characterDied) {
          const updatedEntry = workingCs.initiativeOrder.find(e => e.id === characterId);
          if (updatedEntry && (updatedEntry.deathSaveFailures ?? 0) >= 3) {
            workingCs = {
              ...workingCs,
              initiativeOrder: workingCs.initiativeOrder.map(e =>
                e.id === characterId ? { ...e, isStabilized: true } : e
              ),
            };
            await prisma.$transaction([
              prisma.character.update({
                where: { id: characterId },
                data: {
                  pendingChoicesQueue: {
                    push: {
                      type: 'heroic_sacrifice',
                      fallenName: character.name,
                      fallenClass: character.characterClass,
                      fallenLevel: character.level,
                    },
                  },
                },
              }),
              prisma.messageLog.create({
                data: {
                  roomInstanceId,
                  characterId,
                  isMechanicalEvent: false,
                  mechanicalSummary: { type: 'heroic_sacrifice', characterName: character.name },
                  text: `[FALLEN] ${character.name} has fallen. The party has a sneaking suspicion they haven't seen the last of ${character.name}'s story...`,
                },
              }),
            ]);
          }
        }
      } else if (!alreadyAdvanced) {
        workingCs = advanceTurn(cs);
      }

      let totalEnemyDamage = 0;
      const pendingRollData: NonNullable<EnemyTurnResult['rollData']>[] = [];

      const playerPoiSlot = (roomInstance.poiInstances.find(p => p.id === currentProximityPoiId)?.template as Record<string, unknown> | undefined)?.grid_slot as string ?? 'C';

      while (true) {
        const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
        if (!activeEntry) break;

        // Hand control back to any character who acts on their own: living characters, or the
        // calling character whose death save was already resolved before this loop started.
        if (activeEntry.type === 'character' && (activeEntry.hp > 0 || activeEntry.id === characterId)) break;

        // Downed character: auto-resolve death save
        if (activeEntry.type === 'character' && activeEntry.hp <= 0 && !activeEntry.isStabilized) {
          const { updatedCs, characterDied, rollLog } = resolveDownedCharacterTurn(activeEntry, workingCs);
          workingCs = updatedCs;
          console.log(`[stage3:death-save:auto] char=${activeEntry.id} roll=${rollLog.roll} outcome=${rollLog.outcome}`);
          downedAutoResolveRollLogs.push({
            type: 'combat_roll',
            action: 'Death Save',
            d20: rollLog.roll,
            modifier: 0,
            total: rollLog.roll,
            vsTarget: 'DC 10',
            success: rollLog.outcome !== 'failure' && rollLog.outcome !== 'dead',
            isCrit: rollLog.roll === 20,
          });
          allEnemyFacts.push(...rollLog.facts);
          if (characterDied) {
            // Phase 2: heroic_sacrifice trigger (deathSaveFailures >= 3 from own roll)
            const updatedEntry = workingCs.initiativeOrder.find(e => e.id === activeEntry.id);
            if (updatedEntry && (updatedEntry.deathSaveFailures ?? 0) >= 3) {
              workingCs = {
                ...workingCs,
                initiativeOrder: workingCs.initiativeOrder.map(e =>
                  e.id === activeEntry.id ? { ...e, isStabilized: true } : e
                ),
              };
              await prisma.$transaction([
                prisma.character.update({
                  where: { id: activeEntry.id },
                  data: {
                    pendingChoicesQueue: {
                      push: {
                        type: 'heroic_sacrifice',
                        fallenName: activeEntry.name,
                        fallenClass: character.characterClass,
                        fallenLevel: character.level,
                      },
                    },
                  },
                }),
                prisma.messageLog.create({
                  data: {
                    roomInstanceId,
                    characterId: activeEntry.id,
                    isMechanicalEvent: false,
                    mechanicalSummary: { type: 'heroic_sacrifice', characterName: activeEntry.name },
                    text: `[FALLEN] ${activeEntry.name} has fallen. The party has a sneaking suspicion they haven't seen the last of ${activeEntry.name}'s story...`,
                  },
                }),
              ]);
            }
          }
          continue;
        }

        // Stabilized downed character: already skipped by advanceTurn's isSkippable — break if we somehow land here
        if (activeEntry.type === 'character' && activeEntry.isStabilized) break;

        const poiForEnemy = roomInstance.poiInstances.find(p => p.id === activeEntry.id);
        const defaultProps = (poiForEnemy?.template?.defaultProperties ?? {}) as Record<string, unknown>;

        const effectiveCharHp = character.currentHp - totalEnemyDamage;
        const targetIsDying = effectiveCharHp <= 0;

        const result = resolveEnemyTurn(activeEntry, workingCs, characterId, character.name, defaultProps, playerPoiSlot, character.isHiding ?? false, targetIsDying);
        allEnemyFacts.push(...result.facts);
        if (!targetIsDying) {
          totalEnemyDamage += result.hpDamage;
        }

        if (result.rollData) {
          pendingRollData.push(result.rollData);
        }

        workingCs = {
          ...workingCs,
          initiativeOrder: workingCs.initiativeOrder.map(e => {
            if (e.id === activeEntry.id) return result.updatedEntry;
            if (e.id === characterId) {
              let updated = e;
              if (!targetIsDying && result.concentrationBreak?.broke) {
                updated = { ...updated, status_effects: updated.status_effects.filter(s => !s.startsWith('concentrating:')) };
              }
              const autoFails = result.deathSaveAutoFailures ?? 0;
              if (autoFails > 0) {
                const newFailures = (updated.deathSaveFailures ?? 0) + autoFails;
                updated = { ...updated, deathSaveFailures: newFailures };
                // Post-loop check (line 551) handles isStabilized + heroic_sacrifice push
              }
              return updated;
            }
            return e;
          }),
        };
        if (!targetIsDying && result.concentrationBreak?.broke) {
          allEnemyFacts.push(result.concentrationBreak.fact);
        }

        workingCs = advanceTurn(workingCs);
        // If all characters are sacrificed/stabilized, no one will break the loop naturally
        if (!workingCs.initiativeOrder.some(e => e.type === 'character' && e.hp > 0)) break;
      }

      // Check if any enemy auto-fail pushed deathSaveFailures >= 3 during this turn
      const charCsEntry = workingCs.initiativeOrder.find(e => e.id === characterId);
      if (charCsEntry && charCsEntry.hp <= 0 && !charCsEntry.isStabilized && (charCsEntry.deathSaveFailures ?? 0) >= 3) {
        workingCs = {
          ...workingCs,
          initiativeOrder: workingCs.initiativeOrder.map(e =>
            e.id === characterId ? { ...e, isStabilized: true } : e
          ),
        };
        await prisma.$transaction([
          prisma.character.update({
            where: { id: characterId },
            data: {
              pendingChoicesQueue: {
                push: {
                  type: 'heroic_sacrifice',
                  fallenName: character.name,
                  fallenClass: character.characterClass,
                  fallenLevel: character.level,
                },
              },
            },
          }),
          prisma.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'heroic_sacrifice', characterName: character.name },
              text: `[FALLEN] ${character.name} has fallen. The party has a sneaking suspicion they haven't seen the last of ${character.name}'s story...`,
            },
          }),
        ]);
        allEnemyFacts.push(`${character.name} has fallen.`);
      }

      if (totalEnemyDamage > 0) {
        const newHp = Math.max(0, character.currentHp - totalEnemyDamage);
        await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
      }

      await prisma.roomInstance.update({
        where: { id: roomInstanceId },
        data: { combatState: workingCs as object },
      });

      // Narrative first — badges appear after so they read as mechanical receipts for the described action
      await generateAndPersistNarrative(
        roomInstanceId,
        characterId,
        character.name,
        roomInstance.template.name,
        roomInstance.template.baseDescription,
        [],
        roomInstance.session.id,
        allEnemyFacts.length > 0 ? allEnemyFacts : undefined,
        roomInstance.participants.map(p => p.character.name),
      );

      for (const rollData of pendingRollData) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollData,
            text: `[COMBAT] ${rollData.action}`,
          },
        });
      }

      for (const rollData of downedAutoResolveRollLogs) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollData,
            text: `[COMBAT] ${rollData.action}`,
          },
        });
      }

      return buildViewState(roomInstanceId, 'combat', characterId, roomInstance.session.id, currentProximityPoiId);
    }

    // Phase P: exploration action lock — first-in wins, second caller gets 409
    const isExplorationAction = (riRow?.gameState ?? 'exploration') !== 'combat';
    if (isExplorationAction) {
      const lockResult = await prisma.roomInstance.updateMany({
        where: { id: roomInstanceId, processingAction: false },
        data: { processingAction: true },
      });
      if (lockResult.count === 0) {
        throw Object.assign(
          new Error('Another action is being processed — please wait a moment and try again'),
          { status: 409 },
        );
      }
    }

    try {

    // If character is standing at a visible exit, fetch adjacent room POIs so
    // Haiku can reference them by real instance ID (cross-room actions).
    let adjacentRoom: AdjacentRoomContext | null = null;
    if (currentProximityPoiId) {
      const proximityCtx = poiContexts.find(p => p.id === currentProximityPoiId);
      if (proximityCtx?.isExit && proximityCtx.targetRoomTemplateId) {
        const effectivePeek = computeEffectivePeek(
          proximityCtx.peekVisibility,
          proximityCtx.isLocked,
          proximityCtx.interacted,
          proximityCtx.destroyed,
        );
        if (effectivePeek !== 'none') {
          // Fetch or lazily create the adjacent room instance so we have real POI IDs
          let adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: proximityCtx.targetRoomTemplateId },
            include: { template: true, poiInstances: { include: { template: true } }, participants: { include: { character: { select: { id: true, name: true } } } } },
          });
          if (!adjRoom) {
            const adjTemplate = await prisma.roomTemplate.findUniqueOrThrow({
              where: { id: proximityCtx.targetRoomTemplateId },
              include: { poiTemplates: true },
            });
            adjRoom = await prisma.roomInstance.create({
              data: {
                sessionId: roomInstance.session.id,
                roomTemplateId: proximityCtx.targetRoomTemplateId,
                poiInstances: {
                  create: adjTemplate.poiTemplates.map(pt => {
                    const dp = pt.defaultProperties as Record<string, unknown>;
                    const initAwareness = dp.initial_awareness_state as string | undefined;
                    return {
                      poiTemplateId: pt.id,
                      currentProperties: initAwareness
                        ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                        : {},
                    };
                  }),
                },
              },
              include: { template: true, poiInstances: { include: { template: true } }, participants: { include: { character: { select: { id: true, name: true } } } } },
            });
          }
          // Character's current grid_slot — from proximity target template, or 'C' for open space
          const proximityPoiInstance = currentProximityPoiId
            ? roomInstance.poiInstances.find(pi => pi.id === currentProximityPoiId)
            : null;
          const charGridSlot = proximityPoiInstance?.template.grid_slot ?? 'C';
          const exitDirection = proximityPoiInstance?.template.exit_direction ?? '';
          const exitWallSection = proximityPoiInstance?.template.exit_wall_section ?? 'C';
          const exitArchWidth = proximityPoiInstance?.template.exit_arch_width ?? 1;
          // 'obvious_only' shows visibility_level >= 2; 'full' shows everything
          const minVisLevel = effectivePeek === 'full' ? 1 : 2;

          const adjPois: PoiContext[] = adjRoom.poiInstances
            .filter(pi => {
              const dp = pi.template.defaultProperties as Record<string, unknown>;
              if (dp.poi_type === 'open_space') return false;
              if (pi.template.visibility_level < minVisLevel) return false;
              if (!exitDirection) return true;
              return isPoiVisibleThroughExit(
                charGridSlot,
                pi.template.grid_slot,
                exitDirection,
                exitWallSection,
                exitArchWidth,
              );
            })
            .map(pi => {
              const dp = pi.template.defaultProperties as Record<string, unknown>;
              const { items, floorItems } = extractPoiItems(dp, pi.currentProperties);
              const adjLockedBy = dp.locked_by;
              const adjIsLockable = Array.isArray(adjLockedBy)
                ? (adjLockedBy as string[]).length > 0
                : typeof adjLockedBy === 'string' && adjLockedBy.length > 0;
              const adjCurrentProps = pi.currentProperties as Record<string, unknown>;
              const adjIsLocked = adjIsLockable && adjCurrentProps.unlocked !== true;
              const adjIsUnlocked = adjIsLockable && adjCurrentProps.unlocked === true;
              return {
                id: pi.id,
                name: pi.template.name,
                keyword: pi.template.keywordIdentifier,
                availableStances: extractAvailableStances(pi.template.defaultProperties),
                ...extractExplorationFlags(pi.currentProperties),
                isLocked: adjIsLocked,
                isUnlocked: adjIsUnlocked,
                ...extractExitInfo(pi.template.defaultProperties),
                exitDirection: null,
                items,
                floorItems,
                isOpenSpace: false,
                visibility: resolveEffectiveVisibility(dp, pi.currentProperties as Record<string, unknown>),
                peekVisibility: ((dp.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
              };
            });
          const adjCharactersProximity = (adjRoom.participants ?? [])
            .filter(p => p.characterId !== characterId)
            .map(p => ({ id: p.characterId, name: p.character.name }));
          adjacentRoom = {
            roomName: adjRoom.template.name,
            exitPoiId: currentProximityPoiId,
            exitPoiName: proximityCtx.name,
            targetRoomTemplateId: proximityCtx.targetRoomTemplateId,
            pois: adjPois,
            characters: adjCharactersProximity,
          };
          console.log(`[adjacent] fetched ${adjPois.length} POI(s) from "${adjRoom.template.name}" via "${proximityCtx.name}"`);
        }
      }
    }

    // Fallback: if not standing at an exit but there's exactly one peek-visible exit,
    // still populate adjacentRoom so the LLM can parse cross-room actions like "walk to <POI>".
    if (!adjacentRoom) {
      const peekableExits = poiContexts.filter(p => {
        if (!p.isExit || !p.targetRoomTemplateId) return false;
        return computeEffectivePeek(p.peekVisibility, p.isLocked, p.interacted, p.destroyed) !== 'none';
      });
      if (peekableExits.length === 1) {
        const fallbackExit = peekableExits[0];
        const effectivePeek = computeEffectivePeek(
          fallbackExit.peekVisibility,
          fallbackExit.isLocked,
          fallbackExit.interacted,
          fallbackExit.destroyed,
        );
        const minVisLevel = effectivePeek === 'full' ? 1 : 2;

        // Resolve character's current grid slot for LoS check
        const charPoiInstance = currentProximityPoiId
          ? roomInstance.poiInstances.find(pi => pi.id === currentProximityPoiId)
          : null;
        const charGridSlot: string = charPoiInstance?.template.grid_slot ?? 'C';

        // Resolve exit geometry from the raw template
        const exitPoiInstance = roomInstance.poiInstances.find(pi => pi.id === fallbackExit.id);
        const exitDirection: string = exitPoiInstance?.template.exit_direction ?? '';
        const exitWallSection: string = exitPoiInstance?.template.exit_wall_section ?? 'C';
        const exitArchWidth: number = exitPoiInstance?.template.exit_arch_width ?? 1;

        let adjRoom = await prisma.roomInstance.findFirst({
          where: { sessionId: roomInstance.session.id, roomTemplateId: fallbackExit.targetRoomTemplateId! },
          include: { template: true, poiInstances: { include: { template: true } }, participants: { include: { character: { select: { id: true, name: true } } } } },
        });
        if (!adjRoom) {
          const adjTemplate = await prisma.roomTemplate.findUniqueOrThrow({
            where: { id: fallbackExit.targetRoomTemplateId! },
            include: { poiTemplates: true },
          });
          adjRoom = await prisma.roomInstance.create({
            data: {
              sessionId: roomInstance.session.id,
              roomTemplateId: fallbackExit.targetRoomTemplateId!,
              poiInstances: {
                create: adjTemplate.poiTemplates.map(pt => {
                  const dp = pt.defaultProperties as Record<string, unknown>;
                  const initAwareness = dp.initial_awareness_state as string | undefined;
                  return {
                    poiTemplateId: pt.id,
                    currentProperties: initAwareness
                      ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                      : {},
                  };
                }),
              },
            },
            include: { template: true, poiInstances: { include: { template: true } }, participants: { include: { character: { select: { id: true, name: true } } } } },
          });
        }
        const adjPois: PoiContext[] = adjRoom.poiInstances
          .filter(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            if (dp.poi_type === 'open_space') return false;
            if (pi.template.visibility_level < minVisLevel) return false;
            if (!exitDirection) return true;
            return isPoiVisibleThroughExit(
              charGridSlot,
              pi.template.grid_slot,
              exitDirection,
              exitWallSection,
              exitArchWidth,
            );
          })
          .map(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            const { items, floorItems } = extractPoiItems(dp, pi.currentProperties);
            const adjLockedBy = dp.locked_by;
            const adjIsLockable = Array.isArray(adjLockedBy)
              ? (adjLockedBy as string[]).length > 0
              : typeof adjLockedBy === 'string' && adjLockedBy.length > 0;
            const adjCurrentProps = pi.currentProperties as Record<string, unknown>;
            return {
              id: pi.id,
              name: pi.template.name,
              keyword: pi.template.keywordIdentifier,
              availableStances: extractAvailableStances(pi.template.defaultProperties),
              ...extractExplorationFlags(pi.currentProperties),
              isLocked: adjIsLockable && adjCurrentProps.unlocked !== true,
              isUnlocked: adjIsLockable && adjCurrentProps.unlocked === true,
              ...extractExitInfo(pi.template.defaultProperties),
              exitDirection: null,
              items,
              floorItems,
              isOpenSpace: false,
              visibility: resolveEffectiveVisibility(dp, adjCurrentProps),
              peekVisibility: ((dp.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
            };
          });
        const adjCharacters = (adjRoom.participants ?? [])
          .filter(p => p.characterId !== characterId)
          .map(p => ({ id: p.characterId, name: p.character.name }));
        if (adjPois.length > 0 || adjCharacters.length > 0) {
          adjacentRoom = {
            roomName: adjRoom.template.name,
            exitPoiId: fallbackExit.id,
            exitPoiName: fallbackExit.name,
            targetRoomTemplateId: fallbackExit.targetRoomTemplateId!,
            pois: adjPois,
            characters: adjCharacters,
          };
          console.log(`[adjacent] fallback: fetched ${adjPois.length} POI(s) from "${adjRoom.template.name}" via "${fallbackExit.name}" (charSlot=${charGridSlot})`);
        }
      }
    }

    // Stage 2 — intent parse (with bypass for roll-sheet actions)
    const COMBAT_DIRECT_HINTS = new Set(['attack', 'shove', 'hide', 'provoke', 'dodge', 'dash', 'disengage']);
    let parsedActions: ExtractedAction[];
    if (action_hint && COMBAT_DIRECT_HINTS.has(action_hint) && bodyTargetPoiId !== undefined) {
      // Roll-sheet action: bypass Haiku intent parse, construct ExtractedAction directly
      parsedActions = [{
        action_type: action_hint as ActionType,
        target_poi_instance_id: bodyTargetPoiId ?? null,
        item_id: null,
        target_character_id: null,
        resulting_stance: null,
        interaction_result: null,
        target_room_template_id: null,
      }];
    } else {
      parsedActions = await parseIntentWithHaiku(
        poiContexts,
        characterInventory,
        otherCharacters,
        playerActionText,
        currentProximityPoiId,
        adjacentRoom,
        action_hint,
      );
    }

    // Validate item IDs from parser against known items (including adjacent room items)
    const knownItemIds = new Set([
      ...characterInventory.bag.map(i => i.id),
      ...Object.values(characterInventory.equipped)
        .filter((i): i is ItemDefinition => i != null)
        .map(i => i.id),
      ...poiContexts.flatMap(p => [...p.items, ...p.floorItems].map(i => i.id)),
      ...(adjacentRoom?.pois.flatMap(p => [...p.items, ...p.floorItems].map(i => i.id)) ?? []),
    ]);
    for (const action of parsedActions) {
      if (action.item_id && !knownItemIds.has(action.item_id)) {
        console.warn(`[intent-parser] WARNING: Haiku returned unknown item_id "${action.item_id}" — nulling out`);
        action.item_id = null;
      }
    }

    // Combat turn gate: if in combat and it's not the player's turn, reject
    const inOwnRoomCombat = riRow?.gameState === 'combat' && !!riRow.combatState;
    if (inOwnRoomCombat) {
      const cs = riRow!.combatState as unknown as CombatState;
      console.log(`[stage3:turn] actor=${cs.activeActorId} player=${characterId} match=${cs.activeActorId === characterId}`);
      if (cs.activeActorId !== characterId) {
        throw Object.assign(new Error("It's not your turn"), { status: 409 });
      }
    }

    // Combat action resolution (Phase 3 + 4): resolve in-combat actions, then auto-resolve enemy turns
    // A remote-combat turn (LoS auto-enroll, character physically elsewhere) is only
    // actionable here when it's actually that character's turn in the remote room —
    // otherwise this room's exploration flow proceeds normally.
    const remoteIsMyTurn = !!remoteCombatRoomId && !!remoteCs && remoteCs.activeActorId === characterId;
    const inCombat = inOwnRoomCombat || remoteIsMyTurn;
    const cs = (inOwnRoomCombat ? riRow!.combatState : remoteCs) as unknown as CombatState;
    const combatRoomId = inOwnRoomCombat ? roomInstanceId : (remoteCombatRoomId ?? roomInstanceId);
    const combatActionTypes = new Set(['attack', 'shove', 'dodge', 'dash', 'disengage', 'hide', 'provoke', 'change_proximity', 'death_save', 'use_item', 'throw_item', 'use_class_feature']);
    const allCombatFacts: string[] = [];
    let playerCombatRollResult: ViewStatePayload['rollResult'] | undefined;
    let hadSilentKill = false; // Phase 13: suppress loud propagation for silent kills
    if (inCombat && parsedActions.length > 0) {
      const usage = cs.currentTurnUsage;
      const firstType = parsedActions[0].action_type;
      // Dying characters (0 HP, not yet dead) can only make death saving throws
      if (character.currentHp <= 0 && firstType !== 'death_save') {
        throw Object.assign(new Error('You are unconscious — you can only make a death saving throw on your turn.'), { status: 403 });
      }
      // Living characters cannot make death saving throws
      if (character.currentHp > 0 && firstType === 'death_save') {
        throw Object.assign(new Error('You cannot make a death saving throw — you are not unconscious.'), { status: 400 });
      }
      const mainActionTypes = new Set(['attack', 'dodge', 'dash', 'disengage', 'hide', 'provoke', 'use_item', 'throw_item']);
      const BONUS_ACTION_HINTS_GATE = ['Cunning Action', 'Second Wind', 'Channel Divinity'];
      const isClassFeature = firstType === 'use_class_feature' || action_hint === 'use_class_feature';
      const isThisBonusAction = isClassFeature || (!!action_hint && BONUS_ACTION_HINTS_GATE.some(h => action_hint.includes(h)));
      if (isThisBonusAction && usage.bonusActionUsed) {
        throw Object.assign(new Error('You have already used your bonus action this turn.'), { status: 400 });
      }
      // Validate the entire action sequence against available resources upfront so we
      // never execute a partial batch (e.g. move succeeds, action fails mid-turn).
      let seqActionUsed = usage.actionUsed;
      let seqMoveUsed   = usage.movementUsed;
      for (const a of parsedActions) {
        if (a.action_type === 'change_proximity') {
          if (seqMoveUsed) throw Object.assign(new Error('You have already used your movement this turn.'), { status: 400 });
          seqMoveUsed = true;
        } else if (mainActionTypes.has(a.action_type) && !isThisBonusAction) {
          if (seqActionUsed) throw Object.assign(new Error('You have already used your action this turn.'), { status: 400 });
          seqActionUsed = true;
        }
      }
    }
    if (inCombat && parsedActions.length > 0 && parsedActions.some(a => combatActionTypes.has(a.action_type))) {
      const mainHand = characterInventory.equipped.main_hand;
      const equippedWeapon = mainHand ? {
        damageDice: mainHand.damage_dice ?? '1d4',
        weaponType: mainHand.weapon_type ?? 'melee',
        silent: mainHand.silent,
        toHitBonus: mainHand.equip_bonus?.to_hit,
      } : null;
      const hasExtraAttack = classFeatures.some(f => f.name === 'Extra Attack' && f.featureType === 'PASSIVE');
      const numAttacks = hasExtraAttack ? calcAttacksPerAction(character.characterClass, character.level) : 1;
      const charCtxForCombat = { id: character.id, name: character.name, characterClass: character.characterClass, level: character.level, baseDexterity: character.baseDexterity, baseStrength: character.baseStrength, baseCharisma: character.baseCharisma, baseWisdom: character.baseWisdom, isHiding: character.isHiding, critThreshold: character.critThreshold ?? 20, attacksPerAction: numAttacks };

      // Process all parsed actions sequentially, carrying combat state forward.
      // This allows compound prompts like "move to the hay bale and hide" to
      // resolve both change_proximity and hide in a single turn.
      let csForCombat = cs;
      let combatResult = null as ReturnType<typeof resolveCombatAction> | null;
      for (const action of parsedActions) {
        if (!combatActionTypes.has(action.action_type)) continue;

        // OA: moving away from a close enemy triggers opportunity attacks unless Disengaged.
        if (inOwnRoomCombat && action.action_type === 'change_proximity') {
          const targetEntry = csForCombat.initiativeOrder.find(e => e.id === action.target_poi_instance_id);
          if (targetEntry && targetEntry.proximity === 'close') {
            const oaResult = resolveOpportunityAttacks(csForCombat, characterId, character.name, roomInstance.poiInstances);
            allCombatFacts.push(...oaResult.facts);
            if (oaResult.hpDamage > 0) {
              const newHp = Math.max(0, character.currentHp - oaResult.hpDamage);
              await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
            }
            csForCombat = oaResult.updatedCombatState;
          }
        }

        const result = resolveCombatAction(action, csForCombat, charCtxForCombat, equippedWeapon, characterInventory);
        allCombatFacts.push(...result.facts);
        csForCombat = result.updatedCombatState;

        if (!combatResult) {
          combatResult = result;
        } else {
          // Merge subsequent results into combatResult
          combatResult = {
            ...result,
            facts: [...combatResult.facts, ...result.facts],
            rollLogs: [...combatResult.rollLogs, ...result.rollLogs],
            deadEnemyPoiIds: [...combatResult.deadEnemyPoiIds, ...result.deadEnemyPoiIds],
            silentKillIds: new Set([...combatResult.silentKillIds, ...result.silentKillIds]),
            dbHpUpdates: [...combatResult.dbHpUpdates, ...result.dbHpUpdates],
            resourceUsages: [...combatResult.resourceUsages, ...result.resourceUsages],
            playerGainedHidden: result.playerGainedHidden ?? combatResult.playerGainedHidden,
            characterDied: combatResult.characterDied || result.characterDied,
            combatEnded: combatResult.combatEnded || result.combatEnded,
            updatedCombatState: csForCombat,
          };
        }
        if (combatResult.combatEnded || combatResult.characterDied) break;
      }
      if (!combatResult) combatResult = resolveCombatAction(parsedActions[0], cs, charCtxForCombat, equippedWeapon, characterInventory);

      // Inject flavor text and roll severity for narrative prompt
      const BARE_ATTACK_WORDS = new Set(['attack', 'i attack', 'hit', 'strike', 'shove', 'i shove', 'hide', 'i hide', 'dodge', 'i dodge', 'provoke', 'i provoke', 'disengage', 'dash']);
      const trimmedActionText = playerActionText.toLowerCase().trim();
      if (!BARE_ATTACK_WORDS.has(trimmedActionText) && playerActionText.trim().length > 0) {
        const safeFlavor = playerActionText.replace(/"/g, '\\"').slice(0, 120);
        allCombatFacts.push(`PLAYER FLAVOR: "${safeFlavor}". You MUST incorporate this exact action into your narration verbatim and match the player's tone precisely.`);
      }
      const primaryRoll = combatResult.rollLogs[0];
      const primaryRollActionType = parsedActions.find(a => ['attack', 'shove', 'hide', 'provoke'].includes(a.action_type))?.action_type ?? '';
      if (primaryRoll && primaryRollActionType) {
        const d20 = primaryRoll.d20;
        const outcome = primaryRoll.isCrit ? 'critical hit' : primaryRoll.success ? 'hit' : d20 === 1 ? 'fumble' : 'miss';
        allCombatFacts.push(`ROLL SEVERITY: d20=${d20}, outcome=${outcome}`);
      }

      // Capture roll result for response forwarding
      const primaryCombatLog = combatResult.rollLogs[0];
      if (primaryCombatLog && parsedActions[0]?.action_type !== 'death_save') {
        playerCombatRollResult = {
          d20: primaryCombatLog.d20,
          allRolls: primaryCombatLog.d20Rolls ? [...primaryCombatLog.d20Rolls] : undefined,
          success: primaryCombatLog.success,
          isCrit: primaryCombatLog.isCrit ?? false,
          damage: primaryCombatLog.damageRoll?.total,
          targetDefeated: combatResult.deadEnemyPoiIds.length > 0,
          rollType: primaryRollActionType as 'attack' | 'hide' | 'provoke' | 'shove' | undefined || undefined,
        };
      }

      if (parsedActions[0]?.action_type === 'death_save') {
        const rollLog = combatResult.rollLogs[0];
        console.log(`[stage3:death-save] char=${characterId} roll=${rollLog?.d20} outcome=${combatResult.characterDied ? 'dead' : combatResult.facts[0]}`);
      }

      // Write player combat roll badges
      for (const rollLog of combatResult.rollLogs) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollLog,
            text: `[COMBAT] ${combatResult.facts[0] ?? ''}`,
          },
        });
      }

      // Mark dead enemies in DB (from player attack) and collect xpValue + defeat flags
      const deadEnemyXpValues: { xpValue: number }[] = [];
      const defeatFlags: Record<string, true> = {};
      for (const deadId of combatResult.deadEnemyPoiIds) {
        const existingPoi = await prisma.poiInstance.findUnique({
          where: { id: deadId },
          select: { currentProperties: true, template: { select: { defaultProperties: true } } },
        });
        if (existingPoi) {
          await prisma.poiInstance.update({
            where: { id: deadId },
            data: { currentProperties: { ...(existingPoi.currentProperties as object), awareness_state: 'dead', current_hp: 0 } },
          });
          const dp = existingPoi.template.defaultProperties as Record<string, unknown>;
          const xpValue = typeof dp.xp_value === 'number' ? dp.xp_value : 0;
          deadEnemyXpValues.push({ xpValue });
          const cs = (dp.combat_stats as Record<string, unknown>) ?? {};
          if (typeof cs.defeat_flag === 'string') defeatFlags[cs.defeat_flag] = true;
        }
      }
      if (Object.keys(defeatFlags).length > 0) {
        const existingSession = await prisma.gameSession.findUniqueOrThrow({
          where: { id: roomInstance.session.id },
          select: { storyFlags: true },
        });
        const existingFlags = (existingSession.storyFlags as Record<string, unknown>) ?? {};
        await prisma.gameSession.update({
          where: { id: roomInstance.session.id },
          data: { storyFlags: { ...existingFlags, ...defeatFlags } as object },
        });
        console.log(`[combat] defeat flags set:`, defeatFlags);
      }

      // Award combat XP to all enrolled characters (Phase 3)
      if (deadEnemyXpValues.length > 0) {
        const totalXp = awardCombatXp(deadEnemyXpValues);
        if (totalXp > 0) {
          const currentCs = combatResult.combatEnded
            ? combatResult.updatedCombatState
            : combatResult.updatedCombatState;
          const enrolledCharIds = currentCs.initiativeOrder
            .filter(e => e.type === 'character')
            .map(e => e.id);
          const sourceText = deadEnemyXpValues.length === 1
            ? (combatResult.updatedCombatState.initiativeOrder.find(e => combatResult.deadEnemyPoiIds.includes(e.id))?.name ?? 'enemy')
            : `${deadEnemyXpValues.length} enemies`;
          for (const charId of enrolledCharIds) {
            const charData = await prisma.character.findUnique({
              where: { id: charId },
              select: {
                id: true, characterClass: true, baseConstitution: true,
                xp: true, level: true, currentHp: true, maxHp: true,
                pendingChoicesQueue: true, featuresUnlocked: true,
              },
            });
            if (charData) {
              await prisma.$transaction(async tx => {
                await applyXpAward(tx, {
                  ...charData,
                  pendingChoicesQueue: (charData.pendingChoicesQueue ?? []) as unknown[],
                  featuresUnlocked: charData.featuresUnlocked ?? [],
                }, totalXp, sourceText, combatRoomId);
              });
            }
          }
        }
      }

      // Apply HP updates from item heals or Crimson Rite cost
      for (const upd of combatResult.dbHpUpdates) {
        const targetChar = await prisma.character.findUnique({ where: { id: upd.id }, select: { currentHp: true, maxHp: true } });
        if (targetChar) {
          await prisma.character.update({
            where: { id: upd.id },
            data: { currentHp: Math.min(targetChar.maxHp, Math.max(0, targetChar.currentHp + upd.hpDelta)) },
          });
        }
      }

      // Decrement resource pools consumed by class features
      for (const usage of combatResult.resourceUsages) {
        const existing = await prisma.characterResourceState.findUnique({
          where: { characterId_poolKey: { characterId, poolKey: usage.poolKey } },
        });
        if (existing) {
          await prisma.characterResourceState.update({
            where: { characterId_poolKey: { characterId, poolKey: usage.poolKey } },
            data: { current: Math.max(0, existing.current + usage.delta) },
          });
        }
      }

      // Phase 13: persist hide state and track silent kills
      if (combatResult.playerGainedHidden !== null) {
        await prisma.character.update({ where: { id: characterId }, data: { isHiding: combatResult.playerGainedHidden } });
      }
      hadSilentKill = combatResult.silentKillIds.size > 0;

      if (combatResult.characterDied) {
        // Heroic sacrifice: push to pendingChoicesQueue instead of setting isDead directly
        const csWithStabilized = {
          ...combatResult.updatedCombatState,
          initiativeOrder: combatResult.updatedCombatState.initiativeOrder.map(e =>
            e.id === characterId ? { ...e, isStabilized: true } : e
          ),
        };
        await prisma.$transaction([
          prisma.character.update({
            where: { id: characterId },
            data: {
              pendingChoicesQueue: {
                push: {
                  type: 'heroic_sacrifice',
                  fallenName: character.name,
                  fallenClass: character.characterClass,
                  fallenLevel: character.level,
                },
              },
            },
          }),
          prisma.messageLog.create({
            data: {
              roomInstanceId: combatRoomId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'heroic_sacrifice', characterName: character.name },
              text: `[FALLEN] ${character.name} has fallen. The party has a sneaking suspicion they haven't seen the last of ${character.name}'s story...`,
            },
          }),
          prisma.roomInstance.update({
            where: { id: combatRoomId },
            data: { combatState: advanceTurn(csWithStabilized) as object },
          }),
        ]);
        console.log(`[stage3:combat] heroic_sacrifice queued for ${characterId}`);
      } else if (combatResult.combatEnded) {
        await prisma.roomInstance.update({ where: { id: combatRoomId }, data: { gameState: 'exploration', combatState: Prisma.JsonNull } });
        await prisma.character.update({ where: { id: characterId }, data: { isHiding: false } });
        console.log('[stage3:combat] combat ended — all enemies dead');
      } else {
        // Player's turn remains active — enemies act when player ends turn
        // use_class_feature always marks bonus action (handled in resolveCombatAction's turnUsage)
        const BONUS_ACTION_HINTS = ['Cunning Action', 'Second Wind', 'Channel Divinity'];
        const isBonusAction = parsedActions[0]?.action_type === 'use_class_feature'
          || action_hint === 'use_class_feature'
          || (!!action_hint && BONUS_ACTION_HINTS.some(h => action_hint.includes(h)));
        const finalUpdatedCs = isBonusAction
          ? { ...combatResult.updatedCombatState, currentTurnUsage: { ...combatResult.updatedCombatState.currentTurnUsage, bonusActionUsed: true } }
          : combatResult.updatedCombatState;

        if (parsedActions[0]?.action_type === 'death_save') {
          // Dying characters can't extend their turn — auto-advance and let enemies act.
          const advancedCs = advanceTurn(finalUpdatedCs);
          await prisma.roomInstance.update({ where: { id: combatRoomId }, data: { combatState: advancedCs as object } });
          const playerCsEntry = finalUpdatedCs.initiativeOrder.find(e => e.id === characterId);
          const playerGridSlot = playerCsEntry?.grid_slot
            ?? ((roomInstance.poiInstances.find(p => p.id === currentProximityPoiId)?.template as Record<string, unknown> | undefined)?.grid_slot as string)
            ?? 'C';
          await autoResolveLeadingEnemyTurns(combatRoomId, characterId, character.name, character.currentHp, character.isHiding ?? false, playerGridSlot, allCombatFacts);
        } else {
          await prisma.roomInstance.update({ where: { id: combatRoomId }, data: { combatState: finalUpdatedCs as object } });
        }

        // Phase 13: body discovery / patrol — these reason about the combat room's own
        // POIs and only apply when the character is physically present there.
        if (!remoteCombatRoomId) {
          // Phase 13: body discovery — unaware enemies check for newly dead allies
          const newDeadCount = combatResult.deadEnemyPoiIds.length;
          if (newDeadCount > 0) {
            for (const poi of roomInstance.poiInstances) {
              const cp = poi.currentProperties as Record<string, unknown>;
              if (cp.awareness_state !== 'unaware') continue;
              const dp = poi.template.defaultProperties as Record<string, unknown>;
              const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
              const { escalate } = resolveBodyDiscovery(
                combatStats.wis_score ?? 10,
                combatStats.passive_perception,
                'visible',
              );
              console.log(`[stage13:body-discovery] ${poi.template.name} check: escalate=${escalate}`);
              if (escalate) {
                await prisma.poiInstance.update({
                  where: { id: poi.id },
                  data: { currentProperties: { ...(cp as object), awareness_state: 'suspicious' } },
                });
                allCombatFacts.push(`${poi.template.name} notices something wrong and becomes alert!`);
              }
            }
          }

          // Phase 13: patrol — suspicious enemies approach
          for (const poi of roomInstance.poiInstances) {
            const dp = poi.template.defaultProperties as Record<string, unknown>;
            if (!dp.patrol) continue;
            const cp = poi.currentProperties as Record<string, unknown>;
            const awareness = cp.awareness_state as string | undefined;
            if (awareness === 'suspicious') {
              allCombatFacts.push(`${poi.template.name} moves toward the doorway, drawn by a sound...`);
            }
          }
        }
      }

      // Melee attack: move attacker to the target's grid position (only meaningful when
      // the character is physically present in the combat room).
      const attackAction = parsedActions[0];
      if (!remoteCombatRoomId && attackAction.action_type === 'attack' && attackAction.target_poi_instance_id && equippedWeapon?.weaponType !== 'ranged') {
        const existingPart = await prisma.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const existingCs = (existingPart?.combatState ?? {}) as Record<string, unknown>;
        await prisma.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...existingCs, proximity_target_id: attackAction.target_poi_instance_id }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: attackAction.target_poi_instance_id } },
        });
      }
    }

    // Stage 3
    const characterCtx: CharacterContext = {
      id: characterId,
      name: character.name,
      characterClass: character.characterClass,
      level: character.level,
      skillsModifiers: character.skillsModifiers,
      skillProficiencies: character.skillProficiencies,
      baseWisdom: character.baseWisdom,
      baseDexterity: character.baseDexterity,
      baseStrength: character.baseStrength,
      baseCharisma: character.baseCharisma,
      currentHp: character.currentHp,
      maxHp: character.maxHp,
      isHiding: character.isHiding,
    };

    // Phase 5: opportunity attacks fire when player flees (move_to_room in combat).
    // Only applies when the character is physically present in their combat room — a
    // remote-combat participant moving within their own exploration room isn't fleeing.
    if (inOwnRoomCombat && parsedActions[0]?.action_type === 'move_to_room') {
      const oppResult = resolveOpportunityAttacks(cs, characterId, character.name, roomInstance.poiInstances);
      allCombatFacts.push(...oppResult.facts);
      if (oppResult.hpDamage > 0) {
        const newHp = Math.max(0, character.currentHp - oppResult.hpDamage);
        await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
      }
      // Fleeing ends the player's turn — advance initiative so enemies left behind can act.
      const advancedCs = advanceTurn(oppResult.updatedCombatState);

      // Remove the fleeing character from this room's combat — they're no longer here to act,
      // and leaving a stale entry behind causes this room to keep alerting/redirecting them.
      const remainingOrder = advancedCs.initiativeOrder.filter(e => e.id !== characterId);
      const stillHasCharacters = remainingOrder.some(e => e.type === 'character');

      if (!stillHasCharacters) {
        await prisma.roomInstance.update({ where: { id: roomInstanceId }, data: { gameState: 'exploration', combatState: Prisma.JsonNull } });
        console.log('[stage3:combat] combat ended in source room — fled with no characters remaining');
      } else {
        const activeActorId = remainingOrder.some(e => e.id === advancedCs.activeActorId)
          ? advancedCs.activeActorId
          : (remainingOrder.find(e => !e.isDormant && !(e.type === 'enemy' && e.hp <= 0)) ?? remainingOrder[0]).id;
        await prisma.roomInstance.update({ where: { id: roomInstanceId }, data: { combatState: { ...advancedCs, initiativeOrder: remainingOrder, activeActorId } as object } });
      }
      for (const rollData of oppResult.rollData) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollData,
            text: `[COMBAT] ${rollData.action}`,
          },
        });
      }
    }

    const { appliedActions, newRoomInstanceId } = await mutateGameState(
      parsedActions,
      characterCtx,
      roomInstanceId,
      roomInstance.session.id,
      exitPoiMap,
      validPoiMap,
      openSpacePoiId,
      inCombat,
    );

    // Check whether any story flags set this turn complete the current act
    await checkAndAdvanceAct(roomInstance.session.id);

    // Phase 6a: suspicious enemies in current room escalate to alert on any player action.
    // Hostile enemies escalate even when the player is hiding — they already know the player is an enemy.
    // Non-hostile suspicious NPCs only escalate when the player is visible.
    if (!newRoomInstanceId) {
      for (const poi of roomInstance.poiInstances) {
        const dp = poi.template.defaultProperties as Record<string, unknown>;
        const cp = poi.currentProperties as Record<string, unknown>;
        if (dp.poi_type !== 'npc' || cp.awareness_state !== 'suspicious') continue;
        const isHostile = Array.isArray(cp.hostile_to) && (cp.hostile_to as string[]).includes('player');
        if (!isHostile && character.isHiding) continue;
        await prisma.poiInstance.update({ where: { id: poi.id }, data: { currentProperties: { ...cp, awareness_state: 'alert' } } });
        allCombatFacts.push(`${poi.template.name} spots you — they are now hostile.`);
        console.log(`[stage3:detection] ${poi.template.name}: suspicious → alert (hostile, escalating)`);
        // Keep poiContexts in sync so detectCombatTrigger sees the updated state
        const ctx = poiContexts.find(c => c.id === poi.id);
        if (ctx) ctx._currentAwareness = 'alert';
      }
    }

    // Phase 6: on room entry, run awareness detection for enemies in new room
    if (newRoomInstanceId && parsedActions[0]?.action_type === 'move_to_room') {
      const newRoomFull = await prisma.roomInstance.findUniqueOrThrow({
        where: { id: newRoomInstanceId },
        include: { poiInstances: { include: { template: true } } },
      });
      // Loud actions before entering (e.g. opening a door) break stealth even if isHiding was true.
      const hadLoudActionBeforeEntry = parsedActions.some(
        a => a.action_type === 'interact' || a.action_type === 'force_open' || a.action_type === 'destroy_poi',
      );
      const isSneaking = character.isHiding && !hadLoudActionBeforeEntry;
      const dexMod = abilityModifier(character.baseDexterity);
      const stealthD20 = isSneaking ? randomInt(1, 21) : 0;
      const stealthTotal = isSneaking ? stealthD20 + dexMod : 0;
      console.log(`[stage3:detection] room=${newRoomInstanceId} sneaking=${isSneaking} loudBefore=${hadLoudActionBeforeEntry}`);
      for (const poi of newRoomFull.poiInstances) {
        const dp = poi.template.defaultProperties as Record<string, unknown>;
        const cp = poi.currentProperties as Record<string, unknown>;
        const awareness = cp.awareness_state as string | undefined;
        if (!awareness || awareness === 'alert' || awareness === 'dead') continue;
        const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
        const wisScore = combatStats.wis_score ?? 10;
        const passivePerception = combatStats.passive_perception ?? (10 + abilityModifier(wisScore));
        if (awareness === 'unaware' || awareness === 'suspicious') {
          if (!isSneaking) {
            await prisma.poiInstance.update({ where: { id: poi.id }, data: { currentProperties: { ...cp, awareness_state: 'alert' } } });
            allCombatFacts.push(`A ${poi.template.name} is present in this room and spots your entry — they are hostile.`);
            console.log(`[stage3:detection] ${poi.template.name}: ${awareness} → alert (visible entry)`);
          } else {
            const detected = stealthTotal < passivePerception;
            console.log(`[stage3:stealth] roll=${stealthTotal} vs DC=${passivePerception} result=${detected ? 'fail' : 'pass'}`);
            await prisma.messageLog.create({
              data: {
                roomInstanceId: newRoomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: {
                  type: 'combat_roll',
                  action: 'Your Stealth',
                  d20: stealthD20,
                  modifier: dexMod,
                  total: stealthTotal,
                  vsTarget: `${poi.template.name}'s Perception ${passivePerception}`,
                  success: !detected,
                },
                text: `🎲 Your Stealth: ${stealthD20}${dexMod !== 0 ? `+${dexMod}` : ''}=${stealthTotal} vs ${poi.template.name}'s Perception ${passivePerception} — ${detected ? 'detected' : 'undetected'}`,
              },
            });
            if (detected) {
              const nextAwareness = awareness === 'suspicious' ? 'alert' : 'suspicious';
              await prisma.poiInstance.update({ where: { id: poi.id }, data: { currentProperties: { ...cp, awareness_state: nextAwareness } } });
              if (nextAwareness === 'alert') {
                allCombatFacts.push(`A ${poi.template.name} was already on guard and spots you sneaking in.`);
              } else {
                allCombatFacts.push(`A ${poi.template.name} is present in this room and heard something — their gaze sharpens (awareness: suspicious).`);
              }
            } else {
              allCombatFacts.push(`A ${poi.template.name} is present in this room but remains unaware of you.`);
            }
          }
        }
      }
    }

    // Phase 6: auto-join combat when entering a combat room
    if (newRoomInstanceId && parsedActions[0]?.action_type === 'move_to_room') {
      const newRoomForJoin = await prisma.roomInstance.findUnique({
        where: { id: newRoomInstanceId },
        select: { gameState: true, combatState: true },
      });
      if (newRoomForJoin?.gameState === 'combat') {
        // Compute resolvedIsHiding: check stealth vs combat enemies if sneaking
        const hadLoudBefore = parsedActions.some(
          a => a.action_type === 'interact' || a.action_type === 'force_open' || a.action_type === 'destroy_poi',
        );
        const isSneakingForJoin = character.isHiding && !hadLoudBefore;
        let resolvedIsHidingForJoin = isSneakingForJoin;
        if (isSneakingForJoin && newRoomForJoin.combatState) {
          const cs = newRoomForJoin.combatState as unknown as CombatState;
          const dexModForJoin = abilityModifier(character.baseDexterity);
          const stealthRollForJoin = randomInt(1, 21) + dexModForJoin;
          for (const entry of cs.initiativeOrder) {
            if (entry.type !== 'enemy' || entry.hp <= 0) continue;
            const pp = entry.passive_perception ?? 10;
            if (stealthRollForJoin < pp) {
              resolvedIsHidingForJoin = false;
              break;
            }
          }
        }
        await joinCombat(characterId, newRoomInstanceId, resolvedIsHidingForJoin);
        await autoResolveLeadingEnemyTurns(newRoomInstanceId, characterId, character.name, character.currentHp, character.isHiding ?? false, 'C', allCombatFacts);
      }
    }

    // Phase 5c: adjacent-room LoS combat re-entry — if the new room has a peekable exit
    // back to a room in active combat, the character re-entered enemy LoS and rejoins.
    if (newRoomInstanceId && parsedActions[0]?.action_type === 'move_to_room') {
      const newRoomPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId: newRoomInstanceId },
        include: { template: { select: { defaultProperties: true } } },
      });
      for (const pi of newRoomPois) {
        const dp = pi.template.defaultProperties as Record<string, unknown>;
        const cp = (pi.currentProperties as Record<string, unknown>) ?? {};
        if (dp.poi_type !== 'exit') continue;
        const targetTemplateId = (dp.enter as Record<string, unknown> | undefined)?.target_room_template_id as string | undefined;
        if (!targetTemplateId) continue;
        const effectivePeek = computeEffectivePeek(
          (dp.peek_visibility as string) ?? 'none',
          computeIsLockable(dp.locked_by) && cp.unlocked !== true,
          cp.interacted === true,
          cp.destroyed === true,
        );
        if (effectivePeek === 'none') continue;
        const adjRoom = await prisma.roomInstance.findFirst({
          where: { sessionId: roomInstance.session.id, roomTemplateId: targetTemplateId },
          select: { id: true, gameState: true },
        });
        if (!adjRoom || adjRoom.gameState !== 'combat' || adjRoom.id === roomInstanceId) continue;
        await joinCombat(characterId, adjRoom.id, character.isHiding);
        await autoResolveLeadingEnemyTurns(adjRoom.id, characterId, character.name, character.currentHp, character.isHiding ?? false, 'C', allCombatFacts);
      }
    }

    // Phase 6: loud action propagation to adjacent rooms for attack/destroy_poi
    // Phase 13: suppress propagation for silent kills (player hidden + silent weapon + instant kill)
    const firstParsedAction = parsedActions[0];
    if (!hadSilentKill && (firstParsedAction?.action_type === 'attack' || firstParsedAction?.action_type === 'destroy_poi' || firstParsedAction?.action_type === 'force_open')) {
      const targetPoi = firstParsedAction.target_poi_instance_id
        ? roomInstance.poiInstances.find(p => p.id === firstParsedAction.target_poi_instance_id)
        : null;
      const isLoud = !targetPoi || (targetPoi.template.defaultProperties as Record<string, unknown>).loud !== false;
      if (isLoud) {
        const exits = roomInstance.poiInstances.filter(p => {
          const dp = p.template.defaultProperties as Record<string, unknown>;
          return dp.poi_type === 'exit' && (dp.enter as Record<string, unknown>)?.target_room_template_id;
        });
        for (const exit of exits) {
          const dp = exit.template.defaultProperties as Record<string, unknown>;
          const cp = exit.currentProperties as Record<string, unknown>;
          const enterVerb = dp.enter as Record<string, unknown>;
          const targetTemplateId = enterVerb.target_room_template_id as string;
          const barrierDc = dp.peek_visibility === 'none' ? (cp.unlocked ? 15 : 18) : 10;
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: targetTemplateId },
            include: { poiInstances: { include: { template: true } } },
          });
          if (!adjRoom) continue;
          console.log(`[stage3:loud] propagating to adjacent room ${adjRoom.id}, barrier DC=${barrierDc}`);
          for (const adjPoi of adjRoom.poiInstances) {
            const adjDp = adjPoi.template.defaultProperties as Record<string, unknown>;
            const adjCp = adjPoi.currentProperties as Record<string, unknown>;
            const awareness = adjCp.awareness_state as string | undefined;
            if (!awareness || awareness === 'alert' || awareness === 'dead') continue;
            const wisMod = abilityModifier((adjDp.combat_stats as PoiCombatStats | undefined)?.wis_score ?? 10);
            const hearRoll = randomInt(1, 21) + wisMod;
            const nextAwareness = awareness === 'unaware' ? 'suspicious' : 'alert';
            console.log(`[stage3:loud] ${adjPoi.template.name}: roll=${hearRoll} vs DC=${barrierDc} → ${hearRoll >= barrierDc ? nextAwareness : 'unchanged'}`);
            if (hearRoll >= barrierDc) {
              await prisma.poiInstance.update({ where: { id: adjPoi.id }, data: { currentProperties: { ...adjCp, awareness_state: nextAwareness } } });
            }
          }
        }
      }
    }

    // Enemy state summary — always re-fetch so Phase 6/6a writes are reflected accurately
    {
      const summaryRoomId = newRoomInstanceId ?? roomInstanceId;
      const summaryRoom = await prisma.roomInstance.findUnique({ where: { id: summaryRoomId }, include: { poiInstances: { include: { template: true } } } });
      if (summaryRoom) {
        const enemySummaries = summaryRoom.poiInstances
          .filter(p => {
            const dp = p.template.defaultProperties as Record<string, unknown>;
            const cp = p.currentProperties as Record<string, unknown>;
            return dp.poi_type === 'npc' && cp.awareness_state !== 'dead';
          })
          .map(p => {
            const cp = p.currentProperties as Record<string, unknown>;
            const awareness = (cp.awareness_state as string) ?? 'unaware';
            const hostile = Array.isArray(cp.hostile_to) && (cp.hostile_to as string[]).includes('player');
            const willAttack = hostile && awareness === 'alert';
            const intent = willAttack ? ' → WILL ATTACK' : hostile && awareness === 'suspicious' ? ' → hunting' : '';
            return `${p.template.name}: ${awareness}${hostile ? ' [hostile]' : ''}${intent}`;
          });
        if (enemySummaries.length > 0) {
          console.log(`[enemies] ${enemySummaries.join(' | ')}`);
        }
      }
    }

    // Combat entry: check if any parsed action (or alert enemy) triggers combat.
    // Skipped for a remote-combat-turn action — detectCombatTrigger returns true for
    // any 'attack', which would otherwise spuriously start a second combat in the
    // player's own (exploration) room.
    const currentSessionGameState = riRow?.gameState ?? 'exploration';
    if (!remoteIsMyTurn && currentSessionGameState !== 'combat' && parsedActions.length > 0) {
      const firstAction = parsedActions[0];
      const storyFlags = (roomInstance.session.storyFlags as Record<string, unknown>) ?? {};

      // When the player moved rooms, Phase 6 may have set enemies there to alert — build
      // check contexts from a fresh fetch so detectCombatTrigger sees those writes.
      let checkContexts = poiContexts as CombatPoiContext[];
      if (newRoomInstanceId) {
        const freshNewRoom = await prisma.roomInstance.findUniqueOrThrow({ where: { id: newRoomInstanceId }, include: { poiInstances: { include: { template: true } } } });
        checkContexts = freshNewRoom.poiInstances.map(poi => {
          const dp = poi.template.defaultProperties as Record<string, unknown>;
          const cp = poi.currentProperties as Record<string, unknown>;
          return {
            id: poi.id,
            _currentAwareness: cp.awareness_state as string | undefined,
            _hostileTo: Array.isArray(cp.hostile_to) ? (cp.hostile_to as string[]) : undefined,
            _recognitionException: (dp.recognition_exception as string) ?? undefined,
          } as unknown as CombatPoiContext;
        });
      }

      // LoS visibility log: what the player can see and what enemies can see
      {
        const logRoomId = newRoomInstanceId ?? roomInstanceId;
        const logRoom = await prisma.roomInstance.findUnique({
          where: { id: logRoomId },
          include: { poiInstances: { include: { template: true } } },
        });
        const playerVisibleNpcs = (logRoom?.poiInstances ?? []).filter(p => {
          const dp = p.template.defaultProperties as Record<string, unknown>;
          const cp = p.currentProperties as Record<string, unknown>;
          return dp.poi_type === 'npc' && cp.awareness_state !== 'dead';
        });
        if (playerVisibleNpcs.length > 0) {
          console.log(`[los:player] same-room NPCs: ${playerVisibleNpcs.map(p => {
            const cp = p.currentProperties as Record<string, unknown>;
            return `${p.template.name}(${cp.awareness_state ?? 'unaware'})`;
          }).join(', ')}`);
        }
        // Adjacent rooms: check peekable exits for visible NPCs
        const allExits = (logRoom?.poiInstances ?? []).filter(p => {
          const dp = p.template.defaultProperties as Record<string, unknown>;
          return dp.poi_type === 'exit';
        });
        for (const exitPoi of allExits) {
          const dp = exitPoi.template.defaultProperties as Record<string, unknown>;
          const cp = (exitPoi.currentProperties as Record<string, unknown>) ?? {};
          const targetTemplateId = (dp.enter as Record<string, unknown> | undefined)?.target_room_template_id as string | undefined;
          if (!targetTemplateId) continue;
          const peek = computeEffectivePeek(
            (dp.peek_visibility as string) ?? 'none',
            computeIsLockable(dp.locked_by) && cp.unlocked !== true,
            cp.interacted === true,
            cp.destroyed === true,
          );
          if (peek === 'none') continue;
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: targetTemplateId },
            include: { poiInstances: { include: { template: true } } },
          });
          if (!adjRoom) continue;
          const adjNpcs = adjRoom.poiInstances.filter(p => {
            const adp = p.template.defaultProperties as Record<string, unknown>;
            const acp = p.currentProperties as Record<string, unknown>;
            return adp.poi_type === 'npc' && acp.awareness_state !== 'dead';
          });
          if (adjNpcs.length > 0) {
            console.log(`[los:player] adjacent NPCs via ${exitPoi.template.name}(peek=${peek}): ${adjNpcs.map(p => {
              const acp = p.currentProperties as Record<string, unknown>;
              const hostile = Array.isArray(acp.hostile_to) && (acp.hostile_to as string[]).includes('player');
              return `${p.template.name}(${acp.awareness_state ?? 'unaware'}${hostile ? ',hostile' : ''})`;
            }).join(', ')}`);
          }
        }
      }

      let combatTriggered = detectCombatTrigger(
        firstAction,
        checkContexts,
        currentSessionGameState,
        storyFlags,
      );
      console.log(`[los:combat-trigger] same-room check → ${combatTriggered}`);

      // If the player is not in combat and tried to attack but no enemies are present,
      // reject early so we never enter an empty combat state.
      if (!combatTriggered && !inCombat && firstAction.action_type === 'attack') {
        throw Object.assign(
          new Error('There are no enemies here to attack. The battle is elsewhere.'),
          { status: 400 },
        );
      }

      // Also check adjacent rooms: alert hostile enemies visible through peekable exits
      // can see the player and will engage (D&D 5e LoS rule).
      let adjCombatRoomId: string | null = null;
      if (!combatTriggered && firstAction.action_type !== 'attack') {
        const logRoomId = newRoomInstanceId ?? roomInstanceId;
        const logRoom = await prisma.roomInstance.findUnique({
          where: { id: logRoomId },
          include: { poiInstances: { include: { template: true } } },
        });
        for (const exitPoi of (logRoom?.poiInstances ?? [])) {
          const dp = exitPoi.template.defaultProperties as Record<string, unknown>;
          const cp = (exitPoi.currentProperties as Record<string, unknown>) ?? {};
          if (dp.poi_type !== 'exit') continue;
          const targetTemplateId = (dp.enter as Record<string, unknown> | undefined)?.target_room_template_id as string | undefined;
          if (!targetTemplateId) continue;
          const peek = computeEffectivePeek(
            (dp.peek_visibility as string) ?? 'none',
            computeIsLockable(dp.locked_by) && cp.unlocked !== true,
            cp.interacted === true,
            cp.destroyed === true,
          );
          if (peek === 'none') continue;
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: targetTemplateId },
            select: { id: true, gameState: true },
          });
          if (!adjRoom) continue;
          // Skip rooms already in combat — enterCombat's LoS scan handles enrollment
          // when combat starts; a player who arrives later shouldn't be dragged into an
          // existing fight in another room just by looking around.
          if (adjRoom.gameState === 'combat') continue;
          // Build contexts for adjacent room
          const adjFull = await prisma.roomInstance.findUniqueOrThrow({
            where: { id: adjRoom.id },
            include: { poiInstances: { include: { template: true } } },
          });
          const adjContexts = adjFull.poiInstances.map(poi => {
            const adp = poi.template.defaultProperties as Record<string, unknown>;
            const acp = poi.currentProperties as Record<string, unknown>;
            return {
              id: poi.id,
              _currentAwareness: acp.awareness_state as string | undefined,
              _hostileTo: Array.isArray(acp.hostile_to) ? (acp.hostile_to as string[]) : undefined,
              _recognitionException: (adp.recognition_exception as string) ?? undefined,
            } as unknown as CombatPoiContext;
          });
          const adjTriggered = detectCombatTrigger(firstAction, adjContexts, currentSessionGameState, storyFlags);
          console.log(`[los:combat-trigger] adjacent room via ${exitPoi.template.name}(peek=${peek}) → ${adjTriggered}`);
          if (adjTriggered) {
            combatTriggered = true;
            adjCombatRoomId = adjRoom.id;
            break;
          }
        }
      }

      if (combatTriggered) {
        if (adjCombatRoomId) {
          // Cross-room combat: enemy in adjacent room spotted through a peekable exit.
          // enterCombat handles LoS auto-enroll for all adjacent players; joinCombat is a
          // fallback no-op if the current character was already enrolled.
          const adjRoomFull = await prisma.roomInstance.findUniqueOrThrow({
            where: { id: adjCombatRoomId },
            include: { poiInstances: { include: { template: true } }, template: { select: { name: true } } },
          });
          await enterCombat(adjRoomFull, roomInstance.session.id);
          await joinCombat(characterId, adjCombatRoomId, character.isHiding ?? false, roomInstanceId);
          allCombatFacts.push(`${character.name} spots a hostile enemy through the passage — combat begins!`);
          await autoResolveLeadingEnemyTurns(adjCombatRoomId, characterId, character.name, character.currentHp, character.isHiding ?? false, 'C', allCombatFacts);
        } else {
          // Same-room combat: enterCombat here, then auto-resolve any leading enemy turns.
          const activeRoomId = newRoomInstanceId ?? roomInstanceId;
          // Always re-fetch so Phase 6/6a awareness writes are visible in enterCombat
          const activeRoomInstance = await prisma.roomInstance.findUniqueOrThrow({ where: { id: activeRoomId }, include: { poiInstances: { include: { template: true } }, template: { select: { name: true } } } });
          await enterCombat(activeRoomInstance, roomInstance.session.id);
          const combatStartPlayerSlot = (activeRoomInstance.poiInstances.find(p => p.id === currentProximityPoiId)?.template as Record<string, unknown> | undefined)?.grid_slot as string ?? 'C';
          await autoResolveLeadingEnemyTurns(activeRoomInstance.id, characterId, character.name, character.currentHp, character.isHiding ?? false, combatStartPlayerSlot, allCombatFacts);
        }
      }
    }

    // Resolve active room context (may change after move_to_room)
    let activeRoomInstanceId = roomInstanceId;
    let activeRoomName = roomInstance.template.name;
    let activeRoomDescription = roomInstance.template.baseDescription;
    let activeGameState = riRow?.gameState ?? 'exploration';
    let activeCharacterProximityTargetId: string | null = null;

    // Read current participant proximity for LoS filter
    const participant = await prisma.roomParticipant.findUnique({
      where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
    });
    activeCharacterProximityTargetId =
      ((participant?.combatState as Record<string, unknown>)?.proximity_target_id as string) ?? null;

    if (newRoomInstanceId) {
      activeRoomInstanceId = newRoomInstanceId;
      activeCharacterProximityTargetId = null; // just arrived, in open space
      const newRoom = await prisma.roomInstance.findUniqueOrThrow({
        where: { id: newRoomInstanceId },
        select: { gameState: true, template: { select: { name: true, baseDescription: true } } },
      });
      activeRoomName = newRoom.template.name;
      activeRoomDescription = newRoom.template.baseDescription;
      activeGameState = newRoom.gameState;
    }

    // Stage 4 + 5: narrative + view-state
    // For combat roll-sheet actions: fire-and-forget narrative so the response returns immediately
    // with rollResult while Haiku generates the prose concurrently.
    if (playerCombatRollResult !== undefined) {
      const narrativeArgs: Parameters<typeof generateAndPersistNarrative> = [
        activeRoomInstanceId,
        characterId,
        character.name,
        activeRoomName,
        activeRoomDescription,
        appliedActions,
        roomInstance.session.id,
        allCombatFacts.length > 0 ? allCombatFacts : undefined,
        roomInstance.participants.map(p => p.character.name),
      ];
      generateAndPersistNarrative(...narrativeArgs).catch(async (err) => {
        console.warn('[narrative] generation failed, retrying once:', err);
        try {
          await generateAndPersistNarrative(...narrativeArgs);
        } catch (retryErr) {
          console.error('[narrative] retry failed, writing mechanical summary:', retryErr);
          await persistMechanicalSummary(activeRoomInstanceId, roomInstance.session.id, playerCombatRollResult!, characterId);
        }
      });
      const rawViewState = await prefetchViewStateData(activeRoomInstanceId, characterId, roomInstance.session.id);
      const viewState = await assembleViewState(rawViewState, activeRoomInstanceId, activeGameState, characterId, roomInstance.session.id, activeCharacterProximityTargetId);
      return { ...viewState, rollResult: playerCombatRollResult };
    }

    // Non-combat or non-roll-sheet: await narrative (no animation window, no shimmer)
    const [narrativeResult, rawViewState] = await Promise.all([
      generateAndPersistNarrative(
        activeRoomInstanceId,
        characterId,
        character.name,
        activeRoomName,
        activeRoomDescription,
        appliedActions,
        roomInstance.session.id,
        allCombatFacts.length > 0 ? allCombatFacts : undefined,
        roomInstance.participants.map(p => p.character.name),
      ),
      prefetchViewStateData(activeRoomInstanceId, characterId, roomInstance.session.id),
    ]);

    // Stage 5 assembly: injects narrative text directly (prefetch may predate the DB write)
    const viewState = await assembleViewState(
      rawViewState,
      activeRoomInstanceId,
      activeGameState,
      characterId,
      roomInstance.session.id,
      activeCharacterProximityTargetId,
      narrativeResult.text,
    );

    return viewState;
    } finally {
      if (isExplorationAction) {
        await prisma.roomInstance.update({
          where: { id: roomInstanceId },
          data: { processingAction: false },
        }).catch(() => {});
      }
    }
  }
}
