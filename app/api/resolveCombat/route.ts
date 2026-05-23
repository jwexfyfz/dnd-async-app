import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { parseCombatEffect, clampHp } from "../../../lib/combat-effect";

export async function POST(req: NextRequest) {
  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("text" in body) ||
    typeof (body as Record<string, unknown>).text !== "string"
  ) {
    return NextResponse.json({ error: "Missing or invalid 'text' field" }, { status: 400 });
  }

  const text = (body as { text: string }).text;

  // ── Extract combat effect ────────────────────────────────────────────────────
  const effect = parseCombatEffect(text);
  if (!effect) {
    return NextResponse.json({ error: "No <combat_effect> tag found" }, { status: 400 });
  }

  // ── Fetch character ──────────────────────────────────────────────────────────
  let character: { id: string; currentHp: number; maxHp: number } | null;
  try {
    character = await prisma.character.findUnique({
      where:  { id: effect.targetId },
      select: { id: true, currentHp: true, maxHp: true },
    });
  } catch (err) {
    console.error("[resolveCombat] read error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!character) {
    return NextResponse.json({ error: `Character not found: ${effect.targetId}` }, { status: 404 });
  }

  // ── Apply delta with boundary enforcement ────────────────────────────────────
  const newHp = clampHp(character.currentHp, effect.delta, character.maxHp);

  // ── Persist ──────────────────────────────────────────────────────────────────
  let updated: Record<string, unknown>;
  try {
    updated = await prisma.character.update({
      where: { id: effect.targetId },
      data:  { currentHp: newHp },
    });
  } catch (err) {
    console.error("[resolveCombat] write error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json(updated);
}
