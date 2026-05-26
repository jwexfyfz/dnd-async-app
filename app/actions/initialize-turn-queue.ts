"use server";

import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { computeCharacterStats } from "../../lib/character-stats";
import { abilityModifier, proficiencyBonus } from "../../lib/dice";
import { SKILL_MAP } from "../../config/skills";
import type { SuggestionChip, QueueRoll } from "../../types/suggestion-chip";
import type { CharacterStats } from "../../lib/character-stats";

// ─── Attack detection ─────────────────────────────────────────────────────────

const ATTACK_KEYWORDS = [
  "attack", "strike", "hit", "shoot", "stab", "slash", "smash",
  "fire", "charge", "assault", "thrust", "cleave", "bash",
];

function isAttackLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return ATTACK_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Per-class defaults (pre-Phase E; Phase E makes this data-driven via Item) ─

function primaryAttackStatKey(
  characterClass: string,
): keyof CharacterStats {
  if (["Rogue", "Ranger", "Monk"].includes(characterClass)) return "dexterity";
  if (["Wizard", "Sorcerer"].includes(characterClass))       return "intelligence";
  if (["Warlock", "Bard"].includes(characterClass))          return "charisma";
  return "strength";
}

function defaultDamageDice(characterClass: string): string {
  if (["Barbarian"].includes(characterClass))         return "1d12";
  if (["Fighter", "Paladin"].includes(characterClass)) return "1d8";
  if (["Ranger"].includes(characterClass))             return "1d8";
  if (["Rogue"].includes(characterClass))              return "1d6";
  return "1d6";
}

function signedMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

// ─── Roll builder ─────────────────────────────────────────────────────────────

function buildRolls(
  chip:       SuggestionChip,
  charName:   string,
  charClass:  string,
  stats:      CharacterStats,
  profBonus:  number,
  proficiencies: string[],
  targetAC:   number,
): QueueRoll[] {
  if (!chip.requiresRoll) return [];

  // Attack discriminator: bare ability types (strength, dexterity, intelligence, etc.) and
  // legacy "none" chips are weapon/spell attacks → generate ATTACK + DAMAGE rolls.
  // Named skill types (athletics, perception, etc.) are ability checks → single roll.
  // Keyword matching is a secondary fallback for any mislabelled chips.
  const ATTACK_CHIP_TYPES = new Set<string>([
    "none", "strength", "dexterity", "constitution",
    "intelligence", "wisdom", "charisma",
  ]);
  if (ATTACK_CHIP_TYPES.has(chip.type) || isAttackLabel(chip.label)) {
    const statKey    = primaryAttackStatKey(charClass);
    const atkMod     = abilityModifier(stats[statKey].total) + profBonus;
    const dmgDice    = defaultDamageDice(charClass);
    const dmgMod     = abilityModifier(stats[statKey].total);

    return [
      {
        id:                     randomUUID(),
        type:                   "ATTACK",
        actorName:              charName,
        label:                  chip.label,
        diceFormula:            `1d20${signedMod(atkMod)}`,
        dc:                     targetAC,
        advantageState:         chip.advantageState,
        naturalResult:          null,
        secondaryNaturalResult: null,
        totalResult:            null,
        isSuccess:              null,
        skipped:                false,
      },
      {
        id:                     randomUUID(),
        type:                   "DAMAGE",
        actorName:              charName,
        label:                  `${chip.label} — Damage`,
        diceFormula:            `${dmgDice}${signedMod(dmgMod)}`,
        dc:                     null,
        advantageState:         "NONE",
        naturalResult:          null,
        secondaryNaturalResult: null,
        totalResult:            null,
        isSuccess:              null,
        skipped:                false,
      },
    ];
  }

  // Skill / ability check
  const skill        = SKILL_MAP[chip.type];
  const abilityKey   = skill?.abilityKey ?? "baseWisdom";
  const statName     = abilityKey.replace("base", "").toLowerCase() as keyof CharacterStats;
  const score        = stats[statName]?.total ?? 10;
  const isProficient = skill ? proficiencies.includes(skill.label) : false;
  const mod          = abilityModifier(score) + (isProficient ? profBonus : 0);
  const label        = skill ? `${skill.label} Check` : chip.label;
  const dc           = 12; // non-attack default DC

  return [
    {
      id:                     randomUUID(),
      type:                   "ABILITY_CHECK",
      actorName:              charName,
      label,
      diceFormula:            `1d20${signedMod(mod)}`,
      dc,
      advantageState:         chip.advantageState,
      naturalResult:          null,
      secondaryNaturalResult: null,
      totalResult:            null,
      isSuccess:              null,
      skipped:                false,
    },
  ];
}

// ─── Action ───────────────────────────────────────────────────────────────────

export interface InitializeTurnQueueResult {
  success: boolean;
  turnId?: string;
  rolls?:  QueueRoll[];
  error?:  string;
}

export async function initializeTurnQueue(
  gameId: string,
  chip:   SuggestionChip,
): Promise<InitializeTurnQueueResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      partyMembers: { include: { character: true }, orderBy: { turnOrder: "asc" } },
    },
  });
  if (!game) return { success: false, error: "Game not found." };

  const callerMember = game.partyMembers.find((m) => m.userId === user.id);
  if (game.partyMembers.length > 0) {
    if (!callerMember) return { success: false, error: "Not in this game." };
    if (game.currentTurnCharacterId !== callerMember.characterId)
      return { success: false, error: "Not your turn." };
  } else if (game.character.userId !== user.id) {
    return { success: false, error: "Access denied." };
  }

  const currentCharId = callerMember?.characterId ?? game.characterId;
  const currentChar   = callerMember ? callerMember.character : game.character;
  const gameState     = game.state as Record<string, any>;
  const targetAC      = (gameState.targetAC as number | undefined) ?? 14;

  const stats     = await computeCharacterStats(currentCharId);
  const profBonus = proficiencyBonus(currentChar.level);

  const rolls = buildRolls(
    chip,
    currentChar.name,
    currentChar.characterClass,
    stats,
    profBonus,
    currentChar.skillProficiencies,
    targetAC,
  );

  const turnId    = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.activeTurnQueue.create({
    data: {
      id:               turnId,
      gameId,
      characterId:      currentCharId,
      status:           rolls.length === 0 ? "COMPLETED" : "PENDING_ROLLS",
      currentRollIndex: 0,
      rolls:            rolls as any,
      expiresAt,
    },
  });

  return { success: true, turnId, rolls };
}
