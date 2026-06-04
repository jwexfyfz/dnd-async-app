import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const roomInstanceId = req.nextUrl.searchParams.get('roomInstanceId');
  if (!roomInstanceId) {
    return NextResponse.json({ error: 'roomInstanceId is required' }, { status: 400 });
  }
  try {
    const roomInstance = await prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      include: {
        session: { select: { id: true, gameState: true } },
        template: { select: { name: true } },
        poiInstances: {
          select: { id: true, currentProperties: true, template: { select: { name: true, defaultProperties: true } } },
        },
      },
    });
    if (!roomInstance) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const participants = await prisma.roomParticipant.findMany({
      where: { roomInstanceId },
      include: { character: { select: { id: true, name: true } } },
    });

    const poiIndex: Record<string, string> = {};
    const poiStates: Record<string, { examined: boolean; interacted: boolean; unlocked: boolean }> = {};
    const uiLayoutAnchors: Record<string, unknown[]> = { open_space: [] };

    for (const poi of roomInstance.poiInstances) {
      const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
      const poiType = defaultProps.poi_type as string | undefined;
      if (poiType === 'open_space') {
        uiLayoutAnchors[poi.id] = [];
        continue;
      }
      poiIndex[poi.id] = poi.template.name;
      uiLayoutAnchors[poi.id] = [];
      const props = (poi.currentProperties as Record<string, unknown>) ?? {};
      poiStates[poi.id] = {
        examined: props.examined === true,
        interacted: props.interacted === true,
        unlocked: props.unlocked === true,
      };
    }

    for (const p of participants) {
      const cs = p.combatState as { proximity_target_id?: string; stance?: string };
      const ref = { entityId: p.characterId, entityType: 'character', name: p.character.name, stance: cs.stance ?? null };
      if (cs.proximity_target_id && uiLayoutAnchors[cs.proximity_target_id]) {
        (uiLayoutAnchors[cs.proximity_target_id] as typeof ref[]).push(ref);
      } else {
        (uiLayoutAnchors.open_space as typeof ref[]).push(ref);
      }
    }

    return NextResponse.json({
      activeState: roomInstance.session.gameState,
      sessionId: roomInstance.session.id,
      roomName: roomInstance.template.name,
      poiIndex,
      poiStates,
      uiLayoutAnchors,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}
