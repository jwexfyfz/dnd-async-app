import { z } from 'zod';

export const StatModifierSchema = z.object({
  field: z.enum(['critThreshold', 'speed', 'armorClass']),
  operation: z.enum(['set', 'add']),
  value: z.number(),
});

export const ActiveAbilitySchema = z.object({
  cost: z.array(z.object({ poolKey: z.string(), amount: z.number() })),
  effect: z.object({
    type: z.enum(['heal_self', 'grant_advantage', 'bonus_attack', 'grant_action']),
    value: z.union([z.number(), z.string()]).optional(),
  }),
});

export const TriggeredEffectSchema = z.object({
  trigger: z.enum(['on_hit', 'on_crit', 'on_kill', 'on_attack_roll']),
  condition: z.enum(['ally_adjacent_to_target', 'has_advantage']).optional(),
  effect: z.object({
    type: z.enum(['add_damage', 'grant_bardic_inspiration']),
    dice: z.string().optional(),
  }),
});

export const ReactionEffectSchema = z.object({
  trigger: z.enum(['on_ally_hit', 'on_enemy_attack']),
  cost: z.array(z.object({ poolKey: z.string(), amount: z.number() })),
  effect: z.object({ type: z.enum(['protect_ally', 'counter_attack']) }),
});

export const ChoiceGateSchema = z.object({
  choiceType: z.enum(['maneuver', 'spell', 'fighting_style', 'subclass']),
  options: z.array(z.string()).optional(),
  minSelections: z.number(),
  maxSelections: z.number(),
});

const FEATURETYPE_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  PASSIVE: null,
  SPELLCASTING: null,
  STAT_MODIFIER: StatModifierSchema,
  RESOURCE_POOL: null,
  ACTIVE_ABILITY: ActiveAbilitySchema,
  TRIGGERED_EFFECT: TriggeredEffectSchema,
  REACTION: ReactionEffectSchema,
  CHOICE_GATE: ChoiceGateSchema,
};

export function validateMechanicsJson(
  featureType: string,
  mechanicsJson: unknown,
  featureName: string,
): void {
  const schema = FEATURETYPE_SCHEMAS[featureType];
  if (schema === null) {
    if (mechanicsJson !== null && mechanicsJson !== undefined) {
      throw new Error(
        `[seed] ${featureName}: ${featureType} must have null mechanicsJson, got ${JSON.stringify(mechanicsJson)}`,
      );
    }
    return;
  }
  if (mechanicsJson === null || mechanicsJson === undefined) {
    throw new Error(`[seed] ${featureName}: ${featureType} requires non-null mechanicsJson`);
  }
  const result = schema.safeParse(mechanicsJson);
  if (!result.success) {
    throw new Error(
      `[seed] ${featureName}: invalid mechanicsJson — ${result.error.message}`,
    );
  }
}
