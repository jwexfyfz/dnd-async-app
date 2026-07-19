import type { GachaRarity, GachaPullRecord } from '@/types/v2-game';
import {
  COMMON_ITEMS,
  UNCOMMON_ITEMS,
  getRarePool,
  getLegendaryPool,
  filterDuplicates,
  type GachaItemDef,
} from './gacha-items';

// ─── Pity / rate math ────────────────────────────────────────────────────────

export function legendaryRate(pityCount: number): number {
  return Math.min(1.0, 0.02 + Math.max(0, pityCount - 29) * 0.10);
}

export function rollRarity(pityCount: number): { rarity: GachaRarity; d100: number } {
  const d100 = Math.floor(Math.random() * 100) + 1;

  // Guaranteed pity at 40
  if (pityCount >= 40) return { rarity: 'legendary', d100 };

  // Soft pity: bonus legendary chance on top of the base 2% (d100 99-100)
  if (pityCount >= 30) {
    const bonusRate = legendaryRate(pityCount) - 0.02;
    if (Math.random() < bonusRate) return { rarity: 'legendary', d100 };
  }

  // d100 determines rarity — thresholds match the UI display
  if (d100 >= 99) return { rarity: 'legendary', d100 };
  if (d100 >= 89) return { rarity: 'rare', d100 };
  if (d100 >= 61) return { rarity: 'uncommon', d100 };
  return { rarity: 'common', d100 };
}

// ─── Item selection ───────────────────────────────────────────────────────────

export function selectItem(
  rarity: GachaRarity,
  characterClass: string,
  pullHistory: GachaPullRecord[],
): GachaItemDef {
  const pulledIds = pullHistory.map(r => r.itemId);

  let pool: GachaItemDef[];
  if (rarity === 'legendary') {
    pool = filterDuplicates(getLegendaryPool(characterClass), pulledIds);
  } else if (rarity === 'rare') {
    pool = filterDuplicates(getRarePool(characterClass), pulledIds);
  } else if (rarity === 'uncommon') {
    pool = filterDuplicates(UNCOMMON_ITEMS, pulledIds);
  } else {
    pool = COMMON_ITEMS; // consumables never excluded
  }

  // Fallback: if equipment pool is empty (player has all items in tier), drop one tier
  if (pool.length === 0) {
    if (rarity === 'legendary') return selectItem('rare', characterClass, pullHistory);
    if (rarity === 'rare') return selectItem('uncommon', characterClass, pullHistory);
    return COMMON_ITEMS[0]; // absolute floor
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Pity flavor text ─────────────────────────────────────────────────────────

export function getPityFlavor(pityCount: number): string {
  const rate = legendaryRate(pityCount);
  if (pityCount >= 40) return "Your guardian angel's gift awaits.";
  if (rate >= 0.90) return "Your guardian angel's greatest gift stirs — it is almost time.";
  if (rate >= 0.70) return 'Your guardian angel is preparing something exceptional for you.';
  if (rate >= 0.50) return 'Your guardian angel thinks you deserve a truly good gift.';
  if (rate >= 0.30) return 'Your guardian angel believes you have earned something meaningful.';
  if (rate >= 0.10) return "Your guardian angel stirs — your dedication hasn't gone unnoticed.";
  return 'Your guardian angel offers you a small token of their favor.';
}

export function isSoftPity(pityCount: number): boolean {
  return pityCount >= 30;
}

// ─── Streak logic ─────────────────────────────────────────────────────────────

function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export interface StreakResult {
  streakDays: number;
  streakShields: number;
  lastStreakDate: string;
  pendingPullsAdded: number;
  shieldUsed: boolean;
  streakBroken: boolean;
  newShieldEarned: boolean;
  message: string | null;
}

export function computeStreakUpdate(
  current: { streakDays: number; streakShields: number; lastStreakDate: string | null },
): StreakResult {
  const today = utcDateString();
  const yesterday = utcDateString(new Date(Date.now() - 86400000));
  const twoDaysAgo = utcDateString(new Date(Date.now() - 172800000));

  let { streakDays, streakShields } = current;
  const { lastStreakDate } = current;
  let shieldUsed = false;
  let streakBroken = false;
  let pendingPullsAdded = 0;
  let message: string | null = null;

  if (lastStreakDate === today) {
    // Already active today
    return { streakDays, streakShields, lastStreakDate: today, pendingPullsAdded: 0, shieldUsed: false, streakBroken: false, newShieldEarned: false, message: null };
  }

  if (lastStreakDate === yesterday) {
    streakDays += 1;
  } else if (lastStreakDate === twoDaysAgo && streakShields > 0) {
    streakShields -= 1;
    streakDays += 1;
    shieldUsed = true;
    message = `Your streak shield saved your ${streakDays}-day streak.`;
  } else {
    streakDays = 1;
    streakBroken = lastStreakDate !== null;
    if (streakBroken) message = 'Your streak was broken.';
  }

  let newShieldEarned = false;
  if (streakDays > 0 && streakDays % 7 === 0) {
    streakShields += 1;
    pendingPullsAdded += 1;
    newShieldEarned = true;
  }

  return { streakDays, streakShields, lastStreakDate: today, pendingPullsAdded, shieldUsed, streakBroken, newShieldEarned, message };
}
