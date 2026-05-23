"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "../../../lib/supabase-client";
import { getGame } from "../../actions/get-game";
import { takeTurn } from "../../actions/take-turn";
import { initializeGame } from "../../actions/initialize-game";
import MapRenderer, { type MapData, type PartyMarker } from "../../../components/map-renderer";
import UserMenu from "../../../components/user-menu";
import { classEmoji } from "../../../lib/class-emoji";
import type { D20Result } from "../../../lib/dice";
import { xpForNextLevel, XP_THRESHOLDS } from "../../../lib/xp";
import { proficiencyBonus } from "../../../lib/leveling";
import { getCharacterSheetData } from "../../../lib/character-sheet";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GameState {
  playerPos:       { x: number; y: number };
  hp:              number;
  maxHp:           number;
  inventory:       string[];
  equipped:        { weapon: string | null; armor: string | null };
  npcsEncountered: { name: string; disposition: string; note: string }[];
  plotFlags:       string[];
  activeObjective: string;
  // Party extensions
  partyPositions?: Record<string, { x: number; y: number }>;
  partyHp?:        Record<string, number>;
  partyMaxHp?:     Record<string, number>;
}

interface LevelUpResult {
  oldLevel:         number;
  newLevel:         number;
  oldMaxHp:         number;
  newMaxHp:         number;
  proficiencyBonus: number;
}

interface CharacterData {
  id:             string;
  name:           string;
  characterClass: string;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
  xp:             number;
  level:          number;
}

interface PartyMemberData {
  id:          string;
  characterId: string;
  userId:      string;
  status:      string;
  turnOrder:   number;
  character:   CharacterData;
  user:        { id: string; displayName: string | null; email: string };
}

interface MessageData {
  id:        string;
  role:      "PLAYER" | "DUNGEON_MASTER";
  content:   string;
  chips:     string[] | null;
  createdAt: string;
}

