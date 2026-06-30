import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { rollD20Check, abilityModifier } from '@/lib/dice';
import { rollStealthCheck } from '@/lib/stealth';
import { normalizeInventory, extractPoiItems, inventorySummary, resolveEquipSlot } from '@/lib/v2/item-helpers';
import { extractExitInfo, extractAvailableStances } from '@/lib/v2/poi-context-helpers';
import { slotGridDistance, isPoiVisibleThroughExit } from '@/lib/v2/room-geometry';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';
import {
  detectCombatTrigger, enterCombat, resolveCombatAction,
  resolveOpportunityAttacks, checkCombatEnd, exitCombat, advanceTurn,
} from '@/lib/v2/combat-engine';
import type { OpportunityAttackResult, EnemyTurnResult } from '@/lib/v2/combat-engine';
import type { ExtractedAction, CharacterInventory, ItemDefinition, CombatState } from '@/types/v2-game';
import type { PoiContext } from '@/lib/v2/poi-context';

// ─── Stage 3: Deterministic State Mutation ───────────────────────────────────

export interface AppliedAction {
  action: ExtractedAction;
  poiName: string | null;
  itemName: string | null;
  overrideFact?: string;
}

export interface MutationResult {
  appliedActions: AppliedAction[];
  newRoomInstanceId: string | null;
}

export interface CharacterContext {
  id: string;
  name: string;
  characterClass: string;
  level: number;
  skillsModifiers: unknown;
  skillProficiencies: string[];
  baseWisdom: number;
  baseDexterity: number;
  baseStrength: number;
  baseCharisma: number;
  currentHp: number;
  maxHp: number;
  isHiding: boolean;
}

function requireValidPoi(id: string | null, validPoiMap: Map<string, string>): string {
  if (!id || !validPoiMap.has(id)) {
    throw new Error(`Invalid target_poi_instance_id "${id}" — aborting to prevent corrupt state.`);
  }
  return validPoiMap.get(id)!;
}

async function writeStoryFlags(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
  newFlags: Record<string, unknown>,
): Promise<void> {
  const session = await tx.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { storyFlags: true },
  });
  const existing = (session.storyFlags as Record<string, unknown>) ?? {};
  await tx.gameSession.update({
    where: { id: sessionId },
    data: { storyFlags: { ...existing, ...newFlags } as object },
  });
  console.log(`[story] flags written to session ${sessionId}:`, newFlags);
}

interface InteractCheck {
  skill?: string;
  dc?: number;
  item?: string;
  fallback?: { skill: string; dc: number };
}

function resolveSkillCheck(
  character: CharacterContext,
  skill: string,
  dc: number,
): { success: boolean; d20: number; modifier: number; total: number } {
  const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
  const modifier = skillMods[skill] ?? skillMods[skill.toLowerCase()] ?? 0;
  const d20 = randomInt(1, 21);
  const total = d20 + modifier;
  return { success: total >= dc, d20, modifier, total };
}

function resolveInteractCheck(
  check: InteractCheck,
  character: CharacterContext,
  inventory: CharacterInventory,
): { success: boolean; usedItem?: string; roll?: { skill: string; d20: number; modifier: number; total: number; dc: number } } {
  if (check.item) {
    const allItems = [
      ...inventory.bag,
      ...Object.values(inventory.equipped).filter((i): i is ItemDefinition => i != null),
    ];
    const hasItem = allItems.some(i => i.id === check.item);
    if (hasItem) return { success: true, usedItem: check.item };
    // item not found — fall back to skill check if defined
    if (check.fallback) {
      const result = resolveSkillCheck(character, check.fallback.skill, check.fallback.dc);
      return { success: result.success, roll: { skill: check.fallback.skill, ...result, dc: check.fallback.dc } };
    }
    return { success: false };
  }
  if (check.skill && check.dc != null) {
    const result = resolveSkillCheck(character, check.skill, check.dc);
    return { success: result.success, roll: { skill: check.skill, ...result, dc: check.dc } };
  }
  return { success: true }; // no check defined — auto-success
}

