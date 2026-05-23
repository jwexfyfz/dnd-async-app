-- CreateTable
CREATE TABLE "EquippableItem" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isEquipped" BOOLEAN NOT NULL DEFAULT false,
    "combatImpactLabel" TEXT NOT NULL,

    CONSTRAINT "EquippableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquippableItem_mapId_idx" ON "EquippableItem"("mapId");

-- AddForeignKey
ALTER TABLE "EquippableItem" ADD CONSTRAINT "EquippableItem_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;
