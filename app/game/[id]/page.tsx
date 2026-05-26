"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "../../../lib/supabase-client";
import { getGame } from "../../actions/get-game";
import { takeTurn } from "../../actions/take-turn";
import type { Chip } from "../../../types/chips";
import { initializeGame } from "../../actions/initialize-game";
import { getMapItems, type EquippableItemData } from "../../actions/get-map-items";
import { getClassFeatures, type ClassFeatureData } from "../../actions/get-class-features";
import { updateItem } from "../../actions/update-item";
import MapRenderer, { type MapData, type PartyMarker } from "../../../components/map-renderer";
import UserMenu from "../../../components/user-menu";
import { classEmoji } from "../../../lib/class-emoji";
import type { D20Result } from "../../../lib/dice";
import type { SkillCheckResult } from "../../../lib/skills";
import { xpForNextLevel, XP_THRESHOLDS } from "../../../lib/xp";
import { proficiencyBonus } from "../../../lib/leveling";
import { getCharacterSheetData } from "../../../lib/character-sheet";
import { getCharacterStats } from "../../actions/get-character-stats";
import type { CharacterStats } from "../../../lib/character-stats";
import { SKILL_MAP, resolveChipCost } from "@/config/skills";
import { getContinuationChips } from "@/app/actions/get-continuation-chips";
import { useTurnActions } from "@/hooks/useTurnActions";
import type { TurnCostType } from "@/types/turn-actions";
import RollSheet from "../../../components/roll-sheet";
import type { ActiveRollContext } from "../../../lib/roll-context";
import type { TurnResult } from "../../actions/take-turn";

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
  id:                  string;
  name:                string;
  characterClass:      string;
  baseStrength:        number;
  baseDexterity:       number;
  baseConstitution:    number;
  baseIntelligence:    number;
  baseWisdom:          number;
  baseCharisma:        number;
  xp:                  number;
  level:               number;
  currentHp:           number;
  maxHp:               number;
  skillProficiencies:  string[];
  remainingActions:      number;
  remainingBonusActions: number;
  remainingMovementFeet: number;
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
  chips:     Chip[] | null;
  createdAt: string;
}

interface GameFull {
  id:                    string;
  phase:                 string;
  currentTurnCharacterId: string | null;
  state:                 GameState;
  character:             CharacterData;
  storyPrompt:           { title: string; description: string };
  map:                   { id: string; name: string; data: MapData };
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

function signedColor(n: number): { display: string; cls: string } {
  if (n > 0) return { display: `+${n}`, cls: "text-green-600" };
  if (n < 0) return { display: `${n}`,  cls: "text-red-600"   };
  return       { display: "0",          cls: "text-slate-400"  };
}

// Mini-chip background + text color keyed by the skill's parent ability.
const ABILITY_CHIP_STYLE: Record<string, string> = {
  baseStrength:     "bg-blue-100   text-blue-700",
  baseDexterity:    "bg-teal-100   text-teal-700",
  baseConstitution: "bg-red-100    text-red-700",
  baseIntelligence: "bg-purple-100 text-purple-700",
  baseWisdom:       "bg-green-100  text-green-700",
  baseCharisma:     "bg-yellow-100 text-yellow-700",
};

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
  const [diceResult,       setDiceResult]       = useState<D20Result | null>(null);
  const [levelUpResult,    setLevelUpResult]    = useState<LevelUpResult | null>(null);
  const [skillCheckResult, setSkillCheckResult] = useState<SkillCheckResult | null>(null);
  const [turnError,        setTurnError]        = useState<string | null>(null);
  const [localHpOverrides, setLocalHpOverrides] = useState<Record<string, number>>({});
  const [hpFlashing,       setHpFlashing]       = useState(false);
  const [mapItems,         setMapItems]         = useState<EquippableItemData[]>([]);
  const [activeRollContext,  setActiveRollContext]  = useState<ActiveRollContext | null>(null);
  const [activeRollChipText, setActiveRollChipText] = useState<string>("");

