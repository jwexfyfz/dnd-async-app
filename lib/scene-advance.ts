
// Mechanical scene advancement — evaluates trigger conditions against live DB state
// and advances game.currentSceneId when they are met.
//
// Called inside the Prisma transaction at the end of each turn, AFTER:
//   • combat HP deltas are applied (so ENEMY_DEFEATED sees the updated GameMap.data)
//   • player position is written (so AREA_REACHED sees the new tile)
//   • item pickup is processed (so ITEM_FOUND sees isPickedUp: true)
//
// Returns the new scene on advance so callers can include it in the response.

export type SceneAdvanceResult =
  | { advanced: false }
  | { advanced: true; newScene: { id: string; title: string; description: string } };

export interface SceneTriggerFields {
  id:               string;
  actId:            string;
  order:            number;
  triggerType:      string;
  triggerAreaX:     number | null;
  triggerAreaY:     number | null;
  triggerEnemyId:   string | null;
  triggerItemId:    string | null;
  triggerTurnLimit: number | null;
}

export interface SceneCheckOpts {
  activeCharId:   string;
  isPartyGame:    boolean;
  callerMemberId: string | undefined;
  sceneTurnCount: number;
  gameId:         string;
  currentActId:   string | null;
  // Resolved player position after this turn's movement (avoids stale character.posX/posY in DB).
  callerPos?:     { x: number; y: number };
}

export async function checkSceneTrigger(
  tx: any,
  scene: SceneTriggerFields,
  opts: SceneCheckOpts,
): Promise<{ triggered: boolean; nextScene: { id: string; title: string; description: string } | null }> {
  let triggered = false;

  // Check the NEXT scene's trigger — we want to know if conditions to enter it are met.
  const nextScene = await tx.scene.findFirst({
    where:   { actId: scene.actId, order: scene.order + 1 },
    select:  { id: true, order: true, title: true, description: true, triggerType: true, triggerAreaX: true, triggerAreaY: true, triggerEnemyId: true, triggerItemId: true, triggerTurnLimit: true },
    orderBy: { order: "asc" },
  });

  console.log(`[scene-trigger] ── next scene: id=${nextScene?.id ?? "none"} type=${nextScene?.triggerType ?? "n/a"} ──`);

  if (!nextScene) {
    console.log(`[scene-trigger] no next scene in act | triggered=false`);
    console.log(`[scene-trigger] ── result: triggered=false ──`);
    return { triggered: false, nextScene: null };
  }

  switch (nextScene.triggerType) {
    case "ACT_START":
      // ACT_START scenes are entered by act initialization, not turn-by-turn checks.
      triggered = false;
      console.log(`[scene-trigger] ACT_START: handled by act init, not turn trigger | triggered=false`);
      break;

    case "AREA_REACHED": {
      if (nextScene.triggerAreaX === null || nextScene.triggerAreaY === null) break;
      let posX: number | undefined;
      let posY: number | undefined;
      if (opts.isPartyGame && opts.callerMemberId) {
        const row = await tx.partyMember.findUnique({
          where:  { id: opts.callerMemberId },
          select: { posX: true, posY: true },
        });
        posX = row?.posX; posY = row?.posY;
      } else if (opts.callerPos) {
        // Solo games: character.posX/posY is not written to DB — use the in-memory position.
        posX = opts.callerPos.x; posY = opts.callerPos.y;
      }
      if (posX !== undefined && posY !== undefined) {
        triggered = posX === nextScene.triggerAreaX && posY === nextScene.triggerAreaY;
      }
      console.log(`[scene-trigger] AREA_REACHED: target=(${nextScene.triggerAreaX},${nextScene.triggerAreaY}) actual=(${posX ?? "?"}, ${posY ?? "?"}) | triggered=${triggered}`);
      break;
    }

    case "ENEMY_DEFEATED": {
      if (!nextScene.triggerEnemyId || !opts.currentActId) break;
      const gm = await tx.gameMap.findUnique({
        where:  { gameId_actId: { gameId: opts.gameId, actId: opts.currentActId } },
        select: { data: true },
      });
      if (!gm) break;
      const gmData   = gm.data as any;
      const enemyState = (gmData.enemyState ?? {}) as Record<string, { currentHp: number }>;
      const enemy = enemyState[nextScene.triggerEnemyId];
      triggered = !!enemy && enemy.currentHp <= 0;
      if (enemy) {
        console.log(`[scene-trigger] ENEMY_DEFEATED: triggerEnemyId=${nextScene.triggerEnemyId} currentHp=${enemy.currentHp} | triggered=${triggered}`);
      } else {
        console.log(`[scene-trigger] ENEMY_DEFEATED: triggerEnemyId=${nextScene.triggerEnemyId} NOT FOUND in GameMap.data.enemies | triggered=false`);
      }
      break;
    }

    case "TURN_LIMIT":
      if (nextScene.triggerTurnLimit !== null) {
        triggered = opts.sceneTurnCount >= nextScene.triggerTurnLimit;
      }
      console.log(`[scene-trigger] TURN_LIMIT: sceneTurnCount=${opts.sceneTurnCount} triggerTurnLimit=${nextScene.triggerTurnLimit ?? "none"} | triggered=${triggered}`);
      break;

    case "ITEM_FOUND": {
      if (!nextScene.triggerItemId || !opts.currentActId) break;
      const gm = await tx.gameMap.findUnique({
        where:  { gameId_actId: { gameId: opts.gameId, actId: opts.currentActId } },
        select: { data: true },
      });
      if (!gm) break;
      const gmData2   = gm.data as any;
      const itemState = (gmData2.itemState ?? {}) as Record<string, { isPickedUp: boolean }>;
      const item = itemState[nextScene.triggerItemId];
      triggered = !!item && item.isPickedUp === true;
      console.log(`[scene-trigger] ITEM_FOUND: triggerItemId=${nextScene.triggerItemId} isPickedUp=${item?.isPickedUp ?? "NOT FOUND"} | triggered=${triggered}`);
      break;
    }
  }

  console.log(`[scene-trigger] ── result: triggered=${triggered} ──`);

  if (!triggered) return { triggered: false, nextScene: null };

  return { triggered: true, nextScene: { id: nextScene.id, title: nextScene.title, description: nextScene.description } };
}
