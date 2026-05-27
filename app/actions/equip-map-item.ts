"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

type EquipSlot = "mainHand" | "offHand" | "armor" | "ring";

const SLOT_ID_FIELD: Record<EquipSlot, "mainHandId" | "offHandId" | "armorId" | "ringId"> = {
  mainHand: "mainHandId",
  offHand:  "offHandId",
  armor:    "armorId",
  ring:     "ringId",
};

// Determine the Character equipment slot for a map item based on its `type` field.
// The type is set by the Phase E migration from category+name.
function slotForItem(itemType: string): EquipSlot {
  switch (itemType) {
    case "WEAPON":     return "mainHand";
    case "SHIELD":     return "offHand";
    case "ARMOR":      return "armor";
    case "FOCUS":      return "offHand";
    case "RING":       return "ring";
    case "CONSUMABLE": return "ring";
    default:           return "mainHand";
  }
}

export async function equipMapItem(
  characterId: string,
  itemId:      string,
  equip:       boolean,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const [item, character] = await Promise.all([
    prisma.item.findUnique({
      where:  { id: itemId },
      select: { type: true },
    }),
    prisma.character.findUnique({
      where:  { id: characterId },
      select: { userId: true, mainHandId: true, offHandId: true, armorId: true, ringId: true },
    }),
  ]);

  if (!item)      return { success: false, error: "Item not found." };
  if (!character) return { success: false, error: "Character not found." };
  if (character.userId !== user.id) return { success: false, error: "Forbidden." };

  const slot      = slotForItem(item.type);
  const slotField = SLOT_ID_FIELD[slot];

  try {
    await prisma.$transaction(async (tx) => {
      if (equip) {
        const currentInSlot = (character as Record<string, string | null>)[slotField];

        // Unequip the item already in this slot (if different from the one being equipped)
        if (currentInSlot && currentInSlot !== itemId) {
          await tx.item.update({ where: { id: currentInSlot }, data: { isEquipped: false } });
        }

        await tx.item.update({ where: { id: itemId }, data: { isEquipped: true } });
        await tx.character.update({ where: { id: characterId }, data: { [slotField]: itemId } });
      } else {
        await tx.item.update({ where: { id: itemId }, data: { isEquipped: false } });

        // Only clear the Character FK if it still points to this item
        const currentInSlot = (character as Record<string, string | null>)[slotField];
        if (currentInSlot === itemId) {
          await tx.character.update({ where: { id: characterId }, data: { [slotField]: null } });
        }
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed.";
    return { success: false, error: msg };
  }

  return { success: true };
}
