"use server";

import { prisma } from "../../lib/prisma";
import type { GameTile, ItemInstance } from "../../lib/tile-types";

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
  const tiles     = (gmData.tiles ?? []) as GameTile[][];
  const itemState = (gmData.itemState ?? {}) as Record<string, ItemInstance>;

  // Scan tiles for ground items — build position map
  const gmItemPosMap = new Map<string, { posX: number; posY: number }>();
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    for (let x = 0; x < row.length; x++) {
      const itemId = row[x].item;
      if (itemId) {
        const state = itemState[itemId];
        if (state && !state.isPickedUp && state.isVisible) {
          gmItemPosMap.set(itemId, { posX: x, posY: y });
        }
      }
    }
  }

  // Collect character-held item IDs
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

  const allIds = [...new Set([...gmItemPosMap.keys(), ...characterItemIds])];
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
