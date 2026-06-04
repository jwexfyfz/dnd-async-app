import { describe, it, expect, vi } from "vitest";
import { createGameMap } from "./create-game-map";
import { buildChipCandidates } from "./chip-candidates";

vi.mock("./prisma", () => ({ prisma: {} }));

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeTx(
  pois: any[] = [],
  enemyRows: Array<{ id: string; maxHp: number; mainHandId?: string | null }> = [],
  itemRows:  Array<{ id: string; blocksMovement?: boolean; name?: string }> = [],
) {
  return {
    map: {
      findUnique: vi.fn().mockResolvedValue({
        id:   "map-1",
        data: { width: 5, height: 5, tiles: [[{ t: "F" }]], playerStart: { x: 0, y: 0 }, rooms: [], pois },
      }),
    },
    enemy: {
      findMany: vi.fn().mockImplementation(async ({ select }: any) => {
        if (select?.mainHandId !== undefined) return enemyRows;
        return enemyRows.map(e => ({ id: e.id, maxHp: e.maxHp }));
      }),
    },
    item: {
      findMany: vi.fn().mockResolvedValue(itemRows),
    },
    gameMap: {
      create: vi.fn().mockImplementation(async (args: any) => ({ id: "gm-1", ...args.data })),
    },
  };
}

// ─── Group 1: createGameMap — loot population ─────────────────────────────────

describe("createGameMap — enemy loot population", () => {
  it("enemy with mainHandId → lootItemIds = [mainHandId]", async () => {
    const tiles = [[{ t: "F" as const, enemy: "e-1" }]];
    const tx = makeTx([], [{ id: "e-1", maxHp: 10, mainHandId: "uuid-sword" }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.enemyState["e-1"].lootItemIds).toEqual(["uuid-sword"]);
  });

  it("enemy with null mainHandId → lootItemIds = []", async () => {
    const tiles = [[{ t: "F" as const, enemy: "e-1" }]];
    const tx = makeTx([], [{ id: "e-1", maxHp: 10, mainHandId: null }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.enemyState["e-1"].lootItemIds).toEqual([]);
  });
});

// ─── Group 2: createGameMap — container POI enrichment ────────────────────────

describe("createGameMap — container POI enrichment", () => {
  it("container POI initialised with isOpen=false, searchedBy=[], isLocked=false (no lockId)", async () => {
    const pois = [{ id: "p1", name: "Chest", x: 1, y: 1, symbol: "C", isContainer: true, containerInventory: [], lockId: null }];
    const tx = makeTx(pois);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.pois[0].isOpen).toBe(false);
    expect(result.data.pois[0].searchedBy).toEqual([]);
    expect(result.data.pois[0].isLocked).toBe(false);
  });

  it("locked container POI initialised with isLocked=true", async () => {
    const pois = [{ id: "p1", name: "Chest", x: 1, y: 1, symbol: "C", isContainer: true, containerInventory: [], lockId: "chest_lock_01" }];
    const tx = makeTx(pois);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.pois[0].isLocked).toBe(true);
  });

  it("container item names resolved from DB", async () => {
    const pois = [{
      id: "p1", name: "Chest", x: 1, y: 1, symbol: "C", isContainer: true,
      containerInventory: [{ itemId: "uuid-sword", investigationAc: 0 }],
    }];
    const tx = makeTx(pois, [], [{ id: "uuid-sword", name: "Short Sword" }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.pois[0].containerInventory![0].itemName).toBe("Short Sword");
  });
});

// ─── Group 3: createGameMap — terrain POI enrichment ─────────────────────────

describe("createGameMap — terrain POI enrichment", () => {
  it("terrain POI initialised with currentHp = maxHp, isLocked from lockId", async () => {
    const pois = [{ id: "p1", name: "Door", x: 2, y: 2, symbol: "D", maxHp: 10, lockId: "cellar_key_01" }];
    const tx = makeTx(pois);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.pois[0].currentHp).toBe(10);
    expect(result.data.pois[0].isLocked).toBe(true);
    expect(result.data.pois[0].isDestroyed).toBe(false);
  });

  it("terrain POI with no lockId → isLocked = false", async () => {
    const pois = [{ id: "p1", name: "Barrel", x: 2, y: 2, symbol: "B", maxHp: 5, lockId: null }];
    const tx = makeTx(pois);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.pois[0].isLocked).toBe(false);
  });
});

