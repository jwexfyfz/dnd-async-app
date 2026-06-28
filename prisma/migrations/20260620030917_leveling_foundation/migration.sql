-- CreateEnum
CREATE TYPE "FeatureType" AS ENUM ('PASSIVE', 'STAT_MODIFIER', 'RESOURCE_POOL', 'ACTIVE_ABILITY', 'TRIGGERED_EFFECT', 'REACTION', 'CHOICE_GATE', 'SPELLCASTING');

-- CreateEnum
CREATE TYPE "FeatureActionType" AS ENUM ('ACTION', 'BONUS_ACTION', 'REACTION', 'FREE');

-- CreateEnum
CREATE TYPE "RestType" AS ENUM ('SHORT_REST', 'LONG_REST');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "critThreshold" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "featuresUnlocked" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastLongRest" TIMESTAMP(3),
ADD COLUMN     "pendingChoicesQueue" JSONB[] DEFAULT ARRAY[]::JSONB[],
ADD COLUMN     "subclass" TEXT;

-- AlterTable
ALTER TABLE "ClassFeature" ADD COLUMN     "actionType" "FeatureActionType",
ADD COLUMN     "featureType" "FeatureType" NOT NULL DEFAULT 'PASSIVE',
ADD COLUMN     "implemented" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mechanicsJson" JSONB,
ADD COLUMN     "requiresChoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subclass" TEXT;

-- CreateTable
CREATE TABLE "FeatureResourcePool" (
    "poolKey" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "maxByLevel" JSONB NOT NULL,
    "resetOn" "RestType" NOT NULL,
    "dieSize" INTEGER,

    CONSTRAINT "FeatureResourcePool_pkey" PRIMARY KEY ("poolKey")
);

-- CreateTable
CREATE TABLE "CharacterResourceState" (
    "characterId" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "current" INTEGER NOT NULL,

    CONSTRAINT "CharacterResourceState_pkey" PRIMARY KEY ("characterId","poolKey")
);

-- CreateTable
CREATE TABLE "Subclass" (
    "id" TEXT NOT NULL,
    "characterClass" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "playstyleTag" TEXT NOT NULL,
    "keyStat" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Subclass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureResourcePool_featureId_key" ON "FeatureResourcePool"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "Subclass_characterClass_key_key" ON "Subclass"("characterClass", "key");

-- AddForeignKey
ALTER TABLE "FeatureResourcePool" ADD CONSTRAINT "FeatureResourcePool_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "ClassFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterResourceState" ADD CONSTRAINT "CharacterResourceState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
