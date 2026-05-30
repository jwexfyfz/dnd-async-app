"use client";

import { useMemo } from "react";
import type { GameTile } from "../lib/tile-types";
import { getVisibleTiles } from "../lib/game-map-utils";
import { VP_RADIUS } from "../lib/visibility";

export interface MapData {
  width:  number;
  height: number;
  tiles:  GameTile[][];
  playerStart: { x: number; y: number };
  rooms:  { name: string; description: string }[];
  pois:   { id: string; name: string; x: number; y: number; symbol: string }[];
  // Optional new-format fields — present on GameMapData, absent on template MapData
  itemState?: Record<string, { isPickedUp: boolean; isVisible: boolean }>;
}

export interface PartyMarker {
  characterId:   string;
  pos:           { x: number; y: number };
  emoji:         string;
  isCurrentTurn: boolean;
}

export interface EnemyMarker {
  id:    string;
  name:  string;
  pos:   { x: number; y: number };
  hp:    number;
  maxHp: number;
}

export interface ItemMarker {
  id:   string;
  name: string;
  pos:  { x: number; y: number };
}

interface Props {
  mapData:       MapData;
  playerPos:     { x: number; y: number };
  partyMarkers?: PartyMarker[];
  enemyMarkers?: EnemyMarker[];
  itemMarkers?:  ItemMarker[];
}

// Viewport half-radius — shared with lib/visibility.ts; do not redefine here.
const VP = VP_RADIUS;

const TILE_RENDER: Record<string, { char: string; cls: string }> = {
  W:   { char: "#", cls: "text-slate-400" },
  F:   { char: "·", cls: "text-slate-300" },
  D:   { char: "+", cls: "text-amber-500" },
  "?": { char: "░", cls: "text-slate-600" },
};

export default function MapRenderer({ mapData, playerPos, partyMarkers, enemyMarkers, itemMarkers }: Props) {
  const { tiles, width, height, pois, itemState } = mapData;
  const useParty   = partyMarkers && partyMarkers.length > 0;
  const hasEnemies = enemyMarkers && enemyMarkers.length > 0;
  const hasItems   = itemMarkers  && itemMarkers.length  > 0;

  // Viewport bounds — clamped to map edges.
  const vpMinX = Math.max(0, playerPos.x - VP);
  const vpMaxX = Math.min(width  - 1, playerPos.x + VP);
  const vpMinY = Math.max(0, playerPos.y - VP);
  const vpMaxY = Math.min(height - 1, playerPos.y + VP);
  const vpWidth  = vpMaxX - vpMinX + 1;

  // LoS set — tiles not in this set render as fog.
  const visibleSet = useMemo(
    () => tiles.length > 0 ? getVisibleTiles(tiles, playerPos.x, playerPos.y, VP) : new Set<string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiles, playerPos.x, playerPos.y],
  );

  // Items on tiles (from itemState, if available) — used as a supplemental overlay
  // for items not yet in itemMarkers (e.g. newly placed items between fetches).
  const tileItemSet = useMemo(() => {
    const s = new Set<string>(); // "x,y"
    if (!itemState) return s;
    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        const id = tiles[y][x].item;
        if (!id) continue;
        const st = itemState[id];
        if (st && !st.isPickedUp && st.isVisible) s.add(`${x},${y}`);
      }
    }
    return s;
  }, [tiles, itemState]);

  const cells: React.ReactNode[] = [];

  for (let y = vpMinY; y <= vpMaxY; y++) {
    for (let x = vpMinX; x <= vpMaxX; x++) {
      const key     = `${x},${y}`;
      const tile    = tiles[y]?.[x];
      const visible = visibleSet.has(key);

      if (!tile) {
        cells.push(<div key={key} className="text-center text-slate-700">#</div>);
        continue;
      }

      // Hidden (outside LoS) — fog of war.
      if (!visible) {
        cells.push(<div key={key} className="text-center text-slate-700">░</div>);
        continue;
      }

      // Priority 1: party markers / solo player.
      if (useParty) {
        const m = partyMarkers!.find((m) => m.pos.x === x && m.pos.y === y);
        if (m) {
          cells.push(
            <div key={key} className="text-center" title={`Character at (${x},${y})`}>
              {m.emoji}
            </div>,
          );
          continue;
        }
      } else if (x === playerPos.x && y === playerPos.y) {
        cells.push(<div key={key} className="text-center font-bold text-amber-600">@</div>);
        continue;
      }

      // Priority 2: enemies.
      if (hasEnemies) {
        const enemy = enemyMarkers!.find((e) => e.pos.x === x && e.pos.y === y);
        if (enemy) {
          const hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
          const cls   = hpPct > 0.5 ? "text-red-500" : hpPct > 0.25 ? "text-red-600" : "text-red-800";
          cells.push(
            <div key={key} className={`text-center ${cls}`} title={`${enemy.name} HP:${enemy.hp}/${enemy.maxHp}`}>
              👾
            </div>,
          );
          continue;
        }
      }

      // Priority 3: items (explicit markers first, tile-scan fallback).
      if (hasItems) {
        const item = itemMarkers!.find((it) => it.pos.x === x && it.pos.y === y);
        if (item) {
          cells.push(
            <div key={key} className="text-center text-yellow-500" title={item.name}>◆</div>,
          );
          continue;
        }
      }
      if (!hasItems && tileItemSet.has(key)) {
        cells.push(<div key={key} className="text-center text-yellow-500" title="Item">◆</div>);
        continue;
      }

      // Priority 4: POIs.
      const poi = pois.find((p) => p.x === x && p.y === y);
      if (poi) {
        cells.push(<div key={key} className="text-center text-emerald-600">{poi.symbol}</div>);
        continue;
      }

      // Priority 5: terrain.
      const render = TILE_RENDER[tile.t] ?? { char: "?", cls: "text-red-400" };
      cells.push(<div key={key} className={`text-center ${render.cls}`}>{render.char}</div>);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="w-full bg-slate-100 rounded-xl overflow-hidden p-2 select-none font-mono"
        style={{
          display:             "grid",
          gridTemplateColumns: `repeat(${vpWidth}, 1fr)`,
          fontSize:            "clamp(13px, 4vw, 22px)",
          lineHeight:          1.5,
        }}
      >
        {cells}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-slate-400">
        {useParty ? (
          partyMarkers!.map((m) => (
            <span key={m.characterId}>{m.emoji} {m.isCurrentTurn ? <strong>active</strong> : "waiting"}</span>
          ))
        ) : (
          <span><span className="text-amber-600 font-bold">@</span> You</span>
        )}
        {hasEnemies && <span><span className="text-red-500">👾</span> Enemy</span>}
        {(hasItems || tileItemSet.size > 0) && <span><span className="text-yellow-500">◆</span> Item</span>}
        <span><span className="text-slate-400">#</span> Wall</span>
        <span><span className="text-amber-500">+</span> Door</span>
        {pois.length > 0 && <span><span className="text-emerald-600">■</span> POI</span>}
      </div>

      {/* POI list */}
      {pois.length > 0 && (
        <div className="text-xs text-slate-400 space-y-0.5">
          {pois.map((poi) => (
            <div key={poi.id}>
              <span className="text-emerald-600 font-mono">{poi.symbol}</span>
              {" — "}{poi.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
