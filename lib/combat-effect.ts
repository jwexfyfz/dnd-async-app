// ─── Combat Effect Utilities ──────────────────────────────────────────────────
// Pure functions — no framework dependencies. Safe to import from edge or Node.
// ─────────────────────────────────────────────────────────────────────────────

export interface CombatEffect {
  targetId: string;
  delta:    number;
  type:     string;
}

/**
 * Extracts the first <combat_effect> self-closing tag from raw AI text.
 * Attribute order is not assumed — each attribute is matched independently.
 * Returns null if the tag is absent or any required attribute is malformed.
 */
export function parseCombatEffect(text: string): CombatEffect | null {
  const tagMatch = text.match(/<combat_effect\b([^/]*)\s*\/>/);
  if (!tagMatch) return null;

  const attrs = tagMatch[1];
  const attr  = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`));

  const targetId = attr("target_id")?.[1];
  const deltaStr = attr("delta")?.[1];
  const type     = attr("type")?.[1];

  if (!targetId || deltaStr === undefined || !type) return null;

  const delta = parseInt(deltaStr, 10);
  if (isNaN(delta)) return null;

  return { targetId, delta, type };
}

/** Applies delta and enforces HP boundaries: floor 0, ceiling maxHp. */
export function clampHp(currentHp: number, delta: number, maxHp: number): number {
  return Math.min(maxHp, Math.max(0, currentHp + delta));
}

/** Extracts ALL <combat_effect /> tags from raw AI text, in order. */
export function parseCombatEffects(text: string): CombatEffect[] {
  const results: CombatEffect[] = [];
  const tagRegex = /<combat_effect\b([^/]*)\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(text)) !== null) {
    const attrs = m[1];
    const attr  = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`));
    const targetId = attr("target_id")?.[1];
    const deltaStr = attr("delta")?.[1];
    const type     = attr("type")?.[1];
    if (!targetId || deltaStr === undefined || !type) continue;
    const delta = parseInt(deltaStr, 10);
    if (isNaN(delta)) continue;
    results.push({ targetId, delta, type });
  }
  return results;
}
