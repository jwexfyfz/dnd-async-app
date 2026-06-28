'use client';

import { useEffect, useState, useRef } from 'react';
import { classEmoji } from '@/lib/class-emoji';

// ─── Map Types ────────────────────────────────────────────────────────────────

export interface MapPoi {
  instanceId: string | null;
  templateId: string;
  name: string;
  grid_slot: string;
  visibility_level: number;
  exit_direction: string | null;
  exit_wall_section: string;
  exit_arch_width: number;
  poi_type: string;
  peek_visibility: string;
  examined: boolean;
  interacted: boolean;
  unlocked: boolean;
  isDead?: boolean;
}

export interface MapCharacter {
  characterId: string;
  name: string;
  characterClass: string | null;
  grid_slot: string;
  stance: string | null;
  type: 'player' | 'enemy';
  isDead?: boolean;
  isHiding?: boolean;
}

export interface MapRoom {
  instanceId: string;
  templateId: string;
  name: string;
  map_x: number;
  map_y: number;
  pois: MapPoi[];
  characters: MapCharacter[];
}

export interface MapData {
  rooms: MapRoom[];
  character: { characterId: string | null; roomInstanceId: string | null; proximityTargetId: string | null; isHiding: boolean };
}

// ─── Grid Constants ───────────────────────────────────────────────────────────

const SLOT_PX = 40;
const ROOM_PX = SLOT_PX * 3; // 120

const SLOT_OFFSETS: Record<string, [number, number]> = {
  NW: [0, 0], N: [1, 0], NE: [2, 0],
  W:  [0, 1], C: [1, 1], E:  [2, 1],
  SW: [0, 2], S: [1, 2], SE: [2, 2],
};

function slotCenter(slot: string, roomPixelX: number, roomPixelY: number): [number, number] {
  const [sx, sy] = SLOT_OFFSETS[slot] ?? [1, 1];
  return [roomPixelX + sx * SLOT_PX + SLOT_PX / 2, roomPixelY + sy * SLOT_PX + SLOT_PX / 2];
}

// ─── LoS Check ────────────────────────────────────────────────────────────────

function wallAxisForDirection(dir: string): 'x' | 'y' {
  return dir === 'E' || dir === 'W' ? 'x' : 'y';
}

// Returns opening range [min, max] in slot coords along the perpendicular axis
function archOpening(wallSection: string, archWidth: number): [number, number] {
  const sectionStart: Record<string, number> = { N: 0, C: 1, S: 2 };
  const start = sectionStart[wallSection] ?? 1;
  const end = Math.min(start + archWidth, 3);
  return [start, end]; // in slot units
}

function isSlotVisibleThroughExit(
  charSlot: string,
  targetSlot: string,
  exit: MapPoi,
  charRoomX: number,
  charRoomY: number,
  targetRoomX: number,
  targetRoomY: number,
): boolean {
  if (!exit.exit_direction || exit.peek_visibility === 'none') return false;

  const [cx, cy] = slotCenter(charSlot, charRoomX, charRoomY);
  const [tx, ty] = slotCenter(targetSlot, targetRoomX, targetRoomY);

  const dir = exit.exit_direction;
  const axis = wallAxisForDirection(dir);

  // Wall coordinate in px
  let wallCoord: number;
  if (dir === 'E') wallCoord = charRoomX + ROOM_PX;
  else if (dir === 'W') wallCoord = charRoomX;
  else if (dir === 'S') wallCoord = charRoomY + ROOM_PX;
  else wallCoord = charRoomY; // N

  // Where the line crosses the wall
  let crossCoord: number;
  if (axis === 'x') {
    if (tx === cx) return false; // parallel, no crossing
    crossCoord = cy + (ty - cy) * (wallCoord - cx) / (tx - cx);
  } else {
    if (ty === cy) return false;
    crossCoord = cx + (tx - cx) * (wallCoord - cy) / (ty - cy);
  }

  // Convert crossing coord to slot units relative to room
  const [openMin, openMax] = archOpening(exit.exit_wall_section, exit.exit_arch_width);
  let roomRelative: number;
  if (axis === 'x') {
    roomRelative = (crossCoord - charRoomY) / SLOT_PX;
  } else {
    roomRelative = (crossCoord - charRoomX) / SLOT_PX;
  }

  return roomRelative >= openMin && roomRelative <= openMax;
}

// ─── SVG Map Renderer ─────────────────────────────────────────────────────────

