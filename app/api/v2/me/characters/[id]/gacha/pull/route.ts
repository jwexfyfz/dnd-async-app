import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { rollRarity, selectItem } from '@/lib/v2/gacha-engine';
import type { GachaPullRecord } from '@/types/v2-game';
import { normalizeInventory } from '@/lib/v2/item-helpers';

// POST /api/v2/me/characters/[id]/gacha/pull
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: characterId } = await params;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      userId: true,
      characterClass: true,
      pendingPulls: true,
      lifetimePullCount: true,
      pityCount: true,
      pullHistory: true,
      inventory: true,
    },
  });
  if (!character) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (character.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (character.pendingPulls < 1) return NextResponse.json({ error: 'No pulls available' }, { status: 400 });

  const pullHistory = (character.pullHistory as unknown as GachaPullRecord[]) ?? [];

  const { rarity, d100 } = rollRarity(character.pityCount);
  const item = selectItem(rarity, character.characterClass, pullHistory);

  const newRecord: GachaPullRecord = {
    itemId: item.id,
    itemName: item.name,
    rarity,
    pulledAt: new Date().toISOString(),
  };

  const updatedHistory = [...pullHistory, newRecord];

  // Add item to inventory bag
  const inv = normalizeInventory(character.inventory);
  const itemForBag = { ...item } as Record<string, unknown>;
  // Strip gacha-only fields before storing
  delete itemForBag.gachaRarity;
  delete itemForBag.classRestriction;
  inv.bag.push(itemForBag as unknown as import('@/types/v2-game').ItemDefinition);

  await prisma.character.update({
    where: { id: characterId },
    data: {
      pendingPulls: { decrement: 1 },
      lifetimePullCount: { increment: 1 },
      pityCount: rarity === 'legendary' ? 0 : { increment: 1 },
      pullHistory: updatedHistory as object[],
      inventory: inv as object,
    },
  });

  return NextResponse.json({
    ok: true,
    d100,
    rarity,
    item: itemForBag,
    remainingPulls: character.pendingPulls - 1,
  });
}
