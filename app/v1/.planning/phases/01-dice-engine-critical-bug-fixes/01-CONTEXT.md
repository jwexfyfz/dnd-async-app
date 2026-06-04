# Phase 1: Dice Engine & Critical Bug Fixes - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace AI-invented dice rolls with a deterministic TypeScript engine in `lib/dice.ts`. Fix two critical bugs in `app/actions/take-turn.ts` (prompt injection via `chipText`, race condition via non-atomic state mutation). Install Vitest and write unit tests for all dice functions. Render a dice result card in the chat UI above Claude's narration.

This phase does NOT include XP, leveling, or skills — those are Phases 2–4.

</domain>

<decisions>
## Implementation Decisions

### Dice Result Display
- **D-01:** Show BOTH a dice card AND Claude's narrative in the chat feed — not narrative only.
- **D-02:** Dice card appears ABOVE the narrative paragraph (mechanical result first, story consequence below).
- **D-03:** Card format: `🎲 14 + 3 = 17  vs AC 14  HIT!` — full math shown including target number.
- **D-04:** Target number label is DYNAMIC: attack rolls show "vs AC [N]", skill checks show "vs DC [N]". Not always "vs DC".
- **D-05:** `rollD20Check` must return `{ roll, modifier, total, dc, dcType: "AC" | "DC", success }` so the UI can render the correct label.

### Claude's Role with Dice
- **D-06:** Code generates all dice rolls — Claude CANNOT alter or invent roll results.
- **D-07:** Claude receives the completed roll result object as a fact in the narration prompt and writes creative fiction constrained by that outcome (e.g., if it was a hit, Claude describes a hit — not a miss).
- **D-08:** Code-generated rolls enable better narration: Claude can write specifically to close hits (`17 vs AC 14`) vs crits (`20`) vs near-misses (`13 vs AC 14`) rather than inventing vague outcomes.

### Player Fun / DM Fiat
- **D-09:** Death saving throws at 0 HP — canonical D&D rule. 0 HP does NOT mean instant death; it triggers 3 death saves (3 successes = stabilize, 3 failures = death). Shown transparently as a dice card.
- **D-10:** Instant death from massive damage (single hit exceeding max HP from 0) is IGNORED for this milestone — simplification for player fun.
- **D-11:** Losing streak protection via Claude prompt instruction ONLY — no dice manipulation. Track `consecutiveMisses` counter in `Game.state`. When it reaches 3+, the system prompt tells Claude to engineer a dramatic narrative opening (enemy stumbles, environment intervenes, NPC assists). Counter resets on any hit.
- **D-12:** No "luck token" or "advantage at low HP" mechanics — keep dice manipulation-free. Fun comes from narrative, not altered probability.

### Claude's Discretion
- `chipText` sanitization approach (strip silently vs inform player) — Claude decides based on best UX practice
- Test file placement (co-located `lib/dice.test.ts` vs `__tests__/` directory) — Claude decides based on codebase conventions
- `stateDeltas` allowlist scope for Phase 1 (protect only `hp` now vs defer full allowlist to Phase 3) — Claude decides based on implementation risk

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — DICE-01 through DICE-05 are the phase requirements; every plan must cover them
- `.planning/research/SUMMARY.md` — synthesized D&D rules, Vitest config, architecture decisions, pitfalls

### Architecture & Stack
- `.planning/research/ARCHITECTURE.md` — dice engine module design, XP storage, refactored take-turn flow, build order
- `.planning/research/STACK.md` — Vitest setup, exact 3-package install, `lib/prisma.ts` import gotcha (throws at import time without DATABASE_URL)
- `.planning/research/PITFALLS.md` — prompt injection allowlist note, stale state race condition detail, testing pitfalls

### Existing Code (MUST read before modifying)
- `app/actions/take-turn.ts` — the file being refactored; read entire file before touching it
- `lib/prisma.ts` — singleton pattern and the DATABASE_URL throw; dice/XP modules must NOT import this
- `lib/ai-config.ts` — DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE constants used in take-turn

### Codebase Map
- `.planning/codebase/ARCHITECTURE.md` — full system architecture and data flow
- `.planning/codebase/CONCERNS.md` — critical bugs being fixed in this phase (prompt injection, race condition)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/prisma.ts`: Singleton Prisma client — server actions import this; dice/leveling modules must NOT
- `lib/supabase-server.ts`: `createSupabaseServerClient()` — auth pattern used by all server actions
- `lib/ai-config.ts`: `DM_MODEL`, `DM_MAX_TOKENS`, `ROLLING_WINDOW_SIZE` — reuse these constants in refactored take-turn
- Existing `cache_control: { type: "ephemeral" }` on the static system prompt in `take-turn.ts` — keep this; it reduces Claude costs

### Established Patterns
- All server actions: `"use server"` + `createSupabaseServerClient()` auth check + `try/catch` with `{ success, error }` return
- Module-level constants in SCREAMING_SNAKE_CASE (see `lib/ai-config.ts`)
- `// ─── Section ───` separator style used throughout all files
- `Promise.all([...])` for parallel DB writes in take-turn — this is the NON-ATOMIC pattern being replaced by a transaction

### Integration Points
- `app/actions/take-turn.ts` → imports `lib/dice.ts` (new) for dice rolls
- `app/actions/take-turn.ts` → `Game.version` column needed for optimistic lock (requires schema migration or `$transaction` without version)
- Chat UI (wherever DM messages are rendered) → must handle a new `diceResult` field on the Message or as a separate block returned by `takeTurn`
- `Game.state` JSON blob → add `consecutiveMisses: number` field (initialized to 0, incremented on miss, reset on hit)

</code_context>

<specifics>
## Specific Ideas

- Dice card visual: `🎲 14 + 3 = 17  vs AC 14  HIT!` — exact format confirmed by user
- Card appears above narration, not below or inline
- Dynamic label "vs AC" for attack rolls, "vs DC" for skill/ability checks
- Death saves: 3 successes = stable, 3 failures = character death — canonical D&D Basic Rules
- Losing streak: track `consecutiveMisses` in `Game.state`, Claude prompt reads it and engineers an opening when ≥ 3

</specifics>

<deferred>
## Deferred Ideas

- Instant death from massive damage — explicitly ignored for this milestone, may revisit in Phase 3
- "Luck token" / explicit reroll mechanic — discussed and rejected in favor of Claude narrative intervention
- "Advantage at low HP" dice manipulation — rejected to keep dice manipulation-free
- Sanitization UX (player-visible feedback) — Claude's discretion
- XP grants and level-up — Phases 2 and 3
- Skills and proficiency checks — Phase 4

</deferred>

---

*Phase: 1-dice-engine-critical-bug-fixes*
*Context gathered: 2026-05-21*
