import { randomInt } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { computeIsLockable, computeEffectivePeek } from '@/lib/v2/poi-utils';
import { rollInitiative } from '@/lib/initiative';
import { abilityModifier, rollD20Check, rollDice } from '@/lib/dice';
import { computeAttackDamage } from '@/lib/mechanical-damage';
import { rollStealthCheck } from '@/lib/stealth';
import type {
  GameActionRequest,
  ExtractedAction,
  ItemDefinition,
  CharacterInventory,
  EntityRef,
  UiLayoutAnchors,
  AdjacentRoomPreview,
  ViewStatePayload,
  CombatState,
  InitiativeEntry,
} from '@/types/v2-game';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Item Helpers ─────────────────────────────────────────────────────────────

export function normalizeInventory(raw: unknown): CharacterInventory {
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
  // Combat awareness (populated from currentProperties / defaultProperties)
  _currentAwareness?: string;
  _hostileTo?: string[];
  _recognitionException?: string;
  _combatStats?: PoiCombatStats;
  _aiBehavior?: AiBehavior;
  _defaultProps?: Record<string, unknown>;
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
- "use_item"         — Player uses an item (drink a potion, use a key on a lock, throw a grenade, etc.). Set item_id. If the target is an enemy or a POI (lock, container, trap), set target_poi_instance_id. If the target is an ally party member listed under OTHER CHARACTERS, set target_character_id. Never set target_character_id for enemies — use target_poi_instance_id instead.
- "throw_item"       — Player throws an item. Set item_id. Optionally set target_poi_instance_id for landing location.
- "narrative_only"   — Purely conversational or idle (talking to self, waiting in place). Do NOT use this for any movement, exploration, or interaction — even vague ones.
- "attack"           — Player intends to strike an NPC or enemy. Set target_poi_instance_id to the enemy's POI instance ID if identifiable.
- "dodge"            — Player takes the Dodge action in combat. No target needed.
- "dash"             — Player takes the Dash action in combat. No target needed.
- "disengage"        — Player takes the Disengage action to avoid opportunity attacks.
- "hide"             — Player attempts to hide. No target needed.
- "provoke"          — Player attempts to taunt or intimidate an enemy. Set target_poi_instance_id to the enemy's POI instance ID if identifiable.
- "death_save"       — Player at 0 HP makes a death saving throw. No target needed.

RULES:
- You MUST call the extract_game_intent tool. No exceptions.
- target_poi_instance_id MUST be one of the listed POI IDs above (including VISIBLE FROM CURRENT EXIT), or null.
- resulting_stance MUST exactly match one of that POI's listed available stances, or null.
- item_id MUST exactly match an item id listed in CHARACTER INVENTORY or in a POI's items list, or null.
- target_character_id MUST exactly match one of the OTHER CHARACTERS ids listed above, or null.
- interaction_result is only set for "interact" actions; null otherwise.
- LOOT RULE: If the player says "grab", "take", "loot", "steal", "search", or "pick up" targeting a specific POI but the named item does NOT appear in that POI's visible items list, emit "interact" on that POI (not "examine" and not "pick_up"). The engine will expose the items. Set interaction_result to "loot" (or a fitting verb).
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
  partyNames?: string[],
): string {
  const flagEntries = Object.entries(storyFlags);
  const flagsBlock = flagEntries.length > 0
    ? flagEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : '  (none set)';
  const partyLine = partyNames && partyNames.length > 1
    ? `\nPARTY MEMBERS IN THIS ROOM: ${partyNames.join(', ')}\n`
    : '';

  return `You are a realistic and immersive Dungeon Master narrating an asynchronous text-based D&D adventure.
${partyLine}
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
- Do NOT describe future actions or ask the player what they want to do next.
- EXIT/DOOR RULE: The EXIT STATES block is authoritative. If a door or gate is listed as "closed" or "locked", the character has NOT opened it, unlocked it, or passed through it — even if the action brought them to the doorway. Do NOT write that any door was opened, pushed, or traversed unless the engine update explicitly says so.
- APPROACH RULE: A "change_proximity" action means the character walked up to a POI and stopped. Narrate their arrival at it. If the ENGINE UPDATE includes "peers through" or "Visible from this vantage", also describe what the character sees through the opening — use only the listed POI names, do not invent contents.`;
}

// ─── Stage 1: Database Context Lookup ────────────────────────────────────────

