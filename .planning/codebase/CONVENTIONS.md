# Coding Conventions

**Analysis Date:** 2026-05-23

## Hard Rules (from CLAUDE.md)

- Never alter `prisma/schema.prisma` or run `prisma db push/migrate` unless the task explicitly requires it.
- Never suppress or comment out TypeScript/build errors — fix the root cause.
- Never let AI generate dice roll results — dice math is pure code only (see `lib/dice.ts`).
- Surgical edits only — don't reformat or refactor files outside the active task.

## TypeScript Patterns

**Strict mode:** `strict: true` in `tsconfig.json`. All code compiles under strict null checks.

**Interface definitions:** Defined locally in the file where they are consumed — not in a shared `types/` directory.
- Action response shapes use a local `interface ActionResponse { success: boolean; error?: string; data?: ... }` pattern per action file.
- Prop interfaces are defined just above the component they describe: `interface Props { ... }`.
- Domain interfaces (e.g., `D20Result` in `lib/dice.ts`) live in the lib file that owns the concept.

**Type narrowing:** Explicit null checks with early returns (`if (!user) return { success: false, error: "..." }`). `as` casts are used only for `FormDataEntryValue` parsing and JSON game state — never to silence errors.

**Exported constants:** Typed with `readonly` arrays where immutability matters (e.g., `export const XP_THRESHOLDS: readonly number[]` in `lib/xp.ts`).

**`type` vs `import type`:** `import type { D20Result }` is used for type-only imports to keep runtime bundles clean (seen in `app/actions/take-turn.ts`).

## File Naming

- **Action files:** kebab-case, verb-noun pattern — `create-character.ts`, `take-turn.ts`, `get-characters.ts`
- **Component files:** kebab-case `.tsx` — `character-form.tsx`, `character-list.tsx`, `login-screen.tsx`
- **Lib files:** kebab-case `.ts` — `dice.ts`, `xp.ts`, `leveling.ts`, `combat-effect.ts`
- **Test files:** same name as the file under test with `.test.ts` suffix — `dice.test.ts`, `xp.test.ts`
- **Page files:** `page.tsx` in route directories per Next.js App Router convention
- **CSS:** single `app/globals.css`

## Component Patterns

**"use client" vs server:** All interactive components declare `"use client"` at the top of the file. All data-fetching/mutation files declare `"use server"`. These directives are the first line of each file with no preceding comments.

**Client components:** `app/page.tsx`, `components/character-form.tsx`, `components/character-list.tsx`, `components/login-screen.tsx`, `components/user-menu.tsx`, `components/map-renderer.tsx`.

**Server components / pages:** `app/game/[id]/page.tsx`, `app/create-character/page.tsx`, `app/play/page.tsx` — these are server-rendered pages that pass data down to client components.

**Prop interface naming:** Always `interface Props { ... }` (not `ComponentNameProps`), defined immediately before the component function.

**Default exports:** All components use `export default function ComponentName(...)`.

**Aligned prop formatting:** Multi-field interfaces use column-aligned values for readability:
```typescript
interface Character {
  id:             string;
  name:           string;
  characterClass: string;
}
```

## Server Action Patterns

**Return shape:** Every action returns a plain object with `{ success: boolean; error?: string; data?: T }`. Data is always under the `data` key. Errors are always strings (never Error objects).

**Error handling:** All async database work is wrapped in `try/catch`. On catch, `console.error` is called and `{ success: false, error: error.message }` is returned. TypeScript errors typed `error: any`.

**Auth guard:** Every mutating action calls `supabase.auth.getUser()` and returns early with `{ success: false, error: "Not authenticated." }` if no user is present.

**`revalidatePath`:** Called at the end of successful mutations to invalidate Next.js cache (e.g., `revalidatePath("/")` in `create-character.ts`).

**`"use server"` placement:** Always the absolute first line of action files.

## State Management Patterns

**useState:** Used in all interactive client components. Multiple related state variables are declared with aligned formatting:
```typescript
const [deleteTarget,   setDeleteTarget]   = useState<Character | null>(null);
const [confirmText,    setConfirmText]    = useState("");
const [isDeleting,     setIsDeleting]     = useState(false);
```

**Status enum pattern:** Loading/error/success state tracked as a discriminated union:
```typescript
const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
```

**Optimistic updates:** Not used. All mutations call the server action, await the result, then refresh state via a `loadCharacters()` callback pattern. Only `take-turn.ts` uses a version-locked `prisma.$transaction` as an optimistic concurrency guard server-side.

**`useCallback`:** Used for data-fetching functions passed as callbacks (`loadCharacters` in `app/page.tsx`).

## CSS Conventions

**Framework:** Tailwind CSS v4 — imported via `@import "tailwindcss"` in `app/globals.css`.

**Custom CSS:** Minimal. Only CSS custom properties for background/foreground colors and a single `@keyframes hp-flash` animation for HP damage feedback are defined in `globals.css`.

**Animation:** Tailwind utility classes (`animate-pulse`, `transition-colors`, `transition-all`) for interactive feedback. The `hp-flash` keyframe is the only custom animation.

**Component styling:** All styling via inline Tailwind classes on JSX elements — no CSS modules, no styled-components.

**Design tokens:** Slate/blue/red color palette from Tailwind defaults. Cards use `rounded-xl`, `shadow`, `border border-slate-200 bg-white`.

## Import Conventions

**Path alias:** `@/*` maps to project root (defined in `tsconfig.json`). Used in client components (e.g., `import { createCharacter } from "@/app/actions/create-character"`).

**Relative imports:** Used in server actions and lib files (e.g., `import { prisma } from "../../lib/prisma"`).

**Import order (observed pattern):**
1. Framework/third-party (`next/cache`, `@anthropic-ai/sdk`)
2. Internal lib files (`../../lib/prisma`, `../../lib/supabase-server`)
3. Types (`import type { D20Result }`)

**No barrel files:** Each module is imported directly by path — no `index.ts` re-export aggregators.

## Prisma Conventions

**Singleton client:** `lib/prisma.ts` exports a global singleton `prisma` using `globalThis` to prevent multiple instances in dev hot-reload.

**Query structure:** `findMany`/`findUnique` with inline `where`, `include`, `orderBy`, `select`, `take` options using object-literal formatting with aligned keys.

**`select` vs `include`:** Use `select` to fetch minimal fields for performance; use `include` for nested relation traversal.

**Transactions:** `prisma.$transaction(async (tx) => { ... })` used only for multi-write operations requiring atomicity (e.g., the optimistic-lock write in `app/actions/take-turn.ts`). Single writes use direct `prisma.model.create/update`.

**Error handling:** Prisma errors bubble up to the `catch (error: any)` block in server actions — never silenced.

## Section Banners

Lib files and complex action files use visual section banners for readability:
```typescript
// ─── Section Name ────────────────────────────────────────────────────────────
```

---

*Convention analysis: 2026-05-23*
