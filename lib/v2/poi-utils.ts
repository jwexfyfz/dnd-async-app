export function computeIsLockable(lockedBy: unknown): boolean {
  return Array.isArray(lockedBy)
    ? (lockedBy as string[]).length > 0
    : typeof lockedBy === 'string' && lockedBy.length > 0;
}

/**
 * Resolves the effective peek-through visibility for an exit POI.
 * - destroyed door → full LoS regardless of lock state
 * - locked (lockable and not yet unlocked) → no LoS
 * - rawPeek 'none' but door has been opened (interacted) → obvious_only
 * - otherwise → rawPeek as-is
 */
export function computeEffectivePeek(
  rawPeek: string,
  isLocked: boolean,
  interacted: boolean,
  destroyed: boolean,
): 'none' | 'obvious_only' | 'full' {
  if (destroyed) return 'full';
  if (isLocked) return 'none';
  if (rawPeek === 'none' && interacted) return 'full';
  return rawPeek as 'none' | 'obvious_only' | 'full';
}
