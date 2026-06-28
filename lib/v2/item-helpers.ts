import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';

export function normalizeInventory(raw: unknown): CharacterInventory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bag: [], equipped: {} };
  }
  const inv = raw as Record<string, unknown>;
  return {
    bag: Array.isArray(inv.bag) ? (inv.bag as ItemDefinition[]) : [],
    equipped:
      inv.equipped && typeof inv.equipped === 'object' && !Array.isArray(inv.equipped)
        ? (inv.equipped as CharacterInventory['equipped'])
        : {},
  };
}

export function inventorySummary(inv: CharacterInventory): string {
  const equippedSlots = Object.entries(inv.equipped)
    .filter(([, item]) => item != null)
    .map(([slot, item]) => `${slot}:${item!.name}`)
    .join(', ');
  return `bag=${inv.bag.length} item(s)${equippedSlots ? `, equipped=[${equippedSlots}]` : ''}`;
}

export function extractPoiItems(
  defaultProperties: unknown,
  currentProperties: unknown,
): { items: ItemDefinition[]; floorItems: ItemDefinition[] } {
  const defaults = (defaultProperties as Record<string, unknown>) ?? {};
  const current = (currentProperties as Record<string, unknown>) ?? {};

  const templateItems = Array.isArray(defaults.items) ? (defaults.items as ItemDefinition[]) : [];
  const takenIds = new Set(Array.isArray(current.items_taken) ? (current.items_taken as string[]) : []);
  const revealedIds = new Set(
    Array.isArray(current.revealed_items) ? (current.revealed_items as string[]) : [],
  );

  const visibleItems = templateItems.filter(item => {
    if (takenIds.has(item.id)) return false;
    if (item.hidden && !revealedIds.has(item.id)) return false;
    return true;
  });

  const floorItems = Array.isArray(current.floor_items) ? (current.floor_items as ItemDefinition[]) : [];

  console.log(`[items] extractPoiItems — template:${templateItems.map(i => `${i.id}(hidden=${!!i.hidden})`).join(',')||'none'} taken:[${[...takenIds].join(',')}] revealed:[${[...revealedIds].join(',')}] visible:[${visibleItems.map(i=>i.id).join(',')}] floor:[${floorItems.map(i=>i.id).join(',')}]`);

  return { items: visibleItems, floorItems };
}
