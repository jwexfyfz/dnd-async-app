# Project Goal: Implementation of Asynchronous, Server-Seeded Dice Rolling (Refactored)

## Objective
Refactor the current AI-adjudicated turn logic into a player-initiated, secure, and high-production-value dice rolling system. We are shifting from a model where the AI DM "invents" outcomes to a deterministic system where the server handles the mechanics/math and the player manually triggers the gamble via a loop of queued server-seeded rolls.

---

## Key Architectural Changes

### 1. Database Decoupling (5-Pillar Schema & Write Timings)
To eliminate database write latency, prevent data pollution, and dramatically lower LLM input token usage, the monolithic game state data layer is split into five dedicated pillars alongside relational table schemas.

#### Pillar 1: `worldState` (Session Metadata)
* **Format**: JSON Object tracking session-level flags, active campaign goals, and pity metrics.
* **Structure**: 
    ```json
    {
      "activeObjective": "String",
      "plotFlags": ["String"],
      "consecutiveMisses": "Number",
      "npcsEncountered": [
        { "name": "String", "note": "String", "disposition": "String" }
      ]
    }
    ```
* **Write Timing**: Updated asynchronously at the very end of a turn sequence during the **Auto-Advance** step.

#### Relational Tables: `Character`, `PartyMember`, & `Item` (Performance & Latency Optimized)
* **Format**: Strongly-typed Prisma schemas separating global metadata, inventory math, and active game positions. Single-target updates run via indexed lookups.
* **Production Schemas**:
    ```prisma
    model Character {
      id                    String         @id @default(uuid())
      name                  String
      userId                String
      user                  User           @relation(fields: [userId], references: [id])
      characterClass        String
      baseStrength          Int            @default(8)
      baseDexterity         Int            @default(8)
      baseConstitution      Int            @default(8)
      baseIntelligence      Int            @default(8)
      baseWisdom            Int            @default(8)
      baseCharisma          Int            @default(8)
      xp                    Int            @default(0)
      level                 Int            @default(1)
      maxHp                 Int            @default(10)
      currentHp             Int            @default(10)
      activeConditions      String[]       @default([]) // e.g., ["Poisoned", "Prone"]
      skillProficiencies    String[]       @default([])
      mainHandId            String?
      mainHand              Item?          @relation("CharacterMainHand", fields: [mainHandId], references: [id])
      offHandId             String?
      offHand               Item?          @relation("CharacterOffHand", fields: [offHandId], references: [id])
      armorId               String?
      armor                 Item?          @relation("CharacterArmor", fields: [armorId], references: [id])
      ringId                String?
      ring                  Item?          @relation("CharacterRing", fields: [ringId], references: [id])
      remainingActions      Int            @default(1)
      remainingBonusActions Int            @default(1)
      remainingMovementFeet Int            @default(30)
      remainingReactions    Int            @default(1)
      hasCastedBonusSpell   Boolean        @default(false) // Tracks 5e bonus action spell restriction
      backpack              String[]       @default([])
      games                 Game[]
      partyMemberships      PartyMember[]
    }

    model PartyMember {
      id          String    @id @default(uuid())
      gameId      String
      game        Game      @relation(fields: [gameId], references: [id])
      characterId String
      character   Character @relation(fields: [characterId], references: [id])
      posX        Int       @default(0)
      posY        Int       @default(0)
      isNPC       Boolean   @default(false)

      @@index([gameId])
    }

    model Item {
      id                 String      @id @default(uuid())
      name               String
      type               String      // "WEAPON" | "ARMOR" | "CONSUMABLE"
      diceFormula        String?     // e.g., "1d8", "2d6"
      statModifierBonus  Int         @default(0) // e.g., +1 weapon, +2 shield
      combatImpactLabel  String      // For Claude: "+1 Longsword (1d8+1)", "+2 AC"
      
      mainHandCharacters Character[] @relation("CharacterMainHand")
      offHandCharacters  Character[] @relation("CharacterOffHand")
      armorCharacters    Character[] @relation("CharacterArmor")
      ringCharacters     Character[] @relation("CharacterRing")
    }
    ```
* **Write Timing**: Mutated instantly via atomic query operations when an interaction ends. During turn execution, damage mutations hit `Character.currentHp`, status conditions append to `activeConditions`, and positional shifts map to `PartyMember.posX` / `PartyMember.posY`.

