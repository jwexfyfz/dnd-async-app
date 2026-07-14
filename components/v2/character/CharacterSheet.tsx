'use client';

import { useState } from 'react';
import type { CharacterStats } from '@/types/v2-game';
import { CLASS_FEATURES } from '@/components/v2/combat/InitiativeStrip';
import { ABILITY_DESCRIPTIONS, ABILITY_PASSIVE_NOTES, SKILL_ABILITY, SKILL_DESCRIPTIONS } from '@/lib/v2/skill-descriptions';
import { proficiencyBonus } from '@/lib/dice';
import type { AsiChoices, StatKey } from '@/lib/v2/asi-helpers';
import { computeConHpDelta } from '@/lib/v2/asi-helpers';
import { SubclassPicker } from '@/components/v2/character/SubclassPicker';
import { ResourcePools } from '@/components/v2/character/ResourcePools';

export function abilityMod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

export const ABILITY_LABELS: { key: keyof CharacterStats; short: string; full: string }[] = [
  { key: 'baseStrength',     short: 'STR', full: 'Strength' },
  { key: 'baseDexterity',    short: 'DEX', full: 'Dexterity' },
  { key: 'baseConstitution', short: 'CON', full: 'Constitution' },
  { key: 'baseIntelligence', short: 'INT', full: 'Intelligence' },
  { key: 'baseWisdom',       short: 'WIS', full: 'Wisdom' },
  { key: 'baseCharisma',     short: 'CHA', full: 'Charisma' },
];

const COMBAT_STAT_META: Record<string, { title: string; labelColor: string; description: string }> = {
  HP:   { title: 'Hit Points',     labelColor: 'text-red-400',    description: 'Your remaining hit points. Reach 0 and you fall unconscious — allies must stabilize you before you die.' },
  AC:   { title: 'Armor Class',    labelColor: 'text-blue-500',   description: 'How hard you are to hit. An attacker must roll this number or higher on a d20 to land a strike.' },
  Atk:  { title: 'Attack Bonus',   labelColor: 'text-orange-500', description: 'Added to the d20 roll whenever you strike. Higher means you hit more reliably.' },
  Dmg:  { title: 'Weapon Damage',  labelColor: 'text-rose-500',   description: 'Damage roll for your main-hand weapon. Off-hand bonus attacks use only the weapon die (no ability modifier).' },
  Init: { title: 'Initiative',     labelColor: 'text-amber-500',  description: 'Rolled at the start of combat to determine turn order. Higher means you act earlier.' },
};

export function abilityModColor(score: number, isActive: boolean): string {
  if (isActive) return 'text-slate-800';
  const mod = Math.floor((score - 10) / 2);
  if (mod > 0) return 'text-emerald-600';
  if (mod < 0) return 'text-red-500';
  return 'text-slate-500';
}

const STAT_LABELS: { key: StatKey; short: string }[] = [
  { key: 'strength',     short: 'STR' },
  { key: 'dexterity',    short: 'DEX' },
  { key: 'constitution', short: 'CON' },
  { key: 'intelligence', short: 'INT' },
  { key: 'wisdom',       short: 'WIS' },
  { key: 'charisma',     short: 'CHA' },
];

const STAT_TO_BASE: Record<StatKey, keyof CharacterStats> = {
  strength:     'baseStrength',
  dexterity:    'baseDexterity',
  constitution: 'baseConstitution',
  intelligence: 'baseIntelligence',
  wisdom:       'baseWisdom',
  charisma:     'baseCharisma',
};