  const initCalledRef  = useRef(false);
  // Stored so it can be cancelled on unmount, preventing a state update on an
  // unmounted component if the user navigates away within the 800 ms flash window.
  const flashTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auth ──
  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
    });
  }, []);

  // ── Flash-timer cleanup ──
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

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
        const initHp: Record<string, number> = {};
        if (data.partyMembers.length > 0) {
          for (const m of data.partyMembers) initHp[m.characterId] = m.character.currentHp;
        } else {
          initHp[data.character.id] = data.character.currentHp;
        }
        setLocalHpOverrides(initHp);
      } else {
        setLoadError(res.error ?? "Game not found.");
      }
      setLoading(false);
    });
  }, [gameId, router]);

  // ── Load map items for potion chip injection ──
  useEffect(() => {
    if (gameData?.map?.id) getMapItems(gameData.map.id).then(setMapItems);
  }, [gameData?.map?.id]);

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
  const dmChips: Chip[] = (
    ([...localMessages].reverse().find((m) => m.role === "DUNGEON_MASTER")?.chips ?? []) as unknown[]
  ).map((c) => typeof c === "string" ? { text: c, type: "investigation" } as Chip : c as Chip);
  const myHp    = localState?.hp    ?? 0;
  const myMaxHp = localState?.maxHp ?? 1;
  const healingPotions = mapItems.filter(
    (i) => i.category === "Consumable" && i.quantity > 0 && i.name.toLowerCase().includes("potion"),
  );
  const potionChip: Chip[] = myMaxHp > 0 && myHp / myMaxHp < 0.5 && healingPotions.length > 0
    ? [{ text: `Use ${healingPotions[0].name}`, type: "medicine" }]
    : [];
  const currentChips = [...potionChip, ...dmChips.filter((c) => !potionChip.some((p) => p.text === c.text))];

  // ── Chip handler ──
  async function handleChipClick(chip: Chip) {
    if (isTakingTurn || isInitializing || !localState) return;
    setIsTakingTurn(true);
    setDiceResult(null);
    setLevelUpResult(null);
    setSkillCheckResult(null);
    setTurnError(null);

    const playerMsg: MessageData = {
      id:        `player-${Date.now()}`,
      role:      "PLAYER",
      content:   chip.text,
      chips:     null,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, playerMsg]);

    try {
      const result = await takeTurn(gameId, chip.text, chip.type);

      // Server-seeded roll required — show the roll sheet and wait for the player.
      if (result.activeRollContext) {
        setActiveRollContext(result.activeRollContext);
        setActiveRollChipText(chip.text);
        return; // finally clears isTakingTurn
      }

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
        setSkillCheckResult(result.skillCheckResult ?? null);

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
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setHpFlashing(false), 800);
          }
        }

        // Re-fetch to get the updated currentTurnCharacterId and settle HP from DB.
        getGame(gameId).then((res) => {
          if (res.success && res.data) {
            const fresh = res.data as unknown as GameFull;
            setGameData(fresh);
            const freshHp: Record<string, number> = {};
            if (fresh.partyMembers.length > 0) {
              for (const m of fresh.partyMembers) freshHp[m.characterId] = m.character.currentHp;
            } else {
              freshHp[fresh.character.id] = fresh.character.currentHp;
            }
            setLocalHpOverrides((prev) => ({ ...prev, ...freshHp }));
          }
        });
      } else {
        setLocalMessages((prev) => prev.filter((m) => m.id !== playerMsg.id));
        setDiceResult(null);
        setLevelUpResult(null);
        setSkillCheckResult(null);
        const msg = result.error === "STALE_TURN"
          ? "Another action was submitted first — please try again."
          : result.error === "It's not your turn."
            ? "It's not your turn."
            : "The Dungeon Master is temporarily unavailable. Please try again in a moment.";
        setTurnError(msg);
      }
    } catch {
      // Unhandled rejection (network error, Next.js serialisation error, etc.)
      // Remove the optimistic player message and surface a generic error.
      setLocalMessages((prev) => prev.filter((m) => m.id !== playerMsg.id));
      setTurnError("The Dungeon Master is temporarily unavailable. Please try again.");
    } finally {
      setIsTakingTurn(false);
    }
  }

  // ── Roll sheet callbacks ──
  function handleRollComplete(result: TurnResult) {
    if (!result.success || !result.narrative) return;
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
    setSkillCheckResult(result.skillCheckResult ?? null);
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
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setHpFlashing(false), 800);
      }
    }
    getGame(gameId).then((res) => {
      if (res.success && res.data) {
        const fresh = res.data as unknown as GameFull;
        setGameData(fresh);
        const freshHp: Record<string, number> = {};
        if (fresh.partyMembers.length > 0) {
          for (const m of fresh.partyMembers) freshHp[m.characterId] = m.character.currentHp;
        } else {
          freshHp[fresh.character.id] = fresh.character.currentHp;
        }
        setLocalHpOverrides((prev) => ({ ...prev, ...freshHp }));
      }
    });
  }

  function handleRollDone() {
    setActiveRollContext(null);
    setActiveRollChipText("");
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
        {/* Always mounted so useTurnActions state survives tab switches */}
        <div className={activeTab !== "field" ? "hidden" : undefined}>
          <FieldTab
            gameId={gameId}
            state={localState}
            map={map}
            storyPrompt={storyPrompt}
            messages={localMessages}
            chips={currentChips}
            character={gameData.character}
            partyMarkers={isPartyGame ? partyMarkers : []}
            onChipClick={handleChipClick}
            isInitializing={isInitializing}
            isTakingTurn={isTakingTurn}
            chipsEnabled={(!isPartyGame || isMyTurn) && !activeRollContext}
            diceResult={diceResult}
            levelUpResult={levelUpResult}
            skillCheckResult={skillCheckResult}
            turnError={turnError}
          />
        </div>
        {activeTab === "party" && (
          <PartyTab
            partyMembers={partyMembers}
            state={localState}
            currentTurnCharacterId={gameData.currentTurnCharacterId}
            currentUserId={currentUserId}
            hpOverrides={localHpOverrides}
            mapId={gameData.map.id}
          />
        )}
        {activeTab === "chronicle" && (
          <ChronicleTab storyPrompt={storyPrompt} messages={localMessages} />
        )}
      </div>
      {activeRollContext && (
        <RollSheet
          activeRollContext={activeRollContext}
          gameId={gameId}
          chipText={activeRollChipText}
          onTurnComplete={handleRollComplete}
          onDone={handleRollDone}
        />
      )}
    </div>
  );
}

// ─── Tab: The Field ───────────────────────────────────────────────────────────

