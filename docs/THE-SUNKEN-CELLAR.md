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

## Story Flags Reference

| Flag | Set When | Used For |
|---|---|---|
| `commander_note_read` | Party reads Commander's Note in Armory | Act 1 → Act 2 trigger |
| `vorne_identity_known` | Party reads Signet Ring or Trophy Wall history result | DM flavor in Act 2+ |
| `mira_freed` | Party interacts with Prisoner Cage | Mira joins as ally |
| `harwick_defeated` | Harwick's HP reaches 0 | Act 2 clears; affects Act 3 opening |
| `harwick_fled` | Harwick flees below half HP | Alternative Act 2 clear; Harwick reappears |
| `ritual_disrupted` | Party interacts with Ritual Circle to destroy it | Act 2 clears; weakens Varath |
| `ritual_completed` | Party somehow completes Harwick's (wrong) ritual | Bad path flag |
| `maren_rescued` | Party interacts with Chained Merchant | Enables good ending |
| `binding_seal_used` | Party interacts with Binding Seal | Act 3 clears |
| `binding_seal_destroyed` | Party destroys the seal | Bad ending flag |
| `binding_seal_kept` | Party takes the seal without using it | Neutral ending flag |

---

## Room Reference

### Entry Chamber (22222222) — map(0, 0)
**Significant POIs:** Stone Fountain (hidden healing vial), Wooden Barricade (cover),
Iron Pillar (coin pouch), Dark Passage North (exit to Flooded Passage)

### The Flooded Passage (77777777) — map(0, -1)
**Significant POIs:** Collapsed Pillar (Old Imperial inscription; iron key wedged in crack),
Stagnant Pool (waterlogged journal, folded map, bronze amulet), Rusted Iron Gate (exit south),
Submerged Gate North (locked in Act 1; unlocked in Act 2 — exit to Guard Post)

### The Armory (eeeeeeee) — map(1, 0)
**Significant POIs:** Weapon Rack (hand axe; missing halberd — Harwick has it),
Trophy Wall (Vorne crest — sets `vorne_identity_known`),
Locked Chest (Commander's Note — sets `commander_note_read`; healing potion; gold)

### Guard Post (a1a1a1a1) — map(0, -2)
**Significant POIs:** Guard's Table (submerged_gate_key), Slumped Guard / Beren (vorne_key;
can be roused for intel), Vorne Iron Door North (locked by vorne_key; exit to Ritual Chamber)

### Ritual Chamber (b2b2b2b2) — map(0, -3)
**Significant POIs:** Ritual Circle (can be disrupted — sets `ritual_disrupted`),
Prisoner Cage / Mira (sets `mira_freed`), Stone Altar (Harwick's grimoire + reagent box),
Harwick Vorne (NPC/enemy), Hidden Door East (proximity-only; opens in Act 3; exit to Sealed Vault)

### Sealed Vault (c3c3c3c3) — map(1, -3)
**Significant POIs:** Binding Seal (final interaction point),
Chained Merchant / Maren Ashwick (sets `maren_rescued`; enables good ending),
Vorne Family Ledgers (financial records; evidence of the original scandal)
