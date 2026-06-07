import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type LobbyMember = {
  characterId: string;
  characterName: string;
  characterClass: string;
  status: string;
  [k: string]: unknown;
};

export function buildPartyContext(members: LobbyMember[]): string {
  if (members.length === 0) return '';
  if (members.length === 1) {
    return `PARTY ARRIVING: ${members[0].characterName} (${members[0].characterClass})`;
  }
  const list = members.map(m => `${m.characterName} (${m.characterClass})`).join(', ');
  return `PARTY ARRIVING: ${list}`;
}

export async function startSession(
  sessionId: string,
  hostUserId: string,
  hostCharacterId: string,
): Promise<{ roomInstanceId: string }> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: {
      gameState: true,
      hostCharacterId: true,
      lobbyState: true,
      roomInstances: {
        take: 1,
        include: {
          template: { select: { name: true, baseDescription: true } },
          poiInstances: {
            include: { template: { select: { name: true, defaultProperties: true } } },
          },
        },
      },
    },
  });
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.gameState !== 'lobby') {
    if (session.gameState === 'active') {
      return { roomInstanceId: session.roomInstances[0]?.id ?? '' };
    }
    throw Object.assign(new Error('Session is not in lobby state'), { status: 400 });
  }

  // Verify requester owns hostCharacterId
  const hostChar = await prisma.character.findFirst({
    where: { id: hostCharacterId, userId: hostUserId },
    select: { id: true },
  });
  if (!hostChar || session.hostCharacterId !== hostCharacterId) {
    throw Object.assign(new Error('Only the host can start the session'), { status: 403 });
  }

  const roomInstance = session.roomInstances[0];
  if (!roomInstance) throw Object.assign(new Error('No room instance found'), { status: 500 });

  const members = session.lobbyState as LobbyMember[];
  const nonHostMembers = members.filter(m => m.characterId !== hostCharacterId);

  // Generate opening narrative with full party context
  const partyContext = buildPartyContext(members);
  const visiblePois = roomInstance.poiInstances.filter(pi => {
    const props = pi.template.defaultProperties as Record<string, unknown>;
    return props.visibility !== 'proximity_only' && props.poi_type !== 'open_space';
  });
  const poiList = visiblePois.map(pi => `- ${pi.template.name}`).join('\n') || '(empty room)';

  let narrativeText = `${partyContext ? partyContext + '. ' : ''}The party enters ${roomInstance.template.name}. ${roomInstance.template.baseDescription}`;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are a Dungeon Master narrating a D&D adventure. Write an atmospheric opening scene (2-4 sentences) as the party enters the room. Use vivid, present-tense prose. Do not ask what the players do next.

ROOM: ${roomInstance.template.name}
DESCRIPTION: ${roomInstance.template.baseDescription}
VISIBLE FEATURES:
${poiList}`,
      messages: [{
        role: 'user',
        content: `${partyContext}. Set the opening scene.`,
      }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (textBlock?.text) narrativeText = textBlock.text;
  } catch (err) {
    console.error('[session-starter] narrative AI failed:', err instanceof Error ? err.message : err);
  }

  await prisma.$transaction(async tx => {
    // Add non-host members as RoomParticipants
    for (const member of nonHostMembers) {
      const char = await tx.character.findUnique({ where: { id: member.characterId }, select: { id: true } });
      if (!char) throw new Error(`Character ${member.characterId} not found`);
      await tx.roomParticipant.upsert({
        where: { roomInstanceId_characterId: { roomInstanceId: roomInstance.id, characterId: member.characterId } },
        update: { lastActiveAt: new Date() },
        create: { roomInstanceId: roomInstance.id, characterId: member.characterId, combatState: { proximity_target_id: null, stance: null } },
      });
    }

    // Flip session to active
    await tx.gameSession.update({
      where: { id: sessionId },
      data: { gameState: 'active' },
    });

    // Write party opening narrative
    await tx.messageLog.create({
      data: { roomInstanceId: roomInstance.id, isMechanicalEvent: false, text: narrativeText },
    });
  });

  return { roomInstanceId: roomInstance.id };
}
