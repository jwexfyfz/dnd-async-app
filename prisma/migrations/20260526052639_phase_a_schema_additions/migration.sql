-- CreateEnum
CREATE TYPE "TurnQueueStatus" AS ENUM ('PENDING_ROLLS', 'COMPLETED');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "activeConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hasCastedBonusSpell" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remainingReactions" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "activeSuggestionChips" JSONB,
ADD COLUMN     "currentScenario" TEXT,
ADD COLUMN     "narrativeHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "worldState" JSONB;

-- AlterTable
ALTER TABLE "PartyMember" ADD COLUMN     "posX" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "posY" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ActiveTurnQueue" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" "TurnQueueStatus" NOT NULL DEFAULT 'PENDING_ROLLS',
    "currentRollIndex" INTEGER NOT NULL DEFAULT 0,
    "rolls" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveTurnQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActiveTurnQueue_gameId_idx" ON "ActiveTurnQueue"("gameId");

-- AddForeignKey
ALTER TABLE "ActiveTurnQueue" ADD CONSTRAINT "ActiveTurnQueue_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
