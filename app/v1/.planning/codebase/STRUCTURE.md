<!-- refreshed: 2026-05-23 -->
# Codebase Structure

**Analysis Date:** 2026-05-23

## Directory Layout

```
dnd-async-app/
├── app/                    # Next.js App Router — all routes and server actions
│   ├── actions/            # "use server" server action functions
│   ├── api/                # Route handlers (auth callback, resolveCombat)
│   │   ├── auth/           # Supabase OAuth callback handler
│   │   └── resolveCombat/  # (route handler — not a server action)
│   ├── auth/callback/      # OAuth return page
│   ├── create-character/   # Character creation route
│   ├── game/[id]/          # Dynamic game route
│   │   └── lobby/          # Lobby sub-route (pre-game party assembly)
│   ├── play/               # (directory present — no files read)
│   ├── globals.css         # Tailwind base styles
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home — character roster + auth
├── components/             # Shared React components
├── lib/                    # Pure utilities + infrastructure singletons
├── prisma/                 # Schema + migrations
│   └── migrations/         # Applied migration SQL files
├── generated/prisma/       # Prisma generated client (do not edit)
├── public/                 # Static assets (favicon)
├── CLAUDE.md               # Project-specific Claude instructions
├── next.config.ts          # Next.js config
├── prisma.config.ts        # Prisma CLI config (output path)
├── tsconfig.json           # TypeScript config
├── vitest.config.ts        # Vitest test runner config
└── package.json            # Dependencies and scripts
```

## App Routing Structure

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Character roster; Google OAuth sign-in |
| `/create-character` | `app/create-character/` | Character creation wizard |
| `/game/[id]` | `app/game/[id]/page.tsx` | Active game: field, party, chronicle tabs |
| `/game/[id]/lobby` | `app/game/[id]/lobby/page.tsx` | Pre-game lobby; party join + ready-check |
| `/auth/callback` | `app/auth/callback/` | Supabase OAuth redirect receiver |
| `/api/auth` | `app/api/auth/` | Auth route handler |
| `/api/resolveCombat` | `app/api/resolveCombat/` | Combat resolution route handler |

All game pages are `"use client"` — data fetching goes through server actions, not RSC fetch.

## app/actions/ — Server Actions

| File | Exports | Purpose |
|------|---------|---------|
| `take-turn.ts` | `takeTurn(gameId, chipText)` | Core turn loop: dice, AI call, DB write, combat effects |
| `initialize-game.ts` | `initializeGame(gameId)` | Generates opening scene narration for new games |
| `get-game.ts` | `getGame(gameId)` | Fetches full game with character, messages, partyMembers |
| `get-characters.ts` | `getCharacters()` | Fetches user's characters with active game/membership data |
| `create-character.ts` | `createCharacter(formData)` | Creates character + auto-creates a solo game |
| `delete-character.ts` | `deleteCharacter(characterId)` | Deletes character and its associated game |
| `start-game.ts` | `startGame(...)` | (Legacy solo game start) |
| `start-adventure.ts` | `startAdventure(gameId)` | Transitions lobby → active; assigns turn order by DEX |
| `initialize-game.ts` | `initializeGame(gameId)` | First-turn DM narration for empty message log |
| `join-game.ts` | `joinGame(gameId, characterId)` | Adds a PartyMember row for the caller's character |
| `leave-game.ts` | `leaveGame(gameId)` | Removes the caller's PartyMember row |
| `kick-player.ts` | `kickPlayer(gameId, memberId)` | Host removes another party member |
| `set-ready.ts` | `setReady(gameId, ready)` | Toggles PartyMember.status between JOINED/READY |
| `get-story-prompts.ts` | `getStoryPrompts()` | Fetches available StoryPrompt rows |
| `get-class-reference.ts` | `getClassReference(characterClass)` | Fetches ClassProgression + ClassFeature rows |
| `create-character.test.ts` | — | Vitest tests for create-character action |

## lib/ — Utilities

| File | Exports | Purpose |
|------|---------|---------|
| `dice.ts` | `rollDie`, `rollDice`, `abilityModifier`, `proficiencyBonus`, `rollD20Check`, `D20Result` | Pure dice engine; injectable rollFn for testing |
| `xp.ts` | `XP_THRESHOLDS`, `XP_BY_DIFFICULTY`, `computeLevel`, `xpForNextLevel` | XP thresholds and level computation (levels 1–5) |
| `leveling.ts` | `HIT_DIE_BY_CLASS`, `maxHpAtLevel`, re-exports `proficiencyBonus` | HP calculation by class/level/CON; hit die table |
| `combat-effect.ts` | `CombatEffect`, `parseCombatEffect`, `parseCombatEffects`, `clampHp` | XML tag parser for AI-emitted `<combat_effect>` tags |
| `character-sheet.ts` | `getCharacterSheetData`, `CharacterSheetData`, `StatEntry`, `SkillEntry` | Derives full stat block, save proficiencies, skill modifiers |
| `ai-config.ts` | `DM_MODEL`, `DM_MAX_TOKENS`, `ROLLING_WINDOW_SIZE` | Single-source AI configuration constants |
| `prisma.ts` | `prisma` | Prisma client singleton with Neon adapter |
| `supabase-server.ts` | `createSupabaseServerClient()` | Per-request Supabase client reading cookies (server side) |
| `supabase-client.ts` | `supabaseBrowser` | Browser Supabase client singleton (client side) |
| `class-emoji.ts` | `classEmoji(characterClass)` | Maps class name to display emoji |
| `dice.test.ts` | — | Vitest tests for dice engine |
| `leveling.test.ts` | — | Vitest tests for leveling engine |
| `xp.test.ts` | — | Vitest tests for XP engine |

