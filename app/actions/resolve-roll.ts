"use server";

import { randomInt } from "crypto";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { doubleDice, parseModifier } from "../../lib/dice-formula";
import type { QueueRoll } from "../../types/suggestion-chip";

export interface ResolveRollResult {
  success:    boolean;
  roll?:      QueueRoll;
  rolls?:     QueueRoll[];
  completed?: boolean;
  error?:     string;
}

/**
 * Helper function to dynamically parse and roll any standard dice notation (e.g., "1d8", "2d6").
 * It extracts the number of dice and sides, rolls them securely, and sums them up.
 * Returns 0 if the formula doesn't contain a valid dice notation.
 */
function rollDiceFormula(formula: string): number {
  // Regex looks for "XdX" (case-insensitive)
  const match = formula.match(/^(\d+)d(\d+)/i);
  if (!match) return 0;

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  
  let total = 0;
  for (let i = 0; i < count; i++) {
    // randomInt is [min, max), so sides + 1 makes it inclusive
    total += randomInt(1, sides + 1);
  }
  return total;
}

export async function resolveRoll(
  gameId: string,
  turnId: string,
): Promise<ResolveRollResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const queue = await prisma.activeTurnQueue.findUnique({ where: { id: turnId } });
  if (!queue || queue.gameId !== gameId) return { success: false, error: "Turn not found." };
  if (queue.status === "COMPLETED")      return { success: false, error: "Turn already completed." };

  const rolls = queue.rolls as unknown as QueueRoll[];
  const idx   = queue.currentRollIndex;

  if (idx >= rolls.length) return { success: false, error: "No more rolls." };

  const roll     = { ...rolls[idx] };
  const modifier = parseModifier(roll.diceFormula);
  const natural  = rollDiceFormula(roll.diceFormula) || randomInt(1, 21); // crypto-secure [1, 20]
  const total    = natural + modifier;
  const isSuccess = roll.dc !== null ? total >= roll.dc : null;

  roll.naturalResult = natural;
  roll.totalResult   = total;
  roll.isSuccess     = isSuccess;

  const updatedRolls = [...rolls];
  updatedRolls[idx]  = roll;

  // Crit interceptor: natural 20 on ATTACK → double next DAMAGE roll's dice formula.
  if (roll.type === "ATTACK" && natural === 20) {
    const dmgIdx = updatedRolls.findIndex((r, i) => i > idx && r.type === "DAMAGE");
    if (dmgIdx !== -1) {
      updatedRolls[dmgIdx] = {
        ...updatedRolls[dmgIdx],
        diceFormula: doubleDice(updatedRolls[dmgIdx].diceFormula),
      };
    }
  }

  // Miss skip: ATTACK miss → mark subsequent DAMAGE rolls as skipped.
  if (roll.type === "ATTACK" && isSuccess === false) {
    for (let i = idx + 1; i < updatedRolls.length; i++) {
      if (updatedRolls[i].type === "DAMAGE") {
        updatedRolls[i] = { ...updatedRolls[i], skipped: true };
      }
    }
  }

  // Advance index past any skipped rolls.
  let nextIdx = idx + 1;
  while (nextIdx < updatedRolls.length && updatedRolls[nextIdx].skipped) nextIdx++;

  const completed = nextIdx >= updatedRolls.length;

  await prisma.activeTurnQueue.update({
    where: { id: turnId },
    data: {
      rolls:            updatedRolls as any,
      currentRollIndex: nextIdx,
      status:           completed ? "COMPLETED" : "PENDING_ROLLS",
    },
  });

  return { success: true, roll, rolls: updatedRolls, completed };
}
