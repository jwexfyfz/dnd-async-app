/**
 * Seeds a GameSession with a specific combat scenario for manual testing.
 * Usage: npx tsx scripts/seed-combat-scenario.ts --scenario <name>
 *
 * Scenarios: alert-entry | mid-combat | enemy-turn | flee-test | suspicious-grace | ui-combat
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { Prisma } from '@prisma/client';
config({ path: resolve(process.cwd(), '.env.local') });

const GUARD_POST_ROOM_TEMPLATE_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const RITUAL_CHAMBER_ROOM_TEMPLATE_ID = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const DUNGEON_TEMPLATE_ID = '11111111-1111-1111-1111-111111111111';
const SLUMPED_GUARD_POI_TEMPLATE_ID = 'a1000002-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const HARWICK_POI_TEMPLATE_ID = 'b2000004-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? 'jwexfyfz@gmail.com';

const SCENARIO_ARG = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--scenario') + 1];

if (!SCENARIO_ARG) {
  console.error('Usage: npx tsx scripts/seed-combat-scenario.ts --scenario <name>');
  process.exit(1);
}

async function main() {
  const { prisma } = await import('../lib/prisma');

  // 1. Find or create test user and character
  const user = await prisma.user.findFirst({ where: { email: SEED_USER_EMAIL } });
  if (!user) {
    console.error(`No user found with email ${SEED_USER_EMAIL}. Set SEED_USER_EMAIL in .env.local.`);
    process.exit(1);
  }

  let char = await prisma.character.findFirst({ where: { userId: user.id } });
  if (!char) {
    char = await prisma.character.create({
      data: {
        userId: user.id,
        name: 'Tomas Blackwood',
        characterClass: 'Rogue',
        level: 3,
        maxHp: 18,
        currentHp: 18,
        baseDexterity: 16,
        baseStrength: 10,
        baseConstitution: 12,
        baseWisdom: 12,
        baseCharisma: 12,
        baseIntelligence: 12,
        skillProficiencies: ['stealth', 'sleight_of_hand', 'perception'],
      },
    });
    console.log(`[seed] created character ${char.id} (${char.name})`);
  }

  // 2. Find or create a GameSession for The Sunken Cellar
  let session = await prisma.gameSession.findFirst({
    where: {
      dungeonTemplateId: DUNGEON_TEMPLATE_ID,
      roomInstances: { some: { participants: { some: { characterId: char.id } } } },
    },
    include: { roomInstances: { include: { poiInstances: true, participants: true } } },
  });

  if (!session) {
    session = await prisma.gameSession.create({
      data: {
        name: 'The Sunken Cellar — Test',
        dungeonTemplateId: DUNGEON_TEMPLATE_ID,
        gameState: 'exploration',
        storyFlags: {},
      },
      include: { roomInstances: { include: { poiInstances: true, participants: true } } },
    });
    console.log(`[seed] created session ${session.id}`);
  }

  // 3. Ensure Guard Post room instance exists
  let guardPostRoom = session.roomInstances.find(
    r => (r as { roomTemplateId: string }).roomTemplateId === GUARD_POST_ROOM_TEMPLATE_ID,
  ) as (typeof session.roomInstances[0] & { roomTemplateId: string }) | undefined;

  if (!guardPostRoom) {
    const roomTemplate = await prisma.roomTemplate.findUniqueOrThrow({
      where: { id: GUARD_POST_ROOM_TEMPLATE_ID },
      include: { poiTemplates: true },
    });
    guardPostRoom = await prisma.roomInstance.create({
      data: {
        sessionId: session.id,
        roomTemplateId: GUARD_POST_ROOM_TEMPLATE_ID,
        poiInstances: {
          create: roomTemplate.poiTemplates.map(pt => ({ poiTemplateId: pt.id, currentProperties: {} })),
        },
      },
      include: { poiInstances: true, participants: true },
    }) as unknown as typeof guardPostRoom;
    console.log(`[seed] created guard post room instance ${guardPostRoom!.id}`);
  }

  // Ensure character is a participant in the Guard Post room
  await prisma.roomParticipant.upsert({
    where: { roomInstanceId_characterId: { roomInstanceId: guardPostRoom!.id, characterId: char.id } },
    update: { lastActiveAt: new Date() },
    create: { roomInstanceId: guardPostRoom!.id, characterId: char.id, combatState: {} },
  });

  // Reload session with fresh data
  const freshSession = await prisma.gameSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { roomInstances: { include: { poiInstances: { include: { template: true } }, participants: true } } },
  });
  const freshGuardPost = freshSession.roomInstances.find(
    r => (r as { roomTemplateId: string }).roomTemplateId === GUARD_POST_ROOM_TEMPLATE_ID,
  )!;

  // Find the guard's POI instance
  const guardPoiInstance = freshGuardPost.poiInstances.find(
    pi => pi.poiTemplateId === SLUMPED_GUARD_POI_TEMPLATE_ID,
  );
  if (!guardPoiInstance) throw new Error('Guard POI instance not found');

  // Ensure the Slumped Guard template has combat_stats for Phase 2+
  await prisma.poiTemplate.update({
    where: { id: SLUMPED_GUARD_POI_TEMPLATE_ID },
    data: {
      defaultProperties: {
        ...(await prisma.poiTemplate.findUniqueOrThrow({ where: { id: SLUMPED_GUARD_POI_TEMPLATE_ID }, select: { defaultProperties: true } })).defaultProperties as object,
        combat_stats: { dex_score: 10, attack_bonus: 3, damage: '1d6+1', max_hp: 11, ac: 13 },
        ai_behavior: { priority: 'aggressive', flee_threshold: 0 },
        awareness_state: 'unaware',
        hostile_to: [],
      },
    },
  });

  const scenario = SCENARIO_ARG;

  // Reset session state first
  await prisma.gameSession.update({
    where: { id: session.id },
    data: { gameState: 'exploration', combatState: Prisma.JsonNull },
  });
  await prisma.character.update({
    where: { id: char.id },
    data: { currentHp: char.maxHp },
  });

  if (scenario === 'alert-entry') {
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'alert', current_hp: 11, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: "The guard's eyes snap open — he's seen you.",
      },
    });

  } else if (scenario === 'mid-combat') {
    const combatState = {
      round: 2,
      activeActorId: char.id,
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: char.id, type: 'character', name: char.name, initiative: 17, hp: 14, maxHp: char.maxHp, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
        { id: guardPoiInstance.id, type: 'enemy', name: 'Slumped Guard', initiative: 9, hp: 4, maxHp: 11, ac: 13, surprised: false, acted: true, proximity: 'close', status_effects: [] },
      ],
    };
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { gameState: 'combat', combatState: combatState as object },
    });
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'alert', current_hp: 4, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: 'Round 2. The guard has already swung — it is your turn.',
      },
    });
    console.log(`[seed] combatState written: round=${combatState.round} actors=${combatState.initiativeOrder.length}`);

  } else if (scenario === 'enemy-turn') {
    const combatState = {
      round: 1,
      activeActorId: guardPoiInstance.id,
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: char.id, type: 'character', name: char.name, initiative: 9, hp: 14, maxHp: char.maxHp, ac: 12, surprised: false, acted: true, proximity: 'close', status_effects: [] },
        { id: guardPoiInstance.id, type: 'enemy', name: 'Slumped Guard', initiative: 14, hp: 11, maxHp: 11, ac: 13, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { gameState: 'combat', combatState: combatState as object },
    });
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'alert', current_hp: 11, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: 'You attacked. Now the guard acts.',
      },
    });
    console.log(`[seed] combatState written: round=${combatState.round} actors=${combatState.initiativeOrder.length}`);

  } else if (scenario === 'flee-test') {
    const combatState = {
      round: 1,
      activeActorId: char.id,
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: char.id, type: 'character', name: char.name, initiative: 12, hp: 10, maxHp: char.maxHp, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
        { id: guardPoiInstance.id, type: 'enemy', name: 'Slumped Guard', initiative: 8, hp: 7, maxHp: 11, ac: 13, surprised: false, acted: false, proximity: 'close', status_effects: [] },
      ],
    };
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { gameState: 'combat', combatState: combatState as object },
    });
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'alert', current_hp: 7, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: 'Combat is live. The exit is within reach.',
      },
    });
    console.log(`[seed] combatState written: round=${combatState.round} actors=${combatState.initiativeOrder.length}`);

  } else if (scenario === 'suspicious-grace') {
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'suspicious', current_hp: 11, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: "The guard's head lifts — he heard something.",
      },
    });

  } else if (scenario === 'ui-combat') {
    // Ensure Harwick is in the Ritual Chamber room instance
    let ritualRoom = freshSession.roomInstances.find(
      r => (r as { roomTemplateId: string }).roomTemplateId === RITUAL_CHAMBER_ROOM_TEMPLATE_ID,
    );
    if (!ritualRoom) {
      const rt = await prisma.roomTemplate.findUniqueOrThrow({
        where: { id: RITUAL_CHAMBER_ROOM_TEMPLATE_ID },
        include: { poiTemplates: true },
      });
      ritualRoom = await prisma.roomInstance.create({
        data: {
          sessionId: session.id,
          roomTemplateId: RITUAL_CHAMBER_ROOM_TEMPLATE_ID,
          poiInstances: {
            create: rt.poiTemplates.map(pt => ({ poiTemplateId: pt.id, currentProperties: {} })),
          },
        },
        include: { poiInstances: true, participants: true },
      }) as unknown as typeof ritualRoom;
    }
    const harwickPoiInstance = (ritualRoom as { poiInstances: Array<{ id: string; poiTemplateId: string }> }).poiInstances.find(
      pi => pi.poiTemplateId === HARWICK_POI_TEMPLATE_ID,
    );

    const combatState = {
      round: 1,
      activeActorId: char.id,
      currentTurnUsage: { actionUsed: false, bonusActionUsed: false, movementUsed: false, reactionUsed: false },
      initiativeOrder: [
        { id: char.id, type: 'character', name: char.name, initiative: 18, hp: 14, maxHp: char.maxHp, ac: 12, surprised: false, acted: false, proximity: 'close', status_effects: [] },
        { id: guardPoiInstance.id, type: 'enemy', name: 'Slumped Guard', initiative: 9, hp: 4, maxHp: 11, ac: 13, surprised: false, acted: false, proximity: 'close', status_effects: [] },
        ...(harwickPoiInstance ? [{ id: harwickPoiInstance.id, type: 'enemy', name: 'Harwick Vorne', initiative: 14, hp: 22, maxHp: 38, ac: 14, surprised: false, acted: false, proximity: 'far', status_effects: [] }] : []),
      ],
    };
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { gameState: 'combat', combatState: combatState as object },
    });
    await prisma.poiInstance.update({
      where: { id: guardPoiInstance.id },
      data: { currentProperties: { awareness_state: 'alert', current_hp: 4, hostile_to: ['player'] } },
    });
    await prisma.messageLog.create({
      data: {
        roomInstanceId: freshGuardPost.id,
        characterId: char.id,
        isMechanicalEvent: false,
        text: 'Two enemies. Your turn.',
      },
    });
    console.log(`[seed] combatState written: round=${combatState.round} actors=${combatState.initiativeOrder.length}`);

  } else {
    console.error(`Unknown scenario: ${scenario}`);
    process.exit(1);
  }

  console.log(`[seed] scenario=${scenario} sessionId=${session.id} characterId=${char.id}`);
  console.log(`Ready: http://localhost:3000/v2/play?sessionId=${session.id}&characterId=${char.id}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
