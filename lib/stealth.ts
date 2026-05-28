type Pos = { x: number; y: number };

export function isCovered(pos: Pos, tiles: string[][]): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (tiles[pos.y + dy]?.[pos.x + dx] === "W") return true;
    }
  }
  return false;
}

export function rollStealthCheck(dexMod: number): number {
  return Math.ceil(Math.random() * 20) + dexMod;
}

// Attack-type chips that break stealth: melee (strength), ranged/finesse (dexterity),
// and spell attacks keyed by caster stat (intelligence, wisdom, charisma).
export function breaksStealth(chipType: string): boolean {
  const t = chipType.toLowerCase();
  return t === "strength" || t === "dexterity" || t === "intelligence" || t === "wisdom" || t === "charisma";
}
