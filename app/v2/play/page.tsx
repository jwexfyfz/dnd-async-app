'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { CombatState, CharacterStats, InitiativeEntry, CharacterInventory, ItemDefinition, PartyMemberInfo } from '@/types/v2-game';
import { classEmoji, classSprite } from '@/lib/class-emoji';
import AppBar from '@/components/app-bar';
import { ABILITY_DESCRIPTIONS, ABILITY_PASSIVE_NOTES, SKILL_ABILITY, SKILL_DESCRIPTIONS } from '@/lib/v2/skill-descriptions';

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

            // opened door → see everything; obvious_only peek → vis>=2 only; full → everything
            const minVis = (matchingExit.peek_visibility === 'full' || matchingExit.interacted) ? 1 : 2;
            if (p.visibility_level < minVis) return false;

            const { px: cpx, py: cpy } = sourcePos;
            const { px: tpx, py: tpy } = roomPx.get(room.instanceId)!;
            return isSlotVisibleThroughExit(charSlot, p.grid_slot, matchingExit, cpx, cpy, tpx, tpy);
          }
          return true;
        });

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
        <span><span className="font-mono">▮</span> Locked door</span>
        <span><span className="font-mono">▯</span> Open door</span>
        <span>(gap) Archway</span>
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

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ roomName, gameState, round, hp, maxHp }: {
  roomName: string;
  gameState: 'exploration' | 'combat';
  round?: number;
  hp?: number;
  maxHp?: number;
}) {
  const isCombat = gameState === 'combat';
  const hpColor = (hp != null && maxHp != null && maxHp > 0)
    ? hp / maxHp > 0.6 ? 'text-white' : hp / maxHp > 0.3 ? 'text-yellow-200' : 'text-red-200'
    : 'text-white';
  return (
    <div className={`flex items-center justify-between px-4 py-3 flex-shrink-0 ${isCombat ? 'bg-red-600' : 'bg-blue-600'} text-white`}>
      <span className="font-semibold text-sm truncate max-w-[40%]">{roomName || 'Loading…'}</span>
      {isCombat && (
        <span className="px-2 py-0.5 text-xs font-bold bg-white/20 rounded-full tracking-wide">
          Round {round ?? '—'}
        </span>
      )}
      {hp != null && maxHp != null && (
        <span className={`text-sm font-semibold ${hpColor}`}>♥ {hp}/{maxHp}</span>
      )}
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

type ActiveTab = 'chat' | 'inventory' | 'party' | 'map';

function BottomNav({ activeTab, onTabChange }: {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}) {
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'party', label: 'Party' },
    { id: 'map', label: 'Map' },
  ];
  return (
    <div className="flex border-t border-slate-200 bg-white flex-shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onTabChange(t.id)}
          className={`flex-1 py-3 text-xs font-medium transition-colors ${
            activeTab === t.id
              ? 'text-indigo-600 border-t-2 border-indigo-600 -mt-px font-bold'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────

function MapTab({ sessionId, characterId, roomInstanceId, refreshKey }: {
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
        <>
          <DungeonMap mapData={mapData} currentRoomInstanceId={roomInstanceId} />
          <MapLegend mapData={mapData} />
        </>
      ) : (
        <div className="flex items-center justify-center h-full text-slate-400 text-sm">
          {mapData ? 'Map unavailable' : 'Loading map…'}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function abilityMod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

const ABILITY_LABELS: { key: keyof CharacterStats; short: string; full: string }[] = [
  { key: 'baseStrength',     short: 'STR', full: 'Strength' },
  { key: 'baseDexterity',    short: 'DEX', full: 'Dexterity' },
  { key: 'baseConstitution', short: 'CON', full: 'Constitution' },
  { key: 'baseIntelligence', short: 'INT', full: 'Intelligence' },
  { key: 'baseWisdom',       short: 'WIS', full: 'Wisdom' },
  { key: 'baseCharisma',     short: 'CHA', full: 'Charisma' },
];

function buildBannerEntry(type: 'combat_start' | 'combat_end', cs?: CombatState | null): HistoryEntry {
  if (type === 'combat_end') {
    return {
      id: `banner-end-${Date.now()}`,
      text: '',
      isMechanicalEvent: true,
      mechanicalSummary: { type: 'combat_end' },
      createdAt: new Date().toISOString(),
    };
  }
  return {
    id: `banner-start-${Date.now()}`,
    text: '',
    isMechanicalEvent: true,
    mechanicalSummary: {
      type: 'combat_start',
      round: cs?.round ?? 1,
      initiativeOrder: cs?.initiativeOrder ?? [],
    },
    createdAt: new Date().toISOString(),
  };
}

// ─── Party Tab ────────────────────────────────────────────────────────────────

const COMBAT_STAT_META: Record<string, { labelColor: string; description: string }> = {
  HP:   { labelColor: 'text-red-400',    description: 'Your remaining hit points. Reach 0 and you fall unconscious — allies must stabilize you before you die.' },
  AC:   { labelColor: 'text-blue-500',   description: 'Armor Class — how hard you are to hit. An attacker must roll this number or higher to land a strike.' },
  Atk:  { labelColor: 'text-orange-500', description: 'Your attack bonus added to the d20 roll whenever you strike. Higher means you hit more reliably.' },
  Init: { labelColor: 'text-amber-500',  description: 'Initiative modifier rolled at the start of combat. Higher means you act earlier in the turn order.' },
};


function abilityModColor(score: number, isActive: boolean): string {
  if (isActive) return 'text-slate-800';
  const mod = Math.floor((score - 10) / 2);
  if (mod > 0) return 'text-emerald-600';
  if (mod < 0) return 'text-red-500';
  return 'text-slate-500';
}

function CharacterSheet({ stats, isCombat, isOwn, onFeatureActivate }: {
  stats: CharacterStats;
  isCombat: boolean;
  isOwn: boolean;
  onFeatureActivate?: (label: string) => void;
}) {
  const [featureTooltip, setFeatureTooltip] = useState<string | null>(null);
  const [activeStat, setActiveStat] = useState<string | null>(null);
  const [activeAbility, setActiveAbility] = useState('STR');
  const features = CLASS_FEATURES[stats.characterClass] ?? [];

  const skillsModifiers = stats.skillsModifiers as Record<string, number>;
  const activeSkills = Object.entries(skillsModifiers)
    .filter(([skill]) => SKILL_ABILITY[skill] === activeAbility)
    .sort(([a], [b]) => a.localeCompare(b));

  const atkMod = stats.attackBonus >= 0 ? `+${stats.attackBonus}` : `${stats.attackBonus}`;
  const initMod = stats.initiativeMod >= 0 ? `+${stats.initiativeMod}` : `${stats.initiativeMod}`;
  const hpPct = stats.maxHp > 0 ? stats.currentHp / stats.maxHp : 1;
  const hpValueColor = hpPct > 0.6 ? 'text-emerald-600' : hpPct > 0.3 ? 'text-yellow-600' : 'text-red-600';
  const combatStats = [
    { key: 'HP',   label: 'HP',   value: `${stats.currentHp}/${stats.maxHp}`, valueColor: hpValueColor },
    { key: 'AC',   label: 'AC',   value: String(stats.ac),                     valueColor: 'text-slate-800' },
    { key: 'Atk',  label: 'Atk',  value: atkMod,                               valueColor: 'text-slate-800' },
    { key: 'Init', label: 'Init', value: initMod,                              valueColor: 'text-slate-800' },
  ];

  return (
    <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5">
      {/* Combat stats */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Combat</p>
        <div className="grid grid-cols-4 gap-2">
          {combatStats.map(s => {
            const meta = COMBAT_STAT_META[s.key];
            const isActive = activeStat === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActiveStat(a => a === s.key ? null : s.key)}
                className={`bg-white rounded-lg px-1.5 py-2.5 text-center border transition-all active:scale-[0.97] ${
                  isActive ? 'border-slate-300 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div className={`text-xs font-semibold leading-none mb-1.5 ${meta.labelColor}`}>{s.label}</div>
                <div className={`text-2xl font-bold tracking-tight ${s.valueColor}`}>{s.value}</div>
              </button>
            );
          })}
        </div>
        {activeStat && COMBAT_STAT_META[activeStat] && (() => {
          const dexMod = Math.floor((stats.baseDexterity - 10) / 2);
          const strMod = Math.floor((stats.baseStrength - 10) / 2);
          const profBonus = stats.level >= 5 ? 3 : 2;
          const fmt = (n: number) => n >= 0 ? `+${n}` : `${n}`;

          let rows: { label: string; value: string }[] = [];
          if (activeStat === 'HP') {
            rows = [
              { label: 'Current', value: `${stats.currentHp}` },
              { label: 'Maximum', value: `${stats.maxHp}` },
            ];
          } else if (activeStat === 'AC') {
            const baseAC = 10 + dexMod;
            const gearAC = stats.ac - baseAC;
            rows = [
              { label: `Base (10 + DEX ${fmt(dexMod)})`, value: `${baseAC}` },
              ...(gearAC !== 0 ? [{ label: 'Gear bonus', value: fmt(gearAC) }] : []),
              { label: 'Total', value: `${stats.ac}` },
            ];
          } else if (activeStat === 'Atk') {
            rows = [
              { label: `STR modifier`, value: fmt(strMod) },
              { label: `Proficiency (lvl ${stats.level})`, value: `+${profBonus}` },
              { label: 'Total', value: fmt(stats.attackBonus) },
            ];
          } else if (activeStat === 'Init') {
            rows = [
              { label: 'DEX modifier', value: fmt(dexMod) },
            ];
          }

          return (
            <div className="mt-2 bg-slate-50 rounded-lg px-3 py-2 space-y-1">
              {rows.map(r => (
                <div key={r.label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{r.label}</span>
                  <span className="font-mono font-medium text-slate-700">{r.value}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Class features */}
      {features.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Features</p>
          {isCombat ? (
            <div className="flex flex-col gap-2">
              {features.map(f => (
                <div key={f.id} className="flex flex-col gap-0.5">
                  <button
                    onClick={() => { if (isOwn && onFeatureActivate) onFeatureActivate(f.label); }}
                    className={`self-start text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      isOwn
                        ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-slate-200 text-slate-300 cursor-default'
                    }`}
                  >
                    {f.label}
                  </button>
                  <p className="text-xs text-slate-500 pl-1">{f.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {features.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { if (!isOwn) return; setFeatureTooltip(t => t === f.id ? null : f.id); }}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                      isOwn
                        ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        : 'border-slate-200 text-slate-300 cursor-default'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {featureTooltip && (() => {
                const f = features.find(x => x.id === featureTooltip);
                return f ? (
                  <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    {f.description}
                  </p>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}

      {/* Abilities + Skills folder */}
      <div>
        {/* Section header */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Abilities</p>
          <p className="text-xs font-medium text-amber-600">★ = proficient</p>
        </div>

        {/* Tab row */}
        <div className="grid grid-cols-6 border-b border-slate-200">
          {ABILITY_LABELS.map(({ key, short }) => {
            const score = stats[key] as number;
            const isActive = activeAbility === short;
            return (
              <button
                key={short}
                onClick={() => setActiveAbility(short)}
                className={`py-2 text-center transition-colors relative ${
                  isActive
                    ? 'bg-white border-x border-t border-slate-200 rounded-t-lg -mb-px z-10'
                    : 'hover:bg-slate-100'
                }`}
              >
                <div className={`text-xs font-semibold leading-none mb-1 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {short}
                </div>
                <div className={`text-base font-bold leading-none mb-0.5 ${abilityModColor(score, isActive)}`}>
                  {abilityMod(score)}
                </div>
                <div className={`text-xs leading-none ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                  {score}
                </div>
              </button>
            );
          })}
        </div>

        {/* Skill panel */}
        <div className="border-x border-b border-slate-200 rounded-b-lg bg-white px-3 py-3">
          <p className="text-sm font-semibold text-slate-700 mb-1">
            {ABILITY_LABELS.find(l => l.short === activeAbility)?.full}
          </p>
          <p className="text-xs text-slate-500">
            {ABILITY_DESCRIPTIONS[activeAbility]}
          </p>
          {activeSkills.length > 0 && <div className="border-t border-slate-100 my-3" />}
          {activeSkills.length > 0 ? (
            <div className="space-y-2.5">
              {activeSkills.map(([skill, mod]) => {
                const prof = stats.skillProficiencies.includes(skill);
                const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
                return (
                  <div key={skill}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${prof ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>
                        {prof && <span className="text-amber-500">★ </span>}
                        {skill}
                      </span>
                      <span className={`text-xs font-mono ${prof ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                        {modStr}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {SKILL_DESCRIPTIONS[skill]}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              {ABILITY_PASSIVE_NOTES[activeAbility] ?? 'No skills for this ability.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PartyTab({ characterStats, gameState, onFeatureActivate, partyMembers, characterId }: {
  characterStats: CharacterStats | null;
  gameState: 'exploration' | 'combat';
  onFeatureActivate: (label: string) => void;
  partyMembers: PartyMemberInfo[];
  characterId: string;
}) {
  if (!characterStats) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }
  const others = partyMembers.filter(m => m.characterId !== characterId);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Party roster strip */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {/* Self */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-indigo-300 overflow-hidden">
            <img src={classSprite(characterStats.characterClass)} alt={characterStats.characterClass} className="w-full h-full object-cover" />
          </div>
          <span className="text-xs text-slate-800 font-semibold leading-tight">{characterStats.name}</span>
          <span className="text-xs text-slate-500">{characterStats.characterClass}</span>
          <span className={`text-xs ${characterStats.currentHp / characterStats.maxHp < 0.3 ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
            {characterStats.currentHp}/{characterStats.maxHp} HP
          </span>
        </div>
        {/* Others */}
        {others.map(m => (
          <div key={m.characterId} className="flex flex-col items-center gap-0.5 flex-shrink-0">
            <div className={`w-14 h-14 rounded-full overflow-hidden border-2 ${m.isDead ? 'border-slate-300 opacity-50' : m.isDormant ? 'border-yellow-300' : 'border-slate-200'}`}>
              {m.avatarUrl
                ? <img src={m.avatarUrl} alt={m.characterName} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-slate-100 flex items-center justify-center text-2xl">{classEmoji(m.characterClass)}</div>}
            </div>
            <span className="text-xs text-slate-800 font-semibold leading-tight max-w-[60px] truncate">{m.characterName}</span>
            <span className="text-xs text-slate-500">{m.characterClass}</span>
            <span className={`text-xs ${m.currentHp / m.maxHp < 0.3 ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
              {m.currentHp}/{m.maxHp} HP
            </span>
            {m.isDead && <span className="text-[10px] text-slate-400">☠ Dead</span>}
            {m.isDormant && !m.isDead && <span className="text-[10px] text-yellow-600">Away</span>}
            {!m.isInSameRoom && <span className="text-[10px] text-slate-400 truncate max-w-[60px]">{m.currentRoom}</span>}
          </div>
        ))}
      </div>
      <CharacterSheet
        stats={characterStats}
        isCombat={gameState === 'combat'}
        isOwn={true}
        onFeatureActivate={onFeatureActivate}
      />
    </div>
  );
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────

// ─── UseButtons ──────────────────────────────────────────────────────────────

function UseButtons({ item, isCombat, availablePois, partyMembers, canUse, canEquip, onExplorationAction, onAllyPick, onPoiPick }: {
  item: ItemDefinition;
  isCombat: boolean;
  availablePois: { id: string; name: string }[];
  partyMembers: { id: string; name: string }[];
  canUse: boolean;
  canEquip: boolean;
  onExplorationAction: (text: string, hint: string) => void;
  onAllyPick: (item: ItemDefinition) => void;
  onPoiPick: (item: ItemDefinition) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 pt-0.5" onClick={e => e.stopPropagation()}>
      {isCombat ? (
        item.combat_usable && (
          <button onClick={() => onAllyPick(item)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            Use on…
          </button>
        )
      ) : (
        <>
          {canUse && availablePois.length > 0 && (
            <button onClick={() => onPoiPick(item)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Use on…
            </button>
          )}
          {canUse && partyMembers.length > 0 && (
            <button onClick={() => onAllyPick(item)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Use on ally
            </button>
          )}
          {canUse && (
            <button
              onClick={() => onExplorationAction(`use ${item.name}`, 'use_item')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Use
            </button>
          )}
          {canEquip && (
            <button
              onClick={() => onExplorationAction(`equip ${item.name}`, 'equip')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Equip
            </button>
          )}
          <button
            onClick={() => onExplorationAction(`drop ${item.name}`, 'drop')}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            Drop
          </button>
        </>
      )}
    </div>
  );
}

const SLOT_GROUPS = [
  { label: 'Weapons',     slots: ['main_hand', 'off_hand'] as const },
  { label: 'Armor',       slots: ['head', 'chest', 'legs', 'feet'] as const },
  { label: 'Accessories', slots: ['ring', 'amulet'] as const },
];

const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off-Hand',
  head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet',
  ring: 'Ring', amulet: 'Amulet',
};

const BONUS_LABELS: Record<string, string> = {
  ac: 'AC', damage: 'DMG', to_hit: 'HIT', hp: 'HP',
};

function fmtBonus(bonus: Record<string, number>): string {
  return Object.entries(bonus)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${BONUS_LABELS[k] ?? k.toUpperCase()}`)
    .join(' · ');
}

function bagBadge(item: ItemDefinition): string {
  if (!item.equip_slot) return item.consumable || item.use_effect ? 'C' : '·';
  if (item.equip_slot === 'main_hand' || item.equip_slot === 'off_hand') return 'W';
  if (['head', 'chest', 'legs', 'feet'].includes(item.equip_slot)) return 'A';
  return 'X';
}

function InventoryTab({ characterInventory, gameState, onExplorationAction, onCombatUse, proximityPoi, availablePois, partyMembers, combatState }: {
  characterInventory: CharacterInventory | null;
  gameState: 'exploration' | 'combat';
  onExplorationAction: (text: string, hint: string) => void;
  onCombatUse: (item: ItemDefinition, targetName?: string) => void;
  proximityPoi: { id: string; name: string } | null;
  availablePois: { id: string; name: string }[];
  partyMembers: { id: string; name: string }[];
  combatState: CombatState | null;
}) {
  const isCombat = gameState === 'combat';
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [expandedBagIdx, setExpandedBagIdx] = useState<number | null>(null);
  const [allyPickerItem, setAllyPickerItem] = useState<ItemDefinition | null>(null);
  const [poiPickerItem, setPoiPickerItem] = useState<ItemDefinition | null>(null);

  if (!characterInventory) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  // Aggregate equip_bonus across all equipped items for the gear banner
  const gearBonus: Record<string, number> = {};
  for (const item of Object.values(characterInventory.equipped)) {
    if (!item?.equip_bonus) continue;
    for (const [k, v] of Object.entries(item.equip_bonus)) {
      gearBonus[k] = (gearBonus[k] ?? 0) + v;
    }
  }
  const gearBonusEntries = Object.entries(gearBonus).filter(([, v]) => v > 0);

  const allyCombatTargets = combatState?.initiativeOrder
    .map(e => ({ id: e.id, name: e.name })) ?? partyMembers;

  return (
    <div className="flex-1 overflow-y-auto px-4">

      {/* ── Ally picker overlay ── */}
      {allyPickerItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setAllyPickerItem(null)}>
          <div className="bg-white rounded-t-2xl shadow-xl max-h-[40vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Use {allyPickerItem.name} on…</span>
              <button onClick={() => setAllyPickerItem(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1">
              {(isCombat ? allyCombatTargets : partyMembers).map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (isCombat) onCombatUse(allyPickerItem, m.name);
                    else onExplorationAction(`use ${allyPickerItem.name} on ${m.name}`, 'use_item');
                    setAllyPickerItem(null);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300"
                >
                  <p className="text-sm font-medium text-slate-800">{m.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── POI picker overlay ── */}
      {poiPickerItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setPoiPickerItem(null)}>
          <div className="bg-white rounded-t-2xl shadow-xl max-h-[40vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Use {poiPickerItem.name} on…</span>
              <button onClick={() => setPoiPickerItem(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1">
              {availablePois
                .sort((a, b) => (b.id === proximityPoi?.id ? 1 : 0) - (a.id === proximityPoi?.id ? 1 : 0))
                .map(poi => (
                  <button
                    key={poi.id}
                    onClick={() => {
                      onExplorationAction(`use ${poiPickerItem.name} on ${poi.name}`, 'use_item');
                      setPoiPickerItem(null);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl border hover:bg-indigo-50 hover:border-indigo-300 transition-colors border-slate-200"
                  >
                    <p className="text-sm font-medium text-slate-800">{poi.name}</p>
                    {poi.id === proximityPoi?.id && (
                      <p className="text-[10px] text-slate-400 mt-0.5">nearby</p>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Gear bonus cards ── */}
      {gearBonusEntries.length > 0 && (
        <div className="py-3 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Total Gear Bonus</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(gearBonusEntries.length, 4)}, minmax(0, 1fr))` }}>
            {gearBonusEntries.map(([k, v]) => {
              const labelColor = k === 'ac' ? 'text-blue-500' : k === 'hp' ? 'text-red-400' : 'text-orange-500';
              return (
                <div key={k} className="bg-white rounded-lg px-1.5 py-2.5 text-center border border-slate-200">
                  <div className={`text-xs font-semibold leading-none mb-1.5 ${labelColor}`}>
                    {BONUS_LABELS[k] ?? k.toUpperCase()}
                  </div>
                  <div className="text-2xl font-bold tracking-tight text-emerald-600">+{v}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Equipped ── */}
      <div className="py-3 space-y-4 border-b border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Equipped</p>
        {SLOT_GROUPS.map(({ label, slots }) => (
          <div key={label}>
            <p className="text-[10px] text-slate-400 mb-1.5">{label}</p>
            <div className="space-y-1">
              {slots.map((slot) => {
                const item = characterInventory.equipped[slot];
                const isExpanded = expandedSlot === slot;

                if (!item) {
                  return (
                    <div key={slot} className="rounded-xl border border-dashed border-slate-200 px-3 py-2">
                      <p className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider leading-none mb-0.5">{SLOT_LABELS[slot]}</p>
                      <p className="text-sm text-slate-300">Empty</p>
                    </div>
                  );
                }

                return (
                  <div
                    key={slot}
                    onClick={() => setExpandedSlot(isExpanded ? null : slot)}
                    className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 cursor-pointer select-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-amber-600 uppercase tracking-wider leading-none mb-0.5">
                          {SLOT_LABELS[slot]}
                        </p>
                        <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                      </div>
                      <span className="text-[10px] text-slate-300 shrink-0">{isExpanded ? '▴' : '▾'}</span>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-amber-200 space-y-1.5">
                        {item.description && (
                          <p className="text-xs text-slate-600 italic">{item.description}</p>
                        )}
                        {item.passive_effect && (
                          <p className="text-xs text-slate-500">{item.passive_effect}</p>
                        )}
                        {item.equip_bonus && Object.keys(item.equip_bonus).length > 0 && (
                          <p className="text-xs font-medium text-emerald-700">{fmtBonus(item.equip_bonus)}</p>
                        )}
                        {!isCombat && (
                          <div className="flex justify-end">
                            <button
                              onClick={(e) => { e.stopPropagation(); onExplorationAction(`unequip ${item.name}`, 'unequip'); }}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              Unequip
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Backpack ── */}
      <div className="py-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Backpack</p>
          {characterInventory.bag.length > 0 && (
            <span className="text-[10px] text-slate-300">{characterInventory.bag.length} items</span>
          )}
        </div>
        {characterInventory.bag.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Empty</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {characterInventory.bag.map((item, i) => {
              const isExpanded = expandedBagIdx === i;
              const canEquip = !!item.equip_slot;
              const canUse = !!(item.consumable || item.use_effect);
              const bonusStr = item.equip_bonus && Object.keys(item.equip_bonus).length > 0
                ? fmtBonus(item.equip_bonus) : null;

              // Stat diff vs current slot item
              let diffLine: { vs: string; entries: [string, number][] } | null = null;
              if (canEquip && item.equip_slot) {
                const currentItem = characterInventory.equipped[item.equip_slot];
                const myBonus = item.equip_bonus ?? {};
                const theirBonus = currentItem?.equip_bonus ?? {};
                const allKeys = new Set([...Object.keys(myBonus), ...Object.keys(theirBonus)]);
                const entries = [...allKeys]
                  .map(k => [k, (myBonus[k] ?? 0) - (theirBonus[k] ?? 0)] as [string, number])
                  .filter(([, v]) => v !== 0);
                diffLine = { vs: currentItem?.name ?? 'empty slot', entries };
              }

              return (
                <div
                  key={`${item.id ?? 'item'}-${i}`}
                  onClick={() => setExpandedBagIdx(isExpanded ? null : i)}
                  className="flex items-start gap-2.5 py-2 cursor-pointer select-none"
                >
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center bg-slate-100 text-slate-500">
                    {bagBadge(item)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {item.name}{item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}
                      </p>
                      <span className="shrink-0 text-[10px] text-slate-300">{isExpanded ? '▴' : '▾'}</span>
                    </div>
                    {bonusStr && !isExpanded && (
                      <p className="text-[11px] text-emerald-700">{bonusStr}</p>
                    )}
                    {isExpanded && (
                      <div className="mt-1.5 space-y-1.5">
                        {item.description && (
                          <p className="text-xs text-slate-600 italic">{item.description}</p>
                        )}
                        {item.passive_effect && (
                          <p className="text-xs text-slate-500">{item.passive_effect}</p>
                        )}
                        {bonusStr && (
                          <p className="text-xs font-medium text-emerald-700">{bonusStr}</p>
                        )}
                        {diffLine && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-0.5">vs {diffLine.vs}</p>
                            {diffLine.entries.length === 0 ? (
                              <p className="text-[10px] text-slate-400 italic">No numeric difference</p>
                            ) : (
                              <div className="flex flex-wrap gap-x-2">
                                {diffLine.entries.map(([k, v]) => (
                                  <span key={k} className={`text-xs font-bold ${v > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {v > 0 ? '+' : ''}{v}{' '}{BONUS_LABELS[k] ?? k.toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <UseButtons
                          item={item}
                          isCombat={isCombat}
                          availablePois={availablePois}
                          partyMembers={partyMembers}
                          canUse={canUse}
                          canEquip={canEquip}
                          onExplorationAction={onExplorationAction}
                          onAllyPick={(i) => setAllyPickerItem(i)}
                          onPoiPick={(i) => setPoiPickerItem(i)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Item Picker Sheet ────────────────────────────────────────────────────────

function ItemPickerSheet({ items, targets, onSelect, onDismiss }: {
  items: ItemDefinition[];
  targets: { id: string; name: string; hp: number; maxHp: number }[];
  onSelect: (chip: string) => void;
  onDismiss: () => void;
}) {
  const [selectedItem, setSelectedItem] = useState<ItemDefinition | null>(null);

  const combatUsable = items.filter(i => i.combat_usable);

  function handleItemTap(item: ItemDefinition) {
    const targets = item.target ? (Array.isArray(item.target) ? item.target : [item.target]) : ['self'];
    const needsPicker = targets.some(t => t === 'ally' || t === 'enemy');
    if (needsPicker) {
      setSelectedItem(item);
    } else {
      onSelect(`Use: ${item.name}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onDismiss}>
      <div
        className="bg-white rounded-t-2xl shadow-xl max-h-[55vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-800">
            {selectedItem ? `Target for ${selectedItem.name}` : 'Use Item'}
          </span>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-1">
          {selectedItem ? (
            targets.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No targets available.</p>
            ) : (
              targets.map(t => (
                <button
                  key={t.id}
                  onClick={() => onSelect(`Use: ${selectedItem.name} → ${t.name}`)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                >
                  <p className="text-sm font-medium text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">HP {t.hp}/{t.maxHp}</p>
                </button>
              ))
            )
          ) : combatUsable.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nothing usable in combat.</p>
          ) : (
            combatUsable.map(item => (
              <button
                key={item.id}
                onClick={() => handleItemTap(item)}
                className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
              >
                <p className="text-sm font-medium text-slate-800">{item.name}{item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}</p>
                {item.use_effect && <p className="text-xs text-slate-400 mt-0.5">{item.use_effect}</p>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Action Chips ─────────────────────────────────────────────────────────────

const STANDARD_CHIPS = [
  { id: 'attack',     label: 'Attack' },
  { id: 'dodge',      label: 'Dodge' },
  { id: 'dash',       label: 'Dash' },
  { id: 'disengage',  label: 'Disengage' },
  { id: 'hide',       label: 'Hide' },
  { id: 'use_item',   label: 'Use Item' },
  { id: 'provoke',    label: 'Provoke' },
];

const CUNNING_SUB = [
  { id: 'cunning_hide',       label: 'Hide' },
  { id: 'cunning_dash',       label: 'Dash' },
  { id: 'cunning_disengage',  label: 'Disengage' },
];

function TurnBadge({ label, used }: { label: string; used: boolean }) {
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${used ? 'text-slate-300' : 'text-emerald-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${used ? 'bg-slate-300' : 'bg-emerald-400'}`} />
      {label}
    </span>
  );
}

function ActionChips({ characterStats, characterInventory, combatState, chip, setChip, onOpenItemSheet, onEndTurn }: {
  characterStats: CharacterStats | null;
  characterInventory: CharacterInventory | null;
  combatState: CombatState | null;
  chip: string | null;
  setChip: (v: string | null) => void;
  onOpenItemSheet: () => void;
  onEndTurn: () => void;
}) {
  const [showCunningPicker, setShowCunningPicker] = useState(false);
  const [confirmingEndTurn, setConfirmingEndTurn] = useState(false);

  const actionUsed = combatState?.currentTurnUsage.actionUsed ?? false;
  const bonusUsed  = combatState?.currentTurnUsage.bonusActionUsed ?? false;
  const moveUsed   = combatState?.currentTurnUsage.movementUsed ?? false;
  const hasCombatItems = (characterInventory?.bag ?? []).some(i => i.combat_usable);
  const features = CLASS_FEATURES[characterStats?.characterClass ?? ''] ?? [];

  const unusedResources: string[] = [];
  if (!actionUsed) unusedResources.push('action');
  if (!bonusUsed) unusedResources.push('bonus action');
  if (!moveUsed) unusedResources.push('movement');
  const allUsed = unusedResources.length === 0;

  function formatUnused(): string {
    if (unusedResources.length === 1) return unusedResources[0];
    if (unusedResources.length === 2) return `${unusedResources[0]} and ${unusedResources[1]}`;
    return `${unusedResources[0]}, ${unusedResources[1]}, and ${unusedResources[2]}`;
  }

  const confirmMessage = unusedResources.length === 3
    ? "You haven't taken any actions. End turn and forfeit your turn?"
    : `You still have your ${formatUnused()}. End turn anyway?`;

  function handleEndTurnTap() {
    if (allUsed) {
      onEndTurn();
    } else {
      setConfirmingEndTurn(true);
    }
  }

  const endTurnBtnCls = allUsed
    ? 'border-indigo-400 text-indigo-700 bg-indigo-50 font-semibold'
    : actionUsed
    ? 'border-slate-300 text-slate-500'
    : 'border-slate-200 text-slate-300';

  function tapChip(label: string) {
    setChip(chip === label ? null : label);
  }

  function tapCunning(sublabel: string) {
    setChip(`Cunning Action: ${sublabel}`);
    setShowCunningPicker(false);
  }

  return (
    <div className="bg-white border-t border-slate-100 flex-shrink-0">
      {combatState && (
        <div className="flex items-center justify-between px-4 pt-2 pb-0">
          <div className="flex items-center gap-4">
            <TurnBadge label="Action" used={actionUsed} />
            <TurnBadge label="Bonus"  used={bonusUsed} />
            <TurnBadge label="Move"   used={moveUsed} />
          </div>
          <button
            onClick={handleEndTurnTap}
            className={`text-xs px-3 py-1 rounded-full border transition-all ${endTurnBtnCls}`}
          >
            End Turn →
          </button>
        </div>
      )}
      {confirmingEndTurn && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-100">
          <span className="text-xs text-amber-800 flex-1">{confirmMessage}</span>
          <button
            onClick={() => setConfirmingEndTurn(false)}
            className="text-xs font-medium text-slate-500 px-2 py-1 flex-shrink-0"
          >
            Cancel
          </button>
          <button
            onClick={() => { setConfirmingEndTurn(false); onEndTurn(); }}
            className="text-xs font-medium text-red-600 px-2 py-1 flex-shrink-0"
          >
            End Turn
          </button>
        </div>
      )}
      {showCunningPicker && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Cunning Action — use as:</span>
          {CUNNING_SUB.map(c => (
            <button
              key={c.id}
              onClick={() => tapCunning(c.label)}
              className="px-2.5 py-1 rounded-full border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50 text-xs font-medium whitespace-nowrap flex-shrink-0"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto px-4 py-2" style={{ scrollbarWidth: 'none' }}>
        {STANDARD_CHIPS.map(c => {
          const isUseItem = c.id === 'use_item';
          const greyed = actionUsed || (isUseItem && !hasCombatItems);
          const isActive = chip?.startsWith('Use:') && isUseItem ? true : chip === c.label;
          return (
            <button
              key={c.id}
              disabled={actionUsed}
              onClick={() => {
                if (isUseItem) onOpenItemSheet();
                else tapChip(c.label);
              }}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : greyed
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {c.label}
            </button>
          );
        })}
        {features.map(f => {
          const isCunning = !!f.cunning;
          const isActive = isCunning ? chip?.startsWith('Cunning Action') : chip === f.label;
          return (
            <button
              key={f.id}
              disabled={bonusUsed}
              onClick={() => {
                if (bonusUsed) return;
                if (isCunning) setShowCunningPicker(p => !p);
                else tapChip(f.label);
              }}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : bonusUsed
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                  : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
              }`}
            >
              {f.label} ●
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab({ history, hasMore, loadingMore, loadMore, sending, error, input, setInput, sendAction, handleKeyDown, chip, setChip, gameState, combatState, characterStats, characterInventory, chatEndRef, chatContainerRef, showResumeCard, onDismissResume, roomName, characterId, partyMembers, onEndTurn }: {
  history: HistoryEntry[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  sending: boolean;
  error: string;
  input: string;
  setInput: (v: string) => void;
  sendAction: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  chip: string | null;
  setChip: (v: string | null) => void;
  gameState: 'exploration' | 'combat';
  combatState: CombatState | null;
  characterStats: CharacterStats | null;
  characterInventory: CharacterInventory | null;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  showResumeCard: boolean;
  onDismissResume: () => void;
  roomName: string;
  characterId: string;
  partyMembers: PartyMemberInfo[];
  onEndTurn: () => void;
}) {
  const [showItemSheet, setShowItemSheet] = useState(false);

  const combatUsableItems = characterInventory?.bag.filter(i => i.combat_usable) ?? [];
  const partyTargets = combatState?.initiativeOrder
    .map(e => ({ id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp })) ?? [];

  function handleOpenItemSheet() {
    const items = characterInventory?.bag.filter(i => i.combat_usable) ?? [];
    const needsPicker = (i: ItemDefinition) => { const t = i.target ? (Array.isArray(i.target) ? i.target : [i.target]) : ['self']; return t.some(v => v === 'ally' || v === 'enemy'); };
    if (items.length === 1 && !needsPicker(items[0])) {
      setChip(`Use: ${items[0].name}`);
    } else {
      setShowItemSheet(true);
    }
  }

  return (
    <>
      {showItemSheet && (
        <ItemPickerSheet
          items={combatUsableItems}
          targets={partyTargets}
          onSelect={chip => { setChip(chip); setShowItemSheet(false); }}
          onDismiss={() => setShowItemSheet(false)}
        />
      )}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {hasMore && (
          <div className="flex justify-center mb-3">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-40 px-3 py-1 border border-slate-200 rounded-full"
            >
              {loadingMore ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {history.length === 0 && !sending && (
          <p className="text-center text-slate-400 text-sm mt-8">Loading…</p>
        )}
        {history.map(entry => (
          <ChatMessage key={entry.id} entry={entry} characterId={characterId} />
        ))}
        {showResumeCard && gameState === 'exploration' && (
          <ExplorationResumeCard
            roomName={roomName}
            partyMembers={partyMembers}
            lastDmMessage={history.filter(e => !e.mechanicalSummary || (e.mechanicalSummary as { type?: string }).type !== 'player_action').at(-1)?.text ?? null}
            onDismiss={onDismissResume}
          />
        )}
        {showResumeCard && gameState === 'combat' && combatState && (
          <CombatResumeCard combatState={combatState} roomName={roomName} characterId={characterId} onDismiss={onDismissResume} />
        )}
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

      {gameState === 'combat' && (
        <ActionChips
          characterStats={characterStats}
          characterInventory={characterInventory}
          combatState={combatState}
          chip={chip}
          setChip={setChip}
          onOpenItemSheet={handleOpenItemSheet}
          onEndTurn={onEndTurn}
        />
      )}

      <div className="px-4 pt-2 pb-3 bg-white border-t border-slate-200 flex-shrink-0">
        {(() => {
          const isMyTurn = gameState !== 'combat' || !combatState || combatState.activeActorId === characterId;
          if (!isMyTurn) {
            const activeActor = combatState?.initiativeOrder.find(e => e.id === combatState.activeActorId);
            const actorName = activeActor?.name ?? 'Someone';
            return (
              <div className="flex items-center justify-center gap-2 py-3 px-4 bg-slate-100 rounded-xl text-slate-500 text-sm">
                <span className="animate-pulse">⏳</span>
                <span>Waiting for <span className="font-semibold text-slate-700">{actorName}</span>…</span>
              </div>
            );
          }
          if (chip) {
            return (
              <>
                <div className="flex mb-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                    {chip}
                    <button onClick={() => setChip(null)} className="text-indigo-400 hover:text-indigo-600 leading-none ml-0.5" aria-label="Remove chip">×</button>
                  </span>
                </div>
                {renderChatInput()}
              </>
            );
          }
          return renderChatInput();
          function renderChatInput() {
            const allActionsUsed = gameState === 'combat' &&
              (combatState?.currentTurnUsage.actionUsed ?? false) &&
              (combatState?.currentTurnUsage.bonusActionUsed ?? false) &&
              (combatState?.currentTurnUsage.movementUsed ?? false);
            return (
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder={allActionsUsed ? 'All actions used — press End Turn' : 'What do you do? (Enter to send)'}
                  className={`flex-1 resize-none border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${allActionsUsed ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed' : 'border-slate-300'}`}
                  disabled={sending || allActionsUsed}
                />
                <button
                  onClick={sendAction}
                  disabled={sending || !input.trim() || allActionsUsed}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            );
          }
        })()}
      </div>
    </>
  );
}

// ─── Initiative Strip ─────────────────────────────────────────────────────────

const CLASS_FEATURES: Record<string, Array<{ id: string; label: string; description: string; cunning?: boolean }>> = {
  Artificer: [{ id: 'infuse_item', label: '⚙️ Infuse Item', description: 'Infuse mundane items with magical properties during a long rest. Active infusions (2 at level 2, scaling up) persist until you die or re-prepare.' }],
  Barbarian: [{ id: 'rage', label: '🪓 Rage', description: 'Bonus action: enter rage. +2 melee damage, advantage on STR checks/saves, resistance to bludgeoning/piercing/slashing damage for 1 minute.' }],
  Bard: [{ id: 'bardic_inspiration', label: '🎵 Bardic Inspiration', description: 'Bonus action: give an ally within 60 ft a Bardic Inspiration die (d6 → d12 at higher levels) to add to one roll within 10 minutes.' }],
  Cleric: [{ id: 'channel_divinity', label: '⛪ Channel Divinity', description: 'Channel divine power to turn undead or invoke your deity\'s domain ability. Once per short rest.' }],
  Druid: [{ id: 'wild_shape', label: '🐺 Wild Shape', description: 'Action: transform into a beast you\'ve seen. Max CR scales with level. 2 uses/short rest. Duration = half your Druid level in hours.' }],
  Fighter: [{ id: 'second_wind', label: '💨 Second Wind', description: 'Bonus action: recover 1d10 + your Fighter level in hit points. Once per short rest.' }],
  Monk: [{ id: 'ki', label: '🌀 Ki', description: 'Spend Ki points to fuel abilities: Flurry of Blows (2 unarmed strikes, bonus action), Patient Defense (Dodge, bonus action), Step of the Wind (Dash or Disengage, bonus action).' }],
  Paladin: [{ id: 'divine_smite', label: '⚡ Divine Smite', description: 'When you hit with a melee attack, expend a spell slot to deal +2d8 radiant damage per slot level (max 5d8). +1d8 extra against undead or fiends.' }],
  Ranger: [{ id: 'hunters_mark', label: "🏹 Hunter's Mark", description: "Bonus action: mark a creature. Deal +1d6 damage to it on each hit and gain advantage on Perception and Survival checks to find it. Concentration, up to 1 hour." }],
  Rogue: [{ id: 'cunning_action', label: '🗡️ Cunning Action', cunning: true, description: 'Bonus action to Dash, Disengage, or Hide — move fast or vanish without spending your main action.' }],
  Sorcerer: [{ id: 'metamagic', label: '🔥 Metamagic', description: 'Spend Sorcery Points to modify spells: Quickened Spell (bonus action cast, 2 pts), Twinned Spell (second target, 1–9 pts), Subtle Spell (no components, 1 pt), and others.' }],
  Warlock: [{ id: 'eldritch_blast', label: '👁️ Eldritch Blast', description: 'Your signature cantrip: 1d10 force damage at 120 ft. Extra beams at levels 5/11/17. Enhanced by Invocations like Agonizing Blast (+CHA mod) or Repelling Blast (push 10 ft).' }],
  Wizard: [{ id: 'arcane_recovery', label: '🔮 Arcane Recovery', description: 'After a short rest, recover spell slot levels equal to half your Wizard level (min 1). Once per long rest.' }],
};

function hpRingClass(hp: number, maxHp: number): string {
  if (hp === 0 || maxHp === 0) return 'border-slate-300 bg-slate-100';
  const pct = hp / maxHp;
  if (pct > 0.6) return 'border-emerald-400 bg-emerald-50';
  if (pct > 0.3) return 'border-yellow-400 bg-yellow-50';
  return 'border-red-400 bg-red-50';
}

function InitiativeStrip({ initiativeOrder, activeActorId, characterId, characterClass, selectedId, onSelect }: {
  initiativeOrder: InitiativeEntry[];
  activeActorId: string;
  characterId: string;
  characterClass: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const activeIconRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeIconRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeActorId]);

  return (
    <div
      className="flex gap-3 overflow-x-auto px-4 py-2 bg-red-700 border-b border-red-900 flex-shrink-0"
      style={{ scrollbarWidth: 'none' }}
    >
      {initiativeOrder.map(entry => {
        const isActive = entry.id === activeActorId;
        const isOwn = entry.id === characterId;
        const isDead = entry.hp === 0;
        const ringCls = hpRingClass(entry.hp, entry.maxHp);
        const isSelected = entry.id === selectedId;

        return (
          <button
            key={entry.id}
            ref={isActive ? activeIconRef : undefined}
            onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : entry.id); }}
            className={`flex flex-col items-center gap-0.5 flex-shrink-0 transition-all ${entry.acted && !isActive ? 'opacity-50 scale-[0.85]' : ''}`}
          >
            <span className={`text-xs leading-none ${isActive ? 'text-white' : 'text-transparent'}`}>▼</span>
            <div className={`w-10 h-10 rounded-full border-2 ${ringCls} relative overflow-hidden ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-red-700' : ''}`}>
              {isOwn
                ? <img src={classSprite(characterClass)} alt={characterClass} className="w-full h-full object-cover" />
                : <span className="w-full h-full flex items-center justify-center text-lg">👹</span>
              }
              {isDead && (
                <span className="absolute inset-0 flex items-center justify-center bg-slate-200/80 rounded-full text-base">💀</span>
              )}
            </div>
            <span className="text-xs text-red-100 truncate max-w-[48px] leading-tight">{entry.name.split(' ')[0]}</span>
            <span className="text-xs text-red-200 leading-tight">{entry.hp}/{entry.maxHp}</span>
          </button>
        );
      })}
    </div>
  );
}

function InitiativeMiniSheet({ entry, characterStats, isOwnCharacter, isCombat, onClose, onNavigateToChat }: {
  entry: InitiativeEntry;
  characterStats: CharacterStats | null;
  isOwnCharacter: boolean;
  isCombat: boolean;
  onClose: () => void;
  onNavigateToChat: () => void;
}) {
  const features = isOwnCharacter ? (CLASS_FEATURES[characterStats?.characterClass ?? ''] ?? []) : [];

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
      {isOwnCharacter && characterStats ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{entry.name}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
          <div className="flex gap-4 text-sm text-slate-600">
            <span>
              HP{' '}
              <span className={characterStats.currentHp / characterStats.maxHp < 0.3 ? 'text-red-500 font-semibold' : ''}>
                {characterStats.currentHp}/{characterStats.maxHp}
              </span>
            </span>
            <span>AC {characterStats.ac}</span>
            <span>Atk +{characterStats.attackBonus}</span>
          </div>
          {features.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {features.map(f => (
                <button
                  key={f.id}
                  onClick={() => { if (isCombat) { onNavigateToChat(); onClose(); } }}
                  className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
                    isCombat
                      ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                      : 'border-slate-200 text-slate-400 cursor-default'
                  }`}
                >
                  {f.label} ●
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{entry.name}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
          <div className="flex gap-4 text-sm text-slate-600">
            <span>HP {entry.hp}/{entry.maxHp}</span>
            <span>AC {entry.ac}</span>
            <span className="capitalize">Proximity: {entry.proximity}</span>
          </div>
          <div className="text-xs text-slate-400">
            {entry.status_effects.length > 0 ? `Status: ${entry.status_effects.join(', ')}` : 'Status: —'}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Message Types ────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  text: string;
  isMechanicalEvent: boolean;
  mechanicalSummary: Record<string, unknown> | null;
  createdAt: string;
  authorAvatarUrl?: string | null;
  authorName?: string | null;
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

interface CombatRollData {
  action: string;
  d20: number;
  modifier: number;
  total: number;
  vsTarget: string;
  success: boolean;
  isCrit?: boolean;
  damageRoll?: { dice: string; expr: string; total: number };
  rollMode?: 'advantage' | 'disadvantage';
  d20Rolls?: [number, number];
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

function CombatRollBadge({ data }: { data: CombatRollData }) {
  const modStr = data.modifier !== 0 ? (data.modifier > 0 ? `+${data.modifier}` : `${data.modifier}`) : '';
  return (
    <div className="my-2 flex flex-col gap-1.5">
      {/* Attack roll chip */}
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
        data.isCrit
          ? 'bg-amber-50 border-amber-300 text-amber-800'
          : data.success
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-slate-50 border-slate-200 text-slate-500'
      }`}>
        <span>🎲</span>
        <span className="font-semibold">{data.action}</span>
        <span className="text-slate-400 font-normal">
          d20{modStr}{data.rollMode ? ` (${data.rollMode === 'advantage' ? 'adv' : 'dis'})` : ''}
        </span>
        <span className="text-slate-400">→</span>
        <span className="font-bold">
          {data.d20Rolls ? `[${data.d20Rolls.join(', ')}]` : data.d20}{modStr} = {data.total}
        </span>
        <span className="text-slate-400">vs {data.vsTarget}</span>
        <span className={data.success ? (data.isCrit ? 'text-amber-600 font-bold' : 'text-emerald-600 font-semibold') : 'text-slate-400'}>
          {data.isCrit ? '✓ CRIT' : data.success ? '✓ HIT' : '✗ MISS'}
        </span>
      </div>
      {/* Damage roll chip */}
      {data.success && data.damageRoll && (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono w-fit border ${
          data.isCrit ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-orange-50 border-orange-200 text-orange-800'
        }`}>
          <span>⚔️</span>
          <span className="text-slate-400 font-normal">{data.damageRoll.dice}</span>
          <span className="text-slate-400">→</span>
          <span className="font-bold">{data.damageRoll.expr} = {data.damageRoll.total}</span>
          <span className="font-semibold">dmg</span>
        </div>
      )}
    </div>
  );
}

function CombatBanner({ type, round, initiativeSnapshot, characterId }: {
  type: 'combat_start' | 'combat_end';
  round?: number;
  initiativeSnapshot?: InitiativeEntry[];
  characterId?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (type === 'combat_end') {
    return (
      <div className="my-3 px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500 text-center">
        Combat ended — all enemies defeated
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-red-300 bg-red-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-semibold text-red-700">⚔ Combat started — Round {round ?? 1}</span>
        {initiativeSnapshot && initiativeSnapshot.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            {expanded ? 'Hide snapshot' : 'Show snapshot'}
          </button>
        )}
      </div>
      {expanded && initiativeSnapshot && (
        <div className="px-4 pb-2 space-y-1 border-t border-red-200 pt-2">
          {initiativeSnapshot.map(e => (
            <div key={e.id} className="flex items-center justify-between text-xs text-slate-600">
              <span>{e.name}{e.id === characterId ? ' (you)' : ''}</span>
              <span className="text-slate-400">Initiative {e.initiative}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function lastSeenText(d: Date | string | null | undefined): string {
  if (!d) return 'Never';
  const ms = Math.max(0, Date.now() - new Date(d).getTime());
  if (ms < 5 * 60 * 1000) return 'Online now';
  if (ms < 60 * 60 * 1000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)} day${Math.floor(ms / 86400000) === 1 ? '' : 's'} ago`;
}

function ExplorationResumeCard({ roomName, partyMembers, lastDmMessage, onDismiss }: {
  roomName: string;
  partyMembers: PartyMemberInfo[];
  lastDmMessage: string | null;
  onDismiss: () => void;
}) {
  return (
    <div className="my-3 mx-1 rounded-lg border border-teal-200 bg-teal-50 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-teal-100 border-b border-teal-200 font-medium text-teal-700">
        Exploring · {roomName}
      </div>
      {partyMembers.length > 0 && (
        <div className="px-3 py-2 space-y-1 border-b border-teal-100">
          {partyMembers.map(m => (
            <div key={m.characterId} className="flex items-center justify-between text-teal-700">
              <span className="font-medium">{m.characterName}{m.isDead ? ' †' : m.isDormant ? ' (away)' : ''}</span>
              <span className="text-teal-500">{lastSeenText(m.lastSeenAt)}</span>
            </div>
          ))}
        </div>
      )}
      {lastDmMessage && (
        <div className="px-3 py-2 border-b border-teal-100 text-teal-600 italic line-clamp-2">{lastDmMessage}</div>
      )}
      <div className="px-3 py-2 flex justify-center">
        <button onClick={onDismiss} className="text-teal-600 font-medium hover:text-teal-800 transition-colors">Resume Adventure →</button>
      </div>
    </div>
  );
}

function CombatResumeCard({ combatState, roomName, characterId, onDismiss }: {
  combatState: CombatState;
  roomName: string;
  characterId: string;
  onDismiss?: () => void;
}) {
  const living = combatState.initiativeOrder.filter(e => e.hp > 0);
  return (
    <div className="my-3 mx-1 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden text-xs">
      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 font-medium text-slate-600">
        Combat resumed · Round {combatState.round} · {roomName}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {living.map(e => {
          const isYou = e.id === characterId;
          const isActive = e.id === combatState.activeActorId;
          const acted = e.acted && !isActive;
          return (
            <div key={e.id} className="flex items-center justify-between text-slate-600">
              <span className="font-medium">{e.name}{isYou ? ' (you)' : ''}</span>
              <span className="flex items-center gap-2">
                <span className="text-slate-500">♥ {e.hp}/{e.maxHp}</span>
                <span className="text-slate-400">AC {e.ac}</span>
                {isActive && <span className="text-indigo-600 font-semibold">← your turn</span>}
                {acted && <span className="text-slate-400">(acted)</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-slate-200 text-center">
        {onDismiss
          ? <button onClick={onDismiss} className="text-indigo-600 font-medium hover:text-indigo-800 transition-colors">Resume →</button>
          : <span className="text-slate-400">Scroll up to see how this fight started.</span>
        }
      </div>
    </div>
  );
}

function ChatMessage({ entry, characterId }: { entry: HistoryEntry; characterId?: string }) {
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

  if (type === 'combat_roll') {
    return <CombatRollBadge data={summary as unknown as CombatRollData} />;
  }

  if (type === 'combat_start') {
    return (
      <CombatBanner
        type="combat_start"
        round={summary?.round as number | undefined}
        initiativeSnapshot={summary?.initiativeOrder as InitiativeEntry[] | undefined}
        characterId={characterId}
      />
    );
  }

  if (type === 'combat_end') {
    return <CombatBanner type="combat_end" />;
  }

  // DM narrative or player narrative
  const avatarUrl = entry.authorAvatarUrl;
  const authorName = entry.authorName;
  return (
    <div className="flex justify-start my-2 gap-2">
      <div className="flex-shrink-0 w-6 h-6 rounded-full overflow-hidden flex items-center justify-center bg-slate-100 text-xs mt-1">
        {avatarUrl
          ? <img src={avatarUrl} alt={authorName ?? 'DM'} width={24} height={24} className="w-full h-full object-cover" />
          : <span>🎲</span>}
      </div>
      <div className="max-w-sm px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm text-sm text-slate-700 leading-relaxed">
        {entry.text}
      </div>
    </div>
  );
}

function PlayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const characterId = searchParams.get('char');

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [oldestCursor, setOldestCursor] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [activeRoomInstanceId, setActiveRoomInstanceId] = useState('');
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [gameState, setGameState] = useState<'exploration' | 'combat'>('exploration');
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [characterStats, setCharacterStats] = useState<CharacterStats | null>(null);
  const [characterInventory, setCharacterInventory] = useState<CharacterInventory | null>(null);
  const [proximityPoi, setProximityPoi] = useState<{ id: string; name: string } | null>(null);
  const [partyMembers, setPartyMembers] = useState<PartyMemberInfo[]>([]);
  const [availablePois, setAvailablePois] = useState<{ id: string; name: string }[]>([]);
  const [chip, setChip] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [showResumeCard, setShowResumeCard] = useState(true);
  const [selectedStripEntryId, setSelectedStripEntryId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  // Ping lastSeenAt on mount
  useEffect(() => {
    fetch('/api/v2/user/ping', { method: 'POST' }).catch(() => {});
  }, []);

  // Resolve current room from session, then load initial history
  useEffect(() => {
    if (!sessionId || !characterId) {
      router.push('/v2/setup');
      return;
    }
    fetch(`/api/v2/session/current-room?sessionId=${sessionId}&characterId=${characterId}`)
      .then(r => r.json())
      .then(({ roomInstanceId }) => {
        if (!roomInstanceId) { router.push('/v2/setup'); return; }
        setActiveRoomInstanceId(roomInstanceId);
        return Promise.all([
          fetch(`/api/v2/room/history?sessionId=${sessionId}`).then(r => r.json()),
          fetch(`/api/v2/room/state?roomInstanceId=${roomInstanceId}&characterId=${characterId}`).then(r => r.json()),
        ]);
      })
      .then(result => {
        if (!result) return;
        const [{ logs, hasMore: more }, state] = result;
        const entries: HistoryEntry[] = logs ?? [];
        console.log('[history] initial load — count:', entries.length, 'hasMore:', more,
          'oldest:', entries[0]?.createdAt, 'newest:', entries[entries.length - 1]?.createdAt);
        setHistory(prev => {
          // Merge rather than replace: if sendAction already ran and populated state,
          // preserve those newer messages instead of wiping them with a stale load.
          const nonOptimistic = prev.filter(e => !e.id.startsWith('optimistic-'));
          if (nonOptimistic.length === 0) return entries;
          const existingIds = new Set(nonOptimistic.map(e => e.id));
          const olderEntries = entries.filter(e => !existingIds.has(e.id));
          return olderEntries.length > 0 ? [...olderEntries, ...prev] : prev;
        });
        setHasMore(more ?? false);
        setOldestCursor(entries.length > 0 ? entries[0].createdAt : null);
        if (state.roomName) setRoomName(state.roomName);
        if (state.gameState) setGameState(state.gameState);
        setCombatState(state.combatState ?? null);
        if (state.characterStats) setCharacterStats(state.characterStats);
        if (state.characterInventory) setCharacterInventory(state.characterInventory);
        setProximityPoi(state.characterProximityPoi ?? null);
        setPartyMembers(state.partyMembers ?? []);
        setAvailablePois(Object.entries((state.poiIndex as Record<string,string>) ?? {}).map(([id, name]) => ({ id, name })));
      });
  }, [sessionId, characterId]);

  // Poll room state every 3s — skip when it's my combat turn (I'm the one acting)
  useEffect(() => {
    if (!activeRoomInstanceId || !characterId) return;
    const isMyTurn = combatState?.activeActorId === characterId;
    if (isMyTurn) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v2/room/state?roomInstanceId=${activeRoomInstanceId}&characterId=${characterId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.gameState) setGameState(data.gameState as 'exploration' | 'combat');
        setCombatState(data.combatState ?? null);
        if (data.characterStats) setCharacterStats(data.characterStats);
        if (data.characterInventory) setCharacterInventory(data.characterInventory);
        setProximityPoi(data.characterProximityPoi ?? null);
        if (data.partyMembers) setPartyMembers(data.partyMembers);
        if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string, string>).map(([id, name]) => ({ id, name })));
        if (data.currentNarrative) {
          const incoming = data.currentNarrative as HistoryEntry[];
          setHistory(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const fresh = incoming.filter(e => !existingIds.has(e.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
        }
      } catch { /* silent */ }
    };
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [activeRoomInstanceId, characterId, combatState?.activeActorId]);

  // After load-more prepends: restore scroll position so viewport doesn't jump.
  // useLayoutEffect fires before paint — adjusts scrollTop while suppressScrollRef is still true.
  useLayoutEffect(() => {
    if (suppressScrollRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop += chatContainerRef.current.scrollHeight - prevScrollHeightRef.current;
    }
  }, [history]);

  // After any history change: scroll to bottom for new messages, but skip for load-more.
  // useEffect fires after useLayoutEffect — resets the flag here so the order is guaranteed.
  useEffect(() => {
    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      return;
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !activeRoomInstanceId) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ sessionId: sessionId! });
      if (oldestCursor) params.set('cursor', oldestCursor);
      const { logs, hasMore: more } = await fetch(`/api/v2/room/history?${params}`).then(r => r.json());
      const older: HistoryEntry[] = logs ?? [];
      console.log('[history] load more — count:', older.length, 'hasMore:', more,
        'oldest:', older[0]?.createdAt, 'newest:', older[older.length - 1]?.createdAt);
      prevScrollHeightRef.current = chatContainerRef.current?.scrollHeight ?? 0;
      suppressScrollRef.current = true;
      setHistory(prev => [...older, ...prev]);
      setHasMore(more ?? false);
      if (older.length > 0) setOldestCursor(older[0].createdAt);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, sessionId, oldestCursor]);

  const sendAction = useCallback(async () => {
    if (!input.trim() || sending || !activeRoomInstanceId || !characterId) return;
    const text = input.trim();
    const prevGameState = gameState;
    setInput('');
    setSending(true);
    setError('');
    setShowResumeCard(false);

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
        body: JSON.stringify({ characterId, roomInstanceId: activeRoomInstanceId, playerActionText: text, action_hint: chip ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); return; }

      console.log('[sendAction] response roomInstanceId:', data.roomInstanceId, 'current:', activeRoomInstanceId);
      console.log('[sendAction] currentNarrative length:', data.currentNarrative?.length);

      const newNarrative: HistoryEntry[] = data.currentNarrative ?? [];
      const isRoomChange = data.roomInstanceId && data.roomInstanceId !== activeRoomInstanceId;
      const nextGameState = (data.gameState as 'exploration' | 'combat') ?? prevGameState;
      const isTransition = prevGameState !== nextGameState;

      // Append fresh entries to history; inject combat banner on state transitions
      setHistory(prev => {
        const withoutOptimistic = prev.filter(e => !e.id.startsWith('optimistic-'));
        const existingIds = new Set(withoutOptimistic.map((e: HistoryEntry) => e.id));
        const fresh = newNarrative.filter((e: HistoryEntry) => !existingIds.has(e.id));
        console.log('[sendAction] fresh entries:', fresh.length, fresh.map(e => (e.mechanicalSummary as Record<string,unknown>)?.type));
        const base = [...withoutOptimistic, ...fresh];
        if (isTransition) {
          base.push(buildBannerEntry(nextGameState === 'combat' ? 'combat_start' : 'combat_end', data.combatState as CombatState | null));
        }
        return base;
      });
      if (isRoomChange) {
        console.log('[sendAction] room changed →', data.roomInstanceId);
        setActiveRoomInstanceId(data.roomInstanceId);
      }
      if (data.gameState) setGameState(data.gameState);
      setCombatState(data.combatState ?? null);
      if (data.characterStats) setCharacterStats(data.characterStats);
      if (data.characterInventory) setCharacterInventory(data.characterInventory);
      if (data.roomName) setRoomName(data.roomName);
      setProximityPoi(data.characterProximityPoi ?? null);
      if (data.partyMembers) setPartyMembers(data.partyMembers);
      if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string,string>).map(([id, name]) => ({ id, name })));
      setChip(null);

      setMapRefreshKey(k => k + 1);
    } catch {
      setError('Network error — please try again.');
      setHistory(prev => prev.filter(e => !e.id.startsWith('optimistic-')));
    } finally {
      setSending(false);
    }
  }, [input, sending, activeRoomInstanceId, characterId, chip, gameState]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAction(); }
  };

  // Fires a game action directly (e.g. from inventory buttons) without touching the chat input.
  const executeDirectAction = useCallback(async (text: string, hint: string) => {
    if (sending || !activeRoomInstanceId || !characterId) return;
    const prevGs = gameState;
    setSending(true);
    setError('');
    setShowResumeCard(false);
    try {
      const res = await fetch('/api/v2/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, roomInstanceId: activeRoomInstanceId, playerActionText: text, action_hint: hint }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Action failed'); return; }
      const newNarrative: HistoryEntry[] = data.currentNarrative ?? [];
      const nextGs = (data.gameState as 'exploration' | 'combat') ?? prevGs;
      setHistory(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const fresh = newNarrative.filter(e => !existingIds.has(e.id));
        const base = [...prev, ...fresh];
        if (prevGs !== nextGs) base.push(buildBannerEntry(nextGs === 'combat' ? 'combat_start' : 'combat_end', data.combatState as CombatState | null));
        return base;
      });
      if (data.gameState) setGameState(data.gameState);
      setCombatState(data.combatState ?? null);
      if (data.characterStats) setCharacterStats(data.characterStats);
      if (data.characterInventory) setCharacterInventory(data.characterInventory);
      if (data.roomName) setRoomName(data.roomName);
      setProximityPoi(data.characterProximityPoi ?? null);
      if (data.partyMembers) setPartyMembers(data.partyMembers);
      if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string,string>).map(([id, name]) => ({ id, name })));
      setMapRefreshKey(k => k + 1);
      setActiveTab('chat');
    } finally {
      setSending(false);
    }
  }, [sending, activeRoomInstanceId, characterId, gameState]);

  const handleFeatureActivate = useCallback((label: string) => {
    setChip(label);
    setActiveTab('chat');
  }, []);

  const populateChatAction = useCallback((text: string, hint: string) => {
    if (hint === 'use_item') {
      const targeted = text.match(/^use (.+?) on (.+)$/i);
      setChip(targeted ? `Use: ${targeted[1]} → ${targeted[2]}` : `Use: ${text.replace(/^use /i, '')}`);
    } else {
      setChip(null);
    }
    setInput(text);
    setActiveTab('chat');
  }, []);

  const handleCombatUseItem = useCallback((item: ItemDefinition, targetName?: string) => {
    const text = targetName ? `use ${item.name} on ${targetName}` : `use ${item.name}`;
    populateChatAction(text, 'use_item');
  }, [populateChatAction]);

  const handleEndTurn = useCallback(() => {
    executeDirectAction('end turn', 'end_turn');
  }, [executeDirectAction]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppBar
        left={
          <a href="/v2/setup" className="text-sm text-slate-400 hover:text-slate-600">
            Switch session
          </a>
        }
      />
      <Header
        roomName={roomName}
        gameState={gameState}
        round={combatState?.round}
        hp={characterStats?.currentHp}
        maxHp={characterStats?.maxHp}
      />

      {gameState === 'combat' && combatState && (
        <>
          <InitiativeStrip
            initiativeOrder={combatState.initiativeOrder}
            activeActorId={combatState.activeActorId}
            characterId={characterId!}
            characterClass={characterStats?.characterClass ?? ''}
            selectedId={selectedStripEntryId}
            onSelect={setSelectedStripEntryId}
          />
          {selectedStripEntryId && (() => {
            const entry = combatState.initiativeOrder.find(e => e.id === selectedStripEntryId);
            return entry ? (
              <InitiativeMiniSheet
                entry={entry}
                characterStats={characterStats}
                isOwnCharacter={entry.id === characterId}
                isCombat={true}
                onClose={() => setSelectedStripEntryId(null)}
                onNavigateToChat={() => setActiveTab('chat')}
              />
            ) : null;
          })()}
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden" onClick={() => setSelectedStripEntryId(null)}>
        {activeTab === 'chat' && (
          <ChatTab
            history={history}
            hasMore={hasMore}
            loadingMore={loadingMore}
            loadMore={loadMore}
            sending={sending}
            error={error}
            input={input}
            setInput={setInput}
            sendAction={sendAction}
            handleKeyDown={handleKeyDown}
            chip={chip}
            setChip={setChip}
            gameState={gameState}
            combatState={combatState}
            characterStats={characterStats}
            characterInventory={characterInventory}
            chatEndRef={chatEndRef}
            chatContainerRef={chatContainerRef}
            showResumeCard={showResumeCard}
            onDismissResume={() => setShowResumeCard(false)}
            roomName={roomName}
            characterId={characterId!}
            partyMembers={partyMembers}
            onEndTurn={handleEndTurn}
          />
        )}
        {activeTab === 'inventory' && (
          <InventoryTab
            characterInventory={characterInventory}
            gameState={gameState}
            onExplorationAction={populateChatAction}
            onCombatUse={handleCombatUseItem}
            proximityPoi={proximityPoi}
            availablePois={availablePois}
            partyMembers={partyMembers.map(m => ({ id: m.characterId, name: m.characterName }))}
            combatState={combatState}
          />
        )}
        {activeTab === 'party' && (
          <PartyTab
            characterStats={characterStats}
            gameState={gameState}
            onFeatureActivate={handleFeatureActivate}
            partyMembers={partyMembers}
            characterId={characterId!}
          />
        )}
        {activeTab === 'map' && activeRoomInstanceId && (
          <MapTab
            sessionId={sessionId!}
            characterId={characterId!}
            roomInstanceId={activeRoomInstanceId}
            refreshKey={mapRefreshKey}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
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
