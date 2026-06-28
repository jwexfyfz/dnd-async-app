# Plan: Leveling Mechanics (V2)

> Status: **COMPLETE** — All phases 0–12 implemented. Last updated: 2026-06-20.

---

## Implementation Status

| Phase | Name | Status | File |
|---|---|---|---|
| 0 | Dev Testing Dungeon Seed | ✅ DONE | [phases-0-4](./PLAN-leveling-phases-0-4.md) |
| 1 | XP Math Foundation | ✅ DONE | [phases-0-4](./PLAN-leveling-phases-0-4.md) |
| 2 | Character Schema Extension | ✅ DONE | [phases-0-4](./PLAN-leveling-phases-0-4.md) |
| 3 | Combat XP Engine | ✅ DONE | [phases-0-4](./PLAN-leveling-phases-0-4.md) |
| 4 | Milestone XP + Situation Summary | ✅ DONE | [phases-0-4](./PLAN-leveling-phases-0-4.md) |
| 5 | ViewState XP Fields | ✅ DONE | [phases-5-8](./PLAN-leveling-phases-5-8.md) |
| 6 | XP Visibility UI | ✅ DONE | [phases-5-8](./PLAN-leveling-phases-5-8.md) |
| 7 | Pending Choice UI (Indicators) | ✅ DONE | [phases-5-8](./PLAN-leveling-phases-5-8.md) |
| 8 | ASI Choice | ✅ DONE | [phases-5-8](./PLAN-leveling-phases-5-8.md) |
| 9A | ClassFeature Schema Migration | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 9B | Fighter Seed + Zod Validation | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 9C | Remaining 12 Classes | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 10A | CLASS_DEFINITIONS + Subclass Endpoint | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 10B | In-Game Subclass Picker | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 10C | Character Creation Overlay Redesign | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 11 | Feature Engine + Extra Attack | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |
| 12 | Rest Mechanics | ✅ DONE | [phases-9-12](./PLAN-leveling-phases-9-12.md) |

---

## Design Goals

This is an **async, casual** D&D game — players take turns over hours/days, not in a live session.

1. **Zero manual bookkeeping.** XP and level-ups happen automatically. Players never "spend" or
   track anything — but they make *choices* at key moments (ASI, subclass) that drive return visits.
2. **Reward story progress, not just combat.** Milestone XP means non-combat play paths don't fall behind.
3. **Progress visible at every scale.** XP moves after every event, not just at level boundaries.
4. **Choices create anticipation.** ASI and subclass selections queue as pending actions — a player can
   log off mid-dungeon and come back knowing something is waiting.
5. **Reuse V1 math wholesale.** `lib/xp.ts` and `lib/leveling.ts` are pure, already unit-tested, and
   5e-accurate for L1–5. Extend for L1–20; don't replace.

---

## Scope: Levels 1–20

Campaigns target a level range — The Sunken Cellar is L1–5. Individual encounter design, not XP gates,
controls difficulty within a campaign.

Full 5e XP thresholds (`XP_THRESHOLDS` in `lib/xp.ts`):

| Level | XP     | Level | XP      |
|-------|--------|-------|---------|
| 1     | 0      | 11    | 85,000  |
| 2     | 300    | 12    | 100,000 |
| 3     | 900    | 13    | 120,000 |
| 4     | 2,700  | 14    | 140,000 |
| 5     | 6,500  | 15    | 165,000 |
| 6     | 14,000 | 16    | 195,000 |
| 7     | 23,000 | 17    | 225,000 |
| 8     | 34,000 | 18    | 265,000 |
| 9     | 48,000 | 19    | 305,000 |
| 10    | 64,000 | 20    | 355,000 |

Proficiency bonus: `Math.ceil(level / 4) + 1` → +2 at L1–4, +3 at L5–8, +4 at L9–12, +5 at L13–16, +6 at L17–20.

---

## Resolved Decisions

1. **Full heal on level-up.** Level-up restores HP to the new maximum. Mid-combat level-ups are rare
   enough that this isn't exploitable; the full heal creates a meaningful reward moment.
   Exception: downed characters (`currentHp === 0`) get the new `maxHp` but `currentHp` stays at 0.

2. **Subclass timing follows 5e exactly.** Cleric, Warlock, Sorcerer pick at L1 (character creation overlay).
   Wizard picks at L2 (in-game pending-choice flow). All other classes pick at L3 (in-game pending-choice
   flow). No simplification.

3. **Feat option at ASI levels deferred.** ASI choice is +2 to one stat or +1/+1 to two stats only.
   Feats require per-feat engine logic — out of scope until campaign scope grows.

4. **XP awarded flat per enrolled character, never split.** Async play means uneven participation is
   the norm. Splitting XP punishes players who were offline when a kill happened.

5. **No `ACTIVE_ABILITY` feature gets `implemented: true` until Phase 12 ships.** Setting it before
   the rest endpoint exists grants unlimited uses (resource never decrements).

---

## Phase Files

| File | Phases | What's inside |
|---|---|---|
| [PLAN-leveling-phases-0-4.md](./PLAN-leveling-phases-0-4.md) | 0–4 | XP sources, level-up effects, phase specs for seed through milestone XP |
| [PLAN-leveling-phases-5-8.md](./PLAN-leveling-phases-5-8.md) | 5–8 | Level-up user flows, progress visibility, mid-battle rules, phase specs for UI layer |
| [PLAN-leveling-phases-9-12.md](./PLAN-leveling-phases-9-12.md) | 9A–12 | Data model, character creation flow, feature mechanics, phase specs for feature engine |
