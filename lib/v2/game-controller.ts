import { randomInt } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import type {
  GameActionRequest,
  ExtractedAction,
  ItemDefinition,
  CharacterInventory,
  EntityRef,
  UiLayoutAnchors,
  AdjacentRoomPreview,
  ViewStatePayload,
} from '@/types/v2-game';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Item Helpers ─────────────────────────────────────────────────────────────

function normalizeInventory(raw: unknown): CharacterInventory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bag: [], equipped: {} };
  }
  const inv = raw as Record<string, unknown>;
  return {
    bag: Array.isArray(inv.bag) ? (inv.bag as ItemDefinition[]) : [],
    equipped:
      inv.equipped && typeof inv.equipped === 'object' && !Array.isArray(inv.equipped)
        ? (inv.equipped as CharacterInventory['equipped'])
        : {},
  };
}

function inventorySummary(inv: CharacterInventory): string {
  const equippedSlots = Object.entries(inv.equipped)
    .filter(([, item]) => item != null)
    .map(([slot, item]) => `${slot}:${item!.name}`)
    .join(', ');
  return `bag=${inv.bag.length} item(s)${equippedSlots ? `, equipped=[${equippedSlots}]` : ''}`;
}

function extractPoiItems(
  defaultProperties: unknown,
  currentProperties: unknown,
): { items: ItemDefinition[]; floorItems: ItemDefinition[] } {
  const defaults = (defaultProperties as Record<string, unknown>) ?? {};
  const current = (currentProperties as Record<string, unknown>) ?? {};

  const templateItems = Array.isArray(defaults.items) ? (defaults.items as ItemDefinition[]) : [];
  const takenIds = new Set(Array.isArray(current.items_taken) ? (current.items_taken as string[]) : []);
  const revealedIds = new Set(
    Array.isArray(current.revealed_items) ? (current.revealed_items as string[]) : [],
  );

  const visibleItems = templateItems.filter(item => {
    if (takenIds.has(item.id)) return false;
    if (item.hidden && !revealedIds.has(item.id)) return false;
    return true;
  });

  const floorItems = Array.isArray(current.floor_items) ? (current.floor_items as ItemDefinition[]) : [];

  console.log(`[items] extractPoiItems — template:${templateItems.map(i => `${i.id}(hidden=${!!i.hidden})`).join(',')||'none'} taken:[${[...takenIds].join(',')}] revealed:[${[...revealedIds].join(',')}] visible:[${visibleItems.map(i=>i.id).join(',')}] floor:[${floorItems.map(i=>i.id).join(',')}]`);

  return { items: visibleItems, floorItems };
}

// ─── POI Context ──────────────────────────────────────────────────────────────

interface PoiContext {
  id: string;
  name: string;
  keyword: string;
  availableStances: string[];
  examined: boolean;
  interacted: boolean;
  destroyed: boolean;
  isLocked: boolean;
  isUnlocked: boolean;
  isExit: boolean;
  targetRoomTemplateId: string | null;
  items: ItemDefinition[];
  floorItems: ItemDefinition[];
  isOpenSpace: boolean;
  visibility: 'always' | 'proximity_only';
  peekVisibility: 'none' | 'obvious_only' | 'full';
}

// ─── Grid slot helpers ───────────────────────────────────────────────────────

const SLOT_COORDS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

function slotGridDistance(a: string, b: string): number {
  const ca = SLOT_COORDS[a] ?? SLOT_COORDS.C;
  const cb = SLOT_COORDS[b] ?? SLOT_COORDS.C;
  return Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]));
}

function resolveEffectiveVisibility(
  defaultProps: Record<string, unknown>,
  currentProps: Record<string, unknown>,
): 'always' | 'proximity_only' {
  if (currentProps.visibility_override === 'always') return 'always';
  return ((defaultProps.visibility as string) ?? 'always') as 'always' | 'proximity_only';
}

// ─── Act definitions ──────────────────────────────────────────────────────────

interface ActMutation {
  poiTemplateId: string;
  setProps: Record<string, unknown>;
}

interface ActDefinition {
  act: number;
  completionFlags: string[];
  openingObjective?: string;
  onStartMutations: ActMutation[];
}

const DUNGEON_ACTS: ActDefinition[] = [
  {
    act: 1,
    completionFlags: ['commander_note_read'],
    onStartMutations: [],
  },
  {
    act: 2,
    openingObjective: 'Descend deeper — something stirs below the flooded passage',
    onStartMutations: [
      // Unlock the Submerged Gate so the party can proceed north
      { poiTemplateId: '77000001-0000-0000-0000-000000000001', setProps: { unlocked: true } },
    ],
    completionFlags: ['ritual_disrupted', 'harwick_defeated'],
  },
  {
    act: 3,
    openingObjective: 'Find the Sealed Vault and deal with what is bound there',
    onStartMutations: [
      // Permanently reveal the Hidden Door East in the Ritual Chamber
      { poiTemplateId: 'b2000006-b2b2-b2b2-b2b2-b2b2b2b2b2b2', setProps: { visibility_override: 'always' } },
    ],
    completionFlags: ['binding_seal_used', 'binding_seal_destroyed'],
  },
];

function extractAvailableStances(defaultProperties: unknown): string[] {
  if (!defaultProperties || typeof defaultProperties !== 'object' || Array.isArray(defaultProperties)) {
    return [];
  }
  const reserved = new Set(['items', 'poi_type', 'visibility', 'peek_visibility', 'locked_by', 'enter', 'examine_text', 'examine_details', 'lock_dc', 'perception_details']);
  return Object.entries(defaultProperties as Record<string, { resulting_stance?: string }>)
    .filter(([key]) => !reserved.has(key))
    .map(([, v]) => v?.resulting_stance)
    .filter((s): s is string => typeof s === 'string');
}

function extractExplorationFlags(currentProperties: unknown): { examined: boolean; interacted: boolean; destroyed: boolean } {
  if (!currentProperties || typeof currentProperties !== 'object' || Array.isArray(currentProperties)) {
    return { examined: false, interacted: false, destroyed: false };
  }
  const props = currentProperties as Record<string, unknown>;
  return { examined: props.examined === true, interacted: props.interacted === true, destroyed: props.destroyed === true };
}

function extractExitInfo(
  defaultProperties: unknown,
): { isExit: boolean; targetRoomTemplateId: string | null } {
  if (!defaultProperties || typeof defaultProperties !== 'object' || Array.isArray(defaultProperties)) {
    return { isExit: false, targetRoomTemplateId: null };
  }
  const props = defaultProperties as Record<string, unknown>;
  const enterVerb = props['enter'] as Record<string, unknown> | undefined;
  if (enterVerb && typeof enterVerb.target_room_template_id === 'string') {
    return { isExit: true, targetRoomTemplateId: enterVerb.target_room_template_id };
  }
  return { isExit: false, targetRoomTemplateId: null };
}

// ─── LoS Utilities (mirrors map renderer geometry) ────────────────────────────

const LOS_SLOT_PX = 40;
const LOS_ROOM_PX = LOS_SLOT_PX * 3; // 120

const LOS_SLOT_OFFSETS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

// Adjacent room pixel origin relative to current room at (0,0)
const LOS_ADJ_ORIGIN: Record<string, [number, number]> = {
  N: [0, -LOS_ROOM_PX], S: [0, LOS_ROOM_PX],
  E: [LOS_ROOM_PX, 0],  W: [-LOS_ROOM_PX, 0],
};

function losSlotCenter(slot: string, roomX: number, roomY: number): [number, number] {
  const [sx, sy] = LOS_SLOT_OFFSETS[slot] ?? [1, 1];
  return [roomX + sx * LOS_SLOT_PX + LOS_SLOT_PX / 2, roomY + sy * LOS_SLOT_PX + LOS_SLOT_PX / 2];
}

function losArchOpening(wallSection: string, archWidth: number): [number, number] {
  const start = ({ N: 0, C: 1, S: 2 } as Record<string, number>)[wallSection] ?? 1;
  return [start, Math.min(start + archWidth, 3)];
}

// Returns true if a straight sightline from charSlot (current room at origin) to
// targetSlot (adjacent room) passes through the exit archway opening.
function isPoiVisibleThroughExit(
  charSlot: string,
  targetSlot: string,
  exitDirection: string,
  exitWallSection: string,
  exitArchWidth: number,
): boolean {
  const [adjX, adjY] = LOS_ADJ_ORIGIN[exitDirection] ?? [0, 0];
  const [cx, cy] = losSlotCenter(charSlot, 0, 0);
  const [tx, ty] = losSlotCenter(targetSlot, adjX, adjY);

  const isXWall = exitDirection === 'E' || exitDirection === 'W';
  const wallCoord = exitDirection === 'E' || exitDirection === 'S' ? LOS_ROOM_PX : 0;

  // Where the sightline crosses the wall plane
  let crossCoord: number;
  if (isXWall) {
    if (tx === cx) return false; // sightline parallel to wall
    crossCoord = cy + (ty - cy) * (wallCoord - cx) / (tx - cx);
  } else {
    if (ty === cy) return false;
    crossCoord = cx + (tx - cx) * (wallCoord - cy) / (ty - cy);
  }

  // Room-relative slot coordinate of the crossing (0–3 range)
  const roomRelative = crossCoord / LOS_SLOT_PX; // charRoom origin = 0
  const [openMin, openMax] = losArchOpening(exitWallSection, exitArchWidth);
  return roomRelative >= openMin && roomRelative <= openMax;
}

// ─── Stage 2: Haiku System Prompt ─────────────────────────────────────────────

interface AdjacentRoomContext {
  roomName: string;
  exitPoiId: string;
  exitPoiName: string;
  targetRoomTemplateId: string;
  pois: PoiContext[];
}

