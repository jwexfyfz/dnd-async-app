---
phase: 3
slug: leveling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`globals: false`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:run -- lib/leveling.test.ts` |
| **Full suite command** | `npm run test:run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:run -- lib/leveling.test.ts`
- **After every plan wave:** Run `npm run test:run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | LVL-01, LVL-02, LVL-05 | — | N/A | unit | `npm run test:run -- lib/leveling.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | LVL-01 | T-03-01 | Unknown class → throws | unit | `npm run test:run -- lib/leveling.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 1 | LVL-02, LVL-03 | — | N/A | unit | `npm run test:run -- lib/leveling.test.ts` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 1 | LVL-03 | — | N/A | manual | — | N/A | ⬜ pending |
| 03-05-01 | 05 | 2 | LVL-05 | — | N/A | unit | `npm run test:run -- lib/leveling.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/leveling.test.ts` — test stubs for LVL-01 (`maxHpAtLevel` all classes/levels), LVL-02 (multi-level-up XP jump), LVL-05 (CON modifier edge cases: CON 6/10/16)

*(No framework installation needed — Vitest already installed; `dice.test.ts` and `xp.test.ts` are passing)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| New Fighter character has maxHp = 10 + CON mod in DB | LVL-03 | Requires creating a character and checking DB value | Create a Fighter with CON 14 (mod +2) → verify `character.maxHp` = 12 in DB |
| Level-up info card renders in chat UI after XP gain causes level-up | LVL-02 | Requires end-to-end game session with XP award | Start a game, complete an encounter, verify levelUpResult card appears above narrative |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
