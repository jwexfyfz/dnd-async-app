export type TileType = "W" | "F" | "D" | "?";

// Map.data.tiles — template tiles encode terrain + optional spawn refs
export interface MapTile {
  t: TileType;
  enemy?: string;  // enemyId to spawn here
  item?: string;   // itemId to place here at act start
}

// GameMap.data.tiles — live per-game tiles
export interface GameTile {
  t: TileType;
  actor?: { kind: "enemy" | "party"; id: string };
  item?: string;  // itemId on the ground (undefined = empty)
}

export interface EnemyInstance {
  currentHp:    number;
  maxHp:        number;
  status:       "DORMANT" | "ACTIVE" | "DEFEATED" | "FLED";
  isHiding:     boolean;
  stealthRoll:  number;
  hasReaction:  boolean;
  isSurprised:  boolean;
  lootItemIds:  string[];
}

export interface ItemInstance {
  isPickedUp:           boolean;
  isVisible:            boolean;
  activeFromSceneOrder: number | null;
  droppedByEnemyId:     string | null;
  blocksMovement:       boolean;
}

export interface GameMapData {
  width:       number;
  height:      number;
  tiles:       GameTile[][];
  playerStart: { x: number; y: number };
  rooms:       { name: string; description: string }[];
  pois:        { id: string; name: string; x: number; y: number; symbol: string }[];
  enemyState:  Record<string, EnemyInstance>;
  itemState:   Record<string, ItemInstance>;
}
