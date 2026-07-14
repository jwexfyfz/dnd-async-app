import type { CombatState } from '@/types/v2-game';

export type ChipVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'danger'
  | 'class'
  | 'dim';

export interface ScoredChip {
  id: string;
  label: string;
  score: number;
  variant: ChipVariant;
  killBlow: boolean;
  visible: boolean;
  hint: string;
}

export function myHpPct(combatState: CombatState, characterId: string): number {
  const entry = combatState.initiativeOrder.find(e => e.id === characterId);
  if (!entry || entry.maxHp === 0) return 1;
  return entry.hp / entry.maxHp;
}

export function scoreChips(
  combatState: CombatState,
  characterId: string,
  characterClass: string,
  hasHealingItems: boolean,
  hasCombatItems: boolean,
): ScoredChip[] {
  const order = combatState.initiativeOrder;
  const myEntry = order.find(e => e.id === characterId);
  const hpPct = myHpPct(combatState, characterId);
  const aliveEnemies = order.filter(e => e.type === 'enemy' && e.hp > 0);
  const closeEnemies = aliveEnemies.filter(e => e.proximity === 'close');
  const allFar = aliveEnemies.length > 0 && closeEnemies.length === 0;
  const statusEffects = myEntry?.status_effects ?? [];

  const chips: ScoredChip[] = [];

  // attack
  {
    let score = 1;
    let label = 'Attack';
    let variant: ChipVariant = 'default';
    let killBlow = false;

    if (statusEffects.includes('hiding')) {
      score += 3;
      label = 'Sneak Attack';
      variant = 'success';
    } else if (statusEffects.includes('smite_pending')) {
      score += 2;
      label = 'Attack + Smite';
      variant = 'class';
    } else {
      const hexEffect = statusEffects.find(s => s.startsWith('concentrating:hex:'));
      const markEffect = statusEffects.find(s => s.startsWith('concentrating:hunters_mark:'));
      if (hexEffect) {
        const hexTargetId = hexEffect.split(':')[2];
        if (aliveEnemies.some(e => e.id === hexTargetId)) { score += 1; label = 'Attack + Hex'; variant = 'class'; }
      } else if (markEffect) {
        const markTargetId = markEffect.split(':')[2];
        if (aliveEnemies.some(e => e.id === markTargetId)) { score += 1; label = 'Attack + Mark'; variant = 'class'; }
      }
    }

    const minEnemyHpPct = aliveEnemies.length > 0
      ? Math.min(...aliveEnemies.map(e => e.maxHp > 0 ? e.hp / e.maxHp : 1))
      : 1;
    if (minEnemyHpPct <= 0.25) {
      score += 2;
      if (variant === 'default') variant = 'primary';
      killBlow = true;
    }

    if (allFar) { score -= 1; variant = 'dim'; }

    chips.push({ id: 'attack', label, score, variant, killBlow, visible: true, hint: 'attack' });
  }

  // shove
  {
    if (closeEnemies.length > 0) {
      let score = 1;
      if (hpPct > 0.6 && closeEnemies.some(e => e.hp > 10)) score = 2;
      chips.push({ id: 'shove', label: 'Shove', score, variant: 'default', killBlow: false, visible: true, hint: 'shove' });
    } else {
      chips.push({ id: 'shove', label: 'Shove', score: 0, variant: 'default', killBlow: false, visible: false, hint: 'shove' });
    }
  }

  // dodge
  {
    let score = 0;
    let variant: ChipVariant = 'default';
    if (hpPct <= 0.25) { score += 3; variant = 'danger'; }
    else if (hpPct <= 0.5 && closeEnemies.length >= 2) { score += 2; variant = 'danger'; }
    else if (hpPct <= 0.5) { score += 1; }
    chips.push({ id: 'dodge', label: 'Dodge', score, variant, killBlow: false, visible: true, hint: 'dodge' });
  }

  // dash
  {
    let score = 0;
    let label = 'Dash';
    let variant: ChipVariant = 'default';
    if (allFar) { score += 2; label = 'Close In'; variant = 'primary'; }
    else if (hpPct <= 0.25) { score += 1; variant = 'danger'; }
    else if (closeEnemies.length > 0 && aliveEnemies.length === closeEnemies.length) { score -= 1; variant = 'dim'; }
    chips.push({ id: 'dash', label, score, variant, killBlow: false, visible: true, hint: 'dash' });
  }

  // disengage (Back Off)
  {
    let score = 0;
    let variant: ChipVariant = 'default';
    if (hpPct <= 0.25 && closeEnemies.length >= 1) { score += 3; variant = 'danger'; }
    else if (hpPct <= 0.4 && closeEnemies.length >= 1) { score += 1; }
    chips.push({ id: 'disengage', label: 'Back Off', score, variant, killBlow: false, visible: true, hint: 'disengage' });
  }

  // hide
  {
    if (statusEffects.includes('hiding')) {
      chips.push({ id: 'hide', label: 'Hide', score: 0, variant: 'default', killBlow: false, visible: false, hint: 'hide' });
    } else {
      let score = 0;
      let variant: ChipVariant = 'default';
      if (characterClass === 'Rogue') { score += 2; variant = 'class'; }
      chips.push({ id: 'hide', label: 'Hide', score, variant, killBlow: false, visible: true, hint: 'hide' });
    }
  }

  // use_item
  {
    if (!hasCombatItems) {
      chips.push({ id: 'use_item', label: 'Use Item', score: 0, variant: 'default', killBlow: false, visible: false, hint: 'use_item' });
    } else {
      let score = 0;
      let label = 'Use Item';
      let variant: ChipVariant = 'default';
      if (hpPct <= 0.2 && hasHealingItems) { score += 3; label = 'Use Potion'; variant = 'danger'; }
      else if (hpPct <= 0.4 && hasHealingItems) { score += 2; label = 'Use Potion'; variant = 'danger'; }
      chips.push({ id: 'use_item', label, score, variant, killBlow: false, visible: true, hint: 'use_item' });
    }
  }

  // provoke
  {
    let score = 0;
    let label = 'Provoke';
    const tauntClasses = ['Fighter', 'Barbarian', 'Paladin'];
    const hasUnfocusedEnemy = aliveEnemies.some(e => !e.priority_target);
    if (tauntClasses.includes(characterClass) && hasUnfocusedEnemy) { score += 1; label = 'Taunt'; }
    chips.push({ id: 'provoke', label, score, variant: 'default', killBlow: false, visible: true, hint: 'provoke' });
  }

  return chips;
}
