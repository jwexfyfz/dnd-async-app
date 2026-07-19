export type StatKey = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type AsiChoices = Partial<Record<StatKey, number>>;

export const STAT_TO_FIELD: Record<StatKey, string> = {
  strength:     'baseStrength',
  dexterity:    'baseDexterity',
  constitution: 'baseConstitution',
  intelligence: 'baseIntelligence',
  wisdom:       'baseWisdom',
  charisma:     'baseCharisma',
};

export const ALL_STATS = Object.keys(STAT_TO_FIELD) as StatKey[];

export interface CharBaseStats {
  baseStrength: number;
  baseDexterity: number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom: number;
  baseCharisma: number;
}

export interface CharForAsiValidation extends CharBaseStats {
  pendingChoicesQueue: Array<{ type: string; level: number }>;
}

// Total points allocatable across all stats (each stat capped at 20, max +2 per stat).
// If this drops below 2, a full ASI (which always grants exactly 2 points) can't be spent.
export function getAsiCapacity(char: CharBaseStats): number {
  const statBases: Record<StatKey, number> = {
    strength:     char.baseStrength,
    dexterity:    char.baseDexterity,
    constitution: char.baseConstitution,
    intelligence: char.baseIntelligence,
    wisdom:       char.baseWisdom,
    charisma:     char.baseCharisma,
  };
  return ALL_STATS.reduce((sum, s) => sum + Math.max(0, Math.min(2, 20 - statBases[s])), 0);
}

export function isAsiLocked(char: CharBaseStats): boolean {
  return getAsiCapacity(char) < 2;
}

export function validateAsiChoices(char: CharForAsiValidation, choices: AsiChoices): string | null {
  if (!char.pendingChoicesQueue.length) return 'No pending level-up choices';
  if (char.pendingChoicesQueue[0].type !== 'asi') return 'Next pending choice is not an ASI';

  const total = ALL_STATS.reduce((sum, s) => sum + (choices[s] ?? 0), 0);
  if (total !== 2) return 'Total allocated points must equal 2';

  const statBases: Record<StatKey, number> = {
    strength:     char.baseStrength,
    dexterity:    char.baseDexterity,
    constitution: char.baseConstitution,
    intelligence: char.baseIntelligence,
    wisdom:       char.baseWisdom,
    charisma:     char.baseCharisma,
  };

  for (const stat of ALL_STATS) {
    const delta = choices[stat] ?? 0;
    if (delta < 0) return `Cannot decrease ${stat}`;
    if (delta > 2) return `Cannot add more than 2 to ${stat}`;
    if (statBases[stat] + delta > 20) return `${stat} would exceed 20`;
  }

  return null;
}

export function computeConHpDelta(baseCon: number, conDelta: number, level: number): number {
  const oldConMod = Math.floor((baseCon - 10) / 2);
  const newConMod = Math.floor((baseCon + conDelta - 10) / 2);
  return level * (newConMod - oldConMod);
}
