'use client';

import { useState, useEffect } from 'react';
import type { CharacterStats } from '@/types/v2-game';
import { CLASS_DEFINITIONS } from '@/lib/v2/class-definitions';

interface SubclassLevelUnlock { level: number; features: string[]; }
interface SubclassData {
  id: string;
  key: string;
  name: string;
  blurb: string;
  playstyleTag: string;
  keyStat: string;
  available: boolean;
  levelUnlocks: SubclassLevelUnlock[];
}

const GAP = 12;
const PEEK = 40;

export function SubclassPicker({ stats, onConfirm }: {
  stats: CharacterStats;
  onConfirm: (subclassKey: string) => Promise<void>;
}) {
  const [subclasses, setSubclasses] = useState<SubclassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cardWidth, setCardWidth] = useState(310);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const pending = stats.pendingChoicesQueue[0];
  const subclassTerm = CLASS_DEFINITIONS[stats.characterClass]?.subclassTerm ?? 'Subclass';

  useEffect(() => {
    const measure = () => setCardWidth(window.innerWidth - PEEK * 2);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showConfirm) return;
      if (e.key === 'ArrowLeft') setActiveIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setActiveIdx(i => Math.min(subclasses.length - 1, i + 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [subclasses.length, showConfirm]);

  useEffect(() => {
    fetch(`/api/v2/subclasses?class=${encodeURIComponent(stats.characterClass)}`)
      .then(r => r.json())
      .then(({ subclasses: subs }) => { setSubclasses(subs ?? []); setLoading(false); });
  }, [stats.characterClass]);

  const translateX = PEEK - activeIdx * (cardWidth + GAP) + dragOffset;
  const activeSub = subclasses[activeIdx];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-amber-700">Loading subclasses…</p>
      </div>
    );
  }

  if (showConfirm && activeSub) {
    return (
      <div className="flex-1 flex flex-col rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
        <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-200 flex-shrink-0">
          <span className="text-sm font-bold text-amber-900">
            Level {pending?.type !== 'heroic_sacrifice' ? pending?.level : ''} — {activeSub.name}
          </span>
        </div>
        <div className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          <p className="text-sm font-semibold text-slate-800">{activeSub.name}</p>
          <p className="text-xs text-slate-600 leading-relaxed">{activeSub.blurb}</p>
          <p className="text-xs font-semibold text-amber-700 mt-2">This choice is permanent.</p>
          {activeSub.levelUnlocks.length > 0 && (
            <div className="border-t border-amber-200 pt-3 space-y-2">
              {activeSub.levelUnlocks.map(({ level, features }) => (
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
        <div className="px-4 py-3 flex gap-2 flex-shrink-0 border-t border-amber-200">
          <button
            onClick={() => setShowConfirm(false)}
            className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={async () => {
              if (confirming) return;
              setConfirming(true);
              try { await onConfirm(activeSub.key); } finally { setConfirming(false); }
            }}
            disabled={confirming}
            className="flex-1 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-amber-600 transition-colors"
          >
            {confirming ? 'Confirming…' : `Confirm — ${activeSub.name}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-200 flex-shrink-0">
        <span className="text-sm font-bold text-amber-900">
          Level {pending?.type !== 'heroic_sacrifice' ? pending?.level : ''} — Choose your {subclassTerm}
        </span>
      </div>

      <div className="flex-1 relative overflow-hidden pt-3 pb-1">
        {subclasses.length > 1 && activeIdx > 0 && (
          <button
            onClick={() => setActiveIdx(i => i - 1)}
            className="hidden md:flex absolute left-0 top-0 bottom-0 z-10 w-10 items-center justify-center text-slate-400 hover:text-slate-700 transition-colors text-2xl"
            aria-label="Previous subclass"
          >‹</button>
        )}
        {subclasses.length > 1 && activeIdx < subclasses.length - 1 && (
          <button
            onClick={() => setActiveIdx(i => i + 1)}
            className="hidden md:flex absolute right-0 top-0 bottom-0 z-10 w-10 items-center justify-center text-slate-400 hover:text-slate-700 transition-colors text-2xl"
            aria-label="Next subclass"
          >›</button>
        )}
        <div
          style={{
            display: 'flex',
            gap: GAP,
            transform: `translateX(${translateX}px)`,
            transition: dragStartX !== null ? 'none' : 'transform 280ms ease',
            willChange: 'transform',
            userSelect: 'none',
          }}
          onTouchStart={e => {
            setDragStartX(e.touches[0].clientX);
            setDragStartY(e.touches[0].clientY);
            setDragOffset(0);
          }}
          onTouchMove={e => {
            if (dragStartX === null || dragStartY === null) return;
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - (dragStartY ?? 0);
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dragOffset) < 5) {
              setDragStartX(null);
              return;
            }
            setDragOffset(Math.max(-(cardWidth + GAP), Math.min(cardWidth + GAP, dx)));
          }}
          onTouchEnd={() => {
            if (dragStartX !== null) {
              if (dragOffset < -40) setActiveIdx(i => Math.min(i + 1, subclasses.length - 1));
              else if (dragOffset > 40) setActiveIdx(i => Math.max(i - 1, 0));
            }
            setDragStartX(null);
            setDragStartY(null);
            setDragOffset(0);
          }}
        >
          {subclasses.map((sub, i) => (
            <div
              key={sub.key}
              style={{ width: cardWidth, maxWidth: cardWidth, flexShrink: 0, maxHeight: 380, overflowY: 'auto' }}
              className={`rounded-xl border-2 p-4 bg-white transition-colors ${
                !sub.available ? 'border-slate-200 opacity-60' : activeIdx === i ? 'border-amber-400 shadow-md' : 'border-slate-200'
              }`}
            >
              {!sub.available && (
                <span className="float-right text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full ml-2">Coming soon</span>
              )}
              <p className="font-bold text-slate-800 text-sm mb-1">{sub.name}</p>
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{sub.playstyleTag}</span>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">{sub.blurb}</p>
              <p className="text-[10px] text-slate-400 mt-1 mb-3">Key stat: {sub.keyStat}</p>
              {sub.levelUnlocks.length > 0 && (
                <div className="border-t border-slate-100 pt-2 space-y-2">
                  {sub.levelUnlocks.map(({ level, features }) => (
                    <div key={level}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Level {level}</p>
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

      {subclasses.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2 flex-shrink-0">
          {subclasses.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${activeIdx === i ? 'bg-amber-500' : 'bg-slate-200'}`}
            />
          ))}
        </div>
      )}

      <div className="px-4 pb-3 flex-shrink-0">
        <button
          onClick={() => { if (activeSub?.available) setShowConfirm(true); }}
          disabled={!activeSub?.available}
          className="w-full py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-amber-600 transition-colors"
        >
          Choose This Path
        </button>
      </div>
    </div>
  );
}
