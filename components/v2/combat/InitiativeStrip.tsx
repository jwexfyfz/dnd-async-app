'use client';

import { useRef, useEffect } from 'react';
import type { InitiativeEntry, CharacterStats, PartyMemberInfo } from '@/types/v2-game';
import { classSprite } from '@/lib/class-emoji';

export const CLASS_FEATURES: Record<string, Array<{ id: string; label: string; description: string; bonusAction?: boolean; directFire?: boolean; cunning?: boolean; ki?: boolean }>> = {
  Barbarian: [{ id: 'rage', label: '🪓 Rage', bonusAction: true, directFire: true, description: 'Bonus action: enter rage. +2 melee damage, resistance to bludgeoning/piercing/slashing damage for 1 minute.' }],
  Bard: [{ id: 'bardic_inspiration', label: '🎵 Bardic Inspiration', bonusAction: true, description: "Bonus action: grant an ally a d6 to add to their next attack roll. Say who you're inspiring." }],
  Cleric: [{ id: 'channel_divinity', label: '⛪ Channel Divinity', bonusAction: true, directFire: true, description: 'Bonus action: channel divine power. All enemies must make a WIS save or be turned (unable to act) for the rest of combat. Once per short rest.' }],
  Fighter: [
    { id: 'second_wind', label: '💨 Second Wind', bonusAction: true, directFire: true, description: 'Bonus action: recover 1d10 + Fighter level HP. Once per short rest.' },
    { id: 'action_surge', label: '⚡ Action Surge', bonusAction: true, directFire: true, description: 'Bonus action: gain an extra main action this turn. Once per short rest.' },
  ],
  Monk: [{ id: 'ki', label: '🌀 Ki', ki: true, bonusAction: true, description: 'Spend 1 Ki point: Flurry of Blows (2 unarmed strikes), Patient Defense (Dodge), or Step of the Wind (Disengage).' }],
  Paladin: [
    { id: 'divine_smite', label: '✨ Divine Smite', bonusAction: true, directFire: true, description: 'Bonus action: channel radiant power — your next hit deals +2d8 radiant damage.' },
    { id: 'lay_on_hands', label: '🤲 Lay on Hands', bonusAction: true, directFire: true, description: 'Bonus action: heal yourself for 5 HP from your Lay on Hands pool.' },
  ],
  Ranger: [{ id: 'hunters_mark', label: "🏹 Hunter's Mark", bonusAction: true, directFire: true, description: "Bonus action: mark a creature — deal +1d6 damage on each hit against them. Concentration." }],
  Rogue: [{ id: 'cunning_action', label: '🗡️ Cunning Action', cunning: true, bonusAction: true, description: 'Bonus action to Dash, Disengage, or Hide.' }],
  Warlock: [{ id: 'hex', label: '👁️ Hex', bonusAction: true, directFire: true, description: 'Bonus action: curse a target — deal +1d6 necrotic on each hit against them. Concentration.' }],
};

export function hpRingClass(hp: number, maxHp: number): string {
  if (hp === 0 || maxHp === 0) return 'border-slate-300 bg-slate-100';
  const pct = hp / maxHp;
  if (pct > 0.6) return 'border-emerald-400 bg-emerald-50';
  if (pct > 0.3) return 'border-yellow-400 bg-yellow-50';
  return 'border-red-400 bg-red-50';
}

export function InitiativeStrip({ initiativeOrder, activeActorId, characterId, characterClass, selectedId, onSelect, partyMembers }: {
  initiativeOrder: InitiativeEntry[];
  activeActorId: string;
  characterId: string;
  characterClass: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  partyMembers: PartyMemberInfo[];
}) {
  const activeIconRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeIconRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeActorId]);

  return (
    <div
      className="flex gap-3 overflow-x-auto px-4 py-2 bg-red-700 border-b border-red-900 flex-shrink-0"
      style={{ scrollbarWidth: 'none' }}
    >
      {initiativeOrder.map(entry => {
        const isActive = entry.id === activeActorId;
        const isOwn = entry.id === characterId;
        const isDead = entry.hp === 0;
        const ringCls = hpRingClass(entry.hp, entry.maxHp);
        const isSelected = entry.id === selectedId;

        return (
          <button
            key={entry.id}
            ref={isActive ? activeIconRef : undefined}
            onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : entry.id); }}
            className={`flex flex-col items-center gap-0.5 flex-shrink-0 transition-all ${entry.acted && !isActive ? 'opacity-50 scale-[0.85]' : ''}`}
          >
            <span className={`text-xs leading-none ${isActive ? 'text-white' : 'text-transparent'}`}>▼</span>
            <div className={`w-10 h-10 rounded-full border-2 ${ringCls} relative overflow-hidden ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-red-700' : ''}`}>
              {entry.type === 'character'
                ? (() => {
                    const cls = isOwn ? characterClass : (partyMembers.find(m => m.characterId === entry.id)?.characterClass ?? '');
                    return <img src={classSprite(cls)} alt={cls} className="w-full h-full object-cover" />;
                  })()
                : <span className="w-full h-full flex items-center justify-center text-lg">👹</span>
              }
              {isDead && (
                <span className="absolute inset-0 flex items-center justify-center bg-slate-200/80 rounded-full text-base">💀</span>
              )}
            </div>
            <span className="text-xs text-red-100 truncate max-w-[48px] leading-tight">{entry.name.split(' ')[0]}</span>
            <span className="text-xs text-red-200 leading-tight">{entry.hp}/{entry.maxHp}</span>
          </button>
        );
      })}
    </div>
  );
}

export function InitiativeMiniSheet({ entry, characterStats, isOwnCharacter, isCombat, onClose, onNavigateToChat }: {
  entry: InitiativeEntry;
  characterStats: CharacterStats | null;
  isOwnCharacter: boolean;
  isCombat: boolean;
  onClose: () => void;
  onNavigateToChat: () => void;
}) {
  const features = isOwnCharacter ? (CLASS_FEATURES[characterStats?.characterClass ?? ''] ?? []) : [];

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
      {isOwnCharacter && characterStats ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{entry.name}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
          <div className="flex gap-4 text-sm text-slate-600">
            <span>
              HP{' '}
              <span className={characterStats.currentHp / characterStats.maxHp < 0.3 ? 'text-red-500 font-semibold' : ''}>
                {characterStats.currentHp}/{characterStats.maxHp}
              </span>
            </span>
            <span>AC {characterStats.ac}</span>
            <span>Atk +{characterStats.attackBonus}</span>
          </div>
          {features.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {features.map(f => (
                <button
                  key={f.id}
                  onClick={() => { if (isCombat) { onNavigateToChat(); onClose(); } }}
                  className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
                    isCombat
                      ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                      : 'border-slate-200 text-slate-400 cursor-default'
                  }`}
                >
                  {f.label} ●
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-800 text-sm">{entry.name}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
          </div>
          <div className="flex gap-4 text-sm text-slate-600">
            <span>HP {entry.hp}/{entry.maxHp}</span>
            <span>AC {entry.ac}</span>
            <span className="capitalize">Proximity: {entry.proximity}</span>
          </div>
          <div className="text-xs text-slate-400">
            {entry.status_effects.length > 0 ? `Status: ${entry.status_effects.join(', ')}` : 'Status: —'}
          </div>
        </div>
      )}
    </div>
  );
}
