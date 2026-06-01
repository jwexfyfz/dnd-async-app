import type { GameTile, EnemyInstance, ItemInstance } from "./tile-types";
import { tileBlocksLoS, tileBlocksMovement } from "./tile-types";

/**
 * Flatten GameTile[][] to string[][] for the string-based LoS path in grid.ts.
 * Open doors are emitted as "F" so the string-path ray-marcher treats them as
 * transparent — closed doors and all other tile types keep their own char.
 */
export function tilesToStringGrid(tiles: GameTile[][]): string[][] {
  return tiles.map(row => row.map(cell => {
    if (cell.t === "D" && cell.doorOpen) return "F";
    return cell.t;
  }));
}

export function findActor(
  tiles: GameTile[][],
  id: string,
): { x: number; y: number } | null {
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].actor?.id === id) return { x, y };
    }
  }
  return null;
}

export function findItem(
  tiles: GameTile[][],
  itemId: string,
): { x: number; y: number } | null {
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].item === itemId) return { x, y };
    }
  }
  return null;
}

export function isTilePassable(
  tile: GameTile,
  enemyState: Record<string, EnemyInstance>,
  itemState: Record<string, ItemInstance>,
  moverId: string,
): boolean {
  if (tileBlocksMovement(tile)) return false;
  if (tile.actor && tile.actor.id !== moverId) {
    if (tile.actor.kind === "party") return false;
    const es = enemyState[tile.actor.id];
    if (!es || es.status === "DORMANT" || es.status === "ACTIVE") return false;
  }
  if (tile.item) {
    const is = itemState[tile.item];
    if (is && is.blocksMovement && !is.isPickedUp) return false;
  }
  return true;
}

// Returns a new tiles array — does not mutate the input.
// If dest is occupied by a different actor, returns tiles unchanged.
export function moveActor(
  tiles: GameTile[][],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): GameTile[][] {
  const dest = tiles[toY]?.[toX];
  if (!dest) return tiles;
  if (dest.actor && dest.actor.id !== tiles[fromY]?.[fromX]?.actor?.id) return tiles;

  const actor = tiles[fromY][fromX].actor;
  if (!actor) return tiles;

  return tiles.map((row, y) =>
    row.map((tile, x) => {
      if (x === fromX && y === fromY) {
        const { actor: _a, ...rest } = tile;
        return rest as GameTile;
      }
      if (x === toX && y === toY) return { ...tile, actor };
      return tile;
    }),
  );
}

export function placeItem(
  tiles: GameTile[][],
  itemId: string,
  x: number,
  y: number,
): GameTile[][] {
  return tiles.map((row, ry) =>
    row.map((tile, rx) => {
      if (rx === x && ry === y) return { ...tile, item: itemId };
      return tile;
    }),
  );
}

export function removeItem(tiles: GameTile[][], x: number, y: number): GameTile[][] {
  return tiles.map((row, ry) =>
    row.map((tile, rx) => {
      if (rx === x && ry === y) {
        const { item: _i, ...rest } = tile;
        return rest as GameTile;
      }
      return tile;
    }),
  );
}

// Ray-cast line-of-sight — samples 4 points per tile distance along the continuous
// ray from tile-center to tile-center. Matches the approach in lib/grid.ts so that
// visual LoS and combat LoS are geometrically consistent.
export function hasLineOfSight(tiles: GameTile[][], x0: number, y0: number, x1: number, y1: number): boolean {
  const fx = x0 + 0.5, fy = y0 + 0.5;
  const tx = x1 + 0.5, ty = y1 + 0.5;
  const dx = tx - fx, dy = ty - fy;
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 4);
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t  = i / steps;
    const cx = Math.floor(fx + t * dx);
    const cy = Math.floor(fy + t * dy);
    // Skip samples that land on the destination or origin tile — both are always reachable.
    if ((cx === x1 && cy === y1) || (cx === x0 && cy === y0)) continue;
    const tile = tiles[cy]?.[cx];
    if (!tile || tileBlocksLoS(tile)) return false;
  }
  return true;
}

export function getVisibleTiles(
  tiles: GameTile[][],
  originX: number,
  originY: number,
  radius: number,
): Set<string> {
  const visible = new Set<string>();
  const height = tiles.length;
  const width  = tiles[0]?.length ?? 0;

  const minX = Math.max(0, originX - radius);
  const maxX = Math.min(width  - 1, originX + radius);
  const minY = Math.max(0, originY - radius);
  const maxY = Math.min(height - 1, originY + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - originX, dy = y - originY;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (hasLineOfSight(tiles, originX, originY, x, y)) {
        visible.add(`${x},${y}`);
      }
    }
  }
  return visible;
}
