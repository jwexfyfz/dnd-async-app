import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { abilityModifier, rollDice } from '@/lib/dice';
import type { ActiveAbility } from '@/types/v2-feature-mechanics';

function resolveDiceExpr(expr: string, profBonus: number): number {
  // Supports "1d10+prof", "Nd6", etc.
  const withProf = expr.replace('prof', String(profBonus));
  const match = withProf.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return 0;
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const bonus = parseInt(match[3] ?? '0', 10);
  return rollDice(count, sides).total + bonus;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;
  const { featureId, roomInstanceId } = (await req.json()) as {
    featureId: string;
    roomInstanceId?: string;
  };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true, level: true, currentHp: true, maxHp: true,
      featuresUnlocked: true, resourceStates: true, name: true,
    },
  });
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Not your character' }, { status: 403 });
  if (!character.featuresUnlocked.includes(featureId)) {
    return NextResponse.json({ error: 'Feature not unlocked for this character' }, { status: 400 });
  }

  const feature = await prisma.classFeature.findUnique({
    where: { id: featureId },
    select: { name: true, featureType: true, mechanicsJson: true, implemented: true, actionType: true },
  });
  if (!feature) return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  if (feature.featureType !== 'ACTIVE_ABILITY') {
    return NextResponse.json({ error: 'Feature is not an active ability' }, { status: 400 });
  }
  if (!feature.implemented) {
    return NextResponse.json({ error: 'This ability is not yet implemented' }, { status: 400 });
  }

  const mechanics = feature.mechanicsJson as ActiveAbility;
  const profBonus = character.level >= 5 ? 3 : 2;

  // Check and decrement resource costs
  for (const costEntry of mechanics.cost) {
    const state = character.resourceStates.find(s => s.poolKey === costEntry.poolKey);
    if (!state || state.current < costEntry.amount) {
      return NextResponse.json({ error: `Insufficient ${costEntry.poolKey} (have ${state?.current ?? 0}, need ${costEntry.amount})` }, { status: 400 });
    }
  }

  let healAmount = 0;
  if (mechanics.effect.type === 'heal_self') {
    const exprStr = String(mechanics.effect.value ?? '1');
    healAmount = resolveDiceExpr(exprStr, profBonus);
  }

  const result = await prisma.$transaction(async tx => {
    // Decrement resource pools
    for (const costEntry of mechanics.cost) {
      const state = character.resourceStates.find(s => s.poolKey === costEntry.poolKey)!;
      await tx.characterResourceState.update({
        where: { characterId_poolKey: { characterId, poolKey: costEntry.poolKey } },
        data: { current: state.current - costEntry.amount },
      });
    }

    let newHp = character.currentHp;
    if (mechanics.effect.type === 'heal_self' && healAmount > 0) {
      newHp = Math.min(character.currentHp + healAmount, character.maxHp);
      await tx.character.update({
        where: { id: characterId },
        data: { currentHp: newHp },
      });
    }

    if (roomInstanceId) {
      await tx.messageLog.create({
        data: {
          roomInstanceId,
          characterId,
          isMechanicalEvent: true,
          mechanicalSummary: {
            type: 'ability_used',
            featureName: feature.name,
            effect: mechanics.effect,
            healAmount: healAmount || undefined,
          },
          text: mechanics.effect.type === 'heal_self'
            ? `${character.name} uses ${feature.name} — recovers ${healAmount} HP (${character.currentHp} → ${newHp}).`
            : `${character.name} uses ${feature.name}.`,
        },
      });
    }

    return { newHp, healAmount };
  });

  return NextResponse.json({ ok: true, ...result });
}
