-- AlterTable
ALTER TABLE "Enemy" ADD COLUMN     "mainHandId" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "rangeFeet" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "weaponType" TEXT NOT NULL DEFAULT 'melee';

-- AddForeignKey
ALTER TABLE "Enemy" ADD CONSTRAINT "Enemy_mainHandId_fkey" FOREIGN KEY ("mainHandId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
