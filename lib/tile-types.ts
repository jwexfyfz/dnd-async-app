export type TileType = "W" | "F" | "D" | "?" | "LF" | "NB" | "FB" | "WN" | "WH";
// W=wall, F=floor, D=door, ?=unknown
// LF=large furniture (LoS+movement), NB=nature barrier (LoS+movement)
// FB=fabric obstacle (LoS only), WN=window (movement only), WH=wall hole (neither)

// Map.data.tiles — template tiles encode terrain + optional spawn refs
export interface MapTile {
  t: TileType;
  enemy?: string;  // enemyId to spawn here
  item?: string;   // itemId to place here at act start
}

// GameMap.data.tiles — live per-game tiles
export interface GameTile {
  t: TileType;
  doorOpen?: boolean;  // only meaningful when t === "D"; closed when absent
  actor?: { kind: "enemy" | "party"; id: string };
  item?: string;  // itemId on the ground (undefined = empty)
}

/** Returns true when a tile blocks line-of-sight. */
export function tileBlocksLoS(tile: GameTile): boolean {
  switch (tile.t) {
    case "W":
    case "LF":
    case "NB":
    case "FB":
      return true;
    case "D":
      return !tile.doorOpen;
    default:
      return false;
  }
}

/** Returns true when a tile blocks movement (terrain only; ignores actors/items). */
export function tileBlocksMovement(tile: GameTile): boolean {
  switch (tile.t) {
    case "W":
    case "LF":
    case "NB":
    case "WN":
    case "WH":
      return true;
    case "D":
      return !tile.doorOpen;
    default:
      return false;
  }
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
  pois:        { id: string; name: string; x: number; y: number; symbol: string; itemId?: string }[];
  enemyState:  Record<string, EnemyInstance>;
  itemState:   Record<string, ItemInstance>;
}
