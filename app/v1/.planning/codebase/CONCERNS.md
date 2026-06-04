# Codebase Concerns

**Analysis Date:** 2026-05-23

---

## High — Blocks Correctness or Production Safety

### HP formula mismatch between `start-game.ts` and `leveling.ts`

Solo games initialize HP using a hard-coded d10 formula instead of `maxHpAtLevel`:

```ts
// app/actions/start-game.ts:38-45
const conModifier = Math.floor((character.constitution - 10) / 2);
const startingHp  = 10 + conModifier;
```

`maxHpAtLevel` in `lib/leveling.ts` uses class-specific hit dice (Fighter d10, Wizard d6, Rogue d8, Cleric d8). A Wizard with CON 10 gets `hp=10` from `start-game.ts` but `hp=6` from `maxHpAtLevel`. The `Character.currentHp` column also defaults to `10` in `prisma/schema.prisma:38`, compounding this for characters who never start a game. Party games (via `start-adventure.ts`) do use `character.maxHp`, which was set correctly at creation by `create-character.ts`. Solo game state HP is therefore wrong for all non-Fighter classes.

### `initializeGame` auth guard only checks host ownership, not party membership

```ts
// app/actions/initialize-game.ts:37
if (game.character.userId !== user.id) return { success: false, error: "Access denied." };
```

Any authenticated user can call `initializeGame` for a party game they did not create, since `game.character` is the host's character. The opening scene would be generated and the first DM message would be written by a non-host user.

### `deleteCharacter` only deletes games with `status: "ACTIVE"`, not `COMPLETED`

```ts
// app/actions/delete-character.ts:13
include: { games: { where: { status: "ACTIVE" } } },
```

COMPLETED host games are not cleaned up. The associated `Message` and `PartyMember` rows stay in the database. The character row deletion will fail with a foreign-key constraint error if Prisma's referential integrity is enforced, or silently leave orphaned game records.

### Unvalidated `characterClass` in `create-character.ts`

The action checks that `characterClass` is not blank but does not validate it against the known class list (`HIT_DIE_BY_CLASS` in `lib/leveling.ts`). An arbitrary string such as `"Dragon"` is written to the database. `maxHpAtLevel` will then `throw new Error("Unknown class: Dragon")` at game-start, producing an unhandled 500 for the user.

### No character name length or content constraint

`create-character.ts` only checks `name.trim().length === 0`. A 10,000-character name or a name containing SQL-injection-style content passes validation and is stored. No `@db.VarChar(N)` constraint is applied in `prisma/schema.prisma:24`.

---

## Medium — Degrades Quality or Maintainability

### Inconsistent party-size threshold in `take-turn.ts`

The solo/party branch is decided with two different conditions:

```ts
// Line 234 — auth path
if (game.partyMembers.length > 0) { ... }

// Lines 121, 336, 364 — state / delta routing
if (game.partyMembers.length > 1 && gameState.partyHp) { ... }
```

A single-player party game (one member, i.e. the host who has not invited anyone) follows the "party" auth path but the "solo" state path. Whether this is intentional or a latent edge-case bug is not documented.

### Prompt builders duplicated between `take-turn.ts` and `initialize-game.ts`

`buildStaticPrompt` and `buildDynamicStatePrompt` exist in two separate files with diverging implementations. The `initialize-game.ts` versions do not support party state (`partyHp`, `partyPositions`) and use a different `CHARACTER` section format. A change to the DM prompt contract requires editing both files.

### `any` typing in the critical action path

`buildStaticPrompt` and `buildDynamicStatePrompt` in both `take-turn.ts` (lines 57, 110) and `initialize-game.ts` (lines 126, 157) accept `character: any`, `storyPrompt: any`, `mapData: any`, `partyMembers: any[]`. A property rename on the Prisma model will silently produce an `undefined` value injected into the AI prompt with no compile-time signal.

### `app/api/resolveCombat/route.ts` is unauthenticated

The POST route applies HP deltas to any character by ID without checking the caller's session. It is not called anywhere in the current codebase (no callers found), suggesting it is dead/experimental code, but it presents a data integrity risk if exposed publicly.

### `game/[id]/page.tsx` is 963 lines

The single file contains the main page component plus six sub-components (`FieldTab`, `PartyTab`, `ChronicleTab`, `MemberStatsPane`, `MemberInventoryPane`, `MemberAbilitiesPane`). Extracting sub-components to `components/` would reduce cognitive load and enable per-component testing.

---

## Low — Nice to Fix, Not Urgent

### `console.error` in server actions exposes internal error messages to logs

All server actions pass raw `error.message` or `err.message` to `console.error`. In production this may surface Prisma error details (table names, constraint violations) to the server log. Use a structured logger or scrub messages before logging.

- `app/actions/create-character.ts:89` — logs `error.message` verbatim
- `app/actions/start-game.ts:90` — logs `error.message` verbatim, and returns it directly to the client: `return { success: false, error: error.message }`

### `CLASS_FEATURES` hard-coded in the page component

```ts
// app/game/[id]/page.tsx:601-614
const CLASS_FEATURES: Record<string, string[]> = {
  Barbarian: ["Rage (2/day)", ...],
  ...
};
```

The database has a `ClassFeature` table seeded with authoritative feature data. The page ignores it and renders a static string list instead. The `ClassProgression` and `ClassFeature` models in `prisma/schema.prisma` are never queried by the game page.

### `hpBarColor` and `hpTextColor` divide by `max` without guarding `max === 0`

```ts
// app/game/[id]/page.tsx:93-105
function hpBarColor(hp: number, max: number): string {
  const p = hp / max;  // NaN if maxHp is ever 0
```

If `maxHp` is ever 0 (e.g., extreme negative CON modifier bug), `p` becomes `NaN`, all comparisons return `false`, and the bar color falls through to `"bg-red-500"` silently. Not currently reachable through normal play, but `Math.max(1, hp)` in `leveling.ts` does not prevent `maxHp=0` if `maxHpAtLevel` is bypassed.

---

## Known Gaps

### `ClassProgression` and `ClassFeature` tables are seeded but never surfaced in-game

The Prisma schema defines `ClassProgression` and `ClassFeature` models. The game page renders a hard-coded `CLASS_FEATURES` object instead. No action reads from these tables during gameplay.

### No real-time turn notification for party games

When Player A takes their turn, Player B's browser does not receive any push event. Player B must manually reload or re-navigate to see the updated state. There is no polling, WebSocket, or Supabase Realtime subscription in `app/game/[id]/page.tsx`.

### Opening scene not generated for party games

`initializeGame` checks `game.character.userId !== user.id` (host-only) but the function does not account for party structure at all. `buildDynamicStatePrompt` in `initialize-game.ts` reads `gameState.hp` and `gameState.playerPos`, which do not exist in the party-game state shape (which uses `partyHp`, `partyPositions`). The opening scene for a party game will inject `undefined` values into the AI prompt.

### `PAUSED` game status is defined but never set or handled

`prisma/schema.prisma:101` defines `GameStatus.PAUSED`. No action sets a game to `PAUSED` and no UI handles it. Dead schema value.

### `MemberInventoryPane` shows "Inventory is private" for all non-self members

Party inventory is shared (stored in `gameState.inventory`), but the component shows all other members' inventory as private. This is inconsistent with the game design where inventory is a shared resource.

---

*Concerns audit: 2026-05-23*
