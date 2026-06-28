import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { PendingChoice, CombatState } from '@/types/v2-game';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: characterId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true, userId: true, isDead: true, level: true, pendingChoicesQueue: true,
      participants: {
        select: {
          id: true,
          roomInstance: {
            select: { id: true, sessionId: true, gameState: true, combatState: true },
          },
        },
      },
    },
  });

  if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const queue = (character.pendingChoicesQueue ?? []) as PendingChoice[];
  const sacrificeEntry = queue.find(c => c.type === 'heroic_sacrifice');
  if (!sacrificeEntry) {
    return NextResponse.json({ error: 'No heroic_sacrifice pending for this character' }, { status: 409 });
  }

  const participant = character.participants[0] ?? null;
  const sessionId = participant?.roomInstance.sessionId ?? null;
  const fallenLevel = character.level;

  const newQueue = queue.filter(c => c.type !== 'heroic_sacrifice');

  await prisma.$transaction([
    prisma.character.update({
      where: { id: characterId },
      data: {
        isDead: true,
        currentHp: 0,
        pendingChoicesQueue: newQueue,
      },
    }),
    prisma.roomParticipant.updateMany({
      where: {
        characterId,
        ...(sessionId ? { roomInstance: { sessionId } } : {}),
      },
      data: { isActive: false },
    }),
  ]);

  // Remove character from combat initiative order and advance the turn if needed
  if (participant?.roomInstance.gameState === 'combat' && participant.roomInstance.combatState) {
    const roomInstanceId = participant.roomInstance.id;
    const cs = participant.roomInstance.combatState as unknown as CombatState;
    const wasActive = cs.activeActorId === characterId;

    const newOrder = cs.initiativeOrder.filter(e => e.id !== characterId);
    let newActiveActorId = cs.activeActorId;
    let newRound = cs.round;

    if (wasActive && newOrder.length > 0) {
      const origIdx = cs.initiativeOrder.findIndex(e => e.id === characterId);
      const isSkippable = (e: (typeof newOrder)[number]) =>
        e.isDormant ||
        (e.type === 'enemy' && e.hp <= 0) ||
        (e.type === 'character' && e.hp <= 0 && !!e.isStabilized);

      // Look for next un-acted, non-skippable entry after the removed slot
      const afterSlot = newOrder.slice(origIdx).find(e => !e.acted && !isSkippable(e));
      if (afterSlot) {
        newActiveActorId = afterSlot.id;
      } else {
        // Wrap to new round: first non-skippable entry
        const firstValid = newOrder.find(e => !isSkippable(e));
        if (firstValid) {
          newActiveActorId = firstValid.id;
          newRound = cs.round + 1;
          newOrder.forEach(e => { e.acted = false; });
        }
      }
    }

    await prisma.roomInstance.update({
      where: { id: roomInstanceId },
      data: {
        combatState: {
          ...cs,
          initiativeOrder: newOrder,
          activeActorId: newActiveActorId,
          round: newRound,
          currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
        } as object,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    redirectLevel: fallenLevel,
    sessionId,
    predecessorCharacterId: characterId,
  });
}
