"use server";

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE } from "../../lib/ai-config";
import { parseCombatEffects, clampHp } from "../../lib/combat-effect";
import { computeLevel, XP_BY_DIFFICULTY } from "../../lib/xp";
import { maxHpAtLevel, proficiencyBonus } from "../../lib/leveling";
import type { QueueRoll, SuggestionChip } from "../../types/suggestion-chip";
import type { Chip } from "../../types/chips";

const anthropic = new Anthropic({ maxRetries: 4 });

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildStaticContext(
  character:    any,
  allMembers:   any[],
  storyPrompt:  any,
  mapData:      any,
): string {
  const rooms    = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois     = mapData.pois?.map((p: any) => `${p.name} at (${p.x},${p.y})`).join(", ") ?? "—";
  const partyStr = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name} [id:${m.character.id}] (${m.character.characterClass})`
      ).join("\n")
    : `  ${character.name} [id:${character.id}] (${character.characterClass})`;

  return `You are a skilled Dungeon Master running an async D&D 5e campaign. Prose is vivid but concise — 2–4 sentences of present-tense narration.

PARTY
${partyStr}

SCENARIO: ${storyPrompt.title}
${storyPrompt.description}

MAP: ${mapData.name ?? "Unknown"}
Rooms: ${rooms}
Points of interest: ${pois}`;
}

function buildRollSummary(rolls: QueueRoll[]): string {
  return rolls
    .map((r, i) => {
      if (r.skipped) return `${i + 1}. ${r.type} — ${r.label}: SKIPPED`;
      const outcome = r.isSuccess === true ? "SUCCESS" : r.isSuccess === false ? "FAILURE" : "—";
      const crit    = r.naturalResult === 20 ? " (CRITICAL HIT)" : r.naturalResult === 1 ? " (FUMBLE)" : "";
      return `${i + 1}. ${r.type} — ${r.label}: rolled ${r.naturalResult ?? "—"} (total ${r.totalResult ?? "—"}) vs ${r.dc ?? "—"} → ${outcome}${crit}`;
    })
    .join("\n");
}

function buildDynamicContext(
  gameState:         Record<string, any>,
  partyMembers:      any[],
  currentCharId:     string,
  chipLabel:         string,
  rolls:             QueueRoll[],
  consecutiveMisses: number,
): string {
  const inv   = Array.isArray(gameState.inventory) && gameState.inventory.length ? gameState.inventory.join(", ") : "empty";
  const flags = Array.isArray(gameState.plotFlags)  && gameState.plotFlags.length  ? gameState.plotFlags.join(", ")  : "none";
  const stateStr = partyMembers.length > 1 && gameState.partyHp
    ? partyMembers.map((m: any) => {
        const hp  = gameState.partyHp?.[m.characterId] ?? "?";
        const max = gameState.partyMaxHp?.[m.characterId] ?? "?";
        const arrow = m.characterId === currentCharId ? "→ " : "  ";
        return `${arrow}${m.character.name}: HP ${hp}/${max}`;
      }).join("\n")
    : `HP: ${gameState.hp}/${gameState.maxHp}\nInventory: ${inv}\nObjective: ${gameState.activeObjective}\nPlot flags: ${flags}`;

  const missDirective = consecutiveMisses >= 3
    ? `\nNARRATION DIRECTIVE: After ${consecutiveMisses} consecutive misses, engineer a dramatic opening — enemy stumbles, environment intervenes, or an NPC assists. Do not alter the roll outcomes.`
    : "";

  const turnSection = rolls.length > 0
    ? `TURN RESOLUTION — narrate around these exact results:\n${buildRollSummary(rolls)}`
    : `TURN RESOLUTION — free action, no dice roll required.\nPlayer action: ${chipLabel}`;

  return `CURRENT STATE
${stateStr}

