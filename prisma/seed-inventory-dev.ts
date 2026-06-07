// Dev seed: rich inventory + proximity setup for UI testing.
// Run with: npx tsx prisma/seed-inventory-dev.ts

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

// Test character — "test" (7ea93aa8-1eeb-4bb7-8f1d-01911a62a029)
// Room instance:  bac19630-b39d-4687-82c2-a25c6ebe0765  (The Entry Chamber)
// Participant:    9a8a6136-9d6a-41f2-b421-a6be92392e24
// Stone Fountain: 69e63dce-36a0-45b9-9af9-0a7afaa9b90a  ← set as proximity target
const TEST_CHAR_ID     = "7ea93aa8-1eeb-4bb7-8f1d-01911a62a029";
const TEST_PARTICIPANT = "9a8a6136-9d6a-41f2-b421-a6be92392e24";
const STONE_FOUNTAIN   = "69e63dce-36a0-45b9-9af9-0a7afaa9b90a";
const TEST_ROOM_INSTANCE = "bac19630-b39d-4687-82c2-a25c6ebe0765";

const inventory = {
  equipped: {
    main_hand: {
      id: "dev-weapon-1",
      name: "Longsword",
      description: "A cavalry blade repurposed for dungeon work — longer than ideal indoors, but reassuringly solid.",
      equip_slot: "main_hand",
      equip_bonus: { damage: 4, to_hit: 2 },
    },
    chest: {
      id: "dev-armor-1",
      name: "Chain Mail",
      description: "Interlocked iron rings riveted in a tight weave. Heavy and noisy, but reliable against most blades.",
      equip_slot: "chest",
      equip_bonus: { ac: 3 },
    },
    ring: {
      id: "dev-ring-1",
      name: "Ring of Protection",
      description: "A plain iron band inscribed with a ward glyph. The metal is always slightly warm.",
      equip_slot: "ring",
      equip_bonus: { ac: 1 },
      passive_effect: "Passive ward — bonus applies even while unconscious.",
    },
  },
  bag: [
    {
      id: "dev-weapon-2",
      name: "Dagger",
      description: "A short blade with a worn leather grip. Light enough to throw, quick enough to draw in a grapple.",
      equip_slot: "main_hand",
      equip_bonus: { damage: 1, to_hit: 3 },
    },
    {
      id: "dev-weapon-3",
      name: "Iron Shield",
      description: "A heavy round shield, dented from repeated blows. The boss bears a scratched-out sigil.",
      equip_slot: "off_hand",
      equip_bonus: { ac: 2 },
    },
    {
      id: "dev-armor-2",
      name: "Leather Armour",
      description: "Stiff cured hide stitched into a vest and bracers. Quiet enough not to rattle, light enough to run in.",
      equip_slot: "chest",
      equip_bonus: { ac: 1 },
    },
    {
      id: "dev-armor-3",
      name: "Steel Helm",
      description: "A close-fitting steel cap with a short nasal guard. Smells faintly of the previous owner.",
      equip_slot: "head",
      equip_bonus: { ac: 1 },
    },
    {
      id: "dev-consume-1",
      name: "Health Potion",
      description: "A thumb-sized vial of luminous red liquid. It tastes of copper and cherry bark.",
      consumable: true,
      use_effect: "heal_8",
      quantity: 3,
      combat_usable: true,
      target: ["self", "ally"],
      passive_effect: "Restores 8 HP when consumed.",
    },
    {
      id: "dev-consume-2",
      name: "Flask of Lamp Oil",
      description: "A clay flask sealed with a wax stopper. Shatters on impact and ignites readily.",
      consumable: true,
      throwable: true,
      use_effect: "fire_damage_6",
      quantity: 2,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "+6 fire damage on hit. Coats the target area.",
    },
    {
      id: "dev-consume-3",
      name: "Greater Health Potion",
      description: "A larger vial of deep crimson liquid, sealed with wax. The healing is immediate and intense.",
      consumable: true,
      use_effect: "heal_20",
      quantity: 1,
      combat_usable: true,
      target: ["self", "ally"],
      passive_effect: "Restores 20 HP when consumed.",
    },
    {
      id: "dev-consume-4",
      name: "Antitoxin Vial",
      description: "A pale green liquid that neutralizes most common poisons. Bitter as bile.",
      consumable: true,
      use_effect: "cure_poison",
      quantity: 2,
      combat_usable: true,
      target: ["self", "ally"],
      passive_effect: "Removes the Poisoned condition.",
    },
    {
      id: "dev-consume-5",
      name: "Alchemist's Fire",
      description: "A sticky, viscous fluid in a glass flask. Ignites on contact with air and clings to whatever it touches.",
      consumable: true,
      throwable: true,
      use_effect: "fire_damage_8_persistent",
      quantity: 2,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "+8 fire damage, burns for 1d4 each turn until doused.",
    },
    {
      id: "dev-consume-6",
      name: "Acid Flask",
      description: "A stoppered ceramic vial of corrosive yellowish liquid. Handle with care.",
      consumable: true,
      throwable: true,
      use_effect: "acid_damage_6",
      quantity: 1,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "Deals 6 acid damage and corrodes armour.",
    },
    {
      id: "dev-consume-7",
      name: "Smoke Pellet",
      description: "A walnut-sized ball of compressed reagents. Drops a dense smoke cloud on impact.",
      consumable: true,
      throwable: true,
      use_effect: "obscure_area",
      quantity: 3,
      combat_usable: true,
      target: ["poi"],
      passive_effect: "Creates a 10-ft smoke cloud for 2 rounds.",
    },
    {
      id: "dev-consume-8",
      name: "Scroll of Shield",
      description: "Vellum inscribed with a ward-script in silver ink. Crumbles to ash after reading.",
      consumable: true,
      use_effect: "shield_spell",
      quantity: 1,
      combat_usable: true,
      target: ["self"],
      passive_effect: "+5 AC until your next turn.",
    },
    {
      id: "dev-consume-9",
      name: "Thunderstone",
      description: "A polished grey stone laced with a percussive enchantment. Shatters with a deafening crack when thrown.",
      consumable: true,
      throwable: true,
      use_effect: "thunder_deafen",
      quantity: 2,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "DC 13 Con save or Deafened for 1 minute.",
    },
    {
      id: "dev-consume-10",
      name: "Holy Water (Vial)",
      description: "Blessed water in a sealed crystal vial. Searing to undead and fiends.",
      consumable: true,
      throwable: true,
      use_effect: "holy_damage_8",
      quantity: 1,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "8 radiant damage vs undead/fiends, harmless to others.",
    },
    {
      id: "dev-damage-1",
      name: "Vial of Caustic Bile",
      description: "Extracted from a giant toad's gland. Reeks of ammonia and dissolves leather on contact.",
      consumable: true,
      throwable: true,
      use_effect: "acid_damage_10",
      quantity: 1,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "10 acid damage; target's AC is reduced by 1 until end of their next turn.",
    },
    {
      id: "dev-damage-2",
      name: "Frost Shard",
      description: "A sliver of perpetually frozen blue ice sealed in wax paper. Shatters into a burst of freezing shards on impact.",
      consumable: true,
      throwable: true,
      use_effect: "cold_damage_8_slow",
      quantity: 2,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "8 cold damage; DC 12 Con save or speed halved until end of next turn.",
    },
    {
      id: "dev-damage-3",
      name: "Sunrod",
      description: "A short iron rod tipped with alchemical phosphor. Blindingly bright when snapped and thrown.",
      consumable: true,
      throwable: true,
      use_effect: "radiant_damage_6_blind",
      quantity: 2,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "6 radiant damage; DC 12 Con save or Blinded until end of next turn.",
    },
    {
      id: "dev-damage-4",
      name: "Tanglefoot Bag",
      description: "A leather pouch of sticky alchemical resin. Bursts on impact, coating the target's feet.",
      consumable: true,
      throwable: true,
      use_effect: "restrain_2_rounds",
      quantity: 1,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "DC 13 Str save or Restrained for 2 rounds.",
    },
    {
      id: "dev-damage-5",
      name: "Venom Dart",
      description: "A hollow bone needle loaded with cave-spider venom. Fired with a short puff of breath.",
      consumable: true,
      throwable: true,
      use_effect: "poison_damage_6_poison",
      quantity: 3,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "6 poison damage; DC 12 Con save or Poisoned for 1 minute.",
    },
    {
      id: "dev-damage-6",
      name: "Concussive Orb",
      description: "A ceramic sphere packed with compressed sound. Shatters with a bone-rattling concussive blast.",
      consumable: true,
      throwable: true,
      use_effect: "thunder_damage_10_push",
      quantity: 1,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "10 thunder damage; DC 13 Str save or pushed 10 ft.",
    },
    {
      id: "dev-damage-7",
      name: "Witch-Light Flask",
      description: "A swirling violet liquid that crackles with static. Discharges a bolt of lightning on contact.",
      consumable: true,
      throwable: true,
      use_effect: "lightning_damage_8_chain",
      quantity: 1,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "8 lightning damage; arcs to an adjacent enemy for 4 damage.",
    },
    {
      id: "dev-damage-8",
      name: "Iron Caltrops (Pouch)",
      description: "A cloth pouch of sharpened four-pointed iron spikes. Scattered to control ground.",
      consumable: true,
      use_effect: "scatter_caltrops",
      quantity: 1,
      combat_usable: true,
      target: ["poi"],
      passive_effect: "Creatures moving through the area take 1d4 piercing damage and halve their speed.",
    },
    {
      id: "dev-damage-9",
      name: "Corrosive Bomb",
      description: "A fist-sized clay vessel packed with reactive salts. Erupts in a spray of dissolving vapour.",
      consumable: true,
      throwable: true,
      use_effect: "acid_damage_12_aoe",
      quantity: 1,
      combat_usable: true,
      target: ["enemy", "poi"],
      passive_effect: "12 acid damage in a 5-ft burst; corrodes all armour in the area for –1 AC.",
    },
    {
      id: "dev-damage-10",
      name: "Necrotic Dust",
      description: "A pinch of grey powder ground from cursed bone. Inhaled or thrown, it withers living flesh.",
      consumable: true,
      throwable: true,
      use_effect: "necrotic_damage_8_drain",
      quantity: 2,
      combat_usable: true,
      target: ["enemy"],
      passive_effect: "8 necrotic damage; target's max HP reduced by the damage dealt until a long rest.",
    },
    {
      id: "dev-misc-1",
      name: "Velvet Coin Purse",
      description: "Soft purple velvet, embroidered with a merchant's mark. Contains 12 gold pieces.",
      passive_effect: "No combat use. Worth keeping.",
    },
    {
      id: "dev-misc-2",
      name: "Thieves' Tools",
      description: "A roll of leather containing picks, tension wrenches, and a short pry bar. Well worn.",
      use_effect: "lockpick",
      target: ["poi"],
      passive_effect: "Required for lockpicking checks.",
    },
    {
      id: "dev-misc-3",
      name: "Rope (50 ft)",
      description: "Hempen rope, coiled tight. Reliable for climbing, binding, or improvised rigging.",
      use_effect: "bind_or_climb",
      target: ["poi", "enemy"],
      passive_effect: "Can be used to restrain or anchor to fixtures.",
    },
  ],
};

