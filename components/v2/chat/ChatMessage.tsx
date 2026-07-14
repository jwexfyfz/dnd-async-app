'use client';

import { classSprite } from '@/lib/class-emoji';
import { RollBadge, CombatRollBadge } from '@/components/v2/combat/RollBadge';
import type { RollResult, CombatRollData } from '@/components/v2/combat/RollBadge';
import { CombatBanner } from '@/components/v2/combat/CombatBanner';
import type { HistoryEntry, InitiativeRollEntry } from '@/components/v2/combat/CombatBanner';

export function ChatMessage({ entry, characterId }: { entry: HistoryEntry; characterId?: string }) {
  if (entry.isShimmer) {
    return (
      <div className="flex justify-start my-2 gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-slate-100 text-xs mt-1">
          <span>🎲</span>
        </div>
        <div className="max-w-sm px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm space-y-2 animate-pulse">
          <div className="h-2.5 bg-slate-200 rounded-full w-48" />
          <div className="h-2.5 bg-slate-200 rounded-full w-64" />
          <div className="h-2.5 bg-slate-200 rounded-full w-36" />
        </div>
      </div>
    );
  }

  if (typeof entry.text !== 'string') {
    console.error('[ChatMessage] non-string text — this will throw React error #31:', entry);
  }
  const summary = entry.mechanicalSummary;
  const type = summary?.type as string | undefined;

  if (type === 'player_action') {
    const isOwn = entry.authorCharacterId === characterId;
    const spriteClass = entry.authorCharacterClass ?? '';
    if (isOwn) {
      return (
        <div className="flex justify-end my-2 gap-2">
          <div className="max-w-xs px-4 py-2 bg-indigo-600 text-white rounded-2xl rounded-br-sm text-sm">
            {entry.text}
          </div>
          <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
            <img src={classSprite(spriteClass)} alt={spriteClass} className="w-full h-full object-cover" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-start my-2 gap-2">
        <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden mt-1">
          <img src={classSprite(spriteClass)} alt={spriteClass} className="w-full h-full object-cover" />
        </div>
        <div className="max-w-xs px-4 py-2 bg-slate-100 text-slate-800 rounded-2xl rounded-bl-sm text-sm">
          {entry.authorName && <span className="text-[10px] text-slate-400 block mb-0.5">{entry.authorName}</span>}
          {entry.text}
        </div>
      </div>
    );
  }

  if (type === 'roll_result') {
    const rolls = (summary?.rolls as RollResult[]) ?? [];
    return <RollBadge rolls={rolls} />;
  }

  if (type === 'combat_roll') {
    return <CombatRollBadge data={summary as unknown as CombatRollData} />;
  }

  if (type === 'combat_start') {
    return (
      <CombatBanner
        type="combat_start"
        round={summary?.round as number | undefined}
        initiativeRolls={summary?.initiativeRolls as InitiativeRollEntry[] | undefined}
        activeActorId={summary?.activeActorId as string | undefined}
        characterId={characterId}
      />
    );
  }

  if (type === 'combat_end') {
    return <CombatBanner type="combat_end" />;
  }

  if (type === 'combat_alert') {
    const roomName = summary?.roomName as string | undefined;
    const fighters = summary?.fightingCharacters as string[] | undefined;
    const whoText = fighters && fighters.length > 0
      ? fighters.join(', ') + (fighters.length === 1 ? ' is fighting.' : ' are fighting.')
      : 'Combat is underway.';
    return (
      <div className="my-3 rounded-lg border border-red-300 bg-red-50 overflow-hidden">
        <div className="px-4 py-2 border-b border-red-200">
          <span className="text-sm font-semibold text-red-700">⚔ Combat nearby — {roomName}</span>
        </div>
        <div className="px-4 py-2 text-sm text-red-800">{whoText}</div>
      </div>
    );
  }

  if (type === 'xp_gained') {
    const amount = summary?.amount as number | undefined;
    const source = summary?.source as string | undefined;
    return (
      <div className="flex justify-center my-1.5">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-700">
          +{amount} XP{source ? ` — ${source}` : ''}
        </span>
      </div>
    );
  }

  if (type === 'level_up') {
    const newLevel = summary?.newLevel as number | undefined;
    const oldHp = summary?.oldHp as number | undefined;
    const newHp = summary?.newHp as number | undefined;
    const newFeatures = (summary?.newFeatures as string[] | undefined) ?? [];
    const pendingChoice = summary?.pendingChoice as string | undefined;
    return (
      <div className="my-3 rounded-lg border-2 border-yellow-300 bg-yellow-50 overflow-hidden">
        <div className="px-4 py-2 border-b border-yellow-200 bg-yellow-100">
          <span className="text-sm font-bold text-yellow-800">⬆ Level {newLevel} reached!</span>
        </div>
        <div className="px-4 py-2 space-y-1">
          {oldHp !== undefined && newHp !== undefined && (
            <p className="text-xs text-yellow-800">HP {oldHp} → {newHp}</p>
          )}
          {newFeatures.length > 0 && (
            <p className="text-xs text-yellow-800">{newFeatures.join(' · ')}</p>
          )}
          {pendingChoice && (
            <p className="text-xs font-semibold text-amber-700">
              {pendingChoice === 'asi' ? 'Ability Score Improvement waiting' : 'Subclass choice waiting'}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (type === 'level_up_confirmed') {
    const newLevel = summary?.newLevel as number | undefined;
    const choiceType = summary?.choiceType as string | undefined;
    return (
      <div className="flex justify-center my-1.5">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-50 border border-yellow-300 text-xs font-semibold text-yellow-800">
          ✓ Level {newLevel} {choiceType === 'asi' ? 'ASI' : 'choice'} confirmed
        </span>
      </div>
    );
  }

  if (type === 'join_combat') {
    const d20 = summary?.d20 as number | undefined;
    const modifier = summary?.modifier as number | undefined;
    const total = summary?.total as number | undefined;
    const slot = summary?.slotPosition as number | undefined;
    const round = summary?.round as number | undefined;
    const modStr = modifier !== undefined && modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    return (
      <div className="my-3 rounded-lg border border-orange-200 bg-orange-50 overflow-hidden">
        <div className="px-4 py-2 border-b border-orange-100">
          <span className="text-sm font-semibold text-orange-700">⚔ {entry.authorName ?? 'Ally'} joins the fight — Round {round}</span>
        </div>
        <div className="px-4 py-1.5">
          <div className="flex items-center justify-between text-xs rounded px-2 py-1 bg-white border border-slate-100">
            <span className="font-medium text-indigo-700">{entry.authorName ?? 'Ally'}</span>
            <span className="flex items-center gap-1 text-slate-500 font-mono">
              <span>{d20}</span>
              {modStr && <span className="text-slate-400">{modStr}</span>}
              <span className="text-slate-300">=</span>
              <span className="font-bold text-slate-700">{total}</span>
              {slot !== undefined && <span className="ml-1 text-slate-400">(#{slot})</span>}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'mechanical_summary') {
    return (
      <div className="flex justify-start my-2 gap-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-slate-100 text-xs mt-1">
          <span>⚙</span>
        </div>
        <div className="max-w-sm px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-sm text-xs text-slate-500 font-mono leading-relaxed">
          {entry.text}
        </div>
      </div>
    );
  }

  // DM narrative — always show dice, never user avatar
  return (
    <div className="flex justify-start my-2 gap-2">
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-slate-100 text-xs mt-1">
        <span>🎲</span>
      </div>
      <div className="max-w-sm px-4 py-3 bg-white border border-slate-200 rounded-2xl rounded-bl-sm text-sm text-slate-700 leading-relaxed">
        {entry.text}
      </div>
    </div>
  );
}
