-- Phase E: Item Model Collapse
-- Merges EquippableItem into Item; replaces statBonuses Json + SlotType enum
-- with typed statKey/statModifierBonus columns.
-- IF NOT EXISTS guards make each step safe to re-run after a partial failure.

-- ── Step 1: Add new columns to Item ──────────────────────────────────────────

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "type"              TEXT NOT NULL DEFAULT '';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "statKey"           TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "statModifierBonus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "mapId"             TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "category"          TEXT NOT NULL DEFAULT '';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "description"       TEXT NOT NULL DEFAULT '';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "weightLbs"         DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "quantity"          INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "isEquipped"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "combatImpactLabel" TEXT NOT NULL DEFAULT '';

-- ── Step 2: Populate type from existing slotType enum ────────────────────────

UPDATE "Item" SET "type" = "slotType"::text WHERE "type" = '';

-- ── Step 3: Give slotType a temporary default so EquippableItem rows insert ──

ALTER TABLE "Item" ALTER COLUMN "slotType" SET DEFAULT 'WEAPON'::"SlotType";

-- ── Step 4: Copy EquippableItem rows into Item (skip rows already migrated) ──

INSERT INTO "Item" (
  id, name, "type", "mapId", category, description,
  "weightLbs", quantity, "isEquipped", "combatImpactLabel", "statModifierBonus"
)
SELECT
  e.id,
  e.name,
  CASE
    WHEN e.category = 'Weapon' AND lower(e.name) LIKE '%shield%' THEN 'SHIELD'
    WHEN e.category = 'Weapon'                                    THEN 'WEAPON'
    WHEN e.category = 'Armor'  AND lower(e.name) LIKE '%shield%' THEN 'SHIELD'
    WHEN e.category = 'Armor'                                     THEN 'ARMOR'
    WHEN e.category = 'Consumable'                                THEN 'CONSUMABLE'
    WHEN e.category = 'Held'                                      THEN 'FOCUS'
    ELSE 'WEAPON'
  END,
  e."mapId",
  e.category,
  COALESCE(e.description, ''),
  e."weightLbs",
  e.quantity,
  e."isEquipped",
  e."combatImpactLabel",
  0
FROM "EquippableItem" e
WHERE NOT EXISTS (SELECT 1 FROM "Item" i WHERE i.id = e.id);

-- ── Step 5: Remove the temporary default ─────────────────────────────────────

ALTER TABLE "Item" ALTER COLUMN "slotType" DROP DEFAULT;

-- ── Step 6: FK constraint + index for mapId ───────────────────────────────────

ALTER TABLE "Item"
  ADD CONSTRAINT "Item_mapId_fkey"
  FOREIGN KEY ("mapId") REFERENCES "Map"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Item_mapId_idx" ON "Item"("mapId");

-- ── Step 7: Drop EquippableItem ───────────────────────────────────────────────

DROP TABLE IF EXISTS "EquippableItem";

-- ── Step 8: Drop superseded Item columns ──────────────────────────────────────

ALTER TABLE "Item" DROP COLUMN IF EXISTS "slotType";
ALTER TABLE "Item" DROP COLUMN IF EXISTS "statBonuses";

-- ── Step 9: Drop SlotType enum (column must be gone first) ───────────────────

DROP TYPE IF EXISTS "SlotType";
