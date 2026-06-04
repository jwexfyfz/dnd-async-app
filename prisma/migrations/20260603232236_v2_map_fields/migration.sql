-- AlterTable
ALTER TABLE "PoiTemplate" ADD COLUMN     "exit_arch_width" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "exit_direction" TEXT,
ADD COLUMN     "exit_wall_section" TEXT NOT NULL DEFAULT 'C',
ADD COLUMN     "grid_slot" TEXT NOT NULL DEFAULT 'C',
ADD COLUMN     "visibility_level" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RoomTemplate" ADD COLUMN     "map_x" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "map_y" INTEGER NOT NULL DEFAULT 0;