function buildHaikuSystemPrompt(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
): string {
  const namedPois = poiContexts.filter(p => !p.isExit && !p.isOpenSpace && p.visibility !== 'proximity_only');
  const exitPois = poiContexts.filter(p => p.isExit && p.visibility !== 'proximity_only');
  const openSpacePoi = poiContexts.find(p => p.isOpenSpace);

  const formatItemList = (items: ItemDefinition[]) =>
    items.map(i => `"${i.name}" (id:${i.id})`).join(', ');

  const namedPoiList =
    namedPois.length > 0
      ? namedPois
          .map(poi => {
            const status = [
              poi.examined ? 'examined' : 'not examined',
              poi.interacted ? 'interacted' : 'not interacted',
              poi.isLocked ? 'LOCKED' : null,
              poi.isUnlocked ? 'UNLOCKED (no need to unlock again)' : null,
              poi.destroyed ? 'DESTROYED' : null,
            ].filter(Boolean).join(', ');
            const allItems = [...poi.items, ...poi.floorItems];
            const itemsStr = allItems.length > 0 ? ` | Items here: [${formatItemList(allItems)}]` : '';
            return `  - ID: ${poi.id} | Name: "${poi.name}" | Keyword: "${poi.keyword}" | Status: ${status} | Available stances: [${poi.availableStances.join(', ') || 'none'}]${itemsStr}`;
          })
          .join('\n')
      : '  (none)';

  const openSpaceSection = openSpacePoi
    ? (() => {
        const allItems = [...openSpacePoi.items, ...openSpacePoi.floorItems];
        const itemsStr = allItems.length > 0 ? ` | Items on floor: [${formatItemList(allItems)}]` : '';
        return `\nOPEN SPACE (general floor area, id: ${openSpacePoi.id}):\n  - ID: ${openSpacePoi.id} | Name: "Open Space" | Type: open_space${itemsStr}`;
      })()
    : '';

  const exitPoiList =
    exitPois.length > 0
      ? exitPois
          .map(poi => {
            const stateStr = poi.peekVisibility !== 'none'
              ? 'Type: archway (always open, no door)'
              : `Door state: ${poi.interacted ? 'open' : 'closed'}`;
            return `  - ID: ${poi.id} | Name: "${poi.name}" | Keyword: "${poi.keyword}" | Leads to room template: ${poi.targetRoomTemplateId} | ${stateStr} | Approach stances: [${poi.availableStances.join(', ') || 'none'}]`;
          })
          .join('\n')
      : '  (none)';

  const bagStr =
    characterInventory.bag.length > 0
      ? characterInventory.bag.map(i => `  - "${i.name}" (id:${i.id})`).join('\n')
      : '  (empty)';

  const equippedEntries = Object.entries(characterInventory.equipped)
    .filter(([, item]) => item != null)
    .map(([slot, item]) => `  - ${slot}: "${item!.name}" (id:${item!.id})`);
  const equippedStr = equippedEntries.length > 0 ? equippedEntries.join('\n') : '  (nothing equipped)';

  const othersStr =
    otherCharacters.length > 0
      ? otherCharacters.map(c => `  - "${c.name}" (id:${c.id})`).join('\n')
      : '  (you are alone)';

  const currentPoiName = currentProximityPoiId
    ? (poiContexts.find(p => p.id === currentProximityPoiId)?.name ?? null)
    : null;
  const positionLine = currentPoiName
    ? `CHARACTER POSITION: Currently standing AT "${currentPoiName}" (id: ${currentProximityPoiId}).`
    : `CHARACTER POSITION: Currently in open space (not adjacent to any POI).`;

  const adjacentRoomSection = adjacentRoom && adjacentRoom.pois.filter(p => !p.isOpenSpace).length > 0
    ? (() => {
        const adjPoiList = adjacentRoom.pois
          .filter(p => !p.isOpenSpace)
          .map(p => {
            const status = [
              p.examined ? 'examined' : 'not examined',
              p.interacted ? 'interacted' : 'not interacted',
              p.isLocked ? 'LOCKED' : null,
              p.isUnlocked ? 'UNLOCKED (no need to unlock again)' : null,
            ].filter(Boolean).join(', ');
            const allItems = [...p.items, ...p.floorItems];
            const itemsStr = allItems.length > 0 ? ` | Items: [${allItems.map(i => `"${i.name}" (id:${i.id})`).join(', ')}]` : '';
            return `  - ID: ${p.id} | Name: "${p.name}" | Keyword: "${p.keyword}" | Status: ${status} | Available stances: [${p.availableStances.join(', ') || 'none'}]${itemsStr}`;
          })
          .join('\n');
        return `
VISIBLE FROM CURRENT EXIT — "${adjacentRoom.roomName}" (through "${adjacentRoom.exitPoiName}"):
${adjPoiList}

CROSS-ROOM RULE: If the player's intent targets any POI listed under "VISIBLE FROM CURRENT EXIT", you MUST emit move_to_room as the FIRST action (target_poi_instance_id="${adjacentRoom.exitPoiId}", target_room_template_id="${adjacentRoom.targetRoomTemplateId}"), then change_proximity (if the action requires proximity), then the intended action. The IDs above are real — use them exactly.`;
      })()
    : '';

  return `You are a strict game-state parser for a D&D game engine. Your only job is to call the extract_game_intent tool with a structured representation of the player's intent.

${positionLine}

REGULAR POINTS OF INTEREST IN THIS ROOM:
${namedPoiList}
${openSpaceSection}

EXIT POINTS (doorways, passages, gates leading to other areas):
${exitPoiList}
${adjacentRoomSection}

CHARACTER INVENTORY:
  Bag:
${bagStr}
  Equipped:
${equippedStr}

OTHER CHARACTERS IN THIS ROOM:
${othersStr}

ACTION TYPES:
- "examine"          — Player looks closely at a specific POI. Requires target_poi_instance_id. No stance.
- "interact"         — Player physically uses/opens/pulls/loots a POI. Requires target_poi_instance_id. Set interaction_result to a short verb. Valid for exit POIs too (e.g. "open the door", "push the gate", "try the handle"). The engine will reject this if the POI is LOCKED — the player must use a key or Thieves' Tools first.
- "destroy_poi"      — Player destroys/smashes/breaks a POI (e.g. "smash the crate", "break the barrel", "destroy the bookshelf"). Requires target_poi_instance_id. The engine will reveal all hidden items inside it. Do NOT use for exits or open_space POIs.
- "look_around"      — Player passively surveys the room (e.g. "look around", "survey the room", "observe the area"). No dice roll. Uses passive Perception (10 + WIS modifier + proficiency if Perception-trained). Reveals perception-gated hidden items automatically if their DC ≤ passive score. No target POI needed.
- "search"           — Player actively and methodically searches the room (e.g. "search the room", "investigate", "check for traps"). Rolls Investigation per POI for hidden items. No target POI needed.
- "change_proximity" — Player moves TO a POI but stays in this room. For exit POIs, use when approaching without passing through.
- "move_to_room"     — Player TRAVELS through an exit to another room. Trigger on traversal verbs: "go through", "enter", "walk through", "head to [room name]", "go back", "return", "leave the room". Do NOT use for "open", "push", "pull", "try", "unlock", "check", "examine" — those are "interact" or "examine" even when targeting an exit.
- "pick_up"          — Player picks up an item. Set target_poi_instance_id to the POI or open_space ID where the item is, and item_id to the item's id.
- "drop"             — Player drops an item from their bag. Set item_id. Optionally set target_poi_instance_id to place the item at a specific POI instead of current position.
- "equip"            — Player equips an item from their bag. Set item_id.
- "unequip"          — Player removes an equipped item. Set item_id.
- "use_item"         — Player uses an item (drink a potion, use a key on a lock, pick a lock with Thieves' Tools). Set item_id. For unlocking or lockpicking a POI, also set target_poi_instance_id.
- "throw_item"       — Player throws an item. Set item_id. Optionally set target_poi_instance_id for landing location.
- "narrative_only"   — Purely conversational or idle (talking to self, waiting in place). Do NOT use this for any movement, exploration, or interaction — even vague ones.

RULES:
- You MUST call the extract_game_intent tool. No exceptions.
- target_poi_instance_id MUST be one of the listed POI IDs above (including VISIBLE FROM CURRENT EXIT), or null.
- resulting_stance MUST exactly match one of that POI's listed available stances, or null.
- item_id MUST exactly match an item id listed in CHARACTER INVENTORY or in a POI's items list, or null.
- target_character_id MUST exactly match one of the OTHER CHARACTERS ids listed above, or null.
- interaction_result is only set for "interact" actions; null otherwise.
- For "move_to_room": target_poi_instance_id = the exit POI's ID from the EXIT POINTS list above; target_room_template_id = the "Leads to room template" value from that same exit's line. Both are REQUIRED and must be copied exactly.

PROXIMITY RULE — contact actions require being adjacent:
- "examine", "interact", "destroy_poi", "pick_up", and "drop at POI" all require physical contact. If the character is NOT already at the target POI, ALWAYS prepend a "change_proximity" to that POI first.
- Check CHARACTER POSITION: if the character is already AT the target POI, emit only the action — no change_proximity needed.
- Exception — these actions do NOT require proximity and must NEVER prepend change_proximity: "throw_item", "look_around", "search", "equip", "unequip", "move_to_room", "narrative_only".
- Examples:
  - "open the door" (not at door) → [change_proximity door, interact door]
  - "open the door" (already AT door) → [interact door]
  - "examine the fountain" (not at fountain) → [change_proximity fountain, examine fountain]
  - "grab the dagger" (not at barricade) → [change_proximity barricade, pick_up dagger from barricade]
  - "throw the stone at the pillar" → [throw_item stone] (no proximity needed)
  - "equip the sword" → [equip sword] (no proximity needed)
- Do not invent POI IDs, item IDs, stances, or room template IDs not listed above.`;
}

// ─── Stage 4: Sonnet/Haiku System Prompt ─────────────────────────────────────

