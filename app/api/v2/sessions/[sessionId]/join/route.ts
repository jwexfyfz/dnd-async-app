import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { joinCombat } from '@/lib/v2/combat-engine';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { characterId, predecessorCharacterId } = await req.json();
  if (!characterId || !predecessorCharacterId) {
    return NextResponse.json({ error: 'characterId and predecessorCharacterId required' }, { status: 400 });
  }

  const [newChar, predecessorChar, session] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, userId: true, isDead: true, name: true, characterClass: true },
    }),
    prisma.character.findUnique({
      where: { id: predecessorCharacterId },
      select: { id: true, userId: true, isDead: true, name: true, characterClass: true },
    }),
    prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { id: true, gameState: true },
    }),
  ]);

  if (!newChar || newChar.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (newChar.isDead) return NextResponse.json({ error: 'New character is dead' }, { status: 400 });
  if (!predecessorChar || predecessorChar.userId !== user.id || !predecessorChar.isDead) {
    return NextResponse.json({ error: 'Invalid predecessor' }, { status: 403 });
  }
  if (!session || session.gameState === 'completed') {
    return NextResponse.json({ error: 'Session not active' }, { status: 400 });
  }

  // Verify predecessor was in this session
  const predecessorParticipant = await prisma.roomParticipant.findFirst({
    where: { characterId: predecessorCharacterId, roomInstance: { sessionId } },
    select: { id: true },
  });
  if (!predecessorParticipant) return NextResponse.json({ error: 'Predecessor not in this session' }, { status: 403 });

  // Verify party is not full (≤ 3 active participants)
  const activeCount = await prisma.roomParticipant.count({
    where: { roomInstance: { sessionId }, isActive: true, character: { isDead: false } },
  });
  if (activeCount >= 4) return NextResponse.json({ error: 'Party is full' }, { status: 409 });

  // Find the best safe room — prefer non-combat rooms so the new character doesn't spawn mid-fight
  const roomInstances = await prisma.roomInstance.findMany({
    where: { sessionId },
    select: {
      id: true,
      gameState: true,
      _count: { select: { participants: { where: { isActive: true } } } },
      messages: { where: { isMechanicalEvent: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
    orderBy: { inGameTimestamp: 'desc' },
  });

  const safeRooms = roomInstances.filter(r => r.gameState !== 'combat');
  const candidates = safeRooms.length > 0 ? safeRooms : roomInstances;

  const currentRoom = candidates.sort((a, b) => {
    const diff = b._count.participants - a._count.participants;
    if (diff !== 0) return diff;
    const aTime = a.messages[0]?.createdAt?.getTime() ?? 0;
    const bTime = b.messages[0]?.createdAt?.getTime() ?? 0;
    return bTime - aTime;
  })[0];

  if (!currentRoom) return NextResponse.json({ error: 'No room found in session' }, { status: 400 });

  // Gather recent context
  const recentMessages = await prisma.messageLog.findMany({
    where: { roomInstanceId: currentRoom.id, isMechanicalEvent: false },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { text: true },
  });
  const recentContext = recentMessages
    .reverse()
    .map(m => m.text.substring(0, 200))
    .join(' / ')
    .substring(0, 800);

  await prisma.$transaction([
    prisma.roomParticipant.create({
      data: {
        roomInstanceId: currentRoom.id,
        characterId,
        combatState: { proximity_target_id: null, stance: null },
      },
    }),
    prisma.character.update({
      where: { id: characterId },
      data: {
        pendingArrivalContext: {
          fallenName: predecessorChar.name,
          fallenClass: predecessorChar.characterClass,
          newName: newChar.name,
          newClass: newChar.characterClass,
          recentContext,
        },
      },
    }),
    prisma.messageLog.create({
      data: {
        roomInstanceId: currentRoom.id,
        isMechanicalEvent: false,
        mechanicalSummary: { type: 'character_incoming', characterName: newChar.name },
        text: `[PARTY] ${newChar.name} is making their way to the group...`,
      },
    }),
  ]);

  // If the assigned room is currently in combat, enroll the new character immediately
  // so combat can progress (otherwise enemy auto-advance won't fire and the game stalls).
  if (currentRoom.gameState === 'combat') {
    await joinCombat(characterId, currentRoom.id, false);
  }

  return NextResponse.json({ ok: true });
}
