-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "posX" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "posY" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Enemy" ADD COLUMN     "hasReaction" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isHiding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSurprised" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stealthRoll" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PartyMember" ADD COLUMN     "isHiding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stealthRoll" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CombatSession" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "initiativeOrder" JSONB NOT NULL,
    "currentTurnIndex" INTEGER NOT NULL DEFAULT 0,
    "currentRoundNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CombatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CombatSession_gameId_key" ON "CombatSession"("gameId");

-- AddForeignKey
ALTER TABLE "CombatSession" ADD CONSTRAINT "CombatSession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
