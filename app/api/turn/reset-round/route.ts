import { NextRequest, NextResponse } from "next/server";
import { resetCharacterRound } from "@/app/actions/reset-character-round";

export async function POST(req: NextRequest) {
  const { characterId } = await req.json() as { characterId: string };
  const result = await resetCharacterRound(characterId);
  return NextResponse.json(result);
}