#### Pillar 2: `currentScenario`
* **Format**: String (Text block).
* **Structure**: Pure Markdown story narration. Contains zero raw math or transient game engine state data.
* **Write Timing**: Written immediately following the sequential processing and calculation of the entire server-seeded roll queue, running in parallel while the client plays out animations.

#### Pillar 3: `narrativeHistory`
* **Format**: Array of Strings.
* **Structure**: `[ "Story block from turn 1...", "Story block from turn 2..." ]`
* **Write Timing**: Pushed to concurrently with the `currentScenario` write at the end of a successful turn resolution.

#### Pillar 4: `activeTurnQueue` (Array-Based Multi-Resolve Engine)
* **Format**: Standalone runtime tracking table/row managing active UI drawer queue state. It utilizes a flat, ordered array of rolls to natively handle multiattacks, multi-target saves (AoE spells), and dynamic critical hit mutations.
* **Structure**:
    ```json
    {
      "turnId": "String (UUID)",
      "gameId": "String (UUID)",
      "status": "String ('PENDING_ROLLS' | 'COMPLETED')",
      "currentRollIndex": "Number",
      "rolls": [
        {
          "id": "String (UUID)",
          "type": "String ('ATTACK' | 'DAMAGE' | 'SAVING_THROW' | 'ABILITY_CHECK')",
          "actorName": "String",
          "label": "String", // e.g., "Longsword Strike" or "Goblin A Dex Save"
          "diceFormula": "String", // e.g., "1d20+5", "1d8+3", "8d6"
          "dc": "Number | null", // Armor Class or Spell Save DC
          "advantageState": "String ('NONE' | 'ADVANTAGE' | 'DISADVANTAGE')",
          "naturalResult": "Number | null", // Main roll result (or modified result by advantage)
          "secondaryNaturalResult": "Number | null", // Tracks second die if advantage/disadvantage active
          "totalResult": "Number | null",
          "isSuccess": "Boolean | null"
        }
      ]
    }
    ```
* **Write Timing**:
    1.  **Initialization Write**: Inserted into the DB the millisecond a player clicks a suggestion chip. Sets `status: 'PENDING_ROLLS'` and generates the array of all baseline rolls required for that action.
    2.  **Sequential Roll Mutation**: When the user taps to execute the current roll in the index (`currentRollIndex`), the server processes it securely.
        * *Critical Hit Interceptor*: If `rolls[currentRollIndex].type === 'ATTACK'` and returns a `naturalResult === 20`, the backend immediately intercepts the subsequent damage roll in the array (`type === 'DAMAGE'`) and doubles its `diceFormula` structural dice components (e.g., changing `"1d8+3"` to `"2d8+3"`) before updating the DB row.
    3.  **Index Progression**: Increments `currentRollIndex`. If the final roll in the array is resolved, flips `status: 'COMPLETED'`.
    4.  **Purge/Archive Timing**: Deleted completely from the tracking table upon the expiration of the 1.5-second **Auto-Advance** window.

#### Pillar 5: `activeSuggestionChips`
* **Format**: Flat Array of JSON Objects (Max length: 5).
* **Structure**:
    ```json
    [
      {
        "id": "String (UUID)",
        "label": "String",
        "requiresRoll": "Boolean",
        "advantageState": "String ('NONE' | 'ADVANTAGE' | 'DISADVANTAGE')",
        "action_type": "String ('mainAction' | 'bonusAction' | 'movement')",
        "movementFeet": "Number",
        "spellLevel": "Number" // 0 for cantrips/martial features, >0 for leveled spells
      }
    ]
    ```
* **Write Timing**: Overwritten completely at the end of the execution pipeline, after the new `currentScenario` has finished computing.

#### AI Prompt Serialization Pipeline (Token Saving Utility)
* **Operation**: When compiling context payload for Claude, the backend joins `worldState`, `PartyMember`, and `Character` rows.
* **Token Compression Rule**: Avoid passing raw DB JSON definitions. Condense active elements into structured string blocks including active conditions:
    * *Serialized Format*: `You[LVL:1,HP:10/10,Pos:2,2,Weap:Crowbar,Cond:Poisoned]`

