# The Sunken Cellar — Story Bible

## Logline

A desperate nobleman has retreated to his family's drowned garrison to bind a demon and
reclaim his lost name. The ritual is failing, innocents are trapped below, and the demon
is the one doing the manipulating.

---

## Premise

House Vorne was a minor noble family that funded dungeon expeditions two decades ago.
They were declared extinct after a scandal involving grave robbery and occult dealings.
They weren't extinct — Harwick Vorne, the last heir, went underground.

Harwick has secretly returned to the family's old garrison cellar, now partially flooded
from years of neglect, with a singular obsession: bind the demon Varath using the vault's
ancient Binding Seal, control it, and use its power to restore House Vorne's name and
standing. He has spent months preparing — driving off the garrison's last tenants, flooding
the lower passage to discourage intruders, and gathering the ritual components.

The ritual is failing. Varath is partially bound but not contained. Harwick, unaware that
the demon is conscious and actively manipulating him, is being guided toward making errors
that will free Varath rather than bind it. To cover his mistakes, Harwick has imprisoned
two witnesses: Mira, a young thief who stumbled onto the operation, and Maren Ashwick, a
traveling merchant he intends as a potential sacrifice if the ritual demands blood.

The players enter the cellar looking for shelter, a missing person, or loot — and descend
into something far older and more dangerous than they expected.

---

## Act Structure

