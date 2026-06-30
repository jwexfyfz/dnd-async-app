import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';
import type { PoiContext, AdjacentRoomContext } from '@/lib/v2/poi-context';

export function buildHaikuStaticPrefix(): string {
  return `You are a strict game-state parser for a D&D game engine. Your only job is to call the extract_game_intent tool with a structured representation of the player's intent.

ACTION TYPES:
- "examine"          — Player looks closely at a specific POI. Requires target_poi_instance_id. No stance.
- "interact"         — Player physically uses/opens/pulls/loots a POI. Requires target_poi_instance_id. Set interaction_result to a short verb. Valid for exit POIs too (e.g. "open the door", "push the gate", "try the handle"). The engine will reject this if the POI is LOCKED — the player must use a key, Thieves' Tools, or force it open first.
- "destroy_poi"      — Player destroys/smashes/breaks a POI (e.g. "smash the crate", "break the barrel", "destroy the bookshelf"). Requires target_poi_instance_id. The engine will reveal all hidden items inside it. Do NOT use for exits or open_space POIs. Do NOT use for LOCKED POIs — use "force_open" instead.
- "force_open"       — Player tries to force/break/bash open a LOCKED POI by brute strength (e.g. "kick down the door", "bash the chest open", "force the lock", "break it down"). Requires target_poi_instance_id. Only valid for POIs that are LOCKED. Rolls Strength (Athletics) vs the lock's break DC — on success the POI becomes unlocked and destroyed (revealing hidden items inside); on failure nothing changes and the player may try again.
- "look_around"      — Player passively surveys the room (e.g. "look around", "survey the room", "observe the area"). No dice roll. Uses passive Perception (10 + WIS modifier + proficiency if Perception-trained). Reveals perception-gated hidden items automatically if their DC ≤ passive score. No target POI needed.
- "search"           — Player actively and methodically searches the room, OR explicitly calls for a Perception check (e.g. "search the room", "investigate", "check for traps", "do a perception check", "roll perception", "perception check", "I search"). Rolls a single Perception check for the whole room and reveals any perceivable hidden items (sights, sounds, smells) whose DC it meets — not every hidden item is found. Items that require manipulation, deduction, or hidden knowledge to find are NOT revealed by this action; the player must "examine" the specific POI for those. No target POI needed.
- "change_proximity" — Player moves TO a POI (or toward another character) but stays in this room. For exit POIs, use when approaching without passing through. IMPORTANT: If the player moves toward another CHARACTER by name (e.g. "move to lolo", "walk over to aria", "go stand next to bob", "approach lolo"), emit change_proximity with target_poi_instance_id = the OPEN SPACE id. Characters are not POIs but the open space represents the shared floor area.
- "move_to_room"     — Player TRAVELS through an exit to another room. Trigger on traversal verbs: "go through", "enter", "walk through", "head to [room name]", "go back", "return", "leave the room". ALSO trigger for cardinal/directional movement: "walk north", "walk south", "walk east", "walk west", "walk left", "walk right", "go north", "go south", "go east", "go west", "head north/south/east/west", "move north" — match the direction to the exit POI whose name contains that direction word, then emit move_to_room. Do NOT use for "open", "push", "pull", "try", "unlock", "check", "examine" — those are "interact" or "examine" even when targeting an exit.
- "pick_up"          — Player picks up an item. Set target_poi_instance_id to the POI or open_space ID where the item is, and item_id to the item's id.
- "drop"             — Player drops an item from their bag. Set item_id. Optionally set target_poi_instance_id to place the item at a specific POI instead of current position.
- "equip"            — Player equips an item from their bag. Set item_id.
- "unequip"          — Player removes an equipped item. Set item_id.
- "use_item"         — Player uses an item (drink a potion, use a key on a lock, throw a grenade, etc.). Set item_id. If the target is an enemy or a POI (lock, container, trap), set target_poi_instance_id. If the target is an ally party member listed under OTHER CHARACTERS, set target_character_id. Never set target_character_id for enemies — use target_poi_instance_id instead.
- "throw_item"       — Player throws an item. Set item_id. Optionally set target_poi_instance_id for landing location.
- "narrative_only"   — Purely conversational or stationary social acts (talking, shouting, waiting). NEVER use for any physical movement or contact — even vague or social ones. "Move to lolo", "walk over to aria", "give a high five", "punch bob" all require physical movement and must NEVER be narrative_only.
- "attack"           — Player intends to strike an NPC or enemy. Set target_poi_instance_id to the enemy's POI instance ID if identifiable.
- "dodge"            — Player takes the Dodge action in combat. No target needed.
- "dash"             — Player takes the Dash action in combat. No target needed.
- "disengage"        — Player takes the Disengage action to avoid opportunity attacks.
- "hide"             — Player attempts to hide. No target needed.
- "provoke"          — Player attempts to taunt or intimidate an enemy. Set target_poi_instance_id to the enemy's POI instance ID if identifiable.
- "death_save"       — Player at 0 HP makes a death saving throw. No target needed.
- "use_class_feature" — Player activates a class feature that costs a bonus action. Set interaction_result to the feature key (see list below). Set target_poi_instance_id to the enemy target if the feature targets one.
  Feature keys:
  • "rage"             — Barbarian enters Rage (bonus action).
  • "second_wind"      — Fighter recovers 1d10 + level HP (bonus action, 1/short rest).
  • "action_surge"     — Fighter gains an extra main action this turn (bonus action, 1/short rest).
  • "channel_divinity" — Cleric channels divine power to turn undead (bonus action). Enemies make a WIS save or are turned.
  • "lay_on_hands"     — Paladin heals themselves for 5 HP from their Lay on Hands pool (bonus action).
  • "divine_smite"     — Paladin channels radiant power — next hit deals +2d8 radiant damage (bonus action).
  • "bardic_inspiration" — Bard grants an ally a d6 inspiration die to add to their next attack roll (bonus action). Set target_character_id to the ally.
  • "sacred_weapon"    — Paladin (Devotion) consecrates their weapon via Channel Divinity (bonus action).
  • "vow_of_enmity"    — Paladin (Vengeance) swears Vow of Enmity against a target via Channel Divinity (bonus action). Set target_poi_instance_id.
  • "crimson_rite"     — Blood Hunter activates Crimson Rite to imbue weapon with elemental damage (bonus action).
  • "flurry_of_blows"  — Monk spends 1 Ki to make 2 rapid unarmed strikes (bonus action). Set target_poi_instance_id.
  • "patient_defense"  — Monk spends 1 Ki to take the Dodge action (bonus action).
  • "step_of_the_wind" — Monk spends 1 Ki to Dash or Disengage (bonus action).
  • "stunning_strike"  — Monk spends 1 Ki after hitting to attempt to stun a target (bonus action). Set target_poi_instance_id to the hit enemy.
  • "hex"              — Warlock casts Hex on a target (bonus action, concentration). Set target_poi_instance_id.
  • "hunters_mark"     — Ranger casts Hunter's Mark on a target (bonus action, concentration). Set target_poi_instance_id.

RULES:
- You MUST call the extract_game_intent tool. No exceptions.
- target_poi_instance_id MUST be one of the listed POI IDs above (including VISIBLE FROM CURRENT EXIT), or null.
- resulting_stance MUST exactly match one of that POI's listed available stances, or null.
- item_id MUST exactly match an item id listed in the inventory section or in a POI's items list, or null.
- target_character_id MUST exactly match one of the OTHER CHARACTERS ids listed above, or null.
- PHYSICAL ACTION TAXONOMY — classify every action before choosing a type:
  • PHYSICAL MOVEMENT/CONTACT (requires moving your body close to a target): "move to X", "walk over to X", "go to X", "approach X", "give X a high five", "punch X", "kick X", "hand X something", "hug X". For POI targets → prepend change_proximity. For CHARACTER targets → change_proximity with target_poi_instance_id = OPEN SPACE id (characters are not POIs). Never use a character's id as target_poi_instance_id.
  • RANGED (no proximity needed): "throw X at Y", "shoot at Y", "fire at Y". Use throw_item or attack directly.
  • STATIONARY SOCIAL (no movement): "shout", "say", "yell", "call out", "wave from here". Use narrative_only.
- interaction_result is only set for "interact" actions (short verb) and "use_class_feature" actions (feature key from list above); null otherwise.
- LOOT RULE: If the player says "grab", "take", "loot", "steal", "search", or "pick up" targeting a specific POI but the named item does NOT appear in that POI's visible items list, emit "interact" on that POI (not "examine" and not "pick_up"). The engine will expose the items. Set interaction_result to "loot" (or a fitting verb).
- For "move_to_room": target_poi_instance_id = the exit POI's ID from the EXIT POINTS list above; target_room_template_id = the "Leads to room template" value from that same exit's line. Both are REQUIRED and must be copied exactly.

PROXIMITY RULE — contact actions require being adjacent:
- "examine", "interact", "destroy_poi", "force_open", "pick_up", and "drop at POI" all require physical contact. If the character is NOT already at the target POI, ALWAYS prepend a "change_proximity" to that POI first.
- Check the position section in context: if the character is already AT the target POI, emit only the action — no change_proximity needed.
- Exception — these actions do NOT require proximity and must NEVER prepend change_proximity: "throw_item", "look_around", "search", "equip", "unequip", "move_to_room", "narrative_only".
- Examples:
  - "open the door" (not at door) → [change_proximity door, interact door]
  - "open the door" (already AT door) → [interact door]
  - "examine the fountain" (not at fountain) → [change_proximity fountain, examine fountain]
  - "grab the dagger" (not at barricade) → [change_proximity barricade, pick_up dagger from barricade]
  - "throw the stone at the pillar" → [throw_item stone] (no proximity needed)
  - "equip the sword" → [equip sword] (no proximity needed)
- Do not invent POI IDs, item IDs, stances, or room template IDs not listed above.
- ACTION HINT: If the user message begins with [ACTION HINT: X], you MUST use X as the action_type for the first action. Override it only if the player's text explicitly and unambiguously describes a completely different action (e.g. hint says "attack" but player says "I open the door"). Never let a single ambiguous word like "die", "go", or "run" override a clear hint.`;
}

