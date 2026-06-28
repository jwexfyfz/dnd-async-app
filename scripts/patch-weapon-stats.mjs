// One-off data patch: backfill item descriptions and weapon/armor stats (damage_dice,
// weapon_type, silent, equip_bonus, description) onto items already persisted in
// PoiTemplate.defaultProperties, PoiInstance.currentProperties (floor_items), and
// Character.inventory (bag/equipped). Mirrors the item definitions updated in
// prisma/seed.mjs. Does NOT delete or reset any game data — only merges new fields
// onto matching item objects (matched by `id`).
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ITEM_PATCHES = {
  // ─── Weapons & equippable gear — combat stats ──────────────────────────────
  hand_axe: {
    description: "A well-balanced hand axe. 1d6 slashing, melee, can be thrown.",
    damage_dice: "1d6",
    weapon_type: "melee",
  },
  hunting_bow: {
    description: "A simple recurve hunting bow. 1d6 piercing, ranged, and nearly silent.",
    damage_dice: "1d6",
    weapon_type: "ranged",
    silent: true,
  },
  vorne_plate: {
    description: "Old plate armor bearing the Vorne crest. +1 AC.",
    equip_bonus: { ac: 1 },
  },
  pipe_dagger: {
    description: "A finely balanced dagger with a faint enchantment. 1d4+1 piercing, finesse.",
    damage_dice: "1d4+1",
    weapon_type: "finesse",
    equip_bonus: { to_hit: 1, damage: 1 },
  },
  old_dagger: {
    description: "A worn iron dagger. 1d4 piercing, finesse.",
    damage_dice: "1d4",
    weapon_type: "finesse",
  },

  // ─── Other items — descriptions only ───────────────────────────────────────
  pipe_gold: { description: "A small handful of tarnished gold coins, tied in a scrap of cloth." },
  grocery_list: { description: "A short list in a merchant's hand: flour, salt, lamp oil, candles. Utterly unremarkable." },
  healing_vial: { description: "A small glass vial of shimmering red liquid. Restores 4 HP when consumed." },
  silver_ring: { description: "A plain silver band, tarnished with age but still wearable. Worth a few coins to the right buyer." },
  carved_token: { description: "A disc of dark wood carved with an unfamiliar sigil — the mark of some faction operating in the cellar." },
  coin_pouch: { description: "A small leather pouch, heavy with coin." },
  loose_stone: { description: "A fist-sized chunk of broken masonry. Crude, but it'll do in a pinch as a thrown weapon." },
  thieves_tools: { description: "A slim leather roll of picks, tension wrenches, and files. Useful for opening locks without a key." },
  iron_key: { description: "A corroded iron key, wedged into a crack in the stone. It looks like it might fit a padlock somewhere nearby." },
  dried_herb: { description: "A bundle of dried medicinal herbs, bound with twine. Chewing them eases pain and closes minor wounds. Restores 2 HP." },
  occultist_journal: { description: "A water-damaged leather journal, its pages filled with cramped notes on a binding ritual gone wrong." },
  bronze_amulet: { description: "A tarnished bronze amulet on a corroded chain, etched with warding sigils. Wearing it steadies the mind against outside influence." },
  folded_map: { description: "A water-stained map of the cellar's lower passages, hand-drawn in fading ink." },
  vorne_locket: { description: "A small brass locket on a broken chain, holding two faded portraits — a woman and a child." },
  signet_ring: { description: "A heavy gold ring stamped with the crossed pick and torch of House Vorne — a noble seal of some standing." },
  torch_bundle: { description: "Several pitch-soaked torches bundled with cord. Each burns long enough to light a room for an hour." },
  rope_coil: { description: "Fifty feet of sturdy hemp rope, neatly coiled." },
  ration_pack: { description: "Dried meat, hardtack, and a wedge of waxed cheese — enough food for a day on the road." },
  chest_healing_potion: { description: "A corked vial of glowing crimson liquid, sealed with wax. Restores 8 HP when consumed." },
  chest_gold_coins: { description: "A small stack of gold coins, still bearing the royal mint mark." },
  chest_commanders_note: { description: "A folded note bearing Vorne's seal, detailing payments for a job described only as 'site security.'" },
  oil_of_silence: { description: "A small vial of inky oil. Pour it across a 10-foot area to dampen sound completely for a short time." },
  conspiracy_note: { description: "A hastily scrawled note implicating an innocent party — planted evidence, by the look of the forced handwriting." },
  submerged_gate_key: { description: "A heavy iron key, slick with damp, stamped with a sigil matching the submerged gate to the north." },
  vorne_key: { description: "A brass key engraved with the Vorne crest — a stylized flame. It looks like it opens something important." },
  harwick_grimoire: { description: "A hand-copied ritual manual, its margins crowded with increasingly frantic annotations and corrections." },
  reagent_vials: { description: "Glass vials of a silver-black reagent, sealed with wax and labeled in Old Imperial: 'anchor reagent.'" },
  vorne_ledger: { description: "A leather-bound ledger documenting two decades of House Vorne's dealings — the most recent pages detail bribes and silenced witnesses." },
  blank_pardon: { description: "An official pardon document, blank but for a royal seal already affixed — meant to be filled in with whoever's name was needed." },
};

// Recursively walks an object/array tree, merging ITEM_PATCHES fields onto any object
// whose `id` matches a patch key. Returns true if anything was changed.
function patchItem(node) {
  if (!node || typeof node !== "object") return false;
  let changed = false;

  if (typeof node.id === "string" && ITEM_PATCHES[node.id]) {
    const patch = ITEM_PATCHES[node.id];
    for (const [k, v] of Object.entries(patch)) {
      node[k] = v;
      changed = true;
    }
    if (node.id === "pipe_dagger" && "attack_bonus" in node) {
      delete node.attack_bonus;
      changed = true;
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (patchItem(entry)) changed = true;
      }
    } else if (value && typeof value === "object") {
      if (patchItem(value)) changed = true;
    }
  }

  return changed;
}

async function main() {
  console.log("Patching PoiTemplate.defaultProperties...");
  const templates = await prisma.poiTemplate.findMany({ select: { id: true, name: true, defaultProperties: true } });
  for (const t of templates) {
    const dp = JSON.parse(JSON.stringify(t.defaultProperties ?? {}));
    if (patchItem(dp)) {
      await prisma.poiTemplate.update({ where: { id: t.id }, data: { defaultProperties: dp } });
      console.log(`  patched template "${t.name}" (${t.id})`);
    }
  }

  console.log("Patching PoiInstance.currentProperties...");
  const instances = await prisma.poiInstance.findMany({ select: { id: true, currentProperties: true } });
  for (const inst of instances) {
    const cp = JSON.parse(JSON.stringify(inst.currentProperties ?? {}));
    if (patchItem(cp)) {
      await prisma.poiInstance.update({ where: { id: inst.id }, data: { currentProperties: cp } });
      console.log(`  patched instance ${inst.id}`);
    }
  }

  console.log("Patching Character.inventory...");
  const characters = await prisma.character.findMany({ select: { id: true, name: true, inventory: true } });
  for (const c of characters) {
    const inv = JSON.parse(JSON.stringify(c.inventory ?? {}));
    if (patchItem(inv)) {
      await prisma.character.update({ where: { id: c.id }, data: { inventory: inv } });
      console.log(`  patched character "${c.name}" (${c.id}) inventory`);
    }
  }

  console.log("Done.");
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
