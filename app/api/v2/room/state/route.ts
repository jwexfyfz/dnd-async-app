import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { abilityModifier } from '@/lib/dice';
import { normalizeInventory } from '@/lib/v2/game-controller';
import { getSessionSituationSummary } from '@/lib/v2/situation-summary';
import { xpForNextLevel } from '@/lib/xp';
import { buildClassFeatureDetails } from '@/lib/v2/character-builder';
import type { CombatState, CombatAlertInfo, RemoteCombatInfo } from '@/types/v2-game';

const DORMANT_MS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const roomInstanceId = req.nextUrl.searchParams.get('roomInstanceId');
  const characterId = req.nextUrl.searchParams.get('characterId');
  if (!roomInstanceId) {
    return NextResponse.json({ error: 'roomInstanceId is required' }, { status: 400 });
  }
  try {
    const roomInstance = await prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      include: {
        session: { select: { id: true } },
        template: { select: { name: true, canLongRest: true } },
        poiInstances: {
          select: { id: true, currentProperties: true, template: { select: { name: true, defaultProperties: true } } },
        },
      },
    });
    if (!roomInstance) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const sessionId = roomInstance.session.id;

    const [participants, sessionPartyData, charRow, messageLogs, shortRestPools] = await Promise.all([
      prisma.roomParticipant.findMany({
        where: { roomInstanceId, isActive: true },
        include: { character: { select: { id: true, name: true } } },
      }),
      prisma.roomParticipant.findMany({
        where: { roomInstance: { sessionId }, isActive: true },
        include: {
          character: {
            select: {
              id: true, name: true, characterClass: true, currentHp: true, maxHp: true, isDead: true,
              level: true, xp: true, inventory: true,
              baseStrength: true, baseDexterity: true, baseConstitution: true,
              baseIntelligence: true, baseWisdom: true, baseCharisma: true,
              skillsModifiers: true, skillProficiencies: true,
              featuresUnlocked: true,
              resourceStates: { select: { poolKey: true, current: true } },
              user: { select: { avatarUrl: true, lastSeenAt: true } },
            },
          },
          roomInstance: { select: { id: true, gameState: true, combatState: true, template: { select: { name: true } } } },
        },
        orderBy: { lastActiveAt: 'desc' },
      }),
      characterId ? prisma.character.findUnique({
        where: { id: characterId },
        select: {
          name: true, inventory: true, currentHp: true, maxHp: true, level: true, xp: true, characterClass: true,
          baseStrength: true, baseDexterity: true, baseConstitution: true, baseIntelligence: true,
          baseWisdom: true, baseCharisma: true, skillsModifiers: true, skillProficiencies: true, isHiding: true,
          pendingChoicesQueue: true, subclass: true, critThreshold: true, featuresUnlocked: true,
          resourceStates: { select: { poolKey: true, current: true } },
        },
      }) : Promise.resolve(null),
      prisma.messageLog.findMany({
        where: { roomInstanceId, isMechanicalEvent: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true,
          characterId: true,
          character: { select: { name: true, characterClass: true, user: { select: { avatarUrl: true } } } },
        },
      }),
      prisma.featureResourcePool.findMany({
        where: { resetOn: 'SHORT_REST' },
        select: { poolKey: true, maxByLevel: true },
      }),
    ]);

    const poiIndex: Record<string, string> = {};
    const poiStates: Record<string, { examined: boolean; interacted: boolean; unlocked: boolean }> = {};
    const uiLayoutAnchors: Record<string, unknown[]> = { open_space: [] };

    for (const poi of roomInstance.poiInstances) {
      const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
      const poiType = defaultProps.poi_type as string | undefined;
      if (poiType === 'open_space') { uiLayoutAnchors[poi.id] = []; continue; }
      poiIndex[poi.id] = poi.template.name;
      uiLayoutAnchors[poi.id] = [];
      const props = (poi.currentProperties as Record<string, unknown>) ?? {};
      poiStates[poi.id] = {
        examined: props.examined === true,
        interacted: props.interacted === true,
        unlocked: props.unlocked === true,
      };
    }

    for (const p of participants) {
      const cs = p.combatState as { proximity_target_id?: string; stance?: string };
      const ref = { entityId: p.characterId, entityType: 'character', name: p.character.name, stance: cs.stance ?? null };
      if (cs.proximity_target_id && uiLayoutAnchors[cs.proximity_target_id]) {
        (uiLayoutAnchors[cs.proximity_target_id] as typeof ref[]).push(ref);
      } else {
        (uiLayoutAnchors.open_space as typeof ref[]).push(ref);
      }
    }

    let characterProximityPoi: { id: string; name: string } | null = null;
    if (characterId) {
      const selfParticipant = participants.find(p => p.characterId === characterId);
      const cs = selfParticipant?.combatState as { proximity_target_id?: string } | null;
      if (cs?.proximity_target_id && poiIndex[cs.proximity_target_id]) {
        characterProximityPoi = { id: cs.proximity_target_id, name: poiIndex[cs.proximity_target_id] };
      }
    }

    // Batch-build classFeatureDetails for character + all party members
    const allFeatureIds = new Set<string>();
    if (charRow) {
      for (const id of (charRow.featuresUnlocked ?? []) as string[]) allFeatureIds.add(id);
    }
    for (const rp of sessionPartyData) {
      for (const id of (rp.character.featuresUnlocked ?? []) as string[]) allFeatureIds.add(id);
    }
    const allFeatureDetails = await buildClassFeatureDetails([...allFeatureIds]);
    const featureDetailMap = new Map(allFeatureDetails.map(f => [f.id, f]));

    function featureDetailsForIds(ids: string[]): import('@/types/v2-game').CharacterStats['classFeatureDetails'] {
      return ids.map(id => featureDetailMap.get(id)).filter((f): f is NonNullable<typeof f> => f != null) as import('@/types/v2-game').CharacterStats['classFeatureDetails'];
    }

    let characterStats = null;
    let characterInventory = null;
    if (charRow) {
      const inv = normalizeInventory(charRow.inventory);
      characterInventory = inv;
      const dexMod = abilityModifier(charRow.baseDexterity);
      const strMod = abilityModifier(charRow.baseStrength);
      const profBonus = charRow.level >= 5 ? 3 : 2;
      const armorBonus = Object.values(inv.equipped)
        .filter((i): i is NonNullable<typeof i> => i != null)
        .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);

      let canShortRest = false;
      for (const pool of shortRestPools) {
        const state = (charRow.resourceStates ?? []).find(s => s.poolKey === pool.poolKey);
        if (!state) continue;
        const maxByLevel = pool.maxByLevel as Record<string, number>;
        let max = 0;
        for (let l = 1; l <= charRow.level; l++) {
          if (maxByLevel[String(l)] !== undefined) max = maxByLevel[String(l)];
        }
        if (state.current < max) { canShortRest = true; break; }
      }

      const charFeatureIds = (charRow.featuresUnlocked ?? []) as string[];
      characterStats = {
        name: charRow.name,
        currentHp: charRow.currentHp, maxHp: charRow.maxHp,
        ac: 10 + dexMod + armorBonus,
        level: charRow.level, xp: charRow.xp ?? 0, characterClass: charRow.characterClass,
        attackBonus: strMod + profBonus, initiativeMod: dexMod,
        baseStrength: charRow.baseStrength, baseDexterity: charRow.baseDexterity,
        baseConstitution: charRow.baseConstitution, baseIntelligence: charRow.baseIntelligence,
        baseWisdom: charRow.baseWisdom, baseCharisma: charRow.baseCharisma,
        skillsModifiers: (charRow.skillsModifiers as Record<string, number>) ?? {},
        skillProficiencies: charRow.skillProficiencies ?? [],
        isHiding: charRow.isHiding,
        pendingChoicesQueue: (charRow.pendingChoicesQueue ?? []) as unknown as import('@/types/v2-game').PendingLevelUpChoice[],
        subclass: charRow.subclass ?? null,
        critThreshold: charRow.critThreshold ?? 20,
        featuresUnlocked: charRow.featuresUnlocked ?? [],
        resourceStates: charRow.resourceStates ?? [],
        canShortRest,
        classFeatureDetails: featureDetailsForIds(charFeatureIds),
      };
    }

    // Session-wide partyMembers (deduped, full PartyMemberInfo)
    const seenIds = new Set<string>();
    const partyMembers = [];
    for (const rp of sessionPartyData) {
      if (seenIds.has(rp.character.id)) continue;
      seenIds.add(rp.character.id);
      const c = rp.character;
      const memberDexMod = abilityModifier(c.baseDexterity);
      const memberStrMod = abilityModifier(c.baseStrength);
      const memberProfBonus = c.level >= 5 ? 3 : 2;
      const memberInv = normalizeInventory(c.inventory);
      const memberArmorBonus = Object.values(memberInv.equipped)
        .filter((i): i is NonNullable<typeof i> => i != null)
        .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);
      const memberFeatureIds = (c.featuresUnlocked ?? []) as string[];
      partyMembers.push({
        characterId: c.id,
        characterName: c.name,
        characterClass: c.characterClass,
        avatarUrl: c.user.avatarUrl,
        currentHp: c.currentHp,
        maxHp: c.maxHp,
        isDead: c.isDead,
        isDormant: Date.now() - rp.lastActiveAt.getTime() > DORMANT_MS,
        isInSameRoom: rp.roomInstance.id === roomInstanceId,
        currentRoom: rp.roomInstance.template.name,
        lastSeenAt: c.user.lastSeenAt,
        level: c.level,
        ac: 10 + memberDexMod + memberArmorBonus,
        attackBonus: memberStrMod + memberProfBonus,
        initiativeMod: memberDexMod,
        baseStrength: c.baseStrength,
        baseDexterity: c.baseDexterity,
        baseConstitution: c.baseConstitution,
        baseIntelligence: c.baseIntelligence,
        baseWisdom: c.baseWisdom,
        baseCharisma: c.baseCharisma,
        skillsModifiers: (c.skillsModifiers as Record<string, number>) ?? {},
        skillProficiencies: c.skillProficiencies ?? [],
        xp: c.xp ?? 0,
        xpToNextLevel: xpForNextLevel(c.level) !== null ? (xpForNextLevel(c.level)! - (c.xp ?? 0)) : null,
        nextFeature: null,
        resourceStates: (c.resourceStates ?? []) as Array<{ poolKey: string; current: number }>,
        classFeatureDetails: featureDetailsForIds(memberFeatureIds),
      });
    }

    // Recent narrative (chronological) with author info
    const currentNarrative = messageLogs.reverse().map(n => ({
      id: n.id,
      text: n.text,
      isMechanicalEvent: n.isMechanicalEvent,
      mechanicalSummary: n.mechanicalSummary,
      createdAt: n.createdAt,
      authorCharacterId: n.characterId ?? null,
      authorCharacterClass: n.character?.characterClass ?? null,
      authorName: n.character?.name ?? null,
      authorAvatarUrl: null as null, // always use class sprite, never profile photo
    }));

    const situationSummary = roomInstance.gameState !== 'combat'
      ? await getSessionSituationSummary(sessionId)
      : null;

    // combatAlert: session has active combat and this character is NOT enrolled
    let combatAlert: CombatAlertInfo | null = null;
    if (characterId) {
      for (const rp of sessionPartyData) {
        const ri = rp.roomInstance as { id: string; gameState: string; combatState: unknown; template: { name: string } };
        if (ri.gameState !== 'combat' || !ri.combatState) continue;
        const cs = ri.combatState as CombatState;
        if (cs.initiativeOrder.some(e => e.id === characterId)) continue;
        combatAlert = {
          roomName: ri.template.name,
          fightingCharacters: cs.initiativeOrder.filter(e => e.type === 'character').map(e => e.name),
          round: cs.round,
        };
        break;
      }
    }

    // remoteCombat: character is enrolled in another room's combat as a remote participant
    // (e.g. LoS auto-enroll) while physically remaining here.
    let remoteCombat: RemoteCombatInfo | null = null;
    if (characterId) {
      for (const rp of sessionPartyData) {
        const ri = rp.roomInstance as { id: string; gameState: string; combatState: unknown; template: { name: string } };
        if (ri.id === roomInstanceId || ri.gameState !== 'combat' || !ri.combatState) continue;
        const cs = ri.combatState as CombatState;
        const entry = cs.initiativeOrder.find(e => e.id === characterId);
        if (!entry) continue;
        remoteCombat = {
          roomInstanceId: ri.id,
          roomName: ri.template.name,
          combatState: charRow
            ? { ...cs, initiativeOrder: cs.initiativeOrder.map(e => e.id === characterId ? { ...e, hp: charRow.currentHp } : e) }
            : cs,
        };
        break;
      }
    }

    // Self's hp in initiativeOrder can lag character.currentHp — e.g. enemy/opportunity
    // attack damage updates currentHp but not the persisted combatState entry. Override
    // with the authoritative DB value, matching lib/v2/view-state.ts's assembleViewState.
    const rawCombatState = roomInstance.combatState as unknown as CombatState | null;
    const resolvedCombatState = (rawCombatState && charRow)
      ? {
          ...rawCombatState,
          initiativeOrder: rawCombatState.initiativeOrder.map(e =>
            e.id === characterId ? { ...e, hp: charRow.currentHp } : e
          ),
        }
      : rawCombatState;

    return NextResponse.json({
      activeState: roomInstance.gameState,
      gameState: roomInstance.gameState,
      canLongRest: (roomInstance.template as { canLongRest?: boolean }).canLongRest ?? false,
      combatState: resolvedCombatState ?? null,
      combatAlert,
      remoteCombat,
      sessionId,
      roomName: roomInstance.template.name,
      poiIndex,
      poiStates,
      uiLayoutAnchors,
      characterStats,
      characterInventory,
      characterProximityPoi,
      partyMembers,
      currentNarrative,
      situationSummary,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}
