import type { ItemDefinition } from '@/types/v2-game';

export interface PoiCombatStats {
  dex_score?: number;
  wis_score?: number;
  con_score?: number;
  attack_bonus?: number;
  damage?: string;
  max_hp?: number;
  ac?: number;
  passive_perception?: number;
  resistances?: string[];
}

export interface AiBehavior {
  priority?: 'aggressive' | 'defensive' | 'cowardly';
  flee_threshold?: number;
}

export interface PoiContext {
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
  exitDirection: string | null;
  targetRoomTemplateId: string | null;
  items: ItemDefinition[];
  floorItems: ItemDefinition[];
  isOpenSpace: boolean;
  visibility: 'always' | 'proximity_only';
  peekVisibility: 'none' | 'obvious_only' | 'full';
  _currentAwareness?: string;
  _hostileTo?: string[];
  _recognitionException?: string;
  _combatStats?: PoiCombatStats;
  _aiBehavior?: AiBehavior;
  _defaultProps?: Record<string, unknown>;
}

export interface CombatPoiContext extends PoiContext {
  _currentAwareness?: string;
  _hostileTo?: string[];
  _recognitionException?: string;
  _combatStats?: PoiCombatStats;
  _aiBehavior?: AiBehavior;
  _currentHp?: number;
  _defaultProps?: Record<string, unknown>;
}

export interface AdjacentRoomContext {
  roomName: string;
  exitPoiId: string;
  exitPoiName: string;
  targetRoomTemplateId: string;
  pois: PoiContext[];
  characters: Array<{ id: string; name: string }>;
}
