export interface GameActionRequest {
  characterId: string;
  roomInstanceId: string;
  playerActionText: string;
  action_hint?: string | null;
  target_poi_instance_id?: string | null;
}

export type ActionType =
  | 'change_proximity'
  | 'narrative_only'
  | 'examine'
  | 'interact'
  | 'destroy_poi'
  | 'force_open'
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
  | 'shove'
  | 'dodge'
  | 'dash'
  | 'disengage'
  | 'hide'
  | 'provoke'
  | 'death_save'
  | 'use_class_feature';

export interface ExtractedAction {
  action_type: ActionType;
  target_poi_instance_id: string | null;
  resulting_stance: string | null;
  interaction_result: string | null;
  target_room_template_id: string | null;
  item_id: string | null;
  target_character_id: string | null;
}

export type TargetClass = 'self' | 'ally' | 'enemy' | 'poi';

export interface ItemDefinition {
  id: string;
  name: string;
  description?: string;
  quantity?: number;
  equip_slot?: 'main_hand' | 'off_hand' | 'head' | 'chest' | 'legs' | 'feet' | 'ring' | 'amulet' | 'hands';
  equip_bonus?: Record<string, number>;
  damage_dice?: string;
  weapon_type?: 'melee' | 'ranged' | 'finesse';
  two_handed?: boolean;
  throwable?: boolean;
  throw_damage_type?: string;
  throw_effect?: 'ignite';
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
  combat_usable?: boolean;
  silent?: boolean;
  target?: TargetClass | TargetClass[];
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
    hands?: ItemDefinition;
  };
}

export type GachaRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface GachaPullRecord {
  itemId: string;
  itemName: string;
  rarity: GachaRarity;
  pulledAt: string;
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

export type MechanicalSummaryType =
  | { type: 'xp_gained'; amount: number; source: string; characterId: string }
  | { type: 'level_up'; newLevel: number; oldHp: number; newHp: number; newFeatures: string[]; characterId: string }
  | { type: 'level_up_confirmed'; choiceType: 'asi' | 'subclass'; detail: string; characterId: string }
  | { type: string; [key: string]: unknown };

export interface NarrativeLog {
  id: string;
  text: string;
  isMechanicalEvent: boolean;
  mechanicalSummary: MechanicalSummaryType | null;
  createdAt: Date;
  authorAvatarUrl?: string | null;
  authorName?: string | null;
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
  grid_slot?: string;
  status_effects: string[];
  priority_target?: string;
  priority_target_until_round?: number;
  str_score?: number;
  reactionUsed?: boolean;
  resistances?: string[];
  passive_perception?: number;
  constitutionSave?: number;
  isDormant?: boolean;
  remoteRoomInstanceId?: string;
  deathSaveSuccesses?: number;
  deathSaveFailures?: number;
  isStabilized?: boolean;
}

export type PendingChoice =
  | { type: 'asi'; level: number }
  | { type: 'subclass'; level: number }
  | { type: 'heroic_sacrifice'; fallenName: string; fallenClass: string; fallenLevel: number };

/** @deprecated Use PendingChoice */
export type PendingLevelUpChoice = PendingChoice;

export interface NextFeature {
  name: string;
  level: number;
}

export interface PartyMemberInfo {
  characterId: string;
  characterName: string;
  characterClass: string;
  avatarUrl: string | null;
  currentHp: number;
  maxHp: number;
  isDead: boolean;
  isDormant: boolean;
  isInSameRoom: boolean;
  currentRoom: string;
  lastSeenAt: Date | null;
  // Full stats for character sheet display
  level: number;
  ac: number;
  attackBonus: number;
  initiativeMod: number;
  baseStrength: number;
  baseDexterity: number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom: number;
  baseCharisma: number;
  skillsModifiers: Record<string, number>;
  skillProficiencies: string[];
  // XP progress (Phase 5)
  xp: number;
  xpToNextLevel: number | null;
  nextFeature: NextFeature | null;
  // Resource pools
  resourceStates: Array<{ poolKey: string; current: number }>;
  classFeatureDetails: CharacterStats['classFeatureDetails'];
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
  accumulatedXp?: number;
}

export interface CharacterStats {
  name: string;
  currentHp: number;
  maxHp: number;
  ac: number;
  level: number;
  xp: number;
  characterClass: string;
  attackBonus: number;
  weaponDamage: { main: string | null; off: string | null };
  initiativeMod: number;
  baseStrength: number;
  baseDexterity: number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom: number;
  baseCharisma: number;
  skillsModifiers: Record<string, number>;
  skillProficiencies: string[];
  isHiding: boolean;
  pendingChoicesQueue: PendingChoice[];
  subclass: string | null;
  critThreshold: number;
  featuresUnlocked: string[];
  resourceStates: Array<{ poolKey: string; current: number }>;
  canShortRest: boolean;
  pendingPulls: number;
  streakDays: number;
  streakShields: number;
  lastStreakDate: string | null;
  pityCount: number;
  milestoneFlags: string[];
  pullHistory: GachaPullRecord[];
  classFeatureDetails: Array<{
    id: string;
    name: string;
    featureType: string;
    mechanicsJson: unknown;
    actionType: string | null;
    implemented: boolean;
    level: number;
    subclass: string | null;
    description: string;
    icon?: string;
    resourcePool?: {
      poolKey: string;
      maxByLevel: Record<string, number>;
      resetOn: 'SHORT_REST' | 'LONG_REST';
      dieSize: number | null;
    } | null;
  }>;
}

export interface CombatAlertInfo {
  roomName: string;
  fightingCharacters: string[];
  round: number;
}

export interface RemoteCombatInfo {
  roomInstanceId: string;
  roomName: string;
  combatState: CombatState;
}

export interface ViewStatePayload {
  roomInstanceId: string;
  currentNarrative: NarrativeLog[];
  activeState: string;
  gameState: 'exploration' | 'combat';
  combatState: CombatState | null;
  combatAlert: CombatAlertInfo | null;
  remoteCombat: RemoteCombatInfo | null;
  poiIndex: Record<string, string>;
  poiStates: Record<string, PoiState>;
  uiLayoutAnchors: UiLayoutAnchors;
  characterInventory: CharacterInventory;
  openSpaceItems: ItemDefinition[];
  adjacentRoomPreviews: Record<string, AdjacentRoomPreview>;
  characterStats: CharacterStats;
  partyMembers: PartyMemberInfo[];
  rollResult?: {
    d20: number;
    allRolls?: number[];
    success: boolean;
    isCrit: boolean;
    damage?: number;
    targetDefeated?: boolean;
    rollType?: 'attack' | 'hide' | 'provoke' | 'shove';
    damageRolls?: number[];
    damageDieFaces?: number;
    modifier?: number;
    dc?: number;
    vsTarget?: string;
  };
}
