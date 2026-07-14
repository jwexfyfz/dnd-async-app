'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { CombatState, CharacterStats, InitiativeEntry, CharacterInventory, ItemDefinition, PartyMemberInfo, CombatAlertInfo, RemoteCombatInfo } from '@/types/v2-game';
import { classEmoji, classSprite } from '@/lib/class-emoji';
import AppBar from '@/components/app-bar';
import { RollBadge, CombatRollBadge } from '@/components/v2/combat/RollBadge';
import type { RollResult, CombatRollData } from '@/components/v2/combat/RollBadge';
import { CombatBanner, ExplorationResumeCard, CombatResumeCard, RemoteCombatBanner, buildBannerEntry } from '@/components/v2/combat/CombatBanner';
import type { HistoryEntry, InitiativeRollEntry } from '@/components/v2/combat/CombatBanner';
import { InitiativeStrip, InitiativeMiniSheet, CLASS_FEATURES } from '@/components/v2/combat/InitiativeStrip';
import { ActionChips, TurnBadge } from '@/components/v2/combat/ActionChips';
import { CombatRollSheet } from '@/components/v2/combat/CombatRollSheet';
import type { TargetOption, RollSheetResult } from '@/components/v2/combat/CombatRollSheet';
import { InventoryTab, ItemPickerSheet } from '@/components/v2/inventory/InventoryTab';
import { UseButtons } from '@/components/v2/inventory/UseButtons';
import { PartyTab } from '@/components/v2/character/PartyTab';
import { ChatMessage } from '@/components/v2/chat/ChatMessage';
import { ChatTab } from '@/components/v2/chat/ChatTab';
import { MapTab } from '@/components/v2/map/DungeonMap';
import { Header, BottomNav } from '@/components/v2/layout/Header';
import type { ActiveTab } from '@/components/v2/layout/Header';
import type { AsiChoices } from '@/lib/v2/asi-helpers';

// ─── Map — see imports (MapTab from map/DungeonMap) ───────────────────────────

// ─── Header + BottomNav — see imports (Header, BottomNav from layout/Header) ──

// ─── Party Tab — see imports (PartyTab from character/PartyTab) ───────────────

// ─── Inventory Tab ────────────────────────────────────────────────────────────

// ─── UseButtons ──────────────────────────────────────────────────────────────

// ─── Action Chips — see imports (ActionChips, TurnBadge from ActionChips) ───

// ─── Chat Tab — see imports (ChatTab from chat/ChatTab) ───────────────────────

// ─── Initiative Strip — see imports (InitiativeStrip, InitiativeMiniSheet, CLASS_FEATURES from InitiativeStrip) ───




// ─── Message Types — see imports (HistoryEntry, InitiativeRollEntry from CombatBanner) ───



// ─── ChatMessage — see imports (ChatMessage from chat/ChatMessage) ─────────────

