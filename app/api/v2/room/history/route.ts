import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const LIMIT = 20;

export async function GET(req: NextRequest) {
  const roomInstanceId = req.nextUrl.searchParams.get('roomInstanceId');
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!roomInstanceId && !sessionId) {
    return NextResponse.json({ error: 'roomInstanceId or sessionId is required' }, { status: 400 });
  }
  const cursor = req.nextUrl.searchParams.get('cursor');

  const baseWhere = sessionId
    ? { roomInstance: { sessionId }, isMechanicalEvent: false }
    : { roomInstanceId: roomInstanceId!, isMechanicalEvent: false };
  const select = {
    id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true,
    characterId: true,
    character: { select: { name: true, characterClass: true } },
  };

  const flatten = (raw: { id: string; text: string; isMechanicalEvent: boolean; mechanicalSummary: unknown; createdAt: Date; characterId: string | null; character: { name: string; characterClass: string } | null }[]) =>
    raw.map(n => ({
      id: n.id,
      text: n.text,
      isMechanicalEvent: n.isMechanicalEvent,
      mechanicalSummary: n.mechanicalSummary,
      createdAt: n.createdAt,
      authorCharacterId: n.characterId ?? null,
      authorCharacterClass: n.character?.characterClass ?? null,
      authorName: n.character?.name ?? null,
      authorAvatarUrl: null as null,
    }));

  const since = req.nextUrl.searchParams.get('since');

  try {
    // since= mode: return all messages newer than the given ISO timestamp, ordered asc, no pagination
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json({ error: 'Invalid since value' }, { status: 400 });
      }
      const raw = await prisma.messageLog.findMany({
        where: { ...baseWhere, createdAt: { gt: sinceDate } },
        orderBy: { createdAt: 'asc' },
        select,
      });
      return NextResponse.json({ logs: flatten(raw), hasMore: false });
    }

    if (!cursor) {
      const raw = await prisma.messageLog.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        take: LIMIT + 1,
        select,
      });
      const hasMore = raw.length > LIMIT;
      if (hasMore) raw.pop();
      raw.reverse();
      return NextResponse.json({ logs: flatten(raw), hasMore });
    }

    const raw = await prisma.messageLog.findMany({
      where: { ...baseWhere, createdAt: { lt: new Date(cursor) } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT + 1,
      select,
    });
    const hasMore = raw.length > LIMIT;
    if (hasMore) raw.pop();
    raw.reverse();
    return NextResponse.json({ logs: flatten(raw), hasMore });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room history' }, { status: 500 });
  }
}
