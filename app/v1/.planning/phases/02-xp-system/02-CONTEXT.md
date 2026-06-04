# Phase 2: XP System - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Add XP accumulation to the game loop: `Character` gains XP when an encounter resolves, level is computed from cumulative XP, and both are displayed in the Party tab. XP persists on the `Character` record (not `Game.state`) so it survives across games.

This phase does NOT include HP recalculation on level-up (Phase 3), skill proficiencies (Phase 4), or death saves/damage mechanics. Level is written to `character.level` but max HP is unchanged until Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Encounter Detection
- **D-01:** Claude signals encounter completion via a new field `encounterResult: "completed" | null` in its JSON response alongside `narrative`, `stateDeltas`, and `chips`. Claude picks the flag; code picks the XP amount.
- **D-02:** The static system prompt includes explicit rules telling Claude when to set `encounterResult: "completed"` — specifically: when an active combat encounter fully resolves (enemy defeated or fled, boss dies, room cleared). Claude uses narrative judgment within those rules.
- **D-03:** Code never trusts Claude to determine XP amount — only the `encounterResult` signal is consumed. XP amount comes from a code-owned lookup table.

### XP Grant Amount
- **D-04:** XP is awarded from a difficulty-based lookup table keyed on `StoryPrompt.difficulty`: Beginner → 50 XP, Standard → 100 XP, Veteran → 200 XP. Table lives as a constant in `lib/xp.ts` alongside `XP_THRESHOLDS`.
- **D-05:** XP is written to `Character.xp` inside the existing `prisma.$transaction` in `take-turn.ts`, alongside the `game.update`. `computeLevel()` is called immediately after; if level increased, `character.level` is also written in the same transaction.

### Level-Up Feedback
- **D-06:** When a level-up occurs, `take-turn.ts` injects a `LEVEL UP` note into the dynamic state system prompt sent to Claude: `"LEVEL UP: [CharacterName] advanced to Level [N] this turn."` Claude weaves this into the narrative as a dramatic moment.
- **D-07:** No new UI component needed in Phase 2 for level-up — Claude's narration is the only signal. HP recalculation notification is deferred to Phase 3.

### XP Display
- **D-08:** XP and level are displayed in the Party tab on each member card — a compact XP progress bar below the existing HP bar, matching the HP bar's visual pattern (`bg-slate-200` track, colored fill, text label above).
- **D-09:** Label format: `Level N  ·  XP: 250 / 300` above a slim progress bar. If at level cap (level 5), show `Level 5  ·  MAX` with a full bar.
- **D-10:** XP/level data is server-authoritative — read from `partyMembers[].character` returned by the existing `getGame` re-fetch that already fires after every chip click. No client-side XP state. This prevents client/server desync since `character.xp` and `character.level` are canonical on the `Character` row.
- **D-11:** `getGame` must include `xp` and `level` in the character select inside `partyMembers`. `getCharacters` on the roster page does NOT need to return XP/level in Phase 2 — roster cards show no XP bar yet.

