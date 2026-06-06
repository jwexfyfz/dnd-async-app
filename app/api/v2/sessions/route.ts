import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const anthropic = new Anthropic({ maxRetries: 4 });

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!characterId) {
    return NextResponse.json({ error: 'characterId query param is required' }, { status: 400 });
  }

  try {
    const character = await prisma.character.findFirst({
      where: { id: characterId, userId: user.id },
      select: { id: true },
    });
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

    const sessions = await prisma.gameSession.findMany({
      where: {
        roomInstances: {
          some: { participants: { some: { characterId } } },
        },
      },
      include: {
        dungeonTemplate: { select: { name: true } },
        roomInstances: {
          include: {
            template: { select: { name: true } },
            participants: {
              where: { characterId },
              select: { lastActiveAt: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      sessions: sessions.map(session => {
        const activeRooms = session.roomInstances.filter(ri => ri.participants.length > 0);
        const mostRecent = activeRooms.sort(
          (a, b) => b.participants[0].lastActiveAt.getTime() - a.participants[0].lastActiveAt.getTime(),
        )[0];
        return {
          sessionId: session.id,
          sessionName: session.name,
          dungeonName: session.dungeonTemplate?.name ?? session.name,
          currentRoomName: mostRecent?.template.name ?? 'Unknown',
          roomInstanceId: mostRecent?.id ?? '',
          currentObjective: session.currentObjective,
          lastActiveAt: mostRecent?.participants[0]?.lastActiveAt,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch sessions' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!sessionId || !characterId) {
    return NextResponse.json({ error: 'sessionId and characterId are required' }, { status: 400 });
  }

  try {
    const participant = await prisma.roomParticipant.findFirst({
      where: {
        characterId,
        character: { userId: user.id },
        roomInstance: { sessionId },
      },
    });
    if (!participant) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    await prisma.gameSession.delete({ where: { id: sessionId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete session' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { characterId, dungeonTemplateId } = await req.json();
  if (!characterId || !dungeonTemplateId) {
    return NextResponse.json({ error: 'characterId and dungeonTemplateId are required' }, { status: 400 });
  }

  try {
    const [character, dungeon] = await Promise.all([
      prisma.character.findFirst({
        where: { id: characterId, userId: user.id },
        select: { id: true, name: true, characterClass: true, level: true },
      }),
      prisma.dungeonTemplate.findUniqueOrThrow({
        where: { id: dungeonTemplateId },
        select: { startRoomTemplateId: true },
      }),
    ]);
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if (!dungeon.startRoomTemplateId) {
      return NextResponse.json({ error: 'Dungeon has no start room configured' }, { status: 400 });
    }

    const roomTemplate = await prisma.roomTemplate.findUniqueOrThrow({
      where: { id: dungeon.startRoomTemplateId },
      select: {
        name: true,
        baseDescription: true,
        poiTemplates: { select: { id: true, name: true, defaultProperties: true } },
      },
    });

    const result = await prisma.$transaction(async tx => {
      const session = await tx.gameSession.create({
        data: {
          name: `${character.name}'s Session`,
          dungeonTemplateId,
          currentObjective: 'Investigate the disturbances in the merchant\'s cellar',
        },
      });
      const roomInstance = await tx.roomInstance.create({
        data: {
          sessionId: session.id,
          roomTemplateId: dungeon.startRoomTemplateId!,
          poiInstances: {
            create: roomTemplate.poiTemplates.map(tpl => ({ poiTemplateId: tpl.id, currentProperties: {} })),
          },
        },
        select: { id: true },
      });
      await tx.roomParticipant.upsert({
        where: { roomInstanceId_characterId: { roomInstanceId: roomInstance.id, characterId } },
        update: { lastActiveAt: new Date() },
        create: { roomInstanceId: roomInstance.id, characterId, combatState: { proximity_target_id: null, stance: null } },
      });
      return { characterId, sessionId: session.id, roomInstanceId: roomInstance.id };
    });

    let narrativeText = `You enter ${roomTemplate.name}. ${roomTemplate.baseDescription}`;
    try {
      const visiblePois = roomTemplate.poiTemplates.filter(t => {
        const props = t.defaultProperties as Record<string, unknown>;
        return props.visibility !== 'proximity_only' && props.poi_type !== 'open_space';
      });
      const poiList = visiblePois.map(t => `- ${t.name}`).join('\n') || '(empty room)';

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: `You are a Dungeon Master narrating a D&D adventure. Write an atmospheric opening scene (2-4 sentences) as the character enters the room. Use vivid, present-tense prose. Do not ask what the player does next.

ROOM: ${roomTemplate.name}
DESCRIPTION: ${roomTemplate.baseDescription}
VISIBLE FEATURES:
${poiList}`,
        messages: [
          {
            role: 'user',
            content: `${character.name} (${character.characterClass}, level ${character.level}) enters. Set the opening scene.`,
          },
        ],
      });

      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      if (textBlock?.text) narrativeText = textBlock.text;
    } catch (err) {
      console.error('[sessions] opening narrative AI call failed — using fallback:', err instanceof Error ? err.message : err);
    }

    await prisma.messageLog.create({
      data: {
        roomInstanceId: result.roomInstanceId,
        characterId,
        isMechanicalEvent: false,
        text: narrativeText,
      },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create session' }, { status: 500 });
  }
}
