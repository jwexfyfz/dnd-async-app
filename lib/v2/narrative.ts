import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { extractPoiItems } from '@/lib/v2/item-helpers';
import { buildNarrativeSystemPrompt } from '@/lib/v2/ai-prompts';
import type { AppliedAction } from '@/lib/v2/mutation-engine';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateAndPersistNarrative(
  roomInstanceId: string,
  characterId: string,
  characterName: string,
  roomName: string,
  roomDescription: string,
  appliedActions: AppliedAction[],
  sessionId: string,
  extraFacts?: string[],
  roomParticipantNames?: string[],
): Promise<{ text: string; persisted: boolean }> {
  const [recentLogs, freshPois, sessionRow] = await Promise.all([
    prisma.messageLog.findMany({
      where: { roomInstanceId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { text: true, isMechanicalEvent: true },
    }),
    prisma.poiInstance.findMany({
      where: { roomInstanceId },
      include: { template: true },
    }),
    prisma.gameSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { storyFlags: true },
    }),
  ]);
  const storyFlags = (sessionRow.storyFlags as Record<string, unknown>) ?? {};
  const chronologicalLogs = recentLogs.reverse();

  const itemsBlock = freshPois
    .flatMap(poi => {
      const { items, floorItems } = extractPoiItems(poi.template.defaultProperties, poi.currentProperties);
      const all = [...items, ...floorItems];
      if (all.length === 0) return [];
      return all.map(i => `- ${i.name} (at: ${poi.template.name})`);
    })
    .join('\n');

  const npcsBlock = freshPois
    .filter(poi => {
      const dp = poi.template.defaultProperties as Record<string, unknown>;
      const cp = poi.currentProperties as Record<string, unknown>;
      return dp.poi_type === 'npc' && cp.awareness_state !== 'dead';
    })
    .map(poi => {
      const cp = poi.currentProperties as Record<string, unknown>;
      const awareness = (cp.awareness_state as string) ?? 'unaware';
      const hp = cp.current_hp as number | undefined;
      const maxHp = (poi.template.defaultProperties as Record<string, unknown>).combat_stats
        ? ((poi.template.defaultProperties as Record<string, unknown>).combat_stats as Record<string, unknown>).max_hp as number | undefined
        : undefined;
      let hpNote = '';
      if (hp !== undefined && maxHp !== undefined && maxHp > 0) {
        const pct = hp / maxHp;
        const condition = pct <= 0.25 ? 'near death' : pct <= 0.5 ? 'bloodied' : pct <= 0.75 ? 'wounded' : 'healthy';
        hpNote = ` (condition: ${condition})`;
      }
      return `- ${poi.template.name}${hpNote} [awareness: ${awareness}]`;
    })
    .join('\n');

  const exitStateLines = freshPois
    .filter(poi => (poi.template.defaultProperties as Record<string, unknown>).poi_type === 'exit')
    .map(poi => {
      const dp = poi.template.defaultProperties as Record<string, unknown>;
      const rawPeek = (dp.peek_visibility as string) ?? 'none';
      if (rawPeek !== 'none') return `${poi.template.name}: archway (always open)`;
      const cp = poi.currentProperties as Record<string, unknown>;
      const state = cp.unlocked === true ? 'unlocked' : cp.interacted === true ? 'open' : 'closed';
      return `${poi.template.name}: ${state}`;
    });
  const exitContext = exitStateLines.length > 0
    ? `[EXIT STATES: ${exitStateLines.join('; ')}] `
    : '';

  // Claim pendingArrivalContext (if any) for this character's first action.
  // NOTE: PostgreSQL RETURNING returns post-update values, so we read first then clear.
  type ArrivalContext = { fallenName: string; fallenClass: string; newName: string; newClass: string; recentContext: string };
  const charRow = await prisma.character.findUnique({
    where: { id: characterId },
    select: { pendingArrivalContext: true },
  });
  const rawArrival = charRow?.pendingArrivalContext ?? null;
  if (rawArrival) {
    await prisma.character.update({ where: { id: characterId }, data: { pendingArrivalContext: Prisma.JsonNull } });
  }
  let arrivalExtraContext = '';
  if (rawArrival) {
    const arrival = rawArrival as ArrivalContext;
    arrivalExtraContext = `
A new companion, ${arrival.newName} (${arrival.newClass}), is joining the party for the first time. Weave their arrival naturally into the narrative. Draw a subtle thematic connection to ${arrival.fallenName} (${arrival.fallenClass}) who fell in recent battle — perhaps a shared marking, a rumor heard on the road, or a curious resemblance. Do not be heavy-handed. Let the story breathe.

Recent party activity (for continuity — do not contradict this):
${arrival.recentContext}
    `.trim();
  }

  const mechanicalFactBlock = exitContext + appliedActions
    .map(({ action, poiName, itemName, overrideFact }) => {
      if (overrideFact) return overrideFact;
      switch (action.action_type) {
        case 'move_to_room':
          return `Character "${characterName}" just arrived in this room, having passed through "${poiName ?? 'an exit'}". Describe their entrance and first impression of the surroundings.`;
        case 'change_proximity':
          return `Character "${characterName}" is now standing AT "${poiName}"${action.resulting_stance ? ` with the stance "${action.resulting_stance}"` : ''}.`;
        case 'examine':
          return `Character "${characterName}" examined "${poiName}" closely. The engine has recorded this inspection.`;
        case 'interact':
          return `Character "${characterName}" ${action.interaction_result ?? 'interacted with'} "${poiName}". The engine has updated the object's state.`;
        case 'look_around':
          return `Character "${characterName}" surveyed the room with a careful eye.`;
        case 'search':
          return `Character "${characterName}" searched the room thoroughly.`;
        case 'pick_up':
          return `Character "${characterName}" picked up "${itemName ?? action.item_id}" from "${poiName}".`;
        case 'drop':
          return `Character "${characterName}" dropped "${itemName ?? action.item_id}" at ${poiName ?? 'the floor'}.`;
        case 'equip':
          return `Character "${characterName}" equipped "${itemName ?? action.item_id}".`;
        case 'unequip':
          return `Character "${characterName}" put away "${itemName ?? action.item_id}".`;
        case 'use_item':
          return `Character "${characterName}" used "${itemName ?? action.item_id}". The engine has resolved its effect.`;
        case 'throw_item':
          return `Character "${characterName}" threw "${itemName ?? action.item_id}"${poiName ? ` toward ${poiName}` : ''}.`;
        default:
          return `Character "${characterName}" performed a narrative action with no positional change.`;
      }
    })
    .join(' ');

  const baseFactBlock = extraFacts && extraFacts.length > 0
    ? extraFacts.join(' ') + (mechanicalFactBlock ? ' ' + mechanicalFactBlock : '')
    : mechanicalFactBlock;
  const finalFactBlock = arrivalExtraContext
    ? arrivalExtraContext + (baseFactBlock ? '\n\n' + baseFactBlock : '')
    : baseFactBlock;

  const historyBlock = chronologicalLogs
    .map((log, i) => `[${i + 1}] ${log.text}`)
    .join('\n');

  console.log('[narrative] room:', roomName);
  console.log('[narrative] npcs block:', npcsBlock || '(none)');
  console.log('[narrative] fact block:', finalFactBlock);

  const narrativeResponse = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildNarrativeSystemPrompt(roomName, roomDescription, finalFactBlock, itemsBlock, storyFlags, roomParticipantNames, npcsBlock),
    messages: [
      {
        role: 'user',
        content: `RECENT ROOM HISTORY:\n${historyBlock || '(No prior events in this room)'}\n\nNarrate the current engine update now.`,
      },
    ],
  });

  const textBlock = narrativeResponse.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  const narrativeText = textBlock?.text ?? '[No narrative generated]';
  console.log('[narrative] generated:', narrativeText);

  let persisted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.messageLog.create({
        data: { roomInstanceId, characterId, isMechanicalEvent: false, text: narrativeText },
      });
      persisted = true;
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && msg.includes('Foreign key constraint')) {
        console.warn('[narrative] FK violation on first attempt — retrying after 200ms');
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      console.error('[narrative] messageLog.create failed:', msg);
      break;
    }
  }

  return { text: narrativeText, persisted };
}
