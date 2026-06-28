export function extractAvailableStances(defaultProperties: unknown): string[] {
  if (!defaultProperties || typeof defaultProperties !== 'object' || Array.isArray(defaultProperties)) {
    return [];
  }
  const reserved = new Set(['items', 'poi_type', 'visibility', 'peek_visibility', 'locked_by', 'enter', 'examine_text', 'examine_details', 'lock_dc', 'perception_details']);
  return Object.entries(defaultProperties as Record<string, { resulting_stance?: string }>)
    .filter(([key]) => !reserved.has(key))
    .map(([, v]) => v?.resulting_stance)
    .filter((s): s is string => typeof s === 'string');
}

export function extractExplorationFlags(currentProperties: unknown): { examined: boolean; interacted: boolean; destroyed: boolean } {
  if (!currentProperties || typeof currentProperties !== 'object' || Array.isArray(currentProperties)) {
    return { examined: false, interacted: false, destroyed: false };
  }
  const props = currentProperties as Record<string, unknown>;
  return { examined: props.examined === true, interacted: props.interacted === true, destroyed: props.destroyed === true };
}

export function extractExitInfo(
  defaultProperties: unknown,
): { isExit: boolean; targetRoomTemplateId: string | null } {
  if (!defaultProperties || typeof defaultProperties !== 'object' || Array.isArray(defaultProperties)) {
    return { isExit: false, targetRoomTemplateId: null };
  }
  const props = defaultProperties as Record<string, unknown>;
  const enterVerb = props['enter'] as Record<string, unknown> | undefined;
  if (enterVerb && typeof enterVerb.target_room_template_id === 'string') {
    return { isExit: true, targetRoomTemplateId: enterVerb.target_room_template_id };
  }
  return { isExit: false, targetRoomTemplateId: null };
}
