import { prisma } from '@/lib/prisma';
import { abilityModifier } from '@/lib/dice';
import { normalizeInventory, extractPoiItems } from '@/lib/v2/item-helpers';
import { extractExplorationFlags } from '@/lib/v2/poi-context-helpers';
import { isPoiVisibleThroughExit } from '@/lib/v2/room-geometry';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';
import type { ViewStatePayload, ItemDefinition, UiLayoutAnchors, EntityRef, AdjacentRoomPreview, CombatAlertInfo, CombatState, RemoteCombatInfo, PendingLevelUpChoice, MechanicalSummaryType, NextFeature } from '@/types/v2-game';
import { resolveEffectiveVisibility } from '@/lib/v2/room-geometry';
import { xpForNextLevel } from '@/lib/xp';
import { buildClassFeatureDetails } from '@/lib/v2/character-builder';

export async function prefetchViewStateData(
  roomInstanceId: string,
  characterId: string,
  sessionId: string,
) {
  const [recentNarrative, participants, charRow, poiInstances, roomRow, sessionPartyData, sessionCombatRooms] = await Promise.all([
    prisma.messageLog.findMany({
      where: { roomInstanceId, isMechanicalEvent: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true,
        characterId: true,
        character: { select: { name: true, characterClass: true } },
      },
    }),
    prisma.roomParticipant.findMany({
      where: { roomInstanceId },
      include: { character: { select: { id: true, name: true } } },
    }),
    prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: {
        name: true, inventory: true, currentHp: true, maxHp: true, level: true, xp: true, characterClass: true,
        baseStrength: true, baseDexterity: true, baseConstitution: true, baseIntelligence: true,
        baseWisdom: true, baseCharisma: true, skillsModifiers: true, skillProficiencies: true,
        isHiding: true, pendingChoicesQueue: true, subclass: true, critThreshold: true, featuresUnlocked: true,
        resourceStates: { select: { poolKey: true, current: true } },
      },
    }),
    prisma.poiInstance.findMany({
      where: { roomInstanceId },
      include: { template: true },
    }),
    prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      select: { gameState: true, combatState: true },
    }),
    prisma.roomParticipant.findMany({
      where: { roomInstance: { sessionId } },
      include: {
        character: {
          select: {
            id: true, name: true, characterClass: true, currentHp: true, maxHp: true, isDead: true,
            level: true, xp: true, inventory: true,
            baseStrength: true, baseDexterity: true, baseConstitution: true,
            baseIntelligence: true, baseWisdom: true, baseCharisma: true,
            skillsModifiers: true, skillProficiencies: true,
            user: { select: { avatarUrl: true, lastSeenAt: true } },
          },
        },
        roomInstance: { select: { id: true, template: { select: { name: true } } } },
      },
      orderBy: { lastActiveAt: 'desc' },
    }),
    prisma.roomInstance.findMany({
      where: { sessionId, gameState: 'combat' },
      select: { id: true, combatState: true, template: { select: { name: true } } },
    }),
  ]);
  const allClasses = [...new Set([
    charRow.characterClass,
    ...sessionPartyData.map(rp => rp.character.characterClass),
  ])];
  const classProgressionRows = await prisma.classProgression.findMany({
    where: { characterClass: { in: allClasses } },
    orderBy: { level: 'asc' },
    select: { characterClass: true, level: true, featuresUnlocked: true },
  });

  const featureIds = (charRow.featuresUnlocked as string[]) ?? [];
  const classFeatureDetails = await buildClassFeatureDetails(featureIds);

  return { recentNarrative, participants, charRow, poiInstances, roomRow, sessionPartyData, sessionCombatRooms, classProgressionRows, classFeatureDetails };
}

export type ViewStateRawData = Awaited<ReturnType<typeof prefetchViewStateData>>;

function getNextFeature(
  rows: { characterClass: string; level: number; featuresUnlocked: string[] }[],
  characterClass: string,
  currentLevel: number,
): NextFeature | null {
  const next = rows.find(r => r.characterClass === characterClass && r.level > currentLevel && r.featuresUnlocked.length > 0);
  return next ? { name: next.featuresUnlocked[0], level: next.level } : null;
}

