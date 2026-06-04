export interface GameActionRequest {
  characterId: string;
  roomInstanceId: string;
  playerActionText: string;
}

export type ActionType =
  | 'change_proximity'
  | 'narrative_only'
  | 'examine'
  | 'interact'
  | 'look_around'
  | 'search'
  | 'move_to_room'
  | 'pick_up'
  | 'drop'
  | 'equip'
  | 'unequip'
  | 'use_item'
  | 'throw_item';

export interface ExtractedAction {
  action_type: ActionType;
  target_poi_instance_id: string | null;
  resulting_stance: string | null;
  interaction_result: string | null;
  target_room_template_id: string | null;
  item_id: string | null;
  target_character_id: string | null;
}

export interface ItemDefinition {
  id: string;
  name: string;
  quantity?: number;
  equip_slot?: 'main_hand' | 'off_hand' | 'head' | 'chest' | 'legs' | 'feet' | 'ring' | 'amulet';
  equip_bonus?: Record<string, number>;
  throwable?: boolean;
  consumable?: boolean;
  charges?: number;
  on_depleted?: 'destroy' | 'inert';
  use_effect?: string;
  story_flag?: string;
  improvised?: boolean;
  obvious?: boolean;
  hidden?: boolean;
  reveal_check?: { skill: string; dc: number };
  value_gp?: number;
}

export interface CharacterInventory {
  bag: ItemDefinition[];
  equipped: {
    main_hand?: ItemDefinition;
    off_hand?: ItemDefinition;
    head?: ItemDefinition;
    chest?: ItemDefinition;
    legs?: ItemDefinition;
    feet?: ItemDefinition;
    ring?: ItemDefinition;
    amulet?: ItemDefinition;
  };
}

export interface EntityRef {
  entityId: string;
  entityType: 'character' | 'npc';
  name: string;
  stance: string | null;
}

export interface UiLayoutAnchors {
  open_space: EntityRef[];
  [poiInstanceId: string]: EntityRef[];
}

export interface NarrativeLog {
  id: string;
  text: string;
  isMechanicalEvent: boolean;
  mechanicalSummary: unknown;
  createdAt: Date;
}

export interface PoiState {
  examined: boolean;
  interacted: boolean;
  unlocked: boolean;
  items: ItemDefinition[];
}

export interface AdjacentRoomPreview {
  roomName: string;
  items: ItemDefinition[];
  characters: EntityRef[];
}

export interface ViewStatePayload {
  roomInstanceId: string;
  currentNarrative: NarrativeLog[];
  activeState: string;
  poiIndex: Record<string, string>;
  poiStates: Record<string, PoiState>;
  uiLayoutAnchors: UiLayoutAnchors;
  characterInventory: CharacterInventory;
  openSpaceItems: ItemDefinition[];
  adjacentRoomPreviews: Record<string, AdjacentRoomPreview>;
}
