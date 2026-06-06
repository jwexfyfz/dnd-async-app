import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { abilityModifier } from '@/lib/dice';
import { normalizeInventory } from '@/lib/v2/game-controller';

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
        session: { select: { id: true, gameState: true, combatState: true } },
        template: { select: { name: true } },
        poiInstances: {
          select: { id: true, currentProperties: true, template: { select: { name: true, defaultProperties: true } } },
        },
      },
    });
    if (!roomInstance) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const participants = await prisma.roomParticipant.findMany({
      where: { roomInstanceId },
      include: { character: { select: { id: true, name: true } } },
    });

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

    let characterStats = null;
    if (characterId) {
      const char = await prisma.character.findUnique({
        where: { id: characterId },
        select: {
          inventory: true, currentHp: true, maxHp: true, level: true, characterClass: true,
          baseStrength: true, baseDexterity: true, baseConstitution: true, baseIntelligence: true,
          baseWisdom: true, baseCharisma: true, skillsModifiers: true, skillProficiencies: true, isHiding: true,
        },
      });
      if (char) {
        const inv = normalizeInventory(char.inventory);
        const dexMod = abilityModifier(char.baseDexterity);
        const strMod = abilityModifier(char.baseStrength);
        const profBonus = char.level >= 5 ? 3 : 2;
        const armorBonus = Object.values(inv.equipped)
          .filter((i): i is NonNullable<typeof i> => i != null)
          .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);
        characterStats = {
          currentHp: char.currentHp, maxHp: char.maxHp,
          ac: 10 + dexMod + armorBonus,
          level: char.level, characterClass: char.characterClass,
          attackBonus: strMod + profBonus, initiativeMod: dexMod,
          baseStrength: char.baseStrength, baseDexterity: char.baseDexterity,
          baseConstitution: char.baseConstitution, baseIntelligence: char.baseIntelligence,
          baseWisdom: char.baseWisdom, baseCharisma: char.baseCharisma,
          skillsModifiers: (char.skillsModifiers as Record<string, number>) ?? {},
          skillProficiencies: char.skillProficiencies ?? [],
          isHiding: char.isHiding,
        };
      }
    }

    return NextResponse.json({
      activeState: roomInstance.session.gameState,
      gameState: roomInstance.session.gameState,
      combatState: roomInstance.session.combatState ?? null,
      sessionId: roomInstance.session.id,
      roomName: roomInstance.template.name,
      poiIndex,
      poiStates,
      uiLayoutAnchors,
      characterStats,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}
