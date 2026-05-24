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
- ✓ AI-narrated turn-taking loop (`take-turn` server action + Claude) — existing
- ✓ Game state persisted as JSON blob in PostgreSQL — existing
- ✓ Message history per game (PLAYER / DUNGEON_MASTER roles) — existing
- ✓ Dice engine — pure TypeScript `rollD20()`, `rollDice()`, `abilityModifier()`, modifier application — Validated in Phase 01: dice-engine-critical-bug-fixes
- ✓ Server-side prompt injection fix — `chipText` sanitized; `stateDeltas` key allowlist enforced — Validated in Phase 01
- ✓ DB transaction on turn state mutation — `$transaction` + optimistic version lock — Validated in Phase 01
- ✓ Test coverage — unit tests for dice engine, XP math, level-up thresholds, proficiency bonus — Validated in Phases 01–03
- ✓ XP system — grant experience at encounter end, track totals on `Character`, display progress — Validated in Phase 02: xp-system
- ✓ Leveling — auto-level-up when XP crosses D&D Basic Rules thresholds (levels 1–5); recalculate `maxHp` per class hit die; proficiency bonus steps at level 5 — Validated in Phase 03: leveling
- ✓ Party tab — Stats / Inventory / Abilities sub-tabs; equipment slots grid; backpack list with stat diffs; `EquippableItem` DB table seeded per-map — Manually implemented post-Phase 03
- ✓ Class data schemas — `ClassProgression` and `ClassFeature` tables seeded for Fighter, Rogue, Cleric, Wizard levels 1–20 — Manually implemented post-Phase 03

### Validated

- ✓ `Character.skillProficiencies String[]` — per-character skill picks stored in DB; class-gated UI + server validation; backfill script seeded defaults — Validated in Phase 04: skills-abilities-integration
- ✓ `resolveSkillCheck()` in `lib/skills.ts` — d20 + ability modifier + proficiency bonus; injectable `rollFn`; 33 unit tests covering all behavior groups — Validated in Phase 04
- ✓ In-game skill check integration — two-call architecture in `take-turn.ts`; `[SKILL skill=X outcome=Y]` keyword injected into Claude narration; SkillCheckCard renders in violet — Validated in Phase 04
- ✓ Abilities sub-tab wired to `ClassFeature` DB — `getClassFeatures` server action; hardcoded `CLASS_FEATURES` map deleted; "New" badge on current-level features — Validated in Phase 04

### Active

- [ ] Passive Perception — stored derived value; computed server-side from WIS modifier + proficiency if proficient; never rolled per action

### Out of Scope (this milestone)

- Levels 6–20 — addressed after levels 1–5 are stable and tested
- Rogue Expertise (double proficiency bonus) — deferred; commented no-op in `resolveSkillCheck()`
- Ability Score Improvements at level 4 — deferred; explicit commented no-op in level-up handler
- Class-specific resource pools (spell slots, rage charges) — deferred; `ClassProgression.resourcePoolMax` column exists but not wired to UI
- Real-time updates (WebSocket/Supabase Realtime) — separate initiative
- Notification system (Resend/Discord) — separate initiative
- Full initiative tracker UI — separate initiative

## Context

**Existing codebase:** Brownfield — auth, character creation, lobby, turn-taking, XP, leveling, and a Party tab with Stats / Inventory / Abilities sub-tabs are all implemented. See `.planning/codebase/` for full maps.

**UI state (post-Phase 03 manual work):** `app/game/[id]/page.tsx` contains three Party sub-tab panes — `MemberStatsPane` (6-stat grid + Actions & Skills list), `MemberInventoryPane` (equipment slots + backpack), and `MemberAbilitiesPane` (proficiency bonus + class features). Both the skills list and the abilities list currently use hardcoded lookup maps (`SKILL_PROFS` in `lib/character-sheet.ts`, `CLASS_FEATURES` in `page.tsx`) — Phase 04 replaces these with DB-driven values.