function buildNarrativeSystemPrompt(
  roomName: string,
  roomDescription: string,
  mechanicalFactBlock: string,
  itemsBlock: string,
  storyFlags: Record<string, unknown>,
): string {
  const flagEntries = Object.entries(storyFlags);
  const flagsBlock = flagEntries.length > 0
    ? flagEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : '  (none set)';

  return `You are a realistic and immersive Dungeon Master narrating an asynchronous text-based D&D adventure.

ROOM CONTEXT:
Name: ${roomName}
Description: ${roomDescription}

STORY FLAGS (permanent facts about the session — use these for callbacks and consequences):
${flagsBlock}

ITEMS CURRENTLY IN THIS ROOM (AUTHORITATIVE — DO NOT INVENT OTHERS):
${itemsBlock || '(no items visible in this room)'}

ENGINE UPDATE (VERIFIED BY DATABASE — DO NOT CONTRADICT):
${mechanicalFactBlock}

STRICT INSTRUCTIONS:
- Narrate the above action vividly in 2-4 sentences from a cinematic, third-person perspective.
- You may ONLY reference items listed in "ITEMS CURRENTLY IN THIS ROOM". Do NOT invent any other items.
- Do NOT invent mechanical outcomes (damage, rolls, effects) beyond what the engine update states.
- Do NOT describe future actions or ask the player what they want to do next.`;
}

// ─── Stage 1: Database Context Lookup ────────────────────────────────────────

const roomInstanceQuery = (roomInstanceId: string) =>
  prisma.roomInstance.findUniqueOrThrow({
    where: { id: roomInstanceId },
    include: {
      template: true,
      session: { select: { id: true, gameState: true, storyFlags: true } },
      poiInstances: { include: { template: true } },
      participants: { include: { character: { select: { id: true, name: true } } } },
    },
  });

async function lookupDatabaseContext(characterId: string, roomInstanceId: string) {
  const [character, roomInstance] = await Promise.all([
    prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        characterClass: true,
        level: true,
        maxHp: true,
        currentHp: true,
        skillsModifiers: true,
        skillProficiencies: true,
        inventory: true,
        baseStrength: true,
        baseDexterity: true,
        baseConstitution: true,
        baseIntelligence: true,
        baseWisdom: true,
        baseCharisma: true,
      },
    }),
    roomInstanceQuery(roomInstanceId),
  ]);

  // Lazy sync: create PoiInstances for any templates added after this session was created
  const existingTemplateIds = new Set(roomInstance.poiInstances.map(pi => pi.poiTemplateId));
  const allTemplates = await prisma.poiTemplate.findMany({
    where: { roomTemplateId: roomInstance.roomTemplateId },
    select: { id: true },
  });
  const missing = allTemplates.filter(t => !existingTemplateIds.has(t.id));

  if (missing.length > 0) {
    console.log(`[db] lazy-syncing ${missing.length} missing PoiInstance(s) for room ${roomInstanceId}`);
    await prisma.poiInstance.createMany({
      data: missing.map(t => ({ roomInstanceId, poiTemplateId: t.id, currentProperties: {} })),
    });
    return { character, roomInstance: await roomInstanceQuery(roomInstanceId) };
  }

  return { character, roomInstance };
}

// ─── Stage 2: Intent Parsing via Claude Haiku ────────────────────────────────

async function parseIntentWithHaiku(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  playerActionText: string,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
): Promise<ExtractedAction[]> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildHaikuSystemPrompt(poiContexts, characterInventory, otherCharacters, currentProximityPoiId, adjacentRoom),
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
                      'look_around',
                      'search',
                      'move_to_room',
                      'pick_up',
                      'drop',
                      'equip',
                      'unequip',
                      'use_item',
                      'throw_item',
                    ],
                    description: 'The category of the action.',
                  },
                  target_poi_instance_id: {
                    type: ['string', 'null'],
                    description:
                      'POI instance ID being targeted. Required for examine, interact, change_proximity, move_to_room, pick_up. For use_item when unlocking. Null otherwise.',
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
                    description: 'Target character ID. Null (give_item deferred to multi-player phase).',
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
    messages: [{ role: 'user', content: playerActionText }],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    throw new Error('Haiku did not return a tool_use block — intent parsing failed.');
  }

  const { actions } = toolUseBlock.input as { actions: ExtractedAction[] };

  console.log('[intent-parser] input:', playerActionText);
  console.log(
    '[intent-parser] poi contexts:',
    JSON.stringify(
      poiContexts.map(p => ({
        id: p.id.slice(0, 8),
        name: p.name,
        isExit: p.isExit,
        isOpenSpace: p.isOpenSpace,
        items: p.items.map(i => i.name),
        floorItems: p.floorItems.map(i => i.name),
      })),
      null,
      2,
    ),
  );
  console.log('[intent-parser] captured:', JSON.stringify(actions, null, 2));

  return actions;
}

// ─── Stage 3: Deterministic State Mutation ───────────────────────────────────

interface AppliedAction {
  action: ExtractedAction;
  poiName: string | null;
  itemName: string | null;
  overrideFact?: string;
}

interface MutationResult {
  appliedActions: AppliedAction[];
  newRoomInstanceId: string | null;
}

interface CharacterContext {
  id: string;
  name: string;
  level: number;
  skillsModifiers: unknown;
  skillProficiencies: string[];
  baseWisdom: number;
  baseDexterity: number;
  currentHp: number;
  maxHp: number;
}

function requireValidPoi(id: string | null, validPoiMap: Map<string, string>): string {
  if (!id || !validPoiMap.has(id)) {
    throw new Error(`Invalid target_poi_instance_id "${id}" — aborting to prevent corrupt state.`);
  }
  return validPoiMap.get(id)!;
}

async function writeStoryFlags(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  sessionId: string,
  newFlags: Record<string, unknown>,
): Promise<void> {
  const session = await tx.gameSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { storyFlags: true },
  });
  const existing = (session.storyFlags as Record<string, unknown>) ?? {};
  await tx.gameSession.update({
    where: { id: sessionId },
    data: { storyFlags: { ...existing, ...newFlags } as object },
  });
  console.log(`[story] flags written to session ${sessionId}:`, newFlags);
}

interface InteractCheck {
  skill?: string;
  dc?: number;
  item?: string;
  fallback?: { skill: string; dc: number };
}

function resolveSkillCheck(
  character: CharacterContext,
  skill: string,
  dc: number,
): { success: boolean; d20: number; modifier: number; total: number } {
  const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
  const modifier = skillMods[skill] ?? skillMods[skill.toLowerCase()] ?? 0;
  const d20 = randomInt(1, 21);
  const total = d20 + modifier;
  return { success: total >= dc, d20, modifier, total };
}

function resolveInteractCheck(
  check: InteractCheck,
  character: CharacterContext,
  inventory: CharacterInventory,
): { success: boolean; usedItem?: string; roll?: { skill: string; d20: number; modifier: number; total: number; dc: number } } {
  if (check.item) {
    const allItems = [
      ...inventory.bag,
      ...Object.values(inventory.equipped).filter((i): i is ItemDefinition => i != null),
    ];
    const hasItem = allItems.some(i => i.id === check.item);
    if (hasItem) return { success: true, usedItem: check.item };
    // item not found — fall back to skill check if defined
    if (check.fallback) {
      const result = resolveSkillCheck(character, check.fallback.skill, check.fallback.dc);
      return { success: result.success, roll: { skill: check.fallback.skill, ...result, dc: check.fallback.dc } };
    }
    return { success: false };
  }
  if (check.skill && check.dc != null) {
    const result = resolveSkillCheck(character, check.skill, check.dc);
    return { success: result.success, roll: { skill: check.skill, ...result, dc: check.dc } };
  }
  return { success: true }; // no check defined — auto-success
}

async function handleMoveToRoom(
  action: ExtractedAction,
  characterId: string,
  currentRoomInstanceId: string,
  sessionId: string,
  exitPoiMap: Map<string, string>,
  validPoiMap: Map<string, string>,
  characterName: string,
): Promise<string> {
  const exitPoiId = action.target_poi_instance_id;
  const targetRoomTemplateId = action.target_room_template_id;

  if (!exitPoiId || !targetRoomTemplateId) {
    throw new Error('move_to_room requires both target_poi_instance_id and target_room_template_id.');
  }
  const expectedTarget = exitPoiMap.get(exitPoiId);
  if (!expectedTarget || expectedTarget !== targetRoomTemplateId) {
    throw new Error(
      `Exit POI "${exitPoiId}" does not lead to room template "${targetRoomTemplateId}" — aborting.`,
    );
  }

  // Check if exit POI is locked
  await prisma.$transaction(async tx => {
    const exitPoi = await tx.poiInstance.findUniqueOrThrow({
      where: { id: exitPoiId },
      include: { template: true },
    });
    const defaultProps = exitPoi.template.defaultProperties as Record<string, unknown>;
    const lockedBy = defaultProps.locked_by;
    const isLockable =
      Array.isArray(lockedBy)
        ? (lockedBy as string[]).length > 0
        : typeof lockedBy === 'string' && lockedBy.length > 0;
    if (isLockable) {
      const currentProps = exitPoi.currentProperties as Record<string, unknown>;
      if (currentProps.unlocked !== true) {
        throw new Error(`${validPoiMap.get(exitPoiId) ?? 'The exit'} is locked.`);
      }
    }
  });

  const exitPoiName = validPoiMap.get(exitPoiId) ?? 'the exit';

  return await prisma.$transaction(async tx => {
    const currentRoom = await tx.roomInstance.findUniqueOrThrow({
      where: { id: currentRoomInstanceId },
      select: { roomTemplateId: true },
    });

    let targetRoom = await tx.roomInstance.findFirst({
      where: { sessionId, roomTemplateId: targetRoomTemplateId },
      include: { poiInstances: { include: { template: true } } },
    });

    if (!targetRoom) {
      const targetTemplate = await tx.roomTemplate.findUniqueOrThrow({
        where: { id: targetRoomTemplateId },
        include: { poiTemplates: true },
      });
      targetRoom = await tx.roomInstance.create({
        data: {
          sessionId,
          roomTemplateId: targetRoomTemplateId,
          poiInstances: {
            create: targetTemplate.poiTemplates.map(pt => ({
              poiTemplateId: pt.id,
              currentProperties: {},
            })),
          },
        },
        include: { poiInstances: { include: { template: true } } },
      });
    }

    // Mirror door state: find the return-exit POI in the target room that leads
    // back to the current room. If it's a door (peek_visibility === 'none'),
    // mark it interacted (open) so the door doesn't appear closed behind the player.
    const exitPoiInstance = await tx.poiInstance.findUniqueOrThrow({
      where: { id: exitPoiId },
      include: { template: true },
    });
    const exitDefaultProps = exitPoiInstance.template.defaultProperties as Record<string, unknown>;
    const isDoor = exitDefaultProps.peek_visibility === 'none';

    if (isDoor) {
      const returnExitPoi = targetRoom.poiInstances.find(pi => {
        const dp = pi.template.defaultProperties as Record<string, unknown>;
        const enter = dp.enter as Record<string, unknown> | undefined;
        return (
          dp.poi_type === 'exit' &&
          dp.peek_visibility === 'none' &&
          enter?.target_room_template_id === currentRoom.roomTemplateId
        );
      });
      if (returnExitPoi) {
        const existing = (returnExitPoi.currentProperties as Record<string, unknown>) ?? {};
        await tx.poiInstance.update({
          where: { id: returnExitPoi.id },
          data: { currentProperties: { ...existing, interacted: true } },
        });
      }
    }

    await tx.roomParticipant.upsert({
      where: { roomInstanceId_characterId: { roomInstanceId: targetRoom.id, characterId } },
      update: { lastActiveAt: new Date(), combatState: {} },
      create: { roomInstanceId: targetRoom.id, characterId, combatState: {} },
    });

    await tx.messageLog.create({
      data: {
        roomInstanceId: currentRoomInstanceId,
        characterId,
        isMechanicalEvent: true,
        mechanicalSummary: {
          event: 'departed',
          through: exitPoiName,
          target_room_template_id: targetRoomTemplateId,
        },
        text: `[MECHANICAL] ${characterName} passed through ${exitPoiName} and left this room.`,
      },
    });

    await tx.messageLog.create({
      data: {
        roomInstanceId: targetRoom.id,
        characterId,
        isMechanicalEvent: true,
        mechanicalSummary: {
          event: 'arrived',
          through: exitPoiName,
          from_room_instance_id: currentRoomInstanceId,
        },
        text: `[MECHANICAL] ${characterName} arrived from the previous room through ${exitPoiName}.`,
      },
    });

    return targetRoom.id;
  });
}

