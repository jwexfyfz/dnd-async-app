import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { abilityModifier } from '@/lib/dice';
import { normalizeInventory } from '@/lib/v2/game-controller';

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
        template: { select: { name: true } },
        poiInstances: {
          select: { id: true, currentProperties: true, template: { select: { name: true, defaultProperties: true } } },
        },
      },
    });
    if (!roomInstance) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const sessionId = roomInstance.session.id;

    const [participants, sessionPartyData, charRow, messageLogs] = await Promise.all([
      prisma.roomParticipant.findMany({
        where: { roomInstanceId },
        include: { character: { select: { id: true, name: true } } },
      }),
      prisma.roomParticipant.findMany({
        where: { roomInstance: { sessionId } },
        include: {
          character: {
            select: {
              id: true, name: true, characterClass: true, currentHp: true, maxHp: true, isDead: true,
              level: true, inventory: true,
              baseStrength: true, baseDexterity: true, baseConstitution: true,
              baseIntelligence: true, baseWisdom: true, baseCharisma: true,
              skillsModifiers: true, skillProficiencies: true,
              user: { select: { avatarUrl: true, lastSeenAt: true } },
            },
          },
          roomInstance: { select: { id: true, template: { select: { name: true } } } },
        },
        orderBy: { lastActiveAt: 'asc' },
      }),
      characterId ? prisma.character.findUnique({
        where: { id: characterId },
        select: {
          name: true, inventory: true, currentHp: true, maxHp: true, level: true, characterClass: true,
          baseStrength: true, baseDexterity: true, baseConstitution: true, baseIntelligence: true,
          baseWisdom: true, baseCharisma: true, skillsModifiers: true, skillProficiencies: true, isHiding: true,
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
      characterStats = {
        name: charRow.name,
        currentHp: charRow.currentHp, maxHp: charRow.maxHp,
        ac: 10 + dexMod + armorBonus,
        level: charRow.level, characterClass: charRow.characterClass,
        attackBonus: strMod + profBonus, initiativeMod: dexMod,
        baseStrength: charRow.baseStrength, baseDexterity: charRow.baseDexterity,
        baseConstitution: charRow.baseConstitution, baseIntelligence: charRow.baseIntelligence,
        baseWisdom: charRow.baseWisdom, baseCharisma: charRow.baseCharisma,
        skillsModifiers: (charRow.skillsModifiers as Record<string, number>) ?? {},
        skillProficiencies: charRow.skillProficiencies ?? [],
        isHiding: charRow.isHiding,
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

    return NextResponse.json({
      activeState: roomInstance.gameState,
      gameState: roomInstance.gameState,
      combatState: roomInstance.combatState ?? null,
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
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}
