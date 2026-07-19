import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { validateAsiChoices, computeConHpDelta, isAsiLocked, STAT_TO_FIELD, ALL_STATS } from '@/lib/v2/asi-helpers';
import type { AsiChoices } from '@/lib/v2/asi-helpers';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;
  const body = await req.json();
  const { type, choices, subclassKey, roomInstanceId } = body as {
    type: string;
    choices?: AsiChoices;
    subclassKey?: string;
    roomInstanceId?: string;
  };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true,
      level: true,
      currentHp: true,
      maxHp: true,
      baseStrength: true,
      baseDexterity: true,
      baseConstitution: true,
      baseIntelligence: true,
      baseWisdom: true,
      baseCharisma: true,
      pendingPulls: true,
      pendingChoicesQueue: true,
      characterClass: true,
      subclass: true,
      featuresUnlocked: true,
    },
  });

  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Not your character' }, { status: 403 });

  const queue = (character.pendingChoicesQueue as Array<{ type: string; level: number }>);
  if (queue.length === 0) return NextResponse.json({ error: 'No pending choices' }, { status: 400 });
  const resolvedChoice = queue[0];
  const newQueue = queue.slice(1);

  // ── Subclass branch ──────────────────────────────────────────────────────
  if (type === 'subclass') {
    if (resolvedChoice.type !== 'subclass') {
      return NextResponse.json({ error: `Expected choice type 'subclass', got '${resolvedChoice.type}'` }, { status: 400 });
    }
    if (!subclassKey) {
      return NextResponse.json({ error: 'subclassKey is required for subclass choice' }, { status: 400 });
    }
    if (character.subclass) {
      return NextResponse.json({ error: 'Subclass already chosen' }, { status: 400 });
    }

    const subclassRow = await prisma.subclass.findUnique({
      where: { characterClass_key: { characterClass: character.characterClass, key: subclassKey } },
    });
    if (!subclassRow) {
      return NextResponse.json({ error: `Unknown subclass '${subclassKey}' for class '${character.characterClass}'` }, { status: 400 });
    }
    if (!subclassRow.available) {
      return NextResponse.json({ error: `Subclass '${subclassKey}' is not yet available` }, { status: 400 });
    }

    // Fetch ClassFeature rows for this subclass at the resolved level
    const subclassFeatures = await prisma.classFeature.findMany({
      where: {
        characterClass: character.characterClass,
        level: resolvedChoice.level,
        subclass: subclassKey,
      },
      select: { id: true, featureType: true },
    });

    const newFeatureIds = subclassFeatures.map(f => f.id);
    const updatedFeatures = [...character.featuresUnlocked, ...newFeatureIds];

    await prisma.$transaction(async tx => {
      await tx.character.update({
        where: { id: characterId },
        data: {
          subclass: subclassKey,
          featuresUnlocked: updatedFeatures,
          pendingChoicesQueue: newQueue,
        },
      });

      // Create CharacterResourceState for any RESOURCE_POOL features
      for (const feature of subclassFeatures) {
        if (feature.featureType === 'RESOURCE_POOL' || feature.featureType === 'ACTIVE_ABILITY') {
          const pool = await tx.featureResourcePool.findUnique({
            where: { featureId: feature.id },
            select: { poolKey: true, maxByLevel: true },
          });
          if (pool) {
            const maxByLevel = pool.maxByLevel as Record<string, number>;
            let current = 0;
            for (let l = 1; l <= character.level; l++) {
              if (maxByLevel[String(l)] !== undefined) current = maxByLevel[String(l)];
            }
            await tx.characterResourceState.upsert({
              where: { characterId_poolKey: { characterId, poolKey: pool.poolKey } },
              create: { characterId, poolKey: pool.poolKey, current },
              update: { current },
            });
          }
        }
      }

      if (roomInstanceId) {
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              type: 'level_up_confirmed',
              choiceType: 'subclass',
              newLevel: resolvedChoice.level,
              subclassKey,
              subclassName: subclassRow.name,
            },
            text: `✓ ${subclassRow.name} chosen — ${subclassRow.blurb}`,
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  }

  // ── ASI branch ───────────────────────────────────────────────────────────
  if (type === 'asi') {
    if (resolvedChoice.type !== 'asi') {
      return NextResponse.json({ error: `Expected choice type 'asi', got '${resolvedChoice.type}'` }, { status: 400 });
    }

    // All ability scores are maxed (or too close to 20 to absorb 2 full points) —
    // there's nothing to spend this ASI on, so grant a gacha pull instead.
    if (isAsiLocked(character)) {
      const newPendingPulls = character.pendingPulls + 1;
      await prisma.$transaction(async tx => {
        await tx.character.update({
          where: { id: characterId },
          data: { pendingPulls: { increment: 1 }, pendingChoicesQueue: newQueue },
        });

        if (roomInstanceId) {
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: true,
              mechanicalSummary: {
                type: 'level_up_confirmed',
                choiceType: 'asi_locked',
                newLevel: resolvedChoice.level,
              },
              text: `✓ Level ${resolvedChoice.level} ASI — all ability scores maxed, your guardian angel grants an extra gift instead`,
            },
          });
        }
      });

      return NextResponse.json({ ok: true, locked: true, pendingPulls: newPendingPulls });
    }

    const validationError = validateAsiChoices({ ...character, pendingChoicesQueue: queue }, choices ?? {});
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const statUpdates: Record<string, number> = {};
    for (const stat of ALL_STATS) {
      const delta = (choices ?? {})[stat] ?? 0;
      if (delta > 0) {
        statUpdates[STAT_TO_FIELD[stat]] = { increment: delta } as unknown as number;
      }
    }

    const conDelta = (choices ?? {}).constitution ?? 0;
    const maxHpDelta = conDelta > 0 ? computeConHpDelta(character.baseConstitution, conDelta, character.level) : 0;
    const newMaxHp = character.maxHp + maxHpDelta;
    const newCurrentHp = character.currentHp === 0
      ? 0
      : Math.min(character.currentHp + maxHpDelta, newMaxHp);
    const hpUpdates = maxHpDelta !== 0 ? { maxHp: newMaxHp, currentHp: newCurrentHp } : {};

    const choiceDesc = ALL_STATS
      .filter(s => ((choices ?? {})[s] ?? 0) > 0)
      .map(s => `+${(choices ?? {})[s]} ${s}`)
      .join(', ');

    await prisma.$transaction(async tx => {
      await tx.character.update({
        where: { id: characterId },
        data: { ...statUpdates, ...hpUpdates, pendingChoicesQueue: newQueue },
      });

      if (roomInstanceId) {
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              type: 'level_up_confirmed',
              choiceType: 'asi',
              newLevel: resolvedChoice.level,
              choiceDesc,
              ...(maxHpDelta > 0 ? { maxHpDelta } : {}),
            },
            text: `✓ Level ${resolvedChoice.level} ASI confirmed — ${choiceDesc}${maxHpDelta > 0 ? ` · +${maxHpDelta} max HP` : ''}`,
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown choice type '${type}'` }, { status: 400 });
}