// Maps chip display labels to their canonical action_hint values.
// Without this, "Back Off" gets sent as action_hint and the intent parser
// mis-reads it as change_proximity (movement) instead of disengage (action).
const CHIP_HINT_MAP: Record<string, string> = {
  'Back Off': 'disengage',
  'Dodge': 'dodge',
  'Dash': 'dash',
};

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
  const [showResumeCard, setShowResumeCard] = useState(false);
  const [combatAlert, setCombatAlert] = useState<CombatAlertInfo | null>(null);
  const [remoteCombat, setRemoteCombat] = useState<RemoteCombatInfo | null>(null);
  const [situationSummary, setSituationSummary] = useState<string | null>(null);
  const [canLongRest, setCanLongRest] = useState(false);
  const [autoRestApplied, setAutoRestApplied] = useState(false);
  const [autoRestDismissed, setAutoRestDismissed] = useState(false);
  const [selectedStripEntryId, setSelectedStripEntryId] = useState<string | null>(null);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [sacrificeModalOpen, setSacrificeModalOpen] = useState(false);
  const [sacrificeConfirming, setSacrificeConfirming] = useState(false);
  const [rollSheetAction, setRollSheetAction] = useState<{ hint: 'attack' | 'hide' | 'provoke' | 'shove'; validTargets: TargetOption[] } | null>(null);
  const [chatRollResult, setChatRollResult] = useState<{ hint: 'attack' | 'hide' | 'provoke' | 'shove'; result: RollSheetResult } | null>(null);
  const narrativePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollNarrativeArrivedRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const suppressScrollRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const sendingRef = useRef(false);
  const autoEndTurnFiredRoundRef = useRef(-1);
  const autoResolveEnemyActorRef = useRef<string | null>(null);
  const newestTimestampRef = useRef<string | null>(null);

  // Ping lastSeenAt on mount
  useEffect(() => {
    fetch('/api/v2/user/ping', { method: 'POST' }).catch(() => {});
  }, []);

  // Auto long rest on session load — fires once per characterId
  useEffect(() => {
    if (!characterId) return;
    fetch(`/api/v2/me/characters/${characterId}/rest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'long', auto: true }),
    }).then(r => r.ok ? r.json() : null).then(d => { if (d?.applied) setAutoRestApplied(true); }).catch(() => {});
  }, [characterId]);

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
        const badEntries = entries.filter(e => typeof e.text !== 'string');
        if (badEntries.length > 0) console.error('[history] initial load — entries with non-string text:', badEntries);
        console.log('[history] initial load — count:', entries.length, 'hasMore:', more,
          'oldest:', entries[0]?.createdAt, 'newest:', entries[entries.length - 1]?.createdAt);
        if (entries.length > 0) {
          newestTimestampRef.current = entries[entries.length - 1].createdAt;
        }
        setHistory(prev => {
          // Merge rather than replace: if sendAction already ran and populated state,
          // preserve those newer messages instead of wiping them with a stale load.
          const nonOptimistic = prev.filter(e => !e.id.startsWith('optimistic-'));
          if (nonOptimistic.length === 0) return entries;
          const existingIds = new Set(nonOptimistic.map(e => e.id));
          const olderEntries = entries.filter(e => !existingIds.has(e.id));
          return olderEntries.length > 0 ? [...olderEntries, ...prev] : prev;
        });
        // Only show resume card if the session already has player activity
        const hasPlayerActivity = entries.some(e => (e.mechanicalSummary as { type?: string } | null)?.type === 'player_action');
        if (hasPlayerActivity) setShowResumeCard(true);
        setHasMore(more ?? false);
        setOldestCursor(entries.length > 0 ? entries[0].createdAt : null);
        if (state.roomName) setRoomName(state.roomName);
        if (state.gameState) setGameState(state.gameState);
        setCanLongRest(state.canLongRest ?? false);
        if (state.combatState && typeof (state.combatState as Record<string,unknown>).code === 'string') {
          console.error('[init] combatState looks like a DB error object:', state.combatState);
        }
        setCombatState(state.combatState ?? null);
        setCombatAlert((state.combatAlert as CombatAlertInfo | null) ?? null);
        setRemoteCombat((state.remoteCombat as RemoteCombatInfo | null) ?? null);
        if (state.characterStats) setCharacterStats(state.characterStats);
        if (state.characterInventory) setCharacterInventory(state.characterInventory);
        setProximityPoi(state.characterProximityPoi ?? null);
        setPartyMembers(state.partyMembers ?? []);
        setAvailablePois(Object.entries((state.poiIndex as Record<string,string>) ?? {}).map(([id, name]) => ({ id, name })));
        if (state.situationSummary) setSituationSummary(state.situationSummary as string);
      });
  }, [sessionId, characterId]);

  // Poll room state every 3s — skip when it's my combat turn (I'm the one acting)
  useEffect(() => {
    if (!activeRoomInstanceId || !characterId || !sessionId) return;
    const isMyTurn = combatState?.activeActorId === characterId || remoteCombat?.combatState.activeActorId === characterId;
    if (isMyTurn) return;
    const poll = async () => {
      try {
        // 1. Fetch game state (combat, stats, party, POIs)
        const stateRes = await fetch(`/api/v2/room/state?roomInstanceId=${activeRoomInstanceId}&characterId=${characterId}`);
        if (!stateRes.ok) return;
        const data = await stateRes.json();
        if (data.combatState && typeof (data.combatState as Record<string,unknown>).code === 'string') {
          console.error('[poll] combatState looks like a DB error object:', data.combatState);
        }
        if (data.gameState) setGameState(data.gameState as 'exploration' | 'combat');
        setCombatState(data.combatState ?? null);
        setCombatAlert((data.combatAlert as CombatAlertInfo | null) ?? null);
        setRemoteCombat((data.remoteCombat as RemoteCombatInfo | null) ?? null);
        if (data.characterStats) setCharacterStats(data.characterStats);
        if (data.characterInventory) setCharacterInventory(data.characterInventory);
        setProximityPoi(data.characterProximityPoi ?? null);
        if (data.partyMembers) setPartyMembers(data.partyMembers);
        if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string, string>).map(([id, name]) => ({ id, name })));
        setCanLongRest(data.canLongRest ?? false);

        // 2. Fetch new messages since last known timestamp (all rooms in session)
        if (!sendingRef.current) {
          const histParams = new URLSearchParams({ sessionId });
          if (newestTimestampRef.current) histParams.set('since', newestTimestampRef.current);
          const histRes = await fetch(`/api/v2/room/history?${histParams}`);
          if (histRes.ok) {
            const { logs: newLogs } = await histRes.json();
            const incoming = (newLogs ?? []) as HistoryEntry[];
            const badPoll = incoming.filter(e => typeof e.text !== 'string');
            if (badPoll.length > 0) console.error('[poll] incoming entries with non-string text:', badPoll);
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
  }, [activeRoomInstanceId, characterId, sessionId, combatState?.activeActorId, remoteCombat?.combatState.activeActorId]);

  // After load-more prepends: restore scroll position so viewport doesn't jump.
  // useLayoutEffect fires before paint — adjusts scrollTop while suppressScrollRef is still true.
  useLayoutEffect(() => {
    if (suppressScrollRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop += chatContainerRef.current.scrollHeight - prevScrollHeightRef.current;
    }
  }, [history]);

  // After any history change: scroll to bottom for new messages, but skip for load-more.
  // useEffect fires after useLayoutEffect — resets the flag here so the order is guaranteed.
  // Use scrollTop on the container directly: scrollIntoView scrolls ALL ancestors (including
  // the window on mobile), and multiple concurrent smooth animations conflict, causing upward jumps.
  useEffect(() => {
    if (suppressScrollRef.current) {
      suppressScrollRef.current = false;
      return;
    }
    const container = chatContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [history]);

  // When navigating to the chat tab, scroll to the bottom so recent messages are visible.
  useEffect(() => {
    if (activeTab === 'chat') {
      const container = chatContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    }
  }, [activeTab]);

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
    sendingRef.current = true;
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
        body: JSON.stringify({ characterId, roomInstanceId: activeRoomInstanceId, playerActionText: text, action_hint: CHIP_HINT_MAP[chip ?? ''] ?? chip ?? undefined }),
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
        // Exclude both optimistic placeholders and the previous injected-current sentinel —
        // injected-current is reused on every response, so keeping it in existingIds would
        // filter out the new injected narrative, causing it to silently disappear.
        const withoutOptimistic = prev.filter(e => !e.id.startsWith('optimistic-') && e.id !== 'injected-current');
        const existingIds = new Set(withoutOptimistic.map((e: HistoryEntry) => e.id));
        const fresh = newNarrative.filter((e: HistoryEntry) => !existingIds.has(e.id));
        console.log('[sendAction] fresh entries:', fresh.length, fresh.map(e => (e.mechanicalSummary as Record<string,unknown>)?.type));
        const base = [...withoutOptimistic, ...fresh];
        if (isTransition) {
          const hasCombatStartInFresh = fresh.some(e => (e.mechanicalSummary as Record<string,unknown> | null)?.type === 'combat_start');
          if (nextGameState === 'combat' && !hasCombatStartInFresh) {
            base.push(buildBannerEntry('combat_start', data.combatState as CombatState | null));
          } else if (nextGameState === 'exploration') {
            base.push(buildBannerEntry('combat_end'));
          }
        }
        return base;
      });
      if (isRoomChange) {
        console.log('[sendAction] room changed →', data.roomInstanceId);
        setActiveRoomInstanceId(data.roomInstanceId);
      }
      // Advance the poll cursor so it doesn't re-fetch entries already shown.
      // currentNarrative may contain an injected entry with id='injected-current' whose
      // createdAt is the server assembly time (after the DB write) — using it as the
      // poll cursor excludes the real DB entry from the next poll, preventing duplicates.
      if (newNarrative.length > 0) {
        const newest = newNarrative[newNarrative.length - 1].createdAt;
        if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
          newestTimestampRef.current = newest;
        }
      }
      if (data.gameState) setGameState(data.gameState);
      setCombatState(data.combatState ?? null);
      setCombatAlert((data.combatAlert as CombatAlertInfo | null) ?? null);
      setRemoteCombat((data.remoteCombat as RemoteCombatInfo | null) ?? null);
      if (data.characterStats) setCharacterStats(data.characterStats);
      if (data.characterInventory) setCharacterInventory(data.characterInventory);
      if (data.roomName) setRoomName(data.roomName);
      setProximityPoi(data.characterProximityPoi ?? null);
      if (data.partyMembers) setPartyMembers(data.partyMembers);
      if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string,string>).map(([id, name]) => ({ id, name })));
      setChip(null);

      setMapRefreshKey(k => k + 1);

      // If the server took the fire-and-forget narrative path (roll occurred), show dice
      // animation and poll for the narrative that arrives asynchronously.
      const rawRollResult = data.rollResult as { d20?: number; success?: boolean; isCrit?: boolean; damage?: number; targetDefeated?: boolean; rollType?: string } | undefined;
      if (rawRollResult) {
        const hint = (rawRollResult.rollType ?? 'attack') as 'attack' | 'hide' | 'provoke' | 'shove';
        setChatRollResult({
          hint,
          result: {
            d20: rawRollResult.d20 ?? 0,
            success: rawRollResult.success ?? false,
            isCrit: rawRollResult.isCrit ?? false,
            damageDealt: rawRollResult.damage,
            targetDefeated: rawRollResult.targetDefeated,
          },
        });
        // Poll for the narrative that will be written after this response returns
        const since = newestTimestampRef.current;
        if (since && sessionId) {
          rollNarrativeArrivedRef.current = false;
          if (narrativePollRef.current) clearInterval(narrativePollRef.current);
          let attempts = 0;
          narrativePollRef.current = setInterval(async () => {
            attempts++;
            try {
              const r = await fetch(`/api/v2/room/history?sessionId=${sessionId}&since=${since}`);
              const { logs } = await r.json() as { logs: HistoryEntry[] };
              if (logs?.length > 0) {
                clearInterval(narrativePollRef.current!);
                narrativePollRef.current = null;
                rollNarrativeArrivedRef.current = true;
                setHistory(prev => {
                  const withoutShimmer = prev.filter(e => !e.isShimmer);
                  const ids = new Set(withoutShimmer.map(e => e.id));
                  const fresh = logs.filter(e => !ids.has(e.id));
                  if (fresh.length === 0) return prev;
                  const newest = fresh[fresh.length - 1].createdAt;
                  if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
                    newestTimestampRef.current = newest;
                  }
                  return [...withoutShimmer, ...fresh];
                });
              } else if (attempts >= 12) {
                clearInterval(narrativePollRef.current!);
                narrativePollRef.current = null;
              }
            } catch { /* ignore poll errors */ }
          }, 500);
        }
      }
    } catch {
      setError('Network error — please try again.');
      setHistory(prev => prev.filter(e => !e.id.startsWith('optimistic-')));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [input, sending, activeRoomInstanceId, characterId, chip, gameState, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAction(); }
  };

  // Apply API response data to local state (shared between chat send, direct actions, and roll sheet)
  const applyActionResponse = useCallback((data: Record<string, unknown>, prevGs: 'exploration' | 'combat', opts?: { switchToChat?: boolean; stripShimmer?: boolean }) => {
    const newNarrative: HistoryEntry[] = (data.currentNarrative as HistoryEntry[]) ?? [];
    const nextGs = (data.gameState as 'exploration' | 'combat') ?? prevGs;
    setHistory(prev => {
      const withoutInjected = prev.filter(e => e.id !== 'injected-current' && !(opts?.stripShimmer && e.isShimmer));
      const existingIds = new Set(withoutInjected.map(e => e.id));
      const fresh = newNarrative.filter(e => !existingIds.has(e.id));
      const base = [...withoutInjected, ...fresh];
      if (prevGs !== nextGs) {
        const hasCombatStartInFresh = fresh.some(e => (e.mechanicalSummary as Record<string,unknown> | null)?.type === 'combat_start');
        if (nextGs === 'combat' && !hasCombatStartInFresh) {
          base.push(buildBannerEntry('combat_start', data.combatState as CombatState | null));
        } else if (nextGs === 'exploration') {
          base.push(buildBannerEntry('combat_end'));
        }
      }
      return base;
    });
    if (newNarrative.length > 0) {
      const newest = newNarrative[newNarrative.length - 1].createdAt;
      if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
        newestTimestampRef.current = newest;
      }
    }
    if (data.gameState) setGameState(data.gameState as 'exploration' | 'combat');
    setCombatState((data.combatState as CombatState | null) ?? null);
    setCombatAlert((data.combatAlert as CombatAlertInfo | null) ?? null);
    setRemoteCombat((data.remoteCombat as RemoteCombatInfo | null) ?? null);
    if (data.characterStats) setCharacterStats(data.characterStats as CharacterStats);
    if (data.characterInventory) setCharacterInventory(data.characterInventory as CharacterInventory);
    if (data.roomName) setRoomName(data.roomName as string);
    setProximityPoi((data.characterProximityPoi as { id: string; name: string } | null) ?? null);
    if (data.partyMembers) setPartyMembers(data.partyMembers as PartyMemberInfo[]);
    if (data.poiIndex) setAvailablePois(Object.entries(data.poiIndex as Record<string,string>).map(([id, name]) => ({ id, name })));
    setMapRefreshKey(k => k + 1);
    if (opts?.switchToChat) setActiveTab('chat');
  }, []);

  // Fetch wrapper with 15s timeout — returns raw API data, throws on error
  const dispatchAction = useCallback(async (text: string, hint: string, targetPoiId?: string | null): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/v2/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, roomInstanceId: activeRoomInstanceId, playerActionText: text, action_hint: hint, target_poi_instance_id: targetPoiId }),
        signal: controller.signal,
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? 'Action failed');
      return data;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error('The action timed out — try again.');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }, [characterId, activeRoomInstanceId]);

  // Fires a game action directly (e.g. from direct-fire chips: dodge, dash, disengage)
  const executeDirectAction = useCallback(async (text: string, hint: string, switchToChat = true) => {
    if (sending || !activeRoomInstanceId || !characterId) return;
    const prevGs = gameState;
    setSending(true);
    sendingRef.current = true;
    setError('');
    setShowResumeCard(false);
    try {
      const data = await dispatchAction(text, hint);
      applyActionResponse(data, prevGs, { switchToChat });
    } catch (err) {
      setError((err as Error).message ?? 'Action failed');
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [sending, activeRoomInstanceId, characterId, gameState, dispatchAction, applyActionResponse]);

  // Roll sheet submit — fires action and drives animation
  const handleRoll = useCallback(async (
    hint: 'attack' | 'hide' | 'provoke' | 'shove',
    flavorText: string,
    targetId: string | null,
  ): Promise<RollSheetResult> => {
    const text = flavorText.trim() || hint;
    const prevGs = gameState;
    setSending(true);
    sendingRef.current = true;
    setError('');
    rollNarrativeArrivedRef.current = false;
    if (narrativePollRef.current) { clearInterval(narrativePollRef.current); narrativePollRef.current = null; }
    try {
      const data = await dispatchAction(text, hint, targetId);
      applyActionResponse(data, prevGs, { switchToChat: true });

      // Poll for fire-and-forget narrative starting immediately after server responds
      const since = newestTimestampRef.current;
      if (since && sessionId) {
        let attempts = 0;
        narrativePollRef.current = setInterval(async () => {
          attempts++;
          try {
            const r = await fetch(`/api/v2/room/history?sessionId=${sessionId}&since=${since}`);
            const { logs } = await r.json() as { logs: HistoryEntry[] };
            if (logs?.length > 0) {
              clearInterval(narrativePollRef.current!);
              narrativePollRef.current = null;
              rollNarrativeArrivedRef.current = true;
              setHistory(prev => {
                const withoutShimmer = prev.filter(e => !e.isShimmer);
                const ids = new Set(withoutShimmer.map(e => e.id));
                const fresh = logs.filter(e => !ids.has(e.id));
                if (fresh.length === 0) return prev;
                const newest = fresh[fresh.length - 1].createdAt;
                if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
                  newestTimestampRef.current = newest;
                }
                return [...withoutShimmer, ...fresh];
              });
            } else if (attempts >= 8) {
              clearInterval(narrativePollRef.current!);
              narrativePollRef.current = null;
            }
          } catch { /* ignore poll errors */ }
        }, 500);
      }

      const rollResult = data.rollResult as { d20?: number; allRolls?: number[]; success?: boolean; isCrit?: boolean; damage?: number; targetDefeated?: boolean } | undefined;
      return {
        d20: rollResult?.d20 ?? 0,
        allRolls: rollResult?.allRolls,
        success: rollResult?.success ?? false,
        isCrit: rollResult?.isCrit ?? false,
        damageDealt: rollResult?.damage,
        targetDefeated: rollResult?.targetDefeated,
      };
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [gameState, dispatchAction, applyActionResponse, sessionId]);

  const handleRollSheetDismiss = useCallback(() => {
    setRollSheetAction(null);
    if (!rollNarrativeArrivedRef.current) {
      setHistory(prev => [...prev, {
        id: `shimmer-${Date.now()}`,
        text: '',
        isMechanicalEvent: false,
        mechanicalSummary: null,
        createdAt: new Date().toISOString(),
        isShimmer: true,
      }]);
    }
  }, []);

  const handleChatRollDismiss = useCallback(() => {
    setChatRollResult(null);
    if (!rollNarrativeArrivedRef.current) {
      setHistory(prev => [...prev, {
        id: `shimmer-${Date.now()}`,
        text: '',
        isMechanicalEvent: false,
        mechanicalSummary: null,
        createdAt: new Date().toISOString(),
        isShimmer: true,
      }]);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    if (!activeRoomInstanceId || !characterId) return;
    const r = await fetch(`/api/v2/room/state?roomInstanceId=${activeRoomInstanceId}&characterId=${characterId}`);
    if (!r.ok) return;
    const d = await r.json();
    if (d.characterStats) setCharacterStats(d.characterStats);
    if (d.partyMembers) setPartyMembers(d.partyMembers);
    setCanLongRest(d.canLongRest ?? false);
  }, [activeRoomInstanceId, characterId]);

  const handleSubclassResolve = useCallback(async (subclassKey: string) => {
    if (!characterId) return;
    const res = await fetch(`/api/v2/me/characters/${characterId}/level-up`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'subclass', subclassKey, roomInstanceId: activeRoomInstanceId }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to choose subclass'); return; }
    await refreshStats();
    const histParams = new URLSearchParams({ sessionId: sessionId! });
    if (newestTimestampRef.current) histParams.set('since', newestTimestampRef.current);
    const histRes = await fetch(`/api/v2/room/history?${histParams}`);
    if (histRes.ok) {
      const { logs: newLogs } = await histRes.json();
      const incoming = (newLogs ?? []) as HistoryEntry[];
      if (incoming.length > 0) {
        setHistory(prev => { const ids = new Set(prev.map(e => e.id)); const fresh = incoming.filter(e => !ids.has(e.id)); return fresh.length > 0 ? [...prev, ...fresh] : prev; });
        newestTimestampRef.current = incoming[incoming.length - 1].createdAt;
      }
    }
  }, [characterId, activeRoomInstanceId, sessionId, refreshStats]);

  const handleShortRest = useCallback(async () => {
    if (!characterId) return;
    const res = await fetch(`/api/v2/me/characters/${characterId}/rest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'short' }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Short rest failed'); return; }
    await refreshStats();
  }, [characterId, refreshStats]);

  const handleMakeCamp = useCallback(async () => {
    if (!characterId || !activeRoomInstanceId) return;
    const res = await fetch(`/api/v2/me/characters/${characterId}/rest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'long', roomInstanceId: activeRoomInstanceId }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Long rest failed'); return; }
    await refreshStats();
  }, [characterId, activeRoomInstanceId, refreshStats]);

  const handleFeatureActivate = useCallback((label: string) => {
    const feature = Object.values(CLASS_FEATURES).flat().find(f => f.label === label);
    if (feature?.directFire) {
      executeDirectAction(label, 'use_class_feature');
    } else {
      setChip(label);
      setActiveTab('chat');
    }
  }, [executeDirectAction]);

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

  // Equip/unequip/drop from the inventory tab execute immediately and stay on the inventory tab.
  const handleInventoryAction = useCallback((text: string, hint: string) => {
    if (hint === 'equip' || hint === 'unequip' || hint === 'drop') {
      executeDirectAction(text, hint, false);
    } else {
      populateChatAction(text, hint);
    }
  }, [executeDirectAction, populateChatAction]);

  const handleCombatUseItem = useCallback((item: ItemDefinition, targetName?: string) => {
    const text = targetName ? `use ${item.name} on ${targetName}` : `use ${item.name}`;
    populateChatAction(text, 'use_item');
  }, [populateChatAction]);

  const handleEndTurn = useCallback(() => {
    executeDirectAction('end turn', 'end_turn');
  }, [executeDirectAction]);

  const handleDeathSave = useCallback(() => {
    executeDirectAction('make a death saving throw', 'death_save');
  }, [executeDirectAction]);

  const handleAsiResolve = useCallback(async (choices: AsiChoices) => {
    if (!characterId) return;
    const res = await fetch(`/api/v2/me/characters/${characterId}/level-up`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'asi', choices, roomInstanceId: activeRoomInstanceId }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? 'Failed to apply ASI');
      return;
    }
    // Refresh characterStats and partyMembers to reflect new values
    if (!activeRoomInstanceId) return;
    const stateRes = await fetch(`/api/v2/room/state?roomInstanceId=${activeRoomInstanceId}&characterId=${characterId}`);
    if (!stateRes.ok) return;
    const data = await stateRes.json();
    if (data.characterStats) setCharacterStats(data.characterStats);
    if (data.partyMembers) setPartyMembers(data.partyMembers);
    // Fetch the new level_up_confirmed message
    const histParams = new URLSearchParams({ sessionId: sessionId! });
    if (newestTimestampRef.current) histParams.set('since', newestTimestampRef.current);
    const histRes = await fetch(`/api/v2/room/history?${histParams}`);
    if (histRes.ok) {
      const { logs: newLogs } = await histRes.json();
      const incoming = (newLogs ?? []) as HistoryEntry[];
      if (incoming.length > 0) {
        setHistory(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const fresh = incoming.filter(e => !existingIds.has(e.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        const newest = incoming[incoming.length - 1].createdAt;
        if (!newestTimestampRef.current || newest > newestTimestampRef.current) {
          newestTimestampRef.current = newest;
        }
      }
    }
  }, [characterId, activeRoomInstanceId, sessionId]);

  const pendingQueue = characterStats?.pendingChoicesQueue ?? [];
  const hasPendingChoice = pendingQueue.length > 0;
  const activePending = pendingQueue[0] ?? null;
  const hasSacrifice = activePending?.type === 'heroic_sacrifice';
  const pendingStripText = activePending
    ? activePending.type === 'heroic_sacrifice'
      ? `${activePending.fallenName} has fallen — begin your next chapter`
      : (pendingQueue.length > 1
          ? `1 of ${pendingQueue.length} — Level ${activePending.level}: ${activePending.type === 'asi' ? 'Ability Score Improvement' : 'Choose your subclass'}`
          : `✦ Level ${activePending.level} reached — ${activePending.type === 'asi' ? 'Ability Score Improvement waiting' : 'Choose your subclass'}`)
    : null;

  const handleConfirmSacrifice = useCallback(async () => {
    if (!characterId || sacrificeConfirming) return;
    setSacrificeConfirming(true);
    try {
      const res = await fetch(`/api/v2/me/characters/${characterId}/confirm-sacrifice`, { method: 'POST' });
      if (!res.ok) { setSacrificeConfirming(false); return; }
      const data = await res.json();
      const params = new URLSearchParams({
        fromSacrifice: 'true',
        level: String(data.redirectLevel),
        predecessorId: data.predecessorCharacterId,
      });
      if (data.sessionId) params.set('sessionId', data.sessionId);
      if (activePending?.type === 'heroic_sacrifice') params.set('fallenName', activePending.fallenName);
      router.push(`/v2/setup?${params}`);
    } catch {
      setSacrificeConfirming(false);
    }
  }, [characterId, sacrificeConfirming, activePending, router]);

  // Remote combat: the character is enrolled (LoS auto-enroll) in another room's combat
  // while physically remaining here. On their turn there, the combat UI (initiative strip,
  // action chips, end turn) is driven by remoteCombat.combatState instead of the local one —
  // the surrounding room/map context still reflects this character's own room.
  const isRemoteMyTurn = !!remoteCombat && remoteCombat.combatState.activeActorId === characterId;
  const displayGameState: 'exploration' | 'combat' = gameState === 'combat' ? 'combat' : (isRemoteMyTurn ? 'combat' : 'exploration');
  const displayCombatState: CombatState | null = gameState === 'combat' ? combatState : (isRemoteMyTurn ? remoteCombat!.combatState : null);

  const validTargets = useMemo((): TargetOption[] => {
    if (!displayCombatState) return [];
    return displayCombatState.initiativeOrder
      .filter(e => e.type === 'enemy' && e.hp > 0)
      .map(e => ({ id: e.id, name: e.name, ac: e.ac, hp: e.hp, maxHp: e.maxHp, proximity: e.proximity }));
  }, [displayCombatState]);
  const validShoveTargets = useMemo(() => validTargets.filter(t => t.proximity === 'close'), [validTargets]);

  const handleOpenRollSheet = useCallback((hint: 'attack' | 'hide' | 'provoke' | 'shove') => {
    const targets = hint === 'shove' ? validShoveTargets : validTargets;
    setRollSheetAction({ hint, validTargets: targets });
  }, [validTargets, validShoveTargets]);

  // Auto-advance turn for unconscious characters — death save resolves server-side
  const isMyTurnLocal = combatState?.activeActorId === characterId;
  const isMyTurn = isMyTurnLocal || isRemoteMyTurn;
  const bonusActionUsed = isMyTurn ? (displayCombatState?.currentTurnUsage.bonusActionUsed ?? false) : undefined;
  const currentRound = combatState?.round ?? remoteCombat?.combatState.round ?? 0;
  useEffect(() => {
    if (!isMyTurn) return;
    const isDying = (characterStats?.currentHp ?? 1) <= 0;
    // Stop auto-advancing once heroic sacrifice is triggered
    if (!isDying || hasSacrifice || autoEndTurnFiredRoundRef.current === currentRound || sendingRef.current) return;
    autoEndTurnFiredRoundRef.current = currentRound;
    const t = setTimeout(() => executeDirectAction('end turn', 'end_turn'), 800);
    return () => clearTimeout(t);
  }, [isMyTurn, characterStats?.currentHp, currentRound, hasSacrifice, executeDirectAction]);

  // Self-healing: if an enemy holds the active slot and this character is enrolled, fire end_turn
  // so the server runs the enemy loop and advances to the player's turn.
  const activeActorId = combatState?.activeActorId ?? null;
  useEffect(() => {
    if (!combatState || !characterId || isMyTurn || sendingRef.current) return;
    const activeActor = combatState.initiativeOrder.find(e => e.id === activeActorId);
    const isEnrolled = combatState.initiativeOrder.some(e => e.id === characterId);
    if (activeActor?.type !== 'enemy' || !isEnrolled) return;
    // Stop self-healing once heroic sacrifice is triggered — character is removed from combat
    if (hasSacrifice) return;
    // Deduplicate by (round, actorId) to handle multi-round enemy turns correctly
    const dedupeKey = `${currentRound}:${activeActorId}`;
    if (autoResolveEnemyActorRef.current === dedupeKey) return;
    autoResolveEnemyActorRef.current = dedupeKey;
    const t = setTimeout(() => executeDirectAction('end turn', 'end_turn'), 1500);
    return () => clearTimeout(t);
  }, [activeActorId, characterId, combatState, isMyTurn, currentRound, hasSacrifice, executeDirectAction]);

  const isDyingInCombat = (characterStats?.currentHp ?? 1) <= 0 && displayGameState === 'combat' && !hasSacrifice;
  const myEntry = combatState?.initiativeOrder.find(e => e.id === characterId);
  const deathSaveSuccesses = myEntry?.deathSaveSuccesses ?? 0;
  const deathSaveFailures = myEntry?.deathSaveFailures ?? 0;

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
        gameState={displayGameState}
        round={displayCombatState?.round}
        hp={characterStats?.currentHp}
        maxHp={characterStats?.maxHp}
      />

      {/* Death save status overlay */}
      {isDyingInCombat && (
        <div className="fixed bottom-32 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="bg-slate-900/90 text-white rounded-2xl px-5 py-4 w-full max-w-sm shadow-2xl">
            <p className="text-sm font-semibold text-center mb-3 text-red-300">Unconscious — Death Saving Throws</p>
            <div className="flex justify-center gap-8">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">Successes</p>
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < deathSaveSuccesses ? 'bg-emerald-400 border-emerald-400' : 'border-slate-500'}`} />
                  ))}
                </div>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">Failures</p>
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < deathSaveFailures ? 'bg-red-400 border-red-400' : 'border-slate-500'}`} />
                  ))}
                </div>
              </div>
            </div>
            {isMyTurn && <p className="text-[11px] text-slate-400 text-center mt-3">Rolling death save…</p>}
          </div>
        </div>
      )}

      {/* Auto long rest modal */}
      {autoRestApplied && !autoRestDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full space-y-3">
            <p className="font-semibold text-slate-800 text-base">🏕 While you were away…</p>
            <p className="text-sm text-slate-500">Your party rested. HP and abilities restored.</p>
            <button onClick={() => setAutoRestDismissed(true)} className="w-full py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 transition-colors">Got it</button>
          </div>
        </div>
      )}

      {/* Heroic sacrifice modal */}
      {hasSacrifice && (sacrificeModalOpen || !popupDismissed) && activePending?.type === 'heroic_sacrifice' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full space-y-4">
            <div className="text-center space-y-1">
              <p className="text-2xl opacity-40">⚔</p>
              <p className="font-bold text-slate-800 text-lg">{activePending.fallenName} has fallen.</p>
              <p className="text-sm text-slate-500">Their story will be remembered by all who stood beside them.</p>
            </div>
            <p className="text-sm text-slate-600 text-center">
              Your adventure continues — create your next character at level {activePending.fallenLevel} and rejoin the party when they reach safety.
            </p>
            <button
              onClick={handleConfirmSacrifice}
              disabled={sacrificeConfirming}
              className="w-full py-2.5 bg-slate-800 text-white rounded-lg text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {sacrificeConfirming ? 'Redirecting…' : 'Begin Character Creation'}
            </button>
            <button
              onClick={() => { setSacrificeModalOpen(false); setPopupDismissed(true); }}
              className="w-full py-1.5 text-xs text-slate-400 hover:text-slate-600"
            >
              Watch combat
            </button>
          </div>
        </div>
      )}

      {/* Level-up popup — fires once per session when pending choices exist (non-sacrifice) */}
      {hasPendingChoice && !hasSacrifice && !popupDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 mx-4 max-w-sm w-full space-y-4">
            <p className="font-semibold text-slate-800 text-base">
              {activePending?.type === 'asi'
                ? `Level ${activePending.level} — Ability Score Improvement`
                : `Level ${activePending?.level} — Choose your subclass`}
            </p>
            <p className="text-sm text-slate-500">You have a pending level-up choice. Review it now or come back later.</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setPopupDismissed(true); setActiveTab('party'); }}
                className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors"
              >
                Review now
              </button>
              <button
                onClick={() => setPopupDismissed(true)}
                className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending choice strip — red for sacrifice, amber for level-up */}
      {hasPendingChoice && pendingStripText && (
        stripCollapsed ? (
          <div
            className={`h-1 flex-shrink-0 ${hasSacrifice ? 'bg-red-500' : 'bg-amber-400'}`}
            onClick={() => setStripCollapsed(false)}
          />
        ) : hasSacrifice ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 flex-shrink-0">
            <span className="flex-1 text-xs font-semibold text-red-800 truncate">{pendingStripText}</span>
            <button
              onClick={() => { setSacrificeModalOpen(true); setPopupDismissed(true); }}
              className="text-xs font-bold text-red-700 border border-red-300 rounded px-2 py-0.5 hover:bg-red-100 transition-colors shrink-0"
            >
              Go
            </button>
            <button
              onClick={() => setStripCollapsed(true)}
              className="text-red-400 hover:text-red-600 shrink-0 text-base leading-none"
              aria-label="Collapse pending choice strip"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 flex-shrink-0">
            <span className="flex-1 text-xs font-semibold text-amber-800 truncate">{pendingStripText}</span>
            <button
              onClick={() => { setActiveTab('party'); setPopupDismissed(true); }}
              className="text-xs font-bold text-amber-700 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-100 transition-colors shrink-0"
            >
              Go
            </button>
            <button
              onClick={() => setStripCollapsed(true)}
              className="text-amber-500 hover:text-amber-700 shrink-0 text-base leading-none"
              aria-label="Collapse pending choice strip"
            >
              ×
            </button>
          </div>
        )
      )}

      {remoteCombat && (
        <RemoteCombatBanner remoteCombat={remoteCombat} isMyTurn={isRemoteMyTurn} />
      )}

      {displayGameState === 'combat' && displayCombatState && (
        <>
          <InitiativeStrip
            initiativeOrder={displayCombatState.initiativeOrder}
            activeActorId={displayCombatState.activeActorId}
            characterId={characterId!}
            characterClass={characterStats?.characterClass ?? ''}
            selectedId={selectedStripEntryId}
            partyMembers={partyMembers}
            onSelect={setSelectedStripEntryId}
          />
          {selectedStripEntryId && (() => {
            const entry = displayCombatState.initiativeOrder.find(e => e.id === selectedStripEntryId);
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
            gameState={displayGameState}
            combatState={displayCombatState}
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
            onFeatureActivate={handleFeatureActivate}
            onOpenRollSheet={handleOpenRollSheet}
            situationSummary={situationSummary}
            combatAlert={combatAlert}
          />
        )}
        {activeTab === 'inventory' && (
          <InventoryTab
            characterInventory={characterInventory}
            gameState={displayGameState}
            onExplorationAction={handleInventoryAction}
            onCombatUse={handleCombatUseItem}
            proximityPoi={proximityPoi}
            availablePois={availablePois}
            partyMembers={partyMembers.map(m => ({ id: m.characterId, name: m.characterName }))}
            combatState={displayCombatState}
          />
        )}
        {activeTab === 'party' && (
          <PartyTab
            characterStats={characterStats}
            gameState={displayGameState}
            onFeatureActivate={handleFeatureActivate}
            partyMembers={partyMembers}
            characterId={characterId!}
            onAsiResolve={handleAsiResolve}
            onSubclassResolve={handleSubclassResolve}
            onShortRest={handleShortRest}
            onMakeCamp={handleMakeCamp}
            canLongRest={canLongRest}
            bonusActionUsed={bonusActionUsed}
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

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} hasPendingChoice={hasPendingChoice} />

      {rollSheetAction && characterId && (
        <CombatRollSheet
          actionHint={rollSheetAction.hint}
          attackBonus={characterStats?.attackBonus ?? 0}
          validTargets={rollSheetAction.validTargets}
          isSending={sending}
          onRoll={(flavorText, targetId) => handleRoll(rollSheetAction.hint, flavorText, targetId)}
          onDismiss={handleRollSheetDismiss}
          diceCount={(() => {
            const entry = combatState?.initiativeOrder.find(e => e.id === characterId);
            if (!entry) return 1;
            const hasAdvantage = entry.status_effects.includes('advantage_next_attack');
            const hasElvenAccuracy = entry.status_effects.includes('elven_accuracy_next_attack');
            if (hasElvenAccuracy) return 3;
            if (hasAdvantage) return 2;
            return 1;
          })()}
        />
      )}
      {chatRollResult && !rollSheetAction && (
        <CombatRollSheet
          actionHint={chatRollResult.hint}
          attackBonus={characterStats?.attackBonus ?? 0}
          validTargets={[]}
          isSending={false}
          onRoll={async () => chatRollResult.result}
          onDismiss={handleChatRollDismiss}
          immediateResult={chatRollResult.result}
        />
      )}
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
