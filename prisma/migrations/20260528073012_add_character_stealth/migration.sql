-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "isHiding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stealthRoll" INTEGER NOT NULL DEFAULT 0;