const roomInstanceQuery = (roomInstanceId: string) =>
  prisma.roomInstance.findUniqueOrThrow({
    where: { id: roomInstanceId },
    include: {
      template: true,
      session: { select: { id: true, gameState: true, storyFlags: true, kickedCharacterIds: true } },
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
        isHiding: true,
        stealthRoll: true,
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
  actionHint?: string | null,
): Promise<ExtractedAction[]> {
  const userContent = actionHint
    ? `[ACTION HINT: ${actionHint}]\n${playerActionText}`
    : playerActionText;
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
                      'attack',
                      'dodge',
                      'dash',
                      'disengage',
                      'hide',
                      'provoke',
                      'death_save',
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

  // Sanitize <UNKNOWN> placeholders — treat as unresolved (null)
  for (const a of actions) {
    if (a.target_character_id === '<UNKNOWN>') a.target_character_id = null;
    if (a.target_poi_instance_id === '<UNKNOWN>') a.target_poi_instance_id = null;
    if (a.target_room_template_id === '<UNKNOWN>') a.target_room_template_id = null;
  }

  console.log('[intent-parser] input:', playerActionText);
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

// ─── Combat: Enter / Exit ─────────────────────────────────────────────────────

interface PoiCombatStats {
  dex_score?: number;
  wis_score?: number;
  attack_bonus?: number;
  damage?: string;
  max_hp?: number;
  ac?: number;
  passive_perception?: number;
  resistances?: string[];
}

interface AiBehavior {
  priority?: 'aggressive' | 'defensive' | 'cowardly';
  flee_threshold?: number;
}

export function detectCombatTrigger(
  extractedAction: ExtractedAction,
  poiContexts: PoiContext[],
  sessionGameState: string,
  storyFlags: Record<string, unknown>,
): boolean {
  if (extractedAction.action_type === 'attack') return true;
  if (sessionGameState !== 'exploration') return false;
  for (const poi of poiContexts) {
    const dp = (poi as unknown as { _defaultProps?: Record<string, unknown> })._defaultProps;
    const awareness = poi._currentAwareness;
    if (!awareness) continue;
    if (awareness !== 'alert') continue;
    const hostileTo = poi._hostileTo as string[] | undefined;
    if (!hostileTo || hostileTo.length === 0) continue;
    const recognitionException = poi._recognitionException as string | undefined;
    if (recognitionException && storyFlags[recognitionException]) continue;
    return true;
  }
  return false;
}

interface CombatPoiContext extends PoiContext {
  _currentAwareness?: string;
  _hostileTo?: string[];
  _recognitionException?: string;
  _combatStats?: PoiCombatStats;
  _aiBehavior?: AiBehavior;
  _currentHp?: number;
  _defaultProps?: Record<string, unknown>;
}

export async function enterCombat(
  roomInstance: { id: string; poiInstances: Array<{ id: string; poiTemplateId: string; currentProperties: unknown; template: { defaultProperties: unknown; name: string; grid_slot?: string | null } }> },
): Promise<CombatState> {
  const DORMANT_MS = 48 * 60 * 60 * 1000;

  // Already-in-combat guard
  const roomRow = await prisma.roomInstance.findUnique({ where: { id: roomInstance.id }, select: { gameState: true, combatState: true } });
  if (roomRow?.gameState === 'combat' && roomRow.combatState) {
    return roomRow.combatState as unknown as CombatState;
  }

  // Load all room participants with character stats + lastActiveAt
  const roomParticipants = await prisma.roomParticipant.findMany({
    where: { roomInstanceId: roomInstance.id },
    include: {
      character: {
        select: { id: true, name: true, baseDexterity: true, currentHp: true, maxHp: true },
      },
    },
  });

  // Collect alert enemies (skip already-dead ones)
  const alertEnemies: Array<{ poiInstanceId: string; name: string; combatStats: PoiCombatStats; currentHp: number; ac: number }> = [];
  for (const poi of roomInstance.poiInstances) {
    const dp = poi.template.defaultProperties as Record<string, unknown>;
    const cp = poi.currentProperties as Record<string, unknown>;
    if (cp.awareness_state !== 'alert') continue;
    const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
    const maxHp = combatStats.max_hp ?? 10;
    const currentHp = typeof cp.current_hp === 'number' ? cp.current_hp : maxHp;
    if (currentHp <= 0) continue;
    alertEnemies.push({ poiInstanceId: poi.id, name: poi.template.name, combatStats, currentHp, ac: combatStats.ac ?? 10 });
  }

  // Build actors for initiative
  const actors = [
    ...roomParticipants.map(rp => ({
      actorId: rp.characterId,
      actorType: 'CHARACTER' as const,
      dexterity: rp.character.baseDexterity,
    })),
    ...alertEnemies.map(e => ({
      actorId: e.poiInstanceId,
      actorType: 'ENEMY' as const,
      dexterity: e.combatStats.dex_score ?? 10,
    })),
  ];

  const slots = rollInitiative(actors);

  // Check unaware enemies (surprised)
  const unawarePoiIds = new Set(
    roomInstance.poiInstances
      .filter(pi => (pi.currentProperties as Record<string, unknown>).awareness_state === 'unaware')
      .map(pi => pi.id),
  );

  // Build initiative order with isDormant stamping
  const initiativeOrder: InitiativeEntry[] = slots.map(slot => {
    const rp = roomParticipants.find(p => p.characterId === slot.actorId);
    if (rp) {
      return {
        id: rp.characterId,
        type: 'character',
        name: rp.character.name,
        initiative: slot.initiative,
        hp: rp.character.currentHp,
        maxHp: rp.character.maxHp,
        ac: 10 + abilityModifier(rp.character.baseDexterity),
        surprised: false,
        acted: false,
        proximity: 'close',
        status_effects: [],
        isDormant: Date.now() - rp.lastActiveAt.getTime() > DORMANT_MS,
      };
    }
    const enemy = alertEnemies.find(e => e.poiInstanceId === slot.actorId)!;
    const enemyPoi = roomInstance.poiInstances.find(p => p.id === slot.actorId);
    return {
      id: slot.actorId,
      type: 'enemy',
      name: enemy.name,
      initiative: slot.initiative,
      hp: enemy.currentHp,
      maxHp: enemy.combatStats.max_hp ?? 10,
      ac: enemy.ac,
      surprised: unawarePoiIds.has(slot.actorId),
      acted: false,
      proximity: 'close',
      grid_slot: enemyPoi?.template.grid_slot ?? 'C',
      status_effects: [],
      resistances: enemy.combatStats.resistances ?? [],
      passive_perception: enemy.combatStats.passive_perception ?? (10 + abilityModifier(enemy.combatStats.wis_score ?? 10)),
    };
  });

  // First valid (non-dormant, non-dead) actor goes first
  const firstValid = initiativeOrder.find(e => !e.isDormant && !(e.type === 'enemy' && e.hp <= 0));
  const combatState: CombatState = {
    round: 1,
    initiativeOrder,
    activeActorId: firstValid?.id ?? initiativeOrder[0]?.id ?? '',
    currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
  };

  // Build the rich roll breakdown for the combat_start message
  const initiativeRolls = slots.map(slot => {
    const entry = initiativeOrder.find(e => e.id === slot.actorId);
    return {
      id: slot.actorId,
      name: entry?.name ?? slot.actorId,
      type: slot.actorType === 'CHARACTER' ? 'character' : 'enemy',
      d20Roll: slot.d20Roll,
      modifier: slot.modifier,
      initiative: slot.initiative,
    };
  });

  await Promise.all([
    prisma.roomInstance.update({
      where: { id: roomInstance.id },
      data: { gameState: 'combat', combatState: combatState as object },
    }),
    prisma.messageLog.create({
      data: {
        roomInstanceId: roomInstance.id,
        isMechanicalEvent: false,
        mechanicalSummary: {
          type: 'combat_start',
          round: 1,
          initiativeRolls,
          activeActorId: combatState.activeActorId,
        },
        text: `[COMBAT] Initiative rolled — ${initiativeRolls.map(r => `${r.name} ${r.d20Roll}${r.modifier !== 0 ? (r.modifier > 0 ? `+${r.modifier}` : `${r.modifier}`) : ''}=${r.initiative}`).join(', ')}. First to act: ${initiativeOrder.find(e => e.id === combatState.activeActorId)?.name ?? 'unknown'}.`,
      },
    }),
  ]);

  console.log(`[stage3:combat] entering combat — room=${roomInstance.id} pcs=${roomParticipants.length} enemies=${alertEnemies.length}`);
  console.log(`[stage3:initiative] order=[${initiativeOrder.map(e => e.name).join(' → ')}]`);

  return combatState;
}

export async function exitCombat(roomInstanceId: string): Promise<void> {
  await prisma.roomInstance.update({
    where: { id: roomInstanceId },
    data: { gameState: 'exploration', combatState: Prisma.JsonNull },
  });
  console.log('[stage3:combat] combat ended — all enemies dead');
}

// ─── Combat: Opportunity Attacks (Phase 5) ───────────────────────────────────

export interface OpportunityAttackResult {
  facts: string[];
  hpDamage: number;
  updatedCombatState: CombatState;
}

export function resolveOpportunityAttacks(
  cs: CombatState,
  characterId: string,
  characterName: string,
  poiInstances: Array<{ id: string; template: { defaultProperties: unknown } }>,
): OpportunityAttackResult {
  const facts: string[] = [];
  let hpDamage = 0;

  const playerEntry = cs.initiativeOrder.find(e => e.id === characterId);
  const hasDisengaged = playerEntry?.status_effects.includes('disengaged') ?? false;
  if (hasDisengaged) {
    return { facts, hpDamage, updatedCombatState: cs };
  }

  const charAc = playerEntry?.ac ?? 10;
  let order = cs.initiativeOrder.map(e => ({ ...e }));

  for (let i = 0; i < order.length; i++) {
    const entry = order[i];
    if (entry.type !== 'enemy') continue;
    if (entry.proximity !== 'close') continue;
    if (entry.reactionUsed) continue;
    if (entry.hp <= 0) continue;

    const poi = poiInstances.find(p => p.id === entry.id);
    const dp = (poi?.template?.defaultProperties ?? {}) as Record<string, unknown>;
    const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
    const attackBonus = combatStats.attack_bonus ?? 0;
    const damageDice = combatStats.damage ?? '1d4';

    const roll = rollD20Check(attackBonus, charAc, 'AC');
    order[i] = { ...entry, reactionUsed: true };

    if (roll.fumble) {
      facts.push(`${entry.name} swings at ${characterName} (opportunity) — rolled 1, miss.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=1 hit=false damage=0`);
    } else if (roll.success || roll.critical) {
      const { total: damage } = computeAttackDamage(damageDice, 0, roll.critical);
      hpDamage += damage;
      facts.push(`${entry.name} strikes ${characterName} as they flee — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${charAc}, hit, dealt ${damage} damage.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=${roll.roll} vs AC=${charAc} hit=true damage=${damage}`);
    } else {
      facts.push(`${entry.name} swings at ${characterName} (opportunity) — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${charAc}, miss.`);
      console.log(`[stage3:opportunity] ${entry.name} opportunity attack — roll=${roll.roll} vs AC=${charAc} hit=false damage=0`);
    }
  }

  return { facts, hpDamage, updatedCombatState: { ...cs, initiativeOrder: order } };
}

// ─── Combat: Enemy AI Turn Resolution (Phase 4) ──────────────────────────────

export interface EnemyTurnResult {
  facts: string[];
  hpDamage: number;
  updatedEntry: InitiativeEntry;
  rollData?: {
    type: 'combat_roll';
    action: string;
    d20: number;
    modifier: number;
    total: number;
    vsTarget: string;
    success: boolean;
    isCrit?: boolean;
    damageRoll?: { dice: string; expr: string; total: number };
    rollMode?: 'advantage' | 'disadvantage';
    d20Rolls?: [number, number];
  };
}

export function resolveEnemyTurn(
  entry: InitiativeEntry,
  cs: CombatState,
  characterId: string,
  characterName: string,
  defaultProps: Record<string, unknown>,
  playerGridSlot = 'C',
): EnemyTurnResult {
  const facts: string[] = [];
  let hpDamage = 0;
  let updatedEntry = { ...entry };

  if (entry.surprised) {
    updatedEntry = { ...entry, surprised: false };
    facts.push(`${entry.name} is surprised and loses their turn.`);
    console.log(`[stage3:enemy-turn] ${entry.name} — action=skip (surprised)`);
    return { facts, hpDamage, updatedEntry };
  }

  const combatStats = (defaultProps.combat_stats ?? {}) as PoiCombatStats;
  const aiBehavior = (defaultProps.ai_behavior ?? {}) as AiBehavior;
  const priority = aiBehavior.priority ?? 'aggressive';
  const fleeThreshold = aiBehavior.flee_threshold ?? 0;

  const charEntry = cs.initiativeOrder.find(e => e.id === characterId);
  const characterAc = charEntry?.ac ?? 10;
  const playerDodging = charEntry?.status_effects.includes('dodging') ?? false;

  const hasPriorityTarget =
    entry.priority_target === characterId &&
    (entry.priority_target_until_round === undefined || cs.round <= entry.priority_target_until_round);

  type EnemyAction = 'attack' | 'move' | 'flee' | 'hold';
  let action: EnemyAction = 'hold';

  if (hasPriorityTarget || priority === 'aggressive') {
    action = entry.proximity === 'close' ? 'attack' : 'move';
  } else if (priority === 'defensive') {
    action = entry.proximity === 'close' ? 'attack' : 'hold';
  } else if (priority === 'cowardly') {
    const hpPercent = entry.maxHp > 0 ? entry.hp / entry.maxHp : 1;
    action = hpPercent <= fleeThreshold ? 'flee' : 'attack';
  }

  console.log(`[stage3:enemy-turn] ${entry.name} — action=${action} target=${characterName}`);

  if (action === 'attack') {
    const attackBonus = combatStats.attack_bonus ?? 0;
    const damageDice = combatStats.damage ?? '1d4';
    const hasAdvantage = entry.status_effects.includes('advantage_next_attack');
    const hasDisadvantage = playerDodging;

    let roll = rollD20Check(attackBonus, characterAc, 'AC');
    let rollMode: 'advantage' | 'disadvantage' | undefined;
    let d20Rolls: [number, number] | undefined;
    if (hasAdvantage && !hasDisadvantage) {
      const roll2 = rollD20Check(attackBonus, characterAc, 'AC');
      d20Rolls = [roll.roll, roll2.roll];
      roll = roll2.roll > roll.roll ? roll2 : roll;
      rollMode = 'advantage';
    } else if (hasDisadvantage && !hasAdvantage) {
      const roll2 = rollD20Check(attackBonus, characterAc, 'AC');
      d20Rolls = [roll.roll, roll2.roll];
      roll = roll2.roll < roll.roll ? roll2 : roll;
      rollMode = 'disadvantage';
    }
    const rollModeFields = rollMode ? { rollMode, d20Rolls } : {};

    if (hasAdvantage) {
      updatedEntry = { ...updatedEntry, status_effects: updatedEntry.status_effects.filter(s => s !== 'advantage_next_attack') };
    }

    let rollData: EnemyTurnResult['rollData'];
    if (roll.fumble) {
      facts.push(`${entry.name} attacked ${characterName} — rolled 1 (fumble), miss.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=1 vs AC=${characterAc} hit=false damage=0`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
    } else if (roll.success || roll.critical) {
      const { total: damage, expr: dmgExpr } = computeAttackDamage(damageDice, 0, roll.critical);
      hpDamage = damage;
      facts.push(`${entry.name} attacked ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, ${roll.critical ? 'CRITICAL HIT' : 'hit'}, dealt ${damage} damage.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=${roll.roll} vs AC=${characterAc} hit=true damage=${damage}`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: true, isCrit: roll.critical || undefined, damageRoll: { dice: `${damageDice}${roll.critical ? ' ×2' : ''}`, expr: dmgExpr, total: damage }, ...rollModeFields };
    } else {
      facts.push(`${entry.name} attacked ${characterName} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${characterAc}, miss.`);
      console.log(`[stage3:enemy-attack] ${entry.name} roll=${roll.roll} vs AC=${characterAc} hit=false damage=0`);
      rollData = { type: 'combat_roll', action: `${entry.name} attacks`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${characterAc}`, success: false, ...rollModeFields };
    }
    updatedEntry = { ...updatedEntry, grid_slot: playerGridSlot };
    return { facts, hpDamage, updatedEntry, rollData };
  } else if (action === 'move') {
    updatedEntry = { ...updatedEntry, proximity: 'close', grid_slot: playerGridSlot };
    facts.push(`${entry.name} moves to close range.`);
  } else if (action === 'flee') {
    facts.push(`${entry.name} attempts to flee!`);
  } else {
    facts.push(`${entry.name} holds position.`);
  }

  return { facts, hpDamage, updatedEntry };
}

// ─── Combat: Body Discovery (Phase 13) ───────────────────────────────────────

export type BodyObscurement = 'visible' | 'partial' | 'full';

export interface BodyDiscoveryResult {
  roll: number;
  dc: number;
  escalate: boolean;
}

export function resolveBodyDiscovery(
  wisScore: number,
  passivePerception: number | undefined,
  obscurement: BodyObscurement,
  rollFn?: () => number,
): BodyDiscoveryResult {
  const dc = obscurement === 'full' ? 16 : obscurement === 'partial' ? 12 : 8;
  const wisMod = abilityModifier(wisScore);
  const rawRoll = rollFn ? rollFn() : randomInt(1, 21);
  const roll = rawRoll + wisMod;
  return { roll, dc, escalate: roll >= dc };
}

// ─── Combat: Turn Resolution (Phase 3) ───────────────────────────────────────

export function advanceTurn(cs: CombatState): CombatState {
  const order = cs.initiativeOrder;
  const currentIdx = order.findIndex(e => e.id === cs.activeActorId);
  const updated = order.map((e, i) => i === currentIdx ? { ...e, acted: true } : e);

  const isSkippable = (e: (typeof updated)[number]) => e.isDormant || (e.type === 'enemy' && e.hp <= 0);

  const nextIdx = updated.findIndex((e, i) => i > currentIdx && !e.acted && !isSkippable(e));
  if (nextIdx !== -1) {
    return { ...cs, initiativeOrder: updated, activeActorId: updated[nextIdx].id, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
  }
  // New round — reset acted flags but keep skipping dormant/dead
  const reset = updated.map(e => ({ ...e, acted: false }));
  const firstValid = reset.findIndex(e => !isSkippable(e));
  if (firstValid === -1) {
    // All dormant or dead — end combat or just return unchanged to avoid loop
    return { ...cs, initiativeOrder: reset, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
  }
  return { ...cs, round: cs.round + 1, initiativeOrder: reset, activeActorId: reset[firstValid].id, currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false } };
}

export function checkCombatEnd(cs: CombatState): boolean {
  return cs.initiativeOrder.every(e => e.type === 'character' || e.hp <= 0);
}

type CombatRollLog = {
  type: 'combat_roll';
  action: string;
  d20: number;
  modifier: number;
  total: number;
  vsTarget: string;
  success: boolean;
  isCrit?: boolean;
  damageRoll?: { dice: string; expr: string; total: number };
  rollMode?: 'advantage' | 'disadvantage';
  d20Rolls?: [number, number];
};

interface CombatActionResult {
  facts: string[];
  updatedCombatState: CombatState;
  combatEnded: boolean;
  deadEnemyPoiIds: string[];
  silentKillIds: Set<string>;
  playerGainedHidden: boolean | null;
  dbHpUpdates: Array<{ id: string; hpDelta: number }>;
  rollLogs: CombatRollLog[];
}

export function resolveCombatAction(
  action: ExtractedAction,
  cs: CombatState,
  character: { id: string; name: string; characterClass: string; level: number; baseDexterity: number; baseStrength: number; baseCharisma: number; baseWisdom: number; isHiding?: boolean },
  equippedWeapon: { damageDice: string; weaponType?: string; silent?: boolean } | null,
  inventory?: CharacterInventory | null,
): CombatActionResult {
  const facts: string[] = [];
  let order = [...cs.initiativeOrder];
  const playerEntry = order.find(e => e.id === character.id)!;
  let combatEnded = false;
  const deadEnemyPoiIds: string[] = [];
  const silentKillIds = new Set<string>();
  let playerGainedHidden: boolean | null = null;
  const dbHpUpdates: Array<{ id: string; hpDelta: number }> = [];
  let turnUsage = { ...cs.currentTurnUsage };
  const rollLogs: CombatRollLog[] = [];

  if (action.action_type === 'attack') {
    playerGainedHidden = false; // attacking always reveals the character
    const targetId = action.target_poi_instance_id;
    const targetIdx = targetId ? order.findIndex(e => e.id === targetId) : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
    if (targetIdx === -1) {
      facts.push('No valid target found for attack.');
    } else {
      const target = order[targetIdx];
      const strMod = abilityModifier(character.baseStrength);
      const dexMod = abilityModifier(character.baseDexterity);
      const isFinesse = equippedWeapon?.weaponType === 'finesse';
      const statMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
      const profBonus = character.level >= 5 ? 3 : 2;
      const attackBonus = statMod + profBonus;

      // Advantage/disadvantage (Phase 13: add prone)
      const isHidden = character.isHiding ?? false;
      const targetSurprised = target.surprised;
      const targetProne = target.status_effects.includes('prone');
      const meleeAttack = equippedWeapon?.weaponType !== 'ranged';
      const hasAdvantage = isHidden || targetSurprised || (targetProne && meleeAttack);
      const hasDisadvantage = (!isHidden && equippedWeapon?.weaponType === 'ranged' && order.some(e => e.type === 'enemy' && e.proximity === 'close' && e.hp > 0))
        || (targetProne && !meleeAttack);

      let roll1 = rollD20Check(attackBonus, target.ac, 'AC');
      let finalRoll = roll1;
      let rollMode: 'advantage' | 'disadvantage' | undefined;
      let d20Rolls: [number, number] | undefined;
      if (hasAdvantage && !hasDisadvantage) {
        const roll2 = rollD20Check(attackBonus, target.ac, 'AC');
        d20Rolls = [roll1.roll, roll2.roll];
        finalRoll = roll2.roll > roll1.roll ? roll2 : roll1;
        rollMode = 'advantage';
      } else if (hasDisadvantage && !hasAdvantage) {
        const roll2 = rollD20Check(attackBonus, target.ac, 'AC');
        d20Rolls = [roll1.roll, roll2.roll];
        finalRoll = roll2.roll < roll1.roll ? roll2 : roll1;
        rollMode = 'disadvantage';
      }
      const rollModeFields = rollMode ? { rollMode, d20Rolls } : {};

      // Natural 1 always misses
      if (finalRoll.fumble) {
        facts.push(`${character.name} attacked ${target.name} — rolled 1 (fumble), miss.`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: 1, modifier: 0, total: 1, vsTarget: `AC ${target.ac}`, success: false, ...rollModeFields });
      } else if (finalRoll.success || finalRoll.critical) {
        const damageDice = equippedWeapon?.damageDice ?? '1d4';
        const { total: damage, expr: dmgExpr } = computeAttackDamage(damageDice, statMod, finalRoll.critical);

        // Sneak attack: Rogue with advantage OR an ally adjacent to the target
        let sneakDamage = 0;
        let sneakDiceCount = 0;
        let sneakExpr = '';
        const isRogue = character.characterClass === 'Rogue';
        const allyAdjacent = order.some(e => e.type === 'character' && e.id !== character.id && e.hp > 0 && e.proximity === 'close');
        if (isRogue && (hasAdvantage || allyAdjacent)) {
          sneakDiceCount = Math.ceil(character.level / 2);
          const sneakRoll = rollDice(sneakDiceCount, 6);
          sneakDamage = sneakRoll.total;
          sneakExpr = ` + [${sneakRoll.rolls.join(', ')}] sneak`;
        }

        // Phase 13: damage resistance halves damage
        const weaponType = equippedWeapon?.weaponType ?? 'melee';
        const isResisted = (target.resistances ?? []).includes(weaponType);
        const effectiveDamage = isResisted ? Math.max(1, Math.floor((damage + sneakDamage) / 2)) : damage + sneakDamage;

        const newHp = Math.max(0, target.hp - effectiveDamage);
        order[targetIdx] = { ...target, hp: newHp };

        console.log(`[stage3:attack] target=${target.name} roll=${finalRoll.roll} vs AC=${target.ac} hit=${finalRoll.success} damage=${effectiveDamage}${isResisted ? '(resisted)' : ''} crit=${finalRoll.critical}`);
        facts.push(`${character.name} attacked ${target.name} — rolled ${finalRoll.roll}+${attackBonus}=${finalRoll.total} vs AC ${target.ac}, ${finalRoll.critical ? 'CRITICAL HIT' : 'hit'}, dealt ${effectiveDamage} damage${sneakDamage ? ` (incl. ${sneakDiceCount}d6 sneak attack)` : ''}${isResisted ? ' (resisted)' : ''}.`);
        const dmgModStr = statMod !== 0 ? (statMod > 0 ? `+${statMod}` : `${statMod}`) : '';
        const diceLabel = `${damageDice}${dmgModStr}${finalRoll.critical ? ' ×2' : ''}`;
        const dmgExprFull = `${dmgExpr}${sneakExpr}${isResisted ? ' (resisted)' : ''}`;
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: finalRoll.roll, modifier: attackBonus, total: finalRoll.total, vsTarget: `AC ${target.ac}`, success: true, isCrit: finalRoll.critical || undefined, damageRoll: { dice: diceLabel, expr: dmgExprFull, total: effectiveDamage }, ...rollModeFields });

        if (newHp <= 0) {
          console.log(`[stage3:enemy-dead] ${target.name} dropped to 0 HP — removed from initiative`);
          facts.push(`${target.name} dropped to 0 HP and is dead.`);
          // Phase 13: silent kill only if hidden + silent weapon
          const isSilentKill = isHidden && (equippedWeapon?.silent ?? false);
          deadEnemyPoiIds.push(target.id);
          if (!isSilentKill) silentKillIds.delete(target.id);
          else silentKillIds.add(target.id);
          order = order.filter(e => e.id !== target.id);
        }
      } else {
        console.log(`[stage3:attack] target=${target.name} roll=${finalRoll.roll} vs AC=${target.ac} hit=false damage=0 crit=false`);
        facts.push(`${character.name} attacked ${target.name} — rolled ${finalRoll.roll}+${attackBonus}=${finalRoll.total} vs AC ${target.ac}, miss.`);
        rollLogs.push({ type: 'combat_roll', action: `${character.name} attacks ${target.name}`, d20: finalRoll.roll, modifier: attackBonus, total: finalRoll.total, vsTarget: `AC ${target.ac}`, success: false, ...rollModeFields });
      }
    }

  } else if (action.action_type === 'dodge') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'dodging'), 'dodging'] };
    facts.push(`${character.name} takes the Dodge action — attackers have disadvantage until their next turn.`);

  } else if (action.action_type === 'dash') {
    facts.push(`${character.name} Dashes — movement doubled this turn.`);

  } else if (action.action_type === 'disengage') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    order[playerIdx] = { ...playerEntry, status_effects: [...playerEntry.status_effects.filter(s => s !== 'disengaged'), 'disengaged'] };
    facts.push(`${character.name} Disengages — no opportunity attacks this turn.`);

  } else if (action.action_type === 'hide') {
    const dexMod = abilityModifier(character.baseDexterity);
    const d20Raw = Math.ceil(Math.random() * 20);
    const stealthRoll = d20Raw + dexMod;
    const enemies = order.filter(e => e.type === 'enemy' && e.hp > 0);
    const highestPerception = enemies.length > 0
      ? Math.max(...enemies.map(e => e.passive_perception ?? 10))
      : 10;
    if (stealthRoll >= highestPerception) {
      facts.push(`${character.name} hides — Stealth ${stealthRoll} beats passive Perception ${highestPerception}. Now hidden.`);
      playerGainedHidden = true;
    } else {
      facts.push(`${character.name} attempts to hide — Stealth ${stealthRoll} vs passive Perception ${highestPerception}, fails.`);
      playerGainedHidden = false;
    }
    rollLogs.push({ type: 'combat_roll', action: `${character.name} stealth`, d20: d20Raw, modifier: dexMod, total: stealthRoll, vsTarget: `Perception ${highestPerception}`, success: stealthRoll >= highestPerception });

  } else if (action.action_type === 'provoke') {
    const targetId = action.target_poi_instance_id;
    const targetIdx = targetId ? order.findIndex(e => e.id === targetId) : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
    if (targetIdx !== -1) {
      const target = order[targetIdx];
      const chaMod = abilityModifier(character.baseCharisma);
      const intimidDC = 12;
      const check = rollD20Check(chaMod, intimidDC, 'DC');
      if (check.success) {
        order[targetIdx] = { ...target, priority_target: character.id, priority_target_until_round: cs.round + 2 };
        facts.push(`${character.name} provokes ${target.name} — Intimidation ${check.total} vs DC ${intimidDC}, success. ${target.name} focuses on ${character.name} for 2 rounds.`);
      } else {
        order[targetIdx] = { ...target, status_effects: [...target.status_effects, 'advantage_next_attack'] };
        facts.push(`${character.name} provokes ${target.name} — Intimidation ${check.total} vs DC ${intimidDC}, failure. ${target.name} gains advantage on next attack.`);
      }
      rollLogs.push({ type: 'combat_roll', action: `${character.name} intimidates ${target.name}`, d20: check.roll, modifier: chaMod, total: check.total, vsTarget: `DC ${intimidDC}`, success: check.success });
    }

  } else if (action.action_type === 'change_proximity') {
    const playerIdx = order.findIndex(e => e.id === character.id);
    const playerIsProne = playerIdx !== -1 && order[playerIdx].status_effects.includes('prone');
    if (playerIsProne) {
      // Standing up costs movement — remove prone, no proximity change
      order[playerIdx] = { ...order[playerIdx], status_effects: order[playerIdx].status_effects.filter(s => s !== 'prone') };
      facts.push(`${character.name} stands up, no longer prone.`);
    } else {
      const targetId = action.target_poi_instance_id;
      const targetIdx = targetId ? order.findIndex(e => e.id === targetId) : -1;
      if (targetIdx !== -1) {
        const target = order[targetIdx];
        const newProx = target.proximity === 'close' ? 'far' : 'close';
        order[targetIdx] = { ...target, proximity: newProx };
        facts.push(`${target.name} proximity changed to ${newProx}.`);
      }
    }

  } else if (action.action_type === 'death_save') {
    const deathRoll = rollD20Check(0, 10, 'DC');
    if (deathRoll.success) {
      facts.push(`${character.name} death save — rolled ${deathRoll.roll}, success.`);
    } else {
      facts.push(`${character.name} death save — rolled ${deathRoll.roll}, failure.`);
    }
    rollLogs.push({ type: 'combat_roll', action: `${character.name} death save`, d20: deathRoll.roll, modifier: 0, total: deathRoll.total, vsTarget: 'DC 10', success: deathRoll.success });

  } else if (action.action_type === 'use_item' || action.action_type === 'throw_item') {
    const itemId = action.item_id;
    const item = itemId ? (inventory?.bag.find(i => i.id === itemId) ?? null) : null;
    if (!item) {
      facts.push(`${character.name} tried to use an item but it wasn't found.`);
    } else {
      const targetId = action.target_character_id ?? action.target_poi_instance_id;
      const effect = item.use_effect ?? '';

      if (effect.startsWith('heal_')) {
        const amount = parseInt(effect.replace('heal_', ''), 10);
        const targetIdx = targetId
          ? order.findIndex(e => e.id === targetId)
          : order.findIndex(e => e.id === character.id);
        if (targetIdx !== -1) {
          const target = order[targetIdx];
          const healed = Math.min(amount, target.maxHp - target.hp);
          order[targetIdx] = { ...target, hp: target.hp + healed };
          facts.push(`${character.name} used ${item.name} on ${target.name} — restored ${healed} HP (${target.hp} → ${target.hp + healed}).`);
          if (target.type === 'character') dbHpUpdates.push({ id: target.id, hpDelta: healed });
        }
      } else if (effect === 'cure_poison') {
        const targetIdx = targetId
          ? order.findIndex(e => e.id === targetId)
          : order.findIndex(e => e.id === character.id);
        if (targetIdx !== -1) {
          const target = order[targetIdx];
          const wasPoisoned = target.status_effects.includes('poisoned');
          order[targetIdx] = { ...target, status_effects: target.status_effects.filter(s => s !== 'poisoned') };
          facts.push(`${character.name} used ${item.name} on ${target.name} — ${wasPoisoned ? 'cured poison' : 'not poisoned, no effect'}.`);
        }
      } else if (effect === 'shield_spell') {
        const playerIdx = order.findIndex(e => e.id === character.id);
        if (playerIdx !== -1) {
          order[playerIdx] = { ...order[playerIdx], status_effects: [...order[playerIdx].status_effects.filter(s => s !== 'shielded'), 'shielded'] };
          facts.push(`${character.name} used ${item.name} — +5 AC until next turn.`);
        }
      } else {
        // Generic damage effect: parse trailing number e.g. holy_damage_8, fire_damage_6
        const dmgMatch = effect.match(/(\d+)/);
        const baseDamage = dmgMatch ? parseInt(dmgMatch[1], 10) : 0;
        if (baseDamage > 0) {
          const targetIdx = targetId
            ? order.findIndex(e => e.id === targetId)
            : order.findIndex(e => e.type === 'enemy' && e.hp > 0);
          if (targetIdx !== -1) {
            const target = order[targetIdx];
            const dexMod = abilityModifier(character.baseDexterity);
            const profBonus = character.level >= 5 ? 3 : 2;
            const attackBonus = dexMod + profBonus;
            const roll = rollD20Check(attackBonus, target.ac, 'AC');
            if (roll.fumble) {
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled 1 (fumble), miss.`);
            } else if (roll.success || roll.critical) {
              const damage = roll.critical ? baseDamage * 2 : baseDamage;
              const newHp = Math.max(0, target.hp - damage);
              order[targetIdx] = { ...target, hp: newHp };
              console.log(`[stage3:item-use] ${character.name} used ${item.name} on ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} hit damage=${damage}`);
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, hit, dealt ${damage} damage.`);
              if (newHp <= 0) {
                facts.push(`${target.name} dropped to 0 HP and is dead.`);
                if (target.type === 'enemy') deadEnemyPoiIds.push(target.id);
                order = order.filter(e => e.id !== target.id);
              }
            } else {
              console.log(`[stage3:item-use] ${character.name} used ${item.name} on ${target.name} — roll=${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac} miss`);
              facts.push(`${character.name} used ${item.name} on ${target.name} — rolled ${roll.roll}+${attackBonus}=${roll.total} vs AC ${target.ac}, miss.`);
            }
            rollLogs.push({ type: 'combat_roll', action: `${character.name} uses ${item.name}`, d20: roll.roll, modifier: attackBonus, total: roll.total, vsTarget: `AC ${target.ac}`, success: roll.success || roll.critical, isCrit: roll.critical || undefined });
          } else {
            facts.push(`${character.name} used ${item.name} — no valid target.`);
          }
        } else {
          facts.push(`${character.name} used ${item.name}.`);
        }
      }
      turnUsage = { ...turnUsage, actionUsed: true };
    }
  }

  // Mark main-action consumption for standard combat actions
  if (['attack', 'dodge', 'dash', 'disengage', 'hide', 'provoke'].includes(action.action_type)) {
    turnUsage = { ...turnUsage, actionUsed: true };
  }
  if (action.action_type === 'change_proximity') {
    turnUsage = { ...turnUsage, movementUsed: true };
  }

  let updatedCs = { ...cs, initiativeOrder: order, currentTurnUsage: turnUsage };
  combatEnded = checkCombatEnd(updatedCs);

  return { facts, updatedCombatState: updatedCs, combatEnded, deadEnemyPoiIds, silentKillIds, playerGainedHidden, dbHpUpdates, rollLogs };
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
  characterClass: string;
  level: number;
  skillsModifiers: unknown;
  skillProficiencies: string[];
  baseWisdom: number;
  baseDexterity: number;
  baseStrength: number;
  baseCharisma: number;
  currentHp: number;
  maxHp: number;
  isHiding: boolean;
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
  // Auto-resolve when LLM couldn't identify the exit but there's only one available
  const isUnresolved =
    !action.target_poi_instance_id ||
    !action.target_room_template_id ||
    action.target_room_template_id === '<UNKNOWN>';
  let resolvedExitPoiId: string;
  let resolvedTemplateId: string;
  if (isUnresolved) {
    if (exitPoiMap.size === 1) {
      const [[onlyId, onlyTemplate]] = exitPoiMap;
      resolvedExitPoiId = onlyId;
      resolvedTemplateId = onlyTemplate;
    } else {
      throw new Error('move_to_room requires both target_poi_instance_id and target_room_template_id.');
    }
  } else {
    resolvedExitPoiId = action.target_poi_instance_id!;
    resolvedTemplateId = action.target_room_template_id!;
  }

  const expectedTarget = exitPoiMap.get(resolvedExitPoiId);
  if (!expectedTarget || expectedTarget !== resolvedTemplateId) {
    throw new Error(
      `Exit POI "${resolvedExitPoiId}" does not lead to room template "${resolvedTemplateId}" — aborting.`,
    );
  }

  // Check if exit POI is locked
  await prisma.$transaction(async tx => {
    const exitPoi = await tx.poiInstance.findUniqueOrThrow({
      where: { id: resolvedExitPoiId },
      include: { template: true },
    });
    const defaultProps = exitPoi.template.defaultProperties as Record<string, unknown>;
    const isLockable = computeIsLockable(defaultProps.locked_by);
    if (isLockable) {
      const currentProps = exitPoi.currentProperties as Record<string, unknown>;
      if (currentProps.unlocked !== true) {
        throw new Error(`${validPoiMap.get(resolvedExitPoiId) ?? 'The exit'} is locked.`);
      }
    }
  });

  const exitPoiName = validPoiMap.get(resolvedExitPoiId) ?? 'the exit';

  return await prisma.$transaction(async tx => {
    const currentRoom = await tx.roomInstance.findUniqueOrThrow({
      where: { id: currentRoomInstanceId },
      select: { roomTemplateId: true },
    });

    let targetRoom = await tx.roomInstance.findFirst({
      where: { sessionId, roomTemplateId: resolvedTemplateId },
      include: { poiInstances: { include: { template: true } } },
    });

    if (!targetRoom) {
      const targetTemplate = await tx.roomTemplate.findUniqueOrThrow({
        where: { id: resolvedTemplateId },
        include: { poiTemplates: true },
      });
      targetRoom = await tx.roomInstance.create({
        data: {
          sessionId,
          roomTemplateId: resolvedTemplateId,
          poiInstances: {
            create: targetTemplate.poiTemplates.map(pt => {
              const dp = pt.defaultProperties as Record<string, unknown>;
              const initAwareness = dp.initial_awareness_state as string | undefined;
              return {
                poiTemplateId: pt.id,
                currentProperties: initAwareness
                  ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                  : {},
              };
            }),
          },
        },
        include: { poiInstances: { include: { template: true } } },
      });
    }

    // Mirror door state: find the return-exit POI in the target room that leads
    // back to the current room. If it's a door (peek_visibility === 'none'),
    // mark it interacted (open) so the door doesn't appear closed behind the player.
    const exitPoiInstance = await tx.poiInstance.findUniqueOrThrow({
      where: { id: resolvedExitPoiId },
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
          target_room_template_id: resolvedTemplateId,
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
  inCombat = false,
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

      // If the character is peering at an exit, inject adjacent room visibility into the narrative fact
      let peerOverrideFact: string | undefined;
      const targetExitPoiId = action.target_poi_instance_id;
      console.log(`[peer] change_proximity target=${targetExitPoiId} isExit=${exitPoiMap.has(targetExitPoiId ?? '')}`);
      if (targetExitPoiId && exitPoiMap.has(targetExitPoiId)) {
        const exitPoi = await prisma.poiInstance.findUniqueOrThrow({
          where: { id: targetExitPoiId },
          include: { template: true },
        });
        const dp = exitPoi.template.defaultProperties as Record<string, unknown>;
        const cp = exitPoi.currentProperties as Record<string, unknown>;
        const rawPeek = (dp.peek_visibility as string) ?? 'none';
        const effectivePeek = computeEffectivePeek(
          rawPeek,
          computeIsLockable(dp.locked_by) && cp.unlocked !== true,
          cp.interacted === true,
          cp.destroyed === true,
        );

        const targetRoomTemplateId = exitPoiMap.get(targetExitPoiId)!;

        console.log(`[peer] rawPeek=${rawPeek} effectivePeek=${effectivePeek} unlocked=${cp.unlocked} interacted=${cp.interacted} destroyed=${cp.destroyed} targetTemplate=${targetRoomTemplateId}`);
        if (effectivePeek === 'none') {
          peerOverrideFact = `Character "${characterName}" pressed against "${poiName}", straining to sense what lies beyond — but the door is solid and reveals nothing.`;
        } else {
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId, roomTemplateId: targetRoomTemplateId },
            include: { template: true, poiInstances: { include: { template: true } } },
          });
          console.log(`[peer] adjRoom=${adjRoom ? adjRoom.template.name : 'NOT FOUND (room not yet visited)'} poiCount=${adjRoom?.poiInstances.length ?? 0}`);
          if (adjRoom) {
            const minVisLevel = effectivePeek === 'full' ? 1 : 2;
            const exitDirection: string = exitPoi.template.exit_direction ?? '';
            const exitWallSection: string = exitPoi.template.exit_wall_section ?? 'C';
            const exitArchWidth: number = exitPoi.template.exit_arch_width ?? 1;
            const charGridSlot = exitPoi.template.grid_slot ?? 'C';

            console.log(`[peer] effectivePeek=${effectivePeek} minVisLevel=${minVisLevel} exitDir=${exitDirection||'(none)'} wallSection=${exitWallSection} archWidth=${exitArchWidth} charSlot=${charGridSlot}`);

            const visiblePois = adjRoom.poiInstances.filter(pi => {
              const pdp = pi.template.defaultProperties as Record<string, unknown>;
              if ((pdp.poi_type as string) === 'open_space') return false;
              if (pi.template.visibility_level < minVisLevel) {
                console.log(`[peer] SKIP "${pi.template.name}" — visibility_level=${pi.template.visibility_level} < minVisLevel=${minVisLevel}`);
                return false;
              }
              if (!exitDirection) return true;
              const los = isPoiVisibleThroughExit(charGridSlot, pi.template.grid_slot, exitDirection, exitWallSection, exitArchWidth);
              console.log(`[peer] "${pi.template.name}" slot=${pi.template.grid_slot} LoS=${los}`);
              return los;
            });

            const poiList = visiblePois.length > 0
              ? visiblePois.map(pi => `"${pi.template.name}"`).join(', ')
              : 'nothing remarkable';
            peerOverrideFact = `Character "${characterName}" peers through "${poiName}" into "${adjRoom.template.name}". Visible from this vantage: ${poiList}. Describe only what can be seen from this angle — do not fabricate unseen details.`;
          }
        }
      }

      appliedActions.push({ action, poiName, itemName: null, overrideFact: peerOverrideFact });

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
        const isLockable = computeIsLockable(defaultProps.locked_by);
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

          // When opening a lockable container, auto-reveal hidden items that
          // have no reveal_check (items visible immediately on opening).
          const templateItems = Array.isArray(defaultProps.items)
            ? (defaultProps.items as ItemDefinition[])
            : [];
          const existingRevealed = new Set(
            Array.isArray(currentProps.revealed_items)
              ? (currentProps.revealed_items as string[])
              : [],
          );
          const takenIds = new Set(
            Array.isArray(currentProps.items_taken)
              ? (currentProps.items_taken as string[])
              : [],
          );
          const autoReveal = isLockable
            ? templateItems
                .filter(i => i.hidden && !i.reveal_check && !existingRevealed.has(i.id) && !takenIds.has(i.id))
                .map(i => i.id)
            : [];

          await tx.poiInstance.update({
            where: { id: action.target_poi_instance_id! },
            data: {
              currentProperties: {
                ...currentProps,
                interacted: true,
                lastInteraction: verb,
                ...(autoReveal.length > 0
                  ? { revealed_items: [...Array.from(existingRevealed), ...autoReveal] }
                  : {}),
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

        // Move player to the POI they interacted with
        const partRow = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const partCs = (partRow?.combatState ?? {}) as Record<string, unknown>;
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...partCs, proximity_target_id: action.target_poi_instance_id }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: action.target_poi_instance_id } },
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

        // Move player to the POI they picked up from
        const partRow = await tx.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const partCs = (partRow?.combatState ?? {}) as Record<string, unknown>;
        await tx.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...partCs, proximity_target_id: sourcePoi }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: sourcePoi } },
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
          if (item.use_effect.startsWith('heal_') && !inCombat) {
            // In combat, heal is handled by resolveCombatAction — skip DB update here to avoid double apply
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
            const isExitPoi = (defaultProps.poi_type as string) === 'exit';
            await tx.poiInstance.update({
              where: { id: action.target_poi_instance_id },
              data: {
                currentProperties: {
                  ...currentProps,
                  unlocked: true,
                  ...(isExitPoi ? { interacted: true, lastInteraction: 'opened' } : {}),
                },
              },
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
            if (!computeIsLockable(defaultProps.locked_by)) throw new Error(`"${validPoiMap.get(action.target_poi_instance_id) ?? 'this POI'}" has no lock to pick.`);
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
        } else if (!item.use_effect && action.target_poi_instance_id) {
          // Fallback: item has no use_effect but is being used on a POI — check if it's a key for that lock
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
          if (lockedByArr.includes(item.id)) {
            const currentProps = poi.currentProperties as Record<string, unknown>;
            const isExitPoi = (defaultProps.poi_type as string) === 'exit';
            await tx.poiInstance.update({
              where: { id: action.target_poi_instance_id },
              data: {
                currentProperties: {
                  ...currentProps,
                  unlocked: true,
                  ...(isExitPoi ? { interacted: true, lastInteraction: 'opened' } : {}),
                },
              },
            });
            const targetPoiName = validPoiMap.get(action.target_poi_instance_id) ?? 'the target';
            effectDescription = `unlocked ${targetPoiName}`;
            console.log(`[items] use_item unlock (fallback): ${characterName} unlocked "${targetPoiName}" with "${item.name}"`);
            // Consume the key
            if (itemLocation === 'bag') inv.bag.splice(bagIdx, 1);
            else {
              const slot = Object.entries(inv.equipped).find(([, i]) => i?.id === itemId)?.[0];
              if (slot) delete inv.equipped[slot as keyof CharacterInventory['equipped']];
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

        await tx.character.update({
          where: { id: characterId },
          data: { inventory: inv as unknown as object },
        });

        if (!inCombat) {
          // In combat the item shatters on impact — no floor drop
          let landingPoiId = action.target_poi_instance_id;
          if (!landingPoiId || !validPoiMap.has(landingPoiId)) {
            landingPoiId = openSpacePoiId;
          }
          if (!landingPoiId) throw new Error('No valid landing location — open_space POI not found');
          landingPoiName = validPoiMap.get(landingPoiId) ?? 'open space';

          const poi = await tx.poiInstance.findUniqueOrThrow({ where: { id: landingPoiId } });
          const currentProps = poi.currentProperties as Record<string, unknown>;
          const floorItems = Array.isArray(currentProps.floor_items) ? (currentProps.floor_items as ItemDefinition[]) : [];
          await tx.poiInstance.update({
            where: { id: landingPoiId },
            data: { currentProperties: { ...currentProps, floor_items: [...floorItems, item] } as unknown as object },
          });
        }

        console.log(`[items] throw_item: ${characterName} threw "${item.name}"${inCombat ? ' (combat — no floor drop)' : ` → "${landingPoiName}"`}`);
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

  const finalFactBlock = extraFacts && extraFacts.length > 0
    ? extraFacts.join(' ') + (mechanicalFactBlock ? ' ' + mechanicalFactBlock : '')
    : mechanicalFactBlock;

  const historyBlock = chronologicalLogs
    .map((log, i) => `[${i + 1}] ${log.text}`)
    .join('\n');

  console.log('[narrative] room:', roomName);
  console.log('[narrative] fact block:', finalFactBlock);

  const narrativeResponse = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: buildNarrativeSystemPrompt(roomName, roomDescription, finalFactBlock, itemsBlock, storyFlags, roomParticipantNames),
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

// ─── Stage 5: View State Packager ────────────────────────────────────────────

async function buildViewState(
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  fallbackNarrative?: string,
): Promise<ViewStatePayload> {
  const [recentNarrative, participants, charRow, poiInstances, roomRow, sessionPartyData] = await Promise.all([
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
        name: true, inventory: true, currentHp: true, maxHp: true, level: true, characterClass: true,
        baseStrength: true, baseDexterity: true, baseConstitution: true, baseIntelligence: true,
        baseWisdom: true, baseCharisma: true, skillsModifiers: true, skillProficiencies: true,
        isHiding: true,
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
    mechanicalSummary: n.mechanicalSummary,
    createdAt: n.createdAt,
    authorCharacterId: n.characterId ?? null,
    authorCharacterClass: n.character?.characterClass ?? null,
    authorName: n.character?.name ?? null,
    authorAvatarUrl: null as null,
  }));
  if (fallbackNarrative && !orderedNarrative.some(n => n.text === fallbackNarrative)) {
    orderedNarrative.push({
      id: 'injected-current',
      text: fallbackNarrative,
      isMechanicalEvent: false,
      mechanicalSummary: null,
      createdAt: new Date(),
      authorCharacterId: null,
      authorCharacterClass: null,
      authorName: null,
      authorAvatarUrl: null,
    });
  }

  const resolvedGameState = (roomRow?.gameState ?? gameState) as 'exploration' | 'combat';
  const rawCombatState = roomRow?.combatState
    ? (roomRow.combatState as unknown as import('@/types/v2-game').CombatState)
    : null;
  // Sync authoritative character HP into the player's initiative entry.
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
    });
  }

  const profBonus = charRow.level >= 5 ? 3 : charRow.level >= 3 ? 2 : 2;
  const dexMod = abilityModifier(charRow.baseDexterity);
  const strMod = abilityModifier(charRow.baseStrength);
  const inv = normalizeInventory(charRow.inventory);
  const armorBonus = Object.values(inv.equipped)
    .filter((i): i is import('@/types/v2-game').ItemDefinition => i != null)
    .reduce((acc, item) => acc + ((item.equip_bonus?.ac) ?? 0), 0);

  return {
    roomInstanceId,
    currentNarrative: orderedNarrative,
    activeState: resolvedGameState,
    gameState: resolvedGameState,
    combatState: resolvedCombatState,
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
      characterClass: charRow.characterClass,
      attackBonus: strMod + profBonus,
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
    },
    partyMembers,
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
  const { characterId, roomInstanceId, playerActionText, action_hint } = body;

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
      const isLockable = computeIsLockable(defaultProps.locked_by);
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
        // Combat awareness fields (underscore-prefixed to avoid conflict with existing PoiContext)
        _currentAwareness: currentProps.awareness_state as string | undefined,
        _hostileTo: Array.isArray(currentProps.hostile_to) ? (currentProps.hostile_to as string[]) : undefined,
        _recognitionException: (defaultProps.recognition_exception as string) ?? undefined,
        _combatStats: (defaultProps.combat_stats ?? {}) as PoiCombatStats,
        _aiBehavior: (defaultProps.ai_behavior ?? {}) as AiBehavior,
        _defaultProps: defaultProps,
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

    // Gates: lobby, dead character, kicked
    if (roomInstance.session.gameState === 'lobby') {
      throw Object.assign(new Error('Session has not started yet'), { status: 403 });
    }
    const charForGate = await prisma.character.findUnique({ where: { id: characterId }, select: { isDead: true } });
    if (charForGate?.isDead) throw Object.assign(new Error('Dead characters cannot act'), { status: 403 });
    const kickedIds = (roomInstance.session.kickedCharacterIds ?? []) as string[];
    if (kickedIds.includes(characterId)) throw Object.assign(new Error('You have been removed from this session'), { status: 403 });

    // Read combat state from roomInstance
    const riRow = await prisma.roomInstance.findUnique({
      where: { id: roomInstanceId },
      select: { gameState: true, combatState: true, processingAction: true },
    });

    // Early-exit: end_turn bypasses intent parsing — just advance turn and run enemies
    if (action_hint === 'end_turn') {
      const sessionGs = riRow?.gameState ?? 'exploration';
      const sessionCs = riRow?.combatState;
      if (sessionGs !== 'combat' || !sessionCs) {
        return buildViewState(roomInstanceId, sessionGs as string, characterId, roomInstance.session.id, currentProximityPoiId);
      }
      const cs = sessionCs as unknown as CombatState;
      if (cs.activeActorId !== characterId) {
        throw Object.assign(new Error("It's not your turn"), { status: 409 });
      }

      // Advance past player
      let workingCs = advanceTurn(cs);
      let totalEnemyDamage = 0;
      const allEnemyFacts: string[] = [];
      const pendingRollData: NonNullable<EnemyTurnResult['rollData']>[] = [];

      const playerPoiSlot = (roomInstance.poiInstances.find(p => p.id === currentProximityPoiId)?.template as Record<string, unknown> | undefined)?.grid_slot as string ?? 'C';

      while (true) {
        const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
        if (!activeEntry || activeEntry.type === 'character') break;

        const poiForEnemy = roomInstance.poiInstances.find(p => p.id === activeEntry.id);
        const defaultProps = (poiForEnemy?.template?.defaultProperties ?? {}) as Record<string, unknown>;

        const result = resolveEnemyTurn(activeEntry, workingCs, characterId, character.name, defaultProps, playerPoiSlot);
        allEnemyFacts.push(...result.facts);
        totalEnemyDamage += result.hpDamage;

        if (result.rollData) {
          pendingRollData.push(result.rollData);
        }

        workingCs = {
          ...workingCs,
          initiativeOrder: workingCs.initiativeOrder.map(e =>
            e.id === activeEntry.id ? result.updatedEntry : e,
          ),
        };

        if (totalEnemyDamage >= character.currentHp) break;
        workingCs = advanceTurn(workingCs);
      }

      if (totalEnemyDamage > 0) {
        const newHp = Math.max(0, character.currentHp - totalEnemyDamage);
        await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
      }

      await prisma.roomInstance.update({
        where: { id: roomInstanceId },
        data: { combatState: workingCs as object },
      });

      // Narrative first — badges appear after so they read as mechanical receipts for the described action
      await generateAndPersistNarrative(
        roomInstanceId,
        characterId,
        character.name,
        roomInstance.template.name,
        roomInstance.template.baseDescription,
        [],
        roomInstance.session.id,
        allEnemyFacts.length > 0 ? allEnemyFacts : undefined,
        roomInstance.participants.map(p => p.character.name),
      );

      for (const rollData of pendingRollData) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollData,
            text: `[COMBAT] ${rollData.action}`,
          },
        });
      }

      return buildViewState(roomInstanceId, 'combat', characterId, roomInstance.session.id, currentProximityPoiId);
    }

    // Phase P: exploration action lock — first-in wins, second caller gets 409
    const isExplorationAction = (riRow?.gameState ?? 'exploration') !== 'combat';
    if (isExplorationAction) {
      const lockResult = await prisma.roomInstance.updateMany({
        where: { id: roomInstanceId, processingAction: false },
        data: { processingAction: true },
      });
      if (lockResult.count === 0) {
        throw Object.assign(
          new Error('Another action is being processed — please wait a moment and try again'),
          { status: 409 },
        );
      }
    }

    try {

    // If character is standing at a visible exit, fetch adjacent room POIs so
    // Haiku can reference them by real instance ID (cross-room actions).
    let adjacentRoom: AdjacentRoomContext | null = null;
    if (currentProximityPoiId) {
      const proximityCtx = poiContexts.find(p => p.id === currentProximityPoiId);
      if (proximityCtx?.isExit && proximityCtx.targetRoomTemplateId) {
        const effectivePeek = computeEffectivePeek(
          proximityCtx.peekVisibility,
          proximityCtx.isLocked,
          proximityCtx.interacted,
          proximityCtx.destroyed,
        );
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
                  create: adjTemplate.poiTemplates.map(pt => {
                    const dp = pt.defaultProperties as Record<string, unknown>;
                    const initAwareness = dp.initial_awareness_state as string | undefined;
                    return {
                      poiTemplateId: pt.id,
                      currentProperties: initAwareness
                        ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                        : {},
                    };
                  }),
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

    // Fallback: if not standing at an exit but there's exactly one peek-visible exit,
    // still populate adjacentRoom so the LLM can parse cross-room actions like "walk to <POI>".
    if (!adjacentRoom) {
      const peekableExits = poiContexts.filter(p => {
        if (!p.isExit || !p.targetRoomTemplateId) return false;
        return computeEffectivePeek(p.peekVisibility, p.isLocked, p.interacted, p.destroyed) !== 'none';
      });
      if (peekableExits.length === 1) {
        const fallbackExit = peekableExits[0];
        const effectivePeek = computeEffectivePeek(
          fallbackExit.peekVisibility,
          fallbackExit.isLocked,
          fallbackExit.interacted,
          fallbackExit.destroyed,
        );
        const minVisLevel = effectivePeek === 'full' ? 1 : 2;

        // Resolve character's current grid slot for LoS check
        const charPoiInstance = currentProximityPoiId
          ? roomInstance.poiInstances.find(pi => pi.id === currentProximityPoiId)
          : null;
        const charGridSlot: string = charPoiInstance?.template.grid_slot ?? 'C';

        // Resolve exit geometry from the raw template
        const exitPoiInstance = roomInstance.poiInstances.find(pi => pi.id === fallbackExit.id);
        const exitDirection: string = exitPoiInstance?.template.exit_direction ?? '';
        const exitWallSection: string = exitPoiInstance?.template.exit_wall_section ?? 'C';
        const exitArchWidth: number = exitPoiInstance?.template.exit_arch_width ?? 1;

        let adjRoom = await prisma.roomInstance.findFirst({
          where: { sessionId: roomInstance.session.id, roomTemplateId: fallbackExit.targetRoomTemplateId! },
          include: { template: true, poiInstances: { include: { template: true } } },
        });
        if (!adjRoom) {
          const adjTemplate = await prisma.roomTemplate.findUniqueOrThrow({
            where: { id: fallbackExit.targetRoomTemplateId! },
            include: { poiTemplates: true },
          });
          adjRoom = await prisma.roomInstance.create({
            data: {
              sessionId: roomInstance.session.id,
              roomTemplateId: fallbackExit.targetRoomTemplateId!,
              poiInstances: {
                create: adjTemplate.poiTemplates.map(pt => {
                  const dp = pt.defaultProperties as Record<string, unknown>;
                  const initAwareness = dp.initial_awareness_state as string | undefined;
                  return {
                    poiTemplateId: pt.id,
                    currentProperties: initAwareness
                      ? { awareness_state: initAwareness, current_hp: (dp.combat_stats as { max_hp?: number } | undefined)?.max_hp ?? 10, hostile_to: ['player'] }
                      : {},
                  };
                }),
              },
            },
            include: { template: true, poiInstances: { include: { template: true } } },
          });
        }
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
            return {
              id: pi.id,
              name: pi.template.name,
              keyword: pi.template.keywordIdentifier,
              availableStances: extractAvailableStances(pi.template.defaultProperties),
              ...extractExplorationFlags(pi.currentProperties),
              isLocked: adjIsLockable && adjCurrentProps.unlocked !== true,
              isUnlocked: adjIsLockable && adjCurrentProps.unlocked === true,
              ...extractExitInfo(pi.template.defaultProperties),
              items,
              floorItems,
              isOpenSpace: false,
              visibility: resolveEffectiveVisibility(dp, adjCurrentProps),
              peekVisibility: ((dp.peek_visibility as string) ?? 'none') as 'none' | 'obvious_only' | 'full',
            };
          });
        if (adjPois.length > 0) {
          adjacentRoom = {
            roomName: adjRoom.template.name,
            exitPoiId: fallbackExit.id,
            exitPoiName: fallbackExit.name,
            targetRoomTemplateId: fallbackExit.targetRoomTemplateId!,
            pois: adjPois,
          };
          console.log(`[adjacent] fallback: fetched ${adjPois.length} POI(s) from "${adjRoom.template.name}" via "${fallbackExit.name}" (charSlot=${charGridSlot})`);
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
      action_hint,
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

    // Combat turn gate: if in combat and it's not the player's turn, reject
    if (riRow?.gameState === 'combat' && riRow.combatState) {
      const cs = riRow.combatState as unknown as CombatState;
      console.log(`[stage3:turn] actor=${cs.activeActorId} player=${characterId} match=${cs.activeActorId === characterId}`);
      if (cs.activeActorId !== characterId) {
        throw Object.assign(new Error("It's not your turn"), { status: 409 });
      }
    }

    // Combat action resolution (Phase 3 + 4): resolve in-combat actions, then auto-resolve enemy turns
    const inCombat = riRow?.gameState === 'combat' && !!riRow.combatState;
    const combatActionTypes = new Set(['attack', 'dodge', 'dash', 'disengage', 'hide', 'provoke', 'change_proximity', 'death_save', 'use_item', 'throw_item']);
    const allCombatFacts: string[] = [];
    let hadSilentKill = false; // Phase 13: suppress loud propagation for silent kills
    if (inCombat && parsedActions.length > 0) {
      const cs = riRow!.combatState as unknown as CombatState;
      const usage = cs.currentTurnUsage;
      const firstType = parsedActions[0].action_type;
      if (firstType === 'change_proximity' && usage.movementUsed) {
        throw Object.assign(new Error('You have already used your movement this turn.'), { status: 400 });
      }
      const mainActionTypes = new Set(['attack', 'dodge', 'dash', 'disengage', 'hide', 'provoke', 'use_item', 'throw_item']);
      const BONUS_ACTION_HINTS_GATE = ['Cunning Action', 'Second Wind', 'Channel Divinity'];
      const isThisBonusAction = !!action_hint && BONUS_ACTION_HINTS_GATE.some(h => action_hint.includes(h));
      if (mainActionTypes.has(firstType) && !isThisBonusAction && usage.actionUsed) {
        throw Object.assign(new Error('You have already used your action this turn.'), { status: 400 });
      }
      if (isThisBonusAction && usage.bonusActionUsed) {
        throw Object.assign(new Error('You have already used your bonus action this turn.'), { status: 400 });
      }
    }
    if (inCombat && parsedActions.length > 0 && combatActionTypes.has(parsedActions[0].action_type)) {
      const cs = riRow!.combatState as unknown as CombatState;
      const mainHand = characterInventory.equipped.main_hand;
      const equippedWeapon = mainHand ? { damageDice: '1d6', weaponType: 'melee' } : null;
      const combatResult = resolveCombatAction(
        parsedActions[0],
        cs,
        { id: character.id, name: character.name, characterClass: character.characterClass, level: character.level, baseDexterity: character.baseDexterity, baseStrength: character.baseStrength, baseCharisma: character.baseCharisma, baseWisdom: character.baseWisdom, isHiding: character.isHiding },
        equippedWeapon,
        characterInventory,
      );
      allCombatFacts.push(...combatResult.facts);

      // Write player combat roll badges
      for (const rollLog of combatResult.rollLogs) {
        await prisma.messageLog.create({
          data: {
            roomInstanceId,
            characterId,
            isMechanicalEvent: false,
            mechanicalSummary: rollLog,
            text: `[COMBAT] ${combatResult.facts[0] ?? ''}`,
          },
        });
      }

      // Mark dead enemies in DB (from player attack)
      for (const deadId of combatResult.deadEnemyPoiIds) {
        const existingPoi = await prisma.poiInstance.findUnique({ where: { id: deadId }, select: { currentProperties: true } });
        if (existingPoi) {
          await prisma.poiInstance.update({
            where: { id: deadId },
            data: { currentProperties: { ...(existingPoi.currentProperties as object), awareness_state: 'dead', current_hp: 0 } },
          });
        }
      }

      // Apply HP updates from item heals targeting ally characters
      for (const upd of combatResult.dbHpUpdates) {
        const targetChar = await prisma.character.findUnique({ where: { id: upd.id }, select: { currentHp: true, maxHp: true } });
        if (targetChar) {
          await prisma.character.update({
            where: { id: upd.id },
            data: { currentHp: Math.min(targetChar.maxHp, targetChar.currentHp + upd.hpDelta) },
          });
        }
      }

      // Phase 13: persist hide state and track silent kills
      if (combatResult.playerGainedHidden !== null) {
        await prisma.character.update({ where: { id: characterId }, data: { isHiding: combatResult.playerGainedHidden } });
      }
      hadSilentKill = combatResult.silentKillIds.size > 0;

      if (combatResult.combatEnded) {
        await prisma.roomInstance.update({ where: { id: roomInstanceId }, data: { gameState: 'exploration', combatState: Prisma.JsonNull } });
        console.log('[stage3:combat] combat ended — all enemies dead');
      } else {
        // Player's turn remains active — enemies act when player ends turn
        const BONUS_ACTION_HINTS = ['Cunning Action', 'Second Wind', 'Channel Divinity'];
        const isBonusAction = !!action_hint && BONUS_ACTION_HINTS.some(h => action_hint.includes(h));
        const finalUpdatedCs = isBonusAction
          ? { ...combatResult.updatedCombatState, currentTurnUsage: { ...combatResult.updatedCombatState.currentTurnUsage, bonusActionUsed: true } }
          : combatResult.updatedCombatState;
        await prisma.roomInstance.update({ where: { id: roomInstanceId }, data: { combatState: finalUpdatedCs as object } });

        // Phase 13: body discovery — unaware enemies check for newly dead allies
        const newDeadCount = combatResult.deadEnemyPoiIds.length;
        if (newDeadCount > 0) {
          for (const poi of roomInstance.poiInstances) {
            const cp = poi.currentProperties as Record<string, unknown>;
            if (cp.awareness_state !== 'unaware') continue;
            const dp = poi.template.defaultProperties as Record<string, unknown>;
            const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
            const { escalate } = resolveBodyDiscovery(
              combatStats.wis_score ?? 10,
              combatStats.passive_perception,
              'visible',
            );
            console.log(`[stage13:body-discovery] ${poi.template.name} check: escalate=${escalate}`);
            if (escalate) {
              await prisma.poiInstance.update({
                where: { id: poi.id },
                data: { currentProperties: { ...(cp as object), awareness_state: 'suspicious' } },
              });
              allCombatFacts.push(`${poi.template.name} notices something wrong and becomes alert!`);
            }
          }
        }

        // Phase 13: patrol — suspicious enemies approach
        for (const poi of roomInstance.poiInstances) {
          const dp = poi.template.defaultProperties as Record<string, unknown>;
          if (!dp.patrol) continue;
          const cp = poi.currentProperties as Record<string, unknown>;
          const awareness = cp.awareness_state as string | undefined;
          if (awareness === 'suspicious') {
            allCombatFacts.push(`${poi.template.name} moves toward the doorway, drawn by a sound...`);
          }
        }
      }

      // Melee attack: move attacker to the target's grid position
      const attackAction = parsedActions[0];
      if (attackAction.action_type === 'attack' && attackAction.target_poi_instance_id && equippedWeapon?.weaponType !== 'ranged') {
        const existingPart = await prisma.roomParticipant.findUnique({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
        });
        const existingCs = (existingPart?.combatState ?? {}) as Record<string, unknown>;
        await prisma.roomParticipant.upsert({
          where: { roomInstanceId_characterId: { roomInstanceId, characterId } },
          update: { combatState: { ...existingCs, proximity_target_id: attackAction.target_poi_instance_id }, lastActiveAt: new Date() },
          create: { roomInstanceId, characterId, combatState: { proximity_target_id: attackAction.target_poi_instance_id } },
        });
      }
    }

    // Stage 3
    const characterCtx: CharacterContext = {
      id: characterId,
      name: character.name,
      characterClass: character.characterClass,
      level: character.level,
      skillsModifiers: character.skillsModifiers,
      skillProficiencies: character.skillProficiencies,
      baseWisdom: character.baseWisdom,
      baseDexterity: character.baseDexterity,
      baseStrength: character.baseStrength,
      baseCharisma: character.baseCharisma,
      currentHp: character.currentHp,
      maxHp: character.maxHp,
      isHiding: character.isHiding,
    };

    // Phase 5: opportunity attacks fire when player flees (move_to_room in combat)
    if (inCombat && parsedActions[0]?.action_type === 'move_to_room') {
      const cs = riRow!.combatState as unknown as CombatState;
      const oppResult = resolveOpportunityAttacks(cs, characterId, character.name, roomInstance.poiInstances);
      allCombatFacts.push(...oppResult.facts);
      if (oppResult.hpDamage > 0) {
        const newHp = Math.max(0, character.currentHp - oppResult.hpDamage);
        await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
      }
      if (oppResult.hpDamage > 0 || oppResult.facts.length > 0) {
        await prisma.roomInstance.update({ where: { id: roomInstanceId }, data: { combatState: oppResult.updatedCombatState as object } });
      }
    }

    const { appliedActions, newRoomInstanceId } = await mutateGameState(
      parsedActions,
      characterCtx,
      roomInstanceId,
      roomInstance.session.id,
      exitPoiMap,
      validPoiMap,
      openSpacePoiId,
      inCombat,
    );

    // Check whether any story flags set this turn complete the current act
    await checkAndAdvanceAct(roomInstance.session.id);

    // Phase 6: on room entry, run awareness detection for enemies in new room
    if (newRoomInstanceId && parsedActions[0]?.action_type === 'move_to_room') {
      const newRoomFull = await prisma.roomInstance.findUniqueOrThrow({
        where: { id: newRoomInstanceId },
        include: { poiInstances: { include: { template: true } } },
      });
      const stealthRollValue = rollStealthCheck(abilityModifier(character.baseDexterity));
      const isSneaking = character.isHiding;
      console.log(`[stage3:detection] room=${newRoomInstanceId} sneaking=${isSneaking}`);
      for (const poi of newRoomFull.poiInstances) {
        const dp = poi.template.defaultProperties as Record<string, unknown>;
        const cp = poi.currentProperties as Record<string, unknown>;
        const awareness = cp.awareness_state as string | undefined;
        if (!awareness || awareness === 'alert' || awareness === 'dead') continue;
        const combatStats = (dp.combat_stats ?? {}) as PoiCombatStats;
        const wisScore = combatStats.wis_score ?? 10;
        const passivePerception = combatStats.passive_perception ?? (10 + abilityModifier(wisScore));
        if (awareness === 'unaware') {
          if (!isSneaking) {
            await prisma.poiInstance.update({ where: { id: poi.id }, data: { currentProperties: { ...cp, awareness_state: 'suspicious' } } });
            allCombatFacts.push(`${poi.template.name} notices your entry.`);
            console.log(`[stage3:detection] ${poi.template.name}: unaware → suspicious (no stealth)`);
          } else {
            console.log(`[stage3:stealth] roll=${stealthRollValue} vs DC=${passivePerception} result=${stealthRollValue >= passivePerception ? 'pass' : 'fail'}`);
            if (stealthRollValue < passivePerception) {
              await prisma.poiInstance.update({ where: { id: poi.id }, data: { currentProperties: { ...cp, awareness_state: 'suspicious' } } });
              allCombatFacts.push(`${poi.template.name} heard something — their gaze sharpens.`);
            }
          }
        }
      }
    }

    // Phase 6: loud action propagation to adjacent rooms for attack/destroy_poi
    // Phase 13: suppress propagation for silent kills (player hidden + silent weapon + instant kill)
    const firstParsedAction = parsedActions[0];
    if (!hadSilentKill && (firstParsedAction?.action_type === 'attack' || firstParsedAction?.action_type === 'destroy_poi')) {
      const targetPoi = firstParsedAction.target_poi_instance_id
        ? roomInstance.poiInstances.find(p => p.id === firstParsedAction.target_poi_instance_id)
        : null;
      const isLoud = !targetPoi || (targetPoi.template.defaultProperties as Record<string, unknown>).loud !== false;
      if (isLoud) {
        const exits = roomInstance.poiInstances.filter(p => {
          const dp = p.template.defaultProperties as Record<string, unknown>;
          return dp.poi_type === 'exit' && (dp.enter as Record<string, unknown>)?.target_room_template_id;
        });
        for (const exit of exits) {
          const dp = exit.template.defaultProperties as Record<string, unknown>;
          const cp = exit.currentProperties as Record<string, unknown>;
          const enterVerb = dp.enter as Record<string, unknown>;
          const targetTemplateId = enterVerb.target_room_template_id as string;
          const barrierDc = dp.peek_visibility === 'none' ? (cp.unlocked ? 15 : 18) : 10;
          const adjRoom = await prisma.roomInstance.findFirst({
            where: { sessionId: roomInstance.session.id, roomTemplateId: targetTemplateId },
            include: { poiInstances: { include: { template: true } } },
          });
          if (!adjRoom) continue;
          console.log(`[stage3:loud] propagating to adjacent room ${adjRoom.id}, barrier DC=${barrierDc}`);
          for (const adjPoi of adjRoom.poiInstances) {
            const adjDp = adjPoi.template.defaultProperties as Record<string, unknown>;
            const adjCp = adjPoi.currentProperties as Record<string, unknown>;
            const awareness = adjCp.awareness_state as string | undefined;
            if (!awareness || awareness === 'alert' || awareness === 'dead') continue;
            const wisMod = abilityModifier((adjDp.combat_stats as PoiCombatStats | undefined)?.wis_score ?? 10);
            const hearRoll = randomInt(1, 21) + wisMod;
            const nextAwareness = awareness === 'unaware' ? 'suspicious' : 'alert';
            console.log(`[stage3:loud] ${adjPoi.template.name}: roll=${hearRoll} vs DC=${barrierDc} → ${hearRoll >= barrierDc ? nextAwareness : 'unchanged'}`);
            if (hearRoll >= barrierDc) {
              await prisma.poiInstance.update({ where: { id: adjPoi.id }, data: { currentProperties: { ...adjCp, awareness_state: nextAwareness } } });
            }
          }
        }
      }
    }

    // Combat entry: check if any parsed action (or alert enemy) triggers combat
    const currentSessionGameState = riRow?.gameState ?? 'exploration';
    if (currentSessionGameState !== 'combat' && parsedActions.length > 0) {
      const firstAction = parsedActions[0];
      const storyFlags = (roomInstance.session.storyFlags as Record<string, unknown>) ?? {};
      const combatTriggered = detectCombatTrigger(
        firstAction,
        poiContexts as CombatPoiContext[],
        currentSessionGameState,
        storyFlags,
      );
      if (combatTriggered) {
        const activeRoomId = newRoomInstanceId ?? roomInstanceId;
        const activeRoomInstance = newRoomInstanceId
          ? await prisma.roomInstance.findUniqueOrThrow({ where: { id: activeRoomId }, include: { poiInstances: { include: { template: true } } } })
          : roomInstance;
        let freshCs = await enterCombat(activeRoomInstance);

        // If the first actor is an enemy, auto-resolve all leading enemy turns immediately
        // so players are never stuck waiting for the game to unblock.
        if (freshCs.initiativeOrder.find(e => e.id === freshCs.activeActorId)?.type === 'enemy') {
          let workingCs = freshCs;
          let totalEnemyDamage = 0;
          const pendingRollData: NonNullable<EnemyTurnResult['rollData']>[] = [];

          const combatStartPlayerSlot = (activeRoomInstance.poiInstances.find(p => p.id === currentProximityPoiId)?.template as Record<string, unknown> | undefined)?.grid_slot as string ?? 'C';

          while (true) {
            const activeEntry = workingCs.initiativeOrder.find(e => e.id === workingCs.activeActorId);
            if (!activeEntry || activeEntry.type === 'character') break;

            const poiForEnemy = activeRoomInstance.poiInstances.find(p => p.id === activeEntry.id);
            const defaultProps = (poiForEnemy?.template?.defaultProperties ?? {}) as Record<string, unknown>;

            const result = resolveEnemyTurn(activeEntry, workingCs, characterId, character.name, defaultProps, combatStartPlayerSlot);
            allCombatFacts.push(...result.facts);
            totalEnemyDamage += result.hpDamage;
            if (result.rollData) pendingRollData.push(result.rollData);

            workingCs = {
              ...workingCs,
              initiativeOrder: workingCs.initiativeOrder.map(e =>
                e.id === activeEntry.id ? result.updatedEntry : e,
              ),
            };

            if (totalEnemyDamage >= character.currentHp) break;
            workingCs = advanceTurn(workingCs);
          }

          if (totalEnemyDamage > 0) {
            const newHp = Math.max(0, character.currentHp - totalEnemyDamage);
            await prisma.character.update({ where: { id: characterId }, data: { currentHp: newHp } });
          }

          await prisma.roomInstance.update({
            where: { id: activeRoomInstance.id },
            data: { combatState: workingCs as object },
          });

          for (const rollData of pendingRollData) {
            await prisma.messageLog.create({
              data: {
                roomInstanceId: activeRoomInstance.id,
                characterId,
                isMechanicalEvent: false,
                mechanicalSummary: rollData,
                text: `[COMBAT] ${rollData.action}`,
              },
            });
          }
        }
      }
    }

    // Resolve active room context (may change after move_to_room)
    let activeRoomInstanceId = roomInstanceId;
    let activeRoomName = roomInstance.template.name;
    let activeRoomDescription = roomInstance.template.baseDescription;
    let activeGameState = riRow?.gameState ?? 'exploration';
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
        select: { gameState: true, template: { select: { name: true, baseDescription: true } } },
      });
      activeRoomName = newRoom.template.name;
      activeRoomDescription = newRoom.template.baseDescription;
      activeGameState = newRoom.gameState;
    }

    // Stage 4
    const { text: currentNarrativeText, persisted: narrativePersisted } =
      await generateAndPersistNarrative(
        activeRoomInstanceId,
        characterId,
        character.name,
        activeRoomName,
        activeRoomDescription,
        appliedActions,
        roomInstance.session.id,
        allCombatFacts.length > 0 ? allCombatFacts : undefined,
        roomInstance.participants.map(p => p.character.name),
      );

    // Stage 5 — always fetches fresh POI state from DB
    const viewState = await buildViewState(
      activeRoomInstanceId,
      activeGameState,
      characterId,
      roomInstance.session.id,
      activeCharacterProximityTargetId,
      narrativePersisted ? undefined : currentNarrativeText,
    );

    return viewState;
    } finally {
      if (isExplorationAction) {
        await prisma.roomInstance.update({
          where: { id: roomInstanceId },
          data: { processingAction: false },
        }).catch(() => {});
      }
    }
  }
}
