/*
  Warnings:

  - You are about to drop the column `gameSessionId` on the `RoomInstance` table. All the data in the column will be lost.
  - Added the required column `sessionId` to the `GameMap` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sessionId` to the `RoomInstance` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "RoomInstance" DROP CONSTRAINT "RoomInstance_gameId_fkey";

-- DropForeignKey
ALTER TABLE "RoomInstance" DROP CONSTRAINT "RoomInstance_gameSessionId_fkey";

-- AlterTable
ALTER TABLE "GameMap" ADD COLUMN     "sessionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RoomInstance" DROP COLUMN "gameSessionId",
ADD COLUMN     "sessionId" TEXT NOT NULL,
ALTER COLUMN "gameId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RoomInstance" ADD CONSTRAINT "RoomInstance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInstance" ADD CONSTRAINT "RoomInstance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameMap" ADD CONSTRAINT "GameMap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
