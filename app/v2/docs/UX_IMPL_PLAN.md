# UX Implementation Plan — Delve Rebrand + Setup Flow

Source: `UX_AUDIT.md`  
Files touched: `app/v2/setup/page.tsx`, `app/v2/play/page.tsx` (header only), `app/page.tsx` (title), `app/layout.tsx` (title/meta)  
New files: `lib/v2/relative-time.ts`, `lib/v2/__tests__/relative-time.test.ts`  
Test runner: Vitest (`npm test`)

---

## Wave 1 — App rename to Delve

**Goal**: Replace every user-visible instance of "D&D Async" with "Delve". Update page metadata.

### Tasks

**1a. Global string replacements**

Files to update:
- `app/layout.tsx` — `<title>` and any `<meta name="description">`
- `app/page.tsx` — any heading text
- `app/v2/setup/page.tsx` — `"D&D Async"` on line 203
- `app/v2/play/page.tsx` — `"D&D Async"` on line 741

Change `"D&D Async"` → `"Delve"` in each. Do not touch comments or variable names.

**1b. Login screen — full start screen redesign**

Target: `app/v2/setup/page.tsx` lines 200–211, `step === 'login'` branch.

Replace the current JSX with:

```tsx
<div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
  <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 space-y-6">
    {/* Identity */}
    <div className="text-center space-y-1">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">⚔️ Delve</h1>
      <p className="text-sm text-slate-500">Explore when you can.</p>
    </div>

    {/* Pitch */}
    <p className="text-sm text-slate-600 leading-relaxed text-center">
      Play D&D with friends — or solo — without scheduling a session.
      Take your turn whenever you have five minutes.
    </p>

    {/* Google sign-in — use V1 button style */}
    <div className="space-y-3">
      <button
        onClick={handleLogin}
        disabled={loginLoading}
        className="w-full h-11 px-4 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
      >
        {/* Multi-color Google G SVG — copied from components/login-screen.tsx */}
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
          <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.96 1 12 1 7.35 1 3.4 3.65 1.51 7.5l3.86 3C6.28 7.55 8.91 5.04 12 5.04z"/>
          <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.43h6.44c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.98 3.39-4.89 3.39-8.48z"/>
          <path fill="#FBBC05" d="M5.37 14.77c-.24-.72-.37-1.49-.37-2.27s.13-1.55.37-2.27l-3.86-3C.68 8.78 0 10.31 0 12s.68 3.22 1.51 4.77l3.86-3z"/>
          <path fill="#34A853" d="M12 23c3.24 0 5.97-1.08 7.96-2.91l-3.66-2.84c-1.01.68-2.31 1.09-4.3 1.09-3.09 0-5.72-2.51-6.65-5.46L1.49 15.8C3.38 19.65 7.33 23 12 23z"/>
        </svg>
        <span>{loginLoading ? 'Signing in…' : 'Sign in with Google'}</span>
      </button>
      {loginError && (
        <p className="text-xs text-red-500 text-center">{loginError}</p>
      )}
    </div>

    <p className="text-xs text-slate-400 text-center">
      New here? Pick a character and start a dungeon in under 2 minutes.
    </p>
  </div>
</div>
```

Add two state variables at the top of `SetupPage`:
```ts
const [loginLoading, setLoginLoading] = useState(false);
const [loginError,   setLoginError]   = useState('');
```

Update `handleLogin`:
```ts
const handleLogin = async () => {
  setLoginLoading(true);
  setLoginError('');
  try {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/v2/setup` },
    });
  } catch {
    setLoginError('Sign-in failed — please try again.');
    setLoginLoading(false);
  }
};
```

Note: `signInWithOAuth` navigates away on success so `setLoginLoading(false)` is only reached on error.

**Tests**: No unit test needed — this is pure UI state. Manual verification: confirm the error state renders when `handleLogin` throws.

---

## Wave 2 — Character list improvements

**Goal**: Visual hierarchy on character buttons, dashed "New Character" card, improved empty state.

### Tasks

**2a. Class emoji + visual hierarchy** (audit 2.1)

In the `step === 'character'` character map (lines 224–231), replace the current button content:

```tsx
// Before
<span className="font-medium text-slate-800">{c.name}</span>
<span className="text-sm text-slate-500">{c.characterClass} · Level {c.level} · HP {c.currentHp}/{c.maxHp}</span>

