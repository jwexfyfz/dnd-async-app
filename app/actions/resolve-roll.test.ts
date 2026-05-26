// ─── resolve-roll — unit tests ────────────────────────────────────────────────
// Verifies: normal roll resolution, crit interceptor (doubles damage dice),
// miss skip logic, status flip to COMPLETED on final roll.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRandomInt, mockQueueUpdate } = vi.hoisted(() => ({
  mockRandomInt:  vi.fn().mockReturnValue(15),
  mockQueueUpdate:vi.fn().mockResolvedValue({}),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, randomInt: mockRandomInt };
});

vi.mock("../../lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));

// ─── Queue fixture builder ────────────────────────────────────────────────────

function makeQueue(rolls: object[], status = "PENDING_ROLLS", currentRollIndex = 0) {
  return {
    id:               "turn-1",
    gameId:           "game-1",
    characterId:      "char-1",
    status,
    currentRollIndex,
    rolls,
    expiresAt:        new Date(Date.now() + 600_000),
  };
}

const BASE_ATTACK_ROLL = {
  id: "roll-1", type: "ATTACK", actorName: "Aldric", label: "Strike",
  diceFormula: "1d20+5", dc: 14, advantageState: "NONE",
  naturalResult: null, secondaryNaturalResult: null, totalResult: null, isSuccess: null, skipped: false,
};

const BASE_DAMAGE_ROLL = {
  id: "roll-2", type: "DAMAGE", actorName: "Aldric", label: "Strike — Damage",
  diceFormula: "1d8+3", dc: null, advantageState: "NONE",
  naturalResult: null, secondaryNaturalResult: null, totalResult: null, isSuccess: null, skipped: false,
};

const BASE_ABILITY_ROLL = {
  id: "roll-3", type: "ABILITY_CHECK", actorName: "Aldric", label: "Perception Check",
  diceFormula: "1d20+3", dc: 12, advantageState: "NONE",
  naturalResult: null, secondaryNaturalResult: null, totalResult: null, isSuccess: null, skipped: false,
};

vi.mock("../../lib/prisma", () => ({
  prisma: {
    activeTurnQueue: {
      findUnique: vi.fn(),
      update:     mockQueueUpdate,
    },
  },
}));

import { resolveRoll } from "./resolve-roll";
import { doubleDice, parseModifier } from "../../lib/dice-formula";
import { prisma } from "../../lib/prisma";

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe("doubleDice", () => {
  it("doubles the dice count: 1d8+3 → 2d8+3", () => expect(doubleDice("1d8+3")).toBe("2d8+3"));
  it("doubles 2d6+5 → 4d6+5",                  () => expect(doubleDice("2d6+5")).toBe("4d6+5"));
  it("doubles 1d12 → 2d12",                     () => expect(doubleDice("1d12")).toBe("2d12"));
  it("leaves modifier intact",                   () => expect(doubleDice("1d8-1")).toBe("2d8-1"));
});

describe("parseModifier", () => {
  it("extracts positive modifier",  () => expect(parseModifier("1d20+5")).toBe(5));
  it("extracts negative modifier",  () => expect(parseModifier("1d8-1")).toBe(-1));
  it("returns 0 when no modifier",  () => expect(parseModifier("1d6")).toBe(0));
});

// ─── resolveRoll integration tests ───────────────────────────────────────────

describe("resolveRoll — normal resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRandomInt.mockReturnValue(15); // default roll: 15
  });

  it("resolves the current roll with naturalResult, totalResult, isSuccess", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ABILITY_ROLL]) as any,
    );

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.success).toBe(true);
    expect(result.roll!.naturalResult).toBe(15);
    expect(result.roll!.totalResult).toBe(18);  // 15 + 3 mod
    expect(result.roll!.isSuccess).toBe(true);   // 18 >= 12 DC
  });

  it("marks completed: true when it is the only roll", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ABILITY_ROLL]) as any,
    );

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.completed).toBe(true);
    expect(mockQueueUpdate.mock.calls[0][0].data.status).toBe("COMPLETED");
  });

  it("remains PENDING_ROLLS when more non-skipped rolls follow", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ATTACK_ROLL, BASE_DAMAGE_ROLL]) as any,
    );
    mockRandomInt.mockReturnValueOnce(18); // hit (18+5=23 >= 14)

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.completed).toBe(false);
    expect(mockQueueUpdate.mock.calls[0][0].data.status).toBe("PENDING_ROLLS");
    expect(mockQueueUpdate.mock.calls[0][0].data.currentRollIndex).toBe(1);
  });
});

describe("resolveRoll — crit interceptor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("natural 20 on ATTACK doubles the next DAMAGE roll's dice formula", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ATTACK_ROLL, BASE_DAMAGE_ROLL]) as any,
    );
    mockRandomInt.mockReturnValueOnce(20); // crit

    await resolveRoll("game-1", "turn-1");

    const updatedRolls = mockQueueUpdate.mock.calls[0][0].data.rolls;
    expect(updatedRolls[1].diceFormula).toBe("2d8+3"); // 1d8+3 → 2d8+3
  });
});

describe("resolveRoll — miss skip logic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ATTACK miss marks subsequent DAMAGE rolls as skipped and flips status to COMPLETED", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ATTACK_ROLL, BASE_DAMAGE_ROLL]) as any,
    );
    mockRandomInt.mockReturnValueOnce(5); // miss (5+5=10 < 14)

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.completed).toBe(true);
    const updatedRolls = mockQueueUpdate.mock.calls[0][0].data.rolls;
    expect(updatedRolls[1].skipped).toBe(true);
    expect(mockQueueUpdate.mock.calls[0][0].data.status).toBe("COMPLETED");
  });
});

describe("resolveRoll — error cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns error when queue not found", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(null);

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns error when queue is already COMPLETED", async () => {
    vi.mocked(prisma.activeTurnQueue.findUnique).mockResolvedValueOnce(
      makeQueue([BASE_ABILITY_ROLL], "COMPLETED") as any,
    );

    const result = await resolveRoll("game-1", "turn-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already completed/i);
  });
});
