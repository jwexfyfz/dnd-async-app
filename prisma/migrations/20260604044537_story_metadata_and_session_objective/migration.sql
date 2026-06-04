-- AlterTable
ALTER TABLE "DungeonTemplate" ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'Standard',
ADD COLUMN     "length" TEXT NOT NULL DEFAULT 'Short',
ADD COLUMN     "startRoomTemplateId" TEXT,
ADD COLUMN     "synopsis" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tone" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "currentObjective" TEXT,
ADD COLUMN     "dungeonTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_dungeonTemplateId_fkey" FOREIGN KEY ("dungeonTemplateId") REFERENCES "DungeonTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
