import { randomUUID } from "crypto";
import { SKILL_MAP } from "../config/skills";
import type { ChipType } from "../types/chips";

export interface ActiveRollContext {
  requiresRoll: true;
  rollRequestId: string;
  skillType: string;
  targetDC: number;
  modifier: number;
}

/**
 * Builds an ActiveRollContext payload for the Server-Seeded Roll flow.
 * Pure function — no dice are rolled, no AI is called, no DB is written.
 */
export function buildRollContext(chipType: ChipType, targetDC: number, modifier: number): ActiveRollContext {
  return {
    requiresRoll: true,
    rollRequestId: randomUUID(),
    skillType: SKILL_MAP[chipType]?.label ?? chipType,
    targetDC,
    modifier,
  };
}
