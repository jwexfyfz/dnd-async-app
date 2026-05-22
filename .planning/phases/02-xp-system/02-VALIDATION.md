---
phase: 02
phase-slug: xp-system
date: 2026-05-22
---

# Phase 02: XP System — Validation Strategy

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npm run test:run -- lib/xp.test.ts` |
| Full suite command | `npm run test:run` |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| XP-02 | `computeLevel` returns correct level at all 10 boundary XP values | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |
| XP-02 | `xpForNextLevel` returns correct threshold or null at levels 1–5 | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |
| XP-05 | All 10 threshold boundary values pass: (0→1), (299→1), (300→2), (301→2), (899→2), (900→3), (2699→3), (2700→4), (6499→4), (6500→5) | unit | `npm run test:run -- lib/xp.test.ts` | Wave 0 |

XP-01, XP-03, XP-04 involve DB schema, server actions, and UI — not unit-testable in isolation:
- **XP-01**: `npm run db:push` exits 0; `npx prisma generate` exits 0; `xp` and `level` columns visible on Character
- **XP-03**: End-to-end via manual game turn with a "Beginner" story prompt; character.xp increments by 50 in DB after `encounterResult: "completed"`
- **XP-04**: Visual inspection of Party tab after an encounter-completing turn; XP bar renders with "Level N · XP: X / Y" label

## Sampling Rate

| Gate | Command |
|------|---------|
| Per task commit | `npm run test:run -- lib/xp.test.ts` |
| Per wave merge | `npm run test:run` |
| Phase gate | Full suite green before `/gsd:verify-work` |

## Wave 0 Gaps

- [ ] `lib/xp.test.ts` — covers XP-02 and XP-05 (does not exist yet; created in Plan 02-01 Task 3)
