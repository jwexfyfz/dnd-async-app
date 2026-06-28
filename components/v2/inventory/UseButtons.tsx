'use client';

import type { ItemDefinition } from '@/types/v2-game';

export const SLOT_GROUPS = [
  { label: 'Weapons',     slots: ['main_hand', 'off_hand'] as const },
  { label: 'Armor',       slots: ['head', 'chest', 'legs', 'feet'] as const },
  { label: 'Accessories', slots: ['ring', 'amulet'] as const },
];

export const SLOT_LABELS: Record<string, string> = {
  main_hand: 'Main Hand', off_hand: 'Off-Hand',
  head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet',
  ring: 'Ring', amulet: 'Amulet',
};

export const BONUS_LABELS: Record<string, string> = {
  ac: 'AC', damage: 'DMG', to_hit: 'HIT', hp: 'HP',
};

export function fmtBonus(bonus: Record<string, number>): string {
  return Object.entries(bonus)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${BONUS_LABELS[k] ?? k.toUpperCase()}`)
    .join(' · ');
}

export function bagBadge(item: ItemDefinition): string {
  if (!item.equip_slot) return item.consumable || item.use_effect ? 'C' : '·';
  if (item.equip_slot === 'main_hand' || item.equip_slot === 'off_hand') return 'W';
  if (['head', 'chest', 'legs', 'feet'].includes(item.equip_slot)) return 'A';
  return 'X';
}

export function UseButtons({ item, isCombat, availablePois, partyMembers, canUse, canEquip, onExplorationAction, onAllyPick, onPoiPick }: {
  item: ItemDefinition;
  isCombat: boolean;
  availablePois: { id: string; name: string }[];
  partyMembers: { id: string; name: string }[];
  canUse: boolean;
  canEquip: boolean;
  onExplorationAction: (text: string, hint: string) => void;
  onAllyPick: (item: ItemDefinition) => void;
  onPoiPick: (item: ItemDefinition) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 pt-0.5" onClick={e => e.stopPropagation()}>
      {isCombat ? (
        item.combat_usable && (
          <button onClick={() => onAllyPick(item)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
            Use on…
          </button>
        )
      ) : (
        <>
          {canUse && availablePois.length > 0 && (
            <button onClick={() => onPoiPick(item)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Use on…
            </button>
          )}
          {canUse && partyMembers.length > 0 && (
            <button onClick={() => onAllyPick(item)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
              Use on ally
            </button>
          )}
          {canUse && (
            <button
              onClick={() => onExplorationAction(`use ${item.name}`, 'use_item')}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Use
            </button>
          )}
          {canEquip && (
            <button
              onClick={() => onExplorationAction(`equip ${item.name}`, 'equip')}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
            >
              Equip
            </button>
          )}
          <button
            onClick={() => onExplorationAction(`drop ${item.name}`, 'drop')}
            className="text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            Drop
          </button>
        </>
      )}
    </div>
  );
}