**Schema state (post-Phase 03 manual work):** `Character` holds `strength`, `dexterity`, `constitution`, `intelligence`, `wisdom`, `charisma`, `xp`, `level`, `maxHp`, `currentHp`. It does NOT yet have `skillProficiencies`. `ClassProgression` and `ClassFeature` are seeded for Fighter/Rogue/Cleric/Wizard levels 1–20. `EquippableItem` is seeded per-map with `combatImpactLabel` metadata keywords.

**D&D rules source:** D&D Basic Rules 2014 (dndbeyond.com). Targeting the core mechanic subset: proficiency bonus by level, skill check resolution (d20 + ability modifier + proficiency bonus if proficient), class-gated skill pick counts at creation.

**Phase order rationale:** Foundation (dice engine → XP → leveling) is complete. Phase 04 targets the remaining player-facing mechanics layer: skill proficiency storage, real skill check resolution in `take-turn.ts`, and wiring the existing sub-tabs to live DB data.

## Constraints

- **Tech stack:** Next.js App Router, Supabase PostgreSQL, Prisma ORM (Neon adapter), Claude 3.5 Haiku — no new infrastructure
- **Schema discipline:** Schema changes require explicit migrations; no `prisma db push` in production
- **AI guardrails:** Claude narrates outcomes only; all dice math and rule boundaries enforced in TypeScript
- **Scope:** Levels 1–5 only; D&D Basic Rules 2014 as the rules authority
- **Credits:** Phase the work to minimize Claude API usage during build/test cycles

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dice engine before leveling | Skill checks require correct dice math; fixes critical bugs first | ✓ Delivered in Phase 01 |
| Levels 1–5 only for v1 | Reduces complexity; most D&D play happens in this tier | Holding |
| Vitest for testing | ESM-compatible, fast, works with Next.js without config gymnastics | ✓ Delivered in Phase 01 |
| XP granted at encounter end (code, not AI) | AI must not control XP awards — keeps rules deterministic | ✓ Delivered in Phase 02 |
| `maxHp` on `Character` table, not `Game.state` blob | Authoritative source; persists across games; updated atomically on level-up | ✓ Delivered in Phase 03 |
| `ClassProgression` / `ClassFeature` as DB tables | Enables runtime feature lookup by (class, level) without code changes; powers Abilities sub-tab level-up references | Manually implemented post-Phase 03 |
| `EquippableItem` seeded per-map with `combatImpactLabel` keywords | Token-efficient: Claude reads a label string, not a verbose description; stat parser in UI extracts numeric deltas | Manually implemented post-Phase 03 |
| Token-efficient keyword format for skill check context | Claude receives `[SKILL skill=X outcome=Y dc=N]` in a `MECHANICAL CONTEXT` system prompt block; narration rules forbid reproducing the block or exposing roll / DC / proficiency bonus | Pending — Phase 04 |
| `skillProficiencies String[]` on `Character` (not JSON map) | Sufficient for levels 1–5; Rogue Expertise deferred; simpler to validate and query than a map | Pending — Phase 04 |
| Backfill uses thematic class defaults | Existing characters with empty `skillProficiencies` are seeded with the most representative picks per class (e.g. Fighter → Athletics + Intimidation, Rogue → Stealth + Perception) rather than the first N alphabetically | Pending — Phase 04 |
| Failed skill checks write a `stateDeltas` flag | e.g. `guardsAlerted: true` on a failed Stealth check; flag is stored in `Game.state` and available to Claude for narration; downstream gameplay consequences of the flag are deferred to a later phase | Pending — Phase 04 |
| Abilities sub-tab shows cumulative feature list | All `ClassFeature` records up to the character's current level, grouped by level — serves as a permanent reference sheet, not just "what's new" | Pending — Phase 04 |
| Skill picks happen once at creation; no level-up selection | In D&D 5e Basic Rules levels 1–5, skill proficiencies are set at creation and do not change; proficiency bonus increase at level 5 auto-improves all proficient skills without UI interaction | Pending — Phase 04 |

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
*Last updated: 2026-05-24 2026-05-23 — Phase 04 scope revised to reflect post-Phase 03 manual implementation (Party tab sub-tabs, ClassProgression/ClassFeature, EquippableItem)*
