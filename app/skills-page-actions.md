# Specification: Token-Lean Mechanics-First Action Submission Engine (Party Tab)

## 1. Project Objective & Vision
Enable a secondary, mechanics-driven pathway for players to configure and submit actions directly from the **Party (Stats)** tab using individual skill rows under the **Actions & Skills** section. 

* **The Core UX Challenge:** Asynchronous players must be able to log in, quickly configure a mechanically valid turn, and submit their roll in under 15 seconds without facing choice paralysis, high cognitive load, or typing fatigue.
* **The Token Challenge:** Completely eliminate pre-turn AI generation costs. Instead of using an LLM to generate situational suggestions, the application relies on an immutable client-side mapping engine matched against active database entities.

---

## 2. Mobile UI/UX Design System & Drawer Architecture

### A. Component State Rules
* **Default State (Collapsed):** Skill cards render identically to their current production design. The orange `[ Use ]` CTA button remains permanently visible on the collapsed row to signal interactivity.
* **One-Tap Configuration:** Clicking `[ Use ]` from a collapsed state triggers a **Bottom Sheet Modal Drawer** that slides up over the bottom 60% of the mobile screen. The background screen behind the drawer dims with a dark overlay (scrim). This prevents scrolling overflow or layout shifting within the skill list.
* **Non-Destructive State Cache:** If a drawer is swiped down, the scrim is tapped, or a `✕ Cancel` button is clicked, the sheet closes. Any custom entry or selection must be cached temporarily in local component memory so player progress is preserved if the drawer is re-opened.

### B. The 2-Step Interactive Form Layout
Inside the focused bottom sheet drawer, the UI builds a strict, non-breaking natural language statement using two functional steps styled to match the existing cards in "The Field":
1. **Target Selection:** Renders active database objects, NPCs, or room scopes as clean radio buttons or selectable pills. A permanent fallback option reads `( ) Try something else...`, which reveals a native text input field for custom intent.
2. **Intent Preview Card:** Renders an exact visual replica of the action list items used in "The Field" tab, complete with a left-aligned action description string, a center-aligned color-coded skill modifier badge (e.g., `Athletics +23`), and a right-aligned static action cost badge (e.g., `⚡ 1 Action`).

---

## 3. Strict Resource Trackers & Data Validations

The application must evaluate values within the character table before allowing an interaction to be initiated, configured, or submitted:

