# V2 Story System — Manual Test Guide

Tests for items 1–6 implemented in the story mechanics pass (June 2026).
Run these after seeding the DB and starting the dev server.

---

## Setup

```bash
npx prisma db seed
npm run dev
```

Create a session at `/v2/setup`, start game, navigate to `/v2/play`.

To fast-forward act state without playing through, run against your dev DB:
```sql
UPDATE "GameSession"
SET "storyFlags" = '{"commander_note_read": true, "current_act": 2}'
WHERE id = '<your-session-id>';
```

---

## Item 1 — Story flags written on pick_up

**What to do:** Pick up any item that has a `story_flag` in its seed definition.

**Test A — Waterlogged Journal (Flooded Passage → Stagnant Pool)**
1. Go to Flooded Passage, examine the pool, search or reveal the journal
2. Pick it up: `"I take the waterlogged journal"`
3. **Expected log:** `[story] flags written to session <id>: { merchant_notes: true }`

**Test B — Commander's Note (Armory → Locked Chest)**
1. Find iron_key in Flooded Passage (Collapsed Pillar, hidden, perception DC 12)
2. Use iron key on the Locked Chest: `"I use the iron key on the chest"`
3. Pick up Commander's Note: `"I take the commander's note"`
4. **Expected log:** `[story] flags written to session <id>: { commander_note_read: true }`
5. **Expected follow-on:** act 1 completes (see Item 4)

---

## Item 2 — storyFlags appear in DM narrative prompt

**What to verify:** After any flag is set, the DM prompt includes it under `STORY FLAGS`.

Add this temporary log to `generateAndPersistNarrative` in `lib/v2/game-controller.ts`
before the `anthropic.messages.create` call:
```ts
console.log('[narrative] story flags:', JSON.stringify(storyFlags));
```

**Expected output after picking up Commander's Note:**
```
[narrative] story flags: {"merchant_notes":true,"commander_note_read":true,"current_act":2}
```

The DM narrative on subsequent turns should reference known facts (e.g. Vorne identity, ritual purpose)
without you re-explaining them.

---

## Item 3 — NPC interact_options

### 3A — Rouse the guard Beren (Guard Post, needs act 2 access)

1. Navigate to Guard Post (north through Submerged Gate after act 2 starts)
2. Approach the Slumped Guard: `"I go to the slumped guard"`
3. Attempt to rouse him: `"I try to wake the guard"` or `"I check on him"`
4. **Expected log (success, Medicine DC 12):**
   ```
   🎲 medicine check: <roll>+<mod>=<total> vs DC 12 — success
   [story] flags written ...: { vorne_key_found: true }
   ```
5. **Expected log (failure):**
   ```
   🎲 medicine check: <roll>+<mod>=<total> vs DC 12 — failure
   ```
6. **Expected DM narrative:** Uses the success/failure text from the seed NPC definition,
   not a generic "interacted with Slumped Guard" line.

### 3B — Free Mira (Ritual Chamber, requires iron_key in inventory)

1. Carry the iron_key from the Flooded Passage Collapsed Pillar
2. Navigate to Ritual Chamber, approach the Prisoner Cage
3. `"I open the cage"` or `"I free the prisoner"`
4. **Expected log:**
   ```
   [story] flags written ...: { mira_freed: true }
   ```
5. **Expected DM narrative:** Mira drops from the cage and introduces herself.
   The text matches the `success` string in the seed's `interact_options`.

### 3C — Free Maren Ashwick (Sealed Vault, requires vorne_key)

