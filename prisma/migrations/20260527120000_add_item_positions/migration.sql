-- Add optional grid positions to Item for map-based rendering.
-- posX/posY are null when the item is held in a character slot or backpack.
-- Set explicitly for map-loot items that appear on the grid.

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "posX" INTEGER;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "posY" INTEGER;
