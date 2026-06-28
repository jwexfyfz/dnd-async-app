'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { classEmoji } from '@/lib/class-emoji';
import { getStatCost } from '@/lib/v2/point-buy';
import { relativeTime } from '@/lib/v2/relative-time';
import { XP_THRESHOLDS } from '@/lib/xp';
import AppBar from '@/components/app-bar';
import { CLASS_DEFINITIONS } from '@/lib/v2/class-definitions';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'loading' | 'login' | 'character' | 'session';

interface ActiveGame {
  id: string;
  phase: string;
  gameState: string;
  currentTurnCharacterId: string | null;
  story: { title: string } | null;
  currentAct: { order: number; title: string } | null;
  currentScene: { title: string } | null;
  partyMembers: Array<{
    characterId: string;
    character: { id: string; name: string; characterClass: string; currentHp: number; maxHp: number };
  }>;
}

interface ActiveSession {
  id: string;
  gameState: string;
  roomGameState: string;
  dungeonName: string;
  currentRoomName: string | null;
  partyMembers: Array<{ characterId: string; name: string; characterClass: string }>;
  isEnrolledInCombat: boolean;
  activeCombatRoomName: string | null;
}

interface Character {
  id: string;
  name: string;
  characterClass: string;
  level: number;
  currentHp: number;
  maxHp: number;
  xp: number;
  hasPendingChoice: boolean;
  baseStrength: number;
  baseDexterity: number;
  baseConstitution: number;
  baseIntelligence: number;
  baseWisdom: number;
  baseCharisma: number;
  activeGame: ActiveGame | null;
  activeSession: ActiveSession | null;
  situationSummary: string | null;
}