function AsiStepper({ stats, onConfirm }: {
  stats: CharacterStats;
  onConfirm: (choices: AsiChoices) => Promise<void>;
}) {
  const [alloc, setAlloc] = useState<AsiChoices>({});
  const [confirming, setConfirming] = useState(false);

  const totalSpent = STAT_LABELS.reduce((sum, s) => sum + (alloc[s.key] ?? 0), 0);
  const remaining = 2 - totalSpent;

  const adjust = (stat: StatKey, delta: number) => {
    const current = alloc[stat] ?? 0;
    const next = current + delta;
    if (next < 0 || next > 2) return;
    const base = stats[STAT_TO_BASE[stat]] as number;
    if (base + next > 20) return;
    if (delta > 0 && remaining <= 0) return;
    setAlloc(prev => ({ ...prev, [stat]: next === 0 ? undefined : next }));
  };

  const handleConfirm = async () => {
    if (totalSpent !== 2 || confirming) return;
    setConfirming(true);
    try { await onConfirm(alloc); } finally { setConfirming(false); }
  };

  const statHint = (stat: StatKey): string => {
    const delta = alloc[stat] ?? 0;
    if (stat === 'constitution') {
      const hp = computeConHpDelta(stats.baseConstitution, delta, stats.level);
      return hp > 0 ? `+${hp} max HP` : delta > 0 ? 'No HP change' : 'Max HP per level';
    }
    if (stat === 'strength') return 'Attack bonus';
    if (stat === 'dexterity') return 'AC & initiative';
    if (stat === 'intelligence' || stat === 'wisdom' || stat === 'charisma') return 'Skills & saves';
    return '';
  };

  return (
    <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-200 flex items-center justify-between">
        <span className="text-sm font-bold text-amber-900">
          Level {stats.pendingChoicesQueue[0]?.type !== 'heroic_sacrifice' ? stats.pendingChoicesQueue[0]?.level : ''} — Ability Score Improvement
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${remaining > 0 ? 'bg-amber-200 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
          {remaining > 0 ? `${remaining} pt${remaining !== 1 ? 's' : ''} left` : 'Ready'}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {STAT_LABELS.map(({ key, short }) => {
          const base = stats[STAT_TO_BASE[key]] as number;
          const delta = alloc[key] ?? 0;
          const newScore = base + delta;
          const canAdd = remaining > 0 && newScore < 20;
          const canSub = delta > 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-8 text-xs font-bold text-slate-500 uppercase">{short}</span>
              <span className="w-6 text-sm font-semibold text-slate-700 text-center tabular-nums">{base}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjust(key, -1)}
                  disabled={!canSub}
                  className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-100 font-bold text-sm"
                >−</button>
                <span className={`w-5 text-center text-sm font-bold tabular-nums ${delta > 0 ? 'text-amber-700' : 'text-transparent'}`}>
                  +{delta}
                </span>
                <button
                  onClick={() => adjust(key, 1)}
                  disabled={!canAdd}
                  className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-100 font-bold text-sm"
                >+</button>
              </div>
              {delta > 0 && (
                <span className="text-[10px] text-amber-700 ml-1">{statHint(key)}</span>
              )}
              {delta === 0 && (
                <span className="text-[10px] text-slate-400 ml-1">{statHint(key)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-3">
        <button
          onClick={handleConfirm}
          disabled={totalSpent !== 2 || confirming}
          className="w-full py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-amber-600 transition-colors"
        >
          {totalSpent !== 2
            ? `Spend all 2 points to continue`
            : confirming ? 'Confirming…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

export function CharacterSheet({ stats, isCombat, isOwn, onFeatureActivate, onAsiResolve, onSubclassResolve, bonusActionUsed }: {
  stats: CharacterStats;
  isCombat: boolean;
  isOwn: boolean;
  onFeatureActivate?: (label: string) => void;
  onAsiResolve?: (choices: AsiChoices) => Promise<void>;
  onSubclassResolve?: (subclassKey: string) => Promise<void>;
  bonusActionUsed?: boolean;
}) {
  const [featureTooltip, setFeatureTooltip] = useState<string | null>(null);
  const [activeStat, setActiveStat] = useState<string | null>(null);
  const [activeAbility, setActiveAbility] = useState('STR');
  const features = CLASS_FEATURES[stats.characterClass] ?? [];

  const ABILITY_TO_BASE: Record<string, keyof CharacterStats> = {
    STR: 'baseStrength', DEX: 'baseDexterity', CON: 'baseConstitution',
    INT: 'baseIntelligence', WIS: 'baseWisdom', CHA: 'baseCharisma',
  };
  const profBonus = proficiencyBonus(stats.level);
  const storedMods = stats.skillsModifiers as Record<string, number>;
  const activeSkills: [string, number][] = Object.entries(SKILL_ABILITY)
    .filter(([, ability]) => ability === activeAbility)
    .map(([skill]) => {
      const baseKey = ABILITY_TO_BASE[activeAbility];
      const abilMod = Math.floor(((stats[baseKey] as number) - 10) / 2);
      const isProficient = stats.skillProficiencies.includes(skill);
      const mod = skill in storedMods ? storedMods[skill] : abilMod + (isProficient ? profBonus : 0);
      return [skill, mod] as [string, number];
    })
    .sort(([a], [b]) => a.localeCompare(b));

  const atkMod = stats.attackBonus >= 0 ? `+${stats.attackBonus}` : `${stats.attackBonus}`;
  const initMod = stats.initiativeMod >= 0 ? `+${stats.initiativeMod}` : `${stats.initiativeMod}`;
  const hpPct = stats.maxHp > 0 ? stats.currentHp / stats.maxHp : 1;
  const hpValueColor = hpPct > 0.6 ? 'text-emerald-600' : hpPct > 0.3 ? 'text-yellow-600' : 'text-red-600';
  const combatStats = [
    { key: 'HP',   label: 'HP',   value: `${stats.currentHp}/${stats.maxHp}`, valueColor: hpValueColor },
    { key: 'AC',   label: 'AC',   value: String(stats.ac),                     valueColor: 'text-slate-800' },
    { key: 'Atk',  label: 'Atk',  value: atkMod,                               valueColor: 'text-slate-800' },
    { key: 'Dmg',  label: 'Dmg',  value: stats.weaponDamage?.main ?? '—',      valueColor: 'text-slate-800' },
    { key: 'Init', label: 'Init', value: initMod,                              valueColor: 'text-slate-800' },
  ];

  const showAsiStepper = isOwn
    && onAsiResolve
    && stats.pendingChoicesQueue.length > 0
    && stats.pendingChoicesQueue[0].type === 'asi';

  const showSubclassPicker = isOwn
    && onSubclassResolve
    && stats.pendingChoicesQueue.length > 0
    && stats.pendingChoicesQueue[0].type === 'subclass';

  if (showSubclassPicker && onSubclassResolve) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-4">
        <SubclassPicker stats={stats} onConfirm={onSubclassResolve} />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 px-4 py-4 space-y-5">
      {showAsiStepper && onAsiResolve && (
        <AsiStepper stats={stats} onConfirm={onAsiResolve} />
      )}

      {/* Combat stats */}

      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Combat</p>
        <div className="grid grid-cols-5 gap-2">
          {combatStats.map(s => {
            const meta = COMBAT_STAT_META[s.key];
            const isActive = activeStat === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setActiveStat(a => a === s.key ? null : s.key)}
                className={`bg-white rounded-lg px-1.5 py-2.5 text-center border transition-all active:scale-[0.97] ${
                  isActive ? 'border-slate-300 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div className={`text-xs font-semibold leading-none mb-1.5 ${meta.labelColor}`}>{s.label}</div>
                <div className={`font-bold tracking-tight leading-tight ${s.value.length >= 4 ? 'text-sm' : 'text-2xl'} ${s.valueColor}`}>{s.value}</div>
              </button>
            );
          })}
        </div>
        {activeStat && COMBAT_STAT_META[activeStat] && (() => {
          const dexMod = Math.floor((stats.baseDexterity - 10) / 2);
          const strMod = Math.floor((stats.baseStrength - 10) / 2);
          const profBonus = stats.level >= 5 ? 3 : 2;
          const fmt = (n: number) => n >= 0 ? `+${n}` : `${n}`;

          let rows: { label: string; value: string }[] = [];
          if (activeStat === 'HP') {
            rows = [
              { label: 'Current', value: `${stats.currentHp}` },
              { label: 'Maximum', value: `${stats.maxHp}` },
            ];
          } else if (activeStat === 'AC') {
            const baseAC = 10 + dexMod;
            const gearAC = stats.ac - baseAC;
            rows = [
              { label: `Base (10 + DEX ${fmt(dexMod)})`, value: `${baseAC}` },
              ...(gearAC !== 0 ? [{ label: 'Gear bonus', value: fmt(gearAC) }] : []),
              { label: 'Total', value: `${stats.ac}` },
            ];
          } else if (activeStat === 'Atk') {
            rows = [
              { label: `STR modifier`, value: fmt(strMod) },
              { label: `Proficiency (lvl ${stats.level})`, value: `+${profBonus}` },
              { label: 'Total', value: fmt(stats.attackBonus) },
            ];
          } else if (activeStat === 'Dmg') {
            if (!stats.weaponDamage?.main) {
              rows = [{ label: 'No weapon equipped', value: '—' }];
            } else {
              rows = [{ label: 'Main hand', value: stats.weaponDamage.main }];
              if (stats.weaponDamage.off) {
                rows.push({ label: 'Off hand (bonus action)', value: stats.weaponDamage.off });
              }
            }
          } else if (activeStat === 'Init') {
            rows = [
              { label: 'DEX modifier', value: fmt(dexMod) },
            ];
          }

          const meta = COMBAT_STAT_META[activeStat];
          return (
            <div className="mt-2 bg-slate-50 rounded-lg px-3 py-2.5 space-y-2">
              <div>
                <p className={`text-xs font-bold ${meta.labelColor}`}>{meta.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
              </div>
              {rows.length > 0 && (
                <div className="border-t border-slate-200 pt-2 space-y-1">
                  {rows.map(r => (
                    <div key={r.label} className="flex justify-between text-xs">
                      <span className="text-slate-500">{r.label}</span>
                      <span className="font-mono font-medium text-slate-700">{r.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Resource pools */}
      <ResourcePools stats={stats} isCombat={isCombat} />

      {/* Class features */}
      {features.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Features</p>
          {isCombat ? (
            <div className="flex flex-col gap-2">
              {features.map(f => {
                const isBASpent = isOwn && f.bonusAction && bonusActionUsed;
                return (
                  <div key={f.id} className="flex flex-col gap-0.5">
                    <button
                      onClick={() => { if (isOwn && !isBASpent && onFeatureActivate) onFeatureActivate(f.label); }}
                      disabled={!!isBASpent}
                      className={`self-start text-xs px-3 py-1.5 rounded-full border font-medium transition-colors flex items-center gap-1.5 ${
                        isBASpent
                          ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                          : isOwn
                            ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                            : 'border-slate-200 text-slate-300 cursor-default'
                      }`}
                    >
                      {f.label}
                      {f.bonusAction && (
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded leading-none ${isBASpent ? 'bg-slate-100 text-slate-300' : 'bg-indigo-100 text-indigo-500'}`}>BA</span>
                      )}
                    </button>
                    <p className="text-xs text-slate-500 pl-1">{f.description}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {features.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { if (!isOwn) return; setFeatureTooltip(t => t === f.id ? null : f.id); }}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors flex items-center gap-1.5 ${
                      isOwn
                        ? 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        : 'border-slate-200 text-slate-300 cursor-default'
                    }`}
                  >
                    {f.label}
                    {f.bonusAction && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded leading-none bg-emerald-100 text-emerald-500">BA</span>
                    )}
                  </button>
                ))}
              </div>
              {featureTooltip && (() => {
                const f = features.find(x => x.id === featureTooltip);
                return f ? (
                  <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    {f.description}
                  </p>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}

      {/* Abilities + Skills folder */}
      <div>
        {/* Section header */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Abilities</p>
          <p className="text-xs font-medium text-amber-600">★ = proficient</p>
        </div>

        {/* Tab row */}
        <div className="grid grid-cols-6 border-b border-slate-200">
          {ABILITY_LABELS.map(({ key, short }) => {
            const score = stats[key] as number;
            const isActive = activeAbility === short;
            return (
              <button
                key={short}
                onClick={() => setActiveAbility(short)}
                className={`py-2 text-center transition-colors relative ${
                  isActive
                    ? 'bg-white border-x border-t border-slate-200 rounded-t-lg -mb-px z-10'
                    : 'hover:bg-slate-100'
                }`}
              >
                <div className={`text-xs font-semibold leading-none mb-1 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {short}
                </div>
                <div className={`text-base font-bold leading-none mb-0.5 ${abilityModColor(score, isActive)}`}>
                  {abilityMod(score)}
                </div>
                <div className={`text-xs leading-none ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                  {score}
                </div>
              </button>
            );
          })}
        </div>

        {/* Skill panel */}
        <div className="border-x border-b border-slate-200 rounded-b-lg bg-white px-3 py-3">
          <p className="text-sm font-semibold text-slate-700 mb-1">
            {ABILITY_LABELS.find(l => l.short === activeAbility)?.full}
          </p>
          <p className="text-xs text-slate-500">
            {ABILITY_DESCRIPTIONS[activeAbility]}
          </p>
          {activeSkills.length > 0 && <div className="border-t border-slate-100 my-3" />}
          {activeSkills.length > 0 ? (
            <div className="space-y-2.5">
              {activeSkills.map(([skill, mod]) => {
                const prof = stats.skillProficiencies.includes(skill);
                const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
                return (
                  <div key={skill}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${prof ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>
                        {prof && <span className="text-amber-500">★ </span>}
                        {skill}
                      </span>
                      <span className={`text-xs font-mono ${prof ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                        {modStr}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {SKILL_DESCRIPTIONS[skill]}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              {ABILITY_PASSIVE_NOTES[activeAbility] ?? 'No skills for this ability.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
