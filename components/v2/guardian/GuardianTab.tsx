'use client';

import { useState, useEffect } from 'react';
import type { CharacterStats, GachaPullRecord, GachaRarity } from '@/types/v2-game';
import { GachaRevealSheet } from './GachaRevealSheet';
import { getPityFlavor } from '@/lib/v2/gacha-engine';
import { MILESTONES, type MilestoneCategory } from '@/lib/v2/gacha-items';

interface GuardianTabProps {
  characterId: string;
  characterStats: CharacterStats;
  onStatsUpdated: (patch: Partial<CharacterStats>) => void;
}

const RARITY_COLORS: Record<GachaRarity, string> = {
  common: 'text-slate-500',
  uncommon: 'text-emerald-600',
  rare: 'text-blue-600',
  legendary: 'text-amber-500',
};

function StreakDots({ streakDays, lastStreakDate }: { streakDays: number; lastStreakDate: string | null }) {
  const cycleDay = ((streakDays - 1) % 7) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const activeToday = lastStreakDate === today;

  const dots = Array.from({ length: 7 }, (_, i) => {
    const dayNum = i + 1;
    const filled = dayNum < cycleDay || (dayNum === cycleDay && activeToday);
    return filled;
  });

  return (
    <div className="flex gap-2">
      {dots.map((filled, i) => (
        <div key={i} className="flex flex-col items-center gap-0.5">
          <div
            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-colors ${
              filled
                ? 'bg-indigo-500 border-indigo-500 text-white'
                : 'bg-white border-slate-200 text-slate-300'
            }`}
          >
            {i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}

function UtcClock() {
  const [time, setTime] = useState(() => {
    const d = new Date();
    return d.toUTCString().slice(17, 22); // "HH:MM"
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const d = new Date();
      setTime(d.toUTCString().slice(17, 22));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return <span className="text-slate-400 text-xs">Resets midnight UTC · Now {time} UTC</span>;
}

export function GuardianTab({ characterId, characterStats, onStatsUpdated }: GuardianTabProps) {
  const [showReveal, setShowReveal] = useState(false);
  const [showAllMilestones, setShowAllMilestones] = useState(false);

  const {
    pendingPulls = 0,
    streakDays = 0,
    streakShields = 0,
    lastStreakDate = null,
    pityCount = 0,
    milestoneFlags = [],
    pullHistory = [],
  } = characterStats;

  const cycleDay = streakDays > 0 ? ((streakDays - 1) % 7) + 1 : 0;
  const daysUntilPull = streakDays === 0 ? 7 : 7 - cycleDay;

  const earnedSet = new Set(milestoneFlags);
  const flavorText = getPityFlavor(pityCount);
  const earnedCount = MILESTONES.filter(m => earnedSet.has(m.id)).length;
  const recentGifts: GachaPullRecord[] = [...pullHistory].reverse();

  const CATEGORY_ORDER: MilestoneCategory[] = ['Combat', 'Exploration', 'Loot & Equipment', 'Social', 'Progression', 'Engagement'];
  const milestonesByCategory = CATEGORY_ORDER
    .map(category => ({ category, items: MILESTONES.filter(m => m.category === category) }))
    .filter(g => g.items.length > 0);

  function handleRevealDismiss(result: { item: { name: string }; rarity: GachaRarity; remainingPulls: number } | null) {
    setShowReveal(false);
    if (result) {
      onStatsUpdated({
        pendingPulls: result.remainingPulls,
        pullHistory: [
          ...pullHistory,
          {
            itemId: '',
            itemName: result.item.name,
            rarity: result.rarity,
            pulledAt: new Date().toISOString(),
          },
        ].slice(-5),
      });
    }
  }

  return (
    <div className="flex flex-col gap-0 overflow-y-auto h-full bg-slate-50">
      {/* Angel header */}
      <div className="bg-white border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">✦</span>
          <span className="font-semibold text-slate-800 text-sm">Your Guardian Angel</span>
        </div>
        <p className="text-sm text-slate-500 italic pl-6">{flavorText}</p>
      </div>

      {/* Pull card — always visible */}
      <div className={`border-b px-4 py-4 ${pendingPulls > 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-white border-slate-100'}`}>
        <div className={`rounded-xl border p-4 flex flex-col items-center gap-3 ${pendingPulls > 0 ? 'bg-white border-indigo-200' : 'bg-slate-50 border-slate-200'}`}>
          <p className={`text-sm font-semibold ${pendingPulls > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>
            {pendingPulls} gift{pendingPulls !== 1 ? 's' : ''} available
          </p>
          {pendingPulls > 0 ? (
            <button
              onClick={() => setShowReveal(true)}
              className="w-full bg-indigo-600 text-white font-semibold text-sm py-2.5 rounded-lg active:bg-indigo-700 transition-colors"
            >
              Open a Gift
            </button>
          ) : (
            <p className="text-xs text-slate-400 text-center">Complete milestones or a 7-day streak to earn gifts</p>
          )}
        </div>
      </div>

      {/* Streak section */}
      <div className="bg-white border-b border-slate-100 px-4 py-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Streak</p>
        <StreakDots streakDays={streakDays} lastStreakDate={lastStreakDate} />
        <div className="mt-2 flex flex-col gap-0.5">
          {streakDays > 0 ? (
            <span className="text-sm text-slate-600">
              {cycleDay} of 7
              {daysUntilPull > 0
                ? ` — ${daysUntilPull} day${daysUntilPull !== 1 ? 's' : ''} until your next gift`
                : ' — gift available!'}
            </span>
          ) : (
            <span className="text-sm text-slate-400">Play today to start your streak</span>
          )}
          <span className="text-xs text-slate-400">Every 7 days: +1 gift, +1 streak shield</span>
          <UtcClock />
        </div>
        <div className="mt-3 flex items-start gap-2">
          <span className="text-sm">🛡</span>
          <div>
            <p className="text-sm text-slate-700">
              {streakShields} shield{streakShields !== 1 ? 's' : ''} banked
            </p>
            <p className="text-xs text-slate-400">
              {streakShields > 0
                ? 'A shield automatically saves your streak if you miss a UTC day.'
                : 'Earn a shield every 7 days — it auto-applies if you miss a day.'}
            </p>
          </div>
        </div>
      </div>

      {/* Milestones section */}
      <div className="bg-white border-b border-slate-100 px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Milestones</p>
          <span className="text-xs text-slate-400">{earnedCount} / {MILESTONES.length}</span>
        </div>

        <div className="flex flex-col gap-3">
          {milestonesByCategory.map(({ category, items }) => {
            const shown = showAllMilestones ? items : items.slice(0, 2);
            const hiddenCount = items.length - shown.length;
            return (
              <div key={category}>
                <p className="text-xs text-slate-300 uppercase tracking-wider mb-1">{category}</p>
                {shown.map(m => {
                  const done = earnedSet.has(m.id);
                  return (
                    <div key={m.id} className="flex items-start gap-2 py-1">
                      <span className={`mt-0.5 flex-shrink-0 ${done ? 'text-emerald-500' : 'text-slate-300'}`}>{done ? '✓' : '○'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{m.name}</span>
                          {!done && (
                            <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">+1 gift</span>
                          )}
                        </div>
                        <span className={`text-xs ${done ? 'text-slate-300' : 'text-slate-400'}`}>{m.description}</span>
                      </div>
                    </div>
                  );
                })}
                {!showAllMilestones && hiddenCount > 0 && (
                  <p className="text-xs text-slate-300 ml-6">+{hiddenCount} more</p>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setShowAllMilestones(s => !s)}
          className="mt-2 text-xs text-indigo-500 active:text-indigo-700"
        >
          {showAllMilestones ? 'Show less' : 'See all →'}
        </button>
      </div>

      {/* Recent gifts */}
      <div className="bg-white px-4 py-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Gifts</p>
        {recentGifts.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Your first gift awaits.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {recentGifts.map((g, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{g.itemName}</span>
                <span className={`text-xs font-medium capitalize ${RARITY_COLORS[g.rarity]}`}>
                  {g.rarity}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gacha sheet */}
      {showReveal && (
        <GachaRevealSheet
          characterId={characterId}
          pityCount={pityCount}
          pendingPulls={pendingPulls}
          onDismiss={handleRevealDismiss}
        />
      )}
    </div>
  );
}
