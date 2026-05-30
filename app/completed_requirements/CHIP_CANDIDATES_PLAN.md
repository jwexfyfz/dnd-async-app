# Chip Candidates Refactor Plan

## Purpose
Replace the current narrative-first chip generation (Claude invents coordinates)
with a mechanical-first approach (code enumerates valid spatial options, Claude
only labels them). Every SuggestionChip must have non-null actionTarget,
action_type, endPosition, movementFeet, and requiresRoll.

## Resume Instructions
- Read this file first on every session start
- After each phase completes, mark it [x] and add a one-line note
- Minimize output: no long explanations, no re-reading files already noted below
- When context is getting full, checkpoint by updating this doc and starting fresh
- Run `npm run build` after each phase to catch type errors early
- Key files: prisma/schema.prisma, prisma/seed.mjs, types/suggestion-chip.ts,
  app/actions/take-turn.ts, app/actions/auto-advance.ts

## Design Decisions (do not re-litigate these)
- No WeaponDefinition DB table — weapon type lookup lives in lib/weapon-types.ts
- weaponType and rangeFeet both stored on Item (rangeFeet denormalized for fast reads)
- Enemy gets mainHandId FK → Item (same pattern as Character)
- One combined chip for move+attack (not two separate chips)
- 8-direction Chebyshev adjacency for melee approach tiles
- actionTarget = playerPos for self-targeting actions (never null)
- endPosition = playerPos for non-movement actions (never null)
- Seed files updated in-place (no separate migration seed)
- SuggestionChip.actionTarget and .endPosition become required (not optional)

## Weapon Types Reference (lib/weapon-types.ts)
melee:         5ft   (daggers, swords, axes, clubs, picks)
reach:         10ft  (polearms, whips, spears)
thrown:        20ft  (handaxes, daggers when thrown)
ranged_light:  80ft  (shortbow, light crossbow, hand crossbow)
ranged_heavy:  150ft (longbow, heavy crossbow)

## Phases

### Phase 1 — Schema: add weapon fields to Item and Enemy [x]
Migration: 20260529070146_add_weapon_schema applied. prisma generate clean.

### Phase 2 — New file: lib/weapon-types.ts [x]
lib/weapon-types.ts exists with WEAPON_RANGE_FEET record. All 5 weapon types present.

### Phase 3 — Seed: create enemy weapons and link mainHandId [x]
prisma/seed-enemy-weapons.mjs created and run. 19/19 enemies seeded with weapon Items.

### Phase 4 — Seed: add weaponType/rangeFeet to existing player-facing Item seeds [x]
seed-items.ts, seed-equippable-items.ts updated. All Weapon blueprints now have weaponType+rangeFeet.

### Phase 5 — New file: lib/chip-candidates.ts [x]
lib/chip-candidates.ts created with ChipCandidate interface and buildChipCandidates(). Build clean.

### Phase 6 — Type changes: suggestion-chip.ts [x]
Made endPosition and actionTarget required. Fixed 5 call sites (auto-advance, take-turn, handle-player-action, page.tsx x2). Build clean.

### Phase 7 — Prompt changes in take-turn.ts and auto-advance.ts [x]
Both files updated: rangeFeet added to mainHand select, CANDIDATE LIST injected
into dynamic prompt, chip rules changed to candidateId-based format, post-processing
replaced with candidate lookup (flatMap skips invalid candidateIds). Build clean.

### Phase 8 — Integration test [x]
Build clean. Verified candidatesToChips logic directly: all 4 scenarios (melee
in-range, melee out-of-range+POI, ranged, no enemies) produce non-null fields.
auto-advance.ts confirmed to use same candidate flow.

### Phase 9 — Remove AI chip selection, code generates chips directly [x]
candidatesToChips() added to lib/chip-candidates.ts. Both take-turn.ts and
auto-advance.ts now call it instead of the candidateMap lookup. Chip instructions
stripped from all prompts. normaliseSuggestionChips, buildFallbackSuggestionChips,
CHIP_FORMAT_INSTRUCTION, toLegacyChips all deleted. TurnResult.chips changed
from Chip[] to SuggestionChip[]. Build clean.

## Context Management Notes
- Phases 1-4 are schema/seed only — can be done in one session
- Phases 5-6 are new files + type changes — moderate context
- Phase 7 is the largest change (prompt surgery in two big files) — do in fresh context
  with only take-turn.ts and auto-advance.ts loaded
- Phase 8 needs running app — use `npm run dev` and the seed scenario

## Known File Sizes (avoid re-reading unless necessary)
- take-turn.ts: ~1044 lines
- auto-advance.ts: ~650 lines
- seed.mjs: ~500 lines
- suggestion-chip.ts: 38 lines
- schema.prisma: ~232 lines