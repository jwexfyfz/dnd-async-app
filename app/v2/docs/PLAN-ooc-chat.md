# Out-of-Character (OOC) Party Chat

## Context

Players need a way to talk to each other outside the narrative — logistics, jokes, "can you play tonight" — without it polluting the in-character story log. The first idea was "just use your D&D Discord server," but that means leaving the app entirely to say something small, which breaks immersion and makes the game feel less fun to play. Decision: embed chat directly in the app instead, via **Stream Chat** (getstream.io) — a hosted chat API with a full React component library, so we're not building message storage/realtime/read-receipts ourselves.

Stream's free "Build" tier (checked live, Aug 2026): **1,000 MAU, 100 concurrent connections, 1M API calls/month, full base feature set, no credit card required.** Comfortably covers a friend-group app. One caveat: some third-party sources describe Build as intended for dev/prototype rather than long-running production use — worth a direct check against Stream's current ToS before relying on it indefinitely, though the limits themselves aren't the constraint.

Important scope note: **Stream's React SDK is a component library (message list, input, threads, reactions, etc.) — it does not ship a prebuilt floating-launcher-button-with-overlay widget.** That part (the actual UX ask here) is a thin custom shell we build ourselves, wrapping Stream's `Chat`/`Channel`/`MessageList`/`MessageInput` components inside a floating panel.

## UX shape (what's being mocked)

