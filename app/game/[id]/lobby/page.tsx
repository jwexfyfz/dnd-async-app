"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "../../../../lib/supabase-client";
import { getGame } from "../../../actions/get-game";
import { getCharacters } from "../../../actions/get-characters";
import { joinGame } from "../../../actions/join-game";
import { setReady } from "../../../actions/set-ready";
import { startAdventure } from "../../../actions/start-adventure";
import { leaveGame } from "../../../actions/leave-game";
import { kickPlayer } from "../../../actions/kick-player";
import { classEmoji } from "../../../../lib/class-emoji";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartyMember {
  id:          string;
  characterId: string;
  userId:      string;
  status:      string;
  character: {
    id:             string;
    name:           string;
    characterClass: string;
    strength:       number;
    dexterity:      number;
    constitution:   number;
    intelligence:   number;
    wisdom:         number;
    charisma:       number;
  };
  user: { id: string; displayName: string | null; email: string };
}

interface GameData {
  id:          string;
  characterId: string;
  phase:       string;
  storyPrompt: { title: string; description: string; difficulty: string };
  partyMembers: PartyMember[];
}

interface OwnCharacter {
  id:             string;
  name:           string;
  characterClass: string;
  games:           { id: string }[];
  partyMemberships: { game: { id: string } }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(m: PartyMember) {
  return m.user.displayName || m.user.email.split("@")[0];
}

function statMod(score: number) {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

const STATS = [
  { key: "strength",     label: "STR" },
  { key: "dexterity",    label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom",       label: "WIS" },
  { key: "charisma",     label: "CHA" },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const gameId = params.id as string;

  const [authUser,      setAuthUser]      = useState<any>(null);
  const [authLoading,   setAuthLoading]   = useState(true);
  const [gameData,      setGameData]      = useState<GameData | null>(null);
  const [ownChars,      setOwnChars]      = useState<OwnCharacter[]>([]);
  const [loadError,     setLoadError]     = useState("");
  const [loading,       setLoading]       = useState(true);
  const [selectedChar,  setSelectedChar]  = useState("");
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [joinError,     setJoinError]     = useState("");
  const [isJoining,     setIsJoining]     = useState(false);
  const [isStarting,    setIsStarting]    = useState(false);
  const [isToggling,    setIsToggling]    = useState(false);
  const [isLeaving,     setIsLeaving]     = useState(false);
  const [kickingId,     setKickingId]     = useState<string | null>(null);
  const [copied,        setCopied]        = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auth ──
  useEffect(() => {
    supabaseBrowser.auth.getUser().then(({ data: { user } }) => {
      setAuthUser(user);
      setAuthLoading(false);
    });
  }, []);

  // ── Fetch ──
  async function fetchGame() {
    const res = await getGame(gameId);
    if (!res.success) { setLoadError(res.error ?? "Game not found."); return null; }
    const data = res.data as unknown as GameData;
    setGameData(data);
    if (data.phase === "ACTIVE") router.replace(`/game/${gameId}`);
    return data;
  }

  useEffect(() => {
    Promise.all([
      fetchGame().finally(() => setLoading(false)),
      getCharacters().then((res) => {
        if (res.success && res.data) setOwnChars(res.data as OwnCharacter[]);
      }),
    ]);
    pollRef.current = setInterval(fetchGame, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // ── Derived ──
  const myMember    = gameData?.partyMembers.find((m) => m.userId === authUser?.id);
  const isHost      = myMember?.characterId === gameData?.characterId;
  const isInParty   = !!myMember;
  // A character is joinable if it has no active hosted game, no active party
  // membership in another game, and isn't already in this lobby.
  const joinable = ownChars.filter((c) =>
    c.games.length === 0 &&
    c.partyMemberships.length === 0 &&
    !gameData?.partyMembers.some((m) => m.characterId === c.id)
  );

  // ── Handlers ──
  function handleSignIn() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("auth-return-to", window.location.href);
    }
    const domain   = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const endpoint = "/auth/v1/authorize?provider=google&redirect_to=";
    const origin   = typeof window !== "undefined" ? window.location.origin : "";
    window.location.replace(`${domain}${endpoint}${encodeURIComponent(origin)}`);
  }

  async function handleJoin() {
    if (!selectedChar) return;
    setIsJoining(true); setJoinError("");
    const res = await joinGame(gameId, selectedChar);
    if (res.success) { await fetchGame(); }
    else { setJoinError(res.error ?? "Failed to join."); }
    setIsJoining(false);
  }

  async function handleToggleReady() {
    if (!myMember) return;
    setIsToggling(true);
    await setReady(gameId, myMember.status !== "READY");
    await fetchGame();
    setIsToggling(false);
  }

  async function handleStart() {
    setIsStarting(true);
    const res = await startAdventure(gameId);
    if (res.success) router.push(`/game/${gameId}`);
    else setIsStarting(false);
  }

  async function handleLeave() {
    setIsLeaving(true);
    const res = await leaveGame(gameId);
    if (res.success) router.push("/");
    else setIsLeaving(false);
  }

  async function handleKick(memberId: string) {
    setKickingId(memberId);
    await kickPlayer(gameId, memberId);
    await fetchGame();
    setKickingId(null);
  }

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Loading / error screens ──
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500 animate-pulse">Opening the lobby...</p>
      </div>
    );
  }

  if (loadError || !gameData) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{loadError || "Game not found."}</p>
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">← Roster</Link>
      </div>
    );
  }