interface GameFull {
  id:                    string;
  phase:                 string;
  currentTurnCharacterId: string | null;
  state:                 GameState;
  character:             CharacterData;
  storyPrompt:           { title: string; description: string };
  map:                   { name: string; data: MapData };
  messages:              MessageData[];
  partyMembers:          PartyMemberData[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHRONICLE_LIMIT = 20;

function hpBarColor(hp: number, max: number): string {
  const p = hp / max;
  if (p > 0.5) return "bg-emerald-500";
  if (p > 0.25) return "bg-amber-500";
  return "bg-red-500";
}

function hpTextColor(hp: number, max: number): string {
  const p = hp / max;
  if (p > 0.5) return "text-emerald-700";
  if (p > 0.25) return "text-amber-700";
  return "text-red-700";
}

function memberDisplayName(m: PartyMemberData): string {
  return m.user.displayName || m.user.email.split("@")[0];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "field" | "party" | "chronicle";

const TABS: { id: Tab; label: string }[] = [
  { id: "field",     label: "The Field" },
  { id: "party",     label: "Party"     },
  { id: "chronicle", label: "Chronicle" },
];

export default function GamePage() {
  const params  = useParams();
  const router  = useRouter();
  const gameId  = params.id as string;

  const [currentUserId,  setCurrentUserId]  = useState<string | null>(null);
  const [gameData,       setGameData]       = useState<GameFull | null>(null);
  const [loadError,      setLoadError]      = useState("");
  const [loading,        setLoading]        = useState(true);
  const [localMessages,  setLocalMessages]  = useState<MessageData[]>([]);
  const [localState,     setLocalState]     = useState<GameState | null>(null);
  const [activeTab,      setActiveTab]      = useState<Tab>("field");
  const [isInitializing, setIsInitializing] = useState(false);
  const [isTakingTurn,   setIsTakingTurn]   = useState(false);
  const [diceResult,     setDiceResult]     = useState<D20Result | null>(null);
  const [levelUpResult,    setLevelUpResult]    = useState<LevelUpResult | null>(null);
  const [turnError,        setTurnError]        = useState<string | null>(null);
  const [localHpOverrides, setLocalHpOverrides] = useState<Record<string, number>>({});
  const [hpFlashing,       setHpFlashing]       = useState(false);

  const initCalledRef = useRef(false);

  // ── Auth ──
  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
    });
  }, []);

  // ── Load game ──
  useEffect(() => {
    getGame(gameId).then((res) => {
      if (res.success && res.data) {
        const data = res.data as unknown as GameFull;
        // If the game is still in the lobby, go back there.
        if (data.phase === "LOBBY") {
          router.replace(`/game/${gameId}/lobby`);
          return;
        }
        setGameData(data);
        setLocalMessages(data.messages);
        setLocalState(data.state);
      } else {
        setLoadError(res.error ?? "Game not found.");
      }
      setLoading(false);
    });
  }, [gameId, router]);

  // ── Auto-generate opening scene if no messages yet ──
  useEffect(() => {
    if (!gameData || localMessages.length > 0 || initCalledRef.current) return;
    initCalledRef.current = true;
    setIsInitializing(true);
    initializeGame(gameId).then((res) => {
      if (res.success && res.narrative) {
        setLocalMessages([{
          id:        `dm-init-${Date.now()}`,
          role:      "DUNGEON_MASTER",
          content:   res.narrative,
          chips:     res.chips ?? [],
          createdAt: new Date().toISOString(),
        }]);
      }
      setIsInitializing(false);
    });
  }, [gameData, gameId, localMessages.length]);

  // ── Derived ──
  const myMember = gameData?.partyMembers.find((m) => m.userId === currentUserId);
  const isMyTurn = !!myMember && myMember.characterId === gameData?.currentTurnCharacterId;
  const currentTurnMember = gameData?.partyMembers.find(
    (m) => m.characterId === gameData?.currentTurnCharacterId
  );
  const currentChips: string[] =
    [...localMessages].reverse().find((m) => m.role === "DUNGEON_MASTER")?.chips ?? [];

  // ── Chip handler ──
  async function handleChipClick(chip: string) {
    if (isTakingTurn || isInitializing || !localState) return;
    setIsTakingTurn(true);
    setDiceResult(null);
    setLevelUpResult(null);
    setTurnError(null);

    const playerMsg: MessageData = {
      id:        `player-${Date.now()}`,
      role:      "PLAYER",
      content:   chip,
      chips:     null,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, playerMsg]);

    const result = await takeTurn(gameId, chip);
    if (result.success && result.narrative) {
      setLocalMessages((prev) => [...prev, {
        id:        `dm-${Date.now()}`,
        role:      "DUNGEON_MASTER",
        content:   result.narrative!,
        chips:     result.chips ?? [],
        createdAt: new Date().toISOString(),
      }]);
      if (result.newState) setLocalState(result.newState as unknown as GameState);
      setDiceResult(result.diceResult ?? null);
      setLevelUpResult(result.levelUpResult ?? null);

      if (result.combatEffects && result.combatEffects.length > 0) {
        const overrides: Record<string, number> = {};
        const myCharId = myMember?.characterId ?? gameData?.character.id;
        let myCharAffected = false;
        for (const eff of result.combatEffects) {
          overrides[eff.targetId] = eff.newHp;
          if (myCharId && eff.targetId === myCharId) myCharAffected = true;
        }
        setLocalHpOverrides((prev) => ({ ...prev, ...overrides }));
        if (myCharAffected) {
          setHpFlashing(true);
          setTimeout(() => setHpFlashing(false), 800);
        }
      }

      // Re-fetch to get the updated currentTurnCharacterId.
      getGame(gameId).then((res) => {
        if (res.success && res.data) {
          setGameData(res.data as unknown as GameFull);
        }
      });
    } else {
      setLocalMessages((prev) => prev.filter((m) => m.id !== playerMsg.id));
      setDiceResult(null);
      setLevelUpResult(null);
      const msg = result.error === "STALE_TURN"
        ? "Another action was submitted first — please try again."
        : result.error === "It's not your turn."
          ? "It's not your turn."
          : "The Dungeon Master is temporarily unavailable. Please try again in a moment.";
      setTurnError(msg);
    }
    setIsTakingTurn(false);
  }

  // ── Render ──
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500 animate-pulse">Entering the realm...</p>
      </div>
    );
  }
  if (loadError || !gameData || !localState) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{loadError || "Something went wrong."}</p>
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">← Back to roster</Link>
      </div>
    );
  }

  const { character, storyPrompt, map, partyMembers } = gameData;
  const isPartyGame  = partyMembers.length > 1;
  const myCharId     = myMember?.characterId ?? character.id;
  const displayHp    = localHpOverrides[myCharId]
    ?? (isPartyGame ? localState.partyHp?.[myCharId] : localState.hp)
    ?? localState.hp;
  const displayMaxHp = isPartyGame
    ? (localState.partyMaxHp?.[myCharId] ?? localState.maxHp)
    : localState.maxHp;

  // Build party markers for the map — one emoji per character.
  const partyMarkers: PartyMarker[] = partyMembers.map((m) => ({
    characterId:   m.characterId,
    pos:           localState.partyPositions?.[m.characterId] ?? localState.playerPos,
    emoji:         classEmoji(m.character.characterClass),
    isCurrentTurn: m.characterId === gameData.currentTurnCharacterId,
  }));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Sticky top block: turn bar (very top) + header + tabs ── */}
      <div className="sticky top-0 z-10">

        {/* Turn indicator bar — pinned above everything else for party games */}
        {isPartyGame && (
          <div className={`px-4 py-2 flex items-center gap-2 border-b text-sm font-medium ${
            isMyTurn
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-slate-100 border-slate-200 text-slate-500"
          }`}>
            {isMyTurn ? (
              <>
                <span>{classEmoji(myMember!.character.characterClass)}</span>
                <span>Your turn, {myMember!.character.name}!</span>
              </>
            ) : currentTurnMember ? (
              <>
                <span>{classEmoji(currentTurnMember.character.characterClass)}</span>
                <span>Waiting for {currentTurnMember.character.name}…</span>
              </>
            ) : (
              <span>Waiting for the adventure to begin…</span>
            )}
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shadow-sm">
          <Link href="/" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
            ← Roster
          </Link>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">{storyPrompt.title}</p>
            <p className="text-xs text-slate-400">{isPartyGame ? `${partyMembers.length} players` : character.name}</p>
          </div>
          <UserMenu />
        </header>

        {/* HP HUD — character level + animated HP bar, visible across all tabs */}
        <div
          className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-3"
          style={hpFlashing ? { animation: "hp-flash 0.8s ease-out forwards" } : undefined}
        >
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest shrink-0 w-10">
            Lv {(myMember?.character ?? character).level}
          </span>
          <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${hpBarColor(displayHp, displayMaxHp)}`}
              style={{ width: `${Math.max(0, Math.min(100, (displayHp / displayMaxHp) * 100))}%` }}
            />
          </div>
          <span className={`text-xs font-mono font-semibold shrink-0 tabular-nums ${hpTextColor(displayHp, displayMaxHp)}`}>
            {displayHp} / {displayMaxHp}
          </span>
        </div>

        {/* Tab bar */}
        <nav className="flex border-b border-slate-200 bg-white">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-bold tracking-wide transition-colors ${
                activeTab === tab.id
                  ? "text-amber-900 border-b-[3px] border-amber-500 bg-amber-50"
                  : "text-slate-500 hover:text-slate-800 border-b-[3px] border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto">
        {activeTab === "field" && (
          <FieldTab
            state={localState}
            map={map}
            storyPrompt={storyPrompt}
            messages={localMessages}
            chips={currentChips}
            partyMarkers={isPartyGame ? partyMarkers : []}
            onChipClick={handleChipClick}
            isInitializing={isInitializing}
            isTakingTurn={isTakingTurn}
            chipsEnabled={!isPartyGame || isMyTurn}
            diceResult={diceResult}
            levelUpResult={levelUpResult}
            turnError={turnError}
          />
        )}
        {activeTab === "party" && (
          <PartyTab
            partyMembers={partyMembers}
            state={localState}
            currentTurnCharacterId={gameData.currentTurnCharacterId}
            currentUserId={currentUserId}
            hpOverrides={localHpOverrides}
          />
        )}
        {activeTab === "chronicle" && (
          <ChronicleTab storyPrompt={storyPrompt} messages={localMessages} />
        )}
      </div>
    </div>
  );
}

// ─── Tab: The Field ───────────────────────────────────────────────────────────

function FieldTab({
  state, map, storyPrompt, messages, chips, partyMarkers,
  onChipClick, isInitializing, isTakingTurn, chipsEnabled, diceResult, levelUpResult, turnError,
}: {
  state:          GameState;
  map:            { name: string; data: MapData };
  storyPrompt:    { title: string; description: string };
  messages:       MessageData[];
  chips:          string[];
  partyMarkers:   PartyMarker[];
  onChipClick:    (chip: string) => void;
  isInitializing: boolean;
  isTakingTurn:   boolean;
  chipsEnabled:   boolean;
  diceResult?:    D20Result | null;
  levelUpResult?: LevelUpResult | null;
  turnError?:     string | null;
}) {
  const lastDm        = [...messages].reverse().find((m) => m.role === "DUNGEON_MASTER");
  const situationText = lastDm?.content ?? storyPrompt.description;
  const isLoading     = isInitializing || isTakingTurn;

  return (
    <div className="flex flex-col lg:flex-row h-full">
      <div className="flex-1 p-4 sm:p-6 space-y-5 overflow-auto">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            {map.name}
          </p>
          <MapRenderer
            mapData={map.data}
            playerPos={state.playerPos}
            partyMarkers={partyMarkers.length > 0 ? partyMarkers : undefined}
          />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Current Situation
          </p>
          <p className="text-xs font-medium text-amber-600 mb-2">
            Objective: {state.activeObjective}
          </p>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-h-[60px] space-y-2">
            {/* Dice card — ephemeral, above narrative, hidden while loading */}
            {isTakingTurn && (
              <div className="h-6 bg-amber-100 rounded animate-pulse" />
            )}
            {!isTakingTurn && diceResult && (
              <DiceCard result={diceResult} />
            )}
            {!isTakingTurn && levelUpResult && (
              <LevelUpCard result={levelUpResult} />
            )}
            {isInitializing ? (
              <p className="text-sm text-slate-400 italic animate-pulse">
                The Dungeon Master is setting the scene...
              </p>
            ) : (
              <p className="text-sm text-slate-700 leading-relaxed">{situationText}</p>
            )}
          </div>
        </div>
      </div>

      {/* Action chips */}
      <div className="w-full lg:w-64 border-t lg:border-t-0 lg:border-l border-slate-200 p-4 flex flex-col gap-3 bg-white">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
          What do you do?
        </p>
        <div className="space-y-2 flex-1">
          {isInitializing ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))
          ) : !chipsEnabled ? (
            <p className="text-xs text-slate-400 italic pt-1">
              Waiting for another player's turn…
            </p>
          ) : chips.length > 0 ? (
            chips.map((chip) => (
              <button
                key={chip}
                onClick={() => onChipClick(chip)}
                disabled={isLoading}
                className={`w-full text-left text-sm px-3 py-2.5 rounded-lg border transition-colors ${
                  isLoading
                    ? "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                    : "border-slate-300 text-slate-700 bg-white hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100"
                }`}
              >
                {chip}
              </button>
            ))
          ) : (
            <p className="text-xs text-slate-400 italic">Awaiting the Dungeon Master…</p>
          )}
          {isTakingTurn && (
            <p className="text-xs text-slate-400 animate-pulse pt-1">The dungeon responds…</p>
          )}
          {turnError && (
            <p className="text-xs text-red-500 pt-1">{turnError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dice card ────────────────────────────────────────────────────────────────

function DiceCard({ result }: { result: D20Result }) {
  let outcomeText: string;
  let outcomeColor: string;

  if (result.critical) {
    outcomeText  = "CRIT!";
    outcomeColor = "text-green-600 font-bold";
  } else if (result.fumble) {
    outcomeText  = "FUMBLE!";
    outcomeColor = "text-red-600 font-bold";
  } else if (result.success && result.dcType === "AC") {
    outcomeText  = "HIT!";
    outcomeColor = "text-green-600 font-semibold";
  } else if (result.success && result.dcType === "DC") {
    outcomeText  = "SUCCESS!";
    outcomeColor = "text-green-600 font-semibold";
  } else if (!result.success && result.dcType === "AC") {
    outcomeText  = "MISS!";
    outcomeColor = "text-red-500 font-semibold";
  } else {
    outcomeText  = "FAIL!";
    outcomeColor = "text-red-500 font-semibold";
  }

  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
      <span className="text-base">🎲</span>
      <span className="font-mono text-slate-700">
        {result.roll} + {result.modifier} = {result.total}
      </span>
      <span className="text-slate-400">vs {result.dcType} {result.dc}</span>
      <span className={outcomeColor}>{outcomeText}</span>
    </div>
  );
}

// ─── Level-up card ────────────────────────────────────────────────────────────

function LevelUpCard({ result }: { result: LevelUpResult }) {
  const profChanged = proficiencyBonus(result.newLevel) !== proficiencyBonus(result.oldLevel);
  return (
    <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm">
      <span className="text-base">⬆</span>
      <span className="font-semibold text-indigo-700">
        Level {result.oldLevel} → {result.newLevel}
      </span>
      <span className="text-slate-500">
        Max HP: {result.oldMaxHp} → {result.newMaxHp}
      </span>
      {profChanged && (
        <span className="text-slate-500">
          Proficiency Bonus: +{result.proficiencyBonus}
        </span>
      )}
    </div>
  );
}

// ─── Tab: Party ───────────────────────────────────────────────────────────────

type PartySubTab = "stats" | "inventory" | "abilities";

const CLASS_FEATURES: Record<string, string[]> = {
  Barbarian: ["Rage (2/day)", "Unarmored Defense", "Reckless Attack"],
  Bard:      ["Bardic Inspiration (d6)", "Jack of All Trades", "Song of Rest"],
  Cleric:    ["Divine Domain", "Channel Divinity", "Spellcasting"],
  Druid:     ["Wild Shape", "Druidic", "Spellcasting"],
  Fighter:   ["Action Surge", "Second Wind", "Fighting Style"],
  Monk:      ["Martial Arts", "Ki Points", "Unarmored Defense"],
  Paladin:   ["Divine Smite", "Lay on Hands", "Aura of Protection"],
  Ranger:    ["Favored Enemy", "Natural Explorer", "Spellcasting"],
  Rogue:     ["Sneak Attack", "Cunning Action", "Thieves' Cant"],
  Sorcerer:  ["Sorcerous Origin", "Metamagic", "Spellcasting"],
  Warlock:   ["Pact Magic", "Eldritch Invocations", "Patron Feature"],
  Wizard:    ["Arcane Recovery", "Spellcasting", "Spell Mastery"],
};

function PartyTab({
  partyMembers, state, currentTurnCharacterId, currentUserId, hpOverrides,
}: {
  partyMembers:           PartyMemberData[];
  state:                  GameState;
  currentTurnCharacterId: string | null;
  currentUserId:          string | null;
  hpOverrides:            Record<string, number>;
}) {
  const [subTab, setSubTab] = useState<PartySubTab>("stats");

  const myMember = partyMembers.find((m) => m.userId === currentUserId);
  const others   = partyMembers.filter((m) => m.userId !== currentUserId);
  const ordered  = myMember ? [myMember, ...others] : partyMembers;

  return (
    <div className="p-4 sm:p-6 max-w-2xl">
      {/* Sub-tab switcher */}
      <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1">
        {(["stats", "inventory", "abilities"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors ${
              subTab === t
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ordered.map((m) => {
          const isMe     = m.userId === currentUserId;
          const hp       = hpOverrides[m.characterId] ?? state.partyHp?.[m.characterId] ?? state.hp;
          const maxHp    = state.partyMaxHp?.[m.characterId] ?? state.maxHp;
          const hpPct    = Math.max(0, Math.min(100, (hp / maxHp) * 100));
          const isActive = m.characterId === currentTurnCharacterId;

          return (
            <div
              key={m.id}
              className={`bg-white border rounded-xl p-4 shadow-sm space-y-3 ${
                isActive
                  ? "border-green-300 ring-1 ring-green-200"
                  : isMe
                    ? "border-amber-300 ring-1 ring-amber-100"
                    : "border-slate-200"
              }`}
            >
              {/* Identity */}
              <div className="flex items-start gap-3">
                <span className="text-4xl leading-none">{classEmoji(m.character.characterClass)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-900 text-sm">{m.character.name}</p>
                    {isMe && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                        You
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">
                        Their turn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">{memberDisplayName(m)}</p>
                  <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded-full mt-1 text-slate-500">
                    {m.character.characterClass}
                  </span>
                </div>
              </div>

              {/* HP bar — always visible */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>HP</span>
                  <span className="font-mono">{hp} / {maxHp}</span>
                </div>
                <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${hpBarColor(hp, maxHp)}`}
                    style={{ width: `${hpPct}%` }}
                  />
                </div>
              </div>

              {/* Sub-tab content */}
              {subTab === "stats"     && <MemberStatsPane char={m.character} />}
              {subTab === "inventory" && <MemberInventoryPane isMe={isMe} state={state} />}
              {subTab === "abilities" && <MemberAbilitiesPane char={m.character} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STAT_EMOJI: Record<string, string> = {
  strength:     "💪",
  dexterity:    "🤸",
  constitution: "🛡️",
  intelligence: "🧠",
  wisdom:       "🌲",
  charisma:     "💬",
};

const STAT_FULL_NAME: Record<string, string> = {
  strength:     "Strength",
  dexterity:    "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom:       "Wisdom",
  charisma:     "Charisma",
};

function MemberStatsPane({ char }: { char: CharacterData }) {
  const sheet = getCharacterSheetData(char);

  const level    = Math.max(1, Math.min(5, char.level));
  const atCap    = level >= 5;
  const nextXp   = atCap ? null : xpForNextLevel(level);
  const prevXp   = XP_THRESHOLDS[level - 1] ?? 0;
  const xpInLvl  = char.xp - prevXp;
  const xpNeeded = nextXp !== null ? nextXp - prevXp : 1;
  const xpPct    = atCap ? 100 : Math.max(0, Math.min(100, (xpInLvl / xpNeeded) * 100));
  const xpLabel  = atCap ? "Level 5  ·  MAX" : `Level ${level}  ·  XP: ${char.xp} / ${nextXp}`;
  const fmtMod   = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  const profBg   = "bg-green-50";

  return (
    <div className="space-y-2">

      {/* XP bar */}
      <div className="space-y-1">
        <div className="text-xs text-slate-500">{xpLabel}</div>
        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      {/* Proficient legend — own row, right-aligned, above stats */}
      <div className="flex justify-end">
        <div className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
          <span className="text-[10px] text-slate-400">Proficient</span>
        </div>
      </div>

      {/* Stat table: row-header col + 6 stat cols */}
      <div className="grid gap-x-0.5 gap-y-0" style={{ gridTemplateColumns: "auto repeat(6, 1fr)" }}>

        {/* Row 1 — emoji + stat abbreviation headers */}
        <div /> {/* empty corner */}
        {sheet.stats.map(({ key, label }) => (
          <div key={`h-${key}`} className="flex flex-col items-center pb-1 gap-0.5">
            <span className="text-sm leading-none">{STAT_EMOJI[key]}</span>
            <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
          </div>
        ))}

        {/* Row 2 — Combat Bonus */}
        <div className="flex items-center pr-2">
          <span className="text-[9px] text-slate-400 leading-tight">Combat<br />Bonus</span>
        </div>
        {sheet.stats.map(({ key, saveMod, saveProficient }) => (
          <div key={`s-${key}`} className={`flex justify-center items-center rounded-t-md pt-2 pb-1 ${saveProficient ? profBg : ""}`}>
            <span className={`text-lg font-bold leading-tight ${saveProficient ? "text-green-900" : "text-slate-800"}`}>
              {fmtMod(saveMod)}
            </span>
          </div>
        ))}

        {/* Row 3 — Raw Score */}
        <div className="flex items-center pr-2">
          <span className="text-[9px] text-slate-400 leading-tight">Raw<br />Score</span>
        </div>
        {sheet.stats.map(({ key, score, saveProficient }) => (
          <div key={`r-${key}`} className={`flex justify-center items-center rounded-b-md pb-2 pt-1 ${saveProficient ? profBg : ""}`}>
            <span className={`text-xs font-medium ${saveProficient ? "text-green-500" : "text-slate-400"}`}>
              {score}
            </span>
          </div>
        ))}

      </div>

      {/* Actions & Skills — grouped by stat */}
      <div className="space-y-2 pt-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Actions &amp; Skills
        </p>
        {sheet.stats
          .filter(({ key }) => sheet.skills.some((s) => s.ability === key))
          .map(({ key }) => {
            const groupSkills = sheet.skills.filter((s) => s.ability === key);
            return (
              <div key={key} className="bg-slate-50 border border-slate-100 rounded-lg p-2 space-y-1">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  {STAT_EMOJI[key]} {STAT_FULL_NAME[key]}
                </p>
                {groupSkills.map(({ name, modifier, proficient }) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between px-2.5 py-1 rounded-full border text-xs ${
                      proficient
                        ? `${profBg} border-green-200`
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <span className={`truncate mr-1 ${proficient ? "font-bold text-green-900" : "text-slate-600"}`}>
                      {name}
                    </span>
                    <span className={`shrink-0 font-mono text-[11px] ${
                      proficient ? "font-bold text-green-900" : "text-slate-500"
                    }`}>
                      {fmtMod(modifier)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
      </div>

    </div>
  );
}

function MemberInventoryPane({ isMe, state }: { isMe: boolean; state: GameState }) {
  if (!isMe) return <p className="text-xs text-slate-400 italic">Inventory is private.</p>;
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Equipped</p>
        <div className="space-y-1">
          <div className="flex gap-2 text-xs">
            <span className="text-slate-500 w-12 shrink-0">Weapon</span>
            <span className="text-slate-800 font-medium">{state.equipped.weapon ?? "—"}</span>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="text-slate-500 w-12 shrink-0">Armor</span>
            <span className="text-slate-800 font-medium">{state.equipped.armor ?? "—"}</span>
          </div>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Bag</p>
        {state.inventory.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {state.inventory.map((item, i) => (
              <li key={i} className="text-xs text-slate-700">· {item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemberAbilitiesPane({ char }: { char: CharacterData }) {
  const prof  = proficiencyBonus(char.level);
  const feats = CLASS_FEATURES[char.characterClass] ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Proficiency Bonus</span>
        <span className="font-bold text-slate-900">+{prof}</span>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
          {char.characterClass} Features
        </p>
        {feats.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No features recorded.</p>
        ) : (
          <ul className="space-y-0.5">
            {feats.map((f) => (
              <li key={f} className="text-xs text-slate-700">· {f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Chronicle ───────────────────────────────────────────────────────────

function ChronicleTab({
  storyPrompt, messages,
}: {
  storyPrompt: { title: string; description: string };
  messages:    MessageData[];
}) {
  // Only show the most recent messages — older history is stored in the DB
  // but rendering thousands of entries would slow the browser down.
  const visible = messages.slice(-CHRONICLE_LIMIT);
  const trimmed = messages.length > CHRONICLE_LIMIT;

  return (
    <div className="p-4 sm:p-6 max-w-2xl space-y-6">
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Chronicle</p>
        <p className="text-xs text-slate-400">{storyPrompt.title}</p>
      </div>

      {/* Opening scene is always shown first */}
      <div className="border-l-2 border-amber-300 pl-4">
        <p className="text-xs text-slate-400 mb-1">Opening</p>
        <p className="text-sm text-slate-700 leading-relaxed">{storyPrompt.description}</p>
      </div>

      {trimmed && (
        <p className="text-xs text-slate-400 italic">
          Showing the last {CHRONICLE_LIMIT} entries. Earlier history is saved but not displayed.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          Your story has not yet unfolded. Return to The Field to begin.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((msg) =>
            msg.role === "DUNGEON_MASTER" ? (
              <div key={msg.id} className="border-l-2 border-slate-200 pl-4">
                <p className="text-sm text-slate-700 leading-relaxed">{msg.content}</p>
              </div>
            ) : (
              <div key={msg.id} className="pl-4">
                <p className="text-xs text-slate-400 italic">You: {msg.content}</p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
