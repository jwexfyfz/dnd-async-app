// ─── Grid Spatial Engine ──────────────────────────────────────────────────────

type Pos = { x: number; y: number };

/**
 * D&D 5e alternating diagonal cost: 1st diagonal = 5ft, 2nd = 10ft, repeating.
 * Straight movement costs 5ft per tile.
 */
export function diagonalDistance(a: Pos, b: Pos): number {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const straight = Math.abs(dx - dy);
  const diags    = Math.min(dx, dy);
  const diagCost = Math.ceil(diags / 2) * 5 + Math.floor(diags / 2) * 10;
  return straight * 5 + diagCost;
}

/**
 * Ray-march line of sight from tile center to tile center.
 * Returns true if the path is unobstructed.
 * Only "W" tiles block LoS; doors ("D") are transparent.
 */
export function lineOfSight(from: Pos, to: Pos, tiles: string[][]): boolean {
  const fx = from.x + 0.5;
  const fy = from.y + 0.5;
  const tx = to.x + 0.5;
  const ty = to.y + 0.5;
  const dx = tx - fx;
  const dy = ty - fy;
  // 4 samples per tile gives enough resolution to detect a wall in any tile crossed
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 4);
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t  = i / steps;
    const cx = Math.floor(fx + t * dx);
    const cy = Math.floor(fy + t * dy);
    if (tiles[cy]?.[cx] === "W") return false;
  }
  return true;
}

export interface AoOEnemy {
  id:          string;
  pos:         Pos;
  hasReaction: boolean;
  isSurprised: boolean;
}

/**
 * Returns the ID of the first reactive, un-surprised enemy whose threat zone
 * the mover exits (was ≤5 ft, will be >5 ft after movement), or null if no
 * Attack of Opportunity is triggered.
 */
export function checkAttackOfOpportunity(
  moverPos: Pos,
  destPos:  Pos,
  enemies:  AoOEnemy[],
): string | null {
  for (const enemy of enemies) {
    if (!enemy.hasReaction || enemy.isSurprised) continue;
    const currentDist = diagonalDistance(moverPos, enemy.pos);
    const destDist    = diagonalDistance(destPos,  enemy.pos);
    if (currentDist <= 5 && destDist > 5) return enemy.id;
  }
  return null;
}
