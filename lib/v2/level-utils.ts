export function maxForLevel(maxByLevel: Record<string, number>, level: number): number {
  let max = 0;
  for (let l = 1; l <= level; l++) {
    if (maxByLevel[String(l)] !== undefined) max = maxByLevel[String(l)];
  }
  return max;
}
