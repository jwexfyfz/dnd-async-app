// ─── initialize-turn-queue — unit tests ──────────────────────────────────────
// Verifies: roll array shape for attack vs skill chips, auth/turn enforcement,
// and DB row creation with PENDING_ROLLS status.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockQueueCreate } = vi.hoisted(() => ({
  mockQueueCreate: vi.fn().mockResolvedValue({}),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../lib/prisma", () => ({
  prisma: {
    game: {
      findUnique: vi.fn().mockResolvedValue({
        id:                    "game-1",
        characterId:           "char-1",
        currentTurnCharacterId:null,
        version:               0,
        state:                 { targetAC: 14 },
        character: {
          id:                 "char-1",
          userId:             "user-1",
          name:               "Aldric",
          characterClass:     "Fighter",
          level:              3,
          skillProficiencies: ["Athletics"],
        },
        partyMembers: [],
      }),
    },
    activeTurnQueue: { create: mockQueueCreate },
  },
}));

vi.mock("../../lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));

vi.mock("../../lib/character-stats", () => ({
  computeCharacterStats: vi.fn().mockResolvedValue({
    strength:     { total: 16, base: 16, bonuses: {} },
    dexterity:    { total: 14, base: 14, bonuses: {} },
    constitution: { total: 14, base: 14, bonuses: {} },
    intelligence: { total: 10, base: 10, bonuses: {} },
    wisdom:       { total: 12, base: 12, bonuses: {} },
    charisma:     { total: 10, base: 10, bonuses: {} },
  }),
}));

import { initializeTurnQueue } from "./initialize-turn-queue";
import type { SuggestionChip } from "../../types/suggestion-chip";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ATTACK_CHIP: SuggestionChip = {
  id:             "chip-1",
  label:          "Strike the goblin",
  type:           "athletics",
  requiresRoll:   true,
  advantageState: "NONE",
  action_type:    "mainAction",
  movementFeet:   0,
  spellLevel:     0,
};

const SKILL_CHIP: SuggestionChip = {
  id:             "chip-2",
  label:          "Scan for threats",
  type:           "perception",
  requiresRoll:   true,
  advantageState: "NONE",
  action_type:    "mainAction",
  movementFeet:   0,
  spellLevel:     0,
};

const NO_ROLL_CHIP: SuggestionChip = {
  id:             "chip-3",
  label:          "Move to doorway",
  type:           "none",
  requiresRoll:   false,
  advantageState: "NONE",
  action_type:    "movement",
  movementFeet:   15,
  spellLevel:     0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("initializeTurnQueue — attack chip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds ATTACK + DAMAGE roll pair and inserts queue row", async () => {
    const result = await initializeTurnQueue("game-1", ATTACK_CHIP);

    expect(result.success).toBe(true);
    expect(result.rolls).toHaveLength(2);
    expect(result.rolls![0].type).toBe("ATTACK");
    expect(result.rolls![1].type).toBe("DAMAGE");
  });

  it("ATTACK roll carries the chip label and correct DC from game.state.targetAC", async () => {
    const result = await initializeTurnQueue("game-1", ATTACK_CHIP);
    const atkRoll = result.rolls![0];

    expect(atkRoll.label).toBe("Strike the goblin");
    expect(atkRoll.dc).toBe(14);
    expect(atkRoll.advantageState).toBe("NONE");
  });

  it("ATTACK formula includes STR modifier + proficiency for Fighter (STR 16 → +3, prof 2 → +5)", async () => {
    const result = await initializeTurnQueue("game-1", ATTACK_CHIP);
    // Fighter: STR 16 → mod +3, level 3 → profBonus +2, total +5
    expect(result.rolls![0].diceFormula).toBe("1d20+5");
  });

  it("DAMAGE roll has null dc and class-appropriate dice formula", async () => {
    const result = await initializeTurnQueue("game-1", ATTACK_CHIP);
    const dmgRoll = result.rolls![1];

    expect(dmgRoll.dc).toBeNull();
    expect(dmgRoll.diceFormula).toMatch(/1d8/); // Fighter default
  });

  it("all rolls start with null results and skipped: false", async () => {
    const { rolls } = await initializeTurnQueue("game-1", ATTACK_CHIP);
    for (const r of rolls!) {
      expect(r.naturalResult).toBeNull();
      expect(r.totalResult).toBeNull();
      expect(r.isSuccess).toBeNull();
      expect(r.skipped).toBe(false);
    }
  });

  it("inserts activeTurnQueue row with PENDING_ROLLS status and correct gameId/characterId", async () => {
    await initializeTurnQueue("game-1", ATTACK_CHIP);

    expect(mockQueueCreate).toHaveBeenCalledOnce();
    const args = mockQueueCreate.mock.calls[0][0].data;
    expect(args.gameId).toBe("game-1");
    expect(args.characterId).toBe("char-1");
    expect(args.status).toBe("PENDING_ROLLS");
    expect(args.currentRollIndex).toBe(0);
  });
});

describe("initializeTurnQueue — skill chip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds a single ABILITY_CHECK roll for a non-attack chip", async () => {
    const result = await initializeTurnQueue("game-1", SKILL_CHIP);

    expect(result.success).toBe(true);
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls![0].type).toBe("ABILITY_CHECK");
  });

  it("ABILITY_CHECK label reflects the skill name", async () => {
    const result = await initializeTurnQueue("game-1", SKILL_CHIP);
    expect(result.rolls![0].label).toContain("Perception");
  });
});

describe("initializeTurnQueue — no-roll chip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty roll array for requiresRoll: false chips", async () => {
    const result = await initializeTurnQueue("game-1", NO_ROLL_CHIP);

    expect(result.success).toBe(true);
    expect(result.rolls).toHaveLength(0);
  });
});

describe("initializeTurnQueue — auth / turn enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when user is not authenticated", async () => {
    const { createSupabaseServerClient } = await import("../../lib/supabase-server");
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any);

    const result = await initializeTurnQueue("game-1", ATTACK_CHIP);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authenticated/i);
    expect(mockQueueCreate).not.toHaveBeenCalled();
  });
});
