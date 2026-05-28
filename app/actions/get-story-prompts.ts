"use server";

import { prisma } from "../../lib/prisma";

export async function getStoryPrompts() {
  try {
    const stories = await prisma.story.findMany({
      orderBy: { difficulty: "asc" },
    });
    return { success: true, data: stories };
  } catch (error: any) {
    console.error("Failed to fetch stories:", error);
    return { success: false, error: error.message, data: [] };
  }
}
