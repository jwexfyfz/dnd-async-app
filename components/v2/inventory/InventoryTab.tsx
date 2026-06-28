'use client';

import { useState } from 'react';
import type { CharacterInventory, ItemDefinition, CombatState } from '@/types/v2-game';
import { UseButtons, SLOT_GROUPS, SLOT_LABELS, BONUS_LABELS, fmtBonus, bagBadge } from '@/components/v2/inventory/UseButtons';

export function InventoryTab({ characterInventory, gameState, onExplorationAction, onCombatUse, proximityPoi, availablePois, partyMembers, combatState }: {
  characterInventory: CharacterInventory | null;
  gameState: 'exploration' | 'combat';
  onExplorationAction: (text: string, hint: string) => void;
  onCombatUse: (item: ItemDefinition, targetName?: string) => void;
  proximityPoi: { id: string; name: string } | null;
  availablePois: { id: string; name: string }[];
  partyMembers: { id: string; name: string }[];
  combatState: CombatState | null;
}) {
  const isCombat = gameState === 'combat';
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [expandedBagIdx, setExpandedBagIdx] = useState<number | null>(null);
  const [allyPickerItem, setAllyPickerItem] = useState<ItemDefinition | null>(null);
  const [poiPickerItem, setPoiPickerItem] = useState<ItemDefinition | null>(null);

  if (!characterInventory) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  const gearBonus: Record<string, number> = {};
  for (const item of Object.values(characterInventory.equipped)) {
    if (!item?.equip_bonus) continue;
    for (const [k, v] of Object.entries(item.equip_bonus)) {
      gearBonus[k] = (gearBonus[k] ?? 0) + v;
    }
  }
  const gearBonusEntries = Object.entries(gearBonus).filter(([, v]) => v > 0);

  const allyCombatTargets = combatState?.initiativeOrder
    .map(e => ({ id: e.id, name: e.name })) ?? partyMembers;

  return (
    <div className="flex-1 overflow-y-auto px-4">

      {allyPickerItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setAllyPickerItem(null)}>
          <div className="bg-white rounded-t-2xl shadow-xl max-h-[40vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Use {allyPickerItem.name} on…</span>
              <button onClick={() => setAllyPickerItem(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1">
              {(isCombat ? allyCombatTargets : partyMembers).map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (isCombat) onCombatUse(allyPickerItem, m.name);
                    else onExplorationAction(`use ${allyPickerItem.name} on ${m.name}`, 'use_item');
                    setAllyPickerItem(null);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300"
                >
                  <p className="text-sm font-medium text-slate-800">{m.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {poiPickerItem && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setPoiPickerItem(null)}>
          <div className="bg-white rounded-t-2xl shadow-xl max-h-[40vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">Use {poiPickerItem.name} on…</span>
              <button onClick={() => setPoiPickerItem(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-1">
              {availablePois
                .sort((a, b) => (b.id === proximityPoi?.id ? 1 : 0) - (a.id === proximityPoi?.id ? 1 : 0))
                .map(poi => (
                  <button
                    key={poi.id}
                    onClick={() => {
                      onExplorationAction(`use ${poiPickerItem.name} on ${poi.name}`, 'use_item');
                      setPoiPickerItem(null);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl border hover:bg-indigo-50 hover:border-indigo-300 transition-colors border-slate-200"
                  >
                    <p className="text-sm font-medium text-slate-800">{poi.name}</p>
                    {poi.id === proximityPoi?.id && (
                      <p className="text-[10px] text-slate-400 mt-0.5">nearby</p>
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {gearBonusEntries.length > 0 && (
        <div className="py-3 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Total Gear Bonus</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(gearBonusEntries.length, 4)}, minmax(0, 1fr))` }}>
            {gearBonusEntries.map(([k, v]) => {
              const labelColor = k === 'ac' ? 'text-blue-500' : k === 'hp' ? 'text-red-400' : 'text-orange-500';
              return (
                <div key={k} className="bg-white rounded-lg px-1.5 py-2.5 text-center border border-slate-200">
                  <div className={`text-xs font-semibold leading-none mb-1.5 ${labelColor}`}>
                    {BONUS_LABELS[k] ?? k.toUpperCase()}
                  </div>
                  <div className="text-2xl font-bold tracking-tight text-emerald-600">+{v}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="py-3 space-y-4 border-b border-slate-100">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Equipped</p>
        {SLOT_GROUPS.map(({ label, slots }) => (
          <div key={label}>
            <p className="text-[10px] text-slate-400 mb-1.5">{label}</p>
            <div className="space-y-1">
              {slots.map((slot) => {
                const item = characterInventory.equipped[slot];
                const isExpanded = expandedSlot === slot;

                if (!item) {
                  return (
                    <div key={slot} className="rounded-xl border border-dashed border-slate-200 px-3 py-2">
                      <p className="text-[9px] font-semibold text-slate-300 uppercase tracking-wider leading-none mb-0.5">{SLOT_LABELS[slot]}</p>
                      <p className="text-sm text-slate-300">Empty</p>
                    </div>
                  );
                }

                return (
                  <div
                    key={slot}
                    onClick={() => setExpandedSlot(isExpanded ? null : slot)}
                    className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 cursor-pointer select-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-semibold text-amber-600 uppercase tracking-wider leading-none mb-0.5">
                          {SLOT_LABELS[slot]}
                        </p>
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                          {item.damage_dice && <span className="text-[11px] text-slate-400 shrink-0">{item.damage_dice}</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-300 shrink-0">{isExpanded ? '▴' : '▾'}</span>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-amber-200 space-y-1.5">
                        {item.description && (
                          <p className="text-xs text-slate-600 italic">{item.description}</p>
                        )}
                        {item.passive_effect && (
                          <p className="text-xs text-slate-500">{item.passive_effect}</p>
                        )}
                        {item.equip_bonus && Object.keys(item.equip_bonus).length > 0 && (
                          <p className="text-xs font-medium text-emerald-700">{fmtBonus(item.equip_bonus)}</p>
                        )}
                        {!isCombat && (
                          <div className="flex justify-end">
                            <button
                              onClick={(e) => { e.stopPropagation(); onExplorationAction(`unequip ${item.name}`, 'unequip'); }}
                              className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-50 active:bg-red-100"
                            >
                              Unequip
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="py-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Backpack</p>
          {characterInventory.bag.length > 0 && (
            <span className="text-[10px] text-slate-300">{characterInventory.bag.length} items</span>
          )}
        </div>
        {characterInventory.bag.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Empty</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {characterInventory.bag.map((item, i) => {
              const isExpanded = expandedBagIdx === i;
              const canEquip = !!item.equip_slot;
              const canUse = !!(item.consumable || item.use_effect);
              const bonusStr = item.equip_bonus && Object.keys(item.equip_bonus).length > 0
                ? fmtBonus(item.equip_bonus) : null;

              let diffLine: { vs: string; entries: [string, number][] } | null = null;
              if (canEquip && item.equip_slot) {
                const currentItem = characterInventory.equipped[item.equip_slot];
                const myBonus = item.equip_bonus ?? {};
                const theirBonus = currentItem?.equip_bonus ?? {};
                const allKeys = new Set([...Object.keys(myBonus), ...Object.keys(theirBonus)]);
                const entries = [...allKeys]
                  .map(k => [k, (myBonus[k] ?? 0) - (theirBonus[k] ?? 0)] as [string, number])
                  .filter(([, v]) => v !== 0);
                diffLine = { vs: currentItem?.name ?? 'empty slot', entries };
              }

              return (
                <div
                  key={`${item.id ?? 'item'}-${i}`}
                  onClick={() => setExpandedBagIdx(isExpanded ? null : i)}
                  className="flex items-start gap-2.5 py-2 cursor-pointer select-none"
                >
                  <span className="shrink-0 mt-0.5 w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center bg-slate-100 text-slate-500">
                    {bagBadge(item)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {item.name}{item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}
                        </p>
                        {item.damage_dice && <span className="text-[11px] text-slate-400 shrink-0">{item.damage_dice}</span>}
                      </div>
                      <span className="shrink-0 text-[10px] text-slate-300">{isExpanded ? '▴' : '▾'}</span>
                    </div>
                    {bonusStr && !isExpanded && (
                      <p className="text-[11px] text-emerald-700">{bonusStr}</p>
                    )}
                    {isExpanded && (
                      <div className="mt-1.5 space-y-1.5">
                        {item.description && (
                          <p className="text-xs text-slate-600 italic">{item.description}</p>
                        )}
                        {item.passive_effect && (
                          <p className="text-xs text-slate-500">{item.passive_effect}</p>
                        )}
                        {bonusStr && (
                          <p className="text-xs font-medium text-emerald-700">{bonusStr}</p>
                        )}
                        {diffLine && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-0.5">vs {diffLine.vs}</p>
                            {diffLine.entries.length === 0 ? (
                              <p className="text-[10px] text-slate-400 italic">No numeric difference</p>
                            ) : (
                              <div className="flex flex-wrap gap-x-2">
                                {diffLine.entries.map(([k, v]) => (
                                  <span key={k} className={`text-xs font-bold ${v > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {v > 0 ? '+' : ''}{v}{' '}{BONUS_LABELS[k] ?? k.toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <UseButtons
                          item={item}
                          isCombat={isCombat}
                          availablePois={availablePois}
                          partyMembers={partyMembers}
                          canUse={canUse}
                          canEquip={canEquip}
                          onExplorationAction={onExplorationAction}
                          onAllyPick={(i) => setAllyPickerItem(i)}
                          onPoiPick={(i) => setPoiPickerItem(i)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ItemPickerSheet({ items, targets, onSelect, onDismiss }: {
  items: ItemDefinition[];
  targets: { id: string; name: string; hp: number; maxHp: number }[];
  onSelect: (chip: string) => void;
  onDismiss: () => void;
}) {
  const [selectedItem, setSelectedItem] = useState<ItemDefinition | null>(null);

  const combatUsable = items.filter(i => i.combat_usable);

  function handleItemTap(item: ItemDefinition) {
    const targets = item.target ? (Array.isArray(item.target) ? item.target : [item.target]) : ['self'];
    const needsPicker = targets.some(t => t === 'ally' || t === 'enemy');
    if (needsPicker) {
      setSelectedItem(item);
    } else {
      onSelect(`Use: ${item.name}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onDismiss}>
      <div
        className="bg-white rounded-t-2xl shadow-xl max-h-[55vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100 flex-shrink-0">
          <span className="text-sm font-semibold text-slate-800">
            {selectedItem ? `Target for ${selectedItem.name}` : 'Use Item'}
          </span>
          <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-1">
          {selectedItem ? (
            targets.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No targets available.</p>
            ) : (
              targets.map(t => (
                <button
                  key={t.id}
                  onClick={() => onSelect(`Use: ${selectedItem.name} → ${t.name}`)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                >
                  <p className="text-sm font-medium text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">HP {t.hp}/{t.maxHp}</p>
                </button>
              ))
            )
          ) : combatUsable.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Nothing usable in combat.</p>
          ) : (
            combatUsable.map(item => (
              <button
                key={item.id}
                onClick={() => handleItemTap(item)}
                className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
              >
                <p className="text-sm font-medium text-slate-800">{item.name}{item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}</p>
                {item.use_effect && <p className="text-xs text-slate-400 mt-0.5">{item.use_effect}</p>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
