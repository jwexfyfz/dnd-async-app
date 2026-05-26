"use client";

import { useTurnQueue, type TurnQueuePhase } from "@/hooks/useTurnQueue";
import type { AutoAdvanceResult } from "@/app/actions/auto-advance";
import type { QueueRoll } from "@/types/suggestion-chip";

interface TurnQueueSheetProps {
  gameId:            string;
  turnId:            string;
  initialRolls:      QueueRoll[];
  chipLabel:         string;
  onAdvanceComplete: (result: AutoAdvanceResult) => void;
  onDone:            () => void;
}

export default function TurnQueueSheet({
  gameId, turnId, initialRolls, chipLabel, onAdvanceComplete, onDone,
}: TurnQueueSheetProps) {
  const { phase, rolls, currentRollIndex, error, rollCurrent } = useTurnQueue(
    gameId, turnId, initialRolls, chipLabel, onAdvanceComplete, onDone,
  );

  const isSliding      = phase === "sliding";
  const canRoll        = phase === "rolling";
  const resolvedRolls  = rolls.filter((r) => r.naturalResult !== null || r.skipped);
  const currentRoll    = rolls[currentRollIndex] ?? null;
  const allResolved    = rolls.length === 0 || resolvedRolls.length === rolls.length;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 bg-white border-t border-slate-200 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        transform:     isSliding ? "translateY(100%)" : "translateY(0)",
        transition:    "transform 320ms cubic-bezier(0.4,0,0.2,1)",
        willChange:    "transform",
      }}
      role="dialog"
      aria-label="Roll dice"
      aria-modal="true"
    >
      <div className="max-w-lg mx-auto px-4 pt-4 pb-5 space-y-3">

        {/* Drag handle */}
        <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />

        {/* Roll history badges — compact summary of resolved rolls */}
        {resolvedRolls.length > 0 && (
          <RollHistoryBadges rolls={resolvedRolls} />
        )}

        {/* Outcome banner — last resolved roll result */}
        {resolvedRolls.length > 0 && (
          <OutcomeBanner roll={resolvedRolls[resolvedRolls.length - 1]} />
        )}

        {/* Current roll card — shown until all rolls are resolved */}
        {!allResolved && currentRoll && (
          <RollCardView roll={currentRoll} />
        )}

        {/* Auto-advancing state */}
        {(phase === "auto-advancing" || (isSliding && !error)) && (
          <p className="text-center text-sm text-slate-500 animate-pulse">
            The dungeon responds…
          </p>
        )}

        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        {/* Roll button */}
        <button
          type="button"
          onClick={rollCurrent}
          disabled={!canRoll || !currentRoll}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-slate-800 py-4 text-white font-bold text-lg tracking-wide active:bg-slate-900 disabled:opacity-60 transition-colors touch-manipulation select-none"
          aria-label={canRoll ? "Roll the dice" : "Roll in progress"}
        >
          <span className={phase === "resolving" ? "is-spinning" : ""} aria-hidden="true">🎲</span>
          {phase === "resolving"      && "Rolling…"}
          {phase === "auto-advancing" && "Resolved!"}
          {isSliding                  && "Resolved!"}
          {canRoll                    && "TAP TO ROLL"}
        </button>

      </div>
    </div>
  );
}

// ─── Roll card ────────────────────────────────────────────────────────────────

