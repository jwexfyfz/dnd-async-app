-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "inventory" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "remainingObjectInteractions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "skillsModifiers" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "characterClass" SET DEFAULT 'Fighter',
ALTER COLUMN "maxHp" SET DEFAULT 12,
ALTER COLUMN "currentHp" SET DEFAULT 12;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "gameState" TEXT NOT NULL DEFAULT 'exploration',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "GameMap" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "interactionTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "keyId" TEXT;

-- CreateTable
CREATE TABLE "DungeonTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "globalStyle" TEXT NOT NULL,

    CONSTRAINT "DungeonTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomTemplate" (
    "id" TEXT NOT NULL,
    "dungeonTemplateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseDescription" TEXT NOT NULL,
    "searchFailureNarrative" TEXT NOT NULL,

    CONSTRAINT "RoomTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoiTemplate" (
    "id" TEXT NOT NULL,
    "roomTemplateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywordIdentifier" TEXT NOT NULL,
    "defaultProperties" JSONB NOT NULL,

    CONSTRAINT "PoiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameState" TEXT NOT NULL DEFAULT 'exploration',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomInstance" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roomTemplateId" TEXT NOT NULL,
    "inGameTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gameSessionId" TEXT,

    CONSTRAINT "RoomInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoiInstance" (
    "id" TEXT NOT NULL,
    "roomInstanceId" TEXT NOT NULL,
    "poiTemplateId" TEXT NOT NULL,
    "isStateModified" BOOLEAN NOT NULL DEFAULT false,
    "currentProperties" JSONB NOT NULL,

    CONSTRAINT "PoiInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomParticipant" (
    "id" TEXT NOT NULL,
    "roomInstanceId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "combatState" JSONB NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT,

    CONSTRAINT "RoomParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "roomInstanceId" TEXT NOT NULL,
    "characterId" TEXT,
    "isMechanicalEvent" BOOLEAN NOT NULL DEFAULT false,
    "mechanicalSummary" JSONB,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" TEXT,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientStateView" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "currentNarrative" TEXT NOT NULL,
    "activeState" TEXT NOT NULL,
    "uiLayoutAnchors" JSONB NOT NULL,
    "mechanicalFeedSince" JSONB NOT NULL,

    CONSTRAINT "ClientStateView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseDescription" TEXT NOT NULL,
    "searchFailureNarrative" TEXT NOT NULL,
    "inGameTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointOfInterest" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywordIdentifier" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "combatProperties" JSONB NOT NULL,

    CONSTRAINT "PointOfInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomParticipant_roomInstanceId_characterId_key" ON "RoomParticipant"("roomInstanceId", "characterId");

-- AddForeignKey
ALTER TABLE "RoomTemplate" ADD CONSTRAINT "RoomTemplate_dungeonTemplateId_fkey" FOREIGN KEY ("dungeonTemplateId") REFERENCES "DungeonTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoiTemplate" ADD CONSTRAINT "PoiTemplate_roomTemplateId_fkey" FOREIGN KEY ("roomTemplateId") REFERENCES "RoomTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInstance" ADD CONSTRAINT "RoomInstance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInstance" ADD CONSTRAINT "RoomInstance_roomTemplateId_fkey" FOREIGN KEY ("roomTemplateId") REFERENCES "RoomTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomInstance" ADD CONSTRAINT "RoomInstance_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoiInstance" ADD CONSTRAINT "PoiInstance_roomInstanceId_fkey" FOREIGN KEY ("roomInstanceId") REFERENCES "RoomInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoiInstance" ADD CONSTRAINT "PoiInstance_poiTemplateId_fkey" FOREIGN KEY ("poiTemplateId") REFERENCES "PoiTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_roomInstanceId_fkey" FOREIGN KEY ("roomInstanceId") REFERENCES "RoomInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomParticipant" ADD CONSTRAINT "RoomParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_roomInstanceId_fkey" FOREIGN KEY ("roomInstanceId") REFERENCES "RoomInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointOfInterest" ADD CONSTRAINT "PointOfInterest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
