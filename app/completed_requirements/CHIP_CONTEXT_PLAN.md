# Chip Context & Map Coordinate Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.

---

## Goal

Fix four related problems in the suggestion chip and AI DM context systems:

1. **`dbEnemies` fallback is act-scoped, not scene-scoped** — after combat ends, the fallback
   builds `dbEnemies` from all `gmEnemyState` IDs (entire act). The AI DM then sees enemies
   from other scenes it shouldn't know about yet.

2. **Map has no coordinate labels** — players and the DM refer to positions as raw `(x, y)`
   numbers with no spatial mnemonic. Add numeric coordinate labels (0, 1, 2, … for columns
   and rows) to the `MapRenderer` overlay so players can say
   "the spider at (1,1)" instead of guessing position from the tile grid.

3. **Chip labels don't include target coordinates** — when two enemies share a name
   (e.g., "Cave Spider" × 2) or two items share a name, the player cannot tell which chip
   targets which. All chips whose `actionTarget` is an enemy or item must append the
   coordinate to the label, e.g. `"Attack the Cave Spider (1,1)"`.

4. **`candidatesToChips` label for Door chips** — the current label is `"Move to Door"`,
   which should include the door's coordinate: `"Move to Door (4,2)"`.

---

## Design Reference

### Coordinate format

Use raw numeric tile coordinates matching `GameMap.data` exactly — `(x,y)` where x and y
are the integer indices into `GameMap.data.tiles[y][x]`.

```
tileCoordLabel(x: number, y: number): string  →  `(${x},${y})`
```

No utility function needed — inline the template literal directly at each callsite.

### MapRenderer coordinate overlay

`components/map-renderer.tsx` renders an SVG or canvas tile grid. Add:
- **Column labels** (0, 1, 2, …) above the first visible row, one per tile column, centered in the tile cell.
- **Row labels** (0, 1, 2, …) to the left of the first visible column, one per tile row, centered in the tile cell.
- Labels are the raw x (column) and y (row) integer values — identical to coordinates in `GameMap.data`.
- Labels use `text-[10px]` / small font, muted color (`text-slate-400`), so they don't compete with tile content.
- Only render labels for tiles within the current viewport (already clamped by `VP_RADIUS`).

### Chip label changes in `lib/chip-candidates.ts` → `candidatesToChips`

Current labels and proposed changes:

| Case | Current label | New label |
|------|--------------|-----------|
| Direct attack (no movement) | `Attack the ${name}` / `Shoot the ${name}` | `Attack the ${name} (x,y)` |
| Advance (requires movement) | `Advance on the ${name}` | `Advance on the ${name} (x,y)` |
| Move to POI | `Move to ${name}` | `Move to ${name} (x,y)` |
| Self / Search | `Search the area` | unchanged |

`candidatesToChips` already has `cand.actionTarget: Pos`. Use
`` `(${cand.actionTarget.x},${cand.actionTarget.y})` `` for the coordinate suffix — no helper needed.

### `dbEnemies` fallback scope fix in `app/actions/auto-advance.ts`

Current fallback (lines 436–455) queries all `gmEnemyState` keys → `prisma.enemy.findMany`.
Replace with: only include enemies whose `sceneId` matches `game.currentScene?.id`.

```
// Before (act-wide):
const fallbackIds = Object.keys(gmesFallback);
const fallbackTemplates = await prisma.enemy.findMany({ where: { id: { in: fallbackIds } } });

// After (scene-scoped):
const fallbackIds = game.currentScene
  ? Object.keys(gmesFallback).filter(id => {
      // keep only IDs that belong to the current scene
    })
  : Object.keys(gmesFallback);
// Scope by querying with sceneId constraint:
const fallbackTemplates = await prisma.enemy.findMany({
  where: {
    id: { in: fallbackIds },
    ...(game.currentScene ? { sceneId: game.currentScene.id } : {}),
  },
  select: { id: true, name: true, maxHp: true },
});
```

This ensures dead scene 1 enemies (whose `gmEnemyState` entries persist) are never fed to
the AI DM when the player has moved to scene 2.

---

## Progress Tracker

### Phase A — MapRenderer coordinate overlay
- [x] A1: In `components/map-renderer.tsx`, render column labels (0, 1, 2, …) above the tile grid.
          One label per visible column, centered in tile width, `text-slate-400 text-[10px]`.
- [x] A2: Render row labels (0, 1, 2, …) to the left of the tile grid.
          One label per visible row, centered in tile height, `text-slate-400 text-[10px]`.
- [x] A3: Verify labels stay aligned with their tile column/row across the full viewport.

### Phase B — Chip label coordinates in `candidatesToChips`
- [x] B1: In `lib/chip-candidates.ts` → `candidatesToChips`, append `` `(${cand.actionTarget.x},${cand.actionTarget.y})` ``
          to all chip labels where `cand.targetName !== "self"`:
          - Direct attack: `"Attack the Cave Spider (1,2)"`
          - Ranged attack: `"Shoot the Archer (5,4)"`
          - Advance: `"Advance on the Miner (5,3)"`
          - Move to POI/Door: `"Move to Silver Vein (6,3)"`, `"Move to Door (4,2)"`
          No import needed — inline template literal only.

### Phase D — `dbEnemies` fallback scope fix
- [x] D1: In `app/actions/auto-advance.ts`, update the no-combat fallback (lines ~436–455) to add
          `sceneId: game.currentScene.id` to the `prisma.enemy.findMany` `where` clause when
          `game.currentScene` is non-null.
- [x] D2: Add a `console.log` noting how many enemies the scoped fallback returned vs the previous total.

### Phase E — Verification
- [x] E1: `npm run build` — zero new TypeScript errors (pre-existing errors are acceptable).
- [x] E2: `npm test` — all tests pass (1 pre-existing failure in initialize-turn-queue unrelated to these changes).
- [ ] E3: Manual check — start a new turn in scene 2 after clearing scene 1 combat; confirm
          `[autoAdvance] dbEnemies fallback` log shows only scene 2 enemy IDs.
- [ ] E4: Manual check — chip labels show coords, e.g. `"Attack the Cave Spider (1,2)"`.
- [ ] E5: Manual check — MapRenderer shows numeric column/row labels aligned to tiles.

---

## Edge cases to verify before marking E complete
1. Player at x=0, y=0 — column label "0", row label "0" — boundary correct.
2. Two enemies named "Cave Spider" at different coords — chips show distinct labels
   `"Attack the Cave Spider (1,2)"` and `"Advance on the Cave Spider (2,2)"`.
3. `cand.targetName === "self"` (Search the area chip) — no coord appended, label unchanged.
4. No `currentScene` on game (pre-scene game) — fallback query omits `sceneId` filter gracefully,
   behavior identical to current.
5. Door chip — `actionTarget` is the door tile position; label reads `"Move to Door (4,2)"`.
6. Viewport edge — column/row labels render only for tiles within the clamped viewport window,
   no labels for tiles outside `VP_RADIUS`.

---

## Files changed (expected)
- `lib/chip-candidates.ts` — append `(x,y)` in `candidatesToChips`
- `components/map-renderer.tsx` — numeric column/row label overlay
- `app/actions/auto-advance.ts` — scope `dbEnemies` fallback to current scene
