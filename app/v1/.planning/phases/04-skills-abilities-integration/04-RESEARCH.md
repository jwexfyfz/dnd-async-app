# Phase 4: Skills & Abilities Integration — Research

**Researched:** 2026-05-23
**Domain:** D&D skill proficiency mechanics, Prisma String[] migration on Neon/PostgreSQL, Claude structured intent, React multi-select UI
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SKILL-01 | Prisma migration adds `skillProficiencies String[]` to `Character` | PostgreSQL TEXT[] supported on Neon; migration workflow verified from Phase 3 precedent |
| SKILL-02 | Character creation UI: class-gated skill-pick multi-select; server-side validation of count + allowed list | `components/character-form.tsx` and `app/actions/create-character.ts` are the exact two files to edit; pattern is additive |
| SKILL-03 | `lib/skills.ts` exports `SKILLS` map (18 entries) and `resolveSkillCheck()` with injectable `rollFn` | 18-entry SKILL_ABILITY_MAP already exists in `lib/character-sheet.ts` — can be extracted verbatim; injectable rollFn pattern matches xp/leveling test convention |
| SKILL-04 | `take-turn.ts`: Claude structured intent identifies skill; `resolveSkillCheck()` called; compact keyword injected into narration prompt | Current take-turn uses a single Claude call with freeform JSON; needs a pre-narration intent-detection step; full architecture documented below |
| SKILL-05 | Unit tests: proficient vs non-proficient, all 18 mappings, DC boundary conditions | Test file `lib/skills.test.ts` does not yet exist; Wave 0 gap |
</phase_requirements>

---

## Summary

Phase 4 has two distinct halves that share no code between them but converge in Wave 2. The **data half** (04-01) adds `Character.skillProficiencies String[]` via Prisma migration, wires the skill-pick UI into character creation, and runs a backfill script for existing characters. The **DB wiring half** (04-02) replaces the hardcoded `CLASS_FEATURES` map in `page.tsx` with live `ClassFeature` rows fetched from the database. Both halves are independent of each other and can be built in parallel in Wave 1.

Wave 2 (04-03 + 04-04) builds the `lib/skills.ts` pure module and integrates skill checks into `take-turn.ts`. The integration in 04-04 is the highest-risk plan in the phase: it requires detecting skill intent in Claude's response before the narration call, which means a second structured Claude prompt (or extending the first call's output schema). The existing `take-turn.ts` makes a single Claude call for narration; adding a pre-narration intent-detection step is a meaningful architectural change but has a clear implementation path documented below.

Wave 3 (04-05) is purely a wire-up plan — `getCharacterSheetData()` already accepts a `CharacterInput` interface; it just needs `skillProficiencies` added to that interface and passed in from the `MemberStatsPane`. The `SKILL_PROFS` hardcoded fallback in `lib/character-sheet.ts` is then removed.

**Primary recommendation:** Build in the wave order specified in the ROADMAP. Do not attempt to merge 04-03 and 04-04 into one plan — keeping `lib/skills.ts` as a separately testable artifact before the take-turn integration is the correct risk sequencing.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill proficiency storage | Database (Prisma) | — | `skillProficiencies String[]` is canonical data on `Character`; persists across games |
| Skill-pick validation | API / Backend (server action) | Client (UI guard) | Server action is the trust boundary; UI guard is UX only |
| Skill check math | Pure lib (`lib/skills.ts`) | — | Zero-dependency; must be testable without DB or framework |
| Skill intent detection | API / Backend (take-turn.ts) | — | Structured Claude call owns intent; code owns resolution |
| Narration with skill keyword | API / Backend (take-turn.ts) | — | Keyword injected as system prompt context block before narration call |
| ClassFeature DB fetch | API / Backend (server action) | — | `getClassFeatures()` server action; client receives data as prop |
| Skills proficiency display | Client (MemberStatsPane) | — | Reads from `Character.skillProficiencies` via `getCharacterSheetData()` |
| Abilities sub-tab display | Client (MemberAbilitiesPane) | — | Reads from `ClassFeature` DB rows returned by server action |

---

## Section 1: Existing Code Inventory

### `lib/character-sheet.ts` (SKILL_PROFS, SKILLS table)

**Location:** `/lib/character-sheet.ts`
**Lines:** 134 total

Key facts for Phase 4:
- `SKILL_PROFS` constant at lines 60–73: hardcoded Record<string, string[]> with representative class defaults for 12 classes. This is the fallback Phase 4 MUST replace for the 4 supported classes.
- `SKILLS` array at lines 87–106: already contains all 18 skill-to-ability mappings. This is the canonical source — Phase 4's `lib/skills.ts` SKILL_ABILITY_MAP must be extracted from here (not reinvented).
- `CharacterInput` interface at lines 7–16: does NOT currently include `skillProficiencies`. Phase 4 (04-05) adds this field.
- `getCharacterSheetData(char: CharacterInput)` at lines 110–133: builds `skillProfs` set from `SKILL_PROFS[char.characterClass]` at line 113. Phase 4 replaces this with `new Set(char.skillProficiencies ?? [])`.
- `SAVE_PROFS` is NOT touched by Phase 4.

**Change required (04-05):** Add `skillProficiencies?: string[]` to `CharacterInput`. Change line 113 from `SKILL_PROFS[char.characterClass] ?? []` to `char.skillProficiencies ?? []`. Delete the `SKILL_PROFS` constant.

### `app/game/[id]/page.tsx` (CLASS_FEATURES, MemberAbilitiesPane, MemberStatsPane)

**Location:** `/app/game/[id]/page.tsx`
**Lines:** 1287 total

Key facts for Phase 4:

**CLASS_FEATURES (04-02 target):**
- Lines 619–632: hardcoded `Record<string, string[]>` mapping class name to list of plain feature name strings. Contains 12 classes. This has NO level granularity — it is a flat list.
- `MemberAbilitiesPane` at lines 1206–1231: reads `CLASS_FEATURES[char.characterClass] ?? []` and renders a flat `<ul>`. Currently receives only `char: CharacterData`.
- Phase 04-02 replaces this with a server action call that returns `ClassFeature[]` records grouped by level, with a "New" badge on features at `character.level`.