- A small floating round button, visible throughout active play — not a route change, not a new page. **Fixed, not draggable** (see Positioning below for why).
- Click opens an overlay panel layered on top of the current game screen. The game underneath is untouched — no navigation, no lost scroll position, no interrupted turn.
- Panel is trivially dismissible: explicit **×**, click-outside, and **Esc**.
- An unread badge on the button itself (from Stream's channel unread state) so players notice new messages without the panel being open.
- Visually distinct from the in-character narrative log — and **distinctly labeled**: `BottomNav` (`components/v2/layout/Header.tsx`) already has a tab literally called **"Chat"** (the in-character log). This feature is never called just "Chat" anywhere in its UI — button label/tooltip/aria-label, panel header, and any onboarding copy all say **"Party Chat"**, so it's never confused with the existing tab.

## Positioning & layout (fixes a real collision, not a hypothetical)

`app/v2/play/page.tsx` already has: `BottomNav`, an in-flow 5-tab bar (Chat/Bag/Party/Map/Guardian) sitting at the bottom of the screen, plus several `fixed inset-0 z-50` full-screen modals (combat roll sheets, damage sheets, the death-save overlay). A naive `fixed bottom-4 right-4` button would sit on top of the tab row — overlapping the rightmost tab (Guardian) — and would also render *underneath* those z-50 modals, making it invisible exactly when combat is happening.

Fixes, both decided rather than left as later surprises:
- **Clear the tab bar, don't overlap it.** The button's vertical offset is derived from `BottomNav`'s actual rendered height (a shared constant/CSS custom property both components reference), not a guessed pixel value — so it stays correct if the tab bar ever changes (e.g. a 6th tab wraps to two lines).
- **Suppress during full-screen modals.** While any `z-50` action modal is open, the button hides entirely rather than fighting for stacking order against current and future modals. It reappears the instant the modal closes, and the unread badge count is preserved underneath — nothing is lost, chatting mid-roll just isn't the point anyway.
- **No drag.** Considered and rejected: dragging would let each player manually work around a layout bug instead of the layout being correct for everyone. Revisit only if a real device/screen size turns up where the fixed position still doesn't work — not by default.

## States & onboarding

- **Empty state**: a brand-new channel with zero messages shows centered copy — "No messages yet — say hi to your party 👋" — not a blank void.
- **Discoverability**: the button is new UI that will otherwise go unnoticed. First time a player loads `/v2/play` after this ships, a one-time coachmark/pulse draws attention to it ("New: Party Chat — talk to your table without leaving the story"), dismissed permanently after first open or explicit dismissal. A `localStorage` flag is enough — this is cosmetic, not worth a backend/schema change.
- **Mobile/responsive**: this is an async app — players are checking in from phones between turns as much as at a desk. The small corner-card panel in the mock is a desktop-scale treatment; below a small-viewport breakpoint the panel goes near-fullscreen (most of the height, full width minus margins) instead of staying a cramped corner card.
- **Pre-join chat history**: deliberately using Stream's default — a player who joins a session mid-game sees the full existing OOC history for that table, same as joining a Slack/Discord channel. Not hidden. Stated as a decision (a friend-group table has no real privacy expectation against its own current members) rather than something nobody thought about.
- **Kicked player messaging**: kicking already revokes chat access (see Membership below), but today that happens silently. Add a client-side message — "You were removed from this session" — shown to the removed player, rather than access just vanishing with no explanation.
- **Mid-game joiner onboarding**: nothing currently prompts a player who joins an in-progress session (as opposed to creating one from `/v2/setup`) to connect Discord or notices Party Chat exists — onboarding today only happens at first setup. Reuse the same one-time coachmark mechanism for joiners: on first entry into a session they didn't create, surface both "Connect Discord to get notified on your turn" (if not already linked) and the Party Chat coachmark together, since this is genuinely the same "orient a new arrival" moment.

## Stream account setup (manual — do this first, before any code)

Entirely done in the Stream dashboard. Nothing here touches the repo.

1. Go to **https://getstream.io/** and sign up (email, or Google/GitHub) — no credit card required for the free tier.
2. During onboarding you'll be asked which product you're building with — choose **Chat**.
3. You'll land on the **Dashboard** — click **"Create a new application."** Name it (e.g. `dnd-async-app`) and pick a server region close to your players. The region locks in once set, but dev/production mode can be flipped later.
4. You're dropped onto that app's **Chat Overview** page — the **API Key** and **API Secret** are shown right at the top, next to a Usage & Limits table.
5. Copy both. Add `STREAM_API_KEY` (safe to expose client-side) and `STREAM_API_SECRET` (server-only — never send this to the browser) as env vars, locally and in Vercel.
6. In the left sidebar under **App configuration**, turn Stream's default moderation **on** (profanity filter + reporting) — decided, not left open. It's a low-cost default even for a closed friend group.
7. **Dev vs. production mode**: this toggle itself is just a dashboard safety rail (production mode blocks destructive dashboard actions like deleting data) — it does **not** control who can read which channel. The actual risk is two separate, off-by-default settings: **`disable_auth_checks`** (skips verifying a user's token is real) and **`disable_permissions_checks`** (grants every user full read/write/delete on every channel). Leave both off, in either mode — Stream's own docs say never enable them in production, and there's no reason to enable them in development either, since that's exactly what would let one game see another's chat.

## Architecture

- **Scoping**: one Stream channel per `GameSession` — the actual v2 table/session unit (`app/api/v2/sessions/[sessionId]/...`), **not** the older `Game`/`PartyMember` models, which v2 play doesn't use for membership. Channel id `session:{sessionId}`.
- **Membership — restricted to current party, kept in sync**: members are derived from `RoomParticipant` rows across that `GameSession`'s `RoomInstance`s, mapped `characterId → Character.userId`, excluding anyone in `GameSession.kickedCharacterIds`. Two sync hooks, both already-existing routes:
  - **Join** — `app/api/v2/sessions/[sessionId]/join/route.ts` (where `RoomParticipant` is created): after the existing insert, also call Stream's `channel.addMembers([userId])`.
  - **Kick** — `app/api/v2/sessions/[sessionId]/kick/route.ts` (already deletes `RoomParticipant` and appends to `kickedCharacterIds`): also call `channel.removeMembers([userId])` in the same transaction path, so a kicked player loses chat access immediately, not just party/turn access.
- **Auth**: Stream requires a signed per-user token minted server-side. New route `app/api/v2/me/stream-token/route.ts` — given the authenticated Supabase session, calls `StreamChat.getInstance(apiKey, apiSecret).createToken(userId)` (and `upsertUser` for name/avatar), returns the token to the client. Reuses the existing session-lookup pattern already used by routes like `app/api/v2/me/characters/route.ts`.
- **Client**: lazily connect only when the panel is first opened (not on every page load) — avoids paying for a websocket connection for players who never open chat. Wrap the button+panel in a small `<OocChatWidget>` client component.
- **Connection-failure fallback**: if the token fetch or channel connect fails (Stream outage, network issue, expired token), the floating button still renders — it never disappears — but the panel shows a small inline "Chat unavailable — try again" state instead of a broken/blank component, so a Stream-side failure doesn't read as the app itself being broken.
- **Mount point**: no shared `app/v2` layout exists today (only `app/layout.tsx` at the root) — mount the widget directly in `app/v2/play/page.tsx` (and the lobby, if desired) rather than the root layout, so it only appears where active play happens, not on marketing/setup screens.
- **No new Prisma model** — Stream owns message storage/history itself. The only local state is the Stream API key/secret (env vars `STREAM_API_KEY`, `STREAM_API_SECRET`) and the existing `User`/`RoomParticipant`/`GameSession` rows used to derive and sync channel membership.

## Notifications — deliberately in-app only

The out-of-app Discord DM requirement is non-negotiable for the *app* (turn pings, reminders — see `PLAN-discord-notifications.md`), but not for OOC chat specifically. A new OOC message only surfaces as the unread badge on the floating button, visible while the app is open. No Discord DM, no push, no email fires for chat. If this turns out to be too easy to miss for genuinely async groups, revisit — but it's not in scope now, and it keeps these two systems decoupled.

**The re-entry moment, though, is shared and currently undesigned.** A player taps a Discord turn-ping DM, lands back in `/v2/play` — do they see it's their turn *and* that there are unread OOC messages in the same glance, or is one of those hidden behind a click? Fix: on page load, the Party Chat badge count is fetched and rendered immediately alongside the turn/HP header, not lazily after the player happens to notice the button. No new infra — just don't let this be an afterthought once both pieces exist.

## Rollout

1. Wire the token route + a bare Stream `Channel` (no custom UI yet) behind a dev-only flag, confirm messages actually deliver between two linked accounts, and confirm a kicked/removed character actually loses channel access.
2. Build the floating launcher + overlay shell with the real visual styling, including the connection-failure fallback state, ship to your own test account.
3. Enable for the full party.

## Verification
- Two browser sessions (two different linked users) in the same `GameSession`: send a message from one, confirm it appears for the other in under a second and the narrative log is untouched.
- Kick a character mid-session and confirm that user's chat access is revoked, not just their turn/party access.
- Temporarily point the client at a bad API key and confirm the panel shows the fallback state instead of breaking.
- Confirm the panel opens/closes via all three exits (×, click-outside, Esc) and that closing it never affects `combatState`/turn logic underneath.
- Confirm a player with zero unread messages sees no badge, and the badge clears on opening the panel.