async function buildCombatState() {
  const char = await prisma.character.findUnique({
    where: { id: TEST_CHAR_ID },
    select: { name: true, currentHp: true, maxHp: true },
  });
  if (!char) throw new Error(`Character ${TEST_CHAR_ID} not found`);

  return {
  round: 1,
  activeActorId: TEST_CHAR_ID,
  currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
  initiativeOrder: [
    {
      id: TEST_CHAR_ID,
      type: "character",
      name: char.name,
      initiative: 18,
      hp: char.currentHp,
      maxHp: char.maxHp,
      ac: 14,
      surprised: false,
      acted: false,
      proximity: "close",
      status_effects: [],
    },
    {
      id: "enemy-skeleton-01",
      type: "enemy",
      name: "Skeleton Warrior",
      initiative: 14,
      hp: 13,
      maxHp: 13,
      ac: 13,
      surprised: false,
      acted: false,
      proximity: "close",
      status_effects: [],
      resistances: ["piercing"],
      passive_perception: 8,
    },
    {
      id: "enemy-skeleton-02",
      type: "enemy",
      name: "Skeleton Archer",
      initiative: 11,
      hp: 10,
      maxHp: 10,
      ac: 13,
      surprised: false,
      acted: false,
      proximity: "far",
      status_effects: [],
      resistances: ["piercing"],
      passive_perception: 8,
    },
  ],
  };
}

async function main() {
  // 1. Seed inventory on all characters
  const characters = await prisma.character.findMany({ select: { id: true, name: true } });
  for (const char of characters) {
    await prisma.character.update({
      where: { id: char.id },
      data: { inventory: inventory as object },
    });
    console.log(`✓ inventory  ${char.name} (${char.id})`);
  }

  // 2. Put the test character in proximity to the Stone Fountain
  await prisma.roomParticipant.update({
    where: { id: TEST_PARTICIPANT },
    data: { combatState: { proximity_target_id: STONE_FOUNTAIN, stance: "examining" } },
  });
  console.log(`✓ proximity  test char → Stone Fountain (${STONE_FOUNTAIN})`);

  // 3. Set active combat on the session linked to the test room instance
  const roomInstance = await prisma.roomInstance.findUnique({
    where: { id: TEST_ROOM_INSTANCE },
    select: { sessionId: true },
  });
  if (!roomInstance) throw new Error(`Room instance ${TEST_ROOM_INSTANCE} not found`);
  const combatState = await buildCombatState();
  await prisma.gameSession.update({
    where: { id: roomInstance.sessionId },
    data: { gameState: "combat", combatState: combatState as object },
  });
  console.log(`✓ combat     session → round 1, 2 skeletons`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
