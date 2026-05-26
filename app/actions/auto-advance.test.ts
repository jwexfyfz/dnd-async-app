// ─── auto-advance — unit tests ────────────────────────────────────────────────
// Verifies: LLM called exactly once, all DB fields written (dedicated columns +
// dual-write to game.state), activeTurnQueue row purged, success returned.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockAnthropicCreate, COMPLETED_ROLLS } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  COMPLETED_ROLLS: [
    {
      id: "roll-1", type: "ATTACK", actorName: "Aldric", label: "Strike",
      diceFormula: "1d20+5", dc: 14, advantageState: "NONE",
      naturalResult: 18, secondaryNaturalResult: null, totalResult: 23, isSuccess: true, skipped: false,
    },
    {
      id: "roll-2", type: "DAMAGE", actorName: "Aldric", label: "Strike — Damage",
      diceFormula: "1d8+3", dc: null, advantageState: "NONE",
      naturalResult: 6, secondaryNaturalResult: null, totalResult: 9, isSuccess: null, skipped: false,
    },
  ],
}));

let capturedGameUpdate: any   = null;
let capturedQueueDelete: any  = null;

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockAnthropicCreate };
    constructor(_opts?: unknown) {}
  }
  return { default: MockAnthropic };
});

vi.mock("../../lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));

vi.mock("../../lib/prisma", () => {
  const txMessage = { create: vi.fn().mockResolvedValue({}) };
  const txChar    = {
    findMany: vi.fn().mockResolvedValue([]),
    update:   vi.fn().mockResolvedValue({}),
  };
  const txQueue   = {
    delete: vi.fn().mockImplementation((args: any) => {
      capturedQueueDelete = args;
      return Promise.resolve({});
    }),
  };
  const txGame    = {
    findUnique: vi.fn().mockResolvedValue({ version: 0 }),
    update:     vi.fn().mockImplementation((args: any) => {
      capturedGameUpdate = args;
      return Promise.resolve({});
    }),
  };
  const tx = { message: txMessage, character: txChar, activeTurnQueue: txQueue, game: txGame };

  return {
    prisma: {
      activeTurnQueue: {
        findUnique: vi.fn().mockResolvedValue({
          id:               "turn-1",
          gameId:           "game-1",
          characterId:      "char-1",
          status:           "COMPLETED",
          currentRollIndex: 2,
          rolls:            COMPLETED_ROLLS,
          expiresAt:        new Date(Date.now() + 600_000),
        }),
      },
      game: {
        findUnique: vi.fn().mockResolvedValue({
          id:                    "game-1",
          version:               0,
          characterId:           "char-1",
          currentTurnCharacterId:null,
          character: {
            id:             "char-1",
            userId:         "user-1",
            name:           "Aldric",
            characterClass: "Fighter",
            level:          3,
            xp:             0,
            maxHp:          24,
            currentHp:      24,
            baseConstitution:14,
            skillProficiencies:[],
          },
          storyPrompt: { title: "Dark Dungeon", description: "Shadows.", difficulty: "medium" },
          map:         { data: { name: "Dungeon", rooms: [], pois: [] } },
          state: {
            hp: 24, maxHp: 24,
            narrative_history:       ["Previous event."],
            active_suggestion_chips: [],
            consecutiveMisses:       0,
          },
          messages:     [],
          partyMembers: [],
        }),
      },
      $transaction: vi.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(tx)),
    },
  };
});

import { autoAdvance } from "./auto-advance";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("autoAdvance — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGameUpdate  = null;
    capturedQueueDelete = null;
    mockAnthropicCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          narrative:      "Aldric's blade bites deep.",
          stateDeltas:    {},
          chips:          [
            { label: "Press the assault", type: "athletics", requiresRoll: true, advantageState: "NONE", action_type: "mainAction", movementFeet: 0, spellLevel: 0 },
          ],
          encounterResult:null,
        }),
      }],
    });
  });

  it("calls the LLM exactly once", async () => {
    await autoAdvance("game-1", "turn-1", "Strike the goblin");
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("returns success with narrative and chips", async () => {
    const result = await autoAdvance("game-1", "turn-1", "Strike the goblin");

    expect(result.success).toBe(true);
    expect(result.narrative).toBe("Aldric's blade bites deep.");
    expect(result.chips).toHaveLength(1);
    expect(result.chips![0].label).toBe("Press the assault");
    expect(result.chips![0].id).toBeDefined(); // server-assigned UUID
  });

  it("writes narrativeHistory, activeSuggestionChips, and currentScenario to dedicated columns", async () => {
    await autoAdvance("game-1", "turn-1", "Strike the goblin");

    expect(capturedGameUpdate).not.toBeNull();
    const data = capturedGameUpdate.data;

    // Dedicated columns
    expect(data.narrativeHistory).toEqual({ push: "Aldric's blade bites deep." });
    expect(data.currentScenario).toBe("Aldric's blade bites deep.");
    expect(Array.isArray(data.activeSuggestionChips)).toBe(true);
    expect(data.activeSuggestionChips[0].label).toBe("Press the assault");
  });

  it("dual-writes narrative_history and active_suggestion_chips into game.state", async () => {
    await autoAdvance("game-1", "turn-1", "Strike the goblin");

    const state = capturedGameUpdate.data.state as Record<string, any>;
    expect(Array.isArray(state.narrative_history)).toBe(true);
    expect(state.narrative_history).toContain("Aldric's blade bites deep.");
    expect(Array.isArray(state.active_suggestion_chips)).toBe(true);
  });

  it("deletes the activeTurnQueue row", async () => {
    await autoAdvance("game-1", "turn-1", "Strike the goblin");

    expect(capturedQueueDelete).not.toBeNull();
    expect(capturedQueueDelete.where.id).toBe("turn-1");
  });

  it("increments the game version", async () => {
    await autoAdvance("game-1", "turn-1", "Strike the goblin");
    expect(capturedGameUpdate.data.version).toEqual({ increment: 1 });
  });
});

describe("autoAdvance — error cases", () => {
  beforeEach(() => { vi.clearAllMocks(); capturedGameUpdate = null; capturedQueueDelete = null; });

  it("returns error when LLM call fails, without touching DB", async () => {
    mockAnthropicCreate.mockRejectedValueOnce(new Error("overload"));

    const result = await autoAdvance("game-1", "turn-1", "Strike");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
    expect(capturedGameUpdate).toBeNull();
  });

  it("returns error when queue is not found", async () => {
    const { prisma } = await import("../../lib/prisma");
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(null);

    const result = await autoAdvance("game-1", "turn-1", "Strike");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it("returns error when queue is not yet COMPLETED", async () => {
    const { prisma } = await import("../../lib/prisma");
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce({
      id: "turn-1", gameId: "game-1", characterId: "char-1",
      status: "PENDING_ROLLS", currentRollIndex: 0, rolls: [], expiresAt: new Date(),
    } as any);

    const result = await autoAdvance("game-1", "turn-1", "Strike");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not yet resolved/i);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });
});