function RollCardView({ roll }: { roll: QueueRoll }) {
  const modifier   = parseMod(roll.diceFormula);
  const modDisplay = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const isDamage   = roll.type === "DAMAGE";
  const isAttack   = roll.type === "ATTACK";

  return (
    <div className="space-y-3">
      <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400">
        {roll.label}
      </p>

      {roll.advantageState !== "NONE" && (
        <div className={`text-center text-xs font-bold px-2 py-1 rounded-lg ${
          roll.advantageState === "ADVANTAGE"
            ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
            : "bg-amber-50 border border-amber-200 text-amber-700"
        }`}>
          {roll.advantageState}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
          <p className="text-[11px] font-medium text-slate-500 mb-1">
            {isDamage ? "Damage Dice" : "Your Modifier"}
          </p>
          <p className="text-2xl font-bold tabular-nums text-slate-800">
            {isDamage ? roll.diceFormula : modDisplay}
          </p>
        </div>
        {!isDamage && roll.dc !== null && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
            <p className="text-[11px] font-medium text-slate-500 mb-1">
              {isAttack ? "Target AC" : "Target DC"}
            </p>
            <p className="text-2xl font-bold tabular-nums text-slate-800">{roll.dc}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Outcome banner ───────────────────────────────────────────────────────────

function OutcomeBanner({ roll }: { roll: QueueRoll }) {
  if (roll.skipped) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-400 font-medium">{roll.label}: SKIPPED (miss)</p>
      </div>
    );
  }
  if (roll.naturalResult === null) return null;

  const isDamage  = roll.type === "DAMAGE";
  const isAttack  = roll.type === "ATTACK";
  const isCrit    = !isDamage && roll.naturalResult === 20;
  const isFumble  = !isDamage && roll.naturalResult === 1;
  const modifier  = parseMod(roll.diceFormula);
  const modStr    = modifier >= 0 ? `+${modifier}` : `${modifier}`;

  let outcomeLabel: string;
  let colorClass: string;
  if (isCrit)                    { outcomeLabel = "CRITICAL HIT!"; colorClass = "bg-emerald-50 border-emerald-200"; }
  else if (isFumble)             { outcomeLabel = "FUMBLE!";       colorClass = "bg-red-50 border-red-200"; }
  else if (roll.isSuccess === true)  { outcomeLabel = isAttack ? "HIT!"  : "SUCCESS!"; colorClass = "bg-emerald-50 border-emerald-200"; }
  else if (roll.isSuccess === false) { outcomeLabel = isAttack ? "MISS!" : "FAILED!";  colorClass = "bg-red-50 border-red-200"; }
  else                           { outcomeLabel = ""; colorClass = "bg-slate-50 border-slate-200"; }

  const textColor = colorClass.includes("emerald") ? "text-emerald-700" : colorClass.includes("red") ? "text-red-600" : "text-slate-700";

  return (
    <div className={`rounded-xl border p-3 text-center ${colorClass}`} aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
        {roll.label}
      </p>
      {isDamage ? (
        <p className="text-lg font-bold tabular-nums text-slate-800">
          {roll.diceFormula} → {roll.totalResult} damage
        </p>
      ) : (
        <p className="text-lg font-bold tabular-nums text-slate-800">
          🎲 {roll.naturalResult} {modStr} = {roll.totalResult}
          {roll.dc !== null ? ` vs ${isAttack ? "AC" : "DC"} ${roll.dc}` : ""}
        </p>
      )}
      {outcomeLabel && (
        <p className={`text-sm font-bold mt-1 ${textColor}`}>{outcomeLabel}</p>
      )}
    </div>
  );
}

// ─── History badges ───────────────────────────────────────────────────────────

function RollHistoryBadges({ rolls }: { rolls: QueueRoll[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {rolls.map((r) => {
        if (r.skipped) {
          return (
            <span key={r.id} className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">
              {r.type === "DAMAGE" ? "⚔️" : "🎲"} {r.label.split("—")[0].trim()}: SKIP
            </span>
          );
        }
        const mod   = parseMod(r.diceFormula);
        const label = r.type === "DAMAGE"
          ? `⚔️ Dmg: ${r.totalResult}`
          : r.type === "ATTACK"
            ? `🎲 Atk: ${r.naturalResult}${mod >= 0 ? "+" : ""}${mod} vs AC ${r.dc} [${r.isSuccess ? "HIT" : "MISS"}]`
            : `🎲 ${r.label.split("—")[0].trim()}: ${r.totalResult} [${r.isSuccess ? "✓" : "✗"}]`;
        return (
          <span
            key={r.id}
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              r.isSuccess === true  ? "bg-emerald-100 text-emerald-700" :
              r.isSuccess === false ? "bg-red-100 text-red-700"         :
              "bg-slate-100 text-slate-600"
            }`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMod(formula: string): number {
  const m = formula.match(/([+-]\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
