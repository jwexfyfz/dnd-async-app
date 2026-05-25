-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "remainingActions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "remainingBonusActions" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "remainingMovementFeet" INTEGER NOT NULL DEFAULT 30;
