# Discord Turn Notifications + Reminders

## Context

Async D&D play stalls when players don't know it's their turn. The goal is a Discord DM the moment combat turn changes to them, plus idle nudges (combat turn sitting too long, or exploration party going quiet) so the game keeps moving without anyone polling the app.

Decisions locked in with the user:
- **Delivery**: per-user Discord DM via a bot (not a per-game channel webhook).
- **Scope**: both combat-turn notifications and exploration idle nudges.
- **Scheduling**: deployed on Vercel, wants free. **Vercel Hobby's cron is capped to once/day per job — too infrequent for turn reminders.** Use a free GitHub Actions scheduled workflow instead (repo is already on GitHub) hitting a secret-protected API route every ~10 min. No new vendor account needed.

Key finding that simplifies things: a bot only needs REST calls (`create DM channel` + `post message`) to DM a user — no persistent gateway/websocket connection required, so this fits Vercel's serverless model fine. The one real constraint: Discord requires the bot to share a guild with the user before it can open a DM, so whoever runs each Discord server needs to invite the bot once (a plain OAuth2 bot-invite link, no code).

## Discord Developer Portal setup (manual — do this first, before any code)

This is entirely done in Discord's and Supabase's web dashboards. Nothing here touches the repo. Do it in this order:

1. Go to **https://discord.com/developers/applications** and log in with your Discord account.
2. Click **"New Application"** (top-right corner). Give it a name (e.g. `DnD Turn Notifier`), check the box agreeing to the Developer Terms, click **Create**.
3. In the left sidebar, click **"Bot"**.
   - If a bot user doesn't already exist, click **"Add Bot"** → **"Yes, do it!"**.
   - Click **"Reset Token"** (or **"View Token"**), confirm, and copy the token immediately — Discord only shows it once. Paste it somewhere safe for now (password manager or a scratch note); this becomes the `DISCORD_BOT_TOKEN` env var later.
   - Under **"Privileged Gateway Intents"** lower on the same page, leave **all three toggles OFF** (Presence Intent, Server Members Intent, Message Content Intent) — none are needed, since we only ever send outbound DMs, never read messages or listen for events.
4. In the left sidebar, click **"OAuth2" → "General"**.
   - Copy the **Client ID** (visible directly).
   - Click **"Reset Secret"** to reveal the **Client Secret**, copy it immediately.
5. Open your **Supabase dashboard** → select this project → **Authentication → Providers** → find **Discord** in the provider list → toggle it **Enabled**.
   - Paste the **Client ID** and **Client Secret** from step 4 into the matching fields.
   - Click **Save**. Supabase will now display a **Redirect URL** (looks like `https://<your-project-ref>.supabase.co/auth/v1/callback`) — copy it.
6. Back in the Discord Developer Portal → **"OAuth2" → "General"** → scroll to **"Redirects"** → click **"Add Redirect"** → paste the Supabase callback URL from step 5 → click **"Save Changes"** at the bottom of the page.
7. Still under **"OAuth2"**, click **"URL Generator"** in the left sidebar.
   - Under **"Scopes"**, check **`bot`** only.
   - A **"Bot Permissions"** panel appears below — check **"Send Messages"** only (nothing else needed).
   - Copy the generated URL at the bottom of the page — this is the one-time **bot-invite link**.
