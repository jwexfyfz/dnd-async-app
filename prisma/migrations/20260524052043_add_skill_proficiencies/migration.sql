-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "skillProficiencies" TEXT[] DEFAULT ARRAY[]::TEXT[];
