'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { classEmoji } from '@/lib/class-emoji';

type LobbyMember = {
  characterId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  characterName: string;
  characterClass: string;
  status: 'joined' | 'ready';
};

type LobbyState =
  | { gameState: 'lobby'; members: LobbyMember[]; hostCharacterId: string; dungeonName: string; shareUrl: string }
  | { gameState: 'active'; redirectTo: string; myCharacterId: string | null; roomInstanceId: string }
  | { gameState: 'completed' }
  | null;

type Character = { id: string; name: string; characterClass: string; isDead?: boolean };

function AvatarBadge({ member, size = 56 }: { member: LobbyMember; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (member.avatarUrl && !imgFailed) {
    return (
      <img
        src={member.avatarUrl}
        alt={member.characterName}
        width={size}
        height={size}
        className="rounded-full object-cover"
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-slate-100 flex items-center justify-center text-2xl"
      style={{ width: size, height: size }}
    >
      {classEmoji(member.characterClass)}
    </div>
  );
}

function LobbyContent() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();

  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ),
  );
  const [user, setUser] = useState<User | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string>('');
  const [lobby, setLobby] = useState<LobbyState>(null);
  const [lobbyVersion, setLobbyVersion] = useState(0);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // Fetch my characters when logged in
  useEffect(() => {
    if (!user) return;
    fetch('/api/v2/me/characters')
      .then(r => r.json())
      .then(d => setCharacters((d.characters ?? []).filter((c: Character) => !c.isDead)));
  }, [user]);

  // Poll lobby state
  const pollLobby = async () => {
    try {
      const res = await fetch(`/api/v2/lobby/${sessionId}`);
      if (res.status === 404) { setLobby(null); setError('Session no longer exists'); return; }
      const data = await res.json();
      if (data.gameState === 'active') {
        setLobby(data);
        const charParam = data.myCharacterId ? `&char=${data.myCharacterId}` : '';
        router.replace(`/v2/play?session=${sessionId}${charParam}`);
        return;
      }
      setLobby(data);
      if (data.lobbyVersion !== undefined) setLobbyVersion(data.lobbyVersion ?? 0);
    } catch {
      // silently ignore network errors
    }
  };

  useEffect(() => {
    pollLobby();
    pollRef.current = setInterval(pollLobby, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId, user?.id]);

  const myMember = lobby?.gameState === 'lobby'
    ? lobby.members.find(m => m.userId === user?.id)
    : undefined;
  const isHost = lobby?.gameState === 'lobby' && myMember?.characterId === lobby.hostCharacterId;
  const allReady = lobby?.gameState === 'lobby' && lobby.members.every(m => m.status === 'ready');

  const handleJoin = async () => {
    if (!selectedCharId || !user) return;
    setError('');
    setJoining(true);
    try {
      const res = await fetch(`/api/v2/lobby/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: selectedCharId, lobbyVersion }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to join'); return; }
      setLobby(prev => prev?.gameState === 'lobby' ? { ...prev, members: data.members } : prev);
    } finally {
      setJoining(false);
    }
  };

  const handleReady = async () => {
    if (!myMember) return;
    await fetch(`/api/v2/lobby/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: myMember.characterId }),
    });
    await pollLobby();
  };

  const handleLeave = async () => {
    if (!myMember) return;
    const res = await fetch(`/api/v2/lobby/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: myMember.characterId }),
    });
    const data = await res.json();
    if (data.deleted) { router.push('/v2/setup'); return; }
    await pollLobby();
    router.push('/v2/setup');
  };

  const handleStart = async () => {
    if (!isHost || !myMember || starting) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/v2/lobby/${sessionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: myMember.characterId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to start'); setStarting(false); return; }
      router.replace(`/v2/play?session=${sessionId}&char=${myMember.characterId}`);
    } catch {
      setError('Failed to start adventure');
      setStarting(false);
    }
  };

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {
      // Clipboard unavailable — show the URL
      const inp = document.querySelector<HTMLInputElement>('[data-lobby-url]');
      if (inp) { inp.select(); inp.focus(); }
    }
  };

  const handleKick = async (targetCharacterId: string) => {
    if (!isHost || !myMember) return;
    await fetch(`/api/v2/lobby/${sessionId}/kick`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: targetCharacterId }),
    });
    await pollLobby();
  };

  // Loading
  if (lobby === null && !error) {
    return <div className="flex items-center justify-center h-screen text-slate-400">Loading lobby…</div>;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-3">
          <p className="text-red-600 font-medium">{error}</p>
          <button onClick={() => router.push('/v2/setup')} className="text-sm text-indigo-600 underline">Back to setup</button>
        </div>
      </div>
    );
  }

  if (lobby?.gameState !== 'lobby') {
    return <div className="flex items-center justify-center h-screen text-slate-400">Redirecting…</div>;
  }

  const members = lobby.members;
  const emptySlots = Math.max(0, 4 - members.length);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">{lobby.dungeonName}</h1>
          <p className="text-sm text-slate-500">Waiting for adventurers…</p>
        </div>

        {/* Party roster */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Party ({members.length}/4)</p>
          <div className="flex gap-3 flex-wrap">
            {members.map(m => (
              <div key={m.characterId} className="flex flex-col items-center gap-1 relative">
                <div className="relative">
                  <AvatarBadge member={m} size={56} />
                  {m.characterId === lobby.hostCharacterId && (
                    <span className="absolute -top-1 -right-1 text-xs">👑</span>
                  )}
                </div>
                <span className="text-xs font-semibold text-slate-800 max-w-[60px] text-center truncate">{m.characterName}</span>
                <span className="text-xs text-slate-400">{classEmoji(m.characterClass)}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  m.status === 'ready' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {m.status === 'ready' ? 'Ready' : 'Waiting'}
                </span>
                {isHost && m.characterId !== myMember?.characterId && (
                  <button
                    onClick={() => handleKick(m.characterId)}
                    className="text-[10px] text-red-400 hover:text-red-600 mt-0.5"
                  >
                    Kick
                  </button>
                )}
              </div>
            ))}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div key={`empty-${i}`} className="flex flex-col items-center gap-1">
                <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 text-xl">
                  +
                </div>
                <span className="text-xs text-slate-300">Open</span>
              </div>
            ))}
          </div>
        </div>

        {/* Invite link */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Invite link</p>
          <div className="flex gap-2">
            <input
              data-lobby-url
              readOnly
              value={window.location.href}
              className="flex-1 text-xs text-slate-600 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
            >
              {copyDone ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}

        {/* Actions */}
        {!myMember ? (
          /* Not joined yet */
          !user ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-slate-600">Sign in to join this adventure</p>
              <button
                onClick={() => {
                  sessionStorage.setItem('auth-return-to', window.location.href);
                  router.push('/v2/setup');
                }}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
              >
                Sign in
              </button>
            </div>
          ) : characters.length === 0 ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-slate-600">You need a hero first</p>
              <button
                onClick={() => router.push(`/v2/setup?returnTo=/v2/lobby/${sessionId}`)}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
              >
                Create a character
              </button>
            </div>
          ) : members.length >= 4 ? (
            <p className="text-center text-sm text-slate-500 font-medium">Party is full</p>
          ) : (
            <div className="space-y-3 bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Choose your character</p>
              <div className="space-y-2">
                {characters.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCharId(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selectedCharId === c.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {classEmoji(c.characterClass)} {c.name} · {c.characterClass}
                  </button>
                ))}
              </div>
              <button
                onClick={handleJoin}
                disabled={!selectedCharId || joining}
                className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 hover:bg-indigo-700 transition-colors"
              >
                {joining ? 'Joining…' : 'Join Adventure'}
              </button>
            </div>
          )
        ) : (
          /* Already joined */
          <div className="flex flex-col gap-3">
            {!isHost && (
              <button
                onClick={handleReady}
                className={`py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  myMember.status === 'ready'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {myMember.status === 'ready' ? '✓ Ready!' : 'Mark as Ready'}
              </button>
            )}
            {isHost && (
              <button
                onClick={handleStart}
                disabled={!allReady || starting}
                className="py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40 hover:bg-indigo-700 transition-colors"
              >
                {starting ? 'Starting…' : 'Start Adventure'}
              </button>
            )}
            {isHost && !allReady && (
              <p className="text-xs text-center text-slate-400">Waiting for everyone to ready up</p>
            )}
            <button
              onClick={handleLeave}
              className="py-2 text-sm text-red-500 hover:text-red-700 transition-colors"
            >
              Leave session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>}>
      <LobbyContent />
    </Suspense>
  );
}
