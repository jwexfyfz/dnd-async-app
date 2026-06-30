import type { CharacterInventory, ItemDefinition } from '@/types/v2-game';

// Weapons whose two_handed flag may be missing from older stored JSON.
const TWO_HANDED_NAME_RE = /greataxe|great.?sword|halberd|glaive|pike|maul/i;

function patchItem(item: ItemDefinition): ItemDefinition {
  let patched = item;
  if (!patched.equip_slot && patched.weapon_type) {
    patched = { ...patched, equip_slot: 'main_hand' };
  }
  if (!patched.two_handed && TWO_HANDED_NAME_RE.test(patched.name)) {
    patched = { ...patched, two_handed: true };
  }
  return patched;
}

export function normalizeInventory(raw: unknown): CharacterInventory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bag: [], equipped: {} };
  }
  const inv = raw as Record<string, unknown>;
  const rawEquipped = (inv.equipped && typeof inv.equipped === 'object' && !Array.isArray(inv.equipped))
    ? inv.equipped as Record<string, ItemDefinition | undefined>
    : {};
  return {
    bag: Array.isArray(inv.bag) ? (inv.bag as ItemDefinition[]).map(patchItem) : [],
    equipped: Object.fromEntries(
      Object.entries(rawEquipped).map(([slot, item]) => [slot, item ? patchItem(item) : item])
    ) as CharacterInventory['equipped'],
  };
}

// If a one-handed weapon targets main_hand but main_hand is already occupied by
// another one-handed weapon and off_hand is free, route to off_hand instead.
export function resolveEquipSlot(item: ItemDefinition, inv: CharacterInventory): NonNullable<ItemDefinition['equip_slot']> {
  const slot = item.equip_slot!;
  if (slot === 'main_hand' && !item.two_handed) {
    const mainHandItem = inv.equipped.main_hand;
    if (mainHandItem && !mainHandItem.two_handed && !inv.equipped.off_hand) {
      return 'off_hand';
    }
  }
  return slot;
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
