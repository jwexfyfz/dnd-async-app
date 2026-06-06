/**
 * D&D 5e point-buy stat cost rules.
 * Values 14–15 cost/refund 2 points; everything else costs/refunds 1.
 */
export function getStatCost(currentValue: number, isIncrementing: boolean): number {
  if (isIncrementing) {
    return currentValue >= 13 ? 2 : 1;
  } else {
    return currentValue >= 14 ? 2 : 1;
  }
}
