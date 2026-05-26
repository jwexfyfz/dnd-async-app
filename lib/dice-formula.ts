// Doubles the structural dice of a formula: "1d8+3" → "2d8+3", "2d6+5" → "4d6+5"
export function doubleDice(formula: string): string {
  return formula.replace(/(\d+)d(\d+)/g, (_, count, sides) =>
    `${parseInt(count, 10) * 2}d${sides}`,
  );
}

// Extracts the flat modifier from a formula: "1d20+5" → 5, "1d8-1" → -1, "1d6" → 0
export function parseModifier(formula: string): number {
  const match = formula.match(/([+-]\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}
