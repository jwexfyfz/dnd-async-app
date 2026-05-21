"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";

interface ActionResponse {
  success: boolean;
  error?: string;
}

export async function createCharacter(formData: FormData): Promise<ActionResponse> {
  // Step 1: Confirm the request is coming from a logged-in user.
  // getUser() validates the session token server-side — the client can't fake this.
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be logged in to create a character." };
  }

  // Step 2: Parse and validate the submitted form fields.
  const name = formData.get("name") as string;
  const characterClass = formData.get("class") as string;

  // Fallback is 8, matching the D&D 5e Point Buy baseline (not 10, which is the
  // "standard array" default — a different system).
  const strength     = parseInt(formData.get("strength")     as string) || 8;
  const dexterity    = parseInt(formData.get("dexterity")    as string) || 8;
  const constitution = parseInt(formData.get("constitution") as string) || 8;
  const intelligence = parseInt(formData.get("intelligence") as string) || 8;
  const wisdom       = parseInt(formData.get("wisdom")       as string) || 8;
  const charisma     = parseInt(formData.get("charisma")     as string) || 8;

  if (!name || name.trim().length === 0) {
    return { success: false, error: "Character name cannot be blank." };
  }
  if (!characterClass) {
    return { success: false, error: "You must choose a character class." };
  }

  try {
    // Step 3: Ensure this Supabase user has a matching row in our own database.
    // We use the Supabase user's ID as our primary key so the two systems stay
    // permanently in sync — no separate mapping table needed.
    // upsert = "create the row if it doesn't exist yet, otherwise do nothing."
    await prisma.user.upsert({
      where:  { id: user.id },
      update: {},
      create: { id: user.id, email: user.email! },
    });

    // Step 4: Save the new character, linked to the authenticated user's ID.
    await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma,
      },
    });

    // Tell Next.js to invalidate cached data for the home page so the
    // character list reflects the new addition immediately.
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Database error:", error);
    return { success: false, error: error.message || "Failed to save character." };
  }
}
