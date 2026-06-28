import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { HIT_DIE_BY_CLASS } from '@/lib/leveling';
import { maxHpAtLevel } from '@/lib/leveling';
import { CLASS_SKILL_POOL, SKILL_PICK_COUNT } from '@/lib/skills';
import { getGameSituationSummary, getSessionSituationSummary } from '@/lib/v2/situation-summary';
import { XP_THRESHOLDS } from '@/lib/xp';
import type { PendingChoice } from '@/types/v2-game';
import { STARTING_EQUIPMENT } from '@/lib/v2/starting-equipment';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rawChars = await prisma.character.findMany({
      where: { userId: user.id },
      select: {
        id: true, name: true, characterClass: true, level: true, currentHp: true, maxHp: true,
        xp: true, isDead: true, pendingChoicesQueue: true,
        baseStrength: true, baseDexterity: true, baseConstitution: true,
        baseIntelligence: true, baseWisdom: true, baseCharisma: true,
        games: {
          where: { status: { not: 'COMPLETED' } },
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: {
            id: true, phase: true, gameState: true, currentTurnCharacterId: true,
            narrativeHistory: true, worldState: true,
            story: { select: { title: true } },
            currentAct: { select: { order: true, title: true } },
            currentScene: { select: { title: true } },
            partyMembers: {
              select: {
                characterId: true,
                character: { select: { id: true, name: true, characterClass: true, currentHp: true, maxHp: true } },
              },
            },
          },
        },
        partyMemberships: {
          where: { game: { status: { not: 'COMPLETED' } } },
          orderBy: { joinedAt: 'desc' },
          take: 1,
          select: {
            game: {
              select: {
                id: true, phase: true, gameState: true, currentTurnCharacterId: true,
                narrativeHistory: true, worldState: true,
                story: { select: { title: true } },
                currentAct: { select: { order: true, title: true } },
                currentScene: { select: { title: true } },
                partyMembers: {
                  select: {
                    characterId: true,
                    character: { select: { id: true, name: true, characterClass: true, currentHp: true, maxHp: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    // Batch-fetch active GameSessions for all characters in one query
    const characterIds = rawChars.map(c => c.id);
    const sessionRows = characterIds.length > 0
      ? await prisma.gameSession.findMany({
          where: {
            gameState: { not: 'completed' },
            roomInstances: { some: { participants: { some: { characterId: { in: characterIds } } } } },
          },
          select: {
            id: true,
            gameState: true,
            dungeonTemplate: { select: { name: true } },
            roomInstances: {
              orderBy: { inGameTimestamp: 'desc' },
              select: {
                id: true,
                gameState: true,
                combatState: true,
                template: { select: { name: true } },
                participants: {
                  select: {
                    characterId: true,
                    lastActiveAt: true,
                    character: { select: { id: true, name: true, characterClass: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const characters = await Promise.all(rawChars.map(async c => {
      const session = sessionRows.find(s =>
        s.roomInstances.some(ri => ri.participants.some(p => p.characterId === c.id))
      ) ?? null;

      const rawGame = c.games[0] ?? c.partyMemberships[0]?.game ?? null;
      const isGameActive = rawGame && rawGame.phase !== 'LOBBY' && rawGame.gameState !== 'lobby';
      const isSessionActive = session && session.gameState !== 'completed' && session.gameState !== 'lobby';

      const situationSummary = isGameActive && rawGame
        ? await getGameSituationSummary(rawGame)
        : isSessionActive && session
          ? await getSessionSituationSummary(session.id)
          : null;

      // Strip narrativeHistory + worldState from the returned game object (not needed by UI)
      const activeGame = rawGame ? (() => {
        const { narrativeHistory: _nh, worldState: _ws, ...rest } = rawGame as typeof rawGame & { narrativeHistory: string[]; worldState: unknown };
        return rest;
      })() : null;

      return {
        id: c.id, name: c.name, characterClass: c.characterClass,
        level: c.level, currentHp: c.currentHp, maxHp: c.maxHp, xp: c.xp, isDead: c.isDead,
        hasPendingChoice: Array.isArray(c.pendingChoicesQueue) && (c.pendingChoicesQueue as unknown[]).length > 0,
        baseStrength: c.baseStrength, baseDexterity: c.baseDexterity, baseConstitution: c.baseConstitution,
        baseIntelligence: c.baseIntelligence, baseWisdom: c.baseWisdom, baseCharisma: c.baseCharisma,
        activeGame,
        situationSummary,
        activeSession: session ? (() => {
          const seen = new Set<string>();
          const partyMembers: { characterId: string; name: string; characterClass: string }[] = [];
          for (const ri of session.roomInstances) {
            for (const p of ri.participants) {
              if (!seen.has(p.characterId)) {
                seen.add(p.characterId);
                partyMembers.push({ characterId: p.characterId, name: p.character.name, characterClass: p.character.characterClass });
              }
            }
          }
          // Use the room where THIS character actually has a participant record (not roomInstances[0])
          const charRoom = session.roomInstances.find(ri => ri.participants.some(p => p.characterId === c.id));
          // Derive combat enrollment from active combat rooms' initiativeOrder JSON
          const activeCombatRoom = session.roomInstances.find(ri => ri.gameState === 'combat' && ri.combatState) ?? null;
          const isEnrolledInCombat = activeCombatRoom
            ? ((activeCombatRoom.combatState as { initiativeOrder?: Array<{ id: string }> } | null)?.initiativeOrder?.some(e => e.id === c.id) ?? false)
            : false;
          const activeCombatRoomName = activeCombatRoom?.template.name ?? null;
          return {
            id: session.id,
            gameState: session.gameState,
            roomGameState: charRoom?.gameState ?? session.roomInstances[0]?.gameState ?? 'exploration',
            dungeonName: session.dungeonTemplate?.name ?? 'Unknown Dungeon',
            currentRoomName: charRoom?.template.name ?? null,
            partyMembers,
            isEnrolledInCombat,
            activeCombatRoomName,
          };
        })() : null,
      };
    }));
    return NextResponse.json({ characters });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch characters' }, { status: 500 });
  }
}

// ASI levels per class (mirrors xp-helpers.ts)
const ASI_LEVELS: Record<string, number[]> = {
  Fighter: [4, 6, 8, 12, 14, 16, 19],
  Rogue:   [4, 8, 10, 12, 16, 19],
  default: [4, 8, 12, 16, 19],
};
const SUBCLASS_LEVEL: Record<string, number> = {
  Cleric: 1, Sorcerer: 1, Warlock: 1, Wizard: 2, Druid: 2,
};
function subclassLevelForClass(cls: string) { return SUBCLASS_LEVEL[cls] ?? 3; }
function asiLevelsForClass(cls: string) { return ASI_LEVELS[cls] ?? ASI_LEVELS.default; }

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, characterClass, strength, dexterity, constitution, intelligence, wisdom, charisma, skillProficiencies, subclassKey, startingLevel, predecessorCharacterId } = body;
  const L1_SUBCLASS_CLASSES = ['Cleric', 'Sorcerer', 'Warlock'];

  if (!name?.trim()) return NextResponse.json({ error: 'Character name is required' }, { status: 400 });
  if (!characterClass || !HIT_DIE_BY_CLASS[characterClass]) {
    return NextResponse.json({ error: 'Invalid character class' }, { status: 400 });
  }

  const requiredCount = SKILL_PICK_COUNT[characterClass] ?? 0;
  if (!Array.isArray(skillProficiencies) || skillProficiencies.length !== requiredCount) {
    return NextResponse.json({ error: `Choose exactly ${requiredCount} skills for ${characterClass}` }, { status: 400 });
  }
  const allowedSkills = CLASS_SKILL_POOL[characterClass] ?? [];
  if (!skillProficiencies.every((s: string) => allowedSkills.includes(s))) {
    return NextResponse.json({ error: 'One or more selected skills are invalid for this class' }, { status: 400 });
  }

  // Determine target level
  let targetLevel = 1;
  if (typeof startingLevel === 'number' && startingLevel >= 1 && startingLevel <= 20) {
    targetLevel = startingLevel;
  } else if (startingLevel !== undefined) {
    return NextResponse.json({ error: 'startingLevel must be between 1 and 20' }, { status: 400 });
  }

  // Validate predecessor if provided
  if (predecessorCharacterId) {
    const predecessor = await prisma.character.findUnique({
      where: { id: predecessorCharacterId },
      select: { userId: true, isDead: true, level: true },
    });
    if (!predecessor || predecessor.userId !== user.id || !predecessor.isDead) {
      return NextResponse.json({ error: 'Invalid predecessor' }, { status: 403 });
    }
    if (targetLevel !== predecessor.level) {
      return NextResponse.json({ error: 'startingLevel must match fallen character level' }, { status: 400 });
    }
  }

  // Validate subclass requirement at targetLevel
  const subclassLevel = subclassLevelForClass(characterClass);
  if (targetLevel >= subclassLevel && !subclassKey && !L1_SUBCLASS_CLASSES.includes(characterClass)) {
    // For non-L1 classes at or above subclass level, subclassKey is required
    if (targetLevel >= subclassLevel) {
      return NextResponse.json({ error: `Choose a subclass for ${characterClass} at level ${targetLevel}` }, { status: 400 });
    }
  }
  if (L1_SUBCLASS_CLASSES.includes(characterClass) && !subclassKey) {
    return NextResponse.json({ error: `${characterClass} requires a subclass at level 1` }, { status: 400 });
  }

  const computedMaxHp = targetLevel === 1
    ? Math.max(1, HIT_DIE_BY_CLASS[characterClass].die + Math.floor((constitution - 10) / 2))
    : maxHpAtLevel(characterClass, constitution, targetLevel);

  const xp = XP_THRESHOLDS[targetLevel - 1] ?? 0;

  // Build the pending choices queue for levels 2..targetLevel
  const pendingQueue: PendingChoice[] = [];
  const asiLevels = asiLevelsForClass(characterClass);
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    if (asiLevels.includes(lvl)) {
      pendingQueue.push({ type: 'asi', level: lvl });
    }
    // Subclass at its unlock level (only if not provided at creation)
    if (lvl === subclassLevel && !subclassKey) {
      pendingQueue.push({ type: 'subclass', level: lvl });
    }
  }

  try {
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

    const character = await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        baseStrength: strength,
        baseDexterity: dexterity,
        baseConstitution: constitution,
        baseIntelligence: intelligence,
        baseWisdom: wisdom,
        baseCharisma: charisma,
        maxHp: computedMaxHp,
        currentHp: computedMaxHp,
        level: targetLevel,
        xp,
        skillProficiencies,
        pendingChoicesQueue: pendingQueue,
        ...(subclassKey ? { subclass: subclassKey } : {}),
        inventory: (STARTING_EQUIPMENT[characterClass] ?? { bag: [], equipped: {} }) as unknown as object,
      },
      select: { id: true, name: true, characterClass: true, level: true, maxHp: true },
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create character' }, { status: 500 });
  }
}
