"use server";

import { SlotType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

type EquipSlot = "mainHand" | "offHand" | "armor" | "ring";

// Slot → which SlotTypes are permitted in it.
const SLOT_ALLOWED: Record<EquipSlot, SlotType[]> = {
  mainHand: ["WEAPON", "SHIELD"],
  offHand:  ["WEAPON", "SHIELD", "FOCUS"],
  armor:    ["ARMOR"],
  ring:     ["RING"],
};

// Slot name → the FK column on Character.
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

  if (!SLOT_ALLOWED[slot].includes(item.slotType)) {
    return {
      success: false,
      error:   `${item.slotType} items cannot go in the ${slot} slot.`,
    };
  }

  const character = await prisma.character.findUnique({
    where:  { id: characterId },
    select: { userId: true, backpack: true, mainHandId: true, offHandId: true, armorId: true, ringId: true },
  });
  if (!character) return { success: false, error: "Character not found." };
  if (character.userId !== user.id) return { success: false, error: "Forbidden." };

  if (!character.backpack.includes(itemId)) {
    return { success: false, error: "Item is not in the character's backpack." };
  }

  const idField      = SLOT_ID_FIELD[slot];
  const currentlyIn  = character[idField];

  // Build the updated backpack: remove the item being equipped, add any displaced item.
  let newBackpack = character.backpack.filter((id) => id !== itemId);
  if (currentlyIn && currentlyIn !== itemId) {
    newBackpack = [...newBackpack, currentlyIn];
  }

  await prisma.character.update({
    where: { id: characterId },
    data:  { [idField]: itemId, backpack: newBackpack },
  });

  return { success: true };
}
