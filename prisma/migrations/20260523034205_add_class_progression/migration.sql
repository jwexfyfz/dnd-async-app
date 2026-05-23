-- CreateTable
CREATE TABLE "ClassProgression" (
    "id" TEXT NOT NULL,
    "characterClass" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "proficiencyBonus" INTEGER NOT NULL,
    "featuresUnlocked" TEXT[],
    "resourcePoolMax" INTEGER,

    CONSTRAINT "ClassProgression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassFeature" (
    "id" TEXT NOT NULL,
    "characterClass" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "ClassFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassProgression_characterClass_idx" ON "ClassProgression"("characterClass");

-- CreateIndex
CREATE UNIQUE INDEX "ClassProgression_characterClass_level_key" ON "ClassProgression"("characterClass", "level");

-- CreateIndex
CREATE INDEX "ClassFeature_characterClass_level_idx" ON "ClassFeature"("characterClass", "level");

-- AddForeignKey
ALTER TABLE "ClassFeature" ADD CONSTRAINT "ClassFeature_characterClass_level_fkey" FOREIGN KEY ("characterClass", "level") REFERENCES "ClassProgression"("characterClass", "level") ON DELETE RESTRICT ON UPDATE CASCADE;
