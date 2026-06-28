'use client';

import { useState } from 'react';
import type { CharacterStats, PartyMemberInfo } from '@/types/v2-game';
import { classSprite } from '@/lib/class-emoji';
import { CharacterSheet } from '@/components/v2/character/CharacterSheet';
import { XP_THRESHOLDS } from '@/lib/xp';
import type { AsiChoices } from '@/lib/v2/asi-helpers';

function partyMemberToStats(m: PartyMemberInfo): CharacterStats {
  return {
    name: m.characterName,
    currentHp: m.currentHp,
    maxHp: m.maxHp,
    ac: m.ac,
    level: m.level,
    characterClass: m.characterClass,
    attackBonus: m.attackBonus,
    initiativeMod: m.initiativeMod,
    baseStrength: m.baseStrength,
    baseDexterity: m.baseDexterity,
    baseConstitution: m.baseConstitution,
    baseIntelligence: m.baseIntelligence,
    baseWisdom: m.baseWisdom,
    baseCharisma: m.baseCharisma,
    skillsModifiers: m.skillsModifiers,
    skillProficiencies: m.skillProficiencies,
    isHiding: false,
    xp: m.xp,
    pendingChoicesQueue: [],
    subclass: null,
    critThreshold: 20,
    featuresUnlocked: [],
    resourceStates: m.resourceStates ?? [],
    canShortRest: false,
    classFeatureDetails: m.classFeatureDetails ?? [],
  };
}

export function PartyTab({ characterStats, gameState, onFeatureActivate, partyMembers, characterId, onAsiResolve, onSubclassResolve, onShortRest, onMakeCamp, canLongRest }: {
  characterStats: CharacterStats | null;
  gameState: 'exploration' | 'combat';
  onFeatureActivate: (label: string) => void;
  partyMembers: PartyMemberInfo[];
  characterId: string;
  onAsiResolve?: (choices: AsiChoices) => Promise<void>;
  onSubclassResolve?: (subclassKey: string) => Promise<void>;
  onShortRest?: () => Promise<void>;
  onMakeCamp?: () => Promise<void>;
  canLongRest?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(characterId);
  const [resting, setResting] = useState(false);

  if (!characterStats) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  const allMembers = partyMembers;
  const selectedMember = allMembers.find(m => m.characterId === selectedId);
  const shownStats = selectedId === characterId ? characterStats : (selectedMember ? partyMemberToStats(selectedMember) : characterStats);
  const isOwn = selectedId === characterId;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Party roster strip */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {allMembers.map(m => {
          const isSelf = m.characterId === characterId;
          const isSelected = m.characterId === selectedId;
          const hpPct = m.maxHp > 0 ? m.currentHp / m.maxHp : 1;
          const hasPending = isSelf && (characterStats?.pendingChoicesQueue?.length ?? 0) > 0;
          const borderCls = isSelected
            ? 'border-indigo-400'
            : hasPending ? 'border-amber-400'
            : m.isDead ? 'border-slate-300 opacity-50'
            : m.isDormant ? 'border-yellow-300'
            : 'border-slate-200';
          return (
            <button
              key={m.characterId}
              onClick={() => setSelectedId(m.characterId)}
              className="flex flex-col items-center gap-0.5 flex-shrink-0"
            >
              <div className={`w-14 h-14 rounded-full overflow-hidden border-2 ${borderCls} ${isSelf ? 'bg-slate-100' : ''} ${hasPending ? 'animate-pulse' : ''} transition-all`}>
                <img src={classSprite(m.characterClass)} alt={m.characterName} className="w-full h-full object-cover" />
              </div>
              <span className={`text-xs font-semibold leading-tight max-w-[60px] truncate ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>{m.characterName}</span>
              <span className="text-xs text-slate-500">{m.characterClass}</span>
              <span className={`text-xs ${hpPct < 0.3 ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
                {m.currentHp}/{m.maxHp} HP
              </span>
              {m.isDead && <span className="text-[10px] text-slate-400">☠ Dead</span>}
              {m.isDormant && !m.isDead && <span className="text-[10px] text-yellow-600">Away</span>}
              {!m.isInSameRoom && <span className="text-[10px] text-slate-400 truncate max-w-[60px]">{m.currentRoom}</span>}
              {/* XP bar */}
              {m.xpToNextLevel !== null ? (() => {
                const levelStart = XP_THRESHOLDS[m.level - 1] ?? 0;
                const levelEnd = XP_THRESHOLDS[m.level] ?? levelStart + 1;
                const pct = Math.min(100, Math.max(0, ((m.xp - levelStart) / (levelEnd - levelStart)) * 100));
                return (
                  <div className="w-full mt-0.5 space-y-0.5">
                    <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    {m.nextFeature && (
                      <span className="text-[9px] text-amber-600 truncate max-w-[60px] block leading-tight">
                        {m.nextFeature.name} (L{m.nextFeature.level})
                      </span>
                    )}
                  </div>
                );
              })() : (
                <span className="text-[9px] text-slate-400">Max level</span>
              )}
            </button>
          );
        })}
      </div>
      {isOwn && gameState !== 'combat' && (characterStats.canShortRest || canLongRest) && (
        <div className="flex gap-2 px-4 pt-3 flex-shrink-0">
          {characterStats.canShortRest && onShortRest && (
            <button
              disabled={resting}
              onClick={async () => { setResting(true); try { await onShortRest(); } finally { setResting(false); } }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 transition-colors"
            >
              {resting ? 'Resting…' : '💤 Short Rest'}
            </button>
          )}
          {canLongRest && onMakeCamp && (
            <button
              disabled={resting}
              onClick={async () => { setResting(true); try { await onMakeCamp(); } finally { setResting(false); } }}
              className="flex-1 py-2 text-xs font-semibold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
            >
              {resting ? 'Resting…' : '🏕 Make Camp'}
            </button>
          )}
        </div>
      )}
      <CharacterSheet
        stats={shownStats}
        isCombat={gameState === 'combat'}
        isOwn={isOwn}
        onFeatureActivate={isOwn ? onFeatureActivate : () => {}}
        onAsiResolve={isOwn ? onAsiResolve : undefined}
        onSubclassResolve={isOwn ? onSubclassResolve : undefined}
      />
    </div>
  );
}