---

### 2. Server-Seeded Security
To prevent client-side tampering, clicking a "Suggestion Chip" instantly requests a secure roll schema array from the server. The client holds individual execution results hidden until physical die animations complete.

---

### 3. Compute Narrative and Suggestion Chips (Pre-Animation Pipeline)
As soon as the roll queue flips to `status: 'COMPLETED'`, the AI DM must immediately perform the following steps while the client plays its remaining visual history elements out:

1.  **Update `currentScenario`**: Based on the final resolved outcomes of all items in the roll sequence, update the narration Markdown block.
2.  **Check Resource Pools & D&D 5e Action Economy Guardrails**: Evaluate eligibility for action chips:
    * **Main Actions**: Eligible if `remainingActions > 0`. Selecting these decrements `remainingActions`.
    * **Bonus Actions**: Eligible if `remainingBonusActions > 0`. Decrements `remainingBonusActions`.
    * **Movement**: Eligible if `remainingMovementFeet > 0`. Decrements `remainingMovementFeet`. *(Do not hide movement until other actions are zero; players can move at any point during their turn).*
    * **5e Bonus Action Spell Restriction**: If a chip with `action_type == 'bonusAction'` AND `spellLevel > 0` is executed during this turn, the flag `Character.hasCastedBonusSpell` must be flipped to `true`. For the remainder of this turn, the chip generator **must not** generate any main action chips where `spellLevel > 0` (only cantrips or martial actions are valid).
    * **Depleted Turn**: If `remainingActions == 0` AND `remainingBonusActions == 0` AND `remainingMovementFeet == 0`, display a single system chip: "No actions available / End Turn".

---

### 4. The User Experience (UX)
* **Trigger**: Player taps an action chip. **[DB WRITE]**: System initializes `activeTurnQueue` with the required rolls array and sets `status: 'PENDING_ROLLS'`, resetting `currentRollIndex: 0`.
* **The Gamble**: A bottom-sheet drawer slides up, displaying the current targeted roll's specific modifiers, modifiers cards, and target threshold derived from `rolls[currentRollIndex]`.
* **Action Roll Loop**: The player taps to roll. A 1.2-second animation plays while the server seed is fetched. **[DB WRITE]**: System mutates the active index item with its `naturalResult`, `totalResult`, and `isSuccess`.
    * **Summary Persistence**: The top of the drawer injects a persistent, color-coded outcome banner summarizing the last executed roll (e.g., "[SUCCESS] Rolled 16 vs 14 DC").
    * **Queue Loop Evaluation**: If another roll remains in the array, the drawer performs a swift cross-fade or flip animation, increments `currentRollIndex`, and updates the cards to show mechanical thresholds for the next roll (e.g., moving from an attack roll to a damage roll, or moving to the next targeted enemy saving throw).
    * **Skip Logic**: If an attack roll yields a miss or a critical failure that nullifies following damage rows, the system skips the remaining dependent roll array slots, mutates `status: 'COMPLETED'`, and triggers Auto-Advance.
* **Auto-Advance**:
    * **The Roll Outcome Block**: After the final array element is resolved, the system loops through the finalized `rolls` payload and renders a stacked history sequence directly above the narrative text using explicit UI badges (`🎲 Attack: 18 vs AC 14 [SUCCESS]`, `⚔️ Damage: 9 Bludgeoning`).
    * **State Transition Timeout**: The system waits 1.5 seconds. **[DB WRITE]**: System flattens modifications out via a single Prisma interactive transaction (`tx.$transaction`) targeting `worldState`, updating the specific affected `Character` rows (Hp, actions pool, conditions), appending the new timeline event block to `narrativeHistory`, overwriting `activeSuggestionChips`, records the finalized scenario block to `currentScenario`, and explicitly **purges/deletes** the completed row from the `activeTurnQueue` table.
    * The drawer slides away to reveal the updated "Field" tab.

---

## Development Priorities
* **Execution Pipeline**: Narrative Generation → Suggestion Chip Generation → Database Persistence.
* **Efficiency**: Minimize token usage by treating Claude as a state-transition engine rather than a page-rendering loop.
* **Technology Stack**: Implement using **Next.js** server actions and **Prisma** for database operations. Use **Tailwind CSS** for the mobile-first UI components.