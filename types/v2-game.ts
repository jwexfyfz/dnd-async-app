export interface GameActionRequest {
  characterId: string;
  roomInstanceId: string;
  playerActionText: string;
  action_hint?: string | null;
}

export type ActionType =
  | 'change_proximity'
  | 'narrative_only'
  | 'examine'
  | 'interact'
  | 'destroy_poi'
  | 'look_around'
  | 'search'
  | 'move_to_room'
  | 'pick_up'
  | 'drop'
  | 'equip'
  | 'unequip'
  | 'use_item'
  | 'throw_item'
  | 'attack'
  | 'dodge'
  | 'dash'
  | 'disengage'
  | 'hide'
  | 'provoke'
  | 'death_save';

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
  passive_effect?: string;
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

export interface InitiativeEntry {
  id: string;
  type: 'character' | 'enemy';
  name: string;
  initiative: number;
  hp: number;
  maxHp: number;
  ac: number;
  surprised: boolean;
  acted: boolean;
  proximity: 'close' | 'far';
  status_effects: string[];
  priority_target?: string;
  priority_target_until_round?: number;
}

export interface TurnUsage {
  actionUsed: boolean;
  bonusActionUsed: boolean;
  movementUsed: boolean;
  reactionUsed: boolean;
}

export interface CombatState {
  round: number;
  initiativeOrder: InitiativeEntry[];
  activeActorId: string;
  currentTurnUsage: TurnUsage;
}

export interface ViewStatePayload {
  roomInstanceId: string;
  currentNarrative: NarrativeLog[];
  activeState: string;
  gameState: 'exploration' | 'combat';
  combatState: CombatState | null;
  poiIndex: Record<string, string>;
  poiStates: Record<string, PoiState>;
  uiLayoutAnchors: UiLayoutAnchors;
  characterInventory: CharacterInventory;
  openSpaceItems: ItemDefinition[];
  adjacentRoomPreviews: Record<string, AdjacentRoomPreview>;
}
