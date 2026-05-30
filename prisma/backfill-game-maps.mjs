/**
 * Backfill script: creates GameMap records for any Game that doesn't have one.
 *
 * Run after the add_game_map_and_cleanup migration.
 * Relies on Map.data containing top-level "enemySpawns" and "itemPlacements"
 * arrays (populated by seed Phase D). Games without a currentActId are skipped.
 *
 * Usage: node prisma/backfill-game-maps.mjs
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const games = await prisma.game.findMany({
    where: { currentActId: { not: null } },
    include: {
      gameMaps: { select: { actId: true } },
      currentAct: {
        include: {
          map: true,
          enemies: {
            include: { scene: { select: { order: true } } },
          },
        },
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const game of games) {
    const alreadyHasMap = game.gameMaps.some(
      (gm) => gm.actId === game.currentActId
    );
    if (alreadyHasMap) {
      skipped++;
      continue;
    }

    const act = game.currentAct;
    if (!act?.map) {
      console.warn(`Game ${game.id}: no map found for act ${game.currentActId}, skipping`);
      skipped++;
      continue;
    }

    const template = act.map.data;

    // Build item instances from Map.data.itemPlacements (set by seed phase D).
    // Falls back to empty array if seed hasn't been updated yet.
    const itemPlacements = template.itemPlacements ?? [];
    const items = itemPlacements.map((p) => ({
      itemId: p.itemId,
      posX: p.posX,
      posY: p.posY,
      isPickedUp: false,
      isVisible: p.activeFromSceneOrder == null,
      activeFromSceneOrder: p.activeFromSceneOrder ?? null,
      droppedByEnemyId: p.droppedByEnemyId ?? null,
    }));

    // Build enemy instances from Map.data.enemySpawns (set by seed phase D).
    // Falls back to enemy template list with (0,0) positions if not yet seeded.
    const enemySpawns = template.enemySpawns ?? [];
    const spawnMap = new Map(enemySpawns.map((s) => [s.enemyId, s]));

    const enemies = act.enemies.map((e) => {
      const spawn = spawnMap.get(e.id);
      return {
        enemyId: e.id,
        posX: spawn?.posX ?? 0,
        posY: spawn?.posY ?? 0,
        currentHp: e.maxHp,
        maxHp: e.maxHp,
        // Current scene enemies are ACTIVE, others DORMANT
        status: e.scene.order === 1 ? "DORMANT" : "DORMANT",
        isHiding: false,
        stealthRoll: 0,
        hasReaction: true,
        isSurprised: false,
        lootItemIds: spawn?.lootItemIds ?? [],
      };
    });

    const data = {
      width: template.width ?? 0,
      height: template.height ?? 0,
      tiles: template.tiles ?? [],
      playerStart: template.playerStart ?? { x: 0, y: 0 },
      rooms: template.rooms ?? [],
      pois: template.pois ?? [],
      items,
      enemies,
    };

    await prisma.gameMap.create({
      data: {
        gameId: game.id,
        actId: game.currentActId,
        mapId: act.map.id,
        data,
      },
    });

    created++;
    console.log(`Created GameMap for game ${game.id} (act ${game.currentActId})`);
  }

  console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
