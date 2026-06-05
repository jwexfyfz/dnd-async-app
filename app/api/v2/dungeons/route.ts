import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const dungeons = await prisma.dungeonTemplate.findMany({
      where: { startRoomTemplateId: { not: null } },
      select: {
        id: true,
        name: true,
        synopsis: true,
        difficulty: true,
        length: true,
        tone: true,
        startRoomTemplateId: true,
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ dungeons });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch dungeons' }, { status: 500 });
  }
}
