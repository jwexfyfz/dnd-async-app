import { prisma } from "./prisma";
import type { MapTile, GameTile, GameMapData, EnemyInstance, ItemInstance } from "./tile-types";

export async function createGameMap(
  gameId: string,
  actId: string,
  tx?: any,
): Promise<{ id: string; data: GameMapData }> {
  const db = tx ?? prisma;

  const mapTemplate = await db.map.findUnique({ where: { actId } });
  if (!mapTemplate) throw new Error(`No map template found for actId ${actId}`);

  const tmpl = mapTemplate.data as Record<string, any>;
  const templateTiles = (tmpl.tiles ?? []) as MapTile[][];

  // Collect enemy and item IDs from spawn tiles
  const enemyIds: string[] = [];
  const itemIds:  string[] = [];
  for (const row of templateTiles) {
    for (const tile of row) {
      if (tile.enemy) enemyIds.push(tile.enemy);
      if (tile.item)  itemIds.push(tile.item);
    }
  }

  // Fetch maxHp for each enemy
  const enemyRows = enemyIds.length > 0
    ? await db.enemy.findMany({
        where:  { id: { in: enemyIds } },
        select: { id: true, maxHp: true },
      })
    : [];
  const enemyMaxHp = new Map<string, number>(enemyRows.map((e: { id: string; maxHp: number }) => [e.id, e.maxHp]));

  // Fetch blocksMovement for each item
  const itemRows = itemIds.length > 0
    ? await db.item.findMany({
        where:  { id: { in: itemIds } },
        select: { id: true, blocksMovement: true },
      })
    : [];
  const itemBlocks = new Map<string, boolean>(itemRows.map((i: { id: string; blocksMovement: boolean }) => [i.id, i.blocksMovement]));

  // Build GameTile grid and registries
  const enemyState: Record<string, EnemyInstance> = {};
  const itemState:  Record<string, ItemInstance>  = {};

  const gameTiles: GameTile[][] = templateTiles.map(row =>
    row.map(tile => {
      const gt: GameTile = { t: tile.t === "?" ? "?" : tile.t };

      if (tile.enemy) {
        const maxHp = enemyMaxHp.get(tile.enemy) ?? 0;
        gt.actor = { kind: "enemy", id: tile.enemy };
        if (!enemyState[tile.enemy]) {
          enemyState[tile.enemy] = {
            currentHp:   maxHp,
            maxHp,
            status:      "DORMANT",
            isHiding:    false,
            stealthRoll: 0,
            hasReaction: true,
            isSurprised: false,
            lootItemIds: [],
          };
        }
      }

      if (tile.item) {
        gt.item = tile.item;
        if (!itemState[tile.item]) {
          itemState[tile.item] = {
            isPickedUp:           false,
            isVisible:            true,
            activeFromSceneOrder: null,
            droppedByEnemyId:     null,
            blocksMovement:       itemBlocks.get(tile.item) ?? false,
          };
        }
      }

      return gt;
    }),
  );

  const gameMapData: GameMapData = {
    width:       tmpl.width  ?? 0,
    height:      tmpl.height ?? 0,
    tiles:       gameTiles,
    playerStart: tmpl.playerStart ?? { x: 0, y: 0 },
    rooms:       tmpl.rooms  ?? [],
    pois:        tmpl.pois   ?? [],
    enemyState,
    itemState,
  };

  const gameMap = await db.gameMap.create({
    data: { gameId, actId, mapId: mapTemplate.id, data: gameMapData as any },
  });

  return { id: gameMap.id, data: gameMapData };
}
