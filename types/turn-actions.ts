// Shared resource-cost types used by both the useTurnActions hook and Chip definitions.
// Kept in types/ so it can be imported from server and client contexts alike.

export type TurnCostType = "mainAction" | "bonusAction" | "movementFeet" | "free";

export interface ResourceCost {
  type:  TurnCostType;
  value: number;
}
