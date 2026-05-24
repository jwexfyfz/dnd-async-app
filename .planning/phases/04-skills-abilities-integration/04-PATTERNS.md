# Phase 4: Skills & Abilities Integration — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 11 (6 new, 5 modified)
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/skills.ts` | utility (pure module) | transform | `lib/leveling.ts` | exact |
| `lib/skills.test.ts` | test | transform | `lib/leveling.test.ts` | exact |
| `prisma/seed-backfill-skills.mjs` | utility (script) | CRUD | `prisma/seed-backfill-maxhp.mjs` | exact |
| `app/actions/get-class-features.ts` | service (server action) | CRUD/request-response | `app/actions/get-map-items.ts` | exact |
| `prisma/schema.prisma` | config | — | prior `String[]` migration (`featuresUnlocked`) | exact |
| `lib/character-sheet.ts` | utility (pure module) | transform | itself (modification) | self |
| `app/game/[id]/page.tsx` | component (page) | request-response | itself (modification) | self |
| `app/actions/take-turn.ts` | service (server action) | request-response + event-driven | itself (modification) | self |
| `components/character-form.tsx` | component | request-response | itself (modification) | self |
| `app/actions/create-character.ts` | service (server action) | CRUD | itself (modification) | self |
| `SkillCheckCard` (inline in page.tsx) | component | request-response | `LevelUpCard` in `page.tsx` | exact |

---

## Pattern Assignments

### `lib/skills.ts` (utility, transform)

**Analog:** `lib/leveling.ts`

**File header / imports pattern** (`lib/leveling.ts` lines 1–6):
```typescript
// ─── Skills Engine ─────────────────────────────────────────────────────────────
// Pure TypeScript skill functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────

