'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface TargetOption {
  id: string;
  name: string;
  ac: number;
  hp: number;
  maxHp: number;
  proximity: 'close' | 'far';
}

export interface RollSheetResult {
  d20: number;        // the kept result
  allRolls?: number[]; // all dice (for advantage/elven accuracy display)
  success: boolean;
  isCrit: boolean;
  damageDealt?: number;
  targetDefeated?: boolean;
  hasDamageRoll?: boolean; // damage roll UI will follow — suppress damage display and shorten dismiss
  modifier?: number;  // skill/attack modifier applied to d20
  dc?: number;        // numeric DC or contest value being compared against
  vsTarget?: string;  // full label string (e.g. "Perception 14", "DC 12", "Contest 14")
}

interface CombatRollSheetProps {
  actionHint: 'attack' | 'hide' | 'provoke' | 'shove';
  attackBonus: number;
  validTargets: TargetOption[];
  isSending: boolean;
  onRoll: (flavorText: string, targetId: string | null) => Promise<RollSheetResult>;
  onDismiss: () => void;
  immediateResult?: RollSheetResult;
  diceCount?: 1 | 2 | 3;
}

type SheetState = 'idle' | 'rolling' | 'landed' | 'dismissed';

function HpDots({ hp, maxHp }: { hp: number; maxHp: number }) {
  const filled = maxHp > 0 ? Math.round((hp / maxHp) * 5) : 0;
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < filled ? 'bg-emerald-500' : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

export function CombatRollSheet({ actionHint, attackBonus, validTargets, isSending, onRoll, onDismiss, immediateResult, diceCount = 1 }: CombatRollSheetProps) {
  const [state, setState] = useState<SheetState>(immediateResult ? 'rolling' : 'idle');
  const [selectedIdx, setSelectedIdx] = useState<number>(() => {
    const closeIdx = validTargets.findIndex(t => t.proximity === 'close');
    return closeIdx >= 0 ? closeIdx : 0;
  });
  const [flavorText, setFlavorText] = useState('');

  // activeDiceCount: total dice to show. Starts from prop, expands when server
  // returns allRolls with more dice than we expected (e.g. diceCount=1 but server
  // returns advantage rolls). This makes the blank box appear mid-animation.
  const [activeDiceCount, setActiveDiceCount] = useState<number>(() =>
    immediateResult?.allRolls?.length ?? diceCount
  );
  const [rollingDieIdx, setRollingDieIdx] = useState(0);
  const [landedValues, setLandedValues] = useState<(number | null)[]>(() =>
    Array(immediateResult?.allRolls?.length ?? diceCount).fill(null)
  );
  const [activeDisplay, setActiveDisplay] = useState<number>(() => Math.ceil(Math.random() * 20));
  const [result, setResult] = useState<RollSheetResult | null>(null);
  // Outcome label shown after a brief delay so the highlight animation settles first
  const [showOutcome, setShowOutcome] = useState(false);

  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollResultRef = useRef<RollSheetResult | null>(null);
  const animStartRef = useRef<number>(0);
  const startDieRef = useRef<(dieIdx: number, minDuration: number) => void>(() => {});

  const selectedTarget = validTargets[selectedIdx] ?? null;

  const clearTimer = useCallback(() => {
    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const startDieAnimation = useCallback((dieIdx: number, minDuration: number) => {
    animStartRef.current = Date.now();
    setRollingDieIdx(dieIdx);
    setActiveDisplay(Math.ceil(Math.random() * 20));

    const tick = () => {
      const elapsed = Date.now() - animStartRef.current;
      const resolved = rollResultRef.current;
      const rolls = resolved?.allRolls ?? (resolved ? [resolved.d20] : null);

      let interval: number;
      if (elapsed < 600) interval = 40;
      else if (elapsed < 1100) interval = 100;
      else if (elapsed < 1600) interval = 220;
      else interval = 450;

      if (elapsed >= minDuration && rolls) {
        clearTimer();
        const landedValue = rolls[dieIdx] ?? resolved!.d20;

        // Set activeDisplay to the final value in the same batch as landedValues,
        // so the number shown in the spin IS the landed value — no visual jump.
        setActiveDisplay(landedValue);
        setLandedValues(prev => {
          const next = [...prev];
          while (next.length <= dieIdx) next.push(null);
          next[dieIdx] = landedValue;
          return next;
        });

        if (dieIdx + 1 < rolls.length) {
          animTimerRef.current = setTimeout(() => startDieRef.current(dieIdx + 1, 1200), 350);
        } else {
          setResult(resolved!);
          setState('landed');
        }
        return;
      }

      setActiveDisplay(Math.ceil(Math.random() * 20));
      clearTimer();
      animTimerRef.current = setTimeout(tick, interval);
    };

    clearTimer();
    animTimerRef.current = setTimeout(tick, 40);
  }, [clearTimer]);

  useEffect(() => {
    startDieRef.current = startDieAnimation;
  }, [startDieAnimation]);

  // Post-roll mode
  useEffect(() => {
    if (!immediateResult) return;
    rollResultRef.current = immediateResult;
    startDieAnimation(0, 2100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show outcome label after landing (lets the highlight animation finish first)
  useEffect(() => {
    if (state !== 'landed' || !result) return;
    const t = setTimeout(() => setShowOutcome(true), 150);
    return () => clearTimeout(t);
  }, [state, result]);

  // Auto-dismiss once outcome is visible
  useEffect(() => {
    if (!showOutcome || !result) return;
    const delay = result.hasDamageRoll ? 1200 : result.isCrit ? 3000 : result.targetDefeated ? 2500 : 1800;
    const t = setTimeout(() => {
      setState('dismissed');
      onDismiss();
    }, delay);
    return () => clearTimeout(t);
  }, [showOutcome, result, onDismiss]);

  const handleRoll = useCallback(async () => {
    if (isSending || state !== 'idle') return;
    setState('rolling');
    rollResultRef.current = null;
    setRollingDieIdx(0);
    setActiveDiceCount(diceCount);
    setLandedValues(Array(diceCount).fill(null));
    setShowOutcome(false);
    startDieAnimation(0, 2100);

    const targetId = actionHint === 'hide' ? null : (selectedTarget?.id ?? null);
    try {
      const res = await onRoll(flavorText, targetId);
      rollResultRef.current = res;
      // If server returns more dice than the prop said (e.g. advantage was
      // detected server-side but diceCount prop was 1), expand the box count
      // now so the blank box appears while die 0 is still spinning.
      const serverDiceCount = res.allRolls?.length ?? 1;
      if (serverDiceCount > diceCount) {
        setActiveDiceCount(serverDiceCount);
        setLandedValues(prev => {
          const next = [...prev];
          while (next.length < serverDiceCount) next.push(null);
          return next;
        });
      }
    } catch {
      clearTimer();
      setState('idle');
    }
  }, [isSending, state, startDieAnimation, actionHint, selectedTarget, onRoll, flavorText, clearTimer, diceCount]);

  const outcomeBorder = result
    ? result.isCrit ? 'border-amber-400'
    : result.success ? 'border-emerald-500'
    : result.d20 === 1 ? 'border-red-700'
    : 'border-red-400'
    : 'border-teal-400';

  const outcomeNumColor = result
    ? result.isCrit ? 'text-amber-500'
    : result.success ? 'text-emerald-600'
    : result.d20 === 1 ? 'text-red-700'
    : 'text-red-500'
    : 'text-slate-700';

  const outcomeLabel = result
    ? result.isCrit ? 'CRITICAL HIT!'
    : result.success ? 'HIT!'
    : result.d20 === 1 ? 'FUMBLE!'
    : 'MISS!'
    : '';

  const modifierLine = () => {
    if (actionHint === 'hide') return 'Stealth Check · vs. highest enemy Perception';
    if (actionHint === 'provoke') return 'Intimidation · DC 12';
    if (!selectedTarget) return `+${attackBonus}`;
    return `+${attackBonus} · vs. ${selectedTarget.name} · AC ${selectedTarget.ac}`;
  };

  const actionLabel = {
    attack: 'Attack',
    shove: 'Shove',
    hide: 'Hide',
    provoke: 'Provoke',
  }[actionHint];

  const allRolls = result?.allRolls ?? (result ? [result.d20] : null);
  const winnerIdx = allRolls ? allRolls.indexOf(Math.max(...allRolls)) : 0;
  // While rolling: show activeDiceCount boxes (expands when server returns multi-roll)
  // After landed: use allRolls length as ground truth
  const totalDice = state === 'landed' ? (allRolls?.length ?? activeDiceCount) : activeDiceCount;
  const dieSize = totalDice === 1 ? 'w-24 h-24 text-4xl' : totalDice === 2 ? 'w-20 h-20 text-3xl' : 'w-16 h-16 text-2xl';

  const renderDie = (i: number) => {
    const isSpinning = state === 'rolling' && i === rollingDieIdx;
    const isLanded = landedValues[i] !== null;
    const isWaiting = !isSpinning && !isLanded;
    const isWinner = state === 'landed' && i === winnerIdx;
    const isLoser = state === 'landed' && totalDice > 1 && i !== winnerIdx;

    const displayVal = isSpinning ? activeDisplay : (isLanded ? landedValues[i] : '');

    return (
      <div
        key={i}
        className={[
          dieSize,
          'flex items-center justify-center bg-white font-bold rounded-2xl border-2',
          isWaiting ? 'border-slate-200 text-slate-300' : '',
          isSpinning ? 'border-teal-400 text-slate-700' : '',
          isLanded && !isWinner && !isLoser ? 'border-slate-300 text-slate-600' : '',
          isLoser ? 'opacity-25 border-slate-200 text-slate-400' : '',
          isWinner ? `${outcomeBorder} ${outcomeNumColor} ${result?.isCrit ? 'scale-125' : 'scale-110'}` : '',
        ].join(' ')}
        style={{ transition: 'transform 200ms ease-out, border-color 300ms ease, color 300ms ease, opacity 300ms ease' }}
      >
        {displayVal}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => { if (state === 'idle') { onDismiss(); } }}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl flex flex-col gap-4 p-6 pb-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800">{actionLabel}</span>
          {state === 'idle' && (
            <button onClick={onDismiss} className="text-slate-400 text-xl leading-none">×</button>
          )}
        </div>

        {/* Target picker */}
        {actionHint !== 'hide' && validTargets.length > 1 && state === 'idle' && (
          <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {validTargets.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setSelectedIdx(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs flex-shrink-0 transition-colors ${
                  i === selectedIdx
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'border-slate-300 text-slate-600 bg-white'
                }`}
              >
                <span className="font-medium">{t.name}</span>
                <HpDots hp={t.hp} maxHp={t.maxHp} />
                <span className={`text-[10px] ${i === selectedIdx ? 'text-slate-300' : 'text-slate-400'}`}>
                  {t.proximity === 'close' ? 'Close' : 'Far'}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Dice area */}
        {state === 'rolling' || state === 'landed' ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center justify-center gap-3">
              {Array.from({ length: totalDice }, (_, i) => renderDie(i))}
            </div>
            {showOutcome && result && (
              <>
                {actionHint === 'attack' && (
                  <p className="text-xs font-mono text-slate-400 text-center leading-none">
                    <span className={outcomeNumColor}>{result.d20}</span>
                    {attackBonus > 0 && <span>{` + ${attackBonus} = `}<span className={outcomeNumColor}>{result.d20 + attackBonus}</span></span>}
                    {attackBonus < 0 && <span>{` − ${Math.abs(attackBonus)} = `}<span className={outcomeNumColor}>{result.d20 + attackBonus}</span></span>}
                    {selectedTarget && <span>{` · AC ${selectedTarget.ac}`}</span>}
                  </p>
                )}
                {(actionHint === 'hide' || actionHint === 'provoke' || actionHint === 'shove') && result.vsTarget && (
                  <p className="text-xs font-mono text-slate-400 text-center leading-none">
                    <span className={outcomeNumColor}>{result.d20}</span>
                    {result.modifier !== undefined && result.modifier > 0 && <span>{` + ${result.modifier} = `}<span className={outcomeNumColor}>{result.d20 + result.modifier}</span></span>}
                    {result.modifier !== undefined && result.modifier < 0 && <span>{` − ${Math.abs(result.modifier)} = `}<span className={outcomeNumColor}>{result.d20 + result.modifier}</span></span>}
                    <span>{` · ${result.vsTarget}`}</span>
                  </p>
                )}
                <span className={`text-sm font-bold ${result.isCrit ? 'text-amber-600' : result.success ? 'text-emerald-600' : 'text-red-500'}`}>
                  {outcomeLabel}
                </span>
                {!result.hasDamageRoll && result.success && result.damageDealt !== undefined && !result.targetDefeated && (
                  <span className="text-xs text-slate-600">{result.damageDealt} damage</span>
                )}
                {!result.hasDamageRoll && result.targetDefeated && (
                  <span className="text-xs font-semibold text-amber-600">
                    DEFEATED{selectedTarget ? ` — ${selectedTarget.name} falls` : ''}
                  </span>
                )}
                {result.hasDamageRoll && result.success && (
                  <span className="text-xs text-slate-400">Roll for damage →</span>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <input
              type="text"
              maxLength={100}
              value={flavorText}
              onChange={e => setFlavorText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRoll(); }}
              placeholder={`How do you ${actionHint}? (optional)`}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
            {flavorText.length > 60 && (
              <span className="text-xs text-slate-400 -mt-2 text-right">{flavorText.length}/100</span>
            )}
            <div className="text-xs text-slate-500 text-center">{modifierLine()}</div>
            <button
              onClick={handleRoll}
              disabled={isSending}
              className="w-full bg-slate-900 text-white font-semibold text-base py-3.5 rounded-xl disabled:opacity-40 active:bg-slate-700 transition-colors"
            >
              {isSending ? 'Waiting…' : 'ROLL'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
