-- Rename stat columns to baseXxx (preserves data)
ALTER TABLE "Character" RENAME COLUMN "strength"     TO "baseStrength";
ALTER TABLE "Character" RENAME COLUMN "dexterity"    TO "baseDexterity";
ALTER TABLE "Character" RENAME COLUMN "constitution" TO "baseConstitution";
ALTER TABLE "Character" RENAME COLUMN "intelligence" TO "baseIntelligence";
ALTER TABLE "Character" RENAME COLUMN "wisdom"       TO "baseWisdom";
ALTER TABLE "Character" RENAME COLUMN "charisma"     TO "baseCharisma";

-- SlotType enum
CREATE TYPE "SlotType" AS ENUM ('WEAPON', 'ARMOR', 'SHIELD', 'FOCUS', 'RING');

-- Item table
CREATE TABLE "Item" (
    "id"          TEXT    NOT NULL,
    "name"        TEXT    NOT NULL,
    "slotType"    "SlotType" NOT NULL,
    "statBonuses" JSONB   NOT NULL DEFAULT '{}',
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- Equipment slots + backpack on Character
ALTER TABLE "Character" ADD COLUMN "mainHandId" TEXT;
ALTER TABLE "Character" ADD COLUMN "offHandId"  TEXT;
ALTER TABLE "Character" ADD COLUMN "armorId"    TEXT;
ALTER TABLE "Character" ADD COLUMN "ringId"     TEXT;
ALTER TABLE "Character" ADD COLUMN "backpack"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- FK constraints (SET NULL if item deleted)
ALTER TABLE "Character" ADD CONSTRAINT "Character_mainHandId_fkey" FOREIGN KEY ("mainHandId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Character" ADD CONSTRAINT "Character_offHandId_fkey"  FOREIGN KEY ("offHandId")  REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Character" ADD CONSTRAINT "Character_armorId_fkey"    FOREIGN KEY ("armorId")    REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Character" ADD CONSTRAINT "Character_ringId_fkey"     FOREIGN KEY ("ringId")     REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
