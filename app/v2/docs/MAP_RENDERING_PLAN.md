# V2 Map Rendering — Implemented

> **Status: Complete.** Map API implemented in `app/api/v2/map/route.ts`. Frontend SVG renderer in the play page.

## Concept
Local area view — current room fills most of the canvas. Adjacent rooms shown only if visible via LoS. Not a full dungeon overview.

## Grid System
- Each room has a **3×3 grid of POI slots** (NW, N, NE, W, C, E, SW, S, SE)
- **North = up** always. Rooms placed on a grid using explicit `map_x` / `map_y` on `RoomTemplate` (not BFS-computed from exit directions)
- Exit directions (N/S/E/W) are orientation labels for the player, not layout data

## Mobile UX — 3-State Bottom Sheet

Swipe-up bottom sheet. Chat is the primary surface; map is on-demand.

### State 1 — Handle strip (48px, always visible)
```
┌────────────────────────┐
│  DM: The fountain      │
│  gurgles softly...     │
│  > [type action...] ▶ │
├────────────────────────┤
│  ━━━  Entry Chamber  ↑ │
└────────────────────────┘
```
Shows: drag handle + room name. Tap or swipe up → Peek.

### State 2 — Peek (~45% height)
```
┌────────────────────────┐
│  DM: ...dim light...   │
├────────────────────────┤
│         ━━━━━━         │
│      Entry Chamber     │
│   #─────────────────#  │
│   │  Fn    ·    Pl  │  │
│   │                 │  │
│   │  Br    @    ·   ▮  │
│   │                 │  │
│   │   ·    ·    ·   │  │
│   #─────────────────#  │
│   ↓ The Vault          │
└────────────────────────┘
```
Shows: current room only (no adjacent unless character is actively at a door with LoS).
No internal grid lines — lines are walls only. Exit directions labeled below map.

### State 3 — Full (~90% height)

Rooms at same `map_y`, door at S section:
```
   Entry Chamber      The Armory
  #──────────────────────────────#
  │  Fn    ·    Pl  │  ·   ·   · │
  │                 │             │
  │  Br    @    ·   │  ·   ·   · │
  │                 │             │
  │   ·    ·    ·      WR  TW  ·  │  ← door gap (S section)
  #──────────────────────────────#

Legend:
@   Your character        ·   Empty slot
▮   Closed door           ╌   Line of sight
    (gap in wall = open door/archway)
Fn  Stone Fountain        Br  Barricade
Pl  Iron Pillar           WR  Weapon Rack
```

Rooms at different `map_y` — exit at S connects to entrance at C (Armory 1 slot lower):
```
   Entry Chamber
  #─────────────────#
  │  Fn    ·    Pl  │
  │                 │
  │  Br    @    ·   │  The Armory
  │                 #─────────────────#
  │   ·    ·    ·   ╌   WR   TW   ·  │
  #─────────────────│                 │
                    │   ·    ·    ·   │
                    #─────────────────#
```

### Gesture Model
| Gesture | From | Result |
|---|---|---|
| Swipe up / tap strip | Closed | → Peek |
| Swipe up | Peek | → Full |
| Swipe down | Full | → Peek |
| Swipe down / tap outside | Peek | → Closed |

## Rendering Rules
- **Lines = walls only.** No internal cell dividers within a room.
- Rooms treated as a continuous grid — cell (3,1) is directly adjacent to (4,1) just like (2,1)→(3,1).
- Room names label their 3-column group, above the grid. Only shown if the character has visited.
- Door gap = missing section of wall line. Width varies by `exit_arch_width`.
- Unvisited rooms: not rendered at all. No `??` placeholders.

## Rendering Approach
- **SVG** — rooms as wall `<line>` elements, no fill rects
- Each slot = 40px. Room = 120×120px.
- Walls drawn per room edge; shared walls drawn once; gap omitted where door/archway is
- POI labels positioned at their `grid_slot` center within the room

