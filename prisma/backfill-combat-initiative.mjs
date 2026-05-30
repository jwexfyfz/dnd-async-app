/**
 * Backfill: remove out-of-viewport and orphaned enemies from CombatSession.initiativeOrder.
 *
 * An enemy slot is removed if any of the following are true:
 *   1. Not on the tile grid (orphaned — never placed or deleted from map).
 *   2. Status is DEFEATED or FLED in gmEnemyState.
 *   3. Outside VP_RADIUS=10 of every player/party-member position (not in combat range).
 *
 * Player position: game.state.playerPos for solo games; PartyMember.posX/posY for party games.
 * An enemy is "in viewport" if it is within VP_RADIUS of ANY player position.
 *
 * If no enemy slots remain after cleanup → delete the CombatSession.
 * If slots changed → update initiativeOrder (rebase currentTurnIndex if needed).
 *
 * Usage: node prisma/backfill-combat-initiative.mjs [--dry-run]
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const VP_RADIUS = 10;
const DRY_RUN = process.argv.includes("--dry-run");
if (DRY_RUN) console.log("--- DRY RUN — no writes will be made ---\n");

// Bresenham LoS — matches lib/game-map-utils.ts hasLineOfSight exactly
function hasLineOfSight(tiles, x0, y0, x1, y1) {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (x === x1 && y === y1) return true;
    const tile = tiles[y]?.[x];
    if (!tile) return false;
    if ((x !== x0 || y !== y0) && (tile.t === "W" || tile.t === "D")) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
}

// Returns true if (ex, ey) is within circular VP_RADIUS AND has LoS from any player position
function isVisible(tiles, playerPositions, ex, ey) {
  return playerPositions.some(({ x, y }) => {
    const dx = ex - x, dy = ey - y;
    if (dx * dx + dy * dy > VP_RADIUS * VP_RADIUS) return false;
    return hasLineOfSight(tiles, x, y, ex, ey);
  });
}

async function main() {
  const sessions = await prisma.combatSession.findMany({
    select: {
      gameId:             true,
      currentTurnIndex:   true,
      currentRoundNumber: true,
      initiativeOrder:    true,
    },
  });

  console.log(`Found ${sessions.length} combat session(s).\n`);

  for (const session of sessions) {
    const order = session.initiativeOrder;

    // Load game, state, party members, and active GameMap in one shot
    const game = await prisma.game.findUnique({
      where:  { id: session.gameId },
      select: {
        currentActId: true,
        state:        true,
        partyMembers: { select: { posX: true, posY: true } },
      },
    });

    // Resolve player positions
    const playerPositions = game?.partyMembers?.length > 0
      ? game.partyMembers.map(m => ({ x: m.posX, y: m.posY }))
      : [{ x: game?.state?.playerPos?.x ?? 0, y: game?.state?.playerPos?.y ?? 0 }];

    const activeGM = game?.currentActId
      ? await prisma.gameMap.findUnique({
          where:  { gameId_actId: { gameId: session.gameId, actId: game.currentActId } },
          select: { data: true },
        })
      : null;

    const gmTiles   = activeGM?.data?.tiles      ?? [];
    const gmEnemySt = activeGM?.data?.enemyState ?? {};
    const hasTilemap = gmTiles.length > 0;

    // Build tile position map for every enemy actor on the grid
    const tilePos = new Map(); // enemyId → { x, y }
    for (let y = 0; y < gmTiles.length; y++) {
      for (let x = 0; x < gmTiles[y].length; x++) {
        const actor = gmTiles[y][x]?.actor;
        if (actor?.kind === "enemy") tilePos.set(actor.id, { x, y });
      }
    }

    const enemySlots = order.filter(s => s.actorType === "ENEMY");
    const toRemove   = enemySlots.filter(s => {
      // 1. Not on tile grid
      if (hasTilemap && !tilePos.has(s.actorId)) return true;
      // 2. Defeated or fled
      const st = gmEnemySt[s.actorId];
      if (st?.status === "DEFEATED" || st?.status === "FLED") return true;
      // 3. Not visible from any player position (outside radius or blocked by wall/door)
      const pos = tilePos.get(s.actorId);
      if (pos && !isVisible(gmTiles, playerPositions, pos.x, pos.y)) return true;
      return false;
    });

    if (toRemove.length === 0) {
      console.log(`game ${session.gameId}: OK — no slots to remove`);
      continue;
    }

    console.log(`game ${session.gameId}: removing ${toRemove.length} of ${enemySlots.length} enemy slot(s)`);
    toRemove.forEach(s => {
      const pos = tilePos.get(s.actorId);
      const reason = !hasTilemap || !tilePos.has(s.actorId)
        ? "not on tile grid"
        : gmEnemySt[s.actorId]?.status === "DEFEATED" || gmEnemySt[s.actorId]?.status === "FLED"
          ? `status=${gmEnemySt[s.actorId].status}`
          : `not visible from player (wall/door blocked or out of radius) enemy=(${pos?.x},${pos?.y}) players=${JSON.stringify(playerPositions)}`;
      console.log(`  → ${s.actorId}: ${reason}`);
    });

    const removeIds     = new Set(toRemove.map(s => s.actorId));
    const cleanedOrder  = order.filter(s => !removeIds.has(s.actorId));
    const remainingEnemies = cleanedOrder.filter(s => s.actorType === "ENEMY");

    if (remainingEnemies.length === 0) {
      console.log(`  No enemy slots remain — deleting combat session.`);
      if (!DRY_RUN) {
        await prisma.combatSession.delete({ where: { gameId: session.gameId } });
      }
      continue;
    }

    // Rebase currentTurnIndex: if the current slot was removed, reset to 0.
    const currentSlot  = order[session.currentTurnIndex];
    const newTurnIndex = currentSlot && !removeIds.has(currentSlot.actorId)
      ? cleanedOrder.findIndex(s => s.actorId === currentSlot.actorId)
      : 0;

    console.log(`  Keeping ${cleanedOrder.length} slot(s), currentTurnIndex: ${session.currentTurnIndex} → ${newTurnIndex}`);
    if (!DRY_RUN) {
      await prisma.combatSession.update({
        where: { gameId: session.gameId },
        data:  { initiativeOrder: cleanedOrder, currentTurnIndex: newTurnIndex },
      });
    }
  }

  console.log("\nDone.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
