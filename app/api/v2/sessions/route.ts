import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { createSupabaseServerClient } from '@/lib/supabase-server';

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
              select: {
                lastActiveAt: true,
                characterId: true,
                character: {
                  select: {
                    id: true, name: true, characterClass: true,
                    user: { select: { avatarUrl: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      sessions: sessions.map(session => {
        const myParticipation = session.roomInstances.filter(
          ri => ri.participants.some(p => p.characterId === characterId),
        );
        const mostRecent = myParticipation.sort((a, b) => {
          const aT = a.participants.find(p => p.characterId === characterId)?.lastActiveAt.getTime() ?? 0;
          const bT = b.participants.find(p => p.characterId === characterId)?.lastActiveAt.getTime() ?? 0;
          return bT - aT;
        })[0];
        const seenCharIds = new Set<string>();
        const partyMembers: { id: string; name: string; characterClass: string; avatarUrl: string | null }[] = [];
        for (const ri of session.roomInstances) {
          for (const p of ri.participants) {
            if (!seenCharIds.has(p.character.id)) {
              seenCharIds.add(p.character.id);
              partyMembers.push({
                id: p.character.id,
                name: p.character.name,
                characterClass: p.character.characterClass,
                avatarUrl: (p.character as { user?: { avatarUrl?: string | null } }).user?.avatarUrl ?? null,
              });
            }
          }
        }
        return {
          sessionId: session.id,
          sessionName: session.name,
          dungeonName: session.dungeonTemplate?.name ?? session.name,
          currentRoomName: mostRecent?.template.name ?? 'Unknown',
          roomInstanceId: mostRecent?.id ?? '',
          currentObjective: session.currentObjective,
          lastActiveAt: mostRecent?.participants.find(p => p.characterId === characterId)?.lastActiveAt,
          gameState: session.gameState,
          partyMembers,
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
        select: { name: true, startRoomTemplateId: true },
      }),
    ]);
    if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    if (!dungeon.startRoomTemplateId) {
      return NextResponse.json({ error: 'Dungeon has no start room configured' }, { status: 400 });
    }

    const roomTemplate = await prisma.roomTemplate.findUniqueOrThrow({
      where: { id: dungeon.startRoomTemplateId },
      select: {
        poiTemplates: { select: { id: true, defaultProperties: true } },
      },
    });

    // Fetch host's avatarUrl for lobby entry
    const hostUser = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });

    const hostLobbyEntry = {
      characterId,
      userId: user.id,
      displayName: user.user_metadata?.full_name ?? user.email ?? 'Adventurer',
      avatarUrl: hostUser?.avatarUrl ?? null,
      characterName: character.name,
      characterClass: character.characterClass,
      status: 'ready' as const,
    };

    const result = await prisma.$transaction(async tx => {
      const session = await tx.gameSession.create({
        data: {
          name: dungeon.name,
          dungeonTemplateId,
          gameState: 'lobby',
          hostCharacterId: characterId,
          lobbyState: [hostLobbyEntry],
          kickedCharacterIds: [],
          lobbyVersion: 0,
          currentObjective: 'Investigate the disturbances in the merchant\'s cellar',
        },
      });
      const roomInstance = await tx.roomInstance.create({
        data: {
          sessionId: session.id,
          roomTemplateId: dungeon.startRoomTemplateId!,
          gameState: 'exploration',
          combatState: Prisma.JsonNull,
          processingAction: false,
          poiInstances: {
            create: roomTemplate.poiTemplates.map(tpl => {
              const dp = tpl.defaultProperties as Record<string, unknown>;
              const initAwareness = dp.initial_awareness_state as string | undefined;
              const currentProperties = initAwareness
                ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                : {};
              return { poiTemplateId: tpl.id, currentProperties };
            }),
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

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create session' }, { status: 500 });
  }
}
