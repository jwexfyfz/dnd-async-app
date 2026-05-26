// Pure, stateless helpers for The Field tab's passive layout rendering.
// No async calls, no math beyond deterministic ability-score arithmetic.
// Exported so they can be unit-tested against static mock payloads.

import type { Chip, ChipType } from "../types/chips";
import { SKILL_MAP } from "../config/skills";
import { proficiencyBonus } from "./leveling";

// Minimal character shape — only the fields used for modifier computation.
export interface CharacterAbilityScores {
  baseStrength:       number;
  baseDexterity:      number;
  baseConstitution:   number;
  baseIntelligence:   number;
  baseWisdom:         number;
  baseCharisma:       number;
  level:              number;
  skillProficiencies: string[];
}

export interface FieldChipProps {
  text:      string;
  type:      ChipType;
  dc:        number;
  modifier:  number;
  modStr:    string;
  label:     string;
  emoji:     string;
  abilityKey:string;
}

/**
 * Returns the last entry in the pre-computed narrative_history array stored in
 * the game state document.  Falls back to `fallback` when the history is empty,
 * so existing games (without narrative_history) still display their story prompt
 * description.  No computation — purely a safe array read.
 */
export function extractActiveNarrative(
  narrativeHistory: string[],
  fallback:         string,
): string {
  return narrativeHistory.at(-1) ?? fallback;
}

/**
 * Maps the static active_suggestion_chips array stored in the game state
 * document into button-prop objects that the Field tab renders directly.
 *
 * All numeric values (dc, modifier) are derived from fields that are already
 * persisted in the database — no AI calls, no async work.
 *
 * @param chips     - active_suggestion_chips from game.state (pre-computed).
 * @param character - character ability scores from the game document.
 * @param dc        - DC for this action context (game.state.targetAC ?? 12).
 */
export function mapChipsToFieldProps(
  chips:     Chip[],
  character: CharacterAbilityScores,
  dc:        number,
): FieldChipProps[] {
  const profBonus = proficiencyBonus(character.level);

  return chips.map((chip) => {
    const skill      = SKILL_MAP[chip.type] ?? SKILL_MAP["investigation"];
    const abilityScore = (character as unknown as Record<string, number>)[skill.abilityKey] ?? 10;
    const abilityMod   = Math.floor((abilityScore - 10) / 2);
    const isProficient = character.skillProficiencies.includes(skill.label);
    const modifier     = abilityMod + (isProficient ? profBonus : 0);
    const modStr       = modifier >= 0 ? `+${modifier}` : `${modifier}`;

    return {
      text:       chip.text,
      type:       chip.type,
      dc,
      modifier,
      modStr,
      label:      skill.label,
      emoji:      skill.emoji,
      abilityKey: skill.abilityKey,
    };
  });
}