1. Have vorne_key (looted from Beren or Guard's Table)
2. Navigate to Sealed Vault, approach Chained Merchant
3. `"I unlock her chains"` or `"I free her"`
4. **Expected log:** `{ maren_rescued: true }`
5. **Expected DM narrative:** Maren introduces herself and offers to guide the binding ritual.

### 3D — Disrupt the Ritual Circle (Ritual Chamber)

1. Approach the Ritual Circle
2. `"I slash through the markings"` or `"I disrupt the circle"` or `"I destroy the ritual"` 
3. Arcana check DC 13. **Expected log (success):**
   ```
   🎲 arcana check: <roll>+<mod>=<total> vs DC 13 — success
   [story] flags written ...: { ritual_disrupted: true }
   ```
4. **Expected follow-on:** act 2 completes (see Item 4)
5. **Expected DM narrative:** Uses the disrupt `narrative` text from seed (the circle goes dark).

---

## Item 4 — Act completion detection and currentObjective update

### Act 1 → Act 2 (triggered by `commander_note_read`)

After picking up Commander's Note (Test 1B above):

**Expected server logs:**
```
[act] act 1 complete → advancing to act 2
[act] mutation applied to poi instance <id>: { unlocked: true }
```

**Expected state change:**
- `GameSession.currentObjective` → `"Descend deeper — something stirs below the flooded passage"`
- `storyFlags.current_act` → `2`
- Verify in UI: the objective line in `/v2/play` should update immediately on that turn's response

### Act 2 → Act 3 (triggered by `ritual_disrupted` OR `harwick_defeated`)

After disrupting the Ritual Circle (Test 3D above):

**Expected server logs:**
```
[act] act 2 complete → advancing to act 3
[act] mutation applied to poi instance <id>: { visibility_override: 'always' }
```

**Expected state change:**
- `GameSession.currentObjective` → `"Find the Sealed Vault and deal with what is bound there"`
- `storyFlags.current_act` → `3`

---

## Item 5 — onStartMutations applied on act start

### Act 1→2 mutation: Submerged Gate North unlocks

1. Complete act 1 (pick up Commander's Note)
2. Return to or enter Flooded Passage
3. The Submerged Gate North (slot N) should now appear in the POI list as **UNLOCKED**
4. `"I go through the submerged gate"` should succeed without a key
5. **Verify:** `currentProperties.unlocked === true` on that POI instance in DB

If the gate still shows LOCKED, the mutation didn't find the POI instance (room not yet
instantiated when act advanced). Fast-path fix: visit Flooded Passage before picking up
Commander's Note, then pick it up.

### Act 2→3 mutation: Hidden Door East permanently revealed

1. Complete act 2 (disrupt circle or defeat Harwick)
2. Enter the Ritual Chamber
3. The Hidden Door East should appear in the POI list even from the doorway
   (before this, it only appeared when you were physically adjacent to the east wall)
4. `"I go through the hidden door"` should navigate to the Sealed Vault

---

## Item 6 — proximity_only reveal on approach

**What to test:** Hidden Door East in Ritual Chamber is `proximity_only` during Act 2.
Approaching an adjacent grid slot reveals it; approaching a far slot does not.

**Grid layout for Ritual Chamber:**

```
NW      N(Altar)    NE(Harwick)
W       C(OpenSp)   E ← Hidden Door (proximity_only)
SW      S(Iron Dr)  SE
```

**Test A — reveal from adjacent slot (should work)**
1. Be in Act 2, enter Ritual Chamber, do NOT approach east wall first
2. `"I approach the stone altar"` (slot N — adjacent to E, distance 1)
3. **Expected log:**
   ```
   [proximity] revealed "<poi-id>" (slot E) — approached from slot N
   ```
4. Hidden Door East should now appear in the POI list in the response

**Test B — reveal from adjacent slot (NE, Harwick's position)**
1. `"I approach Harwick"` (slot NE — adjacent to E, distance 1)
2. Same expected log and reveal

**Test C — no reveal from far slot**
1. `"I approach the iron door south"` (slot S — distance 2 from E)
2. **Expected:** no `[proximity] revealed` log for the hidden door
3. Hidden Door should NOT appear in POI list

**Test D — after act 3 mutation, door always visible**
1. Complete Act 2, enter Ritual Chamber
2. Without approaching the east wall, the door should already be in the POI list
3. No proximity reveal needed — `visibility_override: 'always'` set by `onStartMutations`

---

## Quick DB inspection queries

```sql
-- Check session story flags and act state
SELECT id, "currentObjective", "storyFlags"
FROM "GameSession" ORDER BY "createdAt" DESC LIMIT 1;

-- Check if Submerged Gate is unlocked
SELECT pi.id, pi."currentProperties"
FROM "PoiInstance" pi
JOIN "PoiTemplate" pt ON pi."poiTemplateId" = pt.id
WHERE pt.id = '77000001-0000-0000-0000-000000000001';

-- Check if Hidden Door has visibility_override
SELECT pi.id, pi."currentProperties"
FROM "PoiInstance" pi
JOIN "PoiTemplate" pt ON pi."poiTemplateId" = pt.id
WHERE pt.id = 'b2000006-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
```
