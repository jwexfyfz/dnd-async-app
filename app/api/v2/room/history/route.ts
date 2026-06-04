import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const roomInstanceId = req.nextUrl.searchParams.get('roomInstanceId');
  if (!roomInstanceId) {
    return NextResponse.json({ error: 'roomInstanceId is required' }, { status: 400 });
  }
  try {
    const logs = await prisma.messageLog.findMany({
      where: { roomInstanceId, isMechanicalEvent: false },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true },
    });
    return NextResponse.json({ logs });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room history' }, { status: 500 });
  }
}
