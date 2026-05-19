"use server";

import { prisma } from "../../lib/prisma";

export async function getCharacters() {
  try {
    const mockUserId = "test-user-uuid-12345";
    
    // Fetch all characters matching our MVP user ID
    const characters = await prisma.character.findMany({
      where: { userId: mockUserId },
      orderBy: { id: "desc" } // Show newest creations first
    });

    return { success: true, data: characters };
  } catch (error: any) {
    console.error("Failed to fetch characters:", error);
    return { success: false, error: error.message, data: [] };
  }
}
