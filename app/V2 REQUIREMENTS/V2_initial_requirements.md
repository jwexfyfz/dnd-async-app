### OBJECTIVE
I want to try out a different strategy for implementing my asynchronous D&D web-app, but I don't want to break the existing game in case I change my mind. Instead, we should create a forked version that I can access separately with a different strategy, where the database will remain the same, but some different tables will be used (already in prisma/schema.prisma).

IMPORTANT: DO NOT EDIT ANY OF THE EXISTING FILES. you can either re-use the existing files, or you can create a brand new folder for the new files.

I need you to write a complete, production-ready, fully implemented Express.js controller file (`src/controllers/gameController.ts`) that handles my asynchronous AI-DM pipeline based on my custom multi-tenant Prisma schema. 

[SYSTEM DESIGN & LIFECYCLE OVERVIEW]
You are implementing an event-driven, rule-bound pipeline for an async D&D text app. The system must never rely on the AI to "remember" state or invent mechanics; the database is the source of truth, and Claude Haiku acts as a strict intent-to-JSON parser while Claude Sonnet acts as an immersive storyteller.

When a player hits the `POST /api/game/action` endpoint, process the lifecycle across these 5 strict sequential stages:

---

### STAGE 1: DATABASE CONTEXT LOOKUP
Query my Supabase instance via Prisma using the incoming payload: `{ characterId, roomInstanceId, playerActionText }`.
1. Fetch the active Character (including stats, skillsModifiers, inventory).
2. Fetch the RoomInstance, joining its parent RoomTemplate (for name, baseDescription).
3. Fetch all PoiInstances connected to this RoomInstance, joining their parent PoiTemplates to retrieve `name`, `keywordIdentifier`, and `defaultProperties` (the valid verbs, mechanical effects, and stances).

---

### STAGE 2: INTENT PARSING VIA CLAUDE TOOLS (HAIKU)
Instantiate the Anthropic client using `process.env.ANTHROPIC_API_KEY`. Call `anthropic.messages.create` using `claude-3-5-haiku-20241022`.
- Pass a System Prompt containing the whitelisted list of PoiInstance IDs, names, keywords, and available stance triggers fetched in Stage 1.
- Define an Anthropic Tool named `extract_game_intent`. Force Claude to call this tool by setting `tool_choice: { type: "tool", name: "extract_game_intent" }`.
- The tool's `input_schema` must be an object with an `actions` array containing:
  * `action_type`: String enum ("change_proximity" or "narrative_only")
  * `target_poi_instance_id`: Nullable String (Must match a valid, fetched PoiInstance ID)
  * `resulting_stance`: Nullable String (Must match the exact stance name defined in that POI's template properties, e.g., "elevated_ground" or "behind_cover")

---

### STAGE 3: DETERMINISTIC STATE MUTATION (PRISMA TRANSACTION)
Extract the parsed tool call parameters from Haiku's response. Wrap the state modifications inside a native Prisma transaction (`prisma.$transaction`):
1. If `action_type` is "change_proximity", update the target `RoomParticipant` row matching this `characterId` and `roomInstanceId`. Overwrite their `combatState` JSONB object with the new `proximity_target_id` and `stance`.
2. Automatically create a row in the `MessageLog` table flagged with `isMechanicalEvent: true`. Store a summary object in `mechanicalSummary` tracking the state change (e.g., `{"event": "movement", "to": "stone_fountain", "stance": "elevated_ground"}`).

---

### STAGE 4: CREATIVE AI-DM STORYTELLING (SONNET)
Call your primary creative model using `claude-3-5-sonnet-20241022`.
- Fetch the last 5 chronological historical text logs from `MessageLog` for this room to maintain conversation continuity.
- Pass a System Prompt dictating that they are a realistic, immersive D&D Dungeon Master. 
- Inject a strict instruction block: "The engine has successfully updated the database. Character X is now standing AT the Point of Interest Y with the stance Z. An opportunity attack check was completed and passed. Describe this action vividly in the context of the room. Do not hallucinate items, doors, or characters that are not in the room context provided."
- Save Sonnet's beautiful markdown text output to `MessageLog` with `isMechanicalEvent: false`.

---

### STAGE 5: THE VIEW STATE PACKAGER (FRONTEND DASHBOARD STATE)
Instead of just returning the text story, you must compute and return a unified JSON payload matching a "Tactical Dashboard View" so the frontend UI can draw a gridless visual map layout. Aggregate and return:
1. `currentNarrative`: The last 5 narrative logs from `MessageLog`.
2. `activeState`: The room's game state (exploration vs combat).
3. `uiLayoutAnchors`: An object mapping all room POI instance IDs. For each POI, list an array of characters currently marked as standing at that POI. Anyone else must be grouped into an `open_space` array. This allows the frontend to instantly render visual container cards showing who is standing where.

---

[IMPLEMENTATION REQUIREMENTS]
- Provide the full, unabridged TypeScript file layout. Do not use placeholders, shorthand syntax, or "// implement later" comments.
- Include all necessary imports, explicit Typescript typing for Express request/response objects, and robust try/catch blocks to gracefully handle validation errors or tool execution failures.
