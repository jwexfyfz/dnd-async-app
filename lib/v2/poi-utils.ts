export function computeIsLockable(lockedBy: unknown): boolean {
  return Array.isArray(lockedBy)
    ? (lockedBy as string[]).length > 0
    : typeof lockedBy === 'string' && lockedBy.length > 0;
}

/**
 * Resolves the effective peek-through visibility for an exit POI.
 * - destroyed door → full LoS regardless of lock state
 * - locked (lockable and not yet unlocked) → no LoS
 * - otherwise → rawPeek as-is (peek_visibility: 'none' means no LoS, period —
 *   matches flavor text where the passage has no visual cues at all,
 *   regardless of whether it's been opened/walked through)
 */
export function computeEffectivePeek(
  rawPeek: string,
  isLocked: boolean,
  interacted: boolean,
  destroyed: boolean,
): 'none' | 'obvious_only' | 'full' {
  if (destroyed) return 'full';
  if (isLocked) return 'none';
  return rawPeek as 'none' | 'obvious_only' | 'full';
}
