-- CreateTable
CREATE TABLE "GameInventory" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GameInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameInventory_gameId_idx" ON "GameInventory"("gameId");

-- AddForeignKey
ALTER TABLE "GameInventory" ADD CONSTRAINT "GameInventory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
