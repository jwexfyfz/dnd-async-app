import { describe, it, expect } from "vitest";
import {
  findActor, findItem, isTilePassable,
  moveActor, placeItem, removeItem, getVisibleTiles,
} from "./game-map-utils";
import type { GameTile, EnemyInstance, ItemInstance } from "./tile-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function floor(overrides?: Partial<GameTile>): GameTile {
  return { t: "F", ...overrides };
}
function wall(): GameTile { return { t: "W" }; }
function door(): GameTile { return { t: "D" }; }

function mkEnemy(status: EnemyInstance["status"] = "ACTIVE"): EnemyInstance {
  return { currentHp: 10, maxHp: 10, status, isHiding: false, stealthRoll: 0, hasReaction: true, isSurprised: false, lootItemIds: [] };
}
function mkItem(blocksMovement = false, isPickedUp = false): ItemInstance {
  return { isPickedUp, isVisible: true, activeFromSceneOrder: null, droppedByEnemyId: null, blocksMovement };
}

// 3×3 open grid
function openGrid(): GameTile[][] {
  return [
    [floor(), floor(), floor()],
    [floor(), floor(), floor()],
    [floor(), floor(), floor()],
  ];
}

// ─── findActor ────────────────────────────────────────────────────────────────

describe("findActor", () => {
  it("returns null when tiles are empty", () => {
    expect(findActor(openGrid(), "e-1")).toBeNull();
  });

  it("returns correct coords when actor present", () => {
    const tiles = openGrid();
    tiles[1][2] = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(findActor(tiles, "e-1")).toEqual({ x: 2, y: 1 });
  });

  it("returns null for a different id", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(findActor(tiles, "e-2")).toBeNull();
  });

  it("handles empty tile grid", () => {
    expect(findActor([], "e-1")).toBeNull();
  });
});

// ─── findItem ─────────────────────────────────────────────────────────────────

describe("findItem", () => {
  it("returns null when no item present", () => {
    expect(findItem(openGrid(), "item-1")).toBeNull();
  });

  it("returns correct coords when item present", () => {
    const tiles = openGrid();
    tiles[2][1] = floor({ item: "item-1" });
    expect(findItem(tiles, "item-1")).toEqual({ x: 1, y: 2 });
  });

  it("returns null for a different itemId", () => {
    const tiles = openGrid();
    tiles[0][2] = floor({ item: "item-1" });
    expect(findItem(tiles, "item-2")).toBeNull();
  });
});

// ─── isTilePassable ───────────────────────────────────────────────────────────

describe("isTilePassable", () => {
  const noEnemies: Record<string, EnemyInstance> = {};
  const noItems:   Record<string, ItemInstance>  = {};

  it("wall → false", () => {
    expect(isTilePassable(wall(), noEnemies, noItems, "p-1")).toBe(false);
  });

  it("closed door → false", () => {
    expect(isTilePassable(door(), noEnemies, noItems, "p-1")).toBe(false);
  });

  it("empty floor → true", () => {
    expect(isTilePassable(floor(), noEnemies, noItems, "p-1")).toBe(true);
  });

  it("ACTIVE enemy → false", () => {
    const tile = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(isTilePassable(tile, { "e-1": mkEnemy("ACTIVE") }, noItems, "p-1")).toBe(false);
  });

  it("DORMANT enemy → false", () => {
    const tile = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(isTilePassable(tile, { "e-1": mkEnemy("DORMANT") }, noItems, "p-1")).toBe(false);
  });

  it("DEFEATED enemy → true (passable corpse)", () => {
    const tile = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(isTilePassable(tile, { "e-1": mkEnemy("DEFEATED") }, noItems, "p-1")).toBe(true);
  });

  it("FLED enemy → true", () => {
    const tile = floor({ actor: { kind: "enemy", id: "e-1" } });
    expect(isTilePassable(tile, { "e-1": mkEnemy("FLED") }, noItems, "p-1")).toBe(true);
  });

  it("enemy with no matching state entry → false (unknown = blocking)", () => {
    const tile = floor({ actor: { kind: "enemy", id: "e-missing" } });
    expect(isTilePassable(tile, noEnemies, noItems, "p-1")).toBe(false);
  });

  it("party actor → false", () => {
    const tile = floor({ actor: { kind: "party", id: "char-2" } });
    expect(isTilePassable(tile, noEnemies, noItems, "p-1")).toBe(false);
  });

  it("mover's own tile (actor.id === moverId) → true", () => {
    const tile = floor({ actor: { kind: "party", id: "p-1" } });
    expect(isTilePassable(tile, noEnemies, noItems, "p-1")).toBe(true);
  });

  it("blocking item not picked up → false", () => {
    const tile = floor({ item: "crate-1" });
    expect(isTilePassable(tile, noEnemies, { "crate-1": mkItem(true, false) }, "p-1")).toBe(false);
  });

  it("blocking item already picked up → true", () => {
    const tile = floor({ item: "crate-1" });
    expect(isTilePassable(tile, noEnemies, { "crate-1": mkItem(true, true) }, "p-1")).toBe(true);
  });

  it("passable item on floor → true", () => {
    const tile = floor({ item: "dagger-1" });
    expect(isTilePassable(tile, noEnemies, { "dagger-1": mkItem(false, false) }, "p-1")).toBe(true);
  });
});

// ─── moveActor ────────────────────────────────────────────────────────────────

