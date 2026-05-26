import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Rejection-sampling ensures each face [1, faces] is equally likely.
// 256 mod 20 = 16 → without rejection, faces 1–16 are slightly favored.
function secureDie(faces: number): number {
  const limit = 256 - (256 % faces);
  const buf = new Uint8Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return (buf[0] % faces) + 1;
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rollRequestId, gameId } = await req.json() as {
    rollRequestId: string;
    gameId:        string;
  };

  if (!rollRequestId || !gameId) {
    return NextResponse.json({ error: "Missing rollRequestId or gameId" }, { status: 400 });
  }

  // Idempotent: if the seed already exists for this request, return the stored result.
  const existing = await prisma.pendingRoll.findUnique({
    where: { requestId: rollRequestId },
  });
  if (existing) {
    return NextResponse.json({ d20: existing.d20 });
  }

  const d20 = secureDie(20);

  await prisma.pendingRoll.create({
    data: {
      requestId: rollRequestId,
      gameId,
      d20,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  return NextResponse.json({ d20 });
}
