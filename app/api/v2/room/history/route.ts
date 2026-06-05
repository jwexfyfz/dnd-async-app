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
  const select = { id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true };

  try {
    if (!cursor) {
      const logs = await prisma.messageLog.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        take: LIMIT + 1,
        select,
      });
      const hasMore = logs.length > LIMIT;
      if (hasMore) logs.pop();
      logs.reverse();
      return NextResponse.json({ logs, hasMore });
    }

    const logs = await prisma.messageLog.findMany({
      where: { ...baseWhere, createdAt: { lt: new Date(cursor) } },
      orderBy: { createdAt: 'desc' },
      take: LIMIT + 1,
      select,
    });
    const hasMore = logs.length > LIMIT;
    if (hasMore) logs.pop();
    logs.reverse();
    return NextResponse.json({ logs, hasMore });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room history' }, { status: 500 });
  }
}
