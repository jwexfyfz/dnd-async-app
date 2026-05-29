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

// Accepts a gameId. Returns ground items from GameMap.data plus item templates
// referenced by the game's characters (equipped/backpack).
export async function getMapItems(gameId: string): Promise<EquippableItemData[]> {
  const [activeGM, game] = await Promise.all([
    prisma.gameMap.findFirst({
      where:   { gameId },
      orderBy: { createdAt: "desc" },
      select:  { data: true },
    }),
    prisma.game.findUnique({
      where:  { id: gameId },
      select: {
        character: {
          select: { mainHandId: true, offHandId: true, armorId: true, ringId: true, backpack: true },
        },
        partyMembers: {
          include: {
            character: {
              select: { mainHandId: true, offHandId: true, armorId: true, ringId: true, backpack: true },
            },
          },
        },
      },
    }),
  ]);

  const gmData    = (activeGM?.data ?? {}) as Record<string, any>;
  const gmItems   = ((gmData.items ?? []) as Array<{
    itemId: string; posX: number; posY: number; isPickedUp: boolean; isVisible: boolean;
  }>);
  const groundItems  = gmItems.filter((i) => !i.isPickedUp && i.isVisible);
  const gmItemPosMap = new Map(groundItems.map((i) => [i.itemId, { posX: i.posX, posY: i.posY }]));

  // Collect all character item IDs (equipped + backpack)
  const chars = game
    ? [game.character, ...game.partyMembers.map((m) => m.character)]
    : [];
  const characterItemIds = new Set<string>();
  for (const c of chars) {
    if (c.mainHandId) characterItemIds.add(c.mainHandId);
    if (c.offHandId)  characterItemIds.add(c.offHandId);
    if (c.armorId)    characterItemIds.add(c.armorId);
    if (c.ringId)     characterItemIds.add(c.ringId);
    for (const id of c.backpack ?? []) characterItemIds.add(id);
  }

  const allIds = [...new Set([...groundItems.map((i) => i.itemId), ...characterItemIds])];
  if (allIds.length === 0) return [];

  const templates = await prisma.item.findMany({
    where:   { id: { in: allIds } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, category: true, description: true,
      weightLbs: true, quantity: true, isEquipped: true, combatImpactLabel: true,
    },
  });

  return templates.map((t) => {
    const pos = gmItemPosMap.get(t.id);
    return { ...t, posX: pos?.posX ?? null, posY: pos?.posY ?? null };
  });
}
