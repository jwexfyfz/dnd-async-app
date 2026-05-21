"use server";

import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export async function getCharacters() {
  // Verify who is making this request before touching the database.
  // Without this check, a logged-out user could still fetch character data.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated.", data: [] };
  }

  try {
    // Fetch only the characters that belong to the authenticated user.
    // The WHERE clause on userId ensures users can never see each other's rosters.
    const characters = await prisma.character.findMany({
      where:   { userId: user.id },
      orderBy: { id: "desc" }, // Show most recently created characters first
    });

    return { success: true, data: characters };
  } catch (error: any) {
    console.error("Failed to fetch characters:", error);
    return { success: false, error: error.message, data: [] };
  }
}