async function mutateGameState(
  actions: ExtractedAction[],
  character: CharacterContext,
  roomInstanceId: string,
  sessionId: string,
  exitPoiMap: Map<string, string>,
  validPoiMap: Map<string, string>,
  openSpacePoiId: string | null,
): Promise<MutationResult> {
  const { id: characterId, name: characterName } = character;
  const appliedActions: AppliedAction[] = [];
  let newRoomInstanceId: string | null = null;

  // Mutable active-room context — reloaded after move_to_room so subsequent actions
  // in the same turn (change_proximity, examine, etc.) target the correct room.
  let activeRoomId = roomInstanceId;
  let activeValidPoiMap = validPoiMap;
  let activeExitPoiMap = exitPoiMap;
  let activeOpenSpacePoiId = openSpacePoiId;

  for (const action of actions) {
    // Shadow outer parameters with the current active-room context for this iteration.
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const roomInstanceId = activeRoomId;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const validPoiMap = activeValidPoiMap;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const exitPoiMap = activeExitPoiMap;
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const openSpacePoiId = activeOpenSpacePoiId;

    // ── move_to_room ───────────────────────────────────────────────────────
    if (action.action_type === 'move_to_room') {
      const exitPoiName = action.target_poi_instance_id
        ? (validPoiMap.get(action.target_poi_instance_id) ?? 'the exit')
        : 'the exit';
      newRoomInstanceId = await handleMoveToRoom(
        action,
        characterId,
        roomInstanceId,
        sessionId,
        exitPoiMap,
        validPoiMap,
        characterName,
      );
      appliedActions.push({ action, poiName: exitPoiName, itemName: null });

      // Reload POI context for subsequent actions in this same turn.
      const freshPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId: newRoomInstanceId },
        include: { template: true },
      });
      activeRoomId = newRoomInstanceId;
      activeValidPoiMap = new Map(freshPois.map(pi => [pi.id, pi.template.name]));
      activeExitPoiMap = new Map(
        freshPois
          .filter(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            return typeof (dp.enter as Record<string, unknown> | undefined)?.target_room_template_id === 'string';
          })
          .map(pi => {
            const dp = pi.template.defaultProperties as Record<string, unknown>;
            const enter = dp.enter as Record<string, unknown>;
            return [pi.id, enter.target_room_template_id as string] as const;
          }),
      );
      activeOpenSpacePoiId = freshPois.find(pi =>
        (pi.template.defaultProperties as Record<string, unknown>).poi_type === 'open_space',
      )?.id ?? null;

    // ── change_proximity ───────────────────────────────────────────────────
    } else if (action.action_type === 'change_proximity') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      const newCombatState = {
        proximity_target_id: action.target_poi_instance_id,
        stance: action.resulting_stance,
      };

      await prisma.$transaction(async tx => {
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: newCombatState, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: newCombatState },
        });

        // Reveal proximity_only POIs within grid-distance 1 of the new position
        const targetPoiInstance = await tx.poiInstance.findUnique({
          where: { id: action.target_poi_instance_id! },
          select: { template: { select: { grid_slot: true } } },
        });
        const targetSlot = targetPoiInstance?.template.grid_slot ?? 'C';

        const proximityOnlyPois = await tx.poiInstance.findMany({
          where: { roomInstanceId },
          include: { template: { select: { grid_slot: true, defaultProperties: true } } },
        });

        for (const pp of proximityOnlyPois) {
          const dp = pp.template.defaultProperties as Record<string, unknown>;
          const cp = pp.currentProperties as Record<string, unknown>;
          if ((dp.visibility as string) !== 'proximity_only') continue;
          if (cp.visibility_override === 'always') continue; // already revealed
          const dist = slotGridDistance(targetSlot, pp.template.grid_slot ?? 'C');
          if (dist <= 1) {
            await tx.poiInstance.update({
              where: { id: pp.id },
              data: { currentProperties: { ...cp, visibility_override: 'always' } },
            });
            console.log(`[proximity] revealed "${pp.id}" (slot ${pp.template.grid_slot}) — approached from slot ${targetSlot}`);
          }
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'movement',
              to: poiName,
              poi_instance_id: action.target_poi_instance_id,
              stance: action.resulting_stance,
            },
            text: `[MECHANICAL] ${characterName} moved to ${poiName}${action.resulting_stance ? ` with stance: ${action.resulting_stance}` : ''}.`,
          },
        });
      });

      appliedActions.push({ action, poiName, itemName: null });

    // ── examine ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'examine') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
      let examineText: string | null = null;
      const passedDetailTexts: string[] = [];

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        examineText = typeof defaultProps.examine_text === 'string' ? defaultProps.examine_text : null;

        const examineDetails = Array.isArray(defaultProps.examine_details)
          ? (defaultProps.examine_details as Array<{ text: string; skill: string; dc: number }>)
          : [];
        const detailRolls: Array<{ text: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];
        for (const detail of examineDetails) {
          const modifier = skillMods[detail.skill] ?? skillMods[detail.skill.toLowerCase()] ?? 0;
          const d20 = randomInt(1, 21);
          const total = d20 + modifier;
          const success = total >= detail.dc;
          console.log(`[examine] detail-check: ${characterName} rolled ${d20}+${modifier}=${total} vs DC ${detail.dc} (${detail.skill}) — ${success ? 'PASS' : 'FAIL'}`);
          detailRolls.push({ text: detail.text, skill: detail.skill, d20, modifier, total, dc: detail.dc, success });
          if (success) passedDetailTexts.push(detail.text);
        }
        if (detailRolls.length > 0) {
          const summary = detailRolls.map(r => `${r.skill} DC${r.dc}: ${r.d20}${r.modifier !== 0 ? `+${r.modifier}` : ''}=${r.total} — ${r.success ? 'noticed' : 'missed'}`).join(', ');
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'roll_result', event: 'examine_details', poi: poiName, rolls: detailRolls },
              text: `🎲 Examine ${poiName}: ${summary}`,
            },
          });
        }

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        const hiddenItems = templateItems.filter(
          i => i.hidden && !revealedIds.has(i.id) && !takenIds.has(i.id),
        );

        const newlyRevealed: string[] = [];
        const rollResults: Array<{ item: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];

        for (const item of hiddenItems) {
          if (!item.reveal_check) {
            newlyRevealed.push(item.id);
            continue;
          }
          const skill = item.reveal_check.skill;
          const modifier = skillMods[skill] ?? skillMods[skill.toLowerCase()] ?? 0;
          const d20 = randomInt(1, 21);
          const total = d20 + modifier;
          const success = total >= item.reveal_check.dc;
          console.log(
            `[items] reveal-check: ${characterName} rolled ${d20}+${modifier}=${total} vs DC ${item.reveal_check.dc} for "${item.name}" — ${success ? 'PASS' : 'FAIL'}`,
          );
          rollResults.push({ item: item.name, skill, d20, modifier, total, dc: item.reveal_check.dc, success });
          if (success) newlyRevealed.push(item.id);
        }

        await tx.poiInstance.update({
          where: { id: action.target_poi_instance_id! },
          data: {
            currentProperties: {
              ...currentProps,
              examined: true,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'examine',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              newly_revealed: newlyRevealed,
            },
            text: `[MECHANICAL] ${characterName} examined ${poiName}${newlyRevealed.length > 0 ? ` and discovered ${newlyRevealed.length} hidden item(s).` : '.'}`,
          },
        });

        if (rollResults.length > 0) {
          const summary = rollResults.map(r => `${r.item}: ${r.d20}${r.modifier !== 0 ? `+${r.modifier}` : ''}=${r.total} vs DC ${r.dc} — ${r.success ? 'found' : 'missed'}`).join(', ');
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'roll_result', event: 'examine', poi: poiName, rolls: rollResults },
              text: `🎲 ${summary}`,
            },
          });
        }
      });

      const detailsSuffix = passedDetailTexts.length > 0
        ? ` On closer inspection: ${passedDetailTexts.join(' ')}`
        : '';
      const examineFact = examineText
        ? `Character "${characterName}" examined "${poiName}" closely. What they observe: ${examineText}${detailsSuffix}`
        : `Character "${characterName}" examined "${poiName}" closely. The engine has recorded this inspection.${detailsSuffix}`;
      appliedActions.push({ action, poiName, itemName: null, overrideFact: examineFact });

    // ── interact ───────────────────────────────────────────────────────────
    } else if (action.action_type === 'interact') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      const verb = action.interaction_result ?? 'interacted';
      let interactOverrideFact: string | undefined;

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const lockedBy = defaultProps.locked_by;
        const isLockable = Array.isArray(lockedBy)
          ? (lockedBy as string[]).length > 0
          : typeof lockedBy === 'string' && lockedBy.length > 0;
        if (isLockable && currentProps.unlocked !== true) {
          throw new Error(`"${poiName}" is locked. Use a key or Thieves' Tools to open it.`);
        }

        // ── NPC interact_options ───────────────────────────────────────────
        const poiType = defaultProps.poi_type as string | undefined;
        const interactOptions = Array.isArray(defaultProps.interact_options)
          ? (defaultProps.interact_options as Array<Record<string, unknown>>)
          : null;

        if (poiType === 'npc' && interactOptions && interactOptions.length > 0) {
          // Pick best matching option: prefer one whose label contains the verb, else use first
          const verbLower = verb.toLowerCase();
          const option =
            interactOptions.find(o => (o.label as string)?.toLowerCase().includes(verbLower)) ??
            interactOptions[0];

          const check = option.check as InteractCheck | undefined;
          let checkResult: ReturnType<typeof resolveInteractCheck> = { success: true };

          if (check) {
            const charRow = await tx.character.findUniqueOrThrow({
              where: { id: characterId },
              select: { inventory: true },
            });
            const inv = normalizeInventory(charRow.inventory);
            checkResult = resolveInteractCheck(check, character, inv);
          }

          const storyFlag = option.story_flag as string | undefined;
          const resultNarrative = checkResult.success
            ? (option.success as string | undefined) ?? (option.narrative as string | undefined)
            : (option.failure as string | undefined) ?? `The attempt fails.`;

          if (checkResult.success && storyFlag) {
            await writeStoryFlags(tx, sessionId, { [storyFlag]: true });
          }

          if (checkResult.roll) {
            const r = checkResult.roll;
            const rollLine = checkResult.usedItem
              ? `Used item: ${checkResult.usedItem}`
              : `${r.skill} check: ${r.d20}+${r.modifier}=${r.total} vs DC ${r.dc} — ${checkResult.success ? 'success' : 'failure'}`;
            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: { type: 'roll_result', event: 'npc_interact', ...r, success: checkResult.success },
                text: `🎲 ${rollLine}`,
              },
            });
          }

          interactOverrideFact = resultNarrative
            ? `[NPC INTERACTION — ${poiName}] ${resultNarrative}`
            : undefined;

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                ...(checkResult.success && storyFlag ? { [`flag_${storyFlag}`]: true } : {}),
              },
            },
          });
        } else if (defaultProps.disrupt && poiType !== 'npc') {
          // ── disrupt action (Ritual Circle etc.) ───────────────────────────
          const disrupt = defaultProps.disrupt as Record<string, unknown>;
          const check = disrupt.check as InteractCheck | undefined;
          let checkResult: ReturnType<typeof resolveInteractCheck> = { success: true };

          if (check) {
            const charRow = await tx.character.findUniqueOrThrow({
              where: { id: characterId },
              select: { inventory: true },
            });
            const inv = normalizeInventory(charRow.inventory);
            checkResult = resolveInteractCheck(check, character, inv);
          }

          const storyFlag = disrupt.story_flag as string | undefined;
          const resultNarrative = checkResult.success
            ? (disrupt.narrative as string | undefined)
            : `The disruption attempt fails — the circle's light pulses and holds.`;

          if (checkResult.success && storyFlag) {
            await writeStoryFlags(tx, sessionId, { [storyFlag]: true });
          }

          if (checkResult.roll) {
            const r = checkResult.roll;
            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: { type: 'roll_result', event: 'disrupt', ...r, success: checkResult.success },
                text: `🎲 ${r.skill} check: ${r.d20}+${r.modifier}=${r.total} vs DC ${r.dc} — ${checkResult.success ? 'success' : 'failure'}`,
              },
            });
          }

          interactOverrideFact = resultNarrative
            ? `[DISRUPTION — ${poiName}] ${resultNarrative}`
            : undefined;

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                disrupted: checkResult.success,
              },
            },
          });
        } else {
          // ── standard interact ──────────────────────────────────────────────
          const poiStoryFlag = defaultProps.story_flag as string | undefined;
          if (poiStoryFlag) {
            await writeStoryFlags(tx, sessionId, { [poiStoryFlag]: true });
          }
          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
              },
            },
          });
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'interact',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              result: verb,
            },
            text: `[MECHANICAL] ${characterName} ${verb} ${poiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName, itemName: null, overrideFact: interactOverrideFact });

    // ── destroy_poi ────────────────────────────────────────────────────────
    } else if (action.action_type === 'destroy_poi') {
      const poiName = requireValidPoi(action.target_poi_instance_id, validPoiMap);
      let revealedItemNames: string[] = [];

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: action.target_poi_instance_id! },
          include: { template: true },
        });
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const takenIds = new Set(Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : []);
        const alreadyRevealed = new Set(Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : []);

        const newlyRevealed = templateItems
          .filter(item => item.hidden && !takenIds.has(item.id) && !alreadyRevealed.has(item.id))
          .map(item => item.id);
        revealedItemNames = templateItems
          .filter(item => newlyRevealed.includes(item.id))
          .map(item => item.name);

        await tx.poiInstance.update({
          where: { id: action.target_poi_instance_id! },
          data: {
            currentProperties: {
              ...currentProps,
              destroyed: true,
              revealed_items: [...Array.from(alreadyRevealed), ...newlyRevealed],
            } as unknown as object,
          },
        });
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'destroy_poi',
              poi_instance_id: action.target_poi_instance_id,
              poi: poiName,
              revealed_items: revealedItemNames,
            },
            text: `[MECHANICAL] ${characterName} destroyed ${poiName}.${revealedItemNames.length > 0 ? ` Revealed: ${revealedItemNames.join(', ')}.` : ''}`,
          },
        });
      });

      const revealedFact = revealedItemNames.length > 0
        ? ` As it breaks apart, the following items spill out and are now visible: ${revealedItemNames.map(n => `"${n}"`).join(', ')}.`
        : ' Nothing of value was hidden inside.';
      appliedActions.push({
        action,
        poiName,
        itemName: null,
        overrideFact: `Character "${characterName}" destroyed "${poiName}".${revealedFact}`,
      });

    // ── look_around ────────────────────────────────────────────────────────
    } else if (action.action_type === 'look_around') {
      const profBonus = Math.ceil(character.level / 4) + 1;
      const wisMod = Math.floor((character.baseWisdom - 10) / 2);
      const perceptionProficient = character.skillProficiencies.some(
        s => s.toLowerCase() === 'perception',
      );
      const passivePerception = 10 + wisMod + (perceptionProficient ? profBonus : 0);

      const allPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId },
        include: { template: true },
      });

      const poiUpdates: Array<{ id: string; currentProperties: object }> = [];
      const autoRevealed: Array<{ poi: string; item: string }> = [];

      for (const poi of allPois) {
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        const passiveItems = templateItems.filter(
          i =>
            i.hidden &&
            !revealedIds.has(i.id) &&
            !takenIds.has(i.id) &&
            i.reveal_check?.skill === 'perception' &&
            (i.reveal_check?.dc ?? 999) <= passivePerception,
        );

        const newlyRevealed = passiveItems.map(i => i.id);
        if (newlyRevealed.length > 0) {
          poiUpdates.push({
            id: poi.id,
            currentProperties: {
              ...currentProps,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          });
          passiveItems.forEach(i => autoRevealed.push({ poi: poi.template.name, item: i.name }));
        }
      }

      await prisma.$transaction(async tx => {
        for (const update of poiUpdates) {
          await tx.poiInstance.update({
            where: { id: update.id },
            data: { currentProperties: update.currentProperties },
          });
        }
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'look_around',
              passive_perception: passivePerception,
              auto_revealed: autoRevealed.length,
            },
            text: `[MECHANICAL] ${characterName} surveyed the room (passive Perception ${passivePerception})${autoRevealed.length > 0 ? ` and noticed ${autoRevealed.length} item(s).` : '.'}`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: null });

    // ── search ─────────────────────────────────────────────────────────────
    } else if (action.action_type === 'search') {
      const skillMods = (character.skillsModifiers as Record<string, number>) ?? {};
      const investigationMod =
        skillMods['investigation'] ?? skillMods['Investigation'] ?? 0;

      const allPois = await prisma.poiInstance.findMany({
        where: { roomInstanceId },
        include: { template: true },
      });

      const rollResults: Array<{ poi: string; item: string; skill: string; d20: number; modifier: number; total: number; dc: number; success: boolean }> = [];
      const poiUpdates: Array<{ id: string; currentProperties: object }> = [];

      for (const poi of allPois) {
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const revealedIds = new Set(
          Array.isArray(currentProps.revealed_items) ? (currentProps.revealed_items as string[]) : [],
        );
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );

        console.log(`[items] search scanning poi "${poi.template.name}": templateItems=[${templateItems.map(i=>`${i.id}(hidden=${!!i.hidden},skill=${i.reveal_check?.skill})`).join(',')||'none'}] revealed=[${[...revealedIds].join(',')}] taken=[${[...takenIds].join(',')}]`);

        const hiddenInvestigationItems = templateItems.filter(
          i =>
            i.hidden &&
            !revealedIds.has(i.id) &&
            !takenIds.has(i.id) &&
            i.reveal_check?.skill === 'investigation',
        );

        const newlyRevealed: string[] = [];
        for (const item of hiddenInvestigationItems) {
          const d20 = randomInt(1, 21);
          const total = d20 + investigationMod;
          const dc = item.reveal_check?.dc ?? 10;
          const success = total >= dc;
          console.log(
            `[items] search reveal-check: ${characterName} rolled ${d20}+${investigationMod}=${total} vs DC ${dc} for "${item.name}" at "${poi.template.name}" — ${success ? 'PASS' : 'FAIL'}`,
          );
          rollResults.push({ poi: poi.template.name, item: item.name, skill: 'investigation', d20, modifier: investigationMod, total, dc, success });
          if (success) newlyRevealed.push(item.id);
        }

        if (newlyRevealed.length > 0) {
          poiUpdates.push({
            id: poi.id,
            currentProperties: {
              ...currentProps,
              revealed_items: [...Array.from(revealedIds), ...newlyRevealed],
            },
          });
        }
      }

      const totalChecked = rollResults.length;
      const totalRevealed = rollResults.filter(r => r.success).length;
      console.log(`[items] search-reveal: ${totalChecked} item(s) checked across ${allPois.length} POI(s), ${totalRevealed} revealed`);

      await prisma.$transaction(async tx => {
        for (const update of poiUpdates) {
          await tx.poiInstance.update({
            where: { id: update.id },
            data: { currentProperties: update.currentProperties },
          });
        }
        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'search', total_checked: totalChecked, total_revealed: totalRevealed },
            text: `[MECHANICAL] ${characterName} searched the room${totalRevealed > 0 ? ` and found ${totalRevealed} hidden item(s).` : '.'}`,
          },
        });
        if (rollResults.length > 0) {
          const summary = rollResults.map(r => `${r.item} (${r.poi}): ${r.d20}${r.modifier !== 0 ? `+${r.modifier}` : ''}=${r.total} vs DC ${r.dc} — ${r.success ? 'found' : 'missed'}`).join(', ');
          await tx.messageLog.create({
            data: {
              roomInstanceId,
              characterId,
              isMechanicalEvent: false,
              mechanicalSummary: { type: 'roll_result', event: 'search', rolls: rollResults },
              text: `🎲 ${summary}`,
            },
          });
        }
      });

      appliedActions.push({ action, poiName: null, itemName: null });

    // ── pick_up ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'pick_up') {
      const itemId = action.item_id;
      const sourcePoi = action.target_poi_instance_id;
      if (!itemId) throw new Error('pick_up requires item_id');
      if (!sourcePoi || !validPoiMap.has(sourcePoi)) {
        throw new Error(`pick_up requires a valid target_poi_instance_id — got "${sourcePoi}"`);
      }
      const poiName = validPoiMap.get(sourcePoi)!;

      let pickedItemName = itemId;

      await prisma.$transaction(async tx => {
        const poi = await tx.poiInstance.findUniqueOrThrow({
          where: { id: sourcePoi },
          include: { template: true },
        });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const defaultProps = poi.template.defaultProperties as Record<string, unknown>;

        const templateItems = Array.isArray(defaultProps.items) ? (defaultProps.items as ItemDefinition[]) : [];
        const takenIds = new Set(
          Array.isArray(currentProps.items_taken) ? (currentProps.items_taken as string[]) : [],
        );
        const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];

        let pickedItem: ItemDefinition | undefined;
        let isFloorItem = false;

        const templateItem = templateItems.find(i => i.id === itemId && !takenIds.has(i.id));
        if (templateItem) {
          pickedItem = templateItem;
        } else {
          const floorItem = floorItems.find(i => i.id === itemId);
          if (floorItem) {
            pickedItem = floorItem;
            isFloorItem = true;
          }
        }

        if (!pickedItem) throw new Error(`Item "${itemId}" not found at "${poiName}"`);
        pickedItemName = pickedItem.name;

        if (isFloorItem) {
          await tx.poiInstance.update({
            where: { id: sourcePoi },
            data: {
              currentProperties: {
                ...currentProps,
                floor_items: floorItems.filter(i => i.id !== itemId),
              } as unknown as object,
            },
          });
        } else {
          await tx.poiInstance.update({
            where: { id: sourcePoi },
            data: {
              currentProperties: {
                ...currentProps,
                items_taken: [...Array.from(takenIds), itemId],
              },
            },
          });
        }

        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);
        inv.bag.push(pickedItem);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        console.log(`[items] pick_up: ${characterName} picked up "${pickedItem.name}" from "${poiName}"`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        if (pickedItem.story_flag) {
          await writeStoryFlags(tx, sessionId, { [pickedItem.story_flag]: true });
        }

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'pick_up', item_id: itemId, item: pickedItem.name, from_poi: poiName },
            text: `[MECHANICAL] ${characterName} picked up ${pickedItem.name} from ${poiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName, itemName: pickedItemName });

    // ── drop ───────────────────────────────────────────────────────────────
    } else if (action.action_type === 'drop') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('drop requires item_id');

      let droppedItemName = itemId;
      let targetPoiName = 'open space';

      await prisma.$transaction(async tx => {
        const participant = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const combatState = (participant?.combatState ?? {}) as { proximity_target_id?: string };

        // Prefer explicit target from parser; fall back to current proximity, then open space
        let targetPoiId =
          (action.target_poi_instance_id && validPoiMap.has(action.target_poi_instance_id))
            ? action.target_poi_instance_id
            : (combatState.proximity_target_id ?? openSpacePoiId);
        if (!targetPoiId || !validPoiMap.has(targetPoiId)) {
          targetPoiId = openSpacePoiId;
        }
        if (!targetPoiId) throw new Error('No valid drop target — open_space POI not found for this room');

        targetPoiName = validPoiMap.get(targetPoiId) ?? 'open space';

        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);
        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const [droppedItem] = inv.bag.splice(itemIdx, 1);
        droppedItemName = droppedItem.name;

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        const poi = await tx.poiInstance.findUniqueOrThrow({ where: { id: targetPoiId } });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];

        await tx.poiInstance.update({
          where: { id: targetPoiId },
          data: { currentProperties: { ...currentProps, floor_items: [...floorItems, droppedItem] } as unknown as object },
        });

        console.log(`[items] drop: ${characterName} dropped "${droppedItem.name}" at "${targetPoiName}"`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'drop', item_id: itemId, item: droppedItem.name, at_poi: targetPoiName },
            text: `[MECHANICAL] ${characterName} dropped ${droppedItem.name} at ${targetPoiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: targetPoiName, itemName: droppedItemName });

    // ── equip ──────────────────────────────────────────────────────────────
    } else if (action.action_type === 'equip') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('equip requires item_id');

      // Pre-check: fetch inventory to validate before opening a transaction
      const preCheck = await prisma.character.findUniqueOrThrow({
        where: { id: characterId },
        select: { inventory: true },
      });
      const preInv = normalizeInventory(preCheck.inventory);
      const preItem = preInv.bag.find(i => i.id === itemId);
      if (preItem && !preItem.equip_slot) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'equip_failed', item_id: itemId, item: preItem.name, reason: 'not_equippable' },
            text: `[MECHANICAL] ${characterName} cannot equip "${preItem.name}" — it has no equipment slot.`,
          },
        });
        appliedActions.push({
          action,
          poiName: null,
          itemName: preItem.name,
          overrideFact: `Character "${characterName}" tried to equip "${preItem.name}" but it cannot be worn or wielded.`,
        });
        continue;
      }

      let equippedItemName = itemId;

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const item = inv.bag[itemIdx];
        if (!item.equip_slot) throw new Error(`"${item.name}" has no equip slot`);

        const slot = item.equip_slot;
        const currentEquipped = inv.equipped[slot];
        equippedItemName = item.name;

        if (currentEquipped) {
          inv.bag[itemIdx] = currentEquipped;
          console.log(`[items] equip: ${characterName} swapped "${currentEquipped.name}" → "${item.name}" in slot ${slot}`);
        } else {
          inv.bag.splice(itemIdx, 1);
          console.log(`[items] equip: ${characterName} equipped "${item.name}" → slot ${slot}`);
        }
        inv.equipped[slot] = item;
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'equip',
              item_id: itemId,
              item: item.name,
              slot,
              swapped_out: currentEquipped?.name ?? null,
            },
            text: `[MECHANICAL] ${characterName} equipped ${item.name}${currentEquipped ? ` (replacing ${currentEquipped.name})` : ''}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: equippedItemName });

    // ── unequip ────────────────────────────────────────────────────────────
    } else if (action.action_type === 'unequip') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('unequip requires item_id');

      let unequippedItemName = itemId;

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const slotEntry = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId);
        if (!slotEntry || !slotEntry[1]) throw new Error(`Item "${itemId}" is not equipped`);

        const [slot, item] = slotEntry as [keyof CharacterInventory['equipped'], ItemDefinition];
        unequippedItemName = item.name;

        inv.bag.push(item);
        delete inv.equipped[slot];

        console.log(`[items] unequip: ${characterName} unequipped "${item.name}" from slot ${slot}`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: { event: 'unequip', item_id: itemId, item: item.name, slot },
            text: `[MECHANICAL] ${characterName} unequipped ${item.name}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: unequippedItemName });

    // ── use_item ───────────────────────────────────────────────────────────
    } else if (action.action_type === 'use_item') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('use_item requires item_id');

      let usedItemName = itemId;
      let effectDescription = 'used';

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true, currentHp: true, maxHp: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        let item: ItemDefinition | undefined;
        let itemLocation: 'bag' | 'equipped' = 'bag';
        let bagIdx = inv.bag.findIndex(i => i.id === itemId);

        if (bagIdx !== -1) {
          item = inv.bag[bagIdx];
        } else {
          const equippedEntry = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId);
          if (equippedEntry) {
            item = equippedEntry[1]!;
            itemLocation = 'equipped';
          }
        }
        if (!item) throw new Error(`Item "${itemId}" not found in inventory`);
        usedItemName = item.name;

        const charUpdates: Record<string, unknown> = {};

        if (item.use_effect) {
          if (item.use_effect.startsWith('heal_')) {
            const amount = parseInt(item.use_effect.replace('heal_', ''), 10);
            const healed = Math.min(charRow.currentHp + amount, charRow.maxHp) - charRow.currentHp;
            charUpdates.currentHp = charRow.currentHp + healed;
            effectDescription = `healed ${healed} HP (${charRow.currentHp} → ${charRow.currentHp + healed})`;
            console.log(`[items] use_item: ${characterName} used "${item.name}" — ${effectDescription}`);

          } else if (item.use_effect === 'unlock') {
            if (!action.target_poi_instance_id) {
              throw new Error('use_item "unlock" requires target_poi_instance_id');
            }
            const poi = await tx.poiInstance.findUniqueOrThrow({
              where: { id: action.target_poi_instance_id },
              include: { template: true },
            });
            const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
            const lockedBy = defaultProps.locked_by;
            const lockedByArr = Array.isArray(lockedBy)
              ? (lockedBy as string[])
              : typeof lockedBy === 'string'
              ? [lockedBy]
              : [];

            if (!lockedByArr.includes(item.id)) {
              throw new Error(`"${item.name}" does not unlock "${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}"`);
            }

            const currentProps = poi.currentProperties as Record<string, unknown>;
            await tx.poiInstance.update({
              where: { id: action.target_poi_instance_id },
              data: { currentProperties: { ...currentProps, unlocked: true } },
            });
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';
            effectDescription = `unlocked ${targetPoiName}`;
            console.log(`[items] use_item unlock: ${characterName} unlocked "${targetPoiName}" with "${item.name}"`);

          } else if (item.use_effect === 'lockpick') {
            if (!action.target_poi_instance_id) {
              throw new Error('use_item "lockpick" requires target_poi_instance_id');
            }
            const poi = await tx.poiInstance.findUniqueOrThrow({
              where: { id: action.target_poi_instance_id },
              include: { template: true },
            });
            const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
            const lockedBy = defaultProps.locked_by;
            const isLockable = Array.isArray(lockedBy)
              ? (lockedBy as string[]).length > 0
              : typeof lockedBy === 'string' && lockedBy.length > 0;
            if (!isLockable) throw new Error(`"${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}" has no lock to pick.`);
            const currentPoiProps = poi.currentProperties as Record<string, unknown>;
            if (currentPoiProps.unlocked === true) throw new Error(`"${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}" is already unlocked.`);

            const lockDc = typeof defaultProps.lock_dc === 'number' ? defaultProps.lock_dc : 15;
            const profBonus = Math.ceil(character.level / 4) + 1;
            const dexMod = Math.floor(((character.baseDexterity ?? 10) - 10) / 2);
            const sleightProficient = character.skillProficiencies.some(
              s => s.toLowerCase() === 'sleight of hand' || s.toLowerCase() === 'thieves tools',
            );
            const d20 = randomInt(1, 21);
            const total = d20 + dexMod + (sleightProficient ? profBonus : 0);
            const success = total >= lockDc;
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';

            console.log(`[items] lockpick: ${characterName} rolled ${d20}+${dexMod}${sleightProficient ? `+${profBonus}` : ''}=${total} vs DC ${lockDc} — ${success ? 'SUCCESS' : 'FAIL'}`);

            await tx.messageLog.create({
              data: {
                roomInstanceId,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: { type: 'roll_result', event: 'lockpick', poi: targetPoiName, d20, modifier: dexMod + (sleightProficient ? profBonus : 0), total, dc: lockDc, success },
                text: `🎲 Lockpick ${targetPoiName}: ${d20}+${dexMod + (sleightProficient ? profBonus : 0)}=${total} vs DC ${lockDc} — ${success ? 'success' : 'fail'}`,
              },
            });

            if (success) {
              await tx.poiInstance.update({
                where: { id: action.target_poi_instance_id },
                data: { currentProperties: { ...currentPoiProps, unlocked: true } },
              });
              effectDescription = `picked the lock on ${targetPoiName} (DC ${lockDc}, rolled ${total})`;
            } else {
              effectDescription = `failed to pick the lock on ${targetPoiName} (DC ${lockDc}, rolled ${total})`;
            }
          }
        }

        // Consumption logic
        if (item.charges !== undefined) {
          item.charges -= 1;
          if (item.charges <= 0 && item.on_depleted === 'destroy') {
            if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
            }
          } else {
            if (itemLocation === 'bag') inv.bag[bagIdx] = item;
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) inv.equipped[slot as keyof CharacterInventory['equipped']] = item;
            }
          }
        } else if (item.consumable) {
          if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
          else {
            const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
            if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
          }
        }

        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object, ...charUpdates },
        });

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'use_item',
              item_id: itemId,
              item: item.name,
              effect: item.use_effect ?? null,
              result: effectDescription,
            },
            text: `[MECHANICAL] ${characterName} used ${item.name}: ${effectDescription}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: null, itemName: usedItemName });

    // ── throw_item ─────────────────────────────────────────────────────────
    } else if (action.action_type === 'throw_item') {
      const itemId = action.item_id;
      if (!itemId) throw new Error('throw_item requires item_id');

      let thrownItemName = itemId;
      let landingPoiName = 'open space';

      await prisma.$transaction(async tx => {
        const charRow = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: { inventory: true },
        });
        const inv = normalizeInventory(charRow.inventory);

        const itemIdx = inv.bag.findIndex(i => i.id === itemId);
        if (itemIdx === -1) throw new Error(`Item "${itemId}" not in bag`);
        const item = inv.bag[itemIdx];
        if (!item.throwable) throw new Error(`"${item.name}" is not throwable`);
        thrownItemName = item.name;
        inv.bag.splice(itemIdx, 1);

        // Resolve landing POI
        let landingPoiId = action.target_poi_instance_id;
        if (!landingPoiId || !validPoiMap.has(landingPoiId)) {
          landingPoiId = openSpacePoiId;
        }
        if (!landingPoiId) throw new Error('No valid landing location — open_space POI not found');
        landingPoiName = validPoiMap.get(landingPoiId) ?? 'open space';

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        const poi = await tx.poiInstance.findUniqueOrThrow({ where: { id: landingPoiId } });
        const currentProps = poi.currentProperties as Record<string, unknown>;
        const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];

        await tx.poiInstance.update({
          where: { id: landingPoiId },
          data: { currentProperties: { ...currentProps, floor_items: [...floorItems, item] } as unknown as object },
        });

        console.log(`[items] throw_item: ${characterName} threw "${item.name}" → "${landingPoiName}"`);
        console.log(`[items] inventory: ${inventorySummary(inv)}`);

        await tx.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: true,
            mechanicalSummary: {
              event: 'throw_item',
              item_id: itemId,
              item: item.name,
              landing_poi: landingPoiName,
            },
            text: `[MECHANICAL] ${characterName} threw ${item.name} toward ${landingPoiName}.`,
          },
        });
      });

      appliedActions.push({ action, poiName: landingPoiName, itemName: thrownItemName });

    // ── narrative_only (and fallthrough) ───────────────────────────────────
    } else {
      await prisma.messageLog.create({
        data: {
          roomInstanceId,
          characterId,
          isMechanicalEvent: true,
          mechanicalSummary: { event: 'narrative_only' },
          text: `[MECHANICAL] ${characterName} performed a narrative action with no positional change.`,
        },
      });
      appliedActions.push({ action, poiName: null, itemName: null });
    }
  }

  return { appliedActions, newRoomInstanceId };
}

