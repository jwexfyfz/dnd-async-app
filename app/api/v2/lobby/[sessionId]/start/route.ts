import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { startSession } from '@/lib/v2/session-starter';

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { sessionId } = await params;
  const { characterId } = await req.json().catch(() => ({})) as { characterId?: string };
  if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 });

  try {
    const result = await startSession(sessionId, user.id, characterId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const status = err instanceof Error && 'status' in err ? (err as { status: number }).status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to start session' }, { status });
  }
}
