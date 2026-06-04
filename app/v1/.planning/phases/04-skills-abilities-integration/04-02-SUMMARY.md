---
phase: 04-skills-abilities-integration
plan: "02"
subsystem: abilities-ui
tags: [server-action, prisma, react-hooks, class-features]
dependency_graph:
  requires: []
  provides: [getClassFeatures server action, MemberAbilitiesPane DB-wired]
  affects: [app/game/[id]/page.tsx, app/actions/get-class-features.ts]
tech_stack:
  added: []
  patterns: [useEffect+loading skeleton (MemberInventoryPane analog), groupBy level with Map.reduce]
key_files:
  created: [app/actions/get-class-features.ts]
  modified: [app/game/[id]/page.tsx]
decisions:
  - CLASS_FEATURES deleted entirely — no migration shim needed; DB is seeded for all 4 classes
  - useEffect dependency array is [char.id, char.level] to re-fetch when character selection or level changes
  - Features grouped by level with Array.from(Map).sort() — avoids Object.groupBy which has limited browser support
  - "New" badge uses violet-100/violet-700 per plan spec — matches violet accent theme in existing UI
metrics:
  duration_minutes: 8
  completed_date: "2026-05-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
requirements_satisfied: [SKILL-05]
---

# Phase 04 Plan 02: Abilities Sub-Tab DB Wiring Summary

Replaced hardcoded CLASS_FEATURES map with live ClassFeature DB fetch via getClassFeatures server action. MemberAbilitiesPane now groups features by level 1–currentLevel and badges newly-unlocked features at the character's current level.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create get-class-features.ts server action | 2d387ec | app/actions/get-class-features.ts (new) |
| 2 | Rewrite MemberAbilitiesPane; delete CLASS_FEATURES | 337dad2 | app/game/[id]/page.tsx |

## What Was Built

**app/actions/get-class-features.ts** — New server action following the get-map-items.ts pattern exactly:
- Exports `ClassFeatureData` interface (id, characterClass, level, name, description)
- Exports `getClassFeatures(characterClass, maxLevel)` using `prisma.classFeature.findMany` with `level: { lte: maxLevel }`, ordered by level then name
- No auth check — ClassFeature is public reference data with no PII

**app/game/[id]/page.tsx** — MemberAbilitiesPane rewritten:
- `useState<ClassFeatureData[]>([])` and `useState(true)` for loading
- `useEffect([char.id, char.level])` calls `getClassFeatures(char.characterClass, char.level)`
- Loading renders `<p className="text-[11px] text-slate-400 py-2">Loading…</p>`
- Features grouped by level via `Map.reduce`, rendered with level headings
- `New` badge (`bg-violet-100 text-violet-700`) on features where `feature.level === char.level`
- Proficiency bonus display retained at top of pane

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data sourced from seeded ClassFeature DB rows.

## Threat Flags

None — no new trust boundaries introduced. getClassFeatures accepts characterClass/maxLevel from CharacterData (server-fetched via getGame); not user-controlled input.

## Verification

1. `npm run build` exits 0 — confirmed
2. `grep -c "CLASS_FEATURES" app/game/[id]/page.tsx` returns 0 — confirmed
3. Manual: open game page → Party tab → Abilities sub-tab — features load from DB
4. Manual: level 2+ characters show "New" badge on their current-level features
5. Manual: switching party members updates features to match the new character's class and level

## Self-Check: PASSED

- app/actions/get-class-features.ts: FOUND
- app/game/[id]/page.tsx CLASS_FEATURES grep = 0: CONFIRMED
- Commit 2d387ec: FOUND
- Commit 337dad2: FOUND
- npm run build: exit 0 CONFIRMED
