import type { GameTile, EnemyInstance, ItemInstance } from "./tile-types";

/** Flatten GameTile[][] to string[][] (tile char only) for grid.ts lineOfSight. */
export function tilesToStringGrid(tiles: GameTile[][]): string[][] {
  return tiles.map(row => row.map(cell => cell.t));
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
  if (tile.t === "W") return false;
  if (tile.t === "D") return false;
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

// Bresenham line check — returns true if the straight line from (x0,y0) to
// (x1,y1) crosses no opaque tile before reaching the destination.
function hasLineOfSight(tiles: GameTile[][], x0: number, y0: number, x1: number, y1: number): boolean {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (x === x1 && y === y1) return true;
    const tile = tiles[y]?.[x];
    if (!tile) return false;
    // Opaque: walls and closed doors block sight (but origin tile is passable)
    if ((x !== x0 || y !== y0) && (tile.t === "W" || tile.t === "D")) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
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
