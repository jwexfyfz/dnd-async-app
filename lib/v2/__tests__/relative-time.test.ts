import { describe, it, expect } from 'vitest';
import { relativeTime } from '../relative-time';

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('relativeTime', () => {
  it('returns "Today" for timestamps within the last 24h', () => {
    expect(relativeTime(iso(0))).toBe('Today');
  });

  it('returns "Yesterday" for ~1 day ago', () => {
    expect(relativeTime(iso(1))).toBe('Yesterday');
  });

  it('returns "N days ago" for 2–6 days', () => {
    expect(relativeTime(iso(3))).toBe('3 days ago');
    expect(relativeTime(iso(6))).toBe('6 days ago');
  });

  it('returns "1 week ago" for 7–13 days', () => {
    expect(relativeTime(iso(7))).toBe('1 week ago');
    expect(relativeTime(iso(13))).toBe('1 week ago');
  });

  it('returns "N weeks ago" for 14–29 days', () => {
    expect(relativeTime(iso(14))).toBe('2 weeks ago');
    expect(relativeTime(iso(21))).toBe('3 weeks ago');
    expect(relativeTime(iso(29))).toBe('4 weeks ago');
  });

  it('returns "N months ago" for 30+ days', () => {
    expect(relativeTime(iso(30))).toBe('1 month ago');
    expect(relativeTime(iso(60))).toBe('2 months ago');
  });
});
