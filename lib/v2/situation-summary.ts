import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { xpForNextLevel } from '@/lib/xp';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM =
  'You are a game-state summarizer. Write 1-2 punchy sentences (max 200 chars total) describing the immediate physical/social reality, the current threat, and the exact choice or action hanging in the air. Second person. No filler. No poetry. Examples: "Successfully picked the armory lock, but two goblin guards just rounded the corner and spotted you. Roll for initiative." / "Mid-negotiation with the tavern keeper for information on the missing necklace. He\'s demanding a 50 gold bribe before he talks."';

async function callHaiku(text: string): Promise<string | null> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 80,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Summarize this game state in 1-2 sentences:\n\n${text.slice(-2000)}` }],
    });
    const result = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : null;
    return result || null;
  } catch {
    return null;
  }
}

// ─── levelUpThisFight ─────────────────────────────────────────────────────────

export function levelUpThisFight(
  characters: Array<{ name: string; xp: number; level: number }>,
  combatXpPool: number,
): string[] {
  return characters
    .filter(c => {
      const needed = xpForNextLevel(c.level);
      return needed !== null && c.xp + combatXpPool >= needed;
    })
    .map(c => c.name);
}

// For v2 GameSession — caches in storyFlags._uiCache
export async function getSessionSituationSummary(sessionId: string): Promise<string | null> {
  const [messages, session] = await Promise.all([
    prisma.messageLog.findMany({
      where: { roomInstance: { sessionId }, isMechanicalEvent: false },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, text: true, mechanicalSummary: true },
    }),
    prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { storyFlags: true },
    }),
  ]);
  if (!session) return null;

  const lastNarrative = messages.find(m => {
    const ms = m.mechanicalSummary as { type?: string } | null;
    return !ms || ms.type !== 'player_action';
  });
  if (!lastNarrative) return null;

  const flags = (session.storyFlags as Record<string, unknown>) ?? {};
  const cache = flags._uiCache as { summary: string; lastMessageId: string } | undefined;
  if (cache?.lastMessageId === lastNarrative.id && cache.summary) {
    return cache.summary;
  }

  const summary = await callHaiku(lastNarrative.text);
  if (summary) {
    prisma.gameSession.update({
      where: { id: sessionId },
      data: { storyFlags: { ...flags, _uiCache: { summary, lastMessageId: lastNarrative.id } } as object },
    }).catch(() => {});
  }
  return summary;
}

// For v1 Game — caches in worldState._situationCache
export async function getGameSituationSummary(
  game: { id: string; narrativeHistory: string[]; worldState: unknown },
): Promise<string | null> {
  const lastNarrative = game.narrativeHistory.at(-1);
  if (!lastNarrative) return null;

  const ws = (game.worldState ?? {}) as Record<string, unknown>;
  const cache = ws._situationCache as { summary: string; narrativeCount: number } | undefined;
  if (cache?.narrativeCount === game.narrativeHistory.length && cache.summary) {
    return cache.summary;
  }

  const summary = await callHaiku(lastNarrative);
  if (summary) {
    prisma.game.update({
      where: { id: game.id },
      data: { worldState: { ...ws, _situationCache: { summary, narrativeCount: game.narrativeHistory.length } } },
    }).catch(() => {});
  }
  return summary;
}
