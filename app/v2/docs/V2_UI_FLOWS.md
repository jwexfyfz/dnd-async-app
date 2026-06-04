# V2 UI Flows

---

## Setup Flow (`/setup`)

3-step HTML page (Supabase CDN SDK, vanilla JS):

- **Step 1:** Google OAuth via Supabase. Redirect URL must be `http://localhost:3001/setup` — add to Supabase Dashboard → Auth → URL Config → Redirect URLs.
- **Step 2:** Select existing character or create new one (point-buy stat system, skill picker).
- **Step 3:** Session picker — shows existing sessions for the character with "Continue" cards, plus "Start New Session" that expands a room template picker.
  - On continue: navigates to `/play?room=<roomInstanceId>&char=<characterId>`
  - On new session: `POST /api/sessions` → navigates to `/play?room=<roomInstanceId>&char=<characterId>`

---

## Play Page (`/play`)

Reads `?room=` and `?char=` from URL query params on load; redirects to `/setup` if either is missing.

**On load:**
- `GET /api/room/history` — pre-populates chat with all prior player actions and DM narratives
- `GET /api/room/state` — pre-populates the tactical sidebar with character positions and POI states

**On action:**
- Sends `POST /api/game/action`
- Renders the last DM narrative entry as the new chat bubble
- Re-renders the sidebar from the Stage 5 response

"Switch session" link → `/setup`

---

## Tactical Sidebar

POI cards show:
- Character chips for anyone currently at that POI (with stance tag if set)
- Green "examined" badge if `poiStates[id].examined === true`
- Purple "interacted" badge if `poiStates[id].interacted === true`

Data source: `uiLayoutAnchors` + `poiStates` from Stage 5 response (or `GET /api/room/state` on initial load). See [V2_MAP.md](./V2_MAP.md) for layout details.

---

## Auth Pattern

Server-side token verification is a plain `fetch` to the Supabase REST API — no SDK needed:

```
GET ${SUPABASE_URL}/auth/v1/user
Headers: { Authorization: Bearer <token>, apikey: <anon_key> }
```

Used in `requireAuth` middleware (`src/middleware/requireAuth.ts`). Result attached as `req.supabaseUser`.

---

## Known Gap

**Sidebar state after room transition** — When `move_to_room` fires, the response returns the new room's state correctly, but the sidebar does not re-run `loadState()` for the new room on its own. It relies on the Stage 5 response, which covers character positions but not a fresh `GET /api/room/state` call for the new room's POI states.
