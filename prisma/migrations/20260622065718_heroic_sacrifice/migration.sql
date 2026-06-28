-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "pendingArrivalContext" JSONB;

-- AlterTable
ALTER TABLE "RoomParticipant" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
