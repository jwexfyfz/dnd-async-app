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
  story:        any,
  currentAct:   any,
  currentScene: any,
  mapData:      any,
): string {
  const rooms    = mapData.rooms?.map((r: any) => `${r.name}: ${r.description}`).join(" | ") ?? "—";
  const pois     = mapData.pois?.map((p: any) => `${p.name} at (${p.x},${p.y})`).join(", ") ?? "—";
  const partyStr = allMembers.length > 1
    ? allMembers.map((m: any) =>
        `  ${m.character.name}[id:${m.character.id},${m.character.characterClass}]`
      ).join("\n")
    : `  ${character.name}[id:${character.id},${character.characterClass}]`;

  const actSummaries = story?.acts
    ?.map((a: any) => `  Act ${a.order}: ${a.title} — ${a.summary}`)
    .join("\n") ?? "";

  const actBlock = currentAct
    ? `CURRENT ACT ${currentAct.order}: ${currentAct.title}\n${currentAct.playerFacingDescription}`
    : "";

  const sceneBlock = currentScene
    ? `CURRENT SCENE ${currentScene.order}: ${currentScene.title}\n${currentScene.description}\nObjectives: ${(currentScene.objectives as string[]).join("; ")}`
    : "";

  return `You are an immersive Dungeon Master running an async D&D 5e campaign. Write 3–4 sentences of specific, present-tense narration. Every sentence must name something concrete — a weapon connecting, an enemy recoiling, a door groaning open, a trap clicking. Never write vague filler ("the dungeon stirs", "you press on"). Describe: (1) the exact result of the player's action, (2) how the environment or enemy reacts, (3) what the character now faces so the next choices are obvious.

PARTY
${partyStr}

OVERARCHING STORY: ${story?.title ?? "Unknown"}
${actSummaries}

${actBlock}

${sceneBlock}

MAP: ${mapData.name ?? "Unknown"}
Rooms: ${rooms}
Points of interest: ${pois}

SPATIAL RULES
Pos: values are tile coordinates. Use them to determine and narrate spatial reality every turn:
- Distance ≤ 1 tile → melee reach; describe the closeness physically (smell, breathing, blade contact).
- Distance 2–4 tiles → near-range; describe positioning, charging, closing the gap.
- Distance 5+ tiles → ranged; describe throws, spells, projectiles arcing across the room.
- After any character (player or enemy) moves, their new x,y MUST appear in stateDeltas (playerPos for the active character; updated enemies array for NPCs). Never let a movement go unrecorded.`;
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
  worldState:    Record<string, any> | null,
  gameState:     Record<string, any>,
  currentChar:   any,
  partyMembers:  any[],
  currentCharId: string,
  chipLabel:     string,
  rolls:         QueueRoll[],
  consecutiveMisses: number,
  lastEncounterCompleted: boolean,
  mapItems:      { id: string; name: string; isEquipped: boolean; posX: number | null; posY: number | null }[],
): string {
  // worldState columns → fall back to game.state JSON
  const ws  = worldState ?? {};
  const obj = (ws.activeObjective ?? gameState.activeObjective ?? "") as string;
  const flags = ((ws.plotFlags ?? gameState.plotFlags ?? []) as string[]);

  // Token-compressed character tag (D4)
  function charTag(char: any, pos: { x: number; y: number }, isActive: boolean): string {
    const prefix = isActive ? "→" : " ";
    const weap  = (char.mainHand as { name: string } | null)?.name ?? "none";
    const armor = (char.armor    as { name: string } | null)?.name ?? "none";
    const cond  = Array.isArray(char.activeConditions) && char.activeConditions.length > 0
      ? (char.activeConditions as string[]).join("+")
      : "none";
    return `${prefix}${char.name}[LVL:${char.level},HP:${char.currentHp}/${char.maxHp},Pos:${pos.x},${pos.y},Weap:${weap},Armor:${armor},Cond:${cond}]`;
  }

  const enemies = (gameState.enemies as { id: string; name: string; hp: number; maxHp: number; x: number; y: number }[] | undefined) ?? [];
  const enemyStr = enemies.length > 0
    ? enemies.map((e) => `${e.name}[id:${e.id},HP:${e.hp}/${e.maxHp},Pos:${e.x},${e.y}]`).join(" ")
    : "none";

  const groundItems = mapItems.filter((i) => !i.isEquipped && i.posX !== null && i.posY !== null);
  const itemStr = groundItems.length > 0
    ? groundItems.map((i) => `${i.name}@(${i.posX},${i.posY})`).join(", ")
    : "none";

  let stateStr: string;
  if (partyMembers.length > 0) {
    const tags = partyMembers
      .map((m: any) => charTag(m.character, { x: m.posX, y: m.posY }, m.characterId === currentCharId))
      .join("  ");
    stateStr = `${tags}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}`;
  } else {
    const pos = (gameState.playerPos as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    stateStr = `${charTag(currentChar, pos, true)}\nEnemies:${enemyStr}\nItems:${itemStr}\nObj:${obj}\nFlags:${flags.length > 0 ? flags.join(",") : "none"}`;
  }

  const missDirective = consecutiveMisses >= 3
    ? `\nNARRATION DIRECTIVE: After ${consecutiveMisses} consecutive misses, engineer a dramatic opening — enemy stumbles, environment intervenes, or an NPC assists. Do not alter the roll outcomes.`
    : "";

  const turnSection = rolls.length > 0
    ? `TURN RESOLUTION — narrate around these exact results:\n${buildRollSummary(rolls)}`
    : `TURN RESOLUTION — free action, no dice roll required.\nPlayer action: ${chipLabel}`;

  const hasLivingEnemies = ((gameState.enemies ?? []) as any[]).some((e: any) => (e.hp ?? 0) > 0);
  const postCombatDirective = lastEncounterCompleted && !hasLivingEnemies
    ? `\nSTORY TRANSITION: The previous combat encounter just resolved — no enemies remain here. Advance the story now: reveal what the party discovers (loot, a clue, a new passage, an NPC reaction), describe what lies ahead, and set up the next decision. Chips MUST be post-combat actions — exploration, investigation, movement, or social — never attacks against defeated enemies.`
    : "";

  return `CURRENT STATE\n${stateStr}\n\n${turnSection}\nconsecutiveMisses:${consecutiveMisses}${missDirective}${postCombatDirective}`;
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
  "narrative": "3–4 sentences, present tense, name the active character. S1: exact outcome of their action (hit/miss/crit/spell effect). S2: enemy or environment reaction. S3–4: what the character now faces (sets up next actions).",
  "stateDeltas": {},
  "chips": [{"label":"Strike the guard","type":"strength","requiresRoll":true,"advantageState":"NONE","action_type":"mainAction","movementFeet":0,"spellLevel":0},{"label":"Scan the shadows","type":"perception","requiresRoll":true,"advantageState":"NONE","action_type":"mainAction","movementFeet":0,"spellLevel":0},{"label":"Dash for cover","type":"athletics","requiresRoll":false,"advantageState":"NONE","action_type":"movement","movementFeet":30,"spellLevel":0}],
  "encounterResult": null
}

Field details:
narrative — 3–4 sentences: (1) exact outcome of the action, (2) enemy/NPC/environment reaction, (3–4) what the character now faces. Be specific — name enemies, objects, distances, damage amounts. No vague filler.
stateDeltas — key/value pairs for any game state changes. Omit party HP — use the combat effect tag instead. PLAYER MOVEMENT: when the active character moves, "playerPos" is REQUIRED with exact integer {x,y} tile coordinates (1–2 tiles toward destination; never null or fractional). ENEMY MOVEMENT: when any enemy moves or attacks, update their x,y in "enemies" — include the FULL enemy list with current HP and updated positions whenever any enemy acts, moves, or takes damage. Omit "enemies" key only if nothing about any enemy changed this turn.
chips — REQUIRED, never empty. ${CHIP_FORMAT_INSTRUCTION} When no enemies are present, chips MUST be exploration, investigation, movement, or social actions that advance the story. An empty chips array is invalid.
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
      character:    { include: { mainHand: { select: { name: true } }, armor: { select: { name: true } } } },
      story:        { include: { acts: { select: { order: true, title: true, summary: true }, orderBy: { order: "asc" } } } },
      currentAct:   true,
      currentScene: true,
      map:          { include: { items: { select: { id: true, name: true, isEquipped: true, posX: true, posY: true } } } },
      partyMembers: {
        include: { character: { include: { mainHand: { select: { name: true } }, armor: { select: { name: true } } } } },
        orderBy:  { turnOrder: "asc" },
      },
      messages:      { orderBy: { createdAt: "asc" }, take: ROLLING_WINDOW_SIZE },
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
  const staticCtx  = buildStaticContext(currentChar, game.partyMembers, game.story, game.currentAct, game.currentScene, mapData);
  const dynamicCtx = buildDynamicContext(
    game.worldState as Record<string, any> | null,
    gameState,
    currentChar,
    game.partyMembers,
    currentCharId,
    chipLabel,
    rolls,
    consecutiveMisses,
    gameState.lastEncounterCompleted === true,
    ((game.map as any).items ?? []) as { id: string; name: string; isEquipped: boolean; posX: number | null; posY: number | null }[],
  );
  console.log("[autoAdvance] prompt lengths — static:", staticCtx.length, "dynamic:", dynamicCtx.length);
  const responseInstr = buildResponseInstruction();

  const recentMessages = game.messages.map((m) => ({
    role:    m.role === "PLAYER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
  if (recentMessages.length === 0 || recentMessages[0].role === "assistant") {
    recentMessages.unshift({ role: "user", content: "The adventure begins." });
  }
  recentMessages.push({ role: "user", content: `Player action: ${chipLabel}` });
  // Prefill the first character of the assistant's response to guarantee JSON output.
  recentMessages.push({ role: "assistant", content: "{" });

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
    // Prepend the prefill character so the full JSON object can be parsed.
    rawText = "{" + (block?.text ?? "");
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
      narrative:      "The immediate danger passes. You take stock of your surroundings and consider your next move.",
      stateDeltas:    {},
      chips: [
        { label: "Search the area",   type: "investigation", requiresRoll: true,  advantageState: "NONE", action_type: "mainAction", movementFeet: 0,  spellLevel: 0 },
        { label: "Listen carefully",  type: "perception",    requiresRoll: true,  advantageState: "NONE", action_type: "mainAction", movementFeet: 0,  spellLevel: 0 },
        { label: "Move ahead",        type: "athletics",     requiresRoll: false, advantageState: "NONE", action_type: "movement",   movementFeet: 30, spellLevel: 0 },
      ],
      encounterResult:null,
    };
  }

  let chips = normaliseSuggestionChips(Array.isArray(parsed.chips) ? parsed.chips : []);
  if (chips.length === 0) {
    chips = [
      { id: randomUUID(), label: "Search the area",  type: "investigation", requiresRoll: true,  advantageState: "NONE", action_type: "mainAction", movementFeet: 0,  spellLevel: 0 },
      { id: randomUUID(), label: "Listen carefully", type: "perception",    requiresRoll: true,  advantageState: "NONE", action_type: "mainAction", movementFeet: 0,  spellLevel: 0 },
      { id: randomUUID(), label: "Move ahead",       type: "athletics",     requiresRoll: false, advantageState: "NONE", action_type: "movement",   movementFeet: 30, spellLevel: 0 },
    ];
  }
  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : "The immediate danger passes. You take stock of your surroundings.";

  // ── Combat effects ────────────────────────────────────────────────────────
  const rawEffects = parseCombatEffects(rawText);
  let resolvedEffects: { targetId: string; delta: number; type: string; newHp: number }[] = [];

  // ── XP / level-up ────────────────────────────────────────────────────────
  const encounterCompleted = parsed.encounterResult === "completed";
  const xpAwarded   = encounterCompleted ? (XP_BY_DIFFICULTY[game.story?.difficulty ?? "Standard"] ?? 0) : 0;
  const currentXp   = (currentChar.xp ?? 0) + xpAwarded;
  const previousLevel = currentChar.level ?? 1;
  const newLevel    = computeLevel(currentXp);
  const didLevelUp  = newLevel > previousLevel;

  // ── State delta application ───────────────────────────────────────────────
  const RULES_ENGINE_KEYS = ["hp", "maxHp", "xp", "level", "proficiencyBonus"] as const;
  const newState: Record<string, any> = { ...gameState, consecutiveMisses };
  const deltas = { ...(parsed.stateDeltas ?? {}) };
  for (const key of RULES_ENGINE_KEYS) delete deltas[key];

  // Discard playerPos if coordinates are not valid integers within map bounds.
  if (deltas.playerPos !== undefined) {
    const p = deltas.playerPos as any;
    const w = (mapData.width  as number) ?? 999;
    const h = (mapData.height as number) ?? 999;
    if (
      typeof p?.x !== "number" || !Number.isInteger(p.x) || p.x < 0 || p.x >= w ||
      typeof p?.y !== "number" || !Number.isInteger(p.y) || p.y < 0 || p.y >= h
    ) {
      delete deltas.playerPos;
    }
  }

  // Capture position before deletion so D5 transaction write has the value
  const newPlayerPos = deltas.playerPos as { x: number; y: number } | undefined;

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

  // Only trust encounterCompleted if no enemy in the updated state still has HP > 0.
  const stillHasLivingEnemies = ((newState.enemies ?? []) as any[]).some((e: any) => (e.hp ?? 0) > 0);
  if (encounterCompleted && !stillHasLivingEnemies) {
    newState.lastEncounterCompleted = true;
  } else {
    delete newState.lastEncounterCompleted;
  }

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

      await tx.message.create({ data: { gameId, role: "PLAYER", content: chipLabel, sceneId: game.currentSceneId } });
      await tx.message.create({
        data: { gameId, role: "DUNGEON_MASTER", content: narrative, chips: toLegacyChips(chips), sceneId: game.currentSceneId },
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
          state:                 newState,
          worldState,
          narrativeHistory:      { push: narrative },
          activeSuggestionChips: chips as any,
          currentTurnCharacterId:nextCharId,
          version:               { increment: 1 },
        },
      });

      // D5: write PartyMember.posX/posY for party games
      if (newPlayerPos) {
        const callerRecord = game.partyMembers.find((m) => m.characterId === currentCharId);
        if (callerRecord) {
          await tx.partyMember.update({
            where: { id: callerRecord.id },
            data:  { posX: newPlayerPos.x, posY: newPlayerPos.y },
          });
        }
      }

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
