import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

config({ path: ".env.local" });

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🧼 Clearing old data...");
  // Delete in dependency order (children first)
  await prisma.activeTurnQueue.deleteMany();
  await prisma.combatSession.deleteMany();
  await prisma.pendingRoll.deleteMany();
  await prisma.message.deleteMany();
  await prisma.partyMember.deleteMany();
  await prisma.gameMap.deleteMany();
  await prisma.game.deleteMany();
  // V2 instance tables (templates are stable — seeded with fixed IDs, never deleted)
  await prisma.messageLog.deleteMany();
  await prisma.roomParticipant.deleteMany();
  await prisma.poiInstance.deleteMany();
  await prisma.roomInstance.deleteMany();
  await prisma.gameSession.deleteMany();
  await prisma.classFeature.deleteMany();
  await prisma.classProgression.deleteMany();
  await prisma.enemy.deleteMany();
  await prisma.scene.deleteMany();
  await prisma.map.deleteMany();
  await prisma.act.deleteMany();
  await prisma.story.deleteMany();
  await prisma.character.deleteMany();
  await prisma.user.deleteMany();
  await prisma.item.deleteMany();

  // ─── Items ─────────────────────────────────────────────────────────────────
  console.log("⚔️  Seeding items...");

  const shortSword = await prisma.item.create({
    data: {
      name: "Short Sword",
      type: "WEAPON",
      category: "Martial",
      description: "A light, fast blade favored by rogues and scouts.",
      weightLbs: 2,
      weaponType: "melee",
      rangeFeet: 5,
      damageDice: "1d6",
      attackBonus: 2,
      combatImpactLabel: "+2 to hit, 1d6+2 piercing",
      interactionTags: ["piercing"],
    },
  });

  const warhammer = await prisma.item.create({
    data: {
      name: "Warhammer",
      type: "WEAPON",
      category: "Martial",
      description: "A heavy hammer capable of demolishing barriers as well as bones.",
      weightLbs: 5,
      weaponType: "melee",
      rangeFeet: 5,
      damageDice: "1d8",
      attackBonus: 3,
      combatImpactLabel: "+3 to hit, 1d8+3 bludgeoning",
      interactionTags: ["blunt", "heavy_demolition"],
    },
  });

  const leatherArmor = await prisma.item.create({
    data: {
      name: "Leather Armor",
      type: "ARMOR",
      category: "Light Armor",
      description: "Cured leather formed into a protective vest.",
      weightLbs: 10,
      combatImpactLabel: "AC 11 + Dex modifier",
    },
  });

  const ironKey = await prisma.item.create({
    data: {
      name: "Iron Key",
      type: "MISC",
      category: "Key",
      description: "A heavy iron key etched with a crown symbol.",
      weightLbs: 0.1,
      keyId: "cellar_key_01",
    },
  });

  const ratClaws = await prisma.item.create({
    data: {
      name: "Giant Rat Claws",
      type: "MISC",
      category: "Trophy",
      description: "Glistening claws stripped from a defeated giant rat.",
      weightLbs: 0.2,
    },
  });

  // ─── Class Progressions ────────────────────────────────────────────────────
  console.log("📖 Seeding class progressions...");

  for (let lvl = 1; lvl <= 5; lvl++) {
    const profBonus = lvl <= 4 ? 2 : 3;
    await prisma.classProgression.create({
      data: {
        characterClass: "Fighter",
        level: lvl,
        proficiencyBonus: profBonus,
        featuresUnlocked: lvl === 1 ? ["Second Wind"] : lvl === 2 ? ["Action Surge"] : [],
        resourcePoolMax: lvl >= 2 ? 1 : null,
      },
    });
  }
  await prisma.classFeature.create({
    data: {
      characterClass: "Fighter",
      level: 1,
      name: "Second Wind",
      description: "Regain 1d10 + Fighter level HP as a bonus action, once per rest.",
      icon: "🌬️",
      costType: "bonus_action",
    },
  });
  await prisma.classFeature.create({
    data: {
      characterClass: "Fighter",
      level: 2,
      name: "Action Surge",
      description: "Take one additional action on your turn, once per rest.",
      icon: "⚡",
      costType: "free",
    },
  });

  // ─── Story ─────────────────────────────────────────────────────────────────
  console.log("📜 Seeding story...");

  const story = await prisma.story.create({
    data: {
      title: "The Sunken Cellar",
      description: "A merchant's cellar beneath Thornfield Village has gone silent. Rats, shadows, and something worse lurk below.",
      difficulty: "Standard",
    },
  });

  // Act 1
  const act1 = await prisma.act.create({
    data: {
      storyId: story.id,
      order: 1,
      title: "Into the Dark",
      summary: "The party descends into the merchant's cellar to investigate strange disappearances.",
      playerFacingDescription:
        "The wooden hatch creaks open. The smell of mildew and copper hits you before you even reach the bottom rung.",
    },
  });

  // Map — 7×7 template. Tiles use MapTile format: { t, enemy?, item? }
  // Layout (y=row, x=col):
  //   Row 0: all walls
  //   Row 1: W F F [D] F  F  W   ← iron door at (3,1), locked
  //   Row 2: W F F  F  F  F  W
  //   Row 3: W F F  F  F [🔨]W   ← warhammer ground item at (5,3)
  //   Row 4: W F F [🐀]F  F  W   ← giant rat spawn at (3,4)
  //   Row 5: W F F  F  F  F  W
  //   Row 6: all walls
  const act1Map = await prisma.map.create({
    data: {
      name: "Merchant's Cellar",
      actId: act1.id,
      data: {
        width: 7,
        height: 7,
        playerStart: { x: 1, y: 1 },
        rooms: [
          {
            name: "Entry Alcove",
            description: "A cramped landing at the base of the stairs. Barrels are stacked against the east wall.",
          },
          {
            name: "Storage Chamber",
            description: "Wide shelves of rotting crates line the walls. A locked iron door leads north.",
          },
        ],
        pois: [
          {
            id: "poi-crate-1",
            name: "Battered Crate",
            x: 2,
            y: 2,
            symbol: "C",
            isContainer: true,
            containerInventory: [
              { itemId: ironKey.id,  investigationAc: 10 },
              { itemId: ratClaws.id, investigationAc: 0  },
            ],
          },
          {
            id: "poi-door-1",
            name: "Iron Cellar Door",
            x: 3,
            y: 1,
            symbol: "D",
            maxHp: 15,
            armorClass: 13,
            damageThreshold: 5,
            lockId: "cellar_key_01",
            eligibleInteractions: ["tool_demolition", "strength_bash"],
            effectiveTools: ["blunt"],
          },
        ],
        tiles: [
          [{ t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "D" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F", item: warhammer.id }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F", enemy: "e1-rat-1" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "F" }, { t: "W" }],
          [{ t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }, { t: "W" }],
        ],
      },
    },
  });

  // Scenes
  const scene1 = await prisma.scene.create({
    data: {
      actId: act1.id,
      order: 1,
      title: "The Entry Alcove",
      description:
        "You land in a cramped alcove. Barrels line the east wall. A scrabbling sound echoes from deeper in the cellar. An iron door to the north is locked.",
      objectives: ["Explore the cellar", "Find out what happened to the merchant's workers"],
      triggerType: "ACT_START",
    },
  });

  const scene2 = await prisma.scene.create({
    data: {
      actId: act1.id,
      order: 2,
      title: "The Rat Nest",
      description:
        "Deeper in, the floor is carpeted with gnawed bones and shredded cloth. A massive dire rat rears up from the shadows.",
      objectives: ["Defeat the dire rat", "Search for the missing workers"],
      triggerType: "AREA_REACHED",
      triggerAreaX: 3,
      triggerAreaY: 4,
    },
  });

  // Enemies — e1-rat-1 ID matches the tile spawn reference above
  const rat1 = await prisma.enemy.create({
    data: {
      id: "e1-rat-1",
      actId: act1.id,
      sceneId: scene1.id,
      name: "Giant Rat",
      description: "A rat the size of a terrier, maddened by hunger.",
      maxHp: 7,
      strength: 7,
      dexterity: 15,
      constitution: 11,
      intelligence: 2,
      wisdom: 10,
      charisma: 4,
      armorClass: 12,
      attackBonus: 4,
      damageDice: "1d4+2",
      mainHandId: ratClaws.id,
    },
  });

  const rat2 = await prisma.enemy.create({
    data: {
      actId: act1.id,
      sceneId: scene2.id,
      name: "Dire Rat",
      description: "A hulking specimen with yellow teeth the length of fingers.",
      maxHp: 14,
      strength: 10,
      dexterity: 12,
      constitution: 12,
      intelligence: 2,
      wisdom: 10,
      charisma: 4,
      armorClass: 11,
      attackBonus: 3,
      damageDice: "1d6+2",
    },
  });

  // ─── User & Character ──────────────────────────────────────────────────────
  console.log("🧙 Seeding user and character...");

  const testUser = await prisma.user.create({
    data: {
      email: "test@example.com",
      displayName: "Test Player",
    },
  });

  const testChar = await prisma.character.create({
    data: {
      name: "Aldric",
      userId: testUser.id,
      characterClass: "Fighter",
      baseStrength: 16,
      baseDexterity: 13,
      baseConstitution: 14,
      baseIntelligence: 10,
      baseWisdom: 12,
      baseCharisma: 8,
      xp: 0,
      level: 1,
      maxHp: 12,
      currentHp: 12,
      skillProficiencies: ["Athletics", "Intimidation"],
      mainHandId: shortSword.id,
      armorId: leatherArmor.id,
      remainingActions: 1,
      remainingBonusActions: 1,
      remainingMovementFeet: 30,
      remainingReactions: 1,
      remainingObjectInteractions: 1,
      posX: 1,
      posY: 1,
    },
  });

  // ─── Game ──────────────────────────────────────────────────────────────────
  console.log("🎲 Seeding game...");

  const game = await prisma.game.create({
    data: {
      characterId: testChar.id,
      storyId: story.id,
      currentActId: act1.id,
      currentSceneId: scene1.id,
      status: "ACTIVE",
      phase: "ACTIVE",
      state: {
        hp: 12,
        maxHp: 12,
        playerPos: { x: 1, y: 1 },
        enemies: [
          { id: rat1.id, name: "Giant Rat", hp: 7, maxHp: 7, x: 3, y: 4 },
        ],
        narrative_history: ["The hatch slams shut above you. You are alone in the dark."],
        active_suggestion_chips: [],
        consecutiveMisses: 0,
      },
      worldState: {
        activeObjective: "Explore the cellar",
        plotFlags: [],
        consecutiveMisses: 0,
        npcsEncountered: [],
      },
    },
  });

  // ─── V2: Dungeon Template & Rooms ─────────────────────────────────────────
  console.log("🏰 Seeding V2 dungeon template...");

  const dungeonTemplate = await prisma.dungeonTemplate.upsert({
    where: { id: "11111111-1111-1111-1111-111111111111" },
    create: {
      id: "11111111-1111-1111-1111-111111111111",
      name: "The Sunken Cellar",
      globalStyle: "Damp Stone Dungeon",
      synopsis: "Thornfield's most trusted merchant has gone silent. Workers sent to investigate his cellar never returned — and now strange sounds echo beneath the market square at night. You've been hired to find out what lurks below, but the deeper you descend, the more it becomes clear that something far older than missing workers is stirring in the dark.",
      difficulty: "Standard",
      length: "Short",
      tone: "Dark Fantasy",
      startRoomTemplateId: "22222222-2222-2222-2222-222222222222",
    },
    update: {
      synopsis: "Thornfield's most trusted merchant has gone silent. Workers sent to investigate his cellar never returned — and now strange sounds echo beneath the market square at night. You've been hired to find out what lurks below, but the deeper you descend, the more it becomes clear that something far older than missing workers is stirring in the dark.",
      difficulty: "Standard",
      length: "Short",
      tone: "Dark Fantasy",
      startRoomTemplateId: "22222222-2222-2222-2222-222222222222",
    },
  });

  const roomTemplate = await prisma.roomTemplate.upsert({
    where: { id: "22222222-2222-2222-2222-222222222222" },
    create: {
      id: "22222222-2222-2222-2222-222222222222",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Entry Chamber",
      baseDescription:
        "A low-ceilinged stone chamber. Torchlight wavers across damp walls. A stone fountain dominates the northwest corner, and a heavy wooden barricade blocks the western passage. An iron pillar near the northeastern wall bears deep claw marks. A wide archway to the east opens into the armory. A dark passage to the north leads deeper into the cellar.",
      searchFailureNarrative:
        "You sweep the chamber but find nothing beyond dust and the smell of old water.",
      map_x: 0,
      map_y: 0,
    },
    update: {
      map_x: 0,
      map_y: 0,
      baseDescription:
        "A low-ceilinged stone chamber. Torchlight wavers across damp walls. A stone fountain dominates the northwest corner, and a heavy wooden barricade blocks the western passage. An iron pillar near the northeastern wall bears deep claw marks. A wide archway to the east opens into the armory. A dark passage to the north leads deeper into the cellar.",
    },
  });

  const entryChamberPois = [
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "Stone Fountain",
      keywordIdentifier: "fountain",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A broad stone basin, long unused. A shallow pool of stagnant water has collected at the bottom from ceiling seepage. Faint angular runes ring the interior lip, worn smooth by many hands.",
        examine_details: [
          { skill: "religion", dc: 12, text: "The runes are a supplication to Bane, god of tyranny — a prayer for dominion over the weak." },
          { skill: "investigation", dc: 15, text: "Fresh candle wax is pooled at the basin's base. Someone performed a ritual here recently." },
          { skill: "investigation", dc: 12, text: "The basin drains through a narrow pipe set into the west wall near the base. The pipe is wide enough for a careful arm. It connects to a stone shelf above the waterline in the flooded passage." },
        ],
        perception_details: [
          { dc: 10, text: "Wax residue coats the basin lip — candles were burned here recently." },
          { dc: 14, text: "A single dark hair is caught in a rune groove. Someone knelt over this basin within the last few days." },
        ],
        interact_options: [
          {
            label: "Drink from the collected water",
            random_outcome: {
              dice: "1d6",
              check_first: { skill: "nature", dc: 12, reveal: "The water has a faint sulphurous tint. Drinking it unexamined would be unwise." },
              outcomes: [
                { range: [1, 3], narrative: "The water is brackish and foul. Something in it disagrees with you immediately.", effect: "curse_next_death_save_disadvantage" },
                { range: [4, 5], narrative: "It tastes of old stone and nothing else. Nothing happens.", effect: null },
                { range: [6, 6], narrative: "Cold and unexpectedly clean — almost supernaturally so. A faint warmth spreads through your chest.", effect: "heal_1d4" },
              ],
            },
          },
          {
            label: "Reach into the drain pipe",
            check: { skill: "athletics", dc: 10, note: "Small characters succeed automatically" },
            success: "Your arm reaches along a stone shelf above the waterline and closes around a waterproof satchel — stashed here deliberately, well above any flood level.",
            success_items: [
              { id: "pipe_gold", name: "15 Gold Pieces", throwable: true, value_gp: 15, obvious: true },
              { id: "pipe_dagger", name: "Explorer's Dagger", equip_slot: "main_hand", throwable: true, attack_bonus: 1, damage_dice: "1d4", obvious: true },
              { id: "grocery_list", name: "Mundane Grocery List", throwable: false, obvious: true },
            ],
            failure: "The pipe is too tight for your arm. A smaller character might manage it.",
          },
        ],
        climb:       { resulting_stance: "elevated_ground" },
        hide_behind: { resulting_stance: "crouching" },
        items: [
          {
            id: "healing_vial",
            name: "Healing Vial",
            consumable: true,
            throwable: true,
            use_effect: "heal_4",
            hidden: true,
            reveal_check: { skill: "perception", dc: 10 },
          },
          {
            id: "silver_ring",
            name: "Silver Ring",
            equip_slot: "ring",
            throwable: true,
            value_gp: 8,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 11 },
          },
        ],
      },
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      name: "Wooden Barricade",
      keywordIdentifier: "barricade",
      grid_slot: "W",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "Rough-hewn planks nailed in haste. Dark stains seep between the boards — old blood, or pitch.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The planks are cracked near the base. A hard kick might bring the whole thing down." },
          { skill: "investigation", dc: 14, text: "Scratch marks on the floor show the barricade was dragged here from the western alcove — something was sealed in, not out." },
        ],
        perception_details: [
          { dc: 10, text: "The bloodstains have browned and cracked — at least a week old, maybe more." },
          { dc: 14, text: "Fresh scrape marks on the floor near the base suggest the barricade was shifted again very recently." },
        ],
        hide_behind:  { resulting_stance: "behind_cover" },
        peek_around:  { resulting_stance: "flanking_position" },
        items: [
          {
            id: "old_dagger",
            name: "Old Dagger",
            equip_slot: "main_hand",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 8 },
          },
          {
            id: "carved_token",
            name: "Carved Token",
            throwable: true,
            hidden: true,
            story_flag: "faction_sigil",
            reveal_check: { skill: "investigation", dc: 15 },
          },
        ],
      },
    },
    {
      id: "55555555-5555-5555-5555-555555555555",
      name: "Iron Pillar",
      keywordIdentifier: "pillar",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "A thick iron pillar bolted to the floor. Deep parallel gouges run from knee-height to the ceiling.",
        examine_details: [
          { skill: "nature", dc: 11, text: "The claw marks are from something large — wider than any wolf. The spacing suggests a creature that walks upright." },
          { skill: "investigation", dc: 14, text: "The gouges are fresh. Fragments of iron dust still cling to the deepest cuts." },
        ],
        perception_details: [
          { dc: 10, text: "The claw marks carry a faint animal musk — whatever made them passed through not long ago." },
          { dc: 14, text: "A dark smear at the pillar's base, low to the ground — pitch or alchemist's fire, still slightly tacky." },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        climb:      { resulting_stance: "elevated_ground" },
        items: [
          {
            id: "coin_pouch",
            name: "Coin Pouch",
            throwable: true,
            value_gp: 5,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 12 },
          },
        ],
      },
    },
    {
      id: "66666666-6666-6666-6666-666666666666",
      name: "Dark Passage North",
      keywordIdentifier: "passage",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "77777777-7777-7777-7777-777777777777" },
        perception_details: [
          { dc: 10, text: "Cold air seeps through the gap — the space beyond is lower and wetter than this chamber." },
          { dc: 14, text: "A faint rhythmic dripping echoes through the passage, too steady to be random water movement." },
        ],
      },
    },
    {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      name: "Wide Archway East",
      keywordIdentifier: "archway",
      grid_slot: "E",
      visibility_level: 2,
      exit_direction: "E",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "obvious_only",
        stand_at:     { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
        perception_details: [
          { dc: 10, text: "The faint smell of weapon oil drifts from the chamber to the east." },
          { dc: 14, text: "Dust on the threshold is scuffed in two directions — someone passed through recently, moving quickly." },
        ],
      },
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The flagstones near the north wall sound hollow when stepped on." },
          { dc: 14, text: "A faint chemical smell lingers near the center of the room — something was spilled here and mopped up." },
        ],
        items: [
          {
            id: "loose_stone",
            name: "Loose Stone",
            throwable: true,
            improvised: true,
            obvious: true,
          },
          {
            id: "thieves_tools",
            name: "Thieves' Tools",
            use_effect: "lockpick",
            obvious: true,
          },
        ],
      },
    },
  ];

  for (const poi of entryChamberPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: roomTemplate.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Flooded Passage (north of Entry) ────────────────────────────────
  const floodedPassage = await prisma.roomTemplate.upsert({
    where: { id: "77777777-7777-7777-7777-777777777777" },
    create: {
      id: "77777777-7777-7777-7777-777777777777",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Flooded Passage",
      baseDescription:
        "A long stone corridor half-submerged in black, knee-deep water. The ceiling drips steadily. A collapsed pillar leans against the eastern wall, its carved surface thick with algae. At the far end, a stagnant pool glimmers faintly in the dark. A rusted iron gate to the south leads back to the entry chamber.",
      searchFailureNarrative:
        "You wade through the cold water and find nothing but slick stone and the smell of rot.",
      map_x: 0,
      map_y: -1,
    },
    update: { map_x: 0, map_y: -1 },
  });

  const floodedPassagePois = [
    {
      id: "88888888-8888-8888-8888-888888888888",
      name: "Collapsed Pillar",
      keywordIdentifier: "pillar",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "positional",
        visibility: "always",
        examine_text: "A broad stone pillar snapped at the base, leaning against the eastern wall. Algae coats every surface; old carved script runs along the shaft.",
        examine_details: [
          { skill: "history", dc: 13, text: "The script is Old Imperial — a dedication to a garrison commander named Arev the Steadfast. This was once a fortified military outpost. A secondary inscription below, in a different hand, appears to be a ritual notation of some kind." },
          { skill: "arcana", dc: 14, text: "Below the dedication, a second inscription: a pre-Imperial ward phrase — 'Varath vel anath korum' — used to anchor a binding and protect the binder from compulsion corruption. Knowing this phrase provides a foundation for completing the vault's binding seal.", story_flag: "ward_phrase_known" },
          { skill: "perception", dc: 11, text: "A thin crack runs along the pillar's underside. Something is wedged into the gap." },
        ],
        perception_details: [
          { dc: 10, text: "The algae on the eastern face is smeared in a long streak — something brushed against it recently." },
          { dc: 14, text: "Beneath the algae, faint chisel marks form a row of numbers: a supply inventory count, partially legible." },
        ],
        interact_options: [
          {
            label: "Read the inscription backwards",
            easter_egg: true,
            narrative: "You reverse the syllables aloud. The algae on the pillar vibrates faintly. A single bubble rises from the water below your feet. Nothing else happens — but you feel briefly certain that something heard you.",
          },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        climb:      { resulting_stance: "elevated_ground" },
        items: [
          {
            id: "iron_key",
            name: "Iron Key",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 12 },
          },
          {
            id: "dried_herb",
            name: "Dried Herb Bundle",
            throwable: true,
            hidden: true,
            consumable: true,
            use_effect: "heal_2",
            reveal_check: { skill: "investigation", dc: 10 },
          },
        ],
      },
    },
    {
      id: "99999999-9999-9999-9999-999999999999",
      name: "Stagnant Pool",
      keywordIdentifier: "pool",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Still, black water. A faint phosphorescence pulses near the bottom — something glimmers just below the surface.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The glow comes from a small object resting in the silt, partially buried." },
          { skill: "nature", dc: 13, text: "The bioluminescence matches cave moss that only grows near underground springs. This pool connects to a deeper water source." },
          { skill: "investigation", dc: 12, text: "The journal's author was an occultist who worked in this cellar decades ago. The final readable entry describes a failed attempt to bind an entity named Varath, and a key insight: 'It cannot manipulate one who genuinely wants nothing. Greed, fear, and ambition are its handholds. A mind at rest gives it nothing to grip.' Knowing this grants advantage on resisting Varath's compulsions in the vault.", story_flag: "occultist_notes" },
        ],
        perception_details: [
          { dc: 10, text: "The phosphorescence pulses in a slow, even rhythm — almost like breathing." },
          { dc: 14, text: "The water near the pool's western edge is slightly warmer than the rest of the passage water." },
        ],
        crouch_beside: { resulting_stance: "crouching" },
        wade_into:     { resulting_stance: "exposed" },
        items: [
          {
            id: "occultist_journal",
            name: "Occultist's Journal",
            throwable: true,
            story_flag: "occultist_notes",
            obvious: true,
          },
          {
            id: "bronze_amulet",
            name: "Bronze Amulet",
            equip_slot: "amulet",
            throwable: true,
            value_gp: 12,
            passive_effect: "disadvantage_varath_will",
            hidden: true,
            reveal_check: { skill: "perception", dc: 14 },
          },
          {
            id: "folded_map",
            name: "Folded Map",
            throwable: true,
            hidden: true,
            story_flag: "dungeon_layout",
            reveal_check: { skill: "investigation", dc: 13 },
          },
        ],
      },
    },
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Rusted Iron Gate",
      keywordIdentifier: "gate",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "22222222-2222-2222-2222-222222222222" },
        perception_details: [
          { dc: 10, text: "Despite the rust coating the bars, the gate's hinges are freshly oiled — it was used recently." },
          { dc: 14, text: "Scrape marks on the sill show the gate was last pulled open from the north side." },
        ],
      },
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The waterline on the walls shows this passage floods knee-deep during heavy rains." },
          { dc: 14, text: "Two sets of boot prints press into the silt, both heading north — neither set returning south." },
        ],
        interact_options: [
          {
            label: "Speak to the rats (requires Speak with Animals)",
            requires_ability: "speak_with_animals",
            easter_egg: true,
            narrative: "A cluster of rats on a dry ledge above the waterline stops moving and looks at you with an unsettling degree of collective attention. Their designated speaker — a grey rat with a notched ear — approaches. They have watched everything. They know Mira is in the hanging cage in the north chamber, that Harwick paces the ritual circle every three minutes, and that the woman in the vault has been speaking to herself in a language none of them recognize. They know where Harwick keeps his personal coin purse (tucked under the stone altar's left leg). They want cheese. A full ration counts as adequate. Half a ration is accepted with visible contempt, and they share only two of three pieces of information.",
            payment: { item: "ration", reward_tier: [{ quantity: 1, info_count: 3 }, { quantity: 0.5, info_count: 2 }] },
          },
        ],
        items: [],
      },
    },
    {
      id: "77000001-0000-0000-0000-000000000001",
      name: "Submerged Gate North",
      keywordIdentifier: "submerged_gate",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        locked_by:       ["submerged_gate_key"],
        lock_dc:         18,
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
        examine_text: "A heavy iron portcullis set into the northern wall, its lower bars submerged in the black water. Rust has welded the bars to the frame in places — but the locking mechanism looks new.",
        perception_details: [
          { dc: 10, text: "The lock is newer than the gate itself — installed within the last year." },
          { dc: 14, text: "Beyond the bars, faint torchlight flickers on a stone ceiling. Someone is using the passage on the other side." },
        ],
      },
    },
  ];

  for (const poi of floodedPassagePois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: floodedPassage.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: The Armory (east of Entry, arch_width=2) ─────────────────────────
  const armoryTemplate = await prisma.roomTemplate.upsert({
    where: { id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" },
    create: {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Armory",
      baseDescription:
        "A vaulted stone chamber lined with weapon racks and hunting trophies. Faded banners hang from iron brackets on the northern wall. A heavy crate sits against the western wall, lid ajar. A wide archway to the west connects back to the entry chamber.",
      searchFailureNarrative:
        "You check the racks and corners but find nothing more than dust and old rust.",
      map_x: 1,
      map_y: 0,
    },
    update: { map_x: 1, map_y: 0 },
  });

  const armoryPois = [
    {
      id: "ff000000-0000-0000-0000-000000000001",
      name: "Weapon Rack",
      keywordIdentifier: "rack",
      grid_slot: "NW",
      visibility_level: 2,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Iron brackets bolted into stone, holding a mix of old weapons. One bracket is bent sharply outward — something heavy hung here and was removed in a hurry.",
        examine_details: [
          { skill: "perception", dc: 10, text: "Fresh scratches on the empty bracket suggest it held a larger weapon until very recently." },
          { skill: "investigation", dc: 13, text: "A thin smear of dark oil on the stone beneath the empty bracket — weapon-maintenance oil, still tacky." },
        ],
        perception_details: [
          { dc: 10, text: "The empty bracket's height and spread is exactly right for a halberd or long spear." },
          { dc: 14, text: "A cut length of leather binding cord lies on the floor below the rack — sliced cleanly, not untied." },
        ],
        take_cover: { resulting_stance: "behind_cover" },
        interact_options: [
          {
            label: "Try on the old Vorne plate armor",
            check: null,
            narrative: "The armor is old but well-kept — someone oiled it recently. It fits as though it was made for you. The Vorne crest on the chest catches the light. For the rest of this dungeon, those who recognize the Vorne name react differently: Beren is more deferential; Harwick is briefly rattled. In combat, the crest gives +1 AC and -1 Charisma (the Vorne name carries weight, and not all of it good).",
            story_flag: "vorne_armor_worn",
            equip_item: { id: "vorne_plate", name: "Vorne Family Plate", equip_slot: "chest", passive_effect: "vorne_presence", obvious: true },
          },
        ],
        items: [
          {
            id: "hand_axe",
            name: "Hand Axe",
            equip_slot: "main_hand",
            throwable: true,
            obvious: true,
          },
          {
            id: "hunting_bow",
            name: "Hunting Bow",
            equip_slot: "main_hand",
            throwable: false,
            hidden: true,
            reveal_check: { skill: "perception", dc: 9 },
          },
          {
            id: "vorne_plate",
            name: "Vorne Family Plate",
            equip_slot: "chest",
            throwable: false,
            passive_effect: "vorne_presence",
            hidden: true,
            reveal_check: { skill: "perception", dc: 11 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000002",
      name: "Trophy Wall",
      keywordIdentifier: "trophies",
      grid_slot: "N",
      visibility_level: 2,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "Mounted skulls, antlers, and pelts — some from creatures you don't recognise. A faded banner above bears a crest: a crossed pick and torch on a field of black.",
        examine_details: [
          { skill: "history", dc: 12, text: "The crest belongs to House Vorne — a minor noble family that funded dungeon expeditions two decades ago. They were declared extinct after a scandal involving grave robbery." },
          { skill: "perception", dc: 11, text: "One of the mounted skulls has been disturbed recently — the dust ring around its base is broken." },
        ],
        perception_details: [
          { dc: 10, text: "The dust ring around one mounted skull is broken — it was handled recently." },
          { dc: 14, text: "Behind a pair of mounted antlers, a small iron hook is screwed into the stone. Something hung here until not long ago." },
        ],
        examine_closely: { resulting_stance: "standing" },
        interact_options: [
          {
            label: "Pry the crest off the wall",
            check: { skill: "athletics", dc: 12 },
            success: "The crest comes away with a crack of old mortar. Behind it: a shallow hollow in the stone. Inside is a small brass locket on a chain. You open it — two portraits, carefully painted on ivory. A woman and a young child. Not Harwick's wife; the clothing is wrong by a generation. On the locket's inner face, engraved in small letters: 'For H, when you find your way back.'",
            success_items: [
              { id: "vorne_locket", name: "Vorne Family Locket", throwable: false, story_flag: "locket_found", obvious: true },
            ],
            failure: "The crest is fixed firmly. You'd need more leverage or a better grip.",
          },
        ],
        items: [
          {
            id: "signet_ring",
            name: "Signet Ring",
            equip_slot: "ring",
            throwable: true,
            value_gp: 15,
            hidden: true,
            story_flag: "noble_house",
            reveal_check: { skill: "investigation", dc: 13 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000003",
      name: "Heavy Crate",
      keywordIdentifier: "crate",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A rough-cut wooden crate, lid cracked open at one corner. Smells of pine tar and old canvas.",
        examine_details: [
          { skill: "perception", dc: 9, text: "There's a second, smaller crate tucked underneath — completely sealed and heavier-looking." },
          { skill: "investigation", dc: 12, text: "The stencil on the side reads 'VORNE EST. SUPPLY — DO NOT OPEN'. The same House Vorne crest from the trophy wall." },
        ],
        perception_details: [
          { dc: 10, text: "The crate shifts unevenly when nudged — heavier on the left side than the right." },
          { dc: 14, text: "A knothole in the side panel is plugged with pale wood putty — recently applied, still soft at the center." },
        ],
        hide_behind: { resulting_stance: "behind_cover" },
        items: [
          {
            id: "torch_bundle",
            name: "Torch Bundle",
            throwable: true,
            consumable: false,
            obvious: true,
          },
          {
            id: "rope_coil",
            name: "Rope Coil",
            throwable: false,
            obvious: true,
          },
          {
            id: "ration_pack",
            name: "Ration Pack",
            consumable: true,
            throwable: false,
            hidden: true,
            reveal_check: { skill: "perception", dc: 8 },
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000006",
      name: "Locked Chest",
      keywordIdentifier: "chest",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A banded iron chest, padlocked with a heavy crown-stamped lock. The ironwork matches the key you may have found in the flooded passage.",
        examine_details: [
          { skill: "investigation", dc: 13, text: "Pry marks ring the lid — someone tried to force it open and gave up. The lock itself is undamaged." },
          { skill: "perception", dc: 14, text: "A faint metallic scraping from inside when you nudge the chest — something loose, possibly coins or a vial." },
        ],
        perception_details: [
          { dc: 10, text: "The chest is slightly warm to the touch — noticeably warmer than the surrounding stone floor." },
          { dc: 14, text: "Fresh scratches ring the lock's shackle — someone attempted to pick it, and recently." },
        ],
        locked_by: ["iron_key"],
        lock_dc: 14,
        crouch_before: { resulting_stance: "crouching" },
        items: [
          {
            id: "chest_healing_potion",
            name: "Healing Potion",
            consumable: true,
            use_effect: "heal_8",
            throwable: true,
            hidden: true,
          },
          {
            id: "chest_gold_coins",
            name: "Gold Coins (15)",
            throwable: true,
            value_gp: 15,
            hidden: true,
          },
          {
            id: "chest_commanders_note",
            name: "Commander's Note",
            throwable: false,
            story_flag: "vorne_orders",
            hidden: true,
          },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000004",
      name: "Wide Archway West",
      keywordIdentifier: "archway",
      grid_slot: "W",
      visibility_level: 2,
      exit_direction: "W",
      exit_wall_section: "C",
      exit_arch_width: 2,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "obvious_only",
        stand_at:     { resulting_stance: "standing_in_archway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "22222222-2222-2222-2222-222222222222" },
        perception_details: [
          { dc: 10, text: "Torchlight from the entry chamber flickers at the arch's far edge — air is moving on the other side." },
          { dc: 14, text: "A faint drag mark cuts across the archway threshold — something heavy was pulled through here." },
        ],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000005",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "Three flagstones near the room's center are noticeably newer than those around them." },
          { dc: 14, text: "The mortar between two northern flagstones is a different shade — disturbed and re-laid within the last year." },
        ],
        items: [],
      },
    },
    {
      id: "ff000000-0000-0000-0000-000000000007",
      name: "Loose Stone Behind Rack",
      keywordIdentifier: "loose_stone_cache",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "flag_gated",
        reveal_flag: "mira_freed",
        reveal_dc_fallback: 18,
        examine_text: "Behind the weapon rack, a section of the stone wall sounds hollow when knuckled. One stone is slightly proud of the rest, its mortar cracked around the edges.",
        examine_details: [
          { skill: "investigation", dc: 10, text: "The stone is a deliberate cache — the mortar was mixed thin so it could be broken and re-set repeatedly. Someone has used this hiding spot many times." },
        ],
        perception_details: [
          { dc: 10, text: "The stone is dustier on the right side than the left — it's been pulled from the left repeatedly." },
        ],
        interact_options: [
          {
            label: "Pull out the loose stone",
            check: null,
            success: "The stone slides free. Behind it: a small oilskin pouch and a folded note. Mira's stash — exactly where she said it would be.",
            success_items: [
              {
                id: "oil_of_silence",
                name: "Oil of Silence",
                consumable: true,
                throwable: true,
                use_effect: "silence_area_10ft",
                obvious: true,
              },
              {
                id: "conspiracy_note",
                name: "Planted Evidence Note",
                throwable: false,
                story_flag: "conspiracy_known",
                obvious: true,
              },
            ],
          },
        ],
      },
    },
  ];

  for (const poi of armoryPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: armoryTemplate.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Guard Post (north of Flooded Passage) ───────────────────────────
  const guardPost = await prisma.roomTemplate.upsert({
    where: { id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
    create: {
      id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Guard Post",
      baseDescription:
        "A low-ceilinged checkpoint room carved from pale stone. A rough wooden table dominates the center, covered in empty tin cups and a half-eaten loaf of bread. A guard slumps in a chair against the east wall, chin to chest, breathing slowly. The air smells of tallow and unwashed wool. A heavy iron door leads north; a stone passage drops south toward the flooded corridor.",
      searchFailureNarrative:
        "You check the corners and surfaces but find nothing beyond mold and old crumbs.",
      map_x: 0,
      map_y: -2,
    },
    update: { map_x: 0, map_y: -2 },
  });

  const guardPostPois = [
    {
      id: "a1000001-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Guard's Table",
      keywordIdentifier: "table",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A scarred wooden table covered in the remnants of a meal — bread crusts, a tin plate, two cups with dried ale rings. A ring of keys hangs from a nail hammered into the table's side.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The ring holds two keys: one plain iron key and one engraved with the Vorne crest. The crested key is newer — cut recently." },
          { skill: "investigation", dc: 12, text: "Beneath the bread cloth, a small iron key on a worn leather thong. It's been hidden deliberately — tucked under the cloth, not just dropped there." },
        ],
        perception_details: [
          { dc: 10, text: "The ale in the cups is recent — still faintly fragrant. Someone was here within the last few hours." },
          { dc: 14, text: "A faint bitter chemical smell beneath the ale — something was dissolved into it." },
        ],
        items: [
          {
            id: "submerged_gate_key",
            name: "Submerged Gate Key",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 12 },
          },
        ],
      },
    },
    {
      id: "a1000002-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Slumped Guard",
      keywordIdentifier: "guard",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "beren_vorne_guard",
        npc_name:   "Beren",
        examine_text: "A broad-shouldered man in Vorne livery, slumped in a wooden chair with his chin on his chest. His chest rises and falls — he's alive, just deeply unconscious. A ring of keys is clipped to his belt.",
        examine_details: [
          { skill: "medicine", dc: 12, text: "He's been drugged — the breathing pattern is too slow for sleep, too regular for unconsciousness from injury. A full dose of dreamroot, probably in his drink. He can be roused with effort." },
          { skill: "perception", dc: 11, text: "The keys on his belt include a heavy brass key engraved with a stylised flame — a Vorne family motif." },
        ],
        perception_details: [
          { dc: 10, text: "His weapons are still sheathed. He wasn't attacked — he sat down and went under." },
          { dc: 14, text: "There's no cup or bowl near him. Whatever he drank, someone removed the evidence." },
        ],
        interact_options: [
          {
            label: "Rouse him (Medicine DC 12)",
            check: { skill: "medicine", dc: 12 },
            success: "Beren stirs, blinks, and grabs your wrist — then lets go as his eyes focus. 'Who — ' He swallows. 'He drugged me. The lord drugged me.' He reaches for his belt. 'The key. Iron door north. Take it — whatever he's doing down there has to stop.'",
            success_flag: "beren_roused",
            failure: "You shake him and slap his face but he doesn't rouse. He'll need time — or something stronger than your efforts.",
          },
          {
            label: "Tickle him",
            easter_egg: true,
            check: { skill: "perception", dc: 20, note: "Only a natural 20 catches what follows" },
            success: "Beren snort-laughs in his sleep and rolls over, mumbling something. You catch it clearly: 'Lena... the merchant said...' He's dreaming about someone who knew Maren Ashwick. He knows more than he let on.",
            failure: "He doesn't react. He's too deeply under.",
          },
          {
            label: "Tell him Harwick drugged him deliberately",
            requires_flag: "beren_roused",
            check: { skill: "persuasion", dc: 12 },
            success: "Beren's jaw tightens. He's quiet for a long moment. 'He didn't want a witness.' He stands, steadier than he looks. 'I won't fight him — he's still my lord. But I'll make sure he can't run. If he tries to flee through here, I'll hold the passage.' He also tells you: the merchant woman is in the vault, east of the ritual chamber. He heard her voice through the wall two days ago.",
            success_flag: "beren_loyal",
            failure: "He shakes his head. 'He has his reasons. He always has his reasons.' He doesn't believe you.",
          },
        ],
        items: [
          {
            id: "vorne_key",
            name: "Vorne Key",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "perception", dc: 11 },
            story_flag: "vorne_key_found",
          },
        ],
      },
    },
    {
      id: "a1000003-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Vorne Iron Door North",
      keywordIdentifier: "iron_door_north",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: "N",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        locked_by:       ["vorne_key"],
        lock_dc:         16,
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
        examine_text: "A solid iron door set with a single lock bearing the Vorne crest — the crossed pick and torch. No handle on this side; it opens toward you.",
        perception_details: [
          { dc: 10, text: "Faint candlelight bleeds under the door's lower edge, flickering unevenly." },
          { dc: 14, text: "A low, irregular muttering carries through the door — a voice reciting something rhythmically. It doesn't sound like a prayer." },
        ],
      },
    },
    {
      id: "a1000004-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Stone Passage South",
      keywordIdentifier: "passage_south",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "77777777-7777-7777-7777-777777777777" },
        examine_text: "A low archway cut into the southern wall, the floor dropping slightly into a flooded passage beyond. Cold air rises from it, carrying the smell of standing water.",
        perception_details: [
          { dc: 10, text: "The stonework around the arch shows water staining — this floods to chest height during heavy rains." },
          { dc: 14, text: "Boot scuff marks on the archway's threshold, heading both directions. Recent, multiple sets." },
        ],
      },
    },
    {
      id: "a1000005-a1a1-a1a1-a1a1-a1a1a1a1a1a1",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "A thin tallow candle stub on the floor near the east wall — someone waited here in the dark recently." },
          { dc: 14, text: "Scratched into the stone near floor level: a series of tally marks, four groups of five. Twenty days." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of guardPostPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: guardPost.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Ritual Chamber (north of Guard Post) ────────────────────────────
  const ritualChamber = await prisma.roomTemplate.upsert({
    where: { id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
    create: {
      id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Ritual Chamber",
      baseDescription:
        "A vaulted chamber lit by a ring of stubby candles arrayed around a circle carved into the floor. The carvings glow faintly — pale silver that dims and brightens in slow pulses. An iron cage hangs from a ceiling chain in the northwest corner, a figure huddled inside. A stone altar against the north wall holds an open grimoire and a lacquered box. A man in travel-worn noble clothes stands at the circle's edge, murmuring with his back to the door. A heavy iron door leads south. In the northeast corner, the stone wall shows a faint hairline seam — almost invisible.",
      searchFailureNarrative:
        "You search the perimeter but the ritual circle's light makes the shadows deeper at the edges.",
      map_x: 0,
      map_y: -3,
    },
    update: { map_x: 0, map_y: -3 },
  });

  const ritualChamberPois = [
    {
      id: "b2000001-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Ritual Circle",
      keywordIdentifier: "circle",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A complex diagram of interlocking rings, glyphs, and radial lines carved deep into the stone floor. The silver light pulses from the grooves themselves — not from any candle. The air above it feels slightly wrong, like pressure before a storm.",
        examine_details: [
          { skill: "arcana", dc: 14, text: "Pre-Imperial binding architecture. The outer ring is correctly formed but the anchor glyphs at the cardinal points are inverted — whoever carved this made a fundamental error. The inverted anchors mean the binding will fail and reverse, releasing rather than containing the entity." },
          { skill: "religion", dc: 13, text: "The central glyph is a Varath-class containment seal — designed for entities that feed on compulsion and influence. Someone is attempting to bind a demon of extraordinary cunning. The inverted anchors terrify you." },
        ],
        perception_details: [
          { dc: 10, text: "The light from the grooves pulses in an irregular pattern — almost like a heartbeat with occasional skips." },
          { dc: 14, text: "Three of the cardinal glyphs show tool marks around their edges — someone has deliberately re-carved them since the original inscription." },
        ],
        disrupt: {
          check: { skill: "arcana", dc: 13 },
          story_flag: "ritual_disrupted",
          narrative: "You drag your blade through three connecting glyphs in rapid succession. The silver light flares white, then sputters out. The air pressure releases. In the sudden dark and silence, you hear Harwick's voice break off mid-syllable.",
        },
        interact_options: [
          {
            label: "Pour a liquid into the circle",
            context_resolved: true,
            outcomes_by_liquid: {
              water: { narrative: "The water hisses as it hits the glowing grooves. The silver light sputters and dims noticeably — the circle is weakened.", effect: "harwick_ritual_penalty_2", story_flag: "circle_water_doused" },
              oil:   { narrative: "The oil spreads across the carved grooves. The circle is now flammable — a torch would end this ritual permanently and start a fire.", story_flag: "circle_oiled", note: "Torching now counts as ritual_disrupted but starts a fire hazard" },
              blood: { narrative: "The blood hits the seal and the light surges brilliant white. Harwick wheels around, eyes wide. 'Yes — yes, that's it.' You've accidentally advanced the ritual.", story_flag: "blood_in_circle", effect: "ritual_advanced" },
              other: { narrative: "It sizzles and evaporates before reaching the glyph floor. No meaningful effect.", effect: null },
            },
          },
          {
            label: "Try to fix the ritual circle",
            check: { skill: "arcana", dc: 16 },
            success: "You identify three cardinal glyphs that Harwick has carved inverted and carefully re-cut them with the tip of your blade. The light shifts from cold silver to a warmer gold — more stable. Whatever binding happens in the vault will be somewhat easier.",
            success_flag: "circle_partially_corrected",
            failure: "You attempt to correct the anchor glyphs but you're not certain which errors are Harwick's and which are Varath's guidance. You stop before making things worse.",
          },
          {
            label: "Sing or hum near the circle",
            easter_egg: true,
            narrative: "You hum a few bars of something simple. The silver light in the nearest glyph groove brightens fractionally, then dims — as if something noticed and caught itself. Harwick, from across the room, says nothing. But his muttering stops for three full seconds.",
          },
        ],
      },
    },
    {
      id: "b2000002-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Prisoner Cage",
      keywordIdentifier: "cage",
      grid_slot: "NW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "mira",
        npc_name:   "Mira",
        examine_text: "A young woman sits cross-legged in the hanging cage, watching the door with sharp dark eyes. She's filthy and clearly hasn't slept properly in days, but her posture suggests she's been watching and waiting rather than despairing.",
        examine_details: [
          { skill: "perception", dc: 10, text: "The cage lock is a simple padlock — the same type as the Locked Chest in the armory. An iron key would likely open it." },
          { skill: "insight", dc: 12, text: "She's afraid but not broken. She's been cataloguing everything in this room — she'll know things." },
        ],
        perception_details: [
          { dc: 10, text: "She mouths something at you — it takes a moment to read: 'The altar. Look at the altar.'" },
          { dc: 14, text: "Her left forearm shows a faded guild tattoo — the Thieves' Guild knot mark from the city." },
        ],
        interact_options: [
          {
            label: "Open the cage (iron_key or lockpick DC 12)",
            check: { item: "iron_key", fallback: { skill: "thieves_tools", dc: 12 } },
            success: "The lock clicks. Mira drops to the floor and rolls her neck. 'Mira. I'm a thief, not a spy, and I want out of here.' She looks at the ritual circle. 'That thing — it changes every day. He re-carves it himself, and every time he does it gets worse. Whatever he's trying to bind, it's telling him to make mistakes.'",
            story_flag: "mira_freed",
          },
        ],
      },
    },
    {
      id: "b2000003-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Stone Altar",
      keywordIdentifier: "altar",
      grid_slot: "N",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A flat stone altar pressed against the north wall, its surface covered in melted wax and ink stains. An open grimoire sits at the center, pages weighted open with a smooth river stone. Beside it, a lacquered wooden box with a brass clasp.",
        examine_details: [
          { skill: "arcana", dc: 12, text: "The grimoire is a hand-copied ritual manual — sections are crossed out and re-annotated in a cramped, increasingly erratic hand. Margin notes show the author repeatedly correcting the same binding steps, then correcting the corrections. The final annotated page reads: 'The entity says the anchors must face inward. I believe it.'" },
          { skill: "investigation", dc: 11, text: "The lacquered box is unlocked. Inside: six glass vials of a silver-black reagent, each sealed with wax. The labels are in Old Imperial — 'anchor reagent.' Three vials are empty." },
        ],
        perception_details: [
          { dc: 10, text: "The grimoire's most recent pages are written in a different hand than the early sections — shakier, more rushed." },
          { dc: 14, text: "Beneath the grimoire, a folded letter addressed to 'H. Vorne, care of the cellar road.' Unsigned." },
        ],
        interact_options: [
          {
            label: "Read the grimoire aloud",
            easter_egg: true,
            check: { skill: "arcana", dc: 10, note: "Failure just means you mispronounce things; the imp arrives either way" },
            narrative: "You read three lines aloud. A small crack appears in the air above the altar — no wider than a hand span — and something falls through it onto the stone surface. It's about the size of a large cat and very angry. It rights itself, smooths what might be hair, and fixes you with a glare of profound offence. 'That,' it says, in a voice like a nail dragged across slate, 'was my nap. I am Glet. I was resting inside the binding diffusion until someone began shouting.' It wants nothing to do with Varath, Harwick, or this ritual. It will answer one honest question about the vault before blinking away. It does not fight. It hates Harwick specifically.",
            success_flag: "glet_summoned",
            glet_knowledge: [
              "The Binding Seal is correctly constructed — the fault is in the ritual circle above, not the vault.",
              "Varath's partial binding has lasted because of the original pre-Imperial architecture, not Harwick's work.",
              "The merchant woman in the vault knows the correct completion procedure.",
            ],
          },
        ],
        items: [
          {
            id: "harwick_grimoire",
            name: "Harwick's Grimoire",
            throwable: false,
            story_flag: "grimoire_read",
          },
          {
            id: "reagent_vials",
            name: "Anchor Reagent (3 remaining)",
            throwable: true,
            hidden: true,
            reveal_check: { skill: "investigation", dc: 11 },
          },
        ],
      },
    },
    {
      id: "b2000004-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Harwick Vorne",
      keywordIdentifier: "harwick",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "harwick_vorne",
        npc_name:   "Harwick Vorne",
        examine_text: "A lean man in his late forties, wearing travel clothes over a padded doublet bearing the Vorne crest. His face is gaunt and over-focused, the look of someone who has not slept properly in weeks. He holds a halberd loosely in one hand — the blade is polished. He's watching the ritual circle, not you.",
        examine_details: [
          { skill: "insight", dc: 13, text: "He's brittle. The confidence in his posture is performance — underneath it he's terrified. He knows something is wrong but will not admit it even to himself." },
          { skill: "history", dc: 12, text: "The halberd's blade bears the Vorne family mark. This is the weapon that was missing from the armory weapon rack." },
        ],
        perception_details: [
          { dc: 10, text: "His lips move constantly, just below audible — repeating something to himself like a ward." },
          { dc: 14, text: "His hands are shaking slightly. Not fear — exhaustion. He hasn't stopped the ritual work in days." },
        ],
        combat_stats: {
          ac: 14,
          max_hp: 38,
          weapon: "family_halberd",
          damage: "1d10+2",
          reach: true,
          flee_threshold: 0.5,
          flee_flag: "harwick_fled",
          defeat_flag: "harwick_defeated",
        },
      },
    },
    {
      id: "b2000005-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Iron Door South",
      keywordIdentifier: "iron_door_south",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: "S",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1" },
        examine_text: "The iron door you came through, now behind you. Its south face bears no lock — it opens freely from this side.",
        perception_details: [
          { dc: 10, text: "The door's hinges are freshly oiled. It opens without a sound." },
          { dc: 14, text: "Scratch marks on the floor on this side suggest the door was barricaded from within at some point — recently cleared." },
        ],
      },
    },
    {
      id: "b2000006-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Hidden Door East",
      keywordIdentifier: "hidden_door",
      grid_slot: "E",
      visibility_level: 1,
      exit_direction: "E",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "proximity_only",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3" },
        examine_text: "A section of wall that, up close, reveals a hairline seam running floor to ceiling. The stone here is slightly smoother than the surrounding wall — cut and fitted, not quarried in place. A small recessed latch is set at chest height, nearly invisible.",
        perception_details: [
          { dc: 10, text: "The stone in this section of wall is noticeably cooler than the surrounding walls — air is moving behind it." },
          { dc: 14, text: "The latch mechanism shows bright metal wear at contact points — used regularly and recently." },
        ],
      },
    },
    {
      id: "b2000007-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SW",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The candles in the ring are burned down to stubs — this ritual has been running for hours, possibly longer." },
          { dc: 14, text: "The silver light from the ritual circle casts faint shadows that move independently of the candle flames — the circle has its own logic." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of ritualChamberPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: ritualChamber.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  // ─── V2: Sealed Vault (east of Ritual Chamber) ────────────────────────────
  const sealedVault = await prisma.roomTemplate.upsert({
    where: { id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3" },
    create: {
      id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      dungeonTemplateId: dungeonTemplate.id,
      name: "The Sealed Vault",
      baseDescription:
        "A small chamber cut from living rock, the walls smooth and featureless except for a raised dais in the center. On the dais sits a flat stone disc — the Binding Seal — its surface covered in fine silver script that writhes slightly when viewed directly. The air here is cold and absolutely still. In the far corner, a woman in merchant's clothing is chained to an iron ring sunk into the wall. She looks up at you with exhausted, watchful eyes. A heavy wooden shelf along the south wall holds ledger books. The vault door west stands ajar.",
      searchFailureNarrative:
        "The vault is bare stone and shelves. There is nothing to find that isn't already visible.",
      map_x: 1,
      map_y: -3,
    },
    update: { map_x: 1, map_y: -3 },
  });

  const sealedVaultPois = [
    {
      id: "c3000001-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Binding Seal",
      keywordIdentifier: "seal",
      grid_slot: "C",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A stone disc roughly two feet across, set into the top of a low dais. The silver script on its surface is pre-Imperial — dense, layered, and moving. Not visibly, but when you look away and back, individual glyphs have shifted. The air directly above the disc is cold enough to see your breath.",
        examine_details: [
          { skill: "arcana", dc: 16, text: "This is the anchor point of the binding architecture — a Varath-class seal, pre-Imperial, correctly constructed. The outer ritual circle upstairs was meant to feed power into this. With the correct reagents and the binding incantation spoken in Old Imperial, the seal can be completed, containing Varath permanently. Without guidance, the incantation check is DC 18 and failure reverses the binding." },
          { skill: "religion", dc: 14, text: "The script is partially active — Varath is already partially touching this world through the seal. Whatever you do here will determine whether it crosses fully or is pushed back." },
        ],
        perception_details: [
          { dc: 10, text: "You hear your own name spoken quietly from nowhere in particular. The sound comes from the seal." },
          { dc: 14, text: "The script nearest the seal's edge is different from the rest — larger, more urgent. It reads, in fragmented Old Imperial: 'break me. break me. break me.'" },
        ],
        interact_options: [
          {
            label: "Complete the binding (with Maren's guidance)",
            requires_flag: "maren_rescued",
            check: {
              skill: "arcana",
              dc: 12,
              dc_modifiers: [
                { requires_flag: "ward_phrase_known", amount: -3, note: "You speak the ward phrase at the anchor points as Maren directs" },
                { requires_flag: "circle_partially_corrected", amount: -2 },
              ],
            },
            success_flag: "binding_seal_used",
            narrative: "Maren stands beside you, reading the incantation from memory in precise Old Imperial. You apply the anchor reagents at the cardinal points as she directs. The script flares white. The cold air rushes inward like a held breath releasing. The script locks — every glyph freezes in place. Silence. Then, distantly, something that might be a scream, cut short. The seal is complete. Varath is contained.",
          },
          {
            label: "Attempt binding without guidance",
            check: {
              skill: "arcana",
              dc: 18,
              dc_modifiers: [
                { requires_flag: "ward_phrase_known", amount: -4, note: "The ward phrase anchors you against compulsion during the incantation" },
                { requires_flag: "circle_partially_corrected", amount: -4 },
                { requires_flag: "occultist_notes", amount: -2, note: "You apply the occultist's insight: you want nothing from this" },
                { requires_equipped: "bronze_amulet", amount: -2 },
              ],
            },
            success_flag: "binding_seal_used",
            failure_flag: "binding_seal_destroyed",
            narrative_success: "With no guide but the script itself, you work through the incantation syllable by syllable. The seal activates — correctly. Varath's presence contracts and disappears. The chamber warms.",
            narrative_failure: "You reach the anchor phrase and the script inverts. The cold turns to heat. The disc cracks down the center. In the sudden silence you realize: Varath is free.",
          },
          {
            label: "Destroy the seal",
            story_flag: "binding_seal_destroyed",
            narrative: "You bring your weapon down on the disc. The script screams — actually screams, a sound that comes from everywhere at once. The disc shatters. The cold releases. The chamber is just a room. But something that was held here is no longer held.",
          },
          {
            label: "Sing or hum near the seal",
            easter_egg: true,
            narrative: "You hum something simple. The script on the disc shifts — individual glyphs realigning fractionally, as if listening. For just a moment the whispers from the seal harmonize with the melody before catching themselves. Varath, whatever it is, has been alone and contained for a very long time. It craves attention of any kind. This is a foothold, if you choose to use it.",
          },
        ],
      },
    },
    {
      id: "c3000002-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Chained Merchant",
      keywordIdentifier: "merchant",
      grid_slot: "NE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "npc",
        visibility: "always",
        npc_id:     "maren_ashwick",
        npc_name:   "Maren Ashwick",
        examine_text: "A woman in her mid-thirties with a merchant's practical clothing — now dirty, worn, and torn at the sleeve. She's chained at the wrist to an iron ring but is sitting upright, watching you assess the room with the focused attention of someone taking inventory. Her expression when she looks at you is relief, quickly mastered into wariness.",
        examine_details: [
          { skill: "insight", dc: 11, text: "She's frightened but functional. She's been using her time in here to think, not panic. She has information and she knows it's leverage." },
          { skill: "perception", dc: 10, text: "The chain is old but the lock is new — same Vorne-style brass clasp as the others in this cellar. Any Vorne key or lockpick will open it." },
        ],
        perception_details: [
          { dc: 10, text: "'I've been waiting four days. Whatever you need to know about that seal, I'll tell you. Just get me out of here first.'" },
          { dc: 14, text: "She keeps glancing at the Binding Seal with the expression of someone who has been listening to it whisper for four days and is holding together through sheer stubbornness." },
        ],
        interact_options: [
          {
            label: "Free her (vorne_key or lockpick DC 12)",
            check: { item: "vorne_key", fallback: { skill: "thieves_tools", dc: 12 } },
            success: "The chain drops. Maren stands and rolls her wrists. 'Maren Ashwick. I delivered reagents to Vorne six months ago — I didn't know what they were for. When I came back to collect payment he locked me in here.' She looks at the seal. 'I know how to complete that correctly. Vorne was doing it wrong — the entity told him to. I can fix it, if you'll let me.'",
            story_flag: "maren_rescued",
          },
        ],
      },
    },
    {
      id: "c3000003-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Vorne Family Ledgers",
      keywordIdentifier: "ledgers",
      grid_slot: "S",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "interactive",
        visibility: "always",
        examine_text: "A wooden shelf holding a dozen ledger books, their spines embossed with the Vorne crest and year dates going back twenty-two years. The most recent volume is open on the shelf, its last pages covered in columns of debts, owed favors, and names.",
        examine_details: [
          { skill: "investigation", dc: 12, text: "The final entries detail payments made in exchange for silence from eight named individuals — minor nobles, city officials, a guild recorder. Harwick has been buying complicity for his operation. This ledger is evidence of criminal conspiracy." },
          { skill: "history", dc: 13, text: "The older ledgers document the original grave-robbery scandal in careful euphemism — 'site reclamation fees,' 'preservation charges,' 'artifact handling costs.' The full scope of what House Vorne did is here, annotated in Harwick's hand as if he's proud of it." },
        ],
        perception_details: [
          { dc: 10, text: "The ledgers smell of tallow and age. They've been kept carefully — this was a deliberate archive, not just records." },
          { dc: 14, text: "Inside the back cover of the most recent volume, a folded document: a royal pardon template, blank, with an official seal already applied. Harwick had planned to coerce someone into signing it." },
        ],
        items: [
          {
            id: "vorne_ledger",
            name: "Vorne Family Ledger (recent)",
            throwable: false,
            story_flag: "ledger_found",
          },
          {
            id: "blank_pardon",
            name: "Blank Pardon Document",
            throwable: false,
            hidden: true,
            value_gp: 0,
            story_flag: "pardon_found",
            reveal_check: { skill: "investigation", dc: 12 },
          },
        ],
      },
    },
    {
      id: "c3000004-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Vault Door West",
      keywordIdentifier: "vault_door",
      grid_slot: "W",
      visibility_level: 1,
      exit_direction: "W",
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:        "exit",
        visibility:      "always",
        peek_visibility: "none",
        stand_at:     { resulting_stance: "standing_in_doorway" },
        peer_through: { resulting_stance: "peering_through" },
        enter:        { target_room_template_id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2" },
        examine_text: "The vault door — heavy stone fitted into a flush frame. It stands ajar, the latch mechanism exposed. From the outside it would be nearly invisible; from inside, it opens easily.",
        perception_details: [
          { dc: 10, text: "The stone door is perfectly balanced — it would take no effort to swing open or closed." },
          { dc: 14, text: "The door's inner face has a single sentence carved in small letters at eye height: 'What is bound here will not stay bound by stone alone.'" },
        ],
      },
    },
    {
      id: "c3000005-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
      name: "Open Space",
      keywordIdentifier: "open_space",
      grid_slot: "SE",
      visibility_level: 1,
      exit_direction: null,
      exit_wall_section: "C",
      exit_arch_width: 1,
      defaultProperties: {
        poi_type:   "open_space",
        visibility: "always",
        perception_details: [
          { dc: 10, text: "The vault is entirely silent — no echo, no drip, no breath of air. The stillness feels deliberate." },
          { dc: 14, text: "In the absolute silence you can hear your own heartbeat clearly. And then, briefly, something that isn't yours." },
        ],
        items: [],
      },
    },
  ];

  for (const poi of sealedVaultPois) {
    await prisma.poiTemplate.upsert({
      where: { id: poi.id },
      create: { ...poi, roomTemplateId: sealedVault.id },
      update: {
        name: poi.name,
        defaultProperties: poi.defaultProperties,
        grid_slot: poi.grid_slot,
        visibility_level: poi.visibility_level,
        exit_direction: poi.exit_direction,
        exit_wall_section: poi.exit_wall_section,
        exit_arch_width: poi.exit_arch_width,
      },
    });
  }

  console.log("\n✅ Seed complete!");
  console.log("=================================================");
  console.log(`Story:      ${story.id}  (${story.title})`);
  console.log(`Act 1:      ${act1.id}`);
  console.log(`Map:        ${act1Map.id}  (${act1Map.name})`);
  console.log(`Scene 1:    ${scene1.id}  (${scene1.title})`);
  console.log(`Scene 2:    ${scene2.id}  (${scene2.title})`);
  console.log(`Enemy 1:    ${rat1.id}  (${rat1.name})`);
  console.log(`Enemy 2:    ${rat2.id}  (${rat2.name})`);
  console.log(`User:       ${testUser.id}  (${testUser.email})`);
  console.log(`Character:  ${testChar.id}  (${testChar.name})`);
  console.log(`Game:       ${game.id}`);
  console.log("-------------------------------------------------");
  console.log("V2 Templates (stable IDs — use /setup to create sessions):");
  console.log(`  Dungeon:  11111111-1111-1111-1111-111111111111  (The Sunken Cellar)`);
  console.log(`  Room A:   22222222-2222-2222-2222-222222222222  (The Entry Chamber)`);
  console.log(`  POIs A:   33333333 Stone Fountain (healing_vial hidden) | 44444444 Wooden Barricade | 55555555 Iron Pillar (coin_pouch hidden) | 66666666 Dark Passage North → | bbbbbbbb Open Space (loose_stone)`);
  console.log(`  Room B:   77777777-7777-7777-7777-777777777777  (The Flooded Passage) map(0,-1)`);
  console.log(`  POIs B:   88888888 Collapsed Pillar NE | 99999999 Stagnant Pool SE | aaaaaaaa Rusted Iron Gate S→ | cccccccc Open Space C`);
  console.log(`  Room C:   eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee  (The Armory) map(1,0)`);
  console.log(`  POIs C:   ff000001 Weapon Rack NW(vis=2) | ff000002 Trophy Wall N(vis=2) | ff000003 Heavy Crate SW(vis=1) | ff000004 Wide Archway West W(arch=2) | ff000005 Open Space C`);
  console.log(`  Room D:   a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1  (The Guard Post) map(0,-2)`);
  console.log(`  POIs D:   a1000001 Guard's Table C | a1000002 Slumped Guard E(npc:beren) | a1000003 Iron Door North N(locked:vorne_key) | a1000004 Stone Passage South S | a1000005 Open Space SW`);
  console.log(`  Room E:   b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2  (The Ritual Chamber) map(0,-3)`);
  console.log(`  POIs E:   b2000001 Ritual Circle C | b2000002 Prisoner Cage NW(npc:mira) | b2000003 Stone Altar N | b2000004 Harwick Vorne NE(npc/enemy) | b2000005 Iron Door South S | b2000006 Hidden Door East E(proximity_only) | b2000007 Open Space SW`);
  console.log(`  Room F:   c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3  (The Sealed Vault) map(1,-3)`);
  console.log(`  POIs F:   c3000001 Binding Seal C | c3000002 Chained Merchant NE(npc:maren) | c3000003 Vorne Family Ledgers S | c3000004 Vault Door West W | c3000005 Open Space SE`);
  console.log("  Scenarios: 1=Entry alone | 2=Entry@E archway obvious_only | 3=Entry@E archway full | 4=Entry@C wide arch");
  console.log("=================================================");
  console.log("Run createGameMap(game.id, act1.id) to initialise the live tile map.");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
