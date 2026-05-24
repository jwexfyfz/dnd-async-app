"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { maxHpAtLevel, HIT_DIE_BY_CLASS } from "../../lib/leveling";
import { CLASS_SKILL_POOL, SKILL_PICK_COUNT } from "../../lib/skills";

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

  function parseAbilityScore(raw: FormDataEntryValue | null): number | null {
    const n = parseInt(raw as string, 10);
    if (isNaN(n) || n < 1 || n > 20) return null;
    return n;
  }

  const strength     = parseAbilityScore(formData.get("strength"));
  const dexterity    = parseAbilityScore(formData.get("dexterity"));
  const constitution = parseAbilityScore(formData.get("constitution"));
  const intelligence = parseAbilityScore(formData.get("intelligence"));
  const wisdom       = parseAbilityScore(formData.get("wisdom"));
  const charisma     = parseAbilityScore(formData.get("charisma"));

  if (!name || name.trim().length === 0) {
    return { success: false, error: "Character name cannot be blank." };
  }
  if (name.trim().length > 50) {
    return { success: false, error: "Character name must be 50 characters or fewer." };
  }
  if (!characterClass) {
    return { success: false, error: "You must choose a character class." };
  }
  if (!(characterClass in HIT_DIE_BY_CLASS)) {
    return { success: false, error: "Invalid character class." };
  }
  if (strength === null || dexterity === null || constitution === null ||
      intelligence === null || wisdom === null || charisma === null) {
    return { success: false, error: "All ability scores must be between 1 and 20." };
  }

  // Parse and validate skill proficiency picks (T-04-01-01, T-04-01-02, T-04-01-03).
  let skillProficiencies: string[];
  try {
    const raw = formData.get("skillProficiencies");
    const parsed = JSON.parse((raw as string) ?? "[]");
    if (!Array.isArray(parsed)) {
      return { success: false, error: "Invalid skill proficiency data." };
    }
    skillProficiencies = parsed as string[];
  } catch {
    return { success: false, error: "Invalid skill proficiency data." };
  }

  const deduped = [...new Set(skillProficiencies)];
  if (deduped.length !== skillProficiencies.length) {
    return { success: false, error: "Duplicate skills are not allowed." };
  }

  const requiredCount = SKILL_PICK_COUNT[characterClass];
  if (skillProficiencies.length !== requiredCount) {
    return { success: false, error: `Choose exactly ${requiredCount} skills for ${characterClass}.` };
  }

  const allowedSkills = CLASS_SKILL_POOL[characterClass] ?? [];
  if (!skillProficiencies.every((s) => allowedSkills.includes(s))) {
    return { success: false, error: "One or more selected skills are not available for this class." };
  }

  try {
    // Step 3: Ensure this Supabase user has a matching row in our own database.
    // displayName comes from the Google OAuth full_name claim and is shown on
    // party cards so teammates can identify each other.
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name    as string | undefined) ||
      user.email?.split("@")[0] ||
      "Adventurer";

    await prisma.user.upsert({
      where:  { id: user.id },
      update: { displayName },
      create: { id: user.id, email: user.email!, displayName },
    });

    // Step 4: Save the new character, linked to the authenticated user's ID.
    const maxHp = maxHpAtLevel(characterClass, constitution, 1);
    await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        baseStrength:     strength,
        baseDexterity:    dexterity,
        baseConstitution: constitution,
        baseIntelligence: intelligence,
        baseWisdom:       wisdom,
        baseCharisma:     charisma,
        maxHp,
        currentHp: maxHp,
        skillProficiencies,
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
