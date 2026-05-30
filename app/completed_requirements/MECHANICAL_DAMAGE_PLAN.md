# Mechanical Damage Calculation Plan

## Executor Instructions
- Do not explain your reasoning, output code blocks, or chat. Execute the task completely. Once finished, output exactly one of:
  - `SUCCESS: [Brief 1-sentence summary of what was done]`
  - `ERROR: [Brief description of the failure and the blocking issue]`
- Track each task's completion below (mark `[x]` when done).
- Before providing final code: (1) list 3–5 distinct edge cases, (2) mentally dry-run logic against them, (3) include runnable unit tests in the output, (4) verify zero placeholder text — production-ready only.
- Backfill all records affected by schema changes using best-judgement defaults.

## Goal
Replace AI-emitted `<combat_effect>` tags for player attack damage with code-computed damage rolls. The AI continues to narrate creative outcomes for crits/fumbles but no longer owns the delta value.

## Why
- AI forgets to emit tags, emitting wrong delta, or wrong target_id → HP never changes
- Attack roll is already mechanical; damage should be too
- Enemy→player damage (AoO, NPC turns) is already fully mechanical — this brings player→enemy in line

## What stays AI-driven
- Healing (potions, spells)
- Environmental/trap damage
- Spell effects without a weapon roll
- Narrative for crits (nat 20) and fumbles (nat 1) — AI still sees the full dice result including CRITICAL HIT / FUMBLE labels

---

## Tasks

- [x] **A. Schema** — add `damageDice String @default("1d4")` and `attackBonus Int @default(0)` to `Item` model in `prisma/schema.prisma`
- [x] **B. Migration** — `20260530032525_add_item_damage_dice` applied
- [x] **C. Seed weapons** — `seed-equippable-items.ts` (had it), `seed-items.ts` (updated ItemBlueprint + all items), `seed-enemy-weapons.mjs` (added damageDice per weapon)
- [x] **D. Backfill existing items** — `prisma/backfill-item-damage-dice.mjs` run; 51 items updated
- [x] **E. `resolve-roll.ts`** — DAMAGE QueueRoll (pre-seeded by initialize-turn-queue) carries dice formula; crit doubles it, miss skips it; totalResult is the damage value
- [x] **F. `auto-advance.ts`** — reads DAMAGE roll totalResult as pendingDamage; applies to GameMap; injects MECHANICAL RESULT into prompt; filters AI combat_effect for same target
- [x] **G. `take-turn.ts`** — direct-chip path uses `computeAttackDamage(weapon.damageDice, statMod, isCrit)` from lib/mechanical-damage.ts
- [x] **H. Prompt cleanup** — both files: "Player weapon attack damage is computed mechanically — DO NOT emit combat_effect for it"
- [x] **I. Tests** — `lib/mechanical-damage.test.ts` (rollDamageExpr, computeAttackDamage, clampHp); auto-advance.test.ts and handle-player-action.test.ts fixed; 271/271 pass
- [x] **J. Revert temp fix** — combat_effect prompt scoped to healing/environmental only (done as part of H)

---

## Key files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `damageDice`, `attackBonus` to `Item` |
| `prisma/seed.mjs` + item seeds | Set damage dice per weapon |
| `app/actions/resolve-roll.ts` | Compute damage on hit, store on turn queue |
| `app/actions/auto-advance.ts` | Read stored damage, apply to GameMap, inject into prompt |
| `app/actions/take-turn.ts` | Same for direct-chip path |
| `lib/combat-effect.ts` | No change (still used for spells/healing) |

## Reference
- Existing mechanical damage pattern: `take-turn.ts:979` (AoO block uses `rollDamageExpr(preparedAoO.damageDice)`)
- `rollDamageExpr` already defined at `take-turn.ts:36`
- Crit flag: `diceResult.critical` (boolean, already computed)
- `ActiveTurnQueue` schema — check if it has a field to carry `pendingDamage` or if we need to add one

---

## Tests

File: `lib/mechanical-damage.test.ts` (or alongside `resolve-roll.test.ts`)

### `rollDamageExpr` — dice math
| # | Input | Expected |
|---|-------|----------|
| 1 | `"1d6"`, result in 1–6 | returns integer ∈ [1, 6] |
| 2 | `"1d4+2"` | returns integer ∈ [3, 6] |
| 3 | `"2d6+3"` | returns integer ∈ [5, 15] |
| 4 | crit: call twice and sum `"1d8"` | returns integer ∈ [2, 16] |
| 5 | unarmed (`"1d4"`), STR mod +2 | returns integer ∈ [3, 6] |

### `computeAttackDamage(weapon, statMod, isCrit)` — new helper
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Normal hit, shortsword `"1d6"`, STR mod +2 | damage ∈ [3, 8] |
| 2 | Critical hit, `"1d6"`, STR mod +2 | damage ∈ [4, 14] (2d6 + mod) |
| 3 | Nat 1 (fumble) — miss, no damage call | `computeAttackDamage` never called; caller handles |
| 4 | `mainHand` null (unarmed) | uses `"1d4"` default + STR mod |
| 5 | `Item.attackBonus = 2` enchanted weapon | attack roll includes +2; damage uses weapon dice only (enchant bonus is to hit, not damage, unless also in `damageDice` string) |

### HP application — `clampHp`
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Enemy at 4 HP, hit for 3 | newHp = 1 |
| 2 | Enemy at 1 HP, hit for 5 (overkill) | newHp = 0 (floor, not negative) |
| 3 | Enemy at 0 HP (already dead) | newHp = 0; attack should be skipped upstream |
| 4 | Crit finishes enemy exactly | newHp = 0; `encounterResult` evaluated correctly |

### `pendingDamage` round-trip
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Hit: `resolve-roll` stores `pendingDamage` in rolls JSON | `auto-advance` reads same value, applies to GameMap |
| 2 | Miss: no `pendingDamage` stored | `auto-advance` applies 0 damage; GameMap unchanged |
| 3 | Turn expires / stale queue | `auto-advance` treats missing `pendingDamage` as 0 |

### Prompt injection
| # | Scenario | Expected |
|---|----------|----------|
| 1 | Normal hit, 5 damage, enemy at 3 HP | Prompt contains `"hit for 5 damage"` and `"3 HP remaining"` |
| 2 | Critical hit, 12 damage, enemy dies | Prompt contains `"CRITICAL HIT"` and `"0 HP"` / `"defeated"` |
| 3 | Miss | Prompt contains no damage number; AI narrates the miss |

---

## Decisions
1. **`pendingDamage` storage** — embed in `ActiveTurnQueue.rolls` JSON (no schema change). `resolve-roll` writes `{ ..., pendingDamage: N }` after computing a hit; `auto-advance` reads it.
2. **`Item.attackBonus` stacking** — follows 5e: item bonus (enchantment) stacks on top of the character's STR/DEX modifier. Total attack = d20 + stat modifier + item.attackBonus. Default 0 (non-magical weapons).
3. **Unarmed / no weapon** — `"1d4 + STR"` per 5e Unarmed Strike rules (monk base, also applies to improvised). When `mainHand` is null, use `"1d4"` and add STR modifier.
