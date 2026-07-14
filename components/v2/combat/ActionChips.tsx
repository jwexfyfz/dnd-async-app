'use client';

import { useState } from 'react';
import type { CharacterStats, CharacterInventory, CombatState } from '@/types/v2-game';
import { CLASS_FEATURES } from '@/components/v2/combat/InitiativeStrip';
import { scoreChips, myHpPct } from '@/components/v2/combat/chip-scoring';
import type { ChipVariant } from '@/components/v2/combat/chip-scoring';

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

const GLOSSARY: { label: string; desc: string }[] = [
  { label: 'Attack', desc: 'Roll d20 + attack bonus vs. enemy AC. A hit deals weapon damage.' },
  { label: 'Shove', desc: 'Strength contest to knock a nearby enemy prone. Prone enemies grant advantage on attacks against them.' },
  { label: 'Dodge', desc: 'Until your next turn, attacks against you have disadvantage and you have advantage on DEX saves.' },
  { label: 'Dash', desc: 'Sprint — doubles your movement this turn.' },
  { label: 'Back Off', desc: 'Disengage — move away without provoking opportunity attacks.' },
  { label: 'Hide', desc: 'Roll Stealth vs. highest enemy Perception. If hidden, your next attack is a Sneak Attack.' },
  { label: 'Provoke', desc: 'Intimidation check (DC 12) to force an enemy to focus on you for 2 rounds.' },
  { label: 'Use Item', desc: 'Use a consumable or combat item from your bag.' },
];

export function TurnBadge({ label, used }: { label: string; used: boolean }) {
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${used ? 'text-slate-300' : 'text-emerald-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${used ? 'bg-slate-300' : 'bg-emerald-400'}`} />
      {label}
    </span>
  );
}

function variantCls(variant: ChipVariant, disabled: boolean): string {
  if (disabled) return 'border-slate-200 text-slate-300 cursor-not-allowed';
  switch (variant) {
    case 'primary': return 'bg-indigo-500 text-white border-indigo-500';
    case 'success': return 'bg-emerald-500 text-white border-emerald-500';
    case 'danger':  return 'bg-red-500 text-white border-red-400';
    case 'class':   return 'bg-purple-500 text-white border-purple-400';
    case 'dim':     return 'border-slate-200 text-slate-300 opacity-60 pointer-events-none';
    default:        return 'border-slate-300 text-slate-600 bg-white hover:bg-slate-50';
  }
}

const ROLL_SHEET_HINTS = new Set(['attack', 'shove', 'hide', 'provoke']);

