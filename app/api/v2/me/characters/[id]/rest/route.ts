import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { applyShortRest, applyLongRest } from '@/lib/v2/rest-helpers';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;
  const { type, roomInstanceId, auto } = (await req.json()) as { type: 'short' | 'long'; roomInstanceId?: string; auto?: boolean };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true,
      currentHp: true,
      maxHp: true,
      level: true,
      resourceStates: true,
    },
  });
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Not your character' }, { status: 403 });

  if (type === 'short') {
    const restored = await prisma.$transaction(async tx => applyShortRest(tx, characterId));
    if (restored.length === 0) {
      return NextResponse.json({ error: 'All resources are already at maximum' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, restored });
  }

  if (type === 'long' && auto) {
    // Skip auto rest if character is currently in active combat
    const activeParticipant = await prisma.roomParticipant.findFirst({
      where: { characterId, roomInstance: { gameState: 'combat' } },
      select: { id: true },
    });
    if (activeParticipant) return NextResponse.json({ ok: true, applied: false });

    const applied = await prisma.$transaction(async tx => {
      const char = await tx.character.findUniqueOrThrow({
        where: { id: characterId },
        select: { lastLongRest: true },
      });
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
      if (!char.lastLongRest || char.lastLongRest > eightHoursAgo) return false;
      await applyLongRest(tx, characterId);
      return true;
    });
    return NextResponse.json({ ok: true, applied });
  }

  if (type === 'long') {
    // Verify the character is in a safe room
    if (roomInstanceId) {
      const roomInstance = await prisma.roomInstance.findUnique({
        where: { id: roomInstanceId },
        include: { template: { select: { canLongRest: true } } },
      });
      if (!roomInstance?.template.canLongRest) {
        return NextResponse.json({ error: 'Long rest is only available in safe rooms' }, { status: 400 });
      }
    }

    await prisma.$transaction(async tx => applyLongRest(tx, characterId));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'type must be "short" or "long"' }, { status: 400 });
}
