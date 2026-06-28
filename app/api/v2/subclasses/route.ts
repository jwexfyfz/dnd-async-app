import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SUBCLASS_LEVEL_UNLOCKS } from '@/lib/v2/class-definitions';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const characterClass = searchParams.get('class');
  if (!characterClass) return NextResponse.json({ error: 'class param required' }, { status: 400 });

  const rows = await prisma.subclass.findMany({
    where: { characterClass },
    orderBy: [{ available: 'desc' }, { name: 'asc' }],
  });

  const classUnlocks = SUBCLASS_LEVEL_UNLOCKS[characterClass] ?? {};
  const subclasses = rows.map(s => ({
    ...s,
    levelUnlocks: classUnlocks[s.key] ?? [],
  }));

  return NextResponse.json({ subclasses });
}
