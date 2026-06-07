-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "isDead" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "hostCharacterId" TEXT,
ADD COLUMN     "kickedCharacterIds" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lobbyState" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lobbyVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RoomInstance" ADD COLUMN     "combatState" JSONB,
ADD COLUMN     "gameState" TEXT NOT NULL DEFAULT 'exploration',
ADD COLUMN     "processingAction" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);