### Act 1 — "The Empty Cellar"
**Rooms:** Entry Chamber, Flooded Passage, Armory  
**Theme:** Atmosphere and archaeology. The cellar feels abandoned but recently disturbed.
Clues in the armory (the Vorne crest, the Commander's Note) establish the House Vorne
backstory and hint that someone has been here recently.  
**Clears when:** `commander_note_read` flag is set (party reads the Commander's Note from
the Locked Chest in the Armory).

### Act 2 — "The Deep Guard"
**Rooms:** All Act 1 rooms + Guard Post + Ritual Chamber  
**Theme:** Confrontation. The Submerged Gate unlocks at act start (Harwick opened it to
move supplies deeper). The party encounters Harwick's operation in progress.  
**onStartMutations:** Unlock Submerged Gate North in Flooded Passage (remove lock).  
**Clears when:** `ritual_disrupted` OR `harwick_defeated` flag is set.

### Act 3 — "The Binding"
**Rooms:** All rooms + Sealed Vault  
**Theme:** Resolution. The Hidden Door East in the Ritual Chamber is revealed at act start.
What waits in the vault depends on what the party chose in Act 2.  
**onStartMutations:** Reveal Hidden Door East (set visibility to "always").  
**Clears when:** `binding_seal_used` flag is set (party interacts with the Binding Seal —
outcome varies based on `maren_rescued` and other accumulated flags).

---

## NPC Profiles

### Harwick Vorne — Villain
The last heir of House Vorne. Late 40s, lean and hollow-eyed from weeks underground.
Once presentable; now ragged, paranoid, and convinced he is weeks away from triumph.
Carries the family halberd (taken from the Armory weapon rack — the missing weapon).

**Motivation:** Restore House Vorne's name and standing. Harwick believes the Binding Seal
can compel Varath to act as the family's supernatural enforcer — giving him the leverage
to call in old debts, expose enemies, and force a formal pardon for the grave robbery scandal.

**Personality:** Proud, brittle, and increasingly irrational. He will not accept that the
ritual is failing. He deflects by blaming his tools, his guards, and his prisoners. When
confronted, he is more likely to bluster and threaten than to listen.

**Combat:** Uses the family halberd (reach, heavy). Fights competently but is a coward at
heart — if reduced below half HP or if Varath is contained, he breaks and tries to flee.
**Flee:** Sets `harwick_fled` flag. Harwick escapes through the flooded passage.

### Mira — Ally (Act 2+)
Young thief, early 20s. She broke into the cellar looking for the Armory's rumored cache.
Captured by a Vorne Guard before she reached it. She's been in the cage long enough to
map the ritual chamber from observation.

**What she knows:** Harwick's name, that he plans to use a person as a "vessel anchor" for
the demon, and that the whispers near the vault have been getting louder. She doesn't know
what Varath is but suspects it's more dangerous than Harwick understands.

**Freed by:** `mira_freed` flag (interact with Prisoner Cage). She will fight alongside the
party if given a weapon. She has Rogue stats (AC 13, 18 HP, dagger 1d4+3, Sneak Attack 2d6).

### Maren Ashwick — Neutral / Ally
Traveling merchant, mid-30s, practical and unsentimental. She was captured 4 days ago when
she came to the cellar seeking payment for a shipment of ritual reagents she had delivered
for Harwick months earlier. When he realized she knew too much, he locked her in the vault.

**What she knows:** Maren has traded in occult goods her entire career. She recognizes the
Binding Seal as pre-Imperial Varath-class binding architecture. She knows the correct
completion procedure (three anchors, no blood, spoken in Old Imperial) and that Harwick's
version is dangerously wrong. She can guide the party through the correct binding.

**Freed by:** `maren_rescued` flag (interact with Chained Merchant). If the party frees
her AND has the Binding Seal available, she enables the good ending.

### Vorne Guard — Neutral (can become informant)
Harwick's last loyal retainer, a broad-shouldered man in his 30s named Beren. Found
slumped unconscious at the Guard Post. He is not dead — Harwick drugged his ale to prevent
him from interfering in the final ritual preparations (Harwick doesn't want witnesses).

He can be roused with a Medicine DC 12 check. If awakened, he is disoriented and
frightened. He will tell the party:
- Harwick has been talking to something in the vault for weeks.
- Two prisoners are being held below.
- The ritual was supposed to be done a month ago but "it keeps going wrong."
- He carries the `vorne_key` (for the Iron Door North) on his person.

### Varath — Conditional Enemy
An ancient demon, partially bound in the Sealed Vault by pre-Imperial architecture.
Varath does not appear in person — it manifests as whispers, compulsions, and false visions
near the Binding Seal. It is intelligent and patient.

**Goal:** Corrupt the binding ritual so that the seal inverts, freeing Varath and anchoring
Harwick in its place. It has been guiding Harwick toward this error for months.

**In Act 3:** If the party reaches the vault without freeing Maren, Varath will attempt to
manipulate the party directly — offering knowledge, power, or safe passage in exchange for
breaking the seal. These are lies.

**Outcomes:**
- `binding_seal_destroyed`: Varath escapes. Bad ending. The demon is loose.
- `binding_seal_kept`: Party holds the seal but doesn't complete the binding. Neutral ending.
  Varath remains partially bound, a future problem.
- `binding_seal_used` (without `maren_rescued`): Party attempts binding without Maren's
  guidance. Roll Arcana DC 18 or the binding inverts — Varath escapes.
- `binding_seal_used` + `maren_rescued`: Maren guides the correct completion. Varath is
  contained permanently. Good ending.

---

## Hidden Side Quests

### The Ward Phrase (Flooded Passage → Sealed Vault)
The collapsed pillar in the Flooded Passage has a second inscription below the garrison dedication: a pre-Imperial ward phrase used to protect ritual binders from compulsion. **Arcana DC 14** to identify and memorize it (sets `ward_phrase_known`). Knowing it lowers the unguided binding DC by 4 and the Maren-guided binding DC by 3.

### The Occultist's Journal (Flooded Passage → Sealed Vault)
The Occultist's Journal in the Stagnant Pool documents a previous failed binding attempt. **Investigation DC 12** to extract the key insight: Varath cannot manipulate someone who genuinely wants nothing (sets `occultist_notes`). Lowers unguided binding DC by 2 and grants advantage on resisting Varath's compulsions. The **Bronze Amulet** in the same pool has `passive_effect: disadvantage_varath_will` when worn.

### Beren's Loyalty (Guard Post → Ritual Chamber)
Beren can be roused with Medicine DC 12 (`beren_roused`). If the party then tells him Harwick drugged him deliberately (Persuasion DC 12), he turns (`beren_loyal`): won't fight Harwick but holds the passage to prevent `harwick_fled`, and tells the party where Maren is held, skipping the need to locate her through the ritual chamber.

### Mira's Hidden Cache (Armory)
After freeing Mira, she reveals a loose stone behind the Armory weapon rack. The POI (`loose_stone_cache`) becomes visible when `mira_freed` is set (or Investigation DC 18 blind). Contains:
- **Oil of Silence** — useful for ritual chamber stealth  
- **Planted Evidence Note** (`conspiracy_known`) — proof that the Vorne "grave robbery scandal" was self-arranged as a deliberate disappearance. Showing this to Harwick (Persuasion) can make him stand aside without combat, as the justification for his entire obsession collapses.

### Glet the Imp (Ritual Chamber → Sealed Vault intel)
Reading Harwick's grimoire aloud from the Stone Altar summons Glet (`glet_summoned`), a minor imp who was napping inside the binding diffusion. Hostile to Varath. Answers one honest question about the vault before departing: the Binding Seal is correctly made, Maren knows the right procedure, and the flaw is entirely in the ritual circle above.

### Fixing the Ritual Circle (Ritual Chamber → Sealed Vault)
Rather than destroying it, players can attempt to correct Harwick's anchor glyph errors (**Arcana DC 16**, sets `circle_partially_corrected`). Success lowers the unguided binding DC by 4. Harwick, if he sees this, pauses — it's the first thing that's gone right for him in weeks.

---

## Easter Eggs

| Action | Location | Result |
|---|---|---|
| Drink from the fountain | Entry Chamber | Random: 1–3 cursed death save, 4–5 nothing, 6 heal 1d4 |
| Reach into the drain pipe | Entry Chamber | Athletics DC 10: satchel with 15gp, Explorer's Dagger, grocery list |
| Read the pillar inscription backwards | Flooded Passage | Algae vibrates; brief sense of being heard |
| Speak to rats (Speak with Animals) | Flooded Passage | Intel on Mira, Harwick's patrol, Maren's location — costs 1 ration |
| Tickle Beren | Guard Post | Nat 20 only: he mumbles "Lena… the merchant said…" (hints at Maren) |
| Pry the Vorne crest off the wall | Armory | Locket with sister portrait — future hook (`locket_found`) |
| Try on the Vorne armor | Armory | +1 AC, -1 CHA; Beren and Harwick react to the crest |
| Sing near the Ritual Circle | Ritual Chamber | Circle glyphs brighten momentarily; Harwick's muttering stops |
| Read the grimoire aloud | Ritual Chamber | Summons Glet the imp (see side quests above) |
| Pour liquid into the Ritual Circle | Ritual Chamber | Water: weakens it; Oil: makes it flammable; Blood: advances ritual (bad) |
| Sing near the Binding Seal | Sealed Vault | Seal whispers harmonize briefly; reveals Varath's loneliness as a foothold |

---

## Story Flags Reference

| Flag | Set When | Used For |
|---|---|---|
| `commander_note_read` | Party reads Commander's Note in Armory | Act 1 → Act 2 trigger |
| `vorne_identity_known` | Party reads Signet Ring or Trophy Wall history result | DM flavor in Act 2+ |
| `mira_freed` | Party interacts with Prisoner Cage | Mira joins as ally; reveals hidden cache |
| `harwick_defeated` | Harwick's HP reaches 0 | Act 2 clears; affects Act 3 opening |
| `harwick_fled` | Harwick flees below half HP | Alternative Act 2 clear; Harwick reappears |
| `ritual_disrupted` | Party interacts with Ritual Circle to destroy it | Act 2 clears; weakens Varath |
| `ritual_completed` | Party somehow completes Harwick's (wrong) ritual | Bad path flag |
| `maren_rescued` | Party interacts with Chained Merchant | Enables good ending |
| `binding_seal_used` | Party interacts with Binding Seal | Act 3 clears |
| `binding_seal_destroyed` | Party destroys the seal | Bad ending flag |
| `binding_seal_kept` | Party takes the seal without using it | Neutral ending flag |
| `ward_phrase_known` | Arcana DC 14 on Collapsed Pillar | −4 DC on unguided binding, −3 DC with Maren |
| `occultist_notes` | Investigation DC 12 on Occultist's Journal | −2 DC on binding; advantage vs Varath compulsion |
| `beren_roused` | Medicine DC 12 on Slumped Guard | Enables loyalty path |
| `beren_loyal` | Persuasion DC 12 after `beren_roused` | Beren blocks Harwick's flee route; reveals Maren's location |
| `mira_cache_found` | Interact with Loose Stone Behind Rack | Items: oil_of_silence, conspiracy_note |
| `conspiracy_known` | Read Planted Evidence Note | Enables talk-down path with Harwick (no combat) |
| `locket_found` | Pry Vorne crest from Trophy Wall | Future-session hook only |
| `vorne_armor_worn` | Equip Vorne Family Plate from Weapon Rack | NPC reaction flavor; +1 AC, −1 CHA |
| `circle_partially_corrected` | Arcana DC 16 on Ritual Circle | −4 DC on binding attempt |
| `circle_oiled` | Pour oil into Ritual Circle | Circle becomes flammable; torch = `ritual_disrupted` + fire hazard |
| `blood_in_circle` | Pour blood into Ritual Circle | Advances ritual (bad); Harwick excited |
| `glet_summoned` | Read grimoire aloud at Stone Altar | Glet answers one vault question |
| `glet_dismissed` | Glet departs | Flavor only |

---

## Room Reference

### Entry Chamber (22222222) — map(0, 0)

| POI | ID | Notes |
|---|---|---|
| Stone Fountain | 33333333 | Healing vial (Perception DC 10); silver ring (Investigation DC 11). **Drink** — random d6: 1–3 curse, 4–5 nothing, 6 heal 1d4. **Reach into drain pipe** (Athletics DC 10) → satchel: 15gp, Explorer's Dagger, grocery list |
| Wooden Barricade | 44444444 | Cover; old dagger (Perception DC 8); carved token → `faction_sigil` (Investigation DC 15) |
| Iron Pillar | 55555555 | Cover/elevation; coin pouch (Investigation DC 12) |
| Dark Passage North | 66666666 | Exit → Flooded Passage |
| Wide Archway East | dddddddd | Exit → Armory (arch width 2; peek shows obvious items) |
| Open Space | bbbbbbbb | Loose stone (throwable improvised); thieves' tools |

### The Flooded Passage (77777777) — map(0, -1)

| POI | ID | Notes |
|---|---|---|
| Collapsed Pillar | 88888888 | History DC 13: garrison lore. **Arcana DC 14: ward phrase → `ward_phrase_known`** (−4/−3 DC on binding). Iron key in crack (Perception DC 12); dried herbs (Investigation DC 10). Easter egg: read backwards |
| Stagnant Pool | 99999999 | Occultist's Journal (obvious) → `occultist_notes` via Investigation DC 12 (−2 binding DC; advantage vs Varath). Folded map → `dungeon_layout` (Investigation DC 13). **Bronze Amulet** (Perception DC 14) — `passive_effect: disadvantage_varath_will` |
| Open Space | cccccccc | Easter egg: Speak with Animals → rats give intel on Mira/Harwick/Maren for 1 ration |
| Rusted Iron Gate | aaaaaaaa | Exit → Entry Chamber |
| Submerged Gate North | 77000001 | Locked (`submerged_gate_key` / DC 18); exit → Guard Post. Locked in Act 1; Harwick opens it at Act 2 start |

### The Armory (eeeeeeee) — map(1, 0)

| POI | ID | Notes |
|---|---|---|
| Weapon Rack | ff000001 | Hand axe (obvious); hunting bow (Perception DC 9). **Vorne Family Plate** (Perception DC 11) — `passive_effect: vorne_presence`, +1 AC/−1 CHA, NPC reactions change → `vorne_armor_worn` |
| Trophy Wall | ff000002 | History DC 12: Vorne crest → `vorne_identity_known`. Signet Ring → `noble_house` (Investigation DC 13). **Easter egg: pry crest** (Athletics DC 12) → locket → `locket_found` (future hook) |
| Heavy Crate | ff000003 | Torch bundle, rope coil (obvious); ration pack (Perception DC 8) |
| Locked Chest | ff000006 | Locked by iron_key (or thieves' tools DC 14). Commander's Note → `commander_note_read` (Act 1 clear); healing potion; 15gp |
| Loose Stone Behind Rack | ff000007 | **Hidden until `mira_freed`** (or Investigation DC 18). Oil of Silence; Planted Evidence Note → `conspiracy_known` (enables talk-down path with Harwick) |
| Wide Archway West | ff000004 | Exit → Entry Chamber |
| Open Space | ff000005 | |

### Guard Post (a1a1a1a1) — map(0, -2)

| POI | ID | Notes |
|---|---|---|
| Guard's Table | a1000001 | Submerged Gate Key (Perception DC 12). Ale smells of dreamroot (Perception DC 14) |
| Slumped Guard / Beren | a1000002 | Medicine DC 12 → `beren_roused` + `vorne_key`. Persuasion DC 12 ("he drugged you") → `beren_loyal`: blocks `harwick_fled`; reveals Maren's location. Easter egg: **tickle** — nat 20 only, hears him mumble Maren's name |
| Vorne Iron Door North | a1000003 | Locked by `vorne_key` (or DC 16); exit → Ritual Chamber |
| Stone Passage South | a1000004 | Exit → Flooded Passage |
| Open Space | a1000005 | Tally marks scratched in stone: 20 days |

### Ritual Chamber (b2b2b2b2) — map(0, -3)

| POI | ID | Notes |
|---|---|---|
| Ritual Circle | b2000001 | Arcana DC 13 to **disrupt** → `ritual_disrupted` (Act 2 clear). Arcana DC 16 to **fix** → `circle_partially_corrected` (−4 binding DC). **Pour liquid**: water weakens it; oil → `circle_oiled` (flammable, torch = disrupted + fire); blood → `blood_in_circle` (advances ritual). Easter egg: sing near it |
| Prisoner Cage / Mira | b2000002 | Iron key or thieves' tools DC 12 → `mira_freed`. Mira reveals hidden cache in Armory |
| Stone Altar | b2000003 | Grimoire → `grimoire_read`; anchor reagents (Investigation DC 11). Easter egg: **read grimoire aloud** → Glet the imp → `glet_summoned` (one honest vault question) |
| Harwick Vorne | b2000004 | AC 14, 38 HP, halberd 1d10+2, reach. Flees at 50% → `harwick_fled`. **Showing `conspiracy_known` + Persuasion = no combat**. `vorne_armor_worn` rattles him |
| Hidden Door East | b2000006 | `visibility: proximity_only`; revealed to "always" at Act 3 start. Exit → Sealed Vault |
| Iron Door South | b2000005 | Exit → Guard Post |
| Open Space | b2000007 | |

### Sealed Vault (c3c3c3c3) — map(1, -3)

| POI | ID | Notes |
|---|---|---|
| Binding Seal | c3000001 | **With `maren_rescued`**: Arcana DC 12 (−3 if `ward_phrase_known`, −2 if `circle_partially_corrected`) → `binding_seal_used`. **Without Maren**: Arcana DC 18 (−4 `ward_phrase_known`, −4 `circle_partially_corrected`, −2 `occultist_notes`, −2 bronze amulet) — failure → `binding_seal_destroyed`. Destroy the seal → `binding_seal_destroyed`. Easter egg: **sing** near it |
| Chained Merchant / Maren | c3000002 | `vorne_key` or thieves' tools DC 12 → `maren_rescued`. Enables good ending; lowers binding DC |
| Vorne Family Ledgers | c3000003 | Investigation DC 12: criminal conspiracy evidence. History DC 13: grave-robbery scandal detail. Hidden blank royal pardon (Investigation DC 12) → `pardon_found` |
| Vault Door West | c3000004 | Exit → Ritual Chamber |
| Open Space | c3000005 | Absolute silence. Perception DC 14: a second heartbeat |
