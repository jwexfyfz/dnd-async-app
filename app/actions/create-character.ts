"use server";

// FORCE the environment variables to load explicitly for this action
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma"; 

export async function createCharacter(formData: FormData) {
  const name = formData.get("name") as string;

  console.log("------------------ MVP DIAGNOSTICS ------------------");
  console.log("Form Name Received:", name);
  console.log("Raw Env Test:", process.env.DATABASE_URL ? "FOUND" : "MISSING");
  console.log("Is Prisma Object Defined?:", typeof prisma !== 'undefined');
  console.log("-----------------------------------------------------");

  if (!name || name.trim().length === 0) {
    return { success: false, error: "Character name cannot be blank." };
  }

  try {
    const mockUserId = "test-user-uuid-12345";
    await prisma.user.upsert({
      where: { id: mockUserId },
      update: {},
      create: { id: mockUserId, email: "mvp_tester@example.com" },
    });

    await prisma.character.create({
      data: { name: name.trim(), userId: mockUserId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Database error during character creation:", error);
    return { success: false, error: error.message };
  }
}
