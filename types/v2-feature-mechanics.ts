// Typed shapes for ClassFeature.mechanicsJson
// PASSIVE and SPELLCASTING features always have mechanicsJson: null

export type StatModifier = {
  field: 'critThreshold' | 'speed' | 'armorClass';
  operation: 'set' | 'add';
  value: number;
};

export type ActiveAbility = {
  cost: Array<{ poolKey: string; amount: number }>;
  effect: {
    type: 'heal_self' | 'grant_advantage' | 'bonus_attack' | 'grant_action';
    value?: number | string;
  };
};

export type TriggeredEffect = {
  trigger: 'on_hit' | 'on_crit' | 'on_kill' | 'on_attack_roll';
  condition?: 'ally_adjacent_to_target' | 'has_advantage';
  effect: {
    type: 'add_damage' | 'grant_bardic_inspiration';
    dice?: string;
  };
};

export type ReactionEffect = {
  trigger: 'on_ally_hit' | 'on_enemy_attack';
  cost: Array<{ poolKey: string; amount: number }>;
  effect: { type: 'protect_ally' | 'counter_attack' };
};

export type ChoiceGate = {
  choiceType: 'maneuver' | 'spell' | 'fighting_style' | 'subclass';
  options?: string[];
  minSelections: number;
  maxSelections: number;
};

export type FeatureMechanicsJson =
  | StatModifier
  | ActiveAbility
  | TriggeredEffect
  | ReactionEffect
  | ChoiceGate;