async function handleMoveToRoom(
  action: ExtractedAction,
  characterId: string,
  currentRoomInstanceId: string,
  sessionId: string,
  exitPoiMap: Map<string, string>,
  validPoiMap: Map<string, string>,
  characterName: string,
): Promise<string> {
  // Auto-resolve when LLM couldn't identify the exit but there's only one available
  const isUnresolved =
    !action.target_poi_instance_id ||
    !action.target_room_template_id ||
    action.target_room_template_id === '<UNKNOWN>';
  let resolvedExitPoiId: string;
  let resolvedTemplateId: string;
  if (isUnresolved) {
    if (exitPoiMap.size === 1) {
      const [[onlyId, onlyTemplate]] = exitPoiMap;
      resolvedExitPoiId = onlyId;
      resolvedTemplateId = onlyTemplate;
    } else {
      throw new Error('move_to_room requires both target_poi_instance_id and target_room_template_id.');
    }
  } else {
    resolvedExitPoiId = action.target_poi_instance_id!;
    resolvedTemplateId = action.target_room_template_id!;
  }

  const expectedTarget = exitPoiMap.get(resolvedExitPoiId);
  if (!expectedTarget || expectedTarget !== resolvedTemplateId) {
    throw new Error(
      `Exit POI "${resolvedExitPoiId}" does not lead to room template "${resolvedTemplateId}" — aborting.`,
    );
  }

  // Check if exit POI is locked
  await prisma.$transaction(async tx => {
    const exitPoi = await tx.poiInstance.findUniqueOrThrow({
      where: { id: resolvedExitPoiId },
      include: { template: true },
    });
    const defaultProps = exitPoi.template.defaultProperties as Record<string, unknown>;
    const isLockable = computeIsLockable(defaultProps.locked_by);
    if (isLockable) {
      const currentProps = exitPoi.currentProperties as Record<string, unknown>;
      if (currentProps.unlocked !== true) {
        throw new Error(`${validPoiMap.get(resolvedExitPoiId) ?? 'The exit'} is locked.`);
      }
    }
  });

  const exitPoiName = validPoiMap.get(resolvedExitPoiId) ?? 'the exit';

  return await prisma.$transaction(async tx => {
    const currentRoom = await tx.roomInstance.findUniqueOrThrow({
      where: { id: currentRoomInstanceId },
      select: { roomTemplateId: true },
    });

    let targetRoom = await tx.roomInstance.findFirst({
      where: { sessionId, roomTemplateId: resolvedTemplateId },
      include: { poiInstances: { include: { template: true } } },
    });

    if (!targetRoom) {
      const targetTemplate = await tx.roomTemplate.findUniqueOrThrow({
        where: { id: resolvedTemplateId },
        include: { poiTemplates: true },
      });
      targetRoom = await tx.roomInstance.create({
        data: {
          sessionId,
          roomTemplateId: resolvedTemplateId,
          poiInstances: {
            create: targetTemplate.poiTemplates.map(pt => {
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
        include: { poiInstances: { include: { template: true } } },
      });
    }

    // Mirror door state: find the return-exit POI in the target room that leads
    // back to the current room. If it's a door (peek_visibility === 'none'),
    // mark it interacted (open) so the door doesn't appear closed behind the player.
    const exitPoiInstance = await tx.poiInstance.findUniqueOrThrow({
      where: { id: resolvedExitPoiId },
      include: { template: true },
    });
    const exitDefaultProps = exitPoiInstance.template.defaultProperties as Record<string, unknown>;
    const isDoor = exitDefaultProps.peek_visibility === 'none';

    if (isDoor) {
      // Mark the source exit as open so the door appears open from the origin room too.
      const sourceExistingProps = (exitPoiInstance.currentProperties as Record<string, unknown>) ?? {};
      if (!sourceExistingProps.interacted) {
        await tx.poiInstance.update({
          where: { id: resolvedExitPoiId },
          data: { currentProperties: { ...sourceExistingProps, interacted: true } },
        });
      }

      const returnExitPoi = targetRoom.poiInstances.find(pi => {
        const dp = pi.template.defaultProperties as Record<string, unknown>;
        const enter = dp.enter as Record<string, unknown> | undefined;
        return (
          dp.poi_type === 'exit' &&
          dp.peek_visibility === 'none' &&
          enter?.target_room_template_id === currentRoom.roomTemplateId
        );
      });
      if (returnExitPoi) {
        const existing = (returnExitPoi.currentProperties as Record<string, unknown>) ?? {};
        await tx.poiInstance.update({
          where: { id: returnExitPoi.id },
          data: { currentProperties: { ...existing, interacted: true } },
        });
      }
    }

    // Remove the stale roomParticipant row from the source room — otherwise the
    // character ends up with two rows (one per room visited), and once their
    // lastActiveAt values land close together, "most recent room" lookups
    // (map currentRoomInstanceId) become non-deterministic and ping-pong between
    // rooms.
    await tx.roomParticipant.deleteMany({
      where: { roomInstanceId: currentRoomInstanceId, characterId },
    });

    await tx.roomParticipant.upsert({
      where: { roomInstanceId_characterId: { roomInstanceId: targetRoom.id, characterId } },
      update: { lastActiveAt: new Date(), combatState: {} },
      create: { roomInstanceId: targetRoom.id, characterId, combatState: {} },
    });

    await tx.messageLog.create({
      data: {
        roomInstanceId: currentRoomInstanceId,
        characterId,
        isMechanicalEvent: true,
        mechanicalSummary: {
          event: 'departed',
          through: exitPoiName,
          target_room_template_id: resolvedTemplateId,
        },
        text: `[MECHANICAL] ${characterName} passed through ${exitPoiName} and left this room.`,
      },
    });

    await tx.messageLog.create({
      data: {
        roomInstanceId: targetRoom.id,
        characterId,
        isMechanicalEvent: true,
        mechanicalSummary: {
          event: 'arrived',
          through: exitPoiName,
          from_room_instance_id: currentRoomInstanceId,
        },
        text: `[MECHANICAL] ${characterName} arrived from the previous room through ${exitPoiName}.`,
      },
    });

    return targetRoom.id;
  });
}

export async function mutateGameState(
  actions: ExtractedAction[],
  character: CharacterContext,
  roomInstanceId: string,
  sessionId: string,
  exitPoiMap: Map<string, string>,
  validPoiMap: Map<string, string>,
  openSpacePoiId: string | null,
  inCombat = false,
): Promise<MutationResult> {
  const { id: characterId, name: characterName } = character;
  const appliedActions: AppliedAction[] = [];
  let newRoomInstanceId: string | null = null;

  // Mutable active-room context — reloaded after move_to_room so subsequent actions
  // in the same turn (change_proximity, examine, etc.) target the correct room.
  let activeRoomId = roomInstanceId;
  let activeValidPoiMap = validPoiMap;
  let activeExitPoiMap = exitPoiMap;
  let activeOpenSpacePoiId = openSpacePoiId;

  for (const action of actions) {
    // Shadow outer parameters with the current active-room context for this iteration.
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const roomInstanceId = activeRoomId;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const validPoiMap = activeValidPoiMap;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const exitPoiMap = activeExitPoiMap;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const openSpacePoiId = activeOpenSpacePoiId;

    // ── move_to_room ───────────────────────────────────────────────────────
    if (action.action_type === 'move_to_room') {
      const exitPoiName = action.target_poi_instance_id
        ? (validPoiMap.get(action.target_poi_instance_id) ?? 'the exit')
        : 'the exit';
      newRoomInstanceId = await handleMoveToRoom(
        action,
        characterId,
        roomInstanceId,
        sessionId,
        exitPoiMap,
        validPoiMap,
        characterName,
      );
      appliedActions.push({ action, poiName: exitPoiName, itemName: null });

      // Reload POI context for subsequent actions in this same turn.
      const freshPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId: newRoomInstanceId },
        include: { template: true },
      });
      activeRoomId = newRoomInstanceId;
      activeValidPoiMap = new Map(freshPois.map(pi => [pi.id, pi.template.name]));
      activeExitPoiMap = new Map(
        freshPois
          .filter(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            return typeof (dp.enter as Record<string, unknown> | undefined)?.target_room_template_id === 'string';
          })
          .map(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            const enter = dp.enter as Record<string, unknown>;
            return [pi.id, enter.target_room_template_id as string] as const;
          }),
      );
      activeOpenSpacePoiId = freshPois.find(pi =>
        (pi.template.defaultProperties as Record<string, unknown>).poi_type === 'open_space',
      )?.id ?? null;

    // ── change_proximity ───────────────────────────────────────────────────
    } else if (action.action_type === 'change_proximity') {
      // The AI may target a stale/invalid POI id (e.g. another room's "open space" id when
      // moving toward a character) — fall back to this room's open space rather than aborting,
      // since moving to the shared floor area is always valid.
      const requestedPoiId = action.target_poi_instance_id;
      const targetPoiId = requestedPoiId && validPoiMap.has(requestedPoiId) ? requestedPoiId : openSpacePoiId;
      if (targetPoiId !== requestedPoiId) {
        console.log(`[proximity] target_poi_instance_id "${requestedPoiId}" not valid for this room — falling back to open space (${targetPoiId})`);
      }
      const poiName = targetPoiId ? (validPoiMap.get(targetPoiId) ?? 'open space') : 'open space';
      const newCombatState = {
        proximity_target_id: targetPoiId,
        stance: action.resulting_stance,
      };

      await prisma.$transaction(async tx => {
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: newCombatState, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: newCombatState },
        });

        // Reveal proximity_only POIs within grid-distance 1 of the new position
        const targetPoiInstance = targetPoiId
          ? await tx.poiInstance.findUnique({
              where: { id: targetPoiId },
              select: { template: { select: { grid_slot: true } } },
            })
          : null;
        const targetSlot = targetPoiInstance?.template.grid_slot ?? 'C';

        const proximityOnlyPois = await tx.poiInstance.findMany({
          where: { roomInstanceId },
          include: { template: { select: { grid_slot: true, defaultProperties: true } } },
        });

        for (const pp of proximityOnlyPois) {
          const dp = pp.template.defaultProperties as Record<string, unknown>;
          const cp = pp.currentProperties as Record<string, unknown>;
          if ((dp.visibility as string) !== 'proximity_only') continue;
          if (cp.visibility_override === 'always') continue; // already revealed
          const dist = slotGridDistance(targetSlot, pp.template.grid_slot ?? 'C');
          if (dist <= 1) {
            await tx.poiInstance.update({
              where: { id: pp.id },
              data: { currentProperties: { ...cp, visibility_override: 'always' } },
            });
            console.log(`[proximity] revealed "${pp.id}" (slot ${pp.template.grid_slot}) — approached from slot ${targetSlot}`);
          }
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'movement',
              to: poiName,
              poi_instance_id: targetPoiId,
              stance: action.resulting_stance,
            },
            text: `[MECHANICAL] ${characterName} moved to ${poiName}${action.resulting_stance ? ` with stance: ${action.resulting_stance}` : ''}.`,
          },
        });
      });

      // If the character is peering at an exit, inject adjacent room visibility into the narrative fact
      let peerOverrideFact: string | undefined;
      const targetExitPoiId = targetPoiId;
      console.log(`[peer] change_proximity target=${targetExitPoiId} isExit=${exitPoiMap.has(targetExitPoiId ?? '')}`);
      if (targetExitPoiId && exitPoiMap.has(targetExitPoiId)) {
        const exitPoi = await prisma.poiInstance.findUniqueOrThrow({
          where: { id: targetExitPoiId },
          include: { template: true },
        });
        const dp = exitPoi.template.defaultProperties as Record<string, unknown>;
        const cp = exitPoi.currentProperties as Record<string, unknown>;
        const rawPeek = (dp.peek_visibility as string) ?? 'none';
        const effectivePeek = computeEffectivePeek(
          rawPeek,
          computeIsLockable(dp.locked_by) && cp.unlocked !== true,
          cp.interacted === true,
          cp.destroyed === true,
        );

        const targetRoomTemplateId = exitPoiMap.get(targetExitPoiId)!;

        console.log(`[peer] rawPeek=${rawPeek} effectivePeek=${effectivePeek} unlocked=${cp.unlocked} interacted=${cp.interacted} destroyed=${cp.destroyed} targetTemplate=${targetRoomTemplateId}`);
        if (effectivePeek === 'none') {
          peerOverrideFact = `Character "${characterName}" pressed against "${poiName}", straining to sense what lies beyond — but the door is solid and reveals nothing.`;
        } else {
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId, roomTemplateId: targetRoomTemplateId },
            include: { template: true, poiInstances: { include: { template: true } } },
          });
          console.log(`[peer] adjRoom=${adjRoom ? adjRoom.template.name : 'NOT FOUND (room not yet visited)'} poiCount=${adjRoom?.poiInstances.length ?? 0}`);
          if (adjRoom) {
            const minVisLevel = effectivePeek === 'full' ? 1 : 2;
            const exitDirection: string = exitPoi.template.exit_direction ?? '';
            const exitWallSection: string = exitPoi.template.exit_wall_section ?? 'C';
            const exitArchWidth: number = exitPoi.template.exit_arch_width ?? 1;
            const charGridSlot = exitPoi.template.grid_slot ?? 'C';

            console.log(`[peer] effectivePeek=${effectivePeek} minVisLevel=${minVisLevel} exitDir=${exitDirection||'(none)'} wallSection=${exitWallSection} archWidth=${exitArchWidth} charSlot=${charGridSlot}`);

            const visiblePois = adjRoom.poiInstances.filter(pi => {
              const pdp = pi.template.defaultProperties as Record<string, unknown>;
              if ((pdp.poi_type as string) === 'open_space') return false;
              if (pi.template.visibility_level < minVisLevel) {
                console.log(`[peer] SKIP "${pi.template.name}" — visibility_level=${pi.template.visibility_level} < minVisLevel=${minVisLevel}`);
                return false;
              }
              if (!exitDirection) return true;
              const los = isPoiVisibleThroughExit(charGridSlot, pi.template.grid_slot, exitDirection, exitWallSection, exitArchWidth);
              console.log(`[peer] "${pi.template.name}" slot=${pi.template.grid_slot} LoS=${los}`);
              return los;
            });

            const poiList = visiblePois.length > 0
              ? visiblePois.map(pi => `"${pi.template.name}"`).join(', ')
              : 'nothing remarkable';
            peerOverrideFact = `Character "${characterName}" peers through "${poiName}" into "${adjRoom.template.name}". Visible from this vantage: ${poiList}. Describe only what can be seen from this angle — do not fabricate unseen details.`;
          }
        }
      }

      appliedActions.push({ action, poiName, itemName: null, overrideFact: peerOverrideFact });

    // ── examine ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'examine') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
      let examineText: string | null = null;
      const passedDetailTexts: string[] = [];

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        examineText = typeof defaultProps.examine_text === 'string' ? defaultProps.examine_text : null;

        const examineDetails = Array.isArray(defaultProps.examine_details)
          ? (defaultProps.examine_details as Array<{ text: string; skill: string; dc: number }>)
          : [];
        if (examineDetails.length > 0) {
          console.log(`[examine] "${poiName}" has ${examineDetails.length} examine_details — one check each: ${examineDetails.map(d => `${d.skill} DC${d.dc}`).join(', ')}`);
        }
        const detailRolls: Array<{ item: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];
        for (const detail of examineDetails) {
          const modifier = skillMods[detail.skill] ?? skillMods[detail.skill.toLowerCase()] ?? 0;
          const d20 = randomInt(1, 21);
          const total = d20 + modifier;
          const success = total >= detail.dc;
          console.log(`[examine] detail-check: ${characterName} rolled ${d20}+${modifier}=${total} vs DC ${detail.dc} (${detail.skill}) — ${success ? 'PASS' : 'FAIL'}`);
          detailRolls.push({ item: detail.text, skill: detail.skill, d20, modifier, total, dc: detail.dc, success });
          if (success) passedDetailTexts.push(detail.text);
        }
        if (detailRolls.length > 0) {
          const summary = detailRolls.map(r => `${r.skill} DC${r.dc}: ${r.d20}${r.modifier !== 0 ? `+${r.modifier}` : ''}=${r.total} — ${r.success ? 'noticed' : 'missed'}`).join(', ');
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'roll_result', event: 'examine_details', poi: poiName, rolls: detailRolls },
              text: `🎲 Examine ${poiName}: ${summary}`,
            },
          });
        }

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        const hiddenItems = templateItems.filter(
          i => i.hidden && !revealedIds.has(i.id) && !takenIds.has(i.id),
        );
        if (hiddenItems.length > 0) {
          console.log(`[examine] "${poiName}" has ${hiddenItems.length} hidden item(s) — ${hiddenItems.map(i => i.reveal_check ? `${i.name} (${i.reveal_check.skill} DC${i.reveal_check.dc})` : `${i.name} (auto-reveal)`).join(', ')}`);
        }

        const newlyRevealed: string[] = [];
        const rollResults: Array<{ item: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];

        for (const item of hiddenItems) {
          if (!item.reveal_check) {
            newlyRevealed.push(item.id);
            continue;
          }
          const skill = item.reveal_check.skill;
          const modifier = skillMods[skill] ?? skillMods[skill.toLowerCase()] ?? 0;
          const d20 = randomInt(1, 21);
          const total = d20 + modifier;
          const success = total >= item.reveal_check.dc;
          console.log(
            `[items] reveal-check: ${characterName} rolled ${d20}+${modifier}=${total} vs DC ${item.reveal_check.dc} for "${item.name}" — ${success ? 'PASS' : 'FAIL'}`,
          );
          rollResults.push({ item: item.name, skill, d20, modifier, total, dc: item.reveal_check.dc, success });
          if (success) newlyRevealed.push(item.id);
        }

        await tx.poiInstance.update({
          where: { id: action.target_poi_instance_id! },
          data: {
            currentProperties: {
              ...currentProps,
              examined: true,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'examine',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              newly_revealed: newlyRevealed,
            },
            text: `[MECHANICAL] ${characterName} examined ${poiName}${newlyRevealed.length > 0 ? ` and discovered ${newlyRevealed.length} hidden item(s).` : '.'}`,
          },
        });

        if (rollResults.length > 0) {
          const summary = rollResults.map(r => `${r.item}: ${r.d20}${r.modifier !== 0 ? `+${r.modifier}` : ''}=${r.total} vs DC ${r.dc} — ${r.success ? 'found' : 'missed'}`).join(', ');
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'roll_result', event: 'examine', poi: poiName, rolls: rollResults },
              text: `🎲 ${summary}`,
            },
          });
        }
      });

      const detailsSuffix = passedDetailTexts.length > 0
        ? ` On closer inspection: ${passedDetailTexts.join(' ')}`
        : '';
      const examineFact = examineText
        ? `Character "${characterName}" examined "${poiName}" closely. What they observe: ${examineText}${detailsSuffix}`
        : `Character "${characterName}" examined "${poiName}" closely. The engine has recorded this inspection.${detailsSuffix}`;
      appliedActions.push({ action, poiName, itemName: null, overrideFact: examineFact });

    // ── interact ───────────────────────────────────────────────────────────
    } else if (action.action_type === 'interact') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      const verb = action.interaction_result ?? 'interacted';
      let interactOverrideFact: string | undefined;

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const isLockable = computeIsLockable(defaultProps.locked_by);
        if (isLockable && currentProps.unlocked !== true) {
          throw new Error(`"${poiName}" is locked. Use a key or Thieves' Tools to open it, or force it open.`);
        }

        // ── NPC interact_options ───────────────────────────────────────────
        const poiType = defaultProps.poi_type as string | undefined;
        const interactOptions = Array.isArray(defaultProps.interact_options)
          ? (defaultProps.interact_options as Array<Record<string, unknown>>)
          : null;

        if (poiType === 'npc' && interactOptions && interactOptions.length > 0) {
          // Pick best matching option: prefer one whose label contains the verb, else use first
          const verbLower = verb.toLowerCase();
          const option =
            interactOptions.find(o => (o.label as string)?.toLowerCase().includes(verbLower)) ??
            interactOptions[0];

          const check = option.check as InteractCheck | undefined;
          let checkResult: ReturnType<typeof resolveInteractCheck> = { success: true };

          if (check) {
            const charRow = await tx.character.findUniqueOrThrow({
              where: { id: characterId },
              select: { inventory: true },
            });
            const inv = normalizeInventory(charRow.inventory);
            checkResult = resolveInteractCheck(check, character, inv);
          }

          const storyFlag = option.story_flag as string | undefined;
          const resultNarrative = checkResult.success
            ? (option.success as string | undefined) ?? (option.narrative as string | undefined)
            : (option.failure as string | undefined) ?? `The attempt fails.`;

          if (checkResult.success && storyFlag) {
            await writeStoryFlags(tx, sessionId, { [storyFlag]: true });
          }

          if (checkResult.roll) {
            const r = checkResult.roll;
            const rollLine = checkResult.usedItem
              ? `Used item: ${checkResult.usedItem}`
              : `${r.skill} check: ${r.d20}+${r.modifier}=${r.total} vs DC ${r.dc} — ${checkResult.success ? 'success' : 'failure'}`;
            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: { type: 'roll_result', event: 'npc_interact', ...r, success: checkResult.success },
                text: `🎲 ${rollLine}`,
              },
            });
          }

          interactOverrideFact = resultNarrative
            ? `[NPC INTERACTION — ${poiName}] ${resultNarrative}`
            : undefined;

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                ...(checkResult.success && storyFlag ? { [`flag_${storyFlag}`]: true } : {}),
              },
            },
          });
        } else if (defaultProps.disrupt && poiType !== 'npc') {
          // ── disrupt action (Ritual Circle etc.) ───────────────────────────
          const disrupt = defaultProps.disrupt as Record<string, unknown>;
          const check = disrupt.check as InteractCheck | undefined;
          let checkResult: ReturnType<typeof resolveInteractCheck> = { success: true };

          if (check) {
            const charRow = await tx.character.findUniqueOrThrow({
              where: { id: characterId },
              select: { inventory: true },
            });
            const inv = normalizeInventory(charRow.inventory);
            checkResult = resolveInteractCheck(check, character, inv);
          }

          const storyFlag = disrupt.story_flag as string | undefined;
          const resultNarrative = checkResult.success
            ? (disrupt.narrative as string | undefined)
            : `The disruption attempt fails — the circle's light pulses and holds.`;

          if (checkResult.success && storyFlag) {
            await writeStoryFlags(tx, sessionId, { [storyFlag]: true });
          }

          if (checkResult.roll) {
            const r = checkResult.roll;
            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: { type: 'roll_result', event: 'disrupt', ...r, success: checkResult.success },
                text: `🎲 ${r.skill} check: ${r.d20}+${r.modifier}=${r.total} vs DC ${r.dc} — ${checkResult.success ? 'success' : 'failure'}`,
              },
            });
          }

          interactOverrideFact = resultNarrative
            ? `[DISRUPTION — ${poiName}] ${resultNarrative}`
            : undefined;

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                disrupted: checkResult.success,
              },
            },
          });
        } else {
          // ── standard interact ──────────────────────────────────────────────
          const poiStoryFlag = defaultProps.story_flag as string | undefined;
          if (poiStoryFlag) {
            await writeStoryFlags(tx, sessionId, { [poiStoryFlag]: true });
          }

          // When opening a lockable container, auto-reveal hidden items that
          // have no reveal_check (items visible immediately on opening).
          const templateItems = Array.isArray(defaultProps.items)
            ? (defaultProps.items as ItemDefinition[])
            : [];
          const existingRevealed = new Set(
            Array.isArray(currentProps.revealed_items)
              ? (currentProps.revealed_items as string[])
              : [],
          );
          const takenIds = new Set(
            Array.isArray(currentProps.items_taken)
              ? (currentProps.items_taken as string[])
              : [],
          );
          const autoReveal = isLockable
            ? templateItems
                .filter(i => i.hidden && !i.reveal_check && !existingRevealed.has(i.id) && !takenIds.has(i.id))
                .map(i => i.id)
            : [];

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                ...(autoReveal.length > 0
                  ? { revealed_items: [...Array.from(existingRevealed), ...autoReveal] }
                  : {}),
              },
            },
          });
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'interact',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              result: verb,
            },
            text: `[MECHANICAL] ${characterName} ${verb} ${poiName}.`,
          },
        });

        // Move player to the POI they interacted with
        const partRow = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const partCs = (partRow?.combatState ?? {}) as Record<string, unknown>;
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...partCs, proximity_target_id: action.target_poi_instance_id }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: action.target_poi_instance_id } },
        });
      });

      appliedActions.push({ action, poiName, itemName: null, overrideFact: interactOverrideFact });

    // ── destroy_poi ────────────────────────────────────────────────────────
    } else if (action.action_type === 'destroy_poi') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      let revealedItemNames: string[] = [];

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const takenIds = new Set(Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : []);
        const alreadyRevealed = new Set(Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : []);

        const newlyRevealed = templateItems
          .filter(item => item.hidden && !takenIds.has(item.id) && !alreadyRevealed.has(item.id))
          .map(item => item.id);
        revealedItemNames = templateItems
          .filter(item => newlyRevealed.includes(item.id))
          .map(item => item.name);

        await tx.poiInstance.update({
          where: { id: action.target_poi_instance_id! },
          data: {
            currentProperties: {
              ...currentProps,
              destroyed: true,
              revealed_items: [...Array.from(alreadyRevealed), ...newlyRevealed],
            } as unknown as object,
          },
        });
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'destroy_poi',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              revealed_items: revealedItemNames,
            },
            text: `[MECHANICAL] ${characterName} destroyed ${poiName}.${revealedItemNames.length > 0 ? ` Revealed: ${revealedItemNames.join(', ')}.` : ''}`,
          },
        });
      });

      const revealedFact = revealedItemNames.length > 0
        ? ` As it breaks apart, the following items spill out and are now visible: ${revealedItemNames.map(n => `"${n}"`).join(', ')}.`
        : ' Nothing of value was hidden inside.';
      appliedActions.push({
        action,
        poiName,
        itemName: null,
        overrideFact: `Character "${characterName}" destroyed "${poiName}".${revealedFact}`,
      });

    // ── force_open ─────────────────────────────────────────────────────────
    } else if (action.action_type === 'force_open') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      let revealedItemNames: string[] = [];
      let success = false;
      let breakDc = 0;
      let roll: { success: boolean; d20: number; modifier: number; total: number } = { success: false, d20: 0, modifier: 0, total: 0 };

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;

        if (!computeIsLockable(defaultProps.locked_by)) {
          throw new Error(`"${poiName}" isn't locked — there's nothing to force open.`);
        }
        if (currentProps.unlocked === true) {
          throw new Error(`"${poiName}" is already unlocked.`);
        }

        const lockDc = typeof defaultProps.lock_dc === 'number' ? defaultProps.lock_dc : 15;
        breakDc = typeof defaultProps.break_dc === 'number' ? defaultProps.break_dc : lockDc + 5;
        roll = resolveSkillCheck(character, 'Athletics', breakDc);
        success = roll.success;

        console.log(`[items] force_open: ${characterName} rolled ${roll.d20}+${roll.modifier}=${roll.total} vs DC ${breakDc} — ${success ? 'SUCCESS' : 'FAIL'}`);

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: {
              type: 'roll_result',
              event: 'force_open',
              rolls: [{
                item: 'Lock',
                skill: 'Athletics',
                d20: roll.d20,
                modifier: roll.modifier,
                total: roll.total,
                dc: breakDc,
                success,
                poi: poiName,
              }],
            },
            text: `🎲 Force open ${poiName}: ${roll.d20}${roll.modifier !== 0 ? (roll.modifier > 0 ? `+${roll.modifier}` : roll.modifier) : ''}=${roll.total} vs DC ${breakDc} — ${success ? 'success' : 'fail'}`,
          },
        });

        if (success) {
          const isExitPoi = (defaultProps.poi_type as string) === 'exit';
          const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
          const takenIds = new Set(Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : []);
          const alreadyRevealed = new Set(Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : []);

          const newlyRevealed = templateItems
            .filter(item => item.hidden && !takenIds.has(item.id) && !alreadyRevealed.has(item.id))
            .map(item => item.id);
          revealedItemNames = templateItems
            .filter(item => newlyRevealed.includes(item.id))
            .map(item => item.name);

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                unlocked: true,
                destroyed: true,
                revealed_items: [...Array.from(alreadyRevealed), ...newlyRevealed],
                ...(isExitPoi ? { interacted: true, lastInteraction: 'forced open' } : {}),
              } as unknown as object,
            },
          });

          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: true,
              mechanicalSummary: {
                event: 'force_open',
                poi_instance_id: action.target_poi_instance_id,
                poi: poiName,
                revealed_items: revealedItemNames,
              },
              text: `[MECHANICAL] ${characterName} forced open ${poiName}.${revealedItemNames.length > 0 ? ` Revealed: ${revealedItemNames.join(', ')}.` : ''}`,
            },
          });
        }
      });

      const overrideFact = success
        ? `Character "${characterName}" forced open "${poiName}" (Athletics ${roll.total} vs DC ${breakDc}) — the lock breaks apart and the way is open.${
            revealedItemNames.length > 0
              ? ` As it breaks open, the following items spill out and are now visible: ${revealedItemNames.map(n => `"${n}"`).join(', ')}.`
              : ' Nothing of value was hidden inside.'
          }`
        : `Character "${characterName}" tried to force open "${poiName}" (Athletics ${roll.total} vs DC ${breakDc}) but failed — it remains locked. They could try again.`;

      appliedActions.push({
        action,
        poiName,
        itemName: null,
        overrideFact,
      });

    // ── look_around ────────────────────────────────────────────────────────
    } else if (action.action_type === 'look_around') {
      const profBonus = Math.ceil(character.level / 4) + 1;
      const wisMod = Math.floor((character.baseWisdom - 10) / 2);
      const perceptionProficient = character.skillProficiencies.some(
        s => s.toLowerCase() === 'perception',
      );
      const passivePerception = 10 + wisMod + (perceptionProficient ? profBonus : 0);

      const allPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId },
        include: { template: true },
      });

      const poiUpdates: Array<{ id: string; currentProperties: object }> = [];
      const autoRevealed: Array<{ poi: string; item: string }> = [];

      for (const poi of allPois) {
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        const passiveItems = templateItems.filter(
          i =>
            i.hidden &&
            !revealedIds.has(i.id) &&
            !takenIds.has(i.id) &&
            i.reveal_check?.skill === 'perception' &&
            (i.reveal_check?.dc ?? 999) <= passivePerception,
        );

        const newlyRevealed = passiveItems.map(i => i.id);
        if (newlyRevealed.length > 0) {
          poiUpdates.push({
            id: poi.id,
            currentProperties: {
              ...currentProps,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          });
          passiveItems.forEach(i => autoRevealed.push({ poi: poi.template.name, item: i.name }));
        }
      }

      await prisma.$transaction(async tx => {
        for (const update of poiUpdates) {
          await tx.poiInstance.update({
            where: { id: update.id },
            data: { currentProperties: update.currentProperties },
          });
        }
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'look_around',
              passive_perception: passivePerception,
              auto_revealed: autoRevealed.length,
            },
            text: `[MECHANICAL] ${characterName} surveyed the room (passive Perception ${passivePerception})${autoRevealed.length > 0 ? ` and noticed ${autoRevealed.length} item(s).` : '.'}`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: null });

    // ── search ─────────────────────────────────────────────────────────────
    } else if (action.action_type === 'search') {
      const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
      const perceptionMod = skillMods['perception'] ?? skillMods['Perception'] ?? 0;

      const allPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId },
        include: { template: true },
      });

      // One Perception roll for the whole room — checked against each
      // perceivable hidden item's DC. Items requiring "investigation"
      // (manipulation, deduction, hidden knowledge) are not surfaced here;
      // they require an "examine" action on the specific POI.
      const d20 = randomInt(1, 21);
      const total = d20 + perceptionMod;

      const rollResults: Array<{ poi: string; item: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];
      const poiUpdates: Array<{ id: string; currentProperties: object }> = [];

      for (const poi of allPois) {
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        const perceivableItems = templateItems.filter(
          i =>
            i.hidden &&
            !revealedIds.has(i.id) &&
            !takenIds.has(i.id) &&
            i.reveal_check?.skill === 'perception',
        );

        const newlyRevealed: string[] = [];
        for (const item of perceivableItems) {
          const dc = item.reveal_check?.dc ?? 10;
          const success = total >= dc;
          rollResults.push({ poi: poi.template.name, item: item.name, skill: 'perception', d20, modifier: perceptionMod, total, dc, success });
          if (success) newlyRevealed.push(item.id);
        }

        if (newlyRevealed.length > 0) {
          poiUpdates.push({
            id: poi.id,
            currentProperties: {
              ...currentProps,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          });
        }
      }

      const totalRevealed = rollResults.filter(r => r.success).length;
      console.log(`[items] search-reveal: ${characterName} rolled Perception ${d20}+${perceptionMod}=${total} — ${totalRevealed}/${rollResults.length} perceivable item(s) found across ${allPois.length} POI(s)`);
      if (rollResults.length > 0) {
        console.log(`[items] search-reveal DC breakdown: ${rollResults.map(r => `${r.item} (${r.poi}) ${r.total} vs DC ${r.dc} — ${r.success ? 'found' : 'missed'}`).join(', ')}`);
      }

      await prisma.$transaction(async tx => {
        for (const update of poiUpdates) {
          await tx.poiInstance.update({
            where: { id: update.id },
            data: { currentProperties: update.currentProperties },
          });
        }
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'search', d20, modifier: perceptionMod, total, total_revealed: totalRevealed },
            text: `[MECHANICAL] ${characterName} searched the room (Perception ${total})${totalRevealed > 0 ? ` and found ${totalRevealed} hidden item(s).` : '.'}`,
          },
        });
        const foundItems = rollResults.filter(r => r.success).map(r => r.item);
        const singleRoll = {
          poi: undefined as string | undefined,
          item: foundItems.length > 0 ? foundItems.join(', ') : 'nothing found',
          skill: 'perception',
          d20,
          modifier: perceptionMod,
          total,
          dc: 0,
          success: foundItems.length > 0,
        };
        const rollSummary = `${d20}${perceptionMod !== 0 ? `+${perceptionMod}` : ''}=${total}`;
        const text = foundItems.length > 0
          ? `🎲 Perception ${rollSummary} — found ${foundItems.join(', ')}`
          : `🎲 Perception ${rollSummary} — nothing found`;
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: { type: 'roll_result', event: 'search', rolls: [singleRoll] },
            text,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: null });

    // ── pick_up ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'pick_up') {
      const itemId = action.item_id;
      const sourcePoi = action.target_poi_instance_id;
      if (!itemId) throw new Error('pick_up requires item_id');
      if (!sourcePoi || !validPoiMap.has(sourcePoi)) {
        throw new Error(`pick_up requires a valid target_poi_instance_id — got "${sourcePoi}"`);
      }
      const poiName = validPoiMap.get(sourcePoi)!;

      let pickedItemName = itemId;

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: sourcePoi },
          include: { template: true },
        });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );
        const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];

        let pickedItem: ItemDefinition | undefined;
        let isFloorItem = false;

        const templateItem = templateItems.find(i => i.id === itemId && !takenIds.has(i.id));
        if (templateItem) {
          pickedItem = templateItem;
        } else {
          const floorItem = floorItems.find(i => i.id === itemId);
          if (floorItem) {
            pickedItem = floorItem;
            isFloorItem = true;
          }
        }

        if (!pickedItem) throw new Error(`Item "${itemId}" not found at "${poiName}"`);
        pickedItemName = pickedItem.name;

        if (isFloorItem) {
          await tx.poiInstance.update({
            where: { id: sourcePoi },
            data: {
              currentProperties: {
                ...currentProps,
                floor_items: floorItems.filter(i => i.id !== itemId),
              } as unknown as object,
            },
          });
        } else {
          await tx.poiInstance.update({
            where: { id: sourcePoi },
            data: {
              currentProperties: {
                ...currentProps,
                items_taken: [...Array.from(takenIds), itemId],
              },
            },
          });
        }

        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);
        inv.bag.push(pickedItem);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        console.log(`[items] pick_up: ${characterName} picked up "${pickedItem.name}" from "${poiName}"`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        if (pickedItem.story_flag) {
          await writeStoryFlags(tx, sessionId, { [pickedItem.story_flag]: true });
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'pick_up', item_id: itemId, item: pickedItem.name, from_poi: poiName },
            text: `[MECHANICAL] ${characterName} picked up ${pickedItem.name} from ${poiName}.`,
          },
        });

        // Move player to the POI they picked up from
        const partRow = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const partCs = (partRow?.combatState ?? {}) as Record<string, unknown>;
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...partCs, proximity_target_id: sourcePoi }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: sourcePoi } },
        });
      });

      appliedActions.push({ action, poiName, itemName: pickedItemName });

    // ── drop ───────────────────────────────────────────────────────────────
    } else if (action.action_type === 'drop') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('drop requires item_id');

      let droppedItemName = itemId;
      let targetPoiName = 'open space';

      await prisma.$transaction(async tx => {
        const participant = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const combatState = (participant?.combatState ?? {}) as { proximity_target_id?: string };

        // Prefer explicit target from parser; fall back to current proximity, then open space
        let targetPoiId =
          (action.target_poi_instance_id && validPoiMap.has(action.target_poi_instance_id))
            ? action.target_poi_instance_id
            : (combatState.proximity_target_id ?? openSpacePoiId);
        if (!targetPoiId || !validPoiMap.has(targetPoiId)) {
          targetPoiId = openSpacePoiId;
        }
        if (!targetPoiId) throw new Error('No valid drop target — open_space POI not found for this room');

        targetPoiName = validPoiMap.get(targetPoiId) ?? 'open space';

        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);
        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const [droppedItem] = inv.bag.splice(itemIdx, 1);
        droppedItemName = droppedItem.name;

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        const poi = await tx.poiInstance.findUniqueOrThrow({ where: { id: targetPoiId } });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];

        await tx.poiInstance.update({
          where: { id: targetPoiId },
          data: { currentProperties: { ...currentProps, floor_items: [...floorItems, droppedItem] } as unknown as object },
        });

        console.log(`[items] drop: ${characterName} dropped "${droppedItem.name}" at "${targetPoiName}"`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'drop', item_id: itemId, item: droppedItem.name, at_poi: targetPoiName },
            text: `[MECHANICAL] ${characterName} dropped ${droppedItem.name} at ${targetPoiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: targetPoiName, itemName: droppedItemName });

    // ── equip ──────────────────────────────────────────────────────────────
    } else if (action.action_type === 'equip') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('equip requires item_id');

      // Pre-check: fetch inventory to validate before opening a transaction
      const preCheck = await prisma.character.findUniqueOrThrow({
        where: { id: characterId },
        select: { inventory: true },
      });
      const preInv = normalizeInventory(preCheck.inventory);
      const preItem = preInv.bag.find(i => i.id === itemId);
      if (preItem && !preItem.equip_slot) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'equip_failed', item_id: itemId, item: preItem.name, reason: 'not_equippable' },
            text: `[MECHANICAL] ${characterName} cannot equip "${preItem.name}" — it has no equipment slot.`,
          },
        });
        appliedActions.push({
          action,
          poiName: null,
          itemName: preItem.name,
          overrideFact: `Character "${characterName}" tried to equip "${preItem.name}" but it cannot be worn or wielded.`,
        });
        continue;
      }

      let equippedItemName = itemId;

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const item = inv.bag[itemIdx];
        if (!item.equip_slot) throw new Error(`"${item.name}" has no equip slot`);

        const slot = resolveEquipSlot(item, inv);
        const currentEquipped = inv.equipped[slot];
        equippedItemName = item.name;

        if (currentEquipped) {
          inv.bag[itemIdx] = currentEquipped;
          console.log(`[items] equip: ${characterName} swapped "${currentEquipped.name}" → "${item.name}" in slot ${slot}`);
        } else {
          inv.bag.splice(itemIdx, 1);
          console.log(`[items] equip: ${characterName} equipped "${item.name}" → slot ${slot}`);
        }
        inv.equipped[slot] = item;

        // Two-handed weapons occupy both hands — clear off_hand if it's still occupied
        let displacedOffHand: ItemDefinition | null = null;
        if (item.two_handed && inv.equipped.off_hand) {
          displacedOffHand = inv.equipped.off_hand;
          inv.bag.push(displacedOffHand);
          console.log(`[items] equip: ${characterName} unequipped "${displacedOffHand.name}" from off_hand (two-handed weapon equipped)`);
          delete inv.equipped.off_hand;
        }
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        const swappedNames = [currentEquipped?.name, displacedOffHand?.name].filter(Boolean);
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'equip',
              item_id: itemId,
              item: item.name,
              slot,
              swapped_out: swappedNames.length ? swappedNames : null,
            },
            text: `[MECHANICAL] ${characterName} equipped ${item.name}${swappedNames.length ? ` (replacing ${swappedNames.join(' and ')})` : ''}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: equippedItemName });

    // ── unequip ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'unequip') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('unequip requires item_id');

      let unequippedItemName = itemId;

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const slotEntry = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId);
        if (!slotEntry || !slotEntry[1]) throw new Error(`Item "${itemId}" is not equipped`);

        const [slot, item] = slotEntry as [keyof CharacterInventory['equipped'], ItemDefinition];
        unequippedItemName = item.name;

        inv.bag.push(item);
        delete inv.equipped[slot];

        console.log(`[items] unequip: ${characterName} unequipped "${item.name}" from slot ${slot}`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'unequip', item_id: itemId, item: item.name, slot },
            text: `[MECHANICAL] ${characterName} unequipped ${item.name}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: unequippedItemName });

    // ── use_item ───────────────────────────────────────────────────────────
    } else if (action.action_type === 'use_item') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('use_item requires item_id');

      let usedItemName = itemId;
      let effectDescription = 'used';

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true, currentHp: true, maxHp: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        let item: ItemDefinition | undefined;
        let itemLocation: 'bag' | 'equipped' = 'bag';
        let bagIdx = inv.bag.findIndex(i => i.id === itemId);

        if (bagIdx !== -1) {
          item = inv.bag[bagIdx];
        } else {
          const equippedEntry = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId);
          if (equippedEntry) {
            item = equippedEntry[1]!;
            itemLocation = 'equipped';
          }
        }
        if (!item) throw new Error(`Item "${itemId}" not found in inventory`);
        usedItemName = item.name;

        const charUpdates: Record<string, unknown> = {};

        if (item.use_effect) {
          if (item.use_effect.startsWith('heal_') && !inCombat) {
            // In combat, heal is handled by resolveCombatAction — skip DB update here to avoid double apply
            const amount = parseInt(item.use_effect.replace('heal_', ''), 10);
            const healed = Math.min(charRow.currentHp + amount, charRow.maxHp) - charRow.currentHp;
            charUpdates.currentHp = charRow.currentHp + healed;
            effectDescription = `healed ${healed} HP (${charRow.currentHp} → ${charRow.currentHp + healed})`;
            console.log(`[items] use_item: ${characterName} used "${item.name}" — ${effectDescription}`);

          } else if (item.use_effect === 'unlock') {
            if (!action.target_poi_instance_id) {
              throw new Error('use_item "unlock" requires target_poi_instance_id');
            }
            const poi = await tx.poiInstance.findUniqueOrThrow({
              where: { id: action.target_poi_instance_id },
              include: { template: true },
            });
            const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
            const lockedBy = defaultProps.locked_by;
            const lockedByArr = Array.isArray(lockedBy)
              ? (lockedBy as string[])
              : typeof lockedBy === 'string'
              ? [lockedBy]
              : [];

            if (!lockedByArr.includes(item.id)) {
              throw new Error(`"${item.name}" does not unlock "${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}"`);
            }

            const currentProps = poi.currentProperties as Record<string, unknown>;
            const isExitPoi = (defaultProps.poi_type as string) === 'exit';
            await tx.poiInstance.update({
              where: { id: action.target_poi_instance_id },
              data: {
                currentProperties: {
                  ...currentProps,
                  unlocked: true,
                  ...(isExitPoi ? { interacted: true, lastInteraction: 'opened' } : {}),
                },
              },
            });
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';
            effectDescription = `unlocked ${targetPoiName}`;
            console.log(`[items] use_item unlock: ${characterName} unlocked "${targetPoiName}" with "${item.name}"`);

          } else if (item.use_effect === 'lockpick') {
            if (!action.target_poi_instance_id) {
              throw new Error('use_item "lockpick" requires target_poi_instance_id');
            }
            const poi = await tx.poiInstance.findUniqueOrThrow({
              where: { id: action.target_poi_instance_id },
              include: { template: true },
            });
            const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
            if (!computeIsLockable(defaultProps.locked_by)) throw new Error(`"${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}" has no lock to pick.`);
            const currentPoiProps = poi.currentProperties as Record<string, unknown>;
            if (currentPoiProps.unlocked === true) throw new Error(`"${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}" is already unlocked.`);

            const lockDc = typeof defaultProps.lock_dc === 'number' ? defaultProps.lock_dc : 15;
            const profBonus = Math.ceil(character.level / 4) + 1;
            const dexMod = Math.floor(((character.baseDexterity ?? 10) - 10) / 2);
            const sleightProficient = character.skillProficiencies.some(
              s => s.toLowerCase() === 'sleight of hand' || s.toLowerCase() === 'thieves tools',
            );
            const d20 = randomInt(1, 21);
            const total = d20 + dexMod + (sleightProficient ? profBonus : 0);
            const success = total >= lockDc;
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';

            console.log(`[items] lockpick: ${characterName} rolled ${d20}+${dexMod}${sleightProficient ? `+${profBonus}` : ''}=${total} vs DC ${lockDc} — ${success ? 'SUCCESS' : 'FAIL'}`);

            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: {
                  type: 'roll_result',
                  event: 'lockpick',
                  rolls: [{
                    item: 'Lock',
                    skill: "Thieves' Tools",
                    d20,
                    modifier: dexMod + (sleightProficient ? profBonus : 0),
                    total,
                    dc: lockDc,
                    success,
                    poi: targetPoiName,
                  }],
                },
                text: `🎲 Lockpick ${targetPoiName}: ${d20}+${dexMod + (sleightProficient ? profBonus : 0)}=${total} vs DC ${lockDc} — ${success ? 'success' : 'fail'}`,
              },
            });

            if (success) {
              await tx.poiInstance.update({
                where: { id: action.target_poi_instance_id },
                data: { currentProperties: { ...currentPoiProps, unlocked: true } },
              });
              effectDescription = `picked the lock on ${targetPoiName} (DC ${lockDc}, rolled ${total})`;
            } else {
              effectDescription = `failed to pick the lock on ${targetPoiName} (DC ${lockDc}, rolled ${total})`;
            }
          }
        } else if (!item.use_effect && action.target_poi_instance_id) {
          // Fallback: item has no use_effect but is being used on a POI — check if it's a key for that lock
          const poi = await tx.poiInstance.findUniqueOrThrow({
            where: { id: action.target_poi_instance_id },
            include: { template: true },
          });
          const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
          const lockedBy = defaultProps.locked_by;
          const lockedByArr = Array.isArray(lockedBy)
            ? (lockedBy as string[])
            : typeof lockedBy === 'string'
            ? [lockedBy]
            : [];
          if (lockedByArr.includes(item.id)) {
            const currentProps = poi.currentProperties as Record<string, unknown>;
            const isExitPoi = (defaultProps.poi_type as string) === 'exit';
            await tx.poiInstance.update({
              where: { id: action.target_poi_instance_id },
              data: {
                currentProperties: {
                  ...currentProps,
                  unlocked: true,
                  ...(isExitPoi ? { interacted: true, lastInteraction: 'opened' } : {}),
                },
              },
            });
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';
            effectDescription = `unlocked ${targetPoiName}`;
            console.log(`[items] use_item unlock (fallback): ${characterName} unlocked "${targetPoiName}" with "${item.name}"`);
            // Consume the key
            if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
            }
          }
        }

        // Consumption logic
        if (item.charges !== undefined) {
          item.charges -= 1;
          if (item.charges <= 0 && item.on_depleted === 'destroy') {
            if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
            }
          } else {
            if (itemLocation === 'bag') inv.bag[bagIdx] = item;
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) inv.equipped[slot as keyof CharacterInventory['equipped']] = item;
            }
          }
        } else if (item.consumable) {
          if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
          else {
            const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
            if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
          }
        }

        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object, ...charUpdates },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'use_item',
              item_id: itemId,
              item: item.name,
              effect: item.use_effect ?? null,
              result: effectDescription,
            },
            text: `[MECHANICAL] ${characterName} used ${item.name}: ${effectDescription}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: usedItemName });

    // ── throw_item ─────────────────────────────────────────────────────────
    } else if (action.action_type === 'throw_item') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('throw_item requires item_id');

      let thrownItemName = itemId;
      let landingPoiName = 'open space';

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const item = inv.bag[itemIdx];
        if (!item.throwable) throw new Error(`"${item.name}" is not throwable`);
        thrownItemName = item.name;
        inv.bag.splice(itemIdx, 1);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        if (!inCombat) {
          // In combat the item shatters on impact — no floor drop
          let landingPoiId = action.target_poi_instance_id;
          if (!landingPoiId || !validPoiMap.has(landingPoiId)) {
            landingPoiId = openSpacePoiId;
          }
          if (!landingPoiId) throw new Error('No valid landing location — open_space POI not found');
          landingPoiName = validPoiMap.get(landingPoiId) ?? 'open space';

          const poi = await tx.poiInstance.findUniqueOrThrow({ where: { id: landingPoiId } });
          const currentProps = poi.currentProperties as Record<string, unknown>;
          const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];
          await tx.poiInstance.update({
            where: { id: landingPoiId },
            data: { currentProperties: { ...currentProps, floor_items: [...floorItems, item] } as unknown as object },
          });
        }

        console.log(`[items] throw_item: ${characterName} threw "${item.name}"${inCombat ? ' (combat — no floor drop)' : ` → "${landingPoiName}"`}`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'throw_item',
              item_id: itemId,
              item: item.name,
              landing_poi: landingPoiName,
            },
            text: `[MECHANICAL] ${characterName} threw ${item.name} toward ${landingPoiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: landingPoiName, itemName: thrownItemName });

    // ── narrative_only (and fallthrough) ───────────────────────────────────
    } else {
      await prisma.messageLog.create({
        data: {
          roomInstanceId,
          characterId,
          isMechanicalEvent: true,
          mechanicalSummary: { event: 'narrative_only' },
          text: `[MECHANICAL] ${characterName} performed a narrative action with no positional change.`,
        },
      });
      appliedActions.push({ action, poiName: null, itemName: null });
    }
  }

  return { appliedActions, newRoomInstanceId };
}