export function ActionChips({
  characterStats,
  characterInventory,
  combatState,
  chip,
  setChip,
  characterId,
  onOpenItemSheet,
  onEndTurn,
  onFeatureActivate,
  onOpenRollSheet,
}: {
  characterStats: CharacterStats | null;
  characterInventory: CharacterInventory | null;
  combatState: CombatState | null;
  chip: string | null;
  setChip: (v: string | null) => void;
  characterId: string;
  onOpenItemSheet: () => void;
  onEndTurn: () => void;
  onFeatureActivate?: (label: string) => void;
  onOpenRollSheet?: (hint: 'attack' | 'hide' | 'provoke' | 'shove') => void;
}) {
  const [showCunningPicker, setShowCunningPicker] = useState(false);
  const [showKiPicker, setShowKiPicker] = useState(false);
  const [confirmingEndTurn, setConfirmingEndTurn] = useState(false);
  const [showGlossary, setShowGlossary] = useState(false);
  const isDying = (characterStats?.currentHp ?? 1) <= 0;

  const actionUsed = combatState?.currentTurnUsage.actionUsed ?? false;
  const bonusUsed  = combatState?.currentTurnUsage.bonusActionUsed ?? false;
  const moveUsed   = combatState?.currentTurnUsage.movementUsed ?? false;
  const features = CLASS_FEATURES[characterStats?.characterClass ?? ''] ?? [];

  const hasCombatItems = (characterInventory?.bag ?? []).some(i => i.combat_usable);
  const hasHealingItems = (characterInventory?.bag ?? []).some(
    i => i.combat_usable && (i.use_effect?.includes('heal') || i.name?.toLowerCase().includes('potion')),
  );

  const scoredChips = combatState ? scoreChips(
    combatState,
    characterId,
    characterStats?.characterClass ?? '',
    hasHealingItems,
    hasCombatItems,
  ) : null;

  // Danger reorder: dodge + disengage pin to front when HP <= 25% with a close enemy
  let orderedChips = scoredChips ?? [];
  if (scoredChips && combatState) {
    const hpPct = myHpPct(combatState, characterId);
    const closeEnemies = combatState.initiativeOrder.filter(e => e.type === 'enemy' && e.hp > 0 && e.proximity === 'close');
    if (hpPct <= 0.25 && closeEnemies.length >= 1) {
      const dodge = scoredChips.find(c => c.id === 'dodge');
      const disengage = scoredChips.find(c => c.id === 'disengage');
      const rest = scoredChips.filter(c => c.id !== 'dodge' && c.id !== 'disengage');
      orderedChips = [dodge, disengage, ...rest].filter(Boolean) as typeof scoredChips;
    }
  }

  const isHiding = characterStats?.isHiding ?? false;

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

  const endTurnBtnCls = allUsed
    ? 'border-indigo-400 text-indigo-700 bg-indigo-50 font-semibold'
    : actionUsed
    ? 'border-slate-300 text-slate-500'
    : 'border-slate-200 text-slate-300';

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

      {/* Hidden status badge */}
      {isHiding && (
        <div className="px-4 pt-1.5 pb-0">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            Hidden — Sneak Attack active
          </span>
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

      {/* Glossary bottom sheet */}
      {showGlossary && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowGlossary(false)}>
          <div className="bg-white rounded-t-2xl shadow-2xl p-5 pb-8 max-h-[60vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-slate-800">Combat Actions</span>
              <button onClick={() => setShowGlossary(false)} className="text-slate-400 text-xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              {GLOSSARY.map(g => (
                <div key={g.label}>
                  <span className="text-xs font-semibold text-slate-700">{g.label}</span>
                  <p className="text-xs text-slate-500 mt-0.5">{g.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex gap-2 overflow-x-auto flex-1 min-w-0" style={{ scrollbarWidth: 'none' }}>
        {!isDying && (
          <>
            {orderedChips.map(scored => {
              if (!scored.visible) return null;
              const isUseItem = scored.id === 'use_item';
              const isRollSheet = ROLL_SHEET_HINTS.has(scored.hint);
              const disabled = actionUsed || (isUseItem && !hasCombatItems);

              const cls = `px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${variantCls(scored.variant, disabled)} ${scored.killBlow && !disabled ? 'ring-2 ring-offset-1 ring-amber-400 animate-pulse' : ''}`;

              return (
                <button
                  key={scored.id}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    if (isUseItem) { onOpenItemSheet(); return; }
                    if (isRollSheet && onOpenRollSheet) {
                      onOpenRollSheet(scored.hint as 'attack' | 'hide' | 'provoke' | 'shove');
                    } else {
                      tapChip(scored.label);
                    }
                  }}
                  className={cls}
                >
                  {scored.label}
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
                    else if (onFeatureActivate) onFeatureActivate(f.label);
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

        {/* Pinned help button — always visible outside scroll */}
        {!isDying && (
          <button
            onClick={() => setShowGlossary(true)}
            className="flex-shrink-0 w-7 h-7 rounded-full border border-slate-200 text-slate-400 text-xs font-medium flex items-center justify-center hover:bg-slate-50 hover:text-slate-600 transition-colors"
          >
            ?
          </button>
        )}
      </div>
    </div>
  );
}