  // ── Not signed in ──
  if (!authUser) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Join the Adventure</h1>
            <p className="text-sm text-slate-500 mt-1">
              Sign in to join <strong>{gameData.storyPrompt.title}</strong>.
            </p>
          </div>
          <div className="text-4xl">{gameData.partyMembers.map(m => classEmoji(m.character.characterClass)).join(" ")}</div>
          <button
            onClick={handleSignIn}
            className="w-full h-11 flex items-center justify-center gap-2 border border-slate-300 rounded-lg bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.96 1 12 1 7.35 1 3.4 3.65 1.51 7.5l3.86 3C6.28 7.55 8.91 5.04 12 5.04z"/>
              <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.43h6.44c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.98 3.39-4.89 3.39-8.48z"/>
              <path fill="#FBBC05" d="M5.37 14.77c-.24-.72-.37-1.49-.37-2.27s.13-1.55.37-2.27l-3.86-3C.68 8.78 0 10.31 0 12s.68 3.22 1.51 4.77l3.86-3z"/>
              <path fill="#34A853" d="M12 23c3.24 0 5.97-1.08 7.96-2.91l-3.66-2.84c-1.01.68-2.31 1.09-4.3 1.09-3.09 0-5.72-2.51-6.65-5.46L1.49 15.8C3.38 19.65 7.33 23 12 23z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </main>
    );
  }

  // ── Signed in but no characters ──
  if (!isInParty && ownChars.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Create a Character First</h1>
            <p className="text-sm text-slate-500 mt-1">
              You need a hero before you can join <strong>{gameData.storyPrompt.title}</strong>.
            </p>
          </div>
          <Link
            href={`/create-character?redirect=/game/${gameId}/lobby`}
            className="block w-full h-11 leading-[2.75rem] text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-700 transition-colors"
          >
            Forge a Character
          </Link>
        </div>
      </main>
    );
  }

  const diffStyle: Record<string, string> = {
    Beginner: "bg-green-100 text-green-700 border-green-200",
    Standard: "bg-amber-100 text-amber-700 border-amber-200",
    Veteran:  "bg-red-100   text-red-700   border-red-200",
  };

  // ── Main lobby ──
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">

        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
          ← Roster
        </Link>

        {/* Scenario card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h1 className="text-lg font-bold text-slate-900">{gameData.storyPrompt.title}</h1>
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 border rounded-full ${diffStyle[gameData.storyPrompt.difficulty] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {gameData.storyPrompt.difficulty}
            </span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">{gameData.storyPrompt.description}</p>
        </div>

        {/* Invite link — only shown to members/host */}
        {isInParty && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-500">
              Invite Link
              <span className="ml-2 font-normal text-slate-400">— share this URL so friends can join your party</span>
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={typeof window !== "undefined" ? window.location.href : ""}
                className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 truncate"
              />
              <button
                onClick={handleCopy}
                className="shrink-0 text-xs font-medium px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {/* Party list */}
        <div>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            Party ({gameData.partyMembers.length}/4)
          </h2>
          <div className="space-y-2">
            {gameData.partyMembers.map((m) => {
              const isExpanded = expandedId === m.id;
              const isHostMember = m.characterId === gameData.characterId;
              return (
                <div key={m.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Summary row — always visible, click to expand */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-2xl">{classEmoji(m.character.characterClass)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{m.character.name}</p>
                      <p className="text-xs text-slate-400 truncate">{displayName(m)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isHostMember && (
                        <span className="text-xs font-medium text-slate-400 border border-slate-200 rounded-full px-2 py-0.5">
                          Host
                        </span>
                      )}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        m.status === "READY" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {m.status === "READY" ? "Ready" : "Joined"}
                      </span>
                      <span className="text-slate-300 text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded: full character stats */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                      <p className="text-xs text-slate-500">
                        {m.character.characterClass} · DEX {m.character.dexterity}
                      </p>
                      <div className="grid grid-cols-6 gap-1 text-center">
                        {STATS.map(({ key, label }) => (
                          <div key={key}>
                            <div className="text-[9px] text-slate-400 font-medium">{label}</div>
                            <div className="text-sm font-bold text-slate-800">{m.character[key]}</div>
                            <div className="text-[9px] text-slate-400">{statMod(m.character[key])}</div>
                          </div>
                        ))}
                      </div>
                      {/* Kick button (host only, on non-host members) */}
                      {isHost && !isHostMember && (
                        <button
                          onClick={() => handleKick(m.id)}
                          disabled={kickingId === m.id}
                          className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                        >
                          {kickingId === m.id ? "Removing..." : "Remove from party"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Join section — authenticated user not yet in the party */}
        {!isInParty && joinable.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Choose your character to join</h2>
            <div className="grid grid-cols-1 gap-2">
              {joinable.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedChar(c.id)}
                  className={`flex items-center gap-3 px-4 py-3 border rounded-xl text-left transition-colors ${
                    selectedChar === c.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 hover:border-slate-400"
                  }`}
                >
                  <span className="text-xl">{classEmoji(c.characterClass)}</span>
                  <div>
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className={`text-xs ${selectedChar === c.id ? "text-slate-300" : "text-slate-500"}`}>
                      {c.characterClass}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {joinError && <p className="text-xs text-red-500">{joinError}</p>}
            <button
              onClick={handleJoin}
              disabled={!selectedChar || isJoining}
              className="w-full h-10 text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {isJoining ? "Joining..." : "Join Adventure"}
            </button>
          </div>
        )}

        {/* No joinable characters */}
        {!isInParty && joinable.length === 0 && ownChars.length > 0 && (
          <p className="text-sm text-slate-400 text-center italic">
            All your characters are already in games.{" "}
            <Link href={`/create-character?redirect=/game/${gameId}/lobby`} className="underline hover:text-slate-600">
              Create a new one
            </Link>
            .
          </p>
        )}

        {/* Ready toggle — non-host members */}
        {isInParty && !isHost && (
          <button
            onClick={handleToggleReady}
            disabled={isToggling}
            className={`w-full h-11 text-sm font-semibold rounded-xl border transition-colors ${
              myMember?.status === "READY"
                ? "bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
                : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {myMember?.status === "READY" ? "✓ Ready — click to unready" : "Mark as Ready"}
          </button>
        )}

        {/* Start button — host */}
        {isHost && (
          <button
            onClick={handleStart}
            disabled={isStarting || gameData.partyMembers.length === 0}
            className="w-full h-11 text-sm font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {isStarting
              ? "Starting..."
              : `Start Adventure (${gameData.partyMembers.length} player${gameData.partyMembers.length !== 1 ? "s" : ""})`}
          </button>
        )}

        {/* Leave button — non-host members */}
        {isInParty && !isHost && (
          <button
            onClick={handleLeave}
            disabled={isLeaving}
            className="w-full h-10 text-sm text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
          >
            {isLeaving ? "Leaving..." : "Leave this game"}
          </button>
        )}
      </div>
    </main>
  );
}