import { abilityModifier, proficiencyBonus, rollDie } from "./dice";
```

**Exported constant table pattern** (`lib/leveling.ts` lines 18–23):
```typescript
export const HIT_DIE_BY_CLASS: Record<string, { die: number; avg: number }> = {
  Fighter: { die: 10, avg: 6 },
  Rogue:   { die: 8,  avg: 5 },
  // ...
};
```
`SKILL_ABILITY_MAP`, `CLASS_SKILL_POOL`, and `SKILL_PICK_COUNT` all follow this same `export const NAME: Record<string, ...> = { ... }` shape. Extract `SKILL_ABILITY_MAP` by converting the existing `SKILLS` array in `lib/character-sheet.ts` (lines 87–106) from `{ name, ability }[]` to a `Record<string, AbilityKey>`.

**Interface for function input** — new in `lib/skills.ts`, no exact analog (closest is `CharacterInput` in `lib/character-sheet.ts` lines 7–16):
```typescript
// lib/character-sheet.ts lines 7–16 — copy and extend with skillProficiencies
interface CharacterInput {
  characterClass: string;
  level:          number;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
}
// Phase 4 adds: skillProficiencies: string[]
```
`SkillCharacterInput` in `lib/skills.ts` is a copy of `CharacterInput` plus `skillProficiencies: string[]`.

**Function with throw-on-unknown-input pattern** (`lib/leveling.ts` lines 44–59):
```typescript
export function maxHpAtLevel(
  characterClass: string,
  constitution: number,
  level: number,
): number {
  const hitDie = HIT_DIE_BY_CLASS[characterClass];
  if (!hitDie) throw new Error(`Unknown class: ${characterClass}`);
  // ...
}
```
`resolveSkillCheck` follows the same pattern: look up `SKILL_ABILITY_MAP[skillName]`, throw `new Error(\`Unknown skill: ${skillName}\`)` if not found.

**Complete function signature for `resolveSkillCheck`** (from RESEARCH.md Section 4):
```typescript
export function resolveSkillCheck(
  skillName:   string,
  character:   SkillCharacterInput,
  dc:          number,
  rollFn?:     () => number,  // default: () => rollDie(20)
): SkillCheckResult
```

**`SkillCheckResult` interface** (from RESEARCH.md Section 3):
```typescript
export interface SkillCheckResult {
  skill:            string;
  abilityScore:     string;
  roll:             number;
  modifier:         number;
  proficiencyBonus: number;   // 0 when not proficient
  total:            number;   // roll + modifier + proficiencyBonus
  dc:               number;
  success:          boolean;
  proficient:       boolean;
}
```

**Re-export pattern** (`lib/leveling.ts` lines 62–69):
```typescript
export { proficiencyBonus };
```
`lib/skills.ts` does NOT need a re-export — all callers that need `proficiencyBonus` already import from `lib/leveling.ts`.

---

### `lib/skills.test.ts` (test, transform)

**Analog:** `lib/leveling.test.ts`

**File header and import pattern** (`lib/leveling.test.ts` lines 1–9):
```typescript
// ─── Leveling Engine Unit Tests ... ──────────────────────────────────────────
// ... description comment block ...
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { HIT_DIE_BY_CLASS, maxHpAtLevel, proficiencyBonus } from './leveling'
```
Skill test import:
```typescript
import { describe, it, expect } from 'vitest'
import { resolveSkillCheck, SKILL_ABILITY_MAP, CLASS_SKILL_POOL, SKILL_PICK_COUNT } from './skills'
```

**Describe block with injectable rollFn pattern** (from RESEARCH.md Section 7 — test pattern):
```typescript
describe('resolveSkillCheck — proficient character', () => {
  it('Stealth check, DEX 14, proficient level-1, DC 12 → success when roll=10', () => {
    const result = resolveSkillCheck("Stealth", {
      characterClass: "Rogue", level: 1,
      strength: 10, dexterity: 14, constitution: 10,
      intelligence: 10, wisdom: 10, charisma: 10,
      skillProficiencies: ["Stealth"],
    }, 12, () => 10);  // 4th arg: injectable rollFn
    expect(result.proficient).toBe(true)
    expect(result.total).toBe(10 + 2 + 2)  // roll + DEX mod + profBonus(1)
    expect(result.success).toBe(true)
  })
})
```

**Boundary condition pattern** (`lib/leveling.test.ts` lines 322–330 — unknown class throws):
```typescript
describe('maxHpAtLevel unknown class throws', () => {
  it('"Paladin", 14, 1 → throws Error with message containing "Unknown class: Paladin"', () => {
    expect(() => maxHpAtLevel('Paladin', 14, 1)).toThrow(/Unknown class: Paladin/)
  })
})
```
Apply the same pattern for an unknown skill name in `lib/skills.test.ts`.

**Constant table smoke-test pattern** (`lib/leveling.test.ts` lines 13–29):
```typescript
describe('HIT_DIE_BY_CLASS', () => {
  it('Fighter → { die: 10, avg: 6 }', () => {
    expect(HIT_DIE_BY_CLASS['Fighter']).toEqual({ die: 10, avg: 6 })
  })
  // ...
})
```
Apply the same pattern for `SKILL_ABILITY_MAP` (check a sampling of mappings) and `CLASS_SKILL_POOL` (check pick counts match `SKILL_PICK_COUNT`).

---

### `prisma/seed-backfill-skills.mjs` (utility script, CRUD)

**Analog:** `prisma/seed-backfill-maxhp.mjs` (read in full — 90 lines)

**File header and module setup pattern** (`seed-backfill-maxhp.mjs` lines 1–22):
```javascript
// prisma/seed-backfill-skills.mjs
// One-shot post-migration backfill: sets every Character.skillProficiencies to
// thematic class defaults for existing characters with empty picks.
//
// Run with: npm run db:backfill-skills
//
// Mirror of lib/skills.ts CLASS constants — kept inline because importing .ts
// from .mjs requires a build step.

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const { PrismaClient } = await import("@prisma/client");
const { PrismaNeon }   = await import("@prisma/adapter-neon");

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma  = new PrismaClient({ adapter });
```

**Inline constants pattern** (`seed-backfill-maxhp.mjs` lines 27–53 — mirror of lib constants):
```javascript
const BACKFILL_DEFAULTS = {
  Fighter: ["Athletics",   "Intimidation"],
  Rogue:   ["Stealth",     "Perception"],
  Cleric:  ["Insight",     "Religion"],
  Wizard:  ["Arcana",      "Investigation"],
};
```

**Main function with skip-on-unknown-class pattern** (`seed-backfill-maxhp.mjs` lines 58–85):
```javascript
async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, characterClass: true, skillProficiencies: true },
  });

  let updated = 0;
  const total = characters.length;

  for (const row of characters) {
    // Skip characters that already have picks (idempotent)
    if (row.skillProficiencies.length > 0) continue;

    const defaults = BACKFILL_DEFAULTS[row.characterClass];
    if (!defaults) {
      console.warn(`Skipping character ${row.id}: unknown class "${row.characterClass}"`);
      continue;
    }

    await prisma.character.update({
      where: { id: row.id },
      data:  { skillProficiencies: defaults },
    });
    updated++;
  }

  console.log(`Updated ${updated} of ${total} characters`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```
Note the difference from `seed-backfill-maxhp.mjs`: the condition is `skillProficiencies.length === 0` (skip already-populated), not a value mismatch check.

---

### `app/actions/get-class-features.ts` (service, CRUD/request-response)

**Analog:** `app/actions/get-map-items.ts` (26 lines — read in full)

**Complete analog** (`get-map-items.ts` lines 1–25):
```typescript
"use server";

import { prisma } from "../../lib/prisma";

export interface EquippableItemData {
  id:                string;
  name:              string;
  // ... other fields
}

export async function getMapItems(mapId: string): Promise<EquippableItemData[]> {
  return prisma.equippableItem.findMany({
    where:   { mapId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, /* ... */
    },
  });
}
```

**`get-class-features.ts` implementation follows the same shape exactly:**
```typescript
"use server";

import { prisma } from "../../lib/prisma";

export interface ClassFeatureData {
  id:             string;
  characterClass: string;
  level:          number;
  name:           string;
  description:    string;
}

export async function getClassFeatures(
  characterClass: string,
  maxLevel:       number,
): Promise<ClassFeatureData[]> {
  return prisma.classFeature.findMany({
    where:   { characterClass, level: { lte: maxLevel } },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    select: {
      id: true, characterClass: true, level: true,
      name: true, description: true,
    },
  });
}
```
No auth check needed — `ClassFeature` is read-only public data (same as `getMapItems` which has no auth check).

---

### `prisma/schema.prisma` — add `skillProficiencies String[]` (config)

**Analog:** existing `featuresUnlocked String[]` field in `ClassProgression` model (confirmed used in `prisma/migrations/20260523034205_add_class_progression/migration.sql`).

**Addition to Character model** — place after `currentHp`:
```prisma
  skillProficiencies String[] @default([])
```
This maps to `TEXT[] DEFAULT '{}'` in PostgreSQL. Neon compatibility confirmed from Phase 3 migration precedent.

---

### `lib/character-sheet.ts` — modifications (04-05)

**File:** `lib/character-sheet.ts` (134 lines — read in full)

**`CharacterInput` interface to extend** (lines 7–16):
```typescript
interface CharacterInput {
  characterClass: string;
  level:          number;
  strength:       number;
  dexterity:      number;
  constitution:   number;
  intelligence:   number;
  wisdom:         number;
  charisma:       number;
  // ADD: skillProficiencies?: string[]
}
```

**Line to replace** (line 113):
```typescript
// BEFORE:
const skillProfs = new Set<string>(SKILL_PROFS[char.characterClass] ?? []);
// AFTER (04-05):
const skillProfs = new Set<string>(char.skillProficiencies ?? []);
```

**`SKILL_PROFS` constant to DELETE** (lines 60–73) — the entire block. Also delete the comment above it ("Default skill proficiency picks...").

**`SKILLS` array to extract** (lines 87–106) — this is the authoritative 18-entry source for `SKILL_ABILITY_MAP` in `lib/skills.ts`. The array stays in `lib/character-sheet.ts`; `lib/skills.ts` derives its `SKILL_ABILITY_MAP` Record from the same data independently (do not import cross-module to keep lib/skills.ts zero-dependency on character-sheet).

---

### `app/game/[id]/page.tsx` — modifications (04-01, 04-02, 04-04, 04-05)

**File:** `app/game/[id]/page.tsx` (1287 lines)

**`CharacterData` interface to extend** (lines 45–59) — add after `maxHp`:
```typescript
// ADD in 04-01 (after migration + prisma generate):
skillProficiencies: string[];
```

**`CLASS_FEATURES` constant to DELETE** (lines 619–632) — the entire block (04-02).

**`MemberAbilitiesPane` rewrite pattern** — analog is `MemberInventoryPane` (lines 881–926). Key pattern:
```typescript
// MemberInventoryPane useEffect pattern (lines 893–895):
useEffect(() => {
  getMapItems(mapId).then((data) => { setItems(data); setLoading(false); });
}, [mapId]);

// Loading state (line 926):
if (loading) return <p className="text-[11px] text-slate-400 py-2">Loading…</p>;
```
`MemberAbilitiesPane` adopts the same: `useState<ClassFeatureData[]>([])`, `useState(true)` for loading, `useEffect(() => { getClassFeatures(char.characterClass, char.level).then(...) }, [char.id, char.level])`. Note dependency array is `[char.id, char.level]` (not `[mapId]`) to refetch on level-up.

**Current `MemberAbilitiesPane` to replace** (lines 1206–1231):
```typescript
function MemberAbilitiesPane({ char }: { char: CharacterData }) {
  const prof  = proficiencyBonus(char.level);
  const feats = CLASS_FEATURES[char.characterClass] ?? [];  // ← DELETE this lookup
  return (
    // ...flat <ul> of feats...
  );
}
```
After 04-02: receives features from `getClassFeatures`; groups by level; adds "New" badge where `feature.level === char.level`.

**`SkillCheckCard` component pattern** — analog is `LevelUpCard` (lines 595–613):
```typescript
// LevelUpCard — indigo theme (lines 595–613):
function LevelUpCard({ result }: { result: LevelUpResult }) {
  return (
    <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm">
      <span className="text-base">⬆</span>
      <span className="font-semibold text-indigo-700">Level {result.oldLevel} → {result.newLevel}</span>
      // ...
    </div>
  );
}
```
`SkillCheckCard` uses the same layout with **violet** theme (`bg-violet-50 border-violet-200 text-violet-700`). Props shape: `{ result: SkillCheckResult }`. Displayed in same `space-y-2` div as `DiceCard` and `LevelUpCard` (lines 490–499). When `skillCheckResult` is present, hide `DiceCard` (it's redundant — the skill result IS the dice roll context).

**State management for `SkillCheckCard`** — copy exact pattern of `diceResult`/`levelUpResult` (lines 137–138, 226–227, 249–250):
```typescript
// Add alongside existing state:
const [skillCheckResult, setSkillCheckResult] = useState<SkillCheckResult | null>(null);

// In handleChipClick — clear on new turn (line 226 area):
setSkillCheckResult(null);

// After takeTurn returns (line 249 area):
setSkillCheckResult(result.skillCheckResult ?? null);
```

**`FieldTab` props extension** — analog is how `levelUpResult` was added (lines 461–462):
```typescript
// Add to FieldTab props interface:
skillCheckResult?: SkillCheckResult | null;
```

---

### `app/actions/take-turn.ts` — modifications (04-04)

**File:** `app/actions/take-turn.ts` (431 lines)

**Imports to add** (lines 1–16 area):
```typescript
import { resolveSkillCheck, SKILL_ABILITY_MAP } from "../../lib/skills";
import type { SkillCheckResult } from "../../lib/skills";
```

**`TurnResult` interface extension** (lines 197–208) — add after `combatEffects`:
```typescript
skillCheckResult?: SkillCheckResult;
```

**`buildDynamicStatePrompt` signature extension** (lines 109–115):
```typescript
// BEFORE:
function buildDynamicStatePrompt(
  gameState: any,
  partyMembers: any[],
  currentCharId: string,
  diceResult: D20Result,
  consecutiveMisses: number,
): string

// AFTER (04-04):
function buildDynamicStatePrompt(
  gameState: any,
  partyMembers: any[],
  currentCharId: string,
  diceResult: D20Result,
  consecutiveMisses: number,
  mechanicalContext?: string,   // NEW — undefined when no skill check
): string
```

**Append pattern for `mechanicalContext`** — analog is `levelUpDirective` (lines 162–166):
```typescript
// Existing append pattern:
const levelUpDirective = gameState.levelUpNote
  ? `\n\nLEVEL UP: ${gameState.levelUpNote} Weave this...`
  : "";

return `${stateSection}${diceSection}${missDirective}${levelUpDirective}`;

// New pattern — append mechanicalContext after levelUpDirective:
const mechanicalContextBlock = mechanicalContext
  ? `\n\nMECHANICAL CONTEXT\n${mechanicalContext}`
  : "";

return `${stateSection}${diceSection}${missDirective}${levelUpDirective}${mechanicalContextBlock}`;
```

**JSON schema extension in `buildStaticPrompt`** — the `RESPONSE RULES` block (lines 79–95). Add `skillName` field to the JSON schema comment block:
```
"skillName": "ExactSkillName" | null
```
Place it alongside `encounterResult` in the schema description. Add to the schema comment the instruction: `skillName: return the exact canonical skill name if this action narratively warrants a skill check (Stealth, Perception, etc.), null on all other turns.`

**Two-call integration pattern** — after `parsed` is extracted from Call #1 (lines 290–301), insert:
```typescript
// Validate skillName against canonical list
const rawSkillName = (parsed as any).skillName;
const validSkillName = (rawSkillName && Object.keys(SKILL_ABILITY_MAP).includes(rawSkillName))
  ? rawSkillName
  : null;

let skillCheckResult: SkillCheckResult | undefined;
let finalParsed = parsed;

if (validSkillName) {
  const dc = (detectActionType(sanitizedAction, gameState)).dc;  // reuse existing DC
  skillCheckResult = resolveSkillCheck(validSkillName, currentCharacter, dc);
  const outcome = skillCheckResult.success ? "SUCCESS" : "FAILURE";
  const mechanicalContext = `[SKILL skill=${validSkillName} outcome=${outcome} dc=${skillCheckResult.dc}]\nNarration rules: Do NOT reproduce the skill name, outcome, DC, roll value, or proficiency bonus in your narrative.`;

  // Call #2 — narration with mechanical context
  const response2 = await anthropic.messages.create({
    model:      DM_MODEL,
    max_tokens: DM_MAX_TOKENS,
    system: [
      {
        type:          "text",
        text:          buildStaticPrompt(game.character, game.partyMembers, game.storyPrompt, mapData),
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: buildDynamicStatePrompt(gameState, game.partyMembers, currentCharId, diceResult, consecutiveMisses, mechanicalContext),
      },
    ],
    messages: buildConversationMessages(contextWindow, sanitizedAction),
  });

  // Use Call #2's parsed result as authoritative (narrative, stateDeltas, chips, encounterResult)
  const textBlock2 = response2.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText2   = textBlock2?.text ?? "";
  try {
    const match2 = rawText2.match(/\{[\s\S]*\}/);
    finalParsed  = JSON.parse(match2?.[0] ?? rawText2);
  } catch { /* keep parsed as fallback */ }
}

// All downstream code uses `finalParsed` instead of `parsed`
```
**Critical:** All code after this block that references `parsed` must be updated to reference `finalParsed` — this covers `parseCombatEffects`, `encounterCompleted`, `stateDeltas`, and the `$transaction` message write.

**Return value extension** (lines 414–429 area) — add alongside `levelUpResult`:
```typescript
skillCheckResult: skillCheckResult,
```

---

### `components/character-form.tsx` — modifications (04-01)

**File:** `components/character-form.tsx` (198 lines)

**State additions** — copy exact pattern of existing `useState` declarations (lines 19–25):
```typescript
// ADD after existing state:
const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
const [skillError,     setSkillError]     = useState("");
```

**`useEffect` to reset skills on class change** — analog is inline pattern; closest existing hook is `useEffect` (none in this file currently — it's class-free). New pattern:
```typescript
// After state declarations:
useEffect(() => {
  setSelectedSkills([]);
  setSkillError("");
}, [selectedClass]);
```
This is a simple React effect — no analog in the current file, but the pattern is straightforward.

**Skill toggle handler** — analog is `handleStatChange` (lines 38–69). Same guard-then-set pattern:
```typescript
function handleSkillToggle(skill: string) {
  setSkillError("");
  if (selectedSkills.includes(skill)) {
    setSelectedSkills(selectedSkills.filter((s) => s !== skill));
  } else {
    const limit = SKILL_PICK_COUNT[selectedClass] ?? 0;
    if (selectedSkills.length >= limit) {
      setSkillError(`Choose exactly ${limit} skills for ${selectedClass}.`);
      return;
    }
    setSelectedSkills([...selectedSkills, skill]);
  }
}
```

**Skill picker UI block** — analog is the Class Grid block (lines 124–140):
```typescript
{/* Class Grid — analog for skill picker layout */}
<div className="space-y-2">
  <label className="text-sm font-medium text-slate-700">Choose Class</label>
  <div className="grid grid-cols-2 gap-2">
    {CLASSES.map((cls) => (
      <button
        key={cls}
        type="button"
        onClick={() => setSelectedClass(cls)}
        className={`p-3 border text-sm font-medium rounded-md transition-colors ${
          selectedClass === cls
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 hover:bg-slate-50"
        }`}
      >
        {cls}
      </button>
    ))}
  </div>
</div>
```
Skill picker uses the same `border/bg-slate-900 text-white` selected style, grid layout `grid-cols-2 gap-2`, conditioned on `selectedClass` being set (render skill picker only after a class is chosen).

**Error display analog** — the `ruleHint` display (lines 179–183):
```typescript
{ruleHint && (
  <div className="text-xs font-medium text-amber-800 bg-amber-50 p-3 rounded-md border border-amber-200">
    {ruleHint}
  </div>
)}
```
`skillError` uses the same `bg-amber-50 border-amber-200 text-amber-800` pattern.

**`handleSubmit` extension** — add before `createCharacter(formData)` call (line 83 area):
```typescript
// Validate skill selection before submit
if (selectedClass && selectedSkills.length !== (SKILL_PICK_COUNT[selectedClass] ?? 0)) {
  setStatus("error");
  setErrorMessage(`Select exactly ${SKILL_PICK_COUNT[selectedClass]} skills for ${selectedClass}.`);
  return;
}

// Append skills as JSON string (single FormData field)
formData.append("skillProficiencies", JSON.stringify(selectedSkills));
```
Reset `selectedSkills` on success alongside existing resets (line 89 area): `setSelectedSkills([])`.

---

### `app/actions/create-character.ts` — modifications (04-01)

**File:** `app/actions/create-character.ts` (96 lines)

**Import addition** (lines 1–6 area):
```typescript
import { CLASS_SKILL_POOL, SKILL_PICK_COUNT } from "../../lib/skills";
```

**FormData parse pattern** — analog is ability score parsing (lines 27–38):
```typescript
// Existing pattern to copy:
function parseAbilityScore(raw: FormDataEntryValue | null): number | null {
  const n = parseInt(raw as string, 10);
  if (isNaN(n) || n < 1 || n > 20) return null;
  return n;
}
const strength = parseAbilityScore(formData.get("strength"));

// New pattern for skillProficiencies:
let skillProficiencies: string[];
try {
  skillProficiencies = JSON.parse(formData.get("skillProficiencies") as string ?? "[]");
  if (!Array.isArray(skillProficiencies)) throw new Error();
} catch {
  return { success: false, error: "Invalid skill proficiency data." };
}
```

**Validation pattern** — analog is the class validation block (lines 43–48):
```typescript
// Existing class validation:
if (!(characterClass in HIT_DIE_BY_CLASS)) {
  return { success: false, error: "Invalid character class." };
}

// New skill validation (place after class validation):
const allowedSkills = CLASS_SKILL_POOL[characterClass] ?? [];
const requiredCount = SKILL_PICK_COUNT[characterClass] ?? 0;
if (skillProficiencies.length !== requiredCount) {
  return { success: false, error: `Choose exactly ${requiredCount} skills for ${characterClass}.` };
}
if (!skillProficiencies.every((s) => allowedSkills.includes(s))) {
  return { success: false, error: "One or more selected skills are not available for this class." };
}
```

**Prisma create extension** — add `skillProficiencies` to the `data` object in `prisma.character.create` (lines 72–86):
```typescript
await prisma.character.create({
  data: {
    name: name.trim(),
    userId: user.id,
    characterClass,
    strength, dexterity, constitution, intelligence, wisdom, charisma,
    maxHp,
    currentHp: maxHp,
    skillProficiencies,   // ADD THIS LINE
  },
});
```

---

## Shared Patterns

### Authentication (all server actions)
**Source:** `app/actions/create-character.ts` lines 16–21
**Apply to:** `app/actions/get-class-features.ts` — NO auth needed (public read-only data, same as `get-map-items.ts` which has no auth check). `create-character.ts` modifications inherit existing auth.
```typescript
// get-class-features.ts does NOT need this block — same as get-map-items.ts
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { success: false, error: "Not logged in." };
```

### Error return shape
**Source:** `app/actions/create-character.ts` lines 8–11
**Apply to:** All server action modifications
```typescript
interface ActionResponse {
  success: boolean;
  error?: string;
}
// Server actions return early with { success: false, error: "..." } on validation failure
// and { success: true } on success.
```

### Prisma import
**Source:** All server actions use `import { prisma } from "../../lib/prisma";`
**Apply to:** `app/actions/get-class-features.ts`

### "use server" / "use client" directive
**Source:** `app/actions/create-character.ts` line 1 / `components/character-form.tsx` line 1
**Apply to:**
- `app/actions/get-class-features.ts`: `"use server";` at line 1
- `components/character-form.tsx`: already has `"use client";` — no change

### useEffect + loading skeleton pattern
**Source:** `MemberInventoryPane` in `page.tsx` lines 893–895, 926
**Apply to:** `MemberAbilitiesPane` rewrite (04-02)
```typescript
useEffect(() => {
  getMapItems(mapId).then((data) => { setItems(data); setLoading(false); });
}, [mapId]);
// ...
if (loading) return <p className="text-[11px] text-slate-400 py-2">Loading…</p>;
```

### Pure module file header
**Source:** `lib/leveling.ts` lines 1–4 / `lib/xp.ts` lines 1–4
**Apply to:** `lib/skills.ts`
```typescript
// ─── Skills Engine ─────────────────────────────────────────────────────────────
// Pure TypeScript skill functions. Zero framework dependencies. Zero Prisma
// imports. All functions are deterministic.
// ─────────────────────────────────────────────────────────────────────────────
```

### Section separator comment style
**Source:** Throughout `lib/leveling.ts`, `lib/xp.ts`, `lib/character-sheet.ts`
**Apply to:** `lib/skills.ts`, `lib/skills.test.ts`
```typescript
// ─── Section Name ─────────────────────────────────────────────────────────────
```

---

## No Analog Found

No files in Phase 4 are without an analog. All 11 files/components have exact or role-match patterns in the codebase.

---

## Metadata

**Analog search scope:** `lib/`, `app/actions/`, `app/game/[id]/`, `components/`, `prisma/`
**Files read:** `lib/leveling.ts`, `lib/leveling.test.ts`, `lib/xp.ts`, `lib/character-sheet.ts`, `lib/dice.ts` (exports only), `app/actions/create-character.ts`, `app/actions/get-map-items.ts`, `app/actions/take-turn.ts` (full), `components/character-form.tsx`, `app/game/[id]/page.tsx` (targeted sections), `prisma/seed-backfill-maxhp.mjs`
**Pattern extraction date:** 2026-05-23
