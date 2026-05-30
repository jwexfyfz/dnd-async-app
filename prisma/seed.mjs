// prisma/seed.mjs
// Run with: npm run db:seed

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon } = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Tile helpers ─────────────────────────────────────────────────────────────

const W = () => ({ t: "W" });
const F = (opts = {}) => ({ t: "F", ...opts });
const D = () => ({ t: "D" });
const U = (opts = {}) => ({ t: "?", ...opts }); // unexplored

// ─── Map data ─────────────────────────────────────────────────────────────────
// Each tile is a MapTile object { t, enemy?, item? }.
// enemy: enemyId that spawns here at act start (DORMANT until scene activates it).
// Positions documented in trigger guide below match (x, y) = (col, row) indexing.

const cellarMap = {
  width: 10, height: 5,
  tiles: [
    [W(),W(),W(),W(),W(),W(),W(),W(),W(),W()],
    [W(),F(),F(),F(),W(),U(),U(),U({ enemy:"a1s2_boss" }),U(),W()],
    [W(),F(),F({ enemy:"a1s1_rat_1" }),F({ enemy:"a1s1_rat_2" }),D(),U({ enemy:"a1s2_cultist_acolyte" }),U(),U({ enemy:"a1s2_cultist" }),U(),W()],
    [W(),F(),F({ enemy:"a1s1_cultist_guard" }),F(),W(),U(),U(),U(),U(),W()],
    [W(),W(),W(),W(),W(),W(),W(),W(),W(),W()],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Storage Room",   description: "Dusty shelves and forgotten crates. Something smells off." },
    { name: "Hidden Chamber", description: "Arcane symbols scratch the stone. Someone was working here." },
  ],
  pois: [
    { id: "chest_1",   name: "Locked Chest", x: 7, y: 3, symbol: "C" },
    { id: "stairs_up", name: "Stairs Up",     x: 2, y: 3, symbol: "^" },
    {
      id: "door", name: "Hidden Door", x: 4, y: 2, symbol: "D",
      interactEffect: {
        mapUpdate: [
          { x: 4, y: 2, tile: "F" },
          { x: 5, y: 1, tile: "F" }, { x: 6, y: 1, tile: "F" }, { x: 7, y: 1, tile: "F" }, { x: 8, y: 1, tile: "F" },
          { x: 5, y: 2, tile: "F" }, { x: 6, y: 2, tile: "F" }, { x: 7, y: 2, tile: "F" }, { x: 8, y: 2, tile: "F" },
          { x: 5, y: 3, tile: "F" }, { x: 6, y: 3, tile: "F" }, { x: 7, y: 3, tile: "F" }, { x: 8, y: 3, tile: "F" },
        ],
      },
    },
  ],
};

const mineMap = {
  width: 12, height: 7,
  tiles: [
    [W(),W(),W(),W(),W(),W(),W(),W(),W(),W(),W(),W()],
    [W(),F({ enemy:"a2s1_tunnel_rat" }),F(),W(),W(),W(),W(),W(),W(),W(),W(),W()],
    [W(),F({ enemy:"a2s1_spider_1" }),F({ enemy:"a2s1_spider_2" }),D(),F(),F(),F(),W(),W(),W(),W(),W()],
    [W(),W(),W(),W(),F(),F({ enemy:"a2s2_miner_1" }),F({ enemy:"a2s2_miner_2" }),W(),W(),W(),W(),W()],
    [W(),W(),W(),W(),F(),F(),F(),D(),U(),U(),U(),W()],
    [W(),W(),W(),W(),W(),W(),W(),U(),U(),U({ enemy:"a2s2_foreman" }),U(),W()],
    [W(),W(),W(),W(),W(),W(),W(),W(),W(),W(),W(),W()],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Mine Entrance",   description: "Pickaxes lean against the wall. Sulfur hangs in the air." },
    { name: "Main Shaft",      description: "Ore-veins run through the walls. A collapsed beam blocks one passage." },
    { name: "Deep Excavation", description: "The foreman's lantern still burns. Nobody has been here in days." },
  ],
  pois: [
    { id: "pickaxe",   name: "Miner's Pickaxe",  x: 2, y: 2, symbol: "P" },
    { id: "ore_vein",  name: "Silver Vein",        x: 5, y: 3, symbol: "O" },
    { id: "lantern",   name: "Foreman's Lantern",  x: 9, y: 5, symbol: "L" },
    {
      id: "deep_door", name: "Reinforced Hatch", x: 7, y: 4, symbol: "D",
      interactEffect: {
        mapUpdate: [
          { x: 7, y: 4, tile: "F" },
          { x: 8, y: 4, tile: "F" }, { x: 9, y: 4, tile: "F" }, { x: 10, y: 4, tile: "F" },
          { x: 7, y: 5, tile: "F" }, { x: 8, y: 5, tile: "F" }, { x: 9, y: 5, tile: "F" }, { x: 10, y: 5, tile: "F" },
        ],
      },
    },
  ],
};

