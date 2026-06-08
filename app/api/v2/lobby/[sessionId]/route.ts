import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type LobbyMember = {
  characterId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  characterName: string;
  characterClass: string;
  status: 'joined' | 'ready';
};

// GET — poll lobby state (public — no auth required to view the lobby)
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        gameState: true,
        hostCharacterId: true,
        lobbyState: true,
        lobbyVersion: true,
        dungeonTemplate: { select: { name: true } },
        roomInstances: {
          take: 1,
          select: { id: true, participants: { take: 1, select: { characterId: true } } },
        },
      },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    if (session.gameState === 'active') {
      const roomInstanceId = session.roomInstances[0]?.id ?? '';
      const hostCharacterId = session.hostCharacterId ?? '';
      return NextResponse.json({
        gameState: 'active',
        redirectTo: `/v2/play?session=${sessionId}&char=${hostCharacterId}`,
        roomInstanceId,
      });
    }

    if (session.gameState === 'completed') {
      return NextResponse.json({ gameState: 'completed' });
    }

    const { origin } = new URL(req.url);
    return NextResponse.json({
      gameState: 'lobby',
      members: session.lobbyState as LobbyMember[],
      hostCharacterId: session.hostCharacterId,
      lobbyVersion: session.lobbyVersion,
      dungeonName: session.dungeonTemplate?.name ?? 'Unknown Dungeon',
      shareUrl: `${origin}/v2/lobby/${sessionId}`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to fetch lobby' }, { status: 500 });
  }
}

// POST — join lobby
export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { characterId, lobbyVersion } = body as { characterId?: string; lobbyVersion?: number };
  if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const [character, session] = await Promise.all([
      prisma.character.findFirst({
        where: { id: characterId, userId: user.id },
        select: { id: true, name: true, characterClass: true, isDead: true },
      }),
      prisma.gameSession.findUnique({
        where: { id: sessionId },
        select: { gameState: true, lobbyState: true, lobbyVersion: true, kickedCharacterIds: true },
      }),
    ]);

    if (!character) return NextResponse.json({ error: 'Character not found or not yours' }, { status: 403 });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (character.isDead) return NextResponse.json({ error: 'Dead characters cannot join sessions' }, { status: 400 });
    if (session.gameState !== 'lobby') return NextResponse.json({ error: 'Session has already started' }, { status: 400 });

    const kicked = session.kickedCharacterIds as string[];
    if (kicked.includes(characterId)) return NextResponse.json({ error: 'You have been removed from this session' }, { status: 403 });

    const members = session.lobbyState as LobbyMember[];
    if (members.some(m => m.characterId === characterId)) {
      return NextResponse.json({ error: 'Already in this lobby' }, { status: 400 });
    }
    if (members.length >= 4) return NextResponse.json({ error: 'Party is full' }, { status: 400 });

    // Optimistic lock
    if (typeof lobbyVersion === 'number' && lobbyVersion !== session.lobbyVersion) {
      return NextResponse.json({ error: 'Lobby changed — please retry', retryable: true }, { status: 409 });
    }

    const hostUser = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true, displayName: true } });
    const newMember: LobbyMember = {
      characterId,
      userId: user.id,
      displayName: hostUser?.displayName ?? user.email ?? 'Adventurer',
      avatarUrl: hostUser?.avatarUrl ?? null,
      characterName: character.name,
      characterClass: character.characterClass,
      status: 'joined',
    };

    const updated = await prisma.gameSession.update({
      where: { id: sessionId, lobbyVersion: session.lobbyVersion },
      data: { lobbyState: [...members, newMember] as object[], lobbyVersion: { increment: 1 } },
      select: { lobbyState: true, lobbyVersion: true },
    });

    return NextResponse.json({ members: updated.lobbyState, lobbyVersion: updated.lobbyVersion });
  } catch (err: unknown) {
    // P2025 = record not found (optimistic lock conflict)
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Lobby changed — please retry', retryable: true }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to join lobby' }, { status: 500 });
  }
}

// PATCH — toggle ready
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const { characterId } = await req.json().catch(() => ({})) as { characterId?: string };
  if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { gameState: true, hostCharacterId: true, lobbyState: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (session.gameState !== 'lobby') return NextResponse.json({ error: 'Session is not in lobby' }, { status: 400 });
    if (characterId === session.hostCharacterId) return NextResponse.json({ error: 'Host is always ready' }, { status: 400 });

    const members = session.lobbyState as LobbyMember[];
    const idx = members.findIndex(m => m.characterId === characterId);
    if (idx === -1) return NextResponse.json({ error: 'Member not found in lobby' }, { status: 404 });

    const updated = members.map((m, i) =>
      i === idx ? { ...m, status: m.status === 'ready' ? 'joined' : 'ready' } as LobbyMember : m,
    );

    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { lobbyState: updated as object[] },
    });

    return NextResponse.json({ members: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update ready state' }, { status: 500 });
  }
}

// DELETE — leave lobby
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const { characterId } = await req.json().catch(() => ({})) as { characterId?: string };
  if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { hostCharacterId: true, lobbyState: true, lobbyVersion: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const members = session.lobbyState as LobbyMember[];
    const idx = members.findIndex(m => m.characterId === characterId);
    if (idx === -1) return NextResponse.json({ error: 'Member not found in lobby' }, { status: 404 });

    const remaining = members.filter(m => m.characterId !== characterId);

    // Host leaving
    if (characterId === session.hostCharacterId) {
      if (remaining.length === 0) {
        await prisma.gameSession.delete({ where: { id: sessionId } });
        return NextResponse.json({ deleted: true });
      }
      // Promote first ready member, or first member if none ready
      const newHost = remaining.find(m => m.status === 'ready') ?? remaining[0];
      await prisma.gameSession.update({
        where: { id: sessionId },
        data: { lobbyState: remaining as object[], hostCharacterId: newHost.characterId, lobbyVersion: { increment: 1 } },
      });
      return NextResponse.json({ members: remaining, newHostCharacterId: newHost.characterId });
    }

    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { lobbyState: remaining as object[], lobbyVersion: { increment: 1 } },
    });
    return NextResponse.json({ members: remaining });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to leave lobby' }, { status: 500 });
  }
}
