# Multiplayer Bug Fix — Handoff

## Status: IN PROGRESS (partial)

Two bugs in the multiplayer play page:

1. **Message log** — each player only sees their own messages + DM responses. Ally messages + DM responses to ally actions are not displayed in real-time.
2. **Ally position** — the dungeon map doesn't update when an ally moves to a new POI. Only updates when the current player acts.

---

## Root cause analysis

### Bug 1 (messages)
The poll in `PlayContent` fetches `/api/v2/room/state` every 3s and merges `currentNarrative` (last 5 messages for the room) into history. This is scoped to the current player's `roomInstanceId` without a `since` timestamp, so:
- `take: 5` can miss messages if many arrive between polls
- When `sendingRef.current = true` (waiting for DM response), the poll skips message merges entirely
- Combined, new ally messages can slip through undetected

Fix: use `/api/v2/room/history?sessionId=S&since=<newestTimestamp>` in the poll instead of `currentNarrative`, so we always fetch ALL new messages since the last known one.

### Bug 2 (positions)
`setMapRefreshKey(k => k + 1)` only fires in `sendAction` and `executeDirectAction` — when the current player acts. Ally actions never trigger it, so the map (`MapTab` / `MapSheet`) never re-fetches.

Fix: when the poll receives new messages from an ally, also call `setMapRefreshKey(k => k + 1)`.

---

## Changes already made

### 1. `app/api/v2/room/history/route.ts` — DONE ✓
Added `since` query param. When provided, returns all messages with `createdAt > since` ordered ascending, no take limit. Falls through to existing cursor pagination if `since` is absent.

### 2. `app/v2/play/page.tsx` — PARTIAL
Added `newestTimestampRef = useRef<string | null>(null)` after `sendingRef`.

---

## Remaining edits to `app/v2/play/page.tsx`

All edits are in `PlayContent` (starts ~line 2292). Do them in order:

### A. After initial load sets `entries`, seed `newestTimestampRef`

Find this block (around line 2349):
```ts
const entries: HistoryEntry[] = logs ?? [];
console.log('[history] initial load — count:', entries.length, ...
setHistory(prev => {
```

Insert BEFORE `setHistory(...)`:
```ts
if (entries.length > 0) {
  newestTimestampRef.current = entries[entries.length - 1].createdAt;
}
```

### B. Replace the poll effect entirely

Find the entire poll `useEffect` (lines ~2378–2406):
```ts
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
      if (data.currentNarrative && !sendingRef.current) {
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
```

Replace with:
```ts
// Poll room state every 3s — skip when it's my combat turn (I'm the one acting)
useEffect(() => {
  if (!activeRoomInstanceId || !characterId || !sessionId) return;
  const isMyTurn = combatState?.activeActorId === characterId;
  if (isMyTurn) return;
  const poll = async () => {
    try {
      // 1. Fetch game state (combat, stats, party, POIs)
      const stateRes = await fetch(`/api/v2/room/state?roomInstanceId=${activeRoomInstanceId}&characterId=${characterId}`);
      if (!stateRes.ok) return;
      const data = await stateRes.json();
      if (data.gameState) setGameState(data.gameState as 'exploration' | 'combat');
      setCombatState(data.combatState ?? null);
      if (data.characterStats) setCharacterStats(data.characterStats);
      if (data.characterInventory) setCharacterInventory(data.characterInventory);
      setProximityPoi(data.characterProximityPoi ?? null);
      if (data.partyMembers) setPartyMembers(data.partyMembers);
      if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string, string>).map(([id, name]) => ({ id, name })));

      // 2. Fetch new messages since last known timestamp (all rooms in session)
      if (!sendingRef.current) {
        const histParams = new URLSearchParams({ sessionId });
        if (newestTimestampRef.current) histParams.set('since', newestTimestampRef.current);
        const histRes = await fetch(`/api/v2/room/history?${histParams}`);
        if (histRes.ok) {
          const { logs: newLogs } = await histRes.json();
          const incoming = (newLogs ?? []) as HistoryEntry[];
          if (incoming.length > 0) {
            newestTimestampRef.current = incoming[incoming.length - 1].createdAt;
            setHistory(prev => {
              const existingIds = new Set(prev.map(e => e.id));
              const fresh = incoming.filter(e => !existingIds.has(e.id));
              return fresh.length > 0 ? [...prev, ...fresh] : prev;
            });
            // If any ally acted, refresh the map so ally positions update
            const hasAllyAction = incoming.some(
              e => (e.mechanicalSummary as { type?: string } | null)?.type === 'player_action' &&
                   e.authorCharacterId !== characterId,
            );
            if (hasAllyAction) setMapRefreshKey(k => k + 1);
          }
        }
      }
    } catch { /* silent */ }
  };
  const id = setInterval(poll, 3000);
  return () => clearInterval(id);
}, [activeRoomInstanceId, characterId, sessionId, combatState?.activeActorId]);
```

### C. Update `newestTimestampRef` in `sendAction` after merging history

Find this block inside `sendAction` (around line 2484):
```ts
      const newNarrative: HistoryEntry[] = data.currentNarrative ?? [];
      const isRoomChange = data.roomInstanceId && data.roomInstanceId !== activeRoomInstanceId;
```

Insert AFTER `const newNarrative` line:
```ts
      if (newNarrative.length > 0) {
        const newest = newNarrative[newNarrative.length - 1].createdAt;
        if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
          newestTimestampRef.current = newest;
        }
      }
```

### D. Update `newestTimestampRef` in `executeDirectAction` after getting data

Find this block inside `executeDirectAction` (around line 2492):
```ts
      const newNarrative: HistoryEntry[] = data.currentNarrative ?? [];
      const nextGs = (data.gameState as 'exploration' | 'combat') ?? prevGs;
```

Insert AFTER `const newNarrative` line:
```ts
      if (newNarrative.length > 0) {
        const newest = newNarrative[newNarrative.length - 1].createdAt;
        if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
          newestTimestampRef.current = newest;
        }
      }
```

---

## Verification

After all edits, run `npm run build` to confirm no TypeScript errors. The two key behaviors to test manually:
- Player A sends action → Player B sees the message within ~3s without acting
- Player A moves to a POI → Player B's map updates within ~3s without acting
