import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { advanceTurn } from '@/lib/v2/game-controller';
import type { CombatState } from '@/types/v2-game';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const { characterId: targetId } = await req.json().catch(() => ({})) as { characterId?: string };
  if (!targetId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { hostCharacterId: true, kickedCharacterIds: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const hostChar = session.hostCharacterId
      ? await prisma.character.findFirst({ where: { id: session.hostCharacterId, userId: user.id }, select: { id: true } })
      : null;
    if (!hostChar) return NextResponse.json({ error: 'Only the host can kick members' }, { status: 403 });
    if (targetId === session.hostCharacterId) return NextResponse.json({ error: 'Cannot kick yourself' }, { status: 400 });

    const targetParticipants = await prisma.roomParticipant.findMany({
      where: { characterId: targetId, roomInstance: { sessionId } },
      select: { id: true, roomInstanceId: true },
    });
    if (targetParticipants.length === 0) return NextResponse.json({ error: 'Character not in this session' }, { status: 404 });

    await prisma.$transaction(async tx => {
      await tx.roomParticipant.deleteMany({ where: { characterId: targetId, roomInstance: { sessionId } } });

      // Splice from any active combat states
      const roomIds = targetParticipants.map(p => p.roomInstanceId);
      const combatRooms = await tx.roomInstance.findMany({
        where: { id: { in: roomIds }, gameState: 'combat' },
        select: { id: true, combatState: true },
      });
      for (const room of combatRooms) {
        const cs = room.combatState as unknown as CombatState;
        const filtered = cs.initiativeOrder.filter(e => e.id !== targetId);
        let newActiveId = cs.activeActorId;
        if (cs.activeActorId === targetId) {
          // Mark kicked actor as acted, advance normally, then use the new activeActorId
          const withActed = { ...cs, initiativeOrder: cs.initiativeOrder.map(e => e.id === targetId ? { ...e, acted: true } : e) };
          const advanced = advanceTurn(withActed);
          newActiveId = advanced.activeActorId;
        }
        const newCs: CombatState = { ...cs, initiativeOrder: filtered, activeActorId: newActiveId };
        if (filtered.every(e => e.type === 'enemy')) {
          await tx.roomInstance.update({ where: { id: room.id }, data: { gameState: 'exploration', combatState: Prisma.JsonNull } });
        } else {
          await tx.roomInstance.update({ where: { id: room.id }, data: { combatState: newCs as object } });
        }
      }

      await tx.gameSession.update({
        where: { id: sessionId },
        data: { kickedCharacterIds: { push: targetId } },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to kick' }, { status: 500 });
  }
}
