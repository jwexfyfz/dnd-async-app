import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { computeStreakUpdate } from '@/lib/v2/gacha-engine';
import type { GachaPullRecord } from '@/types/v2-game';
import { MILESTONES } from '@/lib/v2/gacha-items';

// POST /api/v2/me/characters/[id]/gacha
// body: { action: 'streak' } | { action: 'milestone', milestoneId: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;
  const body = await req.json() as { action: string; milestoneId?: string };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true,
      streakDays: true,
      streakShields: true,
      lastStreakDate: true,
      pendingPulls: true,
      milestoneFlags: true,
      pullHistory: true,
      level: true,
    },
  });
  if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (body.action === 'streak') {
    const result = computeStreakUpdate({
      streakDays: character.streakDays,
      streakShields: character.streakShields,
      lastStreakDate: character.lastStreakDate,
    });

    // Also check level-based milestones while we're here
    const earnedMilestones: string[] = [];
    const existingFlags = new Set(character.milestoneFlags);

    const levelMilestones = [
      { id: 'battle_hardened', minLevel: 2 },
      { id: 'ascended', minLevel: 5 },
    ];
    for (const lm of levelMilestones) {
      if (!existingFlags.has(lm.id) && character.level >= lm.minLevel) {
        earnedMilestones.push(lm.id);
      }
    }

    // first_steps: grant if character has any pull history or previous streak activity
    if (!existingFlags.has('first_steps') && character.lastStreakDate !== null) {
      earnedMilestones.push('first_steps');
    }

    // devoted: 30-day streak
    if (!existingFlags.has('devoted') && result.streakDays >= 30) {
      earnedMilestones.push('devoted');
    }

    const newMilestoneCount = earnedMilestones.length;
    const updatedFlags = [...character.milestoneFlags, ...earnedMilestones.filter(id => !existingFlags.has(id))];

    await prisma.character.update({
      where: { id: characterId },
      data: {
        streakDays: result.streakDays,
        streakShields: result.streakShields,
        lastStreakDate: result.lastStreakDate,
        pendingPulls: { increment: result.pendingPullsAdded + newMilestoneCount },
        milestoneFlags: updatedFlags,
      },
    });

    return NextResponse.json({ ok: true, ...result, earnedMilestones });
  }

  if (body.action === 'milestone') {
    const { milestoneId } = body;
    if (!milestoneId) return NextResponse.json({ error: 'milestoneId required' }, { status: 400 });
    const valid = MILESTONES.some(m => m.id === milestoneId);
    if (!valid) return NextResponse.json({ error: 'Unknown milestone' }, { status: 400 });
    if (character.milestoneFlags.includes(milestoneId)) {
      return NextResponse.json({ ok: true, alreadyEarned: true });
    }
    await prisma.character.update({
      where: { id: characterId },
      data: {
        milestoneFlags: { push: milestoneId },
        pendingPulls: { increment: 1 },
      },
    });
    return NextResponse.json({ ok: true, earned: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// GET /api/v2/me/characters/[id]/gacha — returns current gacha state
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true,
      pendingPulls: true,
      streakDays: true,
      streakShields: true,
      lastStreakDate: true,
      lifetimePullCount: true,
      pityCount: true,
      milestoneFlags: true,
      pullHistory: true,
    },
  });
  if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const pullHistory = (character.pullHistory as unknown as GachaPullRecord[]) ?? [];

  return NextResponse.json({
    pendingPulls: character.pendingPulls,
    streakDays: character.streakDays,
    streakShields: character.streakShields,
    lastStreakDate: character.lastStreakDate,
    lifetimePullCount: character.lifetimePullCount,
    pityCount: character.pityCount,
    milestoneFlags: character.milestoneFlags,
    pullHistory: pullHistory.slice(-5),
  });
}
