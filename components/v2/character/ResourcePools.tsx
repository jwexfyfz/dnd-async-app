'use client';

import { useState } from 'react';
import type { CharacterStats } from '@/types/v2-game';
import { maxForLevel } from '@/lib/v2/level-utils';

export { maxForLevel };

export function getDisplayType(poolKey: string, max: number): 'binary' | 'pips' | 'hp-fraction' {
  if (poolKey === 'lay_on_hands') return 'hp-fraction';
  if (max === 1) return 'binary';
  return 'pips';
}

export function restLabel(resetOn: string): string {
  if (resetOn === 'SHORT_REST') return 'Short Rest';
  if (resetOn === 'LONG_REST') return 'Long Rest';
  return 'Rest';
}

export function restDescription(resetOn: string): string {
  if (resetOn === 'SHORT_REST') {
    return 'Resets on a Short Rest — take 10 minutes to catch your breath outside of combat. Use the 💤 Short Rest button in this tab.';
  }
  if (resetOn === 'LONG_REST') {
    return 'Resets on a Long Rest — sleep at camp. Use the 🏕 Make Camp button in this tab.';
  }
  return 'Resets on a rest.';
}

export function isSpent(current: number): boolean {
  return current === 0;
}

function RestBadge({ resetOn }: { resetOn: string }) {
  const isShort = resetOn === 'SHORT_REST';
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
      isShort
        ? 'bg-blue-50 text-blue-600 border-blue-200'
        : 'bg-amber-50 text-amber-600 border-amber-200'
    }`}>
      {restLabel(resetOn)}
    </span>
  );
}

function PipDisplay({ current, max }: { current: number; max: number }) {
  const pips = Math.min(max, 8);
  return (
    <span className="font-mono text-sm tracking-tight">
      {Array.from({ length: pips }, (_, i) => (
        <span key={i} className={i < current ? 'text-slate-700' : 'text-slate-300'}>
          {i < current ? '●' : '○'}
        </span>
      ))}
      {max > 8 && <span className="ml-1 text-xs text-slate-500">{current}/{max}</span>}
    </span>
  );
}

function BinaryDisplay({ current }: { current: number }) {
  const spent = isSpent(current);
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
      spent
        ? 'bg-slate-100 text-slate-400 border-slate-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
    }`}>
      {spent ? 'Spent' : 'Ready'}
    </span>
  );
}

function HpFractionDisplay({ current, max }: { current: number; max: number }) {
  return (
    <span className="text-sm font-mono text-slate-700">
      {current} / {max} HP
    </span>
  );
}

export function ResourcePools({ stats, isCombat }: { stats: CharacterStats; isCombat: boolean }) {
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const pools = stats.classFeatureDetails
    .filter(f => f.featureType === 'RESOURCE_POOL' && f.resourcePool != null)
    .map(f => {
      const rp = f.resourcePool!;
      const max = maxForLevel(rp.maxByLevel as Record<string, number>, stats.level);
      if (max === 0) return null;
      const stateRow = stats.resourceStates.find(s => s.poolKey === rp.poolKey);
      const current = stateRow?.current ?? max;
      return { f, rp, max, current };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (pools.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Resources</p>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
        {pools.map(({ f, rp, max, current }) => {
          const displayType = getDisplayType(rp.poolKey, max);
          const spent = isSpent(current);
          const isExpanded = !isCombat && expandedPool === rp.poolKey;

          const row = (
            <div
              key={rp.poolKey}
              className={`px-3 py-2.5 ${spent ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2">
                {f.icon && <span className="text-base w-5 text-center flex-shrink-0">{f.icon}</span>}
                <span className={`text-sm font-medium flex-1 min-w-0 truncate ${spent ? 'text-slate-400' : 'text-slate-700'}`}>
                  {f.name}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {displayType === 'pips' && <PipDisplay current={current} max={max} />}
                  {displayType === 'binary' && <BinaryDisplay current={current} />}
                  {displayType === 'hp-fraction' && <HpFractionDisplay current={current} max={max} />}
                  <RestBadge resetOn={rp.resetOn} />
                  {!isCombat && (
                    <span className="text-slate-400 text-xs ml-0.5">{isExpanded ? '˅' : '›'}</span>
                  )}
                </div>
              </div>
              {(isCombat || isExpanded) && (
                <div className="mt-2 ml-7 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 space-y-1">
                  <p>{f.description}</p>
                  <p className="text-slate-400 italic">{restDescription(rp.resetOn)}</p>
                </div>
              )}
            </div>
          );

          if (isCombat) return row;

          return (
            <button
              key={rp.poolKey}
              className="w-full text-left hover:bg-slate-50 transition-colors"
              onClick={() => setExpandedPool(p => p === rp.poolKey ? null : rp.poolKey)}
            >
              {row}
            </button>
          );
        })}
      </div>
    </div>
  );
}
