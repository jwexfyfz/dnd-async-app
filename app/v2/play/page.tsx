'use client';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

// ─── Map Types ────────────────────────────────────────────────────────────────

interface MapPoi {
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
}

interface MapCharacter {
  characterId: string;
  name: string;
  grid_slot: string;
  stance: string | null;
}

interface MapRoom {
  instanceId: string;
  templateId: string;
  name: string;
  map_x: number;
  map_y: number;
  pois: MapPoi[];
  characters: MapCharacter[];
}

interface MapData {
  rooms: MapRoom[];
  character: { roomInstanceId: string | null; proximityTargetId: string | null };
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

function DungeonMap({ mapData, currentRoomInstanceId }: { mapData: MapData; currentRoomInstanceId: string }) {
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
    c => c.characterId === mapData.character.roomInstanceId || true
  )?.grid_slot ?? 'C';

  // Find exits in current room
  const currentExits = (currentRoom?.pois ?? []).filter(p => p.exit_direction && p.peek_visibility !== 'none');

  // For each visited room, determine if it's the current room or adjacent/visible
  const roomByTemplateId = new Map(mapData.rooms.map(r => [r.templateId, r]));

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

  return (
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
            if (exitInGap && exitInGap.exit_arch_width === 1 && exitInGap.peek_visibility === 'none') {
              const mx = isHoriz ? x1 + (gs + ge) / 2 : x1;
              const my = isHoriz ? y1 : y1 + (gs + ge) / 2;
              wallLines.push(
                <text key={`door-${dir}-${cursor}`} x={mx} y={my + 4}
                  textAnchor="middle" fontSize={10} fill={wallColor}>▮</text>
              );
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

        // POI labels — only non-exit, non-open-space POIs
        const visiblePois = room.pois.filter(p => {
          if (p.poi_type === 'open_space' || p.poi_type === 'exit') return false;
          if (!isCurrentRoom) {
            // Adjacent room: filter by LoS and visibility_level
            const sourcePos = currentRoom ? roomPx.get(currentRoom.instanceId) : null;
            if (!sourcePos || !currentRoom) return false;
            const matchingExit = currentExits.find(e => {
              // Find the room this exit leads to
              const targetTemplateId = (currentRoom.pois.find(ep => ep === e)?.poi_type === 'exit')
                ? (currentRoom.pois.find(ep => ep === e) as MapPoi | undefined)?.templateId
                : null;
              // Compare directions instead
              const adjacentByDir: Record<string, { dx: number; dy: number }> = {
                E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 },
                N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 },
              };
              const d = adjacentByDir[e.exit_direction ?? ''];
              if (!d) return false;
              return room.map_x === currentRoom.map_x + d.dx &&
                     room.map_y === currentRoom.map_y + d.dy;
            });
            if (!matchingExit) return false;

            const minVis = matchingExit.peek_visibility === 'full' ? 1 : 2;
            if (p.visibility_level < minVis) return false;

            const { px: cpx, py: cpy } = sourcePos;
            const { px: tpx, py: tpy } = roomPx.get(room.instanceId)!;
            return isSlotVisibleThroughExit(charSlot, p.grid_slot, matchingExit, cpx, cpy, tpx, tpy);
          }
          return true;
        });

        const poiLabels = visiblePois.map(p => {
          const [lx, ly] = slotCenter(p.grid_slot, px, py);
          const label = p.poi_type === 'exit' ? '' : abbrev(p.name);
          return (
            <text key={`poi-${p.templateId}`} x={lx} y={ly + 4}
              textAnchor="middle" fontSize={9} fill="#475569">
              {label}
            </text>
          );
        });

