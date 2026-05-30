import type { GameTile } from "./tile-types";
import { getVisibleTiles } from "./game-map-utils";

export const VP_RADIUS = 10;

/**
 * Stub for the future light source system.
 * When implemented, add: sources: LightSource[] (position, radius, type — torch/spell/ambient).
 * Per-character Darkvision ranges and room-level ambient lighting will also live here.
 * For now unused — `getActorVisibleTiles` ignores it and applies a flat VP_RADIUS.
 */
export interface LightContext {
  // sources: LightSource[]  // future
}

export function getActorVisibleTiles(
  tiles: GameTile[][],
  x: number,
  y: number,
  _lightCtx: LightContext = {},
): Set<string> {
  return getVisibleTiles(tiles, x, y, VP_RADIUS);
}

export function debugLogVisibilityGrid(
  tiles: GameTile[][],
  visibleSet: Set<string>,
  viewerX: number,
  viewerY: number,
  label: string,
  markers: { x: number; y: number; char: string }[] = [],
): void {
  if (process.env.NODE_ENV !== "development") return;
  if (tiles.length === 0) return;

  const height = tiles.length;
  const width  = tiles[0]?.length ?? 0;
  const minY = Math.max(0, viewerY - VP_RADIUS);
  const maxY = Math.min(height - 1, viewerY + VP_RADIUS);
  const minX = Math.max(0, viewerX - VP_RADIUS);
  const maxX = Math.min(width  - 1, viewerX + VP_RADIUS);

  const markerMap = new Map(markers.map((m) => [`${m.x},${m.y}`, m.char]));

  const rows: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let row = "";
    for (let x = minX; x <= maxX; x++) {
      if (x === viewerX && y === viewerY) { row += "@"; continue; }
      const marker = markerMap.get(`${x},${y}`);
      if (marker) { row += marker; continue; }
      if (!visibleSet.has(`${x},${y}`)) { row += "░"; continue; }
      const tile = tiles[y]?.[x];
      if (!tile) { row += "?"; continue; }
      if (tile.t === "W") { row += "#"; continue; }
      if (tile.t === "D") { row += "+"; continue; }
      row += "·";
    }
    rows.push(row);
  }

  console.log(`[visibility] ${label} @ (${viewerX},${viewerY}):`);
  console.log(rows.join("\n"));
}