// ─── Stage 4: Narrative Generation ───────────────────────────────────────────

async function generateAndPersistNarrative(
  roomInstanceId: string,
  characterId: string,
  characterName: string,
  roomName: string,
  roomDescription: string,
  appliedActions: AppliedAction[],
  sessionId: string,
): Promise<void> {
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

  const historyBlock = chronologicalLogs
    .map((log, i) => `[${i + 1}] ${log.text}`)
    .join('\n');

  console.log('[narrative] room:', roomName);
  console.log('[narrative] fact block:', mechanicalFactBlock);

  const narrativeResponse = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildNarrativeSystemPrompt(roomName, roomDescription, mechanicalFactBlock, itemsBlock, storyFlags),
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

  await prisma.messageLog.create({
    data: {
      roomInstanceId,
      characterId,
      isMechanicalEvent: false,
      text: narrativeText,
    },
  });
}

// ─── Stage 5: View State Packager ────────────────────────────────────────────

async function buildViewState(
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
): Promise<ViewStatePayload> {
  const [recentNarrative, participants, charRow, poiInstances] = await Promise.all([
    prisma.messageLog.findMany({
      where: { roomInstanceId, isMechanicalEvent: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, text: true, isMechanicalEvent: true, mechanicalSummary: true, createdAt: true },
    }),
    prisma.roomParticipant.findMany({
      where: { roomInstanceId },
      include: { character: { select: { id: true, name: true } } },
    }),
    prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { inventory: true },
    }),
    prisma.poiInstance.findMany({
      where: { roomInstanceId },
      include: { template: true },
    }),
  ]);

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
      // open_space items are exposed at top level, not in poiStates
      openSpaceItems = allItems;
      uiLayoutAnchors[poi.id] = []; // still register as anchor for characters
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

    const rawPeek = (defaultProps.peek_visibility as string) ?? 'none';
    const lockedBy = defaultProps.locked_by;
    const isLockable = Array.isArray(lockedBy)
      ? (lockedBy as string[]).length > 0
      : typeof lockedBy === 'string' && lockedBy.length > 0;
    const effectivePeek = isLockable && currentProps.unlocked !== true ? 'none' : rawPeek;

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

  return {
    roomInstanceId,
    currentNarrative: recentNarrative.reverse(),
    activeState: gameState,
    poiIndex,
    poiStates,
    uiLayoutAnchors,
    characterInventory,
    openSpaceItems,
    adjacentRoomPreviews,
  };
}

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

