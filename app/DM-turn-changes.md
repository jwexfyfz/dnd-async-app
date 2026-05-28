# Important Guidelines
* Minimize terminal output; display only absolute necessities.
* Setup: 1) Verify all requirements. 2) Create a planning file (`todo.md`) to track phases/tasks. 3) Dynamically manage context as tasks finish.

# Context & Objective
Refactor the 'live battle' feedback loop into a strict, interleaved tabletop D&D turn-based combat system. Isolate player turns from AI processing and strictly enforce initiative tie-breakers, surprise mechanics, user-relative visibility states, anti-hallucination boundaries, and discrete X,Y grid coordinate mechanics. Introduce a live map state tracker for all character, enemy, and asset positions.

---

# Logic Shift Requirements

## 1. Grid Spatial State & Combat Transition
* **Grid Spatial Tracking:** All actors (`character`, `enemy`) and interactive assets must maintain explicit `{ x: number, y: number }` integer coordinates in the database.
* **Stealth & Sneaking States (D&D 5e Rules):** Every actor record must track a `stealthState` object containing `isHiding: boolean` and a `stealthRoll: number`. 
  * A "Sneak" action can only be taken if the actor currently occupies a space with total cover or heavy obscurity. It triggers a backend Stealth check (`1d20 + stealth modifier`), sets `isHiding: true`, and stores the result in `stealthRoll`.
  * **User-Relative Map Visibility:** The map state must render dynamically relative to the specific user viewing it. The client payload sent to a player must completely scrub and hide any enemies that have `isHiding: true` (unless exposed by an active Perception check or low stealth roll), removing them from both the visual map and suggestion chips. Hidden players remain visible to fellow party members on their map UI.
  * **Enemy Vision Blocks:** Enemies cannot see or track any human players who have `isHiding: true`. The AI DM system prompt must mask hidden player coordinates from the enemy context during the AI processing phase, forcing NPCs to act only on known, visible targets.
  * **Breaking Stealth:** `isHiding` instantly drops to `false` the exact millisecond an actor leaves cover/obscurity and enters an opposing entity's unobstructed line of sight, or whenever they execute an aggressive action (attack/harmful spell).
* **Line of Sight & Cover:** Range verification must check the vector between attacker and target coordinates. Solid assets (e.g., walls) intersecting this path create total cover, algorithmically blocking ranged suggestion chips, preventing attacks, and acting as valid terrain to initiate a "Sneak" action. Total cover does not block area-of-effect splash damage if coordinates permit.
* **Diagonal Movement Math:** Calculate movement distance using standard D&D 5e variant grid math (alternating 5ft/10ft for diagonal steps) or a strict Euclidean distance rounded down to ensure actors cannot cheat their speed pool via diagonals.
* **Attacks of Opportunity:** The state engine must check if a movement path exits a square adjacent to a hostile NPC. If triggered, the system verifies the NPC has an available reaction (`hasReaction: true`) and is not currently affected by the **Surprised** condition. If valid, the system pauses movement execution, immediately processes the enemy's free reaction attack narrative/dice block, consumes their reaction (`hasReaction: false`), and then finishes the movement.
* **Suggestion Chips Tracking:** Every suggestion chip payload must define the movement outcome using `endPosition: {x, y}` and an optional `actionTarget: {x, y}`. If an action involves no movement, `endPosition` matches current coordinates. Position updates *only* apply upon action completion.
* **Narrative Grounding:** AI DM creativity is strictly bounded by the current map layout and visible actors. It cannot reference unmapped assets, invent unseen ghost enemies, or narrate successful targeted attacks through solid structural walls.
* **NPC Movement Rules:** AI NPC movement and targeting must algorithmically validate that distance complies with character metrics *before* execution. AI narrative outputs containing movement must include explicit final coordinate tags to update the map state.
* **Combat Trigger:** Battle begins immediately upon aggressive player intent, hostile NPC actions, or failed stealth/perception checks **only if active, hostile enemies are present nearby**.
* **The Intercept Rule:** Attacks from exploration mode do not land automatically. Halt exploration instantly and roll initiative *before* resolution. Discard the triggering action; do not deduct it from upcoming turn resources.
* **Automated Initiative & Tie-Breakers:** Auto-roll `1d20 + dexterity modifier` behind the scenes for all nearby actors (`character` and `enemy` tables). Sort the initiative tracker array chronologically using strict D&D tie-breaker algorithms: 
  1. Higher total initiative roll wins.
  2. On an identical roll tie between a Player and an NPC, the Player wins and goes first.
  3. On a tie between two entities of the same faction, the entity with the higher flat Dexterity score goes first.
  4. If flat Dexterity scores are equal, resolve via a random secondary backend roll.
