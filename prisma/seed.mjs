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
    },
    update: {},
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
        items: [
          {
            id: "loose_stone",
            name: "Loose Stone",
            throwable: true,
            improvised: true,
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
        crouch_beside: { resulting_stance: "crouching" },
        wade_into:     { resulting_stance: "exposed" },
        items: [
          {
            id: "waterlogged_journal",
            name: "Waterlogged Journal",
            throwable: true,
            story_flag: "merchant_notes",
            obvious: true,
          },
          {
            id: "bronze_amulet",
            name: "Bronze Amulet",
            equip_slot: "amulet",
            throwable: true,
            value_gp: 12,
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
        items: [],
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
        take_cover: { resulting_stance: "behind_cover" },
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
        examine_closely: { resulting_stance: "standing" },
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
        items: [],
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