export async function assembleViewState(
  raw: ViewStateRawData,
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  injectedNarrative?: string,
): Promise<ViewStatePayload> {
  const { recentNarrative, participants, charRow, poiInstances, roomRow, sessionPartyData, classProgressionRows, classFeatureDetails } = raw;

  const characterInventory = normalizeInventory(charRow.inventory);
  const poiIndex: Record<string, string> = {};
  const poiStates: Record<string, { examined: boolean; interacted: boolean; unlocked: boolean; items: ItemDefinition[] }> = {};
  const uiLayoutAnchors: UiLayoutAnchors = { open_space: [] };
  let openSpaceItems: ItemDefinition[] = [];

  for (const poi of poiInstances) {
    const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
    const currentProps = poi.currentProperties as Record<string, unknown>;
    const poiType = defaultProps.poi_type as string | undefined;
    const visibility = resolveEffectiveVisibility(defaultProps, currentProps);

    const isOpenSpace = poiType === 'open_space';
    const isVisible = isOpenSpace || visibility === 'always';

    if (!isVisible) continue;

    const { items: templateItems, floorItems } = extractPoiItems(defaultProps, currentProps);
    const allItems = [...templateItems, ...floorItems];

    if (isOpenSpace) {
      openSpaceItems = allItems;
      uiLayoutAnchors[poi.id] = [];
      continue;
    }

    poiIndex[poi.id] = poi.template.name;
    uiLayoutAnchors[poi.id] = [];
    poiStates[poi.id] = {
      examined: currentProps.examined === true,
      interacted: currentProps.interacted === true,
      unlocked: currentProps.unlocked === true,
      items: allItems,
    };
    console.log(`[viewstate] poi "${poi.template.name}" (${poi.id}) items:[${allItems.map(i=>i.id).join(',')||'none'}]`);
  }

  for (const participant of participants) {
    const combatState = participant.combatState as { proximity_target_id?: string; stance?: string };
    const ref: EntityRef = {
      entityId: participant.characterId,
      entityType: 'character',
      name: participant.character.name,
      stance: combatState.stance ?? null,
    };
    const targetAnchor = combatState.proximity_target_id;
    if (targetAnchor && uiLayoutAnchors[targetAnchor]) {
      (uiLayoutAnchors[targetAnchor] as EntityRef[]).push(ref);
    } else {
      uiLayoutAnchors.open_space.push(ref);
    }
  }

  // Adjacent room previews via exit POIs
  const adjacentRoomPreviews: Record<string, AdjacentRoomPreview> = {};

  const exitPois = poiInstances.filter(poi => {
    const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
    return !!(defaultProps['enter'] as Record<string, unknown> | undefined)?.target_room_template_id;
  });

  for (const exitPoi of exitPois) {
    const defaultProps = exitPoi.template.defaultProperties as Record<string, unknown>;
    const currentProps = exitPoi.currentProperties as Record<string, unknown>;
    const enterVerb = defaultProps['enter'] as Record<string, unknown>;
    const targetRoomTemplateId = enterVerb.target_room_template_id as string;

    const effectivePeek = computeEffectivePeek(
      (defaultProps.peek_visibility as string) ?? 'none',
      computeIsLockable(defaultProps.locked_by) && currentProps.unlocked !== true,
      currentProps.interacted === true,
      currentProps.destroyed === true,
    );

    if (effectivePeek === 'none') continue;

    const targetRoomInstance = await prisma.roomInstance.findFirst({
      where: { sessionId, roomTemplateId: targetRoomTemplateId },
      include: {
        template: { select: { name: true } },
        poiInstances: { include: { template: true } },
        participants: { include: { character: { select: { id: true, name: true } } } },
      },
    });

    if (!targetRoomInstance) continue;

    const previewItems: ItemDefinition[] = [];
    for (const poi of targetRoomInstance.poiInstances) {
      const pDefault = poi.template.defaultProperties as Record<string, unknown>;
      const { items: tItems, floorItems: fItems } = extractPoiItems(pDefault, poi.currentProperties);

      const candidateItems = effectivePeek === 'obvious_only'
        ? [...tItems.filter(i => i.obvious), ...fItems.filter(i => i.obvious)]
        : [...tItems, ...fItems];

      previewItems.push(...candidateItems);
    }

    const previewCharacters: EntityRef[] = targetRoomInstance.participants.map(p => ({
      entityId: p.characterId,
      entityType: 'character' as const,
      name: p.character.name,
      stance: ((p.combatState as Record<string, unknown>)?.stance as string) ?? null,
    }));

    console.log(`[items] peek: exit "${exitPoi.template.name}" → "${targetRoomInstance.template.name}" — ${previewItems.length} item(s) visible (peek: ${effectivePeek})`);

    adjacentRoomPreviews[exitPoi.id] = {
      roomName: targetRoomInstance.template.name,
      items: previewItems,
      characters: previewCharacters,
    };
  }

  const orderedNarrative = recentNarrative.reverse().map(n => ({
    id: n.id,
    text: n.text,
    isMechanicalEvent: n.isMechanicalEvent,
    mechanicalSummary: n.mechanicalSummary as unknown as MechanicalSummaryType | null,
    createdAt: n.createdAt,
    authorCharacterId: n.characterId ?? null,
    authorCharacterClass: n.character?.characterClass ?? null,
    authorName: n.character?.name ?? null,
    authorAvatarUrl: null as null,
  }));
  if (injectedNarrative && !orderedNarrative.some(n => n.text === injectedNarrative)) {
    orderedNarrative.push({
      id: 'injected-current',
      text: injectedNarrative,
      isMechanicalEvent: false,
      mechanicalSummary: null,
      createdAt: new Date(),
      authorCharacterId: null,
      authorCharacterClass: null,
      authorName: null,
      authorAvatarUrl: null,
    });
  }

  // combatAlert: session has active combat and this character is NOT enrolled
  let combatAlert: CombatAlertInfo | null = null;
  for (const cr of raw.sessionCombatRooms) {
    const cs = cr.combatState as CombatState | null;
    if (!cs) continue;
    if (cs.initiativeOrder.some(e => e.id === characterId)) continue;
    combatAlert = {
      roomName: cr.template.name,
      fightingCharacters: cs.initiativeOrder.filter(e => e.type === 'character').map(e => e.name),
      round: cs.round,
    };
    break;
  }

  // remoteCombat: character is enrolled in another room's combat as a remote participant
  // (e.g. LoS auto-enroll) while physically remaining here.
  let remoteCombat: RemoteCombatInfo | null = null;
  for (const cr of raw.sessionCombatRooms) {
    if (cr.id === roomInstanceId) continue;
    const cs = cr.combatState as CombatState | null;
    if (!cs) continue;
    const entry = cs.initiativeOrder.find(e => e.id === characterId);
    if (!entry) continue;
    remoteCombat = {
      roomInstanceId: cr.id,
      roomName: cr.template.name,
      combatState: {
        ...cs,
        initiativeOrder: cs.initiativeOrder.map(e =>
          e.id === characterId ? { ...e, hp: charRow.currentHp } : e
        ),
      },
    };
    break;
  }

  const resolvedGameState = (roomRow?.gameState ?? gameState) as 'exploration' | 'combat';
  const rawCombatState = roomRow?.combatState
    ? (roomRow.combatState as unknown as import('@/types/v2-game').CombatState)
    : null;
  const resolvedCombatState = rawCombatState
    ? {
        ...rawCombatState,
        initiativeOrder: rawCombatState.initiativeOrder.map(e =>
          e.id === characterId ? { ...e, hp: charRow.currentHp } : e
        ),
      }
    : null;

  // Build partyMembers (deduped by characterId, keeping most recent room)
  const DORMANT_MS = 48 * 60 * 60 * 1000;
  const seenPartyCharIds = new Set<string>();
  const partyMembers: import('@/types/v2-game').PartyMemberInfo[] = [];
  for (const rp of sessionPartyData) {
    if (seenPartyCharIds.has(rp.character.id)) continue;
    seenPartyCharIds.add(rp.character.id);
    const c = rp.character;
    const lastActive = rp.lastActiveAt;
    const mDexMod = abilityModifier(c.baseDexterity);
    const mStrMod = abilityModifier(c.baseStrength);
    const mProf = c.level >= 5 ? 3 : 2;
    const mInv = normalizeInventory(c.inventory);
    const mArmor = Object.values(mInv.equipped)
      .filter((i): i is import('@/types/v2-game').ItemDefinition => i != null)
      .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);
    partyMembers.push({
      characterId: c.id,
      characterName: c.name,
      characterClass: c.characterClass,
      avatarUrl: c.user.avatarUrl,
      currentHp: c.currentHp,
      maxHp: c.maxHp,
      isDead: c.isDead,
      isDormant: Date.now() - lastActive.getTime() > DORMANT_MS,
      isInSameRoom: rp.roomInstance.id === roomInstanceId,
      currentRoom: rp.roomInstance.template.name,
      lastSeenAt: c.user.lastSeenAt,
      level: c.level,
      ac: 10 + mDexMod + mArmor,
      attackBonus: mStrMod + mProf,
      initiativeMod: mDexMod,
      baseStrength: c.baseStrength,
      baseDexterity: c.baseDexterity,
      baseConstitution: c.baseConstitution,
      baseIntelligence: c.baseIntelligence,
      baseWisdom: c.baseWisdom,
      baseCharisma: c.baseCharisma,
      skillsModifiers: (c.skillsModifiers as Record<string, number>) ?? {},
      skillProficiencies: c.skillProficiencies ?? [],
      xp: c.xp ?? 0,
      xpToNextLevel: (() => { const t = xpForNextLevel(c.level); return t !== null ? t - (c.xp ?? 0) : null; })(),
      nextFeature: getNextFeature(classProgressionRows, c.characterClass, c.level),
      resourceStates: [],
      classFeatureDetails: [],
    });
  }

  const profBonus = charRow.level >= 5 ? 3 : charRow.level >= 3 ? 2 : 2;
  const dexMod = abilityModifier(charRow.baseDexterity);
  const strMod = abilityModifier(charRow.baseStrength);
  const inv = normalizeInventory(charRow.inventory);
  const armorBonus = Object.values(inv.equipped)
    .filter((i): i is import('@/types/v2-game').ItemDefinition => i != null)
    .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);

  const mainWeapon = inv.equipped.main_hand ?? null;
  const offWeapon = inv.equipped.off_hand?.weapon_type ? inv.equipped.off_hand : null;
  const weaponAtkMod = (wt: string | undefined) =>
    wt === 'ranged' ? dexMod : wt === 'finesse' ? Math.max(strMod, dexMod) : strMod;
  const fmtDmg = (dice: string, mod: number) =>
    mod === 0 ? dice : mod > 0 ? `${dice}+${mod}` : `${dice}-${Math.abs(mod)}`;
  const mainAtkMod = weaponAtkMod(mainWeapon?.weapon_type);
  const weaponDamage = {
    main: mainWeapon?.damage_dice ? fmtDmg(mainWeapon.damage_dice, mainAtkMod) : null,
    off:  offWeapon?.damage_dice ?? null,
  };

  return {
    roomInstanceId,
    currentNarrative: orderedNarrative,
    activeState: resolvedGameState,
    gameState: resolvedGameState,
    combatState: resolvedCombatState,
    combatAlert,
    remoteCombat,
    poiIndex,
    poiStates,
    uiLayoutAnchors,
    characterInventory,
    openSpaceItems,
    adjacentRoomPreviews,
    characterStats: {
      name: charRow.name,
      currentHp: charRow.currentHp,
      maxHp: charRow.maxHp,
      ac: 10 + dexMod + armorBonus,
      level: charRow.level,
      xp: charRow.xp,
      characterClass: charRow.characterClass,
      attackBonus: mainAtkMod + profBonus,
      weaponDamage,
      initiativeMod: dexMod,
      baseStrength: charRow.baseStrength,
      baseDexterity: charRow.baseDexterity,
      baseConstitution: charRow.baseConstitution,
      baseIntelligence: charRow.baseIntelligence,
      baseWisdom: charRow.baseWisdom,
      baseCharisma: charRow.baseCharisma,
      skillsModifiers: (charRow.skillsModifiers as Record<string, number>) ?? {},
      skillProficiencies: charRow.skillProficiencies ?? [],
      isHiding: charRow.isHiding,
      pendingChoicesQueue: (charRow.pendingChoicesQueue as unknown as PendingLevelUpChoice[]) ?? [],
      subclass: charRow.subclass ?? null,
      critThreshold: charRow.critThreshold,
      featuresUnlocked: (charRow.featuresUnlocked as string[]) ?? [],
      resourceStates: (charRow.resourceStates ?? []) as Array<{ poolKey: string; current: number }>,
      canShortRest: false,
      classFeatureDetails: classFeatureDetails as import('@/types/v2-game').CharacterStats['classFeatureDetails'],
    },
    partyMembers,
  };
}

export async function buildViewState(
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  fallbackNarrative?: string,
): Promise<ViewStatePayload> {
  const raw = await prefetchViewStateData(roomInstanceId, characterId, sessionId);
  return assembleViewState(raw, roomInstanceId, gameState, characterId, sessionId, characterProximityTargetId, fallbackNarrative);
}
