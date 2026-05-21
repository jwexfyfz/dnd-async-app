"use server";

import { prisma } from "../../lib/prisma";

// Returns all available story prompts shown on the "Choose Your Adventure" screen.
// These are seeded records — not user-generated — so no auth check is needed.
export async function getStoryPrompts() {
  try {
    const prompts = await prisma.storyPrompt.findMany({
      orderBy: { difficulty: "asc" },
    });
    return { success: true, data: prompts };
  } catch (error: any) {
    console.error("Failed to fetch story prompts:", error);
    return { success: false, error: error.message, data: [] };
  }
}
