import { prisma } from '@/lib/prisma';
import { computeLevel, xpForNextLevel, XP_THRESHOLDS } from '@/lib/xp';
import { maxHpAtLevel } from '@/lib/leveling';

// ─── Phase 3 XP Engine ──────────────────────────────────────────────────────

// ASI levels for each class (D&D 5e PHB).
// Most classes: 4, 8, 12, 16, 19. Fighter gets extras at 6, 14. Rogue at 10.
const ASI_LEVELS: Record<string, number[]> = {
  Fighter:     [4, 6, 8, 12, 14, 16, 19],
  Rogue:       [4, 8, 10, 12, 16, 19],
  default:     [4, 8, 12, 16, 19],
};

function asiLevelsForClass(characterClass: string): number[] {
  return ASI_LEVELS[characterClass] ?? ASI_LEVELS.default;
}

// Subclass level at character creation / first in-game choice.
const SUBCLASS_LEVEL: Record<string, number> = {
  Cleric: 1, Sorcerer: 1, Warlock: 1,
  Wizard: 2, Druid: 2,
  // All others: 3
};

function subclassLevelForClass(characterClass: string): number {
  return SUBCLASS_LEVEL[characterClass] ?? 3;
}

// Fill sparse maxByLevel gaps downward: { "1": 1, "5": 2 } at level 3 → 1.
function maxForLevel(maxByLevel: Record<string, number>, level: number): number {
  let result = 0;
  for (let l = 1; l <= level; l++) {
    if (maxByLevel[String(l)] !== undefined) {
      result = maxByLevel[String(l)];
    }
  }
  return result;
}

export function awardCombatXp(deadEnemies: { xpValue: number }[]): number {
  return deadEnemies.reduce((sum, e) => sum + (e.xpValue ?? 0), 0);
}

