"use server";

import { prisma } from "../../lib/prisma";

export interface EquippableItemData {
  id:                string;
  name:              string;
  category:          string;
  weightLbs:         number;
  quantity:          number;
  isEquipped:        boolean;
  combatImpactLabel: string;
}

export async function getMapItems(mapId: string): Promise<EquippableItemData[]> {
  return prisma.equippableItem.findMany({
    where:   { mapId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, category: true, weightLbs: true,
      quantity: true, isEquipped: true, combatImpactLabel: true,
    },
  });
}
