"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function setReady(gameId: string, ready: boolean) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const member = await prisma.partyMember.findFirst({
    where: { gameId, userId: user.id },
  });
  if (!member) return { success: false, error: "Not in this game." };

  await prisma.partyMember.update({
    where: { id: member.id },
    data:  { status: ready ? "READY" : "JOINED" },
  });

  return { success: true };
}
