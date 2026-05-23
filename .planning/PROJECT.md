# Async AI D&D Web App

## What This Is

An asynchronous, text-driven, AI-powered Dungeons & Dragons web application optimized for short, mobile-first, 15-minute play increments. Players are notified when it's their turn, review the chat history, take their actions, and end their turn — advancing a global state machine without needing a human Dungeon Master. Built on Next.js + Supabase + Claude 3.5 Haiku.

## Core Value

A solo or small-group D&D experience that fits into a busy life — drop in for 15 minutes, take your turn, and come back when it's your turn again.

## Requirements

### Validated

- ✓ Google OAuth authentication via Supabase — existing
- ✓ D&D 5e point-buy character creation (stats, class, name) — existing
- ✓ Character roster display per user — existing
- ✓ Game lobby system (create, join, leave, kick, ready-up) — existing
- ✓ Host-controlled game start (lobby → active transition) — existing
- ✓ AI-narrated turn-taking loop (`take-turn` server action + Claude) — existing (with known critical bugs)
- ✓ Game state persisted as JSON blob in PostgreSQL — existing
- ✓ Message history per game (PLAYER / DUNGEON_MASTER roles) — existing

### Active

- [ ] Dice engine — pure TypeScript `rollD20()`, `rollDice()`, modifier application; replaces AI-invented rolls
- [ ] Server-side prompt injection fix in `take-turn.ts` — sanitize `chipText` input
- [ ] DB transaction on turn state mutation — prevent race conditions on concurrent turn submissions
- ✓ XP system — grant experience at encounter end, track totals on `Character`, display progress — Validated in Phase 02: xp-system
- ✓ Leveling — auto-level-up when XP crosses D&D Basic Rules threshold (levels 1–5); recalculate proficiency bonus and max HP — Validated in Phase 03: leveling
- [ ] Skill proficiency tracking — store which skills a character is proficient in; apply to d20 checks
- [ ] In-game skill checks — parse player intent → identify relevant skill → roll d20 + ability modifier + proficiency bonus if applicable
- [ ] Test coverage — unit tests for dice engine, XP math, level-up thresholds, and proficiency bonus application

### Out of Scope (this milestone)

- Levels 6–20 — addressed after levels 1–5 are stable and tested
- Class-specific features beyond proficiency bonus and HP (subclasses, spell slot progression, Extra Attack) — too complex for v1 leveling
- Real-time updates (WebSocket/Supabase Realtime) — separate initiative
- Notification system (Resend/Discord) — separate initiative
- Full initiative tracker UI — separate initiative

## Context

**Existing codebase:** Brownfield — auth, character creation, lobby, and turn-taking are all implemented. See `.planning/codebase/` for full maps. Codebase map identifies three CRITICAL bugs in the current turn-taking loop that must be fixed before skills can work correctly.

**D&D rules source:** D&D Basic Rules 2014 (dndbeyond.com). Targeting the core mechanic subset: XP thresholds (PHB table), proficiency bonus by level, skill check resolution (d20 + ability modifier + proficiency bonus if proficient).

**Phase order rationale:** Dice engine must come first — it's a prerequisite for correct skill checks and fixes critical existing bugs. XP → leveling → skills follows natural D&D dependency order.

**Test gap:** Zero test coverage currently. Vitest recommended for Next.js/ESM; needs install + config as part of Phase 1.

## Constraints

- **Tech stack:** Next.js App Router, Supabase PostgreSQL, Prisma ORM (Neon adapter), Claude 3.5 Haiku — no new infrastructure
- **Schema discipline:** Schema changes require explicit migrations; no `prisma db push` in production
- **AI guardrails:** Claude narrates outcomes only; all dice math and rule boundaries enforced in TypeScript
- **Scope:** Levels 1–5 only; D&D Basic Rules 2014 as the rules authority
- **Credits:** Phase the work to minimize Claude API usage during build/test cycles

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dice engine before leveling | Skill checks require correct dice math; fixes critical bugs first | — Pending |
| Levels 1–5 only for v1 | Reduces complexity; most D&D play happens in this tier | — Pending |
| Vitest for testing | ESM-compatible, fast, works with Next.js without config gymnastics | — Pending |
| XP granted at encounter end (code, not AI) | AI must not control XP awards — keeps rules deterministic | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-22 after Phase 02 (XP System) completion*
