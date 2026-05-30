import { describe, it, expect, vi } from "vitest";
import { createGameMap } from "./create-game-map";
import { buildChipCandidates } from "./chip-candidates";
import type { MapTile } from "./tile-types";

vi.mock("./prisma", () => ({ prisma: {} }));

function makeTx(
  tiles: MapTile[][],
  extra: Record<string, unknown> = {},
  enemyRows: Array<{ id: string; maxHp: number }> = [],
  itemRows: Array<{ id: string; blocksMovement: boolean }> = [],
) {
  return {
    map: {
      findUnique: vi.fn().mockResolvedValue({
        id: "map-1",
        data: { width: tiles[0]?.length ?? 0, height: tiles.length, tiles, playerStart: { x: 0, y: 0 }, rooms: [], pois: [], ...extra },
      }),
    },
    enemy: { findMany: vi.fn().mockResolvedValue(enemyRows) },
    item:  { findMany: vi.fn().mockResolvedValue(itemRows)  },
    gameMap: {
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: "gm-1",
        ...args.data,
      })),
    },
  };
}

// 1. Empty map — no enemies, no items
describe("createGameMap — no items, no enemies", () => {
  it("produces empty registries and tiles with only terrain", async () => {
    const tiles: MapTile[][] = [[{ t: "F" }, { t: "W" }]];
    const tx = makeTx(tiles);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.enemyState).toEqual({});
    expect(result.data.itemState).toEqual({});
    expect(result.data.tiles[0][0]).toEqual({ t: "F" });
    expect(result.data.tiles[0][1]).toEqual({ t: "W" });
  });
});

// 2. Enemy tile
describe("createGameMap — enemy tile", () => {
  it("sets actor on tile and populates enemyState", async () => {
    const tiles: MapTile[][] = [[{ t: "F", enemy: "e-1" }]];
    const tx = makeTx(tiles, {}, [{ id: "e-1", maxHp: 15 }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.tiles[0][0].actor).toEqual({ kind: "enemy", id: "e-1" });
    expect(result.data.enemyState["e-1"]).toMatchObject({
      currentHp: 15,
      maxHp:     15,
      status:    "DORMANT",
    });
  });
});

// 3. Enemy with maxHp = 0
describe("createGameMap — enemy with maxHp = 0", () => {
  it("sets currentHp = 0, status = DORMANT without crash", async () => {
    const tiles: MapTile[][] = [[{ t: "F", enemy: "e-zero" }]];
    const tx = makeTx(tiles, {}, [{ id: "e-zero", maxHp: 0 }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.enemyState["e-zero"].currentHp).toBe(0);
    expect(result.data.enemyState["e-zero"].status).toBe("DORMANT");
  });
});

// 4. Item tile
describe("createGameMap — item tile", () => {
  it("sets item on tile and populates itemState with blocksMovement", async () => {
    const tiles: MapTile[][] = [[{ t: "F", item: "item-1" }]];
    const tx = makeTx(tiles, {}, [], [{ id: "item-1", blocksMovement: true }]);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.tiles[0][0].item).toBe("item-1");
    expect(result.data.itemState["item-1"]).toMatchObject({
      isPickedUp:    false,
      isVisible:     true,
      blocksMovement: true,
    });
  });

  it("blocksMovement defaults to false for unknown itemId", async () => {
    const tiles: MapTile[][] = [[{ t: "F", item: "item-unknown" }]];
    const tx = makeTx(tiles, {}, [], []);
    const result = await createGameMap("game-1", "act-1", tx);
    expect(result.data.itemState["item-unknown"].blocksMovement).toBe(false);
  });
});

// 5. Tile with both enemy and item
describe("createGameMap — tile with both enemy and item", () => {
  it("sets both actor and item on the same tile independently", async () => {
    const tiles: MapTile[][] = [[{ t: "F", enemy: "e-1", item: "item-1" }]];
    const tx = makeTx(tiles, {}, [{ id: "e-1", maxHp: 8 }], [{ id: "item-1", blocksMovement: false }]);
    const result = await createGameMap("game-1", "act-1", tx);
    const tile = result.data.tiles[0][0];
    expect(tile.actor?.id).toBe("e-1");
    expect(tile.item).toBe("item-1");
  });
});

// 6. Two games from same template — independent GameMap records
describe("createGameMap — multiple games, same template", () => {
  it("creates independent data objects; mutating one does not affect the other", async () => {
    const tiles: MapTile[][] = [[{ t: "F" }]];
    const tx1 = makeTx(tiles);
    const tx2 = makeTx(tiles);
    const r1 = await createGameMap("game-A", "act-1", tx1);
    const r2 = await createGameMap("game-B", "act-1", tx2);

    expect(tx1.gameMap.create.mock.calls[0][0].data.gameId).toBe("game-A");
    expect(tx2.gameMap.create.mock.calls[0][0].data.gameId).toBe("game-B");

    // Mutating r1 should not affect r2
    r1.data.enemyState["injected"] = { currentHp: 1, maxHp: 1, status: "ACTIVE", isHiding: false, stealthRoll: 0, hasReaction: true, isSurprised: false, lootItemIds: [] };
    expect(r2.data.enemyState["injected"]).toBeUndefined();
  });
});

// 7. buildChipCandidates — no GameMap (currentActId = null)
describe("buildChipCandidates — no enemies", () => {
  it("returns at least the self chip without throwing", () => {
    const chips = buildChipCandidates({
      playerPos: { x: 1, y: 1 },
      enemies: [],
      weaponRangeFeet: 5,
      remainingMovementFeet: 30,
    });
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(chips.find(c => c.targetName === "self")).toBeDefined();
    expect(chips.filter(c => c.targetName !== "self" && c.action_type === "mainAction")).toHaveLength(0);
  });
});
