"use server";

import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { computeCharacterStats } from "../../lib/character-stats";
import { abilityModifier, proficiencyBonus } from "../../lib/dice";
import { SKILL_MAP } from "../../config/skills";
import { triggerCombat } from "./trigger-combat";
import type { SuggestionChip, QueueRoll } from "../../types/suggestion-chip";
import type { CharacterStats } from "../../lib/character-stats";

// ─── Attack detection ─────────────────────────────────────────────────────────

const ATTACK_KEYWORDS = [
  "attack", "strike", "hit", "shoot", "stab", "slash", "smash",
  "fire", "charge", "assault", "thrust", "cleave", "bash",
];

// Chip types that map to weapon/spell attacks (generate ATTACK+DAMAGE rolls).
const ATTACK_CHIP_TYPES_SET = new Set<string>([
  "none", "strength", "dexterity", "constitution",
  "intelligence", "wisdom", "charisma",
]);

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
  chip:            SuggestionChip,
  charName:        string,
  charClass:       string,
  stats:           CharacterStats,
  profBonus:       number,
  proficiencies:   string[],
  targetAC:        number,
  weaponDamageDice?: string,
  weaponAttackBonus?: number,
  stateEnemies?:   { id: string; x: number; y: number }[],
): QueueRoll[] {
  if (!chip.requiresRoll) return [];

  // Attack discriminator: bare ability types (strength, dexterity, intelligence, etc.) and
  // legacy "none" chips are weapon/spell attacks → generate ATTACK + DAMAGE rolls.
  // Named skill types (athletics, perception, etc.) are ability checks → single roll.
  // Keyword matching is a secondary fallback for any mislabelled chips.
  if (ATTACK_CHIP_TYPES_SET.has(chip.type) || isAttackLabel(chip.label)) {
    const statKey    = primaryAttackStatKey(charClass);
    const atkMod     = abilityModifier(stats[statKey].total) + profBonus + (weaponAttackBonus ?? 0);
    const dmgDice    = weaponDamageDice ?? defaultDamageDice(charClass);
    const dmgMod     = abilityModifier(stats[statKey].total);

    // Find the enemy at the chip's actionTarget position so auto-advance can apply damage mechanically.
    const target = chip.actionTarget;
    const targetEnemyId = target && stateEnemies
      ? stateEnemies.find(e => e.x === target.x && e.y === target.y)?.id
      : undefined;

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
        targetEnemyId,
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
      character:    { include: { mainHand: { select: { damageDice: true, attackBonus: true } } } },
      partyMembers: {
        include: { character: { include: { mainHand: { select: { damageDice: true, attackBonus: true } } } } },
        orderBy:  { turnOrder: "asc" },
      },
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

  const weapon = (currentChar as any).mainHand as { damageDice: string; attackBonus: number } | null;

  // Build enemy positions from tiles (authoritative) so targetEnemyId is resolved from
  // the same source as the chip's actionTarget — not from AI-authored gameState.enemies.
  const activeGM = (game as any).currentActId
    ? await prisma.gameMap.findUnique({
        where:  { gameId_actId: { gameId, actId: (game as any).currentActId } },
        select: { data: true },
      })
    : null;
  const gmTiles   = ((activeGM?.data as any)?.tiles  ?? []) as Array<Array<{ t: string; actor?: { kind: string; id: string } }>>;
  const gmEnemySt = ((activeGM?.data as any)?.enemyState ?? {}) as Record<string, { status?: string }>;
  const tileEnemies: { id: string; x: number; y: number }[] = [];
  for (let ty = 0; ty < gmTiles.length; ty++) {
    for (let tx = 0; tx < gmTiles[ty].length; tx++) {
      const actor = gmTiles[ty][tx]?.actor;
      if (actor?.kind === "enemy" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.id)) {
        const st = gmEnemySt[actor.id];
        if (st?.status !== "DEFEATED" && st?.status !== "FLED") tileEnemies.push({ id: actor.id, x: tx, y: ty });
      }
    }
  }
  const stateEnemies = tileEnemies.length > 0
    ? tileEnemies
    : ((gameState.enemies as any[] | undefined) ?? [])
        .map((e: any) => ({ id: e.id as string, x: e.x as number, y: e.y as number }));

  // Ensure a CombatSession exists before queuing an attack.
  // The queue-based path never goes through take-turn, so the combat intercept
  // there doesn't fire — we must trigger it here instead.
  const isAttackChip = chip.type === "mainAction" || ATTACK_CHIP_TYPES_SET.has(chip.type) || isAttackLabel(chip.label);
  if (isAttackChip) {
    const existingSession = await prisma.combatSession.findUnique({ where: { gameId } });
    if (!existingSession) {
      const livingEnemies = stateEnemies.filter(e => {
        const gmSt = ((activeGM?.data as any)?.enemyState ?? {})[e.id];
        return !gmSt || (gmSt.status !== "DEFEATED" && gmSt.status !== "FLED");
      });
      if (livingEnemies.length > 0) {
        const result = await triggerCombat(gameId, livingEnemies.map(e => e.id));
        if (!result.success) return { success: false, error: result.error };
      }
    }
  }

  const rolls = buildRolls(
    chip,
    currentChar.name,
    currentChar.characterClass,
    stats,
    profBonus,
    currentChar.skillProficiencies,
    targetAC,
    weapon?.damageDice,
    weapon?.attackBonus,
    stateEnemies,
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