// Arena (6×4): all 8 floor tiles claimed by scene 1/2/3 enemies — no overlap.
// Scene 1: guard_1@(1,2), guard_2@(4,2), brute@(2,1)
// Scene 2: champion@(3,2), elite_guard@(4,1), assassin@(1,1)
// Scene 3: architect@(2,2)
const arenaMap = {
  width: 6, height: 4,
  tiles: [
    [W(),W(),W(),W(),W(),W()],
    [W(),F({ enemy:"a3s2_assassin" }),F({ enemy:"a3s1_brute" }),F(),F({ enemy:"a3s2_elite_guard" }),W()],
    [W(),F({ enemy:"a3s1_guard_1" }),F({ enemy:"a3s3_architect" }),F({ enemy:"a3s2_champion" }),F({ enemy:"a3s1_guard_2" }),W()],
    [W(),W(),W(),W(),W(),W()],
  ],
  playerStart: { x: 1, y: 1 },
  rooms: [
    { name: "Proving Grounds", description: "Sand. Blood. An endless stream of challengers." },
  ],
  pois: [
    {
      id: "gate", name: "Iron Gate", x: 4, y: 2, symbol: "G",
      interactEffect: { mapUpdate: [{ x: 4, y: 2, tile: "F" }] },
    },
    { id: "throne", name: "Judge's Throne", x: 4, y: 1, symbol: "T" },
  ],
};

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Seeding: The Shadows of Thornwood ===\n");

  // ── Story ──────────────────────────────────────────────────────────────────
  const story = await prisma.story.upsert({
    where:  { title: "The Shadows of Thornwood" },
    update: {},
    create: {
      title:       "The Shadows of Thornwood",
      description: "A missing nephew. A collapsing mine. A gladiatorial arena hiding the truth. Three acts stand between you and the shadow that has gripped Thornwood for generations.",
      difficulty:  "Standard",
    },
  });

  // ── Act 1 ──────────────────────────────────────────────────────────────────
  console.log("ACT 1: The Innkeeper's Debt");

  const act1 = await prisma.act.upsert({
    where:  { storyId_order: { storyId: story.id, order: 1 } },
    update: {},
    create: {
      storyId: story.id,
      order:   1,
      title:   "The Innkeeper's Debt",
      summary: "A missing nephew leads to a cellar full of cultists. The innkeeper's debt is a cover for something far darker — a secret society with roots running deep into Thornwood's mine. The cult symbol matches markings found in the mine's deepest shaft.",
      playerFacingDescription: "A desperate innkeeper pulls you aside at closing time. Coin has gone missing from the cellar — and so has her nephew. She can't involve the town guard.",
    },
  });

  const cellar = await prisma.map.upsert({
    where:  { name: "Abandoned Cellar" },
    update: { data: cellarMap, actId: act1.id },
    create: { name: "Abandoned Cellar", data: cellarMap, actId: act1.id },
  });
  void cellar;

  const act1scene1 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act1.id, order: 1 } },
    update: {
      title:       "A Cellar Full of Secrets",
      description: "The storage room reeks of mildew and fear. Crates have been shoved aside to clear a ritual space. Cultist guards patrol between the shelves. Fresh bootprints lead toward the locked door at the far end.",
      objectives:  ["Clear the storage room of cultist guards", "Find the hidden door at (4,2)"],
      triggerType: "ACT_START",
    },
    create: {
      actId:       act1.id,
      order:       1,
      title:       "A Cellar Full of Secrets",
      description: "The storage room reeks of mildew and fear. Crates have been shoved aside to clear a ritual space. Cultist guards patrol between the shelves. Fresh bootprints lead toward the locked door at the far end.",
      objectives:  ["Clear the storage room of cultist guards", "Find the hidden door at (4,2)"],
      triggerType: "ACT_START",
    },
  });

  const act1scene2 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act1.id, order: 2 } },
    update: {
      title:        "The Hidden Chamber",
      description:  "Beyond the door, arcane symbols blaze from every wall. Cultists encircle a bound figure — the innkeeper's nephew. A robed Cult Acolyte directs the ritual. The nephew's eyes plead for rescue.",
      objectives:   ["Defeat all cultists in the hidden chamber", "Defeat the Cult Acolyte to reveal the conspiracy"],
      triggerType:  "AREA_REACHED",
      triggerAreaX: 5,
      triggerAreaY: 2,
    },
    create: {
      actId:        act1.id,
      order:        2,
      title:        "The Hidden Chamber",
      description:  "Beyond the door, arcane symbols blaze from every wall. Cultists encircle a bound figure — the innkeeper's nephew. A robed Cult Acolyte directs the ritual. The nephew's eyes plead for rescue.",
      objectives:   ["Defeat all cultists in the hidden chamber", "Defeat the Cult Acolyte to reveal the conspiracy"],
      triggerType:  "AREA_REACHED",
      triggerAreaX: 5,
      triggerAreaY: 2,
    },
  });

  const act1scene3 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act1.id, order: 3 } },
    update: {
      title:       "The Nephew's Trail",
      description: "With the Acolyte fallen, the nephew is freed. Between ragged breaths he describes men in dark cloaks carrying ore samples north, toward the Thornwood shafts. The cult symbol on the wall matches the foreman's personal wax seal.",
      objectives:  ["Escort the nephew to safety via the stairs at (2,3)", "Head to Thornwood Mine"],
      triggerType: "ENEMY_DEFEATED",
    },
    create: {
      actId:       act1.id,
      order:       3,
      title:       "The Nephew's Trail",
      description: "With the Acolyte fallen, the nephew is freed. Between ragged breaths he describes men in dark cloaks carrying ore samples north, toward the Thornwood shafts. The cult symbol on the wall matches the foreman's personal wax seal.",
      objectives:  ["Escort the nephew to safety via the stairs at (2,3)", "Head to Thornwood Mine"],
      triggerType: "ENEMY_DEFEATED",
    },
  });

  // Act 1 Enemies — stable IDs make upsert idempotent on re-runs
  const cellarRat1 = await prisma.enemy.upsert({
    where:  { id: "a1s1_rat_1" },
    update: { actId: act1.id, sceneId: act1scene1.id },
    create: { id: "a1s1_rat_1", actId: act1.id, sceneId: act1scene1.id,
      name: "Cellar Rat", description: "Oversized, red-eyed — the ritual has maddened these creatures.",
      maxHp: 4,
      strength: 7, dexterity: 15, constitution: 11, intelligence: 2, wisdom: 10, charisma: 4,
      armorClass: 10, attackBonus: 0, damageDice: "1d3" },
  });
  void cellarRat1;

  const cellarRat2 = await prisma.enemy.upsert({
    where:  { id: "a1s1_rat_2" },
    update: { actId: act1.id, sceneId: act1scene1.id },
    create: { id: "a1s1_rat_2", actId: act1.id, sceneId: act1scene1.id,
      name: "Cellar Rat", description: "Oversized and feral.",
      maxHp: 4,
      strength: 7, dexterity: 15, constitution: 11, intelligence: 2, wisdom: 10, charisma: 4,
      armorClass: 10, attackBonus: 0, damageDice: "1d3" },
  });
  void cellarRat2;

  const cultistGuard = await prisma.enemy.upsert({
    where:  { id: "a1s1_cultist_guard" },
    update: { actId: act1.id, sceneId: act1scene1.id },
    create: { id: "a1s1_cultist_guard", actId: act1.id, sceneId: act1scene1.id,
      name: "Cultist Guard", description: "Hooded figure in stained leather, wielding a rusty shortsword.",
      maxHp: 16,
      strength: 13, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 9, charisma: 11,
      armorClass: 12, attackBonus: 3, damageDice: "1d6+1" },
  });
  void cultistGuard;

  await prisma.enemy.upsert({
    where:  { id: "a1s2_cultist_acolyte" },
    update: { actId: act1.id, sceneId: act1scene2.id },
    create: { id: "a1s2_cultist_acolyte", actId: act1.id, sceneId: act1scene2.id,
      name: "Cultist Acolyte", description: "A true believer, wielding dark energy with terrifying precision.",
      maxHp: 20,
      strength: 10, dexterity: 12, constitution: 12, intelligence: 14, wisdom: 13, charisma: 11,
      armorClass: 11, attackBonus: 3, damageDice: "2d6" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a1s2_cultist" },
    update: { actId: act1.id, sceneId: act1scene2.id },
    create: { id: "a1s2_cultist", actId: act1.id, sceneId: act1scene2.id,
      name: "Cultist", description: "A rank cultist armed with a dagger and blind devotion.",
      maxHp: 12,
      strength: 11, dexterity: 12, constitution: 10, intelligence: 9, wisdom: 9, charisma: 11,
      armorClass: 11, attackBonus: 2, damageDice: "1d4+1" },
  });

  const cultAcolyte = await prisma.enemy.upsert({
    where:  { id: "a1s2_boss" },
    update: { actId: act1.id, sceneId: act1scene2.id },
    create: { id: "a1s2_boss", actId: act1.id, sceneId: act1scene2.id,
      name: "Cult Acolyte [BOSS]", description: "The ritual leader. Robed in crimson, wielding a corrupted holy symbol pulsing with dark energy.",
      maxHp: 38,
      strength: 10, dexterity: 14, constitution: 13, intelligence: 15, wisdom: 16, charisma: 14,
      armorClass: 14, attackBonus: 5, damageDice: "2d8+3" },
  });

  await prisma.scene.update({ where: { id: act1scene3.id }, data: { triggerEnemyId: cultAcolyte.id } });

  // ── Act 2 ──────────────────────────────────────────────────────────────────
  console.log("ACT 2: Collapse at Thornwood Mine");

  const act2 = await prisma.act.upsert({
    where:  { storyId_order: { storyId: story.id, order: 2 } },
    update: {},
    create: {
      storyId: story.id,
      order:   2,
      title:   "Collapse at Thornwood Mine",
      summary: "The mine collapse was no accident. The foreman has been corrupted by something ancient buried in the deepest shaft — a relic that twists minds and warps flesh. The cult used the mine to excavate it. Whatever they unearthed was moved to the Proving Grounds beneath the city.",
      playerFacingDescription: "Three miners are missing after a partial collapse in the Thornwood shafts. The mining company is stalling. The families have pooled what little coin they have.",
    },
  });

  const mine = await prisma.map.upsert({
    where:  { name: "Thornwood Mine, Level 1" },
    update: { data: mineMap, actId: act2.id },
    create: { name: "Thornwood Mine, Level 1", data: mineMap, actId: act2.id },
  });
  void mine;

  const act2scene1 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act2.id, order: 1 } },
    update: {
      title:       "Into the Dark",
      description: "The mine entrance reeks of sulfur. Fresh claw marks scar the wooden beams. Cave spiders the size of dogs have claimed the entrance as their territory.",
      objectives:  ["Clear the mine entrance of cave spiders", "Advance into the main shaft"],
      triggerType: "ACT_START",
    },
    create: {
      actId:       act2.id,
      order:       1,
      title:       "Into the Dark",
      description: "The mine entrance reeks of sulfur. Fresh claw marks scar the wooden beams. Cave spiders the size of dogs have claimed the entrance as their territory.",
      objectives:  ["Clear the mine entrance of cave spiders", "Advance into the main shaft"],
      triggerType: "ACT_START",
    },
  });

  const act2scene2 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act2.id, order: 2 } },
    update: {
      title:        "The Deep Shaft",
      description:  "The deep excavation is catastrophically wrong. Three miners hang suspended in tendrils of black crystal. The foreman stands at the center — eyes white, flesh partially crystallized — reciting cult scripture. Corrupted miners shamble at his command.",
      objectives:   ["Defeat the corrupted miners", "Defeat the Mine Foreman to free the prisoners"],
      triggerType:  "AREA_REACHED",
      triggerAreaX: 8,
      triggerAreaY: 4,
    },
    create: {
      actId:        act2.id,
      order:        2,
      title:        "The Deep Shaft",
      description:  "The deep excavation is catastrophically wrong. Three miners hang suspended in tendrils of black crystal. The foreman stands at the center — eyes white, flesh partially crystallized — reciting cult scripture. Corrupted miners shamble at his command.",
      objectives:   ["Defeat the corrupted miners", "Defeat the Mine Foreman to free the prisoners"],
      triggerType:  "AREA_REACHED",
      triggerAreaX: 8,
      triggerAreaY: 4,
    },
  });

  const act2scene3 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act2.id, order: 3 } },
    update: {
      title:       "Reckoning Underground",
      description: "As the foreman collapses, the crystal tendrils shatter. The miners drop, alive. Ancient runes carved into the bedrock glow briefly before fading. A passage, previously sealed, grinds open in the eastern wall.",
      objectives:  ["Tend to the freed miners", "Follow the eastern passage toward the Proving Grounds"],
      triggerType: "ENEMY_DEFEATED",
    },
    create: {
      actId:       act2.id,
      order:       3,
      title:       "Reckoning Underground",
      description: "As the foreman collapses, the crystal tendrils shatter. The miners drop, alive. Ancient runes carved into the bedrock glow briefly before fading. A passage, previously sealed, grinds open in the eastern wall.",
      objectives:  ["Tend to the freed miners", "Follow the eastern passage toward the Proving Grounds"],
      triggerType: "ENEMY_DEFEATED",
    },
  });

  // Act 2 Enemies
  const spider1 = await prisma.enemy.upsert({
    where:  { id: "a2s1_spider_1" },
    update: { actId: act2.id, sceneId: act2scene1.id },
    create: { id: "a2s1_spider_1", actId: act2.id, sceneId: act2scene1.id,
      name: "Cave Spider", description: "Dog-sized, fanged, venom dripping.",
      maxHp: 11,
      strength: 12, dexterity: 16, constitution: 13, intelligence: 3, wisdom: 12, charisma: 4,
      armorClass: 13, attackBonus: 3, damageDice: "1d6+1" },
  });
  void spider1;

  const spider2 = await prisma.enemy.upsert({
    where:  { id: "a2s1_spider_2" },
    update: { actId: act2.id, sceneId: act2scene1.id },
    create: { id: "a2s1_spider_2", actId: act2.id, sceneId: act2scene1.id,
      name: "Cave Spider", description: "Dog-sized, fanged, venom dripping.",
      maxHp: 11,
      strength: 12, dexterity: 16, constitution: 13, intelligence: 3, wisdom: 12, charisma: 4,
      armorClass: 13, attackBonus: 3, damageDice: "1d6+1" },
  });
  void spider2;

  const tunnelRat = await prisma.enemy.upsert({
    where:  { id: "a2s1_tunnel_rat" },
    update: { actId: act2.id, sceneId: act2scene1.id },
    create: { id: "a2s1_tunnel_rat", actId: act2.id, sceneId: act2scene1.id,
      name: "Tunnel Rat", description: "Mutated by the dark crystal's influence — three times normal size.",
      maxHp: 7,
      strength: 9, dexterity: 15, constitution: 12, intelligence: 2, wisdom: 10, charisma: 4,
      armorClass: 11, attackBonus: 1, damageDice: "1d4" },
  });
  void tunnelRat;

  await prisma.enemy.upsert({
    where:  { id: "a2s2_miner_1" },
    update: { actId: act2.id, sceneId: act2scene2.id },
    create: { id: "a2s2_miner_1", actId: act2.id, sceneId: act2scene2.id,
      name: "Corrupted Miner", description: "A former miner, now half-crystalline. His pickaxe arm has fused into a weapon.",
      maxHp: 22,
      strength: 16, dexterity: 9, constitution: 15, intelligence: 6, wisdom: 7, charisma: 5,
      armorClass: 11, attackBonus: 4, damageDice: "1d8+3" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a2s2_miner_2" },
    update: { actId: act2.id, sceneId: act2scene2.id },
    create: { id: "a2s2_miner_2", actId: act2.id, sceneId: act2scene2.id,
      name: "Corrupted Miner", description: "A former miner, now half-crystalline.",
      maxHp: 22,
      strength: 16, dexterity: 9, constitution: 15, intelligence: 6, wisdom: 7, charisma: 5,
      armorClass: 11, attackBonus: 4, damageDice: "1d8+3" },
  });

  const mineForeman = await prisma.enemy.upsert({
    where:  { id: "a2s2_foreman" },
    update: { actId: act2.id, sceneId: act2scene2.id },
    create: { id: "a2s2_foreman", actId: act2.id, sceneId: act2scene2.id,
      name: "Mine Foreman [BOSS]", description: "Fully corrupted. His body is wrapped in black crystal shards. His voice resonates with the relic's power.",
      maxHp: 58,
      strength: 18, dexterity: 10, constitution: 16, intelligence: 12, wisdom: 14, charisma: 9,
      armorClass: 16, attackBonus: 6, damageDice: "2d8+4" },
  });
  void mineForeman;

  await prisma.scene.update({ where: { id: act2scene3.id }, data: { triggerEnemyId: mineForeman.id } });

  // ── Act 3 ──────────────────────────────────────────────────────────────────
  console.log("ACT 3: The Proving Grounds");

  const act3 = await prisma.act.upsert({
    where:  { storyId_order: { storyId: story.id, order: 3 } },
    update: {},
    create: {
      storyId: story.id,
      order:   3,
      title:   "The Proving Grounds",
      summary: "The Proving Grounds is the cult's final sanctum — a gladiatorial arena where they test worthy champions to serve as vessels for the relic's power. The architect who founded Thornwood built it in secret. The same architect whose bloodline runs the mining company today.",
      playerFacingDescription: "Beneath Thornwood, a hidden arena has waited centuries for this moment. The cult wanted you here all along. The final trial begins.",
    },
  });

  const arena = await prisma.map.upsert({
    where:  { name: "Proving Grounds Arena" },
    update: { data: arenaMap, actId: act3.id },
    create: { name: "Proving Grounds Arena", data: arenaMap, actId: act3.id },
  });
  void arena;

  const act3scene1 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act3.id, order: 1 } },
    update: {
      title:       "Trial by Fire",
      description: "Torchlight floods the arena as iron gates crash open. Arena guards surge forward — disciplined, well-armored, and ruthless. The crowd is silent. Watching.",
      objectives:  ["Defeat the first wave of arena guards", "Survive the Trial by Fire"],
      triggerType: "ACT_START",
    },
    create: {
      actId:       act3.id,
      order:       1,
      title:       "Trial by Fire",
      description: "Torchlight floods the arena as iron gates crash open. Arena guards surge forward — disciplined, well-armored, and ruthless. The crowd is silent. Watching.",
      objectives:  ["Defeat the first wave of arena guards", "Survive the Trial by Fire"],
      triggerType: "ACT_START",
    },
  });

  const act3scene2 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act3.id, order: 2 } },
    update: {
      title:            "Champions' Gauntlet",
      description:      "Heavier gates grind open. Elite champions stride out — battle-hardened veterans who have survived this arena for years. A shadow moves behind the judge's throne. The architect is here, watching.",
      objectives:       ["Defeat the arena champions", "Outlast the gauntlet — the architect will reveal himself"],
      triggerType:      "TURN_LIMIT",
      triggerTurnLimit: 40,
    },
    create: {
      actId:            act3.id,
      order:            2,
      title:            "Champions' Gauntlet",
      description:      "Heavier gates grind open. Elite champions stride out — battle-hardened veterans who have survived this arena for years. A shadow moves behind the judge's throne. The architect is here, watching.",
      objectives:       ["Defeat the arena champions", "Outlast the gauntlet — the architect will reveal himself"],
      triggerType:      "TURN_LIMIT",
      triggerTurnLimit: 40,
    },
  });

  const act3scene3 = await prisma.scene.upsert({
    where:  { actId_order: { actId: act3.id, order: 3 } },
    update: {
      title:       "The Final Stand",
      description: "The herald tears off his mask — beneath it is an ancient face, impossibly preserved, carved with the same rune that ran through the mine. He is the Thornwood Architect: the cult's founder, kept alive for centuries by the relic's power. The final battle begins.",
      objectives:  ["Defeat the Thornwood Architect", "Destroy the relic and end the curse"],
      triggerType: "ENEMY_DEFEATED",
    },
    create: {
      actId:       act3.id,
      order:       3,
      title:       "The Final Stand",
      description: "The herald tears off his mask — beneath it is an ancient face, impossibly preserved, carved with the same rune that ran through the mine. He is the Thornwood Architect: the cult's founder, kept alive for centuries by the relic's power. The final battle begins.",
      objectives:  ["Defeat the Thornwood Architect", "Destroy the relic and end the curse"],
      triggerType: "ENEMY_DEFEATED",
    },
  });

  // Act 3 Enemies
  await prisma.enemy.upsert({
    where:  { id: "a3s1_guard_1" },
    update: { actId: act3.id, sceneId: act3scene1.id },
    create: { id: "a3s1_guard_1", actId: act3.id, sceneId: act3scene1.id,
      name: "Arena Guard", description: "Trained gladiatorial enforcer in heavy leather, armed with a spear.",
      maxHp: 26,
      strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 11, charisma: 9,
      armorClass: 14, attackBonus: 4, damageDice: "1d8+2" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a3s1_guard_2" },
    update: { actId: act3.id, sceneId: act3scene1.id },
    create: { id: "a3s1_guard_2", actId: act3.id, sceneId: act3scene1.id,
      name: "Arena Guard", description: "Trained gladiatorial enforcer in heavy leather, armed with a spear.",
      maxHp: 26,
      strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 11, charisma: 9,
      armorClass: 14, attackBonus: 4, damageDice: "1d8+2" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a3s1_brute" },
    update: { actId: act3.id, sceneId: act3scene1.id },
    create: { id: "a3s1_brute", actId: act3.id, sceneId: act3scene1.id,
      name: "Arena Brute", description: "A mountain of muscle carrying a greatclub. Slow but devastating.",
      maxHp: 42,
      strength: 19, dexterity: 9, constitution: 16, intelligence: 7, wisdom: 9, charisma: 7,
      armorClass: 12, attackBonus: 5, damageDice: "2d8+4" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a3s2_champion" },
    update: { actId: act3.id, sceneId: act3scene2.id },
    create: { id: "a3s2_champion", actId: act3.id, sceneId: act3scene2.id,
      name: "Arena Champion", description: "A seasoned gladiator, every scar a lesson in survival.",
      maxHp: 48,
      strength: 17, dexterity: 15, constitution: 15, intelligence: 12, wisdom: 13, charisma: 13,
      armorClass: 16, attackBonus: 6, damageDice: "1d8+3" },
  });

  await prisma.enemy.upsert({
    where:  { id: "a3s2_elite_guard" },
    update: { actId: act3.id, sceneId: act3scene2.id },
    create: { id: "a3s2_elite_guard", actId: act3.id, sceneId: act3scene2.id,
      name: "Elite Guard", description: "Wears the arena master's seal. Has never lost.",
      maxHp: 36,
      strength: 16, dexterity: 14, constitution: 14, intelligence: 11, wisdom: 12, charisma: 10,
      armorClass: 15, attackBonus: 5, damageDice: "1d10+3" },
  });

  const shadowAssassin = await prisma.enemy.upsert({
    where:  { id: "a3s2_assassin" },
    update: { actId: act3.id, sceneId: act3scene2.id },
    create: { id: "a3s2_assassin", actId: act3.id, sceneId: act3scene2.id,
      name: "Shadow Assassin", description: "The architect's personal enforcer. Emerges from the shadows at the gauntlet's peak.",
      maxHp: 55,
      strength: 14, dexterity: 18, constitution: 14, intelligence: 14, wisdom: 13, charisma: 12,
      armorClass: 17, attackBonus: 7, damageDice: "2d6+4" },
  });

  await prisma.scene.update({ where: { id: act3scene3.id }, data: { triggerEnemyId: shadowAssassin.id } });

  await prisma.enemy.upsert({
    where:  { id: "a3s3_architect" },
    update: { actId: act3.id, sceneId: act3scene3.id },
    create: { id: "a3s3_architect", actId: act3.id, sceneId: act3scene3.id,
      name: "Thornwood Architect [FINAL BOSS]", description: "The cult founder, preserved for centuries by the relic. His touch drains life. His words command the darkness itself.",
      maxHp: 120,
      strength: 16, dexterity: 14, constitution: 18, intelligence: 20, wisdom: 17, charisma: 18,
      armorClass: 18, attackBonus: 9, damageDice: "3d8+5" },
  });

  // ── Trigger Guide ──────────────────────────────────────────────────────────
  console.log("\n=== TRIGGER GUIDE ===");
  console.log("(How to advance through acts and scenes during testing)\n");

  console.log("ACT 1 — Abandoned Cellar (10×5 grid)");
  console.log(`  [Scene 1] "A Cellar Full of Secrets"  → AUTO-STARTS when you begin the game`);
  console.log(`            Enemies: Cellar Rat @(2,2), Cellar Rat @(3,2), Cultist Guard @(2,3)`);
  console.log(`  [Scene 2] "The Hidden Chamber"         → MOVE to tile (${act1scene2.triggerAreaX},${act1scene2.triggerAreaY}) — pass through the hidden door`);
  console.log(`            Enemies: Cultist Acolyte @(6,2), Cultist @(8,2), Cult Acolyte BOSS @(7,1)`);
  console.log(`  [Scene 3] "The Nephew's Trail"         → DEFEAT Cult Acolyte BOSS @(7,1)`);
  console.log(`  → ACT 2 unlocks after Scene 3 completes\n`);

  console.log("ACT 2 — Thornwood Mine (12×7 grid)");
  console.log(`  [Scene 1] "Into the Dark"              → AUTO-STARTS`);
  console.log(`            Enemies: Cave Spider @(1,2), Cave Spider @(2,2), Tunnel Rat @(3,2)`);
  console.log(`  [Scene 2] "The Deep Shaft"             → MOVE to tile (${act2scene2.triggerAreaX},${act2scene2.triggerAreaY}) — reach the deep excavation through the reinforced hatch`);
  console.log(`            Enemies: Corrupted Miner @(5,3), Corrupted Miner @(6,3), Mine Foreman BOSS @(9,5)`);
  console.log(`  [Scene 3] "Reckoning Underground"      → DEFEAT Mine Foreman BOSS @(9,5)`);
  console.log(`  → ACT 3 unlocks after Scene 3 completes\n`);

  console.log("ACT 3 — Proving Grounds Arena (6×4 grid)");
  console.log(`  [Scene 1] "Trial by Fire"              → AUTO-STARTS`);
  console.log(`            Enemies: Arena Guard @(1,2), Arena Guard @(4,2), Arena Brute @(2,1)`);
  console.log(`  [Scene 2] "Champions' Gauntlet"        → AUTOMATIC after ${act3scene2.triggerTurnLimit} turns (AI DM forces the transition)`);
  console.log(`            Enemies: Arena Champion @(1,2), Elite Guard @(4,1), Shadow Assassin @(3,2)`);
  console.log(`  [Scene 3] "The Final Stand"            → DEFEAT Shadow Assassin @(3,2)`);
  console.log(`            Enemies: Thornwood Architect FINAL BOSS @(2,2)`);

  console.log("\n=== Done. 1 story · 3 acts · 9 scenes · 16 enemies ===\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
