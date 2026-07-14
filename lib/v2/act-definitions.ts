export interface ActMutation {
  poiTemplateId: string;
  setProps: Record<string, unknown>;
}

export interface ActDefinition {
  act: number;
  completionFlags: string[];
  openingObjective?: string;
  onStartMutations: ActMutation[];
}

export interface ActDefinitionWithXp extends ActDefinition {
  milestoneXp?: number;
}

export const DUNGEON_ACTS: ActDefinitionWithXp[] = [
  {
    act: 1,
    completionFlags: ['commander_note_read'],
    onStartMutations: [],
    milestoneXp: 600,
  },
  {
    act: 2,
    openingObjective: 'Descend deeper — something stirs below the flooded passage',
    onStartMutations: [
      { poiTemplateId: '77000001-0000-0000-0000-000000000001', setProps: { unlocked: true } },
    ],
    completionFlags: ['ritual_disrupted', 'harwick_defeated'],
    milestoneXp: 2400,
  },
  {
    act: 3,
    openingObjective: 'Find the Sealed Vault and deal with what is bound there',
    onStartMutations: [
      { poiTemplateId: 'b2000006-b2b2-b2b2-b2b2-b2b2b2b2b2b2', setProps: { visibility_override: 'always' } },
    ],
    completionFlags: ['binding_seal_used', 'binding_seal_destroyed'],
    milestoneXp: 0,
  },
];

// ─── Proving Grounds Act Definitions ─────────────────────────────────────────

export const PROVING_GROUNDS_ACTS: ActDefinitionWithXp[] = [
  {
    act: 1,
    completionFlags: ['sentinels_cleared'],
    onStartMutations: [],
    milestoneXp: 0,
  },
  {
    act: 2,
    openingObjective: 'Clear the Proving Ring and descend to The Gauntlet',
    onStartMutations: [],
    completionFlags: ['proving_ring_cleared'],
    milestoneXp: 300,
  },
  {
    act: 3,
    openingObjective: 'Prove yourself in The Gauntlet',
    onStartMutations: [
      { poiTemplateId: 'd9a30008-d9a3-d9a3-d9a3-d9a300000008', setProps: { unlocked: true } },
    ],
    completionFlags: ['gauntlet_cleared'],
    milestoneXp: 400,
  },
  {
    act: 4,
    openingObjective: 'Face the Proving Master in the Arena Floor',
    onStartMutations: [],
    completionFlags: ['proving_master_defeated'],
    milestoneXp: 600,
  },
];
