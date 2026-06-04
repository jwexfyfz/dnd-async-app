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

  // C1: Fetch mainHandId for each enemy to populate loot
  const enemyLootRows = enemyIds.length > 0
    ? await db.enemy.findMany({
        where:  { id: { in: enemyIds } },
        select: { id: true, mainHandId: true },
      })
    : [];
  const enemyLootMap = new Map<string, string>(
    enemyLootRows
      .filter((e: { id: string; mainHandId: string | null }) => e.mainHandId !== null)
      .map((e: { id: string; mainHandId: string }) => [e.id, e.mainHandId])
  );

  // Fetch blocksMovement for each item
  const itemRows = itemIds.length > 0
    ? await db.item.findMany({
        where:  { id: { in: itemIds } },
        select: { id: true, blocksMovement: true },
      })
    : [];
  const itemBlocks = new Map<string, boolean>(itemRows.map((i: { id: string; blocksMovement: boolean }) => [i.id, i.blocksMovement]));

  // C3: Fetch container item names from Map.data.pois containerInventory slots
  const containerItemIds = (tmpl.pois ?? [])
    .flatMap((p: any) => (p.containerInventory ?? []).map((s: any) => s.itemId as string))
    .filter(Boolean) as string[];
  let containerItemNameMap: Map<string, string> | undefined;
  if (containerItemIds.length > 0) {
    const containerItemRows = await db.item.findMany({
      where:  { id: { in: containerItemIds } },
      select: { id: true, name: true },
    });
    containerItemNameMap = new Map(containerItemRows.map((i: { id: string; name: string }) => [i.id, i.name]));
  }

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
          // C2: Populate lootItemIds from enemy mainHandId
          enemyState[tile.enemy] = {
            currentHp:   maxHp,
            maxHp,
            status:      "DORMANT",
            isHiding:    false,
            stealthRoll: 0,
            hasReaction: true,
            isSurprised: false,
            lootItemIds: enemyLootMap.has(tile.enemy) ? [enemyLootMap.get(tile.enemy)!] : [],
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

  const itemPosMap = new Map<string, string>();
  for (let iy = 0; iy < gameTiles.length; iy++) {
    for (let ix = 0; ix < gameTiles[iy].length; ix++) {
      const tid = gameTiles[iy][ix]?.item;
      if (tid) itemPosMap.set(`${ix},${iy}`, tid);
    }
  }

  const gameMapData: GameMapData = {
    width:       tmpl.width  ?? 0,
    height:      tmpl.height ?? 0,
    tiles:       gameTiles,
    playerStart: tmpl.playerStart ?? { x: 0, y: 0 },
    rooms:       tmpl.rooms  ?? [],
    // C4: Enrich POI initialization with container and terrain live state
    pois: (tmpl.pois ?? []).map((p: any) => ({
      ...p,
      itemId: itemPosMap.get(`${p.x},${p.y}`),
      ...(p.isContainer ? {
        isOpen:     false,
        searchedBy: [],
        containerInventory: (p.containerInventory ?? []).map((slot: any) => ({
          ...slot,
          itemName: containerItemNameMap?.get(slot.itemId) ?? slot.itemId,
        })),
      } : {}),
      ...(p.maxHp !== undefined ? {
        currentHp:   p.maxHp,
        isLocked:    !!p.lockId,
        isDestroyed: false,
      } : {}),
    })),
    enemyState,
    itemState,
  };

  console.log("[create-game-map] enemyState lootItemIds", Object.fromEntries(
    Object.entries(enemyState).map(([id, st]) => [id, st.lootItemIds])
  ));

  const gameMap = await db.gameMap.create({
    data: { gameId, actId, mapId: mapTemplate.id, data: gameMapData as any },
  });

  return { id: gameMap.id, data: gameMapData };
}