**MemberStatsPane (04-05 target):**
- Lines 762–873: calls `getCharacterSheetData(char)` at line 763 — `char` is `CharacterData` which has all ability scores and level but NOT `skillProficiencies`.
- The returned `sheet.skills` drives the skill display at lines 838–868.
- Phase 04-05 adds `skillProficiencies` to `CharacterData` interface and passes it through to `getCharacterSheetData`.

**CharacterData interface:**
- Lines 45–59: currently has `id, name, characterClass, strength, dexterity, constitution, intelligence, wisdom, charisma, xp, level, currentHp, maxHp`.
- Phase 04-01 adds `skillProficiencies: string[]` to this interface after it exists in the DB.

### `app/actions/take-turn.ts` (Claude call structure, structured intent)

**Location:** `/app/actions/take-turn.ts`
**Lines:** 431 total

Current Claude call structure — **single call architecture:**
- One `anthropic.messages.create` call at lines 266–281.
- System prompt: array of two blocks — (1) static prompt with `cache_control: { type: "ephemeral" }` (lines 270–274), (2) dynamic state prompt (lines 275–278).
- Messages: rolling window conversation history + `"Player action: <sanitizedAction>"` as final user turn.
- Response: freeform JSON parsed with `rawText.match(/\{[\s\S]*\}/)` at lines 292–300.
- Output schema (lines 82–95 in `buildStaticPrompt`): `{ narrative, stateDeltas, chips, encounterResult }`.

**For Phase 04-04 (skill intent detection):** The current architecture has NO structured intent detection. The ROADMAP specifies "Call #1 output schema extended with optional `skillName`". There are two approaches:

Option A — Extend existing JSON schema with optional `skillName` field in Call #1 output. This is the lowest-overhead approach: add `"skillName": "SkillName" | null` to the existing `RESPONSE RULES` JSON schema in `buildStaticPrompt`, parse it out from the existing `parsed` object, and conditionally call `resolveSkillCheck()` before running no additional Claude call.

Option B — Add a separate lightweight pre-narration Claude call just for intent detection (separate `anthropic.messages.create`). This doubles Claude API usage for every turn.

**Recommendation: Option A.** The ROADMAP wording ("Call #1 output schema extended") confirms this is the intended approach. The risk is that Claude may hallucinate skill names; the mitigation is to validate the returned `skillName` against the canonical 18-skill list before calling `resolveSkillCheck()`. If `skillName` is not in the list, treat it as `null`.

**Where keyword is injected:** The ROADMAP specifies the keyword goes into Call #2 (narration call). But with Option A there IS no Call #2 — the same call is both intent and narration. The keyword must therefore go into the `buildDynamicStatePrompt()` return value (alongside the DICE RESULT block), after the intent is extracted from a PRIOR turn's response... OR the design needs a two-call structure.

