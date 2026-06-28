import Anthropic from '@anthropic-ai/sdk';
import { buildHaikuStaticPrefix, buildHaikuDynamicContext } from '@/lib/v2/ai-prompts';
import type { ExtractedAction, CharacterInventory } from '@/types/v2-game';
import type { PoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function parseIntentWithHaiku(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  playerActionText: string,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
  actionHint?: string | null,
): Promise<ExtractedAction[]> {
  const userContent = actionHint
    ? `[ACTION HINT: ${actionHint}] (use this action_type unless the text clearly contradicts it)\n${playerActionText}`
    : playerActionText;
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [
      {
        type: 'text' as const,
        text: buildHaikuStaticPrefix(),
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: buildHaikuDynamicContext(
          poiContexts, characterInventory, otherCharacters,
          currentProximityPoiId, adjacentRoom,
        ),
      },
    ],
    tools: [
      {
        name: 'extract_game_intent',
        description: 'Parses player input into structured game actions targeting valid Points of Interest and items.',
        input_schema: {
          type: 'object' as const,
          properties: {
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action_type: {
                    type: 'string',
                    enum: [
                      'change_proximity',
                      'narrative_only',
                      'examine',
                      'interact',
                      'destroy_poi',
                      'force_open',
                      'look_around',
                      'search',
                      'move_to_room',
                      'pick_up',
                      'drop',
                      'equip',
                      'unequip',
                      'use_item',
                      'throw_item',
                      'attack',
                      'dodge',
                      'dash',
                      'disengage',
                      'hide',
                      'provoke',
                      'death_save',
                      'use_class_feature',
                    ],
                    description: 'The category of the action.',
                  },
                  target_poi_instance_id: {
                    type: ['string', 'null'],
                    description:
                      'POI instance ID being targeted. Required for examine, interact, change_proximity, move_to_room, pick_up, force_open. For use_item when unlocking. Null otherwise.',
                  },
                  resulting_stance: {
                    type: ['string', 'null'],
                    description: 'Stance assumed at the target POI. Only for change_proximity. Null otherwise.',
                  },
                  interaction_result: {
                    type: ['string', 'null'],
                    description: 'Short verb for interact actions. Null for all other types.',
                  },
                  target_room_template_id: {
                    type: ['string', 'null'],
                    description: 'For move_to_room: copy the "Leads to room template" ID from the EXIT POINTS list for the chosen exit. Null for all other action types.',
                  },
                  item_id: {
                    type: ['string', 'null'],
                    description:
                      'Item ID from CHARACTER INVENTORY or a POI item list. Required for pick_up, drop, equip, unequip, use_item, throw_item. Null otherwise.',
                  },
                  target_character_id: {
                    type: ['string', 'null'],
                    description: 'For use_item or throw_item in combat: set to the initiative order entry ID of the target (ally or enemy). Copy the ID exactly from the COMBAT STATE initiative order. Null for all other action types.',
                  },
                },
                required: [
                  'action_type',
                  'target_poi_instance_id',
                  'resulting_stance',
                  'interaction_result',
                  'target_room_template_id',
                  'item_id',
                  'target_character_id',
                ],
              },
            },
          },
          required: ['actions'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_game_intent' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    throw new Error('Haiku did not return a tool_use block — intent parsing failed.');
  }

  const { actions } = toolUseBlock.input as { actions: ExtractedAction[] };

  for (const a of actions) {
    if (a.target_character_id === '<UNKNOWN>') a.target_character_id = null;
    if (a.target_poi_instance_id === '<UNKNOWN>') a.target_poi_instance_id = null;
    if (a.target_room_template_id === '<UNKNOWN>') a.target_room_template_id = null;
  }

  console.log('[intent-parser] input:', playerActionText);
  console.log('[intent-parser] other characters:', JSON.stringify(otherCharacters));
  console.log(
    '[intent-parser] poi contexts:',
    JSON.stringify(
      poiContexts.map(p => ({
        id: p.id.slice(0, 8),
        name: p.name,
        isExit: p.isExit,
        isOpenSpace: p.isOpenSpace,
        items: p.items.map(i => `${i.name}(id:${i.id})`),
        floorItems: p.floorItems.map(i => `${i.name}(id:${i.id})`),
      })),
      null,
      2,
    ),
  );
  console.log(
    '[intent-parser] inventory:',
    JSON.stringify(
      {
        bag: characterInventory.bag.map(i => `${i.name}(id:${i.id})`),
        equipped: Object.fromEntries(
          Object.entries(characterInventory.equipped)
            .filter(([, v]) => v != null)
            .map(([slot, i]) => [slot, `${i!.name}(id:${i!.id})`]),
        ),
      },
    ),
  );
  console.log('[intent-parser] captured:', JSON.stringify(actions, null, 2));

  return actions;
}