### Claude's Discretion
- Exact wording Claude uses for level-up narration — the system prompt provides the fact, Claude writes the story
- Visual bar color for XP progress (blue suggested — distinct from HP's green/amber/red)
- Whether `encounterResult` field appears in the JSON schema comment in the system prompt or only described in the rules section

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — XP-01 through XP-05 are the phase requirements; XP_THRESHOLDS values (0/300/900/2700/6500) are authoritative here
- `.planning/ROADMAP.md` — Phase 2 success criteria and dependency on Phase 1

### Existing Code (MUST read before modifying)
- `app/actions/take-turn.ts` — central file for this phase; add `encounterResult` parsing, XP award logic, character.update inside $transaction, and level-up system prompt injection
- `app/actions/get-game.ts` — add `xp` and `level` to partyMembers character select
- `lib/ai-config.ts` — DM_MODEL, DM_MAX_TOKENS, ROLLING_WINDOW_SIZE constants; do not duplicate
- `lib/prisma.ts` — singleton; `lib/xp.ts` must NOT import this (pure functions only)
- `prisma/schema.prisma` — must add `xp Int @default(0)` and `level Int @default(1)` to Character model

### Phase 1 Context (carried-forward decisions)
- `.planning/phases/01-dice-engine-critical-bug-fixes/01-CONTEXT.md` — D-06/D-07 (Claude cannot alter mechanical values), D-11 (consecutiveMisses pattern), $transaction pattern established

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — server action pattern, $transaction location in take-turn
- `.planning/codebase/STACK.md` — Prisma 7 + Neon adapter constraints; `prisma db push` workflow (no migration history)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `prisma.$transaction` in `take-turn.ts` (lines ~293-310) — already wraps `message.create` + `game.update`; add `character.update` here for XP/level writes inside the same atomic boundary
- HP bar in Party tab (`app/game/[id]/page.tsx`, PartyTab component) — exact same `bg-slate-200` track + colored fill + text pattern to reuse for XP bar
- `buildDynamicStatePrompt()` in `take-turn.ts` — already injects `consecutiveMisses` and narration directives; add level-up injection here using the same pattern
- `abilityModifier()` in `lib/dice.ts` — example of a pure exported function with no Prisma import; `lib/xp.ts` follows the same pattern

### Established Patterns
- Server action auth: `createSupabaseServerClient()` → `supabase.auth.getUser()` at top of every action
- Return type: `{ success: boolean, data?, error? }` for all server actions
- Pure utility modules (`lib/dice.ts`, `lib/ai-config.ts`) have zero Prisma imports — `lib/xp.ts` must follow this constraint (testable without DB)
- `// ─── Section ───` separator style used throughout
- Claude JSON response shape: `{ narrative, stateDeltas, chips }` — `encounterResult` is a new top-level field added to this shape

### Integration Points
- `take-turn.ts` → reads `game.storyPrompt.difficulty` (already included in the Prisma `include`) to look up XP amount from the difficulty table
- `take-turn.ts` → `character.update({ where: { id: currentCharId }, data: { xp, level } })` inside `$transaction`
- `get-game.ts` → `partyMembers: { include: { character: { select: { ..., xp: true, level: true } } } }` — adds two fields to existing select
- `app/game/[id]/page.tsx` PartyTab → reads `m.character.xp` and `m.character.level` from `gameData.partyMembers` (already available post-getGame re-fetch)

</code_context>

<specifics>
## Specific Ideas

- XP difficulty table: `{ Beginner: 50, Standard: 100, Veteran: 200 }` — export as `XP_BY_DIFFICULTY` constant from `lib/xp.ts`
- XP bar label: `Level N  ·  XP: 250 / 300` (current / threshold for next level); at cap: `Level 5  ·  MAX`
- Level-up system prompt injection: `"LEVEL UP: [CharacterName] advanced to Level [N] this turn."` — placed in `buildDynamicStatePrompt()` output when level changed
- `encounterResult` field in Claude JSON schema comment in system prompt: add to the existing `RESPONSE RULES` block alongside `narrative`, `stateDeltas`, `chips`
- XP bar visual: distinct color from HP bars — blue (`bg-blue-500`) suggested to avoid confusion with HP color coding (green/amber/red)

</specifics>

<deferred>
## Deferred Ideas

- XP/level on the roster character cards (home page) — noted, deferred to after Phase 2 ships or as a Phase 3 polish item
- Bonus XP for critical hits, roleplaying moments — out of scope for Phase 2; could be a future enhancement
- XP recap at end of game session — separate feature, not Phase 2
- Partial XP on encounter flee or partial completion — keep simple for Phase 2; full XP on `completed`, zero on anything else

</deferred>

---

*Phase: 2-xp-system*
*Context gathered: 2026-05-22*
