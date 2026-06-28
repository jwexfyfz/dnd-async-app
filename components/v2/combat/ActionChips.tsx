'use client';

import { useState } from 'react';
import type { CharacterStats, CharacterInventory, CombatState } from '@/types/v2-game';
import { CLASS_FEATURES } from '@/components/v2/combat/InitiativeStrip';

const STANDARD_CHIPS = [
  { id: 'attack',     label: 'Attack' },
  { id: 'dodge',      label: 'Dodge' },
  { id: 'dash',       label: 'Dash' },
  { id: 'disengage',  label: 'Disengage' },
  { id: 'hide',       label: 'Hide' },
  { id: 'use_item',   label: 'Use Item' },
  { id: 'provoke',    label: 'Provoke' },
];

const CUNNING_SUB = [
  { id: 'cunning_hide',       label: 'Hide' },
  { id: 'cunning_dash',       label: 'Dash' },
  { id: 'cunning_disengage',  label: 'Disengage' },
];

const KI_SUB = [
  { id: 'ki_flurry',   label: 'Flurry of Blows' },
  { id: 'ki_defense',  label: 'Patient Defense' },
  { id: 'ki_wind',     label: 'Step of the Wind' },
];

export function TurnBadge({ label, used }: { label: string; used: boolean }) {
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${used ? 'text-slate-300' : 'text-emerald-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${used ? 'bg-slate-300' : 'bg-emerald-400'}`} />
      {label}
    </span>
  );
}

export function ActionChips({ characterStats, characterInventory, combatState, chip, setChip, onOpenItemSheet, onEndTurn }: {
  characterStats: CharacterStats | null;
  characterInventory: CharacterInventory | null;
  combatState: CombatState | null;
  chip: string | null;
  setChip: (v: string | null) => void;
  onOpenItemSheet: () => void;
  onEndTurn: () => void;
}) {
  const [showCunningPicker, setShowCunningPicker] = useState(false);
  const [showKiPicker, setShowKiPicker] = useState(false);
  const [confirmingEndTurn, setConfirmingEndTurn] = useState(false);
  const isDying = (characterStats?.currentHp ?? 1) <= 0;

  const actionUsed = combatState?.currentTurnUsage.actionUsed ?? false;
  const bonusUsed  = combatState?.currentTurnUsage.bonusActionUsed ?? false;
  const moveUsed   = combatState?.currentTurnUsage.movementUsed ?? false;
  const hasCombatItems = (characterInventory?.bag ?? []).some(i => i.combat_usable);
  const features = CLASS_FEATURES[characterStats?.characterClass ?? ''] ?? [];

  const unusedResources: string[] = [];
  if (!actionUsed) unusedResources.push('action');
  if (!bonusUsed) unusedResources.push('bonus action');
  if (!moveUsed) unusedResources.push('movement');
  const allUsed = unusedResources.length === 0;

  function formatUnused(): string {
    if (unusedResources.length === 1) return unusedResources[0];
    if (unusedResources.length === 2) return `${unusedResources[0]} and ${unusedResources[1]}`;
    return `${unusedResources[0]}, ${unusedResources[1]}, and ${unusedResources[2]}`;
  }

  const confirmMessage = unusedResources.length === 3
    ? "You haven't taken any actions. End turn and forfeit your turn?"
    : `You still have your ${formatUnused()}. End turn anyway?`;

  function handleEndTurnTap() {
    if (allUsed) {
      onEndTurn();
    } else {
      setConfirmingEndTurn(true);
    }
  }

  const endTurnBtnCls = allUsed
    ? 'border-indigo-400 text-indigo-700 bg-indigo-50 font-semibold'
    : actionUsed
    ? 'border-slate-300 text-slate-500'
    : 'border-slate-200 text-slate-300';

  function tapChip(label: string) {
    setChip(chip === label ? null : label);
  }

  function tapCunning(sublabel: string) {
    setChip(`Cunning Action: ${sublabel}`);
    setShowCunningPicker(false);
  }

  function tapKi(sublabel: string) {
    setChip(`Ki: ${sublabel}`);
    setShowKiPicker(false);
  }

  return (
    <div className="bg-white border-t border-slate-100 flex-shrink-0">
      {combatState && (
        <div className="flex items-center justify-between px-4 pt-2 pb-0">
          {isDying ? (
            <span className="text-xs font-medium text-red-500">Unconscious — rolling death save…</span>
          ) : (
            <div className="flex items-center gap-4">
              <TurnBadge label="Action" used={actionUsed} />
              <TurnBadge label="Bonus"  used={bonusUsed} />
              <TurnBadge label="Move"   used={moveUsed} />
            </div>
          )}
          {!isDying && (
            <button
              onClick={handleEndTurnTap}
              className={`text-xs px-3 py-1 rounded-full border transition-all ${endTurnBtnCls}`}
            >
              End Turn →
            </button>
          )}
        </div>
      )}
      {!isDying && confirmingEndTurn && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-t border-amber-100">
          <span className="text-xs text-amber-800 flex-1">{confirmMessage}</span>
          <button
            onClick={() => setConfirmingEndTurn(false)}
            className="text-xs font-medium text-slate-500 px-2 py-1 flex-shrink-0"
          >
            Cancel
          </button>
          <button
            onClick={() => { setConfirmingEndTurn(false); onEndTurn(); }}
            className="text-xs font-medium text-red-600 px-2 py-1 flex-shrink-0"
          >
            End Turn
          </button>
        </div>
      )}
      {showCunningPicker && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Cunning Action — use as:</span>
          {CUNNING_SUB.map(c => (
            <button key={c.id} onClick={() => tapCunning(c.label)}
              className="px-2.5 py-1 rounded-full border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50 text-xs font-medium whitespace-nowrap flex-shrink-0">
              {c.label}
            </button>
          ))}
        </div>
      )}
      {showKiPicker && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Ki — spend 1 point:</span>
          {KI_SUB.map(k => (
            <button key={k.id} onClick={() => tapKi(k.label)}
              className="px-2.5 py-1 rounded-full border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50 text-xs font-medium whitespace-nowrap flex-shrink-0">
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto px-4 py-2" style={{ scrollbarWidth: 'none' }}>
        {!isDying && (
          <>
            {STANDARD_CHIPS.map(c => {
              const isUseItem = c.id === 'use_item';
              const greyed = actionUsed || (isUseItem && !hasCombatItems);
              const isActive = chip?.startsWith('Use:') && isUseItem ? true : chip === c.label;
              return (
                <button
                  key={c.id}
                  disabled={actionUsed}
                  onClick={() => {
                    if (isUseItem) onOpenItemSheet();
                    else tapChip(c.label);
                  }}
                  className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : greyed
                      ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
            {features.map(f => {
              const isCunning = !!f.cunning;
              const isKi = !!f.ki;
              const isActive = isCunning ? chip?.startsWith('Cunning Action') : isKi ? chip?.startsWith('Ki:') : chip === f.label;
              return (
                <button
                  key={f.id}
                  disabled={bonusUsed}
                  onClick={() => {
                    if (bonusUsed) return;
                    if (isCunning) { setShowKiPicker(false); setShowCunningPicker(p => !p); }
                    else if (isKi) { setShowCunningPicker(false); setShowKiPicker(p => !p); }
                    else tapChip(f.label);
                  }}
                  className={`px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : bonusUsed
                      ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                      : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                  }`}
                >
                  {f.label} ●
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
