# Coding Conventions

**Analysis Date:** 2026-05-20

## Code Style

**Formatting:**
- No Prettier config detected. Formatting is not enforced by tooling — code is manually consistent.
- Indentation: 2 spaces throughout all `.ts` and `.tsx` files.
- Trailing commas used in multi-line objects and function args.
- Single quotes used in `lib/` files (`lib/prisma.ts`); double quotes used in `app/` and `components/`. No enforced standard.

**Linting:**
- ESLint 9 with flat config format: `eslint.config.mjs`
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- No custom rule overrides beyond the default Next.js ignores (`.next/`, `out/`, `build/`)
- Run: `npm run lint` (calls `eslint` with no explicit target path — relies on default detection)

**Semicolons:** Always used.

**Line length:** No enforced limit. Some lines are long (e.g., inline ternary chains in JSX).

## TypeScript Patterns

**Strict mode:** Enabled — `tsconfig.json` has `"strict": true`.

**Path aliases:**
- `@/*` maps to the project root. Used in components to import actions:
  ```ts
  import { createCharacter } from "@/app/actions/create-character";
  ```
- Relative paths (`../../lib/prisma`) are used inside `app/actions/` files when referencing `lib/`.

**Type definitions:**
- Local interfaces are declared inline at the top of each file, not in a shared `types/` directory.
- The `Character` interface is duplicated between `app/page.tsx` and `components/character-list.tsx` — no shared type file exists.
- Props interfaces are named `Props` (not `ComponentNameProps`): `interface Props { ... }` pattern used in both `components/character-form.tsx` and `components/character-list.tsx`.
- Server action return types are explicitly annotated: `Promise<ActionResponse>`, `Promise<StartGameResult>`.

**`any` usage:**
- `catch (error: any)` used in all four server actions — the standard pattern for untyped catch blocks.
- `useState<any>(null)` used for the Supabase user object in `app/page.tsx` (line 24) — a known weak spot.

**Type assertions:** `as string` used when reading `FormData` values (unavoidable with the FormData API).

**Generics:** Minimal — only used where React or Prisma APIs require them (e.g., `useState<"idle" | "loading" | "success" | "error">`).

## Component / Function Patterns

**Directive placement:** `"use client"` and `"use server"` directives always appear as the first line of a file, before any imports. All components in `components/` use `"use client"`. All actions in `app/actions/` use `"use server"`.

**Component structure order:**
1. Directive (`"use client"`)
2. React/library imports
3. Local action/component imports
4. Module-level constants (e.g., `CLASSES`, `INITIAL_STATS`)
5. Interface declarations (`interface Props`, `interface Character`)
6. Default exported function component

**Component exports:** All components use `export default function ComponentName`. No named component exports.

**Props pattern:**
```ts
interface Props {
  onCharacterCreated: () => void;
}
export default function CharacterForm({ onCharacterCreated }: Props) { ... }
```

**State management:** Local `useState` hooks only — no global state library. Parent (`app/page.tsx`) owns shared state and passes callbacks down to children.

**Data lifting pattern:** Parent fetches data (`loadCharacters`) and passes it down as props. Children call parent callbacks on mutations (`onCharacterCreated`). Components do not fetch their own data.

**`useCallback`:** Used when a stable function reference is needed as a prop dependency:
```ts
const loadCharacters = useCallback(async () => { ... }, []);
```

**`useEffect` pattern:** Effects are named inner `async function`s called immediately (not inline async arrow functions):
```ts
useEffect(() => {
  async function handleAuthLifecycle() { ... }
  handleAuthLifecycle();
  return () => { subscription.unsubscribe(); };
}, []);
```

**Module-level constants:** Uppercase snake_case for static data:
```ts
const CLASSES = ["Fighter", "Wizard", "Rogue", "Cleric"];
const INITIAL_STATS = { strength: 8, ... };
```

**Server actions:** Thin async functions that: (1) authenticate the user, (2) validate input, (3) run the DB operation in a try/catch, (4) return a typed result object `{ success, error?, data? }`.

## Error Handling

**Server action pattern:** All four actions use the same structure:
```ts
try {
  // DB operation
  return { success: true, data: result };
} catch (error: any) {
  console.error("Context message:", error);
  return { success: false, error: error.message || "Fallback message." };
}
```

**Client-side error display:** Status state machine drives UI feedback:
```ts
const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
const [errorMessage, setErrorMessage] = useState("");
```
Error messages render as inline `<p>` elements with Tailwind utility classes (`text-red-600 bg-red-50`).

**Auth guard pattern:** Every authenticated server action starts with:
```ts
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { success: false, error: "Not authenticated." };
```

**`console.error`:** Used in all catch blocks to log DB errors server-side. No structured logging library.

**Early returns on validation failure:** Guards return immediately instead of nesting:
```ts
if (!name || name.trim().length === 0) {
  return { success: false, error: "Character name cannot be blank." };
}
```

**Cookie write failures:** Silently swallowed in `lib/supabase-server.ts` with a `try/catch` no-op — intentional behavior for server components that can't write cookies.

## Utilities

**`lib/prisma.ts`:**
- Exports a singleton `prisma` client using the `globalThis` pattern to prevent hot-reload connection leaks in development.
- Uses `PrismaNeon` adapter (not the standard `Pool`) — required for Prisma 7 + Neon serverless.
- Named export `prisma` and default export `prisma` both provided.

**`lib/supabase-client.ts`:**
- Single named export `supabaseBrowser` — a browser-side Supabase client for React components.
- Used only in `app/page.tsx` for auth state lifecycle.

**`lib/supabase-server.ts`:**
- Factory function `createSupabaseServerClient()` — creates a per-request server-side Supabase client.
- Used by all server actions that require auth: `create-character.ts`, `get-characters.ts`, `start-game.ts`.

**No shared utility functions** beyond the lib clients. Game logic helpers (e.g., `getStatCost`) are defined inline within the component that uses them.

## Naming Patterns

**Files:** kebab-case for all files: `character-form.tsx`, `create-character.ts`, `supabase-server.ts`.

**Components:** PascalCase: `CharacterForm`, `CharacterList`, `LoginScreen`.

**Functions:** camelCase: `handleSubmit`, `handleStatChange`, `loadCharacters`, `createCharacter`.

**Variables:** camelCase for local vars; UPPER_SNAKE_CASE for module-level constants.

**Database fields:** camelCase in Prisma schema and TS code (`characterClass`, `userId`). Prisma maps to snake_case in PostgreSQL automatically.

**Prisma models:** PascalCase singular: `User`, `Character`, `Game`, `Message`, `Map`, `StoryPrompt`.

## Import Organization

No enforced import order. Observed pattern:
1. Framework/library imports (`next/cache`, `react`)
2. Internal lib imports (`../../lib/prisma`)
3. Internal component/action imports

The `@/` alias is used inconsistently — `character-form.tsx` uses `@/app/actions/create-character`, while `app/page.tsx` uses relative `../lib/supabase-client`.

---

*Convention analysis: 2026-05-20*