function FieldTab({
  gameId, state, map, storyPrompt, messages, chips, character, partyMarkers,
  onChipClick, isInitializing, isTakingTurn, chipsEnabled, diceResult, levelUpResult, skillCheckResult, turnError,
}: {
  gameId:            string;
  state:             GameState;
  map:               { name: string; data: MapData };
  storyPrompt:       { title: string; description: string };
  messages:          MessageData[];
  chips:             Chip[];
  character:         CharacterData;
  partyMarkers:      PartyMarker[];
  onChipClick:       (chip: Chip) => void;
  isInitializing:    boolean;
  isTakingTurn:      boolean;
  chipsEnabled:      boolean;
  diceResult?:       D20Result | null;
  levelUpResult?:    LevelUpResult | null;
  skillCheckResult?: SkillCheckResult | null;
  turnError?:        string | null;
}) {
  const lastDm        = [...messages].reverse().find((m) => m.role === "DUNGEON_MASTER");
  const situationText = lastDm?.content ?? storyPrompt.description;
  const isLoading     = isInitializing || isTakingTurn;

  // console.log("[FieldTab] character from DB:", {
  //   id:                    character.id,
  //   remainingActions:      character.remainingActions,
  //   remainingBonusActions: character.remainingBonusActions,
  //   remainingMovementFeet: character.remainingMovementFeet,
  // });

  const { mainAction, bonusAction, movementFeet, evaluateActionCost, consumeResource, resetTurnActions } =
    useTurnActions(character.characterClass, character.level, character.id, {
      remainingActions:      character.remainingActions,
      remainingBonusActions: character.remainingBonusActions,
      remainingMovementFeet: character.remainingMovementFeet,
    });

  // Remove choices the player cannot currently afford. 'free' always renders.
  const affordableChips = chips.filter((chip) => {
    const cost = resolveChipCost(chip);
    if (cost.type === "free") return true;
    return evaluateActionCost(cost.type as TurnCostType, cost.value);
  });

  // Stable string key — only changes when DM chip content changes, not on every
  // parent re-render. Prevents the effect below from looping on array reference churn.
  const chipsKey = chips.map((c) => c.text).join("\x00");

  // Incremented by the ↺ refresh button to force a re-fetch without changing chipsKey.
  const [refreshKey, setRefreshKey] = useState(0);

  // Async continuation chips: fetched from the AI when the DM has responded but
  // all chips are filtered (main action spent) and the player still has resources.
  const [continuationChips,   setContinuationChips]   = useState<Chip[]>([]);
  const [loadingContinuation, setLoadingContinuation] = useState(false);
  const [noFurtherActions,    setNoFurtherActions]    = useState(false);

  const needsContinuation =
    chips.length > 0 &&
    affordableChips.length === 0 &&
    (bonusAction.current > 0 || movementFeet.current > 0);

  useEffect(() => {
    if (!needsContinuation) {
      setContinuationChips([]);
      setNoFurtherActions(false);
      setLoadingContinuation(false);
      return;
    }
    let cancelled = false;
    setLoadingContinuation(true);
    setContinuationChips([]);
    setNoFurtherActions(false);
    getContinuationChips(
      gameId,
      { bonusAction: bonusAction.current, movementFeet: movementFeet.current },
      { narrative: lastDm?.content ?? "", characterName: character.name, characterClass: character.characterClass },
    ).then((result) => {
      if (cancelled) return;
      if (result.success && result.chips && result.chips.length > 0) {
        setContinuationChips(result.chips);
        setNoFurtherActions(false);
      } else {
        setNoFurtherActions(true);
      }
      setLoadingContinuation(false);
    }).catch(() => {
      if (cancelled) return;
      setNoFurtherActions(true);
      setLoadingContinuation(false);
    });
    return () => { cancelled = true; };
  // chipsKey (not chips array) re-triggers on new DM narrative without looping on reference churn
  }, [needsContinuation, chipsKey, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side safety net: drop any continuation chip whose resource pool is
  // now empty (guards against stale AI output or resource changes mid-flight).
  const filteredContinuationChips = continuationChips.filter((chip) => {
    const cost = resolveChipCost(chip);
    return cost.type === "free" || evaluateActionCost(cost.type as TurnCostType, cost.value);
  });

  // Show "no further actions" if the fetch returned nothing OR if all returned
  // chips were stripped by the client-side resource filter.
  const showNoFurtherActions =
    noFurtherActions ||
    (!loadingContinuation && continuationChips.length > 0 && filteredContinuationChips.length === 0);

  const displayChips = affordableChips.length > 0 ? affordableChips : filteredContinuationChips;

  function costLabel(type: string, value: number): string {
    if (type === "mainAction")   return "⚡ 1 Action";
    if (type === "bonusAction")  return "✨ Bonus";
    if (type === "free")         return "Free";
    if (type === "movementFeet") return `🏃 ${value}ft`;
    return "";
  }

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
            {!isTakingTurn && (
              skillCheckResult ? (
                <SkillCheckCard result={skillCheckResult} />
              ) : (
                diceResult && <DiceCard result={diceResult} />
              )
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

        <TurnActionsTracker
          mainAction={mainAction}
          bonusAction={bonusAction}
          movementFeet={movementFeet}
        />
      </div>

      {/* Action chips */}
      <div className="w-full lg:w-64 border-t lg:border-t-0 lg:border-l border-slate-200 p-4 flex flex-col gap-3 bg-white">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
            What do you do?
          </p>
          {needsContinuation && (
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loadingContinuation}
              title="Regenerate suggestions"
              className="text-slate-400 hover:text-slate-600 disabled:opacity-30 transition-colors text-base leading-none"
            >
              ↺
            </button>
          )}
        </div>
        <div className="space-y-2 flex-1">
          {isInitializing ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))
          ) : !chipsEnabled ? (
            <p className="text-xs text-slate-400 italic pt-1">
              Waiting for another player's turn…
            </p>
          ) : loadingContinuation ? (
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          ) : displayChips.length > 0 ? (
            <>{displayChips.map((chip, i) => {
              const skill        = SKILL_MAP[chip.type] ?? SKILL_MAP["investigation"];
              const abilityScore = character[skill.abilityKey as keyof CharacterData] as number;
              const abilityMod   = Math.floor((abilityScore - 10) / 2);
              const proficient   = character.skillProficiencies.includes(skill.label);
              const totalMod     = abilityMod + (proficient ? proficiencyBonus(character.level) : 0);
              const modStr       = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
              const cost         = resolveChipCost(chip);
              return (
                <button
                  key={`${i}-${chip.text}`}
                  onClick={() => { consumeResource(cost.type as TurnCostType, cost.value); onChipClick(chip); }}
                  disabled={isLoading}
                  className={[
                    "w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    isLoading
                      ? "border-slate-200 bg-slate-50 text-slate-400"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100",
                  ].join(" ")}
                >
                  {/* Action text */}
                  <span className="flex-1 min-w-0 truncate text-xs font-medium">
                    {skill.emoji} {chip.text}
                  </span>
                  {/* Attribute bonus mini-chip — colored by parent ability */}
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${ABILITY_CHIP_STYLE[skill.abilityKey] ?? "bg-slate-100 text-slate-500"}`}>
                    {skill.label} {modStr}
                  </span>
                  {/* Action cost mini-chip — neutral, pushed to far right */}
                  <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {costLabel(cost.type, cost.value)}
                  </span>
                </button>
              );
            })}</>
          ) : showNoFurtherActions ? (
            <p className="text-xs text-slate-400 italic">No further actions available for this situation.</p>
          ) : chips.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Awaiting the Dungeon Master…</p>
          ) : null}
          {isTakingTurn && (
            <p className="text-xs text-slate-400 animate-pulse pt-1">The dungeon responds…</p>
          )}
          {turnError && (
            <p className="text-xs text-red-500 pt-1">{turnError}</p>
          )}
        </div>

        {chipsEnabled && !isInitializing && (
          <button
            onClick={resetTurnActions}
            disabled={isLoading}
            className="w-full text-left text-sm px-3 py-2.5 rounded-lg border-2 border-slate-700 text-slate-700 bg-white font-semibold transition-colors hover:bg-slate-800 hover:text-white hover:border-slate-800 active:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🛑 End Turn &amp; Pass Action
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Turn Actions Tracker ────────────────────────────────────────────────────

function TurnActionsTracker({
  mainAction, bonusAction, movementFeet,
}: {
  mainAction:   { current: number; max: number };
  bonusAction:  { current: number; max: number };
  movementFeet: { current: number; max: number };
}) {
  const activeStyle = "inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-50 text-slate-700 border-slate-200/80 transition-all duration-200";
  const spentStyle  = "inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-100 text-slate-400 border-slate-200 opacity-50 transition-all duration-200";

  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
        Turn Actions
      </p>
      <div className="flex flex-wrap gap-2">
        <span className={mainAction.current > 0 ? activeStyle : spentStyle}>
          {mainAction.current > 0
            ? `⚡ ACTION: ${mainAction.current}/${mainAction.max}`
            : <span className="line-through">✓ ACTION SPENT</span>}
        </span>
        <span className={bonusAction.current > 0 ? activeStyle : spentStyle}>
          {bonusAction.current > 0
            ? `✨ BONUS: ${bonusAction.current}/${bonusAction.max}`
            : <span className="line-through">✓ BONUS SPENT</span>}
        </span>
        <span className={movementFeet.current > 0 ? activeStyle : `${activeStyle} bg-slate-100 text-slate-400 border-slate-200 opacity-40`}>
          {`👟 MOVE: ${movementFeet.current} ft (${Math.ceil(movementFeet.current / 5)} steps)`}
        </span>
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

// ─── Skill Check card ─────────────────────────────────────────────────────────

function SkillCheckCard({ result }: { result: SkillCheckResult }) {
  const profStr = result.proficiencyBonus > 0 ? ` + ${result.proficiencyBonus} prof` : "";
  const outcomeColor = result.success ? "text-green-600" : "text-red-500";
  return (
    <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-sm flex-wrap">
      <span className="text-base">🎲</span>
      <span className="font-semibold text-violet-700 shrink-0">{result.skill}</span>
      <span className="font-mono text-slate-700">
        {result.roll} + {result.modifier}{profStr} = {result.total}
      </span>
      <span className="text-slate-400 shrink-0">vs DC {result.dc}</span>
      <span className={`font-semibold shrink-0 ${outcomeColor}`}>
        {result.success ? "SUCCESS" : "FAIL"}
        {result.roll === 20 && " — CRIT!"}
        {result.roll === 1  && " — FUMBLE!"}
      </span>
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


function PartyTab({
  partyMembers, state, currentTurnCharacterId, currentUserId, hpOverrides, mapId,
}: {
  partyMembers:           PartyMemberData[];
  state:                  GameState;
  currentTurnCharacterId: string | null;
  currentUserId:          string | null;
  hpOverrides:            Record<string, number>;
  mapId:                  string;
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
              {subTab === "stats"     && <MemberStatsPane char={m.character} mapId={mapId} />}
              {subTab === "inventory" && (
                <MemberInventoryPane
                  isMe={isMe}
                  mapId={mapId}
                  strength={m.character.baseStrength}
                />
              )}
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

const SKILL_DESCRIPTION: Record<string, string> = {
  "Acrobatics":      "Balance, tumble, and stay on your feet in difficult terrain or after a fall.",
  "Animal Handling": "Calm, control, or intuit the intentions of beasts and mounts.",
  "Arcana":          "Recall lore about spells, magic items, eldritch symbols, and magical traditions.",
  "Athletics":       "Climb, jump, swim, or grapple — feats of raw physical power.",
  "Deception":       "Mislead others through lies, half-truths, disguise, or misdirection.",
  "History":         "Recall lore about historical events, legendary people, ancient kingdoms, and past wars.",
  "Insight":         "Read a creature's true intentions by studying body language and speech patterns.",
  "Intimidation":    "Influence others through overt threats, hostile actions, or shows of force.",
  "Investigation":   "Search for clues, deduce conclusions, and spot hidden objects by examining an area.",
  "Medicine":        "Stabilize the dying, diagnose illness, and recall knowledge about anatomy and healing.",
  "Nature":          "Recall lore about terrain, plants, animals, weather, and natural cycles.",
  "Perception":      "Spot, hear, or sense the presence of something using your senses.",
  "Performance":     "Entertain an audience through music, dance, acting, storytelling, or other arts.",
  "Persuasion":      "Influence others using tact, social grace, good nature, or a compelling argument.",
  "Religion":        "Recall lore about deities, rites, prayers, religious hierarchies, and holy symbols.",
  "Sleight of Hand": "Pick pockets, conceal objects, or perform fine manual trickery undetected.",
  "Stealth":         "Move silently and stay out of sight to avoid detection by enemies.",
  "Survival":        "Track prey, navigate wilderness, predict weather, and forage for food and shelter.",
};

// ─── AC Calculation ───────────────────────────────────────────────────────────
// Models class-specific unarmored defense before falling back to the standard
// 10 + DEX formula. Each line in the returned array is one addend displayed in
// the expanded breakdown.

interface AcLine { label: string; value: number }

function computeAcBreakdown(
  characterClass: string,
  dexMod: number,
  conMod: number,
  wisMod: number,
  armorBonus: number,
  shieldBonus: number,
): { total: number; lines: AcLine[] } {
  const cls      = characterClass.toLowerCase();
  const isArmored = armorBonus > 0;
  const lines: AcLine[] = [];

  if (cls === "sorcerer") {
    // Draconic Resilience: base 13 + DEX
    lines.push({ label: "Base (Draconic Resilience)", value: 13 });
    lines.push({ label: "Dexterity Bonus",            value: dexMod });
  } else if (cls === "barbarian" && !isArmored) {
    // Unarmored Defense: 10 + DEX + CON
    lines.push({ label: "Base",                 value: 10 });
    lines.push({ label: "Dexterity Bonus",      value: dexMod });
    lines.push({ label: "Constitution Bonus",   value: conMod });
  } else if (cls === "monk" && !isArmored && shieldBonus === 0) {
    // Unarmored Defense: 10 + DEX + WIS (no armor or shield)
    lines.push({ label: "Base",            value: 10 });
    lines.push({ label: "Dexterity Bonus", value: dexMod });
    lines.push({ label: "Wisdom Bonus",    value: wisMod });
  } else {
    // Standard: 10 + DEX
    lines.push({ label: "Base",            value: 10 });
    lines.push({ label: "Dexterity Bonus", value: dexMod });
  }

  if (armorBonus  > 0) lines.push({ label: "Equipped Armor",  value: armorBonus });
  if (shieldBonus > 0) lines.push({ label: "Equipped Shield", value: shieldBonus });

  return { total: lines.reduce((s, l) => s + l.value, 0), lines };
}

function TotalACCard({
  char, equipStats, mapId,
}: {
  char:       CharacterData;
  equipStats: CharacterStats | null;
  mapId:      string;
}) {
  const [mapItems,   setMapItems]   = useState<EquippableItemData[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    getMapItems(mapId).then(setMapItems);
  }, [mapId]);

  const parseAc = (label: string) => {
    const m = label.match(/\+(\d+)\s*AC/i);
    return m ? parseInt(m[1], 10) : 0;
  };

  const equipped     = mapItems.filter((i) => i.isEquipped);
  const armorItems   = equipped.filter((i) => i.category === "Armor" && !i.name.toLowerCase().includes("shield"));
  const shieldItems  = equipped.filter((i) => i.name.toLowerCase().includes("shield"));
  const armorBonus   = armorItems.reduce((sum, i)  => sum + parseAc(i.combatImpactLabel), 0);
  const shieldBonus  = shieldItems.reduce((sum, i) => sum + parseAc(i.combatImpactLabel), 0);

  const dexTotal = equipStats?.dexterity.total    ?? char.baseDexterity;
  const conTotal = equipStats?.constitution.total  ?? char.baseConstitution;
  const wisTotal = equipStats?.wisdom.total        ?? char.baseWisdom;
  const dexMod   = Math.floor((dexTotal - 10) / 2);
  const conMod   = Math.floor((conTotal - 10) / 2);
  const wisMod   = Math.floor((wisTotal - 10) / 2);

  const { total, lines } = computeAcBreakdown(
    char.characterClass, dexMod, conMod, wisMod, armorBonus, shieldBonus,
  );

  const fmtSigned = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  return (
    <div className="rounded-xl border overflow-hidden bg-sky-50 border-sky-200">

      {/* Primary row */}
      <div className="flex items-stretch px-3 py-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xl leading-none">🛡️</span>
          <span className="text-[9px] font-bold text-sky-600 uppercase tracking-widest">Total AC</span>
          <span className="text-2xl font-bold text-sky-900 leading-tight">{total}</span>
        </div>

        <button
          onClick={() => setIsExpanded((p) => !p)}
          className="flex-1 flex items-center justify-end text-sky-400 pr-1"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <span
            className="text-[10px] transition-transform duration-200 inline-block"
            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▼
          </span>
        </button>
      </div>

      {/* Breakdown panel */}
      <div className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${isExpanded ? "max-h-48" : "max-h-0"}`}>
        <div className="px-4 pb-3 pt-1.5 border-t border-sky-100 space-y-1">
          {lines.map(({ label, value }) => (
            <div key={label} className="flex justify-between items-baseline">
              <span className="text-[11px] text-slate-500">{label}</span>
              <span className="text-[11px] font-semibold text-sky-700 font-mono">{fmtSigned(value)}</span>
            </div>
          ))}
          <div className="flex justify-between items-baseline border-t border-sky-100 pt-1 mt-1">
            <span className="text-[11px] font-bold text-slate-600">Total</span>
            <span className="text-[11px] font-bold text-sky-800 font-mono">{total}</span>
          </div>
        </div>
      </div>

    </div>
  );
}

function StatAttributeCard({
  statKey, label, score, saveProficient, profBonus, equipStats, fmtMod,
}: {
  statKey:        string;
  label:          string;
  score:          number;
  saveProficient: boolean;
  profBonus:      number;
  equipStats:     CharacterStats | null;
  fmtMod:         (n: number) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const eff      = equipStats?.[statKey as keyof CharacterStats];
  const eTotal   = eff?.total ?? score;
  const eMod     = Math.floor((eTotal - 10) / 2);
  const eSaveMod = eMod + (saveProficient ? profBonus : 0);

  const cardBg       = saveProficient ? "bg-green-50 border-green-200"  : "bg-white border-slate-200";
  const primaryColor = saveProficient ? "text-green-900"                : "text-slate-800";
  const muteColor    = saveProficient ? "text-green-600"                : "text-slate-500";
  const dividerColor = saveProficient ? "border-green-100"              : "border-slate-100";

  return (
    <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
      <div className="flex items-stretch px-3 py-2.5">

        {/* LEFT — emoji + abbreviation + stacked values */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="flex flex-col items-center w-8 shrink-0">
            <span className="text-xl leading-none">{STAT_EMOJI[statKey]}</span>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{label}</span>
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest shrink-0">Combat Bonus</span>
              <span className={`text-xl font-bold leading-tight ${primaryColor}`}>{fmtMod(eSaveMod)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-slate-400 uppercase tracking-widest shrink-0">Raw Score</span>
              <span className={`text-sm font-medium ${muteColor}`}>{eTotal}</span>
            </div>
          </div>
        </div>

        {/* RIGHT HALF — tap target */}
        <button
          onClick={() => setIsExpanded((p) => !p)}
          className="flex-1 flex items-center justify-end text-slate-400 pr-1"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <span
            className="text-[10px] transition-transform duration-200 inline-block"
            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▼
          </span>
        </button>

      </div>

      {/* BREAKDOWN — smooth expand */}
      <div className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${isExpanded ? "max-h-40" : "max-h-0"}`}>
        <div className={`px-4 pb-3 pt-1.5 border-t ${dividerColor} space-y-1.5`}>

          {/* Line 1: Base Modifier */}
          {(() => { const sc = signedColor(eMod); return (
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-slate-500">Base Modifier&nbsp;
                <span className="text-slate-400 font-mono">({eTotal}−10)÷2</span>
              </span>
              <span className={`text-[11px] font-semibold font-mono ${sc.cls}`}>{sc.display}</span>
            </div>
          ); })()}

          {/* Line 2: Proficiency Bonus */}
          {(() => { const sc = signedColor(saveProficient ? profBonus : 0); return (
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-slate-500">Proficiency Bonus</span>
              <span className={`text-[11px] font-semibold font-mono ${sc.cls}`}>{sc.display}</span>
            </div>
          ); })()}

          {/* Separator + Line 3: Total */}
          {(() => { const sc = signedColor(eSaveMod); return (
            <div className={`flex items-baseline justify-between border-t ${dividerColor} pt-1.5`}>
              <span className="text-[11px] font-bold text-slate-600">Total Combat Bonus</span>
              <span className={`text-[11px] font-bold font-mono ${sc.cls}`}>{sc.display}</span>
            </div>
          ); })()}

        </div>
      </div>
    </div>
  );
}

function SkillRowCard({
  skillName, modifierValue, isProficient, descriptionText, onUse,
}: {
  skillName:       string;
  modifierValue:   string;
  isProficient:    boolean;
  descriptionText: string;
  onUse:           () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const cardBg       = isProficient ? "bg-green-50 border-green-200" : "bg-white border-slate-200";
  const nameColor    = isProficient ? "font-bold text-green-900"     : "text-slate-700";
  const modColor     = isProficient ? "text-green-700"               : "text-slate-500";
  const dividerColor = isProficient ? "border-green-100"             : "border-slate-100";

  return (
    <div className={`rounded-xl border overflow-hidden ${cardBg}`}>

      {/* Primary row */}
      <div className="flex items-center px-3 py-2">

        {/* Skill name + modifier — grows to push Use button to fixed column */}
        <span className={`flex-1 min-w-0 text-xs leading-tight ${nameColor}`}>
          {skillName}{" "}
          <span className={`font-mono text-[11px] ${modColor}`}>({modifierValue})</span>
        </span>

        {/* Use button — fixed width so all cards align */}
        <button
          onClick={(e) => { e.stopPropagation(); onUse(); }}
          className="w-10 shrink-0 text-[10px] font-bold py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 active:bg-amber-200 transition-colors"
        >
          Use
        </button>

        {/* Right half — tap target with chevron */}
        <button
          onClick={() => setIsExpanded((p) => !p)}
          className="flex-1 self-stretch flex items-center justify-end text-slate-400 pl-2 pr-1"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <span
            className="text-[10px] transition-transform duration-200 inline-block"
            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▼
          </span>
        </button>

      </div>

      {/* Description panel */}
      <div className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${isExpanded ? "max-h-40" : "max-h-0"}`}>
        <div className={`px-4 pb-3 pt-1.5 border-t ${dividerColor}`}>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {descriptionText || "No description available."}
          </p>
        </div>
      </div>

    </div>
  );
}

function MemberStatsPane({ char, mapId }: { char: CharacterData; mapId: string }) {
  const [equipStats, setEquipStats] = useState<CharacterStats | null>(null);

  useEffect(() => {
    getCharacterStats(char.id).then(setEquipStats);
  }, [char.id]);

  const sheet = getCharacterSheetData(char);

  const level    = Math.max(1, Math.min(5, char.level));
  const atCap    = level >= 5;
  const nextXp   = atCap ? null : xpForNextLevel(level);
  const prevXp   = XP_THRESHOLDS[level - 1] ?? 0;
  const xpInLvl  = char.xp - prevXp;
  const xpNeeded = nextXp !== null ? nextXp - prevXp : 1;
  const xpPct    = atCap ? 100 : Math.max(0, Math.min(100, (xpInLvl / xpNeeded) * 100));
  const xpLabel  = atCap ? "Level 5  ·  MAX" : `Level ${level}  ·  XP: ${char.xp} / ${nextXp}`;
  const fmtMod = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

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
      <div className="flex justify-end mt-2">
        <div className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />
          <span className="text-[10px] text-slate-400">Proficient</span>
        </div>
      </div>

      {/* Total AC */}
      <TotalACCard char={char} equipStats={equipStats} mapId={mapId} />

      {/* Attribute cards — single-column stack */}
      <div className="space-y-2">
        {sheet.stats.map(({ key, label, score, saveProficient }) => (
          <StatAttributeCard
            key={key}
            statKey={key}
            label={label}
            score={score}
            saveProficient={saveProficient}
            profBonus={sheet.profBonus}
            equipStats={equipStats}
            fmtMod={fmtMod}
          />
        ))}
      </div>

      {/* Actions & Skills — grouped by stat, using equipment-adjusted ability modifier */}
      <div className="space-y-2 pt-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          Actions &amp; Skills
        </p>
        {sheet.stats
          .filter(({ key }) => sheet.skills.some((s) => s.ability === key))
          .map(({ key, modifier: baseAbilityMod }) => {
            const groupSkills   = sheet.skills.filter((s) => s.ability === key);
            const eff           = equipStats?.[key];
            const effAbilityMod = eff !== undefined
              ? Math.floor((eff.total - 10) / 2)
              : baseAbilityMod;
            return (
              <div key={key} className="bg-slate-50 border border-slate-100 rounded-lg p-2 space-y-1">
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  {STAT_EMOJI[key]} {STAT_FULL_NAME[key]}
                </p>
                {groupSkills.map(({ name, proficient }) => {
                  const effSkillMod = effAbilityMod + (proficient ? sheet.profBonus : 0);
                  return (
                    <SkillRowCard
                      key={name}
                      skillName={name}
                      modifierValue={fmtMod(effSkillMod)}
                      isProficient={proficient}
                      descriptionText={SKILL_DESCRIPTION[name] ?? ""}
                      onUse={() => console.log("Triggered roll for skill: " + name)}
                    />
                  );
                })}
              </div>
            );
          })}
      </div>

    </div>
  );
}

const CATEGORY_STYLE: Record<string, string> = {
  Weapon:     "bg-red-100 text-red-700",
  Armor:      "bg-sky-100 text-sky-700",
  Consumable: "bg-emerald-100 text-emerald-700",
};

function MemberInventoryPane({
  isMe, mapId, strength,
}: {
  isMe:     boolean;
  mapId:    string;
  strength: number;
}) {
  const [items,          setItems]          = useState<EquippableItemData[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [pending,        setPending]        = useState<Set<string>>(new Set());
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  useEffect(() => {
    getMapItems(mapId).then((data) => { setItems(data); setLoading(false); });
  }, [mapId]);

  const maxCapacity = strength * 15;
  const totalWeight = items.reduce((sum, it) => sum + it.weightLbs * it.quantity, 0);
  const overCapacity = totalWeight > maxCapacity;

  function markPending(id: string, on: boolean) {
    setPending((prev) => { const s = new Set(prev); on ? s.add(id) : s.delete(id); return s; });
  }

  async function toggleEquipped(item: EquippableItemData) {
    const next = !item.isEquipped;
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isEquipped: next } : i));
    markPending(item.id, true);
    await updateItem(item.id, { isEquipped: next });
    markPending(item.id, false);
  }

  async function handleEquip(item: EquippableItemData, displaced: EquippableItemData | null) {
    setItems((prev) => prev.map((i) => {
      if (i.id === item.id)            return { ...i, isEquipped: true };
      if (displaced && i.id === displaced.id) return { ...i, isEquipped: false };
      return i;
    }));
    markPending(item.id, true);
    const ops: Promise<unknown>[] = [updateItem(item.id, { isEquipped: true })];
    if (displaced) ops.push(updateItem(displaced.id, { isEquipped: false }));
    await Promise.all(ops);
    markPending(item.id, false);
  }

  if (loading) return <p className="text-[11px] text-slate-400 py-2">Loading…</p>;
  if (items.length === 0) return <p className="text-[11px] text-slate-400 italic">No items in this area.</p>;

  // ── Slot resolution ──────────────────────────────────────────────────────────
  // Category heuristic: "Shield" in name → Off-Hand; Weapon → Main Hand;
  // non-Shield Armor → Body Armor; Consumable → Active Ring.
  const equipped = items.filter((i) => i.isEquipped);
  const slotMainHand  = equipped.find((i) => i.category === "Weapon" && !i.name.toLowerCase().includes("shield")) ?? null;
  const slotOffHand   = equipped.find((i) => i.name.toLowerCase().includes("shield") || (i.category === "Weapon" && i.id !== slotMainHand?.id)) ?? null;
  const slotBodyArmor = equipped.find((i) => i.category === "Armor"  && !i.name.toLowerCase().includes("shield")) ?? null;
  const slotRing      = equipped.find((i) => i.category === "Consumable") ?? null;

  const slottedIds = new Set([slotMainHand?.id, slotOffHand?.id, slotBodyArmor?.id, slotRing?.id].filter(Boolean) as string[]);
  const backpack   = items.filter((i) => !slottedIds.has(i.id));

  // ── Stat parser (shared by boost aggregation and diff calculation) ───────────
  function parseStats(label: string) {
    const ac     = label.match(/\+(\d+)\s*AC/i);
    const damage = label.match(/\+(\d+)\s*Damage/i);
    const hit    = label.match(/\+(\d+)\s*to\s*Hit/i);
    const hp     = label.match(/\+(\d+)\s*(?:Temp\s*)?HP/i);
    return {
      ac:     ac     ? parseInt(ac[1],     10) : 0,
      damage: damage ? parseInt(damage[1], 10) : 0,
      hit:    hit    ? parseInt(hit[1],    10) : 0,
      hp:     hp     ? parseInt(hp[1],     10) : 0,
    };
  }

  function targetSlotItem(item: EquippableItemData): EquippableItemData | null {
    const isShield = item.name.toLowerCase().includes("shield");
    if (item.category === "Weapon"     && !isShield) return slotMainHand;
    if (item.category === "Weapon"     &&  isShield) return slotOffHand;
    if (item.category === "Armor"      && !isShield) return slotBodyArmor;
    if (item.category === "Armor"      &&  isShield) return slotOffHand;
    if (item.category === "Consumable")              return slotRing;
    return null;
  }

  // ── Stat boost aggregation ────────────────────────────────────────────────────
  // Parse combatImpactLabel of each equipped item for numeric modifiers.
  // Patterns matched: "+N Damage", "+N to Hit", "+N AC", "+N Temp HP"
  const statBoosts = equipped.reduce(
    (acc, item) => {
      const text = item.combatImpactLabel;
      const acMatch     = text.match(/\+(\d+)\s*AC/i);
      const damageMatch = text.match(/\+(\d+)\s*Damage/i);
      const hitMatch    = text.match(/\+(\d+)\s*to\s*Hit/i);
      const hpMatch     = text.match(/\+(\d+)\s*(?:Temp\s*)?HP/i);
      if (acMatch)     acc.ac     += parseInt(acMatch[1],     10);
      if (damageMatch) acc.damage += parseInt(damageMatch[1], 10);
      if (hitMatch)    acc.hit    += parseInt(hitMatch[1],    10);
      if (hpMatch)     acc.hp     += parseInt(hpMatch[1],     10);
      return acc;
    },
    { ac: 0, damage: 0, hit: 0, hp: 0 },
  );
  const hasBoosts = equipped.length > 0;

  const SLOTS = [
    { key: "main",  label: "Main Hand",   placeholder: "Empty weapon slot",  item: slotMainHand  },
    { key: "off",   label: "Off-Hand",    placeholder: "Empty shield slot",   item: slotOffHand   },
    { key: "body",  label: "Body Armor",  placeholder: "Empty armor slot",    item: slotBodyArmor },
    { key: "ring",  label: "Active Ring", placeholder: "Empty consumable slot", item: slotRing    },
  ];

  return (
    <div className="space-y-2">

      {/* ── Stat boost banner ── */}
      {hasBoosts && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 py-1.5 bg-white rounded-lg">
          {statBoosts.ac > 0 && (
            <span className="text-[10px] font-bold text-sky-600 leading-none">
              <span className="text-slate-400 font-normal">Defense </span>+{statBoosts.ac} AC
            </span>
          )}
          {statBoosts.damage > 0 && (
            <span className="text-[10px] font-bold text-red-600 leading-none">
              <span className="text-slate-400 font-normal">Damage </span>+{statBoosts.damage}
            </span>
          )}
          {statBoosts.hit > 0 && (
            <span className="text-[10px] font-bold text-amber-600 leading-none">
              <span className="text-slate-400 font-normal">To Hit </span>+{statBoosts.hit}
            </span>
          )}
          {statBoosts.hp > 0 && (
            <span className="text-[10px] font-bold text-emerald-600 leading-none">
              <span className="text-slate-400 font-normal">Temp HP </span>+{statBoosts.hp}
            </span>
          )}
        </div>
      )}

      {/* ── Equipment slots grid ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">Equipped</p>
        <div className="grid grid-cols-2 gap-1.5">
          {SLOTS.map(({ key, label, placeholder, item }) => (
            <div
              key={key}
              className={`rounded-lg px-2 py-1.5 flex flex-col gap-0.5 min-h-[48px] justify-between ${
                item
                  ? "bg-amber-50 border border-amber-200"
                  : "border border-dashed border-slate-200 bg-slate-50"
              }`}
            >
              <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 leading-none">
                {label}
              </span>
              {item ? (
                <div className="flex items-end justify-between gap-1">
                  <p className="text-[11px] font-semibold text-slate-800 leading-tight truncate flex-1">
                    {item.name}
                  </p>
                  {isMe && (
                    <button
                      onClick={() => toggleEquipped(item)}
                      disabled={pending.has(item.id)}
                      className="shrink-0 text-[9px] font-bold text-amber-600 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed leading-none"
                    >
                      Unequip
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-slate-300 italic leading-tight">{placeholder}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Backpack rows (equipped items filtered out) ── */}
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Backpack</p>
        {backpack.length === 0 ? (
          <p className="text-[10px] text-slate-300 italic py-0.5">All items are equipped.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {backpack.map((item) => {
              const isBusy   = pending.has(item.id);
              const dimmed   = item.quantity === 0 ? "opacity-40" : "";
              const isOpen   = expandedItemId === item.id;

              // "equippable" → Weapon/Armor with a target slot
              // "consumable" → Consumable
              // "held"       → anything else (carried but not slotted)
              const kind: "equippable" | "consumable" | "held" =
                item.category === "Consumable" ? "consumable"
                : (item.category === "Weapon" || item.category === "Armor") ? "equippable"
                : "held";

              const slotItem = kind === "equippable" ? targetSlotItem(item) : null;

              // Stat diff — only meaningful for equippables
              const myStats   = parseStats(item.combatImpactLabel);
              const slotStats = slotItem ? parseStats(slotItem.combatImpactLabel) : { ac: 0, damage: 0, hit: 0, hp: 0 };
              const diff = {
                ac:     myStats.ac     - slotStats.ac,
                damage: myStats.damage - slotStats.damage,
                hit:    myStats.hit    - slotStats.hit,
                hp:     myStats.hp     - slotStats.hp,
              };
              const diffEntries = (Object.entries(diff) as [string, number][]).filter(([, v]) => v !== 0);

              // Show quantity when there's more than one, or always for consumables
              const showQty = kind === "consumable" || item.quantity > 1;

              return (
                <div key={item.id} className={dimmed}>
                  {/* ── Collapsed row (always visible) ── */}
                  <div
                    className="flex items-center gap-1.5 py-1 cursor-pointer select-none"
                    onClick={() => setExpandedItemId(isOpen ? null : item.id)}
                  >
                    <span className={`shrink-0 w-4 text-center text-[9px] font-black rounded py-px uppercase ${CATEGORY_STYLE[item.category] ?? "bg-slate-100 text-slate-500"}`}>
                      {item.category[0]}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-slate-800 leading-tight truncate">{item.name}</p>
                      <p className="text-[10px] font-medium text-emerald-700 leading-none">{item.combatImpactLabel}</p>
                    </div>

                    <span className="shrink-0 text-[10px] font-mono text-slate-400 tabular-nums">
                      {item.weightLbs % 1 === 0 ? item.weightLbs : item.weightLbs.toFixed(1)}lb
                    </span>

                    {showQty && (
                      <span className="shrink-0 text-[10px] font-mono font-bold text-slate-500 tabular-nums">
                        ×{item.quantity}
                      </span>
                    )}

                    {kind === "equippable" && (
                      <div onClick={(e) => e.stopPropagation()}>
                        {isMe ? (
                          <button
                            onClick={() => handleEquip(item, slotItem)}
                            disabled={isBusy}
                            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors disabled:cursor-not-allowed"
                          >
                            Equip
                          </button>
                        ) : null}
                      </div>
                    )}

                    <span className="shrink-0 text-[9px] text-slate-300">{isOpen ? "▲" : "▼"}</span>
                  </div>

                  {/* ── Expanded panel ── */}
                  {isOpen && (
                    <div className="mb-1.5 px-2 py-1.5 bg-slate-50 rounded-md space-y-1.5">
                      {/* Description */}
                      <p className="text-[10px] text-slate-600 italic">{item.description || item.combatImpactLabel}</p>

                      {/* Stat diff — equippables only */}
                      {kind === "equippable" && (
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
                            vs {slotItem ? slotItem.name : "empty slot"}
                          </p>
                          {diffEntries.length === 0 ? (
                            <p className="text-[10px] text-slate-400 italic">No numeric difference</p>
                          ) : (
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                              {diffEntries.map(([stat, val]) => (
                                <span
                                  key={stat}
                                  className={`text-[10px] font-bold ${val > 0 ? "text-emerald-600" : "text-red-500"}`}
                                >
                                  {val > 0 ? "+" : ""}{val} {stat.toUpperCase()}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Equip hint — equippables only */}
                      {kind === "equippable" && isMe && (
                        <p className="text-[9px] text-slate-400 italic">
                          Type &ldquo;/equip {item.name}&rdquo; to swap.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Weight summary ── */}
      <div className="pt-1 border-t border-slate-100 space-y-0.5">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] text-slate-500">Total weight</span>
          <span className={`text-[10px] font-mono font-semibold tabular-nums ${overCapacity ? "text-red-600" : "text-slate-600"}`}>
            {totalWeight.toFixed(1)} / {maxCapacity} lb
          </span>
        </div>
        <div className="h-1 w-full bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${overCapacity ? "bg-red-500" : "bg-slate-400"}`}
            style={{ width: `${Math.min(100, (totalWeight / maxCapacity) * 100)}%` }}
          />
        </div>
        {overCapacity && (
          <p className="text-[9px] text-red-500 font-medium">Over capacity — movement is reduced.</p>
        )}
      </div>

    </div>
  );
}

function MemberAbilitiesPane({ char }: { char: CharacterData }) {
  const prof = proficiencyBonus(char.level);
  const [features, setFeatures] = useState<ClassFeatureData[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    getClassFeatures(char.characterClass, char.level).then((data) => {
      setFeatures(data);
      setLoading(false);
    });
  }, [char.id, char.level]);

  if (loading) return <p className="text-[11px] text-slate-400 py-2">Loading…</p>;

  // Group features by level
  const byLevel = features.reduce<Map<number, ClassFeatureData[]>>((acc, f) => {
    const group = acc.get(f.level) ?? [];
    group.push(f);
    acc.set(f.level, group);
    return acc;
  }, new Map());

  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">Proficiency Bonus</span>
        <span className="font-bold text-slate-900">+{prof}</span>
      </div>
      {levels.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No features recorded.</p>
      ) : (
        <div className="space-y-3">
          {levels.map((lvl) => (
            <div key={lvl}>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
                Level {lvl}
              </p>
              <ul className="space-y-1">
                {(byLevel.get(lvl) ?? []).map((f) => (
                  <li key={f.id} className="text-xs text-slate-700">
                    <span className="font-medium">· {f.name}</span>
                    {f.level === char.level && (
                      <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded ml-1">New</span>
                    )}
                    {f.description && (
                      <span className="text-slate-500"> — {f.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
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
