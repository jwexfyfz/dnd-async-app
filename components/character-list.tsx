"use client";

import { useState } from "react";
import Link from "next/link";
import { classEmoji } from "../lib/class-emoji";
import { deleteCharacter } from "../app/actions/delete-character";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartyMemberSlot {
  characterId: string;
  turnOrder:   number;
  character:   { id: string; name: string; characterClass: string };
}

interface ActiveGame {
  id:                     string;
  updatedAt:              string;
  phase:                  string;
  currentTurnCharacterId: string | null;
  storyPrompt:            { title: string };
  partyMembers:           PartyMemberSlot[];
}

interface Character {
  id:             string;
  name:           string;
  characterClass: string;
  baseStrength:     number;
  baseDexterity:    number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom:       number;
  baseCharisma:     number;
  // Hosted games (character is the game creator).
  games:          ActiveGame[];
  // Non-host party memberships.
  partyMemberships: Array<{ game: ActiveGame }>;
}

interface Props {
  characters: Character[];
  loading:    boolean;
  onDeleted?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CharacterList({ characters, loading, onDeleted }: Props) {
  const [deleteTarget,   setDeleteTarget]   = useState<Character | null>(null);
  const [confirmText,    setConfirmText]    = useState("");
  const [isDeleting,     setIsDeleting]     = useState(false);
  const [deleteError,    setDeleteError]    = useState("");

  if (loading) {
    return <p className="text-sm text-slate-500 animate-pulse">Summoning your roster...</p>;
  }

  // Merge hosted + party-member games; prefer the hosted game if both exist.
  function activeGame(hero: Character): ActiveGame | null {
    return hero.games[0] ?? hero.partyMemberships[0]?.game ?? null;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError("");
    const res = await deleteCharacter(deleteTarget.id);
    if (res.success) {
      setDeleteTarget(null);
      setConfirmText("");
      onDeleted?.();
    } else {
      setDeleteError(res.error ?? "Failed to delete.");
    }
    setIsDeleting(false);
  }

  const targetGame = deleteTarget ? activeGame(deleteTarget) : null;
  const isInGame   = !!targetGame;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {characters.map((hero) => {
          const game         = activeGame(hero);
          const activeGameId = game?.id ?? null;
          return (
            <CharacterCard
              key={hero.id}
              hero={hero}
              game={game}
              activeGameId={activeGameId}
              onDeleteClick={() => { setDeleteTarget(hero); setConfirmText(""); setDeleteError(""); }}
            />
          );
        })}

        {/* New Character card — always last */}
        <Link
          href="/create-character"
          className="flex flex-col items-center justify-center gap-2 min-h-[180px] rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
        >
          <span className="text-3xl font-light leading-none">+</span>
          <span className="text-sm font-medium">New Character</span>
        </Link>
      </div>

      {/* ── Delete confirmation dialog ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 space-y-4">
            {isInGame ? (
              /* Strong warning for in-game characters */
              <>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-slate-900">
                    {deleteTarget.name} is mid-adventure!
                  </h2>
                  <p className="text-sm text-slate-600">
                    This character is currently in{" "}
                    <strong>{targetGame!.storyPrompt.title}</strong>. Deleting
                    them will permanently remove them from the party and
                    irreversibly change the story for everyone else.
                  </p>
                </div>
                <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Type <strong>{deleteTarget.name}</strong> to confirm you want to leave.
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={deleteTarget.name}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
                <div className="flex flex-col gap-2 pt-1">
                  {/* Primary CTA: keep the character */}
                  <button
                    onClick={() => { setDeleteTarget(null); setConfirmText(""); }}
                    className="w-full h-11 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Keep me in the game
                  </button>
                  {/* Destructive: white / secondary-looking */}
                  <button
                    onClick={confirmDelete}
                    disabled={confirmText !== deleteTarget.name || isDeleting}
                    className="w-full h-11 text-sm font-medium rounded-xl border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors"
                  >
                    {isDeleting ? "Deleting…" : "I insist on leaving"}
                  </button>
                </div>
              </>
            ) : (
              /* Simple confirm for characters not in a game */
              <>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-slate-900">Delete {deleteTarget.name}?</h2>
                  <p className="text-sm text-slate-500">
                    This action cannot be undone.
                  </p>
                </div>
                {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="flex-1 h-10 text-sm font-medium rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    disabled={isDeleting}
                    className="flex-1 h-10 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {isDeleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Character card ───────────────────────────────────────────────────────────

function CharacterCard({
  hero, game, activeGameId, onDeleteClick,
}: {
  hero:          Character;
  game:          ActiveGame | null;
  activeGameId:  string | null;
  onDeleteClick: () => void;
}) {
  // Lobby games link back to the lobby; active games go to the game screen.
  const gameUrl = activeGameId
    ? (game?.phase === "LOBBY" ? `/game/${activeGameId}/lobby` : `/game/${activeGameId}`)
    : null;

  const currentTurnMember = game?.partyMembers.find(
    (m) => m.characterId === game.currentTurnCharacterId
  ) ?? null;
  const isMyTurn = game?.currentTurnCharacterId === hero.id;

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm p-4 gap-4 hover:border-slate-300 transition-colors">

      {/* Identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{classEmoji(hero.characterClass)}</span>
          <div>
            <h2 className="font-semibold text-slate-900 text-sm">{hero.name}</h2>
            <span className="inline-block text-xs font-semibold px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-full mt-0.5 text-slate-600">
              {hero.characterClass}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isMyTurn && (
            <span className="text-xs font-semibold px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-amber-700 animate-pulse">
              Your turn!
            </span>
          )}
          {/* Delete button */}
          <button
            onClick={onDeleteClick}
            className="p-1 text-slate-300 hover:text-red-400 transition-colors"
            aria-label={`Delete ${hero.name}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Campaign info — shown when there's an active or lobby game */}
      {game && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Campaign</p>
            <p className="text-xs font-medium text-slate-700 truncate">{game.storyPrompt.title}</p>
          </div>

          {game.phase === "LOBBY" ? (
            <p className="text-xs text-slate-400 italic">In lobby — waiting to start</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Turn</p>
              <p className="text-xs text-slate-600">
                {isMyTurn
                  ? <span className="text-amber-600 font-semibold">Your turn!</span>
                  : currentTurnMember
                    ? <span>{currentTurnMember.character.name}&apos;s turn</span>
                    : <span className="text-slate-400">—</span>
                }
              </p>

              {/* Party member row with turn-status dots */}
              {game.partyMembers.length > 1 && (
                <div className="flex gap-2 items-center flex-wrap">
                  {game.partyMembers.map((m) => {
                    const isCurrent = m.characterId === game.currentTurnCharacterId;
                    return (
                      <div key={m.characterId} className="flex flex-col items-center gap-0.5" title={m.character.name}>
                        <span className="text-base leading-none">{classEmoji(m.character.characterClass)}</span>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          isCurrent ? "bg-amber-400" : "bg-slate-300"
                        }`} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ability scores */}
      <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
        {([
          { field: "baseStrength",     label: "STR" },
          { field: "baseDexterity",    label: "DEX" },
          { field: "baseConstitution", label: "CON" },
          { field: "baseIntelligence", label: "INT" },
          { field: "baseWisdom",       label: "WIS" },
          { field: "baseCharisma",     label: "CHA" },
        ] as const).map(({ field, label }) => (
          <div key={field} className="bg-slate-50 border border-slate-100 rounded-md py-1.5">
            <div className="text-slate-400 font-medium uppercase text-[10px]">{label}</div>
            <div className="font-bold text-slate-800 text-sm">{hero[field]}</div>
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="mt-auto">
        {gameUrl ? (
          <Link
            href={gameUrl}
            className="block w-full text-center text-sm font-semibold py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700 transition-colors"
          >
            {game?.phase === "LOBBY" ? "Back to Lobby" : "Continue Adventure"}
          </Link>
        ) : (
          <Link
            href={`/play?characterId=${hero.id}`}
            className="block w-full text-center text-sm font-semibold py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Begin Adventure
          </Link>
        )}
      </div>
    </div>
  );
}