async function checkAndAdvanceAct(sessionId: string): Promise<void> {
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
  console.log(`[act] act ${currentAct} complete → advancing to act ${currentAct + 1}`);

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
  });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleGameAction(body: GameActionRequest): Promise<ViewStatePayload> {
  const { characterId, roomInstanceId, playerActionText } = body;

  if (!characterId || !roomInstanceId || !playerActionText) {
    throw new Error('Missing required fields: characterId, roomInstanceId, playerActionText');
  }

  {
    // Stage 1
    const { character, roomInstance } = await lookupDatabaseContext(characterId, roomInstanceId);
    const characterInventory = normalizeInventory(character.inventory);

    const poiContexts: PoiContext[] = roomInstance.poiInstances.map(poi => {
      const defaultProps = poi.template.defaultProperties as Record<string, unknown>;
      const currentProps = poi.currentProperties as Record<string, unknown>;
      const { items, floorItems } = extractPoiItems(defaultProps, currentProps);
      const lockedBy = defaultProps.locked_by;
      const isLockable = Array.isArray(lockedBy)
        ? (lockedBy as string[]).length > 0
        : typeof lockedBy === 'string' && lockedBy.length > 0;
      const isLocked = isLockable && currentProps.unlocked !== true;
      const isUnlocked = isLockable && currentProps.unlocked === true;
      return {
        id: poi.id,
        name: poi.template.name,
        keyword: poi.template.keywordIdentifier,
        availableStances: extractAvailableStances(poi.template.defaultProperties),
        ...extractExplorationFlags(poi.currentProperties),
        isLocked,
        isUnlocked,
        ...extractExitInfo(poi.template.defaultProperties),
        items,
        floorItems,
        isOpenSpace: (defaultProps.poi_type as string) === 'open_space',
        visibility: resolveEffectiveVisibility(defaultProps, currentProps),
        peekVisibility: ((defaultProps.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
      };
    });

    const validPoiMap = new Map(roomInstance.poiInstances.map(poi => [poi.id, poi.template.name]));
    const exitPoiMap = new Map(
      poiContexts
        .filter(p => p.isExit && p.targetRoomTemplateId)
        .map(p => [p.id, p.targetRoomTemplateId!]),
    );
    const openSpacePoiId = poiContexts.find(p => p.isOpenSpace)?.id ?? null;

    const otherCharacters = roomInstance.participants
      .filter(p => p.characterId !== characterId)
      .map(p => ({ id: p.characterId, name: p.character.name }));

    const selfParticipant = roomInstance.participants.find(p => p.characterId === characterId);
    const currentProximityPoiId =
      ((selfParticipant?.combatState as Record<string, unknown> | null)?.proximity_target_id as string) ?? null;

    // Persist player action before AI stages so it's in history
    await prisma.messageLog.create({
      data: {
        roomInstanceId,
        characterId,
        isMechanicalEvent: false,
        mechanicalSummary: { type: 'player_action' },
        text: playerActionText,
      },
    });

    // If character is standing at a visible exit, fetch adjacent room POIs so
    // Haiku can reference them by real instance ID (cross-room actions).
    let adjacentRoom: AdjacentRoomContext | null = null;
    if (currentProximityPoiId) {
      const proximityCtx = poiContexts.find(p => p.id === currentProximityPoiId);
      if (proximityCtx?.isExit && proximityCtx.targetRoomTemplateId) {
        // Determine effective peek: doors only become visible after being opened
        const doorOpened = proximityCtx.interacted;
        const effectivePeek = proximityCtx.peekVisibility === 'none' && doorOpened
          ? 'obvious_only'
          : proximityCtx.peekVisibility;
        if (effectivePeek !== 'none') {
          // Fetch or lazily create the adjacent room instance so we have real POI IDs
          let adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: proximityCtx.targetRoomTemplateId },
            include: { template: true, poiInstances: { include: { template: true } } },
          });
          if (!adjRoom) {
            const adjTemplate = await prisma.roomTemplate.findUniqueOrThrow({
              where: { id: proximityCtx.targetRoomTemplateId },
              include: { poiTemplates: true },
            });
            adjRoom = await prisma.roomInstance.create({
              data: {
                sessionId: roomInstance.session.id,
                roomTemplateId: proximityCtx.targetRoomTemplateId,
                poiInstances: {
                  create: adjTemplate.poiTemplates.map(pt => ({ poiTemplateId: pt.id, currentProperties: {} })),
                },
              },
              include: { template: true, poiInstances: { include: { template: true } } },
            });
          }
          // Character's current grid_slot — from proximity target template, or 'C' for open space
          const proximityPoiInstance = currentProximityPoiId
            ? roomInstance.poiInstances.find(pi => pi.id === currentProximityPoiId)
            : null;
          const charGridSlot = proximityPoiInstance?.template.grid_slot ?? 'C';
          const exitDirection = proximityPoiInstance?.template.exit_direction ?? '';
          const exitWallSection = proximityPoiInstance?.template.exit_wall_section ?? 'C';
          const exitArchWidth = proximityPoiInstance?.template.exit_arch_width ?? 1;
          // 'obvious_only' shows visibility_level >= 2; 'full' shows everything
          const minVisLevel = effectivePeek === 'full' ? 1 : 2;

          const adjPois: PoiContext[] = adjRoom.poiInstances
            .filter(pi => {
              const dp = pi.template.defaultProperties as Record<string, unknown>;
              if (dp.poi_type === 'open_space') return false;
              if (pi.template.visibility_level < minVisLevel) return false;
              if (!exitDirection) return true;
              return isPoiVisibleThroughExit(
                charGridSlot,
                pi.template.grid_slot,
                exitDirection,
                exitWallSection,
                exitArchWidth,
              );
            })
            .map(pi => {
              const dp = pi.template.defaultProperties as Record<string, unknown>;
              const { items, floorItems } = extractPoiItems(dp, pi.currentProperties);
              const adjLockedBy = dp.locked_by;
              const adjIsLockable = Array.isArray(adjLockedBy)
                ? (adjLockedBy as string[]).length > 0
                : typeof adjLockedBy === 'string' && adjLockedBy.length > 0;
              const adjCurrentProps = pi.currentProperties as Record<string, unknown>;
              const adjIsLocked = adjIsLockable && adjCurrentProps.unlocked !== true;
              const adjIsUnlocked = adjIsLockable && adjCurrentProps.unlocked === true;
              return {
                id: pi.id,
                name: pi.template.name,
                keyword: pi.template.keywordIdentifier,
                availableStances: extractAvailableStances(pi.template.defaultProperties),
                ...extractExplorationFlags(pi.currentProperties),
                isLocked: adjIsLocked,
                isUnlocked: adjIsUnlocked,
                ...extractExitInfo(pi.template.defaultProperties),
                items,
                floorItems,
                isOpenSpace: false,
                visibility: resolveEffectiveVisibility(dp, pi.currentProperties as Record<string, unknown>),
                peekVisibility: ((dp.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
              };
            });
          adjacentRoom = {
            roomName: adjRoom.template.name,
            exitPoiId: currentProximityPoiId,
            exitPoiName: proximityCtx.name,
            targetRoomTemplateId: proximityCtx.targetRoomTemplateId,
            pois: adjPois,
          };
          console.log(`[adjacent] fetched ${adjPois.length} POI(s) from "${adjRoom.template.name}" via "${proximityCtx.name}"`);
        }
      }
    }

    // Stage 2
    const parsedActions = await parseIntentWithHaiku(
      poiContexts,
      characterInventory,
      otherCharacters,
      playerActionText,
      currentProximityPoiId,
      adjacentRoom,
    );

    // Validate item IDs from parser against known items (including adjacent room items)
    const knownItemIds = new Set([
      ...characterInventory.bag.map(i => i.id),
      ...Object.values(characterInventory.equipped)
        .filter((i): i is ItemDefinition => i != null)
        .map(i => i.id),
      ...poiContexts.flatMap(p => [...p.items, ...p.floorItems].map(i => i.id)),
      ...(adjacentRoom?.pois.flatMap(p => [...p.items, ...p.floorItems].map(i => i.id)) ?? []),
    ]);
    for (const action of parsedActions) {
      if (action.item_id && !knownItemIds.has(action.item_id)) {
        console.warn(`[intent-parser] WARNING: Haiku returned unknown item_id "${action.item_id}" — nulling out`);
        action.item_id = null;
      }
    }

    // Stage 3
    const characterCtx: CharacterContext = {
      id: characterId,
      name: character.name,
      level: character.level,
      skillsModifiers: character.skillsModifiers,
      skillProficiencies: character.skillProficiencies,
      baseWisdom: character.baseWisdom,
      baseDexterity: character.baseDexterity,
      currentHp: character.currentHp,
      maxHp: character.maxHp,
    };

    const { appliedActions, newRoomInstanceId } = await mutateGameState(
      parsedActions,
      characterCtx,
      roomInstanceId,
      roomInstance.session.id,
      exitPoiMap,
      validPoiMap,
      openSpacePoiId,
    );

    // Check whether any story flags set this turn complete the current act
    await checkAndAdvanceAct(roomInstance.session.id);

    // Resolve active room context (may change after move_to_room)
    let activeRoomInstanceId = roomInstanceId;
    let activeRoomName = roomInstance.template.name;
    let activeRoomDescription = roomInstance.template.baseDescription;
    let activeGameState = roomInstance.session.gameState;
    let activeCharacterProximityTargetId: string | null = null;

    // Read current participant proximity for LoS filter
    const participant = await prisma.roomParticipant.findUnique({
      where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
    });
    activeCharacterProximityTargetId =
      ((participant?.combatState as Record<string, unknown>)?.proximity_target_id as string) ?? null;

    if (newRoomInstanceId) {
      activeRoomInstanceId = newRoomInstanceId;
      activeCharacterProximityTargetId = null; // just arrived, in open space
      const newRoom = await prisma.roomInstance.findUniqueOrThrow({
        where: { id: newRoomInstanceId },
        include: {
          template: true,
          session: { select: { gameState: true } },
        },
      });
      activeRoomName = newRoom.template.name;
      activeRoomDescription = newRoom.template.baseDescription;
      activeGameState = newRoom.session.gameState;
    }

    // Stage 4
    await generateAndPersistNarrative(
      activeRoomInstanceId,
      characterId,
      character.name,
      activeRoomName,
      activeRoomDescription,
      appliedActions,
      roomInstance.session.id,
    );

    // Stage 5 — always fetches fresh POI state from DB
    const viewState = await buildViewState(
      activeRoomInstanceId,
      activeGameState,
      characterId,
      roomInstance.session.id,
      activeCharacterProximityTargetId,
    );

    return viewState;
  }
}
