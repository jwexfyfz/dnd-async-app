"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

interface UpdateItemPatch {
  isEquipped?: boolean;
  quantity?:   number;
}

interface ActionResponse {
  success: boolean;
  error?:  string;
}

export async function updateItem(id: string, patch: UpdateItemPatch): Promise<ActionResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const data: UpdateItemPatch = {};
  if (patch.isEquipped !== undefined) data.isEquipped = patch.isEquipped;
  if (patch.quantity   !== undefined) data.quantity   = Math.max(0, patch.quantity);

  if (Object.keys(data).length === 0) return { success: true };

  try {
    await prisma.equippableItem.update({ where: { id }, data });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? "Update failed." };
  }
}