interface Session {
  sessionId: string;
  dungeonName: string;
  currentRoomName: string;
  currentObjective: string | null;
  lastActiveAt: string;
  gameState: string;
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

const CLASSES = ['Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];

const CLASS_SKILLS: Record<string, string[]> = {
  Artificer: ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Sleight of Hand'],
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
  Artificer: 2, Barbarian: 2, Bard: 3, Cleric: 2, Druid: 2, Fighter: 2,
  Monk: 2, Paladin: 2, Ranger: 3, Rogue: 4, Sorcerer: 2, Warlock: 2, Wizard: 2,
};

const INITIAL_STATS = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
const POINT_BUY_BUDGET = 27;

const L1_SUBCLASS_CLASSES = ['Cleric', 'Sorcerer', 'Warlock'];

interface SubclassLevelUnlock { level: number; features: string[]; }
interface SubclassRow { id: string; key: string; name: string; blurb: string; playstyleTag: string; keyStat: string; available: boolean; levelUnlocks: SubclassLevelUnlock[]; }

// ─── CharCreationForm ─────────────────────────────────────────────────────────

function CharCreationForm({ onCreated, lockedLevel, predecessorCharacterId }: {
  onCreated: (newCharId: string) => Promise<void>;
  lockedLevel?: number;
  predecessorCharacterId?: string;
}) {
  const [charName,   setCharName]   = useState('');
  const [charClass,  setCharClass]  = useState('Fighter');
  const [stats,      setStats]      = useState(INITIAL_STATS);
  const [pointsLeft, setPointsLeft] = useState(POINT_BUY_BUDGET);
  const [skills,     setSkills]     = useState<string[]>([]);
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [ruleHint,   setRuleHint]   = useState('');
  const [overlay, setOverlay] = useState<{ cls: string; step: 'detail' | 'subclass' | 'confirm'; subs: SubclassRow[]; subsLoading: boolean; picked: SubclassRow | null } | null>(null);
  const [selectedSubclassKey, setSelectedSubclassKey] = useState<string | null>(null);
  const [selectedSubclassName, setSelectedSubclassName] = useState<string | null>(null);
  const [activeSubIdx, setActiveSubIdx] = useState(0);
  const [subCardWidth, setSubCardWidth] = useState(310);
  const [subDragStartX, setSubDragStartX] = useState<number | null>(null);
  const [subDragStartY, setSubDragStartY] = useState<number | null>(null);
  const [subDragOffset, setSubDragOffset] = useState(0);

  useEffect(() => {
    const measure = () => setSubCardWidth(window.innerWidth - 80);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const SUBCLASS_LEVEL_MAP: Record<string, number> = { Cleric: 1, Sorcerer: 1, Warlock: 1, Wizard: 2, Druid: 2 };
  function subclassLevelFor(cls: string) { return SUBCLASS_LEVEL_MAP[cls] ?? 3; }

  function openOverlay(cls: string) {
    const needsSub = L1_SUBCLASS_CLASSES.includes(cls) || (!!lockedLevel && lockedLevel >= subclassLevelFor(cls));
    setOverlay({ cls, step: 'detail', subs: [], subsLoading: needsSub, picked: null });
    if (needsSub) {
      fetch(`/api/v2/subclasses?class=${encodeURIComponent(cls)}`)
        .then(r => r.json())
        .then(({ subclasses }) => {
          setOverlay(prev => prev ? { ...prev, subs: subclasses ?? [], subsLoading: false } : null);
        })
        .catch(() => {
          setOverlay(prev => prev ? { ...prev, subsLoading: false } : null);
        });
    }
  }

  function confirmClass(cls: string, sub: SubclassRow | null) {
    setCharClass(cls);
    setSelectedSubclassKey(sub?.key ?? null);
    setSelectedSubclassName(sub?.name ?? null);
    if (cls !== charClass) setSkills([]);
    setOverlay(null);
  }

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
        ...(selectedSubclassKey ? { subclassKey: selectedSubclassKey } : {}),
        ...(lockedLevel && lockedLevel > 1 ? { startingLevel: lockedLevel } : {}),
        ...(predecessorCharacterId ? { predecessorCharacterId } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed to create character.'); setSaving(false); return; }
    await onCreated(data.character.id);
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
          autoComplete="new-password"
          name="character-hero-name"
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="e.g. Lyra the Swift"
        />
      </div>

      {/* Class */}
      <div>
        <label className="text-sm font-medium text-slate-700">Class</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {CLASSES.map(cls => {
            const def = CLASS_DEFINITIONS[cls];
            const selected = charClass === cls;
            const rolePill = def ? {
              attacker:   selected ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700',
              tank:       selected ? 'bg-white/20 text-white' : 'bg-sky-100 text-sky-700',
              support:    selected ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
              controller: selected ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-700',
            }[def.roleType] : '';
            const roleLabel = def ? { attacker: 'Attacker', tank: 'Tank', support: 'Support', controller: 'Controller' }[def.roleType] : '';
            return (
              <button
                key={cls}
                type="button"
                onClick={() => openOverlay(cls)}
                className={`p-3 border text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                  selected
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{classEmoji(cls)}</span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block truncate">{cls}{selected && selectedSubclassName ? ` · ${selectedSubclassName}` : ''}</span>
                  {def && (
                    <span className="mt-0.5 block">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${rolePill}`}>{roleLabel}</span>
                    </span>
                  )}
                </span>
                {selected && <span className="text-xs opacity-70 shrink-0">✎</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Class detail / subclass overlay */}
      {overlay && (() => {
        const def = CLASS_DEFINITIONS[overlay.cls];
        if (overlay.step === 'detail') return (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col justify-end" onClick={() => setOverlay(null)}>
            <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>

              {/* ── Non-scrollable top ── */}
              <div className="p-5 space-y-4 shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{classEmoji(overlay.cls)}</span>
                    <div>
                      <p className="font-bold text-slate-900 text-lg">{overlay.cls}</p>
                      <p className="text-xs text-slate-500">{def?.role}</p>
                    </div>
                  </div>
                  <button onClick={() => setOverlay(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">✕</button>
                </div>
                {def && (
                  <>
                    <div className="space-y-3 pb-2">
                      <span className={`inline-flex text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                        def.roleType === 'attacker'   ? 'bg-rose-100 text-rose-700' :
                        def.roleType === 'tank'       ? 'bg-sky-100 text-sky-700' :
                        def.roleType === 'support'    ? 'bg-emerald-100 text-emerald-700' :
                        'bg-violet-100 text-violet-700'
                      }`}>
                        {{ attacker: 'Attacker', tank: 'Tank', support: 'Support', controller: 'Controller' }[def.roleType]}
                      </span>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-0.5">Difficulty</span>
                          {[0, 1, 2].map(i => (
                            <div key={i} className={`w-2 h-2 rounded-full ${
                              i < { beginner: 1, intermediate: 2, expert: 3 }[def.difficulty]
                                ? def.difficulty === 'beginner'     ? 'bg-green-500'
                                  : def.difficulty === 'intermediate' ? 'bg-amber-500'
                                  : 'bg-red-500'
                                : 'bg-slate-200'
                            }`} />
                          ))}
                          <span className={`text-xs font-semibold ${
                            def.difficulty === 'beginner'     ? 'text-green-700' :
                            def.difficulty === 'intermediate' ? 'text-amber-700' :
                            'text-red-700'
                          }`}>
                            {{ beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' }[def.difficulty]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-snug">{def.difficultyNote}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm text-slate-600">
                      <p>{def.playstyleBlurb}</p>
                      <div className="flex gap-4 text-xs">
                        <span><strong>Key stats:</strong> {def.keyStats.join(', ')}</span>
                        <span><strong>Hit die:</strong> d{def.hitDie}</span>
                      </div>
                      <p><strong>Signature ability:</strong> {def.highlightFeature}</p>
                    </div>
                  </>
                )}
              </div>

              {/* ── Scrollable level progression ── */}
              {def && def.baseLevelUnlocks.length > 0 && (
                <div className="overflow-y-auto flex-1 border-t border-slate-100 px-5">
                  <div className="py-3 space-y-2.5">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Level Progression</p>
                    {def.baseLevelUnlocks.map(({ level, features }) => (
                      <div key={level}>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Level {level}</p>
                        {features.map(f => (
                          <p key={f} className="text-xs text-slate-700 leading-snug">· {f}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Non-scrollable bottom: subclass info + buttons ── */}
              <div className="px-5 pb-5 pt-4 space-y-3 shrink-0 border-t border-slate-100">
                {def && (
                  L1_SUBCLASS_CLASSES.includes(overlay.cls) ? (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Choose your {def.subclassTerm} now
                      </p>
                      {overlay.subsLoading ? (
                        <p className="text-xs text-slate-400">Loading options…</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {overlay.subs.map(sub => (
                            <span key={sub.key} className="text-xs px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full font-medium">
                              {sub.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400">Your {def.subclassTerm} shapes your spells and signature abilities from the very start.</p>
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs">{def.subclassTerm} chosen at level {def.subclassLevel} (in-game)</p>
                  )
                )}
                <div className="flex gap-2">
                  <button onClick={() => setOverlay(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">← Back</button>
                  <button
                    onClick={() => {
                      if (L1_SUBCLASS_CLASSES.includes(overlay.cls)) {
                        setActiveSubIdx(0);
                        setOverlay(prev => prev ? { ...prev, step: 'subclass' } : null);
                      } else {
                        confirmClass(overlay.cls, null);
                      }
                    }}
                    className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700"
                  >
                    {L1_SUBCLASS_CLASSES.includes(overlay.cls) ? `Choose ${overlay.cls} →` : `Choose ${overlay.cls}`}
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
        if (overlay.step === 'subclass') return (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col justify-end">
            <div className="bg-white rounded-t-2xl pt-5 pb-4 flex flex-col" style={{ maxHeight: '88vh' }}>
              <div className="flex items-center justify-between px-5 mb-3">
                <p className="font-bold text-slate-900">Choose your {def?.subclassTerm ?? 'Subclass'}</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setOverlay(prev => prev ? { ...prev, step: 'detail' } : null)}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    ← Back
                  </button>
                  <button onClick={() => setOverlay(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
                </div>
              </div>
              {overlay.subsLoading && <p className="text-sm text-slate-400 px-5">Loading…</p>}
              {!overlay.subsLoading && overlay.subs.length === 0 && <p className="text-sm text-slate-400 px-5">No options available.</p>}
              {!overlay.subsLoading && overlay.subs.length > 0 && (
                <>
                  <div style={{ overflow: 'hidden', width: '100%' }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        transform: `translateX(${40 - activeSubIdx * (subCardWidth + 12) + subDragOffset}px)`,
                        transition: subDragStartX !== null ? 'none' : 'transform 280ms ease',
                        willChange: 'transform',
                        userSelect: 'none',
                      }}
                      onTouchStart={e => {
                        setSubDragStartX(e.touches[0].clientX);
                        setSubDragStartY(e.touches[0].clientY);
                        setSubDragOffset(0);
                      }}
                      onTouchMove={e => {
                        if (subDragStartX === null || subDragStartY === null) return;
                        const dx = e.touches[0].clientX - subDragStartX;
                        const dy = e.touches[0].clientY - (subDragStartY ?? 0);
                        if (Math.abs(dy) > Math.abs(dx) && Math.abs(subDragOffset) < 5) {
                          setSubDragStartX(null);
                          return;
                        }
                        setSubDragOffset(Math.max(-(subCardWidth + 12), Math.min(subCardWidth + 12, dx)));
                      }}
                      onTouchEnd={() => {
                        if (subDragStartX !== null) {
                          if (subDragOffset < -40 && activeSubIdx < overlay.subs.length - 1) setActiveSubIdx(i => i + 1);
                          else if (subDragOffset > 40 && activeSubIdx > 0) setActiveSubIdx(i => i - 1);
                        }
                        setSubDragStartX(null);
                        setSubDragStartY(null);
                        setSubDragOffset(0);
                      }}
                    >
                    {overlay.subs.map((sub, i) => (
                      <div
                        key={sub.key}
                        style={{ width: subCardWidth, maxWidth: subCardWidth, flexShrink: 0, maxHeight: 380, overflowY: 'auto' }}
                        className={`rounded-xl border-2 p-4 bg-white transition-colors ${
                          !sub.available ? 'border-slate-200 opacity-60' : activeSubIdx === i ? 'border-indigo-400 shadow-md' : 'border-slate-200'
                        }`}
                      >
                        {!sub.available && (
                          <span className="float-right text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full ml-2">Coming soon</span>
                        )}
                        <p className="font-bold text-slate-800 text-base mb-1">{sub.name}</p>
                        <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{sub.playstyleTag}</span>
                        <p className="text-xs text-slate-600 mt-2 leading-relaxed">{sub.blurb}</p>
                        <p className="text-[10px] text-slate-400 mt-1 mb-3">Key stat: {sub.keyStat}</p>
                        {sub.levelUnlocks.length > 0 && (
                          <div className="border-t border-slate-100 pt-2 space-y-2.5">
                            {sub.levelUnlocks.map(({ level, features }) => (
                              <div key={level}>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Level {level}</p>
                                {features.map(f => (
                                  <p key={f} className="text-xs text-slate-700 leading-snug">· {f}</p>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    </div>
                  </div>
                  {overlay.subs.length > 1 && (
                    <div className="flex justify-center gap-1.5 py-2.5">
                      {overlay.subs.map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full transition-colors ${activeSubIdx === i ? 'bg-indigo-500' : 'bg-slate-200'}`}
                        />
                      ))}
                    </div>
                  )}
                  <div className="px-5 pt-1">
                    <button
                      onClick={() => {
                        const sub = overlay.subs[activeSubIdx];
                        if (sub?.available) setOverlay(prev => prev ? { ...prev, step: 'confirm', picked: sub } : null);
                      }}
                      disabled={!overlay.subs[activeSubIdx]?.available}
                      className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-indigo-700 transition-colors"
                    >
                      Choose This Path
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
        if (overlay.step === 'confirm' && overlay.picked) return (
          <div className="fixed inset-0 z-50 bg-black/50 flex flex-col justify-end">
            <div className="bg-white rounded-t-2xl p-5 space-y-3">
              <p className="font-bold text-slate-900">{overlay.picked.name}</p>
              <p className="text-sm text-slate-600 leading-relaxed">{overlay.picked.blurb}</p>
              <p className="text-xs font-semibold text-amber-700">This choice is permanent.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setOverlay(prev => prev ? { ...prev, step: 'subclass' } : null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">← Back</button>
                <button onClick={() => confirmClass(overlay.cls, overlay.picked)} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700">Confirm — {overlay.picked.name}</button>
              </div>
            </div>
          </div>
        );
        return null;
      })()}

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
        disabled={!charName.trim() || skills.length !== required || saving || (L1_SUBCLASS_CLASSES.includes(charClass) && !selectedSubclassKey)}
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
  const [pendingDeleteId,  setPendingDeleteId]  = useState<string | null>(null);
  const [deleteTarget,     setDeleteTarget]     = useState<Character | null>(null);
  const [confirmName,      setConfirmName]      = useState('');
  const [isDeleting,       setIsDeleting]       = useState(false);
  const [deleteError,      setDeleteError]      = useState('');
  const [error,            setError]            = useState('');
  const [loginLoading,     setLoginLoading]     = useState(false);
  const [loginError,       setLoginError]       = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); setStep('character'); loadCharacters(); }
      else      { setStep('login'); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const returnTo = sessionStorage.getItem('auth-return-to');
        if (returnTo) {
          sessionStorage.removeItem('auth-return-to');
          window.location.href = returnTo;
          return;
        }
        setUser(session.user); setStep('character'); loadCharacters();
      } else {
        setUser(null); setStep('login');
      }
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
    if (session.gameState === 'lobby') {
      window.location.href = `/v2/lobby/${session.sessionId}`;
    } else {
      window.location.href = `/v2/play?session=${session.sessionId}&char=${selectedChar!.id}`;
    }
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
    window.location.href = `/v2/lobby/${data.sessionId}`;
  };

  const handleDeleteCharacter = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    const res = await fetch(`/api/v2/me/characters/${deleteTarget.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { setDeleteError(data.error ?? 'Failed to delete.'); setIsDeleting(false); return; }
    await loadCharacters();
    setDeleteTarget(null);
    setConfirmName('');
    setIsDeleting(false);
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

  // Heroic sacrifice flow: skip directly to char creation
  const fromSacrifice = searchParams.get('fromSacrifice') === 'true';
  const sacrificeLevel = fromSacrifice ? Number(searchParams.get('level') ?? '1') : undefined;
  const sacrificePredecessorId = fromSacrifice ? (searchParams.get('predecessorId') ?? undefined) : undefined;
  const sacrificeSessionId = fromSacrifice ? (searchParams.get('sessionId') ?? undefined) : undefined;
  const sacrificeFallenName = fromSacrifice ? (searchParams.get('fallenName') ?? undefined) : undefined;

  if (fromSacrifice && step === 'character') {
    return (
      <>
        <AppBar title="Delve" />
        <div className="w-full max-w-md mx-auto py-8 px-4">
          {sacrificeFallenName && (
            <div className="mb-5 p-4 bg-slate-100 rounded-xl text-center">
              <p className="font-semibold text-slate-700">{sacrificeFallenName} has fallen.</p>
              <p className="text-sm text-slate-500 mt-1">Build your next hero at level {sacrificeLevel}.</p>
            </div>
          )}
          <CharCreationForm
            lockedLevel={sacrificeLevel}
            predecessorCharacterId={sacrificePredecessorId}
            onCreated={async (newCharId) => {
              if (!sacrificeSessionId) { router.push('/v2/setup'); return; }
              const joinRes = await fetch(`/api/v2/sessions/${sacrificeSessionId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId: newCharId, predecessorCharacterId: sacrificePredecessorId }),
              });
              if (joinRes.ok) {
                router.push(`/v2/play?session=${sacrificeSessionId}&char=${newCharId}`);
              } else {
                router.push('/v2/setup');
              }
            }}
          />
        </div>
      </>
    );
  }

  if (step === 'character') {
    return (
      <>
        <AppBar title="Delve" />
        <div className="w-[92%] max-w-5xl mx-auto py-8">
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
            <div className="grid grid-cols-1 min-[1000px]:grid-cols-2 gap-4">
              {characters.map(c => {
                const g = c.activeGame;
                const s = c.activeSession;
                const inGame = !!(g || s);
                const progressLabel = g?.currentAct
                  ? `Act ${g.currentAct.order} · ${g.currentScene?.title ?? g.currentAct.title}`
                  : null;

                // Derive status banner
                const gameStateVal = g?.gameState ?? (s ? s.roomGameState : null);
                const inCombat = gameStateVal === 'combat';
                const turnCharId = g?.currentTurnCharacterId ?? null;
                const isMyTurn = inCombat && turnCharId === c.id;
                const turnCharName = inCombat && turnCharId && !isMyTurn
                  ? (g?.partyMembers.find(m => m.characterId === turnCharId)?.character.name ?? null)
                  : null;

                // ally-in-combat: session has active combat but this character is NOT enrolled
                const sessionInCombat = s?.roomGameState === 'combat';
                const allyInCombat = sessionInCombat && !(s?.isEnrolledInCombat ?? false);

                type BannerState = 'your-turn' | 'battle-waiting' | 'ally-in-combat' | 'exploring' | 'lobby' | null;
                const bannerState: BannerState = !inGame ? null
                  : (g?.phase === 'LOBBY' || s?.gameState === 'lobby') ? 'lobby'
                  : allyInCombat ? 'ally-in-combat'
                  : inCombat && isMyTurn ? 'your-turn'
                  : inCombat ? 'battle-waiting'
                  : 'exploring';

                const bannerProps: Record<NonNullable<BannerState>, { cls: string; label: string }> = {
                  'your-turn':       { cls: 'bg-green-50 border-b border-green-100 text-green-700', label: '⚔️  In Battle — Your turn' },
                  'battle-waiting':  { cls: 'bg-rose-50 border-b border-rose-100 text-rose-700',   label: `⚔️  In Battle${turnCharName ? ` — ${turnCharName}'s turn` : ''}` },
                  'ally-in-combat':  { cls: 'bg-orange-50 border-b border-orange-100 text-orange-700', label: `⚔️  Ally in Battle${s?.activeCombatRoomName ? ` — ${s.activeCombatRoomName}` : ''}` },
                  'exploring':       { cls: 'bg-indigo-50 border-b border-indigo-100 text-indigo-600', label: '🧭  Exploring' },
                  'lobby':           { cls: 'bg-slate-50 border-b border-slate-100 text-slate-500',    label: '⏳  In Lobby' },
                };

                return (
                  <div key={c.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Status banner */}
                    {bannerState && (
                      <div className={`px-4 py-1.5 text-xs font-semibold ${bannerProps[bannerState].cls}`}>
                        {bannerProps[bannerState].label}
                      </div>
                    )}
                    <div className="p-4 space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{classEmoji(c.characterClass)}</span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
                            {c.hasPendingChoice && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-300 leading-none">Choice</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{c.characterClass} · Lv {c.level}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setDeleteTarget(c); setConfirmName(''); setDeleteError(''); }}
                        className="p-1 text-slate-300 hover:text-red-400 transition-colors shrink-0"
                        aria-label={`Delete ${c.name}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </div>

                    {/* Campaign / Progress / Party */}
                    <div className="border-t border-slate-100 pt-3 space-y-1.5">
                      {g ? (
                        <>
                          <div className="flex justify-between items-baseline gap-2 text-xs">
                            <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Campaign</span>
                            <span className="text-slate-700 font-medium truncate text-right">{g.story?.title ?? '—'}</span>
                          </div>
                          <div className="flex justify-between items-baseline gap-2 text-xs">
                            <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Progress</span>
                            <span className="text-slate-600 text-right">{progressLabel ?? (g.phase === 'LOBBY' ? 'In lobby' : '—')}</span>
                          </div>
                          {g.partyMembers.length > 0 && (
                            <div className="flex justify-between items-center gap-2 text-xs">
                              <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Party</span>
                              <div className="flex gap-1.5 items-center">
                                {g.partyMembers.map(m => (
                                  <div key={m.characterId} className="flex flex-col items-center gap-0.5" title={m.character.name}>
                                    <span className="text-sm leading-none">{classEmoji(m.character.characterClass)}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${m.characterId === g.currentTurnCharacterId ? 'bg-amber-400' : 'bg-slate-300'}`} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : s ? (
                        <>
                          <div className="flex justify-between items-baseline gap-2 text-xs">
                            <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Campaign</span>
                            <span className="text-slate-700 font-medium truncate text-right">{s.dungeonName}</span>
                          </div>
                          {s.currentRoomName && (
                            <div className="flex justify-between items-baseline gap-2 text-xs">
                              <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Location</span>
                              <span className="text-slate-600 text-right truncate">{s.currentRoomName}</span>
                            </div>
                          )}
                          {s.partyMembers.length > 0 && (
                            <div className="flex justify-between items-center gap-2 text-xs">
                              <span className="text-slate-400 font-semibold uppercase tracking-widest shrink-0">Party</span>
                              <div className="flex gap-1.5 items-center">
                                {s.partyMembers.map(m => (
                                  <div key={m.characterId} className="flex flex-col items-center gap-0.5" title={m.name}>
                                    <span className="text-sm leading-none">{classEmoji(m.characterClass)}</span>
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 text-center italic py-1">Not in a campaign</p>
                      )}
                    </div>

                    {/* HP + Situation */}
                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      {/* Self HP */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest w-6 shrink-0">HP</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              c.currentHp / c.maxHp < 0.3 ? 'bg-red-400' :
                              c.currentHp / c.maxHp < 0.6 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, (c.currentHp / c.maxHp) * 100))}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium tabular-nums shrink-0 ${c.currentHp / c.maxHp < 0.3 ? 'text-red-500' : 'text-slate-600'}`}>
                          {c.currentHp}/{c.maxHp}
                        </span>
                      </div>

                      {/* XP bar */}
                      {(() => {
                        const levelEnd = XP_THRESHOLDS[c.level] ?? null;
                        if (levelEnd === null) {
                          return <div className="flex items-center gap-2"><span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest w-6 shrink-0">XP</span><span className="text-xs text-slate-400">Max level</span></div>;
                        }
                        const levelStart = XP_THRESHOLDS[c.level - 1] ?? 0;
                        const pct = Math.min(100, Math.max(0, ((c.xp - levelStart) / (levelEnd - levelStart)) * 100));
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest w-6 shrink-0">XP</span>
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{c.xp}/{levelEnd}</span>
                          </div>
                        );
                      })()}

                      {/* Party HP */}
                      {g?.partyMembers && g.partyMembers.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {g.partyMembers.map(m => {
                            const ratio = m.character.currentHp / m.character.maxHp;
                            return (
                              <div key={m.characterId} className="flex items-center gap-1" title={`${m.character.name}: ${m.character.currentHp}/${m.character.maxHp} HP`}>
                                <span className="text-sm leading-none">{classEmoji(m.character.characterClass)}</span>
                                <div className="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${ratio < 0.3 ? 'bg-red-400' : ratio < 0.6 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                                    style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-400 tabular-nums">{m.character.currentHp}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Situation summary */}
                      {c.situationSummary && (
                        <p className="text-xs text-slate-500 italic leading-relaxed pt-0.5">
                          {c.situationSummary}
                        </p>
                      )}
                    </div>

                    {/* CTA */}
                    <button
                      onClick={() => {
                        if (s) {
                          window.location.href = s.gameState === 'lobby'
                            ? `/v2/lobby/${s.id}`
                            : `/v2/play?session=${s.id}&char=${c.id}`;
                        } else {
                          handleSelectChar(c);
                        }
                      }}
                      className={`w-full text-center text-sm font-semibold py-2 rounded-md transition-colors ${
                        inGame
                          ? 'bg-slate-900 text-white hover:bg-slate-700'
                          : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {inGame ? 'Continue Adventure →' : 'Begin Adventure'}
                    </button>
                    </div>{/* end p-4 body */}
                  </div>
                );
              })}

              <button
                onClick={() => setShowCharModal(true)}
                className="w-full p-4 border-2 border-dashed border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 flex items-center justify-center gap-3 text-slate-400 hover:text-slate-600 transition-all"
              >
                <span className="text-2xl font-light leading-none">+</span>
                <span className="text-sm font-medium">New Character</span>
              </button>
            </div>
          )}
        </div>

        {/* Delete character dialog */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 space-y-4">
              {deleteTarget.activeGame ? (
                <>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold text-slate-900">{deleteTarget.name} is mid-adventure!</h2>
                    <p className="text-sm text-slate-600">
                      This character is currently in{' '}
                      <strong>{deleteTarget.activeGame.story?.title ?? 'an active campaign'}</strong>.
                      Deleting them will permanently remove them from the party and irreversibly change the story for everyone else.
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Type <strong>{deleteTarget.name}</strong> to confirm you want to leave.
                  </p>
                  <input
                    type="text"
                    value={confirmName}
                    onChange={e => setConfirmName(e.target.value)}
                    placeholder={deleteTarget.name}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                  {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      onClick={() => { setDeleteTarget(null); setConfirmName(''); }}
                      className="w-full h-11 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Keep me in the game
                    </button>
                    <button
                      onClick={handleDeleteCharacter}
                      disabled={confirmName !== deleteTarget.name || isDeleting}
                      className="w-full h-11 text-sm font-medium rounded-xl border border-slate-300 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40 transition-colors"
                    >
                      {isDeleting ? 'Deleting…' : 'I insist on leaving'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold text-slate-900">Delete {deleteTarget.name}?</h2>
                    <p className="text-sm text-slate-500">This action cannot be undone.</p>
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
                      onClick={handleDeleteCharacter}
                      disabled={isDeleting}
                      className="flex-1 h-10 text-sm font-semibold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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
                  const returnTo = searchParams.get('returnTo');
                  if (returnTo) router.push(returnTo);
                }}
              />
              {/* CharCreationForm onCreated receives newCharId but we ignore it here */}
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