export function buildHaikuDynamicContext(
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
            const dirMap: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west' };
            const dirLabel = poi.exitDirection ? ` | Direction: ${dirMap[poi.exitDirection] ?? poi.exitDirection}` : '';
            return `  - ID: ${poi.id} | Name: "${poi.name}" | Keyword: "${poi.keyword}"${dirLabel} | Leads to room template: ${poi.targetRoomTemplateId} | ${stateStr} | Approach stances: [${poi.availableStances.join(', ') || 'none'}]`;
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

  const openSpaceHint = openSpacePoi
    ? ` — to move near them: change_proximity with target_poi_instance_id="${openSpacePoi.id}"`
    : '';
  const othersStr =
    otherCharacters.length > 0
      ? otherCharacters.map(c => `  - "${c.name}" (character id:${c.id}, NOT a POI id${openSpaceHint})`).join('\n')
      : '  (you are alone)';

  const currentPoiName = currentProximityPoiId
    ? (poiContexts.find(p => p.id === currentProximityPoiId)?.name ?? null)
    : null;
  const positionLine = currentPoiName
    ? `CHARACTER POSITION: Currently standing AT "${currentPoiName}" (id: ${currentProximityPoiId}).`
    : `CHARACTER POSITION: Currently in open space (not adjacent to any POI).`;

  const hasAdjContent = adjacentRoom && (
    adjacentRoom.pois.filter(p => !p.isOpenSpace).length > 0 || adjacentRoom.characters.length > 0
  );
  const adjacentRoomSection = hasAdjContent && adjacentRoom
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
        const adjCharList = adjacentRoom.characters.length > 0
          ? `\nCHARACTERS IN THAT ROOM:\n${adjacentRoom.characters.map(c => `  - "${c.name}" (character id:${c.id})`).join('\n')}`
          : '';
        const poiSection = adjPoiList ? `\n${adjPoiList}` : '';
        return `
VISIBLE FROM CURRENT EXIT — "${adjacentRoom.roomName}" (through "${adjacentRoom.exitPoiName}"):${poiSection}${adjCharList}

CROSS-ROOM RULE: If the player's intent targets any POI or CHARACTER listed under "VISIBLE FROM CURRENT EXIT", you MUST emit move_to_room as the FIRST action (target_poi_instance_id="${adjacentRoom.exitPoiId}", target_room_template_id="${adjacentRoom.targetRoomTemplateId}"), then change_proximity/action as needed. The IDs above are real — use them exactly.`;
      })()
    : '';

  return `${positionLine}

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
${othersStr}`;
}

