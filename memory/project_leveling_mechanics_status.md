---
name: project-leveling-mechanics-status
description: Status of leveling mechanics phases (XP, class features, subclasses, rest)
metadata:
  type: project
---

Phases 9B–12 implemented 2026-06-20. All backend logic is complete; two UI-only phases remain.

**What shipped:**
- Phase 9B: Fighter seed with full L1-5 ClassFeature rows (Zod validation, FeatureResourcePool for second_wind/action_surge, Champion/BM/EK Subclass rows). `types/v2-feature-mechanics.ts` and `lib/v2/seed-schemas.ts` created.
- Phase 9C: All 13 classes seeded (ClassProgression + ClassFeature L1-5 + Subclass rows). `canLongRest` added to RoomTemplate schema (migration: 20260620053000). Quartermaster Hub marked `canLongRest: true`.
- Phase 10A: `lib/v2/class-definitions.ts` (CLASS_DEFINITIONS constant). Level-up endpoint extended with subclass branch (PATCH `/api/v2/me/characters/[id]/level-up`). New GET `/api/v2/subclasses?class=Fighter` endpoint.
- Phase 11: `lib/v2/db-context.ts` — `attacksPerAction()` function + `classFeatures` fetch added to `lookupDatabaseContext`. Combat engine — Extra Attack loop (numAttacks), `critThreshold` override, sneak attack fires once per turn. `CharacterStats` type extended with `resourceStates` and `classFeatureDetails`.
- Phase 12: `lib/v2/rest-helpers.ts` (short/long rest logic). POST `/api/v2/me/characters/[id]/rest` endpoint. POST `/api/v2/me/characters/[id]/ability` endpoint (direct ability use + resource decrement). ViewState now includes resourceStates and classFeatureDetails.

**What remains (UI only):**
- Phase 10B: `components/v2/character/SubclassPicker.tsx` — swipeable subclass cards for in-game pending-choice flow.
- Phase 10C: `app/v2/setup/page.tsx` overlay redesign — class detail + inline subclass picker at character creation.
- Short rest button in PartyTab (show when resources depleted, not in combat).
- Auto long rest on session load (check lastLongRest > 8h, apply + note in "While you were away" modal).
- "Make Camp" action in rooms with canLongRest: true.

**Why:** Phase 0 seed not yet run in production. Run `npx prisma db seed` to populate class features. New characters created after seed will have correct featuresUnlocked from level-up. Existing characters need backfill (handled in seed for test char Aldric).
