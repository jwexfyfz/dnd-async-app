import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { HIT_DIE_BY_CLASS } from '@/lib/leveling';
import { CLASS_SKILL_POOL, SKILL_PICK_COUNT } from '@/lib/skills';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const characters = await prisma.character.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, characterClass: true, level: true, currentHp: true, maxHp: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ characters });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch characters' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, characterClass, strength, dexterity, constitution, intelligence, wisdom, charisma, skillProficiencies } = await req.json();

  if (!name?.trim()) return NextResponse.json({ error: 'Character name is required' }, { status: 400 });
  if (!characterClass || !HIT_DIE_BY_CLASS[characterClass]) {
    return NextResponse.json({ error: 'Invalid character class' }, { status: 400 });
  }

  const requiredCount = SKILL_PICK_COUNT[characterClass] ?? 0;
  if (!Array.isArray(skillProficiencies) || skillProficiencies.length !== requiredCount) {
    return NextResponse.json({ error: `Choose exactly ${requiredCount} skills for ${characterClass}` }, { status: 400 });
  }
  const allowedSkills = CLASS_SKILL_POOL[characterClass] ?? [];
  if (!skillProficiencies.every((s: string) => allowedSkills.includes(s))) {
    return NextResponse.json({ error: 'One or more selected skills are invalid for this class' }, { status: 400 });
  }

  const hitDie = HIT_DIE_BY_CLASS[characterClass].die;
  const conMod = Math.floor((constitution - 10) / 2);
  const maxHp = Math.max(1, hitDie + conMod);

  try {
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      user.email?.split('@')[0] ||
      'Adventurer';

    await prisma.user.upsert({
      where: { id: user.id },
      update: { displayName },
      create: { id: user.id, email: user.email ?? '', displayName },
    });

    const character = await prisma.character.create({
      data: {
        name: name.trim(),
        userId: user.id,
        characterClass,
        baseStrength: strength,
        baseDexterity: dexterity,
        baseConstitution: constitution,
        baseIntelligence: intelligence,
        baseWisdom: wisdom,
        baseCharisma: charisma,
        maxHp,
        currentHp: maxHp,
        skillProficiencies,
      },
      select: { id: true, name: true, characterClass: true, level: true, maxHp: true },
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create character' }, { status: 500 });
  }
}