// ─── Group 4: buildChipCandidates — loot chips ───────────────────────────────

describe("buildChipCandidates — loot chips", () => {
  it("defeated adjacent enemy with lootItemIds → loot chip generated", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 1, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      defeatedEnemies:       [{ id: "e1", name: "Rat", x: 1, y: 1, lootItemIds: ["uuid-claw"] }],
    });
    expect(candidates.find(c => c.action_type === "loot" && c.lootEnemyId === "e1")).toBeDefined();
  });

  it("defeated enemy 3 tiles away → no loot chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 0, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      defeatedEnemies:       [{ id: "e1", name: "Rat", x: 3, y: 3, lootItemIds: ["uuid-claw"] }],
    });
    expect(candidates.find(c => c.action_type === "loot")).toBeUndefined();
  });

  it("defeated enemy with empty lootItemIds → no loot chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 1, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      defeatedEnemies:       [{ id: "e1", name: "Rat", x: 1, y: 1, lootItemIds: [] }],
    });
    expect(candidates.find(c => c.action_type === "loot")).toBeUndefined();
  });
});

// ─── Group 5: buildChipCandidates — container chips ──────────────────────────

describe("buildChipCandidates — container chips", () => {
  it("adjacent closed container → container_open chip generated", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois:                  [{ id: "p1", name: "Chest", x: 2, y: 1, isContainer: true, isOpen: false }],
    });
    expect(candidates.find(c => c.action_type === "container_open" && c.poiId === "p1")).toBeDefined();
  });

  it("container 2 tiles away → no container_open chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 0, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois:                  [{ id: "p1", name: "Chest", x: 2, y: 0, isContainer: true, isOpen: false }],
    });
    expect(candidates.find(c => c.action_type === "container_open")).toBeUndefined();
  });

  it("adjacent open container + searchedBy roll 16 + investigationAc 8 → container_pickup chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      currentCharId:         "char-1",
      pois: [{
        id: "p1", name: "Chest", x: 2, y: 1, isContainer: true, isOpen: true,
        searchedBy:          [{ characterId: "char-1", roll: 16 }],
        containerInventory:  [{ itemId: "uuid-potion", itemName: "Potion", investigationAc: 8 }],
      }],
    });
    expect(candidates.find(c => c.action_type === "container_pickup" && c.containerItemId === "uuid-potion")).toBeDefined();
  });

  it("roll 7 < investigationAc 8 → no pickup chip for that slot", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      currentCharId:         "char-1",
      pois: [{
        id: "p1", name: "Chest", x: 2, y: 1, isContainer: true, isOpen: true,
        searchedBy:          [{ characterId: "char-1", roll: 7 }],
        containerInventory:  [{ itemId: "uuid-potion", itemName: "Potion", investigationAc: 8 }],
      }],
    });
    expect(candidates.find(c => c.action_type === "container_pickup")).toBeUndefined();
  });

  it("no searchedBy entry → only investigationAc=0 slots visible", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 0 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      currentCharId:         "char-1",
      pois: [{
        id: "p1", name: "Chest", x: 2, y: 1, isContainer: true, isOpen: true,
        searchedBy:          [],
        containerInventory: [
          { itemId: "uuid-a", itemName: "Common Item", investigationAc: 0 },
          { itemId: "uuid-b", itemName: "Hidden Item", investigationAc: 8 },
          { itemId: "uuid-c", itemName: "Very Hidden",  investigationAc: 14 },
        ],
      }],
    });
    const pickups = candidates.filter(c => c.action_type === "container_pickup");
    expect(pickups).toHaveLength(1);
    expect(pickups[0].containerItemId).toBe("uuid-a");
  });
});

