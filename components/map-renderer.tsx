"use client";

export interface MapData {
  width: number;
  height: number;
  tiles: string[][];
  playerStart: { x: number; y: number };
  rooms: { name: string; description: string }[];
  pois: { id: string; name: string; x: number; y: number; symbol: string }[];
}

export interface PartyMarker {
  characterId:   string;
  pos:           { x: number; y: number };
  emoji:         string;
  isCurrentTurn: boolean;
}

interface Props {
  mapData:      MapData;
  playerPos:    { x: number; y: number }; // kept for solo/legacy games
  partyMarkers?: PartyMarker[];            // populated for party games
}

const TILE: Record<string, { char: string; cls: string }> = {
  W: { char: "#", cls: "text-slate-400" },
  F: { char: "·", cls: "text-slate-300" },
  D: { char: "+", cls: "text-amber-500" },
};

export default function MapRenderer({ mapData, playerPos, partyMarkers }: Props) {
  const flatTiles = mapData.tiles.flat();
  const useParty  = partyMarkers && partyMarkers.length > 0;

  return (
    <div className="space-y-3">
      <div
        className="w-full bg-slate-100 rounded-xl overflow-hidden p-2 select-none font-mono"
        style={{
          display:               "grid",
          gridTemplateColumns:   `repeat(${mapData.width}, 1fr)`,
          fontSize:              "clamp(13px, 4vw, 22px)",
          lineHeight:            1.5,
        }}
      >
        {flatTiles.map((tile, i) => {
          const x = i % mapData.width;
          const y = Math.floor(i / mapData.width);

          // Party markers take priority over everything else.
          if (useParty) {
            const marker = partyMarkers.find((m) => m.pos.x === x && m.pos.y === y);
            if (marker) {
              return (
                <div key={i} className="text-center" title={`Character at (${x},${y})`}>
                  {marker.emoji}
                </div>
              );
            }
          } else {
            // Solo game — use the classic @ symbol.
            if (x === playerPos.x && y === playerPos.y) {
              return <div key={i} className="text-center font-bold text-amber-600">@</div>;
            }
          }

          const poi = mapData.pois.find((p) => p.x === x && p.y === y);
          if (poi) {
            return <div key={i} className="text-center text-emerald-600">{poi.symbol}</div>;
          }

          const render = TILE[tile] ?? { char: "?", cls: "text-red-400" };
          return <div key={i} className={`text-center ${render.cls}`}>{render.char}</div>;
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-slate-400">
        {useParty ? (
          partyMarkers.map((m) => (
            <span key={m.characterId}>{m.emoji} {m.isCurrentTurn ? <strong>active</strong> : "waiting"}</span>
          ))
        ) : (
          <span><span className="text-amber-600 font-bold">@</span> You</span>
        )}
        <span><span className="text-slate-400">#</span> Wall</span>
        <span><span className="text-amber-500">+</span> Door</span>
        {mapData.pois.length > 0 && <span><span className="text-emerald-600">■</span> POI</span>}
      </div>

      {/* POI list */}
      {mapData.pois.length > 0 && (
        <div className="text-xs text-slate-400 space-y-0.5">
          {mapData.pois.map((poi) => (
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
