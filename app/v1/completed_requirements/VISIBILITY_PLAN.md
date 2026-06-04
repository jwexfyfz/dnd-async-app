# Visibility System Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.

---

## Goal

Create a single-source-of-truth visibility module that:
1. Centralises `VP_RADIUS` so renderer and server share the same constant.
2. Provides a `LightContext` stub interface ready for a future light source system — currently unused but architecturally present.
3. Logs an ASCII grid to the console (dev-only) showing exactly what each player and each NPC can see each turn, so visibility can be verified without running the UI.

No behaviour changes — purely additive logging + constant centralisation.

---

## Design Reference

### `lib/visibility.ts` exports

```
VP_RADIUS = 10                                  // shared with renderer

LightContext = {}                                // stub — future: { sources: LightSource[] }

getActorVisibleTiles(
  tiles:     GameTile[][],
  x:         number,
  y:         number,
  _lightCtx: LightContext = {},                 // ignored for now
) → Set<string>                                 // delegates to getVisibleTiles(tiles, x, y, VP_RADIUS)

debugLogVisibilityGrid(
  tiles:      GameTile[][],
  visibleSet: Set<string>,
  viewerX:    number,
  viewerY:    number,
  label:      string,
  markers?:   { x: number; y: number; char: string }[],
) → void                                        // no-op outside development
```

### Grid character key
| Char | Meaning |
|------|---------|
| `@`  | viewer position |
| `·`  | visible floor |
| `#`  | visible wall |
| `+`  | visible door |
| `░`  | fog (outside LoS) |
| `E`  | enemy marker |
| `P`  | party member marker |
| `?`  | missing tile |

Grid is clamped to viewer ± VP_RADIUS (same as renderer viewport).
Guard: `if (process.env.NODE_ENV !== "development") return;`

### Logging callsites

**`take-turn.ts`** — after line 461 where `rawGameTiles` / `tiles` is built:
- Compute `getActorVisibleTiles(gameTiles, playerX, playerY)` where `gameTiles` is typed `GameTile[][]`
- Build `enemyMarkers` from `gameState.enemies` (filter hp > 0)
- Call `debugLogVisibilityGrid` with label `Player <name>`

**`process-npc-turns.ts`** — inside the `npcBatch` loop, after each enemy's position is confirmed from `tileActorPos`:
- Compute `getActorVisibleTiles(gmTilesNpc as GameTile[][], enemy.posX, enemy.posY)`
- Build `partyMarkers` from `characters` array (use `partyMember.posX/Y` if available, else skip)
- Call `debugLogVisibilityGrid` with label `NPC <enemy.name>`

---

## Progress Tracker

### Phase A — `lib/visibility.ts`
- [x] A1: Create `lib/visibility.ts` — export `VP_RADIUS = 10`, `LightContext` stub interface with JSDoc comment explaining future extension point, `getActorVisibleTiles`, `debugLogVisibilityGrid`

### Phase B — Centralise VP_RADIUS in renderer
- [x] B1: Update `components/map-renderer.tsx` — remove `const VP = 10`, import `VP_RADIUS` from `../lib/visibility`, replace all `VP` references with `VP_RADIUS`

### Phase C — Player visibility logging in `take-turn.ts`
- [x] C1: After line 461 (`rawGameTiles` read), import `getActorVisibleTiles` and `debugLogVisibilityGrid` from `../../lib/visibility`. Cast `rawGameTiles` to `GameTile[][]`. Read `playerX`/`playerY` from `actorCurrentPos`. Build enemy markers from `gameState.enemies` filtered to `hp > 0`. Call `debugLogVisibilityGrid`.

### Phase D — NPC visibility logging in `process-npc-turns.ts`
- [x] D1: After building `npcBatch` (the loop at line 155), add a second loop over `npcBatch`. For each entry, read `enemy.posX`/`enemy.posY` from the already-built position map. Compute `getActorVisibleTiles`. Build party markers from `characters` array using `game.state.partyPositions` if available, else `game.state.playerPos`. Call `debugLogVisibilityGrid` with label `NPC <enemy.name>`.

### Phase E — Verification
- [x] E1: `npm run build` — zero TypeScript errors
- [x] E2: `npm test` — 311/311 tests pass

---

## Edge cases to verify before marking E complete
1. Player at map edge — grid clamps correctly, no out-of-bounds crash
2. No active GameMap (pre-combat, `gmData.tiles` is `[]`) — `debugLogVisibilityGrid` receives empty array, returns without logging
3. Enemy at (0,0) default when `tileActorPos` has no entry — skip logging for that NPC rather than log misleading grid
4. `process.env.NODE_ENV === "production"` — `debugLogVisibilityGrid` is a no-op, zero console output
5. NPC with no `characters` in party (solo game) — `partyMarkers` falls back to `[{ x: playerX, y: playerY, char: "P" }]` from `game.state.playerPos`

---

## Files changed (expected)
- `lib/visibility.ts` — new
- `components/map-renderer.tsx` — VP constant → import
- `app/actions/take-turn.ts` — visibility log after tiles read
- `app/actions/process-npc-turns.ts` — visibility log per NPC in batch