describe("moveActor", () => {
  it("moves actor from origin to dest", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ actor: { kind: "party", id: "p-1" } });
    const next = moveActor(tiles, 0, 0, 2, 1);
    expect(next[0][0].actor).toBeUndefined();
    expect(next[1][2].actor).toEqual({ kind: "party", id: "p-1" });
  });

  it("origin tile is clean after move", () => {
    const tiles = openGrid();
    tiles[1][1] = floor({ actor: { kind: "enemy", id: "e-1" } });
    const next = moveActor(tiles, 1, 1, 2, 2);
    expect(next[1][1].actor).toBeUndefined();
    expect(Object.keys(next[1][1])).not.toContain("actor");
  });

  it("does not mutate original tiles", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ actor: { kind: "party", id: "p-1" } });
    const copy = tiles.map(r => [...r]);
    moveActor(tiles, 0, 0, 1, 1);
    expect(tiles[0][0].actor?.id).toBe("p-1");
    expect(tiles[1][1].actor).toBeUndefined();
  });

  it("returns tiles unchanged when dest is occupied by a different actor", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ actor: { kind: "party", id: "p-1" } });
    tiles[1][1] = floor({ actor: { kind: "enemy", id: "e-1" } });
    const next = moveActor(tiles, 0, 0, 1, 1);
    expect(next[0][0].actor?.id).toBe("p-1");
    expect(next[1][1].actor?.id).toBe("e-1");
  });

  it("returns tiles unchanged when origin has no actor", () => {
    const tiles = openGrid();
    const next = moveActor(tiles, 0, 0, 1, 1);
    expect(next[1][1].actor).toBeUndefined();
  });

  it("returns tiles unchanged when dest coords are out of bounds", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ actor: { kind: "party", id: "p-1" } });
    const next = moveActor(tiles, 0, 0, 99, 99);
    expect(next[0][0].actor?.id).toBe("p-1");
  });
});

// ─── placeItem / removeItem ────────────────────────────────────────────────────

describe("placeItem", () => {
  it("sets item on correct tile", () => {
    const next = placeItem(openGrid(), "sword-1", 1, 2);
    expect(next[2][1].item).toBe("sword-1");
  });

  it("does not mutate original", () => {
    const tiles = openGrid();
    placeItem(tiles, "sword-1", 0, 0);
    expect(tiles[0][0].item).toBeUndefined();
  });
});

describe("removeItem", () => {
  it("clears item from tile", () => {
    const tiles = openGrid();
    tiles[1][1] = floor({ item: "dagger-1" });
    const next = removeItem(tiles, 1, 1);
    expect(next[1][1].item).toBeUndefined();
    expect(Object.keys(next[1][1])).not.toContain("item");
  });

  it("leaves other tiles unchanged", () => {
    const tiles = openGrid();
    tiles[0][0] = floor({ item: "potion-1" });
    tiles[2][2] = floor({ item: "sword-1" });
    const next = removeItem(tiles, 0, 0);
    expect(next[2][2].item).toBe("sword-1");
  });
});

// ─── getVisibleTiles ─────────────────────────────────────────────────────────

describe("getVisibleTiles", () => {
  // 5×5 open grid
  const open5: GameTile[][] = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => floor()),
  );

  it("origin tile is always visible", () => {
    expect(getVisibleTiles(open5, 2, 2, 3).has("2,2")).toBe(true);
  });

  it("adjacent tiles are visible", () => {
    const vis = getVisibleTiles(open5, 2, 2, 3);
    expect(vis.has("1,2")).toBe(true);
    expect(vis.has("3,2")).toBe(true);
    expect(vis.has("2,1")).toBe(true);
    expect(vis.has("2,3")).toBe(true);
  });

  it("tiles beyond radius are not visible", () => {
    // radius 1 from center of 5×5 — corners at distance sqrt(2) ≈ 1.41 are outside radius 1
    const vis = getVisibleTiles(open5, 2, 2, 1);
    expect(vis.has("0,0")).toBe(false);
    expect(vis.has("4,4")).toBe(false);
  });

  it("tiles behind a wall are not visible", () => {
    // Place a wall column at x=2, blocking sight to x≥3
    const walled: GameTile[][] = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => (x === 2 && y !== 0 ? wall() : floor())),
    );
    const vis = getVisibleTiles(walled, 0, 2, 4);
    expect(vis.has("4,2")).toBe(false);
  });

  it("tiles behind a closed door are not visible", () => {
    const withDoor: GameTile[][] = open5.map((row, y) =>
      row.map((tile, x) => (x === 2 && y === 2 ? door() : tile)),
    );
    const vis = getVisibleTiles(withDoor, 0, 2, 4);
    // The door tile itself at x=2 is not transparent, so x=3,4 behind it are hidden
    expect(vis.has("3,2")).toBe(false);
    expect(vis.has("4,2")).toBe(false);
  });

  it("tiles through open floor are visible up to radius", () => {
    // (0,0) → (4,4): distance ≈ 5.66, need radius ≥ 6
    const vis = getVisibleTiles(open5, 0, 0, 6);
    expect(vis.has("4,4")).toBe(true);
  });

  it("player at map edge — no out-of-bounds crash", () => {
    expect(() => getVisibleTiles(open5, 0, 0, 10)).not.toThrow();
    expect(() => getVisibleTiles(open5, 4, 4, 10)).not.toThrow();
  });

  it("empty tile grid → only origin might be returned without crash", () => {
    expect(() => getVisibleTiles([], 0, 0, 5)).not.toThrow();
  });
});
