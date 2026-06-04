import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const templates = await prisma.roomTemplate.findMany({
      select: {
        id: true,
        name: true,
        baseDescription: true,
        dungeonTemplate: { select: { name: true } },
        poiTemplates: { select: { name: true, keywordIdentifier: true } },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ templates });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room templates' }, { status: 500 });
  }
}
