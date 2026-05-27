"use server";

import { prisma } from "../../lib/prisma";

export interface EquippableItemData {
  id:                string;
  name:              string;
  category:          string;
  description:       string;
  weightLbs:         number;
  quantity:          number;
  isEquipped:        boolean;
  combatImpactLabel: string;
  posX:              number | null;
  posY:              number | null;
}

export async function getMapItems(mapId: string): Promise<EquippableItemData[]> {
  return prisma.item.findMany({
    where:   { mapId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, category: true, description: true,
      weightLbs: true, quantity: true, isEquipped: true, combatImpactLabel: true,
      posX: true, posY: true,
    },
  });
}
