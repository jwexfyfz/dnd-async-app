import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.user.upsert({
    where: { id: user.id },
    update: { lastSeenAt: new Date() },
    create: { id: user.id, email: user.email ?? '', lastSeenAt: new Date() },
  });
  return new NextResponse(null, { status: 204 });
}