export function DungeonMap({ mapData, currentRoomInstanceId, showLegend }: { mapData: MapData; currentRoomInstanceId: string; showLegend?: boolean }) {
  if (!mapData?.rooms?.length) return null;

  // Compute canvas bounds
  const xs = mapData.rooms.map(r => r.map_x);
  const ys = mapData.rooms.map(r => r.map_y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  const PAD = 16;
  const roomPixelPos = (r: MapRoom) => ({
    px: (r.map_x - minX) * ROOM_PX + PAD,
    py: (r.map_y - minY) * ROOM_PX + PAD,
  });

  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const svgW = (maxX - minX + 1) * ROOM_PX + PAD * 2;
  const svgH = (maxY - minY + 1) * ROOM_PX + PAD * 2;

  const currentRoom = mapData.rooms.find(r => r.instanceId === currentRoomInstanceId);
  const charProximityId = mapData.character.proximityTargetId;

  // Find character's current grid_slot
  const charSlot = currentRoom?.characters.find(
    c => c.characterId === mapData.character.characterId
  )?.grid_slot ?? 'C';

  // Find exits in current room
  const currentExits = (currentRoom?.pois ?? []).filter(p => p.exit_direction && p.peek_visibility !== 'none');

  // Build room pixel positions
  const roomPx = new Map(mapData.rooms.map(r => {
    const { px, py } = roomPixelPos(r);
    return [r.instanceId, { px, py }];
  }));

  // Abbreviate POI name to 2-3 chars
  const abbrev = (name: string) => {
    const words = name.replace(/^(The |A |An )/i, '').split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 3);
    return words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
  };

  const wallColor = '#334155';
  const wallWidth = 1.5;

  // Pre-compute visible POIs per room using the same LoS filter applied to map labels.
  const visiblePoisByRoom = new Map<string, MapPoi[]>();
  const visibleDeadPoisByRoom = new Map<string, MapPoi[]>();
  for (const room of mapData.rooms) {
    const isCurrentRoom = room.instanceId === currentRoomInstanceId;
    const visibilityFilter = (p: MapPoi) => {
      if (p.poi_type === 'open_space' || p.poi_type === 'exit') return false;
      if (!isCurrentRoom) {
        const sourcePos = currentRoom ? roomPx.get(currentRoom.instanceId) : null;
        if (!sourcePos || !currentRoom) return false;
        const matchingExit = currentExits.find(e => {
          const adjacentByDir: Record<string, { dx: number; dy: number }> = {
            E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 },
            N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
          };
          const d = adjacentByDir[e.exit_direction ?? ''];
          if (!d) return false;
          return room.map_x === currentRoom.map_x + d.dx && room.map_y === currentRoom.map_y + d.dy;
        });
        if (!matchingExit) return false;
        const minVis = (matchingExit.peek_visibility === 'full' || matchingExit.interacted) ? 1 : 2;
        if (p.visibility_level < minVis) return false;
        const { px: cpx, py: cpy } = sourcePos;
        const { px: tpx, py: tpy } = roomPx.get(room.instanceId)!;
        return isSlotVisibleThroughExit(charSlot, p.grid_slot, matchingExit, cpx, cpy, tpx, tpy);
      }
      return true;
    };
    const allFiltered = room.pois.filter(visibilityFilter);
    visiblePoisByRoom.set(room.instanceId, allFiltered.filter(p => !p.isDead));
    visibleDeadPoisByRoom.set(room.instanceId, allFiltered.filter(p => !!p.isDead));
  }
  const allVisiblePois = [...visiblePoisByRoom.values()].flat();

  const legendEntries = new Map<string, string>();
  for (const p of allVisiblePois) {
    const a = abbrev(p.name);
    if (!legendEntries.has(a)) legendEntries.set(a, p.name);
  }

  const allyLegend = new Map<string, { name: string; characterClass: string | null; isHiding: boolean }>();
  const deadEnemyLegend = new Map<string, string>(); // id → name
  for (const room of mapData.rooms) {
    for (const c of room.characters) {
      if (c.type === 'player' && c.characterId !== mapData.character.characterId) {
        allyLegend.set(c.characterId, { name: c.name, characterClass: c.characterClass, isHiding: c.isHiding ?? false });
      }
      if (c.type === 'enemy' && c.isDead) {
        deadEnemyLegend.set(c.characterId, c.name);
      }
    }
    // Dead enemy POIs persist after combat state is cleared — include them in the legend
    for (const p of visibleDeadPoisByRoom.get(room.instanceId) ?? []) {
      const key = p.instanceId ?? p.templateId;
      if (!deadEnemyLegend.has(key)) deadEnemyLegend.set(key, p.name);
    }
  }

  return (
    <>
    <svg width={svgW} height={svgH} className="block" style={{ fontFamily: 'monospace' }}>
      {mapData.rooms.map(room => {
        const { px, py } = roomPx.get(room.instanceId)!;
        const isCurrentRoom = room.instanceId === currentRoomInstanceId;

        // Determine which exits connect to which adjacent room
        const exits = room.pois.filter(p => p.exit_direction);

        // Wall gaps: for each direction, collect gap segments [start, end] in px along the wall
        const gapsByDir: Record<string, Array<[number, number]>> = { N: [], S: [], E: [], W: [] };
        for (const exit of exits) {
          if (!exit.exit_direction) continue;
          const dir = exit.exit_direction;
          const [openMin, openMax] = archOpening(exit.exit_wall_section, exit.exit_arch_width);
          const gapStart = openMin * SLOT_PX;
          const gapEnd = openMax * SLOT_PX;
          gapsByDir[dir].push([gapStart, gapEnd]);
        }

        // Draw wall lines with gaps
        const wallLines: React.ReactElement[] = [];

        const drawWall = (dir: string, x1: number, y1: number, x2: number, y2: number) => {
          const gaps = gapsByDir[dir] ?? [];
          if (gaps.length === 0) {
            wallLines.push(
              <line key={`wall-${dir}`} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={wallColor} strokeWidth={wallWidth} strokeLinecap="square" />
            );
            return;
          }
          // Sort gaps and draw segments between them
          const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
          const isHoriz = y1 === y2;
          let cursor = 0;
          for (const [gs, ge] of sorted) {
            if (cursor < gs) {
              const seg = isHoriz
                ? { x1: x1 + cursor, y1, x2: x1 + gs, y2 }
                : { x1, y1: y1 + cursor, x2, y2: y1 + gs };
              wallLines.push(
                <line key={`wall-${dir}-${cursor}`} {...seg}
                  stroke={wallColor} strokeWidth={wallWidth} strokeLinecap="square" />
              );
            }
            // Draw closed-door symbol (▮) for non-archway exits in gap
            const exitInGap = exits.find(e => {
              if (e.exit_direction !== dir) return false;
              const [s] = archOpening(e.exit_wall_section, e.exit_arch_width);
              return s * SLOT_PX === gs;
            });
            if (exitInGap && exitInGap.exit_arch_width === 1) {
              const mx = isHoriz ? x1 + (gs + ge) / 2 : x1;
              const my = isHoriz ? y1 : y1 + (gs + ge) / 2;
              if (exitInGap.peek_visibility === 'none' && !exitInGap.interacted) {
                // closed door
                wallLines.push(
                  <text key={`door-${dir}-${cursor}`} x={mx} y={my + 4}
                    textAnchor="middle" fontSize={10} fill={wallColor}>▮</text>
                );
              } else if (exitInGap.interacted) {
                // opened door
                wallLines.push(
                  <text key={`door-${dir}-${cursor}`} x={mx} y={my + 4}
                    textAnchor="middle" fontSize={10} fill="#94a3b8">▯</text>
                );
              }
            }
            cursor = ge;
          }
          // Remaining segment after last gap
          const wallLen = isHoriz ? x2 - x1 : y2 - y1;
          if (cursor < wallLen) {
            const seg = isHoriz
              ? { x1: x1 + cursor, y1, x2, y2 }
              : { x1, y1: y1 + cursor, x2, y2 };
            wallLines.push(
              <line key={`wall-${dir}-end`} {...seg}
                stroke={wallColor} strokeWidth={wallWidth} strokeLinecap="square" />
            );
          }
        };

        drawWall('N', px, py, px + ROOM_PX, py);
        drawWall('S', px, py + ROOM_PX, px + ROOM_PX, py + ROOM_PX);
        drawWall('W', px, py, px, py + ROOM_PX);
        drawWall('E', px + ROOM_PX, py, px + ROOM_PX, py + ROOM_PX);

        // POI labels — pre-computed above using the same LoS filter
        const visiblePois = visiblePoisByRoom.get(room.instanceId) ?? [];

        // Group POIs by slot so shared slots can be stacked vertically
        const poisBySlot = new Map<string, typeof visiblePois>();
        for (const p of visiblePois) {
          const group = poisBySlot.get(p.grid_slot) ?? [];
          group.push(p);
          poisBySlot.set(p.grid_slot, group);
        }

        const poiLabels: React.ReactElement[] = [];
        for (const [slot, pois] of poisBySlot) {
          const [lx, ly] = slotCenter(slot, px, py);
          const n = pois.length;
          if (n === 1) {
            poiLabels.push(
              <text key={`poi-${pois[0].templateId}`} x={lx} y={ly + 4}
                textAnchor="middle" fontSize={9} fill="#475569">
                {abbrev(pois[0].name)}
              </text>
            );
          } else if (n === 2) {
            poiLabels.push(
              <text key={`poi-${pois[0].templateId}`} x={lx} y={ly - 1}
                textAnchor="middle" fontSize={8} fill="#475569">{abbrev(pois[0].name)}</text>,
              <text key={`poi-${pois[1].templateId}`} x={lx} y={ly + 8}
                textAnchor="middle" fontSize={8} fill="#475569">{abbrev(pois[1].name)}</text>,
            );
          } else {
            poiLabels.push(
              <text key={`poi-${pois[0].templateId}`} x={lx} y={ly - 1}
                textAnchor="middle" fontSize={8} fill="#475569">{abbrev(pois[0].name)}</text>,
              <text key={`poi-slot-${slot}-overflow`} x={lx} y={ly + 8}
                textAnchor="middle" fontSize={8} fill="#94a3b8">+{n - 1}</text>,
            );
          }
        }

        // Characters visible in this room (adjacent rooms filtered by LoS)
        const visibleCharacters = room.characters.filter(c => {
          if (isCurrentRoom) return true;
          const sourcePos = currentRoom ? roomPx.get(currentRoom.instanceId) : null;
          if (!sourcePos || !currentRoom) return false;
          const matchingExit = currentExits.find(e => {
            const adjacentByDir: Record<string, { dx: number; dy: number }> = {
              E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 },
              N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
            };
            const d = adjacentByDir[e.exit_direction ?? ''];
            if (!d) return false;
            return room.map_x === currentRoom.map_x + d.dx && room.map_y === currentRoom.map_y + d.dy;
          });
          if (!matchingExit || matchingExit.peek_visibility === 'none') return false;
          const { px: cpx, py: cpy } = sourcePos;
          const { px: tpx, py: tpy } = roomPx.get(room.instanceId)!;
          return isSlotVisibleThroughExit(charSlot, c.grid_slot, matchingExit, cpx, cpy, tpx, tpy);
        });

        // Character tokens — group live characters by slot; dead enemies rendered separately
        const deadEnemies = visibleCharacters.filter(c => c.type === 'enemy' && c.isDead);
        const charsBySlot = new Map<string, MapCharacter[]>();
        for (const c of visibleCharacters) {
          if (c.isDead) continue;
          const g = charsBySlot.get(c.grid_slot) ?? [];
          g.push(c);
          charsBySlot.set(c.grid_slot, g);
        }

        // Offset table from slot center for 1–4 sub-tokens
        const subOffsets: [number, number][][] = [
          [],
          [[0, 0]],
          [[-9, 0], [9, 0]],
          [[-9, -7], [9, -7], [0, 8]],
          [[-9, -8], [9, -8], [-9, 8], [9, 8]],
        ];

        const charTokens: React.ReactElement[] = [];
        const myCharId = mapData.character.characterId;

        for (const [slot, chars] of charsBySlot) {
          const [scx, scy] = slotCenter(slot, px, py);
          const me = chars.find(c => c.characterId === myCharId);
          const allies = chars.filter(c => c.type !== 'enemy' && c.characterId !== myCharId);
          const enemies = chars.filter(c => c.type === 'enemy');

          const toks: Array<{ fill: string; label: string }> = [];
          if (me) toks.push({ fill: '#6366f1', label: '@' });

          if (enemies.length === 1) {
            toks.push({ fill: '#dc2626', label: '!' });
          } else if (enemies.length > 1) {
            toks.push({ fill: '#dc2626', label: '!' });
            toks.push({ fill: '#7f1d1d', label: `+${enemies.length - 1}` });
          }

          const allyBudget = 4 - toks.length;
          const allyInsert = me ? 1 : 0;
          if (allies.length === 1 && allyBudget >= 1) {
            toks.splice(allyInsert, 0, { fill: '#818cf8', label: classEmoji(allies[0].characterClass ?? '') });
          } else if (allies.length > 1) {
            if (allyBudget >= 2) {
              toks.splice(allyInsert, 0,
                { fill: '#818cf8', label: classEmoji(allies[0].characterClass ?? '') },
                { fill: '#94a3b8', label: `+${allies.length - 1}` },
              );
            } else if (allyBudget >= 1) {
              toks.splice(allyInsert, 0, { fill: '#94a3b8', label: `+${allies.length}` });
            }
          }

          const n = toks.length;
          const r = n === 1 ? 7 : 6;
          const offs = subOffsets[Math.min(n, 4)] ?? subOffsets[4];

          toks.forEach((tok, i) => {
            const [ox, oy] = offs[i] ?? [0, 0];
            const isOverflow = tok.label.startsWith('+');
            charTokens.push(
              <g key={`char-${slot}-${i}`}>
                <circle cx={scx + ox} cy={scy + oy} r={r} fill={tok.fill} />
                <text
                  x={scx + ox} y={scy + oy + (isOverflow ? 3 : 4)}
                  textAnchor="middle" fontSize={isOverflow ? 7 : 9}
                  fill="white" fontWeight="bold"
                >
                  {tok.label}
                </text>
              </g>
            );
          });
        }

        // Dead enemy corpse markers — small gray circle with ✕ at their last position
        const charDeadIds = new Set(deadEnemies.map(c => c.characterId));
        const deadPoiCorpses = (visibleDeadPoisByRoom.get(room.instanceId) ?? [])
          .filter(p => !charDeadIds.has(p.instanceId ?? ''));
        const corpseTokens = [
          ...deadEnemies.map((c, i) => {
            const [cx, cy] = slotCenter(c.grid_slot, px, py);
            return (
              <g key={`corpse-${c.characterId}-${i}`} opacity={0.6}>
                <circle cx={cx} cy={cy} r={6} fill="#475569" />
                <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={8} fill="white" fontWeight="bold">✕</text>
              </g>
            );
          }),
          ...deadPoiCorpses.map((p, i) => {
            const [cx, cy] = slotCenter(p.grid_slot, px, py);
            return (
              <g key={`corpse-poi-${p.templateId}-${i}`} opacity={0.6}>
                <circle cx={cx} cy={cy} r={6} fill="#475569" />
                <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={8} fill="white" fontWeight="bold">✕</text>
              </g>
            );
          }),
        ];

        // Empty slot dots for current room
        const emptyDots = isCurrentRoom
          ? Object.entries(SLOT_OFFSETS)
              .filter(([slot]) => !visiblePois.some(p => p.grid_slot === slot) &&
                                  !room.characters.some(c => c.grid_slot === slot))
              .map(([slot]) => {
                const [dx, dy] = slotCenter(slot, px, py);
                return (
                  <circle key={`dot-${slot}`} cx={dx} cy={dy} r={1.5} fill="#94a3b8" />
                );
              })
          : [];

        // Room name label (above room)
        const visited = true; // all rooms in the response have been visited
        const roomLabel = visited ? (
          <text x={px + ROOM_PX / 2} y={py - 5} textAnchor="middle" fontSize={9}
            fill="#64748b" fontWeight="500">
            {room.name}
          </text>
        ) : null;

        // Room background tint for current room
        const bg = isCurrentRoom ? (
          <rect x={px} y={py} width={ROOM_PX} height={ROOM_PX} fill="#f8fafc" />
        ) : (
          <rect x={px} y={py} width={ROOM_PX} height={ROOM_PX} fill="#f1f5f9" opacity={0.5} />
        );

        return (
          <g key={room.instanceId}>
            {bg}
            {wallLines}
            {emptyDots}
            {poiLabels}
            {corpseTokens}
            {charTokens}
            {roomLabel}
          </g>
        );
      })}
    </svg>
    {showLegend && (
      <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-mono font-bold text-indigo-600">@</span> You{mapData.character.isHiding && <span className="text-slate-400 italic"> (hiding)</span>}</span>
          {[...allyLegend.entries()].map(([id, a]) => (
            <span key={id}>{classEmoji(a.characterClass ?? '')} {a.name}{a.isHiding && <span className="text-slate-400 italic"> (hiding)</span>}</span>
          ))}
          <span><span className="font-mono font-bold text-red-600">!</span> Enemy</span>
          <span><span className="font-mono">·</span> Empty slot</span>
          <span><span className="font-mono">▮</span> Locked door</span>
          <span><span className="font-mono">▯</span> Open door</span>
          <span>(gap) Archway</span>
          {[...legendEntries.entries()].map(([a, name]) => (
            <span key={a}><span className="font-mono font-medium">{a}</span> {name}</span>
          ))}
          {[...deadEnemyLegend.entries()].map(([id, name]) => (
            <span key={id} className="text-slate-400"><span className="font-mono">✕</span> {name} (dead)</span>
          ))}
        </div>
      </div>
    )}
    </>
  );
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

