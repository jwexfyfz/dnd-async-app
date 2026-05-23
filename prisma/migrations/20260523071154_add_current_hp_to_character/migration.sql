-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "currentHp" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_currentHp_nonneg" CHECK ("currentHp" >= 0);

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_currentHp_cap" CHECK ("currentHp" <= "maxHp");
