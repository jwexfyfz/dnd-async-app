# Phase 2: XP System - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 02-xp-system
**Areas discussed:** Encounter detection, XP grant amount, Level-up feedback, XP display location

---

## Encounter Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Claude signals it in JSON | Claude returns `encounterResult` field; code reads flag and awards code-determined XP | ✓ |
| Per-turn trickle | Award small fixed XP every turn; no encounter detection needed | |
| Player-triggered chip | Add "End Encounter" chip; player explicitly signals completion | |

**Signal shape:** `encounterResult: "completed" | null` (string enum chosen over boolean for future extensibility — "fled", "failed" states possible later)

**System prompt rules:** Explicit rules telling Claude when to signal `completed` — enemy defeated/fled, boss dies, room cleared.

---

## XP Grant Amount

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 100 XP | Every encounter awards 100 XP regardless of difficulty | |
| Per-action trickle | 10–25 XP per turn | |
| CR-based difficulty table | Beginner/Standard/Veteran → different XP values | ✓ |

**Values chosen:** Beginner 50 XP, Standard 100 XP, Veteran 200 XP
**Rationale:** ~6 Beginner or ~3 Standard encounters to reach level 2 (300 XP threshold). Meaningful progression pace.

---

## Level-Up Feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Claude narrates it | System prompt injection: "LEVEL UP: [Name] advanced to Level [N]" | ✓ |
| Dice card area banner | Extend existing dice card area with level-up banner | |
| Silent / status panel only | No announcement; player discovers in XP display | |

**System prompt content:** Just the level announcement — no mention of HP (Phase 3 handles HP recalculation).

---

## XP Display Location

| Option | Description | Selected |
|--------|-------------|----------|
| Party tab only | XP bar added to each member card in existing Party tab | ✓ |
| Party tab + roster cards | Show XP/level on Party tab AND home page character cards | |
| New Status tab | 4th tab in game screen dedicated to character status | |

**Visualization:** Progress bar with text (`Level N  ·  XP: 250 / 300`) below HP bar — same visual pattern.

**Data flow:** Server-authoritative only — data comes from `getGame` re-fetch (already fires after each turn), reads `partyMembers[].character.xp/level`. No client-side XP state.

**User clarification:** User explicitly raised concern about client-side desync risk. Resolved by relying on the existing post-turn `getGame` re-fetch rather than optimistic local state.

---

## Claude's Discretion

- Exact narration wording for level-up announcement
- XP bar color (blue suggested to distinguish from HP color coding)
- Whether `encounterResult` field appears in JSON schema comment in system prompt

## Deferred Ideas

- XP/level on roster character cards (home page) — noted, not in Phase 2 scope
- Bonus XP for critical hits or roleplaying moments — future enhancement
- XP recap at end of game session — separate feature
- Partial XP on flee/partial completion — Phase 2 keeps it simple (full XP on `completed`, zero otherwise)
