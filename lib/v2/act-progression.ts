import { prisma } from '@/lib/prisma';
import { DUNGEON_ACTS } from '@/lib/v2/act-definitions';
import type { ActMutation } from '@/lib/v2/act-definitions';
import { applyXpAward } from '@/lib/v2/xp-helpers';

// ─── Act Progression ──────────────────────────────────────────────────────────

async function applyActOnStartMutations(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
  mutations: ActMutation[],
): Promise<void> {
  for (const mutation of mutations) {
    const poiInstance = await tx.poiInstance.findFirst({
      where: { poiTemplateId: mutation.poiTemplateId, roomInstance: { sessionId } },
      select: { id: true, currentProperties: true },
    });
    if (!poiInstance) {
      console.log(`[act] mutation skip — template ${mutation.poiTemplateId} not yet instantiated`);
      continue;
    }
    await tx.poiInstance.update({
      where: { id: poiInstance.id },
      data: { currentProperties: { ...(poiInstance.currentProperties as object), ...mutation.setProps } as object },
    });
    console.log(`[act] mutation applied to poi instance ${poiInstance.id}:`, mutation.setProps);
  }
}

export async function checkAndAdvanceAct(sessionId: string): Promise<void> {
  const session = await prisma.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { storyFlags: true, currentObjective: true },
  });
  const flags = (session.storyFlags as Record<string, unknown>) ?? {};
  const currentAct = typeof flags.current_act === 'number' ? flags.current_act : 1;

  const actDef = DUNGEON_ACTS.find(a => a.act === currentAct);
  if (!actDef) return;

  const isComplete = actDef.completionFlags.some(f => flags[f] === true);
  if (!isComplete) return;

  const nextActDef = DUNGEON_ACTS.find(a => a.act === currentAct + 1);
  const milestoneXp = (actDef as { milestoneXp?: number }).milestoneXp ?? 0;
  console.log(`[act] act ${currentAct} complete → advancing to act ${currentAct + 1} (${milestoneXp} milestone XP)`);

  // Get all party members in this session for milestone XP
  const partyMembers = await prisma.roomParticipant.findMany({
    where: { roomInstance: { sessionId } },
    select: {
      roomInstanceId: true,
      character: {
        select: {
          id: true, characterClass: true, baseConstitution: true,
          xp: true, level: true, currentHp: true, maxHp: true,
          pendingChoicesQueue: true, featuresUnlocked: true,
        },
      },
    },
    distinct: ['characterId'],
  });

  await prisma.$transaction(async tx => {
    await applyActOnStartMutations(tx, sessionId, nextActDef?.onStartMutations ?? []);

    const session2 = await tx.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { storyFlags: true },
    });
    const existingFlags = (session2.storyFlags as Record<string, unknown>) ?? {};

    await tx.gameSession.update({
      where: { id: sessionId },
      data: {
        currentObjective: nextActDef?.openingObjective ?? session.currentObjective,
        storyFlags: { ...existingFlags, current_act: currentAct + 1 } as object,
      },
    });

    // Award milestone XP to all party members
    if (milestoneXp > 0) {
      for (const member of partyMembers) {
        const char = member.character;
        await applyXpAward(tx, {
          ...char,
          pendingChoicesQueue: (char.pendingChoicesQueue ?? []) as unknown[],
          featuresUnlocked: char.featuresUnlocked ?? [],
        }, milestoneXp, `Act ${currentAct} complete`, member.roomInstanceId);
      }
    }
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