type SheetState = 'closed' | 'peek' | 'full';

export function MapSheet({ sessionId, characterId, roomInstanceId, roomName, refreshKey }: {
  sessionId: string;
  characterId: string;
  roomInstanceId: string;
  roomName: string;
  refreshKey: number;
}) {
  const [sheetState, setSheetState] = useState<SheetState>('closed');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    console.log('[MapSheet] effect — sheetState:', sheetState, 'roomInstanceId:', roomInstanceId, 'refreshKey:', refreshKey);
    console.log('[MapSheet] fetching map for session:', sessionId, 'char:', characterId);
    fetch(`/api/v2/map?sessionId=${sessionId}&characterId=${characterId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        console.log('[MapSheet] map data — rooms:', data.rooms?.length, 'char room:', data.character?.roomInstanceId);
        setMapData(data);
      })
      .catch((e) => console.error('[MapSheet] fetch error:', e));
  }, [sheetState, sessionId, characterId, roomInstanceId, refreshKey]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = touchStartY.current - e.changedTouches[0].clientY;
    touchStartY.current = null;
    if (Math.abs(delta) < 20) return;
    if (delta > 0) {
      // swipe up
      setSheetState(s => s === 'closed' ? 'peek' : 'full');
    } else {
      // swipe down
      setSheetState(s => s === 'full' ? 'peek' : 'closed');
    }
  };

  const sheetHeights: Record<SheetState, string> = {
    closed: '48px',
    peek: '45vh',
    full: '90vh',
  };

  return (
    <div
      style={{ height: sheetHeights[sheetState], transition: 'height 0.25s ease' }}
      className="bg-white border-t border-slate-200 overflow-hidden flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Handle strip */}
      <button
        className="flex items-center justify-between px-4 flex-shrink-0 h-12 w-full"
        onClick={() => setSheetState(s => s === 'closed' ? 'peek' : s === 'peek' ? 'full' : 'closed')}
      >
        <span className="text-xs font-medium text-slate-600">{roomName}</span>
        <span className="text-slate-300 text-xs">━━━━</span>
        <span className="text-slate-400 text-xs">{sheetState === 'closed' ? '↑' : '↓'}</span>
      </button>

      {/* Map content */}
      {sheetState !== 'closed' && (
        <div className="flex-1 overflow-auto">
          <div className="p-2">
            {mapData?.rooms ? (
              <DungeonMap mapData={mapData} currentRoomInstanceId={roomInstanceId} showLegend={sheetState === 'full'} />
            ) : (
              <div className="flex items-center justify-center h-20 text-slate-400 text-xs">
                {mapData ? 'Map unavailable' : 'Loading map…'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────

export function MapTab({ sessionId, characterId, roomInstanceId, refreshKey }: {
  sessionId: string;
  characterId: string;
  roomInstanceId: string;
  refreshKey: number;
}) {
  const [mapData, setMapData] = useState<MapData | null>(null);

  useEffect(() => {
    fetch(`/api/v2/map?sessionId=${sessionId}&characterId=${characterId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => setMapData(data))
      .catch(e => console.error('[MapTab] fetch error:', e));
  }, [sessionId, characterId, roomInstanceId, refreshKey]);

  return (
    <div className="flex-1 overflow-auto p-3">
      {mapData?.rooms ? (
        <DungeonMap mapData={mapData} currentRoomInstanceId={roomInstanceId} showLegend />
      ) : (
        <div className="flex items-center justify-center h-full text-slate-400 text-sm">
          {mapData ? 'Map unavailable' : 'Loading map…'}
        </div>
      )}
    </div>
  );
}