export interface ApplyXpResult {
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  levelsGained: number[];
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ─── Internal: apply one level's effects inside a transaction ───────────────

async function applyLevelEffects(
  tx: PrismaTx,
  character: {
    id: string;
    characterClass: string;
    baseConstitution: number;
    currentHp: number;
    pendingChoicesQueue: unknown[];
    featuresUnlocked: string[];
  },
  newLevel: number,
): Promise<{
  newMaxHp: number;
  newFeatureNames: string[];
  pendingChoiceAdded: 'asi' | 'subclass' | null;
}> {
  // Step 1-2: compute new maxHp
  const newMaxHp = maxHpAtLevel(character.characterClass, character.baseConstitution, newLevel);

  // Step 4: look up ClassProgression for this level
  const progression = await tx.classProgression.findUnique({
    where: { characterClass_level: { characterClass: character.characterClass, level: newLevel } },
    select: { featuresUnlocked: true },
  });

  const featureNames: string[] = progression?.featuresUnlocked ?? [];

  // Look up ClassFeature IDs for these feature names
  let newFeatureIds: string[] = [];
  if (featureNames.length > 0) {
    const features = await tx.classFeature.findMany({
      where: { characterClass: character.characterClass, name: { in: featureNames } },
      select: { id: true, name: true, featureType: true },
    });
    newFeatureIds = features.map(f => f.id);

    // Step 6: create CharacterResourceState for RESOURCE_POOL features
    for (const feature of features) {
      if (feature.featureType === 'RESOURCE_POOL') {
        const pool = await tx.featureResourcePool.findUnique({
          where: { featureId: feature.id },
          select: { poolKey: true, maxByLevel: true },
        });
        if (pool) {
          const current = maxForLevel(pool.maxByLevel as Record<string, number>, newLevel);
          await tx.characterResourceState.upsert({
            where: { characterId_poolKey: { characterId: character.id, poolKey: pool.poolKey } },
            create: { characterId: character.id, poolKey: pool.poolKey, current },
            update: { current },
          });
        }
      }
    }
  }

  // Step 5: determine if this level adds a pending choice
  let pendingChoiceAdded: 'asi' | 'subclass' | null = null;
  const asiLevels = asiLevelsForClass(character.characterClass);
  const subclassLevel = subclassLevelForClass(character.characterClass);

  if (subclassLevel === newLevel && !character.featuresUnlocked.some(id => id.startsWith('subclass:'))) {
    pendingChoiceAdded = 'subclass';
  } else if (asiLevels.includes(newLevel)) {
    pendingChoiceAdded = 'asi';
  }

  return { newMaxHp, newFeatureNames: featureNames, pendingChoiceAdded };
}

// ─── applyXpAward ────────────────────────────────────────────────────────────

export async function applyXpAward(
  tx: PrismaTx,
  character: {
    id: string;
    characterClass: string;
    baseConstitution: number;
    xp: number;
    level: number;
    currentHp: number;
    maxHp: number;
    pendingChoicesQueue: unknown[];
    featuresUnlocked: string[];
  },
  xpAmount: number,
  sourceText: string,
  roomInstanceId: string,
): Promise<ApplyXpResult> {
  if (xpAmount <= 0) {
    return { newXp: character.xp, newLevel: character.level, leveledUp: false, levelsGained: [] };
  }

  const newXp = Math.min(character.xp + xpAmount, XP_THRESHOLDS[XP_THRESHOLDS.length - 1]);
  const oldLevel = character.level;
  const newLevel = computeLevel(newXp);
  const levelsGained: number[] = [];

  // Write xp_gained MessageLog entry
  await tx.messageLog.create({
    data: {
      roomInstanceId,
      characterId: character.id,
      isMechanicalEvent: true,
      mechanicalSummary: { type: 'xp_gained', amount: xpAmount, source: sourceText, characterId: character.id },
      text: `+${xpAmount} XP — ${sourceText}`,
    },
  });

  if (newLevel === oldLevel) {
    // No level-up, just update XP
    await tx.character.update({ where: { id: character.id }, data: { xp: newXp } });
    return { newXp, newLevel, leveledUp: false, levelsGained: [] };
  }

  // Process each intermediate level in ascending order (load-bearing invariant)
  const levels = [];
  for (let l = oldLevel + 1; l <= newLevel; l++) levels.push(l);

  let currentPendingQueue = [...character.pendingChoicesQueue] as Array<{ type: string; level: number }>;
  let currentFeatures = [...character.featuresUnlocked];
  let finalMaxHp = character.maxHp;

  for (const lvl of levels) {
    const { newMaxHp, newFeatureNames, pendingChoiceAdded } = await applyLevelEffects(
      tx, { ...character, pendingChoicesQueue: currentPendingQueue, featuresUnlocked: currentFeatures }, lvl,
    );

    finalMaxHp = newMaxHp;

    // Append feature IDs for new level
    const features = await tx.classFeature.findMany({
      where: { characterClass: character.characterClass, name: { in: newFeatureNames } },
      select: { id: true },
    });
    currentFeatures = [...currentFeatures, ...features.map(f => f.id)];

    // Queue pending choice
    if (pendingChoiceAdded) {
      currentPendingQueue.push({ type: pendingChoiceAdded, level: lvl });
    }

    levelsGained.push(lvl);

    // Write level_up MessageLog
    const oldHp = lvl === oldLevel + 1 ? character.maxHp : finalMaxHp;
    await tx.messageLog.create({
      data: {
        roomInstanceId,
        characterId: character.id,
        isMechanicalEvent: true,
        mechanicalSummary: {
          type: 'level_up',
          newLevel: lvl,
          oldHp,
          newHp: newMaxHp,
          newFeatures: newFeatureNames,
          characterId: character.id,
          pendingChoice: pendingChoiceAdded,
        },
        text: `⬆ Level ${lvl} reached! HP ${oldHp} → ${newMaxHp}${newFeatureNames.length ? ` · ${newFeatureNames.join(' · ')}` : ''}${pendingChoiceAdded ? ` · Choice pending` : ''}`,
      },
    });
  }

  // Sort pending queue ascending by level (load-bearing invariant)
  currentPendingQueue.sort((a, b) => a.level - b.level);

  // Apply all changes in one update
  const newCurrentHp = character.currentHp === 0 ? 0 : finalMaxHp;

  await tx.character.update({
    where: { id: character.id },
    data: {
      xp: newXp,
      level: newLevel,
      maxHp: finalMaxHp,
      currentHp: newCurrentHp,
      pendingChoicesQueue: currentPendingQueue,
      featuresUnlocked: currentFeatures,
    },
  });

  return { newXp, newLevel, leveledUp: true, levelsGained };
}
