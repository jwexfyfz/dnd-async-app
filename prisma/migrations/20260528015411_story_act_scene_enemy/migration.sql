/*
  Warnings:

  - You are about to drop the column `currentScenario` on the `Game` table. All the data in the column will be lost.
  - You are about to drop the column `storyPromptId` on the `Game` table. All the data in the column will be lost.
  - You are about to drop the `StoryPrompt` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[actId]` on the table `Map` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SceneTriggerType" AS ENUM ('ACT_START', 'AREA_REACHED', 'ENEMY_DEFEATED', 'ITEM_FOUND', 'TURN_LIMIT');

-- CreateEnum
CREATE TYPE "EnemyStatus" AS ENUM ('DORMANT', 'ACTIVE', 'DEFEATED', 'FLED');

-- DropForeignKey
ALTER TABLE "Game" DROP CONSTRAINT "Game_storyPromptId_fkey";

-- DropForeignKey
ALTER TABLE "StoryPrompt" DROP CONSTRAINT "StoryPrompt_mapId_fkey";

-- AlterTable
ALTER TABLE "Game" DROP COLUMN "currentScenario",
DROP COLUMN "storyPromptId",
ADD COLUMN     "currentActId" TEXT,
ADD COLUMN     "currentSceneId" TEXT,
ADD COLUMN     "storyId" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "activeFromSceneId" TEXT,
ADD COLUMN     "enemyId" TEXT;

-- AlterTable
ALTER TABLE "Map" ADD COLUMN     "actId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sceneId" TEXT;

-- DropTable
DROP TABLE "StoryPrompt";

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'Standard',

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Act" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "playerFacingDescription" TEXT NOT NULL,

    CONSTRAINT "Act_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objectives" TEXT[],
    "triggerType" "SceneTriggerType" NOT NULL,
    "triggerEnemyId" TEXT,
    "triggerItemId" TEXT,
    "triggerAreaX" INTEGER,
    "triggerAreaY" INTEGER,
    "triggerTurnLimit" INTEGER,
    "summary" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enemy" (
    "id" TEXT NOT NULL,
    "actId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "maxHp" INTEGER NOT NULL,
    "currentHp" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 10,
    "dexterity" INTEGER NOT NULL DEFAULT 10,
    "constitution" INTEGER NOT NULL DEFAULT 10,
    "intelligence" INTEGER NOT NULL DEFAULT 10,
    "wisdom" INTEGER NOT NULL DEFAULT 10,
    "charisma" INTEGER NOT NULL DEFAULT 10,
    "armorClass" INTEGER NOT NULL DEFAULT 10,
    "attackBonus" INTEGER NOT NULL DEFAULT 0,
    "damageDice" TEXT NOT NULL,
    "posX" INTEGER NOT NULL,
    "posY" INTEGER NOT NULL,
    "status" "EnemyStatus" NOT NULL DEFAULT 'DORMANT',

    CONSTRAINT "Enemy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_title_key" ON "Story"("title");

-- CreateIndex
CREATE INDEX "Act_storyId_idx" ON "Act"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "Act_storyId_order_key" ON "Act"("storyId", "order");

-- CreateIndex
CREATE INDEX "Scene_actId_idx" ON "Scene"("actId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_actId_order_key" ON "Scene"("actId", "order");

-- CreateIndex
CREATE INDEX "Enemy_actId_idx" ON "Enemy"("actId");

-- CreateIndex
CREATE INDEX "Enemy_sceneId_idx" ON "Enemy"("sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "Map_actId_key" ON "Map"("actId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_activeFromSceneId_fkey" FOREIGN KEY ("activeFromSceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_enemyId_fkey" FOREIGN KEY ("enemyId") REFERENCES "Enemy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enemy" ADD CONSTRAINT "Enemy_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enemy" ADD CONSTRAINT "Enemy_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Map" ADD CONSTRAINT "Map_actId_fkey" FOREIGN KEY ("actId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_currentActId_fkey" FOREIGN KEY ("currentActId") REFERENCES "Act"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_currentSceneId_fkey" FOREIGN KEY ("currentSceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
