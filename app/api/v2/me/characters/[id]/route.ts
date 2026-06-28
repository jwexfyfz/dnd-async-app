import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { userId: true, games: { select: { id: true } } },
  });
  if (!character) return NextResponse.json({ error: 'Character not found.' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Not your character.' }, { status: 403 });

  try {
    for (const game of character.games) {
      await prisma.message.deleteMany({ where: { gameId: game.id } });
      await prisma.partyMember.deleteMany({ where: { gameId: game.id } });
      await prisma.game.delete({ where: { id: game.id } });
    }
    await prisma.partyMember.deleteMany({ where: { characterId } });
    await prisma.character.delete({ where: { id: characterId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete character.' },
      { status: 500 },
    );
  }
}