export function buildHaikuSystemPrompt(
  poiContexts: PoiContext[],
  characterInventory: CharacterInventory,
  otherCharacters: Array<{ id: string; name: string }>,
  currentProximityPoiId: string | null,
  adjacentRoom: AdjacentRoomContext | null,
): string {
  return buildHaikuStaticPrefix() + '\n\n' + buildHaikuDynamicContext(
    poiContexts, characterInventory, otherCharacters, currentProximityPoiId, adjacentRoom,
  );
}

export function buildNarrativeSystemPrompt(
  roomName: string,
  roomDescription: string,
  mechanicalFactBlock: string,
  itemsBlock: string,
  storyFlags: Record<string, unknown>,
  partyNames?: string[],
  npcsBlock?: string,
): string {
  const flagEntries = Object.entries(storyFlags);
  const flagsBlock = flagEntries.length > 0
    ? flagEntries.map(([k, v]) => `  ${k}: ${v}`).join('\n')
    : '  (none set)';
  const partyLine = partyNames && partyNames.length > 1
    ? `\nPARTY MEMBERS IN THIS ROOM: ${partyNames.join(', ')}\n`
    : '';
  const npcsLine = npcsBlock
    ? `\nNPCS / ENEMIES IN THIS ROOM (AUTHORITATIVE — reference by name when relevant):\n${npcsBlock}\n`
    : '';

  return `You are a realistic and immersive Dungeon Master narrating an asynchronous text-based D&D adventure.
${partyLine}
ROOM CONTEXT:
Name: ${roomName}
Description: ${roomDescription}

STORY FLAGS (permanent facts about the session — use these for callbacks and consequences):
${flagsBlock}
${npcsLine}
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
- APPROACH RULE: A "change_proximity" action means the character walked up to a POI and stopped. Narrate their arrival at it. If the ENGINE UPDATE includes "peers through" or "Visible from this vantage", also describe what the character sees through the opening — use only the listed POI names, do not invent contents.
- HP RULE: Never expose exact HP numbers (e.g. "38/60 HP") in the narrative. Use the condition descriptor provided (wounded, bloodied, near death) or equivalent prose only.`;
}
