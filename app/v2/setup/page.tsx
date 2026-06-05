'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

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
  sessionName: string;
  dungeonName: string;
  currentRoomName: string;
  roomInstanceId: string;
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

const CLASSES = ['Fighter', 'Rogue', 'Wizard', 'Cleric'];

const CLASS_SKILLS: Record<string, string[]> = {
  Fighter: ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Survival'],
  Rogue: ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Performance', 'Persuasion', 'Sleight of Hand', 'Stealth'],
  Wizard: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'],
  Cleric: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
};

const SKILL_COUNT: Record<string, number> = {
  Fighter: 2, Rogue: 4, Wizard: 2, Cleric: 2,
};

function statMod(val: number) { return Math.floor((val - 10) / 2); }
function modStr(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

export default function SetupPage() {
  const [supabase] = useState(() =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ),
  );

  const [step, setStep] = useState<Step>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dungeons, setDungeons] = useState<Dungeon[]>([]);
  const [showNewChar, setShowNewChar] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [error, setError] = useState('');

  const [charName, setCharName] = useState('');
  const [charClass, setCharClass] = useState('Fighter');
  const [stats, setStats] = useState({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
  const [skills, setSkills] = useState<string[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUser(user);
        setStep('character');
        loadCharacters();
      } else {
        setStep('login');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setStep('character');
        loadCharacters();
      } else {
        setUser(null);
        setStep('login');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadCharacters = useCallback(async () => {
    const res = await fetch('/api/v2/me/characters');
    if (res.ok) {
      const { characters } = await res.json();
      setCharacters(characters);
    }
  }, []);

  const loadSessions = useCallback(async (charId: string) => {
    const [sRes, dRes] = await Promise.all([
      fetch(`/api/v2/sessions?characterId=${charId}`),
      fetch('/api/v2/dungeons'),
    ]);
    if (sRes.ok) {
      const { sessions } = await sRes.json();
      setSessions(sessions);
    }
    if (dRes.ok) {
      const { dungeons } = await dRes.json();
      setDungeons(dungeons);
    }
  }, []);

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/v2/setup` },
    });
  };

  const handleSelectChar = (char: Character) => {
    setSelectedChar(char);
    setStep('session');
    loadSessions(char.id);
  };

  const handleCreateChar = async () => {
    setError('');
    const res = await fetch('/api/v2/me/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: charName,
        characterClass: charClass,
        strength: stats.str,
        dexterity: stats.dex,
        constitution: stats.con,
        intelligence: stats.int,
        wisdom: stats.wis,
        charisma: stats.cha,
        skillProficiencies: skills,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    await loadCharacters();
    setShowNewChar(false);
    setCharName(''); setSkills([]);
  };

  const handleContinueSession = (session: Session) => {
    window.location.href = `/v2/play?session=${session.sessionId}&char=${selectedChar!.id}`;
  };

  const handleDeleteSession = async (session: Session) => {
    if (!confirm(`Abandon "${session.dungeonName}"? This cannot be undone.`)) return;
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

  const toggleSkill = (skill: string) => {
    const max = SKILL_COUNT[charClass] ?? 2;
    setSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : prev.length < max ? [...prev, skill] : prev,
    );
  };

  if (step === 'loading') {
    return <div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>;
  }

  if (step === 'login') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6">
        <h1 className="text-3xl font-bold text-slate-800">D&amp;D Async</h1>
        <button
          onClick={handleLogin}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  if (step === 'character') {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-800">Choose a Character</h2>
          <span className="text-sm text-slate-400">{user?.email}</span>
        </div>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <div className="space-y-3 mb-6">
          {characters.map(c => (
            <button
              key={c.id}
              onClick={() => handleSelectChar(c)}
              className="w-full text-left p-4 border border-slate-200 rounded-lg hover:bg-slate-50 flex justify-between items-center"
            >
              <span className="font-medium text-slate-800">{c.name}</span>
              <span className="text-sm text-slate-500">{c.characterClass} · Level {c.level} · HP {c.currentHp}/{c.maxHp}</span>
            </button>
          ))}
          {characters.length === 0 && (
            <p className="text-slate-400 text-sm text-center py-4">No characters yet.</p>
          )}
        </div>
        <button
          onClick={() => setShowNewChar(v => !v)}
          className="text-indigo-600 text-sm font-medium hover:underline"
        >
          {showNewChar ? 'Cancel' : '+ New Character'}
        </button>
        {showNewChar && (
          <div className="mt-4 border border-slate-200 rounded-lg p-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">Name</label>
              <input
                value={charName}
                onChange={e => setCharName(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
                placeholder="Character name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Class</label>
              <select
                value={charClass}
                onChange={e => { setCharClass(e.target.value); setSkills([]); }}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm"
              >
                {CLASSES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map(stat => (
                <div key={stat}>
                  <label className="text-xs font-medium text-slate-600 uppercase">{stat}</label>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      min={3}
                      max={18}
                      value={stats[stat]}
                      onChange={e => setStats(prev => ({ ...prev, [stat]: Number(e.target.value) }))}
                      className="w-14 border border-slate-300 rounded px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-slate-500">{modStr(statMod(stats[stat]))}</span>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">
                Skills ({SKILL_COUNT[charClass] ?? 2} of {CLASS_SKILLS[charClass]?.length ?? 0})
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(CLASS_SKILLS[charClass] ?? []).map(skill => (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      skills.includes(skill)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {skill}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleCreateChar}
              disabled={!charName.trim() || skills.length !== (SKILL_COUNT[charClass] ?? 2)}
              className="w-full py-2 bg-indigo-600 text-white rounded font-medium text-sm disabled:opacity-40 hover:bg-indigo-700"
            >
              Create Character
            </button>
          </div>
        )}
      </div>
    );
  }

  // step === 'session'
  return (
    <div className="max-w-xl mx-auto py-12 px-4">
      <button onClick={() => setStep('character')} className="text-sm text-slate-400 hover:text-slate-600 mb-4">← Back</button>
      <h2 className="text-2xl font-bold text-slate-800 mb-1">{selectedChar?.name}</h2>
      <p className="text-sm text-slate-500 mb-6">{selectedChar?.characterClass} · Level {selectedChar?.level}</p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {sessions.length > 0 && (
        <div className="space-y-3 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Continue Adventure</p>
          {sessions.map(s => (
            <div
              key={s.sessionId}
              className="flex items-stretch border border-slate-200 rounded-lg hover:bg-slate-50 overflow-hidden"
            >
              <button
                onClick={() => handleContinueSession(s)}
                className="flex-1 text-left p-4"
              >
                <p className="font-semibold text-slate-800">{s.dungeonName}</p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {s.currentRoomName}
                  {s.currentObjective && (
                    <span className="text-slate-400"> · {s.currentObjective}</span>
                  )}
                </p>
              </button>
              <button
                onClick={() => handleDeleteSession(s)}
                className="px-4 text-slate-300 hover:text-red-500 border-l border-slate-100 text-sm"
                title="Abandon this adventure"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowNewSession(v => !v)}
        className="text-indigo-600 text-sm font-medium hover:underline"
      >
        {showNewSession ? 'Cancel' : '+ Begin New Adventure'}
      </button>

      {showNewSession && (
        <div className="mt-4 space-y-4">
          {dungeons.map(d => (
            <div key={d.id} className="border border-slate-200 rounded-lg p-4">
              <h3 className="font-semibold text-slate-800 mb-1">{d.name}</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-3">{d.synopsis}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{d.difficulty}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{d.length}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{d.tone}</span>
                </div>
                <button
                  onClick={() => handleNewSession(d.id)}
                  disabled={!d.startRoomTemplateId}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
                >
                  Begin →
                </button>
              </div>
            </div>
          ))}
          {dungeons.length === 0 && (
            <p className="text-slate-400 text-sm text-center py-4">No adventures available.</p>
          )}
        </div>
      )}
    </div>
  );
}