8. Open that generated URL yourself (or send it to whoever administers your D&D group's Discord server), pick the target server from the dropdown, click **Authorize**. This adds the bot to that server — required once per server, not per player, since Discord only lets a bot DM someone it shares a server with.
9. Add the bot token from step 3 to your local `.env` as `DISCORD_BOT_TOKEN=...`, and add the same variable in **Vercel → Project Settings → Environment Variables** for Production (and Preview if you test there).

Once steps 1–9 are done, hand the Client ID (not the secret) and confirmation that steps are complete back to me and we can start on the code side of the plan below.

## Data model changes (prisma/schema.prisma — additive/nullable only)

- `User`: `+ discordUserId String? @unique`, `+ discordUsername String?`, `+ notifyDiscord Boolean @default(true)`
- `RoomParticipant`: `+ lastReminderAt DateTime?` (dedupes exploration idle nudges)
- `types/v2-game.ts` `CombatState`: `+ turnStartedAt: string`, `+ lastReminderAt?: string` — no migration needed, this is the existing JSON blob on `RoomInstance.combatState`.

This requires confirmation before running `npx prisma migrate dev` per the project's hard rule on schema changes.

**Known gap, surfaced during the OOC chat UX audit**: `notifyDiscord` is one global boolean per `User`. Anyone playing in more than one campaign can't mute just one table's turn pings without going deaf to all of them. Not fixed here — flagging so it's a deliberate deferral, not a surprise later. If it needs fixing, it likely moves from a `User`-level flag to something scoped per `GameSession` (e.g. on `RoomParticipant`, alongside the `lastReminderAt` field already being added there).

**Also shared with the OOC chat plan**: when a player returns via a turn-ping DM, they should see both "it's your turn" and unread Party Chat count in the same glance on landing — see `PLAN-ooc-chat.md`'s Notifications section. Not this doc's responsibility to build, just noting the dependency so it isn't designed twice, differently.

## Account linking

Reuse the existing Supabase→Prisma sync pattern in `app/auth/callback/route.ts` (already upserts `User` from `data.user` after `exchangeCodeForSession`). Extend it: after exchange, check `data.user.identities` for a `provider === 'discord'` entry and additionally set `discordUserId`/`discordUsername` on the upsert when present.

Frontend: add a "Connect Discord" control to `app/v2/setup/page.tsx` near the existing Google `handleLogin` (`app/v2/setup/page.tsx:706-718`), calling:
```ts
supabase.auth.linkIdentity({ provider: 'discord', options: { redirectTo: `${origin}/auth/callback` } })
```
Once linked, show the connected Discord username, a mute/unmute toggle for `notifyDiscord`, and a static bot-invite link (OAuth2 URL with `scope=bot`, from the Discord Developer Portal app created for this). A small `app/api/v2/me/discord/route.ts` (GET status / PATCH mute) follows the existing `app/api/v2/me/characters/route.ts` pattern.

## Notification dispatch

New `lib/discord/notify.ts`:
- `sendDiscordDM(discordUserId, content)`: `POST https://discord.com/api/v10/users/@me/channels {recipient_id}` → `POST /channels/{id}/messages {content}`, using `DISCORD_BOT_TOKEN` (new env var). Always wrapped in try/catch and never throws — a Discord failure must never break a game action.
- `notifyYourTurn(characterId)`: resolves `Character.userId → User.discordUserId/notifyDiscord`, skips silently if unlinked or muted, otherwise sends the DM.

## Turn-change hook (the core "it's your turn" ping)

`lib/v2/game-controller.ts` has ~7 separate `prisma.roomInstance.update({ data: { combatState... } })` call sites (e.g. lines 143, 351-354, 623-626, 1256-1259, 1280, 1287, 1388) plus one in `app/api/v2/sessions/[sessionId]/kick/route.ts:59`, rather than one choke point. Introduce a single wrapper, e.g. `persistCombatState(roomInstanceId, newCombatState)` in `lib/v2/game-controller.ts`, and swap every existing call site to use it. The wrapper diffs `previous.activeActorId` vs `newCombatState.activeActorId`; if it changed to a player character, it calls `notifyYourTurn` (fire-and-forget, errors swallowed).

Stamp `turnStartedAt` at the actual source of truth for "a turn began" — the two return points in `advanceTurn()` in `lib/v2/combat-engine.ts` (~line 855 and ~864) — so every caller of `advanceTurn` automatically carries a correct timestamp without needing to touch each call site individually.

## Discord linkage — user journey

Happy path:
1. User is already logged in (existing Google flow) and lands on `/v2/setup`.
2. A "Connect Discord" card is shown (only when not yet linked).
3. Click → `supabase.auth.linkIdentity({ provider: 'discord', options: { redirectTo: '${origin}/auth/callback' } })` → Discord consent screen → approve → back to `/auth/callback` → session now has a `discord` identity → callback upserts `discordUserId`/`discordUsername` onto the Prisma `User` row → redirect to `/v2/setup`.
4. Setup page now shows "Connected as {username}", a mute/unmute toggle for `notifyDiscord`, and a static "invite our bot to your server" link.
5. Whoever admins the shared Discord server clicks the bot-invite link once — one-time per server, not per user.
6. Next turn change → DM arrives.

Edge cases this journey must explicitly handle (not just the happy path):
- **Discord account already linked to a different app user** — `discordUserId` is unique; catch the constraint violation in the callback and show "This Discord account is already connected to another player" instead of a raw failure.
- **User cancels the consent screen** — callback's existing `if (!error && data.user)` guard already no-ops correctly; confirm the UI doesn't get stuck in a loading state.
- **Disconnecting Discord** — not in the original plan; add an "unlink" action calling Supabase's `unlinkIdentity` and clearing `discordUserId`/`discordUsername`/`notifyDiscord` on the `User` row.
- **Bot never invited to a shared server** — DMs will silently fail forever otherwise. Since delivery failures are now logged (see below), surface a small banner on `/v2/setup` when the user's most recent notification attempts all failed, pointing back at the bot-invite link.

## Notification logging

New model so delivery is queryable and debuggable, instead of only living in ephemeral Vercel function logs:

```prisma
model DiscordNotificationLog {
  id             String                     @id @default(uuid())
  userId         String
  user           User                       @relation(fields: [userId], references: [id])
  characterId    String?
  gameId         String?
  roomInstanceId String?
  kind           DiscordNotificationKind
  status         DiscordNotificationStatus
  errorMessage   String?
  createdAt      DateTime                   @default(now())

  @@index([userId, createdAt])
}
enum DiscordNotificationKind   { TURN_PING COMBAT_REMINDER EXPLORATION_REMINDER }
enum DiscordNotificationStatus { SENT SKIPPED_UNLINKED SKIPPED_MUTED FAILED }
```

`sendDiscordDM`/`notifyYourTurn` write exactly one row per attempt, regardless of outcome. This is what answers "did it send, and why not" for a given user/game, and is what powers the failed-delivery banner above. This is a third schema addition on top of `User` and `RoomParticipant.lastReminderAt` — flag it the same way for migration confirmation. (Lighter alternative if you'd rather not add a table: structured `console.log` only, relying on Vercel log drains — but that's not queryable from inside the app, which is the gap being solved here.)

## Rollout plan (staged, not big-bang)

- **Stage 0 — build behind a flag**: `DISCORD_NOTIFICATIONS_ENABLED` env var, default `false` in production. All dispatch code checks it first.
- **Stage 1 — solo dev test**: add `DISCORD_TEST_USER_IDS` env allowlist; while the global flag is off, notifications still fire for accounts in this list. Link your own account, run a real combat encounter, confirm the bot DM arrives and `DiscordNotificationLog` rows look right.
- **Stage 2 — turn pings only, all users**: flip `DISCORD_NOTIFICATIONS_ENABLED` on, but don't deploy the reminder cron yet. Watch a handful of real sessions for false positives (e.g. a ping firing on an HP update instead of an actual turn change) before adding the reminder layer.
- **Stage 3 — reminders on**: deploy the GitHub Actions cron with generous thresholds (e.g. 20 min combat / 48h exploration) so a bug can't spam anyone; tighten once trusted.
- **Stage 4 — general availability**: drop the allowlist gate. Keep `DISCORD_NOTIFICATIONS_ENABLED` permanently as a kill switch, and the per-user `notifyDiscord` mute as the standing off-switch.

## Regression testing plan

- `lib/v2/__tests__/regression-baseline.test.ts` already mocks `prisma.roomInstance.update` and unit-tests `advanceTurn` / `checkCombatEnd` / `exitCombat` / `resolveEnemyTurn` directly from `game-controller` — this is the existing anchor, not a new pattern. Run `npm run test:run` before touching anything to capture a clean baseline, and again after each stage above.
- Add new unit tests alongside it for:
  - `persistCombatState`'s diff logic — a same-actor update (e.g. an HP change) must NOT fire a notification; an actual `activeActorId` flip must fire exactly once.
  - `notifyYourTurn` skip conditions: no linked `discordUserId`, `notifyDiscord = false`, active actor is an enemy not a player.
  - `advanceTurn`'s new `turnStartedAt` stamping — set on real turn advance, untouched by non-turn combatState writes.
  - Discord-call failure isolation: force `sendDiscordDM` to reject and assert the surrounding game action still completes and returns normally (it must never throw into the request path).
- Manual playtest checklist targeting the ~7 refactored `combatState`-persisting call sites: normal attack turn advance, enemy turn resolution, a player fleeing mid-combat, kicking a player during combat, combat ending both ways (all enemies dead / all players fled), a death-save turn skip, and an opportunity-attack-triggered advance. For a fixed seeded encounter (`scripts/seed-combat-scenario.ts` or `prisma/seed-inventory-dev.ts`), diff the `combatState` before/after the refactor to prove it's a no-op on actual game state — the refactor should only add notification side effects, never change combat behavior.

## Verification
- After Stage 1: confirm the bot DM arrives for your own linked account and a `SENT` row appears in `DiscordNotificationLog`.
- After Stage 2: trigger a real turn change in playtest and confirm exactly one DM per turn — no duplicates, no pings on non-turn combatState writes.
- After Stage 3: temporarily lower the reminder thresholds via env, leave a turn idle, curl the cron route directly (don't wait on the GitHub schedule) and confirm exactly one reminder fires, with a second immediate call producing no duplicate (cooldown respected).
- Before calling any stage done: `npm run test:run` must still pass in full, including the existing `regression-baseline.test.ts`.