${turnSection}
consecutiveMisses: ${consecutiveMisses}${missDirective}`;
}

const CHIP_FORMAT_INSTRUCTION = `chips: array of 3–5 objects for the player's NEXT possible action. Each object:
  "label": string, under 6 words, situationally specific
  "type": one of: athletics, acrobatics, sleight_of_hand, stealth, arcana, history, investigation, nature, religion, animal_handling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion, strength, dexterity, constitution, intelligence, wisdom, charisma, none
    Rules for "type":
    - Melee weapon attacks (slash, strike, smash, stab) → "strength" (or "dexterity" for finesse/light weapons)
    - Ranged weapon attacks (shoot, fire, throw) → "dexterity"
    - Spell attacks → use the caster's primary stat: "intelligence" (Wizard/Artificer), "charisma" (Sorcerer/Warlock/Bard), "wisdom" (Cleric/Druid/Ranger)
    - Movement/Dash actions → "athletics"
    - Named skill checks (Perception, Stealth, etc.) → use the matching skill type
    - Use "none" ONLY for purely free actions that require no roll (object interactions, drop item, etc.)
  "requiresRoll": boolean
  "advantageState": one of: "NONE", "ADVANTAGE", "DISADVANTAGE"
  "action_type": one of: "mainAction", "bonusAction", "movement", "free"
  "movementFeet": number, 0 unless action_type is "movement"
  "spellLevel": number, 0 for martial or cantrip, spell slot level for leveled spells`;

function buildResponseInstruction(): string {
  return `RESPONSE RULES
Reply with exactly one JSON object. No markdown fences, no prose before or after.
{
  "narrative": "2–4 sentences, vivid present tense, address the active character by name",
  "stateDeltas": {},
  "chips": [{"label":"Strike the guard","type":"strength","requiresRoll":true,"advantageState":"NONE","action_type":"mainAction","movementFeet":0,"spellLevel":0},{"label":"Scan the shadows","type":"perception","requiresRoll":true,"advantageState":"NONE","action_type":"mainAction","movementFeet":0,"spellLevel":0},{"label":"Dash for cover","type":"athletics","requiresRoll":false,"advantageState":"NONE","action_type":"movement","movementFeet":30,"spellLevel":0}],
  "encounterResult": null
}

Field details:
narrative — describe what happens as a result of the action.
stateDeltas — key/value pairs for any game state changes (playerPos, inventory, etc.). Omit HP — use the combat effect tag instead.
chips — ${CHIP_FORMAT_INSTRUCTION}
encounterResult — use the string "completed" if combat fully resolves this turn; otherwise null.

