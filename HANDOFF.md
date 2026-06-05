# Handoff: Fix MessageLog_roomInstanceId_fkey FK violation

## Root cause

`generateAndPersistNarrative` in `lib/v2/game-controller.ts` is called with a newly-created
room's ID after a `move_to_room` action. With Neon's HTTP connection pool, the room created
inside the `handleMoveToRoom` transaction can be invisible on a different pooled connection,
causing the final `messageLog.create` to FK-violate on `MessageLog_roomInstanceId_fkey`.

## State right now

The return type of `generateAndPersistNarrative` was already changed from `Promise<void>` to
`Promise<string>` at ~line 2120 of `lib/v2/game-controller.ts`. Nothing else has been touched.
The build is currently broken because the function still returns `void` implicitly — fix that as
part of the changes below.

---

## Changes needed

### 1. `lib/v2/game-controller.ts` — body of `generateAndPersistNarrative` (~line 2222)

The current ending of the function looks like this:

```typescript
  const narrativeText = textBlock?.text ?? '[No narrative generated]';
  console.log('[narrative] generated:', narrativeText);

  await prisma.messageLog.create({
    data: {
      roomInstanceId,
      characterId,
      isMechanicalEvent: false,
      text: narrativeText,
    },
  });
}
```

Replace it with:

```typescript
  const narrativeText = textBlock?.text ?? '[No narrative generated]';
  console.log('[narrative] generated:', narrativeText);

  let persisted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.messageLog.create({
        data: { roomInstanceId, characterId, isMechanicalEvent: false, text: narrativeText },
      });
      persisted = true;
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && msg.includes('Foreign key constraint')) {
        console.warn('[narrative] FK violation on first attempt — retrying after 200ms');
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      console.error('[narrative] messageLog.create failed:', msg);
      break;
    }
  }

  return { text: narrativeText, persisted };
}
```

Also update the function signature return type (already partially done):

```typescript
): Promise<{ text: string; persisted: boolean }> {
```

---

### 2. `lib/v2/game-controller.ts` — `buildViewState` signature (~line 2234)

Add an optional `fallbackNarrative` parameter:

```typescript
async function buildViewState(
  roomInstanceId: string,
  gameState: string,
  characterId: string,
  sessionId: string,
  characterProximityTargetId: string | null,
  fallbackNarrative?: string,
): Promise<ViewStatePayload> {
```

---

### 3. `lib/v2/game-controller.ts` — `buildViewState` return statement (~line 2378)

Current:

```typescript
  return {
    roomInstanceId,
    currentNarrative: recentNarrative.reverse(),
    ...
  };
```

Replace with:

```typescript
  const orderedNarrative = recentNarrative.reverse();
  if (fallbackNarrative && !orderedNarrative.some(n => n.text === fallbackNarrative)) {
    orderedNarrative.push({
      id: 'injected-current',
      text: fallbackNarrative,
      isMechanicalEvent: false,
      mechanicalSummary: null,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    roomInstanceId,
    currentNarrative: orderedNarrative,
    ...
  };
```

---

### 4. `lib/v2/game-controller.ts` — call site of `generateAndPersistNarrative` (~line 2791)

Current:

```typescript
    await generateAndPersistNarrative(
      activeRoomInstanceId,
      characterId,
      character.name,
      activeRoomName,
      activeRoomDescription,
      appliedActions,
      roomInstance.session.id,
    );

    const viewState = await buildViewState(
      activeRoomInstanceId,
      activeGameState,
      characterId,
      roomInstance.session.id,
      activeCharacterProximityTargetId,
    );
```

Replace with:

```typescript
    const { text: currentNarrativeText, persisted: narrativePersisted } =
      await generateAndPersistNarrative(
        activeRoomInstanceId,
        characterId,
        character.name,
        activeRoomName,
        activeRoomDescription,
        appliedActions,
        roomInstance.session.id,
      );

    const viewState = await buildViewState(
      activeRoomInstanceId,
      activeGameState,
      characterId,
      roomInstance.session.id,
      activeCharacterProximityTargetId,
      narrativePersisted ? undefined : currentNarrativeText,
    );
```

---

### 5. Check `types/v2-game.ts` — `currentNarrative` item shape

The injected fallback object uses `{ id, text, isMechanicalEvent, mechanicalSummary, createdAt }`.
Verify that `ViewStatePayload.currentNarrative` is typed to accept these fields (it probably already
does since `buildViewState` reads the same shape from `messageLog.findMany`). If `createdAt` is
typed as `Date` instead of `string`, either cast it or change the injected object accordingly.

---

### 6. Run build

```bash
npm run build
```

Should be clean. If there are type errors on the injected object shape, align the fields with
whatever `ViewStatePayload['currentNarrative'][number]` expects.

---

## Other completed work this session (already merged, no action needed)

- `prisma/seed.mjs` — `iron_key` gets `use_effect: "unlock"` + `consumable: true`
- `prisma/seed.mjs` — `character.deleteMany()` and `user.deleteMany()` removed; test user/char
  switched to upserts with stable IDs so re-seeding preserves v2 characters
- `lib/v2/game-controller.ts` — `interact` on a lockable container auto-reveals hidden items
  that have no `reveal_check` (chest contents become visible on open)
- `lib/v2/game-controller.ts` — `use_item` unlock on an exit POI also sets `interacted: true`
  (doors auto-open when keyed, revealing adjacent room on map)
- `app/api/v2/map/route.ts` — returns only current room + Manhattan-distance-1 neighbors
  (no more rooms 2–3 hops away cluttering the map)
- `app/api/v2/dungeons/route.ts` — filters out `DungeonTemplate` rows with no
  `startRoomTemplateId` so incomplete dungeon cards never appear in setup
- `app/v2/play/page.tsx` — map legend updated: ▮ = locked door, ▯ = open door, gap = archway