// After
<div className="flex items-center gap-2">
  <span className="text-xl">{classEmoji(c.characterClass)}</span>
  <div>
    <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
    <p className="text-xs text-slate-400">{c.characterClass} · Level {c.level} · HP {c.currentHp}/{c.maxHp}</p>
  </div>
</div>
<span className="text-slate-300 text-sm">→</span>
```

Add import at the top of `app/v2/setup/page.tsx`:
```ts
import { classEmoji } from '@/lib/class-emoji';
```

**2b. "New Character" dashed card** (audit 2.2)

Replace the `<button onClick={() => setShowNewChar(v => !v)}>` text link with:

```tsx
<button
  onClick={() => setShowCharModal(true)}
  className="w-full text-left p-4 border-2 border-dashed border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50 flex items-center gap-3 text-slate-400 hover:text-slate-600 transition-all"
>
  <span className="text-2xl font-light">+</span>
  <span className="text-sm font-medium">New Character</span>
</button>
```

The `showNewChar` inline form is removed in Wave 3 when the modal is added.

**2c. Empty state** (audit 2.3)

Add above the character map:

```tsx
{characters.length === 0 && (
  <div className="text-center py-10 space-y-3">
    <p className="text-slate-500 font-medium">No heroes yet.</p>
    <p className="text-sm text-slate-400">Create your first character to begin your adventure.</p>
    <button
      onClick={() => setShowCharModal(true)}
      className="mt-2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
    >
      Create Character
    </button>
  </div>
)}
```

**Tests**: No logic to unit test in this wave. All changes are presentational.

---

## Wave 3 — Character creation modal

**Goal**: Move character creation out of the inline toggle into a modal. Adopt V1 point-buy. Fix skill label and disabled-state hint.

### Tasks

**3a. Add modal state variable**

```ts
const [showCharModal, setShowCharModal] = useState(false);
```

Remove `showNewChar` state entirely.

**3b. Modal overlay**

Add at the bottom of `SetupPage`'s JSX (before the closing fragment), rendered whenever `step !== 'loading'` so it can appear from any step:

```tsx
{showCharModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">New Character</h2>
        <button
          onClick={() => setShowCharModal(false)}
          className="text-slate-400 hover:text-slate-600 text-xl leading-none"
        >
          ✕
        </button>
      </div>
      {/* Character creation form — see 3c */}
      <CharCreationForm
        onCreated={async () => {
          await loadCharacters();
          setShowCharModal(false);
        }}
      />
    </div>
  </div>
)}
```

**3c. Extract `CharCreationForm` as a local component in setup/page.tsx**

This replaces the inline form that lived under `showNewChar`. The component implements D&D 5e point-buy matching V1's `CharacterForm` logic, but submits to `/api/v2/me/characters`.

Key behaviors copied from `components/character-form.tsx`:
- Stats start at 8, not 10
- 27-point budget
- Incrementing above 13 costs 2 points; decrementing from 15/14 refunds 2
- Max stat value 15, min 8
- `pointsLeft` counter displayed

Skill label (audit 2.5): Use dynamic label based on selection count:
```ts
const remaining = SKILL_COUNT[charClass] - skills.length;
const skillLabel = skills.length === 0
  ? `Choose your skills — pick ${SKILL_COUNT[charClass]}`
  : remaining > 0
    ? `Skills: ${skills.length} / ${SKILL_COUNT[charClass]} chosen — pick ${remaining} more`
    : `Skills: ${SKILL_COUNT[charClass]} / ${SKILL_COUNT[charClass]} chosen ✓`;