// ─── Group 6: buildChipCandidates — key use chips ────────────────────────────

describe("buildChipCandidates — key use chips", () => {
  it("adjacent locked POI + player has matching key → key_use chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 3, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois:                  [{ id: "poi-door", name: "Iron Door", x: 3, y: 3, lockId: "key_01", isLocked: true }],
      playerInventory:       [{ itemId: "uuid-key", interactionTags: [], keyId: "key_01" }],
    });
    expect(candidates.find(c => c.action_type === "key_use" && c.poiId === "poi-door" && c.toolItemId === "uuid-key")).toBeDefined();
  });

  it("locked POI but player has no matching key → no key_use chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 3, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois:                  [{ id: "poi-door", name: "Iron Door", x: 3, y: 3, lockId: "key_01", isLocked: true }],
      playerInventory:       [{ itemId: "uuid-hammer", interactionTags: ["blunt"], keyId: undefined }],
    });
    expect(candidates.find(c => c.action_type === "key_use")).toBeUndefined();
  });

  it("unlocked POI → no key_use chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 3, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois:                  [{ id: "poi-door", name: "Iron Door", x: 3, y: 3, lockId: "key_01", isLocked: false }],
      playerInventory:       [{ itemId: "uuid-key", interactionTags: [], keyId: "key_01" }],
    });
    expect(candidates.find(c => c.action_type === "key_use")).toBeUndefined();
  });
});

// ─── Group 7: buildChipCandidates — terrain chips ────────────────────────────

describe("buildChipCandidates — terrain chips", () => {
  it("adjacent POI with tool_demolition + player has matching tool → terrain_demolish chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois: [{
        id: "poi-wall", name: "Cracked Wall", x: 2, y: 3,
        eligibleInteractions: ["tool_demolition"],
        effectiveTools:       ["blunt"],
      }],
      playerInventory: [{ itemId: "uuid-hammer", interactionTags: ["blunt", "heavy_demolition"], keyId: undefined }],
    });
    expect(candidates.find(c => c.action_type === "terrain_demolish" && c.poiId === "poi-wall" && c.toolItemId === "uuid-hammer")).toBeDefined();
  });

  it("player tool tags don't intersect effectiveTools → no demolish chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois: [{
        id: "poi-wall", name: "Cracked Wall", x: 2, y: 3,
        eligibleInteractions: ["tool_demolition"],
        effectiveTools:       ["blunt"],
      }],
      playerInventory: [{ itemId: "uuid-dagger", interactionTags: ["piercing"], keyId: undefined }],
    });
    expect(candidates.find(c => c.action_type === "terrain_demolish")).toBeUndefined();
  });

  it("adjacent POI with strength_bash → terrain_bash chip", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois: [{ id: "poi-door", name: "Rotting Door", x: 2, y: 3, eligibleInteractions: ["strength_bash"] }],
    });
    expect(candidates.find(c => c.action_type === "terrain_bash" && c.poiId === "poi-door")).toBeDefined();
  });

  it("destroyed POI → no terrain chips generated", () => {
    const candidates = buildChipCandidates({
      playerPos:             { x: 2, y: 2 },
      enemies:               [],
      weaponRangeFeet:       5,
      remainingMovementFeet: 30,
      pois: [{
        id: "poi-wall", name: "Cracked Wall", x: 2, y: 3,
        eligibleInteractions: ["tool_demolition", "strength_bash"],
        effectiveTools:       ["blunt"],
        isDestroyed:          true,
      }],
      playerInventory: [{ itemId: "uuid-hammer", interactionTags: ["blunt"], keyId: undefined }],
    });
    expect(candidates.find(c => c.action_type === "terrain_demolish" || c.action_type === "terrain_bash")).toBeUndefined();
  });
});
