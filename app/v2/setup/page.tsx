'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { classEmoji } from '@/lib/class-emoji';
import { getStatCost } from '@/lib/v2/point-buy';
import { relativeTime } from '@/lib/v2/relative-time';
import AppBar from '@/components/app-bar';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'loading' | 'login' | 'character' | 'session';

interface Character {
  id: string;
  name: string;
  characterClass: string;
  level: number;
  currentHp: number;
  maxHp: number;
}

interface Session {
  sessionId: string;
  dungeonName: string;
  currentRoomName: string;
  currentObjective: string | null;
  lastActiveAt: string;
}

interface Dungeon {
  id: string;
  name: string;
  synopsis: string;
  difficulty: string;
  length: string;
  tone: string;
  startRoomTemplateId: string | null;
}

// ─── Character creation constants ─────────────────────────────────────────────

const CLASSES = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];

const CLASS_SKILLS: Record<string, string[]> = {
  Barbarian: ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival'],
  Bard:      ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'],
  Cleric:    ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
  Druid:     ['Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival'],
  Fighter:   ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Survival'],
  Monk:      ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'],
  Paladin:   ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'],
  Ranger:    ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival'],
  Rogue:     ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Performance', 'Persuasion', 'Sleight of Hand', 'Stealth'],
  Sorcerer:  ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'],
  Warlock:   ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion'],
  Wizard:    ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'],
};

const SKILL_COUNT: Record<string, number> = {
  Barbarian: 2, Bard: 3, Cleric: 2, Druid: 2, Fighter: 2,
  Monk: 2, Paladin: 2, Ranger: 3, Rogue: 4, Sorcerer: 2, Warlock: 2, Wizard: 2,
};

const INITIAL_STATS = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
const POINT_BUY_BUDGET = 27;

// ─── CharCreationForm ─────────────────────────────────────────────────────────

function CharCreationForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [charName,   setCharName]   = useState('');
  const [charClass,  setCharClass]  = useState('Fighter');
  const [stats,      setStats]      = useState(INITIAL_STATS);
  const [pointsLeft, setPointsLeft] = useState(POINT_BUY_BUDGET);
  const [skills,     setSkills]     = useState<string[]>([]);
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [ruleHint,   setRuleHint]   = useState('');

  useEffect(() => { setSkills([]); }, [charClass]);

  function handleStatChange(stat: keyof typeof INITIAL_STATS, increment: boolean) {
    const current = stats[stat];
    setRuleHint('');
    if (increment) {
      if (current >= 15) { setRuleHint('Cannot increase above 15.'); return; }
      const cost = getStatCost(current, true);
      if (pointsLeft < cost) { setRuleHint(`Need ${cost} points — only ${pointsLeft} remaining.`); return; }
      setStats(prev => ({ ...prev, [stat]: current + 1 }));
      setPointsLeft(p => p - cost);
    } else {
      if (current <= 8) { setRuleHint('Cannot decrease below 8.'); return; }
      const refund = getStatCost(current, false);
      setStats(prev => ({ ...prev, [stat]: current - 1 }));
      setPointsLeft(p => p + refund);
    }
  }

  function toggleSkill(skill: string) {
    const max = SKILL_COUNT[charClass] ?? 2;
    setSkills(prev =>
      prev.includes(skill)
        ? prev.filter(s => s !== skill)
        : prev.length < max ? [...prev, skill] : prev,
    );
  }

  async function handleSubmit() {
    setError('');
    setSaving(true);
    const res = await fetch('/api/v2/me/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: charName,
        characterClass: charClass,
        strength:     stats.str,
        dexterity:    stats.dex,
        constitution: stats.con,
        intelligence: stats.int,
        wisdom:       stats.wis,
        charisma:     stats.cha,
        skillProficiencies: skills,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create character.'); setSaving(false); return; }
    await onCreated();
  }

  const required  = SKILL_COUNT[charClass] ?? 2;
  const remaining = required - skills.length;
  const skillLabel = skills.length === 0
    ? `Choose your skills — pick ${required}`
    : remaining > 0
      ? `Skills: ${skills.length} / ${required} chosen`
      : `Skills: ${required} / ${required} chosen ✓`;

  function modStr(v: number) {
    const m = Math.floor((v - 10) / 2);
    return m >= 0 ? `+${m}` : `${m}`;
  }

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="text-sm font-medium text-slate-700">Name</label>
        <input
          value={charName}
          onChange={e => setCharName(e.target.value)}
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="e.g. Lyra the Swift"
        />
      </div>

      {/* Class */}
      <div>
        <label className="text-sm font-medium text-slate-700">Class</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {CLASSES.map(cls => (
            <button
              key={cls}
              type="button"
              onClick={() => setCharClass(cls)}
              className={`p-3 border text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                charClass === cls
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{classEmoji(cls)}</span> {cls}
            </button>
          ))}
        </div>
      </div>

      {/* Attributes — point buy */}
      <div className="bg-slate-50 rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700">Attributes</span>
          <span className={`text-xs px-2 py-1 rounded-full font-bold ${
            pointsLeft === 0 ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
          }`}>
            {pointsLeft} points left
          </span>
        </div>
        {(Object.keys(INITIAL_STATS) as Array<keyof typeof INITIAL_STATS>).map(stat => (
          <div key={stat} className="flex justify-between items-center">
            <span className="text-sm font-medium text-slate-600 uppercase tracking-wide text-xs">{stat}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleStatChange(stat, false)}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold text-slate-600"
              >−</button>
              <span className="w-6 text-center font-semibold text-sm text-slate-800">{stats[stat]}</span>
              <button
                type="button"
                onClick={() => handleStatChange(stat, true)}
                className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded hover:bg-slate-100 font-bold text-slate-600"
              >+</button>
              <span className="w-7 text-xs text-slate-400 text-right">{modStr(stats[stat])}</span>
            </div>
          </div>
        ))}
        {ruleHint && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {ruleHint}
          </p>
        )}
      </div>

      {/* Skills */}
      <div>
        <label className="text-sm font-medium text-slate-700">{skillLabel}</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {(CLASS_SKILLS[charClass] ?? []).map(skill => (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                skills.includes(skill)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {skill}
            </button>
          ))}
        </div>
        {skills.length > 0 && remaining > 0 && (
          <p className="text-xs text-amber-600 mt-2">
            Choose {remaining} more skill{remaining > 1 ? 's' : ''} to continue.
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!charName.trim() || skills.length !== required || saving}
        className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-medium text-sm disabled:opacity-40 hover:bg-indigo-700 transition-colors"
      >
        {saving ? 'Creating…' : 'Create Character'}
      </button>
    </div>
  );
}

// ─── SetupContent ─────────────────────────────────────────────────────────────

function SetupContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ),
  );

  const [step,           setStep]           = useState<Step>('loading');
  const [user,           setUser]           = useState<User | null>(null);
  const [characters,     setCharacters]     = useState<Character[]>([]);
  const [selectedChar,   setSelectedChar]   = useState<Character | null>(null);
  const [sessions,       setSessions]       = useState<Session[]>([]);
  const [dungeons,       setDungeons]       = useState<Dungeon[]>([]);
  const [showCharModal,  setShowCharModal]  = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [error,          setError]          = useState('');
  const [loginLoading,   setLoginLoading]   = useState(false);
  const [loginError,     setLoginError]     = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); setStep('character'); loadCharacters(); }
      else      { setStep('login'); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) { setUser(session.user); setStep('character'); loadCharacters(); }
      else               { setUser(null); setStep('login'); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Sync step with URL: restore session on forward nav, return to character on back nav
  useEffect(() => {
    const charId = searchParams.get('char');
    if (!charId) {
      if (step === 'session') setStep('character');
      return;
    }
    if (step === 'session') return;
    if (characters.length === 0) return;
    const match = characters.find(c => c.id === charId);
    if (match) { setSelectedChar(match); setStep('session'); loadSessions(match.id); }
  }, [characters, searchParams, step]);

  const loadCharacters = useCallback(async () => {
    const res = await fetch('/api/v2/me/characters');
    if (res.ok) { const { characters } = await res.json(); setCharacters(characters); }
  }, []);

  const loadSessions = useCallback(async (charId: string) => {
    const [sRes, dRes] = await Promise.all([
      fetch(`/api/v2/sessions?characterId=${charId}`),
      fetch('/api/v2/dungeons'),
    ]);
    if (sRes.ok) { const { sessions } = await sRes.json(); setSessions(sessions); }
    if (dRes.ok) { const { dungeons } = await dRes.json(); setDungeons(dungeons); }
  }, []);

  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/v2/setup` },
      });
    } catch {
      setLoginError('Sign-in failed — please try again.');
      setLoginLoading(false);
    }
  };

  const handleSelectChar = (char: Character) => {
    setSelectedChar(char);
    setStep('session');
    loadSessions(char.id);
    router.push(`/v2/setup?char=${char.id}`);
  };

  const handleContinueSession = (session: Session) => {
    window.location.href = `/v2/play?session=${session.sessionId}&char=${selectedChar!.id}`;
  };

  const handleDeleteSession = async (session: Session) => {
    setError('');
    const res = await fetch(
      `/api/v2/sessions?sessionId=${session.sessionId}&characterId=${selectedChar!.id}`,
      { method: 'DELETE' },
    );
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    setSessions(prev => prev.filter(s => s.sessionId !== session.sessionId));
  };

  const handleNewSession = async (dungeonId: string) => {
    setError('');
    const res = await fetch('/api/v2/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: selectedChar!.id, dungeonTemplateId: dungeonId }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    window.location.href = `/v2/play?session=${data.sessionId}&char=${selectedChar!.id}`;
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>
    );
  }

  // ── Login / Start screen ─────────────────────────────────────────────────────

  if (step === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">⚔️ Delve</h1>
            <p className="text-sm text-slate-500">Explore when you can.</p>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed text-center">
            Play D&amp;D with friends — or solo — without scheduling a session.
            Take your turn whenever you have five minutes.
          </p>

          <div className="space-y-3">
            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="w-full h-11 px-4 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.96 1 12 1 7.35 1 3.4 3.65 1.51 7.5l3.86 3C6.28 7.55 8.91 5.04 12 5.04z"/>
                <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.43h6.44c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.98 3.39-4.89 3.39-8.48z"/>
                <path fill="#FBBC05" d="M5.37 14.77c-.24-.72-.37-1.49-.37-2.27s.13-1.55.37-2.27l-3.86-3C.68 8.78 0 10.31 0 12s.68 3.22 1.51 4.77l3.86-3z"/>
                <path fill="#34A853" d="M12 23c3.24 0 5.97-1.08 7.96-2.91l-3.66-2.84c-1.01.68-2.31 1.09-4.3 1.09-3.09 0-5.72-2.51-6.65-5.46L1.49 15.8C3.38 19.65 7.33 23 12 23z"/>
              </svg>
              <span>{loginLoading ? 'Signing in…' : 'Sign in with Google'}</span>
            </button>
            {loginError && (
              <p className="text-xs text-red-500 text-center">{loginError}</p>
            )}
          </div>

          <p className="text-xs text-slate-400 text-center">
            New here? Pick a character and start a dungeon in under 2 minutes.
          </p>
        </div>
      </div>
    );
  }

  // ── Character selection ──────────────────────────────────────────────────────

  if (step === 'character') {
    return (
      <>
        <AppBar title="Delve" />
        <div className="max-w-xl mx-auto py-8 px-4">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Choose a Hero</h2>
          </div>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

          {characters.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <p className="text-slate-500 font-medium">No heroes yet.</p>
              <p className="text-sm text-slate-400">Create your first character to begin your adventure.</p>
              <button
                onClick={() => setShowCharModal(true)}
                className="mt-2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Create Character
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {characters.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelectChar(c)}
                  className="w-full text-left p-4 border border-slate-200 rounded-lg hover:bg-slate-50 flex justify-between items-center transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{classEmoji(c.characterClass)}</span>
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
                      <p className="text-xs text-slate-400">
                        {c.characterClass} · Level {c.level} · HP {c.currentHp}/{c.maxHp}
                      </p>
                    </div>
                  </div>
                  <span className="text-slate-300 text-sm">→</span>
                </button>
              ))}

              <button
                onClick={() => setShowCharModal(true)}
                className="w-full p-4 border-2 border-dashed border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 flex items-center gap-3 text-slate-400 hover:text-slate-600 transition-all"
              >
                <span className="text-2xl font-light leading-none">+</span>
                <span className="text-sm font-medium">New Character</span>
              </button>
            </div>
          )}
        </div>

        {showCharModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-slate-900">New Character</h2>
                <button
                  onClick={() => setShowCharModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none"
                >✕</button>
              </div>
              <CharCreationForm
                onCreated={async () => {
                  await loadCharacters();
                  setShowCharModal(false);
                }}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Session selection ────────────────────────────────────────────────────────

  const hpRatio = selectedChar ? selectedChar.currentHp / selectedChar.maxHp : 1;

  return (
    <>
      <AppBar
        title="Delve"
        left={
          <button
            onClick={() => router.back()}
            className="text-sm text-slate-400 hover:text-slate-600"
          >
            ← Heroes
          </button>
        }
      />
    <div className="max-w-xl mx-auto py-8 px-4">
      <h2 className="text-2xl font-bold text-slate-800 mb-1">{selectedChar?.name}</h2>
      <p className="text-sm text-slate-500 mb-6">
        {selectedChar?.characterClass} · Level {selectedChar?.level}
        {selectedChar && (
          <>
            {' · '}
            <span className={hpRatio < 0.5 ? 'text-red-500 font-medium' : ''}>
              HP {selectedChar.currentHp}/{selectedChar.maxHp}
            </span>
          </>
        )}
      </p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {sessions.length > 0 && (
        <div className="space-y-3 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Continue Adventure</p>
          {sessions.map(s =>
            pendingDeleteId === s.sessionId ? (
              <div
                key={s.sessionId}
                className="flex items-center justify-between p-4 border border-amber-200 bg-amber-50 rounded-lg"
              >
                <p className="text-sm text-slate-700">
                  Abandon <span className="font-semibold">{s.dungeonName}</span>?
                </p>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setPendingDeleteId(null)}
                    className="text-sm px-3 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white transition-colors"
                  >
                    Keep it
                  </button>
                  <button
                    onClick={() => { handleDeleteSession(s); setPendingDeleteId(null); }}
                    className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    Abandon
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={s.sessionId}
                className="flex items-stretch border border-slate-200 rounded-lg hover:bg-slate-50 overflow-hidden transition-colors"
              >
                <button onClick={() => handleContinueSession(s)} className="flex-1 text-left p-4">
                  <p className="font-semibold text-slate-800">{s.dungeonName}</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {s.currentRoomName}
                    {s.currentObjective && (
                      <span className="text-slate-400"> · {s.currentObjective}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{relativeTime(s.lastActiveAt)}</p>
                </button>
                <button
                  onClick={() => setPendingDeleteId(s.sessionId)}
                  className="px-4 text-slate-300 hover:text-red-500 border-l border-slate-100 text-sm transition-colors"
                  title="Abandon this adventure"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Begin New Adventure
        </p>
        {dungeons.map(d => (
          <div key={d.id} className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-800 mb-1">{d.name}</h3>
            <p className="text-sm text-slate-500 leading-relaxed mb-3">{d.synopsis}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {d.difficulty}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {d.length}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {d.tone}
                </span>
              </div>
              <button
                onClick={() => handleNewSession(d.id)}
                disabled={!d.startRoomTemplateId}
                className="text-sm font-medium px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
              >
                Begin
              </button>
            </div>
          </div>
        ))}
        {dungeons.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-4">No adventures available.</p>
        )}
      </div>
    </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>}>
      <SetupContent />
    </Suspense>
  );
}