* **remainingActions:** If `character.remainingActions === 0`, the primary `[ Use ]` toggle button on the skill row is disabled globally and displays a gray `[ Out of Actions ]` badge.
* **remainingBonusActions:** If a skill card is modified by an active character feature toggle (e.g., Rogue's Cunning Action for Stealth) and `remainingActions` is `0`, evaluate `remainingBonusActions`. If `> 0`, allow the workflow but change the right-hand cost chip from `1 Action` to `1 Bonus Action`.
* **remainingMovementFeet:** For physical skill hazards requiring movement or traversal, compare the room object's distance requirements against the character's remaining movement. Disable the final roll button if current movement is insufficient.
* **Advantage / Disadvantage Toggles:** Evaluate active scene state flags (`hasAdvantage` / `hasDisadvantage`). If true, visually append this information to the roll trigger string (e.g., changing `d20 + 23` to `d20 (Disadvantage) + 23`).
* **Submit Constraints:** The final execution button is inactive (`disabled={true}`) until a target radio selection is explicitly registered or a custom entry in the fallback input achieves a string length `>= 3`.

---

## 4. Deterministic Dynamic Verb Construction Engine

To avoid downstream AI decision ambiguity, the string values inside the verb matrix must completely avoid the word "or". The string engine combines `Verb` + `Target Name` into a perfectly readable, active-voice statement.

### Entity Target Metadata Classifications
All database entities and room objects must expose a `targetType` string property matching one of these categories:
* `humanoid_npc`: Intelligent mortal characters, guards, merchants.
* `monster_beast`: Monstrous threats, creatures, aberrations.
* `heavy_hazard`: Collapsing structures, slamming portcullises, falling debris.
* `structural`: Pillars, walls, barricades, floorboards, windows.
* `container`: Chests, desk drawers, pouches, lockboxes.
* `arcane_relic`: Runes, altars, glowing crystals, planar portals.
* `lore_item`: Books, ledgers, ancient carvings, paintings.
* `hidden_space`: Secret bricks, dark corners, gaps under rugs.

### Complete 18-Skill Definitive Verb Matrix

```typescript
export type TargetType = 
  | "humanoid_npc" 
  | "monster_beast" 
  | "heavy_hazard"
  | "structural" 
  | "container" 
  | "arcane_relic" 
  | "lore_item" 
  | "hidden_space";

export const SKILL_VERB_MAP: Record<string, Record<TargetType, string>> = {
  Athletics: {
    humanoid_npc: "Grapple",
    monster_beast: "Wrestle",
    heavy_hazard: "Brace against",
    structural: "Smash through",
    container: "Prize open",
    arcane_relic: "Physically topple",
    lore_item: "Destroy",
    hidden_space: "Heave away the barrier covering"
  },
  Acrobatics: {
    humanoid_npc: "Evade",
    monster_beast: "Vault over",
    heavy_hazard: "Dodge past",
    structural: "Balance along",
    container: "Flip over",
    arcane_relic: "Leap across",
    lore_item: "Tumble over",
    hidden_space: "Contort yourself to fit into"
  },
  Sleight_of_Hand: {
    humanoid_npc: "Pickpocket",
    monster_beast: "Deftly snatch a trophy from",
    heavy_hazard: "Wedge a tool into",
    structural: "Sabotage a mechanism on",
    container: "Pick the lock of",
    arcane_relic: "Manipulate the moving parts of",
    lore_item: "Conceal and pocket",
    hidden_space: "Reach deep inside the narrow gap of"
  },
  Stealth: {
    humanoid_npc: "Sneak past",
    monster_beast: "Stalk",
    heavy_hazard: "Slip silently under",
    structural: "Hide behind",
    container: "Creep toward",
    arcane_relic: "Approach unseen near",
    lore_item: "Deftly swipe",
    hidden_space: "Conceal yourself inside"
  },
  Arcana: {
    humanoid_npc: "Assess the magical aura of",
    monster_beast: "Identify the planar origin of",
    heavy_hazard: "Disrupt the magical triggers of",
    structural: "Scan for hidden magical seals on",
    container: "Decipher the protective wards on",
    arcane_relic: "Siphon power from",
    lore_item: "Translate the mystical glyphs inside",
    hidden_space: "Detect residual magical traces within"
  },
  History: {
    humanoid_npc: "Recall the ancestral lineage of",
    monster_beast: "Recall historical legends regarding",
    heavy_hazard: "Recall the ancient engineering design of",
    structural: "Identify the origin era of",
    container: "Recall historical context of",
    arcane_relic: "Recall the ancient creation lore of",
    lore_item: "Authenticate the origin of",
    hidden_space: "Recall historical accounts of"
  },
  Investigation: {
    humanoid_npc: "Scrutinize the physical tells of",
    monster_beast: "Search for structural weaknesses on",
    heavy_hazard: "Examine the triggering mechanism of",
    structural: "Search for architectural flaws in",
    container: "Ransack and catalog",
    arcane_relic: "Deconstruct the physical patterns of",
    lore_item: "Cross-reference the details inside",
    hidden_space: "Sift through the debris inside"
  },
  Nature: {
    humanoid_npc: "Analyze the biological traits of",
    monster_beast: "Identify the harvestable components of",
    heavy_hazard: "Predict the natural trajectory of",
    structural: "Identify the organic rot affecting",
    container: "Examine the natural materials of",
    arcane_relic: "Analyze the elemental affinity of",
    lore_item: "Identify the biological medium used in",
    hidden_space: "Scan for natural venomous tracks inside"
  },
  Religion: {
    humanoid_npc: "Identify the holy sect affiliation of",
    monster_beast: "Recall the divine myths regarding",
    heavy_hazard: "Identify the unholy curse pulsing through",
    structural: "Identify the sacred geometry carved into",
    container: "Purify the defiled seal on",
    arcane_relic: "Perform a rite of consecration on",
    lore_item: "Interpret the theological scripture within",
    hidden_space: "Bless the desecrated ground inside"
  },
  Animal_Handling: {
    humanoid_npc: "Calm the mount belonging to",
    monster_beast: "Pacify the aggressive instincts of",
    heavy_hazard: "Guide a draft animal away from",
    structural: "Lure an animal out from the structural gaps of",
    container: "Safely coax a hidden critter out of",
    arcane_relic: "Discourage a beast from defiling",
    lore_item: "Train a creature to fetch",
    hidden_space: "Track a hidden nesting spot inside"
  },
  Insight: {
    humanoid_npc: "Read the true motives of",
    monster_beast: "Anticipate the combat posture of",
    heavy_hazard: "Predict the collapse timing of",
    structural: "Discern the intentional structural trickery of",
    container: "Sense the deceptive nature of",
    arcane_relic: "Intuit the raw spiritual purpose of",
    lore_item: "Grasp the underlying authorial intent of",
    hidden_space: "Intuit why someone hid items inside"
  },
  Medicine: {
    humanoid_npc: "Stabilize the wounds of",
    monster_beast: "Anatomically study the carcass of",
    heavy_hazard: "Evaluate the blunt-force trauma risk of",
    structural: "Sanitize the diseased surface of",
    container: "Inspect for lethal contact poisons on",
    arcane_relic: "Treat exposure symptoms caused by",
    lore_item: "Identify forensic blood splatter on",
    hidden_space: "Check for biological contagion hazards inside"
  },
  Perception: {
    humanoid_npc: "Listen to the distant whispering of",
    monster_beast: "Spot the camouflaged outline of",
    heavy_hazard: "Hear the grinding components of",
    structural: "Spot a tiny seam in",
    container: "Listen for shifting contents inside",
    arcane_relic: "Notice the faint humming energy of",
    lore_item: "Spot an obscured detail on",
    hidden_space: "Peer directly into the darkness of"
  },
  Survival: {
    humanoid_npc: "Track the footprints left by",
    monster_beast: "Forage material components from",
    heavy_hazard: "Navigate a safe route around",
    structural: "Improvise a structural brace on",
    container: "Scavenge usable materials from",
    arcane_relic: "Track the strange radiation emitting from",
    lore_item: "Preserve the fragile state of",
    hidden_space: "Examine the primitive shelter potential inside"
  },
  Deception: {
    humanoid_npc: "Lie flagrantly to",
    monster_beast: "Feign a harmless posture toward",
    heavy_hazard: "Trick onlookers regarding your proximity to",
    structural: "Create a misleading distraction hitting",
    container: "Conceal your true intent while opening",
    arcane_relic: "Masquerade your magical presence near",
    lore_item: "Forge a replica of",
    hidden_space: "Create a false lead pointing away from"
  },
  Intimidation: {
    humanoid_npc: "Coerce",
    monster_beast: "Cow the fighting spirit of",
    heavy_hazard: "Vent your raw fury at",
    structural: "Violently strike a warning blow against",
    container: "Aggressively smash open",
    arcane_relic: "Defiantly challenge the power of",
    lore_item: "Vandallize the surface of",
    hidden_space: "Fiercely command whatever is lurking inside"
  },
  Performance: {
    humanoid_npc: "Captivate the attention of",
    monster_beast: "Distract the bestial senses of",
    heavy_hazard: "Execute a theatrical stunt dodging",
    structural: "Use the acoustics of",
    container: "Dramatically reveal the contents of",
    arcane_relic: "Chant a dramatic historical ballad near",
    lore_item: "Orate the epic tales found within",
    hidden_space: "Stagewhisper an echo into"
  },
  Persuasion: {
    humanoid_npc: "Reason diplomatically with",
    monster_beast: "Establish a non-threatening rapport with",
    heavy_hazard: "Calmly coordinate a group evacuation from",
    structural: "Request peaceful permission to clear",
    container: "Respectfully ask for access to",
    arcane_relic: "Plead for safe passage past",
    lore_item: "Negotiate the purchase or trade of",
    hidden_space: "Calmly assure whoever is cowering inside"
  }
};
```

## Frontend Assembly Engine Example
```
const resolveActionString = (skillKey: string, targetEntity: any) => {
  if (targetEntity.id === 'custom_fallback') {
    return targetEntity.customTextValue;
  }
  const verb = SKILL_VERB_MAP[skillKey][targetEntity.targetType as TargetType];
  return `${verb} ${targetEntity.name}`;
};
```

## 5. State Handoff Workflow
1. **Confirmation**: The user verifies the live Intent Preview Card match and taps `[ Confirm & Roll ]`.
2. **Lockdown**: Form fields lock down (`disabled={true}`) and a global 3D canvas dice-rolling overlay plays.
3. **Payload Resolution**: The client resolves the final integer payload: `1d20 Result + Skill Modifier Score`.
4. **Transition**: Upon animation completion, the client programmatically transitions the top navigation active tab from **Party** to **The Field**.
5. **API Delivery**: The processed interaction text and roll integers are delivered to the *Stage 2 Narrative Storyteller API* endpoint, pinning a loading skeleton state to the top of the history timeline feed.