* **UI Delivery:** 
  * Render a card labeled "In Combat".
  * Display the sorted initiative order inside the card using Google profile pictures. Highlight the active turn's user. Hide dice rolls/math for initiative.
* **State Management:** Persist the sorted turn order, grid coordinates, visibility states, reaction availability pools (`hasReaction: boolean`), `currentTurnActorId`, and `currentRoundNumber` in a per-combat `CombatSession` record. Reset all actors to `hasReaction: true` at the start of their individual turns. Clear the session upon battle resolution.

## 2. Surprise Rounds & Perception Failures
* **Surprise Evaluation:** When combat is triggered, the system evaluates all targets individually for the **Surprised** status effect for Round 1. A creature is Surprised *only* if it is completely unaware of **all** threats. If an enemy notices even one player (e.g., the enemy's Passive Perception beats that specific player's `stealthRoll`), that enemy cannot be surprised, even if other players are perfectly hidden.
* **Turn Processing for Surprised Actors:** Surprised actors still take their designated spot in the initiative order and are never skipped. When `currentTurnActorId` matches a surprised actor, the system executes the following:
  * **Restrictions:** Force-pass their turn with zero movement, actions, or bonus actions. The actor cannot use reactions while surprised.
  * **Reaction Recovery:** Instantly delete the 'Surprised' status and set `hasReaction: true` at the exact end of this restricted turn, enabling reactions during the remainder of Round 1.

## 3. Player Turn Logic & UI Constraints
* **Turn Processing:** Resolve player actions individually on submission with immediate DB commits (including failed checks).
* **Narrative Delivery:** Trigger an AI DM narrative response per action:
  * *State-Changing Actions:* Advance scenario, update grid coordinates, alter map entities, trigger traps, reveal hidden enemies, or process attacks.
  * *Static Actions:* Give descriptive flavor/closure only (e.g., loud echoes, empty pockets). Advance background time/torch trackers. Do not advance the core plot.
* **Exhaustion UI:** Keep an "End Turn" button pinned to the bottom. If turn resources/actions hit 0, hide all suggestion chips and force an "End Turn" submission.

## 4. AI DM Turn Processing & Grounding
* **Turn Escalation:** Shift to the next `currentTurnActorId` immediately when an active actor triggers "End Turn". 
* **Dead Actor Skip:** The state engine must automatically skip any actor whose `currentHP` is 0 or less, immediately progressing `currentTurnActorId` to the next entity in the initiative order without triggering an AI narrative block.
* **Continuous NPC Loop:** If the next valid actor is an NPC, auto-execute their logic. Loop through consecutive NPC turns seamlessly without waiting for player inputs. Stop only when a human player's ID is reached.
* **Strict Grid Grounding:** The AI DM cannot invent or interact with actions, enemies, or objects (e.g., ghost crates or unmapped monsters) that do not explicitly occupy valid X,Y coordinates in the current database map state.
* **Dynamic Interleaving:** Batch consecutive NPC turns into one cohesive narrative block and group their combat dice outcomes using the existing narrative dice UI component. Save directly to the chat log.

## 5. UI Updates
* Sync 'Party' and 'The Field' tabs (`currentHP`, grid coordinates, user-relative visibility filters, and active turn highlights) exactly when a narrative block finishes updating to eliminate UI flickering.

---

# Expected Task Output
Analyze `app/actions/take-turn.ts` and the combat page. Propose a structural strategy to refactor the system prompt for interleaved, coordinate-aware, and status-aware (`Surprised`) NPC turn batching instead of 1:1 player reactions. If database schemas for `character`, `enemy`, `CombatSession`, or `Map` are ambiguous in the file, demand them before writing implementation code.
