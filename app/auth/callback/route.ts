import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.user) {
        const user = data.user;
        const displayName =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          user.email?.split('@')[0] ||
          'Adventurer';
        const rawAvatarUrl = user.user_metadata?.avatar_url as string | undefined;
        const avatarUrl = rawAvatarUrl && rawAvatarUrl.startsWith('https://') ? rawAvatarUrl : null;
        await prisma.user.upsert({
          where: { id: user.id },
          update: { displayName, avatarUrl, lastSeenAt: new Date() },
          create: { id: user.id, email: user.email ?? '', displayName, avatarUrl, lastSeenAt: new Date() },
        });
      }
    } catch (err) {
      console.error('[auth/callback] user upsert failed:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.redirect(`${origin}/v2/setup`);
}