## components/ — Shared Components

| File | Renders | Key Props |
|------|---------|-----------|
| `map-renderer.tsx` | ASCII tile grid with player/party markers and POI legend | `mapData: MapData`, `playerPos`, `partyMarkers?: PartyMarker[]` |
| `character-list.tsx` | Character card grid with active-game status, XP bars, and campaign actions | `characters[]`, `loading`, `onDeleted` |
| `character-form.tsx` | Character creation form (name, class, stat rolling) | (standalone form, uses `createCharacter` action) |
| `login-screen.tsx` | Google sign-in card | (no props — handles OAuth redirect internally) |
| `user-menu.tsx` | Auth session dropdown (sign out, display name) | (reads session from Supabase browser client) |

## prisma/ — Schema Entities

| Model | Key Fields | Relationships |
|-------|-----------|---------------|
| `User` | `id`, `email`, `displayName` | has many `Character`, many `PartyMember` |
| `Character` | `name`, `characterClass`, 6 ability scores, `xp`, `level`, `maxHp`, `currentHp` | belongs to `User`; linked to `Game` and `PartyMember` |
| `Game` | `state: Json`, `phase: GamePhase`, `currentTurnCharacterId`, `version` | belongs to `Character` (host), `StoryPrompt`, `Map`; has many `Message`, `PartyMember` |
| `PartyMember` | `turnOrder`, `status: MemberStatus` | links `Game` + `Character` + `User` |
| `Message` | `role: MessageRole`, `content`, `chips: Json?` | belongs to `Game` |
| `Map` | `name`, `data: Json` | has many `StoryPrompt`, `Game` |
| `StoryPrompt` | `title`, `description`, `difficulty` | belongs to `Map`; has many `Game` |
| `ClassProgression` | `characterClass`, `level`, `proficiencyBonus`, `featuresUnlocked`, `resourcePoolMax` | unique on `(characterClass, level)`; has many `ClassFeature` |
| `ClassFeature` | `name`, `description`, `characterClass`, `level` | belongs to `ClassProgression` |

**Enums:** `GameStatus (ACTIVE/PAUSED/COMPLETED)`, `GamePhase (LOBBY/ACTIVE/COMPLETED)`, `MessageRole (PLAYER/DUNGEON_MASTER)`, `MemberStatus (JOINED/READY)`

## Key Data Types

**`GameState` (Game.state JSON blob, typed in `app/game/[id]/page.tsx`):**
```typescript
{
  playerPos:       { x: number; y: number };   // active character position (solo)
  hp:              number;                      // solo HP
  maxHp:           number;                      // solo max HP
  inventory:       string[];                    // shared party inventory
  equipped:        { weapon: string | null; armor: string | null };
  npcsEncountered: { name: string; disposition: string; note: string }[];
  plotFlags:       string[];
  activeObjective: string;
  consecutiveMisses?: number;                   // tracks miss streak for AI directive
  levelUpNote?:    string;                      // injected for AI to narrate level-up
  // Party extensions (present when partyMembers.length > 1):
  partyPositions?: Record<string, { x: number; y: number }>;
  partyHp?:        Record<string, number>;      // keyed by characterId
  partyMaxHp?:     Record<string, number>;      // keyed by characterId
}
```

**`D20Result` (`lib/dice.ts`):**
```typescript
{ roll, modifier, total, dc, dcType: "AC"|"DC", success, critical, fumble }
```

**`CombatEffect` (`lib/combat-effect.ts`):**
```typescript
{ targetId: string; delta: number; type: string }  // +newHp added after DB lookup
```

**`MapData` (`components/map-renderer.tsx`):**
```typescript
{ width, height, tiles: string[][], playerStart: {x,y}, rooms[], pois[] }
```

## Naming Conventions

**Files:** `kebab-case.ts` for all lib and action files; `kebab-case.tsx` for components.

**Server actions:** Named exports matching the file name in camelCase (e.g. `take-turn.ts` → `export async function takeTurn`).

**Types:** Inline interfaces in each file; no shared types barrel. Key interfaces repeated across action files and the game page.

## Where to Add New Code

**New server action:** Create `app/actions/my-action.ts` with `"use server"` at top. Pattern: auth check → DB fetch → business logic → DB write → return typed result object.

**New game mechanic (pure logic):** Add to `lib/` as a zero-dependency `.ts` file. Mirror the pattern in `lib/dice.ts` (injectable test seams, no Prisma/framework imports). Add matching `.test.ts` file.

**New UI tab on the game page:** Add tab id to the `Tab` type and `TABS` array in `app/game/[id]/page.tsx`, add a new tab component function in the same file following the `FieldTab`/`PartyTab`/`ChronicleTab` pattern.

**New shared component:** Add to `components/` as a `"use client"` `.tsx` file. Import server actions directly (Next.js handles the boundary).

**New DB model:** Add to `prisma/schema.prisma`, run `npx prisma migrate dev` (confirm before running — see CLAUDE.md hard rules).

## Special Directories

**`.planning/`:** GSD planning documents. Not committed in the main flow — check `.gitignore`.

**`generated/prisma/`:** Prisma generated client output (configured in `prisma.config.ts`). Do not edit. Regenerate with `npx prisma generate`.

**`prisma/migrations/`:** Applied migration SQL. Committed. Do not edit manually.

---

*Structure analysis: 2026-05-23*