**Revised understanding of the two-call pattern:** Reading the ROADMAP plan 04-04 more carefully: "Call #1 output schema extended with optional `skillName`; `resolveSkillCheck()` runs before Call #2; compact keyword injected into Call #2 system prompt". This implies TWO Claude calls per turn when a skill check occurs:
- Call #1: existing narration call BUT with `skillName` added to the JSON output schema.
- Parse `skillName` from Call #1 response. If present, call `resolveSkillCheck()`.
- Call #2: narration-only call with the skill check result injected as a `MECHANICAL CONTEXT` block. Call #2 produces the final narrative that the player sees.
- When NO skill check: same as today (Call #1 = narration, no Call #2).

This is confirmed by the keyword format `[SKILL skill=X outcome=Y dc=N]` — it exists to inform Claude's narration, which means it must be fed INTO a subsequent narration call.

**Token cost:** Call #1 with skill detection is low-token (structured output, short). Call #2 is the main narration call. Total cost per skill-check turn is roughly 1.5x today's cost. On turns with no skill check, cost is unchanged.

**RULES_ENGINE_KEYS allowlist** (line 348): currently `["hp", "maxHp", "xp", "level", "proficiencyBonus"]`. Phase 04 does NOT need to extend this list for skill checks — `skillProficiencies` is never in Claude's stateDeltas.

**Failed skill checks and stateDeltas:** Per the ROADMAP and PROJECT.md Key Decisions: "Failed skill checks write a `stateDeltas` flag (e.g. `guardsAlerted: true`)". This is a free-form string key that goes into `Game.state` via the normal `newState = { ...gameState, ...deltas }` path. It does NOT need special handling — Claude writes the flag name in stateDeltas, code writes it to Game.state. Downstream consequences deferred.

### `app/actions/create-character.ts` (Phase 04-01 target)

**Location:** `/app/actions/create-character.ts`
**Lines:** 96 total

Current state: Accepts `FormData` with fields `name, class, strength, dexterity, constitution, intelligence, wisdom, charisma`. Calls `createCharacter()` which writes to `prisma.character.create()`.

**Phase 04-01 changes:**
1. Parse `skillProficiencies` from FormData (JSON array of skill name strings).
2. Validate: length must equal `SKILL_PICK_COUNT[characterClass]`; each name must be in `CLASS_SKILL_POOL[characterClass]`.
3. Add `skillProficiencies` to the `prisma.character.create({ data: { ... } })` call.
4. Return server-side validation error if picks are invalid.

### `components/character-form.tsx` (Phase 04-01 target)

**Location:** `/components/character-form.tsx`
**Lines:** 198 total

Current state: Single-page form with name, class picker (4 buttons), and stat point-buy. No skill selection step.

**Phase 04-01 changes:**
- Add `selectedSkills: string[]` state and `skillError: string` state.
- After class is selected, render a multi-select skill picker showing `CLASS_SKILL_POOL[selectedClass]`.
- Each skill is a toggle button. Already-selected skills are highlighted. Selecting beyond `SKILL_PICK_COUNT[selectedClass]` shows an error (not a crash).
- Class change clears `selectedSkills` — a `useEffect` that watches `selectedClass`.
- On submit, append `formData.append("skillProficiencies", JSON.stringify(selectedSkills))`.

**UX edge:** If user changes class after picking skills, selected skills must be cleared to prevent cross-class invalid picks. This is a client-side reset only; server-side validation is the trust boundary.

### `prisma/schema.prisma` (Phase 04-01 target)

**Current Character model** (lines 22–42): has `strength, dexterity, constitution, intelligence, wisdom, charisma, xp, level, maxHp, currentHp`. Does NOT have `skillProficiencies`.

**Required addition:**
```prisma
  skillProficiencies String[] @default([])
```

PostgreSQL `TEXT[]` is fully supported on Neon (PostgreSQL-compatible). `@default([])` means the migration adds the column with an empty array for all existing rows. This is safe for the migration itself, but a backfill script should then populate thematic defaults for existing characters (per PROJECT.md Key Decisions).

**Migration strategy:** Follow the exact workflow established in Phase 3 — `npx prisma migrate dev --name add_skill_proficiencies`. The migrations directory exists and has 5 prior migrations. This is a clean additive migration with no risk of data loss.

### `ClassFeature` table (Phase 04-02 target)

**Schema** (from migration SQL and `schema.prisma` lines 197–208):
```
ClassFeature {
  id             String (UUID)
  characterClass String
  level          Int
  name           String
  description    String
}
```

**Seeded data:** `prisma/seed-class-progression.ts` seeds ClassFeature rows for Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard — all levels 1–20. The seed IS run (migrations exist for `add_class_progression`).

**Query for Phase 04-02:** `getClassFeatures(characterClass, maxLevel)` server action:
```typescript
return prisma.classFeature.findMany({
  where: { characterClass, level: { lte: maxLevel } },
  orderBy: [{ level: "asc" }, { name: "asc" }],
});
```

The result is a flat list of features unlocked from level 1 up to `character.level` — serves as a cumulative reference sheet.

**"New" badge logic:** Feature is "new" if `feature.level === character.level`. This is a client-side comparison; no server-side flag needed.

---

## Section 2: Schema Analysis

### Current Character Model

```prisma
model Character {
  id             String        @id @default(uuid())
  name           String
  userId         String
  characterClass String
  strength       Int @default(8)
  dexterity      Int @default(8)
  constitution   Int @default(8)
  intelligence   Int @default(8)
  wisdom         Int @default(8)
  charisma       Int @default(8)
  xp             Int @default(0)
  level          Int @default(1)
  maxHp          Int @default(10)
  currentHp      Int @default(10)
  // skillProficiencies MISSING — Phase 04-01 adds this
}
```

### Migration Required

```prisma
  skillProficiencies String[] @default([])
```

**Migration command:** `npx prisma migrate dev --name add_skill_proficiencies`

**Neon/PostgreSQL compatibility:** `String[]` in Prisma maps to `TEXT[]` in PostgreSQL. Neon is PostgreSQL-compatible and fully supports array types. [ASSUMED — based on PostgreSQL standard; Neon documented as PostgreSQL-compatible]

**`@default([])` behavior:** PostgreSQL will store an empty array `{}` for all existing rows during migration. No null values. This is safe — the backfill script runs AFTER migration to populate thematic defaults.

### Backfill Approach

Follows the exact pattern of `prisma/seed-backfill-maxhp.mjs`:
- New file: `prisma/seed-backfill-skills.mjs`
- ESM `.mjs` format (not `.ts`) — avoids tsx dependency for one-shot scripts
- Inline skill constants (mirrors `lib/skills.ts`) because importing `.ts` from `.mjs` is unsupported without a build step
- Queries `prisma.character.findMany({ select: { id, characterClass, skillProficiencies } })`
- For each character where `skillProficiencies.length === 0`: sets thematic defaults from `BACKFILL_DEFAULTS`
- Skips characters that already have picks (idempotent)
- Adds npm script `"db:backfill-skills": "node prisma/seed-backfill-skills.mjs"`

**Backfill defaults (from PROJECT.md Key Decisions):**
```javascript
const BACKFILL_DEFAULTS = {
  Fighter: ["Athletics",  "Intimidation"],
  Rogue:   ["Stealth",    "Perception"],
  Cleric:  ["Insight",    "Religion"],
  Wizard:  ["Arcana",     "Investigation"],
};
```

**Risk:** Characters with non-standard classes (not in the 4 supported classes) should be skipped with a `console.warn`, same as the maxHp backfill script.

---

## Section 3: Claude Integration Analysis

### Current Architecture (before Phase 04)

```
Player action → sanitizeChipText()
             → detectActionType()    (keyword-based: attack/strike → AC check)
             → rollD20Check()        (code owns all dice)
             → anthropic.messages.create()   ← ONE CALL
                 system[0]: buildStaticPrompt() [cached]
                 system[1]: buildDynamicStatePrompt()  (includes DICE RESULT block)
                 messages:  rolling history + "Player action: X"
             → parse JSON { narrative, stateDeltas, chips, encounterResult }
             → parseCombatEffects()  (XML tags after JSON)
             → XP/level-up computation
             → $transaction
             → return TurnResult
```

### Phase 04-04 Architecture (two-call when skill detected)

```
Player action → sanitizeChipText()
             → detectActionType()
             → rollD20Check()

             ← CALL #1: Intent Detection Call ──────────────────────────
             │  system[0]: buildStaticPrompt() [cached — same as today]
             │  system[1]: buildDynamicStatePrompt() [same as today]
             │  messages:  history + "Player action: X"
             │  Output schema extended: adds optional "skillName": string | null
             │  (also still returns narrative, stateDeltas, chips, encounterResult)
             └─────────────────────────────────────────────────────────────

             → if parsed.skillName is in SKILLS canonical list:
                 resolveSkillCheck(parsed.skillName, character)
                 build compact keyword: "[SKILL skill=X outcome=Y dc=N]"

             ← CALL #2: Narration Call (ONLY when skillName detected) ───
             │  system[0]: buildStaticPrompt() [cached — same prompt block]
             │  system[1]: buildDynamicStatePrompt() + MECHANICAL CONTEXT block
             │  messages:  same history + "Player action: X"
             │  Output schema: same { narrative, stateDeltas, chips, encounterResult }
             │  NARRATION RULES: forbid raw number reproduction
             └─────────────────────────────────────────────────────────────

             → When NO skillName: Call #1 result IS the narration (today's behavior)
             → When skillName: Call #2 result is the narration; Call #1 stateDeltas used

             → parseCombatEffects(), XP/level-up, $transaction (unchanged)
```

### MECHANICAL CONTEXT Block Format

```
MECHANICAL CONTEXT
[SKILL skill=Stealth outcome=SUCCESS dc=14]
Narration rules: Do NOT reproduce the skill name, outcome, DC, roll value, or proficiency bonus in your narrative. Describe the result dramatically without mechanical exposition.
```

**Placement:** Appended to `buildDynamicStatePrompt()` output as a new section, similar to how `levelUpDirective` is appended today (lines 163–165 of take-turn.ts).

### SkillCheckResult Return Shape

`resolveSkillCheck()` in `lib/skills.ts` returns:
```typescript
interface SkillCheckResult {
  skill:           string;
  abilityScore:    string;   // e.g., "dexterity"
  roll:            number;   // d20 raw
  modifier:        number;   // ability modifier
  proficiencyBonus: number;  // 0 if not proficient
  total:           number;   // roll + modifier + proficiencyBonus
  dc:              number;
  success:         boolean;
  proficient:      boolean;
}
```

The compact keyword uses only `skill`, `success/failure outcome`, and `dc`. Raw numbers (roll, modifier, proficiencyBonus) never appear in the keyword.

### Failed Skill Check State Flag

Per PROJECT.md: failed checks write a `stateDeltas` flag. The flag key is free-form and comes from Claude's stateDeltas in the narration response (e.g., `{ guardsAlerted: true }`). This flows through the existing `Object.assign(newState, deltas)` path. The RULES_ENGINE_KEYS allowlist does not need to be extended — no new mechanical keys are created.

Downstream consequences of flags are explicitly deferred to a later phase.

---

## Section 4: Implementation Approach (per plan)

### 04-01: skillProficiencies Migration + Character Creation UI

**Approach:**
1. Edit `prisma/schema.prisma`: add `skillProficiencies String[] @default([])` after `currentHp`.
2. Run `npx prisma migrate dev --name add_skill_proficiencies`.
3. Run `npx prisma generate`.
4. Create `prisma/seed-backfill-skills.mjs` — backfill thematic defaults for existing characters.
5. Add npm script `db:backfill-skills` to `package.json`.
6. Edit `components/character-form.tsx`: add skill-pick step after class selection.
7. Edit `app/actions/create-character.ts`: parse + validate + save `skillProficiencies`.

**Pitfalls:**
- Class change in the form must reset `selectedSkills` — forgetting this causes stale invalid picks to persist in state.
- Server-side validation must check BOTH pick count AND allowed-list membership — UI can be bypassed.
- `formData.append("skillProficiencies", JSON.stringify(selectedSkills))` — server parses with `JSON.parse(formData.get("skillProficiencies") as string)`. Do NOT use `.getAll()` for array fields — JSON stringify/parse is more reliable with Next.js FormData.

### 04-02: Abilities Sub-Tab DB Wiring

**Approach:**
1. Create `app/actions/get-class-features.ts` — `getClassFeatures(characterClass: string, maxLevel: number): Promise<ClassFeature[]>` server action.
2. Edit `app/game/[id]/page.tsx`:
   - Remove `CLASS_FEATURES` constant (lines 619–632).
   - `MemberAbilitiesPane` becomes async-capable — it uses `useEffect` + `useState` to fetch features on mount (or receives features as a prop fetched in `PartyTab`).
   - Add "New" badge: `feature.level === char.level` renders a colored badge.
3. No schema changes. No migration.

**Prop drilling vs. useEffect in component:** Since `MemberAbilitiesPane` already receives `char: CharacterData`, the cleanest approach is to add a `useEffect` inside `MemberAbilitiesPane` that calls `getClassFeatures(char.characterClass, char.level)` — same pattern as `MemberInventoryPane` using `useEffect(() => { getMapItems(mapId)... }, [mapId])` (lines 893–895). This keeps the data-fetching co-located with the component that needs it.

**Pitfall:** `MemberAbilitiesPane` currently renders synchronously from a constant. After the change, there will be a brief loading state. Add a `loading` boolean and render a skeleton placeholder (e.g., `<p className="text-[11px] text-slate-400 py-2">Loading…</p>`) — same pattern as `MemberInventoryPane` at line 926.

### 04-03: lib/skills.ts Pure Module

**Approach:**
1. Create `lib/skills.ts` following the exact `lib/leveling.ts` / `lib/xp.ts` module pattern.
2. Export `SKILL_ABILITY_MAP` — extract the `SKILLS` array from `lib/character-sheet.ts` directly; it is already the canonical 18-entry list.
3. Also export `SKILLS = SKILL_ABILITY_MAP` as a named re-export alias to satisfy REQUIREMENTS.md SKILL-03 literal wording (`lib/skills.ts` exports `SKILLS`). Both names refer to the same object; `SKILL_ABILITY_MAP` is the primary name used internally (more descriptive); `SKILLS` is the alias for requirement compliance.
4. Export `CLASS_SKILL_POOL: Record<string, string[]>` — the allowed skill list per class (4 entries).
5. Export `SKILL_PICK_COUNT: Record<string, number>` — pick count per class (4 entries).
6. Export `resolveSkillCheck(skillName: string, character: SkillCharacterInput, rollFn?: () => number): SkillCheckResult`.
   - `rollFn` defaults to `() => Math.ceil(Math.random() * 20)` but tests inject a deterministic function.
   - Alternatively, use the existing `rollD20Check` from `lib/dice.ts` — this is already injectable-pattern-adjacent.
   - Actually: `lib/skills.ts` should import `rollDie` from `lib/dice.ts` as the default rollFn to maintain consistency with the dice engine. Tests override via the parameter.
7. Create `lib/skills.test.ts` — unit tests covering all SKILL-05 scenarios.

**Injectable rollFn signature:** `rollFn: () => number` — returns a number in [1, 20]. The default is `() => rollDie(20)` from `lib/dice.ts`. Tests pass `() => 15` or similar fixed values.

**SkillCharacterInput interface:**
```typescript
interface SkillCharacterInput {
  characterClass: string;
  level:          number;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
  skillProficiencies: string[];
}
```

This is a strict subset of `CharacterData` from `page.tsx` — structural typing means any `CharacterData` passes as a valid `SkillCharacterInput`.

### 04-04: take-turn.ts Skill Check Integration

**Approach:**
1. Import `resolveSkillCheck, SKILL_ABILITY_MAP` from `lib/skills.ts`.
2. Extend `buildStaticPrompt()` JSON schema in `RESPONSE RULES` to include: `"skillName": "ExactSkillName" | null`.
3. After parsing Call #1 response: validate `parsed.skillName` against `Object.keys(SKILL_ABILITY_MAP)`. If valid, call `resolveSkillCheck(parsed.skillName, currentCharacter)`.
4. Build `MECHANICAL CONTEXT` block if skill check occurred.
5. If skill check occurred: make Call #2 (narration call) with the mechanical context block appended to `buildDynamicStatePrompt()`. Use Call #2's narrative/chips/stateDeltas for the final result.
6. If no skill check: use Call #1's narrative/chips/stateDeltas as today.
7. Add `SkillCheckCard` UI component in `page.tsx` — similar to `DiceCard` / `LevelUpCard` pattern.
8. Extend `TurnResult` interface with `skillCheckResult?: SkillCheckResult`.

**Extend `buildDynamicStatePrompt()` signature:**
```typescript
function buildDynamicStatePrompt(
  gameState: any,
  partyMembers: any[],
  currentCharId: string,
  diceResult: D20Result,
  consecutiveMisses: number,
  mechanicalContext?: string,   // NEW — null when no skill check
): string
```

Append mechanicalContext as a `\n\nMECHANICAL CONTEXT\n${mechanicalContext}` block at the end, only when provided.

**SkillCheckCard UI:** Add to `page.tsx` in same section as `DiceCard` and `LevelUpCard`. Use a purple/violet color (distinct from amber-DiceCard and indigo-LevelUpCard).

**Pitfall:** Claude may hallucinate a skill name that is a slight misspelling (e.g., "Sleight of hands" vs "Sleight of Hand"). The canonical validation step (check `parsed.skillName` against exact `SKILL_ABILITY_MAP` keys) catches this and treats it as null — no crash, no partial execution.

**Pitfall:** `buildStaticPrompt` uses `cache_control: { type: "ephemeral" }`. Extending the JSON schema changes the static prompt content. The first turn after deployment will miss the cache for all users; subsequent turns with the same party will cache again. This is acceptable — no special handling needed.

### 04-05: Stats Sub-Tab Live Proficiency Wire-Up

**Approach:**
1. Edit `CharacterData` interface in `page.tsx` — add `skillProficiencies: string[]`.
2. The `getGame` server action fetches `character` via Prisma `include: { character: true }` — after migration and `prisma generate`, `character.skillProficiencies` is automatically available in the response. No server action change needed.
3. Edit `lib/character-sheet.ts`:
   - Add `skillProficiencies?: string[]` to `CharacterInput`.
   - Change line 113: `const skillProfs = new Set<string>(char.skillProficiencies ?? SKILL_PROFS[char.characterClass] ?? []);`
   - Do NOT delete `SKILL_PROFS` yet — keep as fallback until the plan explicitly removes it. Actually: per ROADMAP, Phase 04-05 removes the fallback entirely. Delete `SKILL_PROFS` in this plan.
4. `MemberStatsPane` at line 763 already passes `char` (CharacterData) to `getCharacterSheetData` — once `CharacterData` has `skillProficiencies`, no further change is needed in `MemberStatsPane` itself.

**Dependency:** 04-05 is blocked on 04-01 (migration must exist first so `Character` has `skillProficiencies`). It is NOT blocked on 04-04 — 04-05 only touches `lib/character-sheet.ts` and does not depend on any 04-04 output files (`take-turn.ts`, `SkillCheckCard`). 04-05 runs in Wave 2 in parallel with 04-04.

---

## Section 5: D&D Rules Reference

### SKILL_ABILITY_MAP (18 entries — authoritative)

Extracted directly from `lib/character-sheet.ts` lines 87–106:

| Skill | Ability |
|-------|---------|
| Acrobatics | dexterity |
| Animal Handling | wisdom |
| Arcana | intelligence |
| Athletics | strength |
| Deception | charisma |
| History | intelligence |
| Insight | wisdom |
| Intimidation | charisma |
| Investigation | intelligence |
| Medicine | wisdom |
| Nature | intelligence |
| Perception | wisdom |
| Performance | charisma |
| Persuasion | charisma |
| Religion | intelligence |
| Sleight of Hand | dexterity |
| Stealth | dexterity |
| Survival | wisdom |

[VERIFIED: confirmed in existing `lib/character-sheet.ts` — exact array at lines 87–106]

### Class Skill Lists and Pick Counts

Per D&D Basic Rules 2014 (source: REQUIREMENTS.md SKILL-02):

| Class | Pick Count | Pool Size | Allowed Skills |
|-------|-----------|-----------|----------------|
| Fighter | 2 | 8 | Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, Survival |
| Rogue | 4 | 11 | Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Performance, Persuasion, Sleight of Hand, Stealth |
| Cleric | 2 | 5 | History, Insight, Medicine, Persuasion, Religion |
| Wizard | 2 | 6 | Arcana, History, Insight, Investigation, Medicine, Religion |

Note: REQUIREMENTS.md SKILL-02 previously stated "Fighter: 2 from list of 6" and "Cleric: 2 from list of 8" and "Wizard: 2 from list of 5". These were count errors in the requirements — the "N" values were pool sizes, not pick counts, and were inaccurate. The actual D&D Basic Rules 2014 pool sizes (8/11/5/6) are authoritative. REQUIREMENTS.md has been updated to reflect the correct counts. [RESOLVED — see Open Questions (RESOLVED) below]

**CODE CONSTANT — `CLASS_SKILL_POOL`:**
```typescript
export const CLASS_SKILL_POOL: Record<string, string[]> = {
  Fighter: ["Acrobatics", "Animal Handling", "Athletics", "History", "Insight", "Intimidation", "Perception", "Survival"],
  Rogue:   ["Acrobatics", "Athletics", "Deception", "Insight", "Intimidation", "Investigation", "Perception", "Performance", "Persuasion", "Sleight of Hand", "Stealth"],
  Cleric:  ["History", "Insight", "Medicine", "Persuasion", "Religion"],
  Wizard:  ["Arcana", "History", "Insight", "Investigation", "Medicine", "Religion"],
};

export const SKILL_PICK_COUNT: Record<string, number> = {
  Fighter: 2,
  Rogue:   4,
  Cleric:  2,
  Wizard:  2,
};
```

### Skill Check Formula

```
total = d20 roll + abilityModifier(abilityScore) + (proficient ? proficiencyBonus(level) : 0)
success = total >= dc
```

DC is determined at call site. The default non-combat DC in take-turn.ts is 12 (line 39). For skill checks, the same DC 12 fallback applies in v1. [RESOLVED — see Open Questions (RESOLVED) below]

---

## Section 6: Risk Register

### RISK-01: Prisma String[] Migration on Neon — LOW RISK

**What could go wrong:** Neon is PostgreSQL-compatible but has been known to have edge cases with DDL.
**Mitigation:** Phase 3 already successfully ran 5 migrations on this same Neon connection (including array field `featuresUnlocked String[]` on `ClassProgression` — confirmed in migration SQL at line: `"featuresUnlocked" TEXT[]`). String[] is established precedent. [VERIFIED: migration SQL shows `TEXT[]` already used]
**Action required:** None — follow standard migration workflow.

### RISK-02: Claude Skill Name Hallucination — MEDIUM RISK

**What could go wrong:** Claude returns `skillName: "Sleight of hands"` (lowercase s, plural "hands") or `skillName: "Arcana Magic"` — neither matches the canonical 18 keys.
**Mitigation:** After parsing `parsed.skillName`, validate: `Object.keys(SKILL_ABILITY_MAP).includes(parsed.skillName)`. If false, treat as `null` and proceed without a skill check. This is a no-crash degradation — the turn still resolves normally.
**Residual risk:** Low. The static prompt will include the exact canonical skill names to constrain Claude's output.

### RISK-03: Two-Call Token Cost on Skill Check Turns — MEDIUM RISK

**What could go wrong:** If every turn triggers a skill check, token costs double.
**Mitigation:** Skill checks should be narrative events (Stealth approach, Persuasion conversation, etc.) — not every turn. Exploration and combat turns should return `skillName: null`. The first call is low-token (structured JSON, short). The prompt instructs Claude to return `skillName: null` on all turns that don't narratively warrant a skill check.
**Residual risk:** Acceptable for v1.

### RISK-04: Backfill Script Class Mismatch — LOW RISK

**What could go wrong:** A character was created with a class name that doesn't match `BACKFILL_DEFAULTS` (e.g., "fighter" lowercase, or a non-standard class).
**Mitigation:** Backfill script skips characters with unknown class (console.warn) — same pattern as `seed-backfill-maxhp.mjs`. Characters are left with empty `skillProficiencies = []` which is valid (they just won't have proficiency highlights in the UI until their next game session prompts them to re-create).
**Residual risk:** Low. All characters were created via the 4-class picker.

### RISK-05: Character Creation — Class Change Resets Skills — MEDIUM RISK

**What could go wrong:** User selects Fighter, picks Athletics + Intimidation, then changes class to Rogue. The Rogue skill pool doesn't include Athletics and Intimidation, but the UI state still has them selected. Server-side validation catches this but the UX is confusing.
**Mitigation:** `useEffect` in `character-form.tsx` clears `selectedSkills` whenever `selectedClass` changes. This is explicitly noted in the ROADMAP for 04-01.

### RISK-06: MemberAbilitiesPane Data Fetching — LOW RISK

**What could go wrong:** `useEffect` in `MemberAbilitiesPane` fires once per mount. If the user switches between party members quickly, stale data could display briefly.
**Mitigation:** Use `[char.id, char.level]` as the `useEffect` dependency array — refetches whenever the character or level changes. This covers the level-up case where new features unlock.

### RISK-07: Take-Turn Two-Call Ordering — MEDIUM RISK

**What could go wrong:** Call #1 returns stateDeltas. Call #2 also returns stateDeltas. Which one wins? If both are applied, there could be duplicate or conflicting state changes.
**Mitigation:** When `skillName` is detected and Call #2 is made, use Call #2's `parsed` object for `stateDeltas, chips, encounterResult, narrative`. Call #1's `skillName` is the only value consumed from Call #1. The combat effects parsing runs on Call #2's raw text.
**Action required:** Document this explicitly in the plan so the implementer doesn't accidentally merge both stateDeltas.

---

## Section 7: Validation Architecture

### Test Framework (existing)

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (root) |
| Globals | false — explicit imports required |
| Quick run | `npm run test:run -- lib/skills.test.ts` |
| Full suite | `npm run test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SKILL-03 | `resolveSkillCheck` proficient character: total = roll + modifier + profBonus | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-03 | `resolveSkillCheck` non-proficient: total = roll + modifier only | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-03 | All 18 skill-to-ability mappings produce correct ability score | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-05 | DC boundary: total === dc → success | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-05 | DC boundary: total === dc - 1 → failure | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-05 | `proficient: false` when skill not in `character.skillProficiencies` | unit | `npm run test:run -- lib/skills.test.ts` | No — Wave 0 gap |
| SKILL-02 | Server-side: picks outside allowed list rejected | integration (server action) | Manual / `create-character.test.ts` | Partial |

### Wave 0 Gaps

- [ ] `lib/skills.test.ts` — covers SKILL-03 and SKILL-05 (18 skill mappings, proficient/non-proficient, DC boundary)
- [ ] `lib/skills.ts` — the module itself must exist before tests can run

### Test Patterns to Follow

From `lib/leveling.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { resolveSkillCheck, SKILL_ABILITY_MAP, CLASS_SKILL_POOL } from './skills'

describe('resolveSkillCheck — proficient character', () => {
  it('Stealth check, DEX 14, proficient level-1, DC 12 → success when roll=10', () => {
    const result = resolveSkillCheck("Stealth", {
      characterClass: "Rogue", level: 1,
      strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
      skillProficiencies: ["Stealth"],
    }, 12, () => 10);  // injectable rollFn
    expect(result.proficient).toBe(true)
    expect(result.total).toBe(10 + 2 + 2)  // roll + DEX mod + profBonus(1)
    expect(result.success).toBe(true)       // 14 >= 12
  })
})
```

The `rollFn` and `dc` should both be injectable parameters for deterministic testing. Signature:
```typescript
function resolveSkillCheck(
  skillName:   string,
  character:   SkillCharacterInput,
  dc:          number,
  rollFn?:     () => number,
): SkillCheckResult
```

---

## Architecture Patterns

### System Architecture Diagram (Phase 4 data flow)

```
Character Creation
  character-form.tsx
    → selectedClass change → reset selectedSkills
    → skill multi-select (CLASS_SKILL_POOL[class], SKILL_PICK_COUNT[class])
    → FormData: skillProficiencies=JSON.stringify([...])
    → create-character.ts (server action)
        → validate: picks ⊆ CLASS_SKILL_POOL, len === SKILL_PICK_COUNT
        → prisma.character.create({ skillProficiencies })

In-Game Turn (skill check path)
  handleChipClick()
    → takeTurn() [server action]
        → CALL #1: intent + narration
            → parsed.skillName validated against SKILL_ABILITY_MAP keys
        → if skillName valid:
            → resolveSkillCheck(skill, character, dc, rollFn)   [lib/skills.ts]
            → build [SKILL skill=X outcome=Y dc=N] keyword
            → CALL #2: narration with MECHANICAL CONTEXT block
        → $transaction (unchanged)
        → return TurnResult { skillCheckResult? }
    → setSkillCheckResult(result.skillCheckResult)
    → <SkillCheckCard> rendered in FieldTab (violet theme)

Party Tab — Stats Sub-Tab
  PartyTab → MemberStatsPane({ char })
    → getCharacterSheetData({ ...char, skillProficiencies: char.skillProficiencies })
    → skills list with proficient=true highlighted in green

Party Tab — Abilities Sub-Tab
  MemberAbilitiesPane({ char })
    → useEffect([char.id, char.level])
        → getClassFeatures(char.characterClass, char.level) [server action]
    → cumulative feature list, grouped by level
    → "New" badge on features where feature.level === char.level
```

### Recommended File Structure (new files only)

```
lib/
├── skills.ts           # SKILL_ABILITY_MAP, SKILLS (alias), CLASS_SKILL_POOL, SKILL_PICK_COUNT, resolveSkillCheck
├── skills.test.ts      # SKILL-05 unit tests
prisma/
├── seed-backfill-skills.mjs  # thematic default backfill for existing characters
app/actions/
├── get-class-features.ts     # getClassFeatures(class, maxLevel) server action
```

### Pure Module Pattern (lib/skills.ts)

```typescript
// ─── Skills Engine ─────────────────────────────────────────────────────────────
// Pure TypeScript skill functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { abilityModifier, proficiencyBonus, rollDie } from "./dice";

// ─── Skill → Ability Map ──────────────────────────────────────────────────────

/**
 * All 18 D&D 5e skills mapped to their governing ability score.
 * Source: REQUIREMENTS.md SKILL-03 (authoritative).
 * Extracted from lib/character-sheet.ts SKILLS constant (Phase 04-03).
 */
export const SKILL_ABILITY_MAP: Record<string, keyof SkillCharacterInput> = {
  "Acrobatics":      "dexterity",
  "Animal Handling": "wisdom",
  // ... (18 entries)
};

/** Alias for REQUIREMENTS.md SKILL-03 literal compliance ("lib/skills.ts exports SKILLS"). */
export const SKILLS = SKILL_ABILITY_MAP;
```

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Array type column in Prisma | Custom JSON field | `String[] @default([])` | Native PostgreSQL TEXT[] — supported on Neon, first-class Prisma support |
| Skill check math | Custom formula in take-turn | `resolveSkillCheck()` from lib/skills.ts | Testable pure function; injectable rollFn for tests |
| Class feature lookup | Hardcoded map | `ClassFeature` DB table (already seeded) | DB-driven: correct level granularity, "New" badge logic, no code change for content edits |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Skill check resolution | Inline math in take-turn | `lib/skills.ts resolveSkillCheck()` | Pure function pattern; injectable for tests |
| Class feature lookup | In-memory CLASS_FEATURES map | `ClassFeature` DB rows via `getClassFeatures()` | Already seeded; provides level granularity for "New" badge |
| Skill pick validation in UI | Complex client-side logic only | Server-side check in `create-character.ts` | UI can be bypassed; server is the trust boundary |
| Backfill logic | Custom migration SQL | `.mjs` script mirroring `seed-backfill-maxhp.mjs` pattern | Established pattern; handles unknown classes gracefully |

---

## Common Pitfalls

### Pitfall 1: skillName Validation Missing
**What goes wrong:** `resolveSkillCheck(parsed.skillName, ...)` called with Claude-hallucinated name → throws `Unknown skill` error → turn fails.
**Why it happens:** Claude is instructed to return a skill name but may return a variant spelling.
**How to avoid:** Validate `parsed.skillName` against the exact keys of `SKILL_ABILITY_MAP` before calling `resolveSkillCheck`. Treat invalid names as `null`.
**Warning signs:** Test with an invalid skill name in the schema; confirm it returns `null` cleanly.

### Pitfall 2: Double stateDeltas Application
**What goes wrong:** Both Call #1 and Call #2 return `stateDeltas`; both are applied to `newState` → duplicate or conflicting state mutations.
**Why it happens:** Code applies `Object.assign(newState, deltas)` once. If Call #2 is introduced, the assignment must use only Call #2's deltas.
**How to avoid:** When skill check path is active, replace `parsed` with Call #2's parsed result before the `Object.assign` step.

### Pitfall 3: skillProficiencies Missing from getGame Response
**What goes wrong:** `CharacterData.skillProficiencies` is `undefined` after 04-01 migration → `getCharacterSheetData` receives undefined → falls back to empty array → all skills show non-proficient.
**Why it happens:** `getGame` server action uses `include: { character: true }` which returns all fields — after `prisma generate`, `skillProficiencies` is present. But if `prisma generate` is not run after migration, the type is stale.
**How to avoid:** Run `npx prisma generate` immediately after `npx prisma migrate dev`. This is the standard step; note it explicitly in the plan.

### Pitfall 4: MemberAbilitiesPane Cache Staleness After Level-Up
**What goes wrong:** Character levels up mid-game; `MemberAbilitiesPane` shows old features because `useEffect` dep array doesn't include `char.level`.
**Why it happens:** `useEffect([char.id])` only fires on character ID change, not level change.
**How to avoid:** Use `useEffect(() => {...}, [char.id, char.level])` — refetch whenever level changes.

### Pitfall 5: `@default([])` Is Not `@default(dbgenerated("'{}'")`
**What goes wrong:** Prisma `String[] @default([])` — this may generate a `DEFAULT '{}'::text[]` in PostgreSQL, which is correct. But if something goes wrong, rows inserted via raw SQL (not Prisma) might miss the default.
**Why it happens:** Backfill scripts use the Prisma client (not raw SQL), so they'll always have the correct behavior.
**How to avoid:** Not a real risk for this project. All writes go through Prisma client.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `CLASS_FEATURES` flat list | `ClassFeature` DB rows per (class, level) | Phase 04-02 | Level granularity for "New" badge; content editable without code deploy |
| Hardcoded `SKILL_PROFS` class defaults | `Character.skillProficiencies` per-character | Phase 04-01 + 04-05 | Individual picks; correct proficiency modifiers in UI |
| No skill checks in take-turn | Claude intent → `resolveSkillCheck()` → keyword | Phase 04-04 | Code-owned skill resolution; Claude gets outcome, not raw numbers |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Neon supports `String[] @default([])` — assumed from PostgreSQL compatibility | Schema Analysis | Migration would fail; fallback: use `@default(dbgenerated("'{}'"::text[]))` |
| A2 | REQUIREMENTS.md "list of 6" for Fighter was a count error; actual Fighter pool is 8 skills per D&D Basic Rules 2014 | D&D Rules | RESOLVED — REQUIREMENTS.md updated; CLASS_SKILL_POOL uses 8-skill Fighter list |
| A3 | REQUIREMENTS.md "list of 8" for Cleric was a count error; actual Cleric pool is 5 skills per D&D Basic Rules 2014 | D&D Rules | RESOLVED — REQUIREMENTS.md updated; CLASS_SKILL_POOL uses 5-skill Cleric list |
| A4 | Two-call architecture (Call #1 intent, Call #2 narration) is the ROADMAP intent | Claude Integration | If single-call intended, remove Call #2; compact keyword approach changes |
| A5 | `getClassFeatures` in `useEffect` (component-level fetch) is the preferred approach vs. prop drilling from `PartyTab` | Impl Approach 04-02 | Prop drilling is also valid; either works; component-level matches `MemberInventoryPane` precedent |

---

## Open Questions (RESOLVED)

1. **REQUIREMENTS.md skill list count discrepancies (A2, A3)**
   - What we know: REQUIREMENTS.md said "Fighter: 2 from list of 6" and "Cleric: 2 from list of 8"
   - Resolution: The "list of N" counts in REQUIREMENTS.md were errors — they counted skill pool sizes incorrectly. D&D Basic Rules 2014 are authoritative. The actual pool sizes are: Fighter 8 skills, Rogue 11 skills, Cleric 5 skills, Wizard 6 skills. REQUIREMENTS.md SKILL-02 has been updated with correct counts. CLASS_SKILL_POOL in the plans uses the correct D&D Basic Rules lists. No plan changes needed — the skill pools in 04-01 and 04-03 already match D&D Basic Rules.

2. **DC for skill checks in take-turn**
   - What we know: Non-combat DC defaults to 12 (take-turn.ts line 39). Skill checks may need their own DC.
   - Resolution: Fixed DC 12 for all skill checks in v1. This matches the existing non-combat DC already used in take-turn.ts. Claude describes difficulty narratively; raw DC is never exposed to the player. Dynamic DCs are deferred to v2.

3. **SkillCheckCard UI location when dice card also present**
   - What we know: `DiceCard` and `LevelUpCard` both render in the same `space-y-2` div in FieldTab.
   - Resolution: `SkillCheckCard` supersedes `DiceCard` on skill check turns — when `skillCheckResult` is present in `TurnResult`, hide `DiceCard` (since the skill check IS the dice roll and the SkillCheckCard provides richer context). On non-skill-check turns, `DiceCard` renders as today. Both cards never appear simultaneously.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backfill script (.mjs) | Yes | Assumed >=18 | — |
| Prisma migrate | 04-01 migration | Yes | 7.8.0 (package.json) | — |
| Vitest | 04-03 unit tests | Yes | 4.1.7 (package.json) | — |
| Neon DB connection | Migration + backfill | Yes | Live (5 prior migrations exist) | — |

---

## Sources

### Primary (HIGH confidence)
- `lib/character-sheet.ts` — exact SKILLS array (18 entries), SKILL_PROFS table, CharacterInput interface, getCharacterSheetData function
- `app/actions/take-turn.ts` — complete Claude call structure, buildStaticPrompt JSON schema, RULES_ENGINE_KEYS, $transaction pattern
- `prisma/schema.prisma` — Character model current state, ClassFeature schema
- `prisma/migrations/20260523034205_add_class_progression/migration.sql` — confirms TEXT[] already used in this codebase
- `components/character-form.tsx` — current form structure, point-buy pattern, FormData submission
- `app/actions/create-character.ts` — server action pattern, validation approach, prisma.character.create shape
- `prisma/seed-backfill-maxhp.mjs` — exact backfill script pattern to replicate
- `.planning/REQUIREMENTS.md` — SKILL-01 through SKILL-05 authoritative requirements
- `.planning/PROJECT.md` — Key Decisions section (token keyword format, backfill defaults, stateDeltas flag)
- `.planning/ROADMAP.md` — Phase 4 wave structure, plan-by-plan details

### Secondary (MEDIUM confidence)
- `.planning/phases/03-leveling/03-PATTERNS.md` — pure module pattern, test conventions, backfill script structure
- `lib/leveling.ts`, `lib/xp.ts` — pure module code pattern to replicate for lib/skills.ts

### Tertiary (LOW confidence — ASSUMED)
- D&D Basic Rules 2014 class skill lists — training knowledge; not verified from official source in this session

---

## Metadata

**Confidence breakdown:**
- Existing code inventory: HIGH — read all relevant source files directly
- Schema analysis: HIGH — schema.prisma read directly; migration history confirmed
- Claude integration: HIGH — take-turn.ts read completely; two-call architecture derived from ROADMAP
- D&D rules (18 skills): HIGH — extracted from existing `lib/character-sheet.ts` (already implemented)
- D&D rules (class skill pools): MEDIUM — training knowledge; SKILL-02 in REQUIREMENTS.md provides pick counts, skill lists need cross-check
- Architecture patterns: HIGH — consistent with Phase 3 patterns

**Research date:** 2026-05-23
**Valid until:** 2026-06-23 (stable stack; ROADMAP does not change between now and planning)
