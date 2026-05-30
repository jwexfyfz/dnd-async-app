-- ─── Phase 1: Create GameMap table ───────────────────────────────────────────

CREATE TABLE "GameMap" (
    "id"        TEXT NOT NULL,
    "gameId"    TEXT NOT NULL,
    "actId"     TEXT NOT NULL,
    "mapId"     TEXT NOT NULL,
    "data"      JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameMap_gameId_actId_key" ON "GameMap"("gameId", "actId");
CREATE INDEX "GameMap_gameId_idx" ON "GameMap"("gameId");

ALTER TABLE "GameMap" ADD CONSTRAINT "GameMap_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameMap" ADD CONSTRAINT "GameMap_actId_fkey"
    FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GameMap" ADD CONSTRAINT "GameMap_mapId_fkey"
    FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Phase 2: Backfill GameMap from existing Game + Map + Item + Enemy data ───
-- Runs before old columns are dropped.
-- Only creates records for games that have an active act and a map assigned.
-- Enemy status defaults: enemies belonging to the current scene → ACTIVE, others → DORMANT.

INSERT INTO "GameMap" ("id", "gameId", "actId", "mapId", "data", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    g."id",
    g."currentActId",
    g."mapId",
    jsonb_build_object(
        'width',       COALESCE((m."data" ->> 'width')::int,  0),
        'height',      COALESCE((m."data" ->> 'height')::int, 0),
        'tiles',       COALESCE(m."data" -> 'tiles',       '[]'::jsonb),
        'playerStart', COALESCE(m."data" -> 'playerStart', '{"x":0,"y":0}'::jsonb),
        'rooms',       COALESCE(m."data" -> 'rooms',       '[]'::jsonb),
        'pois',        COALESCE(m."data" -> 'pois',        '[]'::jsonb),

        -- Items: all Item rows attached to this map template
        'items', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'itemId',              i."id",
                        'posX',                COALESCE(i."posX", 0),
                        'posY',                COALESCE(i."posY", 0),
                        'isPickedUp',          false,
                        'isVisible',           (i."activeFromSceneId" IS NULL),
                        'activeFromSceneOrder', s."order",
                        'droppedByEnemyId',    i."enemyId"
                    )
                )
                FROM "Item" i
                LEFT JOIN "Scene" s ON s."id" = i."activeFromSceneId"
                WHERE i."mapId" = m."id"
            ),
            '[]'::jsonb
        ),

        -- Enemies: all Enemy rows belonging to this act
        'enemies', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'enemyId',    e."id",
                        'posX',       e."posX",
                        'posY',       e."posY",
                        'currentHp',  e."currentHp",
                        'maxHp',      e."maxHp",
                        'status',     CASE
                                          WHEN e."sceneId" = g."currentSceneId" THEN e."status"::text
                                          WHEN e."status"::text = 'DEFEATED'    THEN 'DEFEATED'
                                          WHEN e."status"::text = 'FLED'        THEN 'FLED'
                                          ELSE 'DORMANT'
                                      END,
                        'isHiding',   e."isHiding",
                        'stealthRoll', e."stealthRoll",
                        'hasReaction', e."hasReaction",
                        'isSurprised', e."isSurprised",
                        'lootItemIds', COALESCE(
                            (
                                SELECT jsonb_agg(li."id"::text)
                                FROM "Item" li
                                WHERE li."enemyId" = e."id"
                            ),
                            '[]'::jsonb
                        )
                    )
                )
                FROM "Enemy" e
                WHERE e."actId" = g."currentActId"
            ),
            '[]'::jsonb
        )
    ),
    NOW(),
    NOW()
FROM "Game"    g
JOIN "Map"     m ON m."id" = g."mapId"
WHERE g."currentActId" IS NOT NULL;

-- ─── Phase 3: Drop old columns from Item ─────────────────────────────────────

DROP INDEX IF EXISTS "Item_mapId_idx";
ALTER TABLE "Item" DROP CONSTRAINT IF EXISTS "Item_mapId_fkey";
ALTER TABLE "Item" DROP CONSTRAINT IF EXISTS "Item_activeFromSceneId_fkey";
ALTER TABLE "Item" DROP CONSTRAINT IF EXISTS "Item_enemyId_fkey";

ALTER TABLE "Item"
    DROP COLUMN IF EXISTS "posX",
    DROP COLUMN IF EXISTS "posY",
    DROP COLUMN IF EXISTS "mapId",
    DROP COLUMN IF EXISTS "activeFromSceneId",
    DROP COLUMN IF EXISTS "enemyId";

-- ─── Phase 4: Drop instance-state columns from Enemy ─────────────────────────

ALTER TABLE "Enemy"
    DROP COLUMN IF EXISTS "posX",
    DROP COLUMN IF EXISTS "posY",
    DROP COLUMN IF EXISTS "currentHp",
    DROP COLUMN IF EXISTS "status",
    DROP COLUMN IF EXISTS "isHiding",
    DROP COLUMN IF EXISTS "stealthRoll",
    DROP COLUMN IF EXISTS "hasReaction",
    DROP COLUMN IF EXISTS "isSurprised";

-- ─── Phase 5: Drop Game.mapId ────────────────────────────────────────────────

ALTER TABLE "Game" DROP CONSTRAINT IF EXISTS "Game_mapId_fkey";
ALTER TABLE "Game" DROP COLUMN IF EXISTS "mapId";

-- ─── Phase 6: Drop GameInventory table ───────────────────────────────────────

ALTER TABLE "GameInventory" DROP CONSTRAINT IF EXISTS "GameInventory_gameId_fkey";
DROP TABLE IF EXISTS "GameInventory";

-- ─── Phase 7: Drop EnemyStatus enum ─────────────────────────────────────────

DROP TYPE IF EXISTS "EnemyStatus";