COMBAT EFFECT TAG (engine-only, not shown to players)
When a character's HP changes, append this tag after the closing brace:
<combat_effect target_id="CHAR_ID" delta="N" type="physical" />`;
}

// ─── Chip normalisation ───────────────────────────────────────────────────────

function normaliseSuggestionChips(raw: any[]): SuggestionChip[] {
  return raw.map((c) => ({
    id:             randomUUID(),
    label:          typeof c.label === "string" ? c.label.slice(0, 60) : "Continue",
    type:           c.type ?? "none",
    requiresRoll:   c.requiresRoll === true,
    advantageState: c.advantageState ?? "NONE",
    action_type:    c.action_type    ?? "mainAction",
    movementFeet:   typeof c.movementFeet === "number" ? c.movementFeet : 0,
    spellLevel:     typeof c.spellLevel   === "number" ? c.spellLevel   : 0,
  }));
}

// Backwards-compat Chip[] for game.state.active_suggestion_chips (Phase C removes this)
function toLegacyChips(chips: SuggestionChip[]): Chip[] {
  return chips
    .filter((c) => c.type !== "none")
    .map((c) => ({ text: c.label, type: c.type } as Chip));
}

// ─── Action ───────────────────────────────────────────────────────────────────

export interface AutoAdvanceResult {
  success:       boolean;
  narrative?:    string;
  chips?:        SuggestionChip[];
  newState?:     Record<string, any>;
  combatEffects?:{ targetId: string; delta: number; type: string; newHp: number }[];
  levelUpResult?:{ oldLevel: number; newLevel: number; oldMaxHp: number; newMaxHp: number; proficiencyBonus: number };
  error?:        string;
}

export async function autoAdvance(
  gameId:    string,
  turnId:    string,
  chipLabel: string,
): Promise<AutoAdvanceResult> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  // ── Load queue ────────────────────────────────────────────────────────────
  const queue = await prisma.activeTurnQueue.findUnique({ where: { id: turnId } });
  if (!queue || queue.gameId !== gameId) return { success: false, error: "Turn not found." };
  if (queue.status !== "COMPLETED")      return { success: false, error: "Rolls not yet resolved." };

  const rolls = queue.rolls as unknown as QueueRoll[];

  // ── Load game ─────────────────────────────────────────────────────────────
  const game = await prisma.game.findUnique({
    where:   { id: gameId },
    include: {
      character:    true,
      storyPrompt:  true,
      map:          true,
      partyMembers: { include: { character: true }, orderBy: { turnOrder: "asc" } },
      messages:     { orderBy: { createdAt: "asc" }, take: ROLLING_WINDOW_SIZE },
    },
  });
  if (!game) return { success: false, error: "Game not found." };

  const callerMember  = game.partyMembers.find((m) => m.userId === user.id);
  const currentCharId = callerMember?.characterId ?? game.characterId;
  const currentChar   = callerMember ? callerMember.character : game.character;
  const gameState     = game.state as Record<string, any>;
  const mapData       = game.map.data as Record<string, any>;
  const expectedVersion = game.version;

  // ── consecutiveMisses ─────────────────────────────────────────────────────
  const primaryRoll   = rolls.find((r) => r.type !== "DAMAGE");
  // Free actions (no rolls) and successes both reset the miss streak.
  const turnSucceeded = rolls.length === 0 || (primaryRoll?.isSuccess ?? false);
  const consecutiveMisses = turnSucceeded
    ? 0
    : (gameState.consecutiveMisses ?? 0) + 1;

  // ── Claude call ───────────────────────────────────────────────────────────
  const staticCtx  = buildStaticContext(currentChar, game.partyMembers, game.storyPrompt, mapData);
  const dynamicCtx = buildDynamicContext(gameState, game.partyMembers, currentCharId, chipLabel, rolls, consecutiveMisses);
  const responseInstr = buildResponseInstruction();

  const recentMessages = game.messages.map((m) => ({
    role:    m.role === "PLAYER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
  if (recentMessages.length === 0 || recentMessages[0].role === "assistant") {
    recentMessages.unshift({ role: "user", content: "The adventure begins." });
  }
  recentMessages.push({ role: "user", content: `Player action: ${chipLabel}` });

  let rawText: string;
  try {
    const response = await anthropic.messages.create({
      model:      DM_MODEL,
      max_tokens: DM_MAX_TOKENS,
      system: [
        { type: "text", text: staticCtx,    cache_control: { type: "ephemeral" } },
        { type: "text", text: `${dynamicCtx}\n\n${responseInstr}` },
      ],
      messages: recentMessages,
    });
    const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    rawText = block?.text ?? "";
  } catch (err: any) {
    console.error("autoAdvance AI error:", err.message);
    return { success: false, error: "The DM is temporarily unavailable." };
  }

  console.log("[autoAdvance] raw Claude response:", rawText.slice(0, 800));

  // ── Parse Claude response ─────────────────────────────────────────────────
  let parsed: {
    narrative:      string;
    stateDeltas:    Record<string, any>;
    chips:          any[];
    encounterResult:"completed" | null;
  };
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? rawText);
    console.log("[autoAdvance] parsed chips:", parsed.chips?.length ?? 0);
  } catch (parseErr) {
    console.error("[autoAdvance] JSON parse failed:", parseErr, "\nrawText:", rawText.slice(0, 800));
    parsed = {
      narrative:      "The dungeon stirs around you.",
      stateDeltas:    {},
      chips:          [],
      encounterResult:null,
    };
  }

  const chips    = normaliseSuggestionChips(Array.isArray(parsed.chips) ? parsed.chips : []);
  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "The dungeon stirs.";

  // ── Combat effects ────────────────────────────────────────────────────────
  const rawEffects = parseCombatEffects(rawText);
  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];

  // ── XP / level-up ────────────────────────────────────────────────────────
  const encounterCompleted = parsed.encounterResult === "completed";
  const xpAwarded   = encounterCompleted ? (XP_BY_DIFFICULTY[game.storyPrompt.difficulty] ?? 0) : 0;
  const currentXp   = (currentChar.xp ?? 0) + xpAwarded;
  const previousLevel = currentChar.level ?? 1;
  const newLevel    = computeLevel(currentXp);
  const didLevelUp  = newLevel > previousLevel;

  // ── State delta application ───────────────────────────────────────────────
  const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
  const newState: Record<string, any> = { ...gameState, consecutiveMisses };
  const deltas = { ...(parsed.stateDeltas ?? {}) };
  for (const key of RULES_ENGINE_KEYS) delete deltas[key];

  if (game.partyMembers.length > 1 && newState.partyHp) {
    if (deltas.hp !== undefined) {
      newState.partyHp = { ...newState.partyHp, [currentCharId]: deltas.hp };
      delete deltas.hp;
    }
    if (deltas.playerPos !== undefined) {
      newState.partyPositions = { ...newState.partyPositions, [currentCharId]: deltas.playerPos };
      delete deltas.playerPos;
    }
  }
  Object.assign(newState, deltas);

  if (didLevelUp) {
    newState.levelUpNote = `${currentChar.name} advanced to Level ${newLevel} this turn.`;
  } else {
    delete newState.levelUpNote;
  }

  // Dual-write to legacy game.state fields (Phase C removes these when frontend cuts over)
  const existingHistory: string[] = Array.isArray(newState.narrative_history)
    ? (newState.narrative_history as string[]) : [];
  newState.narrative_history        = [...existingHistory, narrative];
  newState.active_suggestion_chips  = toLegacyChips(chips);

  // ── Turn rotation ─────────────────────────────────────────────────────────
  let nextCharId = currentCharId;
  if (game.partyMembers.length > 1) {
    const sorted  = [...game.partyMembers].sort((a, b) => a.turnOrder - b.turnOrder);
    const curIdx  = sorted.findIndex((m) => m.characterId === currentCharId);
    nextCharId    = sorted[(curIdx + 1) % sorted.length].characterId;
  }

  // ── worldState for dedicated column (Phase D will fully migrate reads here) ─
  const worldState = {
    activeObjective:   newState.activeObjective   ?? gameState.activeObjective,
    plotFlags:         newState.plotFlags          ?? gameState.plotFlags          ?? [],
    consecutiveMisses,
    npcsEncountered:   newState.npcsEncountered    ?? gameState.npcsEncountered    ?? [],
  };

  // ── Atomic transaction ────────────────────────────────────────────────────
  let committedMaxHp = currentChar.maxHp;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.game.findUnique({ where: { id: gameId }, select: { version: true } });
      if (!current || current.version !== expectedVersion) throw new Error("STALE_TURN");

      await tx.message.create({ data: { gameId, role: "PLAYER", content: chipLabel } });
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: narrative, chips: toLegacyChips(chips) },
      });

      if (xpAwarded > 0 || didLevelUp) {
        committedMaxHp = didLevelUp
          ? maxHpAtLevel(currentChar.characterClass, currentChar.baseConstitution, newLevel)
          : currentChar.maxHp;
        await tx.character.update({
          where: { id: currentCharId },
          data:  { xp: currentXp, level: newLevel, maxHp: committedMaxHp },
        });
      }

      // Resolve combat HP deltas inside the transaction (consistent snapshot).
      if (rawEffects.length > 0) {
        const ids   = [...new Set(rawEffects.map((e) => e.targetId))];
        const chars = await tx.character.findMany({
          where:  { id: { in: ids } },
          select: { id: true, currentHp: true, maxHp: true },
        });
        const charMap = new Map(chars.map((c) => [c.id, c]));
        resolvedEffects = rawEffects
          .filter((e) => charMap.has(e.targetId))
          .map((e) => {
            const c = charMap.get(e.targetId)!;
            return { ...e, newHp: clampHp(c.currentHp, e.delta, c.maxHp) };
          });
        for (const eff of resolvedEffects) {
          await tx.character.update({ where: { id: eff.targetId }, data: { currentHp: eff.newHp } });
        }
      }

      await tx.game.update({
        where: { id: gameId },
        data: {
          state:                newState,
          // Dedicated Phase B pillars (dual-write alongside game.state)
          worldState,
          currentScenario:      narrative,
          narrativeHistory:     { push: narrative },
          activeSuggestionChips:chips as any,
          currentTurnCharacterId: nextCharId,
          version:              { increment: 1 },
        },
      });

      // Purge completed queue row.
      await tx.activeTurnQueue.delete({ where: { id: turnId } });
    });
  } catch (err: any) {
    if (err.message === "STALE_TURN") return { success: false, error: "STALE_TURN" };
    throw err;
  }

  return {
    success:       true,
    narrative,
    chips,
    newState,
    combatEffects: resolvedEffects.length > 0 ? resolvedEffects : undefined,
    levelUpResult: didLevelUp ? {
      oldLevel:         previousLevel,
      newLevel,
      oldMaxHp:         currentChar.maxHp,
      newMaxHp:         committedMaxHp,
      proficiencyBonus: proficiencyBonus(newLevel),
    } : undefined,
  };
}
