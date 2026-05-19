"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";

interface ActionResponse {
  success: boolean;
  error?: string;
}

export async function createCharacter(formData: FormData): Promise<ActionResponse> {
  const name = formData.get("name") as string;
  const characterClass = formData.get("class") as string;
  
  const strength = parseInt(formData.get("strength") as string) || 10;
  const dexterity = parseInt(formData.get("dexterity") as string) || 10;
  const constitution = parseInt(formData.get("constitution") as string) || 10;
  const intelligence = parseInt(formData.get("intelligence") as string) || 10;
  const wisdom = parseInt(formData.get("wisdom") as string) || 10;
  const charisma = parseInt(formData.get("charisma") as string) || 10;

  if (!name || name.trim().length === 0) {
    return { success: false, error: "Character name cannot be blank." };
  }
  if (!characterClass) {
    return { success: false, error: "You must choose a character class." };
  }

  try {
    const mockUserId = "test-user-uuid-12345";
    
    await prisma.user.upsert({
      where: { id: mockUserId },
      update: {},
      create: { id: mockUserId, email: "mvp_tester@example.com" },
    });

    // app/actions/create-character.ts
// ... keep everything else the same, just update the data allocation block at the bottom:

    await prisma.character.create({
    data: {
        name: name.trim(),
        userId: mockUserId,
        characterClass: characterClass, // Map the form data variable to our safe database key
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma
    },
    });


    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Database error:", error);
    return { success: false, error: error.message || "Failed to save character." };
  }
}
