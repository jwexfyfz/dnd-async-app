import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!sessionId || !characterId) {
    return NextResponse.json({ error: 'sessionId and characterId are required' }, { status: 400 });
  }

  try {
    // All room instances visited in this session
    const roomInstances = await prisma.roomInstance.findMany({
      where: { sessionId },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            map_x: true,
            map_y: true,
            poiTemplates: {
              select: {
                id: true,
                name: true,
                grid_slot: true,
                visibility_level: true,
                exit_direction: true,
                exit_wall_section: true,
                exit_arch_width: true,
                defaultProperties: true,
              },
            },
          },
        },
        poiInstances: {
          select: {
            id: true,
            poiTemplateId: true,
            currentProperties: true,
          },
        },
        participants: {
          select: {
            characterId: true,
            combatState: true,
            lastActiveAt: true,
            character: { select: { id: true, name: true, characterClass: true, isHiding: true } },
          },
        },
      },
    });

    // Character's current room
    const currentParticipant = await prisma.roomParticipant.findFirst({
      where: { characterId },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        roomInstanceId: true,
        combatState: true,
        character: { select: { isHiding: true } },
      },
    });

    // For each character, find their most recently active room instance
    const charCurrentRoom = new Map<string, string>();
    for (const ri of roomInstances) {
      for (const p of ri.participants) {
        const existing = charCurrentRoom.get(p.characterId);
        if (!existing) {
          charCurrentRoom.set(p.characterId, ri.id);
        } else {
          // Compare lastActiveAt to keep the most recent
          const existingRi = roomInstances.find(r => r.id === existing);
          const existingP = existingRi?.participants.find(ep => ep.characterId === p.characterId);
          if (existingP && p.lastActiveAt > existingP.lastActiveAt) {
            charCurrentRoom.set(p.characterId, ri.id);
          }
        }
      }
    }

    const rooms = roomInstances.map(ri => {
      // Build poi instance map for state lookup
      const poiStateMap = new Map(
        ri.poiInstances.map(pi => [pi.poiTemplateId, pi.currentProperties as Record<string, unknown>])
      );
      const poiInstanceIdMap = new Map(
        ri.poiInstances.map(pi => [pi.poiTemplateId, pi.id])
      );

      const pois = ri.template.poiTemplates.map(pt => {
        const state = poiStateMap.get(pt.id) ?? {};
        const defaultProps = pt.defaultProperties as Record<string, unknown>;
        const effectivePeek = computeEffectivePeek(
          (defaultProps.peek_visibility as string) ?? 'none',
          computeIsLockable(defaultProps.locked_by) && state.unlocked !== true,
          state.interacted === true,
          state.destroyed === true,
        );

        return {
          instanceId: poiInstanceIdMap.get(pt.id) ?? null,
          templateId: pt.id,
          name: pt.name,
          grid_slot: pt.grid_slot,
          visibility_level: pt.visibility_level,
          exit_direction: pt.exit_direction,
          exit_wall_section: pt.exit_wall_section,
          exit_arch_width: pt.exit_arch_width,
          poi_type: (defaultProps.poi_type as string) ?? 'interactive',
          peek_visibility: effectivePeek,
          examined: state.examined === true,
          interacted: state.interacted === true,
          unlocked: state.unlocked === true,
          isDead: state.awareness_state === 'dead',
        };
      });

      // Build a lookup from enemy POI instance ID → their current combat grid_slot
      // so player positions resolve to where enemies actually are, not their template origin
      const combatOrder = (ri.combatState as { initiativeOrder?: { id: string; grid_slot?: string }[] } | null)?.initiativeOrder ?? [];
      const enemyCombatSlot = new Map(combatOrder.filter(e => e.grid_slot).map(e => [e.id, e.grid_slot!]));

      const characters: {
        characterId: string;
        name: string;
        characterClass: string | null;
        grid_slot: string;
        stance: string | null;
        type: 'player' | 'enemy';
        isDead?: boolean;
      }[] = ri.participants.filter(p => charCurrentRoom.get(p.characterId) === ri.id).map(p => {
        const cs = p.combatState as { proximity_target_id?: string; stance?: string };
        const proxId = cs.proximity_target_id ?? null;
        // If the proximity target is an enemy with a tracked combat position, use that
        const combatSlot = proxId ? enemyCombatSlot.get(proxId) : undefined;
        let gridSlot = 'C';
        if (combatSlot) {
          gridSlot = combatSlot;
        } else if (proxId) {
          const proximityPoi = ri.poiInstances.find(pi => pi.id === proxId);
          const proximityTemplate = proximityPoi
            ? ri.template.poiTemplates.find(pt => pt.id === proximityPoi.poiTemplateId)
            : null;
          gridSlot = proximityTemplate?.grid_slot ?? 'C';
        }
        return {
          characterId: p.characterId,
          name: p.character.name,
          characterClass: p.character.characterClass,
          grid_slot: gridSlot,
          stance: cs.stance ?? null,
          type: 'player' as const,
          isHiding: p.character.isHiding ?? false,
        };
      });

      // Add enemies from combat state (alive and dead)
      const roomCombat = ri.combatState as { initiativeOrder?: { id: string; type: string; name: string; hp: number; grid_slot?: string }[] } | null;
      if (roomCombat?.initiativeOrder) {
        for (const entry of roomCombat.initiativeOrder) {
          if (entry.type !== 'enemy') continue;
          // entry.id is the poiInstanceId
          const poi = ri.poiInstances.find(pi => pi.id === entry.id);
          const template = poi ? ri.template.poiTemplates.find(pt => pt.id === poi.poiTemplateId) : null;
          // Prefer the tracked grid_slot (updated as enemy moves), fall back to template slot
          const gridSlot = entry.grid_slot ?? template?.grid_slot ?? 'C';
          characters.push({
            characterId: entry.id,
            name: entry.name,
            characterClass: null,
            grid_slot: gridSlot,
            stance: null,
            type: 'enemy',
            isDead: entry.hp <= 0,
          });
        }
      }

      return {
        instanceId: ri.id,
        templateId: ri.template.id,
        name: ri.template.name,
        map_x: ri.template.map_x,
        map_y: ri.template.map_y,
        pois,
        characters,
      };
    });

    const combatState = currentParticipant?.combatState as { proximity_target_id?: string } | null;
    const character = {
      characterId,
      roomInstanceId: currentParticipant?.roomInstanceId ?? null,
      proximityTargetId: combatState?.proximity_target_id ?? null,
      isHiding: currentParticipant?.character?.isHiding ?? false,
    };

    // Include adjacent unvisited rooms reachable through peekable exits
    const visitedTemplateIds = new Set(rooms.map(r => r.templateId));
    const currentRoomInstance = roomInstances.find(ri => ri.id === currentParticipant?.roomInstanceId);
    if (currentRoomInstance) {
      const peekableExits = currentRoomInstance.template.poiTemplates.filter(pt => {
        const dp = pt.defaultProperties as Record<string, unknown>;
        if (!pt.exit_direction) return false;
        const pi = currentRoomInstance.poiInstances.find(pi => pi.poiTemplateId === pt.id);
        const state = (pi?.currentProperties as Record<string, unknown>) ?? {};
        return computeEffectivePeek(
          (dp.peek_visibility as string) ?? 'none',
          computeIsLockable(dp.locked_by) && state.unlocked !== true,
          state.interacted === true,
          state.destroyed === true,
        ) !== 'none';
      });

      for (const exitPt of peekableExits) {
        const dp = exitPt.defaultProperties as Record<string, unknown>;
        const enterVerb = dp.enter as Record<string, unknown> | undefined;
        const targetTemplateId = enterVerb?.target_room_template_id as string | undefined;
        if (!targetTemplateId || visitedTemplateIds.has(targetTemplateId)) continue;

        const adjTemplate = await prisma.roomTemplate.findUnique({
          where: { id: targetTemplateId },
          select: {
            id: true, name: true, map_x: true, map_y: true,
            poiTemplates: {
              select: {
                id: true, name: true, grid_slot: true, visibility_level: true,
                exit_direction: true, exit_wall_section: true, exit_arch_width: true,
                defaultProperties: true,
              },
            },
          },
        });
        if (!adjTemplate) continue;

        const pois = adjTemplate.poiTemplates.map(pt => {
          const defaultProps = pt.defaultProperties as Record<string, unknown>;
          return {
            instanceId: null as string | null,
            templateId: pt.id,
            name: pt.name,
            grid_slot: pt.grid_slot,
            visibility_level: pt.visibility_level,
            exit_direction: pt.exit_direction,
            exit_wall_section: pt.exit_wall_section,
            exit_arch_width: pt.exit_arch_width,
            poi_type: (defaultProps.poi_type as string) ?? 'interactive',
            peek_visibility: ((defaultProps.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
            examined: false,
            interacted: false,
            unlocked: false,
            isDead: false,
          };
        });

        rooms.push({
          instanceId: `preview:${targetTemplateId}`,
          templateId: targetTemplateId,
          name: adjTemplate.name,
          map_x: adjTemplate.map_x,
          map_y: adjTemplate.map_y,
          pois,
          characters: [],
        });
        visitedTemplateIds.add(targetTemplateId);
        console.log(`[map] added preview room: ${adjTemplate.name} via ${exitPt.name}`);
      }
    }

    // Restrict to current room + direct neighbors (Manhattan distance ≤ 1)
    const curTemplate = currentRoomInstance?.template;
    const nearbyRooms = curTemplate
      ? rooms.filter(r =>
          Math.abs(r.map_x - curTemplate.map_x) + Math.abs(r.map_y - curTemplate.map_y) <= 1
        )
      : rooms;

    return NextResponse.json({ rooms: nearbyRooms, character });
  } catch (e) {
    console.error('[map] error:', e);
    return NextResponse.json({ error: 'Failed to fetch map data' }, { status: 500 });
  }
}
