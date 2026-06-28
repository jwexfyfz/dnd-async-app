export const SLOT_COORDS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

export function slotGridDistance(a: string, b: string): number {
  const ca = SLOT_COORDS[a] ?? SLOT_COORDS.C;
  const cb = SLOT_COORDS[b] ?? SLOT_COORDS.C;
  return Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1]));
}

export function resolveEffectiveVisibility(
  defaultProps: Record<string, unknown>,
  currentProps: Record<string, unknown>,
): 'always' | 'proximity_only' {
  if (currentProps.visibility_override === 'always') return 'always';
  return ((defaultProps.visibility as string) ?? 'always') as 'always' | 'proximity_only';
}

export const LOS_SLOT_PX = 40;
export const LOS_ROOM_PX = LOS_SLOT_PX * 3;

export const LOS_SLOT_OFFSETS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

export const LOS_ADJ_ORIGIN: Record<string, [number, number]> = {
  N: [0, -LOS_ROOM_PX], S: [0, LOS_ROOM_PX],
  E: [LOS_ROOM_PX, 0],  W: [-LOS_ROOM_PX, 0],
};

export function losSlotCenter(slot: string, roomX: number, roomY: number): [number, number] {
  const [sx, sy] = LOS_SLOT_OFFSETS[slot] ?? [1, 1];
  return [roomX + sx * LOS_SLOT_PX + LOS_SLOT_PX / 2, roomY + sy * LOS_SLOT_PX + LOS_SLOT_PX / 2];
}

export function losArchOpening(wallSection: string, archWidth: number): [number, number] {
  const start = ({ N: 0, C: 1, S: 2 } as Record<string, number>)[wallSection] ?? 1;
  return [start, Math.min(start + archWidth, 3)];
}

export function isPoiVisibleThroughExit(
  charSlot: string,
  targetSlot: string,
  exitDirection: string,
  exitWallSection: string,
  exitArchWidth: number,
): boolean {
  const [adjX, adjY] = LOS_ADJ_ORIGIN[exitDirection] ?? [0, 0];
  const [cx, cy] = losSlotCenter(charSlot, 0, 0);
  const [tx, ty] = losSlotCenter(targetSlot, adjX, adjY);

  const isXWall = exitDirection === 'E' || exitDirection === 'W';
  const wallCoord = exitDirection === 'E' || exitDirection === 'S' ? LOS_ROOM_PX : 0;

  let crossCoord: number;
  if (isXWall) {
    if (tx === cx) return false;
    crossCoord = cy + (ty - cy) * (wallCoord - cx) / (tx - cx);
  } else {
    if (ty === cy) return false;
    crossCoord = cx + (tx - cx) * (wallCoord - cy) / (ty - cy);
  }

  const roomRelative = crossCoord / LOS_SLOT_PX;
  const [openMin, openMax] = losArchOpening(exitWallSection, exitArchWidth);
  return roomRelative >= openMin && roomRelative <= openMax;
}
