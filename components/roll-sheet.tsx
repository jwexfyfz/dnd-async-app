"use client";

import type { ActiveRollContext } from "@/lib/roll-context";
import type { TurnResult } from "@/app/actions/take-turn";
import { useRollSheet } from "@/hooks/useRollSheet";

interface RollSheetProps {
  activeRollContext: ActiveRollContext;
  gameId:            string;
  chipText:          string;
  onTurnComplete:    (result: TurnResult) => void;
  onDone:            () => void;
}

export default function RollSheet({
  activeRollContext,
  gameId,
  chipText,
  onTurnComplete,
  onDone,
}: RollSheetProps) {
  const { phase, revealedD20, triggerRoll } = useRollSheet(
    activeRollContext,
    gameId,
    chipText,
    onTurnComplete,
    onDone,
  );

  const { skillType, targetDC, modifier } = activeRollContext;
  const modDisplay = modifier >= 0 ? `+${modifier}` : `${modifier}`;

  const isSpinning  = phase === "spinning";
  const isRevealing = phase === "revealing";
  const isSliding   = phase === "dismounting";

  // Total = revealed d20 + modifier (only shown in revealing/dismounting phases)
  const total   = revealedD20 !== null ? revealedD20 + modifier : null;
  const success = total !== null ? total >= targetDC : null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-slate-200 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] roll-sheet"
      style={{
        paddingBottom:  "env(safe-area-inset-bottom)",
        transform:      isSliding ? "translateY(100%)" : "translateY(0)",
        transition:     "transform 320ms cubic-bezier(0.4,0,0.2,1)",
        willChange:     "transform",
      }}
      role="dialog"
      aria-label="Roll dice"
      aria-modal="true"
    >
      <div className="max-w-lg mx-auto px-4 pt-4 pb-5">

        {/* Drag handle */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />

        {/* Skill label */}
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
          {skillType} Check
        </p>

        {/* Modifier vs DC — hidden until spinning so math stays behind the timer */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-500 mb-1">Your Modifier</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800">{modDisplay}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-500 mb-1">Target DC</p>
            <p className="text-2xl font-bold tabular-nums text-slate-800">{targetDC}</p>
          </div>
        </div>

        {/* Reveal card — mounts only after the animation timer concludes */}
        {(isRevealing || isSliding) && revealedD20 !== null && total !== null && (
          <div
            className={`
              mb-4 rounded-xl border p-3 text-center
              ${success
                ? "bg-emerald-50 border-emerald-200"
                : "bg-red-50 border-red-200"}
            `}
            aria-live="polite"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Result
            </p>
            <p className="text-lg font-bold tabular-nums text-slate-800">
              🎲 {revealedD20} {modDisplay} = {total} vs DC {targetDC}
            </p>
            <p className={`text-sm font-bold mt-1 ${success ? "text-emerald-700" : "text-red-600"}`}>
              {success ? "SUCCESS" : "FAILURE"}
              {revealedD20 === 20 && " — CRITICAL!"}
              {revealedD20 === 1  && " — FUMBLE!"}
            </p>
          </div>
        )}

        {/* Roll trigger — disabled once spinning begins */}
        <button
          type="button"
          onClick={triggerRoll}
          disabled={isSpinning || isRevealing || isSliding}
          className="
            w-full flex items-center justify-center gap-3
            rounded-2xl bg-slate-800 py-4
            text-white font-bold text-lg tracking-wide
            active:bg-slate-900 disabled:opacity-60
            transition-colors touch-manipulation select-none
          "
          aria-label={isSpinning ? "Roll in progress" : "Roll the dice"}
        >
          <span
            className={isSpinning ? "is-spinning" : ""}
            aria-hidden="true"
          >
            🎲
          </span>
          {isSpinning  && "Rolling…"}
          {isRevealing && "Rolled!"}
          {isSliding   && "Rolled!"}
          {!isSpinning && !isRevealing && !isSliding && "TAP TO ROLL"}
        </button>

      </div>
    </div>
  );
}
