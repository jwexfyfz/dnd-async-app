"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

type EquipSlot = "mainHand" | "offHand" | "armor" | "ring";

// Allowed item types per slot. type is now a plain string (was SlotType enum).
const SLOT_ALLOWED: Record<EquipSlot, string[]> = {
  mainHand: ["WEAPON", "SHIELD"],
  offHand:  ["WEAPON", "SHIELD", "FOCUS"],
  armor:    ["ARMOR"],
  ring:     ["RING", "CONSUMABLE"],
};

const SLOT_ID_FIELD: Record<EquipSlot, "mainHandId" | "offHandId" | "armorId" | "ringId"> = {
  mainHand: "mainHandId",
  offHand:  "offHandId",
  armor:    "armorId",
  ring:     "ringId",
};

interface ActionResponse {
  success: boolean;
  error?:  string;
}

export async function equipItem(
  characterId: string,
  itemId:      string,
  slot:        EquipSlot,
): Promise<ActionResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return { success: false, error: "Item not found." };

  if (!SLOT_ALLOWED[slot].includes(item.type)) {
    return {
      success: false,
      error:   `${item.type} items cannot go in the ${slot} slot.`,
    };
  }

  const character = await prisma.character.findUnique({
    where:  { id: characterId },
    select: { userId: true, backpack: true, mainHandId: true, offHandId: true, armorId: true, ringId: true },
  });
  if (!character)                       return { success: false, error: "Character not found." };
  if (character.userId !== user.id)     return { success: false, error: "Forbidden." };
  if (!character.backpack.includes(itemId)) {
    return { success: false, error: "Item is not in the character's backpack." };
  }

  const idField     = SLOT_ID_FIELD[slot];
  const currentlyIn = character[idField];

  const newBackpack = [
    ...character.backpack.filter((id) => id !== itemId),
    ...(currentlyIn && currentlyIn !== itemId ? [currentlyIn] : []),
  ];

  try {
    await prisma.$transaction(async (tx) => {
      // Validate: no other character may have this item equipped already.
      const conflict = await tx.character.findFirst({
        where: {
          id: { not: characterId },
          OR: [
            { mainHandId: itemId },
            { offHandId:  itemId },
            { armorId:    itemId },
            { ringId:     itemId },
          ],
        },
        select: { id: true },
      });
      if (conflict) throw new Error("ITEM_ALREADY_EQUIPPED");

      await tx.character.update({
        where: { id: characterId },
        data:  { [idField]: itemId, backpack: newBackpack },
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "ITEM_ALREADY_EQUIPPED") {
      return { success: false, error: "This item is already equipped by another character." };
    }
    return { success: false, error: "Failed to equip item." };
  }

  return { success: true };
}
