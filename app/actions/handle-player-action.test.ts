// ─── handle-player-action — unit tests ───────────────────────────────────────
// Covers three requirements:
//   1. The LLM is invoked exactly once per call to handlePlayerAction.
//   2. Both game.state.narrative_history and game.state.active_suggestion_chips
//      are written to the database inside a single transaction.
//   3. A successful result is returned ({ success: true }).
//
// Pure helper functions (generateDeterministicChips, buildNarrativeMessages)
// are tested separately without any mocks.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factory functions, allowing shared
// references between the factory and the test body.

const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockAnthropicCreate };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts?: unknown) {}
  }
  return { default: MockAnthropic };
});

// Captured args from tx.game.update so tests can assert the written state.
let capturedGameUpdateArgs: any = null;

vi.mock("../../lib/prisma", () => {
  const txMessage = { create: vi.fn().mockResolvedValue({}) };
  const txGame = {
    findUnique: vi.fn().mockResolvedValue({ version: 0 }),
    update: vi.fn().mockImplementation((args: any) => {
      capturedGameUpdateArgs = args;
      return Promise.resolve({});
    }),
  };
  const tx = { game: txGame, message: txMessage };

  return {
    prisma: {
      game: {
        findUnique: vi.fn().mockResolvedValue({
          id:                    "game-1",
          version:               0,
          characterId:           "char-1",
          currentTurnCharacterId: null,
          character: {
            id:             "char-1",
            userId:         "user-1",
            name:           "Aldric",
            characterClass: "Fighter",
            baseStrength:     16,
            baseDexterity:    14,
            baseConstitution: 14,
            baseIntelligence: 10,
            baseWisdom:       12,
            baseCharisma:     10,
            level:    1,
            xp:       0,
            maxHp:    12,
            currentHp:12,
            skillProficiencies: [],
          },
          storyPrompt: {
            title:       "The Dark Dungeon",
            description: "Shadows cling to every stone.",
          },
          map: {
            data: { name: "Dungeon", rooms: [], pois: [] },
          },
          state: {
            hp: 12, maxHp: 12,
            narrative_history:       [],
            active_suggestion_chips: [],
          },
          messages:     [],
          partyMembers: [],
        }),
      },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(tx)),
    },
  };
});

vi.mock("../../lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
      }),
    },
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

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  handlePlayerAction,
  generateDeterministicChips,
  buildNarrativeMessages,
} from "./handle-player-action";

// ─── Integration tests ────────────────────────────────────────────────────────

describe("handlePlayerAction — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGameUpdateArgs = null;
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Aldric's blade finds a gap in the armor." }],
    });
  });

  it("invokes the LLM exactly once, writes both DB fields, and returns success", async () => {
    const result = await handlePlayerAction("game-1", "Strike the goblin", 15);

    // ── Requirement 1: LLM called exactly once ────────────────────────────
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);

    // ── Requirement 2: Both fields written to the database ────────────────
    expect(capturedGameUpdateArgs).not.toBeNull();

    const writtenState = capturedGameUpdateArgs.data.state as Record<string, any>;

    // narrative_history must contain the Claude-generated narrative.
    expect(Array.isArray(writtenState.narrative_history)).toBe(true);
    expect(writtenState.narrative_history).toContain(
      "Aldric's blade finds a gap in the armor."
    );

    // active_suggestion_chips must be a non-empty array of chip objects.
    expect(Array.isArray(writtenState.active_suggestion_chips)).toBe(true);
    expect(writtenState.active_suggestion_chips.length).toBeGreaterThan(0);
    const firstChip = writtenState.active_suggestion_chips[0];
    expect(firstChip).toHaveProperty("text");
    expect(firstChip).toHaveProperty("type");

    // ── Requirement 3: Successful response ───────────────────────────────
    expect(result.success).toBe(true);
    expect(result.narrative).toBe("Aldric's blade finds a gap in the armor.");
    expect(result.chips).toBeDefined();
    expect(result.chips!.length).toBeGreaterThan(0);
  });

  it("returns an error without touching the DB when the LLM call fails", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error("API overload"));

    const result = await handlePlayerAction("game-1", "Look around", 8);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/temporarily unavailable/i);
    // No transaction should have run.
    expect(capturedGameUpdateArgs).toBeNull();
  });

  it("returns an error when the user is not authenticated", async () => {
    const { createSupabaseServerClient } = await import("../../lib/supabase-server");
    vi.mocked(createSupabaseServerClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any);

    const result = await handlePlayerAction("game-1", "Strike", 10);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authenticated/i);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });
});