```

Disabled button hint (audit 2.6): Below the skills section, when `skills.length < SKILL_COUNT[charClass]` and `skills.length > 0`:
```tsx
{skills.length > 0 && skills.length < (SKILL_COUNT[charClass] ?? 2) && (
  <p className="text-xs text-amber-600">
    Choose {(SKILL_COUNT[charClass] ?? 2) - skills.length} more skill{...} to continue.
  </p>
)}
```

Submit handler calls `POST /api/v2/me/characters` (same endpoint as the old inline form).

**Tests**: The point-buy cost logic is pure and worth testing. Add `lib/v2/__tests__/point-buy.test.ts`:

```ts
// Tests for the stat cost/refund functions used in CharCreationForm
import { describe, it, expect } from 'vitest';
import { getStatCost } from '../point-buy'; // extract into lib/v2/point-buy.ts
```

Extract `getStatCost(currentValue, isIncrementing)` from `components/character-form.tsx` into `lib/v2/point-buy.ts` and import it in both `CharacterForm` and `CharCreationForm`.

Test cases:
- `getStatCost(8, true)` → 1
- `getStatCost(13, true)` → 2 (crossing into elite tier)
- `getStatCost(12, true)` → 1
- `getStatCost(15, false)` → 2 (refund from elite)
- `getStatCost(13, false)` → 1
- `getStatCost(8, false)` → 1

---

## Wave 4 — Session screen improvements

**Goal**: Replace `confirm()`, upgrade CTAs, add HP and timestamps, remove dungeon toggle.

### Tasks

**4a. Inline session delete confirmation** (audit 3.1)

Add state:
```ts
const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
```

In the session list, replace the `onClick={() => handleDeleteSession(s)}` ✕ button with:
```ts
onClick={() => setPendingDeleteId(s.sessionId)}
```

Render each session row conditionally:
```tsx
{s.sessionId === pendingDeleteId ? (
  <div className="flex items-center justify-between p-4 border border-amber-200 bg-amber-50 rounded-lg">
    <p className="text-sm text-slate-700">
      Abandon <span className="font-semibold">{s.dungeonName}</span>?
    </p>
    <div className="flex gap-2">
      <button
        onClick={() => setPendingDeleteId(null)}
        className="text-sm px-3 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
      >
        Keep it
      </button>
      <button
        onClick={() => { handleDeleteSession(s); setPendingDeleteId(null); }}
        className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
      >
        Abandon
      </button>
    </div>
  </div>
) : (
  /* existing session row JSX */
)}
```

Remove `window.confirm(...)` from `handleDeleteSession`.

**4b. "Begin →" button upgrade** (audit 3.2)

Replace:
```tsx
<button className="text-sm font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
  Begin →
</button>
```

With:
```tsx
<button className="text-sm font-medium px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
  Begin
</button>
```

**4c. Remove `showNewSession` toggle — always show dungeons** (audit 3.3, 3.6)

Delete `showNewSession` state and the `<button onClick={() => setShowNewSession(...)}` toggle. Render dungeon cards unconditionally below the sessions list, wrapped in a `<div className="space-y-3">` with the section label `"Begin New Adventure"`.

When `sessions.length === 0`, render the dungeon section first with no "Continue Adventure" header.

**4d. Character HP in session header** (audit 3.4)

Change:
```tsx
<p className="text-sm text-slate-500 mb-6">{selectedChar?.characterClass} · Level {selectedChar?.level}</p>
```

To:
```tsx
<p className="text-sm text-slate-500 mb-6">
  {selectedChar?.characterClass} · Level {selectedChar?.level}
  {selectedChar && (
    <span className={selectedChar.currentHp / selectedChar.maxHp < 0.5 ? ' · ' : ' · '}>
      <span className={selectedChar.currentHp / selectedChar.maxHp < 0.5 ? 'text-red-500 font-medium' : ''}>
        HP {selectedChar.currentHp}/{selectedChar.maxHp}
      </span>
    </span>
  )}
</p>
```

**4e. Relative timestamp on session cards** (audit 3.5)

Create `lib/v2/relative-time.ts`:
```ts
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}
```

Import and use in the session card:
```tsx
<p className="text-xs text-slate-400 mt-0.5">{relativeTime(s.lastActiveAt)}</p>
```

Place beneath the room name / objective line.

**Tests** — `lib/v2/__tests__/relative-time.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { relativeTime } from '../relative-time';

