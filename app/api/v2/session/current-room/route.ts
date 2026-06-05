import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!sessionId || !characterId) {
    return NextResponse.json({ error: 'sessionId and characterId are required' }, { status: 400 });
  }
  try {
    const participant = await prisma.roomParticipant.findFirst({
      where: { characterId, roomInstance: { sessionId } },
      orderBy: { lastActiveAt: 'desc' },
      select: { roomInstanceId: true },
    });
    if (!participant) {
      return NextResponse.json({ error: 'No room found for this character in session' }, { status: 404 });
    }
    return NextResponse.json({ roomInstanceId: participant.roomInstanceId });
  } catch {
    return NextResponse.json({ error: 'Failed to resolve current room' }, { status: 500 });
  }
}
