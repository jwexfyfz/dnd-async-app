'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GachaRarity } from '@/types/v2-game';
import type { GachaItemDef } from '@/lib/v2/gacha-items';
import { getPityFlavor, isSoftPity } from '@/lib/v2/gacha-engine';

interface PullResult {
  d100: number;
  rarity: GachaRarity;
  item: GachaItemDef;
  remainingPulls: number;
}

interface GachaRevealSheetProps {
  characterId: string;
  pityCount: number;
  pendingPulls: number;
  onDismiss: (result: PullResult | null) => void;
}

type SheetState = 'idle' | 'rolling' | 'landed' | 'reveal' | 'dismissed';

const RARITY_COLORS: Record<GachaRarity, { border: string; text: string; badge: string; glow?: string }> = {
  common:    { border: 'border-slate-400',  text: 'text-slate-500',  badge: 'bg-slate-100 text-slate-600' },
  uncommon:  { border: 'border-emerald-500', text: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700' },
  rare:      { border: 'border-blue-500',   text: 'text-blue-600',   badge: 'bg-blue-50 text-blue-700' },
  legendary: { border: 'border-amber-400',  text: 'text-amber-500',  badge: 'bg-amber-50 text-amber-700', glow: 'shadow-amber-300/60 shadow-lg' },
};

const RARITY_LABELS: Record<GachaRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

const BRACKETS = [
  { range: '1 – 60', label: 'Common', rarity: 'common' as GachaRarity },
  { range: '61 – 88', label: 'Uncommon', rarity: 'uncommon' as GachaRarity },
  { range: '89 – 98', label: 'Rare', rarity: 'rare' as GachaRarity },
  { range: '99 – 100', label: 'Legendary', rarity: 'legendary' as GachaRarity },
];

export function GachaRevealSheet({ characterId, pityCount, pendingPulls, onDismiss }: GachaRevealSheetProps) {
  const [state, setState] = useState<SheetState>('idle');
  const [displayVal, setDisplayVal] = useState<number>(() => Math.ceil(Math.random() * 100));
  const [result, setResult] = useState<PullResult | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<PullResult | null>(null);
  const animStartRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const runAnimation = useCallback(() => {
    animStartRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - animStartRef.current;
      const resolved = resultRef.current;

      let interval: number;
      if (elapsed < 600) interval = 40;
      else if (elapsed < 1100) interval = 100;
      else if (elapsed < 1600) interval = 200;
      else interval = 450;

      if (elapsed >= 2000 && resolved) {
        clearTimer();
        setDisplayVal(resolved.d100);
        setResult(resolved);
        setState('landed');

        // After 600ms show reveal
        timerRef.current = setTimeout(() => {
          setState('reveal');
        }, 600);
        return;
      }

      setDisplayVal(Math.floor(Math.random() * 100) + 1);
      clearTimer();
      timerRef.current = setTimeout(tick, interval);
    };

    clearTimer();
    timerRef.current = setTimeout(tick, 40);
  }, [clearTimer]);

  const handleRoll = useCallback(async () => {
    if (isPulling || state !== 'idle') return;
    setIsPulling(true);
    setState('rolling');
    resultRef.current = null;

    runAnimation();

    try {
      const res = await fetch(`/api/v2/me/characters/${characterId}/gacha/pull`, { method: 'POST' });
      if (!res.ok) {
        clearTimer();
        setState('idle');
        setIsPulling(false);
        return;
      }
      const data = await res.json() as PullResult;
      resultRef.current = data;
    } catch {
      clearTimer();
      setState('idle');
      setIsPulling(false);
    }
  }, [isPulling, state, characterId, runAnimation, clearTimer]);

  const handleDone = useCallback(() => {
    setState('dismissed');
    onDismiss(result);
  }, [result, onDismiss]);

  const flavorText = getPityFlavor(pityCount);
  const softPity = isSoftPity(pityCount);
  const colors = result ? RARITY_COLORS[result.rarity] : null;

  const isEquipment = result?.item && !result.item.consumable && result.item.equip_slot;
  const hasCharges = result?.item?.charges != null && result.item.charges > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => state === 'idle' && onDismiss(null)}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl flex flex-col p-6 pb-8 gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Pity flavor */}
        {state !== 'reveal' && (
          <p className="text-center text-sm text-slate-500 italic">{flavorText}</p>
        )}

        {/* Die + Legend row */}
        <div className="flex items-center justify-center gap-6">
          {/* d100 die */}
          <div
            className={[
              'w-24 h-24 flex items-center justify-center rounded-2xl border-2 font-bold text-3xl transition-all duration-300',
              state === 'idle' ? 'border-slate-200 text-slate-400' : '',
              state === 'rolling' ? 'border-teal-400 text-slate-700' : '',
              state === 'landed' || state === 'reveal'
                ? `${colors?.border ?? 'border-slate-400'} ${colors?.text ?? 'text-slate-600'} ${result?.rarity === 'legendary' ? colors?.glow : ''}`
                : '',
            ].join(' ')}
          >
            {state === 'idle' ? '?' : displayVal}
          </div>

          {/* Rarity legend */}
          <div className="flex flex-col gap-1 text-xs">
            {softPity && state === 'idle' ? (
              <p className="text-amber-600 italic max-w-[160px] text-[11px]">
                Your guardian angel is shifting the odds in your favor.
              </p>
            ) : (
              BRACKETS.map(b => {
                const isLit = (state === 'landed' || state === 'reveal') && result?.rarity === b.rarity;
                const rc = RARITY_COLORS[b.rarity];
                return (
                  <div
                    key={b.rarity}
                    className={`flex gap-2 transition-all duration-300 ${isLit ? `font-bold ${rc.text}` : 'text-slate-400'}`}
                  >
                    <span className="w-14 text-right tabular-nums">{b.range}</span>
                    <span>{b.label}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Item reveal card */}
        {state === 'reveal' && result && colors && (
          <div
            className={[
              'rounded-xl border-2 p-4 flex flex-col gap-2 transition-all duration-300',
              colors.border,
              result.rarity === 'legendary' ? colors.glow : '',
            ].join(' ')}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-base">{result.item.name}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
                {RARITY_LABELS[result.rarity]}
              </span>
            </div>
            <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
              {result.item.equip_slot && <span>Slot: {result.item.equip_slot.replace('_', ' ')}</span>}
              {result.item.classRestriction && <span>· {result.item.classRestriction}</span>}
              {hasCharges && <span>· {result.item.charges} charge{result.item.charges !== 1 ? 's' : ''}</span>}
              {isEquipment && <span>· Equipment</span>}
              {result.item.consumable && <span>· Consumable</span>}
            </div>
            {result.item.description && (
              <p className="text-sm text-slate-700 italic leading-snug">"{result.item.description}"</p>
            )}
            <p className="text-xs text-slate-400">Added to your bag.</p>
          </div>
        )}

        {/* Action buttons */}
        {state === 'idle' && (
          <button
            onClick={handleRoll}
            disabled={isPulling}
            className="w-full bg-slate-900 text-white font-semibold text-base py-3.5 rounded-xl disabled:opacity-40 active:bg-slate-700 transition-colors"
          >
            Open Gift
          </button>
        )}

        {state === 'rolling' && (
          <div className="text-center text-sm text-slate-400">Rolling…</div>
        )}

        {state === 'reveal' && result && (
          <div className="flex gap-3">
            {result.remainingPulls > 0 && (
              <button
                onClick={() => {
                  setResult(null);
                  resultRef.current = null;
                  setState('idle');
                  setDisplayVal(Math.ceil(Math.random() * 100));
                  setIsPulling(false);
                }}
                className="flex-1 bg-slate-100 text-slate-800 font-semibold text-sm py-3 rounded-xl active:bg-slate-200 transition-colors"
              >
                Open Next ({result.remainingPulls} left)
              </button>
            )}
            <button
              onClick={handleDone}
              className="flex-1 bg-slate-900 text-white font-semibold text-sm py-3 rounded-xl active:bg-slate-700 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