## Wall & Door Visual Language
| Element | Render |
|---|---|
| Solid wall | Continuous `<line>` |
| Closed door | `▮` glyph mid-wall; wall line solid (no gap) |
| Open door (arch_width=1) | 40px gap in wall line at `exit_wall_section` |
| Wide archway (arch_width=2) | 80px gap (2 sections) |
| Full-wall opening (arch_width=3) | No wall line at all |

## LoS Algorithm
Straight line from character cell center to target cell center. Visible if the line crosses the shared wall within the door/archway opening.

Using a 6×3 global grid (Room 1 = cols 1–3, Room 2 = cols 4–6):
- Door at center of east wall between (3,2) and (4,2): opening y ∈ [1.5, 2.5]
- Formula: `y_cross = cy + (ty - cy) * (3.5 - cx) / (tx - cx)`
- Visible if `y_cross` falls within the opening range

**Verified examples:**
- Character at (3,2), door at C: entire Room 2 visible
- Character at (3,3), door at C: sees (4,1), (4,2), (5,1)
- Character at (2,2), door at C: sees (4,2), (5,2), (6,2) only

**Must be at the exit POI slot** to actively peek through a door. Archways relax this.

## POI Visibility Levels
`visibility_level` on `PoiTemplate`:
| Level | Name | Visible when |
|---|---|---|
| 0 | Concealed | Never on map (secret door, hidden trap) |
| 1 | Subtle | Only when character is inside the room |
| 2 | Obvious | Shows through `obvious_only` peek or archway |
| 3 | Prominent | Shows through any peek |

## Exit peek_visibility → LoS filter
| peek_visibility | Shows POIs |
|---|---|
| `"none"` | Nothing (closed door) |
| `"obvious_only"` | visibility_level 2+ only |
| `"full"` | visibility_level 1+ |
| In room | visibility_level 1+ (level 0 only after discover) |

## The 4 Rendering Scenarios

### 1 — In room, door closed
No adjacent room rendered.

### 2 — @ at exit slot (E), peek_visibility="obvious_only"
LoS cone from door; only lvl2+ POIs labeled in adjacent room; lvl1 shows as `·`.

### 3 — @ at exit slot (E), peek_visibility="full"
Same LoS cone; lvl1 POIs also labeled.

### 4 — @ at center (C), wide archway (arch_width=2, N+C sections open)
Character can see through from C slot; upper LoS reaches NW+N of adjacent room; SW+S fogged.

## Schema Fields Added

### RoomTemplate
```prisma
map_x Int @default(0)
map_y Int @default(0)
```

### PoiTemplate
```prisma
grid_slot        String @default("C")   // NW|N|NE|W|C|E|SW|S|SE
visibility_level Int    @default(1)     // 0-3
exit_direction   String?                // N|S|E|W — null for non-exits
exit_wall_section String @default("C") // N|C|S — which section of the wall
exit_arch_width  Int    @default(1)    // 1=door gap, 2=wide arch, 3=full open
```

## Test Rooms (Seed)

Three rooms covering all 4 scenarios:

| Room | map_x | map_y | Connects to |
|---|---|---|---|
| The Entry Chamber | 0 | 0 | Armory (E, arch_width=2), Flooded Passage (N, closed door) |
| The Armory | 1 | 0 | Entry Chamber (W, arch_width=2) |
| The Flooded Passage | 0 | -1 | Entry Chamber (S, closed door) |

- **Scenario 1**: Character in Entry, not at any door → Entry only rendered
- **Scenario 2**: Character at east exit (E slot), peek_visibility="obvious_only" → Armory shows lvl2+ POIs
- **Scenario 3**: Character at east exit (E slot), peek_visibility="full" → Armory shows all lvl1+ POIs
- **Scenario 4**: Archway arch_width=2 (N+C open) → Character at C of Entry can see Armory through arch

## Character & POI Positions
- Character token rendered at their `proximity_target` POI's `grid_slot`
- No proximity target → center (C slot) of current room
- Multiple characters at same slot = stacked tokens

## Fog of War
- Visited rooms: full detail
- Peeked rooms: visible slots per LoS + visibility_level filter
- Never-seen rooms: not rendered