function iso(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

describe('relativeTime', () => {
  it('returns "Today" for timestamps within the last 24h', () => {
    expect(relativeTime(iso(0))).toBe('Today');
  });
  it('returns "Yesterday" for ~1 day ago', () => {
    expect(relativeTime(iso(1))).toBe('Yesterday');
  });
  it('returns "N days ago" for 2–6 days', () => {
    expect(relativeTime(iso(3))).toBe('3 days ago');
    expect(relativeTime(iso(6))).toBe('6 days ago');
  });
  it('returns "1 week ago" for 7–13 days', () => {
    expect(relativeTime(iso(7))).toBe('1 week ago');
  });
  it('returns "N weeks ago" for 2–4 weeks', () => {
    expect(relativeTime(iso(14))).toBe('2 weeks ago');
  });
  it('returns "N months ago" for 30+ days', () => {
    expect(relativeTime(iso(30))).toBe('1 month ago');
    expect(relativeTime(iso(60))).toBe('2 months ago');
  });
});
```

---

## Wave 5 — URL-based step state

**Goal**: Browser back from session selection returns to character list instead of leaving the app.

### Tasks

**5a. Wrap the page in `<Suspense>` and read `searchParams`**

`app/v2/setup/page.tsx` uses `createBrowserClient` and runs client-side, so use `useSearchParams` from `next/navigation`.

At the top of `SetupPage`:
```ts
import { useSearchParams, useRouter } from 'next/navigation';
const searchParams = useSearchParams();
const router = useRouter();
```

Wrap the export in `<Suspense>` the same way `app/v2/play/page.tsx` does (see lines 813–818 there as the pattern).

**5b. Push URL when entering session step**

In `handleSelectChar`:
```ts
router.push(`/v2/setup?char=${char.id}`);
```

**5c. Read URL on mount to restore step**

In the auth `useEffect`, after `setStep('character')` and `loadCharacters()`, add:
```ts
const charId = searchParams.get('char');
if (charId) {
  // will be resolved once characters load — handled in a separate effect
}
```

Add a separate effect that watches `characters` and `searchParams`:
```ts
useEffect(() => {
  const charId = searchParams.get('char');
  if (!charId || characters.length === 0) return;
  const match = characters.find(c => c.id === charId);
  if (match) {
    setSelectedChar(match);
    setStep('session');
    loadSessions(match.id);
  }
}, [characters, searchParams]);
```

**5d. Back button uses router.back()**

Change:
```tsx
<button onClick={() => setStep('character')}>← Back</button>
```

To:
```tsx
<button onClick={() => router.back()}>← Back</button>
```

**Tests**: No pure logic to unit test. URL state is exercised by the existing Next.js routing.

---

## Wave 6 — Play screen header (minimal, non-combat)

**Goal**: Replace "Delve" generic header with character/room context. Excluded from combat redesign scope since it's a one-line change.

**File**: `app/v2/play/page.tsx` line 741

Change:
```tsx
<h1 className="font-semibold text-slate-800">D&amp;D Async</h1>
```

To use `roomName` (already in state):
```tsx
<h1 className="font-semibold text-slate-800 truncate max-w-[60vw]">
  {roomName || 'Delve'}
</h1>
```

This is a one-line edit and does not touch anything the combat redesign will change.

---

## Execution order

Run waves in sequence. Each wave should be a separate commit.

```
Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 → Wave 6
```

Waves 2 and 3 are tightly coupled (both touch character creation), so commit them together if it simplifies the diff.

## Test commands

```bash
npm test -- lib/v2/__tests__/relative-time.test.ts   # after Wave 4e
npm test -- lib/v2/__tests__/point-buy.test.ts        # after Wave 3c
npm test                                               # full suite before final commit
```

## New files summary

| File | Purpose |
|------|---------|
| `lib/v2/relative-time.ts` | Converts ISO timestamp to human string |
| `lib/v2/__tests__/relative-time.test.ts` | Unit tests for relativeTime |
| `lib/v2/point-buy.ts` | Extracted stat cost/refund logic |
| `lib/v2/__tests__/point-buy.test.ts` | Unit tests for point-buy math |