        // Character tokens
        const charTokens = room.characters.map((c, i) => {
          const [cx2, cy2] = slotCenter(c.grid_slot, px, py);
          return (
            <g key={`char-${c.characterId}`}>
              <circle cx={cx2} cy={cy2} r={7} fill="#6366f1" />
              <text x={cx2} y={cy2 + 4} textAnchor="middle" fontSize={9} fill="white" fontWeight="bold">@</text>
            </g>
          );
        });

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
            {charTokens}
            {roomLabel}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function MapLegend({ mapData }: { mapData: MapData | null }) {
  if (!mapData) return null;

  // Collect unique visible non-exit POIs for legend
  const seen = new Map<string, string>();
  for (const room of mapData.rooms) {
    for (const poi of room.pois) {
      if (poi.poi_type === 'open_space' || poi.poi_type === 'exit') continue;
      const abbr = poi.name.replace(/^(The |A |An )/i, '').split(/\s+/).map((w: string) => w[0]).join('').slice(0, 3).toUpperCase();
      if (!seen.has(abbr)) seen.set(abbr, poi.name);
    }
  }

  return (
    <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span><span className="font-mono font-bold text-indigo-600">@</span> You</span>
        <span><span className="font-mono">·</span> Empty slot</span>
        <span><span className="font-mono">▮</span> Closed door</span>
        <span>(gap) Open door / archway</span>
        {[...seen.entries()].map(([abbr, name]) => (
          <span key={abbr}><span className="font-mono font-medium">{abbr}</span> {name}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────

type SheetState = 'closed' | 'peek' | 'full';

function MapSheet({ sessionId, characterId, roomInstanceId, roomName, refreshKey }: {
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
    if (sheetState !== 'closed') {
      console.log('[MapSheet] fetching map for session:', sessionId, 'char:', characterId);
      fetch(`/api/v2/map?sessionId=${sessionId}&characterId=${characterId}`)
        .then(r => r.json())
        .then(data => {
          console.log('[MapSheet] map data — rooms:', data.rooms?.length, 'char room:', data.character?.roomInstanceId);
          setMapData(data);
        })
        .catch((e) => console.error('[MapSheet] fetch error:', e));
    }
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
              <DungeonMap mapData={mapData} currentRoomInstanceId={roomInstanceId} />
            ) : (
              <div className="flex items-center justify-center h-20 text-slate-400 text-xs">
                {mapData ? 'Map unavailable' : 'Loading map…'}
              </div>
            )}
          </div>
          {sheetState === 'full' && <MapLegend mapData={mapData} />}
        </div>
      )}
    </div>
  );
}

interface HistoryEntry {
  id: string;
  text: string;
  isMechanicalEvent: boolean;
  mechanicalSummary: Record<string, unknown> | null;
  createdAt: string;
}

interface RollResult {
  item: string;
  skill: string;
  d20: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  poi?: string;
}

function RollBadge({ rolls }: { rolls: RollResult[] }) {
  return (
    <div className="my-2 flex flex-col gap-1">
      {rolls.map((r, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
            r.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-slate-50 border-slate-200 text-slate-500'
          }`}
        >
          <span>🎲</span>
          <span className="capitalize">{r.skill}</span>
          <span className="font-bold">
            {r.d20}{r.modifier !== 0 ? (r.modifier > 0 ? `+${r.modifier}` : r.modifier) : ''}={r.total}
          </span>
          <span>vs DC {r.dc}</span>
          {r.poi && <span className="text-slate-400">@ {r.poi}</span>}
          <span className={r.success ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
            {r.success ? `✓ ${r.item}` : '✗ nothing'}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChatMessage({ entry }: { entry: HistoryEntry }) {
  const summary = entry.mechanicalSummary;
  const type = summary?.type as string | undefined;

  if (type === 'player_action') {
    return (
      <div className="flex justify-end my-2">
        <div className="max-w-xs px-4 py-2 bg-indigo-600 text-white rounded-2xl rounded-br-sm text-sm">
          {entry.text}
        </div>
      </div>
    );
  }

  if (type === 'roll_result') {
    const rolls = (summary?.rolls as RollResult[]) ?? [];
    return <RollBadge rolls={rolls} />;
  }

  // DM narrative
  return (
    <div className="flex justify-start my-2">
      <div className="max-w-sm px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm text-sm text-slate-700 leading-relaxed">
        {entry.text}
      </div>
    </div>
  );
}

function PlayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomInstanceId = searchParams.get('room');
  const characterId = searchParams.get('char');

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [activeRoomInstanceId, setActiveRoomInstanceId] = useState(roomInstanceId ?? '');
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roomInstanceId || !characterId) {
      router.push('/v2/setup');
      return;
    }
    setActiveRoomInstanceId(roomInstanceId);
    Promise.all([
      fetch(`/api/v2/room/history?roomInstanceId=${roomInstanceId}`).then(r => r.json()),
      fetch(`/api/v2/room/state?roomInstanceId=${roomInstanceId}`).then(r => r.json()),
    ]).then(([{ logs }, state]) => {
      setHistory(logs ?? []);
      if (state.sessionId) setSessionId(state.sessionId);
      if (state.roomName) setRoomName(state.roomName);
    });
  }, [roomInstanceId, characterId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const sendAction = useCallback(async () => {
    if (!input.trim() || sending || !activeRoomInstanceId || !characterId) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    setError('');

    // Add player message to history immediately
    const optimisticEntry: HistoryEntry = {
      id: `optimistic-${Date.now()}`,
      text,
      isMechanicalEvent: false,
      mechanicalSummary: { type: 'player_action' },
      createdAt: new Date().toISOString(),
    };
    setHistory(prev => [...prev, optimisticEntry]);

    try {
      const res = await fetch('/api/v2/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, roomInstanceId: activeRoomInstanceId, playerActionText: text }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }

      console.log('[sendAction] response roomInstanceId:', data.roomInstanceId, 'current:', activeRoomInstanceId);
      console.log('[sendAction] currentNarrative length:', data.currentNarrative?.length);

      const newNarrative: HistoryEntry[] = data.currentNarrative ?? [];
      setHistory(prev => {
        // Remove the optimistic entry; add all genuinely new entries from server
        const withoutOptimistic = prev.filter(e => !e.id.startsWith('optimistic-'));
        const existingIds = new Set(withoutOptimistic.map((e: HistoryEntry) => e.id));
        const fresh = newNarrative.filter((e: HistoryEntry) => !existingIds.has(e.id));
        console.log('[sendAction] fresh entries:', fresh.length, fresh.map(e => (e.mechanicalSummary as Record<string,unknown>)?.type));
        return [...withoutOptimistic, ...fresh];
      });

      setMapRefreshKey(k => k + 1);

      if (data.roomInstanceId && data.roomInstanceId !== activeRoomInstanceId) {
        console.log('[sendAction] room changed →', data.roomInstanceId);
        setActiveRoomInstanceId(data.roomInstanceId);
        fetch(`/api/v2/room/state?roomInstanceId=${data.roomInstanceId}`)
          .then(r => r.json())
          .then(state => { if (state.roomName) setRoomName(state.roomName); });
      }
    } catch {
      setError('Network error — please try again.');
      setHistory(prev => prev.filter(e => !e.id.startsWith('optimistic-')));
    } finally {
      setSending(false);
    }
  }, [input, sending, activeRoomInstanceId, characterId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAction(); }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
        <h1 className="font-semibold text-slate-800">D&amp;D Async</h1>
        <a href="/v2/setup" className="text-xs text-slate-400 hover:text-slate-600">Switch session</a>
      </div>

      {/* Chat stream */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {history.length === 0 && !sending && (
          <p className="text-center text-slate-400 text-sm mt-8">Loading…</p>
        )}
        {history.map(entry => (
          <ChatMessage key={entry.id} entry={entry} />
        ))}
        {sending && (
          <div className="flex justify-start my-2">
            <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm text-sm text-slate-400 italic">
              The DM is writing…
            </div>
          </div>
        )}
        {error && (
          <p className="text-center text-red-500 text-xs my-2">{error}</p>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Map bottom sheet */}
      {sessionId && (
        <MapSheet
          sessionId={sessionId}
          characterId={characterId!}
          roomInstanceId={activeRoomInstanceId}
          roomName={roomName}
          refreshKey={mapRefreshKey}
        />
      )}

      {/* Input */}
      <div className="px-4 py-3 bg-white border-t border-slate-200">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="What do you do? (Enter to send)"
            className="flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            disabled={sending}
          />
          <button
            onClick={sendAction}
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>}>
      <PlayContent />
    </Suspense>
  );
}