// ─── generateDeterministicChips — pure-function tests ────────────────────────

describe("generateDeterministicChips", () => {
  it("returns fumble recovery chips on a roll of 1", () => {
    const chips = generateDeterministicChips("Fighter", 1, false);
    expect(chips.length).toBeGreaterThan(0);
    const texts = chips.map((c) => c.text.toLowerCase());
    expect(texts.some((t) => t.includes("footing") || t.includes("guard") || t.includes("damage"))).toBe(true);
  });

  it("returns critical-hit chips on a roll of 20", () => {
    const chips = generateDeterministicChips("Fighter", 20, true);
    expect(chips.length).toBeGreaterThan(0);
    const texts = chips.map((c) => c.text.toLowerCase());
    expect(texts.some((t) => t.includes("advantage") || t.includes("prize") || t.includes("rally"))).toBe(true);
  });

  it("is deterministic — same inputs always produce the same output", () => {
    const a = generateDeterministicChips("Rogue", 14, true);
    const b = generateDeterministicChips("Rogue", 14, true);
    expect(a).toEqual(b);
  });

  it("returns failure chips when the roll fails", () => {
    const success = generateDeterministicChips("Fighter", 10, true);
    const failure = generateDeterministicChips("Fighter", 10, false);
    expect(success).not.toEqual(failure);
  });

  it("returns valid chips for all supported classes", () => {
    const classes = [
      "Fighter","Rogue","Wizard","Cleric","Barbarian",
      "Paladin","Ranger","Bard","Druid","Monk","Sorcerer","Warlock",
    ];
    for (const cls of classes) {
      const chips = generateDeterministicChips(cls, 12, true);
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(typeof chip.text).toBe("string");
        expect(chip.text.length).toBeGreaterThan(0);
        expect(typeof chip.type).toBe("string");
      }
    }
  });

  it("falls back to default chips for an unknown class", () => {
    const chips = generateDeterministicChips("Artificer", 12, true);
    expect(chips.length).toBeGreaterThan(0);
  });
});

// ─── buildNarrativeMessages — pure-function tests ─────────────────────────────

describe("buildNarrativeMessages", () => {
  it("produces a single user message containing action, roll result, and outcome", () => {
    const messages = buildNarrativeMessages(
      "The Dark Dungeon",
      "Shadows cling to every stone.",
      "Aldric",
      "Fighter",
      [],
      "Strike the goblin",
      15,
      12,
      1,
      true,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const content = messages[0].content;
    expect(content).toContain("Strike the goblin");
    expect(content).toContain("SUCCESS");
    expect(content).toContain("Aldric");
  });

  it("labels roll 20 as CRITICAL SUCCESS", () => {
    const [msg] = buildNarrativeMessages("S","D","Hero","Fighter",[],  "Act", 20, 12, 1, true);
    expect(msg.content).toContain("CRITICAL SUCCESS");
  });

  it("labels roll 1 as FUMBLE", () => {
    const [msg] = buildNarrativeMessages("S","D","Hero","Fighter",[], "Act", 1, 12, 0, false);
    expect(msg.content).toContain("FUMBLE");
  });

  it("includes recent narrative history when provided", () => {
    const history = ["First event happened.", "Second event unfolded."];
    const [msg] = buildNarrativeMessages("S","D","Hero","Fighter", history, "Act", 10, 12, 0, true);
    expect(msg.content).toContain("First event happened.");
    expect(msg.content).toContain("Second event unfolded.");
  });
});
