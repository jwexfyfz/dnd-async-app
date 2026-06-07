import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type LobbyMember = { characterId: string; status: string; [k: string]: unknown };

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const { characterId: targetCharacterId } = await req.json().catch(() => ({})) as { characterId?: string };
  if (!targetCharacterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { hostCharacterId: true, lobbyState: true, lobbyVersion: true, kickedCharacterIds: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // Verify requester is the host
    const hostChar = session.hostCharacterId
      ? await prisma.character.findFirst({ where: { id: session.hostCharacterId, userId: user.id }, select: { id: true } })
      : null;
    if (!hostChar) return NextResponse.json({ error: 'Only the host can kick members' }, { status: 403 });
    if (targetCharacterId === session.hostCharacterId) return NextResponse.json({ error: 'Cannot kick yourself' }, { status: 400 });

    const members = session.lobbyState as LobbyMember[];
    if (!members.some(m => m.characterId === targetCharacterId)) {
      return NextResponse.json({ error: 'Member not found in lobby' }, { status: 404 });
    }

    const remaining = members.filter(m => m.characterId !== targetCharacterId);
    const kicked = (session.kickedCharacterIds as string[]).concat(targetCharacterId);
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: {
        lobbyState: remaining as object[],
        kickedCharacterIds: kicked,
        lobbyVersion: { increment: 1 },
      },
    });

    return NextResponse.json({ members: remaining });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to kick member' }, { status: 500 });
  }
}
