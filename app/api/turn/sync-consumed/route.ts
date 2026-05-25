import { NextRequest, NextResponse } from "next/server";
import { syncConsumedResource } from "@/app/actions/sync-consumed-resource";
import type { TurnCostType } from "@/types/turn-actions";

export async function POST(req: NextRequest) {
  const { characterId, costType, value } = await req.json() as {
    characterId: string;
    costType:    TurnCostType;
    value:       number;
  };
  const result = await syncConsumedResource({ characterId, costType, value });
  return NextResponse.json(result);
}
