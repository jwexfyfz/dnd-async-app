# POI Item ID Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Mark each task `[x]` immediately when done — do not batch.
- Stop and ask after 3 consecutive failures; do not auto-fix indefinitely.
- Before final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run against them, (3) verify zero placeholder text.

---

## Goal

Store each map item's database ID directly in its corresponding POI entry at map-creation time, so the chip-building pipeline can read `poi.itemId` without scanning the tile grid at runtime.

Currently `GameMapData.pois` entries are copied verbatim from the map template and carry no item reference. The chip-building code in `auto-advance.ts` works around this by building a position→itemId lookup from the tile grid on every turn. This plan bakes that lookup into the map data at creation time and removes the runtime workaround.

---

## Design Reference

### Type change — `lib/tile-types.ts`

`GameMapData.pois` is currently typed as a plain passthrough. Add `itemId?` to the inline POI shape:

```
pois: { id: string; name: string; x: number; y: number; symbol: string; itemId?: string }[]
```

`itemId` is undefined for pure navigation POIs (stairs, doors, etc.) and set to the DB item ID for loot/equipment POIs.

### Map creation change — `lib/create-game-map.ts`

After `gameTiles` is built (line 85), construct a position→itemId map from the tile grid:

```
itemPosMap: Map<"x,y", itemId>  — built from gameTiles where tile.item is set
```

Then enrich `tmpl.pois` before assigning to `gameMapData`:

```
pois = tmpl.pois.map(p => ({
  ...p,
  itemId: itemPosMap.get(`${p.x},${p.y}`)   // undefined if no item at this position
}))
```

This replaces the direct `tmpl.pois ?? []` passthrough.

### Runtime simplification — `app/actions/auto-advance.ts`

Remove the `tileItemPosMap` tile-scan block added as a workaround (the loop over `gmTilesCand` that builds `tileItemPosMap`, and the `.map(p => ({ ...p, itemId: ... }))` call on `allPois`).

Replace with a direct cast that reads `itemId` from the stored map data:

```
const allPois = (mapData.pois ?? []) as { name: string; x: number; y: number; itemId?: string }[]
```

### Renderer type — `components/map-renderer.tsx`

`MapData.pois` is typed locally as `{ id: string; name: string; x: number; y: number; symbol: string }[]`. Add `itemId?` to match the updated stored shape. No render logic changes — `itemId` is not displayed.

---

## Progress Tracker

### Phase A — Type update
- [x] A1: In `lib/tile-types.ts`, add `itemId?: string` to the POI entry shape inside `GameMapData`. If `GameMapData.pois` is typed as `any[]` or a plain object passthrough, tighten it to the explicit shape with `itemId?`.

### Phase B — Enrich POIs at map creation
- [x] B1: In `lib/create-game-map.ts`, after the `gameTiles` array is built (after line 85), build `itemPosMap: Map<string, string>` by iterating `gameTiles` and recording `"x,y" → tile.item` for every tile where `tile.item` is set.
- [x] B2: In `lib/create-game-map.ts`, replace the `pois: tmpl.pois ?? []` line in `gameMapData` with `pois: (tmpl.pois ?? []).map(p => ({ ...p, itemId: itemPosMap.get(`${p.x},${p.y}`) }))`.

### Phase C — Remove runtime tile-scan workaround
- [x] C1: In `app/actions/auto-advance.ts`, delete the `gmItemStateForPois` variable, the `tileItemPosMap` loop, and the `.map(p => ({ ...p, itemId: ... }))` call on `allPois`. Replace with a direct cast: `const allPois = (mapData.pois ?? []) as { name: string; x: number; y: number; itemId?: string }[]`.

### Phase D — Renderer type
- [x] D1: In `components/map-renderer.tsx`, add `itemId?: string` to the `pois` entry shape inside the `MapData` interface. No other changes to this file.

### Phase E — Verification
- [ ] E1: `npm run build` — zero new TypeScript errors
- [ ] E2: `npm test` — all tests pass

---

## Edge cases to verify before marking E complete
1. **POI with no item at its position** (stairs `^`, door hints, etc.) — `itemPosMap.get(...)` returns `undefined`; POI is passed through unchanged; chip generates as a pure movement chip with no pickup.
2. **Item on a tile with no matching POI** — `itemPosMap` has the entry but no POI maps to that position; item still renders via `tileItemSet` in the renderer; no chip is generated for it (no change from current behaviour).
3. **Existing `GameMap` rows** (created before this change) — their `pois` entries have no `itemId`; item pickup chips won't fire for those maps. `itemId?: string` is optional so the app won't crash, but pickups are silently skipped. Fix: delete the old `GameMap` rows in dev and let the game re-create them on next load. No code change needed — this is a data migration concern only.
4. **Multiple items on the same tile** — not valid per current map schema (`tile.item` is a single string), so `itemPosMap` will have at most one entry per position.
5. **Item at position `(0,0)`** — `itemPosMap.get("0,0")` returns the ID correctly; no off-by-one or falsy-key issue.

---

## Files changed (expected)
- `lib/tile-types.ts` — add `itemId?` to POI shape in `GameMapData`
- `lib/create-game-map.ts` — build `itemPosMap` after tiles, enrich pois before writing `gameMapData`
- `app/actions/auto-advance.ts` — remove tile-scan workaround, direct cast
- `components/map-renderer.tsx` — add `itemId?` to `MapData.pois` interface
