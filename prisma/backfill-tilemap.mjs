/**
 * Backfill: converts GameMap records from old { enemies[], items[] } format
 * to new { tiles (GameTile objects with actor/item slots), enemyState, itemState }.
 *
 * Run after seed.mjs has been re-run so Map.data.tiles are MapTile objects.
 * Usage: node prisma/backfill-tilemap.mjs
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon }   = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma  = new PrismaClient({ adapter });

async function main() {
  const gameMaps = await prisma.gameMap.findMany({ select: { id: true, data: true, mapId: true } });
  console.log(`Found ${gameMaps.length} GameMap record(s).`);

  let converted = 0, skipped = 0;

  for (const gm of gameMaps) {
    const d = gm.data;

    // Already converted — tiles are objects with { t } field
    if (Array.isArray(d.tiles) && d.tiles[0]?.[0]?.t !== undefined) {
      // But might be missing enemyState/itemState registries — rebuild from tile scan
      if (d.enemyState && d.itemState) { skipped++; continue; }
    }

    // Fetch the Map template to get the MapTile grid
    const mapTemplate = await prisma.map.findUnique({ where: { id: gm.mapId }, select: { data: true } });
    if (!mapTemplate) { console.warn(`  [skip] no map template for gameMap ${gm.id}`); skipped++; continue; }

    const tmpl = mapTemplate.data;
    const templateTiles = tmpl.tiles ?? [];

    // Detect if template tiles are the new MapTile format or old string format
    const isNewFormat = Array.isArray(templateTiles[0]) && typeof templateTiles[0][0] === "object";

    // Collect old enemy/item data for HP preservation
    const oldEnemies = (d.enemies ?? []);
    const oldItems   = (d.items   ?? []);
    const oldEnemyMap = new Map(oldEnemies.map(e => [e.enemyId, e]));
    const oldItemMap  = new Map(oldItems.map(i => [i.itemId, i]));

    // Fetch current DB values for enemies/items on this map
    const enemyIds = isNewFormat
      ? templateTiles.flat().filter(t => t.enemy).map(t => t.enemy)
      : oldEnemies.map(e => e.enemyId);
    const itemIds = isNewFormat
      ? templateTiles.flat().filter(t => t.item).map(t => t.item)
      : oldItems.map(i => i.itemId);

    const [enemyRows, itemRows] = await Promise.all([
      enemyIds.length > 0 ? prisma.enemy.findMany({ where: { id: { in: enemyIds } }, select: { id: true, maxHp: true } }) : [],
      itemIds.length  > 0 ? prisma.item.findMany({  where: { id: { in: itemIds  } }, select: { id: true, blocksMovement: true } }) : [],
    ]);
    const enemyMaxHp  = new Map(enemyRows.map(e => [e.id, e.maxHp]));
    const itemBlocks  = new Map(itemRows.map(i => [i.id, i.blocksMovement]));

    // Build GameTile[][] from template
    const enemyState = {};
    const itemState  = {};

    const gameTiles = isNewFormat
      ? templateTiles.map(row => row.map(tile => {
          const gt = { t: tile.t };
          if (tile.enemy) {
            const old   = oldEnemyMap.get(tile.enemy);
            const maxHp = enemyMaxHp.get(tile.enemy) ?? 0;
            gt.actor = { kind: "enemy", id: tile.enemy };
            enemyState[tile.enemy] = {
              currentHp:   old?.currentHp ?? maxHp,
              maxHp,
              status:      old?.status    ?? "DORMANT",
              isHiding:    old?.isHiding  ?? false,
              stealthRoll: old?.stealthRoll ?? 0,
              hasReaction: old?.hasReaction ?? true,
              isSurprised: old?.isSurprised ?? false,
              lootItemIds: old?.lootItemIds ?? [],
            };
          }
          if (tile.item) {
            const old = oldItemMap.get(tile.item);
            if (!old?.isPickedUp) gt.item = tile.item;
            itemState[tile.item] = {
              isPickedUp:           old?.isPickedUp ?? false,
              isVisible:            old?.isVisible  ?? true,
              activeFromSceneOrder: old?.activeFromSceneOrder ?? null,
              droppedByEnemyId:     old?.droppedByEnemyId    ?? null,
              blocksMovement:       itemBlocks.get(tile.item) ?? false,
            };
          }
          return gt;
        }))
      : (tmpl.tiles ?? []).map(row => row.map(t => ({ t: typeof t === "string" ? t : (t.t ?? "F") })));

    // For old-format maps: place enemies/items at their recorded positions
    if (!isNewFormat) {
      for (const e of oldEnemies) {
        const px = e.posX ?? 0, py = e.posY ?? 0;
        if (gameTiles[py]?.[px]) gameTiles[py][px].actor = { kind: "enemy", id: e.enemyId };
        enemyState[e.enemyId] = {
          currentHp: e.currentHp ?? (enemyMaxHp.get(e.enemyId) ?? 0),
          maxHp:     e.maxHp    ?? (enemyMaxHp.get(e.enemyId) ?? 0),
          status:    e.status   ?? "DORMANT",
          isHiding: e.isHiding ?? false, stealthRoll: e.stealthRoll ?? 0,
          hasReaction: e.hasReaction ?? true, isSurprised: e.isSurprised ?? false,
          lootItemIds: e.lootItemIds ?? [],
        };
      }
      for (const i of oldItems) {
        const px = i.posX ?? 0, py = i.posY ?? 0;
        if (!i.isPickedUp && gameTiles[py]?.[px]) gameTiles[py][px].item = i.itemId;
        itemState[i.itemId] = {
          isPickedUp: i.isPickedUp ?? false, isVisible: i.isVisible ?? true,
          activeFromSceneOrder: i.activeFromSceneOrder ?? null,
          droppedByEnemyId: i.droppedByEnemyId ?? null,
          blocksMovement: itemBlocks.get(i.itemId) ?? false,
        };
      }
    }

    const newData = {
      width:       d.width  ?? tmpl.width  ?? 0,
      height:      d.height ?? tmpl.height ?? 0,
      tiles:       gameTiles,
      playerStart: d.playerStart ?? tmpl.playerStart ?? { x: 0, y: 0 },
      rooms:       d.rooms  ?? tmpl.rooms  ?? [],
      pois:        d.pois   ?? tmpl.pois   ?? [],
      enemyState,
      itemState,
    };

    await prisma.gameMap.update({ where: { id: gm.id }, data: { data: newData } });
    console.log(`  [converted] gameMap ${gm.id}`);
    converted++;
  }

  console.log(`\nDone. Converted: ${converted}, Skipped: ${skipped}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
