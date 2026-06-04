# Phase 1: Dice Engine & Critical Bug Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 1-dice-engine-critical-bug-fixes
**Areas discussed:** Dice result visibility, Claude API call reduction, Player fun / DM fiat

---

## Dice Result Visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Full dice card in chat | Render structured inline block matching CLAUDE.md spec | |
| Narrative only | Defer dice card UI to later phase | |
| Both — card + narrative | Show dice card AND Claude's narrative paragraph | ✓ |

**User's choice:** Both — card + narrative
**Notes:** User confirmed this matches the CLAUDE.md spec intent.

---

## Dice Card Position

| Option | Description | Selected |
|--------|-------------|----------|
| Card above narration | Mechanical result first, story consequence below | |
| Card below narration | Story-first, dice as footnote | |
| Card + DC shown above | Full detail including target number, card above narration | ✓ |

**User's choice:** Card + DC shown above — full format `🎲 14 + 3 = 17  vs AC 14  HIT!`
**Notes:** User viewed ASCII mockups of all three layouts and selected the full-detail version.

---

## Target Number Label

| Option | Description | Selected |
|--------|-------------|----------|
| Dynamic label | "vs AC" for attacks, "vs DC" for skill checks | ✓ |
| Always "vs DC" | Uniform label, simpler | |
| Omit target | Show math only, not what it was checked against | |

**User's choice:** Dynamic label
**Notes:** No clarifications needed.

---

## Claude API Call Reduction

| Option | Description | Selected |
|--------|-------------|----------|
| Claude narrates every roll | One Claude call per turn regardless of action type | |
| Tiered templates for attacks | Template pool for common outcomes, Claude for story beats | |
| Classify action first, route | Code determines mechanical vs complex → template or Claude | |

**User's choice:** (Redirected from this framing)
**Notes:** User asked whether code-generated dice rolls matter if Claude narrates anyway. Discussed: code generates rolls for FAIRNESS and AUDITABILITY, not to constrain Claude's creativity. Claude still writes fun narration — it just does so knowing the mechanically determined outcome. User agreed code-generated makes sense.

---

## Player Fun / DM Fiat

| Option | Description | Selected |
|--------|-------------|----------|
| Death saving throws | 0 HP triggers 3 death saves instead of instant death | ✓ |
| Advantage at low HP | 2d20 take higher when below 25% HP | |
| Hidden floor rule | 50% chance a killing hit becomes a near-miss | |
| Claude prompt instruction only | Narrative softening, no dice manipulation | |

**User's choice:** Death saving throws
**Notes:** User also selected "prevent long losing streaks" and "prevent instant death from a single hit" as the specific problems to solve.

---

## Losing Streak Protection

| Option | Description | Selected |
|--------|-------------|----------|
| Advantage after 3 misses | Next roll gets 2d20 after 3 consecutive misses | |
| Claude nudge only | System prompt engineers dramatic opening after 3+ misses | ✓ |
| Luck token | Once-per-encounter explicit reroll | |

**User's choice:** Claude nudge only — no dice manipulation
**Notes:** Track `consecutiveMisses` in `Game.state`, pass to Claude prompt, Claude engineers narrative opening (enemy stumbles, environment helps) when ≥ 3. Counter resets on any hit.

---

## Claude's Discretion

- `chipText` sanitization UX (silent strip vs player feedback)
- Test file placement (co-located vs `__tests__/`)
- `stateDeltas` allowlist scope for Phase 1

## Deferred Ideas

- Luck token mechanic — discussed and rejected (keep dice manipulation-free)
- Advantage at low HP — discussed and rejected
- Hidden floor rule — not selected
