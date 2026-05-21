# Project Context: Async AI D&D Web App

## 🎯 Core Mission & Vision
An asynchronous, text-driven, AI-powered Dungeons & Dragons web application optimized for short, mobile-first, 15-minute play increments.
- **Asynchronous Loop:** Players are notified when it is their turn. They review the chat history, take their actions, and end their turn, advancing the global state machine.
- **AI-Powered Agency:** Users use creative text inputs. Claude 3.5 Haiku parses intentions and narrates outcomes, while strict code logic handles the math and boundaries.
- **Target Audience:** Players wanting a low-time-commitment D&D experience without needing a human Dungeon Master (DM).

## 🛠 Tech Stack & Infrastructure
- **Frontend:** Next.js (App Router, hosted on Vercel), TailwindCSS, Radix UI / Shadcn.
- **Auth:** NextAuth.js / Supabase Auth.
- **Database:** Supabase PostgreSQL Cloud via Prisma ORM.
- **AI Layer:** Claude 3.5 Haiku API (via Anthropic SDK).
- **Notifications:** Resend (Email) and Discord Webhooks.

## 🎨 UI Architecture & Tab Layer System
The frontend is divided into a clean, mobile-optimized tabbed interface with global UI states:

### 1. Global Navigation & Headers
- **Global Initiative Tracker:** A persistent horizontal bar pinned to the top of the viewport displaying the turn sequence sequence (Player & Monster avatars from left to right).
- **"It's Your Turn!" Badge:** A bright, pulsating red badge or notification dot anchored directly over the Chat Tab icon when `Campaigns.active_turn_player_id === user.character_id`.
- **Notification Settings Panel:** A configuration gear interface where users link Discord IDs and opt into browser Push Notifications / Resend email alerts.

### 2. The Chat UI Tab
- **The Text Feed:** Handles mixed-content blocks. Embeds structured system dice cards `[Roll: 14 + 3 = 17 | Success!]` inline with Claude's contextual narrative text blocks.
- **The Adaptive Action Input:** Context-aware box. Shows a prominent green border when it is the user's turn. Displays a disabled, grayed-out layout with a "Waiting for [Entity] turn..." banner when inactive.
- **Quick-Command Action Chips:** Horizontal scrolling tap-targets over the text bar (`[⚔️ Attack]`, `[🔍 Search]`, `[🏃 Move]`, `[🎒 Use Item]`) that pre-fill the text field to streamline mobile entry.

### 3. The Map UI Tab
- **20x20 Viewport Matrix:** A dynamic CSS grid bounding-box tracking the player's vector position. 
- **Coordinate Reference Overlay:** Implements clear chess-style map borders (Letters A–T on top, Numbers 1–20 on sides) so players can type targeted text strings (e.g., "I fire an arrow at the goblin on C12").
- **Center-On-Me Anchor:** A floating UI control element that instantly snaps the scrolling map viewport back onto the player's structural token.

### 4. The Status / Equips Tab
- **Stats Grid:** High-density readouts for core parameters (`hp`, `max_hp`, active inventory items).
- **Interactive Spell & Skill Cards:** Clicking an ability triggers a modal pop-up parsing explicit mechanical rule boundaries so users can confirm spell profiles before committing an asynchronous action.

## 💾 Database Schema & State Model (Supabase/Prisma)
Maintain strict referential integrity across these key tables:
- `Campaigns`: Tracks `round_number`, `active_turn_player_id`, and the ordered `initiative_queue` array.
- `Characters`: Core constraints (`hp`, `max_hp`, `spell_slots`, `inventory` JSON, `authorized_skills` array).
- `TurnSessions` & `ActionLogs`: Audit trail of raw text inputs, structured JSON commands, dice math, and final AI narratives.
- `DiscoveredObjects`: Links `character_id` to discovered coordinate IDs to manage perception filtering.

## 🎮 The Gameplay Transaction Loop (Strict Execution Order)
Every turn action submitted by a user must pass through these distinct phases:
1. **Middleware Validation:** Verify `request.user_id` matches `Campaigns.active_turn_player_id`. Drop request if invalid.
2. **Intent Parsing (AI):** Claude 3.5 Haiku extracts the player's intent into a strongly typed JSON command (e.g., `{ action: "SEARCH", target: "desk", coordinates: [X, Y] }`).
3. **Boundary Validation (Code):** TypeScript backend verifies distance, line of sight, tile collision (`OBSTACLE`), and inventory/skill prerequisites.
4. **Dice Roll Engine (Code):** Pure code executes `d20 + modifiers` against the target's Difficulty Class (DC) or Armor Class (AC). **Never let AI invent the roll result.**
5. **Adjudication & Narration (AI):** Claude evaluates non-coded interactions and generates a rich, immersive text narrative summarizing the mechanical roll results.
6. **State Mutation & Alert (Code):** Update the database. If the turn ends, shift the `active_turn_player_id` and trigger the notification worker (Resend/Discord).

## 📐 Coding Standards & Conventions
- **State Architecture:** Serverless edge functions process rules. PostgreSQL is the absolute source of truth; do not hold game loops in server memory.
- **Perception Rule:** Filter out hidden elements from map payload queries unless the character's passive perception clears the object's hidden DC, or a record exists in `DiscoveredObjects`.
- **AI Guardrails:** System prompts to Claude 3.5 Haiku must strictly forbid it from breaking D&D mechanical boundaries or overriding the Dice Engine's structural output.

## 🚀 Key Commands & Scripts
- Run local development environment: `npm run dev`
- Database migration sync: `npx prisma migrate dev`
- Execute test suites: `npm run test`

## 🧪 Verification & Acceptance Criteria
- **The Golden Rule:** You must test your work. Run `npm run test` or check file logs immediately after writing code.
- **No Suppressed Errors:** If a build fails, fix the underlying root architectural cause. Never just hide or comment out a compiler or TypeScript error.
- **Schema Lock:** Never alter the database schema or run `prisma db push`/`migrate` unless a feature explicitly demands it. Check targets carefully before executing destructive terminal commands.

## 🧠 Behavioral Expectations
1. **Don't Assume:** If a requirement is ambiguous or you find conflicting patterns, halt mid-action and ask the user for clarification. Surface the tradeoffs.
2. **Minimalist Implementation:** Write the absolute minimum code required to solve the immediate request. Do not write speculative helper features for the future.
3. **Surgical Refactoring:** Only edit files directly involved in your task. Do not clean up code or change formatting in untouched files unless explicitly ordered.
