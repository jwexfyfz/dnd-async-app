'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface DamageRollSheetProps {
  rolls: number[];
  dieFaces: number;
  totalDamage: number;
  isCrit: boolean;
  targetDefeated?: boolean;
  targetName?: string | null;
  onDismiss: () => void;
}

type SheetState = 'idle' | 'rolling' | 'landed';

export function DamageRollSheet({ rolls, dieFaces, totalDamage, isCrit, targetDefeated, targetName, onDismiss }: DamageRollSheetProps) {
  const [state, setState] = useState<SheetState>('idle');
  const [landedValues, setLandedValues] = useState<(number | null)[]>(rolls.map(() => null));
  const [rollingDieIdx, setRollingDieIdx] = useState(0);
  const [activeDisplay, setActiveDisplay] = useState(() => Math.ceil(Math.random() * dieFaces));
  const [showOutcome, setShowOutcome] = useState(false);

  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animStartRef = useRef<number>(0);
  const rollStartRef = useRef<number>(0);
  const startDieRef = useRef<(dieIdx: number) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const startDieAnimation = useCallback((dieIdx: number) => {
    animStartRef.current = Date.now();
    setRollingDieIdx(dieIdx);
    setActiveDisplay(Math.ceil(Math.random() * dieFaces));

    const minDuration = 1400 + dieIdx * 300;

    const tick = () => {
      const elapsed = Date.now() - animStartRef.current;
      let interval: number;
      if (elapsed < 500) interval = 40;
      else if (elapsed < 900) interval = 100;
      else if (elapsed < 1200) interval = 220;
      else interval = 400;

      if (elapsed >= minDuration) {
        clearTimer();
        const landedValue = rolls[dieIdx];
        setActiveDisplay(landedValue);
        setLandedValues(prev => {
          const next = [...prev];
          next[dieIdx] = landedValue;
          return next;
        });
        if (dieIdx + 1 < rolls.length) {
          animTimerRef.current = setTimeout(() => startDieRef.current(dieIdx + 1), 300);
        } else {
          setState('landed');
        }
        return;
      }

      setActiveDisplay(Math.ceil(Math.random() * dieFaces));
      clearTimer();
      animTimerRef.current = setTimeout(tick, interval);
    };

    clearTimer();
    animTimerRef.current = setTimeout(tick, 40);
  }, [clearTimer, dieFaces, rolls]);

  useEffect(() => {
    startDieRef.current = startDieAnimation;
  }, [startDieAnimation]);

  useEffect(() => {
    if (state !== 'landed') return;
    // Show outcome at least 1000ms after landing AND at least 4000ms from when user clicked roll
    const elapsed = Date.now() - rollStartRef.current;
    const delay = Math.max(1000, 4000 - elapsed);
    const t = setTimeout(() => setShowOutcome(true), delay);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!showOutcome) return;
    const delay = targetDefeated ? 3500 : isCrit ? 3000 : 2500;
    const t = setTimeout(() => onDismiss(), delay);
    return () => clearTimeout(t);
  }, [showOutcome, targetDefeated, isCrit, onDismiss]);

  const handleRoll = () => {
    if (state !== 'idle') return;
    rollStartRef.current = Date.now();
    setState('rolling');
    startDieAnimation(0);
  };

  const dieCount = rolls.length;
  const dieSize = dieCount === 1 ? 'w-24 h-24 text-4xl' : dieCount === 2 ? 'w-20 h-20 text-3xl' : 'w-16 h-16 text-2xl';

  const renderDie = (i: number) => {
    const isSpinning = state === 'rolling' && i === rollingDieIdx;
    const isLanded = landedValues[i] !== null;
    const isWaiting = !isSpinning && !isLanded;
    const displayVal = isSpinning ? activeDisplay : (isLanded ? landedValues[i] : '');

    return (
      <div
        key={i}
        className={[
          dieSize,
          'flex items-center justify-center bg-white font-bold rounded-2xl border-2 transition-all duration-200',
          isWaiting ? 'border-slate-200 text-slate-300' : '',
          isSpinning ? 'border-orange-400 text-slate-700' : '',
          isLanded ? 'border-orange-500 text-orange-600 scale-110' : '',
        ].join(' ')}
      >
        {displayVal}
      </div>
    );
  };

  const diceLabel = `${dieCount}d${dieFaces}${isCrit ? ' — CRIT' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="bg-white rounded-t-2xl shadow-2xl flex flex-col gap-4 p-6 pb-8">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800">Roll Damage</span>
          {state === 'idle' && (
            <button onClick={onDismiss} className="text-slate-400 text-xl leading-none">×</button>
          )}
        </div>

        <div className="text-xs text-slate-500 text-center">{diceLabel}</div>

        {state === 'idle' ? (
          <button
            onClick={handleRoll}
            className="w-full bg-orange-600 text-white font-semibold text-base py-3.5 rounded-xl active:bg-orange-700 transition-colors"
          >
            ROLL DAMAGE
          </button>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center justify-center gap-3">
              {rolls.map((_, i) => renderDie(i))}
            </div>
            {showOutcome && (
              <>
                <span className="text-sm font-bold text-orange-600">
                  {totalDamage} damage{isCrit ? ' — CRITICAL!' : ''}
                </span>
                {targetDefeated && (
                  <span className="text-xs font-semibold text-amber-600">
                    DEFEATED{targetName ? ` — ${targetName} falls` : ''}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
